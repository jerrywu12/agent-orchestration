# Global Agent Tooling Config

This folder tracks the desired machine-wide MCP/tooling configuration for shared open-source UI tooling and DeerFlow.

Canonical local repo path:

`/Users/jerry/agent-orchestrator`

Operational config files still live in the home-directory locations each agent reads:

- Codex: `/Users/jerry/.codex/config.toml`
- Claude: `/Users/jerry/.claude.json`
- Gemini: `/Users/jerry/.gemini/config/mcp_config.json`
- Cursor: `/Users/jerry/.cursor/mcp.json`

Cursor's persistent guidance rule lives at `/Users/jerry/.cursor/rules/shared-ui-tooling.mdc`. Future project installs seed the same rule from `templates/cursor-shared-ui-tooling.mdc.template`.

The snippets here are the source-of-truth entries to keep those operational files aligned with the shared tooling bundle.

DeerFlow operational paths:

- Checkout: `/Users/jerry/agent-orchestrator/local/agent-home/deerflow/deer-flow`
- MCP wrapper: `/Users/jerry/.local/bin/agent-deerflow-mcp`
- Gateway wrapper: `/Users/jerry/.local/bin/agent-deerflow-gateway`
- Launchd service: `local.agent.deerflow`
- Health endpoint: `http://127.0.0.1:8001/health`

Validation command:

```bash
/Users/jerry/agent-orchestrator/scripts/check_open_source_ui_tooling.sh
```

## Global command safety hooks

The tracked guardrail under `agent-guardrails/` is the source of truth for the
machine-wide Claude Code and Codex `PreToolUse` hooks. It blocks high-confidence
catastrophic shell operations before execution, including recursive or mass file
deletion, history-rewriting Git commands, storage erasure, broad permission
changes, privilege escalation, remote scripts piped into a shell, and destructive
inline interpreter payloads. Normal development commands such as `git push`,
read-only `find`, and deleting one explicit file remain allowed.

Install or refresh both global hooks:

```bash
python3 /Users/jerry/agent-orchestrator/config/global-agent-tooling/agent-guardrails/install_global_hooks.py
```

The installer preserves unrelated settings, writes files atomically with private
permissions, and stores timestamped backups under
`~/.local/share/agent-guardrails/backups/`. The installed validator lives at
`~/.local/share/agent-guardrails/pre_tool_guard.py`.

Codex asks for one-time trust before enabling a newly discovered hook. In a new
Codex task, run `/hooks`, review the command path, and trust the hook. Claude Code
loads the global hook from `~/.claude/settings.json`.

Run the isolated regression suite without touching live home-directory settings:

```bash
python3 -m unittest discover \
  -s /Users/jerry/agent-orchestrator/config/global-agent-tooling/agent-guardrails \
  -p 'test_*.py' -v
```

For installer smoke tests against a disposable home directory, set
`AGENT_GUARDRAILS_HOME`. `AGENT_GUARDRAILS_PYTHON` can override the interpreter
recorded in hook configuration.
