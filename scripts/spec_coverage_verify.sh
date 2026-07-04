#!/usr/bin/env bash
# Verify that the feature branch changes cover the active spec criteria.
set -euo pipefail

SPEC_PATH="${1:-}"
BRANCH_NAME="${2:-$(git branch --show-current)}"

if [ -z "$SPEC_PATH" ]; then
  echo "Usage: ./scripts/spec_coverage_verify.sh <spec_path> [<branch_name>]" >&2
  exit 1
fi

if [ ! -f "$SPEC_PATH" ]; then
  echo "Error: Spec file not found at $SPEC_PATH" >&2
  exit 1
fi

echo "=========================================================="
echo "Running spec self-verification coverage checks..."
echo "Spec:   $SPEC_PATH"
echo "Branch: $BRANCH_NAME"
echo "=========================================================="

# 1. Parse acceptance criteria/workstreams from the spec file
# Extract lines containing workstreams (e.g. W1, W2, etc.) or checkable lists
echo "Extracting acceptance criteria from spec..."
CRITERIA=()
while IFS= read -r line; do
  if [[ "$line" =~ \*\*W[0-9]+.* ]]; then
    # Matches markdown bold workstream headers: **W1: Description**
    CRITERIA+=("$line")
  elif [[ "$line" =~ ^-[[:space:]]\[[[:space:]]x?\].* ]]; then
    # Matches checklist items: - [ ] or - [x]
    CRITERIA+=("$line")
  fi
done < "$SPEC_PATH"

if [ ${#CRITERIA[@]} -eq 0 ]; then
  echo "No workstream identifiers (W1, W2, ...) or checklist items found in the spec."
  echo "VERDICT: COVERAGE: UNKNOWN (no machine-checkable criteria found — verify manually)"
  exit 0
fi

echo "Found ${#CRITERIA[@]} criteria item(s). Listing for manual/agent confirmation:"
for item in "${CRITERIA[@]}"; do
  echo "  [ ] $item"
done

# ---------------------------------------------------------------------------
# TODO: Implement real coverage checking here — e.g. diff the branch against its
#       base and confirm each workstream's acceptance criteria is exercised by
#       the changes and/or tests. Until then this is ADVISORY ONLY and must not
#       assert that coverage is complete.
# ---------------------------------------------------------------------------

echo "=========================================================="
echo "VERDICT: COVERAGE: NEEDS-REVIEW (advisory — criteria above are unverified)"
echo "=========================================================="
exit 0
