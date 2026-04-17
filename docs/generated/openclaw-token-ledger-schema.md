# OpenClaw Token Ledger Schema

Default ledger path:

- `~/.openclaw/telemetry/token-usage.sqlite`

## `token_usage_events`

One row per real token-using event.

Important fields:

- source identity:
  - `event_key`
  - `source_kind`
  - `source_path`
- time:
  - `observed_at`
  - `ledger_date`
- runtime context:
  - `agent_id`
  - `session_id`
  - `session_key`
  - `session_label`
  - `surface`
  - `chat_type`
  - `account_id`
  - `conversation_label`
- model identity:
  - `provider`
  - `model_name`
  - `model_api`
- task context:
  - `event_type`
  - `message_role`
  - `stop_reason`
  - `run_status`
  - `profile_key`
  - `run_type`
  - `task_key`
  - `task_tier`
- usage:
  - `input_tokens`
  - `cached_input_tokens`
  - `cache_write_tokens`
  - `output_tokens`
  - `total_tokens`
- cost:
  - `input_cost_usd`
  - `cached_input_cost_usd`
  - `cache_write_cost_usd`
  - `output_cost_usd`
  - `total_cost_usd`
- audit:
  - `latency_ms`
  - `error_text`
  - `raw_json`
  - `inserted_at`

Current `source_kind` values:

- `openclaw_session`
- `app_llm_run`

## `collector_state`

Stores incremental cursors for safe repeated syncs.

Examples:

- `cursor:file:/home/ubuntu/.openclaw/agents/main/sessions/....jsonl`
- `cursor:llm_runs:/srv/openclaw/workspace-personal/.../news-bot.sqlite`
