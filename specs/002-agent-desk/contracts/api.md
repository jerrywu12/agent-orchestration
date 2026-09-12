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
