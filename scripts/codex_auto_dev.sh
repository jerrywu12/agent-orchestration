#!/usr/bin/env bash
# Codex execution wrapper.
#
# NOTE: This is a PLACEHOLDER runner. It sets up an isolated worktree and runs
# the verification gate, but it does NOT invoke an LLM/agent and does NOT push
# or open a PR. A green gate here therefore does NOT mean the spec was
# implemented. Wire your Codex CLI in at the marked TODO before relying on this
# in an automated pipeline.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CONFIG_FILE="$ROOT/.agents/config.json"

if [ -f "$CONFIG_FILE" ]; then
  PROJECT_NAME=$(grep -o '"project_name": "[^"]*' "$CONFIG_FILE" | head -1 | cut -d'"' -f4 || echo "Project")
  NAMESPACE=$(grep -o '"branches_namespace": "[^"]*' "$CONFIG_FILE" | head -1 | cut -d'"' -f4 || echo "agent")
  NAMESPACE="${NAMESPACE:-agent}"
else
  PROJECT_NAME="Project"
  NAMESPACE="agent"
fi

SPEC_PATH="${1:-}"
if [ -z "$SPEC_PATH" ]; then
  echo "Usage: ./scripts/codex_auto_dev.sh <spec_path>" >&2
  exit 1
fi

echo "=========================================================="
echo "Codex runner (PLACEHOLDER) for $PROJECT_NAME"
echo "Spec: $SPEC_PATH"
echo "=========================================================="

# Canonical slug — must match agent_worktree.sh slugify() so that 'create' and
# 'path' resolve to the SAME directory (collapse runs of non-alphanumerics and
# trim leading/trailing dashes).
SLUG=$(basename "$SPEC_PATH" \
  | sed -E 's/_DEV_PLAN\.md$//' \
  | tr '[:upper:]' '[:lower:]' \
  | sed -E 's/[^a-z0-9]+/-/g; s/^-+//; s/-+$//')
BRANCH="$NAMESPACE/codex/$SLUG"

# 1. Create clean worktree
echo "Creating isolated worktree for branch: $BRANCH..."
"$ROOT/scripts/agent_worktree.sh" create "$SLUG" --branch "$BRANCH"
WORKTREE_PATH=$("$ROOT/scripts/agent_worktree.sh" path "$SLUG")

# 2. Execute within the worktree
cd "$WORKTREE_PATH"

# ---------------------------------------------------------------------------
# TODO: Invoke your Codex agent here to implement the spec inside this worktree,
#       e.g.:  codex exec --cd "$WORKTREE_PATH" --spec "$SPEC_PATH"
# The placeholder makes no edits, so the gate below runs against an UNCHANGED
# tree. Do not treat a green gate as evidence that the spec was implemented.
# ---------------------------------------------------------------------------
echo "[placeholder] No agent invoked — no source changes were made."

echo "Running verification gate..."
./scripts/dev_check.sh fast

echo "Running spec-coverage check (advisory)..."
./scripts/spec_coverage_verify.sh "$SPEC_PATH" "$BRANCH"

# 3. Push / open PR — intentionally NOT performed by the placeholder.
echo "[placeholder] Skipping push and PR (no agent ran)."
# When wired up, replace the line above with something like:
#   git -C "$WORKTREE_PATH" push -u origin "$BRANCH"
#   gh pr create --head "$BRANCH" --fill

# 4. Notify Slack (honest status — no false "tests passed / PR opened" claim)
if [ -f "$ROOT/scripts/notify_slack.sh" ]; then
  "$ROOT/scripts/notify_slack.sh" \
    "codex runner (placeholder) prepared worktree + ran gate for $(basename "$SPEC_PATH") on $BRANCH — no agent/push/PR yet" || true
fi

echo "Placeholder runner finished: worktree prepared and gate run; no implementation performed."
