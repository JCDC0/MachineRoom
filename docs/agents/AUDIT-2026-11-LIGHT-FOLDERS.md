# Heavy folders at the lowest depth, November 2026

Date: 2026-11-10
Version: 0.1.401
Branch: `feat/p22-hunt-heavy-folders`
Brief: Task P22
Author: OpenCode 4

## Scope and method

The tree is `makeScaleTree` with its default 40,000 files and 4,000 folders, plus one top-level `heavy-files` folder with 50,000 files directly and one `heavy-folders` folder with 5,000 folders directly. Each of the 5,000 child folders holds one file, because the tree builder only sees a folder through its files. `makeTree` then holds 95,000 files and 9,003 folders, 7 of them top level.

A throwaway script outside the repository ran each scenario in its own Node 24.22.1 process and called `global.gc()` before each timed operation. The machine was shared with other lanes, so the spread is wide. I give the median and, where it matters, the smallest sample. No browser was started. The DOM counts come from `createCards` with the fake element the card tests use (`tests/cards-virtual.test.js:7-65`), so the node counts are exact for the code, not a browser measurement.

## Findings

| # | Finding | Where | Cost | Smallest fix |
| ---: | --- | --- | --- | --- |
| 1 | A top-level folder is drawn at every depth, even 0, and its full item list is built. Root is always in focus, so its first three children are added to `drawn` and the 50,000 file folder is one of them. | `src/model/folderView.js:236-244`, `src/engine/cards.js:72-77`, `src/engine/cards.js:338` | Cold plan 258 to 435ms for 95,000 files; depth 0 is not cheaper than depth 1. | Add root's first children only when the depth is at least 1, or draw only root until the owner opens another card. |
| 2 | The first plan builds the whole file index and every card view before the first frame. | `src/model/folderView.js:105-121`, `src/model/folderView.js:276-308`, `src/engine/cards.js:334-348` | 258 to 435ms for 95,000 files; 165 to 287ms for a plain 40,000 file tree. | Build the index and the first plan in an idle chunk or a worker, root card first. |
| 3 | A touch inside the 50,000 file folder replans it and rebuilds its card rows. | `src/model/folderView.js:246-282`, `src/engine/cards.js:730-764` | Medians of 50 to 116ms per card update, minimum 36.6ms, one 734ms sample; plan alone 15.1 to 21.2ms. | Cap a folder at 2,000 items and keep the touched file first. |
| 4 | `folderKey` walks every child and file and joins them into a cache key on each touch. | `src/model/folderView.js:265-274` | About 1.3MB per touch for 50,000 files: every path plus a rank character. The row key alone measured 1,199,999 bytes. | Key on `folderVersion` plus the ranks of only the focused and touched paths. |
| 5 | `cards.js` maps every path, joins a key and builds a full path to place Map on each plan change. | `src/engine/cards.js:739-750` | 12.3 to 28.5ms, a 1,199,999 byte key and a 50,000 entry Map per touch. | Keep `view.items` as the row list, build `rowIndex` lazily, and key on the items array. |
| 6 | `itemsFor` builds and sorts all 50,000 entries on each rebuild. | `src/model/folderView.js:246-261` | 3.1 to 3.6ms for a path-only sort; the real comparator also reads two Sets and a Map per comparison. | Bucket by rank and merge the already-sorted file and folder lists. |
| 7 | The plan and the card keep about 14MB while the 50,000 file folder is drawn. | `src/model/folderView.js:276-311`, `src/engine/cards.js:751-759` | Plan and index for the whole tree 10,742,824 bytes; card rows 3,434,992 bytes. | Cap the items and drop a cached view's items when the folder is not drawn. |
| 8 | `items = all.slice()` copies 50,000 references on each rebuild. | `src/model/folderView.js:282` | 0.15 to 0.19ms and about 0.4MB per touch. | Use `all` directly when `limitItems` is false. |
| 9 | A write that adds one file replans the 50,000 file folder. | `src/model/state.js:137-141`, `src/engine/cards.js:137-145` | 22.3 to 51.8ms for apply, `viewInput` and `cardPlan`. | The 2,000 item cap removes most of it. |
| 10 | Bulk names do not keep the item list out of the plan. `bulkPath` only stops child cards at the next depth. The seven names in the brief all return false from `isBulkFolder`. | `src/model/folderView.js:10-20`, `src/model/folderView.js:143-147` | `assets`, `node_modules` and `.venv` with 50,000 files each cost 18.5 to 19.2ms per touch, the same as `heavy-files` at 19.1ms. | Apply the item cap to every folder; use the name list only for the child card rule. |
| 11 | The start state and the first file list are built in full. | `src/model/state.js:47-73`, `src/engine/cards.js:87-97` | `createState` 27 to 55ms, median 43.6ms; first `viewInput` 12 to 23ms, median 16.3ms. | Share the bridge's path list or build both lazily. |
| 12 | A Hermes read scans the whole dirs array to test whether the path is a folder. | `src/model/parsers/common.js:45` | 9,003 `includes` checks per read, 13.8ms per 1,000; warm read 0.021 to 0.026ms. | Pass a Set in the pipeline context. |

## What a card with 50,000 items builds

At `maxFiles` 6, `cardRows` is 6 and the card is 196 pixels tall. `rowWindow(50000, 0, 132)` is virtual and returns first 0 and last 10, so 10 rows: 6 visible rows and 4 overscan rows. The bottom spacer is 1,099,780 pixels.

The first draw and each touch build the same four things:

- `view.items`: 50,000 `{ path, kind }` objects, because `cardPlan` asks planFolderView for `limitItems: false` (`src/engine/cards.js:338`).
- `card.wanted`, a reference to that array, and `card.rowPaths`, 50,000 path strings plus a 1,199,999 byte `rowKey`.
- `card.rowIndex`, a Map of 50,000 path to place.
- 45 DOM nodes: the card frame, the backs holder with no backs for a folder with no child folders, the head with its tab, name and meta, two gaps, 10 rows with a name and a note each, the band and four brackets. `card.items.children` is 12: 2 gap divs and 10 rows. A touch replaces the 10 rows, 30 nodes, and keeps the frame, so the node count stays 45.

Memory measured with a forced collection: the plan and its index held 10,742,824 bytes, and the card's row structures held another 3,434,992 bytes. One 50,000 file folder costs about 14MB while it is drawn.

Per touch, in this order:

1. `itemsFor` builds a 50,000 entry array and sorts it (`src/model/folderView.js:246-261`). A path-only sort of the same list took 3.1 to 3.6ms; the real comparator also reads two Sets and a Map per comparison.
2. `folderKey` walks every child and file and joins a string for the cache key (`src/model/folderView.js:265-274`). For 50,000 files that string has the same shape as the 1,199,999 byte row key.
3. `items = all.slice()` copies 50,000 references (`src/model/folderView.js:282`). This took 0.15 to 0.19ms.
4. `cards.js` maps 50,000 paths, joins the 1,199,999 byte key and builds the 50,000 entry Map (`src/engine/cards.js:739-750`). This took 12.3 to 28.5ms.
5. `paintWindow` rebuilds 10 rows. The DOM part is small; the list work above is the cost.

## Times at depth 1 and 0

`planFolderView` on the 95,000 file tree, one touch inside each heavy folder:

| Depth | Cold plan | Touch in heavy-files | Touch in heavy-folders |
| ---: | ---: | ---: | ---: |
| 0 | 314 to 435ms, median 417 | 15.1 to 41.7ms, median 18.3 | 8.9 to 37.9ms, median 14.8 |
| 1 | 258 to 430ms, median 338 | 15.7 to 35.8ms, median 19.1 | 12.6 to 22.7ms, median 17.9 |
| 2 | 311 to 391ms, median 326 | 20.1 to 26.9ms, median 21.2 | 16.3 to 24.0ms, median 18.0 |

Depth 2 is there because it is the default (`src/engine/room.js:299`). Depth 0 is not cheaper: root's first three children are always drawn (finding 1), and the 50,000 file folder is one of them. A touch adds the folder to `drawn` at any depth, so a folder an agent works in is never protected by the depth setting.

## Other measured calls

| Call | Time |
| --- | ---: |
| `viewInput`, first | 12 to 23ms, median 16.3 |
| `viewInput`, after | 0.001ms |
| `cardRows` | 6 |
| `rowWindow` | first 0, last 10, virtual |
| Write one file | 22.3 to 51.8ms |
| `touchesForCommand`, first | 139.8ms, builds the file index |
| `touchesForCommand`, after | 0.012ms |
| Hermes read, first | 104.6ms, builds the file index |
| Hermes read, after | 0.021 to 0.026ms |

The shell command and the Hermes read are cheap after the pipeline's one-off index build (`src/model/pipeline.js:28-30`). A caller that passes a new files array pays the 100 to 140ms index build again.

## Bulk names and a count cap

`isBulkFolder` names only `node_modules`, `dist`, `build`, `coverage`, `vendor`, `.next`, `target`, `out` and `__pycache__` (`src/model/folderView.js:10`). The seven names in the brief all return false.

A top-level folder with 50,000 files named `assets`, `node_modules` or `.venv` costs the same as `heavy-files`:

| Folder | Cold plan, depth 1 | Touch |
| --- | ---: | ---: |
| `heavy-files` | 258 to 430ms, median 338 | 19.1ms |
| `assets` | 223 to 245ms, median 234 | 18.5ms |
| `node_modules` | 221 to 231ms, median 226 | 19.2ms |
| `.venv` | 229 to 244ms, median 237 | 19.1ms |

The bulk check only stops the folder's children from being pinned at the next depth (`src/model/folderView.js:143-147`). It does not keep the folder's own item list out of the plan. At depth 1 the folder is pinned like any other top-level folder, so its 50,000 items are built. At depth 0 it can still be one of root's first three children. `isBulkFolder` reads only the last path segment, and the other five names in the brief, `Library`, `.gradle`, `Pods`, `.cache` and `.idea`, are not in the set either, so each costs the same as `assets` at the same item count.

A count cap should exist. Per touch, plan only, median of 9 with a collection before each:

| Items | Touch |
| ---: | ---: |
| 1,000 | 0.82ms |
| 2,000 | 1.73ms |
| 5,000 | 2.82ms |
| 10,000 | 5.01ms |
| 20,000 | 9.60ms |
| 50,000 | 19.91ms |

The card adds its row work on top. That work measured 12.3 to 28.5ms at 50,000 items and grows with the list. One frame is 16ms. A cap at 2,000 is the largest count I measured with a median under 2ms for the plan, and it leaves the rest of the frame to the room. The card should show the touched file first and `+ N more`, not drop the touched file.

## Brief against the code

- The brief asks for depth 0, but the Settings slider clamps the folder depth to 1 to 3 (`src/ui/settings.js:149`). `cards.js` and `folderView.js` accept 0; the owner cannot pick it.
- The brief reads as if depth 0 means only the root card. The code also draws root's first three children at any depth, so a 50,000 file top-level folder is drawn at depth 0.
- A bulk folder is described as closed. It still lists all its items; the name only stops child cards at the next depth.
- `makeScaleTree` at 40,000 files and 4,000 folders gives 5 top-level folders, not 4,000 top-level folders. The 4,000 folders are spread over depth 12, and the two added folders make 7.

## Proposed briefs

**P24. Cap a folder card at 2,000 items and keep the touched file first.**
Files: `src/model/folderView.js`, `src/engine/cards.js` and their tests. Add `MAX_FOLDER_ITEMS` 2,000. When `limitItems` is false and a folder holds more than that, return the focused and touched items first, then the rest in order up to the cap, with `hiddenItems` and the existing `+ N more` row. A test builds the P22 tree, touches one file in the 50,000 file folder and checks that the view holds 2,000 items, the touched path is first, the card draws 10 rows and the plan stays under 5ms. Measure with `npm run scale-probe` or the same script.

**P25. Take the first plan off the first frame.**
Files: `src/model/folderView.js`, `src/engine/cards.js`, `src/Stage.jsx` and the tests. Build the file index in an idle chunk or a worker, draw the root card first, then the pinned cards as each view is ready. Keep the end state the same. Measure the cold plan on the P22 tree and a plain 40,000 file tree before and after.

**P26. Key folders by version, not by content.**
Files: `src/model/folderView.js`, `src/engine/cards.js` and the tests. Replace `folderKey` with `folderVersion` plus the ranks of only the focused and touched paths in that folder. In `paintRows`, use the view's item array as the row key and build `rowIndex` on first use. Pass the pipeline's dirs as a Set to `fileTouch`. A test checks that a touch inside one large folder rebuilds only that folder and that a second touch with the same focus does not. Measure the 50,000 file touch before and after.

## What was not reached

- No browser and no real DOM. The DOM node counts are exact for the code through the card tests' fake element, but layout and paint in Chromium were not measured.
- No real 50,000 item folder on disk. The tree was built in memory with `makeScaleTree` and `makeTree`.
- The machine was shared with other lanes and the spread was wide. A quiet machine will give lower absolute times.
- I did not run the full test suite. No code changed, only this file.
- I did not start the room, a lane run or any harness.
