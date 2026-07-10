---
title: Wiki Schema
type: schema
---

# chronomaxi wiki: schema

This wiki follows Andrej Karpathy's LLM Wiki pattern: a persistent, agent-maintained
knowledge base that sits between raw sources and your questions, so synthesis compounds
instead of being re-derived every session. Primary source (read before deviating from
these rules): https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f

This file is the schema layer described there. It is mechanical, written for agents, not
for humans. Follow it exactly.

## Directory layout

```
wiki/
  SCHEMA.md   <- this file. Rules only. You do not write to it unless the user asks you to
              evolve the schema itself.
  INDEX.md    <- content-oriented catalog. Every page listed with a link and a one-line
              summary. Read this first when answering a query.
  LOG.md      <- chronological, append-only. One line per operation.
  raw/        <- immutable source captures. Write once, never edit again.
  pages/      <- synthesis. You own this directory entirely.
  assets/     <- images, screenshots, standalone HTML exhibits referenced by pages/.
```

## raw/ (immutable)

- Anything you capture verbatim from a primary source: command output, file snapshots,
  screenshots, transcripts, external article text.
- Write once. Never edit a raw/ file after creation. If a source changes, capture a new
  raw/ file with a new timestamp, do not overwrite the old one.
- Filename: `YYYY-MM-DD-slug.md` (or the natural extension for non-markdown captures, e.g.
  `.png`, `.html`, placed in assets/ instead if it's binary/rendered output rather than
  text).
- Frontmatter:
  ```yaml
  ---
  title: <short description>
  date: YYYY-MM-DD
  type: raw
  source: <command, URL, file path, or tool that produced this>
  ---
  ```

## pages/ (synthesis, agent-owned)

- Everything here is written and maintained by agents. Humans read it; agents write it.
- Two kinds of pages:
  - **Dated/event pages**: `YYYY-MM-DD-slug.md` — a specific event, investigation, or
    time-boxed piece of work (e.g. `2026-07-09-ui-overhaul.md`).
  - **Entity/concept pages**: `kebab-case.md`, no date — a durable topic that gets updated
    in place as new information arrives (e.g. `architecture.md`, `tracker.md`).
- Frontmatter:
  ```yaml
  ---
  title: <short description>
  date: YYYY-MM-DD          # date created (event pages) or last major revision
  type: event | entity | concept | comparison
  sources: [raw/2026-07-09-example.md, ...]   # raw/ files this page cites, if any
  ---
  ```
- **Citation convention**: any claim traceable to a raw/ capture MUST link it with a
  relative path, e.g. `see [raw/2026-07-09-old-app-capture.md](../raw/2026-07-09-old-app-capture.md)`.
  Claims traceable to live repo code cite the file path directly, e.g.
  `tracker/src/logger_v4.rs`. Do not cite from memory, cite what you actually read.
- When new information updates an existing entity/concept page, edit it in place and note
  the change in LOG.md; do not fork a second page for the same topic.

## assets/ (binary/rendered exhibits)

- Screenshots, generated images, and standalone HTML files (e.g. a before/after comparison
  artifact) that a pages/ file embeds or links to.
- Immutable once written, same as raw/, unless it is itself the output of a page you are
  actively iterating on.

## INDEX.md duty

- Every new or renamed page in pages/ MUST get an entry in INDEX.md: link + one-line
  summary, filed under the right section (Architecture, Events, Entities, Concepts...).
  Add a new section heading if none fits.
- Update INDEX.md in the same turn you create or rename a page. A page not in INDEX.md is
  effectively invisible to future agents.

## LOG.md duty

- Append one line per operation, never edit past entries. Format:
  `## [YYYY-MM-DD] <op> | <title>` followed by 1-3 lines of detail, where `<op>` is one of
  `bootstrap`, `ingest`, `query`, `lint`.
- This keeps LOG.md greppable: `grep '^## \[' wiki/LOG.md | tail -5` gives the last 5
  operations.

## Multi-agent coordination

- If more than one agent is writing to this wiki concurrently, each page/raw file has one
  owning agent for that session. Coordinate ownership out of band (chat/IRC) before editing
  a file another agent is actively writing. INDEX.md and LOG.md are shared, append
  carefully or ask the file's session owner to append on your behalf.

## Style

- No emojis. No em dashes (use commas or periods). Keep prose short and mechanical, this is
  an instruction file and a reference layer for LLMs, not a blog.
