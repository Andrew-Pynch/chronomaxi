# chronomaxi session attribution

Tags every SSH session (interactive, agent-driven, and omp-tool-driven) with
who actually drove it, so the central Convex dashboard can split tracked
time into human hours versus per-agent hours instead of one undifferentiated
bucket. Two independent mechanisms, both repo-side deliverables in this
directory. The installers are live on Ron, Bertha, and Timmy as of 2026-07-12,
with per-host backups, actor checks, SSH config checks, and tmux parsing checks.

## Files

- `chronomaxi-attribution.zsh` -- zsh `precmd`/`preexec` hook library.
  Sourced from `~/.zshrc`. Sets the terminal's OSC2 window title on every
  prompt cycle to `cmx|actor=<a>|host=<h>|to=<t>|sid=<id8>`. Display-only,
  never makes a network call. Safe no-op outside zsh or on `TERM=dumb`.
- `chronomaxi-ssh-hook.sh` -- POSIX sh script invoked once per real `ssh(1)`
  connection via `ssh_config`'s `LocalCommand`. POSTs an `ssh-start` event to
  `$CHRONOMAXI_INGEST_URL/session-event`, then backgrounds a watcher that
  POSTs `ssh-end` once the ssh client process exits. Fail-open: never
  blocks, delays, or breaks the ssh connection itself.
- `install.sh` -- per-machine idempotent installer for both of the above,
  plus an env file and marker-guarded blocks in `~/.zshrc` / `~/.ssh/config`.
  Supports `--dry-run` and `--uninstall`.
- `install.test.sh` -- regression coverage for standalone and merged `Host *`
  layouts, idempotent refresh, valid `ssh -G` expansion, and uninstall.

## Mechanism 1: terminal title tags (interactive sessions only)

`chronomaxi-attribution.zsh` registers `precmd`/`preexec` hooks via
`add-zsh-hook`, placed in `.zshrc` after oh-my-zsh's own `source
$ZSH/oh-my-zsh.sh` line so ours writes the title last and wins. On every
prompt cycle it writes:

```
cmx|actor=<actor>|host=<hostname>|to=<target-or-dash>|sid=<8-lowercase-hex>
```

`to=` is populated only while an `ssh`/`mosh`/`autossh` command is actually
running (set in `preexec`, cleared again in the next `precmd`); the target
is a best-effort parse of the command line, cosmetic only -- the
authoritative target for the dashboard comes from `ssh_config`'s own `%h`/
`%n` resolution in mechanism 2, not this parse. `sid=` is regenerated on
every title write; when `preexec` detects an ssh invocation it is also
exported as `CMX_SSH_SID` immediately before the shell forks that command,
so the about-to-run `ssh(1)` child inherits it, and `chronomaxi-ssh-hook.sh`
reuses it verbatim as `sessionId` -- this is why the title's `sid=` and the
lifecycle event's `sessionId` are always the exact same 8-hex string for an
interactively-typed ssh, never a prefix relationship.

## Mechanism 2: lifecycle events (every session, including non-interactive)

A shell-function `ssh()` wrapper was the obvious first design and was
rejected: empirically, the omp `bash` tool does not source `.bashrc`/
`.zshrc` functions, so a wrapper only ever fires for a real interactive
shell and misses the dominant agent-driven pattern (`bash` tool calling
`ssh` directly) entirely. `ssh_config`'s `LocalCommand` fires inside the
real `ssh(1)` client process itself instead, which is the one hook point
every caller ultimately execs through: interactive shells, the `bash`
tool's raw `ssh ...` calls, and the dedicated omp `ssh` tool's first
connection per `ControlPersist` window.

`install.sh` adds this block, merged non-destructively into an existing
bare `Host *` block if one exists, else inserted as a new one at the very
top of `~/.ssh/config` (ssh_config keeps the first value seen per keyword
across all matching `Host` blocks, so ours must lead the file to apply
everywhere):

```
Host *
    PermitLocalCommand yes
    LocalCommand ~/.config/chronomaxi/chronomaxi-ssh-hook.sh %n %h %p %r %L
```

The hook resolves `actor` from its own inherited environment (see below),
POSTs an `ssh-start` event, then backgrounds a watcher that polls `kill -0
"$PPID"` (the ssh client process, since `LocalCommand` runs as its direct
child) every 5 seconds and POSTs `ssh-end` once it exits. This vantage
point cannot retrieve a real process exit code (only "process gone" is
observable, not a `wait()`-able status), so `exitCode` is left unset rather
than fabricated -- a documented gap, not a bug. All network calls run in
the background with a 2-second `curl` timeout; failures spool to
`/tmp/cmx-events.jsonl` and get replayed opportunistically on the next
connection, before that connection's own event is sent.

**Known gap:** the dedicated omp `ssh` tool multiplexes a persistent
`ControlPersist` connection per host via command-line `-o` flags, which
always win over file-based `ssh_config` directives. Only the first call in
a given persistence window fires `LocalCommand`; later calls to the same
host within that window produce no lifecycle event at all. No
config-level fix exists; closing it needs a harness change (native
lifecycle telemetry in the ssh tool, or an env-injection surface it
currently lacks).

## Actor resolution (identical rule in both mechanisms)

```
CMX_ACTOR_OVERRIDE set?        -> that value, verbatim
else OMPCODE set?              -> agent:<CMX_AGENT_NAME>, or agent:unknown if unset
else                           -> human
```

Resolved fresh from the environment on every single hook invocation, never
cached or exported as a static default anywhere. This is the one property
that must never break: a human's ordinary interactive shell is never a
descendant of the omp harness process tree, so `OMPCODE` is structurally
absent there, and `human` is the result whenever it is absent, full stop --
there is no code path that defaults an ambiguous state to an agent label.
Undercounting agent time (falling back to `agent:unknown`) is a far smaller
data-quality problem than ever mislabeling a human's hands-on-keyboard time
as agent time, so the design is deliberately asymmetric in that direction.

**Agent self-tagging convention:** any agent that wants individual
attribution rather than the `agent:unknown` bucket should pass
`env: {"CMX_AGENT_NAME": "<task-id-or-role>"}` on `bash` tool calls that
invoke `ssh`/`scp`/`rsync -e ssh`. This works with zero harness changes --
the `env` parameter is merged into the child process environment, which is
inherited transitively down through `ssh` into the `LocalCommand` hook.
Verified in this session: this very agent's own `bash` tool calls carry
`OMPCODE` visibly into spawned children.

## Threat model

This is self-hosted personal telemetry on Andrew's own three machines, not
a multi-tenant system with an adversarial trust boundary. The design treats
actor/target spoofing as a **data-quality risk, not a security boundary**:

- **Actor spoofing.** Any local process can set `CMX_AGENT_NAME`/`OMPCODE`
  and lie about being an agent, or a human could set
  `CMX_ACTOR_OVERRIDE=agent:x` to disguise their own session. Accepted.
  The one inviolable property is the reverse direction: **a human's
  ordinary interactive shell is never auto-labeled as an agent.** Nothing
  in either mechanism exports a static actor default into any rc file or
  caches a resolved value across shell invocations -- see actor resolution
  above.
- **Target spoofing.** `targetHost`/`targetHostAlias` come from
  `ssh_config`'s own `%h`/`%n` token expansion, not from parsing typed
  argv, so `ProxyJump`, wildcard `Host` blocks, and aliases resolve exactly
  as the real connection does and cannot be tricked by argument reordering.
- **Event forgery.** The ingest endpoint is reachable by anything with
  network access to the Convex host with the shared bearer token; there is
  no per-request client identity beyond that token. `sessionId` is a
  client-generated key used for upsert/patch, so at most an attacker with
  the token can inject bogus rows, not corrupt an unrelated live session.
  Accepted risk given all reachable hosts are Andrew's own.
- **Secrets handling.** `CHRONOMAXI_INGEST_SECRET` lives in
  `~/.config/chronomaxi/env` (mode 600, created by `install.sh`, never
  committed to git), read by the hook script via `.`-sourcing, never placed
  in argv (would leak via `ps`) and never logged.
- **Privacy.** Neither mechanism sends command-line text. The lifecycle
  event carries only host/actor/timing/session-id fields (no shell command,
  no remote command argument) specifically to avoid leaking secrets typed
  as `ssh host 'export TOKEN=...; run'`-style remote command arguments. The
  title grammar is similarly narrow: actor/host/target/session-id only, no
  command text, unlike oh-my-zsh's own default title support which embeds
  up to 100 chars of the typed command line.
- **Opt-out.** `CMX_SSH_TRACK_DISABLE=1` (one shell) or a standing sentinel
  file at `~/.config/chronomaxi/disable` (this host, until removed) silence
  both mechanisms identically. Checked fresh on every hook invocation, never
  cached at shell-start time -- a human quietly toggling the sentinel mid
  session takes effect on the very next prompt/connection, not the next
  login.

## Verification matrix

| Check | How | Failure mode being guarded against |
|---|---|---|
| Actor bucketing correctness | Real interactive `ssh host` -> `actor=human`. `bash` tool `ssh host 'true'` with no env override -> `actor=agent:unknown`. `bash` tool with `env:{CMX_AGENT_NAME:"probe"}` -> `actor=agent:probe`. | `actor=human` leaking from an agent-driven call is the critical failure; verified empirically in this session (see below). |
| `LocalCommand` fires on every real path | Interactive shell, `bash`-tool raw `ssh`, and the dedicated omp `ssh` tool's first call to a fresh host all trigger the hook. | If the omp `ssh` tool passes `-F <custom-config>`/`-F none`, `LocalCommand` silently never fires and the "universal hook" claim is false for that path. |
| `ControlMaster` reuse produces zero events, not duplicates or a hang | Call the dedicated omp `ssh` tool against the same host twice within the persistence window; expect one start/end pair then silence, never two pairs. | A second full pair means the multiplexing assumption is wrong; a hang means the backgrounded POST is blocking the connection (must never happen -- verified: hook returns in well under 100ms regardless of network state). |
| End event fires on abnormal termination | SIGHUP/Ctrl-C mid-session; watcher posts `ssh-end` within ~5-10s in both cases, never while the connection is merely idle-but-alive. | An orphaned start-with-no-end row that never closes; a server-side stale-session sweep is a recommended backstop regardless. |
| Opt-out suppresses both mechanisms immediately | Touch the sentinel, run a session, confirm no title change and no POST; remove it, confirm the very next session resumes tracking without a shell restart. | Caching the disable check once at shell/hook start rather than per-invocation. |
| Secret never leaks | `ps auxww \| grep chronomaxi-ssh-hook` during a live invocation shows no literal token in argv; token is read from a 600-mode file, not passed as `--token=...`. | Token visible via `ps` to any other local user on a shared host. |
| Reserved future fields round-trip cleanly | POST a v1 event (no `model`/`provider`/token fields) against the deployed schema; row inserts without those fields present. | Schema defining those fields as non-optional would break every v1 event until token ingestion ships. |

### What was actually verified in this wave (repo-side, no machine install)

- `chronomaxi-attribution.zsh`: syntax-checked with `zsh -n`; functionally
  exercised in a real interactive zsh (via `script` for a pty, since the
  harness shell has none) confirming `actor`/`to`/`sid` transitions for
  human/agent-unknown/agent-named/override/non-ssh/opt-out cases, and
  confirming `CMX_SSH_SID` is correctly inherited by a forked `ssh`-named
  child process before being cleared on the next prompt. This caught a
  real bug: zsh's `preexec` `$1` is only populated when the history
  mechanism is active (undocumented-by-default gotcha, confirmed against
  zsh's own `zshall(1)` FUNCTIONS section) -- fixed by reading `$3` (the
  full, always-populated, alias-expanded command text) instead.
- `chronomaxi-ssh-hook.sh`: shellcheck-clean under `sh`, `dash`, and
  `busybox` dialects. Functionally exercised against a fake `curl`+`ssh`
  harness covering: full start/end POST shape, `sessionId` correlation via
  `CMX_SSH_SID`, spool-on-failure + flush-on-next-connection, the opt-out
  sentinel and env var, and missing-config no-op. Also exercised end to end
  against ConvexFoundation's live local Convex stack (`bunx convex dev`),
  which caught a second real bug: `startedAt` is required on the `ssh-end`
  POST too (not just `ssh-start`), used as an out-of-order-delivery
  fallback -- both events now post cleanly with `applied:true`.
- `install.sh`: shellcheck-clean under `bash`. `--dry-run` demonstrated
  against the real machine `$HOME` (see below) with zero files touched.
  Additionally exercised for real (non-dry-run writes, entirely inside
  `/tmp` sandboxes, never the real machine) against three synthetic
  fixtures matching the three actual hosts' documented `~/.ssh/config`
  states: no `Host *` block at all (big-ron), an existing bare `Host *`
  block to merge into (lil-timmy), and no `~/.ssh/config` file at all
  (a from-scratch host) -- all three produced syntactically valid configs,
  confirmed with `ssh -G` against the generated files. Also verified
  idempotent re-run (no duplicate blocks) and `--uninstall` (clean
  reversal, installed script copies removed, env file intentionally left
  behind since it may hold a configured secret).

### `install.sh --dry-run` against the real machine, verbatim

```
$ ./deploy/attribution/install.sh --dry-run
[chronomaxi-install] target home: /home/andrew (dry-run: 1)
[chronomaxi-install] installing hook scripts to /home/andrew/.config/chronomaxi
DRY-RUN: mkdir -p /home/andrew/.config/chronomaxi
DRY-RUN: cp .../chronomaxi-attribution.zsh /home/andrew/.config/chronomaxi/chronomaxi-attribution.zsh
DRY-RUN: cp .../chronomaxi-ssh-hook.sh /home/andrew/.config/chronomaxi/chronomaxi-ssh-hook.sh
DRY-RUN: chmod +x /home/andrew/.config/chronomaxi/chronomaxi-ssh-hook.sh
[chronomaxi-install] creating env file at /home/andrew/.config/chronomaxi/env
DRY-RUN: write /home/andrew/.config/chronomaxi/env with:
  | CHRONOMAXI_INGEST_URL=http://big-bertha:3211
  | CHRONOMAXI_INGEST_SECRET=REPLACE_ME
[chronomaxi-install] adding chronomaxi source line to /home/andrew/.zshrc after the oh-my-zsh source line
DRY-RUN: cp -p '/home/andrew/.zshrc' '/home/andrew/.zshrc.pre-chronomaxi.<timestamp>.bak'
DRY-RUN: rewrite /home/andrew/.zshrc (diff vs current):
--- /home/andrew/.zshrc
+++ /dev/fd/63
@@ -77,6 +77,9 @@
 source $ZSH/oh-my-zsh.sh
+# >>> chronomaxi-attribution >>>
+source "/home/andrew/.config/chronomaxi/chronomaxi-attribution.zsh"
+# <<< chronomaxi-attribution <<<

[chronomaxi-install] no bare 'Host *' block in /home/andrew/.ssh/config, inserting
a new one at the top (first-match-wins in ssh_config, so this must lead the file
to apply to every host)
DRY-RUN: cp -p '/home/andrew/.ssh/config' '/home/andrew/.ssh/config.pre-chronomaxi.<timestamp>.bak'
DRY-RUN: rewrite /home/andrew/.ssh/config (diff vs current):
--- /home/andrew/.ssh/config
+++ /dev/fd/63
@@ -1,3 +1,9 @@
+# >>> chronomaxi-ssh-attribution >>>
+Host *
+    PermitLocalCommand yes
+    LocalCommand /home/andrew/.config/chronomaxi/chronomaxi-ssh-hook.sh %n %h %p %r %L
+# <<< chronomaxi-ssh-attribution <<<

 Host big-bertha
     RemoteForward 18339 127.0.0.1:18339
[chronomaxi-install] done. Open a new shell (or 'exec zsh') to pick up the title hook.
[chronomaxi-install] Edit /home/andrew/.config/chronomaxi/env and set CHRONOMAXI_INGEST_SECRET before lifecycle events will send.
```

Confirmed after the dry run: `/home/andrew/.config/chronomaxi` was not
created, no `.bak` files exist, and neither `.zshrc` nor `.ssh/config` was
modified. This dry-run also independently confirms the two empirical
findings the design was originally grounded on: big-ron's real
`~/.ssh/config` genuinely has no bare `Host *` block yet, and its real
`~/.zshrc` genuinely has the oh-my-zsh source line the installer anchors
on.

## Environment variables

| Var | Where | Purpose |
|---|---|---|
| `CHRONOMAXI_INGEST_URL` | `~/.config/chronomaxi/env` | Base URL of the Convex site origin, e.g. `http://big-bertha:3211`. The hook POSTs to `$CHRONOMAXI_INGEST_URL/session-event`. |
| `CHRONOMAXI_INGEST_SECRET` | `~/.config/chronomaxi/env` | Bearer token for the ingest endpoint. Mode 600, never committed. |
| `CMX_AGENT_NAME` | per-call, e.g. `bash` tool `env` param | Names an agent for individual attribution; combined with `OMPCODE` presence to form `agent:<name>`. |
| `CMX_ACTOR_OVERRIDE` | ad hoc | Wins over everything else; escape hatch, not meant for rc-file defaults. |
| `CMX_SSH_TRACK_DISABLE` | one shell | Opt out of both mechanisms for that shell only. |
| `~/.config/chronomaxi/disable` | sentinel file | Opt out of both mechanisms on this host until removed. |
| `CMX_SSH_SID` | internal, exported by the zsh preexec hook | Correlates a title's `sid=` with the matching lifecycle event's `sessionId`. Not meant to be set by hand. |
| `CHRONOMAXI_HOME` | override | Defaults to `~/.config/chronomaxi`; both scripts and `install.sh` honor an override (used for the sandboxed tests above). |
