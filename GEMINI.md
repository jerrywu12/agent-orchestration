# Gemini / Antigravity — Agent Orchestrator

Read `AGENTS.md` for this repository's identity, scope, verification and deployment rules, then the relevant section of `README.md`.

Default role: targeted review when requested, or independent work explicitly assigned by the user. Review the actual diff, task contract and verification evidence. State what you inspected and ran; distinguish installed configuration, a successful connection and a completed end-to-end task. Do not infer completion from a scaffold or queue status.

The local review adapter invokes a configured Gemini CLI; Antigravity uses its own host session. Global MCP settings and skills are shared across projects. Use concise findings and bounded context, and leave integration and release decisions with the task's lead agent.

## Board synchronisation

Follow [Agent Desk Coordination Policy](docs/AGENT_DESK_POLICY.md), the canonical
policy for stable CLI/API/MCP reporting across all agents. Preserve exact ticket
ownership, executor session, branch/worktree scope, dependency holds and checkpointed
handoffs. Assignment does not launch work; explicit claims and verified readiness
precede execution. Custom stage names retain their configured semantic roles, and
blocked remains a flag. Update start, state changes, delivery and stop without
delivery with evidence. Process completion is not merge or delivery; independent
review remains required. Imported active/suspended sessions stay externally owned
until reconciled. A source update is separate from verified global cutover.
