#!/bin/bash
# Build and install the Agent Desk menu bar indicator.
#
# Usage:  ./install.sh [install|uninstall]
#
# Installs a LaunchAgent that keeps the indicator running and restarts it at
# login. The indicator is a display client for Agent Desk's /api/activity; it
# performs no observation of its own.

set -euo pipefail

LABEL="local.agent.agent-desk-menubar"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
DEST_DIR="$HOME/.local/share/agent-desk/menubar"
DEST="$DEST_DIR/AgentDeskMenuBar"
STATE_DIR="$HOME/.local/state/agent-desk"
SRC="$(cd "$(dirname "$0")" && pwd)/AgentDeskMenuBar.swift"

action="${1:-install}"

uninstall() {
  if launchctl print "gui/$(id -u)/$LABEL" >/dev/null 2>&1; then
    launchctl bootout "gui/$(id -u)/$LABEL" || true
  fi
  rm -f "$PLIST"
  rm -f "$DEST"
  echo "Agent Desk menu bar indicator removed."
}

if [ "$action" = "uninstall" ]; then
  uninstall
  exit 0
fi

if [ "$action" != "install" ]; then
  echo "Usage: $0 [install|uninstall]" >&2
  exit 2
fi

command -v swiftc >/dev/null 2>&1 || {
  echo "swiftc not found. Install the Xcode Command Line Tools: xcode-select --install" >&2
  exit 1
}

mkdir -p "$DEST_DIR" "$STATE_DIR"

# Build to a temporary path first so a failed build never replaces a working
# binary.
tmp="$(mktemp -t AgentDeskMenuBar)"
swiftc -O -o "$tmp" "$SRC"
chmod +x "$tmp"
mv "$tmp" "$DEST"

cat > "$PLIST" <<PLISTEOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>$LABEL</string>
    <key>ProgramArguments</key>
    <array>
        <string>$DEST</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>ProcessType</key>
    <string>Interactive</string>
    <key>LimitLoadToSessionType</key>
    <string>Aqua</string>
    <key>StandardOutPath</key>
    <string>$STATE_DIR/menubar.log</string>
    <key>StandardErrorPath</key>
    <string>$STATE_DIR/menubar.err.log</string>
</dict>
</plist>
PLISTEOF

# Reload so an existing indicator picks up the new binary.
if launchctl print "gui/$(id -u)/$LABEL" >/dev/null 2>&1; then
  launchctl bootout "gui/$(id -u)/$LABEL" || true
fi
launchctl bootstrap "gui/$(id -u)" "$PLIST"

echo "Agent Desk menu bar indicator installed and running."
echo "  binary: $DEST"
echo "  agent:  $PLIST"
