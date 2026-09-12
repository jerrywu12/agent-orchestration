# Agent Desk

A self-hosted workspace for tickets owned by independent AI agents. Compact list and board
views, custom stages, dependencies, priorities, labels, exact executor ownership, reported
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

Create a project, set its repository/path, add a ticket and assign an agent. Move it to Planning
before Start. Start checks holds and creates a separate Git worktree from fetched `origin/main`.
It keeps the installed CLI's model and permission defaults. Codex, Claude, Gemini and Cursor
have fixed command adapters; a missing CLI is shown as unavailable. Antigravity, Hermes,
Ollama and ArkCLI report through their own clients using the connector; Ollama/ArkCLI remain
advisory providers. Assignment never launches anything; stage automation is an explicit opt-in.

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

The stdio MCP server exposes `desk_list_tasks`, `desk_get_task`, `desk_claim_task` and
`desk_report_progress`. Installed per-agent connectors load their scoped token from the
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
repository owner. First use Pull only to discover the board's Status options, then map each
local stage to an existing option. The app never creates/deletes Project fields or options.
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
references, labels, original stages (including Parked), and source session handles. Original
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
