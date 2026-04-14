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
- `followup_research` -> Tier 3
- future `rerank_delta` LLM step -> Tier 1 only

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
