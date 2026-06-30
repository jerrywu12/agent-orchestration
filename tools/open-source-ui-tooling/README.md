# Open-Source UI Tooling Bundle

This folder is the shared, repo-tracked install root for UI testing and inspection tools used by local agents.

Installed tools:

- Playwright CLI and Playwright Test for browser automation, screenshots, and visual regression checks.
- Playwright MCP for agent-driven browser control.
- Storybook CLI for isolated UI component fixtures.
- Chrome DevTools MCP for live Chrome DOM/CSS/console/network inspection.

Global wrappers are installed into `/Users/jerry/.local/bin` and point back to this folder, so agents can run stable commands while versions remain tracked by this repo's `package-lock.json`.

Useful commands:

```bash
/Users/jerry/agent-orchestrator/scripts/check_open_source_ui_tooling.sh
/Users/jerry/agent-orchestrator/scripts/install_open_source_ui_tooling.sh
cd /Users/jerry/agent-orchestrator/tools/open-source-ui-tooling && npm outdated
```

Repo-local adoption rule:

- Use these global tools for inspection and bootstrap help.
- For real project test suites, add project-local dependencies and lockfile entries in that project so CI and local runs use the same versions.
