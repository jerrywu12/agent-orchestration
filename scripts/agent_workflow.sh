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
  scripts/agent_workflow.sh handoff submit <spec_path> [--agent <agent>] [--mode <mode>] [--ticket <id>]
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

validate_ticket_id() {
  local ticket="$1"
  [ -z "$ticket" ] || { [[ "$ticket" =~ ^[A-Za-z0-9][A-Za-z0-9_-]*$ ]] && [ "${#ticket}" -le 200 ]; }
}

# A queue item owns its explicit linkage. An enclosing runner's ticket/session
# must not leak into a different item, or into an item that has no ticket at all.
run_ticket_child() (
  local ticket="$1" agent="$2"
  shift 2
  if [ -z "$ticket" ] || [ "$ticket" != "${AGENT_DESK_TICKET_ID:-}" ] ||
     [ "$agent" != "${AGENT_DESK_AGENT_ID:-}" ]; then
    unset AGENT_DESK_WRAPPED AGENT_DESK_EXECUTION_ID AGENT_DESK_SESSION_ID
  fi
  if [ -n "${AGENT_DESK_AGENT_ID:-}" ] && [ "$agent" != "$AGENT_DESK_AGENT_ID" ]; then
    unset AGENT_DESK_TOKEN
  fi
  export AGENT_DESK_TICKET_ID="$ticket" AGENT_DESK_AGENT_ID="$agent"
  if [ "$agent" = "codex" ]; then
    "$@"
  elif [ -f "$ROOT/scripts/agent_desk_hook.sh" ]; then
    /bin/bash "$ROOT/scripts/agent_desk_hook.sh" "$agent" "$@"
  elif [ -n "$ticket" ]; then
    echo "Agent Desk: source hook unavailable for assigned ticket; refusing execution." >&2
    return 1
  else
    echo "Agent Desk: unlinked runner; no ticket or board progress will be inferred." >&2
    "$@"
  fi
)

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
  local ticket_id=""
  
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
      --ticket)
        shift
        ticket_id="${1:-}"
        [ -n "$ticket_id" ] || die "--ticket requires an ID."
        ;;
      *)
        usage >&2
        exit 1
        ;;
    esac
    shift || true
  done

  [ -f "$spec_path" ] || die "Spec file not found: $spec_path"
  validate_ticket_id "$ticket_id" || die "Invalid Agent Desk ticket ID."

  local spec_name
  spec_name=$(basename "$spec_path")
  local queue_file="$QUEUE_DIR/$spec_name.job"

  echo "Queuing handoff for $spec_name targeted to agent: $agent..."
  cat <<EOF > "$queue_file"
spec_path="$spec_path"
target_agent="$agent"
mode="$mode"
ticket_id="$ticket_id"
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
  local ticket_id=""
  
  # Parse job properties
  spec_path=$(grep '^spec_path=' "$job_file" | cut -d'"' -f2 || echo "")
  target_agent=$(grep '^target_agent=' "$job_file" | cut -d'"' -f2 || echo "codex")
  mode=$(grep '^mode=' "$job_file" | cut -d'"' -f2 || echo "local-worktree")
  ticket_id=$(grep '^ticket_id=' "$job_file" | cut -d'"' -f2 || true)
  validate_ticket_id "$ticket_id" || die "Invalid Agent Desk ticket ID in queue metadata."

  echo "Starting execution of $spec_path for agent $target_agent..."
  # Mark job running by updating status
  sed -i.bak 's/status="pending"/status="running"/g' "$job_file" && rm -f "${job_file}.bak"

  local rc=0
  if [ "$target_agent" = "codex" ]; then
    if [ -f "$ROOT/scripts/codex_auto_dev.sh" ]; then
      run_ticket_child "$ticket_id" codex "$ROOT/scripts/codex_auto_dev.sh" "$spec_path" || rc=$?
    else
      die "codex_auto_dev.sh not found."
    fi
  elif [ "$target_agent" = "gemini" ]; then
    if [ -f "$ROOT/scripts/gemini_auto_review.sh" ]; then
      local slug
      slug=$(basename "$spec_path" \
        | sed -E 's/_DEV_PLAN\.md$//' \
        | tr '[:upper:]' '[:lower:]' \
        | sed -E 's/[^a-z0-9]+/-/g; s/^-+//; s/-+$//')
      run_ticket_child "$ticket_id" gemini "$ROOT/scripts/gemini_auto_review.sh" "$slug" || rc=$?
    else
      die "gemini_auto_review.sh not found."
    fi
  else
    echo "Unknown agent $target_agent. Skipping execution."
  fi

  # Record a terminal status based on the runner's exit code — never mark a
  # failed run as "completed".
  local final_status="completed"
  [ "$rc" -eq 0 ] || final_status="failed"
  sed -i.bak "s/status=\"running\"/status=\"$final_status\"/g" "$job_file" && rm -f "${job_file}.bak"

  if [ "$rc" -ne 0 ]; then
    echo "Handoff execution FAILED (exit $rc). Job marked '$final_status': $job_file" >&2
    return "$rc"
  fi
  echo "Handoff execution complete."
  return 0
}

run_next() {
  # NB: use 'return', never 'exit' — this runs inside the long-lived watch loop,
  # and an 'exit' here would kill the whole watcher on the first empty poll.
  local found_any=0
  local job
  while IFS= read -r job; do
    [ -n "$job" ] || continue
    found_any=1
    if grep -q 'status="pending"' "$job" 2>/dev/null; then
      # Tolerate runner failure: run_job records status="failed" in the job file,
      # and we keep the watcher alive regardless.
      run_job "$job" || true
      return 0
    fi
  done < <(find "$QUEUE_DIR" -name "*.job" 2>/dev/null | sort)

  if [ "$found_any" -eq 0 ]; then
    echo "No pending jobs in queue."
  else
    echo "All jobs processed."
  fi
  return 0
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
        # `|| true` guards each grep: no match exits 1, which under
        # `set -o pipefail` would otherwise abort the assignment.
        pending=$(  { grep -l 'status="pending"'   "$QUEUE_DIR"/*.job 2>/dev/null || true; } | wc -l | tr -d ' ')
        running=$(  { grep -l 'status="running"'   "$QUEUE_DIR"/*.job 2>/dev/null || true; } | wc -l | tr -d ' ')
        completed=$({ grep -l 'status="completed"' "$QUEUE_DIR"/*.job 2>/dev/null || true; } | wc -l | tr -d ' ')
        failed=$(   { grep -l 'status="failed"'    "$QUEUE_DIR"/*.job 2>/dev/null || true; } | wc -l | tr -d ' ')
        echo "Jobs — pending: ${pending:-0}  running: ${running:-0}  completed: ${completed:-0}  failed: ${failed:-0}"
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
