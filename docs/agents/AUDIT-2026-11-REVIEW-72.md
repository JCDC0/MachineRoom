# Review 72: the owner's design changes, P694 to P703

Scope: `a5480146..0b9f124d` on `main` (base `a5480146` is P694; merges P693, P695 to P701, P703; hand commits `65763930`, `2583ded8`, `c14b7f94`; P702b `107848c6` is briefed only).

## Findings

1. **R72-1 (High, a user can meet it, P699 `46240636`): Status rings stay yellow after the first tool call (`src/engine/agents.js:84-95,1759`, `src/model/state.js:254-279`).**
   - `statusRingColor` checks `entry.calls.size > 0` for yellow vs white, but `apply()` (`state.js:268-279`) never deletes `activity.id` on `tool.end` (kept for `room.js:990`), clearing only on `run.start`/`run.end`.
   - Case: any run executes a tool (`calls.size = 1`, yellow), ends it (`tool.end`, size stays `1`), then thinks. Inspector says `thinking` (`room.js:583-599`), while 3D rings stay yellow and thinking arcs stay off. `tests/agent-colors.test.js:607-690` and `tests/agent-thinking.test.js:343-444` never send `tool.end` mid-run.
   - Fix: keep an `openCalls` set per agent in `state.js` (add `tool.start`, delete `tool.end`, clear on `run.start`/`run.end`/`finish`) and read it in `statusRingColor` and `agentThinking`.

2. **R72-2 (Medium, a user can meet it, P701 `1a1e04b6`): Outward callouts occlude behind cards/hub, block clicks, and park on double-click (`src/engine/agents.js:142-172,702-710,1871-1892`, `src/styles.css:2892`, `src/Stage.jsx:1369`).**
   - Case (`OVERVIEW`, `1280x692`, `fit.dist = 1657`, 8 folders): with 1 sub and 4 lanes, ring-1 `lane0` callout (`d = 1232`, `[610..719, 502..533]`) hides behind front card `scripts` (`d = 840`, `[443..837, 525..662]`), and ring-1 `lane1` (`d = 2040`, `[761..826, 348..367]`) hides behind the hub (`d = 1657`, `[506..774, 306..386]`; WebGL draws over CSS3D). With 4 ring-0 lanes, `lane1` (`d = 1891`) sits over back card `tests` (`d = 2360`); `pointer-events: auto` + `pointerdown` stopPropagation block card clicks and camera drags. Double-clicking a callout hits `Stage.jsx:1369`, which still checks removed `.mr-term-console` instead of `.mr-callout`, calling `parkRoom()`. (`docs/agents/architecture/ACTIVITIES.md:52-56` still lists `.mr-term-console`.)
   - Fix: stop `dblclick` on `.mr-callout`; update `Stage.jsx:1369` and `ACTIVITIES.md:52-56`; capture pointer events only on title/link or lift callouts clear of cards and hub.

3. **R72-3 (Medium, a user can meet it, P701 `1a1e04b6`): Crowd mode loses the console and address link (`src/engine/agents.js:1826-1827,1847`, `src/engine/room.js:420`).**
   - Case: 5 agents work (`a0` runs `npm run dev` printing `http://localhost:5173/`, then `a1..a4` start). `fullCalloutKeys` keeps `a3` and `a4`, so `a0` becomes compact (`showConsole = false`), hiding `.mr-callout-console` and stripping `is-address`/link. Hovering the callout fails to expand it because `room.js:420` ignores non-canvas targets.
   - Fix: keep active shell console or address link visible when compact, and match `.mr-callout[data-agent]` in `onPointerMove`.

4. **R72-4 (Medium, a user can meet it, P703 `35101e35`): Stale `deepest` in `AgentDepthSettings` (`src/ui/AgentDepthSettings.jsx:47-98`, `src/control/client.js:69-77`).**
   - Fetches `agentDepth()` once on mount and never listens to `family`/`agents` notices while `Settings.jsx:159-168` stays mounted above Agents; `client.js:69-76` drops `deepest`/`deepestAgents` on 409.
   - Case: (a) open Settings with no subs (`deepest = 0`), add a ring-1 sub in Agents, click depth `1` -> 409 shows text without opening Hide, repeating 409 until Settings reopens; (b) open with a ring-1 sub, remove it in Agents, click depth `1` -> Hide card shows when nothing hides.
   - Fix: refresh `agentDepth()` on `family`/`agents` notices and keep `error.deepest`/`deepestAgents` in `client.js:75` so 409 opens Hide directly.

5. **R72-5 (Medium, a user can meet it, P698 `32fe295d`): Folders stay open or shut wrongly (`src/engine/cards.js:682-692,1148-1154,1304-1323`, `src/engine/room.js:1140-1172`).**
   - Cases (`folderContents: false`): (a) click subfolder row `sub/` inside `src/ui` (which also holds `App.jsx`): `cards.js:685` pins without recomputing so `onInspect` selects `src/ui`, and `cards.js:690` sets `inspected = 'src/ui/sub'`; `src/ui/sub` spawns shut while `src/ui` stays open (and stays open even if `src/ui/sub` was already drawn). (b) Inspector/Log folder click calls `room.focusPath`, clearing selection and flying to a shut card when `openOnTouch: false`. (c) `touchLife` (`1.1s`) decays by `delta * speedRate` while `openLevel` uses `0.25s` wall time and ignores `active.dirs`: at 8x it shuts in `0.1375s` before opening; live multi-second calls shut after `1.1s`.
   - Fix: set `inspected` (`cards.js:690`) only for files and select pinned dirs; select `dir` in `focusPath`; keep open while `openOnTouchEnabled && active.dirs.has(card.path)` with wall-time `touchLife` >= `0.25s`.

6. **R72-6 (Low, edge case only, P703 `35101e35`): Off lanes and multi-ring drops (`server/agent-depth.js:23-34,140-148`).**
   - `deepestRing` omits `node.active` (unlike `ringUse`, `server/seats.js:118`): 1 sub + 2 off lanes reports `deepestAgents: 3` vs `taken: 1`. Dropping `4 -> 1` with agents on rings 1 and 2 names only ring 2. Edge case: needs off lanes under a sub or a multi-ring drop.
   - Fix: filter by `node.active` and sum all agents on rings `>= body.limit`.

7. **R72-7 (Low, edge case only, P698 `32fe295d`): Weak `openOnTouch` test (`tests/room.test.js:336-351`, `src/engine/room.js:1304`).**
   - Passes `{ folderContents: false, openOnTouch: false }` and checks only `is-collapsed` (from `folderContents`). Undoing `room.js:1304` leaves it green (`65763930` in `Stage.jsx` also lacks a test). Edge case: `cards.test.js` covers `openOnTouch`.
   - Fix: flash a file with `openOnTouch: false` and assert `src` stays collapsed, then toggle `true` and assert it opens.

## Checked and found sound

- **P694 (`a5480146`), P695 (`53e46136`), P700 (`78058877`), `2583ded8`**: brief args kept; 15 CSS classes unused in `src/`; sector labels/13 helpers and 4 lens brackets removed; undo-safe tests.
- **P696 (`18544bdd`)**: incremental strands, shared `PointsMaterial`, `cards.stamp()` cache; undo-safe tests (matches step 1; title said "one draw call").
- **P697 (`551153ef`)**: passive scroll (`scrollY > 2`) with cleanup, 6 `SEAM_TOP` rules keep transitions and reduced-motion override, `createSeamSync` watches `childList` only (no jump), undo-safe tests.
- **P698 closed anchors & P699 shape colour**: strings, tunnels, occluder, brackets, `slotPosition` never point at removed rows; `addView`, `setRoster`, `update`, `setLabels` keep `view.color`.

## Grades

| Merge | Commit | Grade | Reason |
| --- | --- | --- | --- |
| P694 (base) | `a5480146` | A | Brief runs keep effort and model; undo-safe tests. |
| P693 | `2566f39d` | A | Audit doc only; matches repo. |
| P695 | `53e46136` | A | Clean removal of 15 unused CSS rules. |
| P696 | `18544bdd` | A | Clean E6/E11 caching; undo-safe tests. |
| P697 | `551153ef` | A | Clean scroll flatten, no jump; undo-safe tests. |
| P698 + `65763930` | `32fe295d` | B- | Sound anchors, but R72-5 bugs and R72-7 test gap. |
| Lens brackets | `2583ded8` | A | Clean removal of 4 unused lens brackets. |
| P700 | `78058877` | A | Clean sector-label removal and test/doc updates. |
| P699 + `c14b7f94` | `46240636` | C | Shape colours hold, but R72-1 breaks ring state. |
| P701 | `1a1e04b6` | C+ | Clean merge, but R72-2 occlusion/clicks and R72-3 link loss. |
| P703 | `35101e35` | B- | Solid 409 gate and card, but R72-4 stale `deepest` and R72-6. |

## Verification

- `npx vitest run tests/agent-colors.test.js tests/agent-thinking.test.js tests/room.test.js tests/cards.test.js tests/agent-callout-crowd.test.js tests/agent-depth.test.js tests/agent-depth-settings.test.js`: 7 files, 135 passed.
- Node probes proved R72-1, R72-2 (`1280x692` `OVERVIEW`), R72-3, R72-5, R72-6. By-eye checks (P696 to P701) are left to the orchestrator.
