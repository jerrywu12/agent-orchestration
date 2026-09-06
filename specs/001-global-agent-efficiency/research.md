# Research decisions
- RTK official README documents compact shell output and instruction-based Codex integration. Install explicit CLI; preserve safety hooks. https://github.com/rtk-ai/rtk
- Serena official docs require separate stdio processes for different projects; desktop cwd may not be project cwd. Use explicit project activation and small read-only context. https://oraios.github.io/serena/02-usage/020_running.html and 030_clients.html
- Install published serena-agent in isolated uv tool environment; record observed versions. https://oraios.github.io/serena/02-usage/010_installation.html
- Existing Aider/Graphify present; no duplicate index construction or replacement harness.
- Model backends are not MCP clients. Use a small advice-only adapter over existing APIs/CLI; preserve credentials, no model-generated execution.
- DeerFlow refreshed at 2026-09-06 16:14 +0800; HTTP health passed, advisory returned provider HTTP 400. Hermes bounded advisory identified summary omission, exit/signal fidelity and index concurrency as priorities. Advice compared with local contracts.
