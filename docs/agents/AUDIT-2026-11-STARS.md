# The stars, the agent colours and the replay

A review of U152 and U153, read from the diff `67ebba80..896370aa` and from the code those commits touch at `main` on 2026-11-07. Findings are in the order the owner would notice them. A design idea is kept apart from a finding.

## Findings

### 1. A failed tool call turns white when its star lands

- File: `src/engine/room.js:769`, with `showTouch` at `src/engine/room.js:745` and the failure path at `src/engine/room.js:818`.
- When: a `tool.start` launches a star that takes 0.25 to 0.9 seconds. If the matching `tool.end` fails before the star lands, the red flash and the `failed NAME` label show at once, then the star lands. `showTouch` stores a white flash over the red one and shows `read NAME` or `write NAME`. The owner sees a failed write go white and a success label appear after the failure.
- How sure: high. The landing callback always calls `showTouch`, and nothing cancels or checks the call result.
- Smallest fix: carry the call id with the star and drop its landing when that call ends failed, or have the landing read the call result and keep the red flash and failure label. Add a room test with a tool that fails inside the star's flight time.

### 2. A touch star follows the previous frame's chain, not the touch's own

- File: `src/engine/room.js:766`, with `beforeFrame` at `src/engine/room.js:888` and `world.mask = mask` at `src/engine/room.js:914`.
- When: `player.tick` calls `onActivity` from `beforeFrame`, before the frame rebuilds the working mask and the card links. `launchTouchStar` reads `world.mask`, which is the previous frame's mask. The first touch of a run often has no previous focus, so `litChain` returns no chain and the star goes straight from the agent centre to the card tab. A later touch in another folder follows the previous touch's chain. The tunnel, updated later in the same frame, follows the current chain, so the star and the tunnel take different paths. The same happens when a just-created card has no link in the previous frame's `world.links`.
- How sure: high. The order is fixed in the frame loop, and `tests/agent-strip.test.js:298` already shows that a null mask gives no chain.
- Smallest fix: rebuild the mask and links before `player.tick`, or compute a fresh mask from `getState()` inside `launchTouchStar` so the star and the tunnel read the same state. Queue a touch star the way `pendingSpawns` is queued when the card for the touch does not exist yet. Add a test that the first touch of an agent produces the same waypoints as the tunnel.

### 3. The star lands on the tab and the label appears above the card centre

- File: `src/engine/room.js:749`, with the star end at `src/engine/room.js:765` and `cards.topPoint` at `src/engine/cards.js:965`.
- When: every file touch. The star ends on the card's tab anchor, which `tabAnchorOffset` puts near the left of the top edge. `showTouch` places the label with `topPoint`, which is the card centre plus half the card height plus 40 units, and `labels.show` adds another 80 units up. On a 250 unit card at scale 1 the tab is 89 units left of centre and the label sits 116 units above the tab, about 146 units away. The owner sees the label float away from the star that just landed.
- How sure: high. The two functions use different anchors by construction, and the numbers above come from `tabAnchorOffset` and `labels.show`.
- Smallest fix: place the label at the star's landing point, with a small lift, or give `topPoint` the same tab anchor the tunnel and star use.

### 4. Stars land after their run has ended or their agent has left

- File: `src/engine/room.js:769`, with `run.end` at `src/engine/room.js:830` and `removeView` at `src/engine/agents.js:1087`.
- When: a run ends, a child fades out, or a session reader leaves the roster while a star is in flight. The star keeps its fixed points and lands 0.25 to 0.9 seconds later. It then flashes white and shows `read NAME` or `write NAME`, after the run end has turned the agent and its chip green, or after the agent is gone. The owner sees a finished run touched again, or a label from an agent that is no longer there.
- How sure: high. Stars have no owner key and no cancel path.
- Smallest fix: tag a star with its agent and call or drop it on `run.end` and on view removal, or make the landing check that the agent still exists and its run is still open.

### 5. Spawn stars move under reduced motion

- File: `src/engine/room.js:836` and `src/engine/room.js:786`.
- When: `prefers-reduced-motion` is on and an `agent.spawn` arrives. The `run.start`, `agent.message` and web stars are guarded by `still()`, and a touch shows its flash and label at once, but the spawn activity is pushed to `pendingSpawns` and `flushSpawnStars` launches it with no `still()` check. The star crosses the room even though the rest of the room holds still.
- How sure: high. The guard is missing on this one path.
- Smallest fix: skip the spawn star when `still()` is true, or guard `flushSpawnStars`.

### 6. Flashes and labels run on wall clock, not on replay time

- File: `src/engine/room.js:913`, with `src/engine/cards.js:1000` and `src/engine/labels.js:57`.
- When: a replay is paused or runs at 4x. `stars.update` gets `delta * starSpeed`, so stars pause and speed up with the player, but `labels.update(delta)` and the flash expiry use the raw frame delta and `performance.now()`. Pausing a replay lets an existing label fade and a flash expire while the room is frozen, and at 4x a label stays for 2.6 seconds of wall time, which is 10.4 seconds of replay time, over later events.
- How sure: high. The two clocks are separate.
- Smallest fix: give the room one replay clock advanced by `delta * starSpeed`, and use it for label life and flash expiry.

### 7. A moving card pulls away from a star that is already in flight

- File: `src/engine/room.js:768`, with the static sample at `src/engine/stars.js:223`.
- When: a write adds a file, a card grows or glides, a card lifts, or the plan drops the card while a star is in flight. `launchTouchStar` copies the route once, including the card tab, so the star lands where the tab was at launch. The tunnel recomputes its anchor every frame, and the label uses the card's new position, so the star lands on empty space or apart from the label.
- How sure: high for a card that moves during the flight; the star path is never rebuilt.
- Smallest fix: keep the route as waypoints and sample the current anchors each frame, or recompute the last point at landing before the flash and label.

### 8. The pool and label limits drop labels in a burst

- File: `src/engine/stars.js:160`, `src/engine/stars.js:190` and `src/engine/labels.js:13`.
- When: one shell command touches many files, or a burst of touches fills the 48 star slots. The oldest star lands at once, as the brief asks, but each landing asks for a label and `createLabels` has 16 sprites, so it reuses the oldest. More than 16 landings in one moment means some touches never show their label, and the flashes all show at once.
- How sure: high for the limits; low for how often the owner will hit it.
- Smallest fix: keep the number of landings that fire a label in a frame under the label pool, or queue the landings and show their labels as sprites free up.

### 9. The star is smaller than the brief says on a scaled screen

- File: `src/engine/stars.js:132` and `src/engine/stars.js:141`, with the pixel ratio at `src/engine/room.js:236`.
- When: the window has a device pixel ratio above 1, which is most laptops. `PointsMaterial.size` is in drawing buffer pixels, and the room sets the renderer to `Math.min(window.devicePixelRatio, 1.5)`. The 22 pixel core becomes about 14.7 CSS pixels and the 40 pixel halo about 26.7 CSS pixels. The owner asked for a 22 pixel core and a 40 pixel halo, and at the overview the star may read as a small dot.
- How sure: high for the arithmetic; medium for how much it matters to the owner at a given screen.
- Smallest fix: multiply both sizes by `renderer.getPixelRatio()` when the stars are built, or pass the ratio into `createStars` and update it on a resize.

### 10. An offline web call still sends a star, with no beam

- File: `src/engine/room.js:817` and `src/engine/room.js:781`.
- When: the bridge reports no network and `setOnline(false)` has run, then an `isOnlineCall` activity arrives. `agentSet` suppresses the blue beam while offline, but `launchWebStar` has no online check, so a star flies from the agent to the red `NO CONNECTION` shape along a beam that is not drawn.
- How sure: high for the path; medium for whether the owner wants the attempt shown as a star anyway.
- Smallest fix: guard `launchWebStar` with `internet.online()` or the agent set's online state, or draw the beam in the offline colour while the star flies.

### 11. A file touch flashes the whole folder card, not only the row

- File: `src/engine/room.js:748`, with `flashFile` at `src/engine/cards.js:1446`.
- When: any file touch lands. `showTouch` calls `cards.flashFile(dir, path, 'white')`, and `flashFile` flashes both the file row and the folder card. The U152 addendum says the star ends on the card tab and "the row only flashes", so the white card flash is an extra signal that the folder itself was touched.
- How sure: high for the code; medium for whether the owner wants the card flash to stay.
- Smallest fix: flash the file row only in `flashFile`, and keep `flashCluster` for a folder touch.

## Dead code and stale copy

- `src/ui/guide.js:19` and `src/ui/guide.js:45` still say the working tunnel is yellow and that packets run along it. U152 removed the packets and made the tunnel the agent's colour. The guide is shown in the demo, so the owner reads the old behaviour. The fix is to rewrite the two lines; `tests/guide.test.js:98` asserts the old sentence and needs the same edit. These files are outside the U155 file list.
- `src/engine/stars.js:263` exposes `count: () => pool.filter(...)`, and nothing in `src` or `tests` calls it. It also allocates an array. Remove it, or make it a counter if a caller is planned.
- `src/engine/room.js:765` has `if (!cardAnchorOf(dir, starEnd))`, and `src/engine/agents.js:1571` has `if (tab) ... else world.edge(...)`. `cards.anchor` always returns a vector, so both `else` branches are dead. When a card is missing the star and tunnel end at the nearest card's tab, which matches the U152 addendum, so remove the dead fallback or make `anchor` answer null when there is no card.
- `tests/frame-cost.test.js:171` and `tests/frame-cost.test.js:205` are two `describe` blocks with the same name, `the path lengths a star samples`. The second was renamed from the packet buffers and kept the first name. The tests still run, but the output no longer says which block failed.

## Checked and found sound

- `room.reset` is `sync`, and `sync` calls `stars.reset()` and clears `pendingSpawns` at `src/engine/room.js:444` to `src/engine/room.js:452`. A seek while paused drops the star and its pending flash and label, and `cards.sync` clears the flashes.
- A speed of 0 holds a star where it is (`starAdvance` at `src/engine/stars.js:51`, tested with 0, 1 and 4), and `src/Stage.jsx:773` passes 0 while a replay is paused and 1 in a live room.
- Under reduced motion the touch path shows the flash and label at once, and the run.start, message and web stars are blocked. The spawn star is the one exception, finding 5.
- A full pool lands the oldest star at once, as the brief asks (`starSlot` at `src/engine/stars.js:59` and `landAt` at `src/engine/stars.js:176`).
- Two touches on one file in one frame produce two stars on the same path, and the later landing wins the label. `touchesForCommand` keeps the command order, so the final label is the last operation. The row flashes twice. This follows the per-touch rule in U152, but a merge by path would look cleaner.
- The fixture is in time order with ids 1 to 75. It produces 10 `agent.message` activities and 1 `agent.spawn`: orders at 00:11 and 00:31.5, reports at 00:31 and 00:51, dispatches at 00:52 and 01:08, wakes at 01:07, 01:23, 01:39 and 01:57, and `claude` to `claude~1` at 01:12. This matches the U153 brief.
- Cost: `stars.update` walks the fixed pool and writes only active slots, with no allocation per frame. `dispose` removes the two Points objects and disposes the shared geometry, both materials and both textures (`src/engine/stars.js:254`). The only per-frame cost is one upload of the 48 point position and colour buffers while any star is drawn, about 1.2 KB, which is small. The one allocation in the module is the unused `count()`.
- The CSS3D cards render after the WebGL scene (`src/engine/room.js:931` and `src/engine/room.js:933`), so every star draws behind every card, even when the star is in front of the card in 3D. That is the room's existing card rule for the tunnel, not a new star bug, but a bright star can vanish behind a card sooner than a dim trail does.

## Design ideas

- The palette has two oranges (`0xffb347` and `0xff8a3d`), two pinks (`0xff5ad1` and `0xff8fb1`), and two cyan or teal tones (`0x3ee6e6` and `0x4fd1b5`). The last two sit near the web blue `0x2a9dff`, and `0x4fd1b5` sits near the green `0x2aff80`. Two agents on adjacent slots can look alike. The brief fixes the eight colours, so this is for the owner, not a code fix.
- The core texture is 22 pixels on screen, but its bright radial core is 9 of 32 texture pixels across, about 6 pixels on screen. The rays are faint and 22 pixels long. At the overview the star may read as a small dot rather than the bright point the brief describes. Enlarging the core gradient would keep the requested sprite size and make the star easier to see.
- `starSlot`, `starDuration`, `starAdvance` and `agentStar` are tested, but there is no test that a full pool lands the oldest star through `onLand`, and no test that `launchTouchStar` builds the same route as the tunnel. Both are pure enough to test with a star pool and a fake route.
- No test reads the new message frames or the Task spawn from `scenario-i-run.jsonl`. `tests/scenarios.test.js` only moved the tool call count from 23 to 25. If a later fixture edit removes the orders, reports or wakes, the suite stays green and the demo loses the stars again. A test can assert the 10 message kinds and the one spawn.
- The `STAR_*` constants are exported but only `tests/stars.test.js` reads some of them. That is fine for a test seam, but the unused `count` is the only export with no reader at all.

## What this review did not verify

- No browser check. The brief says not to start a dev server, so the on-screen ordering, the star size at the overview, and the label placement are left to the orchestrator in a browser.
- No code was changed and no failing test was committed.
- Only the related tests and `npm run build` were run, not the full `npm test`.
