# memory_ops

This skill handles file-based memory capture and distillation for the personal Discord workspace.

## When to use it

- Capture a meaningful Discord exchange into today's daily note
- Record new preferences, repo aliases, deployment facts, or recurring constraints
- Distill raw notes into durable-memory candidates
- Promote approved stable facts into `MEMORY.md`
- Support heartbeat runs that review recent daily notes

## Core rule

- Do not treat every conversation as memory.
- Daily notes are for raw but useful context.
- `MEMORY.md` is for stable facts only.

## Preferred files

- `./memory/YYYY-MM-DD.md`
- `./MEMORY.md`

## Helper command

Before writing a daily note, scaffold the file if needed:

```bash
bash ./projects/opensec/scripts/ensure-daily-memory-note.sh
```

This prints the note path and creates today's file with the standard sections if missing.

## Daily note capture flow

Use this flow when a Discord interaction reveals something worth keeping for at least a day:

1. Ensure today's note exists.
2. Append a short bullet under `## Discord Conversation Notes`.
3. If the note contains a potentially durable signal, add a short bullet under `## Candidate Signals`.

Good capture targets:

- stable communication preferences
- repo names or aliases that will matter again
- deployment or server facts
- recurring workflow constraints
- open loops likely to matter tomorrow
- process lessons that may become standing operating rules

Do not capture:

- whole chat transcripts
- filler chatter
- secrets or token-like strings
- private or sensitive details from DM unless the owner explicitly wants them stored

## Distillation flow

Use this flow when the owner asks to review memory or when heartbeat is enabled.

1. Review today's note and, when useful, the last 1 to 3 daily notes.
2. Convert repeated or clearly durable signals into concise bullets under `## Promotion Candidates`.
3. Keep each candidate tagged by kind:
   - `[preference]`
   - `[repo]`
   - `[server]`
   - `[constraint]`
   - `[workflow]`
4. Include a short reason when the durability is not obvious.

## Promotion flow

Only update `MEMORY.md` when one of these is true:

- the owner explicitly asks to remember something
- the owner approves a promotion candidate
- a DM-only approval path is already established for memory promotion

When promoting:

- merge with the smallest relevant section in `MEMORY.md`
- deduplicate instead of appending near-duplicates
- keep wording durable and general, not tied to one chat turn
- mark the promoted item under `## Promoted to MEMORY` in the daily note

## Heartbeat role

Heartbeat may use this skill to:

- ensure recent daily notes are reviewed
- suggest durable-memory candidates
- surface candidate promotions to `#assistant` or DM

Heartbeat must not:

- silently rewrite `MEMORY.md`
- promote candidates without approval
- pull private DM details into shared guild channels

## Good outputs

- note path updated
- bullets added or proposed
- whether a memory candidate should stay in daily notes or move to `MEMORY.md`
- whether owner approval is still needed
