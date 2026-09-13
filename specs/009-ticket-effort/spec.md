# Feature Specification: Ticket Effort

**Branch**: `codex/agent-desk-effort`  
**Created**: 2026-09-14  
**Status**: Locked for implementation  
**Input**: “Effort is not just a label, but a new field.”

## User Scenarios & Testing

### User Story 1 - Estimate development effort (P1)
Users set a distinct Effort field when creating or editing a ticket, and may clear it.
Independent test: create each allowed estimate, edit and clear, then reload and restart; the saved value and unrelated metadata remain correct.
1. Effort offers Unset, XS, S, M, L and XL, with help explaining XS <2h, S 2–4h, M 1–2d, L 3–5d, XL >5d, including development, tests, verification and review.
2. Missing historical estimates display Unset. Labels do not create or overwrite estimates.
3. Invalid estimates are rejected; stale or unauthorized changes are refused by existing guards.

### User Story 2 - Compare the work backlog (P1)
Users see Effort on the list and board, filter by one estimate or Unset, and sort estimates from smallest to largest or largest to smallest within existing stage groups.
Independent test: create deliberately unordered estimates in one stage; verify list/card visibility, filters, both sort directions and Unset last.
1. Effort is a named list column and a separate board-card property.
2. Filtering combines with existing search, owner, priority, label and archived filters; clearing filters restores tickets.
3. Default order is preserved unless the user chooses effort sorting. Equal estimates preserve original order; Unset sorts last in both directions.

### Edge Cases
Existing labels such as effort:M remain labels. Active claims, stage history, dependencies, GitHub metadata and launch state remain intact. Agent updates remain restricted to their exact active session and assigned ticket. Estimates are local planning metadata and do not change GitHub labels.

### User Story 3 - Sort by work attributes (P1)
Scope revision authorized by the lead on 2026-09-14 from the user's related sorting request. Users can sort by Priority, Owner, Stage changed or Name, in either direction, and clear active sort. Priority follows semantic urgency; Owner uses displayed agent name; Stage changed uses the recorded stage transition time, never updatedAt; Name uses ticket title. Missing values remain last in both directions. Equal values retain original order. Sorting preserves existing stage groups, filtering and selections in project and All Work views.
Independent test: deliberately unordered attributes and missing values; verify both directions for each requested field and restore default order in list/board.

## Requirements
- FR-001: Store exactly one nullable Effort value per ticket: XS/S/M/L/XL or Unset.
- FR-002: Support create/edit/clear and persistence across reload and restart, without converting labels.
- FR-003: Show canonical help in editing controls, and distinct Effort in create/details/list/board.
- FR-004: Support effort filters and ordered sorting within stages, keeping Unset last.
- FR-005: Existing authorized ticket integrations can read and update estimates without weakening ownership, version, launch, dependency or authentication guards.
- FR-006: Preserve unrelated metadata and GitHub synchronization.
- FR-007: Sort Priority, Owner, Stage changed and Name ascending/descending with stable ties, missing last, and a visible clear-sort control.

## Key Entities
Ticket gains one optional development estimate independent of priority, labels and ownership.

## Assumptions and Scope
The fixed sizing scale is the lead's chosen estimation rubric. Time is total development effort including tests and review, not elapsed queue time. This feature adds the field; the lead separately audits and estimates live backlog tickets after release. No automatic label migration, database rewrite, dependencies, live board mutation or deployment in this implementation slice.

## Success Criteria
Every supported estimate survives save/reload/restart; all invalid values are refused. Users can set, clear, view, filter and sort estimates in both work views. All existing guarded workflows retain their behavior.
