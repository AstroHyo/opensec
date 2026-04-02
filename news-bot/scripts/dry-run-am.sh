#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

pnpm --dir "$ROOT" run digest -- \
  --mode am \
  --db ./data/dry-run-am.sqlite \
  --seed-fixture ./fixtures/sample-items.json \
  --skip-fetch \
  --reset-db \
  --now 2026-03-27T10:00:00-04:00
