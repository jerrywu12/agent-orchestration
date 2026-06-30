#!/usr/bin/env bash
# Runs project tests dynamically using config settings.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CONFIG_FILE="$ROOT/.agents/config.json"

if [ ! -f "$CONFIG_FILE" ]; then
  echo "Error: Config file not found at $CONFIG_FILE" >&2
  exit 1
fi

MODE="${1:-fast}" # fast or full

# Parse commands from json
FAST_CMD=$(python3 -c "import json; print(json.load(open('$CONFIG_FILE'))['fast_test_command'])" 2>/dev/null || echo "npm run test")
FULL_CMD=$(python3 -c "import json; print(json.load(open('$CONFIG_FILE'))['full_test_command'])" 2>/dev/null || echo "npm run test:full")

echo "Running verification gate in MODE: $MODE"

if [ "$MODE" = "fast" ]; then
  echo "Command: $FAST_CMD"
  eval "$FAST_CMD"
else
  echo "Command: $FULL_CMD"
  eval "$FULL_CMD"
fi

echo "VERIFY: PASS"
