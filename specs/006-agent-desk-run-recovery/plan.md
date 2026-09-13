# Implementation plan

Locked. Base5a856ff0aff0a74855ddb26fa83a7e262f247329, worktree /private/tmp/agent-desk-runner-reporting. Local route because reproduction depends on live executions, sandbox, native session metadata and deployment.

1. Record diagnostic evidence and failing runner regression.
2. Parallel bounded writers: bridge owns new managed-bridge/client and tests; trace owns new session-trace and tests; UI owns WorkView/TicketDetails/tracking component/bulk types/scoped CSS and browser fixtures. Root owns runner, API, queue/recovery, service behavior, shared execution types, spec and integration.
3. Serialize shared contracts: bridge createManagedBridge({service,execution,worktree,sendEvent}) -> directory/flush/close; env AGENT_DESK_BRIDGE_DIR; operations get_task/get_resolution_context/update_task/create_subtask/report_progress with server-bound identity. Trace traceExecution(execution,{children}) and captureProcessIdentity(pid) capture metadata only.
4. Runner capture native thread, retain terminal reports, add idempotent persistent batch queue and guarded administrator takeover. UI consumes API contracts documented in frontend handoff and executable HTTP tests. Default batch concurrency2 unless user specifies otherwise.
5. Scripted tests, build, independent review, PR/CI, merge then backed-up deployment. Verify runtime SHA and exact original tickets via API; repair stale metadata with audited actions. Never start real work merely for QA; use synthetic provider smoke for transport.

## Recovery contract
GET /api/tickets/:id/execution-status returns trace+lease+history. POST takeover requires executionId,sessionId,expectedHeartbeatAt,confirmed:true,reason. Recheck trace and compare after asynchronous probes in transaction. Release as revoked with reason and retain original handles, mark held sessions revoked; no fake checkpoint assertion. Start separately with fresh claim/worktree and recovery context to avoid regenerating preserved code.
POST /api/runs accepts ticketIds,concurrency,requestId; GET /api/runs/:id returns durable per-ticket results. POST /api/tickets/bulk-archive returns per-ticket results. All administrator-only. Global active managed count bounds batch dispatch. Service restart marks outstanding batch rows interrupted/failed; no replay. Native calls/fixtures never expose prompts or tokens.

## Explicit integration revision

Independent review requires managed completion validation in Service.event so legacy HTTP/MCP and the mailbox share the invariant; retain original event payload for replay and use the effective checkpoint type for state/activity. A launcher exec command change with unchanged process birth remains protected. Persist bulk request identity before POST so lost responses survive reload. Invalid/missing heartbeat evidence counts as unknown/stale, never fresh. Takeover returns a fresh full execution-status snapshot. No authority or scope expansion.
