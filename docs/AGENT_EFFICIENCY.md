# Shared agent efficiency

The setup applies to existing and future projects through user-level agent configuration. It keeps project gates, current safety hooks and existing model credentials. This is a small tooling layer over the existing agents and orchestration runners.

| Surface | Integration |
| --- | --- |
| Claude Code | User MCP entry in `~/.claude.json`, short global CLAUDE.md notice and skill |
| Codex CLI/App | User MCP entry in `~/.codex/config.toml`, global AGENTS.md notice and shared skill |
| Gemini CLI | MCP entry in `~/.gemini/settings.json`, global GEMINI.md notice and skill |
| Antigravity | MCP entry in current `~/.gemini/config/mcp_config.json`, global rules and skill |
| Ollama | `agent-advice --provider ollama --model <installed-model> --prompt-file <brief>`; local inference only |
| ArkCLI | `agent-advice --provider arkcli --prompt-file <brief>`; existing profile, attribution and generation budget |

Ollama and ArkCLI are model providers. The advice helper does not execute generated tools or edit files. Tool-capable host agents use RTK, `agent-run`, and Serena. Automatic fan-out to all providers is deliberately absent; it would multiply tokens and duplicate work. Global integration is loaded by new sessions. Existing desktop tasks may require an MCP reconnect or a new task; installing files does not prove an already-open task loaded them.

## Install

Prerequisites verified for this rollout: RTK 0.45.0, Serena 1.7.0 and Python 3.13. Package versions are recorded in `config/global-agent-tooling/agent-efficiency/versions.json`. Homebrew's current version can change; record and verify the version actually installed.

```bash
brew install rtk
uv tool install --python 3.13 serena-agent==1.7.0
~/agent-orchestrator/scripts/install_agent_efficiency.sh
~/agent-orchestrator/scripts/install_agent_efficiency.sh --apply
~/agent-orchestrator/scripts/check_agent_efficiency.sh
```

Preview is read-only. Installation preflights JSON/TOML, preserves unrelated keys and rules, copies tools to `~/.local/share/agent-efficiency`, and installs absolute-path launchers under `~/.local/bin`. It records private backups and hashes; a second identical installation changes nothing. Shared named-skill copies are small and independently discoverable. Existing Aider/Graphify configuration is untouched. No coding frontend, gateway, model or API credential is installed by this script.

## Daily use

```bash
agent-run -- ./scripts/dev_check.sh fast
agent-run -- ./.venv/bin/python -m pytest tests/
rtk git status
rtk git log -n 5
```

`agent-run` executes the original argv once in the original working directory and checks it with the existing shared safety validator. It captures combined diagnostics privately, shows bounded output and the full-log path, and returns the real exit code. Failure summaries are only an entry point: inspect the full log for causal evidence. Do not use wrappers to evade native approval rules. No command-rewriting or auto-approval hook is added. Use original commands for interactive sessions, machine-readable pipelines and full diff review.

Serena exposes only project activation, current configuration, file outlines, symbol lookup and referencing symbols. Before first activation, initialize the languages needed: `agent-serena project create /absolute/root --language python --language typescript` for a mixed Python/JS/TS repo. Repeat the flag for relevant languages; preserve an existing project configuration. Serena noninteractive detection selects only its dominant language. Activate the exact absolute worktree first. Each client starts a separate stdio server. Its private cache path includes the complete project root to distinguish worktrees and projects with the same folder name; there is no shared active-project daemon. It has no editing, shell execution, onboarding or memory-writing tools. Existing project Serena configuration remains authoritative if present.

Keep briefs narrow: objective, root/SHA, owned paths, relevant observations, acceptance command, and short return format. Claude handles planning/diagnosis; Codex owns implementation and verification; Gemini/Antigravity provide targeted review when requested. Local Ollama and remote ArkCLI provide bounded advice, not an additional approval gate. Required project advisers still apply.

## Measurement and validation

Compare the same representative backend/UI tasks and model using total input/output usage, cached input separately, retries, elapsed time and acceptance results. RTK and wrapper byte reductions measure command output only; they do not establish a subscription or API bill reduction. `agent-run` keeps per-run output sizes and raw evidence outside repos. Model helpers return provider usage when available; missing usage is not zero.

Run the isolated suite with Python 3.13:

```bash
python3 -m unittest discover -s config/global-agent-tooling/agent-efficiency -p 'test_*.py'
python3 -m unittest discover -s config/global-agent-tooling/agent-guardrails -p 'test_*.py'
```

The rollout's actual MCP, config, provider and output-retention results live in `specs/001-global-agent-efficiency/verification.md`. `AGENT_EFFICIENCY_HOME` selects a disposable home for installer/doctor testing; it never repurposes HOME.

## Rollback

Use the manifest path printed by installation:

```bash
~/agent-orchestrator/scripts/install_agent_efficiency.sh --rollback <manifest-path>
```

Rollback validates every target first and refuses later edits. It restores previous bytes/modes and removes only newly created, unchanged managed files. Backups and runtime logs remain private for inspection. Reversing multiple installation generations is done newest first. RTK/Serena package removal is separate from configuration rollback.

## Recorded deployment status

On 2026-09-06, the user explicitly approved the ArkCLI private credential-state backup and startup compatibility check. The verified backup contains 21 files (869,484 bytes), with private directory/file permissions. Native help exited successfully and preserved the original state; the tested CLI paths did not create `~/.arkcli-bytecloud`, so no separate state move was forced. After the user renewed an expired SSO login, the installed adapter passed its synthetic live check with the existing default model `glm-5.3`: 70 prompt tokens, 3 completion tokens, 73 total. No model/profile switch was requested by the adapter.

See the [operation record](../specs/001-global-agent-efficiency/arkcli_migration_approval.md) for backup and verification details. The previous approval blocker is resolved. Credentials, raw authentication output and backup files are not tracked in this repository.

Gemini CLI was not on PATH at rollout; Gemini settings and the installed Antigravity integration are configured. Existing GUI tasks still need a new session or MCP reconnect. The [deployment verification record](../specs/001-global-agent-efficiency/verification.md) distinguishes tested behavior from configured integration.
