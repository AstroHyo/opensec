# Finance Market Brief Spec

## Product Goal

The `finance` brief should behave like a compact market operator brief, not a generic collection of official press releases.

The user value should come from:

- what actually changed in policy, macro data, funding, regulation, or company disclosures
- how that change transmits into rates, equities, credit, FX, commodities, or risk appetite
- which items are truly market-relevant vs. merely official
- what to monitor next if the signal keeps developing

## Non-Negotiables

- deterministic retrieval and ranking remain the primary gate
- daily brief generation must not depend on freeform live model search
- official sources are preferred, but official status alone does not make an item brief-worthy
- low market relevance official PR should be filtered or demoted
- the brief must still ship if LLM enrichment fails
- every rendered claim must stay grounded in stored evidence
- silence is better than filler

## Core Editorial Principle

The `finance` brief is not a policy bulletin.

An item belongs in the brief only if it materially helps answer one or more of these questions:

- does this change rate expectations?
- does this alter growth, inflation, labor, liquidity, or credit interpretation?
- does this affect market structure, capital flows, disclosure burden, or enforcement risk?
- does this change the outlook for major companies, capex, AI investment, or financing conditions?

If the answer is no, the item should be filtered out or pushed far down.

## Inclusion Rules

### High-priority categories

- Fed rate, liquidity, balance sheet, bank funding, and policy communications
- BLS inflation, labor, wages, and related releases
- SEC rules or enforcement actions with disclosure, listing, capital markets, or large-cap exposure implications
- Treasury policy or sanctions only when there is clear transmission to:
  - market structure
  - energy or commodity flows
  - cross-border funding
  - trade, shipping, or supply chain risk
  - large-cap or sector-level risk pricing
- major company filings with clear changes in:
  - guidance
  - capex
  - AI investment
  - financing
  - risk factor language

### Downweight or exclude by default

- ceremonial announcements
- political self-congratulation releases
- tax or policy promotion posts that do not alter market interpretation
- sanctions or enforcement notices with no clear market transmission path
- official releases that are notable institutionally but not tradable or decision-relevant

## AM Brief Shape

### Sections

- `매크로 체크`
- `정책 / 규제`
- optional `기업 / 자금 흐름`
- `오늘의 포인트`

### AM target

- roughly 2 to 4 items
- overnight and early-session relevant signals only
- no padding with weak official releases

## PM Brief Shape

### Sections

- `Top Developments`
- `Rates / Macro`
- `Policy / Regulation`
- optional `Company / Capital`
- `What Changed In Markets`

### PM target

- roughly 3 to 6 items
- broader than AM, but still selective
- emphasis on interpretation and transmission, not chronology

## Item Contract

Each `finance` item should render with fields that answer real market questions.

Primary fields:

- `whatChanged`
- `marketTransmission`
- `affectedAssets`
- `whyNow`
- `watchpoints`

Optional fields:

- `companyAngle`
- `aiCapitalAngle`
- `uncertaintyNotes`

Compatibility fields:

- `summary`
- `whyImportant`

These can remain for fallback, but they should not define the editorial format.

## Evidence Contract

Each shortlisted finance item should attempt to persist enough context to support later follow-up:

- canonical URL
- source label
- published time
- cleaned article or filing excerpt
- evidence snippets
- market-relevant sections when extractable

Rules:

- official pages should prefer the linked source page over a bare RSS excerpt
- company filings should preserve filing-level evidence such as guidance, capex, or risk factor text where available
- Treasury and SEC items should preserve the specific action, target, and mechanism
- failures should degrade to snippet fallback instead of failing the brief

## Follow-up Contract

### `expand N`

Should answer:

- 핵심 변화
- 시장 전달 경로
- 영향을 받을 자산군
- 왜 오늘 중요해졌는지
- 다음 확인 포인트

### `why important N`

Should answer:

- 직접 영향
- 2차 영향
- 포지셔닝 / 해석 포인트

### `show sources for N`

Should include:

- primary source links
- any secondary links used as signal
- stored evidence snippets

### `today themes`

Should answer in market language, not abstract policy language.

Examples:

- rate path repricing
- disclosure burden rising
- cross-border funding stress
- AI capex still widening

## Quality Bar

Reject or demote outputs that:

- say only "공식 항목이라 중요하다"
- say only "정책 방향을 보여준다"
- fail to name a transmission channel
- do not identify who must react
- cannot name an affected asset class, sector, or financing channel
- confuse official importance with market relevance
