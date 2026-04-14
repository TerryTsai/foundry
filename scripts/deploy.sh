#!/usr/bin/env bash
set -euo pipefail

# Foundry deploy script — polls GitHub, rebuilds if new commits, restarts.
# Designed to run as a systemd oneshot triggered by a timer.
# Avoids data loss: SQLite DB is never touched by this script; the service
# manages it. Only source code, node_modules, and built artifacts change.

REPO_DIR="/home/terry/foundry"
LOG_PREFIX="[foundry-deploy]"

cd "$REPO_DIR"

# Fetch latest from origin without modifying the working tree
git fetch origin main --quiet

LOCAL=$(git rev-parse HEAD)
REMOTE=$(git rev-parse origin/main)

if [ "$LOCAL" = "$REMOTE" ]; then
  exit 0  # nothing new
fi

echo "$LOG_PREFIX $(date '+%Y-%m-%d %H:%M:%S') deploying $LOCAL → $REMOTE"

# Pull (fast-forward only — never creates merge commits)
git pull --ff-only origin main

# Rebuild service
echo "$LOG_PREFIX building service..."
cd "$REPO_DIR/service"
npm install --prefer-offline --no-audit --no-fund --silent
npm run build

# Rebuild web
echo "$LOG_PREFIX building web..."
cd "$REPO_DIR/web"
npm install --prefer-offline --no-audit --no-fund --silent
npm run build

# Rebuild sandbox image if Dockerfile changed
cd "$REPO_DIR"
if git diff --name-only "$LOCAL" "$REMOTE" | grep -q "Dockerfile.sandbox"; then
  echo "$LOG_PREFIX rebuilding sandbox image..."
  cd "$REPO_DIR/service"
  podman build -f Dockerfile.sandbox -t foundry-sandbox . --quiet
fi

# Restart the service (systemd picks up the new dist/)
echo "$LOG_PREFIX restarting service..."
systemctl --user restart foundry.service

echo "$LOG_PREFIX deployed $(git rev-parse --short HEAD)"
