---
title: Historical data inventory (pre-migration)
date: 2026-07-09
type: entity
sources: [raw/2026-07-09-data-archaeology-capture.md]
---

# Historical data inventory (pre-migration)

Cross-host inventory of every chronomaxi `Log` data source found before the central
Convex migration, and what each one means for the migration plan. See
[raw/2026-07-09-data-archaeology-capture.md](../raw/2026-07-09-data-archaeology-capture.md)
for the verbatim scan output this page synthesizes. See
[architecture.md](architecture.md) for the current pipeline that produces this data
(tracker -> sqlite -> prisma -> frontend) and
[2026-07-09-ui-overhaul.md](2026-07-09-ui-overhaul.md) for the dashboard that reads
the same `frontend/prisma/db.sqlite` file this page inventories.

## Sources

| Source | Path | Rows | Date range | Summed hours | Status |
|---|---|---:|---|---:|---|
| big-bertha, `andrew-MS-7B86` | `big-bertha:/home/andrew/personal/chronomaxi/frontend/prisma/db.sqlite` | 19,750,019 | 2024-07-12T21:50:59Z - 2026-03-22T04:35:42Z | 514.53 | authoritative; earlier hostname segment of the same archive file, see continuity note below |
| big-bertha, `big-bertha` | same file | 64,275,635 | 2026-03-22T04:35:42Z - 2026-07-10T04:59:33Z | 1,654.94 | authoritative; later hostname segment of the same archive file |
| **big-bertha combined** | same file, 23,189,491,712 bytes (~23.2GB) | **84,025,654** | 2024-07-12 - 2026-07-10 | **2,169.47** | primary migration source, one physical machine across a hostname rename |
| big-ron, `D2` demo seed | `big-ron:/home/andrew/personal/chronomaxi/frontend/prisma/db.sqlite` | 8,241 | 2026-07-03 - 2026-07-09 | 68.68 | synthetic seed data; migrate per explicit user direction ("migrate ALL rows including demo seed") |
| big-ron, `big-ron` live | same file | 808 | 2026-07-10T02:13:21Z - 2026-07-10T05:00:06Z | 2.59 | live tracker rows, still accruing at scan time |
| **big-ron combined** | same file | **9,049** | 2026-07-03 - 2026-07-10 | **71.27** | secondary migration source |
| big-ron root db (unused) | `big-ron:/home/andrew/personal/chronomaxi/frontend/db.sqlite` | 0 | n/a | 0 | 0 bytes, no `Log` table; decoy path, not a data source |
| lil-timmy | `lil-timmy:/Users/andrewpynch/personal/chronomaxi/frontend/db.sqlite` | 0 | n/a | 0 | 0 bytes, no `Log` table; no `prisma/db.sqlite` in current clone at all; no active tracker launchd agent |
| Railway Postgres (legacy) | `roundhouse.proxy.rlwy.net:48066/railway`, credential in `lil-timmy:/Users/andrewpynch/personal/time-tracker/backend/.env` | unknown | unknown, likely overlaps the big-bertha range | unknown | **inaccessible/stale, not lost** — see below |
| **Grand total (bertha + big-ron)** | | **84,034,703** | 2024-07-12 - 2026-07-10 | **2,240.74** | full row/hour count the migration must land in Convex |

## Device hostname continuity (big-bertha)

`andrew-MS-7B86` and `big-bertha` are **the same physical machine**, not two
different sources. The scan shows a hostname rename on 2026-03-22, not a device
swap: the last `andrew-MS-7B86` row is `2026-03-22T04:35:42.228680103+00:00` and the
first `big-bertha` row is `2026-03-22T04:35:42.329112427+00:00`, roughly 100ms apart,
i.e. the same tracker process boundary, not a gap in coverage. Any migration schema
that keys history by device identity must either merge these two `deviceName` values
into one logical device, or carry both as aliases of one entity, so the two-year
archive reads as continuous rather than as two unrelated machines.

Row density is extreme (84M rows over ~2 years, mostly in the `andrew-MS-7B86`
segment) because the old tracker flushed a database row per short tick rather than
per aggregated span; see the span-aggregation rewrite in
[architecture.md](architecture.md#1-capture-rust-tracker) for the current tracker
behavior, which produces far fewer, longer rows. This means the row count is not a
reliable proxy for wall-clock activity across the two eras: 19.75M rows only cover
514.53h in the old era vs 64.28M rows covering 1654.94h in the new era, an order of
magnitude difference in rows-per-hour.

## Railway: inaccessible/stale, not lost

`lil-timmy:/Users/andrewpynch/personal/time-tracker/backend/.env` still holds a
connection string for a legacy Railway Postgres instance
(`roundhouse.proxy.rlwy.net:48066/railway`) that likely powered old public stats.
As of this scan:

- The stored credential fails password authentication against that host.
- The Railway CLI is still authenticated on big-ron, and the account's related
  projects (`previous-pen`, `backup of old data`) currently show no services or
  volumes in the active project inventory.

This is a **stale/inaccessible** source, not a confirmed-lost one: the account and
credential reference still exist, they simply do not resolve to a reachable database
through the tooling available at scan time (no working password, no live service in
the project list). Do not block the central Convex cutover on recovering it; if it
later becomes reachable, treat any recovered rows as a possible overlap with the
big-bertha archive (same underlying tracker lineage) and dedupe accordingly rather
than assuming they are additive.

## False leads (recorded so they are not re-discovered)

- `big-ron:/home/andrew/personal/chronomaxi/frontend/db.sqlite` — 0 bytes, no `Log`
  table. The real big-ron data lives at `frontend/prisma/db.sqlite`, not this path.
- `lil-timmy:/Users/andrewpynch/personal/chronomaxi/frontend/db.sqlite` — 0 bytes, no
  `Log` table, and there is no `prisma/db.sqlite` anywhere in the current lil-timmy
  clone. lil-timmy currently has no local chronomaxi data and no active tracker
  agent.
- The Postgres process visible on big-ron is `philosophy-bot-db`
  (`postgres:16-alpine`, host port 57342), an unrelated Docker container. It is not a
  chronomaxi data source.

## Migration implications

- **Volume**: the full migration set is 84,034,703 rows / 2,240.74 summed hours
  (84,025,654 from big-bertha + 9,049 from big-ron), all of which must land in the
  central Convex deployment per explicit user direction, including the 8,241-row
  `D2` demo seed on big-ron. Nothing in this inventory is optional to migrate.
- **Streaming/batched import required**: the big-bertha source file is a single
  23.2GB SQLite file. It cannot be read into memory as one array or POSTed as one
  HTTP payload; any importer must page through it (e.g. keyset pagination on SQLite
  `rowid`, not `OFFSET`, to stay fast at this scale) and write to Convex in bounded
  batches sized under Convex's per-mutation argument/document limits.
- **Dedup key must be composite, not a bare id**: the big-bertha and big-ron
  databases are separate SQLite files with independently autoincrementing `Log.id`
  primary keys, so raw ids collide across sources (both likely have an id `1`). A
  safe stable key is `(source_host_or_dataset, original_id)` — e.g.
  `("big-bertha", 4210331)` vs `("big-ron", 4210331)` — not `original_id` alone.
  Apply the same composite-key discipline if Railway data is ever recovered and
  merged in later.
- **Device identity normalization**: import-time logic must treat
  `andrew-MS-7B86` and `big-bertha` as one logical device (see continuity note
  above), not two, or per-device rollups in the new dashboard will show a false
  split at 2026-03-22.
- **Row-density mismatch across eras**: the pre-rewrite tracker's one-row-per-tick
  behavior means the first ~19.75M rows carry far less wall-clock signal per row
  than the post-rewrite ~64.28M rows. Import performance planning (batch counts,
  expected wall-clock time) should budget for a 23GB source dominated by low-value
  tick rows, not assume uniform row value.
- **Railway is non-blocking**: treat it as a possible future supplemental/overlap
  source, never a cutover dependency.
