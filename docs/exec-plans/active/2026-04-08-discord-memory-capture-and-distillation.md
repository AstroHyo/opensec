# 2026-04-08 Discord Memory Capture and Distillation

## Summary

Add a semi-automatic memory loop for the Discord-first personal workspace:

- meaningful Discord context lands in `memory/YYYY-MM-DD.md`
- stable facts are distilled into promotion candidates
- `MEMORY.md` only changes through approved promotion

## Goals

- keep shared guild-channel context out of private durable memory by default
- avoid transcript dumping
- make daily notes easy to scaffold and use
- let heartbeat suggest memory candidates without mutating durable memory

## Delivered Work

### 1. Memory skill

- added `memory_ops`
- documented capture, distillation, and promotion flows
- connected the skill to daily-note and heartbeat usage

### 2. Memory scaffolding

- added a helper script to create today's daily note with the standard sections
- added `workspace-template/memory/README.md`
- synced the new skill and memory template through `setup-personal-workspace.sh`

### 3. Workspace policy

- updated `AGENTS.md` with memory capture triggers and promotion rules
- updated `MEMORY.md` guidance to stay durable and curated
- updated `HEARTBEAT.md` so heartbeat proposes candidates but never auto-promotes
- updated `USER.md` and `TOOLS.md` to reflect the memory loop

## Acceptance Criteria

- the workspace can scaffold a daily note with one command
- daily-note memory capture is documented as distinct from durable memory
- heartbeat behavior stays non-mutating
- `MEMORY.md` promotion remains approval-gated

## Validation

- `bash -n scripts/ensure-daily-memory-note.sh`
- temp-workspace scaffold run for the daily note helper
- template sync path verified through `setup-personal-workspace.sh`
