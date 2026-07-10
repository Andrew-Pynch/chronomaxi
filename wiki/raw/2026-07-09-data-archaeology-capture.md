---
title: Chronomaxi historical data archaeology
date: 2026-07-09
type: raw
source: SQLite Log-table scans of big-bertha frontend/prisma/db.sqlite (23.2GB) and big-ron frontend/prisma/db.sqlite, filesystem/.env inspection on lil-timmy, Railway CLI project inventory
---

# Chronomaxi historical data archaeology, 2026-07-09

Verbatim capture of the cross-host data inventory backing
[pages/historical-data.md](../pages/historical-data.md). Produced by parallel
archaeology workstreams (`RonArchaeology`, `TimmyArchaeology`, `MigrationDesign`)
scoping the central chronomaxi migration.

## big-bertha authoritative SQLite archive

Path: `/home/andrew/personal/chronomaxi/frontend/prisma/db.sqlite`
File size observed: 23,189,491,712 bytes (~23.2 GB). SQLite `Log` table. Grouped
read-only scan results:

| deviceName | rows | first createdAt | latest createdAt | summed duration hours |
|---|---:|---|---|---:|
| `andrew-MS-7B86` | 19,750,019 | 2024-07-12T21:50:59.052183794+00:00 | 2026-03-22T04:35:42.228680103+00:00 | 514.53 |
| `big-bertha` | 64,275,635 | 2026-03-22T04:35:42.329112427+00:00 | 2026-07-10T04:59:33.125180548+00:00 | 1654.94 |
| combined | 84,025,654 | 2024-07-12 | 2026-07-10 | 2169.47 |

Interpretation: hostname changed on 2026-03-22 but continuity is exact to the
millisecond, so both device names are the same machine/archive. Row density is
extreme because the old tracker wrote small tick rows. The durable archive covers
almost exactly two years.

## big-ron current SQLite

Path: `/home/andrew/personal/chronomaxi/frontend/prisma/db.sqlite`
At scan time: 9,049 rows, 71.27 summed hours.

- `D2`: 8,241 synthetic demo rows from 2026-07-03 to 2026-07-09, 68.68h.
- `big-ron`: 808 real rows from 2026-07-10T02:13:21Z to 2026-07-10T05:00:06Z, 2.59h.

Root `frontend/db.sqlite` is 0 bytes and contains no `Log` table.

## lil-timmy

`/Users/andrewpynch/personal/chronomaxi/frontend/db.sqlite` is 0 bytes, no `Log`
table. No `prisma/db.sqlite` found in current clone.
`/Users/andrewpynch/personal/time-tracker/backend/.env` points to a legacy Railway
Postgres (`roundhouse.proxy.rlwy.net:48066/railway`) that likely powered old public
stats. The credential now fails password authentication. Railway CLI is still logged
in on big-ron; related account projects `previous-pen` and `backup of old data` now
have no services or volumes, so that hosted source is not currently recoverable
through the active project inventory. No active tracker launchd agent found on
lil-timmy.

## local Postgres false lead

The Postgres process on big-ron is not chronomaxi. Docker shows `philosophy-bot-db`
(postgres:16-alpine) mapped to host port 57342. Other local DB process observations
were unrelated.

## Migration implication

Migrate the full big-bertha 84M-row archive plus the big-ron DB including seed, per
user direction. Railway history may overlap with bertha and is inaccessible; do not
block central cutover on it. Any importer must deduplicate by stable source Log id
and be streaming/batched because the bertha file is 23GB.
