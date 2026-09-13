# UI/API contract

- Sources: list/board articles, draggable non-archived Backlog while no local bulk mutation/modal.
- Target: Planning section `aria-label="Planning tickets"`; native drag events, visible count/hint.
- Button: `Move to Planning`; same confirmation, disabled empty/archived/busy.
- Dialog: `Move tickets to Planning`; keys/titles/exclusions, `Planning agent`, `Cancel`, `Confirm and start planning`. Confirmation immediately dismisses the dialog and hands off to non-modal `Planning progress`, retaining individual results and projecting current execution telemetry. See `../planning-progress-fix.md` for the superseding lifecycle contract.
- `BulkPlanningTransition({tickets,state,integrations,boardError,onClose,onComplete})`; onComplete receives admitted IDs including launch-failed admissions, once; refresh failure separate. `boardError` is existing useDesk error passed through App/WorkView; no shared refresh-hook change.
- Existing POST `/api/tickets/:id/transition`: `{version,stageId,ownerId,confirmed:true}`; response `{ticket,outcome:"started"|"queued"|"failed",reason?}`. No PATCH bypass.
- 4xx refusal; transport/5xx/unreadable response uncertain. No retry in completed dialog; no erased earlier success.
