# Global Agent UI Tooling Config

This folder tracks the desired machine-wide MCP/tooling configuration for the shared open-source UI tooling bundle.

Canonical local repo path:

`/Users/jerry/agent-orchestrator`

Operational config files still live in the home-directory locations each agent reads:

- Codex: `/Users/jerry/.codex/config.toml`
- Claude: `/Users/jerry/.claude.json`
- Gemini: `/Users/jerry/.gemini/config/mcp_config.json`
- Cursor: `/Users/jerry/.cursor/mcp.json`

Cursor's persistent guidance rule lives at `/Users/jerry/.cursor/rules/shared-ui-tooling.mdc`. Future project installs seed the same rule from `templates/cursor-shared-ui-tooling.mdc.template`.

The snippets here are the source-of-truth entries to keep those operational files aligned with the shared tooling bundle.

Validation command:

```bash
/Users/jerry/agent-orchestrator/scripts/check_open_source_ui_tooling.sh
```
