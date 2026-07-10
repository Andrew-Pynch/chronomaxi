---
title: UI overhaul, before/after evidence
date: 2026-07-09
type: event
sources: [raw/2026-07-09-before-after-capture-notes.md]
---

# UI overhaul, before/after evidence (2026-07-09)

Visual and architectural comparison of chronomaxi before and after the 2026-07-09
overhaul. "Before" is git commit `085ec7a` (the repo's current HEAD, run standalone from
a `git worktree` on port 3002). "After" is the uncommitted working-tree state, the app
running live at `http://localhost:3001/home` (port 3001). Both were pointed at the same
`frontend/prisma/db.sqlite` snapshot so the underlying activity data is identical; only
the code changed. See [architecture.md](architecture.md) for the full post-overhaul
pipeline writeup; this page focuses on what was broken, what it looked like, and what
fixed it.

Full self-contained comparison exhibit (screenshots, architecture diagrams, bug table):
[assets/ui-overhaul-comparison.html](../assets/ui-overhaul-comparison.html). Opens
standalone, no server or build step needed.

## What the before app looked like

Full-page capture: [assets/before-dashboard-full.png](../assets/before-dashboard-full.png).
Closeup of the broken table: [assets/before-emptytable-closeup.png](../assets/before-emptytable-closeup.png).

Unstyled default Tailwind layout, no dashboard chrome. Three things visibly broken in a
single screenshot:

- The "Activity Summary" table renders its header row (Date, Total Hours, Keystrokes,
  Left/Right/Middle Clicks, Mouse Movement) but the `<tbody>` is empty, zero rows, for
  any amount of underlying data. Root cause: `frontend/src/app/_components/ActivitySummary.tsx`
  (085ec7a) hardcodes `<tbody className="divide-y divide-gray-200"></tbody>`, there is no
  map over any prop at all, the component never reads `data.summaryData` in its render.
- "Hours of Activity per Day" and "Keystrokes per Day" are `recharts` `LineChart`s that
  render as a single straight diagonal segment between two points rather than a real
  trend line. Root cause: both charts only look at the last 24 hours of logs
  (`getActivityDataForCurrentUser`, `frontend/src/app/home/actions.ts` in 085ec7a, `gte:
  showActivityAfterDate` where `showActivityAfterDate = now - 24h`), so the per-day
  series has at most two buckets (today, yesterday) to plot.
- Work Chunking Stopwatch shows a static `00:00:00` with no active countdown state and no
  visual polish, just raw unstyled `<input type="number">` fields.

## What the after app looks like

Full-page capture: [assets/after-dashboard-full.png](../assets/after-dashboard-full.png).
Closeup of the stat card row: [assets/after-statcards-closeup.png](../assets/after-statcards-closeup.png).

Dark-themed redesign against the typed `GetActivityData` contract
(`frontend/src/lib/activity-types.ts`): six stat cards (active time, keystrokes, clicks,
mouse distance, top program, top category) each carrying a 7-day-average delta, a
populated "Active Hours, Last 7 Days" area chart spanning all 7 days, a "Keystrokes Per
Hour Today" bar chart with 24 hourly buckets, a horizontal program-duration bar chart, a
category donut, and a working Focus Timer widget.

## Root causes and fixes

Full detail (code references) in the comparison exhibit's bug table section; summarized
here:

| Bug | Root cause (085ec7a) | Fix (current) |
|---|---|---|
| Empty tbody | `ActivitySummary.tsx` hardcodes an empty `<tbody>`, never maps data | Table replaced with typed stat cards bound to `data.today`/`data.days` |
| `getSummaryData` undefined | `logHelpers.getSummaryData()` reduces logs into a `Record<date, {...}>`, then destructures top-level fields that were never on that shape | `getStatsForLogs` returns the typed `GetActivityData` shape directly, no untyped intermediate |
| `Object.entries()` on an array | `Charts.tsx` calls `Object.entries(data.keystrokeFrequencyPerHourToday)`, a field that is already an array | `hourlyToday: HourlyStat[]` consumed directly as an array |
| Timer NaN | `Timer.tsx` does unguarded `parseInt(e.target.value)` into a controlled input | New Focus Timer widget parses with explicit numeric guards and safe defaults |
| Port mismatch | `.env.example` hardcodes `NEXTAUTH_URL="http://localhost:3000"` (default Next.js port) while the app runs on 3001 | `.env.example` updated to `http://localhost:3001` |
| No Wayland support | Tracker only implements an X11 backend (`xdotool`/`xprop`), `Command` output `.unwrap()`'d directly, panics with no error handling outside X11 | `CaptureBackend` enum (`tracker/src/logger_v4.rs`) with `Hyprland` and `X11` variants, selected at runtime from `HYPRLAND_INSTANCE_SIGNATURE`/`XDG_SESSION_TYPE` |
| Row flood | `save_to_db_every_n_seconds()` (085ec7a `logger_v4.rs`) calls `end_current_log().unwrap()` on every 100ms tick regardless of window change, roughly 10 rows/sec | Span aggregation ends a log only on window change, idle change, a 60s cap, or a 40s checkpoint (`MAX_SPAN_SECONDS`/`CHECKPOINT_SPAN_SECONDS`), roughly 1 row per 40s of continuous activity |

## Method

- Before: `git worktree add /tmp/chronomaxi-before 085ec7a`, copied `.env` and
  `frontend/prisma/db.sqlite` from the live repo into the worktree's `frontend/`, `bun
  install`, `bunx prisma generate`, then `SKIP_ENV_VALIDATION=1 bunx next dev --port
  3002` in the background. Screenshotted `http://localhost:3002/home` at 1600x1560,
  then killed the dev server and ran `git worktree remove --force
  /tmp/chronomaxi-before`. No code in the main working tree was touched.
- After: screenshotted the already-running dev server at `http://localhost:3001/home`,
  same 1600x1560 viewport, ~5s settle time for chart animation.
- Root-cause claims for both sides are grounded by reading the actual source at
  `085ec7a` (via `git show 085ec7a:<path>`) and the current uncommitted source, not
  inferred from screenshots alone. Full command-by-command session log, including exact
  file paths read for grounding, in
  [raw/2026-07-09-before-after-capture-notes.md](../raw/2026-07-09-before-after-capture-notes.md).
