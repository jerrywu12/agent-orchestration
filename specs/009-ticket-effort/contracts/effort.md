# Effort Contract

POST /api/tickets accepts effort enum or null. PATCH /api/tickets/:id accepts effort with required current version. GET ticket and state return effort null for legacy absence. Invalid values return 422 VALIDATION; stale versions return 409 VERSION_CONFLICT; existing credentials and scoped agent permissions remain unchanged. desk_update_task changes.effort and desk_create_subtask effort accept the same nullable enum under their existing execution/session/version/reason conditions. Effort remains outside GitHub label/snapshot fields.
