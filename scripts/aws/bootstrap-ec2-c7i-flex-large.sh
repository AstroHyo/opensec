#!/usr/bin/env bash
set -euo pipefail

if [[ "${EUID}" -eq 0 ]]; then
  echo "Run this script as your normal sudo-capable user, not as root."
  exit 1
fi

WORKSPACE_ROOT="${WORKSPACE_ROOT:-/srv/openclaw/workspace-personal}"
REPO_URL="${REPO_URL:-https://github.com/AstroHyo/opensec.git}"
REPO_DIR="${REPO_DIR:-$WORKSPACE_ROOT/projects/opensec}"
SWAPFILE_PATH="${SWAPFILE_PATH:-/swapfile}"
SWAP_SIZE_GB="${SWAP_SIZE_GB:-4}"
NODE_MAJOR="${NODE_MAJOR:-24}"

echo "==> Installing base packages"
sudo apt update
sudo apt install -y git curl ca-certificates build-essential jq unzip

echo "==> Ensuring swapfile (${SWAP_SIZE_GB}G)"
if ! sudo swapon --show | grep -q "^${SWAPFILE_PATH} "; then
  if [[ ! -f "${SWAPFILE_PATH}" ]]; then
    sudo fallocate -l "${SWAP_SIZE_GB}G" "${SWAPFILE_PATH}" || \
      sudo dd if=/dev/zero of="${SWAPFILE_PATH}" bs=1G count="${SWAP_SIZE_GB}" status=progress
    sudo chmod 600 "${SWAPFILE_PATH}"
    sudo mkswap "${SWAPFILE_PATH}"
  fi

  sudo swapon "${SWAPFILE_PATH}"
  if ! grep -q "^${SWAPFILE_PATH} " /etc/fstab; then
    echo "${SWAPFILE_PATH} none swap sw 0 0" | sudo tee -a /etc/fstab >/dev/null
  fi
fi

echo "==> Installing Node.js ${NODE_MAJOR}"
if ! command -v node >/dev/null 2>&1; then
  curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | sudo -E bash -
  sudo apt install -y nodejs
fi

echo "==> Enabling Corepack / pnpm"
sudo corepack enable
sudo corepack prepare pnpm@10.8.1 --activate

echo "==> Preparing workspace directory"
sudo mkdir -p "${WORKSPACE_ROOT}/projects"
sudo chown -R "${USER}:${USER}" /srv/openclaw

echo "==> Cloning OpenSec repo if missing"
if [[ ! -d "${REPO_DIR}/.git" ]]; then
  git clone "${REPO_URL}" "${REPO_DIR}"
fi

echo "==> Bootstrapping personal workspace"
cd "${REPO_DIR}"
chmod +x ./scripts/setup-personal-workspace.sh
WORKSPACE_ROOT="${WORKSPACE_ROOT}" ./scripts/setup-personal-workspace.sh

echo "==> Installing news-bot dependencies"
cd "${REPO_DIR}/news-bot"
pnpm install

cat <<EOF

Bootstrap complete.

Next manual steps:
  1. Run: pnpm approve-builds
     Approve: better-sqlite3, esbuild
  2. Create: ${REPO_DIR}/news-bot/.env
  3. Copy: ${REPO_DIR}/openclaw.personal.example.jsonc -> ~/.openclaw/openclaw.json
  4. Fill Telegram bot token and numeric user ID in ~/.openclaw/openclaw.json
  5. Run: curl -fsSL https://openclaw.ai/install.sh | bash
  6. Run: openclaw onboard --install-daemon
  7. Validate:
     - openclaw gateway status
     - cd ${REPO_DIR}/news-bot && pnpm test
     - ./scripts/dry-run-am.sh
EOF
