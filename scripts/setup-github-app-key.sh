#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_dir="$(cd "$script_dir/.." && pwd)"
env_file="$repo_dir/.env"
app_id="${1:-}"
pem_source="${2:-}"

if [[ -z "$app_id" ]]; then
  read -r -p "GitHub App ID (numeric, not Client ID): " app_id
fi
if [[ ! "$app_id" =~ ^[0-9]+$ ]]; then
  echo "Error: GitHub App ID must be numeric." >&2
  exit 1
fi

if [[ -z "$pem_source" ]]; then
  read -r -p "Path to the downloaded GitHub App .pem file: " pem_source
fi
pem_source="${pem_source/#\~/$HOME}"
if [[ ! -f "$pem_source" ]]; then
  echo "Error: PEM file not found: $pem_source" >&2
  exit 1
fi
if ! openssl pkey -in "$pem_source" -noout >/dev/null 2>&1; then
  echo "Error: that file is not a valid private key." >&2
  exit 1
fi
if [[ ! -f "$env_file" ]]; then
  echo "Error: Foundry environment file not found: $env_file" >&2
  exit 1
fi

key_dir="$HOME/.config/foundry"
key_path="$key_dir/github-app.pem"
mkdir -p "$key_dir"
chmod 700 "$key_dir"
if [[ "$(readlink -f "$pem_source")" != "$key_path" ]]; then
  install -m 600 "$pem_source" "$key_path"
else
  chmod 600 "$key_path"
fi

tmp_file="$(mktemp "$env_file.tmp.XXXXXX")"
trap 'rm -f "$tmp_file"' EXIT
awk -v app_id="$app_id" -v key_path="$key_path" '
  BEGIN { saw_id = 0; saw_path = 0 }
  /^GITHUB_APP_ID=/ { print "GITHUB_APP_ID=" app_id; saw_id = 1; next }
  /^GITHUB_APP_PRIVATE_KEY_PATH=/ { print "GITHUB_APP_PRIVATE_KEY_PATH=" key_path; saw_path = 1; next }
  { print }
  END {
    if (!saw_id) print "GITHUB_APP_ID=" app_id
    if (!saw_path) print "GITHUB_APP_PRIVATE_KEY_PATH=" key_path
  }
' "$env_file" > "$tmp_file"
chmod 600 "$tmp_file"
mv "$tmp_file" "$env_file"
trap - EXIT

systemctl --user restart foundry.service
for _ in {1..10}; do
  if curl -fsS http://127.0.0.1:3000/health >/dev/null; then
    echo "GitHub App key installed and Foundry restarted successfully."
    echo "Ensure the GitHub App is installed on the repositories Foundry should use."
    exit 0
  fi
  sleep 1
done

echo "Foundry did not become healthy. Check: journalctl --user -u foundry.service -n 50" >&2
exit 1
