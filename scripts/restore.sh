#!/usr/bin/env bash
# Foundry restore script
# Usage: ./scripts/restore.sh <backup-file.tar.gz> [target-dir]
# WARNING: Stops the running Foundry process, replaces data, restarts.

set -euo pipefail

FOUNDRY_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKUP_FILE="${1:-}"
TARGET_DIR="${2:-$FOUNDRY_DIR}"

if [ -z "$BACKUP_FILE" ] || [ ! -f "$BACKUP_FILE" ]; then
  echo "Usage: $0 <backup-file.tar.gz> [target-dir]" >&2
  exit 1
fi

echo "[restore] Source: $BACKUP_FILE"
echo "[restore] Target: $TARGET_DIR"
read -r -p "[restore] This will overwrite the existing database. Continue? [y/N] " CONFIRM
if [[ "$CONFIRM" != "y" && "$CONFIRM" != "Y" ]]; then
  echo "[restore] Aborted."
  exit 0
fi

# Stop PM2 process if running
if command -v pm2 &>/dev/null && pm2 describe foundry &>/dev/null 2>&1; then
  echo "[restore] Stopping PM2 process..."
  pm2 stop foundry
fi

# Run restore via Node (uses the repo's restoreRepository function)
node --input-type=module <<EOF
import { restoreRepository } from '$FOUNDRY_DIR/dist/repository/index.js';
import { config as loadEnv } from '$FOUNDRY_DIR/node_modules/dotenv/lib/main.js';
loadEnv({ path: '$FOUNDRY_DIR/.env' });

const key = process.env.FOUNDRY_ENCRYPTION_KEY;
if (!key) { console.error('[restore] FOUNDRY_ENCRYPTION_KEY not set'); process.exit(1); }

const repo = await restoreRepository('$BACKUP_FILE', '$TARGET_DIR', key);
await repo.close();
console.log('[restore] Restore complete.');
EOF

# Restart if PM2 was running
if command -v pm2 &>/dev/null && pm2 describe foundry &>/dev/null 2>&1; then
  echo "[restore] Restarting PM2 process..."
  pm2 start foundry
fi

echo "[restore] Done."
