# Agent Home Status

Last updated: 2026-06-30

Canonical local state root:

`/Users/jerry/agent-orchestrator/local/agent-home`

## Moved

These paths have been moved under the canonical local state root and replaced with compatibility symlinks:

| Original path | Symlink target |
| --- | --- |
| `/Users/jerry/.agents` | `/Users/jerry/agent-orchestrator/local/agent-home/agents` |
| `/Users/jerry/.continue` | `/Users/jerry/agent-orchestrator/local/agent-home/continue` |
| `/Users/jerry/agent-skills` | `/Users/jerry/agent-orchestrator/local/agent-home/agent-skills` |
| `/Users/jerry/.cache/huggingface` | `/Users/jerry/agent-orchestrator/local/agent-home/huggingface` |
| `/Users/jerry/.cache/whisper` | `/Users/jerry/agent-orchestrator/local/agent-home/whisper` |
| `/Users/jerry/.aider-desk` | `/Users/jerry/agent-orchestrator/local/agent-home/aider-desk` |

## Prepared But Not Moved While Active

These folders are managed by `scripts/relocate_agent_home.sh`, but should be moved only after closing the apps or services that write to them:

| Original path | Target |
| --- | --- |
| `/Users/jerry/.codex` | `/Users/jerry/agent-orchestrator/local/agent-home/codex` |
| `/Users/jerry/.claude` | `/Users/jerry/agent-orchestrator/local/agent-home/claude` |
| `/Users/jerry/.gemini` | `/Users/jerry/agent-orchestrator/local/agent-home/gemini` |
| `/Users/jerry/.cursor` | `/Users/jerry/agent-orchestrator/local/agent-home/cursor` |
| `/Users/jerry/.hermes` | `/Users/jerry/agent-orchestrator/local/agent-home/hermes` |
| `/Users/jerry/.local/share/storm` | `/Users/jerry/agent-orchestrator/local/agent-home/storm` |
| `/Users/jerry/.ollama` | `/Users/jerry/agent-orchestrator/local/agent-home/ollama` |
| `/Users/jerry/.lmstudio` | `/Users/jerry/agent-orchestrator/local/agent-home/lmstudio` |
| `/Users/jerry/.local/share/exo-cluster` | `/Users/jerry/agent-orchestrator/local/agent-home/exo-cluster` |
| `/Users/jerry/.antigravity-ide` | `/Users/jerry/agent-orchestrator/local/agent-home/antigravity-ide` |

Run a dry-run first:

```bash
/Users/jerry/agent-orchestrator/scripts/relocate_agent_home.sh
```

Then close the relevant apps and run:

```bash
/Users/jerry/agent-orchestrator/scripts/relocate_agent_home.sh --execute
```
