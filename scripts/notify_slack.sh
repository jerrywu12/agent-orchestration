#!/usr/bin/env bash
# Post a message to Slack via an incoming webhook.
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CONFIG_FILE="$ROOT/.agents/config.json"
ENV_LOCAL="$ROOT/.env.local"

SLACK_CURL_BIN="${SLACK_CURL_BIN:-curl}"
SLACK_WEBHOOK_URL="${SLACK_WEBHOOK_URL:-}"

# Load webhook from config files if not in env
if [ -z "$SLACK_WEBHOOK_URL" ]; then
  if [ -f "$ENV_LOCAL" ]; then
    # Simple line-by-line grep to avoid sourcing arbitrary env scripts
    SLACK_WEBHOOK_URL=$(grep -E "^SLACK_WEBHOOK_URL=" "$ENV_LOCAL" | cut -d'=' -f2- | tr -d '"' | tr -d "'")
  fi
fi

# Fallback to shared home environment
if [ -z "$SLACK_WEBHOOK_URL" ] && [ -f "$HOME/.agent-orchestrator.env" ]; then
  SLACK_WEBHOOK_URL=$(grep -E "^SLACK_WEBHOOK_URL=" "$HOME/.agent-orchestrator.env" | cut -d'=' -f2- | tr -d '"' | tr -d "'")
fi

# Parse option to set webhook
if [ "${1:-}" = "--set" ]; then
  if [ -z "${2:-}" ]; then
    echo "Error: --set requires a webhook URL argument." >&2
    exit 1
  fi
  echo "SLACK_WEBHOOK_URL=\"$2\"" >> "$ENV_LOCAL"
  echo "Webhook URL saved to .env.local"
  exit 0
fi

if [ -z "$SLACK_WEBHOOK_URL" ]; then
  echo "SLACK_WEBHOOK_URL is not configured — skipping Slack notification." >&2
  exit 0
fi

# Load project name from config
PROJECT_NAME="Project"
if [ -f "$CONFIG_FILE" ]; then
  PROJECT_NAME=$(jq -r '.project_name // "Project"' "$CONFIG_FILE" 2>/dev/null || grep -o '"project_name": "[^"]*' "$CONFIG_FILE" | head -1 | cut -d'"' -f4 || echo "Project")
fi

MSG="${1:-}"
if [ -z "$MSG" ]; then
  echo "Error: message is required." >&2
  exit 1
fi

BRANCH="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo '?')"
SHA="$(git rev-parse --short HEAD 2>/dev/null || echo '?')"
TEXT="[$PROJECT_NAME @ ${BRANCH} ${SHA}] ${MSG}"

PAYLOAD=$(cat <<EOF
{
  "text": "$TEXT"
}
EOF
)

# Escape payload characters properly for JSON
ESCAPED_PAYLOAD=$(echo "$PAYLOAD" | python3 -c 'import json,sys; print(json.dumps({"text": sys.stdin.read().replace("{\n  \"text\": \"", "").rstrip("\"\n}")}))' 2>/dev/null || echo "$PAYLOAD")

CODE=$("$SLACK_CURL_BIN" -s -o /dev/null -w '%{http_code}' -X POST \
  -H 'Content-type: application/json' --data "$ESCAPED_PAYLOAD" "$SLACK_WEBHOOK_URL")

if [ "$CODE" = "200" ] || [ "$CODE" = "201" ]; then
  echo "Slack notified ✓"
  exit 0
else
  echo "Slack notify failed (HTTP $CODE)" >&2
  exit 1
fi
