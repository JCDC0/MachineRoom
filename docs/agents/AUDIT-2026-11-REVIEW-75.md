# Review 75: the review 74 fixes, 7189db1d to c9771c4c

Scope: `7189db1d..c9771c4c` on `main`: `5d769a4f` (Stage forced idle, snapshot tests), P718 `166bc968` (`510e3df9`, `6f2623eb`, `1f181786`), P719 `c9771c4c`, doc commits `ba98629d`, `452987e0`, `96802cee`.

## Findings

1. **R75-1 (High, a user can meet it, P719 `c9771c4c`, R74-4 regression): Below 900px, forced idle hides `Idle` itself and traps the user (`src/styles.css:11087-11152`, `src/ui/idleView.js:16-24`, `tests/layout-css.test.js:551-564`).**
   - `stageClassName` emits `stage is-idle is-idle-forced`. `c9771c4c` moved `.stage.is-idle-forced .transport`/`.transport-idle` inside `@media (min-width: 900px)` (`11110-11146`), while `.stage.is-idle .hud-menu, .stage.is-idle .transport` (`11087-11100`) stayed unscoped.
   - Case (PostCSS 800px): Pressing `Idle` below 900px (or resizing narrow) matches `.stage.is-idle .transport` (`opacity: 0; pointer-events: none; transform: translateY(100%)`) with no override, hiding `Idle` off-screen; `.hud-menu` leaves a 52px gap, `.lens` keeps `pointer-events: none !important` (`11149`), and keys wait. `layout-css.test.js:555` checks only `.stage.is-idle-forced`.
   - Fix: Wrap `styles.css:11087-11107` in `@media (min-width: 900px)` and test the 800px cascade for `stage is-idle is-idle-forced`.

2. **R75-2 (High, a user can meet it, `5d769a4f` & P719 `c9771c4c`, R74-2 incomplete): Wheel scroll, `/`, open panels and Tab still break forced idle (`src/Stage.jsx:1069-1083,1351-1386,1483-1494`, `src/ui/Hud.jsx:597-630,1335-1346`, `src/ui/Assistant.jsx:80-106`, `src/styles.css:4602,8159,11149-11152`).**
   - Cases: (a) Wheel at 900px+: `pointer-events: none !important` on `.lens` skips `camera.js:241-252` (`preventDefault`), scrolling `.stage` (`overflow: visible`, `8159`) to `.hud-lower`; clicking `Focus`, a cost row or `Show the tree` calls `rig.hold()`, stopping spin and opening Inspector while `Idle` stays pressed. (b) `/` in replay or no-orchestrator live: `Hud.jsx:1337` mounts `<Assistant />` without `idleForced`; `Assistant.jsx:82` opens `.mr-assistant` (`z-index: 50` over `.transport` `20`), where `overview`/`focus`/`follow` stop spin and dragging covers `Idle`. (c) Open panels and Tab: `toggleIdle` (`1483-1490`) closes only Inspector; open Work, Settings, Log, Help or Agents list stays up, `Hud.jsx:598` blocks `Escape` on Help/Settings/Health, clicking an Agents row stops spin, and `Shift+Tab` from `Idle` hits invisible `Center` (`Enter` -> `parkRoom()` -> `spin = false`).
   - Fix: Guard `focus`/`overview`/`onPick`/`onInspect`/`onShowGitTree` on `idleForcedRef.current`; scroll to top on `toggleIdle(true)`; close HUD panels, Agents list and `Assistant` when forced and pass `idleForced` to `Assistant`; lock `.stage.is-idle-forced` scroll (`height: 100vh; overflow: hidden` at 900px+) and add `visibility: hidden` to hidden controls.

3. **R75-3 (High, a user can meet it, `5d769a4f`, R74-4 incomplete): A dropped bridge during forced idle locks all keys and `Idle` (`src/Stage.jsx:1327,1483-1499`, `src/ui/Hud.jsx:269-270,570,598`, `src/ui/idleView.js:87-91`).**
   - Case (Node): Press `Idle` live (`forced() === true`), then drop the bridge (`bridgeDown = true`). `Stage.jsx:1497` calls `halt()`, setting `idle = false` (`stage is-disconnected`, menu/transport return) while `locked` and `idleForced` stay true. Room keys (`1327`) and HUD keys (`Hud.jsx:570,598`) stay blocked, `Idle` reads `aria-pressed="true"`, clicking `Idle` returns early (`1484`), and reconnect re-enters forced idle.
   - Fix: On `bridgeDown` (`Stage.jsx:1496-1499`), call `force(false)` and clear `idleForcedRef.current`/`idleForced` before `halt()`; gate key blocking on `idle && idleForced`.

4. **R75-4 (Medium, a user can meet it, P718 `1f181786`, R74-3 incomplete): Stale `view.pointer` jumps the tunnel on call end and drops post-run glow after seek (`src/engine/agents.js:1679-1706,2128-2164`, `src/engine/room.js:1030-1037`).**
   - Cases (Node, `createAgents`): (a) Overlap: `o1` (`src/a.js`) and `o2` (`docs/b.md`) open (`aimAt` leaves `view.pointer = docs/b.md`); `o2` ends -> tunnel aims at `src` (`x = 100`); `o1` ends -> `2128` switches to stale `view.pointer`, jumping `view.touch` to `docs` (`x = -200`) during the 0.6s fade (`tunnel = 0.833`) and 5s green `run.end` (`0x2aff80`). (b) Multi-touch `[src/a.js, docs/b.md]`: `focusPointer` (`1690`) picks first (`src`), `room.js:1030-1036` leaves `view.pointer` on last (`docs`), jumping on end. (c) Seek into open call then `run.end`: `snap()` (`2196`) clears `view.pointer = null`; working tunnel aims at `src` (`tunnel = 1`), then `run.end` (`ok: true`) gets `pointer = null` and fades to `tunnel = 0`.
   - Fix: At `agents.js:2128`, mirror any non-null `focusPointer` into `view.pointer` while `working`, and match touch pick order with `aimAt`.

5. **R75-5 (Medium, edge case only, `1f181786`, `c9771c4c`, `5d769a4f`, R74-6 incomplete): R74-3's test passes undone, and forced-idle guards lack tests (`tests/agent-view.test.js:144-167`, `tests/hud-menu.test.js:58-78`, `tests/camera.test.js`, `tests/stage-snapshot.test.js`, `tests/agent-callout-crowd.test.js:384-390`).**
   - Cases (Node): (a) `agent-view.test.js:144-167` calls `aimAt` before the first `update`, so `setStatus` (`agents.js:1653`) wipes `view.pointer = null` before line 2128, and `o2` ends before the assert so `focus[0]` equals `o1`; running it on `1f181786~1:src/engine/agents.js` (R74-3 undone) still returns `aimed.at(-1) === 'src'` and `view.tunnel === 0`. (b) Undoing `Hud.jsx:570,598` (P719 step 2), `camera.js:208` `.mr-callout` (P719 step 4), `Stage.jsx:1327,1484-1490` or `agents.js:896` (`dblclick`) breaks zero tests. Edge case: regression gap only.
   - Fix: Call `update` after `run.start` before `aimAt` in `agent-view.test.js`, assert overlap plus fade/`run.end`; test `Hud` forced-idle keys, `camera.js` `.mr-callout`, `Stage` `toggleIdle`/`onKey` and `consoleLink` `dblclick`.

6. **R75-6 (Low, edge case only, P718 `510e3df9` & `6f2623eb`): Undeduplicated `viewKey` causes extra layouts on `tool.end`, not visible defects (`src/engine/cards.js:73-78,148-150,965-971`).**
   - Case (Node, 10 fixtures, `510e3df9~1` vs `HEAD`): `planDiffs = 0`, `maxPosDelta = 0` on all 10 fixtures. The six digests changed only because `viewFocus` (`73-78`) appends `agent.focus` and `freshRecent` without dedupe, flipping `viewKey` on `tool.end` and doubling layout runs (`sandbox` 37 -> 70, `scenario-a` 16 -> 33). Edge case: CPU/digest churn only.
   - Fix: Deduplicate `viewFocus` (or `viewKey`) so `recompute()` skips `cardPlan`/`layoutRing` when the focus set is unchanged.

## Sound

- **R74-1 (`510e3df9`)**: `focusFromOpenCalls`, `hasActiveCall`, `workingMask` close all four R74-1 cases with undo-safe tests.
- **R74-5 (`1f181786`)**: Gyro normals stay 180.0 deg apart (`3.5` to `4.5 s`, `dot = 0`), max 1 ms step `0.01678 rad`, undo-safe test.
- **R74-6 callout/snapshots (`5d769a4f`, `1f181786`)**: Root `click` dropped; `sameSnapshot`/`resetRunState` cover `openCalls`.
- **R74-2 reduced motion / Transport (`c9771c4c`)**: `camera.js:308` stops spin; `Hud` wires `idleForced`/`onToggleIdle` at 1280px and 600px.
- **Replay layouts (`6f2623eb`)**: Bitwise identical plans and positions across all 10 fixtures.

## Grades

| Merge / Commit | Commit | Grade | Reason |
| --- | --- | --- | --- |
| Stage hand | `5d769a4f` | C+ | Snapshot tests OK; R75-3 locks keys on disconnect, R75-2/R75-5 gaps. |
| P718 merge | `166bc968` | B- | Closes R74-1, R74-5, layouts OK; R75-4 tunnel, R75-5 undo test, R75-6 churn. |
| P719 hand | `c9771c4c` | D+ | Reduced motion OK; R75-1 hides `Idle` below 900px, R75-2 inputs, R75-5 skipped tests. |

## Verification

- `npx vitest run` (12 touched test files): 266 passed. `npm run build`: passed (202 modules).
- Node probes verified R75-1, R75-3, R75-4, R75-5, R75-6 and R74-5. By-eye checks left to orchestrator.
