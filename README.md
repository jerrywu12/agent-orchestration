# Multi-Agent Orchestration Template

This repository provides a modular, configuration-driven blueprint for orchestrating multiple AI agents (**Claude Code, Codex, Gemini, and Cursor**) as specialized micro-services in a single, automated software development lifecycle.

Rather than relying on a single "omnipotent AI," this architecture divides labor into strict "lanes" and uses a git-based local task queue and worktree isolation to keep agents synchronized without conflict.

---

## 1. The Roster (Who does what)

Each tool is assigned to tasks matching its distinct comparative advantage:

| Agent / Tool | Role | Workspace Lane | Primary Duties |
| :--- | :--- | :--- | :--- |
| **Claude** (Claude Code) | **Architect / Planner** | `docs/specs/**` | Clarifies requirements, designs specs, and creates Codex Task Packets. |
| **Codex** (Background Agent) | **Developer / Executor** | `src/**`, `tests/**`, `scripts/**` | Runs in isolated git worktrees, implements code, writes unit/acceptance tests, passes verification gates. |
| **Gemini** (Gemini CLI / reviewer) | **Critic / Reviewer** | read-only; `docs/reviews/**` | Audits merged builds, runs full test gates, logs quality reports, checks for quant/architectural edge cases. |
| **Cursor** (Visual IDE) | **IDE / Surgeon** | Whole Project | The visual command center. Handled by the human developer to edit UI, polish code, and resolve Gemini's audit findings. |

---

## 2. Directory Structure

When installed, the project structure is laid out as follows:

```
├── CLAUDE.md                    # Claude Code terminal instructions & project lanes
├── AGENTS.md                    # Codex developer/TDD instructions & ship rules
├── GEMINI.md                    # Gemini audit instructions & quality axes
├── docs/
│   ├── AGENT_COORDINATION.md    # Master handbook for the multi-agent cycle
│   └── reviews/                 # Directory where Gemini writes code reviews
├── .agents/
│   └── config.json              # Configuration file specifying test commands
├── config/
│   └── global-agent-tooling/     # Tracked MCP snippets for Codex, Claude, Gemini, and Cursor
├── scripts/
│   ├── agent_workflow.sh        # Core task dispatcher (handoff submit, watch, status)
│   ├── agent_worktree.sh        # Creates and prunes isolated git worktrees
│   ├── worktree_doctor.sh       # Cleans up dead worktrees & background processes
│   ├── codex_auto_dev.sh        # Developer wrapper (build + test gate + coverage verify)
│   ├── gemini_auto_review.sh    # Reviewer wrapper (pull main + test check + log review)
│   ├── spec_coverage_verify.sh  # Verifies implementation diffs against spec criteria
│   ├── verify_for_changes.sh    # Executes test suite configured in config.json
│   ├── dev_check.sh             # User-facing check runner
│   └── notify_slack.sh          # Webhook notifier for commits, PRs, and review results
├── tools/
│   └── open-source-ui-tooling/   # Shared Playwright, Storybook, and Chrome DevTools MCP install root
└── storage/
    └── agent_queue/
        └── pending/             # Handoff jobs (.job) awaiting execution
```

---

## 3. The Development Loop

The pipeline is managed via a local, file-based queue:

```
                  ┌────────────────────────────────────────┐
                  │ 1. Plan the feature                    │
                  │    - Claude writes docs/specs/*.md     │
                  └────────────────────────────────────────┘
                                      │
                                      ▼
                  ┌────────────────────────────────────────┐
                  │ 2. Implementation                      │
                  │    - Codex runs in isolated worktree   │
                  │    - Passes dev_check.sh fast          │
                  └────────────────────────────────────────┘
                                      │
                                      ▼
                  ┌────────────────────────────────────────┐
                  │ 3. Peer Review                         │
                  │    - Gemini runs dev_check.sh full     │
                  │    - Generates docs/reviews/review-*.md│
                  └────────────────────────────────────────┘
                                      │
                                      ▼
                  ┌────────────────────────────────────────┐
                  │ 4. Refine & Polish                     │
                  │    - Developer pulls latest main       │
                  │    - Cursor agent edits UI & code      │
                  └────────────────────────────────────────┘
```

### A. Submitting Jobs
After Claude designs the spec and you approve it, submit the handoff to Codex:
```bash
./scripts/agent_workflow.sh handoff submit docs/specs/my-feature_DEV_PLAN.md --agent codex
```

Once Codex implements, merges, and pushes, queue a review audit for Gemini:
```bash
./scripts/agent_workflow.sh handoff submit docs/specs/my-feature_DEV_PLAN.md --agent gemini --mode local
```

### B. Running the Daemon / Watcher
Keep a queue runner watching for new jobs in the background:
```bash
./scripts/agent_workflow.sh handoff watch --interval 30
```

---

## 4. Installation & Project Setup

1.  **Clone or copy** the template installer to your home directory:
    ```bash
    git clone git@github.com:jerrywu12/agent-orchestration.git ~/agent-orchestrator
    ```
2.  **Navigate** to the project where you want to install this pipeline and run:
    ```bash
    ~/agent-orchestrator/install.sh
    ```
3.  **Configure** `.agents/config.json` with the project name, test paths, and test commands:
    ```json
    {
      "project_name": "My Project",
      "src_directories": ["src"],
      "test_directories": ["tests"],
      "fast_test_command": "npm run test:fast",
      "full_test_command": "npm run test:full"
    }
    ```
4.  **Set your Slack Webhook URL** for automated channel alerts:
    ```bash
    ./scripts/notify_slack.sh --set "https://hooks.slack.com/services/..."
    ```
5.  **Verify the setup**:
    ```bash
    ./scripts/agent_workflow.sh doctor
    ```

---

## 5. Shared UI Tooling

This repo also tracks the machine-wide open-source UI tooling bundle used by local agents:

```bash
/Users/jerry/agent-orchestrator/scripts/check_open_source_ui_tooling.sh
/Users/jerry/agent-orchestrator/scripts/install_open_source_ui_tooling.sh
```

Managed tools live under `tools/open-source-ui-tooling/` with exact versions in `package-lock.json`:

- Playwright CLI and `@playwright/test`
- Playwright MCP
- Storybook CLI
- Chrome DevTools MCP

Wrappers are installed in `/Users/jerry/.local/bin`:

- `agent-playwright`
- `agent-playwright-test`
- `agent-playwright-mcp`
- `agent-storybook`
- `agent-chrome-devtools-mcp`
- `storybook`
- `chrome-devtools-mcp`

The desired Codex, Claude, Gemini, and Cursor MCP entries are tracked under `config/global-agent-tooling/`; the operational copies still live in each agent's home-directory config file.

Cursor also receives an always-on project rule from `templates/cursor-shared-ui-tooling.mdc.template`, and the machine-wide operational copy lives at `/Users/jerry/.cursor/rules/shared-ui-tooling.mdc`.

Agents should use this bundle for global inspection and bootstrap help. Repos that need durable tests should still add project-local Playwright or Storybook dependencies so CI and local runs share the repo lockfile.

---

## 6. Local Agent and Model State

Agent and model folders are organized under the ignored local state root:

```bash
/Users/jerry/agent-orchestrator/local/agent-home
```

Use the migration script to preview or perform moves while leaving compatibility symlinks at the original paths:

```bash
/Users/jerry/agent-orchestrator/scripts/relocate_agent_home.sh
/Users/jerry/agent-orchestrator/scripts/relocate_agent_home.sh --execute --only agent-skills
```

See `docs/AGENT_HOME_CONSOLIDATION.md` for the managed folder list and the safe full migration flow. Do not commit anything under `local/agent-home/`.
