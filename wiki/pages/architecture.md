---
title: Architecture (post-overhaul)
date: 2026-07-09
type: entity
sources: []
---

# Architecture (post-overhaul)

Current architecture of chronomaxi as of the 2026-07-09 overhaul (uncommitted working-tree
state on top of git commit `085ec7a`, the pre-overhaul baseline). This page describes the
system as it stands after the overhaul; see
[2026-07-09-ui-overhaul.md](2026-07-09-ui-overhaul.md) for what changed and why (owned by
the before/after capture workstream).

## Pipeline

```
rust tracker (hyprctl / xdotool backends, span aggregation)
  -> sqlite (frontend/prisma/db.sqlite)
    -> prisma (frontend/prisma/schema.prisma)
      -> next.js server actions / tRPC (frontend/src/app/home/actions.ts,
         frontend/src/server/api/routers/activity.ts)
        -> recharts dashboard (frontend/src/app/home/_components/Charts.tsx)
```

## 1. Capture: rust tracker

`tracker/src/logger_v4.rs` runs a continuous capture loop (`tick`, `logger_v4.rs:186`).
On each tick it:

- Reads the active window via a platform backend selected at startup
  (`select_backend`, `logger_v4.rs:70`):
  - **Hyprland** (Wayland): shells out to `hyprctl activewindow -j` for the active window
    and `hyprctl cursorpos` for pointer position (`logger_v4.rs:444`, `logger_v4.rs:714`).
    Click counts are not captured on this backend (no global input access under Wayland).
  - **X11**: shells out to `xdotool getactivewindow` / `xdotool getwindowname` for the
    window, and `xprop -id <id> WM_CLASS` for the program's WM class
    (`logger_v4.rs:456-463`), plus `xdotool getmouselocation` for pointer position
    (`logger_v4.rs:720`).
- Classifies the active window into a category via a hardcoded keyword table (coding,
  entertainment, etc.) in `tracker/src/category.rs`.
- Accumulates keystroke and click counts per in-progress span (`accumulate_keys_pressed`,
  `accumulate_left_click_count`, etc., `logger_v4.rs:285`, `logger_v4.rs:651`).
- Ends the current span and starts a new one when the window changes, idle state changes,
  or the span exceeds `MAX_SPAN_SECONDS` / hits a `CHECKPOINT_SPAN_SECONDS` boundary
  (`logger_v4.rs:255-264`). This is the span aggregation logic: one row per contiguous
  span of window+idle state, capped and checkpointed so long-running spans still flush
  periodically.
- Flushes completed (not in-progress) spans to the database every
  `stats_every_n_seconds` via `save_to_db_every_n_seconds` (`logger_v4.rs:327`), which
  calls `bulk_insert_logs` (`tracker/src/db.rs:43`).

Idle detection lives in `tracker/src/idle_tracking.rs`. The tracker can also be run as a
user systemd service via `chronomaxi-tracker.service` (repo root).

## 2. Storage: sqlite

`tracker/src/db.rs` writes to sqlite (or optionally postgres, see `DbType`) via
`bulk_insert_sqlite` / `bulk_insert_postgres` (`db.rs:53`, `db.rs:88`). In the current
frontend-local dev setup the sink is `frontend/prisma/db.sqlite`, the same database the
Next.js app reads from directly, there is no separate ingestion API between tracker and
frontend.

## 3. Schema: prisma

`frontend/prisma/schema.prisma` defines a single model, `Log` (schema.prisma:20), backed
by the sqlite datasource at `file:./db.sqlite`. Key fields: `durationMs`, `category`,
`isIdle`, `windowId`, `programProcessName`, `programName`, `browserTitle`,
`keysPressedCount`, `mouseMovementInMM`, `leftClickCount`, `rightClickCount`,
`middleClickCount`, indexed on `isIdle` and `windowId`. This is the row shape one tracker
span aggregates into.

## 4. Server: actions + tRPC

`frontend/src/server/db.ts` exports a singleton `PrismaClient` (`db`), reused across hot
reloads in dev.

The read path is a plain Next.js server action, not a REST endpoint:

- `frontend/src/app/home/actions.ts`: `getActivityDataForCurrentUser` queries the last 7
  days of non-idle `Log` rows via `db.log.findMany`, then hands them to
  `getStatsForLogs` (`frontend/src/server/api/routers/helpers/logHelpers.ts:83`), which
  aggregates raw log rows into the `GetActivityData` shape (daily summaries, hourly
  buckets, per-program stats, per-category stats).
- `frontend/src/server/api/routers/activity.ts` exposes the same computation over tRPC
  (`activityRouter.getAll`) by calling `getActivityDataForCurrentUser` directly, it is a
  thin wrapper around the server action rather than an independent code path. tRPC
  plumbing lives in `frontend/src/server/api/trpc.ts` and `frontend/src/server/api/root.ts`.

The contract both paths produce is defined once in `frontend/src/lib/activity-types.ts`:
`GetActivityData` (`days`, `today`, `hourlyToday`, `programsToday`, `categoriesToday`,
`generatedAt`), built from `DailySummary`, `ProgramStat`, `CategoryStat`, `HourlyStat`.
Server and UI both import this type, there is one shape, not one per layer.

## 5. UI: recharts dashboard

`frontend/src/app/home/page.tsx` and `frontend/src/app/home/_components/HomePage.tsx`
render the `/home` route. `frontend/src/app/home/_components/Charts.tsx` consumes
`GetActivityData` directly and renders it with `recharts` (line charts, bar breakdowns for
programs/categories). This is the component the before/after capture work is evaluating
for the previously-broken summary table and line charts.

## Stack notes

- Framework: Next.js (App Router) scaffolded from create-t3-app (T3 stack: Next.js +
  Prisma + tRPC + Tailwind), see repo-root `README.md` and `frontend/README.md`.
- Package manager / runtime: Bun (`frontend/bun.lockb`, `bun run local`, `bun run seed`).
- Dev server for the overhauled app: `http://localhost:3001/home`.
- Tracker build: `cargo run` in `tracker/`, or the packaged systemd unit for a durable
  background instance.
