---
title: Operations (central chronomaxi)
date: 2026-07-10
type: entity
sources: []
---

# Operations (central chronomaxi)

Service inventory and day-2 runbook pointers for the ROLLOUT-phase central
architecture — see [architecture.md](architecture.md) for what each piece
does and why. This page is the "what's running where, on what port, with
which env file" index; it does not re-derive design decisions already
covered there.

## big-bertha (central host, production)

| Service | Type | Port(s) | Env file | Notes |
|---|---|---|---|---|
| `postgres` | docker (`deploy/docker-compose.yml`) | internal only | `deploy/.env` (600 perms) | Convex's document/index store, `chronomaxi_prod` DB |
| `backend` | docker | `3210` (sync), `3211` (HTTP actions/ingest) | `deploy/.env` | Convex backend, digest-pinned image |
| `dashboard` | docker | `6791` | `deploy/.env` | Convex's own admin UI — not the chronomaxi product dashboard, not tailscale-served |
| `export-cleanup` | docker | none | — | Alpine sidecar, daily prune of `/convex/data/storage/exports` >3d |
| chronomaxi tracker (bertha's own) | systemd user unit, `chronomaxi-tracker.service` template | none (outbound only) | unit `Environment=` lines: `CHRONOMAXI_INGEST_URL=http://big-bertha:3211`, `CHRONOMAXI_INGEST_SECRET`, `CHRONOMAXI_ACTOR=human`, `CHRONOMAXI_DEVICE_NAME=big-bertha` | needs the active local GNOME-on-X11 seat for full input capture (see `tailnet` skill) |
| NERV dashboard (product) | systemd unit, `chronomaxi-web.service` template | `3001` (loopback/tailnet) | repo-root `.env.local`: `NEXT_PUBLIC_CONVEX_URL=http://big-bertha:3210` | `bun run start`, `WorkingDirectory=frontend/` |
| tailscale serve | OS-level | `8443` -> `localhost:3001` | — | `443` already taken by another app on bertha, hence the dedicated port |
| ssh attribution hooks | `~/.config/chronomaxi/{chronomaxi-attribution.zsh,chronomaxi-ssh-hook.sh}` | none | `~/.config/chronomaxi/env` (600 perms, never committed) | installed via `deploy/attribution/install.sh`; **not yet run** — gated on Andrew per go/strike board |
| nightly backup cron | cron | — | — | `npx convex export` + `rsync` to `big-ron:/backups/chronomaxi/`, see Backup/restore below |

Pre-existing non-chronomaxi services on bertha (hermes, atlas-api/web/slack,
content-hub, cloudflared, starcube-nucleus, philosophy-bot-db, web-db-1) are
unrelated and untouched — see the `tailnet` skill's "big-bertha service
runbook" for that inventory. They are the reason `443` was unavailable for
tailscale serve above.

## big-ron (workstation, standby)

| Service | Type | Port(s) | Env file | Notes |
|---|---|---|---|---|
| local validation Convex stack | docker compose, `~/personal/chronomaxi/deploy` | `13210` (sync), `13211` (HTTP actions), `16791` (dashboard) | `deploy/.env` | pre-cutover smoke-test stack only; stays up until cutover completes, then `docker compose down` (volumes kept), NOT the standby deployment below |
| standby Convex deployment (post-cutover) | docker compose, own compose project | own ports (distinct `INSTANCE_NAME`/`INSTANCE_SECRET`) | separate `.env.local` pointed at the standby URL+admin key | brought up once per `deploy/BACKUP-RUNBOOK.md`'s "One-time standby bring-up" section; schema/functions pushed via `npx convex deploy --deployment <standby>` (backup ZIPs carry table data only) |
| nightly restore cron (post-cutover) | cron | — | — | `npx convex import --replace-all <latest>.zip -y --deployment <standby>`, RPO ~24h, no multi-master |
| `chronomaxi-web.service` (OLD) | systemd | `3001` | unit env | pre-migration Prisma/sqlite dashboard; **keep running** until the cutover step for big-ron explicitly retires it |
| `chronomaxi-tracker.service` (OLD) | systemd | none | unit env | writes to local sqlite (pre-migration path); **keep running** until big-ron's device is cut over per the migration's HARD ORDERING GATE |
| chronomaxi tracker (NEW, post-cutover) | systemd user unit, same template, repointed | none (outbound only) | `CHRONOMAXI_INGEST_URL=http://big-bertha:3211`, shared `CHRONOMAXI_INGEST_SECRET`, `CHRONOMAXI_ACTOR=human`, `CHRONOMAXI_DEVICE_NAME=big-ron` | only after `bun run verify.ts` prints `ALL CHECKS PASSED` for `ron-live`/`ron-demo` — see [architecture.md](architecture.md#5-historical-migration-one-time-gated) |
| ssh attribution hooks | same as bertha | — | `~/.config/chronomaxi/env` | same install.sh, run independently per host |

`~/backups/chronomaxi` already exists on big-ron (receives the nightly
rsynced export zips from bertha).

## lil-timmy (macOS) — DEFERRED, do not touch this rollout

Board decision: **all** lil-timmy/macOS work is deferred out of this
rollout. Nothing below is actioned; listed only so the deferred scope is
visible in one place (see "Morning-deferred list").

## Backup / restore

Full runbook: [../../deploy/BACKUP-RUNBOOK.md](../../deploy/BACKUP-RUNBOOK.md)
(nightly cron, standby bring-up, ad-hoc manual backup before any risky
operation, emergency restore, in-place version upgrades). Historical
migration's own backup/verification/rollback procedure (checkpoint/resume,
cold archive rule, pre-import snapshot, `verify.ts`):
[../../migration/README.md](../../migration/README.md).

## Morning-deferred list

Items 1-4 require lil-timmy, which is not to be touched this rollout.
Items 5-6 are big-ron items blocked on sudo/user interaction:

1. **timmy tracker install** — bring up the macOS LaunchAgent
   (`deploy/launchd/com.pynchlabs.chronomaxi-tracker.plist`, `gui/<uid>`
   domain, substituted `${...}` placeholders) on lil-timmy.
2. **macOS build verify** — cross-compile/build the tracker binary for
   Apple Silicon and confirm it runs standalone before wiring it into the
   LaunchAgent.
3. **Accessibility / Input Monitoring permission grant** — macOS System
   Settings dialog the LaunchAgent needs at first run; a LaunchAgent (not a
   LaunchDaemon) is required specifically because this grant only works
   inside the user's Aqua GUI session.
4. **timmy brave/hooks** — verify the macOS Brave Browser category-matching
   normalization (`tracker/src/logger_v4.rs:527-543`, substring match on
   `localizedName` e.g. `"Brave Browser"`, distinct from the lowercase
   `WM_CLASS` values Hyprland/X11 report) against a live timmy tracker, and
   install the session-attribution hooks
   (`deploy/attribution/install.sh`) on timmy's zsh/ssh config.
5. **big-ron Wayland evdev input capture** — keystroke/click counts on
   Hyprland need read access to `/dev/input/event*` (root:input 660; user
   `andrew` is not in the `input` group). One sudo command
   (`sudo usermod -aG input andrew` + relogin, or a udev ACL rule), then a
   tracker capture-backend addition. Deferred per user's flag-for-morning
   instruction.
6. **big-ron Brave homepage/bookmark** — Brave was running during rollout;
   `chronomaxi-brave-configure.timer` fires daily at 07:45 and applies the
   change on the first morning Brave is closed (see
   `~/.config/chronomaxi/brave-pending.md`).
