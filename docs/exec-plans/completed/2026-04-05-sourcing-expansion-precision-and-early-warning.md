# 2026-04-05 Sourcing Expansion: Precision Layer + Early-Warning Layer

## Objective

Expand deterministic retrieval with:

- `precision layer`: `Techmeme + Hacker News + existing GeekNews`
- `early-warning layer`: `Bluesky` watchlist signals only

while keeping the daily digest deterministic and ensuring early-warning signals never become standalone digest items.

## Why Now

Current strengths:

- reproducible primary-source fetch
- strong dedupe + ranking core
- follow-up and research already exist

Current gaps:

- important stories can be missed if they surface first through Techmeme or HN
- community amplification is only partially visible through GeekNews
- there is no stored early-warning social signal layer for follow-up and research

## Shipped Design

### Source taxonomy

- `primary`: OpenAI RSS, GitHub Trending
- `precision`: GeekNews, Techmeme, Hacker News
- `early_warning`: Bluesky watchlist signals

### Deterministic flow

1. fetch primary + precision sources
2. normalize, canonicalize, dedupe, and merge into `normalized_items`
3. fetch early-warning signals
4. match signals onto existing normalized items by linked URL, then title similarity fallback
5. score and render digest

### Guardrails

- precision sources may create new digest candidates
- early-warning signals may only boost or annotate existing items
- unmatched signals remain available for `research`, not digest ranking
- daily digest generation never depends on live model search

## Data and Interface Changes

### New source identifiers and types

- source ids: `techmeme`, `hacker_news`, `bluesky_watch`
- source types: `techmeme`, `hacker_news`, `social_signal`
- source layers: `primary`, `precision`, `early_warning`

### Schema additions

- `normalized_items.primary_source_layer`
- `item_sources.source_layer`
- `signal_events`
- `signal_event_matches`

### Digest / follow-up additions

- `ScoreBreakdown.precisionSignalScore`
- `ScoreBreakdown.earlyWarningScore`
- `DigestEntry.signalLinks`

## Scoring Rules

- Techmeme lead: `+8`
- Techmeme related: `+4`
- Hacker News: `+6` base plus capped traction bonus from score/comments
- GeekNews precision contribution: `+4`
- total precision-layer bonus cap: `18`
- Bluesky: `+2` per distinct matched actor, plus `+1` if 2+ distinct actors match
- total early-warning bonus cap: `6`

`crossSignalScore` continues to count only primary and precision sources.

## Tests

- fixture parsing for Techmeme, Hacker News, and Bluesky
- merge test across OpenAI + Techmeme + HN + GeekNews
- candidate-generation test for Techmeme-only AI story
- early-warning matched-signal test
- guardrail test for no-link Bluesky posts
- full suite regression via `vitest run`
