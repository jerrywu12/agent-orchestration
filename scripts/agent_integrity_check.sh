#!/usr/bin/env bash
# Post-agent integrity check (anti-reward-hacking gate).
#
# Threat model: a coder agent left unmonitored in a worktree can try to pass
# the verification gate without implementing the spec — by editing the gate
# scripts, redefining the test commands in .agents/config.json, touching CI
# workflows, weakening the spec, or deleting/skipping existing tests.
#
# This script runs OUTSIDE the agent, from the trusted main checkout, and
# compares the worktree against a trusted base ref. On success it can also
# restore the protected paths from that base (--restore), so the gate that
# runs afterwards can be believed even if a tamper vector went undetected.
#
# Usage:
#   scripts/agent_integrity_check.sh <worktree_path> [options]
#     --base <ref>                 base to diff against (default: origin/main, else main)
#     --spec <path>                spec file (repo-relative or absolute under the
#                                  main checkout); must be unchanged in the worktree
#     --baseline-test-count <n>    pre-agent test count; the post-agent count
#                                  must not drop (needs test_count_command)
#     --restore                    after checks pass, restore protected paths and
#                                  .agents/config.json from trusted sources
#
# Config (read from the MAIN checkout's .agents/config.json — never the worktree):
#   protected_paths       JSON array of repo-relative paths the coder agent must
#                         not touch (default: ["scripts", ".github"])
#   test_directories      JSON array of test dirs (default: ["tests"])
#   test_count_command    optional command printing an integer test count
#
# Env:
#   AGENT_ALLOW_TEST_EDITS=1   downgrade test-edit/skip/count findings to warnings
#                              (human-only override for legitimate test refactors)
#   AGENT_INTEGRITY=0          skip every check (loud warning; debugging only)
#
# Exit codes: 0 = PASS (possibly with warnings), 1 = tampering detected / error.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CONFIG_FILE="$ROOT/.agents/config.json"

usage() {
  sed -n '2,30p' "$0" | sed 's/^# \{0,1\}//'
}

die() {
  echo "ERROR: $*" >&2
  exit 1
}

WT="${1:-}"
[ -n "$WT" ] || { usage >&2; exit 1; }
shift

BASE=""
SPEC=""
BASELINE_COUNT=""
RESTORE=0
while [ "$#" -gt 0 ]; do
  case "$1" in
    --base) shift; BASE="${1:-}"; [ -n "$BASE" ] || die "--base requires a ref" ;;
    --spec) shift; SPEC="${1:-}"; [ -n "$SPEC" ] || die "--spec requires a path" ;;
    --baseline-test-count) shift; BASELINE_COUNT="${1:-}"; [ -n "$BASELINE_COUNT" ] || die "--baseline-test-count requires a number" ;;
    --restore) RESTORE=1 ;;
    *) usage >&2; exit 1 ;;
  esac
  shift || true
done

[ -d "$WT" ] || die "worktree not found: $WT"
git -C "$WT" rev-parse --git-dir >/dev/null 2>&1 || die "not a git worktree: $WT"

if [ "${AGENT_INTEGRITY:-1}" = "0" ]; then
  echo "INTEGRITY: SKIPPED (AGENT_INTEGRITY=0) — gate results CANNOT be trusted against a hostile agent." >&2
  exit 0
fi

# Resolve the trusted base ref.
if [ -z "$BASE" ]; then
  if git -C "$WT" rev-parse -q --verify origin/main >/dev/null 2>&1; then
    BASE="origin/main"
  elif git -C "$WT" rev-parse -q --verify main >/dev/null 2>&1; then
    BASE="main"
  else
    die "cannot resolve a base ref (no origin/main or main); pass --base <ref>"
  fi
else
  git -C "$WT" rev-parse -q --verify "$BASE" >/dev/null 2>&1 || die "base ref not found: $BASE"
fi

# --- Trusted-config readers --------------------------------------------------
# Values come from the main checkout's config only; the worktree copy is one of
# the things under test. Missing keys (or no python3) fall back to defaults.
json_list() { # json_list <key> <default...> — one item per line
  local key="$1" out=""
  shift
  if [ -f "$CONFIG_FILE" ] && command -v python3 >/dev/null 2>&1; then
    out=$(python3 - "$CONFIG_FILE" "$key" <<'PY' 2>/dev/null || true
import json, sys
try:
    v = json.load(open(sys.argv[1])).get(sys.argv[2])
except Exception:
    v = None
if isinstance(v, str):
    v = [v]
if isinstance(v, list) and v:
    print("\n".join(str(x) for x in v))
PY
)
  fi
  if [ -n "$out" ]; then printf '%s\n' "$out"; else printf '%s\n' "$@"; fi
}

PROTECTED=()
while IFS= read -r p; do [ -n "$p" ] && PROTECTED+=("$p"); done < <(json_list protected_paths scripts .github)
TEST_DIRS=()
while IFS= read -r p; do [ -n "$p" ] && TEST_DIRS+=("$p"); done < <(json_list test_directories tests)
TEST_COUNT_CMD="$(json_list test_count_command '' | head -1)"

echo "Integrity check: worktree=$WT base=$BASE protected=[${PROTECTED[*]}] tests=[${TEST_DIRS[*]}]"

# --- Findings ----------------------------------------------------------------
FAIL=0
tamper() { # hard violation — never downgraded
  echo "INTEGRITY: TAMPER — $*" >&2
  FAIL=1
}
test_finding() { # test-lane violation — AGENT_ALLOW_TEST_EDITS=1 downgrades to warning
  if [ "${AGENT_ALLOW_TEST_EDITS:-0}" = "1" ]; then
    echo "INTEGRITY: WARN (allowed by AGENT_ALLOW_TEST_EDITS=1) — $*" >&2
  else
    echo "INTEGRITY: TAMPER — $* (set AGENT_ALLOW_TEST_EDITS=1 to permit deliberate test refactors)" >&2
    FAIL=1
  fi
}

# 1. Tracked changes (committed, staged, or unstaged) under protected paths.
while IFS= read -r f; do
  [ -n "$f" ] || continue
  tamper "protected path modified: $f"
done < <(git -C "$WT" diff --name-only "$BASE" -- "${PROTECTED[@]}" 2>/dev/null || true)

# 2. Untracked additions under protected paths (a new helper script the gate
#    could be tricked into calling).
while IFS= read -r f; do
  [ -n "$f" ] || continue
  tamper "untracked file added under protected path: $f"
done < <(git -C "$WT" status --porcelain -- "${PROTECTED[@]}" 2>/dev/null | { grep '^??' || true; } | cut -c4-)

# 3. .agents/config.json drift — the worktree copy (which the gate wrapper
#    reads) must match the trusted main-checkout copy byte for byte.
if [ -f "$CONFIG_FILE" ]; then
  if ! cmp -s "$CONFIG_FILE" "$WT/.agents/config.json" 2>/dev/null; then
    tamper ".agents/config.json differs from the trusted copy (test commands may have been redefined)"
  fi
fi

# 4. The spec must be unchanged — acceptance criteria are not the agent's to edit.
if [ -n "$SPEC" ]; then
  SPEC_REL="$SPEC"
  case "$SPEC" in
    "$ROOT"/*) SPEC_REL="${SPEC#"$ROOT"/}" ;;
    /*) SPEC_REL="" ;; # absolute path outside the repo — nothing to check in the worktree
  esac
  if [ -n "$SPEC_REL" ]; then
    while IFS= read -r f; do
      [ -n "$f" ] || continue
      tamper "spec modified: $f"
    done < <(git -C "$WT" diff --name-only "$BASE" -- "$SPEC_REL" 2>/dev/null || true)
  fi
fi

# 5. Existing tests must not be modified or deleted (new tests are welcome and
#    show up as additions/untracked, which pass through).
while IFS=$'\t' read -r st f; do
  [ -n "$st" ] || continue
  case "${st:0:1}" in
    M|D|T|R|C) test_finding "existing test ${st:0:1}(odified/eleted/…): $f" ;;
  esac
done < <(git -C "$WT" diff --name-status "$BASE" -- "${TEST_DIRS[@]}" 2>/dev/null || true)

# 6. No new skip/disable markers in test code (both diff-added lines in tracked
#    tests and brand-new untracked test files).
SKIP_RE='(\.skip[[:space:]]*\(|\.todo[[:space:]]*\(|(^|[^[:alnum:]_])x(it|describe|test)[[:space:]]*\(|pytest\.(mark\.)?skip|unittest\.skip|@(Disabled|Ignore)([[:space:](]|$)|(^|[^[:alnum:]_])t\.Skip\(|#\[ignore\])'
ADDED_SKIPS=$(git -C "$WT" diff "$BASE" -- "${TEST_DIRS[@]}" 2>/dev/null | { grep -E '^\+[^+]' || true; } | { grep -cE "$SKIP_RE" || true; })
if [ "${ADDED_SKIPS:-0}" -gt 0 ]; then
  test_finding "$ADDED_SKIPS skip/disable marker(s) added to existing tests"
fi
while IFS= read -r f; do
  [ -n "$f" ] || continue
  [ -f "$WT/$f" ] || continue
  if grep -qE "$SKIP_RE" "$WT/$f" 2>/dev/null; then
    test_finding "new test file contains skip/disable marker: $f"
  fi
done < <(git -C "$WT" status --porcelain -- "${TEST_DIRS[@]}" 2>/dev/null | { grep '^??' || true; } | cut -c4-)

if [ "$FAIL" -ne 0 ]; then
  echo "INTEGRITY: FAIL — the worktree tampered with the verification harness or weakened tests." >&2
  echo "INTEGRITY: gate results for this worktree must not be trusted; inspect it manually: $WT" >&2
  exit 1
fi

# --- Restore (belt and suspenders) -------------------------------------------
# Even with all checks green, put the protected paths back to their trusted
# state before any gate runs, so an undetected vector still has no effect.
if [ "$RESTORE" -eq 1 ]; then
  echo "INTEGRITY: restoring protected paths from $BASE..."
  git -C "$WT" clean -qxfd -- "${PROTECTED[@]}" .agents 2>/dev/null || true
  for p in "${PROTECTED[@]}"; do
    if git -C "$WT" rev-parse -q --verify "$BASE:$p" >/dev/null 2>&1; then
      git -C "$WT" checkout -q "$BASE" -- "$p" 2>/dev/null || true
    fi
  done
  if [ -f "$CONFIG_FILE" ]; then
    mkdir -p "$WT/.agents"
    cp "$CONFIG_FILE" "$WT/.agents/config.json"
  fi
fi

# 7. Post-agent test count must not drop below the pre-agent baseline.
#    Runs after --restore so the count command comes from trusted config.
if [ -n "$BASELINE_COUNT" ] && [ -n "$TEST_COUNT_CMD" ]; then
  POST_COUNT="$( (cd "$WT" && eval "$TEST_COUNT_CMD") 2>/dev/null | tail -1 | tr -cd '0-9' || true)"
  if [ -z "$POST_COUNT" ]; then
    echo "INTEGRITY: WARN — test_count_command produced no number; skipping count comparison." >&2
  elif [ "$POST_COUNT" -lt "$BASELINE_COUNT" ]; then
    test_finding "test count dropped: $BASELINE_COUNT -> $POST_COUNT"
    if [ "$FAIL" -ne 0 ]; then
      echo "INTEGRITY: FAIL — tests disappeared between baseline and post-agent runs." >&2
      exit 1
    fi
  else
    echo "INTEGRITY: test count ok ($BASELINE_COUNT -> $POST_COUNT)"
  fi
fi

echo "INTEGRITY: PASS"
