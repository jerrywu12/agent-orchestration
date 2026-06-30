#!/usr/bin/env bash
# Main multi-agent workflow coordinator.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CONFIG_FILE="$ROOT/.agents/config.json"
QUEUE_DIR="$ROOT/storage/agent_queue/pending"

mkdir -p "$QUEUE_DIR"

usage() {
  cat <<EOF
Multi-Agent Workflow Coordinator

Usage:
  scripts/agent_workflow.sh handoff submit <spec_path> [--agent <agent>] [--mode <mode>]
  scripts/agent_workflow.sh handoff status
  scripts/agent_workflow.sh handoff run-next
  scripts/agent_workflow.sh handoff watch [--interval <seconds>]
  scripts/agent_workflow.sh doctor

Agents:
  codex           (Default) Developer agent. Implements specs and runs tests.
  gemini          Reviewer agent. Audits merged builds and writes reviews.
  claude          Architect agent. Scaffolds specs and plans.

Modes:
  local           Execute directly in the active project branch.
  local-worktree  (Default) Checkout worktree and execute in isolation.
  cloud-ready     Add to queue for remote execution, skip local execution.
EOF
}

die() {
  echo "ERROR: $*" >&2
  exit 1
}

doctor_check() {
  echo "Checking multi-agent workflow setup..."
  
  if [ -f "$CONFIG_FILE" ]; then
    echo "  OK  config: $CONFIG_FILE"
  else
    echo "  FAIL config file not found!"
  fi

  if [ -f "$ROOT/CLAUDE.md" ]; then
    echo "  OK  CLAUDE.md: found"
  else
    echo "  FAIL CLAUDE.md not found!"
  fi

  if [ -f "$ROOT/AGENTS.md" ]; then
    echo "  OK  AGENTS.md: found"
  else
    echo "  FAIL AGENTS.md not found!"
  fi

  if [ -f "$ROOT/GEMINI.md" ]; then
    echo "  OK  GEMINI.md: found"
  else
    echo "  FAIL GEMINI.md not found!"
  fi

  if [ -f "$ROOT/scripts/agent_worktree.sh" ]; then
    echo "  OK  worktree manager: found"
  else
    echo "  FAIL agent_worktree.sh not found!"
  fi

  if [ -f "$ROOT/scripts/codex_auto_dev.sh" ]; then
    echo "  OK  Codex auto-dev runner: found"
  else
    echo "  FAIL codex_auto_dev.sh not found!"
  fi

  if [ -f "$ROOT/scripts/gemini_auto_review.sh" ]; then
    echo "  OK  Gemini auto-review runner: found"
  else
    echo "  FAIL gemini_auto_review.sh not found!"
  fi

  echo "Workflow check completed."
}

submit_handoff() {
  local spec_path="${1:-}"
  shift || true
  [ -n "$spec_path" ] || die "spec_path is required"

  local mode="local-worktree"
  local agent="codex"
  
  while [ "$#" -gt 0 ]; do
    case "$1" in
      --mode)
        shift
        mode="${1:-}"
        ;;
      --agent)
        shift
        agent="${1:-}"
        ;;
      *)
        usage >&2
        exit 1
        ;;
    esac
    shift || true
  done

  [ -f "$spec_path" ] || die "Spec file not found: $spec_path"

  local spec_name
  spec_name=$(basename "$spec_path")
  local queue_file="$QUEUE_DIR/$spec_name.job"

  echo "Queuing handoff for $spec_name targeted to agent: $agent..."
  cat <<EOF > "$queue_file"
spec_path="$spec_path"
target_agent="$agent"
mode="$mode"
queued_at="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
status="pending"
EOF

  echo "Job created in queue: $queue_file"
  
  if [ "$mode" = "local-worktree" ]; then
    echo "Handoff submitted. Run 'run-next' or start the watcher to execute."
  elif [ "$mode" = "local" ]; then
    echo "Executing in-place..."
    run_job "$queue_file"
  else
    echo "Job marked cloud-ready. Skipping local execution."
  fi
}

run_job() {
  local job_file="$1"
  # Load job params
  local spec_path=""
  local target_agent="codex"
  local mode="local-worktree"
  
  # Parse job properties
  spec_path=$(grep '^spec_path=' "$job_file" | cut -d'"' -f2 || echo "")
  target_agent=$(grep '^target_agent=' "$job_file" | cut -d'"' -f2 || echo "codex")
  mode=$(grep '^mode=' "$job_file" | cut -d'"' -f2 || echo "local-worktree")

  echo "Starting execution of $spec_path for agent $target_agent..."
  # Mark job running by updating status
  sed -i.bak 's/status="pending"/status="running"/g' "$job_file" && rm -f "${job_file}.bak"

  if [ "$target_agent" = "codex" ]; then
    if [ -f "$ROOT/scripts/codex_auto_dev.sh" ]; then
      "$ROOT/scripts/codex_auto_dev.sh" "$spec_path"
    else
      die "codex_auto_dev.sh not found."
    fi
  elif [ "$target_agent" = "gemini" ]; then
    if [ -f "$ROOT/scripts/gemini_auto_review.sh" ]; then
      local slug
      slug=$(basename "$spec_path" | sed 's/_DEV_PLAN.md//' | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9]/-/g')
      "$ROOT/scripts/gemini_auto_review.sh" "$slug"
    else
      die "gemini_auto_review.sh not found."
    fi
  else
    echo "Unknown agent $target_agent. Skipping execution."
  fi

  # Mark job complete
  sed -i.bak 's/status="running"/status="completed"/g' "$job_file" && rm -f "${job_file}.bak"
  echo "Handoff execution complete."
}

run_next() {
  local pending_jobs
  pending_jobs=$(find "$QUEUE_DIR" -name "*.job" 2>/dev/null | sort)
  if [ -z "$pending_jobs" ]; then
    echo "No pending jobs in queue."
    exit 0
  fi

  for job in $pending_jobs; do
    if grep -q 'status="pending"' "$job" 2>/dev/null; then
      run_job "$job"
      return 0
    fi
  done
  echo "All jobs processed."
}

watch_queue() {
  local interval=30
  while [ "$#" -gt 0 ]; do
    case "$1" in
      --interval)
        shift
        interval="${1:-30}"
        ;;
    esac
    shift || true
  done

  echo "Watching queue at $QUEUE_DIR every $interval seconds..."
  while true; do
    run_next || true
    sleep "$interval"
  done
}

# Routing
SUB_CMD="${1:-}"
[ -n "$SUB_CMD" ] || { usage; exit 1; }
shift

case "$SUB_CMD" in
  handoff)
    ACTION="${1:-}"
    shift
    case "$ACTION" in
      submit)
        submit_handoff "$@"
        ;;
      status)
        echo "Pending jobs:"
        find "$QUEUE_DIR" -name "*.job" 2>/dev/null | xargs grep -l 'status="pending"' 2>/dev/null | wc -l || echo "0"
        ;;
      run-next)
        run_next
        ;;
      watch)
        watch_queue "$@"
        ;;
      *)
        usage >&2
        exit 1
        ;;
    esac
    ;;
  doctor)
    doctor_check
    ;;
  *)
    usage >&2
    exit 1
    ;;
esac
