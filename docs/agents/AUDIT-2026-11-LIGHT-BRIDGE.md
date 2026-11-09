# Audit, November 2026: what the bridge holds and does on a big project

Date: 2026-11-10
Author: OpenCode 2 (DeepSeek V4.1 Flash)
Branch: `feat/p20-hunt-what-the`
Brief: P20
Ref: `refs/heads/main` at `ff8da960` (0.1.401)

## What was measured

A seeded checkout of 200,000 files in 20,000 folders, made with
`npm run scale-live -- --files 200000 --folders 20000 --seed 20 --keep`.
The bridge ran in a child process on it with the lane and session sources on,
and with an empty runs folder unless a row says otherwise.
The three pages were three `/events?tree=folders&since=1` streams plus the page
polls from `src/Stage.jsx` and `src/ui/Hud.jsx` at their real intervals.
The machine was shared with the other lanes, so wall times are inflated; the
bridge's own CPU share is its `process.cpuUsage()` over the wall window.

Timing numbers are the median of three where three were taken, else the measured
value is given with its range. Memory is `process.memoryUsage()` and
`v8.getHeapStatistics().used_heap_size` after a forced collection.

At rest, with an empty runs folder and three pages:

| Point | RSS | used heap |
| --- | --- | --- |
| after start, before the first page (first tree read done) | 138.5 MB | 32.7 MB |
| after `GET /api/tree` (plain, 200,001 paths, 14.7 MB answer) | 182.2 MB | 55.3 MB |
| with three pages on `/events?tree=folders&since=1` | 223.4 MB | 55.4 MB |
| after a burst of 2,000 new files, settled (4 versions published) | 316.1 MB | 121.5 MB |
| after 10 minutes at rest | 207.7 MB | 122.8 MB |

The heap did not grow during the ten minutes: 124.5 MB at minute 1, 122.8 MB at
minute 10. The 90 MB between start and rest is the four retained file lists.
The RSS fell back from the burst's 316 MB as V8 released pages; the heap kept
the lists.

Bridge CPU share over three 60 second windows at rest: 2.67, 1.02 and 1.17
percent of one core. Median 1.17 percent. The first window holds the pages'
first `GET /api/git` and `GET /api/control/reviews`.

A full `readTree` on this checkout (`git ls-files -z`, sort and map) took 4.25 s
median over eight reads (3.9 to 4.9 s). One cold isolated read took 10.6 s; the
eight bridge reads above are the number to trust.

## Five largest holders at rest

Measured each structure in a fresh Node process, with a collection before and
after, and by the bridge's own counters.

1. The four retained project file lists: 90 MB of heap. One list of 200,001
   paths costs 21.0 MB (a second copy measured in isolation); the bridge's used
   heap rose from 32.7 to 122.8 MB after four published versions. `lastFiles`
   and every page's `treeSent` point into these four arrays, so they add no
   fifth copy.
2. V8 and the module graph: about 11.7 MB of used heap at start (32.7 MB minus
   the 21 MB list), plus about 80 MB of RSS outside the JS heap (code, V8
   committed pages, libuv, the SQLite native pages, git pipe buffers).
3. Transient read and answer buffers: the plain answer is a 14.7 MB JSON
   string, `packTree` builds a 14.4 MB structure, and one read holds the
   `git ls-files` stdout plus the split and sorted copy, about 21 MB net. The
   RSS high-water after the burst was 316 MB.
4. The run-record caches: `runs.jsonl` was 291,390 bytes and 575 records; one
   parsed array costs 0.42 MB, so the lane source's `recordsCache` and
   `cachedRunRecords` keep about 0.84 MB together, and both grow with every run.
5. The recursive fs watcher and the three SSE clients: the watcher cost 0.6 MB
   RSS for 20,000 folders, and three idle pages held 0.07 MB of heap and no
   history frames.

## Findings (most costly first)

| # | File and line | What it costs | Smallest fix |
| --- | --- | --- | --- |
| 1 | `server/doctor.js:219-231`, `server/index.js:1114`, `server/index.js:712`, `server/index.js:70` and `1008-1011` | The whole project is listed three times before a page draws: the doctor's read, the bridge's first read (awaited before `listen`), and the page's `GET /api/tree` after the 1 s `TREE_REUSE_MS` window. Measured: `machineroom up` printed its address after 10.57 s; a page-like folder GET 1.6 s later waited 4.73 s (4.0 s read plus 0.7 s answer), so about 15.3 s to the first drawn room. If the page asks within 1 s, the third read is skipped and the answer takes 0.53 to 0.58 s. | Hand the doctor's file list to the bridge, listen before the first read, and let the plain shape reuse `lastTree` at any age while a read is in flight. |
| 2 | `server/index.js:697-704`, `722-726`, `655-695` | Every watcher event re-lists the whole project. Measured: a 12.4 s burst of 2,000 files started 6 full reads (4 publishes, 2 reads that found no change); the last write reached all three pages 5.82 s later. `scale-live` measured 4.53 s for one new file and 5.16 s for the last of 2,000. | On a watcher event, read only the changed paths (`git status --porcelain -z` or a listing of the watched folder) and merge them into `lastFiles`; keep the full read for start and a slow resync. |
| 3 | `server/index.js:69`, `575`, `583-594`, `616-622`, `624-653` | Four full lists are kept (`TREE_VERSIONS_KEPT`), one per published version, and every page holds a reference. Measured: 21.0 MB per 200,001-path list; used heap 32.7 MB after start, 122.8 MB after four versions, still 122.8 MB after 10 minutes. Four versions are about 84 MB at 200k and about 210 MB at 500k by the same bytes per path. This is a new finding, not in the `GROWTH` table, which counts records and parsers rather than the file tree. | Keep the newest version only, or cap the versions by bytes (for example 32 MB) and keep a small path diff for a late page. |
| 4 | `server/lanes-source.js:366-427`, `373`, `271` and `637`, `279-281`, `589-597` | The lane scan runs five times a second (`pollMs` 200) even while fs.watch is armed. Measured on the real runs folder (739 entries, 584 `.log`, 437 MB): the source's `tick()` median 5.02 ms (p95 6.26), so 25 ms a second, 2.5 percent of one core; with an empty folder it is 0.80 ms. The same scan costs `readdirSync` 0.57 ms and `readAllLanes` 1.21 ms every time, and 584 lagging logs are stat'ed every 10 s. Still open from `GROWTH` finding 2: a lagging log is only removed when it grows or its stat fails. | Scan on the watcher event with a 2 s timer fallback, cache `allAgents` for 5 s, and evict a lagging entry after 10 minutes. |
| 5 | `server/index.js:144-168`, `1008-1036` | The folder-shaped answer is packed and gzipped on every request even when `lastTree` is fresh. Measured: 567,404 gzipped bytes from 3,103,510 uncompressed bytes, in 463 to 579 ms per request; `packTree` alone is 295 ms and 14.4 MB of transient heap. It is the page's first blocking read. | Cache the packed body and the gzipped bytes per `treeVersion`, and build them once at publish. |
| 6 | `server/git.js:179-320`, `server/index.js:948`, `src/Stage.jsx:966` | One uncached `GET /api/git` spawns eight git processes (`rev-parse` twice, `branch`, `status --porcelain -z`, toplevel, worktree list, `for-each-ref`, `log`). Measured: 33 polls, 1.02 to 2.31 s each, most 1.1 to 1.8 s; two reads 1.1 s apart took 1.02 and 1.14 s because the cache is 1 s. Three pages share one computation per minute, but each costs about 1.5 s of git CPU and eight spawns. | Add a light status route (branch, HEAD, dirty count) for the minute poll, load the branch and commit graph when the Repository panel or Source control opens, and raise the cache to 10 s. |
| 7 | `server/index.js:170-179`, `1077-1085` | A page join builds a Set of every path and scans it even when the client's `since` is the current version. Measured: a 200k Set build is 241 ms and 5.2 MB; opening three pages added 578 ms of bridge CPU (1,546 to 2,124 ms) and sent no tree event. | When `since` is the current version, write nothing and send nothing without building the Set; diff only when the version is older. |
| 8 | `server/opencode-sessions.js:118-134`, `365-404`, `432-444`, `server/sessions-source.js:4` and `44` | The OpenCode reader selects every session from `session_v2` every second, for every project. Measured on the live 417.8 MB database with 578 sessions: first tick 7.6 ms, then 1.34 ms per tick; the whole sessions source with the real runs folder is 2.94 ms per second, about 0.3 percent of a core, and it grows with every session ever recorded. | Add `WHERE time_updated > ?` with a high-water mark, and poll every 5 s while no run is open. |
| 9 | `server/claude-sessions.js:104-143`, `419` | The Claude reader lists the runs folder and stats every `.meta.json` every second, even when nothing changed. Measured with 739 entries and 27 meta files: 1.20 ms median per tick (1.96 p95), 0.7 s of CPU in 10 minutes. The parse cache from `GROWTH` finding 1 is in place, so only the repeated list remains; still open in part. | Rescan the meta folder every 10 s or watch it, and reuse that list for the same second. |
| 10 | `server/lanes-source.js:130-213`, `server/runs.js:169-235`, `server/lane-tasks.js:179`, `server/reviews.js:313-321` | The run records are parsed and kept twice, in the lane source's `recordsCache` and in `cachedRunRecords`, and `lastRunFor` filters the whole list once per lane. Measured: 575 records, 291,390 bytes on disk, 0.42 MB per parsed array, about 0.84 MB for both, growing with every run. `GROWTH` finding 12 is fixed for re-reading from byte 0 (both tail by offset now) but not for retention. | Use one shared cache per file, and keep only the newest record per lane plus the month's costs. |
| 11 | `server/network.js:63-113`, `src/Stage.jsx:1004` | While a page is open the bridge opens a TCP connection to `1.1.1.1:443` every 30 s, and keeps it for up to 3 s when the machine is offline. Measured: 2 ms when the cached answer is fresh, 90 to 450 ms when the check runs; three pages cause one check per 30 s. | Raise the interval to 60 s, or check only while an agent works. |

From the earlier tables: `GROWTH` findings 1, 2 and 12 are still open in part and
appear as rows 9, 4 and 10 above. `GROWTH` findings 3, 4, 12's re-read and 13 are
fixed in this tree (`server/orchestrator.js:753`, `server/runs.js:169`,
`server/index.js:263-289`). `FRAME` is page work and was not remeasured here.

## The work the bridge repeats at rest

| Work | Every | Measured cost |
| --- | --- | --- |
| Lane log scan, real runs folder | 200 ms | 5.02 ms, so 25 ms a second (2.5 percent of one core) |
| Lane log scan, empty runs folder | 200 ms | 0.80 ms, so 4 ms a second (0.4 percent) |
| Sessions tick (Claude and OpenCode) | 1 s | 2.94 ms, so 0.3 percent; Claude 1.20 ms, OpenCode 1.34 ms |
| OpenCode `session_v2` scan | 1 s | 1.34 ms on 578 sessions; the first tick 7.6 ms |
| Claude `.meta.json` scan | 1 s | 1.20 ms on 739 entries and 27 meta files |
| Network check | 30 s | one TCP connect; 2 ms cached, 90 to 450 ms when it checks |
| `GET /api/git` from each page | 60 s | 1.02 to 2.31 s and eight git processes; one computation shared by pages within 1 s |
| Page polls (orchestrators, family, agents, costs) | 60 s | 100 to 438 ms wall each on the shared machine; 33 of each per page in 10 minutes |
| `GET /api/control/reviews` | 300 s | 247 to 642 ms per page, 9 in 10 minutes |
| SSE keepalive | 15 s | one short write per page |

## The start path from `machineroom up`

1. `bin/machine-room.mjs:201-213` runs the doctor. `runDoctorWithProject`
   (`server/doctor.js:240-251`) calls `readProjectLine` (`server/doctor.js:219`),
   which calls `readTree` once and builds a Set of every folder to print
   `The project holds 200001 files in 20001 folders.` Measured 4.64 s.
2. `createBridge.start()` (`server/index.js:1109-1130`) awaits `startWatcher`
   (`server/index.js:706-715`), which starts a second full read before the port
   listens. Measured 3.56 s, so the address printed at 10.57 s in total.
3. The page's `discoverBridge` (`src/live/bridge.js:10-20`) asks for the folder
   shape. If more than 1 s has passed since the bridge's read, `TREE_REUSE_MS`
   (`server/index.js:70`) has expired and `GET /api/tree` lists the project a
   third time (`server/index.js:1011`), then packs and gzips it. Measured 4.73 s
   for a page-like request 1.6 s after the address. The browser bundle load is
   extra and was not measured by eye.

So a page draws after three full listings, about 15 s on this checkout, and the
bridge does not answer any request until the first listing is done.

## Proposed briefs

**L1. Read the project once, then send only what changed.**
Files: `server/index.js`, `server/doctor.js`, `src/live/tree.js`, `tests/`.
Pass the doctor's file list into the bridge so its first read is reused. Listen
before any read. Keep one file list plus a small diff list, cap the retained
versions by bytes, and cache the packed and gzipped folder answer per version.
On a watcher event, list only the changed paths and publish a delta. Tests: one
new file, a 2,000-file burst, two pages, a late page whose `since` version is
gone, and a bridge that answers before the first read finishes.

**L2. Make the idle bridge cheap.**
Files: `server/lanes-source.js`, `server/claude-sessions.js`,
`server/opencode-sessions.js`, `server/sessions-source.js`, `server/network.js`,
`tests/`.
Scan the runs folder on the watcher event with a 2 s fallback, cache
`allAgents` for 5 s, and evict a lagging log after 10 minutes. Give the OpenCode
reader a `time_updated` high-water mark and poll it every 5 s when no run is
open; rescan Claude's meta folder every 10 s. Check the network every 60 s.
Tests: 500 synthetic old logs, a temp sqlite database with 500 sessions, and a
quiet folder that must not grow the CPU share.

**L3. Split the git poll from the git graph.**
Files: `server/git.js`, `server/index.js`, `src/Stage.jsx`,
`src/control/client.js`, `tests/`.
Add a light status route with the branch, HEAD and dirty count and use it for
the minute poll. Load branches, changes and the 200-commit graph only when the
Repository panel or Source control opens, and raise the cache to 10 s. Tests:
the status route must not run `for-each-ref` or `log`, and the panel must still
show the graph.

## What could not be measured

- The heap inside the bridge by retainer, not by structure: the five holders
  above were measured one structure at a time, not from a heap snapshot.
- The browser's own load and draw: the brief leaves checks by eye to the
  orchestrator. The 15 s start figure is the bridge's part only.
- The lane and session sources with a lane actually running: the runs folder was
  empty in the main rest run (the real folder was used only for the scan
  micro-measure). A run adds log reading and SSE frames on top of the numbers
  above.
- More than 200,000 files: the 500,000 run belongs to P19. The bytes per list
  and per version are linear in the path count.
