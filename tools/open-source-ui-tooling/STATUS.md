# Open-Source UI Tooling Status

Last verified: 2026-06-30

Managed install root: `/Users/jerry/agent-orchestrator/tools/open-source-ui-tooling`

Global wrapper dir: `/Users/jerry/.local/bin`

Installed package versions:

| Tool | Package | Version | Wrapper |
| --- | --- | --- | --- |
| Playwright CLI | `playwright` | `1.61.1` | `playwright`, `agent-playwright` |
| Playwright Test | `@playwright/test` | `1.61.1` | `agent-playwright-test` |
| Playwright MCP | `@playwright/mcp` | `0.0.77` | `playwright-mcp`, `agent-playwright-mcp` |
| Storybook CLI | `storybook` | `10.4.6` | `storybook`, `agent-storybook` |
| Chrome DevTools MCP | `chrome-devtools-mcp` | `1.4.0` | `chrome-devtools-mcp`, `agent-chrome-devtools-mcp` |

Verification run:

```bash
/Users/jerry/agent-orchestrator/scripts/check_open_source_ui_tooling.sh
playwright screenshot --browser=chromium https://example.com tools/open-source-ui-tooling/playwright-smoke.png
cd /Users/jerry/agent-orchestrator/tools/open-source-ui-tooling && npm run smoke
```

Configuration state:

- Codex MCP: `playwright` and `chrome-devtools` are registered in `/Users/jerry/.codex/config.toml`.
- Claude MCP: `playwright` and `chrome-devtools` are registered in `/Users/jerry/.claude.json`.
- Gemini MCP: `playwright` and `chrome-devtools` are registered in `/Users/jerry/.gemini/config/mcp_config.json`.
- Global guidance files updated: `/Users/jerry/.codex/AGENTS.md`, `/Users/jerry/.claude/CLAUDE.md`, `/Users/jerry/.gemini/GEMINI.md`.

Maintenance:

```bash
cd /Users/jerry/agent-orchestrator/tools/open-source-ui-tooling
npm outdated
npm update
/Users/jerry/agent-orchestrator/scripts/install_open_source_ui_tooling.sh --wrappers-only
```
