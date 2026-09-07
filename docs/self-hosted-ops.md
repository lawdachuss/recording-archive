# Self-Hosted Supabase — Operations Runbook (Stage 0)

Companion to `docs/scaling-plan.md`. These are the infrastructure items from
Stage 0 that can't be done from this repo — they happen on the box running
Supabase. Everything here assumes the standard Supabase docker-compose layout.

---

## 1. Backups that actually work (do this first)

**Untested backups don't exist.** The single highest-value ops task.

### pgBackRest setup (recommended over pg_dump for PITR)

```bash
# On the Postgres host — install
apt install pgbackrest   # or build from source

# /etc/pgbackrest/pgbackrest.conf
[global]
repo1-path=/var/backups/pgbackrest
repo1-retention-full=2          # keep 2 full backups
repo1-cipher-type=aes-256-cbc   # encrypt at rest
repo1-cipher-pass=<generate-one>
process-max=4
log-level-console=info

[db]
pg1-path=/var/lib/postgresql/data
```

Enable WAL archiving in `postgresql.conf` (required for point-in-time recovery):

```
archive_mode = on
archive_command = 'pgbackrest --stanza=db archive-push %p'
wal_level = replica
```

```bash
# Create the stanza and take the first full backup
sudo -u postgres pgbackrest --stanza=db stanza-create
sudo -u postgres pgbackrest --stanza=db backup --type=full

# Cron: full backup Sundays, incremental nightly
0 3 * * 0  pgbackrest --stanza=db backup --type=full
0 3 * * 1-6 pgbackrest --stanza=db backup --type=incr
```

**Ship backups OFF-BOX** (S3-compatible: Backblaze B2, Cloudflare R2, or any
S3). A backup on the same disk as the database is not a backup.

### The restore drill (repeat quarterly, calendar it)

```bash
# 1. Spin up a throwaway Postgres with the same major version
# 2. Restore:
pgbackrest --stanza=db --delta --type=time "--target=2026-09-07 12:00:00" restore
# 3. Start Postgres, verify: row counts, auth login works, API returns 200s
# 4. Document how long it took — that's your real RTO
```

---

## 2. Connection pooling (Supavisor / PgBouncer)

Every PostgREST instance, GoTrue instance and script must connect through the
pooler, never directly to Postgres. Transaction mode:

- Pooler port: `6543` (transaction) — use for API traffic
- Direct port: `5432` — only for migrations/admin

Key settings (Supavisor `docker/volumes/supavisor/` or pgbouncer.ini):

```
default_pool_size = 20          # per user/database pair
max_client_conn = 200           # headroom for function instances
server_reset_query = DISCARD ALL
```

Verify from the API server side: `select count(*) from pg_stat_activity;`
should stay near `pool_size`, not climb with traffic. If it climbs, something
is bypassing the pooler.

---

## 3. Monitoring (the three exporters minimum)

```
postgres_exporter  → Postgres: CPU, connections, cache hit ratio, seq scans, replication (later)
redis_exporter     → Redis: memory, hit ratio, evictions, connected clients
node_exporter      → the box: disk I/O latency, disk space, RAM, load
```

Scrape with Prometheus (or any compatible stack), dashboards in Grafana.
Alert at minimum on:

| Alert | Threshold | Why |
|---|---|---|
| Disk free | < 20% | Full disk = Postgres pauses/writes fail |
| DB connections | > 80% of max | Pooler bypass or leak |
| Cache hit ratio (PG) | < 95% | Hot set no longer fits in RAM → vertical scale |
| Redis evicted keys | > 0/min | Cache too small or TTLs too short |
| 5xx rate (API) | > 0.1% | Something upstream is failing |
| p95 API latency | > 400ms | SLO breach (scaling plan §2) |

Enable in `postgresql.conf`: `shared_preload_libraries = 'pg_stat_statements'`
and `pg_stat_statements.track = all` — this is how you find the queries that
need indexes/RPCs.

---

## 4. Postgres tuning baseline (single box, catalog workload)

Start here, measure, adjust — don't cargo-cult bigger numbers:

```
shared_buffers = 25% of RAM          # e.g. 8GB on a 32GB box
effective_cache_size = 60% of RAM    # planner hint for OS cache
work_mem = 32MB                      # per sort/hash — watch for many parallel sorts
maintenance_work_mem = 1GB           # vacuum/index builds
max_connections = 200                # pooler handles the rest
random_page_cost = 1.1               # SSD/NVMe storage
effective_io_concurrency = 200       # SSD/NVMe
autovacuum_vacuum_scale_factor = 0.05 # busier autovacuum on write-heavy tables
checkpoint_completion_target = 0.9
wal_compression = on
```

---

## 5. Patch cadence

- Pin Supabase component versions in docker-compose; don't float.
- Subscribe to Supabase security advisories (GitHub releases).
- Monthly window: `git pull` the supabase repo, review changelog, upgrade,
  run the restore drill checklist on a branch copy first.
- Realtime/GoTrue/Kong restart cleanly; Postgres upgrades need the
  pg_upgrade path — schedule those separately.

---

## 6. Stage 0 completion checklist

- [ ] pgBackRest full backup + WAL archiving running, shipped off-box
- [ ] Restore drill performed once, RTO documented
- [ ] Pooler verified: API connections bounded under load
- [ ] postgres_exporter + redis_exporter + node_exporter scraped, dashboards up
- [ ] Alerts wired for the table above
- [ ] pg_stat_statements enabled; top-10 queries reviewed
- [ ] postgresql.conf tuned from §4 baseline
- [ ] Media objects moved off the DB box (or confirmed already external)
- [ ] Patch window scheduled (monthly)
