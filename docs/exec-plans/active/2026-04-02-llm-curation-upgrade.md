# 2026-04-02 LLM Curation Upgrade

## Objective

Improve digest quality with LLM assistance while keeping the current deterministic pipeline as the system of record.

The target outcome is not "the model picks the news."
The target outcome is "the model helps explain, compare, and sharpen the news we already fetched and ranked."

## Why Now

Current strengths:

- reliable source ingestion
- explicit ranking
- strong fallback behavior
- stored follow-up context

Current gaps:

- Korean summaries are template-like
- "why important" can be correct but generic
- theme synthesis is simple
- follow-up expansions are shallow
- deterministic ranking cannot capture nuance between similarly scored items

## Non-Goals

- no unconstrained live web search by the model
- no replacement of SQLite state with prompt memory
- no requirement that digest generation fail closed when model APIs are unavailable
- no direct multi-tenant productization

## Proposed End State

```text
deterministic fetch + dedupe + score
  -> shortlist candidates
  -> LLM item enrichment
  -> bounded rerank calibration
  -> final digest selection
  -> LLM theme synthesis
  -> persist artifacts + render Telegram digest
```

## Product Improvements We Want

1. Cleaner Korean summaries with less template repetition
2. Better "왜 중요한지" grounded in the user's actual priorities
3. Stronger distinction between:
   - official source
   - commentary
   - repo discovery
   - methodology signal
4. Better PM-level pattern synthesis
5. Better follow-up answers such as `expand N` and `why important N`

## Architecture Changes

### Phase 1: Item Enrichment Only

Add an optional enrichment pass after deterministic shortlist selection.

Input:

- top `K` candidates after scoring, for example `K=12` in AM and `K=20` in PM
- source metadata
- title, description, snippet
- current score breakdown
- source links

Output per item:

- `summary_ko`
- `why_important_ko`
- `confidence`
- `uncertainty_notes`
- `theme_tags`
- `officialness_note`

Rules:

- preserve English product, API, company, repo, and model names
- cite official source preference when present
- avoid hype language
- do not invent facts not present in the bundle

### Phase 2: Theme Synthesis

Run a second bounded LLM pass over the final selected items.

Output:

- AM: 1 to 2 theme bullets
- PM: 2 to 4 implication bullets

This pass should read selected items and score reasons, not raw unbounded web data.

### Phase 3: Follow-up Enrichment

Use stored digest context plus saved enrichment artifacts to improve:

- `expand N`
- `why important N`
- `today themes`

This should still work in deterministic mode if the model is unavailable.

### Phase 4: Optional Rerank Calibration

After we have evaluation coverage, allow an LLM to suggest bounded rerank deltas on close candidates.

Important:

- the model does not produce a full ranking from scratch
- it proposes small adjustments with rationale
- deterministic rank remains the base score

Example use:

- candidate A and B are close
- model notes A introduces a genuinely new agent workflow while B is mostly commentary
- apply a capped score delta such as `-6` to `+6`

## New Code Modules

Create these under `news-bot/src/llm/`:

- `openaiClient.ts`
- `schemas.ts`
- `promptTemplates.ts`
- `enrichItems.ts`
- `synthesizeThemes.ts`
- `rerankCandidates.ts`
- `followupAnswer.ts`

Add supporting modules under `news-bot/src/evals/`:

- `fixtures/`
- `rubrics.ts`
- `scoreDigestQuality.ts`

## File-Level Change Map

### Existing Files To Extend

- `news-bot/src/config.ts`
  - add LLM feature flags
  - add model selection and timeout config
- `news-bot/src/types.ts`
  - add enrichment result types
  - add persisted artifact types
- `news-bot/src/db.ts`
  - add LLM-related tables
  - add read/write helpers for enrichment artifacts
- `news-bot/src/digest/buildDigest.ts`
  - call optional item enrichment
  - call optional theme synthesis
  - preserve deterministic fallback behavior
- `news-bot/src/commands/followup.ts`
  - optionally use saved enrichment artifacts for richer explanations
- `news-bot/.env.example`
  - document new env vars
- `news-bot/tests/`
  - add schema validation and fallback tests

### New Files To Add First

- `news-bot/src/llm/openaiClient.ts`
- `news-bot/src/llm/schemas.ts`
- `news-bot/src/llm/promptTemplates.ts`
- `news-bot/src/llm/enrichItems.ts`
- `news-bot/src/llm/synthesizeThemes.ts`
- `news-bot/src/evals/rubrics.ts`
- `news-bot/src/evals/scoreDigestQuality.ts`

## Proposed Environment Variables

- `NEWS_BOT_LLM_ENABLED=false`
- `NEWS_BOT_LLM_THEMES_ENABLED=false`
- `NEWS_BOT_LLM_RERANK_ENABLED=false`
- `NEWS_BOT_LLM_MODEL_SUMMARY=...`
- `NEWS_BOT_LLM_MODEL_THEMES=...`
- `NEWS_BOT_LLM_TIMEOUT_MS=20000`
- `NEWS_BOT_LLM_MAX_ITEMS_AM=12`
- `NEWS_BOT_LLM_MAX_ITEMS_PM=20`

## Persistence Changes

Add tables such as:

- `llm_runs`
  - request type
  - model name
  - prompt version
  - input hash
  - latency
  - token usage if available
  - status
  - error text
- `item_enrichments`
  - item id
  - llm run id
  - summary
  - why important
  - theme tags
  - confidence
  - uncertainty notes
  - source hash used
- `digest_enrichments`
  - digest id
  - llm run id
  - synthesized themes
  - what-this-means bullets

Keep deterministic digest generation valid even if these tables are empty.

## Suggested JSON Contracts

### Item Enrichment Output

```json
{
  "summary_ko": "OpenAI가 Responses API에 computer environment를 붙이며 agent 실행 범위를 넓혔습니다.",
  "why_important_ko": "단순 답변 API에서 실제 작업 수행형 agent stack으로 확장되는 신호라서, tool-use 기반 제품 설계에 직접 영향이 있습니다.",
  "confidence": 0.86,
  "uncertainty_notes": [],
  "theme_tags": ["OpenAI", "agents", "developer tooling"],
  "officialness_note": "official_openai"
}
```

### Theme Synthesis Output

```json
{
  "themes_ko": [
    "OpenAI와 agent tooling 진영 모두 '실행 가능한 workflow' 레이어를 강화하는 흐름이 보입니다.",
    "오늘 Repo Radar는 단순 모델 래퍼보다 orchestration과 developer ergonomics에 더 무게가 실렸습니다."
  ]
}
```

## Prompting Strategy

### Item Enrichment Prompt

System goals:

- summarize only from supplied evidence
- keep Korean concise
- preserve English entity names
- state uncertainty when evidence is thin
- prefer official interpretation when official sources exist

Input bundle per item:

- title
- description
- content snippet
- source label
- source type
- openai category if present
- repo metadata if present
- deterministic score reasons
- source links

Response format:

- strict JSON
- validated with `zod`
- reject or retry on invalid output

Guardrails:

- if evidence is insufficient, return a short uncertainty note instead of guessing
- do not restate source titles verbatim unless necessary
- do not invent performance claims, dates, or rollout scope

### Theme Synthesis Prompt

Input:

- final selected digest items
- short score reasons
- item categories

Output:

- concise theme bullets only
- no new facts
- no advice beyond supported evidence

## Evaluation Plan

Before enabling LLM output by default, build a golden set of digest cases:

1. OpenAI-heavy day
2. repo-heavy day
3. mixed weak-signal day
4. GeekNews-heavy day
5. sparse day with few good items

For each case, compare:

- deterministic output
- LLM-enriched output

Judge on:

- factual grounding
- priority alignment
- explanation usefulness
- non-hype tone
- formatting quality

Store evaluation fixtures under:

- `news-bot/src/evals/fixtures/openai-heavy.json`
- `news-bot/src/evals/fixtures/repo-heavy.json`
- `news-bot/src/evals/fixtures/mixed-low-signal.json`

Each fixture should contain:

- normalized candidate items
- expected top picks
- notes about why weak items should stay out

## Rollout Plan

### Milestone 0: Instrumentation

- add prompt versioning
- add enrichment storage
- add basic latency and failure logs
- add feature flags:
  - `NEWS_BOT_LLM_ENABLED`
  - `NEWS_BOT_LLM_RERANK_ENABLED`
  - `NEWS_BOT_LLM_THEMES_ENABLED`

### Milestone 1: Item Summary Enrichment

- enrich top candidates only
- keep deterministic section selection
- fallback to current template summaries on any error

Ship gate:

- summaries are clearly better in eval set
- JSON validation failures are handled without crashing digest generation
- no increase in send failures

### Milestone 2: Theme Synthesis

- use LLM for `오늘 보이는 흐름` and `What this means`
- cache per digest candidate set hash

Ship gate:

- theme bullets feel more useful than current heuristic themes
- no hallucinated cross-item claims

### Milestone 3: Follow-up Upgrade

- store richer item explanation artifacts
- let `expand N` and `why important N` return better narrative depth

Ship gate:

- answers remain tied to stored source evidence

### Milestone 4: Bounded Rerank

- use model only on near-tie candidates
- apply capped delta
- log before/after ranking changes

Ship gate:

- eval set shows better prioritization fit
- no evidence of model bias toward polished but less important items

## Suggested PR Sequence

### PR 1: Foundations

- feature flags
- LLM client skeleton
- DB tables
- type definitions

### PR 2: Item Enrichment

- item prompt bundles
- summary and why-important enrichment
- fallback handling
- snapshot tests

### PR 3: Theme Synthesis

- digest-level theme generation
- persistence
- renderer integration

### PR 4: Follow-up Upgrade

- richer `expand N`
- richer `why important N`
- saved artifact lookup

### PR 5: Rerank Experiment

- bounded delta proposal
- offline eval runner
- rollout flag kept off by default

## Risks And Mitigations

### Hallucination

Mitigation:

- bounded evidence bundle
- structured outputs
- source links retained
- confidence and uncertainty fields

### Prompt Injection Via Source Text

Mitigation:

- treat source text as data only
- system prompt forbids following embedded instructions
- no tool use inside enrichment step

### Cost And Latency

Mitigation:

- enrich only top `K`
- cache by input hash
- use a cheaper model tier for item summaries
- reserve stronger model tier for theme synthesis only if needed

### Quality Regression

Mitigation:

- golden test corpus
- feature flags
- deterministic fallback
- staged rollout by capability

## Concrete Work Breakdown

### Track A: Foundations

1. add feature flags and config schema
2. add `src/llm/` module skeleton
3. add persistence tables
4. add prompt/output schema validation

### Track B: Item Enrichment

1. build candidate-to-prompt bundle
2. implement item enrichment client
3. merge enriched fields into digest entry rendering
4. fallback cleanly to current summaries

### Track C: Theme Synthesis

1. build digest-level prompt bundle
2. synthesize AM and PM themes separately
3. persist theme artifacts for follow-up reuse

### Track D: Evaluation

1. create golden fixtures
2. create scoring rubric runner
3. compare deterministic versus enriched outputs
4. document enable/disable criteria

### Track E: Follow-up

1. attach enrichment artifacts to follow-up context
2. improve `expand N`
3. improve `why important N`
4. keep source list rendering deterministic

## Recommended Order

1. instrumentation and feature flags
2. item enrichment
3. theme synthesis
4. follow-up enrichment
5. rerank calibration

This order keeps risk low while improving the most visible quality problems first.

## Definition Of Done

We should consider the LLM upgrade ready when:

- digest still sends without LLM
- LLM failures degrade gracefully
- summaries are materially better in Korean
- theme bullets are more insightful without inventing facts
- follow-up answers become more useful
- evaluation artifacts make ranking changes explainable

## Recommended Immediate Next Step

Start with PR 1 and PR 2 only.

That gets the product-visible quality gain fastest while keeping the risk surface small:

- better Korean summaries
- better "왜 중요한지"
- no change yet to source selection authority
