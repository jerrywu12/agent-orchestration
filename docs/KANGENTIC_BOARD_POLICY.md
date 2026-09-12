# Kangentic Board Policy — Retired

The canonical replacement is [Agent Desk Coordination Policy](AGENT_DESK_POLICY.md).
Use its stable CLI/API/MCP connection, ownership checks, stage semantics, evidence
requirements and handoff protocol. Earlier guidance that outside sessions cannot
report to a board no longer defines the replacement workflow.

This redirect preserves old documentation links. It does not authorize a live
cutover, restart, new executor or deletion of original Kangentic state. Source
changes and migration tests are separate from verified deployment.

Preserve owners, task/session references, branches, parked work and dependencies.
Keep the original SQLite stores and consistent private backups. Never patch
Kangentic databases or reconstruct another session's endpoint or credentials.
Imported running/suspended sessions remain external until their native clients
checkpoint and the exact handles are reconciled. Disable only verified legacy
writers at cutover, with identity checks and rollback evidence; do not kill their
IDE or agent parents.

See the replacement policy's migration section and
[Agent Desk implementation contract](../specs/002-agent-desk/spec.md) for required
reconciliation and acceptance evidence.
