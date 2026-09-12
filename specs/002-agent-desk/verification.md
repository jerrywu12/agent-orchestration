# Agent Desk verification

## Scope and acceptance

Built the Plane-inspired self-hosted app under tools/agent-desk and the shared integration
in agent-orchestrator. The Smart-Stock-Picker product checkout and its unrelated changes are
not the source of this app. Source base: 221345c51a545075b066b2f0106310070b376efa.

- List/board, custom stages, priorities, labels, dependencies, comments, agent assignment and
  persisted editing: covered by core tests and the exact browser journey.
- Atomic ownership, stale claims, explicit Start, isolated worktrees, literal argv, scoped
  credentials, lifecycle progress and exact-session reconciliation: real SQLite/fake-runner tests.
- GitHub Issues/Projects v2: injected paginated API tests, durable publish/sync intent,
  three-way conflict resolution, preserved labels and explicit stage mapping.
- Migration: read-only SQLite snapshots, private backup/ID mappings, tasks plus backlog,
  attachment references, retained multiple/missing session handles, repeat-import idempotence.
- Deployment: reversible file/hash backups, preserved JSON/TOML/YAML settings and symlinks,
  private CLI/MCP connectors, loopback LaunchAgent, container configuration and backup command.

## Verification performed

- Existing shared tooling: 43 efficiency tests and 13 guardrail tests passed.
- Source shell syntax and fresh template installation/doctor passed (no FAIL lines).
- App suite:107 passed on Node22.22.0, plus the final malformed-heartbeat regression
  and its13-test core lane passed after correction. CI then passed all108 cases.
- App production build passed on Node 22.22.0; browser suite: 11 passed.
- Browser checks cover ticket creation/edit/comment/reload, stage customization, filters/board,
  320/390/768px layouts and keyboard focus, offline recovery, concurrent drafts and external
  reconciliation. Isolated QA runtime path and /api/health were verified; console clean.
- Migration rehearsal: 1 project, 6 stages, 39 tasks + 10 backlog items, 14 source sessions,
  6 attachment references; 49 target tickets, 10 protected claims, no duplicate issue links.
- Docker configuration supplied; local Docker daemon unavailable, so no container runtime proof.

## Review-driven regression evidence

Independent review found and reproduced administrator environment inheritance, poisoned
reporting queues, external-claim recovery classification, dropped missing session references,
initial GitHub retry loss, shared-session sequence races and repository-retarget races.
Each has a failing pre-fix fixture and a focused passing proof after correction. Additional
browser regressions reproduced bodyless POST415, mobile overflow and hidden-navigation focus.
Tests assert the affected boundary, including literal child credentials/argv, retained claims,
real loopback API responses, temporary source bytes and injected remote request counts.
No production agent/provider was launched for automated tests. Hermes quota and DeerFlow
bridge availability prevented external advisory results; the independent task reviewer owns
review evidence. An external Claude source review was rejected by automatic approval review,
so that source transfer did not occur.

## Live cutover

Completed on 2026-09-13 Asia/Shanghai. Installed runtime is served from
`~/.local/share/agent-desk/app` at http://127.0.0.1:4310 by LaunchAgent
`local.agent.agent-desk`. Health verified initial release862d4a0f1838f548e6108cfc5fe45261582a6489
with ready storage and the installed path, followed by the final reviewed UI label update.
The runtime build-info and private installer manifest identify the exact installed revision.

- Imported49 source work items,6 stages,14 sessions and6 attachment references. Preserved10
  unresolved claims. Observer reported1 running and9 suspended source sessions at verification.
  Counts explicitly describe reserved sessions; suspended claims are not presented as running agents.
- Retired only the verified legacy synchronization watcher and replaced its two Python writers
  plus project MCP wiring. Native Kangentic/agent processes and original databases were preserved.
- Installed/scoped MCP handshake and task-read checks passed for Codex, Claude, Gemini,
  Antigravity, Cursor and Hermes (four tools each); per-agent results contained only assigned work.
  Native clients already open still need reconnect; no active client was forcibly restarted.
- GitHub authenticated as the existing account. Smart-Stock-Picker Project1 read successfully;
  five stages mapped to existing Status options, with Parked deliberately retaining its local hold.
  First pull imported8 additional issue records; existing source links did not duplicate.
- Published the actual delivery ticket as agent-orchestration issue13, edited its title locally
  and verified the GitHub title changed, then appended verified evidence on GitHub and proved
  its return to Agent Desk. Both project sync states returned idle/error-null/pending0.
- Real CLI-wrapped verification reported progress seq1 with exact execution/session and PR12,
  then wrapper completion seq2 became awaiting_review and released only that execution. Delivery
  remained unclaimed pending the reviewed merge; the10 imported reservations remained intact.
- Updated the P077 automation to stable Agent Desk CLI/MCP references, retaining PAUSED status,
  its schedule, target task and provider/ownership constraints.
- Consistent live backup and restore passed integrity_check=ok with58 tickets. Source, private
  import/installer/cutover backups and attachment bytes remain outside Git.
- PR12: independent review APPROVE; all three CI jobs passed, including108 app tests and browser.

Private recovery evidence is under `~/.local/state/agent-desk/installations/`, `migrations/`,
`cutovers/20260912T165114Z/manifest.json`, and `backups/20260912T1700-post-cutover.db`.
Do not commit these artifacts. Source change and global cutover are separately verified.

Fresh work starts through Agent Desk or an explicitly ticket-linked CLI/MCP client. Older
project-specific SSP queue scripts are not auto-associated by title: they can be launched through
agent-desk wrap with an exact ticket, and their native clients report through the installed MCP.
No heuristic claim adoption or provider task dispatch was introduced.
