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
