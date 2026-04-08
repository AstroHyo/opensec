#!/usr/bin/env bash
set -euo pipefail

OPENCLAW_BIN="${OPENCLAW_BIN:-openclaw}"
DISCORD_TECH_BRIEF_CHANNEL_ID="${DISCORD_TECH_BRIEF_CHANNEL_ID:-}"
DISCORD_FINANCE_BRIEF_CHANNEL_ID="${DISCORD_FINANCE_BRIEF_CHANNEL_ID:-}"
CRON_TIMEOUT_SECONDS="${CRON_TIMEOUT_SECONDS:-600}"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

if [[ "$(basename "$(dirname "$REPO_ROOT")")" == "projects" ]]; then
  WORKSPACE_ROOT="$(cd "$REPO_ROOT/../.." && pwd)"
else
  WORKSPACE_ROOT="$REPO_ROOT"
fi

BOT_ROOT="$REPO_ROOT/news-bot"

if [[ -z "$DISCORD_TECH_BRIEF_CHANNEL_ID" || -z "$DISCORD_FINANCE_BRIEF_CHANNEL_ID" ]]; then
  echo "DISCORD_TECH_BRIEF_CHANNEL_ID and DISCORD_FINANCE_BRIEF_CHANNEL_ID are required."
  exit 1
fi

TECH_AM_PROMPT="Use the ai_news_brief skill in the workspace at $WORKSPACE_ROOT. Run \`pnpm --dir $BOT_ROOT digest --mode am --profile tech\` via exec. Return only the script output so it can be sent to Discord as-is. Do not browse the web manually unless the script fails."
TECH_PM_PROMPT="Use the ai_news_brief skill in the workspace at $WORKSPACE_ROOT. Run \`pnpm --dir $BOT_ROOT digest --mode pm --profile tech\` via exec. Return only the script output so it can be sent to Discord as-is. Do not browse the web manually unless the script fails."
FINANCE_AM_PROMPT="Use the ai_news_brief skill in the workspace at $WORKSPACE_ROOT. Run \`pnpm --dir $BOT_ROOT digest --mode am --profile finance\` via exec. Return only the script output so it can be sent to Discord as-is. Do not browse the web manually unless the script fails."
FINANCE_PM_PROMPT="Use the ai_news_brief skill in the workspace at $WORKSPACE_ROOT. Run \`pnpm --dir $BOT_ROOT digest --mode pm --profile finance\` via exec. Return only the script output so it can be sent to Discord as-is. Do not browse the web manually unless the script fails."

"$OPENCLAW_BIN" cron add \
  --name "Tech Brief AM" \
  --cron "0 10 * * *" \
  --tz "America/New_York" \
  --session isolated \
  --expect-final \
  --timeout-seconds "$CRON_TIMEOUT_SECONDS" \
  --announce \
  --channel discord \
  --to "channel:$DISCORD_TECH_BRIEF_CHANNEL_ID" \
  --message "$TECH_AM_PROMPT"

"$OPENCLAW_BIN" cron add \
  --name "Tech Brief PM" \
  --cron "0 20 * * *" \
  --tz "America/New_York" \
  --session isolated \
  --expect-final \
  --timeout-seconds "$CRON_TIMEOUT_SECONDS" \
  --announce \
  --channel discord \
  --to "channel:$DISCORD_TECH_BRIEF_CHANNEL_ID" \
  --message "$TECH_PM_PROMPT"

"$OPENCLAW_BIN" cron add \
  --name "Finance Brief AM" \
  --cron "30 10 * * *" \
  --tz "America/New_York" \
  --session isolated \
  --expect-final \
  --timeout-seconds "$CRON_TIMEOUT_SECONDS" \
  --announce \
  --channel discord \
  --to "channel:$DISCORD_FINANCE_BRIEF_CHANNEL_ID" \
  --message "$FINANCE_AM_PROMPT"

"$OPENCLAW_BIN" cron add \
  --name "Finance Brief PM" \
  --cron "30 20 * * *" \
  --tz "America/New_York" \
  --session isolated \
  --expect-final \
  --timeout-seconds "$CRON_TIMEOUT_SECONDS" \
  --announce \
  --channel discord \
  --to "channel:$DISCORD_FINANCE_BRIEF_CHANNEL_ID" \
  --message "$FINANCE_PM_PROMPT"
