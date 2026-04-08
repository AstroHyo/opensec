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
  - `primary_source_layer`
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

Important fields:

- `source_id`
- `source_type`
- `source_layer`
- `source_label`
- `source_url`
- `original_url`

Purpose:

- preserve source-specific evidence
- support cross-signal counting
- support `show sources for N`

Only primary and precision sources live here. Early-warning signals do not.

### `digests`

Stores each rendered digest snapshot.

- `profile_key`
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

- `profile_key`

Purpose:

- resend suppression
- section-slot history

### `followup_context`

Stores digest item context by displayed item number.

- `profile_key`

Purpose:

- `expand N`
- `why important N`
- `show sources for N`

### `source_runs`

Stores per-source fetch execution metadata.

- `profile_key`
- `source_id`
- `started_at`
- `completed_at`
- `status`
- `items_fetched`
- `items_normalized`
- `error_text`

### `llm_runs`

Stores optional LLM execution metadata.

- `profile_key`
- `run_type`
- `model_name`
- `prompt_version`
- `input_hash`
- `status`
- `latency_ms`
- `token_usage_json`
- `error_text`

### `item_enrichments`

Stores per-item LLM summary artifacts.

- `profile_key`
- `item_id`
- `llm_run_id`
- `prompt_version`
- `source_hash`
- `summary_ko`
- `why_important_ko`
- `confidence`
- `uncertainty_notes_json`
- `theme_tags_json`
- `officialness_note`

### `digest_enrichments`

Stores synthesized digest themes keyed by digest cache hash.

- `profile_key`
- `digest_cache_key`
- `digest_mode`
- `llm_run_id`
- `prompt_version`
- `themes_json`

### `signal_events`

Stores early-warning social signals independently from normalized stories.

Important fields:

- `source_id`
- `source_layer`
- `actor_label`
- `actor_handle`
- `post_url`
- `linked_url`
- `title`
- `excerpt`
- `published_at`
- `fetched_at`
- `metrics_json`
- `metadata_json`

These records can exist without any digest-visible story match.

### `signal_event_matches`

Links early-warning signals onto existing normalized items.

- `signal_event_id`
- `item_id`
- `match_type`
- `boost_score`
- `created_at`

## Current Derived Signals

Important runtime-derived values are computed from joins or subqueries:

- `last_sent_at`
- `cross_signal_count`
- matched signal records for each normalized item

`cross_signal_count` intentionally counts only primary/precision source sightings, not early-warning social signals.

## Profile Model

The schema now splits state into:

- global evidence
- profile-scoped context

### Shared global evidence

- `raw_items`
- `normalized_items`
- `item_sources`
- `signal_events`
- `signal_event_matches`

These tables represent raw evidence or canonical merged stories and are shared across profiles.

### Profile-scoped context

- `digests`
- `sent_items`
- `followup_context`
- `source_runs`
- `llm_runs`
- `item_enrichments`
- `digest_enrichments`

These tables use `profile_key` so `tech` and `finance` can:

- rank the same normalized story differently
- store different rendered summaries
- keep separate resend suppression
- answer follow-ups from the right digest namespace

## Current Source Families

### Tech profile

- OpenAI RSS
- GitHub Trending
- GeekNews
- Techmeme
- Hacker News

### Finance profile

- Federal Reserve press feed
- SEC press feed
- Treasury press page
- BLS release pages:
  - CPI
  - Jobs
  - PPI
  - ECI
- major-company SEC filings
