---
name: chronomaxi-fleet-deploy
description: >-
  Deploy chronomaxi (Convex backend, dashboard frontend, and per-machine
  Rust trackers) across the fleet -- big-bertha (central Convex host) plus
  trackers on big-ron/big-bertha/lil-timmy. Use when landing a commit on
  chronomaxi's main branch, running a manual fleet deploy, debugging a
  deploy that didn't fire, or reasoning about the convex-before-trackers
  ordering guarantee.
---

# chronomaxi fleet deploy

## What happens automatically

Every commit landed on `main` in `~/personal/chronomaxi` triggers
`.husky/post-commit`, which -- if the branch is `main` and no opt-out is
set -- spawns `deploy/fleet-deploy.sh` fully detached (`setsid nohup ... &`).
The hook itself returns instantly; the actual deploy runs in the
background and logs to `~/.local/state/chronomaxi/fleet-deploy.log`.

## Ordering guarantee (load-bearing)

The Convex backend (schema + functions) and the frontend deploy on
big-bertha FIRST, before any tracker anywhere is rebuilt/restarted. This
is not an optimization -- Convex's validators reject unknown fields, so a
tracker sending a new field before the backend that accepts it is live
would have every span it flushes rejected. Never manually restart a
tracker ahead of a backend deploy that hasn't landed yet.

## Opting out of an auto-deploy

- `HUSKY=0 git commit -m "wip"` -- skips ALL husky hooks (husky's own
  shim honors this before even reaching post-commit).
- `CHRONOMAXI_NO_DEPLOY=1 git commit -m "wip"` -- skips just the deploy,
  keeps other husky hooks.

Use one of these for intermediate/WIP commits on `main` you don't want
live yet.

## Manual deploy

`deploy/fleet-deploy.sh` from the repo root. Add `CHRONOMAXI_DRY_RUN=1` to
print the full plan (push/build/restart/health-check decisions) with zero
ssh, build, restart, curl, or state-file side effects -- always safe to
run, any branch, any time.

## What it deploys and when

Diffs `HEAD` against the last-deployed rev
(`~/.local/state/chronomaxi/fleet-last-deployed-rev`; missing or
unresolvable -> treated as a full deploy of everything):

- `convex/*` or `frontend/*` changed -> `bunx convex deploy` + frontend
  `bun run build` + restart `chronomaxi-web.service` on big-bertha
  (systemd --user; a failed restart is a WARN, not a hard stop).
- `tracker/*` changed -> `cargo build --release` + restart
  `chronomaxi-tracker.service` on big-ron (local) and big-bertha (ssh),
  both systemd --user units. Each restart is verified `is-active` AND a
  fresh `flushed` journal line within 90s -- a HARD failure (not a
  warning) if that doesn't show, matching the ordering guarantee above.

## lil-timmy (macOS) is best-effort

lil-timmy sleeps often -- a deploy run probes
`launchctl print gui/$(id -u)/com.pynchlabs.chronomaxi-tracker` over ssh
first. Not installed, unreachable, or asleep -> WARN and skip gracefully,
never a hard failure. When installed: builds with
`$HOME/.cargo/bin/cargo` (non-interactive ssh PATH on macOS has no
`~/.cargo/bin`) and restarts with `launchctl kickstart -k`.

## Health checks (run every deploy, unconditionally)

- `https://big-bertha.tail3f4961.ts.net:8443` -> expect HTTP 200
  (dashboard).
- `POST http://big-bertha:3211/ingest` with no auth -> expect HTTP 401
  (confirms the ingest endpoint is up and still enforcing its bearer
  check; a 200 here would mean auth is broken).

Either check failing is a hard failure -- the state file is NOT advanced,
so the next run's diff still includes whatever wasn't verified healthy.

## Log and state paths

- `~/.local/state/chronomaxi/fleet-deploy.log` -- deploy output. Only the
  husky-triggered async runs redirect into it; a manual run just prints
  to your terminal (pipe through `tee -a` yourself if you want both).
- `~/.local/state/chronomaxi/fleet-last-deployed-rev` -- last rev fully
  deployed and health-checked; only advanced on complete success.
- `/tmp/chronomaxi-fleet-deploy.lock` -- flock, serializes concurrent
  runs (a second commit landing mid-deploy waits rather than racing it).

## Background

Full script: `~/personal/chronomaxi/deploy/fleet-deploy.sh`. Machine
topology and ssh conventions: the `tailnet` skill. Session attribution for
any ssh call you make yourself: the `chronomaxi-attribution` skill.
