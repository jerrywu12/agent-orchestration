#!/bin/bash
# Build and install Agent Desk's macOS components as a single app bundle.
#
# Usage:  ./install.sh [install|uninstall]
#
# Both the menu bar indicator and the background server run from one bundle,
# `Agent Desk.app`. macOS groups background items by the bundle they belong to,
# so this produces a single "Agent Desk" row in
# System Settings > General > Login Items & Extensions, rather than one opaque
# row per executable ("AgentDeskMenuBar", "node", ...).
#
# The indicator observes nothing; it is a display client for /api/activity.

set -euo pipefail

MENUBAR_LABEL="local.agent.agent-desk-menubar"
SERVER_LABEL="local.agent.agent-desk"
LA_DIR="$HOME/Library/LaunchAgents"
MENUBAR_PLIST="$LA_DIR/$MENUBAR_LABEL.plist"
SERVER_PLIST="$LA_DIR/$SERVER_LABEL.plist"
DATA_DIR="$HOME/.local/share/agent-desk"
APP_BUNDLE="$DATA_DIR/Agent Desk.app"
MACOS_DIR="$APP_BUNDLE/Contents/MacOS"
STATE_DIR="$HOME/.local/state/agent-desk"
SRC="$(cd "$(dirname "$0")" && pwd)/AgentDeskMenuBar.swift"

uid="$(id -u)"

# Bootout is asynchronous: launchd can still hold the label when bootstrap runs,
# which fails with "Input/output error". Wait for the label to actually go.
unload_label() {
  local label="$1"
  launchctl bootout "gui/$uid/$label" 2>/dev/null || true
  for _ in $(seq 1 25); do
    launchctl print "gui/$uid/$label" >/dev/null 2>&1 || return 0
    sleep 0.2
  done
  echo "warning: $label did not unload cleanly" >&2
}

uninstall() {
  unload_label "$MENUBAR_LABEL"
  rm -f "$MENUBAR_PLIST"
  rm -f "$MACOS_DIR/AgentDeskMenuBar"
  echo "Agent Desk menu bar indicator removed."
  echo "The server ($SERVER_LABEL) was left running; reinstall with bin/install.mjs."
}

action="${1:-install}"
case "$action" in
  uninstall) uninstall; exit 0 ;;
  install) ;;
  *) echo "Usage: $0 [install|uninstall]" >&2; exit 2 ;;
esac

command -v swiftc >/dev/null 2>&1 || {
  echo "swiftc not found. Install the Xcode Command Line Tools: xcode-select --install" >&2
  exit 1
}

mkdir -p "$MACOS_DIR" "$STATE_DIR"

# --- Bundle metadata -------------------------------------------------------
# CFBundleName is what System Settings shows. LSUIElement keeps the menu bar
# app out of the Dock and the app switcher.
cat > "$APP_BUNDLE/Contents/Info.plist" <<'PLISTEOF'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>CFBundleName</key>
    <string>Agent Desk</string>
    <key>CFBundleDisplayName</key>
    <string>Agent Desk</string>
    <key>CFBundleIdentifier</key>
    <string>local.agent.agent-desk</string>
    <key>CFBundleExecutable</key>
    <string>AgentDeskMenuBar</string>
    <key>CFBundlePackageType</key>
    <string>APPL</string>
    <key>CFBundleShortVersionString</key>
    <string>1.0.0</string>
    <key>CFBundleVersion</key>
    <string>1</string>
    <key>LSUIElement</key>
    <true/>
    <key>LSMinimumSystemVersion</key>
    <string>13.0</string>
</dict>
</plist>
PLISTEOF

# --- Menu bar executable ---------------------------------------------------
# Build to a temporary path first so a failed build never replaces a working
# binary.
tmp="$(mktemp -t AgentDeskMenuBar)"
swiftc -O -o "$tmp" "$SRC"
chmod +x "$tmp"
mv "$tmp" "$MACOS_DIR/AgentDeskMenuBar"

# --- Server executable -----------------------------------------------------
# A thin wrapper so the server also runs from inside the bundle and is
# attributed to "Agent Desk" rather than appearing as a bare "node" item. The
# node path is taken from the existing server LaunchAgent when present, so this
# script never disagrees with what bin/install.mjs chose.
node_bin=""
if [ -f "$SERVER_PLIST" ]; then
  node_bin="$(/usr/libexec/PlistBuddy -c 'Print :ProgramArguments:0' "$SERVER_PLIST" 2>/dev/null || true)"
fi
if [ -z "$node_bin" ] || [ ! -x "$node_bin" ]; then
  node_bin="$(command -v node || true)"
fi
if [ -z "$node_bin" ]; then
  echo "Could not determine the node binary for the server wrapper." >&2
  exit 1
fi

cat > "$MACOS_DIR/AgentDeskServer" <<WRAPEOF
#!/bin/bash
# Runs the Agent Desk server from inside Agent Desk.app so macOS attributes the
# background item to the bundle. Environment comes from the LaunchAgent.
exec "$node_bin" "$DATA_DIR/app/server/http.mjs" "\$@"
WRAPEOF
chmod +x "$MACOS_DIR/AgentDeskServer"

# --- Sign ------------------------------------------------------------------
# Ad-hoc signature. It does not establish a developer identity, but it does give
# the bundle a stable code identity so macOS attributes both executables to it.
codesign --force --deep --sign - "$APP_BUNDLE" >/dev/null 2>&1 || {
  echo "warning: ad-hoc codesign failed; items may still be listed separately" >&2
}

# --- LaunchAgents ----------------------------------------------------------
write_plist() {
  local path="$1" label="$2" program="$3" out="$4" err="$5"
  cat > "$path" <<AGENTEOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>$label</string>
    <key>ProgramArguments</key>
    <array>
        <string>$program</string>
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
    <string>$out</string>
    <key>StandardErrorPath</key>
    <string>$err</string>
</dict>
</plist>
AGENTEOF
}

write_plist "$MENUBAR_PLIST" "$MENUBAR_LABEL" \
  "$MACOS_DIR/AgentDeskMenuBar" \
  "$STATE_DIR/menubar.log" "$STATE_DIR/menubar.err.log"

unload_label "$MENUBAR_LABEL"
launchctl bootstrap "gui/$uid" "$MENUBAR_PLIST"

echo "Agent Desk menu bar indicator installed and running."
echo "  bundle: $APP_BUNDLE"
echo "  agent:  $MENUBAR_PLIST"
echo
echo "The server LaunchAgent is written by bin/install.mjs; run an apply there"
echo "to move it into the bundle so both appear as one \"Agent Desk\" item."
