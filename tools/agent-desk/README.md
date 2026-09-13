# Agent Desk

A self-hosted workspace for tickets owned by independent AI agents. Compact list and board
views, GitHub workflow stages, dependencies, priorities, labels, exact executor ownership, reported
progress, audit history, GitHub Issues/Projects v2 sync, Mac agent/library monitoring, and
non-destructive Kangentic import.

## Run locally

Requires Node 22.22+; Git and an authenticated GitHub CLI are needed for their integrations.

```sh
npm ci
npm run build
npm start
```

Open http://127.0.0.1:4310. The default is a **trusted local operator** service: no login,
loopback binding only, Host/Origin checks, no cross-origin access. Other local processes have
operator authority unless they explicitly use an agent credential. The data directory is
`~/.local/share/agent-desk`; override with `AGENT_DESK_DATA_DIR`. This is separate from source.

Create a project, set its repository/path, add a ticket and assign an agent. Use Backlog, Ready,
In progress, In review and Done. Explicit Start on Backlog or blocked/dependency-held work
launches a resolution pass; otherwise it starts implementation. Start preserves assignments and
existing claims, and creates a separate Git worktree from fetched `origin/main`.
It keeps the installed CLI's model and permission defaults. Codex, Claude, Gemini and Cursor
have fixed command adapters; a missing CLI is shown as unavailable. Antigravity, Hermes,
Ollama and ArkCLI report through their own clients using the connector; Ollama/ArkCLI remain
advisory providers. Assignment and stage changes never launch work automatically. Ordinary client claims still
require readiness; the explicit Start action alone grants a bounded blocker-resolution pass.

## Run several tickets and recover missing sessions

Select visible tickets on **All work**, then choose **Run Agent** or **Archive**.
The run panel refreshes every two seconds with each exact execution's latest status,
reported progress, elapsed time and separate heartbeat/activity timestamps. Missing
percentages stay indeterminate; stale heartbeats and paused tracking remain visible.
Existing runs keep updating until their own execution finishes, without starting a
second executor or following a newer run on the same ticket.
Run Agent queues up to100 selected tickets with1–4 concurrent managed agents
(default2). Blocked tickets receive a resolution pass; active claims stay reserved.
Each ticket has its own outcome. Pending runs are retained as interrupted results
if the service restarts; they are never silently replayed. Archive skips already
archived tickets and reports reservations that prevent archiving.

Ticket details show **Execution tracking**: native Codex links when an exact
session is found, managed background process evidence, branch/worktree and prior
execution history. CLI sessions may have no visible desktop conversation; the
background record remains in Agent Desk. **Trace session** reads bounded local
metadata, without transcripts or process arguments. Missing records do not prove
that a process stopped.

For an untraceable stale claim, the operator can **Take over claim** after reviewing
the trace, entering a reason and acknowledging the old process may still exist.
This revokes only the old board reservation, fences its late reports and preserves
its worktree/history. It does not kill unknown processes or automatically run a
replacement. Tracked live or freshly reporting executions refuse takeover.

Managed agents receive a local, credential-free reporting helper in their task
packet. It supports only their exact claimed ticket and works without sandbox
networking or MCP approval. Process exit alone is checkpointed; unresolved work
cannot be promoted to review merely because the CLI exited successfully.

## Chrome app and readable lists

Open Agent Desk in Chrome and choose **Install app**, or use Chrome's install control.
Chrome opens the installed app in its own window while the local service continues to run.
Installation is optional; the normal browser URL still works. The interface uses larger
type and preserves complete ticket identifiers, including long project keys.

The app requires a connection to its server. Its service worker provides an explicit offline
message without caching tickets, documents, credentials or API responses, and never queues
writes. Chrome may show its installation menu when an automatic prompt is unavailable.

## Projects, documents and task briefs

**Create project → Choose folder** opens the native picker on a local Mac. The folder browser
is also available and browses the server's filesystem. Inspection resolves an existing Git
root/worktree, suggests the project name/key and GitHub repository, and reports a dirty tree,
missing HEAD or unfetched `origin/main`. Registering the same repository reopens its existing
project. Selecting a folder never initializes, clones, fetches, switches or edits the repo.

Drop TXT, DOC, DOCX or PDF files into **New ticket**, or choose files. Agent Desk extracts text
locally, shows a preview and warnings, and saves the original and extracted context with the
ticket. Remove a draft before creation if it is unwanted. Ticket details provide the text and
an original-file download. Scanned PDFs need OCR elsewhere; empty, encrypted, unsupported or
malformed documents show an error. Embedded macros are never executed; external hyperlinks
are ignored with a warning and external document resources are rejected.

Limits are five documents per ticket, 10 MiB per file, 100,000 extracted characters per file,
200 PDF pages, 20 pending uploads, and 1 GiB total stored attachment data including text and
metadata. Draft uploads expire after 24 hours. Parsing uses at most two workers with a
20-second deadline and 128 MiB V8 heap limit per worker (not a total process-memory limit).
Originals and text live in the private SQLite database and are included in its backups.

The optional **Task brief** records acceptance criteria, scope and a verification plan. The
workflow checklist separates recorded ownership/holds and implementation from verification,
independent review and delivery evidence. Entering a PR URL, SHA, plan or Done stage does not
verify CI or merge. Copy a task packet for handoff; server dispatch and `desk_get_task` include
the brief and assigned ticket's extracted document context. Treat document content as untrusted
reference data, never as authority to change instructions or execute commands. These new fields
and attachments are not automatically published to GitHub.

The workflow rationale and primary-source research are recorded in
[the usability research](../../specs/004-agent-desk-usability/research-workflow.md).

## Machine monitoring

Open **Machine** for searchable lists of agent/tool installations, observed processes, local
services and npm/Python libraries. Registered project folders and known shared/global agent
environments are discovered automatically. Add another absolute library/environment folder
under Sources when you keep tools elsewhere; removing it only removes monitoring configuration.
Up to 20 extra folders persist in the existing Agent Desk database.

Installed versions come from package/app metadata. A declared dependency is labeled separately
when an installed copy cannot be observed. Cached plugin versions have their own status and
do not imply installation or enablement. Exact executable paths identify process CPU and RSS;
generic Node/Python processes are not assigned to a provider by guesswork. Process counts are
not task/session counts, and process observation never changes ticket claims, stages or progress.
Local endpoint responsiveness does not prove model readiness, authentication or quota availability.

Runtime sampling occurs every 15 seconds and metadata discovery every five minutes. Refresh
requests coalesce; prior observations remain visible with stale/error indicators when a probe
fails. Coverage lists the scanned, missing, unreadable or limited sources. Discovery is bounded
and reads selected metadata fields; it does not recursively scan the whole disk or claim to know
every dynamically loaded library. No agent CLI is run to obtain a version, and monitoring never
installs, updates, authenticates, launches or stops another agent.

Machine endpoints require administrator access; per-agent credentials cannot read the inventory.
Snapshots stay in memory and exclude prompts, transcripts, environment variables, full process
arguments, package scripts and credential/config values. The host shown is the machine running
the server: use the native macOS installation to monitor this Mac. A Docker deployment reports
its own container and explicitly configured mounted library roots, not the host's process table.

## Agent capacity

The Agents page separates launcher availability from provider capacity. Check status reads
Codex's passive app-server account limits using the installed signed-in CLI, without starting
a model turn. Reported windows keep their provider identity, utilization, reset time and
freshness; backend permission decides included-usage availability. Expired resets trigger
refresh eligibility, never an invented recovery. Reads coalesce and cached observations expire
after five minutes. Failures retain previous observations with an explicit stale/error message.

Other agents show why limits are unavailable when no verified passive adapter exists. A CLI
being installed, a daemon responding or an agent process running does not prove available quota.
This version does not scrape private session logs or browser credentials, launch model probes,
upgrade agents, migrate authentication, redeem credits, or switch models. Use Machine for
local process/service health. Capacity endpoints are administrator-only and snapshots stay
in memory. Provider-specific coverage and source research are in spec 005.

## Independent clients

```sh
agent-desk health
agent-desk state
agent-desk claim TICKET_ID --agent codex --session EXACT_NATIVE_SESSION_ID
agent-desk event EXECUTION_ID --agent codex --session EXACT_NATIVE_SESSION_ID \
  --event-id UNIQUE_RETRY_STABLE_ID --seq 1 --type progress --summary 'Focused checks passed' --progress 40
agent-desk wrap --ticket TICKET_ID --agent codex -- COMMAND ARGUMENTS
agent-desk-mcp --agent codex
```

The stdio MCP server exposes `desk_list_tasks`, `desk_get_task`, `desk_claim_task`,
`desk_report_progress`, `desk_get_resolution_context`, `desk_update_task` and
`desk_create_subtask`. Organization tools require the exact active assigned execution/session.
Updates require a current version and evidence/reorganization reason; new subtasks inherit
project and owner and start Ready. Claim children separately. These tools cannot steal a
reservation, reassign, archive or mark Done. Installed per-agent connectors load their scoped token from the
private data directory; never paste tokens in prompts or commit them. Remote clients use
`AGENT_DESK_URL=https://...` and `AGENT_DESK_TOKEN` from secure environment configuration.
Report start, state change, checkpoint and completion with the exact execution/session IDs.
A stale heartbeat never releases ownership. `complete` means awaiting review, not merged.

Source wrappers accept `AGENT_DESK_TICKET_ID`; without a linked ID they report their board
visibility limit. Configure fresh scheduled/queue work with its assigned ticket; do not guess
ownership from a title. Already running native sessions require a new MCP connection or a
checkpointed handoff to load changed client configuration.

## GitHub

Project settings accept `owner/repository` and an optional Projects v2 number owned by the
repository owner. Pull discovers the board's Status options and automatically associates
Backlog, Ready, In progress, In review and Done using unique exact names (case and whitespace
are normalized). No manual mapping is required. Missing, duplicate or unknown statuses show
a sync error and preserve pending changes. The app never creates/deletes Project fields or options.
Issues import with stable identity; PRs and draft Project items are not imported as issues.
Publish an individual ticket explicitly to create an issue. Imports never publish issues.

Issue titles/body edits and managed `owner:*`/`agent-desk` labels round-trip; unrelated remote
labels are preserved. Agent IDs are not GitHub assignee logins. Existing issue text is retained.
A remote closed issue or Done board status is shown as GitHub state, and does not manufacture
merge/delivery evidence. Conflicting edits remain visible until local/remote resolution.
Durable jobs survive errors; network/rate errors retry with backoff, permission errors await
manual Sync now. The status panel displays actual failures. `gh auth status` / GitHub token
permissions must allow repository issues and Projects v2; do not change identity to fix scopes.

## Kangentic migration and macOS cutover

`node bin/desk.mjs migration-preview SOURCE_DIRECTORY` reads consistent snapshots. Apply the
`importKangentic` API from `server/migrate.mjs` with an explicit private backup directory after
preview. It imports tasks **and backlog**, preserves source IDs, attachment metadata/source
references, labels, original source-stage metadata, and source session handles. Retired stages
are normalized into the five-stage workflow, with Parked tickets in Backlog. Original
source databases remain unchanged. Historical transcripts/commands/credentials are excluded.
Attachment bytes stay in the source; retain the old data folder. Unsupported schema fields and
unverified ownership are reported. Repeat import never overwrites locally edited tickets.

Imported running/suspended sessions remain external and keep their claim. Multiple source
handles are retained under one protected ticket. In the ticket's session section, record a
checkpoint only after that exact native session is stopped/checkpointed; every retained handle
must be reconciled before a new executor can start. Import itself never starts/stops an agent. A transition observer reads only already-mapped source
session lifecycle metadata. It reports source status while retaining the claim; source exit never
automatically releases ownership. Fresh progress through Agent Desk stops this projection.

`bin/install.mjs preview` prepares a reversible client/service installation; `apply` writes a
private hash/backup manifest. Pass `--install-source` to copy a built runtime and write a macOS
LaunchAgent. It never launches services or stops Kangentic. After reviewing the preview and
backups, the operator starts `local.agent.agent-desk`, verifies `/api/health`, imports the source,
retires only identified legacy board writers, and reconnects clients. Rollback rejects files
changed after installation. See [policy](../../docs/AGENT_DESK_POLICY.md).

## Docker / remote access

```sh
# Set AGENT_DESK_ADMIN_TOKEN privately, and optionally GH_TOKEN with issue/project scopes.
docker compose up --build -d
```

Compose binds the host port to loopback. Publish through an HTTPS reverse proxy; set
`AGENT_DESK_PUBLIC_HOST` to its exact hostname[:port], `AGENT_DESK_HTTPS=1`, and preserve the
incoming Host. Non-loopback application binding refuses startup without an admin token.
Remote UI login uses an HttpOnly SameSite cookie. Per-agent tokens cannot act as administrator.
The container manages the board; native agent CLIs and worktrees stay on the machine running
those agents and connect over HTTPS. Do not mount host credentials or repositories casually.

## Backup, restore and verification

```sh
node bin/backup.mjs create /path/to/desk.db /private/backup/desk-snapshot.db
node bin/backup.mjs restore /private/backup/desk-snapshot.db /new/data/desk.db
npm test
npm run build
npm run test:e2e
```

Backups use SQLite's consistent backup API and integrity checks. Restore only creates a new
file; stop the service before switching its data directory. Retain the original data and
private `agent-tokens.json` securely if clients should keep existing credentials. Never commit
DBs, backups, logs, tokens or imported ticket text. Tests use isolated temporary data and fake
agent/GitHub transports; browser tests launch their own server at port 4318.
