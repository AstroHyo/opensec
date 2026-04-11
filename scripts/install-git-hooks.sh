#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

git -C "$REPO_ROOT" config core.hooksPath .githooks

chmod 755 \
  "$REPO_ROOT/.githooks/private_training_guard.sh" \
  "$REPO_ROOT/.githooks/pre-commit" \
  "$REPO_ROOT/.githooks/pre-push"

echo "Installed OpenSec git hooks."
echo "core.hooksPath=$(git -C "$REPO_ROOT" config --get core.hooksPath)"
