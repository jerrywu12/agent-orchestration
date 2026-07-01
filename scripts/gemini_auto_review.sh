#!/usr/bin/env bash
# Gemini review wrapper.
#
# Runs the full verification gate, then produces a review:
#   - If a review agent CLI is configured (`gemini_cmd` in config / $GEMINI_CMD),
#     it is invoked to write a real multi-axis review to the review file.
#   - Otherwise it writes an honest NEEDS-REVIEW skeleton (never a fake PASS).
#
# Example config: "gemini_cmd": "gemini --prompt"  (or "agy --dangerously-skip-permissions --prompt")
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CONFIG_FILE="$ROOT/.agents/config.json"
REVIEWS_DIR="$ROOT/docs/reviews"

mkdir -p "$REVIEWS_DIR"

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
GEMINI_CMD="${GEMINI_CMD:-$(cfg gemini_cmd '')}"

FEATURE_NAME="${1:-feature-audit}"
DATE=$(date +"%Y-%m-%d")
REVIEW_FILE="$REVIEWS_DIR/${FEATURE_NAME}-${DATE}.md"

notify() { [ -x "$ROOT/scripts/notify_slack.sh" ] && "$ROOT/scripts/notify_slack.sh" "$1" || true; }

echo "=========================================================="
echo "Gemini runner for $PROJECT_NAME"
echo "Target: $FEATURE_NAME"
echo "Review file: $REVIEW_FILE"
echo "=========================================================="

# 1. Run the full test gate.
echo "Running the full verification gate..."
"$ROOT/scripts/dev_check.sh" full

write_skeleton() {
  cat <<EOF > "$REVIEW_FILE"
# Gemini Review: $FEATURE_NAME ($DATE)

> PLACEHOLDER — no review agent is configured (\`gemini_cmd\` / \$GEMINI_CMD is unset).
> Set one, or replace the axes below with a real review before acting on this verdict.

## Context
- Automated gate \`dev_check.sh full\` exited 0. That only means the configured
  test command returned success; the code was **not** audited.

## ⚠️ Issues
### Correctness
- (pending review)
### Readability
- (pending review)
### Architecture
- (pending review)
### Security
- (pending review)
### Performance
- (pending review)

## 💡 Room to improve
- (pending review)

## Commands run
- ./scripts/dev_check.sh full

## Verdict
- NEEDS-REVIEW: no automated audit was performed.
EOF
}

# 2. Produce the review.
GEMINI_BIN="${GEMINI_CMD%% *}"
if [ -n "$GEMINI_CMD" ] && command -v "$GEMINI_BIN" >/dev/null 2>&1; then
  echo "Invoking review agent: $GEMINI_CMD ..."
  PROMPT=$(cat <<EOF
You are the reviewer agent. Perform a read-only 5-axis code review (correctness,
readability, architecture, security, performance) of the current build for
"$FEATURE_NAME". Confirm the build actually runs. Write your review — using the
skeleton headings below — to this exact path and change no other files:

  $REVIEW_FILE

## ✅ Solid / ## ⚠️ Issues (per axis) / ## 💡 Room to improve (per axis) /
## Commands run / ## Verdict (PASS or NEEDS-CHANGES with reasons).
EOF
)
  REVIEW_RC=0
  # shellcheck disable=SC2086
  $GEMINI_CMD "$PROMPT" < /dev/null || REVIEW_RC=$?
  if [ "$REVIEW_RC" -ne 0 ] || [ ! -s "$REVIEW_FILE" ]; then
    echo "Review agent did not produce a review (rc=$REVIEW_RC) — writing NEEDS-REVIEW skeleton." >&2
    write_skeleton
    notify "gemini runner: agent produced no review for $FEATURE_NAME — verdict NEEDS-REVIEW. Skeleton: docs/reviews/$(basename "$REVIEW_FILE")"
    echo "Gemini review skeleton written (NEEDS-REVIEW)."
    exit 0
  fi
  VERDICT=$(grep -A2 -i '## Verdict' "$REVIEW_FILE" | tail -n +2 | head -1 | sed 's/^[[:space:]-]*//')
  notify "gemini runner: review complete for $FEATURE_NAME — ${VERDICT:-see review}. docs/reviews/$(basename "$REVIEW_FILE")"
  echo "Gemini review written by agent."
else
  echo "No review agent configured — writing NEEDS-REVIEW skeleton."
  write_skeleton
  notify "gemini runner: no review agent configured for $FEATURE_NAME — verdict NEEDS-REVIEW. Skeleton: docs/reviews/$(basename "$REVIEW_FILE")"
  echo "Gemini review skeleton written (NEEDS-REVIEW)."
fi
