# Locked browser and integration contract
All JSON responses are direct objects (no data envelope). Errors: {error:{code,message}}.
GET /api/health => {status:'ok',root,sha,version,storage:'ready'}.
GET /api/state => {projects:Project[],stages:Stage[],agents:Agent[],tickets:Ticket[],
 activity:Activity[],sync:SyncStatus[],capabilities:{localMode:boolean},serverTime:string}.
Ticket.execution is null or current/latest Execution. Timestamps are ISO UTC strings.
GET /api/events => SSE invalidation events; polling GET state also supported.
POST /api/projects {name,key?,path?,repo?,githubProjectNumber?} => Project.
PATCH /api/projects/:id partial fields => Project.
POST /api/stages {projectId,name,color?,role?,position?} => Stage.
PATCH /api/stages/:id {name?,color?,position?,role?,autoStart?} => Stage.
DELETE /api/stages/:id => {ok:true}; reject stage containing tickets.
POST /api/tickets {projectId,title,description?,stageId?,ownerId?,priority?,labels?,parentId?,dependsOn?} => Ticket.
PATCH /api/tickets/:id {version REQUIRED,...editable fields} => Ticket; stale version HTTP 409.
POST /api/tickets/:id/start => Execution; explicit launch, 409 already claimed, 422 unavailable adapter.
POST /api/tickets/:id/stop => Execution; stop only server-owned local process, foreign claim rejects.
POST /api/tickets/:id/claim {agentId,sessionId,branch?,worktreePath?} => Execution.
POST /api/executions/:id/events {eventId,seq,type,summary,progress?,prUrl?,headSha?} => Execution.
Events require matching agentId/sessionId for trusted local callers or matching agent bearer identity;
types heartbeat/progress/checkpoint/complete/failed/stopped; terminal events release claim.
POST /api/tickets/:id/comments {summary} => Activity.
POST /api/tickets/:id/handoff {ownerId,summary} => Ticket; active claims must first be checkpointed/released.
POST /api/projects/:id/sync {direction?:'both'|'pull'} => SyncStatus; enqueue and return, poll state.
POST /api/tickets/:id/publish => Ticket; explicitly creates/links GitHub issue, never on import.
POST /api/tickets/:id/resolve {choice:'local'|'remote'} => Ticket; resolves saved GitHub conflict.
GET /api/integrations => {github:{available,login?,error?},agents:[{id,available,reason?}],migration:{...}}.
POST /api/login {token} => {ok:true}; HttpOnly SameSite Strict cookie. POST logout clears.
PATCH /api/agents/:id {enabled?,name?} => Agent. Adapter/executable configuration is server-side only.

# Defaults / UI
Default stages Backlog, Planning, In progress, In review, Done; project-specific IDs. Imported
stage names are retained. Owner null/unassigned is allowed to plan but prohibits launch.
Agent ids codex,claude,gemini,cursor,antigravity,hermes,ollama,arkcli.
Adapter/capability field distinguishes local execution from externally reported progress.
Priority strings urgent/high/medium/low/none. Activity newest first; stage order numeric.
SyncStatus {projectId,state:'idle'|'syncing'|'error'|'conflict',lastSyncAt,error?,pending:number}.
Use nullable/empty fields defensively for imported data. Label strings render as text, never HTML.

## Migration reconciliation amendment (2026-09-13)
POST /api/executions/:id/reconcile {sessionId,summary,stopped:true} is administrator-only.
It records the operator's checkpoint/stop evidence for one exact imported source session;
it never stops a native agent itself. An aggregate imported claim remains active until
its primary session and all heldSessions entries are explicitly reconciled. Terminal
agent events cannot bypass held-session reconciliation. UI requires explicit confirmation.

## Reviewed metadata-only scope release (2026-10-08)

POST /api/tickets/:id/release-scope (assigned-agent token or configured operator).
Body: agentId (credential-bound), executionId, sessionId, version, targetTicketId,
reason (<=2000), reviewerId (<=200; independent of implementing agent),
reviewEvidence (<=2000). Unknown fields are rejected.
Response: updated source ticket only. Its Planning stage, cleared future allowedPaths
and conflictKeys=none release the reservation, preserving prior scope in an appended
handoff receipt. Receiver and execution history are untouched.
Requires latest checkpointed released exact execution with no active/held session,
current assigned owner/version, leaf source in Backlog/Planning/Ready/In progress,
distinct unarchived same-project leaf receiver with an active owned implementation
execution and valid admitted scope snapshot. Do not run receiver readiness against
the source reservation; that would make release circular.
No resolution grant/claim or separate stage confirmation. Existing general resolution
and implementation/delivery gates remain unchanged. Invalid/stale/foreign/live requests
fail transactionally; prior historical scope and all unfinished acceptance stay durable.
