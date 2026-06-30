#!/usr/bin/env bash
# Install/update shared open-source UI tooling and global wrappers.

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TOOLS_DIR="$ROOT_DIR/tools/open-source-ui-tooling"
BIN_DIR="${AGENT_TOOL_BIN_DIR:-/Users/jerry/.local/bin}"
WRAPPERS_ONLY=0

if [[ "${1:-}" == "--wrappers-only" ]]; then
  WRAPPERS_ONLY=1
fi

mkdir -p "$BIN_DIR"

if [[ "$WRAPPERS_ONLY" != "1" ]]; then
  echo "Installing shared UI tooling packages in $TOOLS_DIR"
  (cd "$TOOLS_DIR" && npm install)
  echo "Installing Playwright browser binaries"
  "$TOOLS_DIR/node_modules/.bin/playwright" install chromium
fi

write_wrapper() {
  local command_name="$1"
  local bin_name="$2"
  local target="$BIN_DIR/$command_name"
  cat > "$target" <<EOF
#!/usr/bin/env bash
set -euo pipefail
exec "$TOOLS_DIR/node_modules/.bin/$bin_name" "\$@"
EOF
  chmod +x "$target"
}

write_wrapper "agent-playwright" "playwright"
write_wrapper "agent-playwright-test" "playwright"
write_wrapper "agent-playwright-mcp" "playwright-mcp"
write_wrapper "agent-storybook" "storybook"
write_wrapper "agent-chrome-devtools-mcp" "chrome-devtools-mcp"

# Friendly canonical command names. These may intentionally replace older npm-global shims.
write_wrapper "playwright" "playwright"
write_wrapper "playwright-mcp" "playwright-mcp"
write_wrapper "storybook" "storybook"
write_wrapper "chrome-devtools-mcp" "chrome-devtools-mcp"

echo "Installed wrappers in $BIN_DIR"
echo "Run $ROOT_DIR/scripts/check_open_source_ui_tooling.sh to verify."
