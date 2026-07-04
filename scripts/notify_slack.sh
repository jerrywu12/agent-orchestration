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
  touch "$ENV_LOCAL"
  # Replace any existing entry rather than appending duplicate lines (a repeated
  # --set otherwise leaves multiple SLACK_WEBHOOK_URL= lines that the reader
  # below collapses into one broken multi-line value).
  if grep -qE '^SLACK_WEBHOOK_URL=' "$ENV_LOCAL" 2>/dev/null; then
    grep -vE '^SLACK_WEBHOOK_URL=' "$ENV_LOCAL" > "$ENV_LOCAL.tmp" && mv "$ENV_LOCAL.tmp" "$ENV_LOCAL"
  fi
  printf 'SLACK_WEBHOOK_URL="%s"\n' "$2" >> "$ENV_LOCAL"
  echo "Webhook URL saved to .env.local"
  echo "Reminder: keep .env.local gitignored so the webhook secret is never committed." >&2
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

# Build the JSON payload in one shot so quotes, backticks, and newlines in the
# message are escaped correctly (the old hand-built-then-string-stripped version
# corrupted messages containing any of those).
if command -v jq >/dev/null 2>&1; then
  PAYLOAD=$(jq -n --arg t "$TEXT" '{text:$t}')
else
  PAYLOAD=$(TEXT="$TEXT" python3 -c 'import json,os; print(json.dumps({"text": os.environ["TEXT"]}))')
fi

CODE=$("$SLACK_CURL_BIN" -s -o /dev/null -w '%{http_code}' -X POST \
  -H 'Content-type: application/json' --data "$PAYLOAD" "$SLACK_WEBHOOK_URL")

if [ "$CODE" = "200" ] || [ "$CODE" = "201" ]; then
  echo "Slack notified ✓"
  exit 0
else
  echo "Slack notify failed (HTTP $CODE)" >&2
  exit 1
fi
