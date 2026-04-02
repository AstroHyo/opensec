# DB Schema

This document reflects the SQLite schema currently defined in `news-bot/src/db.ts`.

## Tables

### `raw_items`

Stores raw fetch payloads per source event.

- `source_id`
- `external_id`
- `fetched_at`
- `source_url`
- `content_hash`
- `payload_json`

Purpose:

- audit source fetches
- avoid duplicate raw inserts

### `normalized_items`

Canonical story or repo records used by ranking and digest generation.

Important fields:

- canonical identity:
  - `canonical_url`
  - `normalized_title`
  - `title_hash`
- source metadata:
  - `source_type`
  - `primary_source_id`
  - `primary_source_label`
  - `source_authority`
  - `source_labels_json`
- time metadata:
  - `published_at`
  - `first_seen_at`
  - `last_seen_at`
  - `last_updated_at`
- content metadata:
  - `item_kind`
  - `openai_category`
  - `geeknews_kind`
  - repo fields
  - `description`
  - `content_text`
- evidence:
  - `source_url`
  - `original_url`
  - `metadata_json`
  - `keywords_json`

### `item_sources`

Many-to-one table from source sightings to a normalized item.

Purpose:

- preserve source-specific evidence
- support cross-signal counting
- support `show sources for N`

### `digests`

Stores each rendered digest snapshot.

- `mode`
- `generated_at`
- `window_start`
- `window_end`
- `header`
- `body_text`
- `items_json`
- `themes_json`
- `stats_json`

### `sent_items`

Tracks which normalized items were included in which digest and when.

Purpose:

- resend suppression
- section-slot history

### `followup_context`

Stores digest item context by displayed item number.

Purpose:

- `expand N`
- `why important N`
- `show sources for N`

### `source_runs`

Stores per-source fetch execution metadata.

- `source_id`
- `started_at`
- `completed_at`
- `status`
- `items_fetched`
- `items_normalized`
- `error_text`

## Current Derived Signals

Two important runtime-derived values are computed from joins or subqueries:

- `last_sent_at`
- `cross_signal_count`

These are not persisted directly in `normalized_items` today.

## Likely Future LLM Tables

Planned but not yet implemented:

- `llm_runs`
- `item_enrichments`
- `digest_enrichments`
