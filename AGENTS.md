# Agent notes

This repo has an LLM wiki at `wiki/` (Karpathy-style: raw sources are immutable,
synthesis pages cite them, `wiki/SCHEMA.md` is the write-rules file for agents).

Read `wiki/SCHEMA.md` before writing to the wiki. Start at `wiki/INDEX.md` to see
what exists, `wiki/LOG.md` for recent history.

Search it with `qmd search <query> -c chronomaxi` (qmd collection `chronomaxi` is
registered at `wiki/`, not repo root). Never edit files under `wiki/raw/` once written.

## Fleet deploy

Chronomaxi deploys only when explicitly requested. From the canonical package,
run `CHRONOMAXI_DRY_RUN=1 bun run deploy:fleet` to preview or
`bun run deploy:fleet` to publish the public subtree mirror and update the
fleet. The script preserves the load-bearing order: Convex backend and
frontend before tracker restarts. Successful revisions are recorded in
`~/.local/state/chronomaxi/fleet-last-deployed-rev`.
