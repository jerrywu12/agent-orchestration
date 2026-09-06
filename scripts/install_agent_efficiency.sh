#!/usr/bin/env bash
# Install the shared package into this user's global agent configs; no project writes.
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
python="${AGENT_EFFICIENCY_PYTHON:-$HOME/.local/share/uv/tools/serena-agent/bin/python}"
if [[ ! -x "$python" ]]; then
  echo 'Install prerequisites: brew install rtk; uv tool install --python 3.13 serena-agent==1.7.0' >&2
  exit 1
fi
exec "$python" "$root/config/global-agent-tooling/agent-efficiency/install.py" "$@"
