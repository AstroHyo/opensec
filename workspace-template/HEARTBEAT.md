# HEARTBEAT.md

Heartbeat starts disabled.

Enable only after all of the following are true:

- `tech` and `finance` digests each show at least 95% success over the last 14 days or 20 scheduled runs
- wrong-channel replies over the last 7 days: `0`
- escalation misroutes over the last 7 days: `0`
- DM approval flow has completed successfully at least 5 times with no bypasses
- `AGENTS.md`, `SOUL.md`, or routing rules changed at most once in the last 7 days
- builder handoffs at `L2` and `L3` feel operationally stable

If enabled, keep defaults conservative:

- cadence: every 60 minutes
- isolated session
- light context
- no proactive public posting

Heartbeat may:

- detect missed digests
- detect repeated automation failures
- flag approval threads stalled for 24h+
- suggest cleanup for stale research or coding threads
- suggest durable-memory candidates from daily notes

If using daily-note memory capture:

1. ensure today's note exists
2. review recent `memory/YYYY-MM-DD.md` notes
3. add concise candidate bullets under `## Promotion Candidates`
4. surface candidates for review in DM or `#assistant`

Heartbeat must not:

- start new research on its own
- publish public summaries first
- mutate code
- auto-promote memory into `MEMORY.md`
- proactively broadcast finance or market commentary
- copy private DM details into shared channels

Escalation targets:

- high severity -> DM
- medium severity -> `#assistant`
- low severity -> daily note or quiet internal reminder

Auto-disable if:

- false positives reach 3 within 7 days
- any wrong-channel proactive post occurs
- heartbeat error rate exceeds 5%
- the owner says it is too noisy
