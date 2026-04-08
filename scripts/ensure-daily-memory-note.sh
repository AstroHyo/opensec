#!/usr/bin/env bash
set -euo pipefail

WORKSPACE_ROOT="${WORKSPACE_ROOT:-/srv/openclaw/workspace-personal}"
USER_TIMEZONE="${USER_TIMEZONE:-${TZ:-America/New_York}}"
NOTE_DATE="${1:-}"

if [[ $# -gt 1 ]]; then
  echo "Usage: $0 [YYYY-MM-DD]" >&2
  exit 1
fi

if [[ -z "$NOTE_DATE" ]]; then
  NOTE_DATE="$(TZ="$USER_TIMEZONE" date +%F)"
fi

NOTE_DIR="$WORKSPACE_ROOT/memory"
NOTE_PATH="$NOTE_DIR/$NOTE_DATE.md"

mkdir -p "$NOTE_DIR"

create_note() {
  cat >"$NOTE_PATH" <<EOF
# $NOTE_DATE Daily Note

## Snapshot

- channels touched:
- active threads:
- why this day matters:

## Discord Conversation Notes

- 

## Candidate Signals

- 

## Promotion Candidates

- 

## Promoted to MEMORY

- 
EOF
}

ensure_section() {
  local heading="$1"
  local starter="$2"

  if ! grep -q "^$heading\$" "$NOTE_PATH"; then
    printf "\n%s\n\n%s\n" "$heading" "$starter" >>"$NOTE_PATH"
  fi
}

if [[ ! -f "$NOTE_PATH" ]]; then
  create_note
else
  ensure_section "## Snapshot" "- channels touched:"
  ensure_section "## Discord Conversation Notes" "- "
  ensure_section "## Candidate Signals" "- "
  ensure_section "## Promotion Candidates" "- "
  ensure_section "## Promoted to MEMORY" "- "
fi

printf '%s\n' "$NOTE_PATH"
