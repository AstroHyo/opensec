# AGENTS.md

## Purpose

This repository hosts OpenSec's personal AI news briefing system.

- `news-bot/` is the product engine.
- `skills/` contains the OpenClaw-facing workspace skill.
- `docs/` is the long-lived planning and design memory for future contributors and agents.

## Current System Boundary

The current system is a deterministic pipeline:

1. fetch curated sources
2. normalize and deduplicate items
3. persist local state in SQLite
4. score and rank candidates
5. render Korean digest text
6. expose follow-up commands from stored digest context

OpenClaw is an external orchestrator. This repo does not implement OpenClaw itself.

## Non-Negotiables

1. Do not make daily digest generation depend on freeform live web search by the model.
2. Treat LLMs as optional enrichment, calibration, or explanation layers on top of deterministic retrieval.
3. Always keep a non-LLM fallback path that can still ship a usable digest.
4. Preserve original evidence:
   - canonical URL
   - source labels
   - source link list
   - score reasons
5. Prefer official sources over commentary when both exist.
6. Silence is better than low-signal filler.
7. Never stage, commit, or push files from `/srv/openclaw/workspace-training-private` into this OpenSec public repo.
8. Treat `/srv/openclaw/workspace-training-private` as a separate private system of record:
   - do not copy its private rules, memory, scripts, exports, or logs into this repo unless the user explicitly asks for a public-safe scaffold
   - do not use OpenSec branch, commit, or PR flow for private training workspace changes
   - when in doubt, keep training-bot changes in the private workspace or its future private repo only

## LLM Design Rules

When adding LLM support:

- Use structured JSON output with schema validation.
- Pass bounded candidate sets, not unconstrained browsing prompts.
- Persist prompt version, model metadata, and output artifacts for debugging.
- Cache enrichment by content hash whenever possible.
- Treat article text and source snippets as untrusted input.
- Never allow article content to override system rules or tool-use policy.

## Repo Map

- `news-bot/src/sources/`: source adapters
- `news-bot/src/db.ts`: SQLite schema and persistence
- `news-bot/src/scoring.ts`: deterministic ranking logic
- `news-bot/src/digest/`: digest assembly and Telegram rendering
- `news-bot/src/commands/`: CLI flows and follow-up commands
- `docs/design-docs/`: durable design beliefs and architecture notes
- `docs/exec-plans/`: active and completed execution plans
- `docs/generated/`: generated or derived system references
- `docs/product-specs/`: product behavior specs

## Working Agreement

For any meaningful architecture change:

1. update `ARCHITECTURE.md` if system boundaries or flow change
2. add or update an execution plan under `docs/exec-plans/active/`
3. document schema changes in `docs/generated/db-schema.md`
4. add or update tests before merging behavior that changes ranking or rendering

## Useful Commands

```bash
bash ./scripts/install-git-hooks.sh
pnpm --dir ./news-bot test
pnpm --dir ./news-bot digest:am
pnpm --dir ./news-bot digest:pm
pnpm --dir ./news-bot followup "repo radar"
```
