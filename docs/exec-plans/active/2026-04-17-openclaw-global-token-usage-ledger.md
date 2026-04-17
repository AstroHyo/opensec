# OpenClaw Global Token Usage Ledger

## Summary

Add a central SQLite ledger for token usage across the whole OpenClaw runtime.

This ledger must cover:

- all OpenClaw agent sessions
- chat and cron turns
- hidden agents and fallback agents
- direct app-side LLM calls that do not pass through OpenClaw session logs, starting with `news-bot llm_runs`

The OpenSec repo will not modify OpenClaw source itself.
Instead, it will ship a sidecar collector and reporting layer that reads existing runtime artifacts.

## Goals

1. capture every real token-using event from OpenClaw session logs
2. capture direct app-level LLM runs that bypass OpenClaw session logs
3. keep one central ledger for audit and cost review
4. make collection incremental and safe to run every minute
5. keep the runtime change deployable without rebuilding OpenClaw

## Scope

### In scope

- `scripts/openclaw/token_usage_ledger.py`
  - `sync`
  - `report`
- user-level timer install helper
- central SQLite schema
- docs for schema and control-plane architecture
- generic discovery of `llm_runs` SQLite sources under `/srv/openclaw/workspace-*`

### Out of scope

- modifying OpenClaw upstream internals
- forcing every app in every repo to adopt the same `llm_runs` schema immediately
- billing reconciliation against provider dashboards beyond local estimated totals

## Source Of Truth Strategy

### 1. OpenClaw session logs

Primary runtime truth:

- `~/.openclaw/agents/*/sessions/*.jsonl`
- usage comes from assistant `message.usage`

This catches:

- visible agents
- hidden agents
- cron sessions
- chat sessions
- fallback or deep specialist sessions

### 2. Direct app-level `llm_runs`

Secondary truth for work done outside OpenClaw session routing:

- discover SQLite files under `/srv/openclaw/workspace-*`
- import rows from tables named `llm_runs`

This starts with `news-bot`, and creates a generic adapter path for future apps.

## Ledger Schema

Central DB default path:

- `~/.openclaw/telemetry/token-usage.sqlite`

Main tables:

- `token_usage_events`
- `collector_state`

`token_usage_events` stores:

- source type
- source path
- observed time
- agent and session identity when available
- provider, model, API
- task metadata when available
- input, cached input, output, total tokens
- estimated cost fields
- raw source JSON for audit

`collector_state` stores incremental cursors:

- per-session-file byte offset
- per-`llm_runs` DB last imported id

## Rollout

1. add collector and report scripts in the repo
2. add tests using fixture session logs and a fixture `llm_runs` DB
3. deploy repo changes to the live OpenClaw workspace
4. install a user-level timer that runs `sync` every minute
5. run an initial backfill
6. verify report output and row growth after new chat or cron activity

## Acceptance

- at least one `main` session event lands in the ledger
- at least one `training` session event lands in the ledger
- at least one `news-bot` direct `llm_runs` row lands in the ledger
- repeated `sync` runs are idempotent
- new appended session log lines are picked up without reimporting old lines
- the 7-day report shows totals by source, agent, and model
