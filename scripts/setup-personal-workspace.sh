#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORKSPACE_ROOT="${WORKSPACE_ROOT:-/srv/openclaw/workspace-personal}"
TARGET_REPO_DIR="$WORKSPACE_ROOT/projects/opensec"

mkdir -p \
  "$WORKSPACE_ROOT/memory" \
  "$WORKSPACE_ROOT/scratch" \
  "$WORKSPACE_ROOT/skills" \
  "$WORKSPACE_ROOT/projects"

copy_if_missing() {
  local src="$1"
  local dst="$2"
  if [[ ! -e "$dst" ]]; then
    cp "$src" "$dst"
  fi
}

copy_if_missing "$REPO_ROOT/workspace-template/AGENTS.md" "$WORKSPACE_ROOT/AGENTS.md"
copy_if_missing "$REPO_ROOT/workspace-template/SOUL.md" "$WORKSPACE_ROOT/SOUL.md"
copy_if_missing "$REPO_ROOT/workspace-template/TOOLS.md" "$WORKSPACE_ROOT/TOOLS.md"
copy_if_missing "$REPO_ROOT/workspace-template/USER.md" "$WORKSPACE_ROOT/USER.md"
copy_if_missing "$REPO_ROOT/workspace-template/MEMORY.md" "$WORKSPACE_ROOT/MEMORY.md"
copy_if_missing "$REPO_ROOT/workspace-template/HEARTBEAT.md" "$WORKSPACE_ROOT/HEARTBEAT.md"
copy_if_missing "$REPO_ROOT/workspace-template/memory/README.md" "$WORKSPACE_ROOT/memory/README.md"

sync_skill_dir() {
  local src="$1"
  local dst="$2"
  rm -rf "$dst"
  mkdir -p "$dst"
  cp -R "$src"/. "$dst"/
}

sync_skill_dir "$REPO_ROOT/skills/ai_news_brief" "$WORKSPACE_ROOT/skills/ai_news_brief"
sync_skill_dir "$REPO_ROOT/skills/code_ops" "$WORKSPACE_ROOT/skills/code_ops"
sync_skill_dir "$REPO_ROOT/skills/memory_ops" "$WORKSPACE_ROOT/skills/memory_ops"
sync_skill_dir "$REPO_ROOT/skills/repo_ops" "$WORKSPACE_ROOT/skills/repo_ops"
sync_skill_dir "$REPO_ROOT/skills/system_ops" "$WORKSPACE_ROOT/skills/system_ops"

if [[ "$REPO_ROOT" != "$TARGET_REPO_DIR" ]]; then
  echo "Workspace scaffolded at: $WORKSPACE_ROOT"
  echo "Repo currently located at: $REPO_ROOT"
  echo
  echo "Recommended final repo path:"
  echo "  $TARGET_REPO_DIR"
  echo
  echo "If you have not already cloned the repo there, run:"
  echo "  git clone https://github.com/AstroHyo/opensec.git $TARGET_REPO_DIR"
else
  echo "Workspace scaffolded and linked to repo at $TARGET_REPO_DIR"
fi

echo
echo "Next steps:"
echo "  1. Copy $REPO_ROOT/openclaw.personal.example.jsonc to ~/.openclaw/openclaw.json"
echo "  2. Fill in Discord bot token, server ID, channel IDs, and owner user ID"
echo "  3. Run: openclaw onboard --install-daemon"
echo "  4. Run: openclaw gateway status"
echo "  5. Run: cd $TARGET_REPO_DIR/news-bot && pnpm install && pnpm approve-builds"
