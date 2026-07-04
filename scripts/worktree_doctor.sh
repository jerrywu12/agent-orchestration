#!/usr/bin/env bash
# Sweep and prune orphaned dev servers and stale worktrees.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CONFIG_FILE="$ROOT/.agents/config.json"
REPO_NAME="$(basename "$ROOT")"
# Only processes whose cwd is under this repo's own worktree parent prefix
# (../<repo>-<slug>) are candidates for cleanup — never a bare repo-name substring.
WT_PREFIX="$(dirname "$ROOT")/$REPO_NAME-"

# Load config
PROJECT_NAME="project"
if [ -f "$CONFIG_FILE" ]; then
  PROJECT_NAME=$(grep -o '"project_name": "[^"]*' "$CONFIG_FILE" | head -1 | cut -d'"' -f4 | tr '[:upper:]' '[:lower:]' | tr ' ' '-' || echo "project")
fi

echo "Running Worktree Doctor daemon for $PROJECT_NAME..."

# 1. Kill zombie node/vite/api processes that were launched in deleted worktrees
echo "Checking for orphaned background processes..."
OS_NAME=$(uname)

if [ "$OS_NAME" = "Darwin" ] || [ "$OS_NAME" = "Linux" ]; then
  # Find running Node, Python, or API processes
  # Check if their working directory contains the repository name but has been deleted
  ps aux | grep -E 'node|npm|vite|python|pytest|uvicorn' | grep -v grep | while read -r line; do
    pid=$(echo "$line" | awk '{print $2}')
    # Get current working directory of PID
    cwd=""
    if [ "$OS_NAME" = "Darwin" ]; then
      # -Fn emits field output; the cwd path is the 'n'-prefixed line.
      # (The old '-fn' is not a valid lsof flag and silently returned nothing.)
      cwd=$(lsof -a -p "$pid" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p' | head -1 || true)
    else
      cwd=$(readlink -f "/proc/$pid/cwd" 2>/dev/null || true)
    fi

    if [ -n "$cwd" ]; then
      # Only act on processes whose cwd is under THIS repo's worktree prefix
      # (../<repo>-<slug>) and whose directory has been removed. SIGTERM first,
      # then SIGKILL if it does not exit — never an immediate kill -9.
      if [[ "$cwd" == "$WT_PREFIX"* ]] && [ ! -d "$cwd" ]; then
        echo "Orphaned process $pid (cwd $cwd was removed). Sending SIGTERM..."
        kill "$pid" 2>/dev/null || true
        ( sleep 2; if kill -0 "$pid" 2>/dev/null; then echo "Process $pid still alive; SIGKILL."; kill -9 "$pid" 2>/dev/null || true; fi ) &
      fi
    fi
  done
  wait
fi

# 2. Prune registered Git worktrees that no longer have a physical folder
echo "Pruning Git worktrees list..."
git worktree prune

# 3. List active worktrees
echo "Active Git worktrees:"
git worktree list

echo "Doctor sweep complete."
