# Claude — Agent Orchestrator

Read `AGENTS.md` for this repository's identity, scope, verification and deployment rules, then the relevant section of `README.md`.

Default role: requirements, planning, diagnosis and bounded advisory work. Put new feature contracts under `specs/` through the shared Spec Kit workflow. Handoffs identify the exact checkout, owned paths, observations, acceptance commands and unresolved decisions. Codex normally owns implementation and final verification unless the user assigns work differently.

This repository maintains the shared orchestration infrastructure. Its `templates/CLAUDE.md.template` is for downstream projects; it is not this repository's own task packet. The local queue does not execute a Claude adapter. Use the host session for planning and follow the shared efficiency policy without copying whole histories into handoffs.
