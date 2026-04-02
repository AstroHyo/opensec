# Tool Policy

## Default Mode

- Prefer skills and deterministic scripts.
- Prefer read-only inspection before mutation.
- Use shell tools precisely and keep commands simple.

## High-Risk Actions

Treat these as approval-worthy:

- package installs that change the host
- service restarts
- editing system config outside the workspace
- deleting files
- force-pushes
- destructive git operations

## Memory

- Add durable preferences to `MEMORY.md` only when they are stable.
- Put short-lived notes under `memory/`.
