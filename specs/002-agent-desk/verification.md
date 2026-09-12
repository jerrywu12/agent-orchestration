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
  and its13-test core lane passed after correction (108 total cases).
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

Pending final test/review checkpoint, deployment and GitHub verification. Original source data
and live native executors must remain intact. The transition contract is recorded separately.
