# ARCHITECTURE.md

## System Summary

OpenSec is a Telegram-first personal AI news briefing system with a deterministic local core.

This repository also provides workspace scaffolding and skills so OpenClaw can handle private Telegram DM coding and repo tasks around the news system.

Today, the product works without any LLM dependency:

- curated source fetch
- normalization and dedupe
- SQLite-backed state
- explicit rule-based ranking
- digest assembly
- Telegram-ready rendering

OpenClaw is used as an external orchestration layer for cron execution, Telegram routing, and skill-based `exec`.

## Current Component Layout

```text
Sources
  -> source adapters
  -> source-layer classification (primary / precision / early-warning)
  -> normalization + canonicalization
  -> dedupe + merge
  -> signal matching
  -> SQLite state
  -> deterministic scoring
  -> digest builder
  -> Telegram renderer
  -> OpenClaw / shell delivery
```

## Primary Components

### Source Adapters

- OpenAI official RSS
- GitHub Trending HTML parsing
- GeekNews RSS + topic-page original-link extraction
- Techmeme homepage cluster parsing
- Hacker News Firebase API
- Bluesky watchlist signal ingestion

### Processing Layer

- URL canonicalization
- normalized title hashing
- fuzzy title similarity fallback
- metadata merge across sources

### State Layer

SQLite stores:

- raw source fetches
- normalized items
- digest history
- resend state
- follow-up context
- source run history

### Decision Layer

The current ranking system combines:

- source authority
- freshness
- precision-layer boosts
- early-warning boosts
- user-interest keyword matches
- methodology signal
- repo traction
- cross-signal boosts
- resend suppression

### Output Layer

- AM digest
- PM digest
- stored-context follow-up commands
- Telegram-safe rendering

## Why This Architecture Exists

This project is intentionally not a "model goes browsing" bot.

The deterministic core gives us:

- reproducibility
- debuggability
- safe fallbacks
- explicit prioritization logic
- durable context for follow-up commands

## Planned LLM Extension Points

LLM usage should be added in layers, in this order:

1. item-level summary enrichment
2. theme synthesis across selected items
3. richer follow-up answers from stored evidence
4. optional rerank calibration on a bounded candidate set
5. explicit post-digest research mode with bounded live search when the user asks for it

These layers must remain downstream of deterministic fetch and candidate generation.

## Planned Follow-up Modes

The future Telegram follow-up UX should separate:

- deterministic follow-up over stored digest context
- bounded LLM explanation over stored digest context
- explicit opt-in live research after the digest has already been generated

The daily digest itself should remain deterministic even if research mode is later added.

## Target Future Architecture

```text
Sources
  -> primary + precision fetch
  -> normalize + dedupe + merge
  -> early-warning signal fetch
  -> signal-to-story match
  -> deterministic score
  -> shortlist candidates
  -> LLM item enrichment
  -> final digest assembly
  -> LLM theme synthesis
  -> render + persist
```

## Boundaries To Keep

- Do not let the model decide what sources to crawl.
- Do not let the model silently replace stored metadata.
- Do not let follow-up answers ignore stored source links.
- Do not let early-warning social signals create standalone digest items.
- Do not let enrichment failure block digest delivery.

## Main Documents

- `AGENTS.md`
- `docs/design-docs/core-beliefs.md`
- `docs/design-docs/openclaw-personal-control-plane.md`
- `docs/exec-plans/active/2026-04-02-llm-curation-upgrade.md`
- `docs/generated/db-schema.md`
