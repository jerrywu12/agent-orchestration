#!/usr/bin/env bash
# Manage isolated local worktrees for parallel agent tasks.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CONFIG_FILE="$ROOT/.agents/config.json"

PROJECT_NAME="project"
if [ -f "$CONFIG_FILE" ]; then
  PROJECT_NAME=$(grep -o '"project_name": "[^"]*' "$CONFIG_FILE" | head -1 | cut -d'"' -f4 | tr '[:upper:]' '[:lower:]' | tr ' ' '-' || echo "project")
fi

DEFAULT_PARENT="$(dirname "$ROOT")"
REPO_NAME="$(basename "$ROOT")"

usage() {
  cat <<EOF
usage:
  scripts/agent_worktree.sh create <slug> [--base <ref>] [--parent <dir>] [--branch <branch>]
  scripts/agent_worktree.sh list
  scripts/agent_worktree.sh remove <slug-or-path> [--force]
  scripts/agent_worktree.sh path <slug> [--parent <dir>]

Creates one local git worktree per agent task so parallel agents do not share a working directory.
Default path: ../$REPO_NAME-<slug>
Default branch: agent/codex/<slug>
EOF
}

die() {
  echo "ERROR: $*" >&2
  exit 1
}

slugify() {
  printf '%s' "$1" \
    | tr '[:upper:]' '[:lower:]' \
    | sed -E 's/[^a-z0-9]+/-/g; s/^-+//; s/-+$//; s/^$/agent-task/'
}

safe_slug() {
  local slug
  slug="$(slugify "$1")"
  case "$slug" in
    ''|.|..|main|master|develop|origin|refs|-*|*..*|*~*|*^*|*:*)
      die "unsafe worktree slug: $1"
      ;;
  esac
  printf '%s\n' "$slug"
}

worktree_path_for() {
  local slug="$1"
  local parent="${2:-$DEFAULT_PARENT}"
  printf '%s/%s-%s\n' "$parent" "$REPO_NAME" "$slug"
}

create_worktree() {
  local raw_slug="${1:-}"
  shift || true
  [ -n "$raw_slug" ] || die "slug is required"

  local slug
  local parent="$DEFAULT_PARENT"
  local base="origin/main"
  local branch=""
  slug="$(safe_slug "$raw_slug")"

  while [ "$#" -gt 0 ]; do
    case "$1" in
      --base)
        shift
        base="${1:-}"
        [ -n "$base" ] || die "--base requires a ref"
        ;;
      --parent)
        shift
        parent="${1:-}"
        [ -n "$parent" ] || die "--parent requires a directory"
        ;;
      --branch)
        shift
        branch="${1:-}"
        [ -n "$branch" ] || die "--branch requires a branch name"
        ;;
      *)
        usage >&2
        exit 2
        ;;
    esac
    shift || true
  done

  branch="${branch:-agent/codex/${slug}}"
  git check-ref-format --branch "$branch" >/dev/null 2>&1 || die "invalid branch name: $branch"

  mkdir -p "$parent"
  local path
  path="$(worktree_path_for "$slug" "$parent")"

  if [ -d "$path" ]; then
    echo "Worktree path already exists: $path" >&2
    if git worktree list | grep -F "$path" >/dev/null; then
      echo "Already registered as a git worktree."
      exit 0
    else
      die "Directory exists but is not registered. Move or remove it first."
    fi
  fi

  echo "Creating worktree at: $path"
  echo "Branch: $branch (based on $base)"

  # Fetch latest changes first
  git fetch origin || true

  # Check if branch already exists locally or remotely
  if git show-ref --verify --quiet "refs/heads/$branch"; then
    echo "Branch $branch already exists locally. Checking it out..."
    git worktree add "$path" "$branch"
  elif git show-ref --verify --quiet "refs/remotes/origin/$branch"; then
    echo "Branch $branch exists on origin. Checking out tracking branch..."
    git worktree add -b "$branch" "$path" "origin/$branch"
  else
    echo "Creating new branch $branch..."
    git worktree add -b "$branch" "$path" "$base"
  fi

  # Copy config and env variables
  if [ -f "$ROOT/.env.local" ]; then
    cp "$ROOT/.env.local" "$path/.env.local" || true
  fi
  mkdir -p "$path/.agents"
  if [ -f "$ROOT/.agents/config.json" ]; then
    cp "$ROOT/.agents/config.json" "$path/.agents/config.json" || true
  fi

  echo "Worktree ready at: $path"
}

remove_worktree() {
  local target="${1:-}"
  local force="${2:-}"
  [ -n "$target" ] || die "slug or path is required"

  local path="$target"
  if [ ! -d "$path" ]; then
    # Try slug matching
    path="$(worktree_path_for "$(safe_slug "$target")")"
  fi

  if [ ! -d "$path" ]; then
    die "Worktree not found: $target"
  fi

  echo "Pruning and removing worktree: $path"
  if [ "$force" = "--force" ]; then
    git worktree remove --force "$path"
  else
    git worktree remove "$path"
  fi
  echo "Removed successfully."
}

list_worktrees() {
  git worktree list
}

# Subcommands routing
CMD="${1:-}"
[ -n "$CMD" ] || { usage; exit 1; }
shift

case "$CMD" in
  create)
    create_worktree "$@"
    ;;
  remove)
    remove_worktree "$@"
    ;;
  list)
    list_worktrees
    ;;
  path)
    worktree_path_for "$@"
    ;;
  *)
    usage >&2
    exit 1
    ;;
esac
