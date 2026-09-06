# Tasks: Shared agent efficiency
- [x] T001 Establish spec, research, CLI contract and plan in specs/001-global-agent-efficiency/**.
- [x] T002 [P] Write failing runner tests then implement config/global-agent-tooling/agent-efficiency/{agent_run.py,test_agent_run.py}; validate argv/cwd, exit/signals/timeout, full logs, byte bounds and concurrency.
- [x] T003 [P] Inspect provider CLI contracts, write failing tests then implement config/global-agent-tooling/agent-efficiency/{agent_advice.py,test_agent_advice.py}; bounded input/output, existing identity, no execution of model replies.
- [x] T004 Implement config/global-agent-tooling/agent-efficiency/{install.py,test_install.py,POLICY.md,SKILL.md,serena-context.yml,versions.json}; test preservation, idempotence, rollback and malformed configs before live writes.
- [x] T005 Wire scripts/{install_agent_efficiency.sh,check_agent_efficiency.sh}, templates/{AGENTS.md.template,CLAUDE.md.template,GEMINI.md.template}, install.sh, docs/AGENT_EFFICIENCY.md, README.md, config/global-agent-tooling/README.md, .github/workflows/ci.yml, .gitignore.
- [x] T006 Run tests and isolated config/MCP/provider smokes; record specs/001-global-agent-efficiency/verification.md.
- [x] T007 Review, commit, push and open PR; deploy installed tested source, validate every adapter plus current/future-project smoke, report GUI reconnection needs.

T002 and T003 have separate files/contracts. T004 owns shared config and is serialized with T005/T007. No worker touches another worker's files or live config. Root handles git/checkpoints and all installations.

Deployment source is published in PR #7. T007 initially recorded ArkCLI as fixture-tested with live verification blocked. After the user explicitly approved the private backup/startup operation and renewed sign-in, live adapter verification passed; see verification.md and arkcli_migration_approval.md. Existing GUI sessions still need MCP reconnect/new task.
