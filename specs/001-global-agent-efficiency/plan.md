# Implementation Plan: Shared agent efficiency
**Branch**: codex/global-agent-efficiency | **Date**: 2026-09-06 | **Status**: Locked
**Spec**: [spec.md](spec.md)

## Summary
Install RTK and Serena once, a small stdlib command-evidence wrapper, a bounded advisory helper, a reversible config installer, and concise global usage guidance. Keep the existing orchestration runners and project gates. Do not enable rewriting hooks that could bypass existing command safety checks.

## Technical Context
Python 3.9+ stdlib for command runner; Python 3.13 for installer TOML validation and Serena's isolated uv tool runtime. RTK Homebrew CLI. JSON/TOML/Markdown operational configs. Private timestamped logs and backups outside repos. macOS user-wide deployment; isolated tests portable to Linux. Existing agent configurations and credentials are preserved. No model default changes.

## Constitution Check
Existing .specify/memory/constitution.md is an unratified placeholder, not an additional governance requirement. Apply concrete existing repo contracts: non-destructive install, honest checks, isolated work, preserved safety hooks, optional Gemini review, no secret commits. No replacement platform or app dependency introduced. T002 pre-execution guard detail: the runner invokes the unchanged shared guard on shlex-joined argv before executing, failing closed on missing/broken/denying guard. Serena external cache paths mirror the complete absolute project path under private state to avoid equal-basename collisions. The user's explicit deployment request authorizes all implementation phases and live setup.

## Project Structure and Ownership
- config/global-agent-tooling/agent-efficiency/agent_run.py and test_agent_run.py: isolated command runner worker.
- config/global-agent-tooling/agent-efficiency/agent_advice.py and test_agent_advice.py: bounded Ollama/ArkCLI synthetic/advisory helper, only after current CLI contract inspected.
- config/global-agent-tooling/agent-efficiency/install.py and test_install.py: root, config preflight/atomic writes/backups/manifest/rollback.
- config/global-agent-tooling/agent-efficiency/POLICY.md, SKILL.md, serena-context.yml, versions.json: root shared artifacts and minimal read-only navigation context.
- scripts/install_agent_efficiency.sh and scripts/check_agent_efficiency.sh: root setup and doctor; source package remains in canonical shared repo.
- templates/AGENTS.md.template, CLAUDE.md.template, GEMINI.md.template and install.sh: short future-project references only; preserve existing template behavior.
- docs/AGENT_EFFICIENCY.md, README.md, config/global-agent-tooling/README.md: operational documentation.
- .github/workflows/ci.yml and .gitignore: isolated Python tests and generated-file exclusions.
- specs/001-global-agent-efficiency/** and .specify/feature.json: contract and verification evidence.

## Installation Contract
Explicit current user's home parameter (AGENT_EFFICIENCY_HOME for tests); no system env repurposing. Preflight every targeted config before writes, refuse an unmanaged conflicting tool path/entry unless equal, preserve unrelated keys/comments where possible. Back up bytes/modes privately, atomically replace only changed files, manifest hashes enable safe rollback that refuses later edits. Append or update a small managed rules block, never replace user rules. Existing hooks and approvals untouched. User-wide Serena stdio entries for Claude/Codex/Gemini/Antigravity; no hard-coded project. Minimal read-only navigation tools and explicit absolute worktree activation. Launchers use resolved absolute installed paths. The additional agent-serena CLI shares private state with the MCP launcher and initializes explicit languages before first activation, because upstream noninteractive inference selects only one language. Current/future projects inherit global policy; templates point to it. Ollama and ArkCLI use bounded model advice; no generated tool calls executed. Existing graphify/aider stay intact.

## Verification
Failing tests before each implementation slice; unit tests for runner fidelity and installer preservation/idempotence/rollback. Fake provider tests before harmless live smoke. MCP handshake plus symbol and reference lookup in Python/TS isolated fixtures (including changed file and two project roots). RTK raw vs filtered output with status equality; wrapper raw retention vs bounded display. Global config validation and source-vs-installed hashes; repeat install no changes; existing/fresh directory calls. Full repository CI smoke + guardrail regression suite, diff/secret review, commit/push/PR, deployment evidence. Active GUI sessions may require reconnection to load new MCP servers; report that accurately.
