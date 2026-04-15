# ai_news_brief

This skill runs the local deterministic news briefing bot for private OpenClaw workspaces, now with profile-aware `tech` and `finance` briefs.

## When to use it
- Scheduled AM digest at 10:00 America/New_York
- Scheduled PM digest at 20:00 America/New_York
- Discord or Telegram follow-up commands like:
  - `brief now`
  - `am brief now`
  - `pm brief now`
  - `openai only`
  - `repo radar`
  - `expand N`
  - `show sources for N`
  - `why important N`
  - `today themes`
  - `ask <질문>`
  - `research <질문>`

## Rules
- Do not browse the web directly for discovery.
- Always prefer the deterministic local pipeline in the OpenSec repo.
- Use exec to run the local scripts.
- Return the script output as-is unless the user explicitly asks for explanation.
- If the script fails because setup is incomplete, reply with the shortest actionable TODO.
- Default profile mapping:
  - `#tech-brief` -> `tech`
  - `#finance-brief` -> `finance`
  - `#assistant` / `#research` -> explicit profile or most recent thread profile

## Repo path convention

Prefer this path in the personal workspace:

- `./projects/opensec/news-bot`

If the current workspace is already the OpenSec repo root, you may use:

- `./news-bot`

## Commands
- AM digest:
  - `pnpm --dir ./projects/opensec/news-bot digest --mode am --profile tech`
- PM digest:
  - `pnpm --dir ./projects/opensec/news-bot digest --mode pm --profile tech`
- Finance AM digest:
  - `pnpm --dir ./projects/opensec/news-bot digest --mode am --profile finance`
- Finance PM digest:
  - `pnpm --dir ./projects/opensec/news-bot digest --mode pm --profile finance`
- Manual follow-up:
  - `pnpm --dir ./projects/opensec/news-bot followup --profile tech "<original user message>"`
- Fetch only:
  - `pnpm --dir ./projects/opensec/news-bot fetch --profile tech`

## Intent routing
- `brief now`: run the digest matching current ET time. Before 15:00 ET use AM, otherwise PM.
- `am brief now`: run AM digest now.
- `pm brief now`: run PM digest now.
- `openai only`: use stored context. Do not refetch.
- `repo radar`: use stored context. Do not refetch.
- `expand N`: use stored context and show the fuller explanation for item `N`.
- `show sources for N`: list stored source links for item `N`.
- `why important N`: list stored scoring reasons for item `N`.
- `today themes`: show the latest stored theme bullets.
- `ask <질문>`: answer from stored digest evidence with LLM help when available, and deterministic fallback otherwise.
- `research <질문>`: do opt-in live LLM web research starting from stored digest context. If live research is unavailable, fall back to stored digest evidence and say so clearly.

## Profile rules

- `tech`:
  - AI, tooling, OpenAI, repos, developer workflow
- `finance`:
  - macro, policy, regulation, and major-company signals
- Keep evidence namespaces separate by profile even when the same canonical article appears in both.
