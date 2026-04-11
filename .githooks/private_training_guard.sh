#!/bin/sh
set -eu

MODE="${1:-staged}"

list_paths() {
  case "$MODE" in
    staged)
      git diff --cached --name-only --diff-filter=ACMR
      ;;
    tracked)
      git ls-files
      ;;
    *)
      echo "Unsupported guard mode: $MODE" >&2
      exit 2
      ;;
  esac
}

is_blocked_path() {
  case "$1" in
    .env.private|SOUL.md|USER.md|MEMORY.md|HEARTBEAT.md|IDENTITY.md)
      return 0
      ;;
    scripts/training_bot.py|skills/training_ops|skills/training_ops/*)
      return 0
      ;;
    memory|memory/*|scratch|scratch/*|exports|exports/*)
      return 0
      ;;
    data/training-bot.sqlite|*/training-bot.sqlite)
      return 0
      ;;
    workspace-training-private/*|*/workspace-training-private/*)
      return 0
      ;;
    *)
      return 1
      ;;
  esac
}

content_allowlist() {
  case "$1" in
    .githooks/private_training_guard.sh)
      return 0
      ;;
    scripts/setup-training-private-workspace.sh)
      return 0
      ;;
    *)
      return 1
      ;;
  esac
}

has_private_marker() {
  marker="$1"
  path="$2"

  if [ "$MODE" = "staged" ]; then
    git show ":$path" 2>/dev/null | grep -Fq "$marker"
  else
    [ -f "$path" ] || return 1
    grep -Fq "$marker" "$path"
  fi
}

fail_guard() {
  echo "OpenSec guard: refusing $MODE because private training workspace content was detected." >&2
  echo >&2
  echo "Move this change to /srv/openclaw/workspace-training-private or its private repo instead." >&2
  echo "If you only need a public-safe scaffold, recreate the minimal redacted version here." >&2
  echo >&2
  printf '%b\n' "$1" >&2
  exit 1
}

PATH_HITS=""
MARKER_HITS=""

while IFS= read -r path; do
  [ -n "$path" ] || continue

  if is_blocked_path "$path"; then
    PATH_HITS="${PATH_HITS}\n- ${path}"
    continue
  fi

  if content_allowlist "$path"; then
    continue
  fi

  for marker in \
    "This file is intentionally private and must never be copied back into the OpenSec repo." \
    "# Private Training Bot Soul" \
    "# Private Training Bot Rules" \
    "# Training Bot Owner Context" \
    "# Private training-bot environment" \
    "TRAINING_DISCORD_BOT_TOKEN=" \
    "TRAINING_NOTION_TOKEN=" \
    "TRAINING_DB_PATH=./data/training-bot.sqlite"
  do
    if has_private_marker "$marker" "$path"; then
      MARKER_HITS="${MARKER_HITS}\n- ${path}: ${marker}"
      break
    fi
  done
done <<EOF
$(list_paths)
EOF

if [ -n "$PATH_HITS" ]; then
  fail_guard "Blocked file paths:${PATH_HITS}"
fi

if [ -n "$MARKER_HITS" ]; then
  fail_guard "Blocked private markers:${MARKER_HITS}"
fi

exit 0
