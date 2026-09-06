# Feature Specification: Shared agent efficiency

**Feature Branch**: `codex/global-agent-efficiency`
**Created**: 2026-09-06
**Status**: Locked for implementation; user authorized global deployment.
**Input**: Deploy token-efficiency suggestions for all current/future projects and Claude, Codex, Antigravity/Gemini, Ollama, ArkCLI.

## User Scenarios & Testing
### US1 — Compact reliable command evidence (P1)
An agent runs the project-owned check and receives a bounded result with a complete private log and the exact exit status.
Acceptance: successful, failing, Unicode, long-line and concurrent runs retain full output; a failing command remains failed; arguments and working directory are unchanged. Long output has an explicit omission marker and log path. No command is executed twice.
### US2 — Consistent tools across projects (P1)
Existing and future project sessions discover the same compact policy and navigation tool without changing project-specific instructions or credentials.
Acceptance: installations preserve unrelated JSON/TOML/rules and hooks, back up changes, are idempotent, and can restore only owned unchanged writes. Each named coding client receives a compatible global entry; a fresh project can use the wrapper without repo bootstrap. Provider-only CLIs are distinguished from tool-capable clients.
### US3 — Bounded collaboration (P2)
The lead agent delegates one bounded task and receives a short result without copying the whole conversation or repeating discovery.
Acceptance: shared policy covers Claude planning, Codex execution, Gemini/Antigravity reviews when requested, and local Ollama/ArkCLI bounded advice using existing identities. Provider failures are explicit; no automatic provider/model fallback or credentials migration. Model helpers never apply advice or execute model-generated commands.
### US4 — Accurate adoption evidence (P2)
The user can inspect installed versions/configuration and measured output reductions.
Acceptance: evidence includes real command status, before/after byte sizes labeled as output-size measurements, Python/TypeScript navigation on isolated fixtures, repeat installation, current/future-project smoke, and limitations. No bill-saving percentage is invented.

## Requirements
- FR-001: One user-wide installation usable from any project, including future projects.
- FR-002: Existing safety hooks, permissions, credentials, provider defaults and project rules remain effective.
- FR-003: Full command diagnostics are retained privately outside repositories; summaries are bounded and never claim pass on failure.
- FR-004: Symbol retrieval is available with project/worktree identity explicitly activated; no shared mutable project singleton across agents.
- FR-005: Integration and verification cover Claude, Codex, Gemini, Antigravity, Ollama and ArkCLI; distinguish configured from observed working.
- FR-006: Central short guidance avoids duplicating large runbooks and delegates narrow briefs; one owner per writable worktree.
- FR-007: Installation is backed up, idempotent, validated before writes, and safely reversible without clobbering later user edits.
- FR-008: Ship tested source, docs and reproducible deployment procedure through a PR.

## Success Criteria
- SC-001: Every named client/provider has a documented, verified integration path or an explicit external blocker.
- SC-002: All synthetic exit-code, argument, output retention, config preservation and repeat-install checks pass.
- SC-003: A verbose controlled command produces a shorter displayed result with complete raw evidence retained.
- SC-004: Existing and newly created project directories both use the installed tools without adding project dependencies.

## Assumptions and Boundaries
The user authorizes implementation, installs, user-level config updates and deployment. Existing project gates still apply. No running trading app is restarted. No model credentials/profiles are changed. No replacement coding platform, gateway, model downloads or automated all-agent fan-out is required. RTK and Serena are developer tooling, not app dependencies. Existing Aider/Graphify stay available; adoption focuses on one navigation layer. Model-provider smoke uses only a harmless synthetic prompt, never repository or customer data.
