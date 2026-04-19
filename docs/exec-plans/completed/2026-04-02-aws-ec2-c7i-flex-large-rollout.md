# 2026-04-02 AWS EC2 c7i-flex.large Rollout

## Goal

Deploy OpenClaw and OpenSec AI News Brief on a single AWS EC2 instance using:

- instance type: `c7i-flex.large`
- OS: Ubuntu Server 24.04 LTS x86_64
- one private Telegram bot
- OpenClaw as personal control plane
- OpenSec as a project and skill inside that workspace

## Why This Choice Makes Sense

The user already has AWS credits and prior EC2 experience.

That changes the tradeoff:

- raw cost matters less during the credit window
- setup familiarity matters more
- one EC2 VM is enough for current needs

`c7i-flex.large` is not the most spacious option, but it is viable if we tune for 4 GB RAM.

## Resource Constraints To Respect

`c7i-flex.large` gives:

- 2 vCPU
- 4 GiB RAM

That is enough for:

- OpenClaw gateway
- Telegram channel
- `news-bot`
- SQLite
- light to moderate Codex-style repo tasks

But it is not enough for:

- heavy concurrent builds
- multiple large repos building in parallel
- memory-hungry background services

## Design Rule For This Instance Size

Treat this EC2 host as:

- a personal AI operations box
- not a general-purpose CI farm

That means:

- one gateway
- one personal workspace
- one active coding task at a time
- swap enabled
- low background noise

## Recommended EC2 Launch Settings

### Region

- `us-east-1` if you want the broadest service support and low latency to the US East Coast

### AMI

- Canonical Ubuntu Server 24.04 LTS
- x86_64

### Instance Type

- `c7i-flex.large`

### Storage

- root volume: `gp3`
- size: `30 GiB`

Why 30 GiB:

- safer than tiny root disks once Node modules, builds, logs, and git repos accumulate
- still cheap within the credit window

### Network

- auto-assign public IPv4: yes
- security group inbound:
  - SSH 22 from your IP only

No extra inbound ports are required for the basic setup.
OpenClaw and Telegram can work without opening public HTTP ports for this use case.

### IAM Role

Recommended:

- attach `AmazonSSMManagedInstanceCore`

That gives you:

- SSM Session Manager access
- easier remote recovery
- less dependence on SSH over time

## Recommended First-Boot Sequence

After the instance is up:

```bash
ssh ubuntu@<public-ip>
```

Then:

```bash
git clone https://github.com/AstroHyo/opensec.git /home/ubuntu/opensec
cd /home/ubuntu/opensec
./scripts/aws/bootstrap-ec2-c7i-flex-large.sh
```

This script:

- installs base packages
- creates a 4 GiB swap file
- installs Node 24
- enables `pnpm`
- prepares `/srv/openclaw/workspace-personal`
- clones or reuses the OpenSec repo there
- runs personal workspace bootstrap
- installs `news-bot` dependencies

## Swap Is Not Optional Here

On a 4 GiB instance, enable swap.

Without swap:

- `pnpm install`
- TypeScript checks
- repo work from DM

are much more likely to hit OOM under pressure.

The bootstrap script creates:

- `/swapfile`
- 4 GiB swap
- `/etc/fstab` entry

## OpenClaw Setup

After bootstrap:

```bash
mkdir -p ~/.openclaw
cp /srv/openclaw/workspace-personal/projects/opensec/openclaw.personal.example.jsonc ~/.openclaw/openclaw.json
```

Edit:

- Telegram bot token
- numeric Telegram user ID in:
  - `allowFrom`
  - `defaultTo`
  - `execApprovals.approvers`

Then install OpenClaw:

```bash
curl -fsSL https://openclaw.ai/install.sh | bash
openclaw onboard --install-daemon
openclaw gateway status
```

## news-bot Environment For 4 GiB RAM

Create:

```bash
cd /srv/openclaw/workspace-personal/projects/opensec/news-bot
cp .env.example .env
```

Recommended `.env` values on this instance size:

```env
NEWS_BOT_TIMEZONE=America/New_York
NEWS_BOT_LANGUAGE=ko
NEWS_BOT_DB_PATH=./data/news-bot.sqlite
NEWS_BOT_HTTP_TIMEOUT_MS=15000

NEWS_BOT_TELEGRAM_USER_ID=<numeric-telegram-user-id>
TELEGRAM_BOT_TOKEN=<telegram-bot-token>

OPENAI_API_KEY=<optional>
NEWS_BOT_LLM_ENABLED=true
NEWS_BOT_LLM_THEMES_ENABLED=true
NEWS_BOT_LLM_RERANK_ENABLED=false

NEWS_BOT_LLM_MODEL_SUMMARY=gpt-4.1-mini
NEWS_BOT_LLM_MODEL_THEMES=gpt-4.1
NEWS_BOT_LLM_TIMEOUT_MS=20000
NEWS_BOT_LLM_MAX_ITEMS_AM=6
NEWS_BOT_LLM_MAX_ITEMS_PM=10
```

Why reduce AM/PM max items on this box:

- keeps API work tighter
- reduces processing overhead
- makes digests more selective
- still fits the product goal of high-signal summaries

## Build Approval Step

After bootstrap:

```bash
cd /srv/openclaw/workspace-personal/projects/opensec/news-bot
pnpm approve-builds
```

Approve:

- `better-sqlite3`
- `esbuild`

## Validate Before Telegram

Run:

```bash
pnpm test
./scripts/dry-run-am.sh
./scripts/dry-run-pm.sh
pnpm run digest:am
```

If these fail, do not continue to cron setup yet.

## Telegram Setup

1. Create bot with `@BotFather`
2. Save token
3. DM the bot once
4. Find your numeric Telegram user ID

Good check:

```bash
openclaw logs --follow
```

Look for `from.id`.

## Cron Setup

Once Telegram works:

```bash
cd /srv/openclaw/workspace-personal/projects/opensec/news-bot
TELEGRAM_USER_ID=<numeric-telegram-user-id> ./scripts/install-cron.sh
```

This registers:

- 10:00 AM ET digest
- 8:00 PM ET digest

## Practical Use On c7i-flex.large

This box should be used like this:

- receive digests
- ask follow-up questions
- run one repo task at a time
- inspect server status
- do small to medium code changes remotely

Avoid:

- multiple large repo builds at once
- keeping many terminal-heavy tasks running in parallel
- long-running background experiments

## When To Upgrade

Move to `m7i-flex.large` or a larger instance when:

- swap is used frequently during normal tasks
- repo builds start feeling slow or fragile
- you want multiple active DM-driven coding tasks
- OpenClaw plus repo work becomes your daily main environment

## Recommended Day-1 Sequence

1. launch EC2 `c7i-flex.large`
2. attach SSM IAM role
3. SSH in
4. run `bootstrap-ec2-c7i-flex-large.sh`
5. run `pnpm approve-builds`
6. create `news-bot/.env`
7. install and onboard OpenClaw
8. configure Telegram allowlist
9. validate dry-runs
10. install cron
11. test `brief now` from Telegram

## Decision Summary

This setup is good if:

- you want to burn AWS credits first
- you already know EC2
- you are okay with a tuned but smaller box

This setup is not ideal if:

- you expect heavy parallel coding workloads
- you want lots of memory headroom
- this becomes your primary long-running dev server
