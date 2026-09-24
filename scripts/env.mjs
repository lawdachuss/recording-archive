/**
 * Dependency-free .env loader for repo scripts.
 *
 * Credentials must NEVER be written into source: this repo is public on
 * GitHub, and a hardcoded Supabase service-role key (plus a GitHub PAT and
 * database passwords) had already been published in its history before this
 * module existed. Everything here reads from env only.
 *
 * Resolution order (first wins):
 *   1. real process environment  — what Vercel / `source .env` provides
 *   2. <repo root>/.env
 *   3. <repo root>/artifacts/api-server/.env
 *
 * Never prints secret values.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ENV_FILES = [".env", "artifacts/api-server/.env"];

/** Parsed environment: process env first, then the repo's gitignored .env files. */
export function loadEnv() {
  const env = { ...process.env };
  for (const rel of ENV_FILES) {
    let text;
    try {
      text = readFileSync(path.join(ROOT, rel), "utf8");
    } catch {
      continue;
    }
    for (const line of text.split(/\r?\n/)) {
      const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
      if (m && !env[m[1]]) env[m[1]] = m[2].replace(/^"(.*)"$/, "$1").replace(/^'(.*)'$/, "$1");
    }
  }
  return env;
}

/**
 * First non-empty value among `names`, or exit with a clear message.
 * Pass names in preference order — e.g. service-role before anon.
 */
export function requireKey(...names) {
  const env = loadEnv();
  for (const name of names) {
    const value = (env[name] ?? "").trim();
    if (value) return value;
  }
  console.error(
    `Missing credential: set one of ${names.join(", ")} in .env ` +
      `(never hardcode credentials — this repository is public).`,
  );
  process.exit(1);
}
