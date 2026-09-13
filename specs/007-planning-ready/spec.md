# Feature Specification: Planning and confirmed Ready admission
**Branch**: codex/agent-desk-planning-ready
**Created**: 2026-09-13
**Status**: Approved user intent

## User Scenarios & Testing
### US1: Prepare requests (P1)
Move a request to Planning, select an agent, confirm and start specification/task preparation. Planning runs stay visible in Planning. The planner produces a comprehensive spec and independently verifiable child tickets. Children start in Planning pending individual admission. A parent tracks children without a duplicate implementation assignment.
Acceptance: six ordered stages; cancel has no stage/owner/start effect; planning-purpose packet explicitly requires spec, decomposition, dependencies, allowed scope, acceptance tests and verification. Migration preserves existing IDs and reservations without launching work.

### US2: Admit buildable work (P1)
Moving to Ready opens an owner-selection confirmation with readiness results. A leaf ticket needs a specification reference, acceptance criteria, scope, verification plan, allowed paths and shared-resource identifiers; blockers and unfinished dependencies prevent admission. Confirmation starts work or queues it visibly when the owner is busy. Actual development starts in In progress.
Acceptance: incomplete work cannot enter Ready through normal creation/update/scoped endpoints; plain assignment does not start work; stale confirmation fails without side effects; retries cannot create duplicate executions. Historical unprepared Ready work is retained but cannot start implementation.

### US3: Prevent conflicting development (P1)
Check Ready, In progress, unmerged In review and all outstanding development reservations in the same repository. Compare file/directory scope and shared behavior/API/schema identifiers; identify competing tickets. Recheck transactionally on confirmation and claim. Preserve reservations despite stage/content changes.
Acceptance: overlapping paths, shared keys across disjoint files, repository aliases, unknown legacy scope, concurrent admissions and claims are covered. Completed/archived work without claims no longer reserves scope. Active planning containers are not duplicate development reservations.

## Requirements
- FR1: Backlog → Planning → Ready → In progress → In review → Done.
- FR2: Planning/Ready confirmation selects owner and authorizes start/queue.
- FR3: Ready requires all six preparation fields, resolved dependencies/blockers and leaf scope.
- FR4: Every execution path validates preparation and conflicts, including queued/bulk/alternate connectors; migration and imports never implicitly launch.
- FR5: Exact session ownership survives migration, failed starts and restart; scope changes cannot shrink an active reservation.
- FR6: UI shows missing preparation, competing tickets, queue and failure reasons. Completion remains independent review, then verified delivery.
- FR7: Automated API/fake-runner/DOM tests use synthetic work, never real ticket dispatch or computer control.

## Key Entities
Preparation, readiness result, confirmed launch intent, execution purpose, reserved scope and parent/child links.

## Success Criteria
All incomplete/conflicting admissions fail without stage/owner/claim side effects. Two concurrent conflicting confirmations admit at most one. Both list and ticket details support stage selection and owner confirmation. Queued, planning, developing and failed states are distinguishable.

## Assumptions and edge cases
Shared resource identifiers are explicitly recorded; fuzzy semantic classification is outside this release. `none` explicitly declares no shared resource. Use conservative scope comparison. Stale versions, cancel, unavailable/disabled agent, missing repository, failed spawn, restart, imports, sync and existing claims retain evidence. Source merge and global deployment are separate.
