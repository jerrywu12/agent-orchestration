# Feature Specification: Bulk Backlog to Planning

**Feature Branch**: `codex/agent-desk-bulk-planning`
**Created**: 2026-09-13
**Status**: Locked for implementation
**Input**: "allow drag and drop multiple ticket from backlog to planning, then confirm"

## User Scenarios & Testing

### User Story 1 - Drop and confirm multiple tickets (Priority: P1)

Select Backlog tickets with existing checkboxes, drag one selected ticket onto Planning, review the complete selection and choose one planning agent, then confirm once.

**Independent Test**: Automated DOM drag in list and board views with two synthetic Backlog tickets; no mutation before confirmation; after confirmation each eligible ticket is Planning with the chosen owner and its own reported launch outcome.

1. Given two selected Backlog tickets, when either is dropped on Planning, then one confirmation lists both ticket identifiers and titles.
2. Given that confirmation, when cancelled or dismissed, then stage, owner, history and execution remain unchanged.
3. Given confirmation and an enabled available planner, when confirmed, then each ticket uses its own project's Planning stage and starts or queues planning through the existing confirmed transition workflow.

### User Story 2 - Safe, accessible partial outcomes (Priority: P1)

Users can perform the same operation without dragging, understand skipped tickets, and see per-ticket outcomes without duplicate launches.

**Independent Test**: Keyboard/button journey, mixed selection, stale version, held execution, unavailable owner, partial API failure and duplicate confirmation tests.

1. Given selection including a non-Backlog or held ticket, when opening confirmation, then that ticket is listed with its exclusion reason; it is not submitted and eligible Backlog tickets can still proceed.
2. Given a ticket changed after opening confirmation, when submitting, then it is refused rather than moving an unreviewed version.
3. Given an in-flight or completed batch, when confirmation is clicked again, then no duplicate request is sent. Network-uncertain results require inspecting current ticket state before a new attempt, not automatic replay.
4. Given only keyboard or touch access, when selecting tickets and using Move to Planning, then the same confirmation and safeguards apply.

### Edge Cases

- Dragging an unselected Backlog ticket moves only that ticket; dragging a selected ticket includes the current visible selection (maximum 100).
- External file/text drops and drops on any other stage do nothing.
- Empty Planning groups remain valid drop targets even with filters; collapsed Planning headers accept drops.
- All Work may span projects; tickets never change project. Missing/ambiguous Planning stages are reported per ticket.
- Archived work, active reservations, disabled/non-executable/unavailable agents remain protected. An unrelated running batch does not disable this action.
- Successful admission followed by launch failure is reported as moved but failed to start, not as unchanged or running.

## Requirements

- **FR-001**: Support multi-selected Backlog drag/drop to Planning in list and board views, with visible target feedback and count.
- **FR-002**: Drop MUST NOT persist anything or start agents; explicit owner confirmation is required.
- **FR-003**: Confirmation MUST list all candidate tickets and exclusion reasons; one agent applies to eligible candidates.
- **FR-004**: Use existing transactional stage/owner/version/claim/dispatch guards and stage timestamps per ticket; no bypass or new automatic takeover.
- **FR-005**: Report started, queued, admitted-but-launch-failed, refused and uncertain outcomes individually. Retain failed/excluded selection and clear successfully admitted selection.
- **FR-006**: Lock confirmation while submitting; do not replay submitted tickets from the result dialog. Refresh board after completion without losing outcomes on refresh failure.
- **FR-007**: Provide keyboard/touch button equivalent, named dialog, labelled owner selector and live status. Preserve existing archive and Run Agent workflows.

### Key Entities

- Candidate: captured ticket identity/version/project/stage and eligibility reason.
- Confirmation: bounded candidate set, selected planner, submit lock, per-ticket results.
- Existing ticket/launch intent/history: remain authoritative, no schema changes.

## Success Criteria

- **SC-001**: Two selected tickets can enter Planning with one drop and one owner confirmation in both views.
- **SC-002**: Cancel and external/invalid drops produce zero writes or launches.
- **SC-003**: Every submitted/excluded candidate has exactly one visible final outcome; no duplicate launch from repeated confirmation.
- **SC-004**: Existing backend tests, browser tests and production build pass; new behavior has pre-implementation failing tests.

## Assumptions / Clarification Resolution

- This implements only Backlog to Planning, not arbitrary stage dragging or reordering.
- One planner is chosen for the batch, consistent with existing single-ticket confirmation.
- Per-ticket outcomes (not all-or-nothing atomic movement) match existing bulk operations and preserve independent guards.
- Existing design tokens and modal behavior are reused. No new drag library, model calls, schema or provider changes.
- Automated DOM/API verification uses synthetic data; no live tickets are moved or launched as QA.
