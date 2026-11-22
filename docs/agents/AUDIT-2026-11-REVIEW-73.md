# Review 73: the review 72 fixes, P705 to P707

Scope: `13bb19c5..031e2681` on `main` (merges P706 `c86522d8`, P705 `cabbe4f2`, P707 `031e2681`; commits `ce3dbe30`, `19c81bd1`, `50de8d8e`, `96496dda`, `3cb48785`, `6fccfcd8`, `5c5a2343`, `894d6e49`, `a3579ae9`; hand commit `81915cb8`; plan `d3d0910c`).

## Findings

1. **R73-1 (High, a user can meet it, P705 `5c5a2343`): `CSS3DObject` sets inline `pointer-events: auto` on `.mr-callout`, so clicks and drags still land on the callout body (`src/engine/agents.js:720-723,751-761`, `src/styles.css:2892`, `src/engine/camera.js:214`).**
   - `new CSS3DObject(element)` (`agents.js:761`, `CSS3DRenderer.js:49`) writes inline `element.style.pointerEvents = 'auto'`, overriding `.mr-callout { pointer-events: none }` (`styles.css:2892`), while root `element` (`agents.js:720-722`) still binds `pointerdown` (`stopEvent`) and `click` (`onPick(key)`).
   - Case: clicking or dragging `.mr-callout-task`, `.mr-callout-cmd` or `.mr-callout-console-body` hits `.mr-callout`, blocks camera drags and card clicks behind it, and selects the agent (`tests/layout-css.test.js:505` only checks CSS text; `tests/agent-callout-crowd.test.js:377` clicks root `element`). Also `consoleLink` (`agents.js:751-753`) stops only `click` and `camera.js:214` omits `.mr-callout`, so once root `pointer-events: none` works, clicking `a.mr-term-console-link` bubbles `pointerdown`/`pointerup` to `surface` and triggers `rig`'s click handler (`room.js:458-476`).
   - Fix: set `element.style.pointerEvents = 'none'` after `new CSS3DObject(element)`, remove `pointerdown`/`click` from root `element`, and stop `pointerdown`/`dblclick` on `consoleLink`.

2. **R73-2 (High, a user can meet it, P706 `3cb48785`): Touched folders never shut after `tool.end` while the run continues, or after seeking past `tool.end` (`src/model/state.js:267-284`, `src/engine/cards.js:937-944,1159,1171-1176`).**
   - `apply()` sets `agent.focus` on `tool.start` (`state.js:268`) and deletes `activity.id` from `agent.openCalls` on `tool.end` (`state.js:273`), but clears `agent.focus` only on `run.end`/`agent.end` (`state.js:199,300`; `run.start` at `243` and `error` at `285` keep it too), while `recompute()` (`cards.js:938-944`) builds `active.dirs` from `agent.focus` without checking `agent.openCalls`.
   - Case (`folderContents: false, openOnTouch: true`): an agent reads `src/a.js` (`tool.start` `c1`), ends it (`tool.end` `c1`, `ok: true`), and thinks or runs `npm test` (`touches: []`) for 10s. After `touchLife` (`1.1s`) expires, `openCalls.size` is `0` (`thinking`), yet `agent.focus` stays `['src/a.js']` and `src` stays open (`openLevel = 1`) until `run.end` or a touch in another folder. Seeking (`cards.sync`) past `tool.end` mid-run also snaps `src` open (`tests/cards.test.js:1603` sent `run.end` instead of `tool.end`, and `1642` skipped `apply`).
   - Fix: update `agent.focus` from remaining open calls on `tool.end` in `state.js` (empty when `openCalls.size === 0`, and cleared on `run.start`/`error`), or build `active.dirs` in `cards.js:938` only while `agent.openCalls?.size > 0`.

3. **R73-3 (Medium, a user can meet it, P705 `ce3dbe30`): Inspector state word, `doingText`, callout and tunnel disagree with `openCalls` after seek, live `tool.end`, overlapping calls, or a failed call (`src/engine/room.js:526,1273-1277`, `src/Stage.jsx:364-378,430-445,1505-1508`, `src/model/player.js:98-110`, `src/live/livePlayer.js:167-179`, `src/model/state.js:258-284`, `src/engine/agents.js:294-307,1756,1831-1833,1945-1949`).**
   - Cases: (a) `player.seek()` into an open call (`t = 800ms` between `tool.start` `1500ms` and `tool.end` `3000ms`) calls `room.sync` (`room.js:526`), clearing `room`'s `openCalls` while `player.snapshot()` omits `openCalls`; 3D rings are yellow and `doingText` says `read src/a.js`, but `room.callsFor` (`Stage.jsx:1506`) returns `{ count: 0, tool: '' }` and Inspector says `thinking` (`tests/agent-colors.test.js:768` passed `openCalls` by hand). (b) In live mode, `tool.end` (`ok: true`) leaves `status`/`label` unchanged and `livePlayer.snapshot()` / `sameAgent` (`Stage.jsx:364-378`) omit `openCalls`; when `tool.start` and `tool.end` share a second (`shownField` at `Stage.jsx:383`) and the agent thinks, `sameSnapshot` drops the update and leaves Inspector on `working` (`resetRunState` at `Stage.jsx:441` also omits `agent.openCalls?.clear()`). (c) When `t1` (`npm run dev`) and `t2` (`read src/a.js`) overlap and `t2` ends, `state.js:259` keeps `t2`'s ended label in `doingText` and Inspector pairs `t1`'s tool (`shell`) with `t2`'s command. (d) When a sole call ends with `ok: false`, `openCalls.size` is `0` (`thinking`), yet `agents.js:1756,1831,1948` checks `Boolean(entry?.label)` instead of `hasOpenCalls(entry)`, keeping a red tunnel and error callout while thinking.
   - Fix: track `{ tool, label, touches }` per open call in `state.js`, include `openCalls: agent.openCalls.size` and `tool` in `player.snapshot()`, `livePlayer.snapshot()` and `sameAgent`, clear `openCalls` in `resetRunState`, and gate `working` in `agents.js:1756` on `hasOpenCalls(entry)`.

4. **R73-4 (Medium, a user can meet it, P706 `96496dda`, `3cb48785`): `room.focusPath` on an undrawn subfolder keeps its parent open, and 8x touches before `run.end` shut without opening (`src/engine/room.js:900,971-972,1169-1185`, `src/engine/cards.js:1651-1661`).**
   - Cases: (a) in `room.focusPath('src/ui/sub')` (`room.js:1175-1185`), `cards.pin('src/ui/sub')` does not run `recompute` before `cards.flashCluster('src/ui/sub', 'white')` (`cards.js:1655-1660`), so `cards.get('src/ui/sub')` is `undefined` and `flashCluster` runs `recordTouch('src/ui', 1100)`: with `folderContents: false` and default `openOnTouch: true`, clicking `src/ui` then `sub` in Inspector opens `src/ui/sub` and keeps parent `src/ui` open for `1.1s` (`tests/e2e-room.test.js:1747` set `openOnTouch: false`); also `focusPath` on a file (`room.js:1169`) skips `cards.setInspected(null)`, leaving any previously inspected file's folder open (`cards.js:1158`). (b) At 8x, when `tool.start` touches `src/a.js` at `t = 1000ms` and `run.end` arrives at `t = 1300ms` (`37.5ms` wall time, before the `0.5s` star lands), `onActivity('run.end')` (`room.js:971-972`) cancels the star and clears `agent.focus`, so `recordTouch` never runs and `src.openLevel` (`<= 0.15`) shuts without opening.
   - Fix: in `room.focusPath`, always clear `inspected = null` and `cards.setInspected(null)`, and in `cards.flashCluster` (`cards.js:1655`) record the touch on `path` when `pinned.has(path)`; on `run.end` (`room.js:971-972`), land or record touches for stars of that run.

5. **R73-5 (Low, edge case only, P707 `894d6e49`, `a3579ae9`): Depth confirm and 409 count rings `>= current.limit` that are already hidden (`server/agent-depth.js:17-37,165`, `src/ui/AgentDepthSettings.jsx:23-37,136,187`).**
   - Case: `occupiedDepthProblem` (`server/agent-depth.js:22`) and `hideOccupiedText` (`AgentDepthSettings.jsx:26`) filter by `item.ring >= limit` without `item.ring < currentLimit`, and `pickDepth` / `POST /api/agent-depth` check `limit <= deepest`. At depth `4`, with 1 sub on Ring 1 and 1 sub on Ring 2, lowering `4 -> 2` (`hideOccupied: true`) hides Ring 2; lowering `2 -> 1` next newly hides only Ring 1 (1 agent), but the confirm and 409 say `Rings 1 and 2 hold 2 agents...` (and with `rings: [{ ring: 2, agents: 1 }]` at `limit = 2`, lowering `2 -> 1` prompts when nothing new hides). Edge case: requires a second depth drop after hiding a deeper ring.
   - Fix: filter occupied rings to `item.ring >= newLimit && item.ring < currentLimit`.

## Checked and found sound

- **P705 R72-3 (`50de8d8e`)**: compact callouts keep live console rows/link, and `onPointerMove` (`room.js:420-441`) expands hovered `.mr-callout[data-agent]`; undo-safe tests.
- **P706 R72-5(a) & R72-7 (`19c81bd1`, `6fccfcd8`)**: subfolder row click pins, recomputes, selects and opens it while shutting its parent; `tests/room.test.js:370-426` fails with `room.js:1328` undone.
- **P707 (`894d6e49`, `a3579ae9`) & `81915cb8`**: `deepestRing` filters by `node.active`; `client.js:76-89` keeps 409 fields; `AgentDepthSettings.jsx` refreshes on `family`/`agents` notices, opens Hide on 409, and keeps quoted `openerSelector: 'mr-depth-confirm'`; `Stage.jsx:1369` and `ACTIVITIES.md:52-59` match `.mr-callout`.

## Grades

| Merge / Commit | Commit | Grade | Reason |
| --- | --- | --- | --- |
| Hand commit | `81915cb8` | A | Guards `.mr-callout` in `Stage.jsx:1369` and updates `ACTIVITIES.md`. |
| P706 | `c86522d8` | C+ | Fixes subfolder clicks and `room.test.js`, but R73-2 and R73-4 leave touched/parent folders open and drop 8x end-of-run touches. |
| P705 | `cabbe4f2` | C | Fixes 3D ring on single `tool.end` and compact consoles, but R73-1 leaves inline `pointerEvents = 'auto'` and R73-3 leaves Inspector/`doingText`/tunnel out of sync. |
| P707 | `031e2681` | A- | Closes R72-4 and R72-6 with undo-safe tests; only R73-5 remains. |

## Verification

- `npx vitest run` on 13 changed/related test files: 292 passed.
- Node probes verified R73-1, R73-2, R73-3 and R73-5. By-eye checks are left to the orchestrator.
