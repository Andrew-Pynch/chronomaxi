# chronomaxi historical migration — runbook

Historical-data importer that compacts each source's raw `Log` rows into
`spans` documents in the chronomaxi Convex deployment. `migration/` is a
standalone bun package (own `package.json`/`bun.lock`/`tsconfig.json`,
depends only on `convex`) so it runs from any checkout that has network
access to a deployment and read access to the two source SQLite files — it
does **not** depend on the frontend's generated Convex types.

Decision locked for this pass: **`--mode compact` is the production path**
(~32,116 measured spans for the bertha archive alone). `--mode raw` exists as
a flag/debug escape hatch and is not the recommended way to migrate anything
— see "Expected runtime" below for why.

## Prerequisites

- `bun` (this repo validated against `bun 1.3.14`).
- `bsdtar` on `PATH` — `verify.ts` extracts Convex's export ZIP with it, not
  GNU `unzip`: `unzip`'s zip-bomb heuristic false-positives on Convex's
  export ZIP layout (overlapping local-file-header records), rejecting a
  perfectly valid archive with `invalid zip file with overlapped
  components`.
- `cd migration && bun install` once per checkout.
- `migration/.env.local` (gitignored, never commit it) with:
  ```
  CONVEX_SELF_HOSTED_URL=<sync/HTTP-client URL of the target deployment>
  CONVEX_SELF_HOSTED_ADMIN_KEY=<admin key for that deployment>
  ```
  `lib/load-env.ts` loads this file relative to `migration/`, so both
  `import.ts` and `verify.ts` work the same whether invoked from `migration/`
  or the repo root; existing `process.env` values always win over the file.
- **Admin key**: generated once per deployment, treat exactly like a root
  password:
  ```
  docker compose -f deploy/docker-compose.yml exec backend ./generate_admin_key.sh
  ```
- **Stack URLs** — two different deployments, do not cross them:
  - *Local smoke-test stack* (this checkout, used for everything in "Local
    smoke tests" below): sync `http://127.0.0.1:13210`, http-actions
    `http://127.0.0.1:13211` — the non-standard `132xx` ports are
    deliberate, so a local test instance never collides with a real `3210`
    Convex deployment on the same box. This is what the checked-in
    `migration/.env.local` points at today.
  - *Production* (`deploy/docker-compose.yml`, big-bertha): sync `3210`,
    http-actions/site-proxy `3211` (`deploy/.env.example`). From bertha
    itself: `http://127.0.0.1:3210`. From elsewhere on the tailnet:
    `http://big-bertha:3210`.

## The three production datasets

| dataset | source file | host | `deviceFilter` | canonical device(s) | scale (measured) |
|---|---|---|---|---|---|
| `bertha-archive` | `/home/andrew/personal/chronomaxi/frontend/prisma/db.sqlite` | big-bertha | none (unfiltered — see below) | `andrew-MS-7B86` → `big-bertha` (pre-rename, same physical machine), `big-bertha` → `big-bertha` | 23.2GB, 84,031,360 rows (`MAX(rowid)`) → **32,116 compact spans** (full-archive RLE pass, 210–220s) |
| `ron-live` | big-ron's `~/personal/chronomaxi/frontend/prisma/db.sqlite` (**not** `frontend/db.sqlite` — that path exists on big-ron but is unrelated/empty) | big-ron | `deviceName = "big-ron"` | `big-ron` → `big-ron` (identity) | ~903 rows → ~431 compact spans |
| `ron-demo` | same file as `ron-live` | big-ron | `deviceName = "D2"` | `D2` → `demo` (synthetic `seed.ts` fixture data, deliberately never folded into a real device so usage stats are never inflated) | 8,241 rows → 8,241 spans (already 1:1 span-shaped — `seed.ts` gives every row a unique `windowId` and a random 25–35s duration, so nothing compacts) |

`bertha-archive` reads the whole `Log` table unfiltered because
`andrew-MS-7B86` and `big-bertha` are the **same physical machine** across a
hostname rename — one temporally sequential timeline (confirmed:
`andrew-MS-7B86`'s rows end before `big-bertha`'s begin), so no device split
is needed at read time; alias resolution to the canonical device name
happens at write time via the `deviceAliases` table instead. `ron-live` and
`ron-demo` share one physical file but are two unrelated, non-interleaved
devices (`D2` rows 1–8241, `big-ron` rows 8242+), so each gets its own
`deviceFilter`, dataset name, and migration checkpoint — this is what lets
an operator import `ron-live` while deliberately skipping the synthetic
`ron-demo` fixture, or vice versa.

## Recommended execution

Run the importer **on the host that owns the source file**, pointed at
Convex over **localhost**, not the tailnet:

```
cd migration
CONVEX_SELF_HOSTED_URL=http://127.0.0.1:3210 \
CONVEX_SELF_HOSTED_ADMIN_KEY=<bertha's admin key> \
  bun run import.ts --db /home/andrew/personal/chronomaxi/frontend/prisma/db.sqlite \
    --dataset bertha-archive --mode compact
```

Reason: this keeps the 23.2GB read *and* the Convex writes on one host over
one loopback link — no shipping a 23GB file over the network, no tailnet hop
for either side of the pipeline. Since the production Convex deployment
lives only on big-bertha (big-ron is a cold nightly-snapshot standby per
`deploy/BACKUP-RUNBOOK.md`, not a second live serving instance), the same
localhost recommendation applies to `ron-live`/`ron-demo`: `rsync` big-ron's
tiny `db.sqlite` (~1.8MB) to bertha once, then run both imports from bertha
against `127.0.0.1:3210` too — one host, one localhost URL, for all three
datasets. Running the importer directly on big-ron against bertha over the
tailnet also works at this data size if rsync isn't convenient; it's just
not the primary recommendation.

**Never run this against big-bertha or the real archive as part of this
task** — `import.ts`'s own header comment already enforces that boundary;
everything executed for this pass was against the local self-hosted smoke
stack only (see "Local smoke tests").

## Expected runtime

- **Compact mode (production path)**: end-to-end well under 10 minutes of
  active compute for the full historical backfill + verification.
  Breakdown: the full-archive read/compaction pass over 84,032,012 raw rows
  measured at 210–220s (~3.5–4min); writing ~32K–45K spans at up to 400 per
  Convex mutation is roughly 90–115 calls, tens of seconds total. Catch-up
  passes (only the delta since the last checkpoint) are proportional to
  new-row-count, not archive size — seconds.
- **Raw mode (`--mode raw`, exists as a flag, discouraged)**: migrating
  84M+ raw ticks as individual documents needs 5,252+ sequential
  16,000-doc-max mutation batches; even at an optimistic 200ms/batch that's
  ~17.5 minutes of pure transaction overhead before accounting for
  serializing/transferring tens of GB of JSON — plausibly **4–8+ hours**
  end-to-end. It also balloons Convex storage from 23.2GB to an estimated
  40–80GB+ (per-document `_id`/`_creationTime`/index overhead) and leaves a
  `spans` table where an ordinary dashboard time-range query risks tripping
  the 32,000-docs-scanned-per-transaction read limit on busy days, because
  raw rows are ~93ms increments, not the far coarser units the tracker's own
  checkpoint logic (and this importer's compaction) already produces. Use
  `--mode raw` for debugging a specific rowid range only, never for a real
  migration pass.

## Checkpoint / resume behavior

- `lib/sqlite-source.ts`'s `SqliteLogSource` streams strictly by rowid
  (`WHERE rowid > cursor AND rowid <= watermark ORDER BY rowid LIMIT
  chunkSize`, default `chunkSize` 10,000) — never `OFFSET` (an O(n) skip-scan
  that gets catastrophically slow past a few hundred thousand rows) and
  never `ORDER BY createdAt` (unindexed; measured at 274s for a 5-row
  `LIMIT` against the 84M-row archive, vs 1–15s for rowid-ordered scans over
  the same file).
- The read boundary (`watermarkRowid = MAX(rowid)`) is captured **once** at
  the start of a pass and frozen for that pass's duration — the live tracker
  can keep appending to the source file beyond it, untouched, the whole
  time.
- `CheckpointManager` (`lib/checkpoint-manager.ts`) saves progress every
  10,000 processed source rows to **two** places: the local
  `.checkpoints/<dataset>.json` mirror first (cheap, always succeeds), then
  Convex's `migrationCheckpoints` table (retried up to 3 times with
  backoff — a persistent Convex outage surfaces as a thrown error instead of
  silently losing the checkpoint). On startup, `load()` reads **Convex
  first** (authoritative — reflects state from whichever machine last ran
  the importer) and falls back to the local JSON mirror only if that query
  throws.
- Resume is automatic: the next invocation with no `--from-rowid` picks up
  `cursorStart = existingCheckpoint.lastSourceRowid`, so killing the
  importer at any point and restarting it reprocesses at most one in-flight
  chunk (≤ `chunk-size` rows) of rework, never a restart from rowid 0.
  `--from-rowid <n>` overrides the checkpoint explicitly, e.g. to force a
  full reprocess for an idempotency check (see below).
- Whatever run is still open when a pass ends is **always** closed
  (`flushOpenRun()`) rather than threaded across a process restart — trades
  at most one extra span split per source per pass (single digits total
  across a full migration: 1 backfill + a few catch-up + 1 cutover pass) for
  eliminating an entire class of cross-process resume bugs. `SUM(durationMs)`
  etc. across a split run always equals what one unsplit span would show —
  nothing is lost or double-counted by the split.
- Write-side idempotency is independent of the checkpoint: every span's
  dedupe key is `sourceKey` (`<dataset>:<firstRowid>-<lastRowid>`, or
  `<dataset>:<rowid>` in `--mode raw`), checked against Convex's
  `by_sourceKey` unique index before insert
  (`convex/lib/spanIngest.ts:insertSpanAndAggregate`) — a duplicate
  `sourceKey` is silently skipped and the aggregate rollup tables
  (`dayAgg`/`hourAgg`/`programAgg`/`categoryAgg`) are left untouched. So
  re-running any pass — a normal resume *or* a forced `--from-rowid`
  reprocess — is always a safe no-op for rows already imported.

## HARD ORDERING GATE

For each device: **the compact-mode import for that device's dataset must
reach checkpoint `status=complete`, and `bun run verify.ts` must print `ALL
CHECKS PASSED` for that dataset, before that device's tracker is repointed
at Convex's live HTTP ingest endpoint** (`POST /ingest`, `convex/http.ts`,
gated by the `CHRONOMAXI_INGEST_SECRET` bearer token).

Why this is non-negotiable, not just cautious:

1. The importer's watermark is a point-in-time `MAX(rowid)` snapshot of the
   `Log` table. Once a tracker is repointed at live ingest it stops writing
   to `Log` entirely and starts writing `spans` directly — there is no way
   to reconcile a `Log`-row gap after that switch happens. Every row up to
   cutover must be captured (backfill + catch-up passes, verified) **before**
   the source stops receiving new rows.
2. `verify.ts`'s ground truth is computed by an independent SQL RLE query
   against the source, not a re-run of `lib/compaction.ts` — it is the only
   check that would catch a bug *in* the compactor itself (a bad key, a
   mishandled null `deviceName`, a timestamp-normalization miss), as
   opposed to just confirming the network accepted what the importer sent.
   Skipping it risks shipping a silent compaction bug straight into the
   live-serving `spans` table.

Sequence per device: (1) backfill, then repeated catch-up passes until the
remaining delta is small; (2) stop the tracker (`SIGTERM` — the tracker's
shutdown handler already flushes its in-flight span to local storage
gracefully); (3) one final catch-up pass; (4) `bun run verify.ts` and
confirm `ALL CHECKS PASSED`; (5) **only then** redeploy the tracker pointed
at live ingest and restart it. Devices cut over independently — no
cross-device coordination is required, since every span carries its own
`deviceName`/`rawDeviceName`.

## Pre-import snapshot

Before the *first* backfill pass of the real migration touches the
production deployment at all, take the same ad-hoc manual backup
`deploy/BACKUP-RUNBOOK.md` prescribes before any risky operation:

```
npx convex export --path /backups/manual-pre-change-$(date -u +%Y%m%dT%H%M%SZ).zip
```

Run this from wherever the Convex CLI is configured against the production
deployment (normally bertha itself). This is the actual undo button:
live-write-during-migration is intentionally lock-free (no
dual-write/multi-master), so this snapshot is what you restore from
(`npx convex import --replace-all <zip> -y`, per the runbook's "Emergency
restore" section) if a migration pass needs to be rolled back before
`verify.ts` is trusted.

## Cold archive rule

The source SQLite files are **never** modified by this tool —
`SqliteLogSource` opens every `--db` path with `{ readonly: true, create:
false }` (`lib/sqlite-source.ts`), and no code path in `migration/` writes
to a source file. Once a dataset's backfill is verified:

1. Record the source file's checksum once (it should be identical before
   and after any pass, since nothing here ever writes to it):
   ```
   sha256sum /home/andrew/personal/chronomaxi/frontend/prisma/db.sqlite | tee bertha-archive.sha256
   ```
2. Keep that recorded digest alongside wherever the eventual cold-storage
   copy lands; re-verify it (`sha256sum -c bertha-archive.sha256`) after any
   copy/move/compression step and before ever restoring from a copy.
3. Never delete the 23.2GB file, even after cutover — it is the permanent,
   lossless fallback for tick-level detail the compacted `spans` table
   intentionally discards (every numeric metric is an exact sum, but e.g.
   per-tick `browserTitle` history is not preserved beyond the run's last
   non-null title).

## Running the importer — CLI reference

```
bun run import.ts --db <path> --dataset <bertha-archive|ron-live|ron-demo> [--mode compact|raw]
                   [--batch-size 400] [--chunk-size 10000] [--import-batch <tag>] [--from-rowid <n>]
```

| flag | required | default | meaning |
|---|---|---|---|
| `--db` | yes | — | path to the source SQLite file (tracker `Log` table schema) |
| `--dataset` | yes | — | `bertha-archive` \| `ron-live` \| `ron-demo` (`lib/datasets.ts` maps each to its `deviceFilter`) |
| `--mode` | no | `compact` | `compact` = run-length merge on `(deviceName, windowId, programProcessName, category, isIdle)`; `raw` = one row per source row (debug only) |
| `--batch-size` | no | `400` | initial Convex mutation batch size; halves automatically on a per-transaction-limit error and retries the same chunk |
| `--chunk-size` | no | `10000` | source rows read per SQLite `SELECT ... LIMIT` |
| `--import-batch` | no | auto (`backfill-<dataset>-<ISO ts>` on first run, `catchup-<dataset>-<ISO ts>` on resume) | tag stamped on every span this run writes, for audit/rollback scoping |
| `--from-rowid` | no | checkpoint's `lastSourceRowid` | overrides the resume cursor — forces reprocessing from this rowid regardless of the saved checkpoint |

`bun run import` (package.json script) is equivalent to `bun run import.ts`.

## Verification

```
cd migration
bun run verify.ts --db <source.sqlite> --dataset <bertha-archive|ron-live|ron-demo>
```

Ground truth comes from an **independent** SQL run-length-encoding query
against the source SQLite (`RLE_SQL` in `verify.ts`) — deliberately not a
re-run of `lib/compaction.ts`, so it catches a bug *in* the compactor, not
just "did the network send what I told it to". Convex-side actuals come
from `bunx convex export` (the same tool the backup runbook's nightly
snapshots use), extracted with `bsdtar` and read straight off
`spans/documents.jsonl`.

For every raw device name present in the dataset it checks: span count,
`SUM(durationMs)`, `SUM(keysPressedCount)`, `SUM(clicks)`,
`SUM(mouseMovementInMM)` (1-unit float tolerance), `MIN(startedAt)`,
`MAX(endedAt)` — plus a global check that no two spans in the relevant
device set share a `sourceKey`. Exits non-zero on any failure.

## Local smoke tests

Everything below ran against the local self-hosted stack only
(`127.0.0.1:13210`/`13211`, `migration/.env.local`) — never against
big-bertha or a real archive.

### bertha-archive-shaped fixture (single continuous device timeline, integer → RFC3339 rename split)

Fixture: `bun run fixture` (`fixtures/generate-fixture.ts` defaults: 25,000
rows each for `andrew-MS-7B86` [INTEGER unix-ms createdAt] and `big-bertha`
[RFC3339 TEXT createdAt with nanosecond fractional seconds], deterministic
seed 42, device B starting 1h after device A ends) → `fixtures/fixture.sqlite`,
50,000 rows total. Backfilled by `bun run import.ts --db fixtures/fixture.sqlite
--dataset bertha-archive --mode compact` and previously idempotency-tested
(`--from-rowid 0 --import-batch catchup-idempotency-test`, 0 inserted / 1618
skipped — see `.checkpoints/bertha-archive.json`). Re-confirmed parity fresh
in this pass:

```
$ bun run verify.ts --db fixtures/fixture.sqlite --dataset bertha-archive
[verify] dataset=bertha-archive db=fixtures/fixture.sqlite
[verify] computing ground truth via independent SQL RLE query against source...
[verify] fetching Convex spans via convex export...
[verify] running: bunx convex export --path /tmp/chronomaxi-verify-LOwdvz/export.zip

[verify] device "andrew-MS-7B86": 25000 source rows -> 795 expected spans
  OK   span count: expected=795 actual=795
  OK   SUM(durationMs): expected=1135515088 actual=1135515088
  OK   SUM(keysPressedCount): expected=498172 actual=498172
  OK   SUM(clicks): expected=100242 actual=100242
  OK   SUM(mouseMovementInMM): expected=6285754 actual=6285754
  OK   MIN(startedAt): expected=1704067200000 actual=1704067200000
  OK   MAX(endedAt): expected=1705202715088 actual=1705202715088

[verify] device "big-bertha": 25000 source rows -> 823 expected spans
  OK   span count: expected=823 actual=823
  OK   SUM(durationMs): expected=1135548725 actual=1135548725
  OK   SUM(keysPressedCount): expected=498397 actual=498397
  OK   SUM(clicks): expected=99989 actual=99989
  OK   SUM(mouseMovementInMM): expected=6238629 actual=6238629
  OK   MIN(startedAt): expected=1705206315756 actual=1705206315756
  OK   MAX(endedAt): expected=1706341864265 actual=1706341864265

[verify] uniqueness: 0 duplicate sourceKey(s) among 1618 spans
  OK   no duplicate sourceKeys

[verify] ALL CHECKS PASSED
```

### ron-shaped fixture (both timestamp formats + device-filtered dataset path) — closed out this pass

Fixture: `fixtures/ron-fixture.sqlite`, generated via:

```
bun run fixtures/generate-fixture.ts --out fixtures/ron-fixture.sqlite \
  --device-a D2 --device-b big-ron --rows-per-device 1500
```

1,500 `D2` rows (rowid 1–1500, INTEGER `createdAt` — Prisma/`seed.ts` shape,
matching the D2 demo seed exactly) + 1,500 `big-ron` rows (rowid 1501–3000,
RFC3339 TEXT `createdAt` with nanosecond fractional seconds — rusqlite
tracker shape, matching live tracker rows exactly), non-interleaved. This
one file exercises both `normalizeTimestamp()` branches *and* the
device-filtered dataset path (`ron-live` filters `deviceName="big-ron"`,
`ron-demo` filters `deviceName="D2"`) in a single fixture — confirmed
structurally before running anything:

```
$ bun -e 'new Database("fixtures/ron-fixture.sqlite").query(
    "SELECT deviceName, COUNT(*) c, MIN(rowid) mn, MAX(rowid) mx, typeof(createdAt) t FROM Log GROUP BY deviceName, typeof(createdAt)").all()'
[
  { deviceName: "D2", c: 1500, mn: 1, mx: 1500, t: "integer" },
  { deviceName: "big-ron", c: 1500, mn: 1501, mx: 3000, t: "text" }
]
```

Initial compact backfill against the local stack (`bun run import.ts --db
fixtures/ron-fixture.sqlite --dataset ron-live --mode compact`, then
`--dataset ron-demo`): 48 spans written for `ron-live`, 46 for `ron-demo`
(`.checkpoints/ron-live.json`, `.checkpoints/ron-demo.json`).

**Parity** — `bun run verify.ts` for both datasets:

```
$ bun run verify.ts --db fixtures/ron-fixture.sqlite --dataset ron-live
[verify] dataset=ron-live db=fixtures/ron-fixture.sqlite
[verify] computing ground truth via independent SQL RLE query against source...
[verify] fetching Convex spans via convex export...
[verify] running: bunx convex export --path /tmp/chronomaxi-verify-uoyrpQ/export.zip

[verify] device "big-ron": 1500 source rows -> 48 expected spans
  OK   span count: expected=48 actual=48
  OK   SUM(durationMs): expected=66560111 actual=66560111
  OK   SUM(keysPressedCount): expected=29535 actual=29535
  OK   SUM(clicks): expected=6070 actual=6070
  OK   SUM(mouseMovementInMM): expected=376223 actual=376223
  OK   MIN(startedAt): expected=1704138378781 actual=1704138378781
  OK   MAX(endedAt): expected=1704204938646 actual=1704204938646

[verify] uniqueness: 0 duplicate sourceKey(s) among 48 spans
  OK   no duplicate sourceKeys

[verify] ALL CHECKS PASSED
```

```
$ bun run verify.ts --db fixtures/ron-fixture.sqlite --dataset ron-demo
[verify] dataset=ron-demo db=fixtures/ron-fixture.sqlite
[verify] computing ground truth via independent SQL RLE query against source...
[verify] fetching Convex spans via convex export...
[verify] running: bunx convex export --path /tmp/chronomaxi-verify-yw4FCy/export.zip

[verify] device "D2": 1500 source rows -> 46 expected spans
  OK   span count: expected=46 actual=46
  OK   SUM(durationMs): expected=67578869 actual=67578869
  OK   SUM(keysPressedCount): expected=29941 actual=29941
  OK   SUM(clicks): expected=5942 actual=5942
  OK   SUM(mouseMovementInMM): expected=370473 actual=370473
  OK   MIN(startedAt): expected=1704067200000 actual=1704067200000
  OK   MAX(endedAt): expected=1704134778869 actual=1704134778869

[verify] uniqueness: 0 duplicate sourceKey(s) among 46 spans
  OK   no duplicate sourceKeys

[verify] ALL CHECKS PASSED
```

**Idempotent re-run** — `--from-rowid 0` forces a full reprocess of
already-imported data, exercising the `by_sourceKey` dedupe path (not just
the checkpoint's "nothing to do, cursor already past watermark" short
circuit):

```
$ bun run import.ts --db fixtures/ron-fixture.sqlite --dataset ron-live --mode compact \
    --from-rowid 0 --import-batch catchup-idempotency-test-ron-live
[import] dataset=ron-live mode=compact db=fixtures/ron-fixture.sqlite batchSize=400 chunkSize=10000
[import] resuming from rowid 0, watermark 3000 (1500 rows this pass), importBatch="catchup-idempotency-test-ron-live"
[import] done: 1500 source rows -> 0 spans inserted, 48 spans skipped (already present), 0.0s elapsed, importBatch="catchup-idempotency-test-ron-live", checkpoint at rowid 3000 (status=complete)
```

```
$ bun run import.ts --db fixtures/ron-fixture.sqlite --dataset ron-demo --mode compact \
    --from-rowid 0 --import-batch catchup-idempotency-test-ron-demo
[import] dataset=ron-demo mode=compact db=fixtures/ron-fixture.sqlite batchSize=400 chunkSize=10000
[import] resuming from rowid 0, watermark 1500 (1500 rows this pass), importBatch="catchup-idempotency-test-ron-demo"
[import] done: 1500 source rows -> 0 spans inserted, 46 spans skipped (already present), 0.0s elapsed, importBatch="catchup-idempotency-test-ron-demo", checkpoint at rowid 1500 (status=complete)
```

0 inserted, 48+46 skipped — exactly the expected idempotent result.
Re-ran `bun run verify.ts` for both datasets immediately after: identical
`ALL CHECKS PASSED` output to the parity block above, byte-for-byte the same
numbers, confirming the skip path never double-counts the aggregate rollup
tables either (`spanIngest.ts`'s `insertSpanAndAggregate` only touches
`dayAgg`/`hourAgg`/`programAgg`/`categoryAgg` on the branch where a span was
actually inserted, never on a skip).

## No bugs found

All three fixture-backed test matrices — `bertha-archive` (1,618/1,618
spans, exact field parity), `ron-live` (48/48), `ron-demo` (46/46) — plus
both idempotent re-runs (0 new inserts each, aggregate tables unaffected by
the skip path) passed on the first attempt against the existing,
unmodified `migration/*.ts` code. No source changes were required for this
pass; `bunx tsc --noEmit -p migration/tsconfig.json` is clean.

## Known gaps (out of scope for this pass)

- **No rollback CLI.** The design (delete-by-`importBatch` via the
  `by_import_batch` index, or delete-by-device via `by_deviceName_startedAt`)
  is documented but not implemented as a script in `migration/`. If ever
  needed, use the Convex dashboard or a one-off admin script against those
  indexes — rollback is always safe to retry given `sourceKey` idempotency,
  it just isn't automated here yet.
- **`--mode raw`** type-checks and is wired through the CLI, but was not
  exercised end-to-end in this pass — `compact` is the only path this
  runbook validates or recommends; `raw` remains a debug escape hatch.
