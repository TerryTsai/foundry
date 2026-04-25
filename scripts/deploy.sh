#!/usr/bin/env bash
set -euo pipefail

# Foundry deploy script — polls GitHub, rebuilds if new commits, restarts.
# Designed to run as a systemd oneshot triggered by a timer.
# Avoids data loss: SQLite DB is never touched by this script; the service
# manages it. Only source code, node_modules, and built artifacts change.

REPO_DIR="/home/terry/foundry"
STATE_FILE="$REPO_DIR/.foundry-deployed-sha"
LOG_PREFIX="[foundry-deploy]"

cd "$REPO_DIR"

# Fetch latest from origin without modifying the working tree
git fetch origin main --quiet

# Fast-forward local main to origin if behind (no-op if already up to date,
# e.g. the commit was made locally on this machine before pushing).
git pull --ff-only origin main --quiet

HEAD_SHA=$(git rev-parse HEAD)
DEPLOYED_SHA=$(cat "$STATE_FILE" 2>/dev/null || echo "")

if [ "$HEAD_SHA" = "$DEPLOYED_SHA" ]; then
  exit 0  # already deployed
fi

echo "$LOG_PREFIX $(date '+%Y-%m-%d %H:%M:%S') deploying ${DEPLOYED_SHA:-<none>} → $HEAD_SHA"

# Install workspace deps from the repo root so every package under
# packages/* and service/ is wired up in one pass.
echo "$LOG_PREFIX installing deps..."
npm install --prefer-offline --no-audit --no-fund --silent

# Build the SPA. The server (run via tsx) statically serves
# packages/site/dist when it exists.
echo "$LOG_PREFIX building site..."
npm run build --workspace=@foundry/site --silent

# Rebuild sandbox image if its Dockerfile changed since last deploy.
if [ -n "$DEPLOYED_SHA" ] && git diff --name-only "$DEPLOYED_SHA" "$HEAD_SHA" \
     | grep -qE '^service/Dockerfile\.sandbox$'; then
  echo "$LOG_PREFIX rebuilding sandbox image..."
  cd "$REPO_DIR/service"
  podman build -f Dockerfile.sandbox -t foundry-sandbox . --quiet
  cd "$REPO_DIR"
fi

# Restart the service (tsx re-reads source on start).
echo "$LOG_PREFIX restarting service..."
systemctl --user restart foundry.service

echo "$HEAD_SHA" > "$STATE_FILE"
echo "$LOG_PREFIX deployed $(git rev-parse --short HEAD)"
