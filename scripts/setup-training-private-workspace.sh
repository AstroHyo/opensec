#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEFAULT_WORKSPACE_ROOT="/srv/openclaw/workspace-training-private"
WORKSPACE_ROOT_INPUT="${WORKSPACE_ROOT:-${1:-$DEFAULT_WORKSPACE_ROOT}}"

abs_path() {
  python3 - "$1" <<'PY'
from pathlib import Path
import sys
print(Path(sys.argv[1]).expanduser().resolve())
PY
}

REPO_ROOT_ABS="$(abs_path "$REPO_ROOT")"
WORKSPACE_ROOT_ABS="$(abs_path "$WORKSPACE_ROOT_INPUT")"

case "$WORKSPACE_ROOT_ABS" in
  "$REPO_ROOT_ABS"|"$REPO_ROOT_ABS"/*)
    echo "Refusing to scaffold a private training workspace inside the OpenSec repo."
    echo "Choose a path outside: $REPO_ROOT_ABS"
    exit 1
    ;;
esac

mkdir -p \
  "$WORKSPACE_ROOT_ABS/memory" \
  "$WORKSPACE_ROOT_ABS/skills/training_ops" \
  "$WORKSPACE_ROOT_ABS/data" \
  "$WORKSPACE_ROOT_ABS/scripts" \
  "$WORKSPACE_ROOT_ABS/scratch" \
  "$WORKSPACE_ROOT_ABS/exports"

chmod 700 \
  "$WORKSPACE_ROOT_ABS" \
  "$WORKSPACE_ROOT_ABS/memory" \
  "$WORKSPACE_ROOT_ABS/skills" \
  "$WORKSPACE_ROOT_ABS/skills/training_ops" \
  "$WORKSPACE_ROOT_ABS/data" \
  "$WORKSPACE_ROOT_ABS/scripts" \
  "$WORKSPACE_ROOT_ABS/scratch" \
  "$WORKSPACE_ROOT_ABS/exports"

write_if_missing() {
  local dst="$1"
  if [[ -e "$dst" ]]; then
    return 0
  fi
  cat >"$dst"
  chmod 600 "$dst"
}

write_if_missing "$WORKSPACE_ROOT_ABS/SOUL.md" <<'EOF'
# Private Training Bot Soul

This file is intentionally private and must never be copied back into the OpenSec repo.

- Put the real training-bot personality here.
- Include tone, boundaries, humor, and relationship style here.
- Default to no emojis and keep the tone clean and text-first, but allow a small, intentional emoji only when it genuinely improves warmth, empathy, or emotional clarity.
- Do not store tokens or raw secrets in this file.
EOF

write_if_missing "$WORKSPACE_ROOT_ABS/AGENTS.md" <<'EOF'
# Private Training Bot Rules

This file is intentionally private and must never be copied back into the OpenSec repo.

- Define the bot's real workout, nutrition, scheduling, and logging behavior here.
- Keep channel, DM, escalation, and approval rules here.
- Default to no emojis and keep the tone clean and text-first, but allow a small, intentional emoji only when it genuinely improves warmth, empathy, or emotional clarity.
- Keep all private owner-specific operating instructions here, not in the public repo.
EOF

write_if_missing "$WORKSPACE_ROOT_ABS/USER.md" <<'EOF'
# Training Bot Owner Context

This file is intentionally private and must never be copied back into the OpenSec repo.

Suggested content:
- owner preferences
- body metrics and constraints
- recovery/pain context
- food preferences and exclusions
- scheduling realities
- duplicated Notion page URL
EOF

write_if_missing "$WORKSPACE_ROOT_ABS/MEMORY.md" <<'EOF'
# Durable Memory

This file is intentionally private and must never be copied back into the OpenSec repo.

Use this for stable, approved facts only.
EOF

write_if_missing "$WORKSPACE_ROOT_ABS/HEARTBEAT.md" <<'EOF'
# Heartbeat

This file is intentionally private and must never be copied back into the OpenSec repo.

Use this only for recurring training-bot checks once the workflow is stable.
EOF

write_if_missing "$WORKSPACE_ROOT_ABS/IDENTITY.md" <<'EOF'
# Identity

name: Training
theme: personal fitness secretary
emoji: 
avatar: 
EOF

write_if_missing "$WORKSPACE_ROOT_ABS/memory/README.md" <<'EOF'
# Daily Notes

This folder is intentionally private and must never be copied back into the OpenSec repo.

Keep raw daily observations here and promote only durable facts into `../MEMORY.md`.
EOF

write_if_missing "$WORKSPACE_ROOT_ABS/skills/training_ops/SKILL.md" <<'EOF'
# training_ops

This file is intentionally private and must never be copied back into the OpenSec repo.

Suggested responsibilities:
- import and sync the duplicated workout Notion
- answer "what is today's workout" and "what should I eat today"
- log workout completion and nutrition compliance
- reschedule missed sessions
- adjust future targets after underperformance
- summarize weekly progress
EOF

write_if_missing "$WORKSPACE_ROOT_ABS/.env.private" <<'EOF'
# Private training-bot environment
# This file is intentionally private and must never be copied back into the OpenSec repo.

TRAINING_DB_PATH=./data/training-bot.sqlite
TRAINING_TIMEZONE=America/New_York
TRAINING_NOTION_SOURCE_PAGE_URL=
TRAINING_NOTION_DUPLICATE_PAGE_URL=
TRAINING_NOTION_TOKEN=
TRAINING_DISCORD_BOT_TOKEN=
TRAINING_DISCORD_CHANNEL_ID=
EOF

echo "Private training workspace scaffolded at:"
echo "  $WORKSPACE_ROOT_ABS"
echo
echo "This path is outside the OpenSec repo and safe from normal git add / push flows."
echo "Next steps:"
echo "  1. Fill in the private files in $WORKSPACE_ROOT_ABS"
echo "  2. Add real training_ops logic under $WORKSPACE_ROOT_ABS/skills/training_ops"
echo "  3. Add secrets only to $WORKSPACE_ROOT_ABS/.env.private"
echo "  4. Bind a separate OpenClaw agent to this workspace"
