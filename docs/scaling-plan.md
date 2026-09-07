# Scaling Plan — video-archive (Vercel + self-hosted Supabase)

A staged plan to grow from today's architecture to global scale without rewrite cliffs.
Revised for the real deployment topology: **Vercel hosts the SPA + API function; Supabase
is self-hosted on your own infrastructure** (the browser also talks to it directly for
auth and realtime notifications). Every stage is independently deployable.

---

## 0. Honest framing

"Billions of users" is Meta/YouTube territory: ~10–100M concurrent users, millions of
requests/second, petabytes of media. Nobody builds that on day one — you build an
architecture where every stage is an **evolution**. This plan is organized that way.

| Registered users | Realistic concurrent peak | Approx. API RPS (catalog reads) |
|---|---|---|
| 10K | ~100 | ~100 |
| 1M | ~10K | ~10–30K |
| 100M | ~1M | ~1–3M |
| 1B+ | ~10M+ | ~10M+ |

Reads dominate video catalogs ~100:1 over writes. The strategy at every stage is the
same: **serve reads from as close to the user as possible, make writes async, and
isolate components so one hot path can't starve another.**

With self-hosted Supabase there is one extra law: **the Postgres box is the ceiling.**
Every stage below is, in large part, about keeping load off that box or replicating it.

---

## 1. Where we are today (verified from the repo)

```
Browser (SPA + service worker: image cache, API network-first + offline fallback)
  │                          │
  │ Vercel CDN (static)      │ DIRECT — auth (GoTrue) + realtime notifications
  ▼                          ▼ (websocket to self-hosted Supabase)
Vercel serverless function (single Express monolith: /api/(.*) → /api/index)
  ├── 3-layer cache: memory → Redis (ioredis) → CDN headers
  │     (s-maxage + stale-while-revalidate + stale-if-error, tag invalidation, dedupe)
  ├── Self-hosted Supabase over HTTP (PostgREST via Kong):
  │     Kong → PostgREST → Postgres   (all on one box, plus GoTrue, Realtime, Storage)
  ├── media-proxy: sharp resizing on the same function, immutable 7-day edge cache
  └── fetchAll() full-table pagination (tags, stats, reactions, comments, admin)
```

**Strengths to keep (they carry to every stage):**
- Edge-first read caching with tag invalidation — right shape at any scale.
- Service worker stale/offline fallbacks — the kernel of graceful degradation.
- Stateless API over HTTP DB access — horizontally scalable by definition.
- Media bytes mostly bypass your box (catbox/pixhost + wsrv.nl + edge-cached proxy).

**Gaps that break first (all fixable in Stage 0):**
1. No rate limiting anywhere; cache keys include raw query params (cache-busting attacks).
2. `fetchAll()` full-table scans on every cache miss (tags/stats/reactions/comments/admin).
3. Media proxy shares one function with all JSON routes; sharp is CPU/memory heavy.
4. `ioredis` holds a persistent TCP socket per serverless instance.
5. Self-hosted specifics: single Postgres box (SPOF), Kong as the single API gateway,
   realtime websockets landing on the same box, backups unproven, no replicas.
6. No observability/load-testing story; SLOs undefined.

---

## 2. Target SLOs (define before scaling)

| Metric | Target |
|---|---|
| Catalog read latency (p95, edge-cached) | < 100 ms |
| Origin p95 (cache miss) | < 400 ms |
| Availability (monthly) | 99.95% (≤ 21 min downtime) |
| Error rate (5xx) | < 0.1% |
| Thumbnail first-paint (p75, real users) | < 1.5 s |
| Postgres CPU (sustained) | < 60% |

---

## 3. Stage 0 — Hardening (now → ~10K concurrent, ~1M users)

*Current Vercel + self-hosted Supabase + Redis setup is fine at this tier. Fix the gaps;
change nothing architectural. Effort: 2–4 weeks (the self-hosted items add time).*

### 3a. Application hardening
1. **Rate limiting (highest priority).** Edge WAF (Cloudflare in front of Vercel): bot
   rules, per-IP burst limits. App-level token bucket in Redis: per-IP (anon) and
   per-user (authenticated), stricter on writes and search.
   **Harden cache keys**: normalize/sort query params, whitelist known params, drop
   tracking junk so random query strings can't bypass the cache.
2. **Push aggregation into Postgres.** Replace `fetchAll()` endpoints with RPCs/views/
   `count()` aggregates (`get_tag_counts()`, `get_site_stats()`, reaction counters).
   A cache miss must cost one cheap query, not N table scans.
3. **Split the media proxy** into its own serverless function (own concurrency pool) with
   a memory bump; expand wsrv.nl offload for more hosts.
4. **HTTP-based Redis client** (e.g., Upstash REST) instead of ioredis sockets.
5. **Observability** — OpenTelemetry on the API, RUM web-vitals from the SPA, and (see
   below) Postgres/Redis exporters. One dashboard: RPS, p95, cache hit ratio, DB CPU,
   function errors.
6. **Load test** the top 10 endpoints (k6); record the real numbers as your baseline.
7. **Async activity writes.** View/history events never block a request: buffer in the
   client (service worker Background Sync / `sendBeacon`), accept fire-and-forget, enqueue
   to Redis Streams, batch-flush to Postgres.

### 3b. Self-hosted Supabase hardening (do these in parallel)
8. **Prove your backups.** `pgBackRest` or WAL-G: base backup + WAL archiving to off-box
   storage (S3-compatible). **Do a test restore.** An untested backup doesn't exist.
9. **Connection pooling** — ensure Supavisor/pgbouncer (transaction mode) sits in front of
   Postgres; PostgREST, GoTrue and your scripts must not each hold open pg connections.
10. **Postgres tuning + monitoring**: `pg_stat_statements` on, sensible
    `shared_buffers`/`work_mem`/`max_connections`, `postgres_exporter` → Prometheus/Grafana,
    alert on CPU, replication lag (later), connection saturation, disk I/O.
11. **Off-box disk for Storage** — move media objects to S3-compatible storage
    (MinIO on a second box now, or cloud R2/B2) so DB box disk I/O is never the media path.
12. **Patch cadence** — self-hosted means you own CVEs. Pin versions, subscribe to Supabase
    security advisories, monthly patch window.

---

## 4. Stage 1 — Vertical scale + replication (→ ~100K concurrent, ~10M users)

*The Postgres box gets friends. This is where self-hosting diverges most from managed.*

1. **Vertical first (cheapest win):** bigger Postgres box — NVMe, more RAM (hot set in
   memory), more cores. Postgres loves a single big machine; this buys enormous headroom.
2. **Streaming read replicas (2+).** Async replication; route all catalog reads to
   replicas, writes to primary. Handle replication lag in the app (read-your-writes for
   user-owned data via session pinning or stickiness to primary).
3. **Split Supabase components onto separate machines** — they no longer share one box:
   - Postgres (primary + replicas) on dedicated hardware
   - Kong/PostgREST ×N behind a load balancer (stateless — scale horizontally)
   - GoTrue ×N (stateless)
   - **Realtime (Elixir) on its own node(s)** — notification websockets are long-lived
     connections; at scale they need dedicated RAM and a LB with websocket support.
     Consider whether notifications need realtime at all at this tier — polling a cached
     `/notifications` endpoint every 30–60s via the existing CDN cache is dramatically
     cheaper and often good enough; keep realtime for presence-style features only.
   - Storage proxy → object storage (now a cluster: MinIO distributed or cloud)
4. **API out of serverless for the hot path** — move the Express API (or its extracted
   services) to always-warm containers (Fly.io/Railway/ECS). Vercel keeps the SPA + CDN.
   Rationale: cold starts, CPU limits on sharp, and predictable cost at sustained load.
5. **Redis HA** — Sentinel or managed cluster; Redis is now on the critical path of every
   read, it must not be a single small box.
6. **Real queue** (SQS/Cloud Tasks/Kafka/NATS): view counters, notification fanout,
   media re-encode, email. The API never does background work inline.
7. **Event pipeline for browsing activity** ("all their activities"):
   `client batch → ingest service → queue → ClickHouse`.
   History/analytics/recommendations read ClickHouse projections, never the operational
   DB. Raw events expire; aggregates live forever.
8. **Pre-generate media variants** (320/640/1200px, webp/avif) on ingest into object
   storage; the transform-on-miss proxy becomes fallback, not primary.
9. **Origin shield** so a global miss storm collapses to one upstream request.
10. **HA for Postgres when ready**: Patroni + etcd automated failover (or accept manual
    failover with a tested runbook — a legitimate cost/simplicity tradeoff early on).
11. **Deploys:** canary + instant rollback; contract tests between services.

---

## 5. Stage 2 — Global scale (→ ~1M concurrent, ~100M users)

1. **CQRS everywhere it matters:** Postgres stays the source of truth for writes; reads
   come from projections — search index (Typesense/Meilisearch/OpenSearch fed by CDC/outbox),
   Redis counters, ClickHouse analytics, denormalized catalog cache.
2. **Shard the write path** only when a single Postgres primary (now HA) is the proven
   bottleneck: hash-shard by `recording_id`/`user_id` (Citus or app-level routing).
   After projections remove read load, this arrives later than you think.
3. **Multi-region:** regional read replicas (Postgres cascading replication), regional
   caches and API containers; users hit the nearest region; writes go to the primary
   region. Self-hosted multi-region is a real ops commitment — budget for it.
4. **Multi-CDN** (2+ providers) with per-region steering; origin shield per CDN.
5. **Cell-based isolation:** partition users/requests into independent cells (compute +
   cache + replica set); a bad cell fails over without global impact.
6. **Resilience mechanics (features, not luxuries):**
   - Load shedding + backpressure — reject cheaply instead of dying slowly.
   - Circuit breakers + bulkheads between services.
   - Serve-stale mode: every layer may serve stale when origin is unhealthy.
   - Static survival mode: extend the existing service worker offline fallback to a full
     read-only mode fed by last-known-good API snapshots.
7. **Chaos drills quarterly:** kill a region, a cache cluster, a DB replica; verify
   user-visible degradation is graceful.
8. **Egress economics:** at this tier bandwidth cost dominates. Media already rides third
   parties + CDN; keep it that way, and consider Cloudflare R2 (zero egress) for anything
   you host yourself.

---

## 6. Stage 3 — Billions (the honesty section)

At ~1B users you operate Meta-class infrastructure: cell-based architecture, custom
sharded storage, per-service teams, 24/7 SRE, multi-petabyte media fabric. No hosting
plan — Vercel or self-hosted — "supports" this out of the box; it is an org-wide program.
What matters is that **nothing in Stages 0–2 throws away work**: edge-first caching,
stateless services, the async event backbone, replicas→shards progression, and the
activity pipeline all carry directly into that world. The rewrite risk is what this plan
manages.

One strategic note: at some tier (roughly Stage 1→2), re-evaluate self-hosted vs managed
Supabase/Postgres. Self-hosting wins on cost/control up to a point; past it, the
operational burden (multi-region replication, failover, patching at 3am) is often worth
paying a managed premium for. That's a business decision, not a technical failure.

---

## 7. Failure modes → mitigations (runbook table)

| Failure | Symptom | Mitigation |
|---|---|---|
| Cache-miss stampede | DB CPU spikes after deploy/eviction | Request coalescing (have it), origin shield, SWR everywhere, warm cache on deploy |
| Hot key (viral recording) | One key saturates a shard/replica | Local in-memory L1 cache, key replication, edge pinning |
| Cache-busting abuse | Origin load with random params | Cache-key normalization, WAF, rate limits |
| Media transform storm | CPU throttling, latency on all routes | Media in own function/service, pre-generated variants, queue overflow to smaller sizes |
| Postgres box saturation | CPU/disk I/O pegged, query timeouts | Vertical scale, replicas for reads, RPC aggregates, async writes, pooling |
| Primary Postgres down | Total write outage (SPOF today) | Patroni failover or tested manual runbook; replicas promoted; serve-stale reads meanwhile |
| Kong/gateway down | All Supabase HTTP fails | Multiple PostgREST instances behind LB; direct health checks; consider dropping Kong for a lighter LB |
| Realtime websocket flood | Memory exhaustion on Supabase box | Realtime on dedicated nodes; polling fallback; connection caps per user |
| Redis outage | Origin overload (not data loss) | In-memory L1 + CDN SWR absorb; circuit breaker skips Redis |
| Replication lag | Stale reads on replicas | Session pinning for read-your-writes; lag-aware routing |
| Region outage | Errors from one geography | Geo failover, multi-CDN, serve-stale, static mode |
| Disk full on DB box | Postgres pauses/crashes | Off-box WAL archiving, disk alerts at 70%, object storage off-box |

---

## 8. Ordered backlog (what to actually do, in sequence)

1. Rate limiting (edge + Redis) + cache-key normalization — *Stage 0*
2. Postgres aggregate RPCs replacing `fetchAll` — *Stage 0*
3. Media proxy split + memory bump — *Stage 0*
4. HTTP-based Redis client — *Stage 0*
5. Backups (pgBackRest/WAL-G) + **tested restore** — *Stage 0*
6. Supavisor/pgbouncer pooling + Postgres monitoring — *Stage 0*
7. Storage objects off-box (S3-compatible) — *Stage 0*
8. Observability + load-test baseline — *Stage 0*
9. Async activity ingestion (beacon → Redis Streams → batched Postgres) — *Stage 0/1*
10. Vertical Postgres upgrade, then streaming read replicas — *Stage 1*
11. Split Supabase components across machines (Realtime first) — *Stage 1*
12. API hot path to always-warm containers; Redis HA — *Stage 1*
13. Service extraction: media, search, social-writes + real queue — *Stage 1*
14. Event pipeline (queue + ClickHouse) — *Stage 1*
15. Pre-generated media variants + origin shield — *Stage 1*
16. Patroni HA, search engine, multi-region reads — *Stage 1/2*
17. CQRS projections, multi-CDN, cells, sharding if ever needed — *Stage 2*

Each item is independently shippable and independently valuable — the site gets faster
and tougher at every step, even if traffic never goes past Stage 1.
