# chronomaxi wiki: log

Append-only. One entry per operation, oldest first. Do not edit past entries. See
SCHEMA.md for the entry format and prefix convention.

## [2026-07-09] bootstrap | wiki bootstrapped

Created wiki/ following Andrej Karpathy's LLM Wiki pattern
(https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f): SCHEMA.md
(write-rules for agents), INDEX.md (nav catalog), LOG.md (this file), raw/, pages/,
assets/. Seeded pages/architecture.md describing the current post-overhaul pipeline
(rust tracker -> sqlite -> prisma -> next.js server actions/tRPC -> recharts). Seeded
INDEX.md with a placeholder entry for the planned
pages/2026-07-09-ui-overhaul.md (owned by a separate before/after capture workstream).
Registered the wiki/ directory as qmd collection `chronomaxi`. Added repo-root
AGENTS.md pointing agents at this wiki.

## [2026-07-09] ingest | ui-overhaul page filed by before/after capture workstream

BeforeAfterCapture finished wiki/raw/2026-07-09-before-after-capture-notes.md,
wiki/pages/2026-07-09-ui-overhaul.md, and wiki/assets/{before-dashboard-full.png,
before-emptytable-closeup.png, after-dashboard-full.png, after-statcards-closeup.png,
ui-overhaul-comparison.html}. Replaced the Events placeholder in INDEX.md with the real
entry and added a Sources (raw/) entry for the capture notes.

## [2026-07-09] ingest | historical data archaeology filed by data archaeology workstream

ArchiveArchaeology captured wiki/raw/2026-07-09-data-archaeology-capture.md
(verbatim SQLite scan output from RonArchaeology/TimmyArchaeology/MigrationDesign:
big-bertha's 84,025,654-row/23.2GB archive, big-ron's 9,049-row current DB, lil-timmy
and Railway status) and synthesized wiki/pages/historical-data.md (source table with
rows/date-ranges/hours, big-bertha `andrew-MS-7B86`/`big-bertha` hostname continuity,
Railway marked inaccessible/stale not lost, migration implications: composite dedup
key, streaming/batched import, device identity normalization). Cross-linked
pages/architecture.md (storage section) and pages/2026-07-09-ui-overhaul.md (intro)
to the new page. Added Entities and Sources (raw/) entries in INDEX.md.

## [2026-07-10] ingest | central architecture + operations pages filed for ROLLOUT

SkillsWiki rewrote wiki/pages/architecture.md in place for the board-approved
ROLLOUT-phase central model (trackers-with-spools on 3 machines -> HTTP ingest
-> self-hosted Convex+Postgres docker on big-bertha -> materialized aggregates
-> NERV Next.js dashboard on big-bertha; big-ron cold nightly-snapshot standby;
dual-mechanism SSH session attribution; production URLs; cold archive rule;
HARD ORDERING GATE), citing tracker/src/{spool,ingest,config,logger_v4}.rs,
convex/{schema,http,spans,dashboard,lib/aggregation,lib/deviceAlias}.ts,
deploy/{docker-compose.yml,.env.example,BACKUP-RUNBOOK.md,attribution/README.md},
migration/README.md, and frontend/src/{components/ConvexClientProvider.tsx,
app/_components/DashboardShell.tsx}. Filed new wiki/pages/operations.md
(per-machine service inventory, backup/restore pointers, morning-deferred
timmy list). Added a Files section to wiki/pages/design-system.md listing
frontend/src/components/nerv/* (it lacked one). Updated INDEX.md: rewrote the
architecture.md summary, added an Operations section for the new page. Applied
deploy/attribution/skill-updates.md's three diffs to
~/.agents/skills/tailnet/SKILL.md (big-bertha row corrected to verified facts:
Ubuntu 24.04.4 LTS, active GNOME-on-X11 local seat, docker host, central
chronomaxi/Convex host, 100.100.118.109; new "Session attribution" section;
frontmatter description addition) and created
~/.agents/skills/chronomaxi-attribution/SKILL.md (cmx| tag grammar,
CMX_AGENT_NAME convention, fail-open semantics) verbatim from that proposal —
both files live outside this repo (~/.agents), not committed here, per board
row 8 approval.

## [2026-07-10] ingest | batch two filed (fleet polish and drill-down)

Created pages/2026-07-10-batch-two.md (per-device aggregates + backfill,
subProgram drill-down, timer/actorOverride/sshSessions, fleet-deploy pipeline,
lil-timmy live, secret rotation, incident-bought kill rules). Updated
architecture.md (pipeline, capture overhaul, schema section, batch-two
pointer), operations.md (bertha frontend build env row, ron additions table,
lil-timmy LIVE section, ops rules, morning-deferred list resolved), and
INDEX.md (Events entry). Batch commits: 213b5a6, a1a8ad0, 05ab30b, 672150c,
0261cb1.

## [2026-07-12] ingest | parallel wave: input diagnostics, buckets, scrubber, drilldown live, statusbar, hermes, kloyce

Eight-agent wave (omp orchestration). Tracker: loud per-host input-count
diagnostics (evdev group on ron, DISPLAY import on bertha, TCC on timmy),
config-driven capture-time buckets (buckets.json), fail-closed privacy scrubber
(homework relabel, chmod 600 local audit log, privacy-denylist.json), tmux
session capture in span ingest. Convex: span bucket/tmuxSession fields, POST
/dictation (kloyce word counts, separate dictated bucket), GET /statusline,
typed WPM helpers, getProgramDetail sub-context query. Frontend: PANEL-104
donut rewritten as deterministic SVG segments, PANEL-103 drilldown live
(Alacritty groups by tmux session, BACK nav). deploy/: statusbar/ (waybar on
ron, bumblebee i3 module on bertha, swiftbar script for timmy), hermes/
(connector + 03:30 dream cron writing ~/chronomaxi-dreams/ + slack digest to
C0B6Q5X4WAG + steering watcher, 2/day rate limit), kloyce/ (SSE reporter units
on bertha and timmy posting /dictation). Fleet deployed rev dafd9ae; dashboard
and drilldown verified live post-deploy. Commit: ce35579.

