# OpenSec News Engine

This package is the deterministic news and signal engine inside OpenSec.

It is not the entire assistant runtime.

The broader OpenSec repository provides:

- OpenClaw-facing skills
- workspace bootstrap assets
- memory documents and daily note flow
- repo and system operation scaffolding
- future extension paths for other assistant lanes

`news-bot/` is the part that owns retrieval, evidence, scoring, digest assembly, follow-up context, and bounded LLM enrichment for news workflows.

## How It Fits Into OpenSec

The clean boundary is:

- root repository
  - personal assistant workspace
  - skills
  - docs
  - control-plane setup
- `news-bot/`
  - deterministic content engine for news and signals

If OpenSec is the assistant system, `news-bot/` is one engine inside it.

That means this package should remain focused on:

- source adapters
- normalization and canonicalization
- SQLite-backed local state
- deterministic ranking
- resend suppression
- article and repo evidence extraction
- digest rendering
- follow-up commands over stored context
- bounded LLM enrichment and research

It should not become the place where all workspace memory, all Discord routing policy, or all future assistant behavior gets mixed together.

## What This Engine Does

- Fetches from three source layers:
  - `primary`: OpenAI official RSS, GitHub Trending
  - `precision`: GeekNews, Techmeme, Hacker News
  - `early_warning`: Bluesky watchlist signals
- Normalizes and deduplicates with:
  - canonical URL normalization
  - normalized title hashing
  - fuzzy title similarity fallback
- Persists local state in SQLite for:
  - raw fetches
  - normalized items
  - digest history
  - resend suppression
  - follow-up context
  - article contexts
  - early-warning signal events and matches
  - LLM run telemetry and budget history
- Separates persisted digest context by profile:
  - `tech`
  - `finance`
- Scores deterministically with:
  - source authority
  - freshness
  - keyword and methodology matches
  - repo traction
  - precision-layer boosts
  - early-warning boosts
  - cross-signal boosts
- Adds bounded insight layers:
  - full-read article or repo context extraction
  - task-tiered LLM enrichment
  - theme synthesis
  - explicit research mode
- Renders channel-ready Korean digests with preserved evidence:
  - canonical link
  - source labels
  - source link list
  - score reasons
  - optional signal links

## Design Rules

The non-negotiables for this package are straightforward:

- daily digest generation stays deterministic
- shared evidence can feed multiple profiles, but digest context is profile-scoped
- precision sources may introduce or strengthen candidates
- early-warning sources never create standalone digest items
- LLMs are optional explanation and research layers, not the retrieval core
- original evidence remains attached even when summaries are enriched
- digest delivery should still work when enrichment is unavailable

## Current Follow-up Surface

Supported commands:

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
- `xhs-login`
- `xhs-rent-watch`
- `llm-runs`

The first group is news-specific follow-up over stored digest context.

The Xiaohongshu watcher commands are a separate bounded subsystem that happens to live in the same package because it shares:

- scheduling needs
- delivery plumbing
- SQLite state
- bounded LLM / vision patterns

## Role Of The LLM Layer

The LLM layer is downstream of deterministic retrieval.

Current intended flow:

```text
curated sources
-> normalize and canonicalize
-> dedupe and merge
-> SQLite state
-> deterministic scoring
-> recent 72h suppression
-> shortlist
-> full-read article / repo context
-> task-tiered enrichment
-> digest render
-> follow-up from stored context
```

Important consequences:

- the model does not free-search for daily candidates
- retrieval quality is not hidden inside one prompt
- enrichment is cacheable and debuggable
- follow-up quality improves because article context is already stored
- budget controls can be applied by task tier

## Package Layout

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
    install-discord-cron.sh
    install-cron.sh
  src/
    index.ts
    config.ts
    db.ts
    types.ts
    profiles.ts
    scoring.ts
    digest/
      buildDigest.ts
      renderTelegram.ts
    evidence/
      articleContext.ts
    llm/
      enrichDigest.ts
      taskRouter.ts
      promptTemplates.ts
      schemas.ts
      openaiClient.ts
      runTelemetry.ts
    sources/
      index.ts
      layers.ts
      relevance.ts
      openaiNews.ts
      githubTrending.ts
      geeknews.ts
      financeSources.ts
      techmeme.ts
      hackerNews.ts
      blueskySignals.ts
      blueskyWatchlist.ts
    commands/
      runDigest.ts
      followup.ts
      followupAnswer.ts
      followupResearch.ts
      showLlmRuns.ts
      watchXiaohongshuRent.ts
    housing/
      constants.ts
      discord.ts
      filter.ts
      llm.ts
      types.ts
      xiaohongshu.ts
    util/
      canonicalize.ts
      dedupe.ts
      http.ts
      text.ts
      timeWindow.ts
  tests/
    articleContext.test.ts
    dbMigrations.test.ts
    dedupe.test.ts
    followup.test.ts
    llm.test.ts
    llmRunTracking.test.ts
    profileNamespaces.test.ts
    recentSuppression.test.ts
    render.test.ts
    scoring.test.ts
    sourcingLayers.test.ts
    taskRouter.test.ts
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
   - `NEWS_BOT_DEFAULT_PROFILE`
   - optionally `NEWS_BOT_TELEGRAM_USER_ID`
   - optionally `TELEGRAM_BOT_TOKEN`
   - optionally `OPENAI_API_KEY`
   - optionally `XAI_API_KEY`
4. Run validation.
   ```bash
   pnpm --dir ./news-bot check
   pnpm --dir ./news-bot test
   bash ./news-bot/scripts/dry-run-am.sh
   bash ./news-bot/scripts/dry-run-pm.sh
   ```

## Environment Variables

Base configuration:

- `NEWS_BOT_TIMEZONE`
- `NEWS_BOT_LANGUAGE`
- `NEWS_BOT_DB_PATH`
- `NEWS_BOT_DEFAULT_PROFILE`
- `NEWS_BOT_HTTP_TIMEOUT_MS`
- `NEWS_BOT_XHS_PROFILE_DIR`
- `NEWS_BOT_XHS_HEADLESS`
- `NEWS_BOT_XHS_VISION_ENABLED`
- `NEWS_BOT_XHS_MAX_RESULTS_PER_QUERY`
- `NEWS_BOT_TELEGRAM_USER_ID`
- `TELEGRAM_BOT_TOKEN`
- `DISCORD_BOT_TOKEN`
- `DISCORD_OWNER_USER_ID`

Precision and signal sourcing:

- `NEWS_BOT_HN_TOP_LIMIT`
- `NEWS_BOT_HN_NEW_LIMIT`
- `NEWS_BOT_BLUESKY_ENABLED`
- `NEWS_BOT_SIGNAL_WINDOW_HOURS`
- `NEWS_BOT_BLUESKY_MAX_POSTS_PER_ACTOR`

Optional LLM behavior:

- `OPENAI_API_KEY`
- `XAI_API_KEY`
- `NEWS_BOT_LLM_ENABLED`
- `NEWS_BOT_LLM_THEMES_ENABLED`
- `NEWS_BOT_LLM_RERANK_ENABLED`
- `NEWS_BOT_LLM_MODEL_TIER_SMALL`
- `NEWS_BOT_LLM_MODEL_TIER_MEDIUM`
- `NEWS_BOT_LLM_MODEL_TIER_DEEP`
- `NEWS_BOT_LLM_TIMEOUT_MS`
- `NEWS_BOT_LLM_TIMEOUT_TIER_SMALL_MS`
- `NEWS_BOT_LLM_TIMEOUT_TIER_MEDIUM_MS`
- `NEWS_BOT_LLM_TIMEOUT_TIER_DEEP_MS`
- `NEWS_BOT_LLM_MAX_ITEMS_AM`
- `NEWS_BOT_LLM_MAX_ITEMS_PM`
- `NEWS_BOT_LLM_MAX_ALLOWED_TIER`
- `NEWS_BOT_LLM_DAILY_BUDGET_USD`
- `NEWS_BOT_LLM_BUDGET_HARD_STOP`

Current default tier routing:

- Tier 1:
  - `xai:grok-4-1-fast-reasoning`
- Tier 2:
  - `openai:gpt-4.1`
- Tier 3:
  - `openai:gpt-5.4-mini`

Bluesky ships disabled by default, and the checked-in watchlist starts empty. Populate [`src/sources/blueskyWatchlist.ts`](./src/sources/blueskyWatchlist.ts) only when you want explicit early-warning actors.

## Local Commands

Fetch the latest source state only:

```bash
pnpm --dir ./news-bot fetch -- --profile tech
```

Run the digest manually:

```bash
pnpm --dir ./news-bot digest -- --profile tech --mode am
pnpm --dir ./news-bot digest -- --profile tech --mode pm
pnpm --dir ./news-bot digest -- --profile finance --mode am
pnpm --dir ./news-bot digest -- --profile finance --mode pm
```

Run follow-up commands:

```bash
pnpm --dir ./news-bot followup -- --profile tech "show sources for 2"
pnpm --dir ./news-bot followup -- --profile tech "ask 오늘 OpenAI 뉴스만 우리 관점으로 다시 요약해줘"
pnpm --dir ./news-bot followup -- --profile finance "ask 오늘 macro 항목만 우리 관점으로 정리해줘"
pnpm --dir ./news-bot followup -- --profile tech "research 2번 뉴스 관련 최신 공식 반응까지 찾아줘"
```

Inspect recent LLM runs:

```bash
pnpm --dir ./news-bot llm:runs -- --profile tech --limit 20
```

## Where To Read Next

If you want the bigger picture:

- [root README](../README.md)
- [ARCHITECTURE.md](../ARCHITECTURE.md)
- [OpenClaw personal control plane note](../docs/design-docs/openclaw-personal-control-plane.md)

If you want the engine internals:

- [`src/db.ts`](./src/db.ts)
- [`src/scoring.ts`](./src/scoring.ts)
- [`src/digest/buildDigest.ts`](./src/digest/buildDigest.ts)
- [`src/llm/taskRouter.ts`](./src/llm/taskRouter.ts)
- [`../docs/generated/db-schema.md`](../docs/generated/db-schema.md)
