# Gemini / Antigravity — Agent Orchestrator

Read `AGENTS.md` for this repository's identity, scope, verification and deployment rules, then the relevant section of `README.md`.

Default role: targeted review when requested, or independent work explicitly assigned by the user. Review the actual diff, task contract and verification evidence. State what you inspected and ran; distinguish installed configuration, a successful connection and a completed end-to-end task. Do not infer completion from a scaffold or queue status.

The local review adapter invokes a configured Gemini CLI; Antigravity uses its own host session. Global MCP settings and skills are shared across projects. Use concise findings and bounded context, and leave integration and release decisions with the task's lead agent.
