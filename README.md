# Agent Orchestrator

This project owns the shared development tooling and reusable orchestration workflow for **Claude Code, Codex, Gemini/Antigravity, Ollama and ArkCLI**. The canonical checkout on this Mac is `/Users/jerry/agent-orchestrator`. Application repositories consume its tools and templates; changes to the shared infrastructure belong here.

The setup has two parts: user-wide tools and guidance that apply to existing and future projects, and an optional project-local queue with isolated worktree runners. One lead agent owns each task, delegates bounded work, and verifies the result. Agents are selected as needed; every task does not invoke every provider.

## Agent roles and execution paths

| Agent or provider | Default role | Integration provided here |
| --- | --- | --- |
| Claude Code | Requirements, planning and diagnosis | Global guidance, Serena MCP and project handoff instructions; planning runs through Claude's host session |
| Codex / Codex Cloud | Implementation, tests, Git work and final verification | Global guidance and Serena MCP; local `codex_auto_dev.sh` runner; Cloud submission uses the separately configured Cloud workflow |
| Gemini / Antigravity | Targeted review or independent work when requested | Global guidance, skills and Serena MCP for both clients; `gemini_auto_review.sh` supports a configured Gemini CLI |
| Ollama | Bounded local development advice | `agent-advice --provider ollama --model <installed-model> --prompt-file <brief>` |
| ArkCLI | Bounded remote development advice | `agent-advice --provider arkcli --prompt-file <brief>`, using the existing profile |
| Cursor | Optional editing and inspection frontend | Existing project rules and shared UI-tooling configuration remain supported |

Ollama and ArkCLI advice does not execute generated tools or edit repositories. The local queue executes **Codex and Gemini only**. A Claude label appears in its help but has no execution adapter; Antigravity, Ollama and ArkCLI are not queue targets. `cloud-ready` is a submission label, not a Cloud launcher; the local consumer does not filter it. Keep Cloud jobs out of a running local watcher and use the separate Cloud workflow.

## Shared tools for all projects

- **RTK** reduces routine discovery output.
- **Serena** provides five navigation tools for outlines, symbols and references; activate the exact worktree and initialize its relevant languages first.
- **`agent-run`** caps displayed command output, retains a complete private log, preserves exit status, and checks the original command with the shared safety guard.
- **`agent-advice`** bounds Ollama/ArkCLI briefs and generated output, with no automatic provider fallback.
- **Shared policy and skills** define compact handoffs and agent ownership while preserving each project's rules and release gates.

Check the existing global deployment:

```bash
cd /Users/jerry/agent-orchestrator
./scripts/check_agent_efficiency.sh
./scripts/install_agent_efficiency.sh  # preview only
```

See [installation, usage and rollback](docs/AGENT_EFFICIENCY.md), [the tracked policy](config/global-agent-tooling/agent-efficiency/POLICY.md), and [deployment evidence](specs/001-global-agent-efficiency/verification.md). Apply an intentional configuration update with `./scripts/install_agent_efficiency.sh --apply` after reviewing the preview.

The recorded rollout has live Claude/Serena and Ollama checks. Existing GUI tasks need a reconnect or a new session to load MCP changes. Gemini CLI was not on PATH at rollout. ArkCLI's adapter is installed and fixture-tested; its live startup migration still requires the specific approval described in the [pending migration scope](specs/001-global-agent-efficiency/arkcli_migration_approval.md). A documentation update does not authorize that migration.

## Optional project-local workflow

Global efficiency tools need no per-project bootstrap. To add the queue, role files and verification wrappers to an application project:

```bash
/Users/jerry/agent-orchestrator/install.sh /absolute/path/to/project
```

The installer preserves existing differing files and writes proposals as `*.orchestration-new`. Review those proposals and configure the target project's `.agents/config.json` with its real source paths and fast/full test commands. The template test commands are placeholders and provide no acceptance evidence.

Run these commands **from the target project**, after its verification commands are configured:

```bash
./scripts/agent_workflow.sh doctor
./scripts/agent_workflow.sh handoff submit docs/specs/my-feature_DEV_PLAN.md --agent codex --mode local-worktree
./scripts/agent_workflow.sh handoff run-next
```

`doctor` checks file presence; inspect every `FAIL` line even if its exit code is zero. For recurring local queue consumption, use `handoff watch --interval 30`. The lead still owns acceptance review, integration and release decisions; queue completion alone is not proof of implementation or merge.

| Setting | Location | Behavior |
| --- | --- | --- |
| `codex_cmd` / `CODEX_CMD` | Project config / environment | Default `codex exec --full-auto --skip-git-repo-check`; the runner appends its worktree and prompt |
| `gemini_cmd` / `GEMINI_CMD` | Project config / environment | Empty by default; explicitly configure the CLI for a requested review |
| `AGENT_AUTO_PR` | Environment | Defaults to `0`; `1` enables push/PR creation when the runner's conditions pass; it does not merge |

Without an available/configured CLI, the corresponding runner leaves a scaffold or a `NEEDS-REVIEW` report. Do not interpret that as completed agent work. Slack notifications require a separately configured webhook and authorization to send messages.

## Repository layout

| Path | Responsibility |
| --- | --- |
| `AGENTS.md`, `CLAUDE.md`, `GEMINI.md` | Instructions for developing **this orchestration project** |
| `config/global-agent-tooling/` | Shared safety guard, efficiency package and client configuration sources |
| `scripts/` | Global installers/checkers and reusable project queue/worktree runners |
| `templates/` | Role files and coordination handbook installed into downstream projects |
| `tools/open-source-ui-tooling/` | Shared Playwright, Storybook and Chrome DevTools bundle |
| `specs/`, `.specify/` | Scoped feature contracts and Spec Kit artifacts |
| `docs/` | Operation, development, deployment and state-location guidance |
| `local/agent-home/` | Ignored machine-local agent/model state; never commit credentials, sessions or caches |

## Develop this project

Read [AGENTS.md](AGENTS.md) and [the repository development guide](docs/PROJECT_DEVELOPMENT.md). Use this repository's CI checks; the generic `dev_check.sh` and `verify_for_changes.sh` are downstream wrappers and need a project's real configuration. See [Spec Kit policy](docs/SPEC_KIT_POLICY.md) for new features and substantial changes.

Shared infrastructure references:

- [Global client tooling](config/global-agent-tooling/README.md)
- [UI tooling bundle](tools/open-source-ui-tooling/README.md)
- [Agent-home consolidation](docs/AGENT_HOME_CONSOLIDATION.md) and [recorded path status](docs/AGENT_HOME_STATUS.md)

DeerFlow's shared checkout is under `local/agent-home/deerflow/deer-flow`; the existing neutral wrappers are `agent-deerflow-gateway` and `agent-deerflow-mcp`. Check live service identity and current state before maintenance; changing this repository's documentation does not restart its services.
