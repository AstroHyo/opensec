#!/usr/bin/env bash
set -euo pipefail

OPENCLAW_BIN="${OPENCLAW_BIN:-openclaw}"
TELEGRAM_USER_ID="${TELEGRAM_USER_ID:-${NEWS_BOT_TELEGRAM_USER_ID:-}}"
WORKSPACE_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
BOT_ROOT="$WORKSPACE_ROOT/news-bot"

if [[ -z "$TELEGRAM_USER_ID" ]]; then
  echo "TELEGRAM_USER_ID (or NEWS_BOT_TELEGRAM_USER_ID) is required."
  exit 1
fi

AM_PROMPT="Use the ai_news_brief skill in the workspace at $WORKSPACE_ROOT. Run \`pnpm --dir $BOT_ROOT run digest:am\` via exec. Return only the script output so it can be sent to Telegram as-is. Do not browse the web manually unless the script fails."
PM_PROMPT="Use the ai_news_brief skill in the workspace at $WORKSPACE_ROOT. Run \`pnpm --dir $BOT_ROOT run digest:pm\` via exec. Return only the script output so it can be sent to Telegram as-is. Do not browse the web manually unless the script fails."

"$OPENCLAW_BIN" cron add \
  --name "AI News Brief AM" \
  --cron "0 10 * * *" \
  --tz "America/New_York" \
  --session isolated \
  --announce \
  --channel telegram \
  --to "$TELEGRAM_USER_ID" \
  "$AM_PROMPT"

"$OPENCLAW_BIN" cron add \
  --name "AI News Brief PM" \
  --cron "0 20 * * *" \
  --tz "America/New_York" \
  --session isolated \
  --announce \
  --channel telegram \
  --to "$TELEGRAM_USER_ID" \
  "$PM_PROMPT"
