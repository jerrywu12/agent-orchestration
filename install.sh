#!/usr/bin/env bash
# install.sh — Setup Agent Orchestration in the current repository
# Usage:
#   cd /path/to/your/new/project
#   /Users/jerry/agent-orchestrator-template/install.sh

set -euo pipefail

TEMPLATE_DIR="$(cd "$(dirname "$0")" && pwd)"
TARGET_DIR="${1:-$(pwd)}"

echo "Initializing Agent Orchestration Structure in $TARGET_DIR..."

# 1. Create target directories
mkdir -p "$TARGET_DIR/.agents"
mkdir -p "$TARGET_DIR/scripts"
mkdir -p "$TARGET_DIR/docs/reviews"
mkdir -p "$TARGET_DIR/storage/agent_queue/pending"

# 2. Copy templates to project root
echo "Copying role files and coordination docs..."
cp "$TEMPLATE_DIR/templates/CLAUDE.md.template" "$TARGET_DIR/CLAUDE.md"
cp "$TEMPLATE_DIR/templates/AGENTS.md.template" "$TARGET_DIR/AGENTS.md"
cp "$TEMPLATE_DIR/templates/GEMINI.md.template" "$TARGET_DIR/GEMINI.md"
cp "$TEMPLATE_DIR/templates/AGENT_COORDINATION.md.template" "$TARGET_DIR/docs/AGENT_COORDINATION.md"
cp "$TEMPLATE_DIR/config/.agents-config.json.template" "$TARGET_DIR/.agents/config.json"

# 3. Copy scripts to project scripts/
echo "Copying automation scripts..."
cp -R "$TEMPLATE_DIR/scripts/"* "$TARGET_DIR/scripts/"
chmod +x "$TARGET_DIR"/scripts/*.sh

# 4. Set up Git hooks
echo "Setting up local Git hooks..."
mkdir -p "$TARGET_DIR/.githooks"
cat << 'EOF' > "$TARGET_DIR/.githooks/post-commit"
#!/usr/bin/env bash
# Run generic commit notification
if [ -f "./scripts/notify_slack.sh" ]; then
  ./scripts/notify_slack.sh "Commit added on $(git branch --show-current): $(git log -1 --pretty=%B)" || true
fi
EOF
chmod +x "$TARGET_DIR/.githooks/post-commit"

# If in a Git repo, configure git to use the githooks path
if [ -d "$TARGET_DIR/.git" ]; then
  (cd "$TARGET_DIR" && git config core.hooksPath .githooks)
  echo "Git hooks configured successfully."
else
  echo "Warning: Target directory is not a Git repository. Run 'git init' and then link hooks with: git config core.hooksPath .githooks"
fi

echo "=========================================================="
echo "Done! The orchestration structure is successfully installed."
echo "Please configure '.agents/config.json' to customize your project settings."
echo "=========================================================="
