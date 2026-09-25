# Feature Specification: Agent Desk Tracking Only

**Feature Branch**: `codex/agent-desk-tracking-only`
**Created**: 2026-09-25
**Status**: Locked for implementation
**Input**: Moving a ticket from Backlog to Planning must not trigger an AI agent. Agent Desk tracks task progress; AI agents update status accordingly. The user clarified that explicit Run Agent must also stop launching work.

## User Scenarios & Testing

### User Story 1 - Assign work without launching it (Priority: P1)

An operator moves one or several tickets to Planning or Ready, selects an accountable agent, and sees the recorded stage and owner. No agent process is started or queued.

**Independent Test**: Confirm single and bulk transitions with a synthetic unavailable launcher; observe updated tickets, zero launch records, and no process start.

1. Given an unclaimed Backlog ticket, when its Planning move is confirmed, then the stage and owner change and the ticket awaits an agent update.
2. Given a prepared Planning ticket, when its Ready move is confirmed, then readiness and reservation checks apply and no agent starts.
3. Given a stale version or held claim, when confirmation is attempted, then the move is refused without changing ownership or starting work.

### User Story 2 - Independently running agents keep status current (Priority: P1)

An assigned agent works in its own client, claims its exact session, and reports verified progress, blockers, checkpoints and completion. Agent Desk displays those reports and the resulting stage changes.

**Independent Test**: Claim and report a synthetic planning and implementation session; observe Planning, Ready, In progress and In review with exact execution ownership.

1. Given a Planning ticket, when its assigned agent claims and reports progress, then the board shows that exact session and its latest report.
2. Given completed planning with complete preparation, when the agent reports completion, then the ticket becomes Ready without starting implementation.
3. Given a Ready ticket, when the assigned agent claims and completes implementation, then the board moves it through In progress to In review.

### User Story 3 - Retire launch requests safely (Priority: P2)

No board, API or legacy queued request can start an agent. Historical executions and recovery evidence remain readable.

**Independent Test**: Attempt direct and bulk launch endpoints; restart with a queued legacy intent; inspect historical execution status.

1. Given a direct or bulk launch request, when submitted, then the service rejects it with `TRACKING_ONLY` and creates no execution.
2. Given an older queued intent, when the service starts, then the intent is cancelled without replay.
3. Given a historical execution or held claim, when the app loads, then its evidence and guarded recovery remain available.

### Edge Cases

- Local CLI availability does not prevent status assignment.
- Existing claims keep their reservation; stale heartbeat alone does not authorize takeover.
- No percentage is invented while an assigned agent has not reported.
- A lost transition response remains uncertain until the ticket is re-read; no automatic retry occurs.

## Requirements

- **FR-001**: Stage confirmation MUST update owner and stage without creating launch intent, execution, process or batch.
- **FR-002**: Direct and bulk launch actions MUST be unavailable in the UI and rejected at the server boundary.
- **FR-003**: Persisted queued and awaiting-claim legacy intents MUST be cancelled on startup without affecting completed history.
- **FR-004**: Exact assigned agents MUST retain claim, progress, organization, checkpoint, completion and delivery reporting paths.
- **FR-005**: The UI MUST distinguish assigned but unclaimed work from an agent actively reporting.
- **FR-006**: Readiness, dependency, conflict, version and existing-claim guards MUST remain enforced.
- **FR-007**: Shared agent guidance MUST require timely verified status reports at start, stage change, delivery and stop.

### Key Entities

- **Ticket**: Canonical task with project, stage, owner, version, preparation and blockers.
- **Execution**: Exact agent session and its progress/evidence.
- **Legacy launch intent**: Retained historical admission metadata; queued intents become cancelled.

## Success Criteria

- **SC-001**: Single and bulk Planning moves generate zero agent starts in automated journeys.
- **SC-002**: All new direct and bulk launch requests are rejected before any execution is created.
- **SC-003**: A reporting agent's progress and stage changes appear after board refresh without mislabeling an idle assignment as working.
- **SC-004**: Existing recovery, archive, readiness and delivery checks pass after the contract change.

## Assumptions

- Agent sessions start outside Agent Desk; the existing CLI/MCP connector remains the reporting channel.
- Existing running processes are not stopped by this source change.
- Historical batch and launch metadata remain available for audit and recovery.
