# Quickstart: Validating background AI agent activity tracking

**Feature**: specs/011-agent-activity-tracking | **Date**: 2026-09-15

Per `AGENTS.md`, Agent Desk verification uses code, scripts, API checks and automated DOM tests. **Do not use computer control and do not capture screenshots.**

## Prerequisites

```bash
cd /Users/jerry/agent-orchestrator/.claude/worktrees/prevent-llm-cheating-067d57/tools/agent-desk
npm install
```

Node v22.23.1 or later (`node:sqlite` `DatabaseSync` is required). No other dependencies — if implementation needs one, stop and revise the plan rather than adding it.

---

## 1. Reproduce the research measurements

Confirms the environment matches the numbers the plan is built on. Run before implementing.

```bash
node -e 'import("node:sqlite").then(async ({DatabaseSync})=>{const fs=await import("node:fs");const os=await import("node:os");const p=os.homedir()+"/.codex/state_5.sqlite";const t=Date.now();const db=new DatabaseSync(p,{readOnly:true});db.exec("PRAGMA query_only=ON; PRAGMA busy_timeout=50");const rows=db.prepare("SELECT id,source,cwd,rollout_path FROM threads WHERE archived=0 AND updated_at >= unixepoch('now') - 86400").all();db.close();let hit=0,miss=0,active=0;for(const r of rows){let st;try{st=fs.statSync(r.rollout_path)}catch{continue}const len=Math.min(262144,st.size);const buf=Buffer.alloc(len);const fd=fs.openSync(r.rollout_path,"r");fs.readSync(fd,buf,0,len,Math.max(0,st.size-len));fs.closeSync(fd);const m=[...buf.toString("utf8").matchAll(/"type":"task_(started|complete)"/g)].at(-1);if(m){hit++;if(m[1]==="started")active++}else miss++}console.log({candidates:rows.length,tailResolved:hit,tailMissed:miss,active,ms:Date.now()-t})})' 2>/dev/null
```

**Expected**: completes in tens of milliseconds; `tailMissed` is a small minority of `candidates`. A large `tailMissed` share means the escalation policy in R-003 needs revisiting **before** coding.

Confirm `etimes` is still unavailable (drives R-006):

```bash
/bin/ps -axo pid=,etimes=,comm= 2>&1 | head -1
```

**Expected**: `ps: etimes: keyword not found`. If this now succeeds, R-006's parser can be simplified — revise the plan rather than keeping dead code.

---

## 2. Server unit tests

```bash
npm test
```

**Expected**: all existing suites plus the new `tests/agent-activity.test.mjs` and `tests/activity-http.test.mjs` pass.

All new tests are fixture-driven through injected collectors — **no test may read the real `~/.codex` database or the real process table** (`spec 003` precedent: fixture discovery must not inspect the CI or user machine). Required coverage:

| Area | Must assert |
|---|---|
| Lifecycle | last marker `started` → active; last `complete` → excluded; never emitted → excluded; beyond escalation bound → `indeterminate` + `partial` |
| Origin | `vscode`/`exec`/`cli` map correctly; structured subagent JSON → `Subagent`; unknown → `Codex`; **raw `source` never appears in output** |
| Description | tabs/newlines/control chars stripped, capped at 60, empty → `Untitled task` |
| Workspace | final path segment only; assert no `/` in any emitted `workspace` |
| Workers | each of the five exclusions in data-model.md as a separate named case |
| `etime` | `MM:SS`, `HH:MM:SS`, `DD-HH:MM:SS`, padded and malformed input |
| Degradation | missing source, bad schema, locked DB, `ps` failure → correct `reason` from the closed set, prior values retained, `state` never `idle` |
| Invariants | `idle` only when all sources `observed`; zero + unobservable → `unobservable` |
| Bounds | 200/200/50/20 caps set `truncated` |
| Lifecycle mgmt | overlapping `refresh()` coalesces; `close()` aborts in flight and stops the timer |

---

## 3. API contract check

Start a **separate test instance**. `AGENT_DESK_DATA_DIR` is mandatory — without it the server defaults to `~/.local/share/agent-desk`, which is the **installed app's live store** ([http.mjs:728](../../tools/agent-desk/server/http.mjs:728)), and the run would mutate real data:

```bash
AGENT_DESK_PORT=7011 AGENT_DESK_DATA_DIR=/tmp/agent-desk-011 npm start &
```

```bash
curl -s localhost:7011/api/activity | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const v=JSON.parse(s);console.log(JSON.stringify({state:v.state,count:v.activeCount,tasks:v.tasks.length,workers:v.workers.length,sources:v.sources.map(x=>[x.id,x.status]),partial:v.partial,stale:v.stale}))})'
```

**Expected**: a `200` matching [contracts/activity-api.md](./contracts/activity-api.md), with `state` consistent with `sources`.

Refresh is non-blocking and coalescing:

```bash
curl -s -o /dev/null -w '%{http_code} %{time_total}s\n' -X POST localhost:7011/api/activity/refresh
```

**Expected**: `202`, returning fast regardless of collector work in flight.

**Privacy assertion** — the payload must contain no absolute path, no home directory, and no command line:

```bash
curl -s localhost:7011/api/activity | grep -E '/Users/|/opt/|/Applications/|--dangerously|sk-|Bearer ' && echo 'FAIL: forbidden content present' || echo 'PASS: no forbidden content'
```

**Expected**: `PASS`. This is contract guarantee 1 and is the cheapest check for an FR-019 regression.

**Agent-scope denial** (SC-009) — using an agent token from the *test instance's* token file, `/tmp/agent-desk-011/agent-tokens.json`:

```bash
curl -s -o /dev/null -w '%{http_code}\n' -H "Authorization: Bearer $AGENT_TOKEN" localhost:7011/api/activity
```

**Expected**: `403`.

---

## 4. DOM tests

```bash
npm run test:e2e
```

**Expected**: existing suites stay green, plus `tests/activity-browser.spec.ts` covering the three distinct states — active with breakdown, none active, cannot observe — and the stale and partial indicators. The "none active" and "cannot observe" states must be **distinguishable in the DOM**, not merely different text (SC-005).

---

## 5. Build

```bash
npm run build
```

---

## 6. No-persistence check (SC-008)

After exercising refreshes and restarting the test instance, confirm no activity data was persisted:

```bash
git -C /Users/jerry/agent-orchestrator/.claude/worktrees/prevent-llm-cheating-067d57 status --porcelain
```

**Expected**: no unexpected data files. Then grep the test instance's store for a task description string seen in the API response — expect no match (FR-018):

```bash
grep -c "<a description string from the API response>" /tmp/agent-desk-011/desk.db || echo 'PASS: not persisted'
```

Finally, stop the test instance and remove `/tmp/agent-desk-011`.

---

## 7. Parity evidence (SC-010, gates retirement)

Run only when Phases A–D are complete, on the target Mac, while real agent work is in flight.

```bash
/Users/jerry/.swiftbar/codex-status.5s.sh > /tmp/parity-indicator.txt 2>&1
curl -s localhost:7011/api/activity > /tmp/parity-agentdesk.json
```

Compare the active sets and record the result in this feature directory.

**Expected divergence — not a failure.** Per R-005, the indicator's sleep-prevention check matches a hardcoded `caffeinate -i /opt/homebrew/bin/codex` pattern that matches nothing on this Mac, so it reports sleep prevention **inactive** while `caffeinate -is` is actually holding the machine awake. Agent Desk is expected to report **active**. Record this explicitly as a corrected defect; the task and worker sets must otherwise match.

---

## 8. Retirement (FR-022 — separate authorized step)

Only after §7 is recorded and the change is merged. This is a machine-local operation, distinct from the source change, and requires explicit authorization at the time.

```bash
cp /Users/jerry/.swiftbar/codex-status.5s.sh /Users/jerry/.swiftbar-retired-codex-status.5s.sh.bak
```

Then quit SwiftBar, remove `/Users/jerry/.swiftbar/codex-status.5s.sh`, and remove SwiftBar's login item. Rollback is restoring the `.bak` and relaunching SwiftBar.

Do **not** delete the `~/.swiftbar` directory or SwiftBar's preferences until the retention period agreed at authorization time has elapsed — `PluginDirectory` is set to `/Users/jerry/.swiftbar` in SwiftBar's preferences and other plugins may be added there.
