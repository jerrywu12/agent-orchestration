#!/usr/bin/env bash
# install.sh — Set up Agent Orchestration in a target repository.
#
# Non-destructive: existing files are never silently overwritten. When a target
# file already exists and differs, the incoming template is written alongside it
# as "<file>.orchestration-new" for you to merge.
#
# Usage:
#   cd /path/to/your/project
#   /path/to/agent-orchestration/install.sh          # installs into $PWD
#   /path/to/agent-orchestration/install.sh <target> # installs into <target>

set -euo pipefail

TEMPLATE_DIR="$(cd "$(dirname "$0")" && pwd)"
TARGET_DIR="${1:-$(pwd)}"

echo "Initializing Agent Orchestration structure in $TARGET_DIR..."

# Copy src -> dst without clobbering. Identical files are skipped; differing
# existing files are preserved and the new version is written to *.orchestration-new.
install_file() {
  local src="$1" dst="$2"
  if [ -e "$dst" ]; then
    if cmp -s "$src" "$dst"; then
      return 0
    fi
    cp "$src" "$dst.orchestration-new"
    echo "  ! $dst exists and differs — left untouched; new template at $dst.orchestration-new" >&2
  else
    cp "$src" "$dst"
    echo "  + $dst"
  fi
}

# Ensure a line exists in the target .gitignore (exact match).
ensure_gitignore() {
  local entry="$1"
  local gi="$TARGET_DIR/.gitignore"
  if [ -f "$gi" ] && grep -qxF "$entry" "$gi"; then
    return 0
  fi
  echo "$entry" >> "$gi"
  echo "  + .gitignore: $entry"
}

# 1. Create target directories
mkdir -p "$TARGET_DIR/.agents"
mkdir -p "$TARGET_DIR/scripts"
mkdir -p "$TARGET_DIR/docs/reviews"
mkdir -p "$TARGET_DIR/storage/agent_queue/pending"

# 2. Copy role files and coordination docs (non-destructive)
echo "Installing role files and coordination docs..."
install_file "$TEMPLATE_DIR/templates/CLAUDE.md.template"             "$TARGET_DIR/CLAUDE.md"
install_file "$TEMPLATE_DIR/templates/AGENTS.md.template"             "$TARGET_DIR/AGENTS.md"
install_file "$TEMPLATE_DIR/templates/GEMINI.md.template"             "$TARGET_DIR/GEMINI.md"
install_file "$TEMPLATE_DIR/templates/AGENT_COORDINATION.md.template" "$TARGET_DIR/docs/AGENT_COORDINATION.md"
install_file "$TEMPLATE_DIR/config/.agents-config.json.template"      "$TARGET_DIR/.agents/config.json"

# 3. Copy scripts (non-destructive, per file)
echo "Installing automation scripts..."
for s in "$TEMPLATE_DIR"/scripts/*; do
  [ -f "$s" ] || continue
  install_file "$s" "$TARGET_DIR/scripts/$(basename "$s")"
done
chmod +x "$TARGET_DIR"/scripts/*.sh 2>/dev/null || true

# 4. Protect secrets and local runtime state from being committed
echo "Updating .gitignore..."
ensure_gitignore ".env.local"
ensure_gitignore "storage/agent_queue/pending/"

# 5. Set up the commit-notification hook (non-blocking, cwd-independent)
echo "Setting up local Git hooks..."
mkdir -p "$TARGET_DIR/.githooks"
cat << 'EOF' > "$TARGET_DIR/.githooks/post-commit"
#!/usr/bin/env bash
# Non-blocking commit notification. Resolves the repo root so it works from any
# cwd (including subdirectories and worktrees), and uses the commit subject only.
ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
if [ -x "$ROOT/scripts/notify_slack.sh" ]; then
  branch="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo '?')"
  subject="$(git log -1 --pretty=%s 2>/dev/null)"
  # Fire-and-forget: committing is never blocked on the network call.
  ( "$ROOT/scripts/notify_slack.sh" "commit on $branch: $subject" >/dev/null 2>&1 & )
fi
EOF
chmod +x "$TARGET_DIR/.githooks/post-commit"

# Configure git to use .githooks — but never hijack an existing hooks setup.
if [ -d "$TARGET_DIR/.git" ]; then
  existing_hookspath="$(cd "$TARGET_DIR" && git config --get core.hooksPath || true)"
  if [ -z "$existing_hookspath" ]; then
    (cd "$TARGET_DIR" && git config core.hooksPath .githooks)
    echo "Git hooks configured (core.hooksPath=.githooks)."
  elif [ "$existing_hookspath" = ".githooks" ]; then
    echo "Git hooks already point to .githooks."
  else
    echo "! core.hooksPath is already '$existing_hookspath' — NOT overriding it." >&2
    echo "  To enable commit notifications, add .githooks/post-commit into your existing hooks." >&2
  fi
else
  echo "Warning: $TARGET_DIR is not a Git repository."
  echo "  Run 'git init', then: git config core.hooksPath .githooks"
fi

echo "=========================================================="
echo "Done. Agent Orchestration structure installed."
echo "Next: configure '.agents/config.json', then run:"
echo "  ./scripts/agent_workflow.sh doctor"
echo "=========================================================="
