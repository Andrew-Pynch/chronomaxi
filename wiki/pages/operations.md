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
| chronomaxi tracker (bertha's own) | systemd user unit, `chronomaxi-tracker.service` template | none (outbound only) | `EnvironmentFile=~/.config/chronomaxi/env` (600 perms): `CHRONOMAXI_INGEST_URL=http://big-bertha:3211`, `CHRONOMAXI_INGEST_SECRET` (rotated 2026-07-10), `CHRONOMAXI_ACTOR=human`, `CHRONOMAXI_DEVICE_NAME=big-bertha` | needs the active local GNOME-on-X11 seat for full input capture (see `tailnet` skill) |
| NERV dashboard (product) | systemd unit, `chronomaxi-web.service` template | `3001` (loopback/tailnet) | repo-root `.env.local`: `NEXT_PUBLIC_CONVEX_URL=http://big-bertha:3210` | `bun run start`, `WorkingDirectory=frontend/` |
| bertha frontend build env | `frontend/.env.local` (600) | — | `NEXT_PUBLIC_CONVEX_URL=https://big-bertha.tail3f4961.ts.net:3210` (TLS proxy, baked at build time), `CHRONOMAXI_TAILNET_MAP=<ip=name,...>` | REQUIRED for `bun run build`; next reads env from `frontend/`, never the repo root. `deploy/fleet-deploy.sh` preflights this. |
| tailscale serve | OS-level | `8443` -> `localhost:3001` | — | `443` already taken by another app on bertha, hence the dedicated port |
| ssh attribution hooks | `~/.config/chronomaxi/{chronomaxi-attribution.zsh,chronomaxi-ssh-hook.sh}` | none | `~/.config/chronomaxi/env` (600 perms, never committed) | installed on all three hosts (title hook + LocalCommand verified live; timmy verified 2026-07-10 with server-side 200s) |
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

Ron additions (2026-07-10 batch two):

| Piece | Where | Notes |
|---|---|---|
| fleet deploy | `deploy/fleet-deploy.sh` + `.husky/post-commit` | any commit on main auto-pushes and deploys the fleet async; skip with `HUSKY=0` or `CHRONOMAXI_NO_DEPLOY=1`; log `~/.local/state/chronomaxi/fleet-deploy.log`; state `~/.local/state/chronomaxi/fleet-last-deployed-rev`; ordering: convex+frontend on bertha before any tracker restart |
| chronomaxi-cli | `deploy/bin/chronomaxi-cli` -> `~/.local/bin/chronomaxi-cli` | `timer start|pause|toggle|reset [min]`, `actor on|off|toggle`; hits `/timer` and `/actor-override` with the env-file secret |
| hypr binds | `~/.config/hypr/bindings.conf` (SUPER CTRL SHIFT D/T/A) + windowrule in `hyprland.conf` | dashboard webapp class `brave-big-bertha.tail3f4961.ts.net__-Default` pinned to workspace 3 on DP-2 (verified live) |
| drilldown hooks | `deploy/drilldown/install.sh` (installed) | zsh preexec/precmd + tmux hooks write `~/.local/state/chronomaxi/foreground` for subProgram resolution |
| evdev input counts | PENDING one sudo | `/etc/udev/rules.d/70-chronomaxi-input.rules`: `SUBSYSTEM=="input", KERNEL=="event*", TAG+="uaccess"` (70- prefix load-bearing); tracker self-heals within 60s |

## lil-timmy (macOS) — LIVE since 2026-07-10 batch two

| Service | Type | Notes |
|---|---|---|
| chronomaxi tracker | LaunchAgent `com.pynchlabs.chronomaxi-tracker` (gui domain, `~/Library/LaunchAgents/`) | first span flushed 2026-07-10 21:07 CDT; capture degraded (no titles/input counts) until the Accessibility/Input Monitoring grant is clicked on the machine. The substituted plist EMBEDS the ingest secret: regenerate the plist on every rotation. |
| tracker env | `~/.config/chronomaxi/env` (600) | secret rotated 2026-07-10, checksum-verified against bertha |
| attribution hooks | zsh + ssh LocalCommand (via `deploy/attribution/install.sh`) | verified with server-side 200s |
| Brave homepage/bookmark | pending-marker + launchd retry (analog of ron's systemd timer) | applies on first launch-while-closed |

## Ops rules (bought by incidents, 2026-07-10)

- Verify process identity (cwd, owner, parentage, purpose) BEFORE any kill.
  Never signal browser processes (single-instance handoff makes any brave pid
  the user's whole session). Never pkill by pattern; exact PID only.
- Never restart a tracker before the convex backend serving its wire format is
  deployed (`deploy/fleet-deploy.sh` encodes this ordering).
- Secret rotation touchpoints: convex deployment env, `~/.config/chronomaxi/env`
  on all three machines, AND the timmy LaunchAgent plist (embedded copy).

## Backup / restore

Full runbook: [../../deploy/BACKUP-RUNBOOK.md](../../deploy/BACKUP-RUNBOOK.md)
(nightly cron, standby bring-up, ad-hoc manual backup before any risky
operation, emergency restore, in-place version upgrades). Historical
migration's own backup/verification/rollback procedure (checkpoint/resume,
cold archive rule, pre-import snapshot, `verify.ts`):
[../../migration/README.md](../../migration/README.md).

## Morning-deferred list (resolved 2026-07-10 batch two)

1. **timmy tracker install** — DONE: LaunchAgent bootstrapped in `gui/<uid>`,
   first span flushed 21:07 CDT.
2. **macOS build verify** — DONE: first successful macOS build, from git at
   0261cb1, runs standalone.
3. **Accessibility / Input Monitoring grant** — STILL PENDING the click on
   timmy's own screen; capture degraded (no titles/input counts) until then.
4. **timmy brave/hooks** — attribution hooks DONE (verified 200s); Brave
   `localizedName` category normalization still unverified against a
   post-grant tracker (needs item 3 first).
5. **big-ron Wayland evdev input capture** — code DONE (batch two); the udev
   uaccess rule is STILL PENDING one sudo (see Ron additions table above).
6. **big-ron Brave homepage/bookmark** — unchanged: `chronomaxi-brave-configure.timer`
   applies on the first morning Brave is closed
   (`~/.config/chronomaxi/brave-pending.md`).
