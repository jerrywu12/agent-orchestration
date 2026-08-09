#!/usr/bin/env bash
# Runs the project verification stages configured in .agents/config.json.
#
# Modes:
#   fast      fast_test_command, then the property stage (if configured)
#   full      full_test_command, then the property stage (if configured)
#   mutation  mutation_test_command only — slow; meant for the pre-PR path,
#             not the agent's iterate-until-green loop
#
# Optional anti-reward-hacking stages (see docs/AGENT_COORDINATION.md):
#   property_test_command   property-based tests (Hypothesis / fast-check / …):
#                           randomized inputs make hardcoded answers fail
#   mutation_test_command   mutation testing (mutmut / Stryker / …): surviving
#                           mutants expose weak tests and dead shortcut code
# Unset stages are reported as SKIPPED — honestly, never as a fake PASS.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CONFIG_FILE="$ROOT/.agents/config.json"

if [ ! -f "$CONFIG_FILE" ]; then
  echo "Error: Config file not found at $CONFIG_FILE" >&2
  exit 1
fi

MODE="${1:-fast}" # fast, full, or mutation

# Parse commands from json
FAST_CMD=$(python3 -c "import json; print(json.load(open('$CONFIG_FILE'))['fast_test_command'])" 2>/dev/null || echo "npm run test")
FULL_CMD=$(python3 -c "import json; print(json.load(open('$CONFIG_FILE'))['full_test_command'])" 2>/dev/null || echo "npm run test:full")
PROP_CMD=$(python3 -c "import json; print(json.load(open('$CONFIG_FILE')).get('property_test_command',''))" 2>/dev/null || echo "")
MUT_CMD=$(python3 -c "import json; print(json.load(open('$CONFIG_FILE')).get('mutation_test_command',''))" 2>/dev/null || echo "")

echo "Running verification gate in MODE: $MODE"

if [ "$MODE" = "mutation" ]; then
  if [ -z "$MUT_CMD" ]; then
    echo "MUTATION: SKIPPED (mutation_test_command not configured)"
    exit 0
  fi
  echo "Command: $MUT_CMD"
  eval "$MUT_CMD"
  echo "MUTATION: PASS"
  exit 0
fi

if [ "$MODE" = "fast" ]; then
  echo "Command: $FAST_CMD"
  eval "$FAST_CMD"
else
  echo "Command: $FULL_CMD"
  eval "$FULL_CMD"
fi

# Property-based stage: randomized inputs the coder agent cannot predict, so
# hardcoded fixture answers fail here even when the unit suite is green.
if [ -n "$PROP_CMD" ]; then
  echo "Running property-based stage: $PROP_CMD"
  eval "$PROP_CMD"
  echo "PROPERTY: PASS"
else
  echo "PROPERTY: SKIPPED (property_test_command not configured)"
fi

echo "VERIFY: PASS"
