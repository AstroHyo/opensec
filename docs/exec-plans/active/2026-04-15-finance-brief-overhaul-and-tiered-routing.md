# 2026-04-15 Finance Brief Overhaul And Tiered Routing

## Why

The current `finance` brief is structurally weak in a different way from the old `tech` brief.

Confirmed problems:

- bucket-level fallback summaries produce near-identical copy across unrelated items
- official source status is overweighted relative to real market relevance
- Treasury / Fed / agency posts can surface even when they do not change market interpretation
- PM themes are generic because they are bucket-driven rather than transmission-driven
- the renderer still uses the older `한줄 요약 + 왜 중요한지` format
- the profile has not yet adopted the evidence-aware, insight-oriented editorial pipeline already used by `tech`

The result is not a market brief. It is closer to an official release digest.

## Goals

Turn the `finance` profile into a selective market interpretation brief:

```text
deterministic source fetch
-> finance source taxonomy
-> market relevance gate
-> shortlist
-> evidence extraction
-> structured finance insight enrichment
-> bounded rerank delta
-> concise AM/PM brief
-> deeper follow-ups from stored evidence
```

The user should be able to scan the brief and immediately answer:

- what actually changed
- why this matters for markets
- which assets or sectors are exposed
- what follow-up signal to watch next

## Non-Negotiables

- deterministic ranking remains the first gate
- no freeform live model discovery for daily brief generation
- non-LLM fallback must remain usable
- official source preference remains, but only after market relevance screening
- low-signal official PR must not consume expensive LLM calls
- task-tier routing must reuse the existing cost-aware router pattern already used by `tech`

## Target State

### 1. Market relevance comes before source prestige

The current system asks:

- is this official?
- is this recent?

The finance brief should first ask:

- does this change rate path, inflation path, labor interpretation, regulation burden, capital access, company outlook, or risk premium?

Examples:

- Fed minutes: likely yes
- major Treasury sanctions with commodity / trade / capital-flow impact: maybe yes
- cartel-linked casino sanctions with no broad transmission path: usually no
- tax-benefit promotion release with no market repricing consequence: no

### 2. The brief should be transmission-aware

Each item should be interpretable through explicit transmission channels such as:

- rates
- growth
- inflation
- labor
- liquidity
- credit
- regulation burden
- disclosure burden
- cross-border funding
- sector earnings or capex
- AI capital expenditure / financing

### 3. The finance brief should be smaller and deeper

Target item counts:

- AM: 2 to 4 items
- PM: 3 to 6 items

Low-value official items should be filtered instead of padded into the brief.

## Proposed Data And Type Changes

### Finance insight fields

Add finance-oriented structured fields alongside compatibility fields:

- `whatChanged`
- `marketTransmission`
- `affectedAssets`
- `whyNow`
- `watchpoints`
- optional `companyAngle`
- optional `aiCapitalAngle`
- `confidence`
- `uncertaintyNotes`
- `evidenceSpans`

Compatibility fields retained:

- `summary`
- `whyImportant`

### Finance metadata enrichment

Extend deterministic metadata and/or derived context with:

- `financeBucket`
- `marketImpactLevel`
- `transmissionChannels[]`
- `affectedAssets[]`
- `requiresMacroContext`
- `policyActionType`
- `companySignalType`

### Evidence persistence

Reuse existing `article_contexts` and `item_enrichments` tables where possible.

Only add new columns if the existing JSON-compatible paths are too cramped.

Default preference:

- keep schema additions minimal
- reuse stored evidence, prompt versioning, and source hashing patterns already present

## Deterministic Overhaul Plan

### Workstream A. Finance source taxonomy

Split finance items more precisely than the current `macro / regulation / company / policy` buckets.

Proposed categories:

- `rates_policy`
- `inflation`
- `labor`
- `liquidity_credit`
- `regulation_market_structure`
- `enforcement_low_impact`
- `trade_sanctions_macro`
- `company_filing`
- `company_capital_ai`
- `political_or_promotional`

Rules:

- `political_or_promotional` should be strongly downweighted or excluded
- `enforcement_low_impact` should not show in top sections by default
- `trade_sanctions_macro` should require an explicit transmission path

### Workstream B. Market relevance gate

Before section assembly, apply hard and soft rules:

Hard filters:

- ceremonial agency releases
- Treasury PR with no obvious market or sector transmission
- pure tax-promotion messaging
- low-impact enforcement items

Soft boosts:

- Fed path sensitivity
- inflation / labor repricing relevance
- company filing with guidance / capex / financing change
- AI capex / data center / semiconductor financing links

### Workstream C. Finance fallback writing

Replace generic fallback text with deterministic finance-specific templates that name:

- the changed policy, filing, or action
- the first-order transmission path
- the likely affected asset or sector

Bad fallback:

- `거시/정책 방향을 읽는 데 직접 쓰이는 공식 항목입니다.`

Good fallback:

- `Fed discount rate 회의록이라 은행 자금 조달 조건과 rate path 해석에 직접 연결됩니다.`
- `Treasury 제재이지만 commodity, shipping, trade finance 경로가 약하면 market brief 우선순위는 낮습니다.`

## LLM Overhaul Plan

### Finance insight prompt

Do not ask for generic "importance."

Ask for bounded, evidence-grounded finance interpretation:

- what changed in the policy / filing / release
- how the change transmits into markets
- which assets or sectors are exposed
- why this matters now rather than as a background fact
- what follow-up data point or disclosure should be watched next

### Finance PM synthesis

PM synthesis should connect items through actual market linkages, not agency categories.

Good synthesis:

- rates stayed central because inflation and labor interpretation both tightened
- regulation burden rose for large issuers because disclosure expectations broadened
- AI capex remained a market theme because filings and financing stories pointed the same direction

Bad synthesis:

- official policy signals matter and should be watched carefully

## Task-Tier Model Routing

Finance should reuse the shared task router pattern so the profile stays cost-aware.

### Tier 0

Deterministic only.

Tasks:

- source fetch
- normalization
- finance bucket classification
- market relevance hard filters
- dedupe
- section caps
- resend suppression
- deterministic fallback writing

Cost rule:

- no model call

### Tier 1

Default model:

- `xai:grok-4-1-fast-reasoning`

Tasks:

- per-item finance enrichment for final shortlist
- AM theme bullets
- short follow-up answers grounded in stored digest context

Why:

- cheaper than deep synthesis
- acceptable for bounded single-item interpretation when the shortlist is already filtered

### Tier 2

Default model:

- `openai:gpt-4.1`

Tasks:

- PM theme synthesis
- multi-item cross-asset interpretation
- day-level wrap-up that needs stronger coherence across several items

Why:

- better synthesis quality for cross-item market interpretation
- still materially cheaper than using a deep model for every step

### Tier 3

Default model:

- `openai:gpt-5.4-mini`

Tasks:

- explicit research follow-up only
- manual user-triggered deep comparative analysis
- bounded "what does this mean for X sector / company / rate path" research

Rules:

- never part of mandatory daily brief generation
- require explicit user intent or special follow-up path

## Cost Optimization Rules

### 1. Shrink the candidate set before LLM

The biggest finance cost win is not a cheaper model. It is refusing to enrich weak items.

Rules:

- AM only enrich the final 2 to 4 selected items
- PM only enrich the final 3 to 6 selected items
- do not enrich excluded Treasury promotion posts or low-impact enforcement items

### 2. Cache by source hash and prompt version

Reuse the same caching pattern already used by `tech`:

- prompt version
- source hash
- profile-aware lookup

### 3. Prefer Tier 1 for item-level work

Do not use Tier 2 or Tier 3 for routine per-item enrichment.

### 4. Preserve shared telemetry

Reuse existing `llm_runs` tracking:

- `profile_key`
- `task_key`
- `task_tier`
- `provider`
- `model_name`
- `token_usage_json`
- `estimated_cost_usd`

### 5. Add finance-specific budget review

Track:

- daily finance spend
- spend per task type
- spend per successful digest
- cost of PM synthesis vs. AM synthesis

If needed later:

- finance-specific daily cap
- forced Tier 0-only mode on budget stress days

## Rendering Overhaul

### AM item format

- `[번호] 제목`
- `무슨 일:`
- `시장 연결:`
- `영향 자산:`
- `다음 체크:`

### PM item format

- `[번호] 제목`
- `무슨 일:`
- `시장 전달 경로:`
- `영향 자산 / 섹터:`
- optional `기업 / 자금 각도:`
- `왜 지금:`
- `다음 체크:`

Remove as default finance labels:

- `한줄 요약`
- `왜 중요한지`

Those can remain as backward-compatible fallbacks only.

## Follow-up Upgrades

### `expand N`

Should answer:

- 핵심 변화
- 시장 전달 경로
- 영향 자산
- 왜 지금 반응해야 하는가
- 후속 체크 포인트

### `why important N`

Should answer:

- 직접 영향
- 2차 영향
- 포지셔닝 / 해석 포인트

### `today themes`

Should summarize:

- rate path
- macro regime
- regulation burden
- capital flow
- AI financing / capex when relevant

## Implementation Phases

### Phase 1. Deterministic finance gate

- refine finance bucket taxonomy
- add `marketImpactLevel`
- add hard filters for promotional / low-impact official releases
- strengthen section selection thresholds

### Phase 2. Finance fallback rewrite

- replace generic finance summary templates
- add deterministic transmission-channel language
- keep non-LLM path usable

### Phase 3. Finance insight schema

- add finance-oriented enrichment fields
- add finance prompt templates
- reuse item enrichment persistence

### Phase 4. Finance renderer overhaul

- convert finance sections away from `한줄 요약 + 왜 중요한지`
- keep links at bottom
- keep Discord-safe link rendering

### Phase 5. Follow-up and PM synthesis

- route finance follow-ups through stored finance evidence
- improve PM day-level synthesis
- preserve Tier 2 only for multi-item synthesis

### Phase 6. Cost telemetry and budgets

- verify `llm_runs` for finance task mix
- measure cost per AM / PM digest
- add optional finance-specific budget controls only if needed

## Test Plan

### Deterministic tests

- Treasury sanctions with weak market linkage should be excluded or demoted
- Treasury tax-promotion PR should be excluded
- Fed minutes should rank above low-impact Treasury PR
- major company filing with capex/guidance change should surface

### Renderer tests

- finance output uses the new market-oriented labels
- links appear only in the bottom link section
- Discord-safe wrapping is preserved

### LLM tests

- finance item enrichment schema validates
- AM theme synthesis stays concise
- PM theme synthesis names transmission channels, not just categories

### Regression tests

- digest still ships when finance LLM enrichment fails
- Tier 1 / Tier 2 routing uses the expected default models
- cost telemetry records provider, model, tier, and estimated cost

## Acceptance Criteria

- sanctions or agency PR with no clear market transmission do not dominate the brief
- each surfaced item names at least one concrete transmission path
- each surfaced item names at least one affected asset, sector, or financing channel
- PM themes feel like market interpretation, not agency grouping
- finance uses the shared task-tier router pattern for cost optimization
- finance brief remains usable with LLM disabled
