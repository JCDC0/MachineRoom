# The stars, the agent colours and the replay

A review of U152 and U153, read from the diff `67ebba80..896370aa` and from the code those commits touch at `main` on 2026-11-07. Findings are in the order the owner would notice them. A design idea is kept apart from a finding.

## Findings

### 1. A failed tool call turns white when its star lands

- File: `src/engine/room.js:769`, with `showTouch` at `src/engine/room.js:745` and the failure path at `src/engine/room.js:818`.
- When: a `tool.start` launches a star that takes 0.25 to 0.9 seconds. If the matching `tool.end` fails before the star lands, the red flash and the `failed NAME` label show at once, then the star lands. `showTouch` stores a white flash over the red one and shows `read NAME` or `write NAME`. The owner sees a failed write go white and a success label appear after the failure.
- How sure: high. The landing callback always calls `showTouch`, and nothing cancels or checks the call result.
- Smallest fix: carry the call id with the star and drop its landing when that call ends failed, or have the landing read the call result and keep the red flash and failure label. Add a room test with a tool that fails inside the star's flight time.

### 2. The first touch star of each agent skips the folder chain

- File: `src/engine/room.js:766`, with `beforeFrame` at `src/engine/room.js:888` and `world.mask = mask` at `src/engine/room.js:914`.
- When: `player.tick` calls `onActivity` from `beforeFrame`, before the frame rebuilds the working mask and the card links. `launchTouchStar` reads `world.mask`, which is the previous frame's mask and is null on the first touch. `litChain` returns no chain, so the star goes straight from the agent centre to the card tab while the tunnel, updated later in the same frame, follows the lit folders. The same happens when a just-created card has no link in the previous frame's `world.links`.
- How sure: high. The order is fixed in the frame loop, and `litChain` returns an empty chain whenever `mask` is null or lacks the touched folder.
- Smallest fix: rebuild the mask and links before `player.tick`, or compute a fresh mask from `getState()` inside `launchTouchStar` so the star and the tunnel read the same state. Add a test that the first touch of an agent produces the same waypoints as the tunnel.

### 3. The star lands on the tab and the label appears above the card centre

- File: `src/engine/room.js:749`, with the star end at `src/engine/room.js:765` and `cards.topPoint` at `src/engine/cards.js:965`.
- When: every file touch. The star ends on the card's tab anchor, which `tabAnchorOffset` puts near the left of the top edge. `showTouch` places the label with `topPoint`, which is the card centre plus half the card height plus 40 units. On a 248 unit card at scale 1 the two points are about 89 units apart horizontally, and more for a wide card. The owner sees the label float away from the star that just landed.
- How sure: high. The two functions use different anchors by construction.
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

## Dead code and stale copy

- `src/ui/guide.js:19` and `src/ui/guide.js:45` still say the working tunnel is yellow and that packets run along it. U152 removed the packets and made the tunnel the agent's colour. The guide is shown in the demo, so the owner reads the old behaviour. The fix is to rewrite the two lines; `tests/guide.test.js:98` asserts the old sentence and needs the same edit. These files are outside the U155 file list.
- `src/engine/stars.js:263` exposes `count: () => pool.filter(...)`, and nothing in `src` or `tests` calls it. It also allocates an array. Remove it, or make it a counter if a caller is planned.
- `tests/frame-cost.test.js:171` and `tests/frame-cost.test.js:205` are two `describe` blocks with the same name, `the path lengths a star samples`. The second was renamed from the packet buffers and kept the first name. The tests still run, but the output no longer says which block failed.

## Design ideas

- The palette has two oranges (`0xffb347` and `0xff8a3d`), two pinks (`0xff5ad1` and `0xff8fb1`), and two cyan or teal tones (`0x3ee6e6` and `0x4fd1b5`). The last two sit near the web blue `0x2a9dff`, and `0x4fd1b5` sits near the green `0x2aff80`. Two agents on adjacent slots can look alike. The brief fixes the eight colours, so this is for the owner, not a code fix.
- The core texture is 22 pixels on screen, but its bright radial core is 9 of 32 texture pixels across, about 6 pixels on screen. The rays are faint and 22 pixels long. At the overview the star may read as a small dot rather than the bright point the brief describes. Enlarging the core gradient would keep the requested sprite size and make the star easier to see.
- `starSlot`, `starDuration`, `starAdvance` and `agentStar` are tested, but there is no test that a full pool lands the oldest star through `onLand`, and no test that `launchTouchStar` builds the same route as the tunnel. Both are pure enough to test with a star pool and a fake route.
- The `STAR_*` constants are exported but only `tests/stars.test.js` reads some of them. That is fine for a test seam, but the unused `count` is the only export with no reader at all.

## What this review did not verify

- No browser check. The brief says not to start a dev server, so the on-screen ordering, the star size at the overview, and the label placement are left to the orchestrator in a browser.
- No code was changed and no failing test was committed.
- Only the related tests and `npm run build` were run, not the full `npm test`.
