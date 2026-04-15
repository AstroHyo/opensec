# repo_ops

This skill handles day-to-day repository work inside the personal workspace.

## When to use it

- Inspect a repo status or diff
- Pull latest changes
- Run tests or lint
- Summarize a branch or recent commit history
- Answer questions like:
  - `check repo-a status`
  - `pull latest in opensec and summarize`
  - `run tests in repo-b`
  - `what changed on this branch`

For code edits, branch work, and implementation requests, prefer `code_ops`.

## Default repo convention

Prefer repositories under:

- `./projects/<repo-name>`

If the user names a repo, resolve it there first.

## Operating rules

- Start with read-only inspection:
  - `git status -sb`
  - relevant test or lint command
  - targeted file reads
- Do not stage or commit unrelated user changes.
- Do not use destructive git commands unless the user explicitly asks.
- If the worktree is mixed, operate only on the relevant repo and files.
- Summarize the exact commands you ran and the result.

## Common flows

### Inspect

- `cd ./projects/<repo-name>`
- `git status -sb`
- inspect files or tests

### Pull and summarize

- `cd ./projects/<repo-name>`
- `git pull --ff-only`
- summarize changed files and key behavior

### Validate

- run the repo’s relevant test, check, or build command

## Good outputs

- what changed
- what is failing or passing
- what still needs approval or confirmation
