---
title: Operations (central chronomaxi)
date: 2026-07-12
type: entity
sources: []
---

# Operations (central chronomaxi)

Service inventory and day-2 runbook pointers for the live central architecture.
See [architecture.md](architecture.md) for what each piece does and why. This
page records what runs where, on which port, and from which canonical path.

## big-bertha (central host, production)

| Service | Type | Port(s) | Env file | Notes |
|---|---|---|---|---|
| `postgres` | docker (`deploy/docker-compose.yml`) | internal only | `deploy/.env` (600 perms) | Convex's document/index store, `chronomaxi_prod` DB |
| `backend` | docker | `3210` (sync), `3211` (HTTP actions/ingest) | `deploy/.env` | Convex backend, digest-pinned image |
| `dashboard` | docker | `6791` | `deploy/.env` | Convex's own admin UI — not the chronomaxi product dashboard, not tailscale-served |
| `export-cleanup` | docker | none | — | Alpine sidecar, daily prune of `/convex/data/storage/exports` >3d |
| chronomaxi tracker (Bertha) | systemd user unit | none (outbound only) | `EnvironmentFile=~/.config/chronomaxi/env` (600 perms) | binary and working directory under `~/work/personal-agent-monorepo/packages/chronomaxi/tracker`; active local GNOME-on-X11 seat required for full input capture |
| NERV dashboard (product) | systemd user unit | `3001` (loopback/tailnet) | package-root `.env.local` plus `frontend/.env.local` at build time | `bun run start` from `~/work/personal-agent-monorepo/packages/chronomaxi/frontend` |
| Bertha frontend build env | `frontend/.env.local` (600) | none | TLS Convex URL and tailnet device map | required for `bun run build`; `deploy/fleet-deploy.sh` preflights it |
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
| retired local dashboard | disabled systemd unit | none | none | product dashboard runs on Bertha |
| chronomaxi tracker | systemd user unit | none (outbound only) | `~/.config/chronomaxi/env` | binary and working directory under `~/work/personal-agent-monorepo/packages/chronomaxi/tracker`; verified flushing after the 2026-07-12 cutover |
| ssh attribution and drill-down hooks | installed scripts plus zsh, SSH, and tmux config blocks | none | `~/.config/chronomaxi/env` | canonical copies installed from `packages/chronomaxi/deploy/`; title actors and tmux quote preservation verified live |

`~/backups/chronomaxi` already exists on big-ron (receives the nightly
rsynced export zips from bertha).

Ron additions (2026-07-10 batch two):

| Piece | Where | Notes |
|---|---|---|
| fleet deploy | `bun run deploy:fleet` from `packages/chronomaxi/` | explicit only; pushes private monorepo main, publishes the public subtree mirror, then deploys Convex/frontend before trackers; no repository commit hook |
| chronomaxi-cli | `deploy/bin/chronomaxi-cli` -> `~/.local/bin/chronomaxi-cli` | `timer start|pause|toggle|reset [min]`, `actor on|off|toggle`; hits `/timer` and `/actor-override` with the env-file secret |
| hypr binds | `~/.config/hypr/bindings.conf` (SUPER CTRL SHIFT D/T/A) + windowrule in `hyprland.conf` | dashboard webapp class `brave-big-bertha.tail3f4961.ts.net__-Default` pinned to workspace 3 on DP-2 (verified live) |
| drilldown hooks | `deploy/drilldown/install.sh` (installed) | zsh preexec/precmd + tmux hooks write `~/.local/state/chronomaxi/foreground` for subProgram resolution |
| evdev input counts | PENDING one sudo | `/etc/udev/rules.d/70-chronomaxi-input.rules`: `SUBSYSTEM=="input", KERNEL=="event*", TAG+="uaccess"` (70- prefix load-bearing); tracker self-heals within 60s |

## lil-timmy (macOS) — LIVE since 2026-07-10 batch two

| Service | Type | Notes |
|---|---|---|
| chronomaxi tracker | LaunchAgent `com.pynchlabs.chronomaxi-tracker` | binary and working directory under `~/work/personal-agent-monorepo/packages/chronomaxi/tracker`; running and flushing after the 2026-07-12 cutover |
| tracker env | `~/.config/chronomaxi/env` (600) | shared ingest credential rotated and verified 2026-07-12 |
| attribution and drill-down hooks | installed zsh, SSH LocalCommand, and tmux hooks | actor resolution, SSH config, script copies, and tmux quote preservation verified live |
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
