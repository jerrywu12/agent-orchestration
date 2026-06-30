#!/usr/bin/env bash
# Sweep and prune orphaned dev servers and stale worktrees.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CONFIG_FILE="$ROOT/.agents/config.json"
REPO_NAME="$(basename "$ROOT")"

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
      cwd=$(lsof -a -p "$pid" -d cwd -fn 2>/dev/null | awk 'NR==2 {print $NF}' || true)
    else
      cwd=$(readlink -f "/proc/$pid/cwd" 2>/dev/null || true)
    fi

    if [ -n "$cwd" ]; then
      # If the cwd contains the repo name, but the directory no longer exists on disk
      if [[ "$cwd" == *"$REPO_NAME"* ]] && [ ! -d "$cwd" ]; then
        echo "Found zombie process $pid (cwd: $cwd is missing). Killing..."
        kill -9 "$pid" || true
      fi
    fi
  done
fi

# 2. Prune registered Git worktrees that no longer have a physical folder
echo "Pruning Git worktrees list..."
git worktree prune

# 3. List active worktrees
echo "Active Git worktrees:"
git worktree list

echo "Doctor sweep complete."
