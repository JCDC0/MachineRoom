# Review 74: review 73 fixes and new design, 76726a0f to P716 wiring

Scope: `76726a0f..HEAD` on `main` plus `2a221601` (P712 `9e73bcd9`, P713 `088f287a`, P714 `8bcd7abb`, P711 `4ca98833`, P715 `9070d58c`, P716 `e8b4a4af`; hand commits `2a221601`, `2639b31f`, `aabbcd25`, `f757d307`).

## Findings

1. **R74-1 (High, a user can meet it, P712 `154d1d96` & P713 `0d4ca3bd`): Stale `agent.focus` leaves R73-2 open on non-file tools, keeps brackets while thinking, and mispoints overlaps (`src/model/state.js:251-307`, `src/engine/cards.js:928-943`, `src/engine/room.js:43-62`).**
   - `state.js:281-307` sets `focus` only when `touches.length > 0`, never rebuilds it on `tool.end`, and keeps it (plus `openCalls` on `error`) on `run.start`/`error`; `cards.js:931-938` gates only `active.dirs` on `hasOpenCall` (not `status`/`active.files`); `room.js:43-62` ignores `openCalls`.
   - Cases (Node): (a) R73-2's case (`folderContents: false, openOnTouch: true`): `read src/a.js`, `tool.end`, then 10s `npm test` (`touches: []`) leaves `focus = ['src/a.js']` with `openCalls.size = 1`, re-opening `src` (`openLevel = 1`) for 10s. (b) While thinking, `workingMask` keeps `dimmed: true, targeted: ['src']` and `active.files` keeps `src/a.js`. (c) With `o1` (`src/a.js`) and `o2` (`docs/b.md`), ending `o2` holds `docs` open while open `src` shuts. (d) `error` mid-call leaves `openCalls.size = 1`, holding the folder open.
   - Fix: Rebuild `focus` from open calls on `tool.start`/`tool.end`, clear `focus` on `run.start`, clear both on `error`, check `status === 'working'` (`cards.js:932`) and `openCalls.size > 0` (`room.js:44`).

2. **R74-2 (High, a user can meet it, P716 `e8b4a4af` & `f757d307`): Room inputs stop forced-idle spin or cover `Idle`, and forced idle spins under reduced motion (`src/engine/camera.js:307,388,395,410,440`, `src/Stage.jsx:73-116,829-848,1372-1380,1481-1485`, `src/ui/Hud.jsx:566-626`, `src/styles.css:1941,11052`).**
   - Cases (Node): `force(true)` skips `idleAllowed()`, `camera.js:307` spins before reading `isStill` (`309`), and `focus`/`hold`/`followSpheres`/`overview` set `spin = false`. (a) In forced idle, `0`, `Escape` or empty double-click calls `rig.overview()`, stopping spin (`0.0397 -> 0`) while `Idle` stays pressed; `1`-`9`, `F` or agent/card clicks kill `spin` and open Inspector; pressing `Idle` while `!rig.free()` never spins (`0`). (b) `?` opens `.hud-help-backdrop` (`z-index: 10`) over `.stage.is-idle-forced .transport` (`z-index: 8`), blocking clicks on `Idle`; `C`, `L`, `/` open Work, Log or Chat. (c) Under `prefers-reduced-motion: reduce`, pressing `Idle` spins the camera (`0.04 rad/s`).
   - Fix: Gate `camera.js:307` on `!isStill`; park and close panels in `toggleIdle`; ignore room/HUD shortcuts and picks while `idleForced`; put `.stage.is-idle-forced .transport` above modal backdrops.

3. **R74-3 (Medium, a user can meet it, P713 `953ff81b` & `0d4ca3bd`): Working tunnel disagrees with the open call on non-file tools and overlapping ends (`src/engine/agents.js:1676-1681,2117-2126`, `src/engine/room.js:1022-1031`).**
   - Cases (Node): `aimAt` runs only on non-empty `touches`, and `agents.js:2117` falls back to stale `view.pointer` / `entry.focus[0]`. (a) After `read src/a.js` ends, `npm test` (`touches: []`) draws a grey tunnel (`tunnel = 1`) to stale `src/a.js`. (b) With `o1` (`src/a.js`) and `o2` (`docs/b.md`), ending `o2` updates callout/`doingText`/Inspector to `src/a.js`, while `view.pointer` stays on `docs/b.md`.
   - Fix: Target the tunnel from the newest open call with touches; keep `view.pointer` only for post-run fades.

4. **R74-4 (Medium, a user can meet it, P716 `788f593d` & `f757d307`): Forced idle breaks narrow layout and leaves `Idle` pressed while disconnected (`src/styles.css:11030-11054,11109-11142`, `src/Stage.jsx:1481-1490`).**
   - Cases: `styles.css:11030-11054` scopes `padding-top: 0`, `.lens { height: 100vh }` and `.transport { position: fixed }` to `min-width: 900px`, while `11109-11142` hides `.hud-menu` and other `.transport` children at all widths. (a) Pressing `Idle` below `900px` (or resizing narrow while forced) leaves a 52px blank top bar, `.lens` at `58vh` and `.hud-dock` visible. (b) Pressing `Idle` while `bridgeDown` (`Stage.jsx:1481-1485`) stays `stage is-disconnected` yet sets `aria-pressed="true"`, then forces idle on reconnect.
   - Fix: Scope `.stage.is-idle-forced` hiding rules to `min-width: 900px` (or hide `.hud-dock` and clear `padding-top`), and ignore `toggleIdle` while `bridgeDown`.

5. **R74-5 (Low, a user can meet it, P715 `ca025b95`): In Gyro, both thinking rings precess in phase (0 deg apart) instead of 180 deg apart (`src/engine/agents.js:237-247`, `tests/agent-thinking.test.js:278-282`).**
   - Case (Node): Normal `(0,0,1)` under `Rx(20 deg)` has `+z` while under `Rx(110 deg)` it has `-z`; subtracting `PI/2` in `b.y` (`agents.js:246`) flips `-z` to `+z`. At `t = 3.5, 4.0, 4.5 s`, Ring A and B azimuths match (`112.5`, `-45.0`, `157.5 deg`). `agent-thinking.test.js:282` checks only raw `a.y - b.y`.
   - Fix: Use `+ (Math.PI / 2) * env` at `agents.js:246` (or `SPINNER_REST_B_X - tilt`) and assert 3D azimuths 180 deg apart.

6. **R74-6 (Low, edge case only, `2a221601`, `2639b31f`, `f757d307`): Hand commits lack tests, and `agents.js:863` keeps a dead root click handler (`tests/stage-snapshot.test.js:101-135`, `tests/bridge-stream.test.js:291,335`, `tests/camera.test.js`, `tests/agent-callout-crowd.test.js:377`, `src/engine/agents.js:860-864`).**
   - Case: Undoing `Stage.jsx:69,373-374,444,1481-1485`, `Hud.jsx:1088-1089,1105-1106` or `camera.js:208` breaks zero tests. `agent-callout-crowd.test.js:377` calls root `click` though `pointerEvents = 'none'` (`agents.js:904`) and `stopPropagation` on `title`/`consoleLink` block it. Edge case: regression gap only.
   - Fix: Test `sameSnapshot` (`openCalls`/`tool`), `resetRunState` (`openCalls`), `camera.js` `.mr-callout` and `Hud`/`Stage` `onToggleIdle`/`idleForced`; stop `pointerdown`/`dblclick` on `consoleLink` and drop root `click`.

## Sound

- **R73-1 (`2a221601`)**: `agents.js:904` beats `CSS3DObject`'s inline `auto` across renders; title picks agent, link opens cleanly, body passes through.
- **P712 R73-4 (`aa7aa46c`, `19002080`)**: `focusPath` clears `inspected`; pinned subfolders record own touches; `run.end` records cancelled 8x touches.
- **P713 + `2639b31f`**: `openCalls` Map, `latestOpenCall`, snapshots, `hasOpenCalls` callout gating and `Stage.jsx` close R73-3 (a), (b), (d) and overlap labels.
- **P714 (`8bcd7abb`)**: Server and UI count `newLimit <= ring < currentLimit`, match `seats.js:levelOf`, keep 409 fallback, with undo-safe tests.
- **P711 (`4ca98833`, `aabbcd25`)**: 0 broken imports; `npm run build`, 74 server/script imports and 4 CLI `node --check` pass.
- **P715 (`9070d58c`)**: Max 1 ms step across 0..8s is `0.0168 rad` (Euler/quaternion); `bright <= 1.5`; reduced motion and non-thinking hold upright.

## Grades

| Merge / Commit | Commit | Grade | Reason |
| --- | --- | --- | --- |
| R73-1 hand | `2a221601` | A- | Closes R73-1; `camera.js:208` untested, dead root click (R74-6). |
| P712 | `9e73bcd9` | C | Closes R73-4; R74-1 leaves R73-2 `npm test`, brackets, overlap open. |
| P713 + `2639b31f` | `088f287a` | B | Unifies Inspector/ring/callout; R74-3 tunnel, `2639b31f` untested. |
| P714 | `8bcd7abb` | A | Clean server + UI fix with undo-safe tests. |
| P711 + `aabbcd25` | `4ca98833` | A | Clean dead-code removal; zero broken callers. |
| P715 | `9070d58c` | B+ | Smooth 8s loop and reduced-motion guard; Gyro aligned (R74-5). |
| P716 + `f757d307` | `e8b4a4af` | C | `force()` and row work; R74-2, R74-4, R74-6 gaps remain. |

## Verification

- `npx vitest run` (17 test files): 389 passed. `npm run build`: passed (202 modules).
- Node probes proved R74-1, R74-2, R74-3, R74-5 and P711 (74 imports, 4 CLI `node --check` OK). By-eye checks left to orchestrator.
