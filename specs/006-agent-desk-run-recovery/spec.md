# Agent Desk managed runs and recovery

Status: locked for implementation, 2026-09-13. The user requested a fix for blocked starts, session tracing and explicit takeover for untraceable stale claims, plus bulk Run Agent and Archive.

## Objective and acceptance
1. An explicit Start can read and update its exact claimed ticket from the installed sandbox without MCP approvals or network access. A private filesystem mailbox delegates only previously authorized ticket operations to the supervisor. No admin/agent token is passed to a managed child. Provider model and sandbox defaults remain intact.
2. Reported progress is retained. Process exit zero without an explicit terminal report checkpoints with the last useful summary; it never implies readiness for review. Complete while a blocker/dependency remains checkpoints with the unresolved cause. Native session identity is captured separately from the board lease.
3. Tickets expose current execution, native Codex link when verified, background process evidence and bounded execution history. Missing heartbeat alone never proves a stopped process.
4. An administrator may explicitly revoke a stale, untraceable claim after reviewing a fresh trace, acknowledging uncertainty and giving a reason. A verified live process cannot be taken over. Exact execution/session/heartbeat comparison fences races. Retain all old records and worktrees; fence late reports. Revocation does not kill unknown processes or claim to stop them.
5. All work supports selection of up to100 visible tickets. Bulk Run Agent queues eligible work with bounded concurrency (default2, configurable1-4), starts blocked/Backlog resolution, leaves live runs alone, and surfaces stale claims for explicit recovery. Results persist, retries use a request ID and service restart interrupts queued work visibly without automatic replay.
6. Bulk Archive returns per-ticket outcomes and refuses active claims. Selection and confirmation identify exactly which tickets are affected.
7. Preserve original S05 reserved implementation. Narrow obsolete Agent Desk blockers with verified evidence; do not invent release or native UI proof. No computer control or screenshots for Agent Desk.

## Structure and commands
Node/SQLite/React existing app under tools/agent-desk. No new runtime dependencies or schema changes. Use existing formatting, validation and Service ownership methods, e.g. `service.event(run.id, { ...identity, seq: current.lastSeq + 1, type, summary })`.
From tools/agent-desk: `npm test`, `npm run build`, `npm run test:e2e` (scripted DOM checks, screenshots/traces disabled). Focused Node regressions must fail before production fixes.

## Boundaries
Always preserve unrelated claims/credentials/worktrees and validate all privileged operations in the parent. Never infer native session identity from ticket title, automatically steal stale reservations, resume unreviewed source work, broaden sandbox/network permissions, or use browser/computer-control tools. User explicitly authorizes recovery capability, not silent takeover of current claims. No further product ambiguity blocks implementation.
