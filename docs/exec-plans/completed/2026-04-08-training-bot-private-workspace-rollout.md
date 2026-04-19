# 2026-04-08 Training Bot Private Workspace Rollout

## Summary

Add a second OpenClaw agent scaffold for private fitness/nutrition coaching.

The public repo must contain only:

- safety rails
- bootstrap script
- high-level public contract

The real persona, memory, hidden workflow, and secrets must live only in a private workspace outside the repo.

## Implemented Public Changes

- added gitignore defense-in-depth entries for likely private training workspace paths
- added `scripts/setup-training-private-workspace.sh`
- added a public product spec for the private workspace contract
- updated architecture docs and indexes to reflect the private specialist-workspace pattern

## Private Runtime Target

- separate agent: `training`
- separate workspace: `/srv/openclaw/workspace-training-private`
- separate Discord bot/account and separate channel
- separate private DB and private memory files

## Out of Public Scope

- real `SOUL.md`
- real `AGENTS.md`
- real `MEMORY.md`
- real `training_ops` skill logic
- secrets and owner-specific data
