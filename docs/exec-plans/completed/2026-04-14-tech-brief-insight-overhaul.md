# 2026-04-14 Tech Brief Insight Overhaul

## Why

The previous tech brief was structurally capped at low depth:

- LLM input did not include article body context
- the schema encouraged one-line generalities
- the renderer forced `한줄 요약 + 왜 중요한지`
- follow-ups replayed the same thin fields

The result was fluent but low-signal output.

## Target State

Turn the `tech` digest into an insight editorial pipeline:

```text
deterministic ranking
-> bounded shortlist
-> article/repo full-read
-> structured insight extraction
-> bounded rerank delta
-> main brief
-> deeper follow-ups from saved evidence
```

## Implemented Scope

### 1. Evidence layer

- added `article_contexts` persistence
- added bounded article/repo extraction
- OpenAI pages now use linked page HTML when available
- GitHub Trending repos now try to extract README context
- fetch failures fall back to snippet-based context

### 2. Insight schema v2

- replaced `summary_ko / why_important_ko`-centric enrichment with:
  - `what_changed_ko`
  - `engineer_relevance_ko`
  - `ai_ecosystem_ko`
  - `openai_angle_ko`
  - `trend_signal_ko`
  - `cause_effect_ko`
  - `watchpoints_ko`
  - `evidence_spans`
  - `novelty_score`
  - `insight_score`

### 3. Bounded rerank

- enrichment now applies only to the deterministic shortlist
- rerank uses bounded deltas from:
  - novelty
  - insight
  - evidence depth
- deterministic scoring remains the primary ordering base

### 4. Renderer overhaul

Tech items now render as:

- `무슨 일`
- `엔지니어 관점`
- `AI 맥락`
- optional `OpenAI 각도`
- `변화 신호`

Generic `왜 중요한지` was removed from the default tech brief.

### 5. Follow-up deepening

- `expand N` now uses article context and evidence spans
- `why important N` now returns:
  - 직접 영향
  - 2차 영향
  - 전략적 의미
- `show sources for N` now includes stored evidence snippets

## Remaining Work

- add stricter quality evals for boilerplate detection
- add richer source-specific extraction rules for more publishers
- consider explicit low-confidence demotion in final section assembly
- strengthen `today themes` with item-level aggregation plus synthesis QA

## Verification

Expected checks:

- renderer tests for the new labels
- schema tests for enrichment v2
- extraction tests for generic article pages and GitHub repo pages
- migration tests for new DB columns and `article_contexts`

Note:

`tsx` and project-wide `tsc` execution were unreliable in the current local environment during this rollout, so verification may need to be re-run on the VPS/runtime environment where the bot actually ships.
