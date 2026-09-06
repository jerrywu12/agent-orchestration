# Deployment verification — 2026-09-06

Source: `codex/global-agent-efficiency`, based on remote main `86170d4`; contract checkpoint `9b057af`. Implementation commit `ae43ae1` is published in [PR #7](https://github.com/jerrywu12/agent-orchestration/pull/7); later closeout edits affect documentation only. Live tools are copied outside the checkout and verified against the installed SHA-256 registry, so they do not depend on a temporary worktree remaining available.

## Results

| Check | Result |
| --- | --- |
| Tooling regression suite | 43 tests passed: 17 command-runner, 15 provider-adapter, 11 installer tests; Python 3.13; 26.334 seconds |
| Existing command guardrails | 13 tests passed; 5.524 seconds |
| Shell syntax | 15 scripts passed `bash -n`; local ShellCheck unavailable, advisory CI stage retained |
| Future-project bootstrap | Fresh Git repository installation and doctor passed, 7 OK / 0 FAIL; `.env.local` ignored |
| Independent source review | Approved after fixes for mode-only rollback, concurrent destination drift, child umask, provider wall deadline and cancellation cleanup |
| Global installation | 24 configured targets plus ownership registry; all installed tool hashes and four MCP configurations passed doctor |
| Settings preservation | Parsed original JSON/TOML settings matched after removing only added Serena entry; all four previous rule-file contents preserved; no existing safety hook files targeted |
| Idempotence | Second live `--apply`: unchanged, 0 changed files |
| Current and future projects | Installed `agent-run` succeeded from Smart-Stock-Picker and a fresh temporary directory, preserving each working directory |
| Deployed Serena MCP | Two concurrent stdio sessions in different roots sharing basename `twin`; each exposed exactly 5 navigation tools; Python and TypeScript bodies, references and changed-file freshness all passed; no `.serena` metadata added to either repository |
| Deployed Ollama adapter | Existing local `deepseek-r1:8b-16k` answered synthetic READY prompt; 60 prompt tokens and 326 completion tokens, 512-token cap; no model downloaded |
| ArkCLI adapter | Fixture tests passed; user-approved backup/startup check completed; after renewed SSO login the installed adapter passed a live synthetic check using default `glm-5.3` (70 prompt / 3 completion tokens) |

## Output measurements

These measure displayed command bytes, not subscription quotas, API token savings or dollar savings.

- Installed runner: 118,013 raw diagnostic bytes reduced to 8,000 displayed bytes (93.22%). All 1,000 diagnostic lines plus final failure remained in the private log. Exit status remained 7, demonstrating that bounded display did not turn failure into success.
- RTK 0.45.0: `git log -20 9b057af6fae8131308192c25d877f1a9d3521405` produced 7,006 bytes; corresponding RTK command produced 2,424 bytes (65.40% reduction, including its no-hook notice). Both exited 0 and included the same 17 commits in order. No command-rewriting hook was installed.
- A controlled end-to-end model benchmark is still needed to quantify tokens or cost per accepted development task. The rollout does not claim a billing reduction.

## Live boundaries

- Claude Code and Codex binaries are available. Their global configuration is validated; already-open desktop tasks must reconnect MCP or start a new task to load it. A synthetic MCP client proves the installed server protocol, not GUI reconnection.
- Antigravity 2.3.1 is installed. Its current global MCP file is `~/.gemini/config/mcp_config.json`. Gemini CLI is not on PATH; its user-level settings and skills are ready for when that frontend is used. No new frontend or credentials were installed.
- The initial ArkCLI operation was stopped by automatic approval review because credential-state backup/migration needed specific authorization. The user subsequently approved it. A private verified backup of 21 files (869,484 bytes) was created and native help exited 0 with original state unchanged. Contrary to the earlier anticipated startup path, no `~/.arkcli-bytecloud` directory was created; no state move was forced. The existing profile's SSO refresh token had expired, and the user renewed sign-in. Authentication then passed and the installed adapter returned READY with the existing default `glm-5.3`: 70 prompt tokens, 3 completion tokens, 73 total, capped at 512 output tokens. See [the approved operation record](arkcli_migration_approval.md).
- Initial Serena smoke exposed two upstream requirements: initial global configuration needs `projects: []`, and noninteractive language detection chooses one dominant language. The installed launcher seeds the required key; documentation requires explicit repeated `--language` initialization for mixed-language projects. Both final deployed sessions passed.
- Existing project rules, release gates and advisory-agent requirements still apply. The global tools do not replace project verification or automatically fan every task out to every provider.

## Local evidence and recovery

Private machine-local evidence (not committed):

- `/private/tmp/efficiency-tests-final.log`
- `/private/tmp/agent-efficiency-independent-ifltxzbk/report.json` and referenced logs
- `/private/tmp/efficiency-deployed-results.json`
- `/private/tmp/efficiency-mcp-global-results.json`
- `/private/tmp/efficiency-ollama-global-smoke.json`

Initial live configuration rollback manifest: `/Users/jerry/.local/share/agent-efficiency/backups/install-30876wv_/manifest.json`. It references private mode-0600 originals. Rollback checks original/installed hashes and modes, including a recheck before each destination restore, and refuses subsequent edits. Runtime Serena state, evidence logs and package removal are intentionally separate.

Run `scripts/check_agent_efficiency.sh` to compare source ownership hashes and configuration. Re-run `scripts/install_agent_efficiency.sh --apply` after an approved source update; inspect its printed rollback manifest. Reproduce the isolated 43+13 tests and fresh-project smoke with the commands in the workflow and operational documentation.

## Orchestration project follow-up

The repository's README and root AGENTS/CLAUDE/GEMINI instructions now identify this as the shared orchestration source project. The development guide points to its real source tests, and the downstream coordination template covers Claude, Codex, Gemini/Antigravity, Ollama and ArkCLI with bounded handoffs. Documentation explicitly distinguishes the two implemented queue adapters from host sessions/advisory providers and records existing dispatcher/installer limitations. Fresh-project installation and doctor passed with zero FAIL lines; local links and diff checks passed. No queue implementation or global tool source was changed by this follow-up.
