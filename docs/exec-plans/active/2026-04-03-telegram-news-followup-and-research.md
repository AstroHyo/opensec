# 2026-04-03 Telegram News Follow-up And Research

## Objective

Add a high-UX Telegram follow-up layer that supports:

- natural-language questions over stored digest context
- optional LLM explanation mode
- opt-in live research mode with cited links

while preserving the deterministic daily digest as the system of record.

## Why Now

Current strengths:

- deterministic digest generation
- stored follow-up context
- Telegram delivery already works
- bounded LLM enrichment already exists for the digest itself

Current gaps:

- follow-up UX is command-shaped rather than natural-language-first
- deeper explanation requires the user to know exact phrases
- there is no explicit opt-in path for live research and fresh insight generation
- there is no clear separation between "explain what we already know" and "go research more"

## Product Goals

1. Let the user ask news questions in normal language
2. Keep the daily digest deterministic
3. Support richer LLM explanation from stored evidence
4. Support opt-in live research with explicit citations
5. Preserve a non-LLM fallback path

## Non-Goals

- no change to deterministic fetch, score, and render for the daily digest
- no unconstrained always-on browsing for all follow-up
- no hidden replacement of stored evidence with model memory
- no repo or system mutations from news Q&A flows

## Proposed User Modes

### Mode A: Deterministic Commands

Keep existing flows:

- `expand N`
- `show sources for N`
- `why important N`
- `today themes`

### Mode B: Ask

Natural-language Q&A over stored digest evidence only.

Examples:

- `ask 2번 뉴스를 우리 제품 관점으로 설명해줘`
- `ask 오늘 OpenAI 뉴스만 짧게 다시 정리해줘`

### Mode C: Research

Opt-in live LLM research with stored digest context as the starting point.

Examples:

- `research 2번 뉴스 관련 최신 공식 반응까지 찾아줘`
- `research 오늘 나온 OpenAI 소식이 실무적으로 뭘 의미하는지 더 조사해줘`

## Architecture Changes

### 1. Follow-up Router

Extend `news-bot/src/commands/followup.ts` to route:

1. exact commands
2. natural-language command aliases
3. ask mode
4. research mode

### 2. Intent Parsing

Add a light parser that extracts:

- referenced item number
- target source family such as OpenAI or Repo Radar
- requested answer style such as summary, comparison, implications
- whether live research was explicitly requested

Possible new file:

- `news-bot/src/commands/followupIntent.ts`

### 3. Ask Answer Engine

Add a bounded answer engine that reads from:

- latest digest items
- follow-up context
- source links
- score reasons
- optional stored digest enrichment artifacts

Possible new file:

- `news-bot/src/commands/followupAnswer.ts`

### 4. Research Evidence Collector

Add a live research step only for explicit research mode.

Responsibilities:

- derive search queries from the user question plus stored digest context
- collect a bounded set of fresh sources
- score official sources above commentary
- pass a compact evidence bundle to the LLM

Possible new files:

- `news-bot/src/llm/researchQueries.ts`
- `news-bot/src/llm/researchEvidence.ts`
- `news-bot/src/llm/researchAnswer.ts`

### 5. Persistence

Persist research artifacts for debugging and reuse.

Recommended tables:

- `followup_runs`
  - mode
  - prompt version
  - model
  - latency
  - status
  - error text
- `followup_research_sources`
  - followup run id
  - url
  - title
  - source label
  - source type
  - published at
  - selected reason
- `followup_answers`
  - followup run id
  - answer text
  - used digest item numbers
  - confidence
  - uncertainty notes

## Prompting Rules

### Ask Mode

- no live browsing
- only use provided stored evidence
- preserve English product and company names
- cite used digest items
- distinguish fact from interpretation

### Research Mode

- use only the bounded search results provided
- prefer official and primary sources first
- mention when a conclusion is an inference
- include explicit links in the final answer
- do not hide uncertainty

## Telegram UX Plan

### Phase 1

Support text-only natural language in the existing DM flow.

Good first queries:

- `2번 뉴스 더 쉽게 설명해줘`
- `오늘 OpenAI 관련만 다시 요약해줘`
- `오늘 제일 중요한 흐름이 뭐야?`
- `2번 뉴스 좀 더 찾아봐`

### Phase 2

Add item-level inline buttons after digest delivery:

- `자세히`
- `출처`
- `LLM 설명`
- `더 리서치`

### Phase 3

Use background task style delivery for longer research requests:

- quick acknowledgment
- in-progress status
- final answer posted back in the same Telegram thread/session

## File-Level Change Map

### Existing Files To Extend

- `news-bot/src/commands/followup.ts`
- `news-bot/src/db.ts`
- `news-bot/src/types.ts`
- `news-bot/src/config.ts`
- `news-bot/src/index.ts`
- `news-bot/tests/llm.test.ts`
- `news-bot/README.md`
- `ARCHITECTURE.md`

### New Files To Add

- `news-bot/src/commands/followupIntent.ts`
- `news-bot/src/commands/followupAnswer.ts`
- `news-bot/src/llm/researchQueries.ts`
- `news-bot/src/llm/researchEvidence.ts`
- `news-bot/src/llm/researchAnswer.ts`
- `news-bot/tests/followup-nlu.test.ts`
- `news-bot/tests/followup-research.test.ts`

## Suggested Delivery Order

### Phase 1: Natural-Language Ask Without Live Search

- add natural-language routing for existing command intents
- add bounded ask mode over stored evidence
- add tests for fallback behavior

### Phase 2: Opt-In Research

- add explicit research mode
- collect bounded live sources
- render cited research answers
- persist artifacts

### Phase 3: Telegram UX Enhancements

- add inline action affordances
- add background-task style updates for long research
- refine short acknowledgment copy

## Validation

- existing deterministic follow-up tests still pass
- ask mode works with no LLM key by falling back cleanly
- research mode never runs unless the user explicitly asks
- research answers include links and used evidence
- deterministic digest generation remains unaffected
