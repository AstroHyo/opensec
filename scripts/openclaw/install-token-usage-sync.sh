#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
SERVICE_DIR="${HOME}/.config/systemd/user"
DB_PATH="${1:-${HOME}/.openclaw/telemetry/token-usage.sqlite}"
PYTHON_BIN="${PYTHON_BIN:-python3}"
SYNC_SCRIPT="${REPO_ROOT}/scripts/openclaw/token_usage_ledger.py"
SERVICE_NAME="openclaw-token-ledger-sync"

mkdir -p "${SERVICE_DIR}"
mkdir -p "$(dirname "${DB_PATH}")"

cat > "${SERVICE_DIR}/${SERVICE_NAME}.service" <<EOF
[Unit]
Description=OpenClaw token ledger sync

[Service]
Type=oneshot
WorkingDirectory=${REPO_ROOT}
ExecStart=/usr/bin/env ${PYTHON_BIN} ${SYNC_SCRIPT} sync --db-path ${DB_PATH}
EOF

cat > "${SERVICE_DIR}/${SERVICE_NAME}.timer" <<EOF
[Unit]
Description=Run OpenClaw token ledger sync every minute

[Timer]
OnCalendar=*-*-* *:*:00
Persistent=true
Unit=${SERVICE_NAME}.service

[Install]
WantedBy=timers.target
EOF

systemctl --user daemon-reload
systemctl --user enable --now "${SERVICE_NAME}.timer"
/usr/bin/env "${PYTHON_BIN}" "${SYNC_SCRIPT}" sync --db-path "${DB_PATH}"
/usr/bin/env "${PYTHON_BIN}" "${SYNC_SCRIPT}" report --db-path "${DB_PATH}" --days 7
