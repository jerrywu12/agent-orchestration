# Claude — Agent Orchestrator

Read `AGENTS.md` for this repository's identity, scope, verification and deployment rules, then the relevant section of `README.md`.

Default role: requirements, planning, diagnosis and bounded advisory work. Put new feature contracts under `specs/` through the shared Spec Kit workflow. Handoffs identify the exact checkout, owned paths, observations, acceptance commands and unresolved decisions. Codex normally owns implementation and final verification unless the user assigns work differently.

This repository maintains the shared orchestration infrastructure. Its `templates/CLAUDE.md.template` is for downstream projects; it is not this repository's own task packet. The local queue does not execute a Claude adapter. Use the host session for planning and follow the shared efficiency policy without copying whole histories into handoffs.

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
