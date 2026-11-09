# Audit 2026-11: The Page's Start on a Large Project

Version 0.1.401. Written on 2026-11-10. This hunt follows one project's file list from the bridge's answer to the first drawn room, on the trees `makeScaleTree` gives at 40,000 and 200,000 files. It uses no subagents and changes no code.

## How it was measured

A temporary Node 24.22.1 script under `%TEMP%`, run with `--expose-gc`, one process per size. Each stage takes the cold path a page takes:

1. `packTree` and `JSON.stringify` the answer the bridge sends for `GET /api/tree` with the folders shape, then `gzipSync` it. This runs in the bridge's process, but the page waits for it.
2. `JSON.parse` that answer.
3. `readFileList` from `src/live/tree.js`.
4. `makeTree` from `src/model/paths.js`.
5. `createState` from `src/model/state.js`.
6. `viewInput` from `src/engine/cards.js`, the cards' cached file list.
7. `cardPlan` from `src/engine/cards.js` with `alwaysDepth` 2, which calls `planFolderView` and `layoutRing`.
8. Then the two Stage memos (`assistantPaths`, `knownSoundRef`), `createPipeline` from `src/model/pipeline.js`, the spread at `Stage.jsx:1218`, and a 500 frame session recorder.

`global.gc()` runs twice before every `process.memoryUsage().heapUsed` reading. Time is one cold call in a fresh process, from `performance.now()`. Warm means the second call with the same input. The numbers repeated within 10 percent across two runs per size. The seeded tree is 200,000 files in 20,000 folders, or 40,000 in 4,000, up to 12 deep, seed 20261021. It is narrow at the top: the root has 9 child folders and 11 files at 200,000 files, so the first plan draws 37 cards, not hundreds. The whole-file structures below cost the same on a wide tree, but the card and DOM counts would be higher.

The probe measured Node only. React render, style and DOM work are not in these numbers, so a browser will be slower than the totals below. That part is left to the orchestrator.

## Findings

Most costly first, at 200,000 files, with the 40,000 number beside it where it helps. Bytes are retained heap unless the row says transient.

| # | File and line | What it builds | 40,000 files | 200,000 files | Smallest fix |
| --- | --- | --- | --- | --- | --- |
| 1 | `src/model/paths.js:89-111` | `makeTree` copies and sorts the list, then splits every path and joins every new folder prefix to fill `dirs` | 57 ms cold, 45 ms warm, +1.6 MB | 456 ms cold, 325 ms warm, +9.7 MB | Take the folder list from the folders answer, which already names each folder and its parent, and sort the received array in place |
| 2 | `src/model/folderView.js:105-121`, used at `src/model/folderView.js:173` and `238-244` | `indexFiles` walks every file into `fileSet`, `filesIn` arrays, `children` and `fileCount` before the first plan | 64 ms, +2.9 MB | 411 ms, +14.8 MB | Index one folder when the plan first draws it, from the prefix range in the sorted list |
| 3 | `src/model/pipeline.js:28-30` with `src/model/fileIndex.js:34-55` | `createPipeline` copies files and dirs and builds two complete `fileIndex` entries at mount; only the file index is ever read, and only from the first Hermes line | 18 ms, +5.8 MB | 279 ms, +25.3 MB | Drop the dirs index, which nothing reads, and build the file index at the first Hermes line or in an idle callback after the first frame |
| 4 | `server/index.js:1016` with `server/index.js:144-168` | Every folder-shaped `GET /api/tree` packs the whole tree, stringifies it and gzips it again | 63 ms, 835 KB (196 KB gzip), +4.9 MB transient | 367 ms, 4.13 MB (1.07 MB gzip), +26.2 MB transient | Keep the packed body and its gzip beside `treeVersion`, and rebuild only when the version changes |
| 5 | `src/model/state.js:47-57` | `createState` makes a Map entry and a counters object for every file | 10 ms, +4.8 MB | 95 ms, +22.4 MB | Keep a counters object only for a file an agent touches, and read the file list from `tree.files` |
| 6 | `src/live/tree.js:31-46` with `src/model/paths.js:90` | The parsed folders answer, the flat path array and `makeTree`'s sorted copy are alive together | 9 ms, +6.7 MB peak | 45 ms, +33.4 MB peak | Empty each run in `readFolders` as soon as it is read, and sort the returned array in place |
| 7 | `src/Stage.jsx:694-697` | `assistantPaths` builds a Set and an array over every file and folder, again on each new file | 4 ms, +0.3 MB | 75 ms, +1.7 MB | Build it when the assistant opens, from the state maps |
| 8 | `src/Stage.jsx:670-673`, `688-691` | `knownSoundRef` builds a filtered array and a Set of every file | 4 ms, +1.3 MB | 49 ms, +5.0 MB | Keep a Set of missing paths only, and ask `state.files` for the rest |
| 9 | `src/model/folderView.js:265-282` with `src/engine/cards.js:338` | The plan builds a key string for every drawn folder and an item object for every file, with `limitItems: false`, while a card draws 6 rows | 8 ms inside the plan, 323 items | 15 ms inside the plan, 519 items over 37 views, worst view 27 | Build items up to the card limit plus a count, and extend on scroll |
| 10 | `src/Stage.jsx:1218` | Every new file spreads all `state.files` keys into a new array for `pipeline.learn` | 3 ms, 0.32 MB per file | 24 ms, 1.6 MB per file | Pass only the paths the tree event added |

Row 10 is finding 14 of `AUDIT-2026-11-GROWTH.md`, and it is still open: the code at `src/Stage.jsx:1218` still spreads every key, and `pipeline.learn` only needs the paths that are new. Finding 20 of that table is also still open: `src/live/tree.js:4` keeps the `versions` Map with no cap. It holds one entry per bridge address, so it is a few bytes and is not in the table. Finding 7 is fixed: `createSessionRecorder` now keeps a head index and compacts only after 1,024 entries, so a push no longer copies the array. Finding 10 is partly fixed: `sweep` at `src/model/pipeline.js:40-49` drops a run that has been idle for 30 minutes, so `parsers` and `lastRunTime` are bounded by the runs of the last half hour, though they still have no size cap.

## The start in order

Cold time and new retained heap, Node, the same process per size.

| Stage | 40,000 files | 200,000 files |
| --- | --- | --- |
| `JSON.parse` of the folders answer | 5 ms | 26 ms |
| `readFileList` | 4 ms | 19 ms |
| `makeTree` | 57 ms | 456 ms |
| `createState` | 10 ms | 95 ms |
| `viewInput` (cards' cached list) | 1.5 ms | 8 ms |
| `assistantPaths` | 4 ms | 75 ms |
| `knownSoundRef` | 4 ms | 49 ms |
| `cardPlan` (plan, card sizes, layout) | 72 ms | 426 ms |
| `createPipeline` (after the first frame) | 18 ms | 279 ms |
| Total before the first card plan | 0.16 s | 1.15 s |
| Total with the pipeline | 0.18 s | 1.43 s |

The 200,000 file total is over the 1 second load budget `scripts/scale-probe.mjs` uses, before any React work. At 40,000 files the page is well inside it. The retained page stages sum to 17.3 MB at 40,000 files and 81.1 MB at 200,000, about 432 and 405 bytes per file, on top of the path strings themselves.

## How many copies of the path list the page keeps

After the first draw, 13 structures hold every file path:

1. `tree.files`, the sorted array (`src/model/paths.js:105`).
2. The keys of `state.files` (`src/model/state.js:48-54`).
3. The cards' `cachedFiles` array (`src/engine/cards.js:88-90`).
4. The folder plan's `fileSet` (`src/model/folderView.js:68`, filled by `addFile` at `65-70`).
5. The folder plan's `filesIn` arrays, one entry per file (`src/model/folderView.js:75-78`).
6. The pipeline's `ctx.files` array (`src/model/pipeline.js:28`).
7. The pipeline's `knownFiles` Set (`src/model/pipeline.js:155`).
8. The file index's `known` Set (`src/model/fileIndex.js:14`).
9. The file index's `paths` array (`src/model/fileIndex.js:16`).
10. The file index's `ranks` Map keys (`src/model/fileIndex.js:15`).
11. The file index's `bases` arrays, one entry per file (`src/model/fileIndex.js:14`, `40-42`).
12. `assistantPaths` (`src/Stage.jsx:694-697`).
13. `knownSoundRef` (`src/Stage.jsx:670-673`).

A 14th appears while the folder inspector is open: `inspectorTree` copies both the file and the folder lists (`src/Stage.jsx:700-707`). A 15th is made and dropped on every new file: the spread at `src/Stage.jsx:1218`. The folder lists have a similar set: `tree.dirs`, `state.dirs` keys, the plan's `folders` and `children`, the pipeline's `ctx.dirs` and `knownDirs`, and the dirs index. The strings are mostly shared, but every Set slot, Map key and array slot is paid for, and that is what the 405 bytes per file buys.

## What the first drawn room does not need yet

- The whole-file folder index (row 2) is built to draw 37 cards. The first frame needs only the root and the folders at depth 1 and 2.
- The pipeline's two indexes (row 3) are built at mount, but nothing calls `resolveKnown` until a Hermes read arrives, and nothing reads the dirs index at all.
- `assistantPaths` (row 7) is used only when the assistant opens. `knownSoundRef` (row 8) is used only from the first touch.
- The plan builds 519 item objects, and the cards draw 219 rows. The rest is for scrolling.
- `readFileList` makes a flat array of full paths, then `makeTree` copies and sorts it again. One of those two arrays is avoidable.

## What is cheap

- `layoutRing`: 0.4 ms for 37 cards, 0.2 ms for 25.
- Card sizes and the ring layout on top of the plan: 15 ms at 200,000 files, 8 ms at 40,000.
- The cards themselves: 37 cards and 219 rows, about 1,200 DOM nodes and 37 occluder geometries. This tree is narrow at the top, so the first room is small. A project with 12 or more top-level folders each full of children builds more cards, and that belongs to the browser hunt.
- The session recorder: 500 history frames cost 0.2 MB with 200 byte chunks and 2.1 MB with 4 KB chunks, because it keeps a reference to each frame plus a small wrapper. The head index means no per-push array copy.
- A warm `planFolderView` with the same list: 0.6 ms, so a touch that changes no folder content is cheap.

## Proposed briefs

**B1. Plan the first cards from a folder index built on demand.**
Files: `src/model/folderView.js`, `tests/folder-view.test.js`, `scripts/scale-probe.mjs`.
Replace the eager `indexFiles` walk with an index that is filled for one folder when the plan first draws it, using a binary search for the folder's prefix range in the sorted list. Keep `fileSet`, `filesIn` and `fileCount` for folders already drawn, and keep the `folderKey` cache. Add a scale probe stage that plans a 200,000 file seeded tree cold and prints the call time, the view count and the item count. Expected: the same 37 views and 519 items, and the first call under 40 ms instead of 411 ms. A test proves one touch inside one folder still updates only that folder's view.

**B2. Send the folder answer once, and take its folder list.**
Files: `server/index.js`, `src/model/paths.js`, `src/live/tree.js`, `src/App.jsx`, `tests/tree.test.js`, `tests/paths.test.js`, `scripts/scale-probe.mjs`.
Keep the packed body, the JSON payload and its gzip beside `treeVersion`, and rebuild them only when the version changes. Pass the folders answer's `folders` pairs into `makeTree` as `dirs`, and sort the received array in place when it is not sorted. Expected: a repeated folder answer drops from 367 ms to a copy, the first answer from 456 ms to under 100 ms at 200,000 files, and 9.7 MB less retained heap. A test checks that a tree built with a folder list and one built from paths alone have the same `files` and `dirs`.

**B3. Build the whole-file indexes and Sets when they are first used.**
Files: `src/model/pipeline.js`, `src/Stage.jsx`, `tests/live.test.js`.
Move the two `indexFor` calls out of `createPipeline`: drop the dirs index, which nothing reads, and build the file index at the first Hermes line or in an idle callback after the first frame, so the room draws first. Build `assistantPaths` when the assistant opens, and replace `knownSoundRef` with a Set of missing paths plus a `state.files` lookup. Expected: about 400 ms and 32 MB less at 200,000 files before the first frame, and no change for a room with a small tree. A test checks that a Hermes line resolves a known file through the lazy index.

`createState` (row 5, 22.4 MB) is the next candidate after these three.

## The orchestrator's corrections

The orchestrator read the findings back against the code on 2026-11-10.

- Rows 1, 2, 4, 7, 8 and 10 hold as written.
- Row 3 is half right. Both indexes are read: every shell command reads the file index through `touchesForCommand` (`src/model/parsers/common.js:60`, `src/model/commands.js:150`), and a listing command such as `ls` or `dir` reads the folder index (`src/model/commands.js:159`), not only a Hermes line. `indexFor` already builds an index on its first call, so removing the two calls at `src/model/pipeline.js:29-30` moves the cost to the first shell command, about 280 ms at 200,000 files on one activity, over the 16 ms budget. B3 should build them in an idle callback after the first frame, not at first use, and keep the folder index.
- A cost the table misses: `src/model/parsers/common.js:45` checks whether a path is a folder with `ctx.dirs.includes`, a scan of every folder for each path a tool names.
- These numbers were taken while four other lanes ran, so they are high, but the ranking stands.
