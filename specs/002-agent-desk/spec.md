# Feature Specification: Agent Desk

**Branch**: codex/agent-desk | **Created**: 2026-09-12 | **Status**: specified for implementation
**Owner**: Codex, this user-assigned new replacement task; isolated worktree /private/tmp/agent-desk-worktree.

## User Scenarios & Testing

### US1 - Manage independent work (P1)
One self-hosted app manages multiple projects, custom ordered stages, priorities, labels,
parent/child tickets and dependencies. A searchable grouped list is primary.
Acceptance: create/edit/assign/move/filter a ticket and reload without losing data; customize
stages; reject cross-project stages and dependency cycles; stage moves preserve ownership.

### US2 - Coordinate agents and observe progress (P1)
Assignment records responsibility. Explicit Start launches a supported adapter; optional stage
automation is separate. Independent agents report via a stable REST API, CLI and MCP bridge.
Acceptance: concurrent claims have one winner; duplicate and old events cannot corrupt progress;
foreign sessions cannot report or release; stale heartbeat remains visible and does not steal a
claim; reassigning active work requires checkpointed handoff; blocked/dependency-held work cannot
start; completion does not mean merge. Unsupported adapters show capability limits honestly.

### US3 - Synchronize GitHub Issues and Projects v2 (P1)
Connect repositories and Project boards, import issues once, sync local edits and mapped stages,
pull remote changes, and expose errors, retry state and conflicts.
Acceptance: paginate and exclude PRs; stable repository/issue identity; preserve unrelated labels
and issue content; agent names are not assumed GitHub logins; round-trip mapped Project status;
retain pending work through network/permission/rate failures; concurrent edits require resolution;
closed issue state does not fabricate delivery or PR merge evidence.

### US4 - Replace Kangentic safely (P1)
Import projects/stages/tickets/labels/priorities/PR and session references from a consistent
read-only source snapshot. Replace shared guidance, connectors and supported runner hooks.
Acceptance: source unchanged; repeat import creates no duplicates; original IDs retained;
active imported sessions remain external and cannot auto-restart; no existing executor killed;
reconcile source counts; enumerate unsupported source fields; retain backups and rollback manifest.

### US5 - Host and recover (P1)
Persistent macOS service and Docker Compose deployment, SQLite persistence and backup/restore.
Acceptance: restart retains data; health identifies root/SHA; keyboard/mobile browser journeys;
loopback-only default; remote binding requires authentication; foreign origins/hosts rejected;
ticket content cannot become shell code; empty/error/stale states are visible.

## Requirements

- FR-001: Durable project/ticket/custom-stage/agent models and ordered list views.
- FR-002: Owner, exact executor session, stage, heartbeat, reported percent and merge evidence are separate.
- FR-003: Transactional exclusive claims, dependency holds and sequenced idempotent progress events.
- FR-004: Append-only activity history for changes, execution and sync.
- FR-005: Stable API/CLI/MCP with administrator and per-agent remote authorization.
- FR-006: Fixed executable adapters with argument arrays; preserve provider/model defaults.
- FR-007: Durable pending GitHub sync, bounded retries and visible conflict resolution.
- FR-008: Non-destructive idempotent migration and reversible connector cutover.
- FR-009: Health, persistence, backup, deployment and recovery instructions.
- FR-010: No secrets, local data, logs, private tickets or provider responses committed.

## Key Entities
Project; Stage; Agent; Ticket; Execution; Event; GitHubLink; SyncJob; MigrationRecord.

## Success Criteria
- SC-001: Browser proves creating, assigning, moving, filtering and persistence.
- SC-002: Concurrent claim and event tests prove exact executor ownership.
- SC-003: Fixture GitHub server proves round-trip Issues/Projects and failure recovery; live permissions reported separately.
- SC-004: Migration counts reconcile and second import changes no identity/count.
- SC-005: Installed service displays app; configured connectors pass health; reconnect/permission gaps named.

## Assumptions and Clarifications
One trusted operator initially. Remote access uses tokens behind HTTPS, not full organization SSO.
Assignment then explicit Start is the default, with optional stage automation; user preference asked.
Plane is a UX reference for an independent implementation. Source belongs in agent-orchestrator.
User authorizes building and global cutover; existing ticket owners and active sessions remain intact.
This newly assigned task is not an existing To Do ticket being auto-promoted.
