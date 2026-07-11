# Agent notes

This repo has an LLM wiki at `wiki/` (Karpathy-style: raw sources are immutable,
synthesis pages cite them, `wiki/SCHEMA.md` is the write-rules file for agents).

Read `wiki/SCHEMA.md` before writing to the wiki. Start at `wiki/INDEX.md` to see
what exists, `wiki/LOG.md` for recent history.

Search it with `qmd search <query> -c chronomaxi` (qmd collection `chronomaxi` is
registered at `wiki/`, not repo root). Never edit files under `wiki/raw/` once written.

## Fleet deploy

Landing a commit on `main` auto-pushes to origin and fleet-deploys via
`.husky/post-commit` (async, never blocks the commit) -- see
`deploy/fleet-deploy.sh` for the ordering guarantee (Convex backend before
trackers). For intermediate/WIP commits on `main` you don't want deployed
yet, use `HUSKY=0 git commit ...` (skips all husky hooks) or
`CHRONOMAXI_NO_DEPLOY=1 git commit ...` (skips just the deploy). Manual
deploy: `deploy/fleet-deploy.sh` (add `CHRONOMAXI_DRY_RUN=1` to preview).
Log: `~/.local/state/chronomaxi/fleet-deploy.log`.
