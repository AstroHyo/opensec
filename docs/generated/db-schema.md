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
- reuse saved insight fields and evidence metadata without live refetch

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

Stores per-item LLM insight artifacts.

- `profile_key`
- `item_id`
- `llm_run_id`
- `prompt_version`
- `source_hash`
- compatibility fields:
  - `summary_ko`
  - `why_important_ko`
- v2 insight fields:
  - `what_changed_ko`
  - `engineer_relevance_ko`
  - `ai_ecosystem_ko`
  - `openai_angle_ko`
  - `trend_signal_ko`
  - `cause_effect_ko`
  - `watchpoints_json`
  - `evidence_spans_json`
  - `novelty_score`
  - `insight_score`
- `confidence`
- `uncertainty_notes_json`
- `theme_tags_json`
- `officialness_note`

Purpose:

- cache structured insight extraction per item
- support bounded rerank deltas
- support deeper follow-up rendering

### `article_contexts`

Stores bounded full-read context for shortlisted items.

- `item_id`
- `source_hash`
- `canonical_url`
- `fetch_status`
- `publisher`
- `author`
- `published_at`
- `headline`
- `dek`
- `clean_text`
- `key_sections_json`
- `evidence_snippets_json`
- `word_count`
- `fetched_at`

Purpose:

- preserve reusable evidence beyond feed snippets
- let follow-ups use stored article or README context
- keep enrichment cacheable by source hash

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

### `housing_watch_runs`

Stores each Xiaohongshu watcher execution.

- `started_at`
- `completed_at`
- `status`
- `queries_json`
- `harvested_count`
- `candidate_count`
- `notified_count`
- `error_text`
- `stats_json`

### `housing_watch_candidates`

Stores deduplicated Xiaohongshu housing posts and their latest evaluation state.

Important fields:

- `note_id`
- `note_url`
- `search_queries_json`
- `body_text`
- `page_text`
- `ocr_text`
- `image_urls_json`
- `hard_filter_decision`
- `hard_filter_reasons_json`
- `llm_prompt_version`
- `llm_model_name`
- `llm_input_hash`
- `llm_output_json`
- `decision`
- `decision_reasons_json`
- `unit_type`
- `whole_unit`
- `female_only`
- `shared_space`
- `roommate_only`
- `availability_summary`
- `commute_friendly`
- `raw_payload_json`

Purpose:

- keep original note evidence
- support dedupe across many search queries
- preserve OCR / LLM artifacts for debugging
- track `maybe -> match` promotion without resending duplicates

### `housing_watch_notifications`

Stores direct Discord DM delivery attempts for housing watcher alerts and maintenance notices.

- `candidate_id`
- `notification_type`
- `delivery_key`
- `destination_user_id`
- `status`
- `message_text`
- `error_text`
- `created_at`
- `sent_at`

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

## Housing Watcher State

The housing watcher tables are separate from the profile-scoped news engine tables.

- they do not use `profile_key`
- they do not affect digest ranking or follow-up context
- they store watcher-specific evidence, adjudication, and delivery state

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
