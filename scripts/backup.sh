#!/usr/bin/env bash
# Foundry backup script
# Usage: ./scripts/backup.sh [backup-dir]
# Default backup dir: ~/foundry-backups
# Designed to be run from cron: 0 3 * * * /home/terry/foundry/scripts/backup.sh

set -euo pipefail

FOUNDRY_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKUP_DIR="${1:-$HOME/foundry-backups}"
PORT="${PORT:-3001}"
MAX_BACKUPS=14   # keep 2 weeks of daily backups

mkdir -p "$BACKUP_DIR"

TIMESTAMP="$(date +%Y-%m-%dT%H-%M-%S)"
BACKUP_PATH="$BACKUP_DIR/foundry-$TIMESTAMP.tar.gz"

echo "[backup] Starting backup → $BACKUP_PATH"

# Check server is up
if ! curl -sf "http://localhost:$PORT/api/health" > /dev/null 2>&1; then
  echo "[backup] ERROR: Foundry server not responding on port $PORT" >&2
  exit 1
fi

# Trigger backup via API
RESULT="$(curl -sf -X POST "http://localhost:$PORT/api/admin/backup" \
  -H "Content-Type: application/json" \
  -d "{\"path\": \"$BACKUP_PATH\", \"compress\": true}")"

if [ $? -ne 0 ] || [ -z "$RESULT" ]; then
  echo "[backup] ERROR: Backup API call failed" >&2
  exit 1
fi

SIZE="$(echo "$RESULT" | python3 -c "import sys,json; print(json.load(sys.stdin).get('sizeBytes', 0))" 2>/dev/null || echo "?")"
echo "[backup] Done — $BACKUP_PATH (${SIZE} bytes)"

# Prune old backups — keep most recent MAX_BACKUPS
ls -1t "$BACKUP_DIR"/foundry-*.tar.gz 2>/dev/null \
  | tail -n "+$((MAX_BACKUPS + 1))" \
  | xargs -r rm --

KEPT="$(ls -1 "$BACKUP_DIR"/foundry-*.tar.gz 2>/dev/null | wc -l)"
echo "[backup] $KEPT backup(s) retained in $BACKUP_DIR"
