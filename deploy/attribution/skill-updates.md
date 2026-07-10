# Proposed skill updates for chronomaxi session attribution

Diffs below are proposed, not applied. Target file is outside
`~/personal/chronomaxi` (`/home/andrew/.agents/skills/tailnet/SKILL.md`),
which this wave does not edit -- gated on the user go/strike board per the
orchestrator constraints. Diffs are against the file as it stood at
`2026-07-10 00:52 UTC` (121 lines, "Updated 2026-07-09" header).

One factual correction made while drafting this: the original assignment
described big-bertha as "Arch, GNOME X11" -- that is big-ron's profile, not
big-bertha's. Direct SSH verification (`cat /etc/os-release`, `loginctl`,
`docker`, `tailscale ip`) confirmed big-bertha is Ubuntu 24.04.4 LTS with an
active local GNOME-on-X11 seat (gdm3 + Xorg on tty2/vt2, per a second
independent check), docker present, Tailscale IP `100.100.118.109`. The
existing tailnet skill row already had the OS right (`Ubuntu 24.04`) but
listed it as headless -- it is not; it has an active local seat, which
matters because the chronomaxi tracker's X11 capture backend depends on one
existing for full input-count telemetry (keystrokes/clicks), not just
window/program/category time.

## Diff 1: big-bertha row (line 18)

```diff
--- a/tailnet/SKILL.md
+++ b/tailnet/SKILL.md
@@ -15,7 +15,7 @@
 | Host | OS / role | Local user | Notes |
 |---|---|---|---|
 | `big-ron` | Arch, primary workstation (RTX 4090) | `andrew` | 99% of omp sessions run HERE. Wayland (`wl-copy`/`wl-paste`). |
-| `big-bertha` | Ubuntu 24.04, always-on server (old tower) | `andrew` | Hosts hermes, project-atlas, starcube-nucleus, DBs. Runbook below. |
+| `big-bertha` | Ubuntu 24.04.4 LTS, GNOME on X11 (active local seat, gdm3 + Xorg vt2), RTX 3080, docker host | `andrew` | Central chronomaxi/Convex host (100.100.118.109). Also hosts hermes, project-atlas, starcube-nucleus, DBs. Runbook below. |
 | `lil-timmy` | macOS laptop (Apple Silicon) | `andrewpynch` | Andrew drives big-ron from it (couch/travel). Often ASLEEP — SSH timeout usually means sleeping, not broken. |
 | `andrew-iphone` | iOS | — | No SSH. Joins omp sessions via `/collab` web link; receives pushes via `phone-link`. |
```

## Diff 2: new "Session attribution" section

Inserted after the `## SSH` section (currently ends line 45) and before
`## Cross-machine helpers` (currently starts line 47), so it sits next to
the other SSH-adjacent content.

```diff
--- a/tailnet/SKILL.md
+++ b/tailnet/SKILL.md
@@ -45,6 +45,29 @@
   Andrew the exact command instead.
 
+## Session attribution (chronomaxi)
+
+- Every host's zsh gets `chronomaxi-attribution.zsh` sourced from `.zshrc`
+  (after the oh-my-zsh source line, so it wins the final title write). It
+  sets the OSC2 window title on every precmd/preexec:
+  `cmx|actor=<actor>|host=<hostname>|to=<target-or-dash>|sid=<8lowercasehex>`,
+  pipe-delimited, no other fields. Safe no-op outside zsh or on `TERM=dumb`.
+- `actor` is resolved FRESH on every hook call from the CURRENT shell's own
+  env, never cached: `CMX_ACTOR_OVERRIDE` wins if set, else
+  `agent:<CMX_AGENT_NAME>` (or `agent:unknown`) if `OMPCODE` is set, else
+  `human`. A human's interactive shell is never a descendant of the omp
+  harness process tree, so `OMPCODE` is structurally absent there -- this
+  property must hold; never export a static actor default in any rc file.
+- **`CMX_AGENT_NAME` convention**: any agent (this one included) that wants
+  individual attribution on an `ssh`/`scp`/`rsync -e ssh` call it makes via
+  the `bash` tool should pass `env: {"CMX_AGENT_NAME": "<task-id-or-role>"}`
+  on that call. The var is inherited transitively through the spawned `ssh`
+  into `~/.config/chronomaxi/chronomaxi-ssh-hook.sh`'s `LocalCommand` hook --
+  no harness change needed. Omitting it buckets the connection as
+  `agent:unknown` rather than a specific name (never as `human`).
+- Lifecycle events (`ssh-start`/`ssh-end`) POST to
+  `$CHRONOMAXI_INGEST_URL/session-event` via an `ssh_config` `Host *`
+  `LocalCommand` hook, not a shell wrapper -- verified that a shell-function
+  `ssh()` override never fires for omp `bash`-tool-driven `ssh` calls, so
+  `LocalCommand` is the one hook point common to interactive shells, the
+  `bash` tool, and the dedicated omp `ssh` tool's first call per host.
+- Known gap: the dedicated omp `ssh` tool multiplexes a `ControlPersist`
+  connection per host; only the FIRST call in a given persistence window
+  fires `LocalCommand` (start+end), later calls to the same host in that
+  window produce no lifecycle event. No config-level fix; see
+  `~/personal/chronomaxi/deploy/attribution/README.md` for the full threat
+  model and verification matrix.
+- Env vars: `CHRONOMAXI_INGEST_URL`, `CHRONOMAXI_INGEST_SECRET` (bearer
+  token, in `~/.config/chronomaxi/env`, never committed), `CMX_AGENT_NAME`,
+  `CMX_ACTOR_OVERRIDE`, `CMX_SSH_TRACK_DISABLE=1` (opt out for one shell), or
+  touch `~/.config/chronomaxi/disable` (opt out on this host until removed).
+- Source: `~/personal/chronomaxi/deploy/attribution/` (installer, hook
+  scripts, and their own README live there; nothing is installed on any
+  machine until Andrew runs `install.sh` himself).
+
 ## Cross-machine helpers (`~/.local/bin` on all 3 machines)
 
 Source of truth: `Linux-Setup-Scripts/scripts/` (GitHub). On remotes the
```

## Diff 3: frontmatter description addition (line 3-8)

Small addition so the skill surfaces when session-attribution work is in
scope, without rewriting the existing description.

```diff
--- a/tailnet/SKILL.md
+++ b/tailnet/SKILL.md
@@ -3,7 +3,8 @@
 description: >-
   Andrew's machine topology — hosts, roles, SSH auth directionality,
   cross-machine helper scripts (tmux-run, tnet-cp, phone-link), big-bertha
-  service runbook, clipboard bridging, and remote-access gotchas. Read before
-  any cross-machine work: SSH, file transfer, remote sessions, driving another
-  box, phone/collab flows, or debugging "works locally, fails over SSH".
+  service runbook, clipboard bridging, chronomaxi session attribution (the
+  cmx| title tag grammar and CMX_AGENT_NAME convention), and remote-access
+  gotchas. Read before any cross-machine work: SSH, file transfer, remote
+  sessions, driving another box, phone/collab flows, tagging an agent-driven
+  ssh call for attribution, or debugging "works locally, fails over SSH".
 ---
```

## New skill draft: `chronomaxi-attribution`

Proposed as a small, focused skill (not applied) at
`/home/andrew/.agents/skills/chronomaxi-attribution/SKILL.md`, separate from
`tailnet` because its audience is narrower (any agent about to run `ssh`,
not general cross-machine topology) and it needs to be found by a more
specific trigger phrase than "cross-machine work". `tailnet`'s new Session
attribution section above cross-references this skill; this skill
cross-references `tailnet` for the underlying topology.

```markdown
---
name: chronomaxi-attribution
description: >-
  Tag your own ssh/scp/rsync calls for chronomaxi session attribution so
  they show up as your specific agent name in the dashboard instead of an
  undifferentiated "agent:unknown" bucket. Use whenever you are about to run
  ssh, scp, or rsync -e ssh via the bash tool against big-ron, big-bertha,
  or lil-timmy.
---

# chronomaxi session attribution for agents

chronomaxi (the time-tracking system on these machines) buckets every ssh
connection by actor: `human`, `agent:unknown`, or `agent:<name>`. Without
action from you, an ssh call you make through the `bash` tool is
attributed as `agent:unknown` -- correctly bucketed as agent time, but not
attributed to you specifically.

## What to do

Pass `CMX_AGENT_NAME` in the `bash` tool's `env` parameter on any call that
invokes `ssh`, `scp`, or `rsync -e ssh`:

    bash(command: "ssh big-bertha 'systemctl status hermes'",
         env: {"CMX_AGENT_NAME": "YourTaskIdOrRole"})

Use a short, stable identifier -- your task id, role, or subagent name is
ideal. This requires no harness changes: the `env` parameter merges into
the spawned process's environment, which ssh inherits into
`chronomaxi-ssh-hook.sh`'s `LocalCommand` invocation automatically.

## What NOT to do

- Do not set `CMX_ACTOR_OVERRIDE` to `human` or anything else meant to
  disguise agent-driven activity as human activity. The one property
  chronomaxi's attribution design treats as inviolable is that a human's
  own interactive shell is never mislabeled as an agent; the converse
  (an agent mislabeling itself as human) is exactly the failure mode this
  guidance exists to prevent AGENTS from causing.
- Do not export `CMX_AGENT_NAME` globally or persist it anywhere that would
  leak into an unrelated later shell (there is no mechanism for this today
  since `env` is per-call, but if one is ever added, it must stay scoped to
  the calls that actually invoke ssh).
- The dedicated omp `ssh` tool and `ssh://` URI resolution (used by
  read/write/grep) have no `env` parameter today, so calls through them
  always resolve to `agent:unknown` regardless of this convention -- a known
  harness limitation, not something fixable from an agent's side. Prefer
  the `bash` tool with `env` set when individual attribution matters for a
  specific ssh call.

## Background

Full design, threat model, and verification matrix:
`~/personal/chronomaxi/deploy/attribution/README.md`. Machine topology and
general cross-host workflow: the `tailnet` skill.
```
