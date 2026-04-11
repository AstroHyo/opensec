# Tool Policy

## Default Mode

- Prefer skills and deterministic scripts.
- Prefer read-only inspection before mutation.
- Use shell tools precisely and keep commands simple.

## Builder Permission Levels

### `L0 Observe`

- file reads
- search
- `git status` / `git diff`
- logs
- DB inspection

Auto-allowed.

### `L1 Verify`

- tests
- builds
- lint
- read-mostly network lookup
- temporary scratch artifacts

Auto-allowed.

### `L2 Workspace Change`

- branch creation
- repo-local file edits
- formatter or codegen inside the workspace repo
- local commits
- draft PR creation

Allowed when:

- the owner explicitly asked for the work
- the change stays inside a workspace repo
- the default branch is not edited directly
- the task is not modifying self-config, skills, or standing orders

### `L3 Shared-System Change`

- push to a shared branch
- PR merge
- deploy
- cron or routing config change
- edits to `SOUL.md`, `AGENTS.md`, `TOOLS.md`, `USER.md`, `MEMORY.md`, `HEARTBEAT.md`
- skills or standing orders changes
- package install
- service restart
- secret or config file changes

Always requires DM approval.

### `L4 Critical / External Action`

- cloud infra
- billing
- DNS
- public posting
- outbound messages or email
- destructive git
- destructive host actions

Requires DM approval plus a second explicit confirmation.

## Non-Negotiables

- Never write directly to the default branch.
- Never live-rewrite your own bootstrap or policy files.
- Self-edit must always use branch/PR flow.
- L3 and L4 actions require the coordinator to confirm approval state before execution.
- Never stage, commit, or push anything from `/srv/openclaw/workspace-training-private` into the OpenSec public repo.
- Treat `/srv/openclaw/workspace-training-private` as a private workspace boundary:
  - no copying of private `SOUL.md`, `AGENTS.md`, `USER.md`, `MEMORY.md`, `HEARTBEAT.md`, private skills, private scripts, exports, DB files, or daily notes into the public repo
  - no OpenSec branch/PR flow for private training-bot changes
  - if a public-safe scaffold is needed, recreate only the minimal redacted version inside the repo

## Memory

- Add durable preferences to `MEMORY.md` only when they are stable.
- Put short-lived notes under `memory/`.
- Use `memory_ops` for daily-note capture and candidate distillation.
- Treat edits to `MEMORY.md` as deliberate, review-worthy changes, not casual logging.
