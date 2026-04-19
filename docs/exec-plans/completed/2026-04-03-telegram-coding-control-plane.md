# 2026-04-03 Telegram Coding Control Plane

## Goal

Make the private Telegram DM setup capable of handling Codex-like coding tasks, not only news digests.

## Why

The repo already includes:

- a deterministic AI news pipeline
- OpenClaw workspace templates
- Telegram/OpenClaw configuration examples
- repo and system operation skills

What was missing was a clear, coding-focused skill and the workspace wiring that makes code-editing tasks feel like a first-class Telegram workflow.

## Scope

- add a coding workflow skill for OpenClaw
- sync that skill into the personal workspace bootstrap
- update routing docs so Telegram DM can use it intentionally
- clarify that the Telegram control plane covers repo editing as well as news workflows

## Non-Goals

- changing the deterministic news pipeline
- changing SQLite schema
- turning OpenClaw into a raw unrestricted shell
- replacing approval gates for risky host or git operations

## Deliverables

1. `skills/code_ops/SKILL.md`
2. workspace bootstrap sync for `code_ops`
3. updated workspace routing docs
4. updated architecture and setup docs

## Validation

- `bash -n scripts/setup-personal-workspace.sh`
- repo diff review for skill and documentation consistency
