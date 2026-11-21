# Review 66: review 64 and 65 fixes, agent seats and the engine chunk (ec864944 to P640)

Scope: `git log ec864944..HEAD` on `main`. The range `ec864944..d54b8dde` (to the P639d merge) holds 12 merges (`P667`, `P665`, `P670`, `P666`, `P668`, `P669`, `P639b`, `P639a` step 1, `P671`, `P639c`, `P672`, `P639d`), three hand code/test commits by the orchestrator (`22242ee8`, `15d68576`, `72edd85c`), and 10 brief commits (`6f100cdc`, `0f446626`, `1321c509`, `6d715841`, `3b5185d8`, `453fd4ac`, `75c681d6`, `e677378c`, `644201cd`, `d25915d2`). After `d54b8dde`, `caaa15ff` merged `P640` (`85f766f5`) at `HEAD` and is also graded below.

## Findings

| ID | Severity | Merge / Commit | Location | Summary |
| --- | --- | --- | --- | --- |
| R66-1 | High | P668 | `server/orchestrators.js:1441-1445` | Owner ladder save ignores `seatCheck` refusals, so the owner can still save a sub past the subagent depth. |
| R66-2 | Medium | P639c | `src/control/mock.js:916-948` | `mockRingRows` counts top-level subs on ring 0 instead of ring 1, making mock seat counts disagree with `server/seats.js`. |
| R66-3 | Medium | `22242ee8` | `src/Stage.jsx:980`, `server/active-lanes.js:441`, `server/agents-config.js:576`, `server/agent-depth.js:110` | `Stage.jsx` updates `setSeatCounts` only on `family` notices, while lane toggle, lane create and depth save emit only `agents`. |
| R66-4 | Medium | P639d | `src/ui/FamilyTree.jsx:1828-1874`, `src/control/client.js:777`, `server/agents-config.js:540` | Creating a lane under a sub or lane checks ring 0 first and fails without an `overRing` confirm if the sub's ring is full. |
| R66-5 | Medium | P665 | `src/ui/Hud.jsx:1066-1074`, `src/ui/Transport.jsx:261` | Narrow layout (`< 900px`) omits `orchestrator` from `Transport`, dropping a working or waiting main orchestrator from the bottom Agents button. |
| R66-6 | Low | P639c, P639d | `src/ui/FamilyTree.jsx:1150,1893,2671`, `server/family.js:527,533` | `made by` shows raw `orchestrator` when idle main is hidden, `runOrOverRing` skips `refresh` on retry, `askSeatSave` prints two error notes, and `/api/family/seats` reuses top-agent error text. |
| R66-7 | Low | P669, P640 | `server/runs.js:2305`, `docs/agents/FREE-HIERARCHY.md:39` | `/api/control/issues` still runs `readMainSubjects` on MachineRoom's repo when serving another project, and `FREE-HIERARCHY.md` says the ring itself turns full opacity when full. |
| R66-8 | Low | P671, P639d | `tests/build-chunks.test.js:81-83`, `tests/control-contract.test.js:1070-1096` | `build-chunks.test.js` dropped `three`/`react` empty-imports checks, and `src/control/client.js:695-697` (`setActiveLanes` `overRing`) has no `createClient` unit test. |

### Details

1. **R66-1 (High): Owner ladder save skips `seatCheck` refusals (`server/orchestrators.js:1441-1445`, P668).**
   - P668 updated `seatCheck` in `server/seats.js:343` to return `{ ok: false, status: 409, reason: 'Ring N is past the subagent depth of D.' }` when the owner turns on a `sub` past `lastRing`.
   - In `server/orchestrators.js:1441-1445`, `ladderChange` calls `seatCheck({ ...after, actor: { owner: true }, action: 'turnOn', target: node.id })`, then passes `seat.overRing` to `overRingProblem(body, seat.overRing)` without checking `seat.ok === false`. Because `seatCheck` sets no `overRing` when it refuses, `overRingProblem(body, undefined)` returns `null`, `node.active = true` runs, and the bridge saves the illegal sub.
   - Failing case: Proved directly against `createOrchestrators` at `depth: 2`. Calling `orchs.ladderChange({ by: 'owner', confirmed: true, ladder: { subs: [{ id: 'a', name: 'A', harness: 'claude', model: 'opus', scope: ['**'], lanes: [] }, { id: 'b', name: 'B', parent: 'a', harness: 'claude', model: 'opus', scope: ['**'], lanes: [] }] } }, true)` returned HTTP `200` and saved `b` under `a` (ring 2) instead of HTTP `409` `Ring 2 is past the subagent depth of 2.`.
   - Fix: In `server/orchestrators.js:1442`, check `if (!seat.ok) return { status: seat.status ?? 409, body: { error: seat.reason } }` before `overRingProblem(body, seat.overRing)`, and add a bridge test for an owner `POST /api/orchestrator/ladder` past `depth`.

2. **R66-2 (Medium): Mock `family().seats` places subs one ring too low (`src/control/mock.js:916-948`, P639c).**
   - In `mockRingRows()`, `levelOfSub(id)` starts `level` at `0` and increments once per entry in `parentOf` (which only holds `subs`). Top-level subs in `SAMPLE_LADDER` (`frontend`) and `readLadder` have `parent === undefined`, so `parentOf.get(id)` is `undefined` and `levelOfSub('frontend')` returns `0` instead of `1`.
   - Lanes under `frontend` use `levelOfSub('frontend') + 1 = 1`, so `mockRingRows` counts the sub on ring 0 and its lanes on ring 1, while `server/seats.js` (`levelOf`) counts both on ring 1.
   - Failing case: Proved directly against `createMockClient({ latencyMs: 0 }).family()`. With default `SAMPLE_LADDER` (`frontend` active with `opencode2` and `opencode3`) and three active ring-0 lanes (`claude`, `opencode`, `opencode4`), `family().seats` returned `[{"ring":0,"taken":4,"limit":null},{"ring":1,"taken":2,"limit":null}]` instead of `taken: 3` on ring 0 and `taken: 3` on ring 1.
   - Fix: In `src/control/mock.js:920`, start `let level = 1` (stopping if `current === 'orchestrator'` or not in `parentOf`) so every top-level sub is ring 1, and match `seatSummary` / `ringSummary` in `tests/family.test.js`.

3. **R66-3 (Medium): Room `X / Y` ring seat labels go stale on lane toggle, create and depth change (`src/Stage.jsx:980`, `22242ee8`).**
   - `Stage.jsx:980` subscribes `updateLabels` (which fetches `client.family()` and calls `roomRef.current?.setSeatCounts?.(...)`) only to `['family']`.
   - `POST /api/lanes/active` (`server/active-lanes.js:441`), `POST /api/lanes/create` (`server/agents-config.js:576`) and `POST /api/agent-depth` (`server/agent-depth.js:110`) emit only `{ topic: 'agents' }`, not `{ topic: 'family' }`. `FamilyTree.jsx:774` listens to both `family` and `agents` and updates immediately, while `Stage.jsx` does not.
   - Failing case: Set ring 0 seats to 2 with 1 lane on (`1 / 2`, white). Turn a second lane on in Agents (or create a lane, or change depth in Settings). The Agents tree reads `Ring 0 · 2 of 2 seats` in yellow at once, while the 3D room label stays `1 / 2` in white for up to 60 seconds until the next `family` poll.
   - Fix: Either subscribe `updateLabels` in `src/Stage.jsx:980` to `['family', 'agents']` (orchestrator-owned) or emit `{ topic: 'family' }` alongside `{ topic: 'agents' }` in `server/active-lanes.js:441`, `server/agents-config.js:576` and `server/agent-depth.js:110`.

4. **R66-4 (Medium): New lane under a sub or lane checks ring 0 and fails without an `overRing` confirm on ring 1 (`src/ui/FamilyTree.jsx:1828-1874`, `server/agents-config.js:540`, P639d).**
   - `createUnder(parent, payload, overRing)` always calls `client.createLane(...)` first without a target ring or `parent`. `POST /api/lanes/create` (`server/agents-config.js:540`) runs `seatCheck(..., action: 'createLane')` on the orchestrator's ring (ring 0).
   - It then calls `client.setLadder(...)` (`FamilyTree.jsx:1855,1860`) to move the active new lane under `parent` (ring 1+). `client.setLadder` does not accept `overRing`, and `createUnder` does not retry `setLadder` on `error.overRing`.
   - Failing case: (a) Ring 0 is full (`taken: 2, limit: 2`) and ring 1 has free space (`taken: 1, limit: 4`). Adding a new lane under a ring-1 sub asks `Ring 0 is full. Make it anyway?` even though the lane is going onto ring 1. (b) Ring 0 is free and ring 1 is full (`taken: 4, limit: 4`). `createLane` creates and activates the new lane on ring 0, then `setLadder` throws 409 `{ error: 'Confirm going past the seats on ring 1.', overRing: 1 }`; `createUnder` catches it at line 1867 and shows `The agent was created. Confirm going past the seats on ring 1.` with the lane stranded on ring 0.
   - Fix: Pass `overRing` through `setLadder` in `src/control/client.js`, handle `error.overRing` on `setLadder` in `createUnder` (and pass `parent` to `createLane` or check the target ring first so ring 0 is not blamed for a sub's lane).

5. **R66-5 (Medium): Narrow layout (`< 900px`) drops the main orchestrator from the bottom Agents button (`src/ui/Hud.jsx:1066-1074`, `src/ui/Transport.jsx:261`, P665).**
   - `Hud.jsx:1080-1089` passes `orchestrator={orchestratorInfo}` to `<Transport>` only when `wide` (`>= 900px`); line `1066-1074` (`!wide`) omits `orchestrator`.
   - Below 900px, `main` inside `Transport.jsx` is `undefined`. When only the main orchestrator is working (no working session or active lane pill), line 261 (`if (!main && sessions.length === 0 && lanes.pills.length === 0)`) returns without the Agents button; when other agents are also working, `mainWorking` and `mainWaiting` stay `false`, so the count is one too low and `Orchestrator` is missing from the dropdown.
   - Also in `Transport.jsx:261`, `orchestratorChips` is computed after the `!main` early return, so a working or waiting sub when `main` is absent would not keep the button visible either.
   - Fix: Pass `orchestrator={orchestratorInfo}` to the `!wide` `<Transport>` in `src/ui/Hud.jsx:1066-1074`, and move `orchestratorChips` above the early return in `src/ui/Transport.jsx:261` checking `chips.some((chip) => chip.tone === 'working' || chip.waiting)`.

6. **R66-6 (Low): Minor UI and route wording issues in P639c and P639d (`src/ui/FamilyTree.jsx`, `server/family.js`).**
   - `src/ui/FamilyTree.jsx:2671`: `made by` looks up `tree.nodes.find((row) => row.id === node.createdBy)?.label || node.createdBy`. When `top` is a session and `orchestrator` is idle, `GET /api/family` hides `orchestrator` from `nodes`, so lanes it created render lowercase `made by orchestrator` instead of `made by Orchestrator` (or its saved label).
   - `src/ui/FamilyTree.jsx:1150` (`runOrOverRing`): the confirm callback `run: () => run(ring)` does not call `refresh()` after `run(ring)` resolves, unlike the first attempt at line 1141 and `createUnder` at line 1873.
   - `src/ui/FamilyTree.jsx:1893` + `1128` (`askSeatSave`): on `setRingSeats` failure, `askSeatSave` sets `seatProblem` and rethrows to `runConfirm`, which also sets `actionError`, showing two error alerts for one failure.
   - `server/family.js:527,533`: `POST /api/family/seats` returns `ORIGIN_TOP_PROBLEM` (`A request to set the top agent needs a page Origin.`) and `CONFIRM_TOP_PROBLEM` (`Confirm putting the agent at the top first.`) instead of seat-specific wording (matching the P639a brief's literal instruction).
   - Fix: Default `'orchestrator'` to `'Orchestrator'` in `made by`, `await refresh()` inside `runOrOverRing`'s retry `run`, keep seat-save errors in `seatProblem` alone (or clear `actionError`), and give `/api/family/seats` its own origin/confirm messages.

7. **R66-7 (Low): Leftover R64-10 project-root check and one inaccurate doc clause (`server/runs.js:2305`, `docs/agents/FREE-HIERARCHY.md:39`).**
   - R64-10 noted that `GET /api/control/issues` reads MachineRoom's `git log` via `readMainSubjects()` even when serving another project. P669 cached `readMainSubjects()` for 30s (`server/runs.js:146-166`), which cuts poll spawns, while `GET /api/control/issues` (`line 2305`) still invokes it (and `readLaneBriefs()`, `line 2311`) for non-MachineRoom checkouts.
   - `docs/agents/FREE-HIERARCHY.md:39` (added in `P640`) says `the ring's X / Y label is yellow with its ring at full opacity`, whereas `src/engine/hub.js:651-653` sets full opacity only on the `X / Y` label sprite (`sprite.material`), leaving the park ring line at its normal opacity.
   - Also note: R64-7 (park rings ignoring `latticeLevels().floor` and a sub overlapping its middle lane) was not scheduled in P665-P672 and remains open from Review 64.
   - Fix: Skip `readMainSubjects()` in `GET /api/control/issues` when `!inThisRepository()` (or when `laneBriefs` is empty for non-MachineRoom projects), and change `FREE-HIERARCHY.md` to say the `X / Y` label is yellow at full opacity.

8. **R66-8 (Low): Weakened chunk test and untested client `overRing` branch (`tests/build-chunks.test.js:81-83`, `tests/control-contract.test.js:1070-1096`).**
   - P671 removed `expect(threeChunk.imports).toEqual([])` and `expect(reactChunk.imports).toEqual([])` when rewriting `tests/build-chunks.test.js` for `codeSplitting`. Both vendor chunks still have empty imports in the build, so removing those assertions left vendor-chunk isolation unpinned.
   - P639d tested `createClient.createLane` with `overRing` in `tests/control-contract.test.js`, but not `createClient.setActiveLanes({ lanes, overRing, confirmed: true })`. Deleting `src/control/client.js:695-697` leaves all tests in `tests/control-contract.test.js` and `tests/family-tree-ui.test.js` (which mocks `setActiveLanes`) passing.
   - Fix: Restore `expect(threeChunk.imports).toEqual([])` and `expect(reactChunk.imports).toEqual([])` in `tests/build-chunks.test.js`, and add a `setActiveLanes` `overRing` case to `tests/control-contract.test.js`.

## Checked and found sound

- **Orbiting top agents (`P667`, `src/engine/agents.js:1220-1264`)**: `placeViews()` computes `orbitAngles = readerAngles(mainAngles, seats.order.length)` and places every agent in `seats.order` at `READER_RADIUS` (`420`) in the gaps between `HUB_RADIUS` (`300`) parked lanes, with `y = HUB_Y + PARK_LIFT` (`290`). No coordinate collisions remain for 3+ top-level agents.
- **Status line while queued or thinking (`P667`, `src/engine/agents.js:48-58`)**: `doingText` returns `'queued'` when `status === 'queued'`, `'thinking'` when `status === 'working'` and `entry.calls.size === 0`, and keeps the label when `entry.calls` is absent.
- **Quiet seat notices and Revoke confirm (`P666`, `server/orchestrator.js:1210,1585,1599,1753-1780,2709-2785`, `src/ui/OrchestratorChat.jsx:1649-1689`, `server/seats.js:304`)**: `passive: true` is persisted across `restore()`, ignored by `newSession`/`openSession`/`branchSession` and `maybeStartTurn`, and still included in the next owner turn; `Cancel` precedes `Revoke` on the Revoke confirm card; `formatGrantNotice` drops the unreachable delete claim.
- **Linger expiry notice and merged brief ids (`P669`, `server/lanes-source.js:779-789,970-971`, `server/index.js:735-742`, `server/lane-tasks.js:202-212`)**: `finish` schedules an unref'd `lingerMs + 1000` timer emitting `{ topic: 'agents' }` and `stop()` clears all kept timers; `mergedBriefIds` parses every `[A-Z]\d+[a-z]?` token after `Merge ` before the first comma.
- **P670 and P672 regression tests**: All seven new test groups (`tests/active-lanes.test.js:790-804`, `tests/bridge.test.js:324-341`, `tests/lanes-source.test.js:296-312`, `tests/terminals.test.js:184-209`, `tests/e2e-room.test.js:548-595`, `tests/room.test.js:320-332`, `tests/slash-commands.test.js:673-755`) fail when their guarded source lines are reverted.
- **Owner-only access on `POST /api/family/seats` (`P639c`, `server/family.js:521-560`)**: Requires `page` (`req.headers.origin`), so neither an orchestrator token nor a lane ticket without an Origin can call it (returns 403). `ringSummary` in `server/seats.js:169-183` and `familySeatsFor` in `server/family.js:52-62` (with `node.manual !== true` filtered out) agree on ring counts.
- **Engine chunk isolation (`P671`, `vite.config.js`, `src/engine/board.js`, `src/model/format.js`)**: Verified `npm run build` emits `engine-iMUya9fe.js` (239.27 kB) importing only `three-DRo8l8HD.js`, with `index-hc36EKJO.js` at 647.83 kB, `react` at 218.78 kB, `three` at 586.48 kB, `mock` at 106.88 kB, and no chunk-size warning under the 970 kB limit.
- **Orchestrator hand commits (`15d68576`, `72edd85c`)**: `tests/machine-up.test.js:121-135` properly checks drained streams and waits for `close` so the final stdout line is read; `server/quiet-agy.js` is imported first by `server/index.js` (covering `bin/machine-room.mjs` and `harness-probe.js`) and `scripts/run-lane.mjs`, setting `AGY_CLI_DISABLE_AUTO_UPDATE=1` only when undefined.

## Grades

### Merges

| Merge | Commit | Grade | Reason |
| --- | --- | --- | --- |
| P667 | `e4c5200c` | A | Moves orbiting top agents to `READER_RADIUS` in lane gaps, fixes `doingText` for `queued` and `thinking`, and adds solid tests. |
| P665 | `6ad0cc94` | B+ | Fixes `lanePills` linger, `queued` count, working `main` row, idle sub filtering, and sessions-only button, with clear tests; leaves `!wide` `<Transport>` in `Hud.jsx` without `orchestrator` (R66-5). |
| P670 | `5314682e` | A | All five regression tests directly prove their guarded paths (`hideOrchestrator`, `/api/agents`, `recentLanes` expiry, `terminals.isOpen`, `soundAtAgent`) and fail if undone. |
| P666 | `16368a82` | A | Clean `passive: true` notice lifecycle across persist/restore and session actions, `Cancel`-first Revoke card, accurate grant notice, and thorough tests. |
| P668 | `9aec3f5d` | C | Fixes `ringLevels` cap in `hub.js` and owner `turnOn` check in `seats.js`, but `server/orchestrators.js:1441-1445` never checks `!seat.ok`, leaving the owner ladder depth bypass open (R66-1). |
| P669 | `4ba2be0d` | A- | Adds linger-expiry `agents` notice with cleanup, full multi-brief ID parsing, and 30s `readMainSubjects` cache; minor gap that non-MachineRoom projects still trigger `readMainSubjects` every 30s (R66-7). |
| P639b | `8179b85c` | A | Clean `setSeatCounts` in `hub.js` and `room.js` with colour/opacity caching, rebuild sync, disposal and complete `hub.test.js` coverage. |
| P639a-1 | `57f547b9` | A | Clean, tested `ringSummary` and atomic `setRings` in `server/seats.js`. |
| P671 | `ecdbf864` | A- | Splits `engine` and `model` into a clean chunk importing only `three`, brings main chunk well below 970 kB and restores the 970 guard; dropped `three`/`react` empty-imports assertions in `build-chunks.test.js` (R66-8). |
| P639c | `aaa0ed62` | B- | Solid `POST /api/family/seats` route, `Seats` group UI and `toggleLane` `overRing`; `mockRingRows` miscounts subs on ring 0 (R66-2), plus minor `made by`, `runOrOverRing` refresh, duplicate error note and copy issues (R66-6). |
| P672 | `e35b9935` | A | Proves both `room.js` `state.depthLimit` frame polling and `chatOnly` exclusion on `codex` `prior` history and `claude` `branchSession`. |
| P639d | `d54b8dde` | B- | Fixes `runConfirm` closing over `overRing` confirms and wires `createUnder` for top-level new lanes, but new lanes under a sub/lane check ring 0 and miss `setLadder` `overRing` (R66-4), and `setActiveLanes` `overRing` lacks a `createClient` test (R66-8). |
| P640 | `caaa15ff` | A- | Accurate docs sync of built seats and differences from `AGENT-SEATS.md`; one misstated detail in `FREE-HIERARCHY.md` about ring opacity when full (R66-7). |

### Hand commits

| Commit | Grade | Reason |
| --- | --- | --- |
| `22242ee8` | B+ | Clean `latestSeatsRef` wiring and remount replay in `src/Stage.jsx`, but `updateLabels` still subscribes only to `['family']`, missing `agents`-only seat-count changes (R66-3). |
| `15d68576` | A | Sound fix waiting on `close` and drained stdio streams in `tests/machine-up.test.js`. |
| `72edd85c` | A | Clean `server/quiet-agy.js` module imported first by bridge and `run-lane`, with direct subprocess import tests. |
| Briefs | A | `6f100cdc`, `0f446626`, `1321c509`, `6d715841`, `3b5185d8`, `453fd4ac`, `75c681d6`, `e677378c`, `644201cd`, `d25915d2`, and `85f766f5` (before `caaa15ff`) accurately track the work. |

## Verification

- `npx vitest run tests/build-chunks.test.js`: 1 file, 2 tests passed.
- `npm run build`: passed (202 modules; `engine` 239.27 kB importing only `three`, `index` 647.83 kB, `three` 586.48 kB, `react` 218.78 kB, `mock` 106.88 kB, no warnings).
- Direct Node checks proved R66-1 (`orchs.ladderChange` returned `200` saving a ring-2 sub at `depth: 2`) and R66-2 (`createMockClient().family().seats` returned `taken: 4` on ring 0 and `taken: 2` on ring 1 instead of `3` and `3`), and confirmed `dist/assets/engine-iMUya9fe.js` imports only `./three-DRo8l8HD.js`.
- Visual checks by eye (3D ring seat labels, `Seats` rows and `made by` layout, narrow `< 900px` transport layout) are left to the orchestrator.
