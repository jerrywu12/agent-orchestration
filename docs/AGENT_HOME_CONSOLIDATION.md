# Agent Home Consolidation

This repository is the canonical organizer for local agent and model tooling. Live state should move under:

`/Users/jerry/agent-orchestrator/local/agent-home`

The `local/` tree is ignored by git because these folders can contain credentials, OAuth refresh tokens, SQLite databases, logs, browser profiles, transcripts, and large model or cache files.

## Managed Folders

| Name | Original path | Consolidated path |
| --- | --- | --- |
| Codex | `/Users/jerry/.codex` | `/Users/jerry/agent-orchestrator/local/agent-home/codex` |
| Claude | `/Users/jerry/.claude` | `/Users/jerry/agent-orchestrator/local/agent-home/claude` |
| Gemini | `/Users/jerry/.gemini` | `/Users/jerry/agent-orchestrator/local/agent-home/gemini` |
| Cursor | `/Users/jerry/.cursor` | `/Users/jerry/agent-orchestrator/local/agent-home/cursor` |
| Shared agent skills | `/Users/jerry/.agents` | `/Users/jerry/agent-orchestrator/local/agent-home/agents` |
| Hermes | `/Users/jerry/.hermes` | `/Users/jerry/agent-orchestrator/local/agent-home/hermes` |
| Continue | `/Users/jerry/.continue` | `/Users/jerry/agent-orchestrator/local/agent-home/continue` |
| STORM | `/Users/jerry/.local/share/storm` | `/Users/jerry/agent-orchestrator/local/agent-home/storm` |
| Agent skills repo | `/Users/jerry/agent-skills` | `/Users/jerry/agent-orchestrator/local/agent-home/agent-skills` |
| Ollama | `/Users/jerry/.ollama` | `/Users/jerry/agent-orchestrator/local/agent-home/ollama` |
| LM Studio | `/Users/jerry/.lmstudio` | `/Users/jerry/agent-orchestrator/local/agent-home/lmstudio` |
| Hugging Face cache | `/Users/jerry/.cache/huggingface` | `/Users/jerry/agent-orchestrator/local/agent-home/huggingface` |
| Whisper cache | `/Users/jerry/.cache/whisper` | `/Users/jerry/agent-orchestrator/local/agent-home/whisper` |
| Exo cluster | `/Users/jerry/.local/share/exo-cluster` | `/Users/jerry/agent-orchestrator/local/agent-home/exo-cluster` |
| Antigravity IDE | `/Users/jerry/.antigravity-ide` | `/Users/jerry/agent-orchestrator/local/agent-home/antigravity-ide` |
| Aider Desk | `/Users/jerry/.aider-desk` | `/Users/jerry/agent-orchestrator/local/agent-home/aider-desk` |
| DeerFlow | `/Users/jerry/Codex/deer-flow` | `/Users/jerry/agent-orchestrator/local/agent-home/deerflow/deer-flow` |

Agent-specific skills are included inside their parent folders, for example `/Users/jerry/.codex/skills`, `/Users/jerry/.claude/skills`, `/Users/jerry/.gemini/skills`, and `/Users/jerry/.cursor/skills-cursor`.

DeerFlow is already migrated and the old `/Users/jerry/Codex` tree has been removed. Use `agent-deerflow-gateway` and `agent-deerflow-mcp` from `/Users/jerry/.local/bin` for all agents.

## Safe Migration Flow

1. Close apps that write to these folders: Codex, Claude, Gemini, Cursor, Hermes, Continue, STORM jobs, Ollama, LM Studio, Exo, Antigravity, and Aider.
2. Preview the move:

   ```bash
   /Users/jerry/agent-orchestrator/scripts/relocate_agent_home.sh
   ```

3. Move everything and leave compatibility symlinks:

   ```bash
   /Users/jerry/agent-orchestrator/scripts/relocate_agent_home.sh --execute
   ```

4. Move one folder at a time when debugging:

   ```bash
   /Users/jerry/agent-orchestrator/scripts/relocate_agent_home.sh --execute --only claude
   ```

5. Restart the affected apps and verify their config, MCP servers, sessions, and skills are still visible.

The script refuses to move a folder when matching agent processes appear active unless `--allow-active` is passed. Prefer closing the apps over forcing an active move.
