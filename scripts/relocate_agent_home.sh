#!/usr/bin/env bash
# Relocate local agent/model folders under this repo's ignored local state tree
# and leave compatibility symlinks at the original paths.

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TARGET_ROOT="${AGENT_ORCHESTRATOR_AGENT_HOME:-$ROOT_DIR/local/agent-home}"
EXECUTE=0
ALLOW_ACTIVE=0
ONLY=""

usage() {
  cat <<EOF
Usage: $0 [--execute] [--allow-active] [--only name[,name...]]

Default mode is a dry run.

Managed names:
  codex, claude, gemini, cursor, agents, hermes, continue, storm,
  agent-skills, ollama, lmstudio, huggingface, whisper, exo-cluster,
  antigravity-ide, aider-desk

Examples:
  $0
  $0 --execute --only claude
  $0 --execute
EOF
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --execute)
      EXECUTE=1
      shift
      ;;
    --allow-active)
      ALLOW_ACTIVE=1
      shift
      ;;
    --only)
      ONLY="${2:-}"
      if [ -z "$ONLY" ]; then
        echo "error: --only requires a comma-separated list" >&2
        exit 2
      fi
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "error: unknown argument: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

entries() {
  cat <<EOF
codex|$HOME/.codex|$TARGET_ROOT/codex|Codex|codex
claude|$HOME/.claude|$TARGET_ROOT/claude|Claude|claude
gemini|$HOME/.gemini|$TARGET_ROOT/gemini|Gemini|gemini|antigravity
cursor|$HOME/.cursor|$TARGET_ROOT/cursor|Cursor|cursor
agents|$HOME/.agents|$TARGET_ROOT/agents|shared agent skills|-
hermes|$HOME/.hermes|$TARGET_ROOT/hermes|Hermes|hermes
continue|$HOME/.continue|$TARGET_ROOT/continue|Continue|continue
storm|$HOME/.local/share/storm|$TARGET_ROOT/storm|STORM|storm
agent-skills|$HOME/agent-skills|$TARGET_ROOT/agent-skills|agent-skills repository|-
ollama|$HOME/.ollama|$TARGET_ROOT/ollama|Ollama models and state|ollama
lmstudio|$HOME/.lmstudio|$TARGET_ROOT/lmstudio|LM Studio models and state|lmstudio
huggingface|$HOME/.cache/huggingface|$TARGET_ROOT/huggingface|Hugging Face cache|huggingface
whisper|$HOME/.cache/whisper|$TARGET_ROOT/whisper|Whisper cache|whisper
exo-cluster|$HOME/.local/share/exo-cluster|$TARGET_ROOT/exo-cluster|Exo cluster runtime|exo
antigravity-ide|$HOME/.antigravity-ide|$TARGET_ROOT/antigravity-ide|Antigravity IDE agent state|antigravity
aider-desk|$HOME/.aider-desk|$TARGET_ROOT/aider-desk|Aider Desk state|aider
EOF
}

is_selected() {
  name="$1"
  if [ -z "$ONLY" ]; then
    return 0
  fi
  case ",$ONLY," in
    *",$name,"*) return 0 ;;
    *) return 1 ;;
  esac
}

quote_cmd() {
  printf "%q " "$@"
  printf "\n"
}

run_cmd() {
  if [ "$EXECUTE" -eq 1 ]; then
    "$@"
  else
    printf "DRY RUN: "
    quote_cmd "$@"
  fi
}

active_matches() {
  patterns="$1"
  if [ -z "$patterns" ] || [ "$patterns" = "-" ]; then
    return 0
  fi
  ps ax -o pid=,comm=,args= | awk -v patterns="$patterns" '
    BEGIN {
      n = split(patterns, raw, "|")
      for (i = 1; i <= n; i++) {
        terms[i] = tolower(raw[i])
      }
    }
    {
      line = tolower($0)
      for (i = 1; i <= n; i++) {
        if (terms[i] != "" && index(line, terms[i]) > 0 && index(line, "relocate_agent_home.sh") == 0 && index(line, "awk -v patterns") == 0) {
          count++
          if (count <= 20) {
            print
          }
          next
        }
      }
    }
    END {
      if (count > 20) {
        print "... " (count - 20) " more matching process(es)"
      }
    }
  '
}

relocate_one() {
  name="$1"
  src="$2"
  dest="$3"
  label="$4"
  patterns="$5"

  if ! is_selected "$name"; then
    return 0
  fi

  echo
  echo "== $label =="
  echo "source: $src"
  echo "target: $dest"

  if [ -L "$src" ]; then
    echo "already symlinked -> $(readlink "$src")"
    return 0
  fi

  if [ ! -e "$src" ]; then
    echo "missing; skipping"
    return 0
  fi

  if [ -e "$dest" ] || [ -L "$dest" ]; then
    echo "error: target already exists: $dest" >&2
    return 1
  fi

  matches="$(active_matches "$patterns" || true)"
  if [ -n "$matches" ] && [ "$ALLOW_ACTIVE" -ne 1 ]; then
    if [ "$EXECUTE" -eq 1 ]; then
      echo "error: matching active processes found; close them or pass --allow-active:" >&2
      echo "$matches" >&2
      return 1
    fi
    echo "warning: matching active processes found; execute mode would stop here unless --allow-active is passed:"
    echo "$matches"
  fi

  run_cmd mkdir -p "$(dirname "$dest")"
  run_cmd mv "$src" "$dest"
  run_cmd ln -s "$dest" "$src"
}

echo "Agent home consolidation target: $TARGET_ROOT"
if [ "$EXECUTE" -eq 0 ]; then
  echo "Mode: dry run. Pass --execute to move folders."
else
  echo "Mode: execute."
fi

while IFS='|' read -r name src dest label patterns; do
  relocate_one "$name" "$src" "$dest" "$label" "$patterns"
done <<EOF
$(entries)
EOF

echo
echo "Done."
