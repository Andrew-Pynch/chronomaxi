---
title: Index
type: index
---

# chronomaxi wiki: index

Content-oriented catalog. Read this first, then drill into the pages you need. See
SCHEMA.md for the rules that keep this file current.

## Architecture

- [pages/architecture.md](pages/architecture.md) — post-overhaul pipeline: rust tracker
  (hyprctl/xdotool backends, span aggregation) -> sqlite (frontend/prisma/db.sqlite) ->
  prisma -> next.js server actions/tRPC -> recharts dashboard. File-path citations
  throughout.

## Events

- [pages/2026-07-09-ui-overhaul.md](pages/2026-07-09-ui-overhaul.md) — Before/after
  evidence of the UI overhaul: pre-overhaul app (085ec7a, empty Activity Summary tbody,
  dead two-point line charts, unstyled) vs live overhauled app (typed GetActivityData
  contract, redesigned dashboard). Full comparison exhibit at
  [assets/ui-overhaul-comparison.html](assets/ui-overhaul-comparison.html) (screenshots +
  architecture diagrams + bug-fix table).

## Entities

- [pages/historical-data.md](pages/historical-data.md) — cross-host inventory of
  every chronomaxi data source before the central Convex migration: big-bertha's
  84,025,654-row/23.2GB authoritative archive (hostname-continuous across
  `andrew-MS-7B86` -> `big-bertha`), big-ron's 9,049-row current DB (demo seed + live),
  empty decoy paths on big-ron/lil-timmy, and the inaccessible/stale legacy Railway
  Postgres source. Table of rows/date-ranges/hours, exact DB paths, and migration
  implications (dedup key, streaming import, device identity normalization).

## Concepts

*(none yet)*

## Sources (raw/)

- [raw/2026-07-09-before-after-capture-notes.md](raw/2026-07-09-before-after-capture-notes.md)
  — capture notes backing pages/2026-07-09-ui-overhaul.md.
- [raw/2026-07-09-data-archaeology-capture.md](raw/2026-07-09-data-archaeology-capture.md)
  — verbatim SQLite scan output backing pages/historical-data.md.
