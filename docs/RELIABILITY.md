# RELIABILITY.md

## Reliability Goals

- Digest generation should still succeed when one source fails.
- Digest generation should still succeed when the LLM is unavailable.
- Follow-up commands should use stored context and avoid unnecessary refetching.
- Failure should degrade quality, not availability.

## Required Fallbacks

### Source Failure

- log failed source run
- continue with remaining sources
- produce partial digest if quality remains acceptable

### LLM Failure

- skip enrichment
- fall back to deterministic summary templates
- still persist digest and follow-up context

### Telegram or OpenClaw Failure

- keep local digest body in SQLite
- allow manual resend from shell

## Operational Checks

- `pnpm --dir ./news-bot test`
- `pnpm --dir ./news-bot digest:am`
- `pnpm --dir ./news-bot digest:pm`
- dry-run fixture commands before major ranking or rendering changes
