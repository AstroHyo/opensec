# OpenSec AI News Brief

Deterministic single-user AI news briefing bot for OpenClaw and Telegram. It fetches curated AI and tooling signals locally, stores state in SQLite, renders Korean digests, and supports follow-up questions from stored digest context.

## What it does

- Fetches from three source layers:
  - `primary`: OpenAI official RSS, GitHub Trending
  - `precision`: GeekNews, Techmeme, Hacker News
  - `early_warning`: Bluesky watchlist signals
- Normalizes and deduplicates by:
  - canonical URL normalization
  - normalized title hashing
  - fuzzy title similarity fallback
- Persists local state in SQLite for:
  - raw fetches
  - normalized items
  - digest history
  - resend suppression
  - follow-up context
  - early-warning signal events and matches
- Scores deterministically with:
  - source authority
  - freshness
  - keyword and methodology matches
  - repo traction
  - precision-layer boosts
  - early-warning boosts
  - cross-signal boosts
- Renders Telegram-ready Korean digests with preserved evidence:
  - canonical link
  - source labels
  - source link list
  - score reasons
  - optional signal links
- Supports follow-up modes:
  - deterministic commands such as `show sources for 2`
  - bounded LLM explanation with `ask <질문>`
  - opt-in live web research with `research <질문>`

## Core rules

- Daily digest generation stays deterministic.
- Precision sources may introduce or strengthen candidates.
- Early-warning sources never create standalone digest items.
- LLMs are optional explanation and research layers, not the retrieval core.
- Original evidence is preserved even when summaries are enriched.

## Supported commands

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
      layers.ts
      relevance.ts
      openaiNews.ts
      githubTrending.ts
      geeknews.ts
      techmeme.ts
      hackerNews.ts
      blueskySignals.ts
      blueskyWatchlist.ts
    commands/
      runDigest.ts
      followup.ts
      followupAnswer.ts
      followupResearch.ts
    util/
      canonicalize.ts
      dedupe.ts
      http.ts
      text.ts
      timeWindow.ts
  tests/
    dedupe.test.ts
    followup.test.ts
    render.test.ts
    scoring.test.ts
    sourcingLayers.test.ts
skills/
  ai_news_brief/
    SKILL.md
```

## Setup

1. Install dependencies.
   ```bash
   pnpm --dir ./news-bot install
   ```
2. Create local environment variables.
   ```bash
   cp ./news-bot/.env.example ./news-bot/.env
   ```
3. Fill in the required values:
   - `NEWS_BOT_TELEGRAM_USER_ID`
   - `TELEGRAM_BOT_TOKEN`
   - optionally `OPENAI_API_KEY`
4. Run validation.
   ```bash
   pnpm --dir ./news-bot check
   pnpm --dir ./news-bot test
   bash ./news-bot/scripts/dry-run-am.sh
   bash ./news-bot/scripts/dry-run-pm.sh
   ```

## Environment variables

Base configuration:

- `NEWS_BOT_TIMEZONE`
- `NEWS_BOT_LANGUAGE`
- `NEWS_BOT_DB_PATH`
- `NEWS_BOT_HTTP_TIMEOUT_MS`
- `NEWS_BOT_TELEGRAM_USER_ID`
- `TELEGRAM_BOT_TOKEN`

Precision and signal sourcing:

- `NEWS_BOT_HN_TOP_LIMIT`
- `NEWS_BOT_HN_NEW_LIMIT`
- `NEWS_BOT_BLUESKY_ENABLED`
- `NEWS_BOT_SIGNAL_WINDOW_HOURS`
- `NEWS_BOT_BLUESKY_MAX_POSTS_PER_ACTOR`

Optional LLM behavior:

- `OPENAI_API_KEY`
- `NEWS_BOT_LLM_ENABLED`
- `NEWS_BOT_LLM_THEMES_ENABLED`
- `NEWS_BOT_LLM_RERANK_ENABLED`
- `NEWS_BOT_LLM_MODEL_SUMMARY`
- `NEWS_BOT_LLM_MODEL_THEMES`
- `NEWS_BOT_LLM_MODEL_RESEARCH`
- `NEWS_BOT_LLM_TIMEOUT_MS`
- `NEWS_BOT_LLM_MAX_ITEMS_AM`
- `NEWS_BOT_LLM_MAX_ITEMS_PM`

Bluesky ships disabled by default, and the checked-in watchlist starts empty. Populate [`src/sources/blueskyWatchlist.ts`](./src/sources/blueskyWatchlist.ts) only when you want explicit early-warning actors.

## Local commands

Fetch the latest source state only:

```bash
pnpm --dir ./news-bot fetch
```

Run the digest manually:

```bash
pnpm --dir ./news-bot digest:am
pnpm --dir ./news-bot digest:pm
```

Run follow-up commands:

```bash
pnpm --dir ./news-bot followup "show sources for 2"
pnpm --dir ./news-bot followup "ask 오늘 OpenAI 뉴스만 우리 관점으로 다시 요약해줘"
pnpm --dir ./news-bot followup "research 2번 뉴스 관련 최신 공식 반응까지 찾아줘"
```

## Follow-up behavior

`ask`:

- uses stored digest evidence only
- can explain, compare, or reframe items more naturally
- falls back cleanly when LLM is disabled

`research`:

- runs only when the user explicitly asks
- can use bounded live web search with citations
- can reuse stored unmatched Bluesky URL signals as hints
- must not change how the daily digest itself is generated

## OpenClaw and Telegram

Patch your OpenClaw Telegram config with the shape shown in [`openclaw.telegram.example.jsonc`](./openclaw.telegram.example.jsonc):

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

- `dmPolicy: "allowlist"` plus `allowFrom` keeps the bot single-owner.
- Start or attach OpenClaw in the workspace root so `skills/ai_news_brief/SKILL.md` is available.
- The current EC2 deployment path is `/srv/openclaw/workspace-personal/projects/opensec-ai-news-brief`.

## Installing cron jobs

Use the helper script:

```bash
TELEGRAM_USER_ID=123456789 bash ./news-bot/scripts/install-cron.sh
```

The script computes the workspace root and `news-bot` path automatically, so you do not need to hard-code `/opt/ai-news-brief`. It installs:

- `AI News Brief AM` at `10:00` America/New_York
- `AI News Brief PM` at `20:00` America/New_York

Each cron prompt tells OpenClaw to run the local `pnpm --dir <news-bot-path> digest:am|pm` command via `exec` and return only the script output.

## Telegram setup

1. Create a bot with `@BotFather`.
2. Put the token in `TELEGRAM_BOT_TOKEN`.
3. DM the bot once from your personal account.
4. Get your numeric Telegram user ID.
5. Set that ID in:
   - `NEWS_BOT_TELEGRAM_USER_ID`
   - OpenClaw `allowFrom`
   - `TELEGRAM_USER_ID` when installing cron

## Design choices

- OpenAI uses the official RSS feed because the newsroom HTML is unreliable behind Cloudflare in headless VPS environments.
- GeekNews, Techmeme, and Hacker News are precision signals. They help discovery and ranking, but they are not treated as primary truth by themselves.
- Bluesky is watchlist-based, disabled by default, and only boosts or annotates already-matched stories.
- The digest can ship without any LLM.
- LLM enrichment runs only after deterministic fetch, merge, ranking, and item selection.
- Live `research` is opt-in and happens after the digest already exists.

## Acceptance checks

- `pnpm --dir ./news-bot check`
- `pnpm --dir ./news-bot test`
- `bash ./news-bot/scripts/dry-run-am.sh`
- `bash ./news-bot/scripts/dry-run-pm.sh`
- `pnpm --dir ./news-bot followup "show sources for 2"`
