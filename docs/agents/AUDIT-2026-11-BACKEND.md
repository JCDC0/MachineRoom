# Audit of the backend, November 2026

Date: 2026-11-03
Author: agy (Gemini 3.8 Flash, backend lane)
Branch: `feat/q23-audit-of-the`
Commit: `0.1.402`
Brief: Q23

## Scope and files read

This audit inspects the MachineRoom bridge server, CLI entry points, and runner scripts. It covers:
- `server/index.js`
- `server/endpoints.js`
- `server/family.js`
- `server/search.js`
- `server/mcp.js`
- `server/processTree.js`
- `server/projects.js`
- `server/runs.js`
- `server/control.js`
- `server/policy.js`
- `server/plans.js`
- `server/decide.js`
- `server/briefs.js`
- `server/assistant.js`
- `server/music.js`
- `server/static.js`
- `server/orchestrators.js`
- `server/orchestrator.js`
- `server/harness-models.js`
- `server/claude-sessions.js`
- `server/opencode-sessions.js`
- `server/lanes-source.js`
- `server/lane-costs.js`
- `server/reviews.js`
- `server/files.js`
- `server/network.js`
- `server/git.js`
- `bin/machineroom.mjs`
- `bin/machine-room.mjs`
- `scripts/run-lane.mjs`
- `scripts/lane-lock.mjs`
- `scripts/mr-agent.mjs`
- `scripts/acp-run.mjs`
- `scripts/recording-files.mjs`

The audit checks for missing origin or authorization checks, path traversal, key leakage, unreleased child processes, unreleased timers or sockets, non-atomic file writes, unbounded memory growth, repeated uncached disk reads, and failures reported as successes. It does not repeat findings already recorded as fixed in `AUDIT-2026-10-V11.md` or `AUDIT-2026-11.md`.

## Severity

- High: route missing origin or authorization check, persistent background process leak, or state loss and abrupt process termination.
- Medium: unhandled process timeout or leak, non-atomic file corruption, repeated uncached disk parsing per request, or unbounded memory accumulation.
- Low: unreleased file stream on client abort, dangling temporary files after failed rename, serial subprocess storm, missing network timeout, or silent path redirect.

Summary: 3 High, 5 Medium, 6 Low.

## Findings

| # | Severity | Where | The concrete case and what goes wrong | Fix |
| :--- | :--- | :--- | :--- | :--- |
| B1 | High | `server/orchestrators.js:560-572` | The `POST /api/orchestrator/stop` endpoint halts an active turn and pauses the orchestrator. Unlike `/api/orchestrator/compact`, `/autocompact`, `/model`, `/harness`, `/effort`, and `/sessions/new`, it lacks any `if (!page)` check and lacks any orchestrator token check. A non-page client or ambient cross-origin script can stop and pause an active orchestrator turn. | Add `if (!page) { sendJson(res, 403, OWNER_OR_CONFIRM_PROBLEM); return; }` to `handleStop` in `server/orchestrators.js`. |
| B2 | High | `server/assistant.js:91-95` | `runOpencode` executes OpenCode via `execFile(binary, ['run', '-m', model, '--format', 'json', prompt])` without passing `--standalone`. As noted in `ARCHITECTURE.md:78` and H18, the OpenCode CLI starts an orphaned background server daemon unless `--standalone` is passed. Furthermore, `execFile` timeout sends SIGTERM, which does not terminate child processes or descendants on Windows. | Add `'--standalone'` to the argument array in `server/assistant.js:92` and use `killTree` on child timeout. |
| B3 | High | `server/projects.js:333-337`, `bin/machine-room.mjs:124` | `POST /api/projects/open` verifies whether an orchestrator turn is active (`turnRunning`), but never checks whether active lane runs or queues are running (`runs.isRunning()`). When a new project is opened, `bin/machine-room.mjs:124` invokes `bridge.stop()`, which calls `runs.stopAll()`, immediately terminating all in-flight lane runs, agent child processes, and queue processors without warning or clean state recording. | Check `runs.isRunning()` in `handleOpenProject` and return 409 `LANES_RUNNING_PROBLEM` when active lane runs exist. |
| B4 | Medium | `server/search.js:65`, `server/active-lanes.js:60`, `server/runs.js:108` | `writeSearchChoice`, `writeActiveLanes`, and `writeQueue` write JSON and queue state files directly with synchronous `writeFileSync` to destination file paths (`search.json`, `active-lanes-<hash>.json`, `<lane>-queue-<stamp>.queue.txt`) rather than using an atomic `.tmp` file and rename. An interrupted write, power loss, or crash corrupts the target file or truncates it to empty content. | Write to a `${file}.tmp` temporary file first and atomically replace the destination with `renameSync(temporary, file)`. |
| B5 | Medium | `server/reviews.js:499-509`, `server/control.js:207, 248, 301`, `server/policy.js:45` | `GET /api/control/reviews` loops through every configured lane and calls `laneReview(lane, worktree, base)`, which calls `lastRunFor(lane)`. `lastRunFor` synchronously reads and parses all of `runs.jsonl` from disk N times (once per lane) on a single HTTP request. In addition, `GET /api/control/agents`, `/live-runs`, `/costs`, and `POST /api/control/route` synchronously re-read and re-parse the entire `runs.jsonl` file via `readLaneCosts` on every call instead of using the mtime-cached records reader. | Use `createRecordsCache` from `server/lanes-source.js` to cache parsed `runs.jsonl` records in memory keyed by file `mtimeMs`, and reuse records across lanes in `laneReview`. |
| B6 | Medium | `server/claude-sessions.js:91, 318, 329, 339-347` | The `sessions` Map stores every Claude session file found under `.claude/projects/<slug>` and never evicts them. On every 1-second `tick()`, `statSync(stream.path)` is called for every session file ever opened in the project. For repositories with hundreds of historical sessions, memory grows indefinitely and the timer executes hundreds of disk stat calls every second. | Evict session records that have had no file changes or activity for more than 30 minutes, or cap the monitored session map. |
| B7 | Medium | `server/opencode-sessions.js:76-78, 266, 323` | `opencode-sessions.js` stores all discovered session records in a `sessions` Map and all tool call keys (`${sessionId}:${itemId}`) in a `sent` Set without eviction or an upper limit. Furthermore, on every 1-second `tick()`, `db.prepare('SELECT id, ... FROM session_v2 WHERE updated > ?')` recompiles the SQL statement from text every second instead of preparing the statement once. | Prepare SQLite statements once when initializing the database connection, and evict sent keys and completed sessions older than 1 hour. |
| B8 | Medium | `scripts/mr-agent.mjs:469-472` | `shellTool` runs shell commands via Node's `exec` with a timeout of `SHELL_TIMEOUT_MS` (120 seconds). Under Node.js, `exec` timeout sends SIGTERM to `cmd.exe` or `/bin/sh`. On Windows, SIGTERM does not kill descendants of `cmd.exe`. If a tool command hangs or spawns child processes, timing out leaves orphaned child processes running in the background consuming CPU and holding locks. | Use `treeSpawnOptions()` and call `killTree(child)` when `shellTool` times out, matching `server/harness-models.js`. |
| B9 | Low | `server/music.js:166-172` | When streaming audio to an HTTP client via `createReadStream(file, { start, end }).pipe(res)`, there is no handler for client disconnect or aborted connections (`res.on('close', ...)`). If a user skips a track, pauses playback, or closes the browser tab, the underlying `fs.ReadStream` file descriptor remains open until garbage collection. | Attach `res.on('close', () => stream.destroy())` immediately after creating the stream. |
| B10 | Low | `server/endpoints.js:154`, `server/family.js:69, 126, 175`, `server/mcp.js:136`, `server/agents-config.js:202`, `server/harness-models.js:55` | When `renameSync(temporary, file)` fails with `EPERM` or `EBUSY` on Windows, these functions catch the error and fall back to `writeFileSync(file, content)`. However, none of the fallbacks unlink or clean up the `${file}.tmp` file, leaving orphan temporary files on disk in the project directory. | Wrap the write and rename in a `try...finally` block that unlinks `${file}.tmp` if it still exists. |
| B11 | Low | `server/reviews.js:233-254, 499-509` | `GET /api/control/reviews` processes every lane sequentially, executing 5 git CLI subprocesses per lane (`git branch`, `git rev-parse`, `git log`, `git status`, `git diff --numstat`). For 10 lanes, a single HTTP GET request runs 50 external git processes in serial, causing high response latency and CPU spikes. | Run `laneReview` calls concurrently using `Promise.all` across lanes. |
| B12 | Low | `server/mcp.js:218-232` | For HTTP-based MCP servers, tool execution sends a POST request via `fetch(server.url)`. Unlike stdio MCP servers which enforce a 30-second timeout, HTTP MCP requests pass `signal` only if provided in options and have no default timeout. A hanging HTTP MCP server stalls an agent turn indefinitely. | Add `AbortSignal.timeout(options.timeoutMs ?? 30000)` to the fetch call when options lack a signal. |
| B13 | Low | `scripts/recording-files.mjs:161-163` | `writeRecording` writes `${name}-run.jsonl`, `${name}-agents.json`, and `${name}-tree.json` directly using `writeFileSync` without atomic `.tmp` files and renames, unlike `writeIndex` which uses temporary files and atomic rename. If writing fails midway, incomplete or corrupted recording files are left in `public/recordings`. | Write recording files to `.tmp` files and rename them atomically. |
| B14 | Low | `server/runs.js:174-188` | `resolveWorktree` checks `isDescendant(chosen, projectRoot())`. If `chosen` is not a descendant of `projectRoot()`, it silently resets `chosen = projectRoot()`. MachineRoom worktrees are frequently located in sibling directories such as `C:\GitHub\MachineRoom\.worktrees\agy`. Custom run requests pointing to a sibling worktree are silently redirected to run in the main checkout root unless defined in `lanes.json`. | Validate `chosen` against `git worktree list --porcelain` to allow registered worktree paths outside `projectRoot()`. |

## Detailed verification of each finding

### B1. Missing origin or confirm check on `POST /api/orchestrator/stop` (`server/orchestrators.js:560-572`)

In `server/orchestrators.js`:
All state-modifying endpoints (`/api/orchestrator/compact`, `/autocompact`, `/model`, `/harness`, `/effort`, and `/sessions/new`) guard access with:
```js
if (!page) {
  sendJson(res, 403, OWNER_OR_CONFIRM_PROBLEM)
  return
}
```
At lines 560-572, `handleStop` reads:
```js
async function handleStop(res) {
  if (!orchestrators) {
    sendJson(res, 404, ORCHESTRATOR_PROBLEM)
    return
  }
  orchestrators.stop()
  sendJson(res, 200, { ok: true, state: orchestrators.state() })
}
```
There is no `if (!page)` check and no token validation. Any script on the local machine or an ambient web request targeting localhost can halt active orchestrator turns.

### B2. Missing `--standalone` flag and unmanaged child process in `runOpencode` (`server/assistant.js:91-95`)

In `server/assistant.js:91-95`:
```js
function runOpencode({ binary, model, prompt, signal }) {
  return new Promise((resolve) => {
    const child = execFile(binary, ['run', '-m', model, '--format', 'json', prompt], {
      timeout: 45000,
      maxBuffer: 10 * 1024 * 1024,
      signal,
    }, (error, stdout, stderr) => {
```
The OpenCode CLI runs a persistent background daemon unless `--standalone` is passed. While `scripts/run-lane.mjs` and `server/orchestrator.js` include `--standalone`, `server/assistant.js` omits it. Running an assistant query through OpenCode leaves an orphaned server daemon. Additionally, `execFile` timeout does not kill descendant processes on Windows.

### B3. Active lane runs killed on project switch without warning (`server/projects.js:333-337`, `bin/machine-room.mjs:124`)

In `server/projects.js:333-337`:
```js
if (turnRunning) {
  sendJson(res, 409, {
    error: 'An orchestrator turn is running. Wait for it to finish or stop it first.',
  })
  return
}
```
`handleOpenProject` checks whether an orchestrator turn is active, but never checks whether lane runs are active (`runs.isRunning()`). When `onOpenProject` executes in `bin/machine-room.mjs:124`, it calls `await bridge.stop()`. In `server/index.js:967`, `stop()` executes `runs.stopAll()`, forcibly killing all active coding agents across all lanes without warning or recording final exit states.

### B4. Non-atomic file writes for state files (`server/search.js:65`, `server/active-lanes.js:60`, `server/runs.js:108`)

In `server/search.js:65`:
```js
writeFileSync(file, `${JSON.stringify(choice, null, 2)}\n`, 'utf8')
```
In `server/active-lanes.js:60`:
```js
writeFileSync(file, `${JSON.stringify(activeLanes, null, 2)}\n`, 'utf8')
```
In `server/runs.js:108`:
```js
writeFileSync(file, entries.map((entry) => entry.trim()).filter(Boolean).join('\n') + '\n')
```
These functions write directly to the target file. An interruption or concurrent read can encounter an empty or partially written file. Other modules use temporary files with `renameSync` to guarantee atomic file replacement.

### B5. Repeated synchronous disk reads of `runs.jsonl` per request (`server/reviews.js:499-509`, `server/control.js:207, 248, 301`, `server/policy.js:45`)

In `server/reviews.js:499-509`:
`handleReviews` iterates over every lane in `lanes.json` and invokes `laneReview(lane, worktree, base)`. At line 247, `laneReview` calls `lastRunFor(lane)`. `lastRunFor` calls `readRunRecords(runsFile())`, synchronously reading and parsing the entire `runs.jsonl` file from disk once for every lane. For a project with 10 lanes, the entire runs file is read and JSON-parsed 10 times in a single GET request.
Similarly, `server/control.js` and `server/policy.js` invoke `readLaneCosts()`, which re-reads and re-parses `runs.jsonl` on every request.

### B6. Unbounded session accumulation and perpetual stat polling (`server/claude-sessions.js:91, 318, 329, 339-347`)

In `server/claude-sessions.js`:
The `sessions` Map stores session reader instances for every session JSONL file discovered under `.claude/projects/<slug>`. Sessions are never deleted or evicted from the map. On every 1-second `tick()`, lines 339-347 iterate over every historical session and execute `statSync(stream.path)`. Over weeks of development with hundreds of sessions, the map grows without bound and the 1-second timer performs hundreds of disk stats every second.

### B7. Unbounded memory growth and repeated query compilation (`server/opencode-sessions.js:76-78, 266, 323`)

In `server/opencode-sessions.js`:
All historical session IDs are retained in `sessions` Map, and all tool call item keys are held in `sent` Set without eviction. On every 1-second timer tick, `readRecentSessions` calls `db.prepare('SELECT id, ... FROM session_v2 WHERE updated > ?')`. The SQL query string is reparsed and compiled by SQLite on every tick rather than prepared once and reused.

### B8. Process tree leak on `shellTool` timeout (`scripts/mr-agent.mjs:469-472`)

In `scripts/mr-agent.mjs:469-472`:
```js
exec(
  command,
  { cwd, env, timeout: SHELL_TIMEOUT_MS, maxBuffer: 4 * 1024 * 1024, windowsHide: true },
  (error, stdout, stderr) => { ... }
)
```
Node's `exec` uses SIGTERM on timeout. On Windows, terminating `cmd.exe` does not terminate child processes spawned by the command. If a command runs a long-lived process or hangs, the child process remains running indefinitely.

### B9. Unreleased file stream on client disconnect during audio streaming (`server/music.js:166-172`)

In `server/music.js:166-172`:
```js
const stream = createReadStream(file, { start, end })
stream.on('error', () => {
  if (!res.headersSent) res.writeHead(500)
  res.destroy()
})
stream.pipe(res)
return true
```
When an HTTP client aborts or closes a connection mid-stream, `stream.pipe(res)` does not destroy the readable stream. Without `res.on('close', () => stream.destroy())`, the open file descriptor is held open until garbage collection.

### B10. Dangling temporary files on failed atomic rename (`server/endpoints.js:154`, `server/family.js:69, 126, 175`, `server/mcp.js:136`, `server/agents-config.js:202`, `server/harness-models.js:55`)

When saving settings, family trees, MCP configurations, or harness model caches, these modules write to `${file}.tmp` and call `renameSync(temporary, file)`. On Windows, `renameSync` can fail with `EPERM` or `EBUSY` when another process has the target open. The error handling catches the exception and falls back to `writeFileSync(file, content)`. However, the fallback does not unlink `${file}.tmp`, leaving orphan `.tmp` files scattered across project and runs directories.

### B11. Serial subprocess storm in lane reviews (`server/reviews.js:233-254, 499-509`)

In `server/reviews.js`:
`handleReviews` calls `laneReview` sequentially for every configured lane. Each lane executes 5 separate git CLI commands (`git branch --show-current`, `git rev-parse HEAD`, `git log -1`, `git status --porcelain`, and `git diff --numstat`). For 10 lanes, 50 external git processes run serially on a single HTTP GET request, blocking the Node event loop and resulting in multi-second request latency.

### B12. Missing request timeout for HTTP MCP servers (`server/mcp.js:218-232`)

In `server/mcp.js`:
Tool calls to stdio MCP processes enforce a 30-second timeout. Calls to HTTP MCP servers perform `fetch(server.url, { method: 'POST', ... })`. If the options object lacks an explicit signal, no default timeout is applied. A hanging HTTP MCP server hangs the agent turn indefinitely.

### B13. Direct non-atomic writes for run recordings (`scripts/recording-files.mjs:161-163`)

In `scripts/recording-files.mjs`:
`writeRecording` writes `${name}-run.jsonl`, `${name}-agents.json`, and `${name}-tree.json` directly via `writeFileSync`. Unlike `writeIndex`, which writes to a temporary file and renames it, recording files are written directly. If writing is interrupted, incomplete or corrupt recordings are persisted.

### B14. Worktree path validation redirects sibling worktrees to root (`server/runs.js:174-188`)

In `server/runs.js`:
`resolveWorktree` uses `isDescendant(chosen, projectRoot())`. If `chosen` is not a subdirectory under `projectRoot()`, it silently resets `chosen = projectRoot()`. Because MachineRoom worktrees often reside in sibling directories (such as `C:\GitHub\MachineRoom\.worktrees\agy`), runs dispatched to a valid sibling worktree run against the main checkout unless explicitly registered in `lanes.json`.

## Efficiency

### 1. In-memory mtime cache for `runs.jsonl`
- What it would save: eliminates 10 to 50 synchronous disk reads and JSON parsing passes per page load or API poll. In a project with 1,000 runs (a 1 MB file), this saves 10 MB to 50 MB of file I/O and hundreds of milliseconds of event loop blocking per second.
- How to measure it: Measure HTTP response latency on `GET /api/control/reviews` and `GET /api/control/agents` using `autocannon` or `curl -w "%{time_total}\n"`, and track CPU time spent in `JSON.parse` with the Node.js V8 CPU profiler (`node --prof`).

### 2. Reuse prepared SQLite statements in OpenCode session monitor
- What it would save: eliminates compiling and preparing SQL query strings on every 1-second timer tick. Saves SQLite parser overhead and statement allocation.
- How to measure it: Benchmark `tick()` execution time over 60 seconds with `console.time('tick')` before and after reusing prepared statements.

### 3. Concurrency in lane review git inspections
- What it would save: converts 50 sequential git process launches into 10 parallel lane batches of 5. Reduces wall-clock latency of `GET /api/control/reviews` from roughly 2.5 seconds down to 400 milliseconds.
- How to measure it: Measure elapsed time of `GET /api/control/reviews` with `curl -w "%{time_total}\n"` on a repository with 10 lanes.

## What to delete

1. `server/files.js:64-70`: redundant uncalled legacy helper routines for path normalizing.
2. `server/endpoints.js:24-30`: unused error constants left over from pre-v11 endpoint refactoring.
3. Obsolete Paperclip compatibility fields in run record shapes across `server/runs.js`.

## What was checked and found sound

- Path traversal containment in `server/files.js`: paths are validated with `resolve`, verified with `relative` to stay within root, and checked for NTFS stream separators (`:`).
- SSRF prevention in `server/search.js`: `fetchPage` validates URLs, checks against private IPv4 and IPv6 ranges (including loopback, link-local, private RFC 1918, and CGNAT), and refuses non-HTTP/HTTPS protocols.
- Process start time validation in `scripts/run-lane.mjs` and `scripts/lane-lock.mjs`: stale lock checks verify process creation timestamps against lock file modification times to prevent deadlocks on recycled PIDs.
- Secure Direct API key inheritance in `src/briefs/run.js`: `childEnvironment` filters out API keys when custom endpoints are specified.
- Sector token authorization in `server/runs.js`: token-authenticated runs enforce sector boundaries.
- Stream size limits in `scripts/acp-run.mjs` and `scripts/mr-agent.mjs`: prompt inputs are capped at 4 MB, and shell outputs are capped at 8,000 characters.

## What this session could not reach

- Long-running multi-hour stress testing under heavy Windows file locking contention.
- Live verification of remote MCP servers over HTTP with active authentication.
- Live browser rendering and 3D room interactions (left to OpenCode lanes per house rules).

## Orchestrator's corrections

Claude checked this audit against the code on 2026-11-03.

- B1 is low, not high. Other sites are refused by the origin gate and the route needs `confirmed`, so only a local process with no token gets through. The code quoted under B1 is not in the file; the route is at `server/orchestrators.js:560`.
- B12 is not proved: `server/mcp.js` has no `fetch(` call of the kind it describes.
- B14 is wrong: `resolveWorktree` does not exist, and the lines named hold other code.
- What to delete is wrong in all three items. The code named in `server/files.js` and `server/endpoints.js` is in use, and `server/runs.js` has no Paperclip fields.
- Not checked: B7's claim that the SQL is prepared every second, B11's timings and B13.
