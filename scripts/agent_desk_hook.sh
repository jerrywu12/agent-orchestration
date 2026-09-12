#!/usr/bin/env bash
# Optional source hook. Source this file, then call agent_desk_wrap AGENT COMMAND
# [ARGS...], or execute this file with those arguments. Never source queue records.

agent_desk_wrap() {
  local agent="${1:-}" ticket="${AGENT_DESK_TICKET_ID:-}"
  shift || true
  if [ -z "$agent" ] || [ "$#" -eq 0 ]; then
    echo "Agent Desk hook requires an agent and command." >&2
    return 1
  fi
  if [ -z "$ticket" ]; then
    echo "Agent Desk: unlinked runner; no ticket or board progress will be inferred." >&2
    return 0
  fi
  if ! [[ "$ticket" =~ ^[A-Za-z0-9][A-Za-z0-9_-]*$ ]] || [ "${#ticket}" -gt 200 ]; then
    echo "Agent Desk: invalid ticket ID; refusing execution." >&2
    return 1
  fi
  if [ "${AGENT_DESK_WRAPPED:-}" = "1" ]; then
    if [ "${AGENT_DESK_AGENT_ID:-}" != "$agent" ] ||
       [ -z "${AGENT_DESK_EXECUTION_ID:-}" ] || [ -z "${AGENT_DESK_SESSION_ID:-}" ]; then
      echo "Agent Desk: incomplete or mismatched inherited execution; refusing execution." >&2
      return 1
    fi
    return 0
  fi
  if ! command -v agent-desk >/dev/null 2>&1; then
    echo "Agent Desk: agent-desk CLI unavailable for assigned ticket; refusing execution." >&2
    return 1
  fi
  # The stable CLI atomically verifies ownership/readiness before starting COMMAND.
  # Preserve every argument literally; ticket content is never shell code.
  exec agent-desk wrap --ticket "$ticket" --agent "$agent" -- "$@"
}

if [ "${BASH_SOURCE[0]}" = "$0" ]; then
  set -euo pipefail
  agent_desk_wrap "$@"
  shift
  exec "$@"
fi
