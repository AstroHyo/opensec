# LLM-Assisted Digest Spec

## Product Goal

The `tech` brief should stop sounding like a compressed RSS summary and start behaving like a compact editorial brief for one technical operator.

The user already knows the raw topic area. The value must come from:

- what actually changed
- why this matters to engineering workflow
- how it connects to the AI / OpenAI ecosystem
- what broader trend it signals
- what to watch next

## Non-Negotiables

- deterministic retrieval and ranking remain the primary gate
- LLMs do not perform open-ended daily discovery
- official sources outrank commentary when both exist
- the brief must still ship if extraction or LLM enrichment fails
- every insight field must stay grounded in stored evidence

## Tech Brief Shape

### AM

- `Top Signals`
- `OpenAI Watch`
- `Repo Radar`
- `오늘의 시그널`

Target: roughly 3 to 5 deep items total, not filler.

### PM

- `Top Developments`
- `OpenAI Watch`
- `Methods / Tooling`
- `Repo Radar`
- `오늘의 변화 방향`

Target: roughly 5 to 8 deep items total, not a long list.

## Item Contract

Each tech item should be renderable with these perspective fields:

- `whatChanged`
- `engineerRelevance`
- `aiEcosystem`
- optional `openAiAngle`
- `trendSignal`
- optional `causeEffect`
- `watchpoints`
- `evidenceSpans`

Compatibility fields:

- `summary`
- `whyImportant`

These remain for fallback and older code paths, but they should no longer define the editorial format.

## Evidence Contract

Each shortlisted item should attempt to persist an `article_context`:

- `canonicalUrl`
- `fetchStatus`
- `headline`
- `dek`
- `publisher`
- `author`
- `publishedAt`
- `cleanText`
- `keySections`
- `evidenceSnippets`
- `wordCount`

Rules:

- OpenAI official items should prefer the linked official page over the RSS snippet
- GeekNews should be used as discovery, but the underlying original article should drive analysis when possible
- GitHub Trending repos should prefer README or repo landing context over the trending blurb alone
- failure should degrade to snippet fallback, not crash the digest

## Follow-up Contract

### `expand N`

Should answer:

- 핵심 내용
- 왜 지금 나왔나
- 엔지니어에게 실제로 달라지는 점
- OpenAI / AI ecosystem 연결
- 앞으로 볼 것

### `why important N`

Should answer:

- 직접 영향
- 2차 영향
- 전략적 의미

### `show sources for N`

Should include:

- primary links
- secondary signal links
- stored evidence snippets

### `today themes`

Should use both:

- saved item-level theme tags
- theme synthesis over the selected daily items

## Quality Bar

Reject or demote outputs that:

- say only "important for AI" or "useful for developers"
- restate the source label without mechanism
- claim an OpenAI angle when none exists
- use trend language without a concrete reason
- give no evidence span or operational implication
