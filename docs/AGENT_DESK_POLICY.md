# Agent Desk Coordination Policy

Updated: 2026-09-13. This is the canonical policy for Claude Code, Codex / Codex
Cloud, Gemini CLI, Antigravity, Cursor, Hermes, Ollama and ArkCLI. Agent Desk
replaces Kangentic. Project acceptance criteria, safety rules and
[Spec Kit](SPEC_KIT_POLICY.md) remain authoritative for the work itself.

## Work items and evidence

A backlog item, feature with `specs/<nnn>-<slug>/`, or implementer dispatch has one
canonical ticket. Several delivery PRs may belong to it; independently planned
child tickets are separate work items. Do not create tickets for disposable
conversation/read-only exploration or turn duplicate imports into executable work.

Update the ticket at **start, state change, delivery, and stop without delivery**.
Report verified state, exact executor, branch/worktree, PR URL, SHA, checks actually
run and what remains. Name blockers and their owners. A stopped, quota-limited or
abandoned lane must leave an update. A stale heartbeat proves neither progress nor
safe takeover. Keep unknown reset times and unverified checks unknown.

Process exit, reported percent, acceptance, review, merge and deployment are
separate evidence. Queue/runner success only means the process finished. A draft
PR or green unmerged branch is still in review. Report GitHub synchronization
failures/conflicts instead of claiming both systems agree.

## Stages and planning

Projects may rename, add and order stages. Use configured IDs and semantic roles
rather than hard-coded display names. Imported names are retained.

| Role | Typical name | Meaning |
| --- | --- | --- |
| `backlog` | Backlog / To Do | Captured work; execution held until moved into a ready stage. |
| `planning` | Planning | Requirements traced to code; specification and executable acceptance tests being written. |
| `active` | In progress / Executing | Verified executor or active child work owns the remaining scope. |
| `review` | In review / PR / Code Review | Reviewable result exists; include its PR/artifact and verification evidence. |
| `done` | Done | Acceptance and delivery verified; code changes require merge evidence. |
| `parked` | Parked | Deliberately held work; no automatic launch. |

Planning uses specify → clarify → plan → tasks: cite current `file:line` evidence,
define executable acceptance tests and split independently verifiable children.
Codex is the default planner. Fall back only on unavailability/quota through
Claude → Ollama/ArkCLI advice through a coordinator → Antigravity → Gemini.
Record the actual planner and preserve explicit user assignments.

**Review is independent of the planner and implementer.** If fallback would give
one agent both roles, move review to another agent. If no independent reviewer is
available, record the gap and leave the result for Jerry. Self-review is not
independent review.

A parent stays open until all children are done. After planning it may use an
active stage as a container without its own executor or branch; delivery evidence
is its children's verified results. It need not pass through PR review itself.
Backward moves require reasons: review defects return to execution; changed
requirements return to planning and explicit specification revision.

**Blocked is a flag, not a stage.** Preserve stage and set a named `blockedReason`.
Preserve existing `blocked:*` evidence, especially `blocked:duplicate-reference`.
Clear a blocker only when its cause is resolved. Parked work, temporary blockers
and stopped executors are distinct states.

## Ownership, claims and handoffs

1. Read the exact ticket, dependencies and task packet. `ownerId` is the assigned
   Agent Desk identity. Preserve imported `owner:<agent>` labels and reconcile
   contradictions before work. Unknown/ambiguous ownership stays unassigned with
   a blocker; do not guess from title, model or last writer. Unassigned tickets
   can capture requirements and receive triage, but cannot launch an executor.
2. Record accountable owner, planner, implementer, reviewer, bounded delegation,
   allowed paths and required approvals. Provider advice is not a repository
   execution lane. In SSP, preserve P077's Codex accountability/delegation,
   P024's division and Claude's reserved P072 scope until a proper handoff.
3. Identify the exact native session/thread, branch/worktree and scope. Inspect
   existing execution records and worktrees. Two sessions of one AI are different
   executors. Respect dependency, parked and blocked holds.
4. Acquire the transactional claim via stable API/CLI/MCP before execution.
   Labels and queue files are metadata, not locks. All cooperating dispatch
   paths must claim; wrappers are not a security boundary against unrelated
   processes that ignore this policy.
5. The old executor checkpoints saved work and relinquishes its exact scope before
   another starts. Never steal a claim because a heartbeat or quota reset is old.
   Reassignment does not stop a native process.
6. Imported running/suspended sessions remain externally owned. Checkpoint or stop
   them in their original client, then reconcile each exact handle with evidence.
   An aggregate claim remains reserved until every held session is reconciled.
   Do not use a new wrapper to resume an existing executor.

Assignment does not launch work. Explicit Start is the default; stage `autoStart`
is separately configured and must pass the same ownership/readiness checks.
Do not enable it during migration or metadata cleanup. Labels never bypass holds.

## Stable connections and outside agents

Use `agent-desk health` and `agent-desk state`, or configured `agent-desk` MCP tools.
Clients use `AGENT_DESK_URL`, default `http://127.0.0.1:4310`. Remote connections
require HTTPS and configured credentials. Access does not depend on being launched
by a desktop app. Use the configured connection; never reconstruct another
process's endpoint, copy its token or write application databases directly.

MCP provides `desk_list_tasks`, `desk_get_task`, `desk_claim_task` and
`desk_report_progress`. Supply exact execution/session, increasing sequence and
unique event ID; retries reuse the event identity. `complete` means awaiting review.
`checkpoint`, `failed` and `stopped` describe execution, not delivery.

For a newly assigned external runner:

```bash
agent-desk wrap --ticket TICKET_ID --agent codex -- ./scripts/codex_auto_dev.sh SPEC_PATH
./scripts/agent_workflow.sh handoff submit SPEC_PATH --agent codex --mode local-worktree --ticket TICKET_ID
```

`--ticket` persists explicit linkage; submission does not claim or verify ownership.
The Codex source hook also accepts `AGENT_DESK_TICKET_ID` and wraps before worktree
creation. Gemini queue execution wraps with `--agent gemini` for an explicit ticket.
Exact inherited wrapper context is reused; other/unlinked queue jobs do not inherit
its claim. Do not set `AGENT_DESK_WRAPPED` manually to bypass claim acquisition.

Linked jobs refuse execution before worktree/production edits if the connector or
claim is unavailable. Unlinked jobs retain legacy behavior with an **unlinked**
notice: no ticket is inferred from a spec filename and no board progress is claimed.
Link coordination work explicitly before dispatch. Report real service/reporting
outages with the undelivered update and retained claim; do not launch replacements.
Verify installation, health and native connectors separately from source changes.

The generic queue still executes only Codex/Gemini. Its unsupported-provider and
placeholder behavior is unchanged. `cloud-ready` neither submits Cloud work nor
gets filtered by its local consumer. Queue completion cannot establish agent
execution or delivery. Use the separate Cloud workflow. Ollama/ArkCLI remain
bounded advisers; other agents use only configured, verified capabilities.

## GitHub synchronization and migration

Keep stable links to canonical issues/Project items. Preserve unrelated labels and
content; agent names are not GitHub logins. Verify stage mappings and sync results.
A closed issue is not merge evidence. Publishing an issue is explicit; import alone
does not create one.

Migration uses consistent read-only SQLite backups and stable source-ID mappings.
Keep original stores, attachment references, routing metadata and rollback manifests
private. Exclude prompts, commands, transcripts and credentials from normal imported
records. Re-import preserves local edits/claims. Reconcile counts, unknown owners,
duplicate references and unsupported fields before reporting success.

Retire legacy writers only at authorized, verified cutover. Revalidate PID, script
and working directory; checkpoint and stop only that writer, not its IDE/agent
parent. Do not restart, migrate or kill existing sessions to install instructions.
Update future sessions/connectors separately, read back configuration and retain
rollback evidence. Source PRs do not update global settings or downstream scripts.
