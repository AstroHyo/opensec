# 2026-04-14 Three-Day Dedupe and Tiered Model Routing

## Why

Two issues are now blocking the next quality step:

1. recent briefs still allow too much repeat exposure across nearby runs
2. LLM calls are not routed by task difficulty, so cost and latency are higher than necessary

These need to be fixed at the pipeline layer, not by prompt tweaks.

## Decision Summary

### 1. Three-day duplicate suppression will become DB-first, not renderer-first

The system should suppress recent repeats before final section assembly.

We will treat the last 72 hours as a strong visibility window:

- exact same canonical story: hard block
- same title cluster / same repo / same official post with minor wording changes: hard block
- same story appearing through a different source path: hard block
- same topic with materially new evidence: conditional allow

Markdown rendering is too late to solve this. The suppression layer must run during candidate selection and section assembly.

### 2. Model choice will be tier-routed by task type

We will stop choosing models ad hoc at each call site.

Instead:

- deterministic work stays non-LLM
- bounded small-reasoning tasks use the cheapest small model that meets quality
- cross-item synthesis uses a stronger but still bounded model
- explicit research or long-form operator questions use the deep model

The default should be "small unless proven otherwise."

## Target State

```text
fetch + normalize + dedupe
-> deterministic scoring
-> recent 72h suppression gate
-> shortlist
-> optional bounded evidence fetch
-> task-tiered LLM enrichment
-> section assembly
-> final render
```

## Workstream A: Strong 72-hour duplicate suppression

### Goal

Ensure that the same story does not reappear within the last 3 days unless it has materially changed.

### Scope

- `tech` brief first
- both scheduled AM and PM runs
- manual follow-up rendering should read the same suppression context

### New rules

#### Hard block

Block an item if any of these are true within the last 72 hours:

- same `canonical_url`
- same `title_hash`
- same `repo_owner/repo_name`
- same official OpenAI page URL
- high fuzzy similarity against a recently sent item cluster

#### Conditional allow

Allow resend only if one of these is true:

- official OpenAI item has meaningful new substance
  - changed article context hash
  - new section content
  - corrected scope that affects engineering interpretation
- repo moved from weak signal to strong signal
  - e.g. trending only -> official release or major discussion
- user explicitly triggers a manual mode that allows repeats

#### Never rely on renderer dedupe

By the time text is rendered, duplicates have already stolen ranking slots.
The suppression decision must happen before final section allocation.

### Data model direction

Keep the suppression system explainable and queryable.

Proposed additions to `sent_items`:

- `canonical_identity_hash`
- `story_cluster_hash`
- `title_snapshot`
- `url_snapshot`
- `section_key`
- `suppression_basis_json`
- `override_reason`

This lets us query:

- "was this exact story shown in the last 72h?"
- "was this near-duplicate cluster already shown?"
- "why was a resend allowed?"

### Implementation sequence

1. Add a reusable `recentDigestWindow` helper
2. Build a DB query that returns sent items from the last 72 hours by profile
3. Derive suppression keys per candidate:
   - canonical URL key
   - title hash key
   - cluster hash key
   - repo key
4. Add a `recent suppression gate` between scoring and section assembly
5. Add `override allow` logic for materially updated official items
6. Persist suppression decision metadata into `sent_items`
7. Add follow-up/debug command support later if useful

### Testing

- exact duplicate within 72h is blocked
- same repo through another source is blocked
- fuzzy title duplicate is blocked
- OpenAI official materially updated item is allowed
- old item after 72h can reappear if still relevant
- no cross-section duplicate within a single digest

## Workstream B: Tiered model routing

### Goal

Reduce cost and latency by routing each bounded LLM task to the smallest model that can do it reliably.

### Routing philosophy

- task type decides the tier
- tier decides the default model
- manual escalation is explicit
- scheduled digest jobs should prefer stability over expensive auto-escalation

### Proposed tiers

#### Tier 0: deterministic

No LLM.

Use for:

- fetch
- normalize
- canonicalize
- dedupe
- scoring
- resend suppression
- section filtering
- source extraction fallback

#### Tier 1: small reasoning

Use the cheapest reliable small model.

Use for:

- item enrichment
- AM theme synthesis
- short follow-up answers over stored context
- bounded classification / tie-break tasks

Quality bar:

- structured JSON
- short bounded inputs
- fast fallback to deterministic output if it fails

#### Tier 2: medium synthesis

Use a stronger model when the task spans multiple items or needs better abstraction quality.

Use for:

- PM theme synthesis
- multi-item "today themes"
- higher-stakes manual synthesis over stored digest context

#### Tier 3: deep research

Use the strongest model only for explicit operator asks.

Use for:

- `research`
- long-form cross-item analysis
- live-search-backed questions

This tier should never be used for the default scheduled digest path.

### Config direction

Replace single-purpose model fields with tier-oriented defaults.

Proposed config:

- `NEWS_BOT_LLM_MODEL_TIER_SMALL`
- `NEWS_BOT_LLM_MODEL_TIER_MEDIUM`
- `NEWS_BOT_LLM_MODEL_TIER_DEEP`
- `NEWS_BOT_LLM_TIMEOUT_TIER_SMALL_MS`
- `NEWS_BOT_LLM_TIMEOUT_TIER_MEDIUM_MS`
- `NEWS_BOT_LLM_TIMEOUT_TIER_DEEP_MS`

### Initial default model mapping

Start conservative and close to the models we already use successfully.

- Tier 1 default: `gpt-4.1-mini`
- Tier 2 default: `gpt-4.1`
- Tier 3 default: `gpt-5.4-mini`

Rationale:

- Tier 1 is the high-volume path, so cost and latency dominate
- Tier 2 is lower-volume but more synthesis-heavy
- Tier 3 is explicit operator-triggered research only, so we can spend more when needed

Optional later:

- allow explicit deep escalation from Tier 3 default to a larger research model only for manual operator requests
- keep that escalation out of the scheduled digest path

### Grok provider review

Grok is a viable second provider, but it should enter through tiered routing rather than as a global swap.

Current official signals worth noting:

- xAI documents a cost-efficient lightweight model family, including `grok-4-1-fast-reasoning`, and positions it as strong at tool calling
- xAI also supports strict structured outputs and OpenAI-compatible Responses API usage
- xAI exposes higher-end reasoning models such as `grok-4.20-reasoning`, but those should be treated as premium paths, not default scheduled-digest models

Recommended stance:

- keep OpenAI as the default provider while we add the routing abstraction
- add xAI as an optional provider in the router
- evaluate Grok first on Tier 1 tasks where the upside is biggest and blast radius is smallest

Initial provider recommendation:

- Tier 1:
  - default: `openai:gpt-4.1-mini`
  - candidate alt: `xai:grok-4-1-fast-reasoning`
- Tier 2:
  - default: `openai:gpt-4.1`
  - candidate alt: `xai:grok-4.20-reasoning` only if quality clearly beats cost
- Tier 3:
  - default: `openai:gpt-5.4-mini`
  - keep Grok optional for later manual research experiments, not default

Why this split:

- Tier 1 is where Grok is most attractive on paper because the work is high-volume, bounded, and schema-driven
- Tier 2 and Tier 3 are where output quality, synthesis stability, and operator trust matter more than raw token price
- scheduled digest paths should avoid provider churn until we have fixture-based evaluation results

### Grok evaluation gate

Before Grok becomes a default tier provider, it must pass the same digest-specific checks:

- strict JSON schema compliance
- low genericness on `what_changed`, `engineer_relevance`, and `trend_signal`
- no increase in hallucinated mechanism claims
- no regression in Korean clarity
- no timeout increase on scheduled digest paths

The first rollout should therefore be:

1. router supports provider-qualified model ids
2. Tier 1 can opt into `xai:grok-4-1-fast-reasoning`
3. run fixture previews and compare against OpenAI outputs
4. promote only if quality and cost both improve enough

### Initial timeout policy

- Tier 1: `20_000` ms
- Tier 2: `30_000` ms
- Tier 3: `60_000` ms

Rules:

- Tier 1 timeout should silently fall back on scheduled paths
- Tier 2 timeout may degrade to deterministic theme output
- Tier 3 timeout should return a partial answer with explicit uncertainty instead of silently hiding the failure

Optional later:

- per-task overrides
- daily spend cap
- manual escalation flag

### Code direction

Add a central router:

- `news-bot/src/llm/taskRouter.ts`

It should accept:

- `taskKey`
- `profileKey`
- `mode`
- optional escalation hint

And return:

- `tier`
- `model`
- `timeoutMs`
- `shouldFallbackSilently`

### Proposed task map

- `item_enrichment` -> Tier 1
- `theme_synthesis_am` -> Tier 1
- `theme_synthesis_pm` -> Tier 2
- `followup_answer` -> Tier 1
- `today_themes` -> Tier 2
- `followup_research` -> Tier 3
- future `rerank_delta` LLM step -> Tier 1 only

### Dynamic downgrade / upgrade rules

The first version should stay simple, but we can still make a few bounded decisions:

- if PM synthesis has only 2 or 3 strong items, allow Tier 1 instead of Tier 2
- if a short follow-up references many items or asks for cross-item synthesis, upgrade from Tier 1 to Tier 2
- never auto-upgrade scheduled digest jobs from Tier 1 or Tier 2 into Tier 3
- only explicit research paths may enter Tier 3

### Persistence and observability

We need cost visibility per task.

Planned `llm_runs` additions:

- `task_key`
- `task_tier`
- `provider`
- `estimated_cost_usd`

This will let us answer:

- what is costing money
- which tasks should be downgraded
- whether quality gain from Tier 2 or Tier 3 is worth it

### Testing

- task router maps each task to the expected tier
- scheduled digest never uses Tier 3
- follow-up research always uses Tier 3
- Tier 1 failure falls back cleanly on scheduled digest paths
- task metadata is recorded in `llm_runs`

## Rollout Order

### Phase 1. Strong resend suppression

Do this first.

Reason:

- it improves operator experience immediately
- it reduces repeated LLM spend on already-sent items
- it makes later prompt tuning more honest

### Phase 2. Task router skeleton

Introduce the routing layer without changing every model immediately.

Reason:

- centralizes the policy
- makes later pricing changes safe

### Phase 3. Migrate existing tasks onto tiers

Move:

- item enrichment
- theme synthesis
- follow-up answer
- research

### Phase 4. Cost telemetry

Persist per-task tier and estimated cost.

### Phase 5. Optional budget controls

Only if needed after observing real usage.

## Risks

### Risk: over-blocking legitimate updates

Mitigation:

- keep official OpenAI override path
- compare article context hash, not just title
- record override reasons for debugging

### Risk: model downgrades hurt quality

Mitigation:

- migrate by task
- compare sample outputs before and after
- keep Tier 2 and Tier 3 reserved for synthesis/research only

### Risk: too much routing complexity

Mitigation:

- central router with 3 tiers only
- no per-call custom logic unless proven necessary

## Acceptance Criteria

### Dedupe

- no item resurfaced within 72h unless override criteria are met
- repo and official-post near-duplicates are suppressed across sources
- suppression is explainable from stored metadata

### Tiered routing

- scheduled digest path defaults to Tier 1 / Tier 2 only
- explicit research is the only path that reaches Tier 3
- per-task routing is centralized and testable
- LLM cost per day is more predictable and easier to inspect
