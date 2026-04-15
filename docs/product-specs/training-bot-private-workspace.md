# Training Bot Private Workspace

This document describes the **public contract** for a private training bot scaffold.

It does **not** contain the bot's real personality, private memory, hidden operating rules, or secrets.

## Product Shape

The training bot is a separate OpenClaw agent for:

- workout scheduling and rescheduling
- diet logging and nutrition guidance
- weekly progress review
- mirrored updates to a bot-managed Notion duplicate

The public repo may describe the bot at this level only.

## Privacy Boundary

The real training bot brain must live in a workspace **outside** this repository.

Recommended EC2 path:

- `/srv/openclaw/workspace-training-private`

This private workspace is expected to contain:

- `SOUL.md`
- `AGENTS.md`
- `USER.md`
- `MEMORY.md`
- `HEARTBEAT.md`
- `.env.private`
- `memory/YYYY-MM-DD.md`
- `skills/training_ops/SKILL.md`
- `data/training-bot.sqlite`
- optional `scripts/`, `exports/`, and `scratch/`

None of those files should be copied into `workspace-template/` or committed into this repo.

The private `.env.private` file is also where the separate training Discord bot token,
dedicated channel ID, and Notion token should live. Those values must never be added to
repo-tracked files.

## Notion Contract

The bot should operate against a **bot-managed duplicate** of the workout plan, not the original page.

Recommended flow:

1. duplicate the original workout page
2. store the duplicate URL only in the private workspace
3. import and sync against the duplicate
4. preserve the original page as history/reference

## Bootstrap

Use:

```bash
bash ./scripts/setup-training-private-workspace.sh /srv/openclaw/workspace-training-private
```

Behavior:

- refuses any target inside the OpenSec repo
- creates the expected private folder structure
- writes placeholder private files only when missing
- leaves the real content to be authored privately
- leaves Discord bot credentials, channel IDs, and Notion credentials in `.env.private`

## Non-Negotiables

- do not commit the real training bot `SOUL.md`
- do not commit the real training bot `AGENTS.md`
- do not commit the real training bot `MEMORY.md`
- do not commit the real training bot `skills/training_ops/SKILL.md`
- do not commit secrets, tokens, channel IDs, or private user data
- do not point the bot at the original Notion page for writes
