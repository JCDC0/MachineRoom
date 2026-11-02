# Audit, November 2026: the engine

Date: 2026-11-03
Author: OpenCode (DeepSeek V4.1 Flash)
Branch: `feat/q20-audit-of-the`
Version read: 0.1.401
Brief: Q20

## Scope

Read `src/engine/**` in full, and the parts of `src/model/` it calls: `folderView.js`, `state.js`, `paths.js`, `hierarchy.js`, `player.js`, `livePlayer.js` and `scaleTree.js`. Read `docs/agents/AUDIT-2026-11.md` first and did not re-list M1 to M5, which are fixed, or F1 to F3, which are already listed as remaining. No code was changed.

The tree was read through the code and, where a scale failure is claimed, through a synthetic tree and `npm run scale-probe`. The probe numbers below are this machine, one run each, not a promise.

## Severity

- **High**: a feature fails in normal use, or the room fails to build.
- **Medium**: a concrete path leaves stale state, does avoidable work per frame, or grows without a bound in a live session.
- **Low**: a scale edge, a small leak, or a cosmetic fault that the code shows.

Summary: **1 High, 7 Medium, 8 Low.**

## Findings

| # | Severity | Where | The case and what goes wrong | Smallest fix |
| :--- | :--- | :--- | :--- | :--- |
| 1 | High | `src/model/folderView.js:232`, called from `src/engine/cards.js:278` | A folder that holds 200,000 items reaches `items.push(...all)`. A spread of 200,000 arguments overflows the V8 call stack and throws `RangeError: Maximum call stack size exceeded`. Trees of the same shape passed at 40,000, 60,000 and 100,000 items in Node, so the 200,000 case is the failure and a browser can fail lower because its argument limit is smaller. `cardPlan` throws during `recompute`, so the room never gets that card or its links. | Replace the spread with a loop or `items = all.slice()`, and cap `view.items` at `MAX_VIEW_ITEMS` (the open S23 limit) so a card never holds an unbounded list. |
| 2 | Medium | `src/engine/cards.js:870-886` | `slotPosition` runs `card.rowPaths.indexOf(file)` before it checks the virtual window. `edgePoint` calls it for every working agent every frame, so a folder with tens of thousands of rows costs a linear scan per frame per agent even when the row is scrolled out of view. | Keep a `Map` from path to index on the card, or check `card.virtual && !card.drawn.has(file)` before the scan and use the card centre as the out-of-view fallback. |
| 3 | Medium | `src/engine/cards.js:54-67, 753`, `src/model/folderView.js:63-75` | Every newly created file changes `state.existingFiles`. `viewKey` includes that count, so `recompute` runs a full `cardPlan`; `viewInput` walks the whole `state.files` map and `indexFiles` compares and copies the whole source array. At 200,000 files one new file measured 4.0 ms in `viewInput` plus 14.3 ms in `cardPlan`, over the 16 ms frame budget before any DOM work. | Append the new existing paths to the cached array when the map identity is unchanged, and give the plan a folder-content revision instead of rebuilding it for every count change. |
| 4 | Medium | `src/engine/cards.js:644-665, 630-639` | `paintRows` builds `paths.join('\n')` over every item in a card and stores every item in `card.wanted`. After finding 1 is fixed, a 200,000-item folder still produces a multi-megabyte key on each plan and `gapTop`/`gapBottom` spacers of about 4.4 million pixels, so scrolling and layout stay expensive. | Cap `view.items` in `folderView` (S23) and key a card by its total count plus a revision, not by a string of every path. |
| 5 | Medium | `src/engine/room.js:807`, `src/engine/cards.js:945-957`, `src/engine/agents.js:1144` | `world.links = cards.visibleLinks()` allocates a fresh object for every visible folder on every frame while the working mask is dimmed, which is whenever a working agent has a focus path. `litChain` then builds a new `Map` from all links for every working agent on every frame. Links change only when cards enter, leave or move. | Build the link array in `relink()` and keep it until `cards.update` reports a layout change; keep a reusable parent `Map` for `litChain`. |
| 6 | Medium | `src/engine/strings.js:295-370` | Each folder link gets its own `THREE.Points`, material and geometry, so it is its own draw call. `build` clears and rebuilds every one of them on any link change, and opening a single folder changes the link list, so a room with hundreds of cards hitches and draws hundreds of point clouds. | Add or remove only the changed strands, or use one pooled `Points` buffer with a range per strand, so the whole set is one draw call. |
| 7 | Medium | `src/engine/room.js:282, 467-472` | `touchLog` keeps up to 50 reads and writes for every path ever touched. It is cleared only by `sync`, which live mode never calls. A long live session that touches many files keeps every path and every cap-sized list, and the inspector can return all of them. | Cap the total number of paths and entries, or drop entries older than a window when a new touch arrives. |
| 8 | Medium | `src/model/state.js:151-161`, `src/engine/agents.js:484, 780, 1183` | `agent.spawn` adds child agents to `state.agents` and nothing removes a finished child. `retired` adds a second entry for each child view that fades. Live state is never reset. `workingKeys`, `masks.of`, `syncViews`, `agentSet.update` and `terminals.update` walk those maps every frame, so a long session gets slower with every subagent it has ever run. | Age finished children out after the view fade, or skip non-active children in the per-frame walks, and delete the `retired` entry when its view goes. |
| 9 | Low | `src/engine/cards.js:357, 518-524, 825-830` | `homes` keeps the position of every card path ever laid out. `removeCard` removes the card and its DOM but leaves `homes`; depth changes, folder renames and tree churn grow it for the life of the page. | Delete the path in `removeCard`, or prune `homes` to the drawn set in `sync`. |
| 10 | Low | `src/engine/internet.js:96-108` | `apply` calls `morphOffsets` every frame. That re-seeds the generator and rebuilds the phase and swing array for every vertex, although the phases and swings never change. | Precompute phase and swing once in `createInternet`, then apply only `1 + sin(time * rate + phase) * swing`. |
| 11 | Low | `src/engine/strings.js:232-286` | `update` calls `centerOf` for both ends of every link every frame, even after all cards have settled. Each call walks `nearestCard` and `dirname`, so the work repeats per frame for data that only changes on layout. | Cache the two endpoints per strand and refresh them only when the card positions change or a card is moving. |
| 12 | Low | `src/engine/hub.js:398-428` | `hub.update` allocates a new `Set` for `workingSectors` every frame, and `room.frame` writes `hub.setSlot` colour and opacity for every view every frame. The values only change when an agent status changes. | Reuse the set, and store the last colour and opacity on each slot so unchanged slots are not written. |
| 13 | Low | `src/engine/cards.js:1029` | `update` allocates `[...cards.values()]` every frame and builds a `className` string for every card every frame. At the normal card set this is small, but it is avoidable allocation in the frame loop. | Iterate `cards.values()` directly and rebuild the class only when its inputs change. |
| 14 | Low | `src/engine/ring.js:229` | `layoutRing` uses `queue.shift()` in a `while` loop. That is O(n²) in the number of drawn cards, so a room with many open folders pays it on every layout. | Walk the queue with an index instead of shifting it. |
| 15 | Low | `src/engine/hub.js:368-371`, `src/engine/room.js:991-993` | `room.setLadder` calls `hub.setLadder`, which always rebuilds ticks, slots and sector geometry. The live ladder poll runs every 60 s and sends an equal object, so the geometry is rebuilt even when nothing changed. | Keep a ladder key and return before `rebuild()` when the key is unchanged. |
| 16 | Low | `src/engine/agents.js:795-823, 1217-1234` | `placeViews` skips every view with a `parentKey`, and child homes are fixed in `childPlace` when the child is created. When the ladder or roster moves a parent, its subagent children stay at the old place. | Recompute each child's home from its parent home in `placeViews`, not only at spawn. |

## Efficiency

Each line says what it would save and how to measure it. The two probe commands were run at 40,000 and 200,000 files.

- **Incremental file list and plan (finding 3)**: at 200,000 files, one new file cost 4.0 ms in `viewInput` and 14.3 ms in `cardPlan` after a synthetic `state.files.set`. Removing those makes a new file cost the touched folder only. Measure by timing `viewInput` and `cardPlan` before and after one `state.files.set` in the same process, or add that stage to `npm run scale-probe`.
- **Cached links and a parent map (finding 5)**: at 300 visible cards this removes 300 link objects and a 300-entry map for every working agent every frame, roughly 18,000 objects per second at 60 fps. Measure by counting `visibleLinks` calls and timing it around a frame, or add a counter to `createRoom` and print it in a probe.
- **One draw call for strings (finding 6)**: one `renderer.info.render.calls` entry instead of one per link. Measure with `renderer.info.render.calls` in a browser or a temporary debug read, at 100, 500 and 2,000 visible cards.
- **Trim the touch log (finding 7)**: bounded memory instead of one list per touched file. Measure `touchLog.size` and the sum of list lengths after a scripted 10,000-touch run, or use `process.memoryUsage().heapUsed` in `npm run scale-live -- --keep` over a long run.
- **Prune retired children (finding 8)**: a constant per-frame walk instead of one that grows with every subagent. Measure `state.agents.size`, `room.views.size` and frame time after 1,000 spawned and finished children in a probe or a synthetic live state.
- **Prune `homes` (finding 9)**: one map entry per drawn card instead of every path ever seen. Measure `homes.size` after opening and folding a deep folder 100 times.
- **Precompute the internet morph (finding 10)**: removes about 162 numbers and 162 seeded calls per frame per room. Measure the `morphOffsets` call time in a loop, or a heap allocation profile over 600 frames.
- **Cache link endpoints (finding 11)**: removes two `nearestCard` walks per link per frame, 36,000 at 300 links and 60 fps. Measure with a counter inside `centerOf` or a `performance.now` sample around `strings.update`.
- **`makeTree` at 200,000 files**: `npm run scale-probe -- --files 200000 --folders 20000` measured `makeTree` at 806 ms, `readTree` at 288 ms and `planFolderView` first call at 473 ms. Building directories by a sorted prefix walk, instead of calling `ancestors` for every file, would cut the 806 ms. Measure the `makeTree` and `planFolderView, first call` rows of the probe; target is under the 1,000 ms load budget before `createState`.
- **`layoutRing` queue (finding 14)**: at 300 cards the shift cost is small; at 2,000 open cards it is the difference between one pass and a quadratic pass. Measure `layoutRing` in `npm run scale-probe` with a larger card set.
- **Skip an equal ladder (finding 15)**: avoids rebuilding a few hundred geometries every minute. Measure `hub` build count over ten minutes of polling, or count `rebuild()` calls in a probe.
- **`cards.update` array and class strings (finding 13)**: a small allocation per frame. Measure with a heap profile over 600 frames at the normal card count.
- **Pointer hover `getBoundingClientRect` (`src/engine/camera.js:178-183, 225-229`)**: `hover` runs on every `pointermove`, including while dragging and over the HUD, and reads the surface rect each time. It can force layout when the HUD changes. Measure with the Performance panel or a counter; skip the rect read while `drag.active` or when the pointer is over the HUD.

## What to delete

- `rowMark` and `rowNote` in `src/engine/cards.js:334-351` are unused duplicates of the logic inside `rowLook`. Delete both.
- `createFollowFocus.end` in `src/engine/room.js:92-97` has no production caller; only `tests/room-follow-reset.test.js` calls it. Delete it and its test, or keep the test as the only contract.
- `cardClickEndsFollow` in `src/engine/room.js:122-124` has no production caller; only `tests/room-follow-reset.test.js` calls it. Delete it and its test.
- `cards.onPath` (`src/engine/cards.js:1262`) and `cards.moving` (`:1272`) are returned but never called from `src` or `tests`. `movingNow` and `wasMoving` exist only to feed `moving`; remove them with it.
- `agents.hubCenter` (`src/engine/agents.js:1243`) is returned and never called. Remove the field.
- `followAfterSeek` (`src/engine/room.js:118-120`) always returns `followCard: null` and `pendingFollow: null`; `room.sync` assigns both and immediately overwrites them. Return only `path`, or keep the shape and drop the two dead fields with the test update.

## Visual bugs you can tell from the code

- `agents.setLabels` (`src/engine/agents.js:905-911`) updates each callout title but not the `view.label` sprite created by `textSprite` at `:650`. A family label change reaches the chip and the callout text but leaves the old name above the agent in the room.
- `placeViews` (`src/engine/agents.js:795-823`) skips child views, so a subagent child stays at its spawn point after the ladder or roster moves its parent (finding 16).
- `hub.rebuild` (`src/engine/hub.js:346-366`) resets `boost` and `sectorLevels`. A run pulse or a working sector glow is cancelled by any roster or ladder change, including the equal 60 s poll in finding 15.
- In `room.frame`, `gitTree.setTop(cards.bottom(''))` (`src/engine/room.js:791`) runs before `cards.update` (`:793`). When a folder opens or closes and the root card's height changes, the git tree is one frame behind. The effect is small but visible during the card grow.
- `agents.update` computes the chip link with `terminals.edgePoint` (`src/engine/agents.js:1095`) before `terminals.update` sets the current chip side (`src/engine/terminals.js:323`), so a side flip is drawn one frame late.

## Unproved or not reached

- The 200,000-item spread failure was reproduced in Node with a synthetic `src/` folder of 200,000 files. It was not reproduced in a browser. The browser's argument limit is lower than Node's, so the failure may start below 200,000; the test above only proves the 200,000 case.
- A finished child agent that later gets a second `run.start` on the same `state.agents` entry would be hidden by the `retired` check at `src/engine/agents.js:780` until a seek clears `retired` at `:1191`. I did not find a session reader that reuses a finished child entry, so this stays unproved.
- `cards.slotPosition` uses the fixed `ROW_H` for the scroll offset (`src/engine/cards.js:878-883`) while `paintWindow` uses the measured `rowHeightOf` (`:605-611`). The current stylesheet sets `.mr-item` to exactly 22 px, so there is no fault today; a font or zoom change that alters the row height would put the strip and the camera hold on the wrong row.
- The pointer hover cost in `camera.js` is a suggestion, not a measured fault. It was not profiled.
- Not read for this audit: `src/ui/**`, `src/Stage.jsx` beyond its calls into the engine, `server/**`, `src/model/parsers/**`, `pipeline.js`, `source.js`, `replay.js`, `sessionRecorder.js`, `costs.js`, `liveTasks.js`, `recordLimits.js`, `fileIndex.js`, and the decider, assistant and control folders.
- No full test suite and no build were run, because the brief says this run only reads. No browser check was made.

## Commands run

- `npm run scale-probe -- --files 40000 --folders 4000` -> pass, 40,000 files, `makeTree` 110.19 ms, `planFolderView` first call 68.83 ms, one new file 1.65 ms.
- `npm run scale-probe -- --files 200000 --folders 20000` -> pass, 200,000 files, `makeTree` 806.44 ms, `planFolderView` first call 473.28 ms, one new file 2.96 ms, `apply` worst 32.02 ms.
- A Node one-liner with `makeScaleTree({files:200000,folders:20000})`, `makeTree`, `createState`, `viewInput` and `cardPlan` -> load 1625.1 ms, `viewInput` cold 5.7 ms, `cardPlan` 572.7 ms, after one new file `viewInput` 4.0 ms and `cardPlan` 14.3 ms.
- A Node one-liner with 200,000 files under `src/` through `cardPlan` -> fail with `RangeError: Maximum call stack size exceeded` at `folderView.js:232`.
- The same one-liner at 40,000, 60,000 and 100,000 files under `src/` -> pass with 40,000, 60,000 and 100,000 items.

The probe and the one-liners write only temporary files that they remove; no code, recordings or repository files were changed.
