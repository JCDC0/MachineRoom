# Audit, November 2026: the room's cost in a real browser

Date: 2026-11-10. Version 0.1.401. Brief P23. Change no code.

## Scope

This measures the built room in a real Chromium, at `?replay&scale=40000` and `?replay&scale=200000`: script, style, layout, heap and DOM nodes at load, at rest and at work, plus long tasks over 50 ms. It also names what the frame loop runs while nothing changes and what can be turned off.

It does not measure a hardware GPU, input latency, a day-long session or the live bridge. The browser renders through SwiftShader on the CPU, so frame rate is not the room's frame rate on the owner's machine. Script, style and layout seconds and the heap and node counts are the numbers to compare.

## Method

1. `npm run build`, then `npm run serve -- --port 5185 --no-open` from the worktree.
2. Headless Playwright Chromium, found the way `scripts/screenshots.mjs` finds it, at 1280 by 800, through the DevTools protocol.
3. At each scale: navigate, wait until a card and the WebGL canvas have drawn and three frames have passed, then read `Performance.getMetrics`. Then one 60 second paused window and one 60 second window at 1x. The paused window starts after 30 seconds of play, so the room holds the cards that warmup opened. `PerformanceObserver` with `longtask` and `buffered` counts tasks over 50 ms. `HeapProfiler.collectGarbage` runs before each heap reading.
4. For the effects: seek to 40 seconds, pause, and measure 10 second windows with the default settings, with fine dust off, with bloom on, and with every screen effect off. Each window starts from the same state: 142 cards, 1,740 rows, 8,221 elements, 11,503 nodes.
5. Each 60 second window ran once at each size, as the brief asks. Other lanes shared the machine, so a rerun would move by some percent.

## Measured

Load, from navigation to the first drawn room. Wall is the probe's clock. The rest comes from `Performance.getMetrics`.

| Files | Wall | Script | Style | Layout | Heap | Nodes | Long tasks |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| 40,000 | 2.09 s | 0.881 s | 0.011 s | 0.043 s | 19.5 MB | 2,288 | 3, 0.81 s total, 441 ms max |
| 200,000 | 2.22 s | 1.354 s | 0.012 s | 0.036 s | 55.2 MB | 3,282 | 4, 1.31 s total, 469 ms max |

60 seconds paused. The room still draws. The first drawn room is not the full room: 37 cards at 200,000 at 2.2 seconds, 152 cards at rest.

| Files | Script | Per second | Style | Layout | Task | Heap | Nodes | Long tasks | Frames |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- | ---: |
| 40,000 | 6.933 s | 115 ms | 0.042 s | 0.003 s | 11.358 s | 23.2 MB | 9,282 | 4, 0.52 s, 347 ms max | 1,912 |
| 200,000 | 3.347 s | 55 ms | 0.029 s | 0.003 s | 5.694 s | 58.4 MB | 12,225 | 1, 0.42 s, 417 ms max | 740 |

The 200,000 room does more per frame and gets fewer frames: 4.5 ms of script a frame against 3.6 ms at 40,000, and 12 frames a second against 31.6 under SwiftShader. At 60 frames on a hardware GPU the same per-frame work would be about 270 ms of script a second.

60 seconds of replay at 1x. The replay position moved 46.2 seconds at 40,000 and 21.7 seconds at 200,000 in 60 seconds of wall time.

| Files | Script | Per second | Style | Layout | Task | Heap | Nodes | Long tasks | Replay moved |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- | ---: |
| 40,000 | 9.551 s | 159 ms | 1.199 s | 1.157 s | 36.263 s | 24.7 MB | 11,336 | 211, 17.94 s, 546 ms max | +46.2 s |
| 200,000 | 14.418 s | 239 ms | 0.611 s | 0.590 s | 26.951 s | 58.9 MB | 14,311 | 168, 23.12 s, 674 ms max | +21.7 s |

Effects at 40,000, paused, same state. `ms a frame` is script divided by frames, which is fairer than script a second when SwiftShader changes the frame rate.

| Settings | Frames | Script | ms a frame | Heap | Canvases |
| --- | ---: | ---: | ---: | ---: | ---: |
| Default (dust and vignette on) | 313 | 1.156 s | 3.69 | 22.1 MB | 1 |
| Fine dust off | 287 | 1.008 s | 3.51 | 22.1 MB | 1 |
| Bloom on | 136 | 0.754 s | 5.55 | 22.7 MB | 2 |
| Every effect off | 273 | 1.001 s | 3.67 | 22.0 MB | 1 |

Dust costs about 0.18 ms a frame, 5 percent. Bloom adds 1.86 ms a frame, 50 percent, and halves the frames. Vignette, grain and aberration cost no measurable script: the all-off window matches the dust-off window.

## What runs each frame while nothing changes

`src/engine/room.js:1029-1089` schedules `requestAnimationFrame` again at the top of every frame and never checks whether the replay is paused, the camera is still or an agent is working. Every frame it calls:

- `space.update` (`src/engine/void.js:294-307`): every second frame it walks 1,800 far dust points and 12,000 fine dust points, calls three sines and a square root for each, writes 41,400 position floats, writes 36,000 colour floats, and sets both buffers `needsUpdate` (`void.js:270-291`).
- `hub.update` (`src/engine/hub.js:549-593`): ring and sector opacities, a dash rotation, and a label scale only when it changes by more than 0.01.
- `internet.update` (`src/engine/internet.js:107-113`): 162 sphere vertices are rewritten and the position buffer is uploaded every frame, whether or not an agent is on the web.
- `gitTree.setTop` and `gitTree.update` (`src/engine/gitTree.js:455-466`): three head vertex colours, only when the tree has commits.
- `cards.update` (`src/engine/cards.js:1126-1344`): a loop over every card, a sine per card for sway, a quaternion compare, guarded class and row writes. `recompute` early-outs when the plan did not change (`cards.js:823-841`).
- `strings.update` (`src/engine/strings.js:190-260`): every folder link, two anchor lookups, and a strand update in `onBeforeRender` for every lit link.
- `labels.update`, `agentSet.update`, `stars.update`: file labels, agent shapes, rings, callouts, tunnels and stars.
- `hub.setSlot` for every agent (`room.js:1066-1072`). `writeColor` and `writeOpacity` guard unchanged values (`hub.js:35-47`), so this is cheap.
- `rig.update`, then `renderer.render(scene, camera)`, `bloom?.render()` when on, and `cssRenderer.render(cssScene, camera)`.

The CSS3D renderer builds a matrix string for every card, chip and callout every frame, then writes `element.style.transform` only when that string changes (`node_modules/three/examples/jsm/renderers/CSS3DRenderer.js:401-418`). At rest the transform does not change, which is why paused style time is 0.7 ms a second. While playing it is 20 ms a second at 40,000, and layout is 19 ms a second against 0.06 ms at rest.

DOM size stays bounded by the row window: 142 cards and 1,740 rows made 8,221 elements at 40,000. At 200,000 the paused room had 152 cards and 1,988 rows, and the end of the play window had 171 cards and 2,241 rows, with 10,253 elements. The page does not draw all 200,000 file rows.

## Could the room draw less often while nothing moves?

Yes. When the replay is paused, no agent works and the camera is still, the room could draw at 10 frames a second instead of the display rate, and after a longer quiet time it could stop until the pointer, a key, the transport or a notice wakes it.

The cost is motion, not correctness. Dust positions and the dust pulse are functions of `driftSeconds`, so a slower clock keeps the same path and only makes the steps larger: at 10 frames a second each step covers 0.1 s of drift instead of 0.05, so a mote near the camera can visibly jump. The pulse would step 0.12 radians a frame. The lattice is static and costs nothing to skip. The compass is React and only updates when the camera yaw changes. The camera drift also uses the same delta and would step. A 60 second freeze leaves a still picture, which is honest when nothing is working.

## Findings

| # | Cost | Where | What costs time | Smallest fix |
| :--- | :--- | :--- | :--- | :--- |
| 1 | 115 ms of script a second at 40,000 and 55 ms at 200,000, with 1,912 and 740 frames | `src/engine/room.js:1029-1089` | The frame loop runs flat out while the replay is paused and nothing moves. Every per-frame item below is paid on every frame. | Add an idle rate: 10 frames a second after 5 seconds with a paused replay, no camera move, no hover, no focus and no working agent. |
| 2 | 14.418 s script and 26.951 s task in 60 s, 168 long tasks (23.12 s, 674 ms max), replay moved 21.7 s of 60.3 s | `src/engine/room.js:1035-1080`, `src/engine/cards.js:1126`, `src/engine/strings.js:171-177`, `src/engine/strings.js:259-288` | At work on 200,000 the page makes long tasks and cannot keep 1x. A 20 second play profile put 2.6 s of 3.8 s script in `getProgramInfoLog` and `getShaderInfoLog` under SwiftShader, so part of this is software shader work. The folder links dispose their line and strand materials on every rebuild, which can force a new shader program. | Keep the link materials across rebuilds, time-slice card plan and card DOM creation, and measure again on a hardware GPU before ranking the two causes. |
| 3 | Load script 1.354 s, 4 long tasks (1.31 s, 469 ms max), heap 55.2 MB at 200,000 | `src/App.jsx:102`, `src/model/paths.js:89`, `src/model/scaleTree.js:102`, `src/model/state.js:47-57` | The whole tree, state and 200,000 file records are built synchronously before the first card. The first draw waits for all of it. | Build the tree and state in time slices, draw the root and top folders first, and allocate a file record only when an agent touches that file. |
| 4 | Replay moved 21.7 s in 60.3 s at 200,000 and 46.2 s in 60.1 s at 40,000 | `src/engine/room.js:1031`, `src/Stage.jsx:782` | The frame delta is capped at 0.1 s and the same capped number drives `player.tick`, so a slow frame loses replay time. | Pass the uncapped elapsed time to `player.tick` and cap only the frame work. |
| 5 | Style 1.199 s and layout 1.157 s in 60 s at work at 40,000, against 0.042 s and 0.003 s at rest | `src/engine/cards.js:1325-1383`, `src/Stage.jsx:833` | Row classes, row notes and card classes are written while cards change, and the transport re-renders through React every 120 ms during play. | Batch the class and text writes once a frame and update the transport position through a ref and a DOM write, not a React render. |
| 6 | Dust off saves 148 ms of script in 10 s, 15 ms a second | `src/engine/void.js:294-307`, `src/engine/void.js:282-290`, `src/engine/void.js:164-171` | The dust setting hides materials but the drift still walks 13,800 points, writes colours and uploads buffers every second frame. The colour buffer is written even when pulse is off. | Skip a layer whose material is invisible and skip the colour writes and upload when pulse is off. |
| 7 | 5.55 ms of script a frame against 3.69 ms, and 136 frames against 313 in 10 s at 40,000 | `src/engine/bloom.js:53-86`, `src/engine/room.js:1079` | Bloom renders the whole scene a second time and halves the frames under SwiftShader. This is finding 1 in `AUDIT-2026-11-FRAME.md`, still open. | Render only the glowing objects into the bloom target, as that audit says. |
| 8 | 55.2 MB of heap at the first draw at 200,000 against 19.5 MB at 40,000, about 223 bytes for each extra file | `src/model/state.js:47-57` | `createState` allocates one object for every file and one for every folder before the first draw, on top of the tree's path strings. | Create a record on first touch and answer the default read from the tree. |
| 9 | 162 vertices and a position upload every frame, plus a strand upload for every lit link | `src/engine/internet.js:107-113`, `src/engine/strings.js:190-260` | The internet sphere breathes and the strands travel even when no agent is online or touching a path. | Skip the sphere write when no agent is online and skip strand uploads when no link is lit. |

Of the findings in `AUDIT-2026-11-FRAME.md`, only its finding 1 (bloom) is still open, and it is my finding 7. Its finding 7 (material writes on every frame) is now guarded by `writeColor` and `writeOpacity` in `src/engine/hub.js:35-47`, and I did not see it in the profile. The node count is in the measured tables: 9,282 at rest at 40,000 and 12,225 at 200,000, and 10,253 elements after the play window at 200,000. The row window keeps the DOM bounded; the open card count is what grows with the replay.

## What I could not verify

- A hardware GPU. Every number here is SwiftShader. In a 20 second play profile at 200,000, about 2.6 s of the 3.8 s script time was `getProgramInfoLog` and `getShaderInfoLog` inside three's shader checks, which a hardware driver would not spend.
- Input latency, a resize, the live bridge, the drawer and the inspector, and a session longer than 60 seconds.
- The first drawn room at 500,000. The brief sets 40,000 and 200,000.

## Proposed briefs

**Next. Give the room an idle rate (OpenCode).** When the replay is paused, no agent is working and the camera is still, draw at 10 frames a second; after 60 seconds of quiet, stop the dust drift and draw on demand. Keep the dust time-based so its path does not change, only its step. Measure with the P23 probe: 40,000 paused under 40 ms of script a second, 200,000 under 20 ms, no paused long task. Files: `src/engine/room.js`, `src/engine/void.js`, `src/Stage.jsx`.

**Next. Keep 1x at 1x on a big room (OpenCode).** Pass the uncapped elapsed time to the player. Reuse the folder link materials instead of disposing them, and time-slice card plan and card DOM creation so a new folder does not make a 500 ms task. Batch row writes once a frame. Measure on a hardware GPU first, and with the P23 probe. Target: replay moves 60 seconds in 60 seconds at 200,000 within 5 percent, no task over 200 ms in the play window, script under 300 ms a second. Files: `src/engine/room.js`, `src/engine/cards.js`, `src/engine/strings.js`, `src/Stage.jsx`.

**Next. Stop building a record for every file at load (OpenCode).** Create a file and folder record on first touch and answer the default read from the tree. Keep the inspector's path list and the row window as they are. Target: 200,000 load heap under 35 MB and 40,000 under 14 MB, with the same first drawn room. Files: `src/model/state.js`, `src/model/fileIndex.js`, `src/engine/cards.js`.

## The orchestrator's corrections

The orchestrator read the findings back against the code on 2026-11-10.

- Findings 1 to 9 hold as written. Finding 4 is confirmed at `src/engine/room.js:1031`, where the capped `delta` goes to `beforeFrame` and on to `player.tick` (`src/Stage.jsx:782`). It slows a replay only; a live room shows frames as they arrive.
- The orchestrator measured the same build of the room in Brave, a Chromium with a hardware GPU, with its window in front, on 2026-11-10 while P19 and this lane loaded the machine. At `?replay&scale=200000` a frame took a median of 12 ms paused and 206 ms (p95 552) at play, against 36 ms (p95 79) at `?replay&scale=1000` at play. Over 6 seconds of play at 200,000 files the long animation frames held 1.05 s of the room's `frame`, 0.86 s of React work and 0.73 s of style and layout. So on a hardware GPU the shader checks of finding 2 are not the main cost: the room's per-touch work and React renders that grow with the file count are, which `AUDIT-2026-11-LIGHT-FOLDERS.md` and `AUDIT-2026-11-LIGHT-START.md` name in part. Which React component renders per touch at 200,000 files is not yet found.
- The proposed briefs are labelled Next here and will be briefed under P ids, none before the owner's yes.
