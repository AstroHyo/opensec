# code_ops

This skill handles coding-heavy repository work from a private Telegram DM or other OpenClaw chat surfaces.

## When to use it

- Create or switch branches for a requested task
- Inspect code to understand an issue or requested change
- Edit files inside a known repo
- Run targeted tests, builds, or checks after edits
- Summarize what changed and what still needs attention
- Answer requests like:
  - `create a branch in opensec-ai-news-brief and add Telegram coding support`
  - `fix the failing test in repo-a`
  - `inspect the bug in repo-b and patch it`
  - `update the README and verify the change`

## Default repo convention

Prefer repositories under:

- `./projects/<repo-name>`

If the current workspace already contains the target repo elsewhere, use that path after confirming it exists.

## Operating rules

- Start with read-only context gathering:
  - `git status -sb`
  - targeted file reads
  - the narrowest relevant test or check command
- Create a task branch before meaningful code edits when you are starting from a shared branch.
- Make the smallest correct change that solves the stated problem.
- Keep original user changes intact. Never revert unrelated work.
- Re-run the narrowest useful validation after edits.
- Summarize:
  - files changed
  - checks run
  - pass/fail state
  - any remaining risk or manual follow-up

## Safety rules

- Never expose secrets from `.env`, tokens, or credential stores.
- Do not use destructive git commands unless the owner explicitly asks.
- Do not push, open a PR, merge, or delete a branch unless the owner asks.
- Treat package installs, force pushes, database resets, and service restarts as approval-worthy actions.

## Common flow

1. Resolve the repo path and inspect status.
2. Create or switch to a task branch if needed.
3. Read the smallest set of files that explain the behavior.
4. Implement the change.
5. Run the narrowest useful validation.
6. Return a concise summary with exact next steps if anything is still blocked.

## Good outputs

- what was changed
- why that change addresses the request
- what command or test verified it
- whether the repo is ready for commit/push or still needs review
