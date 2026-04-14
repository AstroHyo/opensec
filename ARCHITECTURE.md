# ARCHITECTURE.md

## System Summary

OpenSec is now a Discord-first personal control plane with a deterministic multi-profile news engine at its core.

This repository has two layers:

1. `news-bot/`
   - deterministic retrieval
   - normalization and dedupe
   - SQLite-backed local state
   - profile-aware scoring and digest assembly
   - stored-context follow-up
2. OpenClaw workspace assets
   - Discord-first workspace bootstrap
   - coordinator tone and operating rules
   - skills for news, coding, repo work, and system work
   - approval and escalation policy

OpenClaw is still an external orchestrator. This repo does not implement OpenClaw itself.

## Core Boundaries

The deterministic boundary remains unchanged:

- daily digest generation must not depend on freeform live web search
- LLMs are optional explanation, enrichment, or explicit research layers
- original evidence must remain attached to every digest-visible item
- non-LLM fallback must remain usable

The control-plane boundary is now broader:

- Discord is the primary front door
- Telegram may remain as a fallback or legacy channel
- one visible coordinator is preferred over many visible bots
- specialist work should happen through delegation, threads, or hidden subagents

## Component Layout

```text
Sources
  -> source adapters
  -> source-layer classification (primary / precision / early-warning)
  -> normalization + canonicalization
  -> dedupe + merge
  -> signal matching
  -> SQLite state
  -> profile-aware deterministic scoring
  -> recent 72h suppression gate
  -> candidate shortlist
  -> bounded article / repo full-read
  -> task-tiered structured insight enrichment
  -> bounded rerank delta
  -> digest builder
  -> Telegram-oriented renderer
  -> OpenClaw / shell delivery
```

## Tech Brief Insight Pipeline

The `tech` profile no longer treats LLMs as one-line summary writers.

The current intended flow is:

1. deterministic retrieval and ranking
2. strong recent 72h suppression before section assembly
3. bounded shortlist selection
4. article or repo context extraction for only the shortlisted items
5. structured insight enrichment with schema validation
6. bounded rerank delta using novelty, insight, and evidence depth
7. Telegram rendering with perspective-specific fields
8. follow-up answers from saved article context plus saved enrichment

Rules:

- deterministic ranking remains the primary gate
- recent sent-item suppression is DB-first, not renderer-first
- LLMs never free-search for daily digest candidates
- article text is treated as untrusted input
- extraction failure degrades to snippet-based fallback instead of failing the digest
- the main brief should be fewer and deeper rather than longer and flatter

### Recent suppression layer

The digest now enforces a strong 72-hour visibility window before final section assembly.

Hard-block matches include:

- same canonical story identity
- same repo identity
- same official OpenAI page
- high-similarity title cluster

Resend override is intentionally narrow:

- only materially updated official OpenAI items may surface inside 72 hours
- the override reason is stored in `sent_items`

### Task-tiered LLM routing

LLM calls now route through a central task router rather than choosing models ad hoc at each call site.

Default mapping:

- Tier 0:
  - deterministic only
- Tier 1:
  - `xai:grok-4-1-fast-reasoning`
  - item enrichment
  - AM theme synthesis
  - short follow-up answers
- Tier 2:
  - `openai:gpt-4.1`
  - PM theme synthesis
  - multi-item synthesis
- Tier 3:
  - `openai:gpt-5.4-mini`
  - explicit research only

The router also applies:

- provider key availability checks
- per-tier timeouts
- max allowed tier limits
- optional daily budget controls
- provider/tier/cost telemetry in `llm_runs`

### Evidence layer

The digest now persists a reusable evidence layer in `article_contexts`.

This layer stores:

- canonical URL
- fetch status
- headline and dek
- publisher and author when available
- cleaned article or README text
- extracted key sections
- evidence snippets
- word-count depth

Purpose:

- let the model reason over more than `title + snippet`
- improve `expand N` without refetching
- support cacheable enrichment keyed by prompt version and source hash

### Insight schema

The tech brief now prefers a structured insight schema over generic summary fields.

Primary fields:

- `whatChanged`
- `engineerRelevance`
- `aiEcosystem`
- `openAiAngle`
- `trendSignal`
- `causeEffect`
- `watchpoints`
- `evidenceSpans`

`summary` and `whyImportant` still exist as compatibility fields, but they are no longer the editorial center of the digest.

## Housing Watcher

The Xiaohongshu housing watcher is a separate subsystem from the daily digest engine.

It follows this shape:

- broad Xiaohongshu query harvest
- persistent browser session reuse
- deterministic hard reject filters
- optional OCR / LLM adjudication on bounded candidates
- SQLite-backed watcher state
- direct Discord DM delivery

Rules:

- it must not change digest ranking or digest source selection
- it may use LLMs only on bounded post batches after deterministic filtering
- it must preserve original note URLs, query provenance, and decision reasons
- it should degrade to rules-only behavior if LLM or vision steps fail

## Profiles

The news engine is now profile-driven.

Initial profiles:

- `tech`
- `finance`

### Shared global evidence namespace

These stay global because they represent raw or canonical evidence:

- `raw_items`
- `normalized_items`
- `item_sources`
- `article_contexts`
- `signal_events`
- `signal_event_matches`

### Profile-scoped persisted context namespace

These are profile-aware because ranking, rendering, resend suppression, and follow-up context differ by audience:

- `digests`
- `followup_context`
- `sent_items`
- `source_runs`
- `llm_runs`
- `item_enrichments`
- `digest_enrichments`

Effectively, the same normalized story can appear in both `tech` and `finance` while keeping:

- different ranking
- different score reasons
- different `why important`
- different item numbers
- different follow-up context

## Source Model

### Primary sources

- OpenAI official RSS
- GitHub Trending
- Federal Reserve press
- SEC press
- Treasury press
- BLS release pages
- major-company SEC filings

### Precision sources

- GeekNews
- Techmeme
- Hacker News

### Early-warning sources

- Bluesky watchlist signals

Rules:

- precision sources may introduce or strengthen digest candidates
- early-warning sources may only boost or annotate existing candidates
- early-warning sources may never create standalone digest items

## Scoring Layer

Scoring stays deterministic and profile-aware.

Inputs include:

- source authority
- freshness
- keyword and methodology matches
- repo traction where relevant
- precision-layer boosts
- early-warning boosts
- resend suppression

Profile-specific logic:

- `tech` favors OpenAI, tooling, repos, and developer workflow
- `finance` favors macro, policy, regulation, and major-company signals

## Planned Reliability and Cost Layer

The next planned iteration adds two pipeline-level controls:

### 1. Strong recent-item suppression

The current resend logic is score-aware but still too soft for a personal operator brief.

Planned direction:

- move from mostly score-penalty-based repeat handling to a stronger 72-hour suppression gate
- apply suppression before final section assembly, not at render time
- treat cross-source sightings of the same canonical story or repo as one recent item
- allow resend only for materially updated high-value items such as official OpenAI updates

This keeps the brief focused on new information rather than rediscovering the same item through a different feed path.

### 2. Tiered model routing

LLM use should be selected by task difficulty, not by call-site convenience.

Planned direction:

- Tier 0: deterministic only
- Tier 1: small reasoning model for bounded per-item enrichment and short follow-ups
- Tier 2: stronger synthesis model for multi-item daily themes
- Tier 3: deep model only for explicit research or long-form operator asks

The scheduled digest path should stay on Tier 1 and Tier 2 only.
Tier 3 is reserved for explicit opt-in research paths.

## Follow-up Modes

The digest pipeline stays deterministic. Follow-up is layered on top:

- deterministic commands over stored context
- `ask` over stored context with optional LLM explanation
- `research` as explicit opt-in live search starting from stored context

`research` must not change how the daily digest is built.

## Discord Control Plane

OpenClaw is now expected to run with:

- one visible coordinator
- hidden builder and researcher specialist behavior
- private Discord guild
- channel-based work lanes
- DM-only approvals for risky actions

Recommended lanes:

- `#assistant`
- `#tech-brief`
- `#finance-brief`
- `#research`
- `#coding`

Important pattern:

- channel context is shared workspace context
- private durable memory should not be auto-injected into guild channels
- long-running work should prefer thread-bound sessions

## Workspace Bootstrap

Bootstrap files now have stricter separation:

- `SOUL.md`: tone and personality
- `AGENTS.md`: routing, escalation, delegation, and channel rules
- `TOOLS.md`: action levels and safety rules
- `USER.md`: stable owner preferences
- `MEMORY.md`: curated durable memory only
- `memory/YYYY-MM-DD.md`: raw notes
- `HEARTBEAT.md`: heartbeat-only behavior

## Private Specialist Workspaces

When a specialist agent needs a non-public personality, private operating rules, or owner-specific data, use a workspace outside the OpenSec repo.

Pattern:

- public repo contains only a safe scaffold and bootstrap
- private workspace contains the real `SOUL.md`, `AGENTS.md`, `MEMORY.md`, `HEARTBEAT.md`, and private skills
- secrets and private data stay in the private workspace only
- the private workspace must not be copied into `workspace-template/`

This pattern is appropriate for agents such as a private training or nutrition assistant whose behavior and memory should not be shared in git.

## Memory Loop

Discord conversation memory should use a two-stage loop:

1. capture meaningful context into `memory/YYYY-MM-DD.md`
2. distill only stable facts into `MEMORY.md`

Rules:

- not every chat turn becomes memory
- daily notes are the raw capture layer
- `MEMORY.md` is the curated durable layer
- heartbeat may suggest promotion candidates
- heartbeat must not silently promote memory

## Heartbeat Policy

Heartbeat is intentionally off by default.

It should only be enabled after:

- digest delivery is stable for both profiles
- wrong-channel replies are zero
- escalation misroutes are zero
- DM approvals have been exercised successfully
- routing and bootstrap rules have settled down

When enabled, heartbeat must stay low-noise and non-mutating.

## Boundaries To Keep

- Do not let the model decide what sources to crawl.
- Do not let the model silently replace stored metadata.
- Do not let follow-up answers ignore stored source links.
- Do not let early-warning social signals create standalone digest items.
- Do not let enrichment failure block digest delivery.
- Do not let Discord convenience collapse safety rules around approvals, self-editing, or private memory.

## Main Documents

- `AGENTS.md`
- `docs/design-docs/openclaw-personal-control-plane.md`
- `docs/exec-plans/active/2026-04-08-discord-personal-control-plane-v1-1.md`
- `docs/exec-plans/active/2026-04-08-training-bot-private-workspace-rollout.md`
- `docs/exec-plans/active/2026-04-10-xiaohongshu-sf-rent-watcher.md`
- `docs/product-specs/discord-personal-control-plane.md`
- `docs/product-specs/training-bot-private-workspace.md`
- `docs/generated/db-schema.md`
