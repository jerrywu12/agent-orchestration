# Gemini / Antigravity — Agent Orchestrator

Read `AGENTS.md` for this repository's identity, scope, verification and deployment rules, then the relevant section of `README.md`.

Default role: targeted review when requested, or independent work explicitly assigned by the user. Review the actual diff, task contract and verification evidence. State what you inspected and ran; distinguish installed configuration, a successful connection and a completed end-to-end task. Do not infer completion from a scaffold or queue status.

The local review adapter invokes a configured Gemini CLI; Antigravity uses its own host session. Global MCP settings and skills are shared across projects. Use concise findings and bounded context, and leave integration and release decisions with the task's lead agent.

## Board synchronisation

Canonical policy: `docs/KANGENTIC_BOARD_POLICY.md` — mirrored for Claude, Codex, Gemini CLI,
Antigravity, Cursor and ARK lanes; when mirrors disagree, the canonical doc wins.

Any work item with a backlog entry, a `specs/<nnn>-<slug>/` directory, or an implementer dispatch
carries one Kangentic ticket. Update it at four moments: start, state change, delivery, and **stop
without delivery** — a lane that dies mid-task must leave the ticket saying so, because silence reads
as progress. Report verified state with evidence (PR link, SHA, the check that proves it) and say
explicitly what is NOT done; a draft PR and a green gate on an unmerged branch are both "in review",
not "delivered".

**No Kangentic integration is configured on this machine yet** (verified 2026-09-07: no MCP server,
no CLI, no repo reference). Until one exists: do not invent an endpoint or ticket scheme, keep the
project's own backlog and handoff board current, and tell Jerry in your reply that the ticket was not
updated — including the text you would have posted.
