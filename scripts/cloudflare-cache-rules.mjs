#!/usr/bin/env node
/**
 * Cloudflare cache-rule automation for chuglii.in
 *
 * Creates/updates two rules in the `http_request_cache_settings` phase:
 *
 *   1. /api/media  -> Eligible for cache, edge + browser TTL respect origin.
 *                    Today Cloudflare returns `cf-cache-status: DYNAMIC` for
 *                    this path, so every cold image pays a trans-Pacific round
 *                    trip to the Vercel function in iad1 (~1400ms) while the
 *                    same bytes are already cached at Vercel (HIT, 138ms).
 *
 *   2. /sw.js      -> Browser TTL respect origin. Cloudflare currently
 *                    overrides the origin's `max-age=0, must-revalidate` with
 *                    its own `max-age=14400`, which lets browsers sit on a
 *                    stale service worker for 4 hours.
 *
 * Idempotent: re-running updates the existing rules by description instead of
 * stacking duplicates. Read-only with --dry-run.
 *
 * Usage:
 *   node scripts/cloudflare-cache-rules.mjs --dry-run
 *   node scripts/cloudflare-cache-rules.mjs
 *
 * Requires a token in artifacts/api-server/.env (CLOUDFLARE_API_TOKEN) with
 * Zone.Cache Rules:Edit and Zone:Read.
 */

import fs from 'fs';
import path from 'path';
import process from 'process';

const ROOT = process.cwd();
const ZONE_NAME = 'chuglii.in';
const API = 'https://api.cloudflare.com/client/v4';
const PHASE = 'http_request_cache_settings';

const DRY_RUN = process.argv.includes('--dry-run');

const RULE_MEDIA = {
  description: 'cache /api/media at the edge (respect origin TTL)',
  // URI *path*, not URI Full. The dashboard's expression builder defaults to
  // `(http.request.uri.full_uri wildcard r"...")`, which can never match a real
  // request like https://chuglii.in/api/media?url=... — the path form is exact.
  expression: '(http.request.uri.path eq "/api/media")',
  action: 'set_cache_settings',
  action_parameters: {
    // NB: the field is `cache`, NOT `eligible_for_cache` — the Rulesets API
    // rejects the latter with "unknown field". `cache: true` is the API shape
    // behind the dashboard's "Eligible for cache" option. `cache_key_settings`
    // is likewise rejected here; the full URI (query string included) is the
    // default cache key, which is what we want — `?url=` and `&w=` must vary.
    cache: true,
    edge_ttl: { mode: 'respect_origin' },
    browser_ttl: { mode: 'respect_origin' },
  },
};

const RULE_SW = {
  description: 'sw.js browser TTL must respect origin (no stale SW for 4h)',
  expression: '(http.request.uri.path eq "/sw.js")',
  action: 'set_cache_settings',
  action_parameters: {
    browser_ttl: { mode: 'respect_origin' },
  },
};

function readToken() {
  const file = path.join(ROOT, 'artifacts', 'api-server', '.env');
  if (!fs.existsSync(file)) throw new Error(`missing ${file}`);
  const line = fs
    .readFileSync(file, 'utf8')
    .split('\n')
    .find((l) => /^CLOUDFLARE_API_TOKEN=/.test(l.trim()));
  if (!line) throw new Error('CLOUDFLARE_API_TOKEN not found in artifacts/api-server/.env');
  const raw = line.slice(line.indexOf('=') + 1).trim();
  if (!raw || raw.length < 20) throw new Error('CLOUDFLARE_API_TOKEN looks empty/too short');
  return raw;
}

let token = null;
async function cf(pathname, init = {}) {
  const res = await fetch(`${API}${pathname}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    },
  });
  const text = await res.text();
  let body;
  try { body = JSON.parse(text); } catch { body = { raw: text.slice(0, 200) }; }
  if (!res.ok || body.success === false) {
    const msg = (body.errors || []).map((e) => `${e.code}: ${e.message}`).join('; ') || `HTTP ${res.status}`;
    const err = new Error(msg);
    err.status = res.status;
    throw err;
  }
  return body.result;
}

async function main() {
  const log = (...a) => console.log(...a);
  log(`mode: ${DRY_RUN ? 'DRY RUN (no writes)' : 'LIVE'}`);
  log(`zone:  ${ZONE_NAME}\n`);

  if (DRY_RUN) {
    log('would call:');
    log(`  GET  /zones?name=${ZONE_NAME}                       -> resolve zone id`);
    log(`  GET  /zones/{id}/rulesets?phase=${PHASE}            -> find entry ruleset`);
    for (const r of [RULE_MEDIA, RULE_SW]) {
      log(`  POST /zones/{id}/rulesets/{rulesetId}/rules`);
      log(`       description: ${r.description}`);
      log(`       expression : ${r.expression}`);
      log(`       action     : ${r.action}`);
      log(`       params     : ${JSON.stringify(r.action_parameters)}`);
    }
    log('\nno token needed for --dry-run. drop a valid token in to go live.');
    return;
  }

  token = readToken();
  log('token loaded from artifacts/api-server/.env (not printed)\n');

  const zones = await cf(`/zones?name=${ZONE_NAME}`);
  if (!zones?.length) throw new Error(`zone ${ZONE_NAME} not visible to this token (wrong scope or account?)`);
  const zone = zones[0];
  const zid = zone.id;
  log(`zone id : ${zid}`);
  log(`plan    : ${zone.plan?.name ?? 'unknown'}`);
  log(`status  : ${zone.status}\n`);

  const rulesets = await cf(`/zones/${zid}/rulesets?phase=${PHASE}`);
  let entry = rulesets.find((r) => r.phase === PHASE && (r.kind === 'entry' || r.kind === 'zone'));
  if (!entry) {
    log(`no existing ${PHASE} entry ruleset found`);
    log(`(Cache Rules need a Pro plan or above; on Free this will 403)`);
    log(`creating one`);
    entry = await cf(`/zones/${zid}/rulesets`, {
      method: 'POST',
      body: JSON.stringify({
        name: 'default',
        kind: 'zone',
        phase: PHASE,
        rules: [],
      }),
    });
  }
  // The ?phase= list does NOT expand `rules` (it comes back null), so fetch the
  // ruleset detail before deciding create-vs-update — otherwise every run would
  // try to POST a duplicate.
  const detail = await cf(`/zones/${zid}/rulesets/${entry.id}`);
  const existingRules = detail?.rules ?? [];
  log(`ruleset : ${entry.id} (${entry.name}, ${existingRules.length} existing rules)\n`);

  let changed = 0;
  for (const rule of [RULE_MEDIA, RULE_SW]) {
    const existing = existingRules.find((r) => r.description === rule.description);
    if (existing) {
      log(`updating: ${rule.description}`);
      await cf(`/zones/${zid}/rulesets/${entry.id}/rules/${existing.id}`, {
        method: 'PATCH',
        body: JSON.stringify(rule),
      });
    } else {
      log(`creating : ${rule.description}`);
      const res = await cf(`/zones/${zid}/rulesets/${entry.id}/rules`, {
        method: 'POST',
        body: JSON.stringify(rule),
      });
      log(`           -> rule id ${res?.result?.id ?? res?.id ?? 'created'}`);
    }
    changed++;
  }

  log(`\ndone: ${changed} rule(s) applied to ${ZONE_NAME}`);

  const verify = await fetch(`${ZONE_NAME.replace(/^https?:\/\//, 'https://')}/api/media?probe=1`, {
    method: 'GET',
  }).catch(() => null);
  if (verify) {
    log(`post-check /api/media: HTTP ${verify.status}, cf-cache-status=${verify.headers.get('cf-cache-status')}`);
    log('(a brand-new uncached URL will still be DYNAMIC on first hit; check again after it warms)');
  }
}

main().catch((e) => {
  console.error(`\nFAILED: ${e.message}`);
  if (/1000|Invalid API Token|9109/i.test(e.message)) {
    console.error('-> token is invalid/expired. Create a new one:');
    console.error('   Cloudflare dashboard > profile > API Tokens > Create Token');
    console.error('   Permissions: Zone / Cache Rules / Edit  +  Zone / Zone / Read');
    console.error('   Zone Resources: Include > chuglii.in');
    console.error("   then set CLOUDFLARE_API_TOKEN in artifacts/api-server/.env");
  }
  if (/403|plan|enterprise/i.test(e.message)) {
    console.error('-> likely a plan limitation: Cache Rules require Pro+.');
  }
  process.exit(1);
});
