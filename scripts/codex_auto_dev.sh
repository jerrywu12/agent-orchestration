#!/usr/bin/env bash
# Codex execution wrapper.
#
# Behaviour depends on whether a developer agent CLI is available:
#   - If `codex_cmd` (config) / $CODEX_CMD resolves to an installed binary, it is
#     invoked to implement the spec inside an isolated worktree, then the gate is
#     run and (opt-in) a PR is opened.
#   - Otherwise the script falls back to a SAFE PLACEHOLDER: it prepares the
#     worktree and runs the gate but never fakes an implementation.
#
# Push/PR is opt-in: export AGENT_AUTO_PR=1 (with `gh` authenticated) to push the
# branch and open a PR when the gate passes and the agent actually made changes.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CONFIG_FILE="$ROOT/.agents/config.json"

# cfg <key> [default] — read a string value from .agents/config.json.
cfg() {
  local key="$1" def="${2:-}" v=""
  if [ -f "$CONFIG_FILE" ]; then
    if command -v jq >/dev/null 2>&1; then
      v=$(jq -r --arg k "$key" '.[$k] // empty' "$CONFIG_FILE" 2>/dev/null || true)
    else
      v=$(grep -o "\"$key\": \"[^\"]*" "$CONFIG_FILE" | head -1 | cut -d'"' -f4 || true)
    fi
  fi
  printf '%s' "${v:-$def}"
}

PROJECT_NAME="$(cfg project_name Project)"
NAMESPACE="$(cfg branches_namespace agent)"; NAMESPACE="${NAMESPACE:-agent}"
# Agent command: env overrides config; config default is the Codex CLI.
CODEX_CMD="${CODEX_CMD:-$(cfg codex_cmd 'codex exec --full-auto --skip-git-repo-check')}"

SPEC_PATH="${1:-}"
[ -n "$SPEC_PATH" ] || { echo "Usage: ./scripts/codex_auto_dev.sh <spec_path>" >&2; exit 1; }
[ -f "$SPEC_PATH" ] || { echo "Spec not found: $SPEC_PATH" >&2; exit 1; }

echo "=========================================================="
echo "Codex runner for $PROJECT_NAME"
echo "Spec: $SPEC_PATH"
echo "=========================================================="

# Canonical slug — must match agent_worktree.sh slugify() so 'create' and 'path'
# resolve to the SAME directory.
SLUG=$(basename "$SPEC_PATH" \
  | sed -E 's/_DEV_PLAN\.md$//' \
  | tr '[:upper:]' '[:lower:]' \
  | sed -E 's/[^a-z0-9]+/-/g; s/^-+//; s/-+$//')
BRANCH="$NAMESPACE/codex/$SLUG"

notify() { [ -x "$ROOT/scripts/notify_slack.sh" ] && "$ROOT/scripts/notify_slack.sh" "$1" || true; }

echo "Creating isolated worktree for branch: $BRANCH..."
"$ROOT/scripts/agent_worktree.sh" create "$SLUG" --branch "$BRANCH"
WORKTREE_PATH=$("$ROOT/scripts/agent_worktree.sh" path "$SLUG")

# --- Placeholder fallback: no agent CLI available ---------------------------
AGENT_BIN="${CODEX_CMD%% *}"
if ! command -v "$AGENT_BIN" >/dev/null 2>&1; then
  echo "[placeholder] Agent CLI '$AGENT_BIN' not found — preparing worktree and running gate only (no implementation)."
  cd "$WORKTREE_PATH"
  ./scripts/dev_check.sh fast
  ./scripts/spec_coverage_verify.sh "$SPEC_PATH" "$BRANCH" || true
  notify "codex runner: '$AGENT_BIN' not found — worktree prepared + gate run for $(basename "$SPEC_PATH") on $BRANCH; no agent/push/PR"
  echo "Done (placeholder mode)."
  exit 0
fi

# --- Live agent invocation --------------------------------------------------
printf -v PROMPT '%s\n' \
  "You are the developer agent. Implement the dev spec at: $SPEC_PATH" \
  "" \
  "Rules:" \
  "- Work only inside this repository/worktree. Implement strictly to the acceptance criteria in the spec, and write or update tests alongside the code." \
  "- Stay in your lane (source + tests); do not edit the spec document itself." \
  "- The gate MUST pass before you finish: run ./scripts/dev_check.sh fast and fix any failures. Iterate until it is green." \
  "- Do NOT push or open a PR; the wrapper handles that."

LOG="${TMPDIR:-/tmp}/codex-auto-dev-${SLUG}.log"
echo "Invoking agent: $CODEX_CMD --cd \"$WORKTREE_PATH\" <prompt>"
echo "  (log: $LOG)"
AGENT_RC=0
# shellcheck disable=SC2086
$CODEX_CMD --cd "$WORKTREE_PATH" "$PROMPT" > "$LOG" 2>&1 || AGENT_RC=$?
echo "Agent finished (rc=$AGENT_RC)."

cd "$WORKTREE_PATH"

echo "Running verification gate..."
GATE_RC=0
./scripts/dev_check.sh fast || GATE_RC=$?

echo "Running spec-coverage check (advisory)..."
./scripts/spec_coverage_verify.sh "$SPEC_PATH" "$BRANCH" || true

# Did the agent actually change anything? (porcelain also counts untracked files,
# which `git diff` alone would miss)
CHANGED=0
if [ -n "$(git -C "$WORKTREE_PATH" status --porcelain 2>/dev/null)" ]; then
  CHANGED=1
fi

if [ "$AGENT_RC" -ne 0 ] || [ "$GATE_RC" -ne 0 ] || [ "$CHANGED" -eq 0 ]; then
  notify "codex runner: NEEDS ATTENTION for $(basename "$SPEC_PATH") on $BRANCH (agent rc=$AGENT_RC, gate rc=$GATE_RC, changed=$CHANGED). No PR opened. Log: $LOG"
  echo "Not opening a PR (agent rc=$AGENT_RC, gate rc=$GATE_RC, changed=$CHANGED)." >&2
  [ "$AGENT_RC" -eq 0 ] && [ "$GATE_RC" -eq 0 ] || exit 1
  exit 0
fi

# --- Optional push + PR (opt-in) --------------------------------------------
if [ "${AGENT_AUTO_PR:-0}" = "1" ]; then
  echo "Committing, pushing, and opening PR..."
  git -C "$WORKTREE_PATH" add -A
  git -C "$WORKTREE_PATH" commit -m "codex: implement $SLUG" >>"$LOG" 2>&1 || true
  if git -C "$WORKTREE_PATH" push -u origin "$BRANCH" >>"$LOG" 2>&1; then
    PR_URL=""
    command -v gh >/dev/null 2>&1 && PR_URL=$(gh pr create --head "$BRANCH" --fill 2>>"$LOG" || true)
    notify "codex runner: implemented $(basename "$SPEC_PATH"), gate green, PR ${PR_URL:-opened} on $BRANCH"
    echo "PR flow complete: ${PR_URL:-opened}"
  else
    notify "codex runner: implemented $(basename "$SPEC_PATH") on $BRANCH; push FAILED (see $LOG)"
    echo "Push failed — see $LOG" >&2
    exit 1
  fi
else
  notify "codex runner: implemented $(basename "$SPEC_PATH") on $BRANCH, gate green. Review the worktree, then push/PR. (set AGENT_AUTO_PR=1 to automate)"
  echo "Implementation complete and gate green. AGENT_AUTO_PR!=1, so no push/PR was performed."
fi
