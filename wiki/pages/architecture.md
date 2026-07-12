---
title: Architecture (central chronomaxi)
date: 2026-07-10
type: entity
sources: []
---

# Architecture (central chronomaxi)

Target architecture for the ROLLOUT phase: board-approved (strike-board rows 1-3,
5-10) central hosting on big-bertha, committed at repo commit `e2596dd`. This page
describes the architecture the rollout cuts over to, not the pre-migration
per-host state — see [historical-data.md](historical-data.md) for the data
inventory the migration reads from, and
[2026-07-09-ui-overhaul.md](2026-07-09-ui-overhaul.md) for the now-superseded
tracker -> sqlite -> Prisma -> Next.js server actions/tRPC -> recharts pipeline
this replaces (no Prisma, no server actions/tRPC layer in the central design;
the dashboard talks to Convex directly).

## Pipeline

```
tracker (big-ron | big-bertha | lil-timmy, one instance per machine)
  -> local durable spool (sqlite, tracker/src/spool/mod.rs)
    -> decoupled ingest flusher (tokio task, tracker/src/ingest/mod.rs)
      -> HTTP POST /ingest, bearer secret (convex/http.ts)
        -> Convex mutation insertSpanAndAggregate (convex/spans.ts, convex/lib/spanIngest.ts)
        -> spans (append-only) + dayAgg/hourAgg/programAgg/categoryAgg/programDetailAgg
           (materialized rollups, per-device bucket keys since 2026-07-10,
           convex/schema.ts, convex/lib/aggregation.ts)
            -> dashboard.getDashboard query, reads ONLY the aggregates (convex/dashboard.ts)
              -> NERV Next.js dashboard, convex-native (frontend/src/app/_components/DashboardShell.tsx)
```

Backing store for Convex itself: self-hosted `postgres:17` + the Convex backend/
dashboard containers, docker on big-bertha only (`deploy/docker-compose.yml`),
images pinned by digest (not `:latest` — the compose file's header comment
records why the `precompiled-YYYY-MM-DD-<sha>` GitHub release-tag naming does not
correspond 1:1 to `ghcr.io` image tags, so digest pinning was verified against
the live registry rather than assumed).

## 1. Capture: rust tracker, one instance per machine

Each of big-ron, big-bertha, and lil-timmy runs its own tracker instance (same
binary, platform-selected backend — `select_backend`,
`tracker/src/logger_v4.rs:70`: hyprctl/xdotool on Linux depending on
Wayland/X11, a separate macOS backend on timmy). Per-tick capture logic is
unchanged from the pre-migration design (see historical-data.md's linked
pipeline for the capture details); what changed is the sink:

2026-07-10 batch two overhauled the linux capture path: evdev input counting
(tracker/src/input_evdev.rs, EACCES-tolerant with 60s retry), window-title
changes count as idle-breaking activity (tracker/src/idle_tracking.rs), the
Hyprland backend consumes .socket2.sock events instead of per-tick hyprctl
(tracker/src/hypr_events.rs, addresses normalized for the missing 0x prefix),
and terminal focus resolves a tmux subProgram (push file from
deploy/drilldown/ hooks, else tmux IPC). Details:
[2026-07-10-batch-two.md](2026-07-10-batch-two.md).

- Every completed span is written **synchronously, local-disk-only** to a
  durable spool (`tracker/src/spool/mod.rs`) before any network attempt —
  `spool(sourceId TEXT PK, payload JSON, createdAt, sentAt NULL)`. Capture
  durability never depends on Convex or network availability.
- A **decoupled** ingest flusher (`tracker/src/ingest/mod.rs`) runs as its own
  tokio task with its own spool connection; it never blocks capture. It claims
  pending batches (`spool.claim_batch`), POSTs them to
  `$CHRONOMAXI_INGEST_URL/ingest` with `Authorization: Bearer
  $CHRONOMAXI_INGEST_SECRET`, and on success marks them `sentAt` in one
  `UPDATE`. On failure the whole batch stays pending and retries with
  exponential backoff (5s doubling, capped 5min) — Convex dedupes by
  `sourceId` (`by_sourceKey` unique index), so a retried batch is always a safe
  no-op for rows already accepted. Sent rows older than 7 days are pruned
  hourly; pending rows are never pruned regardless of age.
- Config resolved from env (`tracker/src/config.rs`): `CHRONOMAXI_INGEST_URL`,
  `CHRONOMAXI_INGEST_SECRET`, `CHRONOMAXI_ACTOR`, `CHRONOMAXI_DEVICE_NAME`,
  `CHRONOMAXI_SPOOL_PATH` (defaults to
  `$XDG_STATE_HOME/chronomaxi/spool.sqlite` on Linux, `~/Library/Application
  Support/chronomaxi/spool.sqlite` on macOS).
- Deployment mechanism differs by platform: Linux hosts (big-ron, big-bertha)
  use the templated systemd user unit `chronomaxi-tracker.service` (repo
  root, `${...}` placeholders substituted per host at install time); macOS
  (lil-timmy, LIVE since 2026-07-10 batch two) uses the LaunchAgent template
  `deploy/launchd/com.pynchlabs.chronomaxi-tracker.plist` — a *LaunchAgent*
  specifically, not a LaunchDaemon, because AX/WindowServer and the
  Accessibility/Input Monitoring permission dialogs both require running
  inside the user's Aqua GUI session (`gui/<uid>` domain), which a root-level
  LaunchDaemon never has.
- big-bertha's tracker needs its active local GNOME-on-X11 seat (see the
  `tailnet` skill) for full input-count telemetry — keystroke/click counts
  depend on the X11 capture backend having a live local seat to attach to,
  not just window/program/category time, which any backend can produce.

## 2. Transport: HTTP ingest, bearer-secret auth

`convex/http.ts` exposes two unauthenticated-at-the-edge, secret-gated routes,
both checked by `checkBearerSecret` against the `CHRONOMAXI_INGEST_SECRET`
Convex deployment env var (set once via `bunx convex env set
CHRONOMAXI_INGEST_SECRET <value> --url ... --admin-key ...`; there is no
default, a missing env var fails closed):

- `POST /ingest` — batches of up to `MAX_INGEST_BATCH_SIZE` (500) span items,
  each validated against `isIngestSpanItem` (mirrors `convex/spans.ts`'s
  `ingestSpanValidator` — validated here, not just cast, since this is
  untrusted network input crossing the HTTP boundary) before being handed to
  the internal mutation `convex/spans.ts`. `nullsToUndefined` normalizes
  `serde_json`'s explicit-`null` encoding of Rust's `Option::None` to
  Convex's absent-key `v.optional(...)` semantics.
- `POST /session-event` — the session-attribution lifecycle sink (mirrors
  `convex/sshSessions.ts`'s `ingestSessionEvent` args validator); see
  "Session attribution" below.

## 3. Storage: self-hosted Convex + Postgres (big-bertha only)

`deploy/docker-compose.yml`, four services:

- `postgres` (`postgres:17`, `POSTGRES_DB=chronomaxi_prod`) — Convex's
  document/index backing store.
- `backend` (`ghcr.io/get-convex/convex-backend`, digest-pinned) — ports
  `3210` (sync/client) and `3211` (HTTP actions / site proxy). The
  `data:/convex/data` volume is still required even with Postgres backing
  documents/indexes: it holds modules, exports, and (unless
  `S3_STORAGE_*` is set) file storage + search indexes.
- `dashboard` (`ghcr.io/get-convex/convex-dashboard`, digest-pinned) — Convex's
  own admin UI, port `6791`, distinct from the chronomaxi product dashboard in
  step 6 below.
- `export-cleanup` — an `alpine` sidecar that prunes
  `/convex/data/storage/exports` older than 3 days, since Convex does not
  auto-prune export artifacts; authoritative retained copies live off-box (see
  Operations page, backup section).

## 4. Schema: spans + materialized aggregates

`convex/schema.ts`:

- `spans` — append-only system of record, one row per contiguous
  same-window/program run, emitted directly by the tracker's own checkpoint
  logic or by the historical importer. Dedupe/idempotency key `sourceKey`
  (`by_sourceKey` unique index). `actor` is `"human"` or `"agent:<name>"`;
  `deviceName` is the canonical name after `deviceAliases` resolution
  (`rawDeviceName` is kept as received, for audit).
- `dayAgg` / `hourAgg` / `programAgg` / `categoryAgg` / `programDetailAgg` —
  small materialized rollups computed incrementally via
  `convex/lib/aggregation.ts`'s `deriveSpanDeltas`, the single source of truth
  for span-to-aggregate math. Since 2026-07-10 every bucket key includes a
  required `deviceName` (composite indexes, e.g. `by_dayKey_device`), and
  `programDetailAgg` (program x subProgram) feeds the Programs drill-down.
  Both the live ingest mutation (`convex/spans.ts`) and the historical
  migration import mutation (`convex/migration.ts`) call it and apply the
  result the same way (upsert-by-key, add-to-existing-or-insert).
  `scripts/rebuild-aggregates.ts` can rebuild every bucket from spans (paged
  wipe+replay, watermarked, resumable); it ran once in prod for the
  per-device backfill.
- `convex/dashboard.ts`'s `getDashboard()` query reads **only** these
  aggregate tables (optionally device-filtered), never `spans` — stays fast
  and live-subscribable
  regardless of how many spans have accumulated.
- `deviceAliases` (`convex/lib/deviceAlias.ts`'s `resolveCanonicalDevice`) —
  e.g. resolves the pre-rename hostname `andrew-MS-7B86` to the canonical
  `big-bertha`.
- `sshSessions` — the session-attribution lifecycle sink (indexed
  `by_sourceId`, `by_sessionId`, `by_targetHost_startedAt`).
- `migrationCheckpoints` — the importer's resumable checkpoint state,
  authoritative over its local `.checkpoints/<dataset>.json` mirror.

## 5. Historical migration (one-time, gated)

`migration/` is a standalone bun package (importer `import.ts` + verifier
`verify.ts`) that compacts each source's raw `Log` rows into `spans` via a
run-length-encoding pass. Three production datasets: `bertha-archive` (~84M
raw rows -> ~32,116 compact spans), `ron-live` (~903 rows), `ron-demo` (8,241
rows, synthetic seed data, migrated as its own device so it never inflates a
real device's usage stats). Full runbook, CLI reference, and dataset table:
[migration/README.md](../../migration/README.md).

**HARD ORDERING GATE**, non-negotiable: for each device, the compact-mode
import must reach checkpoint `status=complete`, and `bun run verify.ts` must
print `ALL CHECKS PASSED`, **before** that device's tracker is repointed at
Convex's live `POST /ingest` endpoint. Two independent reasons this cannot be
relaxed: (1) the importer's watermark is a point-in-time `MAX(rowid)` snapshot
of the source `Log` table — once a tracker is repointed at live ingest it
stops writing `Log` entirely and starts writing spans directly, so there is no
way to reconcile a `Log`-row gap after that switch happens; (2) `verify.ts`'s
ground truth comes from an independent SQL RLE query against the source, not
a re-run of the compactor, so it is the only check that would catch a bug *in*
the compaction logic itself, not just confirm the network accepted what the
importer sent.

**Cold archive rule**: the source SQLite files are opened `{ readonly: true,
create: false }` and never modified by any code path in `migration/`. Once a
dataset's backfill is verified, its checksum is recorded once
(`sha256sum ... | tee <dataset>.sha256`) and the file is never deleted, even
after cutover — it is the permanent, lossless fallback for tick-level detail
(e.g. per-tick `browserTitle` history) that the compacted `spans` table
intentionally discards.

## 6. Serving: NERV Next.js dashboard (big-bertha only)

`frontend/src/components/ConvexClientProvider.tsx` wraps the app in
`ConvexProvider(new ConvexReactClient(env.NEXT_PUBLIC_CONVEX_URL))` — the
frontend is convex-native: no Prisma, no server actions, no tRPC layer (all
superseded from the pre-migration design in
[2026-07-09-ui-overhaul.md](2026-07-09-ui-overhaul.md)).
`frontend/src/app/_components/DashboardShell.tsx` calls
`useQuery(api.dashboard.getDashboard)` plus `useConvexConnectionState()` for
live connection status, rendering NERV components
(`frontend/src/components/nerv/`, see [design-system.md](design-system.md)).

Only **one** live serving instance exists: big-bertha. Deployed via the
templated systemd unit pattern (`chronomaxi-web.service`, `bun run start`,
`PORT=3001`, `WorkingDirectory=frontend/`). Tailscale serve publishes it
externally on a **dedicated** port because `443` is already taken on
big-bertha by another app.

## Production URLs (post-rollout)

| Surface | URL |
|---|---|
| Dashboard | `https://big-bertha.tail3f4961.ts.net:8443` (tailscale serve -> `localhost:3001`) |
| Convex client (sync/ws) | `http://big-bertha:3210` |
| Convex HTTP actions (ingest) | `http://big-bertha:3211` |

Tracker env for every repointed device:
`CHRONOMAXI_INGEST_URL=http://big-bertha:3211`,
`CHRONOMAXI_INGEST_SECRET=<shared, generated once on bertha, reused
verbatim across all machines' env files>`, `CHRONOMAXI_ACTOR=human` (per
device operator; agents set their own via the tracker's own actor field or
the ssh-attribution mechanisms below, not this var).

## big-ron: standby, not a second live stack

- The **local validation Convex stack** (docker compose under
  `~/personal/chronomaxi/deploy` on big-ron, ports `13210`/`13211`/`16791`,
  `deploy/.env`) exists only to smoke-test the migration and rollout before
  cutover. It stays up until cutover completes, then is torn down
  (`docker compose down`, volumes kept — it is not the standby deployment
  described next).
- Post-cutover, big-ron's role is a **cold nightly-snapshot standby**, not a
  second live-serving instance: `deploy/BACKUP-RUNBOOK.md`'s nightly cron on
  bertha runs `npx convex export`, rsyncs the zip to
  `big-ron:/backups/chronomaxi/`, and a nightly restore on big-ron imports
  `--replace-all` into a separately-provisioned standby deployment (its own
  `INSTANCE_NAME`/`INSTANCE_SECRET`, its own admin key, schema/functions
  pushed once via `npx convex deploy --deployment <standby>` since a backup
  ZIP contains only table data, never code/schema/env vars). RPO is ~24h by
  design — no multi-master, no dual-write.
- big-ron's **pre-existing** services — `chronomaxi-web.service` (old
  Prisma/sqlite dashboard, port 3001) and `chronomaxi-tracker.service`
  (writes to local sqlite) — keep running until the cutover step for that
  device explicitly retires them; they are not touched just because the
  central stack exists.

## Session attribution: dual mechanism

Every SSH connection to any of these three machines — interactive, an
agent's own `ssh` call via the `bash` tool, or the omp `ssh` tool's first
call per `ControlPersist` window — is tagged with who drove it, so the
dashboard can split human hours from per-agent hours instead of one
undifferentiated bucket. **Not yet installed on any machine** — this wave
delivered the code (`deploy/attribution/`) and the go/strike-gated skill
updates only; `install.sh` runs later, by Andrew, per machine.

- **Mechanism 1 (interactive sessions only)**:
  `deploy/attribution/chronomaxi-attribution.zsh` registers `precmd`/
  `preexec` hooks (via `add-zsh-hook`, sourced from `.zshrc` after
  oh-my-zsh's own source line so it writes the title last). Every prompt
  cycle it sets the OSC2 terminal title to
  `cmx|actor=<actor>|host=<hostname>|to=<target-or-dash>|sid=<8lowercasehex>`.
  Display-only; never makes a network call.
- **Mechanism 2 (every session, including non-interactive)**:
  `deploy/attribution/chronomaxi-ssh-hook.sh`, wired via `ssh_config`'s
  `Host * / PermitLocalCommand yes / LocalCommand
  ~/.config/chronomaxi/chronomaxi-ssh-hook.sh %n %h %p %r %L` — the one hook
  point every caller execs through (interactive shells, the `bash` tool's
  raw `ssh` calls, and the omp `ssh` tool's first connection per host). POSTs
  `ssh-start`/`ssh-end` to `$CHRONOMAXI_INGEST_URL/session-event`; failures
  spool to `/tmp/cmx-events.jsonl` and replay opportunistically on the next
  connection. A shell-function `ssh()` wrapper was tried first and rejected:
  the omp `bash` tool empirically does not source `.zshrc`/`.bashrc`
  functions, so a wrapper misses the dominant agent-driven pattern entirely.
- **Actor resolution** (identical rule, both mechanisms), resolved fresh from
  the environment on every hook call, never cached: `CMX_ACTOR_OVERRIDE` if
  set, else `agent:<CMX_AGENT_NAME>` (or `agent:unknown`) if `OMPCODE` is
  set, else `human`. A human's interactive shell is structurally never a
  descendant of the omp harness process tree, so `OMPCODE` is structurally
  absent there — this asymmetry (an agent must never mislabel itself as
  human; a human is never mislabeled as an agent) is the one invariant the
  design treats as inviolable.
- **Known gap**: omp's dedicated `ssh` tool multiplexes a persistent
  `ControlPersist` connection per host; only the first call in a given
  persistence window fires `LocalCommand`. No config-level fix exists.
- Agents self-tag their own `bash`-tool-driven `ssh`/`scp`/`rsync -e ssh`
  calls with `env: {"CMX_AGENT_NAME": "<task-id-or-role>"}` — see the
  `chronomaxi-attribution` skill and the `tailnet` skill's "Session
  attribution" section for the agent-facing convention, and
  `deploy/attribution/README.md` for the full design/threat model/
  verification matrix.

## 2026-07-10 batch two (fleet polish and drill-down)

Superset summary in [2026-07-10-batch-two.md](2026-07-10-batch-two.md):
per-device aggregates + backfill, subProgram drill-down end to end, timer /
actorOverride / sshSessions APIs (`convex/timer.ts`,
`convex/actorOverride.ts`, HTTP routes `/timer` and `/actor-override`),
device-filtered dashboard with whoami auto-default, lil-timmy tracker live,
and the explicit fleet deploy pipeline: `bun run deploy:fleet` from the
canonical monorepo package. It pushes private monorepo main, publishes the
Chronomaxi subtree to the public mirror, deploys Convex/frontend on Bertha
before any tracker restart, runs health checks, and records the successful
monorepo revision in `~/.local/state/chronomaxi/fleet-last-deployed-rev`.
