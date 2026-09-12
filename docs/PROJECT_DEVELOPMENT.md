# Developing Agent Orchestrator

The canonical source checkout is `/Users/jerry/agent-orchestrator`. It owns the shared tools and reusable orchestration templates; downstream application repositories retain their own task packets and acceptance gates. Follow [repository instructions](../AGENTS.md) and work in a separate `codex/` branch/worktree.

## Choose the correct source

- Shared command capture, provider advice and global installation: `config/global-agent-tooling/agent-efficiency/`.
- Command safety and hooks: `config/global-agent-tooling/agent-guardrails/`.
- Project queue, worktree and verification behavior: `scripts/`.
- Instructions distributed to application projects: `templates/`; root role files govern development here.
- Installation, maintenance and recorded deployment coverage: `docs/` and the relevant `specs/` feature.

The queue's implemented adapters are Codex and Gemini. Claude planning and Antigravity work happen through their host sessions. Ollama/ArkCLI are advisory providers via `agent-advice`. There is no automatic all-provider execution loop or Cloud submitter in `agent_workflow.sh`. Its local consumer does not filter the `cloud-ready` label; keep Cloud work in the separately configured Cloud workflow.

## Verification

[The CI workflow](../.github/workflows/ci.yml) defines the source checks. The shared efficiency suite needs Python 3.13; on this Mac its existing runtime is `~/.local/share/uv/tools/serena-agent/bin/python`.

From the source worktree:

```bash
~/.local/share/uv/tools/serena-agent/bin/python -m unittest discover -s config/global-agent-tooling/agent-efficiency -p 'test_*.py'
~/.local/share/uv/tools/serena-agent/bin/python -m unittest discover -s config/global-agent-tooling/agent-guardrails -p 'test_*.py'
for script in scripts/*.sh install.sh; do bash -n "$script" || exit; done
git diff --check
```

Run focused tests during behavior changes and the required suite before merge. On another machine, use a Python 3.13 interpreter. Use `agent-run` around verbose checks when available; inspect its private full log for failures. ShellCheck is advisory in CI.

When changing templates or installation, exercise the existing fresh-project smoke:

```bash
orchestration_fixture="$(mktemp -d)"
git -C "$orchestration_fixture" init -q
./install.sh "$orchestration_fixture"
(cd "$orchestration_fixture" && ./scripts/agent_workflow.sh doctor)
git -C "$orchestration_fixture" check-ignore .env.local
```

Require zero `FAIL` lines in doctor output; doctor currently returns zero even when it reports missing files. Inspect the installed role/coordination files for the intended changes. Do not bootstrap templates into this source checkout as a substitute for a fixture. The generic `scripts/dev_check.sh` reads a downstream project's `.agents/config.json`; its placeholder test commands are not evidence for this repository.

For documentation-only work, verify links and factual commands, review the diff, and run the fresh-project smoke if distributed templates changed. CI retains the full source suites.

## Agent Desk verification

The app under `tools/agent-desk/` requires Node 22.22+. Run `npm test`, `npm run build`,
and `npm run test:e2e` from that directory. The browser suite uses an isolated temporary
SQLite database and server; connector tests use injected GitHub responses and fake agents.
Machine monitor tests inject fixture roots/probes and the browser server disables native
collection; tests must not discover the developer or CI host. Collector/API/coordinator tests
cover metadata bounds, source races, stale observations and administrator-only access.
Document tests use synthetic TXT/DOC/DOCX/PDF fixtures and exercise malformed archives,
Unicode, extraction limits, worker cancellation, draft expiry, quota and scoped access.
Folder tests create temporary Git repositories and inject native picker results; browser
tests must not open native dialogs. Intake browser tests cover full identifiers at desktop
and mobile widths, typography, document previews, project reuse and task briefs. PWA tests
check install metadata and the absence of private-data/offline-write caching. Use the
[desktop/intake verification record](../specs/004-agent-desk-usability/verification.md)
for native Chrome installation and live deployment proof.
CI runs the same checks on Node 22 and Chromium. Native installation, source import and
client reconnection are separate live cutover checks, recorded in
[the verification record](../specs/002-agent-desk/verification.md).

## Publishing and deployment

Commit, push and create a PR with the requested behavior, coverage and actual validation. Wait for required CI and review before merging, then fast-forward the clean canonical checkout. Copied downstream role/config/script templates leave differing files intact and create `*.orchestration-new` proposals. The existing installer separately replaces `.githooks/post-commit` and makes shell scripts executable; account for those effects on established projects.

A source merge does not itself update user-level configuration. For changes that need global deployment, follow [the efficiency installation guide](AGENT_EFFICIENCY.md): preview, apply the authorized changes, check installed hashes/configuration, and retain the rollback manifest. Configuration changes can require a new client session or MCP reconnect. Distinguish source checks from native-client/provider checks in the result.

Machine-local credentials, caches, models and sessions remain outside tracked source. Read [agent-home status](AGENT_HOME_STATUS.md) before maintenance. ArkCLI's user-approved backup and startup verification are recorded in the [operation record](../specs/001-global-agent-efficiency/arkcli_migration_approval.md). Reuse the existing identity/profile, check current authentication, and preserve the private recovery backup.
