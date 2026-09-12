# Machine monitoring contract

Types: tools/agent-desk/src/machine-types.ts, locked before implementation.

All routes require existing administrator access, after host/origin/login/agent-scope checks. Existing scoped agent tokens receive 403; remote anonymous gets401. No machine payload in agent /api/state or MCP.

- GET /api/machine returns MachineSnapshot immediately. Initially arrays empty, times null, scan.scanning until first observation. Poll browser every15seconds while mounted/visible.
- POST /api/machine/refresh JSON{} triggers coalesced background inventory+runtime; returns MachineSnapshot, HTTP202. Preserves prior data while refreshing.
- POST /api/machine/sources JSON{path,label?} validates absolute existing directory, label1..80, max20 unique real roots; persists then invalidates scan. Returns CustomMachineSource HTTP201. Duplicates409, invalid422, unavailable/path errors422, limit422.
- DELETE /api/machine/sources/:id removes only configuration, returns {ok:true}; missing404. No folder deletion.

Coordinator class MachineMonitor(service, options) exports snapshot(), refresh(), addSource(input), removeSource(id), close(). Default auto=true starts initial refresh, unref timer15seconds; inventory refresh after five minutes or manual/configchange. refresh() promise for tests/lifecycle; routes dispatch without awaiting background completion. Options inject discover, probe, home, appRoot, platform, clock and intervals to keep tests isolated. Stale configuration generations cannot publish removed-source inventory.

Collector module server/machine-inventory.mjs exports:
- discoverMachine({home,appRoot,projects,customSources,platform,signal}) -> Promise<{agents,libraries,sources,issues:string[],truncated:boolean}>. Agents return MachineAgent installation fields only: id,name,kind,installed,version,path,optional deskAgentId. Coordinator attaches runtime fields. Custom sources are validated directory records; projects use {id,name,path}. Callers provide home/appRoot; defaults may use OS/platform. It may accept additional fixture-only injectable paths/limits/read helpers for deterministic tests.
- probeMachine({agents,platform,signal}) -> Promise<{host:MachineHost,agents:Record<string,{status,processes,cpuPercent,memoryBytes}>,services:MachineService[],issues:string[],processError:string|null}>. Keys match stable agent ids from discovery. Distinct known app and CLI rows may share deskAgentId but process counts must not double count across identical executable rows. All matched process summaries are comm-only OS evidence; processes have numeric pid/cpuPercent/memoryBytes. If ps fails, processError safe generic text and statuses unknown, never empty-idle success. Fixed endpoint failures become unreachable; permissions/unsupported become unknown as appropriate. No provider credentials/auth checks.

Error handling: HTTP validation uses existing fail(status,code,message). Collector failures must be generic, bounded and must never include file contents, command output, config, environment or arbitrary endpoint body. Runtime partial errors retain prior agent process metrics in coordinator, mark unknown and runtimeError; inventory fatal failure retains previous arrays and inventoryAt, sets scan.error. Display times/error so retained values are not current claims. Coverage issues are meaningful human text, capped50 entries; package/source/metadata limits documented by collector.
