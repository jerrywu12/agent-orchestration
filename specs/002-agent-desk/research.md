# Research and decisions
- Plane reference: https://plane.so/ and https://developers.plane.so/self-hosting/overview.
  Adopt compact work views, custom stages and self-hosted persistence; independent implementation.
- Source evidence: docs/KANGENTIC_BOARD_POLICY.md:185 documents per-session endpoint limits;
  scripts/agent_workflow.sh implements only Codex/Gemini queue adapters. Stable connector needed.
- Current app: one registered project, tasks/swimlanes/sessions in project SQLite database.
  Import using read-only consistent backup, never reconstruct per-session credentials.
- Existing local .kangentic sync scripts mutate old DBs; cutover must retire those writers.
- Node built-in node:sqlite verified on local v22.23.1. Avoid native addon rebuild dependencies.
- GitHub REST: https://docs.github.com/en/rest/issues/issues requires filtering pull_request and
  pagination. Projects v2 uses GraphQL with explicit single-select option mapping.
- Hermes advisory attempted: provider HTTP 429 weekly quota; no fallback credential change.
- DeerFlow refreshed ff-only to ce635b7d, uv sync frozen and SQLite backup/restart; gateway healthy,
  advisory generation unavailable: ReadBeforeWriteConfig missing elide_blocked_payloads.
  Local code/tests and independent review remain authority; neither adviser yielded valid review.
