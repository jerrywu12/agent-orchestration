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
# Optional: command printing an integer test count, used to detect deleted tests.
TEST_COUNT_CMD="$(cfg test_count_command '')"

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

# --- Baseline gate (pre-agent) -----------------------------------------------
# The clean worktree must start green so a green post-agent gate is attributable
# to the implementation, and the pre-agent test count lets the integrity check
# catch deleted tests. AGENT_SKIP_BASELINE=1 bypasses this (e.g. slow suites).
BASELINE_COUNT=""
if [ "${AGENT_SKIP_BASELINE:-0}" != "1" ]; then
  echo "Running baseline gate on the clean worktree..."
  if ! (cd "$WORKTREE_PATH" && ./scripts/dev_check.sh fast); then
    notify "codex runner: BASELINE RED for $(basename "$SPEC_PATH") on $BRANCH — the gate fails before any agent change. Aborting."
    echo "Baseline gate is red — agent results would be meaningless. Fix the base branch first (or set AGENT_SKIP_BASELINE=1)." >&2
    exit 1
  fi
  if [ -n "$TEST_COUNT_CMD" ]; then
    BASELINE_COUNT="$( (cd "$WORKTREE_PATH" && eval "$TEST_COUNT_CMD") 2>/dev/null | tail -1 | tr -cd '0-9' || true)"
    echo "Baseline test count: ${BASELINE_COUNT:-unavailable}"
  fi
fi

# --- Live agent invocation --------------------------------------------------
printf -v PROMPT '%s\n' \
  "You are the developer agent. Implement the dev spec at: $SPEC_PATH" \
  "" \
  "Rules:" \
  "- Work only inside this repository/worktree. Implement strictly to the acceptance criteria in the spec, and write or update tests alongside the code." \
  "- Stay in your lane (source + tests); do not edit the spec document itself." \
  "- Never modify the verification harness: scripts/, .agents/, .github/, or existing test files. Do not delete tests or add skip/disable markers; adding NEW tests is expected and welcome." \
  "- Do not hardcode test fixture values as implementation logic — implement the general behavior the spec describes." \
  "- These rules are enforced mechanically after you finish (integrity check + protected-path restore), so a shortcut cannot pass the gate; it only wastes an iteration." \
  "- Verification may also include property-based tests with randomized inputs, a mutation-testing stage, and a semantic critic reviewing your diff — code that merely satisfies the visible unit tests will be caught." \
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

# --- Integrity check (anti-reward-hacking) -----------------------------------
# Runs from the trusted main checkout, never the worktree copy. Detects edits
# to the gate scripts, .agents/config.json, CI workflows, the spec, and
# existing tests — then restores the protected paths so the gate below can be
# believed. See scripts/agent_integrity_check.sh for the full threat model.
echo "Running integrity check..."
INTEGRITY_ARGS=("$WORKTREE_PATH" --spec "$SPEC_PATH" --restore)
if [ -n "$BASELINE_COUNT" ]; then
  INTEGRITY_ARGS+=(--baseline-test-count "$BASELINE_COUNT")
fi
if ! "$ROOT/scripts/agent_integrity_check.sh" "${INTEGRITY_ARGS[@]}"; then
  notify "codex runner: INTEGRITY FAIL for $(basename "$SPEC_PATH") on $BRANCH — agent touched protected paths or weakened tests. No gate, no PR. Worktree kept for inspection: $WORKTREE_PATH (log: $LOG)"
  echo "Integrity check FAILED — the gate was not run because its result could not be trusted." >&2
  echo "Worktree preserved for inspection: $WORKTREE_PATH" >&2
  exit 1
fi

echo "Running verification gate..."
# Safe to invoke the worktree's copy: the integrity check verified scripts/,
# .github/, and .agents/config.json against trusted sources and restored them.
GATE_RC=0
./scripts/dev_check.sh fast || GATE_RC=$?

echo "Running spec critic / coverage check..."
# Advisory (exit 0) unless a critic CLI is configured, in which case a
# NEEDS-CHANGES verdict fails the run and blocks the PR path.
CRITIC_RC=0
./scripts/spec_coverage_verify.sh "$SPEC_PATH" "$BRANCH" || CRITIC_RC=$?

# Did the agent actually change anything? (porcelain also counts untracked files,
# which `git diff` alone would miss). The runner-provisioned local files copied
# in by agent_worktree.sh are excluded so an empty run never counts as a change.
CHANGED=0
if [ -n "$(git -C "$WORKTREE_PATH" status --porcelain 2>/dev/null \
      | grep -vE '^\?\? (\.agents/|\.env\.local$)')" ]; then
  CHANGED=1
fi

if [ "$AGENT_RC" -ne 0 ] || [ "$GATE_RC" -ne 0 ] || [ "$CRITIC_RC" -ne 0 ] || [ "$CHANGED" -eq 0 ]; then
  notify "codex runner: NEEDS ATTENTION for $(basename "$SPEC_PATH") on $BRANCH (agent rc=$AGENT_RC, gate rc=$GATE_RC, critic rc=$CRITIC_RC, changed=$CHANGED). No PR opened. Log: $LOG"
  echo "Not opening a PR (agent rc=$AGENT_RC, gate rc=$GATE_RC, critic rc=$CRITIC_RC, changed=$CHANGED)." >&2
  [ "$AGENT_RC" -eq 0 ] && [ "$GATE_RC" -eq 0 ] && [ "$CRITIC_RC" -eq 0 ] || exit 1
  exit 0
fi

# --- Mutation gate (pre-PR only; slow) ---------------------------------------
# Surviving mutants mean the tests don't pin the logic down — weak tests are
# exactly how shortcut code slips through a green gate. Runs only after
# everything else passed so the expensive stage is never wasted; SKIPPED
# instantly when mutation_test_command is not configured.
if [ "${AGENT_SKIP_MUTATION:-0}" != "1" ]; then
  MUTATION_RC=0
  ./scripts/dev_check.sh mutation || MUTATION_RC=$?
  if [ "$MUTATION_RC" -ne 0 ]; then
    notify "codex runner: MUTATION GATE FAILED for $(basename "$SPEC_PATH") on $BRANCH — surviving mutants (weak tests or dead shortcut code). No PR. Log: $LOG"
    echo "Mutation gate failed — the tests are too weak to trust the green gate. Not opening a PR." >&2
    exit 1
  fi
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
