# OpenSec AI News Brief

Deterministic single-user AI news briefing bot for a Linux VPS. It fetches AI/news/tooling signals locally, stores them in SQLite, renders Korean Telegram-ready digests, and exposes follow-up commands through OpenClaw.

## What it does
- Fetches and normalizes:
  - GeekNews / `https://news.hada.io/rss/news`
  - OpenAI official news via `https://openai.com/news/rss.xml`
  - GitHub Trending overall + `python` + `typescript` + `javascript` + `rust`
- Deduplicates with:
  - canonical URL normalization
  - normalized title hash
  - fuzzy title similarity fallback
- Stores local state in SQLite:
  - `raw_items`
  - `normalized_items`
  - `digests`
  - `sent_items`
  - `followup_context`
  - `source_runs`
- Scores by:
  - source authority
  - freshness
  - user-interest keywords
  - repo traction
  - methodology boost
  - OpenAI official priority
  - cross-signal boost
- Suppresses resend for 72 hours by default.
- Supports follow-up commands from Telegram or shell:
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
- Optionally enriches selected digest items with OpenAI for:
  - more natural Korean summaries
  - sharper `왜 중요한지`
  - better day-level theme bullets
  - post-digest `ask` answers over stored evidence
  - opt-in `research` answers with live web search and cited links

## Project layout
```text
news-bot/
  package.json
  tsconfig.json
  .env.example
  README.md
  openclaw.telegram.example.jsonc
  fixtures/
    sample-items.json
  scripts/
    dry-run-am.sh
    dry-run-pm.sh
    install-cron.sh
  src/
    index.ts
    config.ts
    db.ts
    types.ts
    scoring.ts
    digest/
      buildDigest.ts
      renderTelegram.ts
    sources/
      index.ts
      geeknews.ts
      openaiNews.ts
      githubTrending.ts
      optional/
        README.md
    commands/
      runDigest.ts
      followup.ts
    util/
      canonicalize.ts
      dedupe.ts
      http.ts
      text.ts
      timeWindow.ts
  tests/
    dedupe.test.ts
    scoring.test.ts
    render.test.ts
skills/
  ai_news_brief/
    SKILL.md
```

## Setup
1. Install dependencies.
   ```bash
   cd /opt/ai-news-brief/news-bot
   pnpm install
   ```
   If pnpm blocks native build scripts, approve:
   ```bash
   pnpm approve-builds
   ```
   Approve `better-sqlite3` and `esbuild`.
2. Configure secrets.
   ```bash
   cp .env.example .env
   ```
3. Fill in:
   - `NEWS_BOT_TELEGRAM_USER_ID`
   - `TELEGRAM_BOT_TOKEN`
   - optionally `OPENAI_API_KEY`
4. Run quick validation.
   ```bash
   pnpm test
   ./scripts/dry-run-am.sh
   ./scripts/dry-run-pm.sh
   ```
5. Optional LLM follow-up tuning:
   - `NEWS_BOT_LLM_MODEL_SUMMARY`
   - `NEWS_BOT_LLM_MODEL_THEMES`
   - `NEWS_BOT_LLM_MODEL_RESEARCH`

## Local commands
- Fetch latest source state only:
  ```bash
  pnpm run fetch
  ```
- Run AM digest now:
  ```bash
  pnpm run digest:am
  ```
- Run PM digest now:
  ```bash
  pnpm run digest:pm
  ```
- Ask a follow-up against stored context:
  ```bash
  pnpm run followup -- "show sources for 2"
  ```
- Ask for a richer stored-evidence explanation:
  ```bash
  pnpm run followup -- "ask 오늘 OpenAI 뉴스만 우리 관점으로 다시 요약해줘"
  ```
- Run opt-in live research with citations:
  ```bash
  pnpm run followup -- "research 2번 뉴스 관련 최신 공식 반응까지 찾아줘"
  ```

## OpenClaw Telegram config
Patch your OpenClaw config with the confirmed Telegram keys shown in [`openclaw.telegram.example.jsonc`](./openclaw.telegram.example.jsonc):

```jsonc
{
  "channels": {
    "telegram": {
      "enabled": true,
      "botToken": "123456789:replace-me",
      "dmPolicy": "allowlist",
      "allowFrom": ["123456789"],
      "linkPreview": false
    }
  },
  "cron": {
    "enabled": true,
    "sessionRetention": "24h",
    "runLog": {
      "maxBytes": "2mb",
      "keepLines": 2000
    }
  }
}
```

Notes:
- `dmPolicy: "allowlist"` plus `allowFrom` makes the bot single-owner.
- Start or attach OpenClaw in the workspace root so `skills/ai_news_brief/SKILL.md` is available.

## Exact cron commands
The helper script wraps these exact commands:

```bash
  openclaw cron add \
  --name "AI News Brief AM" \
  --cron "0 10 * * *" \
  --tz "America/New_York" \
  --session isolated \
  --expect-final \
  --timeout-seconds 600 \
  --announce \
  --channel telegram \
  --to "$TELEGRAM_USER_ID" \
  --message "Use the ai_news_brief skill in the workspace at /opt/ai-news-brief. Run \`pnpm --dir /opt/ai-news-brief/news-bot digest:am\` via exec. Return only the script output so it can be sent to Telegram as-is. Do not browse the web manually unless the script fails."

openclaw cron add \
  --name "AI News Brief PM" \
  --cron "0 20 * * *" \
  --tz "America/New_York" \
  --session isolated \
  --expect-final \
  --timeout-seconds 600 \
  --announce \
  --channel telegram \
  --to "$TELEGRAM_USER_ID" \
  --message "Use the ai_news_brief skill in the workspace at /opt/ai-news-brief. Run \`pnpm --dir /opt/ai-news-brief/news-bot digest:pm\` via exec. Return only the script output so it can be sent to Telegram as-is. Do not browse the web manually unless the script fails."
```

Or run:

```bash
TELEGRAM_USER_ID=123456789 ./scripts/install-cron.sh
```

## Telegram setup
1. Create a bot with `@BotFather`.
2. Put the token in `TELEGRAM_BOT_TOKEN`.
3. DM the bot once from your personal account.
4. Get your numeric user ID.
   - A quick way is to inspect the update payload from Telegram or use any trusted ID helper bot.
5. Put the ID in:
   - `NEWS_BOT_TELEGRAM_USER_ID`
   - OpenClaw `allowFrom`
   - `TELEGRAM_USER_ID` when installing cron

## Design choices
- OpenAI uses the official RSS feed because the HTML newsroom is Cloudflare-protected in headless VPS contexts. The adapter still preserves newsroom section labels and URLs.
- GeekNews is a discovery signal. It is not treated as authoritative truth by itself.
- GitHub Trending is filtered for AI/tooling relevance, so novelty repos do not make Repo Radar just because they are popular.
- The daily digest does not depend on live model discovery.
- LLM enrichment is optional and runs only after deterministic fetch, dedupe, ranking, and item selection.
- Live `research` is opt-in and happens only after the digest has already been generated.

## Dry-run examples
- AM:
  ```bash
  ./scripts/dry-run-am.sh
  ```
- PM:
  ```bash
  ./scripts/dry-run-pm.sh
  ```

## TODOs you must fill in
- Telegram bot token
- Telegram numeric owner user ID
- Actual VPS install path used in cron prompts if not `/opt/ai-news-brief`
- OpenClaw config merge in the correct host profile

## Acceptance checks covered
- `./scripts/dry-run-am.sh`
- `./scripts/dry-run-pm.sh`
- `pnpm test`
- `pnpm run followup -- "show sources for 2"`
