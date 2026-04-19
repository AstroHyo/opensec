# 2026-04-08 Discord Personal Control Plane v1.1

## Summary

Expand OpenSec from a Telegram-centered single news bot into a Discord-first personal control plane with:

- one visible coordinator
- hidden builder and researcher specialist behavior
- profile-driven `tech` and `finance` briefs
- DM-only approval for risky actions
- file-based memory first
- GitOps-only self-editing

## Locked Decisions

- Discord is the primary channel surface
- Telegram can remain as fallback or legacy
- initial profiles are `tech` and `finance`
- finance scope is `macro + major companies`
- channels are:
  - `#assistant`
  - `#tech-brief`
  - `#finance-brief`
  - `#research`
  - `#coding`
- brief channels are `broadcast + follow-up`
- `#coding` delegates into builder behavior
- mention-gated Discord starts on by default
- risky approvals are DM only
- heartbeat starts disabled

## Delivered Workstreams

### 1. Profile-aware news engine

- introduced `ProfileKey = tech | finance`
- added profile configs and source routing
- added finance primary sources
- made digests, follow-up context, resend suppression, source runs, and enrichments profile-scoped
- kept raw evidence global

### 2. Finance profile

- added Fed press, SEC press, Treasury press, BLS release pages, and major-company SEC filings
- added finance scoring, summary, why-important, and section logic
- preserved deterministic digest generation

### 3. Discord-first workspace bootstrap

- updated workspace templates for:
  - coordinator routing
  - channel escalation
  - ENTJ-like warm-sharp personality
  - builder permission levels
  - heartbeat criteria
- updated the personal OpenClaw example config to Discord-first shape
- added Discord cron installation helper for `tech` and `finance` brief channels

### 4. Safety and execution policy

- formalized builder action levels `L0` through `L4`
- locked DM approval for `L3` and `L4`
- made self-edit branch/PR only
- kept private memory out of shared guild channels by default

## Acceptance Criteria

- `tech` and `finance` digests can be generated independently
- follow-up lookup never falls back to a global latest digest
- resend suppression is profile-scoped
- shared normalized evidence can feed both profiles
- Discord workspace templates reflect channel routing, escalation, and approval policy
- heartbeat remains documented but disabled-by-default

## Validation

- typecheck
- full test suite
- dedicated profile namespace tests

## Follow-on Work

- actual Discord server rollout and channel ID binding
- standing orders tuned per channel
- coordinator-to-specialist delegation polish
- heartbeat enablement only after stability thresholds are met
