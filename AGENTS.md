# Agent Orchestrator — repository instructions

This is the shared agent-orchestration project at `/Users/jerry/agent-orchestrator`, remote `jerrywu12/agent-orchestration`. Work on its tools, installers, templates and documentation here. Downstream application task packets and source-path lanes apply when working in those applications, not automatically to this repository.

## Read only the relevant context

Start with `README.md` and `docs/PROJECT_DEVELOPMENT.md`. For shared efficiency work, read `config/global-agent-tooling/agent-efficiency/POLICY.md` and the relevant contract in `specs/`. Use `docs/SPEC_KIT_POLICY.md` for new features or substantial changes. Inspect actual scripts before claiming a queue target, Cloud handoff or check is implemented.

## Ownership and coordination

- One lead owns each task, verification and integration. Delegate independent bounded work with an exact root/SHA, allowed paths, acceptance checks and concise return format.
- Claude normally plans and diagnoses; Codex implements and verifies; Gemini/Antigravity provide requested review or explicitly assigned work. Ollama and ArkCLI provide bounded advice through `agent-advice`; responses do not execute tools.
- The local queue currently executes only Codex/Gemini adapters. Do not submit unsupported providers or treat a scaffold/queue status as implementation evidence. Cloud routing uses the separately configured Cloud workflow.
- Preserve existing guards, project instructions, provider defaults and credentials. Follow the user's current authorization; do not create an extra approval gate for routine reversible work.

## Changes and verification

Use a fresh `codex/` branch/worktree based on current remote main. Preserve unrelated edits; never reset, clean, force-switch or silently stash. Keep source changes in `config/`, `scripts/`, `templates/`, `tools/`, `specs/` or repository documentation as appropriate to the task. Do not install this repository's application templates into its own root.

Run the relevant source tests and installer smoke described in `docs/PROJECT_DEVELOPMENT.md`; `.github/workflows/ci.yml` is the executable CI contract. Generic template commands are not a passing gate. For behavior changes, reproduce the relevant failure before fixing it and prove the changed boundary afterward. Documentation-only changes need link/content checks and a template-install smoke when templates changed, not new tests that merely repeat their text.

Use `agent-run` for noisy checks with complete private evidence, RTK for compact discovery, and the raw diff for final review. Commit, push and create a PR with scope, acceptance coverage and actual checks. Merge only after required checks and review pass; fast-forward the clean canonical checkout afterward.

## Machine-local operations

Global deployment is a separate explicit step from a source edit. Preview configuration changes, preserve unrelated settings, and retain rollback evidence. Read `docs/AGENT_HOME_STATUS.md` before moving state; never commit `local/agent-home/`, credentials, provider responses containing private data, logs or backups. Do not restart unrelated applications/services for documentation or tooling work.

ArkCLI's approved backup and startup verification are recorded in `specs/001-global-agent-efficiency/arkcli_migration_approval.md`. Check current authentication and preserve the existing identity/profile when using it; do not repeat a credential migration merely because the historical note describes one. Never send Slack or other external messages without the user's authorization.

## Board synchronisation

Follow [Agent Desk Coordination Policy](docs/AGENT_DESK_POLICY.md), the canonical
policy for stable CLI/API/MCP reporting across all agents. Preserve exact ticket
ownership, executor session, branch/worktree scope, dependency holds and checkpointed
handoffs. Assignment does not launch work; explicit claims and verified readiness
precede execution. Projects use Backlog, Ready, In progress, In review and Done; blocked remains a flag.
Explicit Start can launch scoped blocker resolution while preserving other claims. Update start, state changes, delivery and stop without
delivery with evidence. Process completion is not merge or delivery; independent
review remains required. Imported active/suspended sessions stay externally owned
until reconciled. A source update is separate from verified global cutover.
