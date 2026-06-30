#!/usr/bin/env bash
# Scoped and timing-enabled verification gate wrapper.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MODE="${1:-fast}"

if [ "$MODE" = "fast" ] || [ "$MODE" = "full" ]; then
  exec "$ROOT/scripts/verify_for_changes.sh" "$MODE"
elif [ "$MODE" = "plan" ]; then
  echo "Planning check scope..."
  echo "Fast checks will run: $(python3 -c "import json; print(json.load(open('$ROOT/.agents/config.json'))['fast_test_command'])")"
else
  echo "Unknown check mode: $MODE" >&2
  echo "Usage: ./scripts/dev_check.sh [fast|full|plan]" >&2
  exit 1
fi
