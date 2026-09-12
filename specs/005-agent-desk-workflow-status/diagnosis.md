# Pre-edit diagnostic record

Runtime: http://127.0.0.1:4310, /Users/jerry/.local/share/agent-desk/app, SHA de0183b27e10ef79b77402514201cb1b677804e9. Source main d3999b1 differs only by prior evidence docs. New implementation base d3999b1 in /private/tmp/agent-desk-workflow-status.

Reproduction: live SSP ticket kg-24c31060bdb1bd86e5964d3aed41b18305fb1d9a has owner codex, blockedReason 'dependency', dependsOn [], and no active execution. Its legacy stage is To Do/backlog. TicketDetails startReason directly returns 'Blocked: dependency' and disables Start. Server Service.ready also throws BLOCKED before claim acquisition. Browser title click opened the ticket; the attempted role=dialog assertion found no matching node, so final rendered regression proof must use the actual dialog DOM rather than this selector.

Trace: imported task blocker -> SQLite ticket -> Service state -> React TicketDetails startReason -> disabled button; if called directly, POST start -> Runner launcher/repository checks -> Service.claim -> Service.ready -> BLOCKED or STAGE_HOLD -> no execution, task packet or agent tooling. Existing MCP only reads/claims/reports, so merely enabling the button cannot provide reorganization authority.

Ranked hypotheses: (1) blanket UI/server blocker guard rejects an intentional resolution task; disproved if a fake CLI resolver can start the same fixture without weakening ordinary claims. (2) existing claim conflict causes the observed block; disproved by this ticket's absent active claim and UI source selecting blocker first. (3) unavailable launcher/repository prevents execution; distinct later boundary tested separately, cannot explain the current blocker-specific disabled title.

First broken boundary: product intent for explicit Start is conflated with automatic readiness. Frontend button and backend trusted Start claim contract own the fix, plus scoped tools needed to fulfill resolution. Pre-fix failing API/Runner regression is added before production changes.

Risk matrix: unit/service ownership, version and dependency cycles; HTTP/MCP identity/schema; fake CLI/worktree lifecycle; concurrent starts and retained claims; provider timeout/reset freshness/output bounds; migration/import/sync persistence and conflicts; exact blocked-ticket browser journey and deployed runtime. Remote model execution is N/A for tests because synthetic CLI fixtures prove the launch and tool boundary without executing real user work. macOS native Chrome completion remains separately gated by OS accessibility.

Adjacent checks: ordinary/automatic claims remain held, explicit Backlog resolution, unassigned/disabled/archived/Done/foreign claim rejection, empty dependency graph with freeform blocker, same-project organization, restart/reimport, pending GitHub conflict, provider unknown quota and expired resets.

Pre-fix executable proof: Node fake-CLI regression `explicit Start launches a blocked Backlog ticket as a resolution pass` failed with code BLOCKED, stack Runner.start -> Service.claim -> Service.ready, before any agent invocation. Private log run-m4k2nnw3.log. No real user ticket was executed.
