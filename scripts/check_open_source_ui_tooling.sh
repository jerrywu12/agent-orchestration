#!/usr/bin/env bash
# Print the installed shared UI tooling status and update hints.

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TOOLS_DIR="$ROOT_DIR/tools/open-source-ui-tooling"
BIN_DIR="${AGENT_TOOL_BIN_DIR:-/Users/jerry/.local/bin}"

echo "Shared UI tooling root: $TOOLS_DIR"
echo "Global wrapper dir: $BIN_DIR"
echo

check_command() {
  local label="$1"
  local command_name="$2"
  if command -v "$command_name" >/dev/null 2>&1; then
    printf "%-26s %s\n" "$label" "$(command -v "$command_name")"
  else
    printf "%-26s MISSING\n" "$label"
  fi
}

check_command "agent-playwright" "agent-playwright"
check_command "agent-playwright-test" "agent-playwright-test"
check_command "agent-playwright-mcp" "agent-playwright-mcp"
check_command "agent-storybook" "agent-storybook"
check_command "agent-chrome-devtools" "agent-chrome-devtools-mcp"
check_command "storybook" "storybook"
check_command "chrome-devtools-mcp" "chrome-devtools-mcp"
echo

if [[ ! -d "$TOOLS_DIR/node_modules" ]]; then
  echo "Packages are not installed yet. Run: $ROOT_DIR/scripts/install_open_source_ui_tooling.sh"
  exit 1
fi

echo "Versions:"
"$TOOLS_DIR/node_modules/.bin/playwright" --version
"$TOOLS_DIR/node_modules/.bin/playwright-mcp" --version
"$TOOLS_DIR/node_modules/.bin/storybook" --version
"$TOOLS_DIR/node_modules/.bin/chrome-devtools-mcp" --version 2>/dev/null
echo

echo "Tracked npm packages:"
(cd "$TOOLS_DIR" && npm list --depth=0)
echo

echo "Update check:"
(cd "$TOOLS_DIR" && npm outdated || true)
