# 2026-04-02 VPS + OpenClaw Rollout Plan

## Goal

Deploy OpenSec AI News Brief as a reliable single-user production bot on a Linux VPS with:

- deterministic local news pipeline
- OpenClaw gateway orchestration
- Telegram DM delivery
- twice-daily cron digests
- optional OpenAI-powered enrichment

## Recommended Deployment Decision

### Default Recommendation

Use:

- provider: Hetzner Cloud
- region: `us-east` / Ashburn
- instance class: `CPX21`
- OS: Ubuntu 24.04 LTS x86_64

Why this is the best fit:

- better price-performance than the US hyperscaler-style options
- enough RAM for Node, OpenClaw, SQLite, source fetching, and light growth
- US East location is suitable for a user on America/New_York
- simple VM model fits a single-owner bot better than heavier platform layers

### Minimum Viable Production Size

Treat this as the floor for stable use:

- 2 to 3 shared vCPUs
- 4 GB RAM
- 40 to 80 GB SSD

For this project, 4 GB RAM is the practical comfort point.

Reasons:

- Node + TypeScript tooling + OpenClaw gateway + Telegram channel + SQLite + occasional `pnpm` work is fine on 4 GB
- 2 GB can work, but is more likely to feel cramped during upgrades, installs, and heavier agent turns
- 1 GB is not recommended

### When To Choose Something Else

Choose DigitalOcean if:

- you want the smoothest US-focused console UX
- you are okay paying more for simpler operations

Choose Lightsail if:

- you already live in AWS
- you want the simplest possible fixed-price VM

Do not choose:

- ARM first, unless you deliberately want it
- very small 512 MB or 1 GB instances
- managed Kubernetes or container platforms for this single-user bot

## Current Provider Snapshot

As of April 2, 2026:

- Hetzner’s Linux-friendly regular-performance plans are available in Ashburn, Virginia and Hillsboro, Oregon, and the regular-performance page shows `CPX11` with 2 GB RAM / 40 GB SSD and `CPX21` with 4 GB RAM / 80 GB SSD.
- Hetzner’s price adjustment doc shows US pricing of `CPX11` at `$6.99/mo` and `CPX21` at `$13.99/mo`.
- DigitalOcean’s basic Droplets list `2 GiB / 1 vCPU / 50 GiB` at `$12/mo` and `4 GiB / 2 vCPUs / 80 GiB` at `$24/mo`.
- AWS Lightsail’s Linux bundles list `2 GB / 2 vCPUs / 60 GB SSD` at `$12/mo` and `4 GB / 2 vCPUs / 80 GB SSD` at `$24/mo`.

Interpretation:

- Hetzner `CPX21` is the strongest value choice if you are comfortable with a slightly more bare-metal-feeling VM provider.
- DigitalOcean `4 GiB / 2 vCPU` is the easiest “pay more, think less” option.
- Lightsail is fine, but not my first choice unless you already use AWS heavily.

## Final Recommendation Matrix

### Best Overall

- Hetzner `CPX21` in Ashburn
- Ubuntu 24.04 LTS x86_64

### Best Budget

- Hetzner `CPX11` in Ashburn

Only choose this if:

- you expect light usage
- you are okay with less headroom during installs and maintenance

### Easiest Operations

- DigitalOcean basic Droplet
- 4 GiB RAM / 2 vCPU
- Ubuntu 24.04 LTS x86_64

## High-Level Architecture On The VPS

```text
VPS
├── OpenClaw gateway + cron + Telegram channel
├── OpenSec repository
│   ├── news-bot/
│   └── skills/
│       ├── ai_news_brief/
│       └── code_ops/
└── local state
    ├── SQLite database
    └── OpenClaw config / logs / cron runs
```

OpenClaw is installed on the VPS.
The OpenSec repo is cloned separately.
OpenClaw reads the workspace skill and runs `news-bot` via `exec`.

## Recommended Filesystem Layout

```text
/opt/opensec-ai-news-brief
├── news-bot
├── skills
├── docs
├── AGENTS.md
└── ARCHITECTURE.md
```

This keeps:

- app code in one stable path
- OpenClaw cron prompts simple
- future updates predictable

Repo helpers for this plan:

- `scripts/setup-personal-workspace.sh`
- `openclaw.personal.example.jsonc`
- `workspace-template/`
- `skills/code_ops/`
- `skills/repo_ops/`
- `skills/system_ops/`

## Rollout Plan

### Phase 1: Provision The VPS

Create a VM with:

- Ubuntu 24.04 LTS x86_64
- SSH key auth only
- public IPv4
- region close to the user, preferably US East

Initial hardening:

- create a non-root sudo user
- disable password SSH auth
- enable firewall
- install security updates

Base packages:

- `git`
- `curl`
- `build-essential`
- `ca-certificates`
- `ufw`

## Phase 2: Install Node And App Dependencies

OpenClaw’s Linux docs currently recommend Node 24, with Node 22.14+ still supported.

Install:

- Node 24
- `pnpm`

Then:

```bash
git clone https://github.com/AstroHyo/opensec-ai-news-brief.git /opt/opensec-ai-news-brief
cd /opt/opensec-ai-news-brief/news-bot
pnpm install
pnpm approve-builds
```

Approve:

- `better-sqlite3`
- `esbuild`

If you want the recommended personal workspace layout directly:

```bash
git clone https://github.com/AstroHyo/opensec-ai-news-brief.git /srv/openclaw/workspace-personal/projects/opensec-ai-news-brief
cd /srv/openclaw/workspace-personal/projects/opensec-ai-news-brief
./scripts/setup-personal-workspace.sh
```

## Phase 3: Configure App Secrets

Create:

```bash
cd /opt/opensec-ai-news-brief/news-bot
cp .env.example .env
```

Minimum production `.env`:

```env
NEWS_BOT_TIMEZONE=America/New_York
NEWS_BOT_LANGUAGE=ko
NEWS_BOT_DB_PATH=./data/news-bot.sqlite
NEWS_BOT_HTTP_TIMEOUT_MS=15000

NEWS_BOT_TELEGRAM_USER_ID=<numeric telegram user id>
TELEGRAM_BOT_TOKEN=<telegram bot token>

OPENAI_API_KEY=<optional, but recommended if using enrichment>
NEWS_BOT_LLM_ENABLED=true
NEWS_BOT_LLM_THEMES_ENABLED=true
NEWS_BOT_LLM_RERANK_ENABLED=false
NEWS_BOT_LLM_MODEL_SUMMARY=gpt-4.1-mini
NEWS_BOT_LLM_MODEL_THEMES=gpt-4.1
NEWS_BOT_LLM_TIMEOUT_MS=20000
NEWS_BOT_LLM_MAX_ITEMS_AM=12
NEWS_BOT_LLM_MAX_ITEMS_PM=20
```

If you want deterministic-only mode at first:

- leave `OPENAI_API_KEY` empty
- set all `NEWS_BOT_LLM_*_ENABLED=false`

## Phase 4: Install OpenClaw

For normal operations, do not clone the OpenClaw source repo.
Install the OpenClaw runtime on the VPS.

Current quick path from the official Linux and Getting Started docs:

```bash
curl -fsSL https://openclaw.ai/install.sh | bash
openclaw onboard --install-daemon
```

Why this is the right path:

- easier than source-building OpenClaw
- aligned with the current official onboarding flow
- installs the gateway and service wrapper cleanly

After install:

```bash
openclaw gateway status
openclaw gateway probe
```

## Phase 5: Connect OpenSec Repo To OpenClaw

The important part is not linking repositories together.
The important part is making OpenClaw run inside the OpenSec workspace path.

Requirements:

- OpenClaw must be started with the OpenSec workspace available
- the workspace must include `skills/ai_news_brief/SKILL.md`
- the skill must call the app via `exec`

Recommended config bootstrap:

```bash
cp /srv/openclaw/workspace-personal/projects/opensec-ai-news-brief/openclaw.personal.example.jsonc ~/.openclaw/openclaw.json
```

Practical rule:

- run or manage OpenClaw from the same user account that owns `/opt/opensec-ai-news-brief`
- keep the workspace path stable

Validation:

```bash
cd /opt/opensec-ai-news-brief/news-bot
pnpm test
./scripts/dry-run-am.sh
./scripts/dry-run-pm.sh
pnpm run digest:am
```

## Phase 6: Telegram Channel Setup

### Telegram Side

1. Open Telegram and talk to `@BotFather`
2. Run `/newbot`
3. Save the bot token
4. DM the bot once from your own Telegram account

### Find Your Numeric Telegram User ID

Safer methods from the OpenClaw docs:

1. DM your bot
2. run `openclaw logs --follow`
3. read `from.id`

Official Bot API fallback:

```bash
curl "https://api.telegram.org/bot<token>/getUpdates"
```

### OpenClaw Config Shape

For a one-owner bot, prefer durable allowlisting:

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

This matches the current repo example:

- `news-bot/openclaw.telegram.example.jsonc`

Important operational decision:

- use `dmPolicy: "allowlist"`
- store the numeric owner ID in config
- do not leave the bot open to the public

## Phase 7: Register Cron Jobs

OpenClaw’s cron docs support isolated jobs with Telegram announce delivery.

Recommended jobs:

- `0 10 * * *` in `America/New_York`
- `0 20 * * *` in `America/New_York`

Example:

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
  --to "123456789" \
  --message "Use the ai_news_brief skill in the workspace at /opt/opensec-ai-news-brief. Run \`pnpm --dir /opt/opensec-ai-news-brief/news-bot digest:am\` via exec. Return only the script output so it can be sent to Telegram as-is. Do not browse the web manually unless the script fails."
```

And:

```bash
openclaw cron add \
  --name "AI News Brief PM" \
  --cron "0 20 * * *" \
  --tz "America/New_York" \
  --session isolated \
  --expect-final \
  --timeout-seconds 600 \
  --announce \
  --channel telegram \
  --to "123456789" \
  --message "Use the ai_news_brief skill in the workspace at /opt/opensec-ai-news-brief. Run \`pnpm --dir /opt/opensec-ai-news-brief/news-bot digest:pm\` via exec. Return only the script output so it can be sent to Telegram as-is. Do not browse the web manually unless the script fails."
```

Or use the helper script in the repo:

```bash
cd /opt/opensec-ai-news-brief/news-bot
TELEGRAM_USER_ID=123456789 ./scripts/install-cron.sh
```

## Phase 8: Smoke Test Checklist

### Before OpenClaw

- `pnpm test`
- `./scripts/dry-run-am.sh`
- `./scripts/dry-run-pm.sh`
- `pnpm run digest:am`
- `pnpm run digest:pm`

### After OpenClaw

- `openclaw gateway status`
- DM the Telegram bot
- run a manual cron job once
- verify bot can answer:
  - `brief now`
  - `openai only`
  - `repo radar`
  - `show sources for 1`

## Phase 9: Operational Hardening

Keep it simple, but do these:

- enable unattended security upgrades or patch regularly
- snapshot the VM before major changes
- back up the SQLite database or at least the repo and `.env`
- keep OpenClaw gateway bound safely according to the default onboarding config
- avoid exposing more ports than necessary

## Recommended Implementation Order

1. provision VPS
2. install Node and clone OpenSec repo
3. validate `news-bot` locally on the server
4. install OpenClaw runtime
5. configure Telegram
6. merge OpenClaw config patch
7. install cron jobs
8. run end-to-end smoke tests

## Fallback Plan If OpenClaw Is Delayed

If OpenClaw setup is blocked, you can still run the bot on the VPS by:

- using `news-bot` directly
- adding plain Linux cron entries
- manually sending or inspecting digests

But the intended production path remains:

- OpenClaw for orchestration
- Telegram for delivery
- SQLite for local product state

## Decision Summary

If you want the clearest answer:

- choose Hetzner `CPX21` in Ashburn
- install Ubuntu 24.04 LTS x86_64
- clone this repo to `/opt/opensec-ai-news-brief`
- install OpenClaw via the official installer
- use Telegram allowlist mode with your numeric user ID
- register the AM and PM isolated cron jobs through OpenClaw
