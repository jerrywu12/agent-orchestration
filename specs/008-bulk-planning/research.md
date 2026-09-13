# Research

- Decision: reuse single-ticket transition sequentially. `server/service.mjs:448` checks confirmation/version/agent/claim/archive/project; updateTicket enforces project-stage ownership, dispatchIntent reports started/queued/failed. A batch backend duplicates this contract.
- Decision: local drag state, not transferred IDs. WorkView bounds visible selection100 and groups across projects. Resolve each candidate's own Planning stage. Arbitrary-stage DnD is out of scope.
- Decision: separate batch dialog from `StageTransition.tsx:31` avoids changes to Ready readiness and details. Reuse Modal/API/agent shapes/CSS.
- Decision: no automatic retry; existing API20s timeout can occur after admission. Unclear response needs inspection, not replay.
- Advisory: previous same-session DeerFlow call failed at bridge config; Hermes quota unavailable until next reset. Independent test/review lanes used; neither unavailable advisory is claimed as evidence.
- No unresolved product/technical clarifications: one planner, per-ticket outcomes, no move before confirmation.
