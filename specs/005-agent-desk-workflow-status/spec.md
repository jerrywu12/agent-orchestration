# Agent Desk: GitHub workflow, agent capacity, and blocker resolution

Status: locked for implementation, 2026-09-13. User request is the product authority.

## Outcomes
1. Every project uses exactly Backlog, Ready, In progress, In review, Done, in that order. These names match the connected GitHub project verified by a fresh read. Remove custom-stage and manual GitHub status-mapping controls and writes. GitHub project identity remains configurable; discovered status metadata is read-only.
2. Migrate legacy Planning to Ready, To Do to Backlog, Executing to In progress, PR / Code Review to In review. Fold Parked and unknown hold stages into Backlog. Preserve surviving canonical stage IDs, all tickets, numbers, assignments, dependency edges, imported identity mappings, active claims and GitHub intent. Migration is transactional, repeatable, and cannot auto-start work. Repeated legacy imports cannot recreate retired stages.
3. GitHub synchronization associates unique exact status names after case/whitespace normalization. Missing, ambiguous or unknown statuses produce visible errors without silently claiming synchronization, creating remote options, or discarding pending/conflict data.
4. Agents shows separate launcher/runtime capability and provider capacity, including observed utilization, reset time, source, and freshness. Codex uses its existing signed-in CLI's passive app-server rate-limit read. Unsupported or unsafe provider integrations explicitly say limits unavailable; no model calls, session probes, credential extraction, provider upgrades, authentication migration, or inferred unlimited capacity. Backend permission, where available, controls availability; expired reset time alone does not prove recovery.
5. Explicit Start remains usable for an assigned blocked ticket, including one in Backlog. It launches an exclusive blocker-resolution execution with context and bounded tools to update its own ticket and create subtasks. It does not blindly clear a blocker or dependency. Disabled/unassigned agents, archived/Done tickets, unavailable launchers, invalid repositories and existing claims remain protected. Automatic starts and ordinary claims still honor readiness/blocker holds.
6. Scoped execution tools let the assigned active agent read same-project dependency context, update its claimed ticket with optimistic version and an audit reason, and create same-owner subtasks. They cannot impersonate an agent, steal a claim, update another agent's ticket, archive work, mark Done, or access unrelated documents. Reorganized tickets retain validation of dependencies, project boundaries and cycles.

## Acceptance evidence
- Seed the 11-stage/two-project legacy shape; migration yields ten canonical stages, Parked tickets move to Backlog, source stage mappings redirect, all claims and pending/conflict intent survive, second migration is a no-op.
- Repeat legacy import including new tasks and unknown stages; canonical stages only, no missing tickets or revived Parked stage.
- Exact-name GitHub round trips, conflicts, unknown/missing/duplicate options, retained pending writes, restart and active-claim completion guards.
- Codex passive protocol fixtures cover multiple buckets, arbitrary window order, null usage, explicit blocked/spend-control states, stale data, reset expiry, errors, output bounds and timeout. HTTP refreshes coalesce; fixtures never contact host providers.
- Browser verifies five stages and absence of mapping/custom-stage controls, capacity and reset display, unsupported quota reasons, and enabled blocked Start button.
- Fake CLI end-to-end Start launches a resolver, receives blocker/dependency context, and reports progress. Scoped tool tests prove own-ticket reorganization succeeds and foreign claims, stale versions, cycles, archive/Done and spoof attempts fail.
- Full Node, TypeScript/build and project Playwright suite; independent review; PR CI before merge; backup before deployment and current live path/SHA plus preserved-data proof afterwards.

## Sources
- https://docs.github.com/en/issues/planning-and-tracking-with-projects/understanding-fields/about-single-select-fields
- https://docs.github.com/en/issues/planning-and-tracking-with-projects/automating-your-project/using-the-api-to-manage-projects
- https://github.com/openai/codex/blob/main/codex-rs/app-server-protocol/schema/json/v2/GetAccountRateLimitsResponse.json
- https://code.claude.com/docs/en/statusline
- https://docs.ollama.com/api/ps
