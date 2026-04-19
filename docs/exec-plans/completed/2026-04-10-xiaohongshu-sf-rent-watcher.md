# 2026-04-10 Xiaohongshu SF Rent Watcher

## Summary

Add a Xiaohongshu watcher that searches broad San Francisco housing queries, keeps a persistent logged-in browser profile, filters hard rejects deterministically, optionally uses OCR / LLM adjudication on bounded candidates, stores evidence in SQLite, and sends direct Discord DM alerts for `match` or `maybe` posts.

## Locked Decisions

- target office: `1455 3rd St, San Francisco, CA 94158`
- commute heuristic: normal bus or tram commute around 40 minutes is acceptable
- geography scope: San Francisco only
- housing shape: whole-unit `studio` or `1b1b` only
- reject female-only, roommate, room-only, or shared kitchen / bathroom posts
- price is ignored
- alerts are sent as direct Discord DMs, one post at a time
- watcher runs every 30 minutes by default
- filtering strategy is hybrid:
  - deterministic hard reject first
  - optional OCR / vision enrichment
  - bounded LLM JSON adjudication second
  - rules-only fallback remains usable

## Workstreams

### 1. Runtime and collection

- add `xhs-rent-watch` CLI entrypoint under `news-bot`
- use Playwright persistent profile storage for Xiaohongshu session reuse
- harvest broad query results and dedupe by note ID / note URL
- load note detail pages, visible text, images, and a screenshot for optional OCR

### 2. Filtering and adjudication

- implement hard reject regex rules for female-only, roommate, room-only, shared-space, and non-SF cases
- add commute-friendly SF neighborhood heuristics
- extract rough summer availability from text
- add optional vision signal extraction and LLM adjudication with strict JSON validation

### 3. Persistence and delivery

- add watcher tables:
  - `housing_watch_runs`
  - `housing_watch_candidates`
  - `housing_watch_notifications`
- store note URL, query provenance, raw text, OCR text, decision reasons, and LLM artifacts
- dedupe candidate notifications by `note_id + decision`
- allow one re-alert when `maybe` later upgrades to `match`
- send Discord DMs directly from the watcher runtime

## Validation

- typecheck
- full test suite
- rule filter tests for female-only / roommate / shared-space rejection
- LLM parsing and fallback tests
- DB migration coverage for watcher tables
