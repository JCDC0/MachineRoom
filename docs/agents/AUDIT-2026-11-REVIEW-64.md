# Review 64: the family tree, seats, rings and the owner's menu

P659 reviewed `git log 9a3039b6..c6513481` and its diffs. The range holds 16 merges (P632, P633, P634, P635, P636, P637, P641, P642, P644, P645, P646, P647, P648, P649, P650 and P651) and three hand commits by the orchestrator (`136cc7a5`, `056f3f58` and `d92c6d30`). Note: P631 (`6c472242`) merged before `9a3039b6` (at `9a3039b6^1`), outside `9a3039b6..c6513481`; it was still checked and graded below. Where later commits in `c6513481..HEAD` changed a file, both states are noted.

## Findings

| ID | Severity | Brief / Commit | Location | Summary |
| --- | --- | --- | --- | --- |
| R64-1 | High | P636, P637 | `server/seats.js:327`, `server/active-lanes.js:408-416` | An orchestrator with no grant (or after `/revoke`) can turn off every lane in its branch via `POST /api/lanes/active`. |
| R64-2 | High | P635, P644 | `src/engine/hub.js:186-215`, `src/engine/agents.js:1214-1260` | Orbiting top-level agents land on the exact same `(x, y, z)` coordinates as level 0 parked lanes. |
| R64-3 | High | P650 | `src/ui/panels/DispatchPanel.jsx:258-276`, `src/ui/panels/runs.js:438-460`, `server/runs.js:955-967` | Start offers every lane (including retired, hidden, manual AGY and inactive lanes) when `chosen` is false, and never refreshes after Agents toggles a lane off. |
| R64-4 | High | P645 | `src/engine/agents.js:201-211`, `src/model/state.js:224-299` | The status line under an agent shows `"done"` or a previous run's command while queued, starting or thinking. |
| R64-5 | Medium | P635, P637, P644 | `src/engine/hub.js:162-179`, `src/engine/room.js:1059-1065`, `server/seats.js:305,365-366`, `server/orchestrators.js:1441` | The engine and seat server disagree by 1 on `depth`, `state.depthLimit` is never populated, and the owner ladder route skips the depth cap. |
| R64-6 | Medium | `056f3f58` | `src/Stage.jsx:858-860,935-968` | `Stage.jsx` drops `setChosenTop` if `client.family()` resolves before the room mounts or the room remounts, and never resets it on failure or replay. |
| R64-7 | Medium | P635 | `src/engine/hub.js:12-16,224-235,559,606`, `src/engine/agents.js:816-824,859` | Park rings ignore the dynamic lattice floor, and a sub orchestrator overlaps its own middle lane at the same `(x, z)`. |
| R64-8 | Medium | P648 | `src/ui/panels/TasksPanel.jsx:21-36,207-213` | `taskCountSummary` ignores `todo`, `backlog` and `in_review`, so the toolbar count can read `No tasks` while open rows render below. |
| R64-9 | Medium | P646, P648 | `src/ui/Waiting.jsx:91-92`, `src/ui/guide.js:23,27,68,70`, `src/ui/emptyRoom.js:2`, `src/ui/panels/MetersPanel.jsx:10`, `src/ui/panels/reviews.js:77` | Owner-facing copy still uses old menu and tab names (`ORCHESTRATOR`, `Control`, `Dispatch`, `Meters`, `Reviews`). |
| R64-10 | Medium | P649 | `server/runs.js:145-147,2284`, `server/lane-tasks.js:202-209` | `GET /api/control/issues` runs an uncached `git log` on every poll against `REPO_ROOT`, and `mergedBriefIds` misses multi-brief merges and non-`P` brief IDs. |
| R64-11 | Low | P647 | `src/ui/sound.js:389`, `src/Stage.jsx:608` | An `agent.message` with an empty or missing `to` falls back to `soundAt(undefined)` and plays a beep from the root card. |
| R64-12 | Low | P642, P644, P645, P647, P649 | `tests/family-tree.test.js`, `tests/room.test.js`, `tests/terminals.test.js`, `tests/sound.test.js`, `tests/lane-tasks.test.js` | Five merges include untested paths or tests that pass with their source change undone. |

### Details

1. **R64-1 (High). An orchestrator with no grant can turn off every lane in its branch (P636, P637).** `server/seats.js:327` (`server/seats.js:174` at `c6513481`) and `server/active-lanes.js:408-416`.
   - `seatCheck` returns `{ ok: true }` on `turnOff` whenever `isUnder(nodes, node, me.id)` is true, without checking whether the actor holds a grant (`grantFor(seats, me.id).lanes > 0`). `AGENT-SEATS.md` specifies that without a grant an orchestrator may only propose a lane, and turning lanes on or off requires a grant.
   - Failing case: With `{ rings: [4, 4], grants: {} }` (default or after `/revoke`), `orchestrator` sends `POST /api/lanes/active` with its `X-MachineRoom-Orchestrator` token and `{ confirmed: true, lanes: [] }`. Because every lane in the project (including lanes under subs) is under `orchestrator`, `seatCheck(..., action: 'turnOff')` returns `{ ok: true }` for all of them and `writeActiveLanes` turns off every lane in the room. A sub with `{ lanes: 0, subs: 0 }` can likewise turn off all lanes under itself. Proved directly against `seatCheck` in Node.
   - Fix: In `server/seats.js:327`, require `grantFor(seats, me.id).lanes > 0` before allowing `turnOff`, returning `{ ok: false, status: 403, reason: 'You have no grant to change lanes.' }` when zero. In `POST /api/lanes/active`, scope an orchestrator's omitted-lane turn-off check so listing only its own lanes does not silently turn off lanes under child subs.

2. **R64-2 (High). Orbiting top-level agents collide onto level 0 parked lanes (P635, P644).** `src/engine/hub.js:186-215` and `src/engine/agents.js:1214-1260`.
   - When `topKey` is a session and three or more top-level agents are on the top ring (`claude-session`, `orchestrator` and `opencode-session`), `topRingSeats` switches to `mode: 'orbit'` and `topRingPoint(slotAngle(i, order.length))` places them on `HUB_RADIUS` (300) at `HUB_Y + PARK_LIFT` (290). Level 0 parked lanes use `laneHome` at the exact same `HUB_RADIUS` (300), `HUB_Y + PARK_LIFT` (290) and `slotAngle(i, parkedKeys.length)` (both starting at `Math.PI / 2`).
   - Failing case: With roster `['orchestrator', 'opencode', 'claude', 'hermes', 'claude-session', 'opencode-session']`, chosen top `claude-session` and `opencode-session` active (or immediately at `c6513481` before `c2b04557` added `ranReaders`), `claude-session` and `opencode` both land at `(0, 290, 300)`, `orchestrator` and `claude` both land at `(-259.81, 290, -150)`, and `opencode-session` and `hermes` both land at `(259.81, 290, -150)`. Even with a single parked lane, index 0 always lands on `(0, 290, 300)`. Also at `c6513481`, `topRingSeats` always included `'orchestrator'` in `order` even in sessions-only rooms without an orchestrator (later fixed in `c2b04557` via `withOrchestrator`). Proved in Node against `createAgents`.
   - Fix: Place orbiting top-level agents on `READER_RADIUS` using `readerAngles(mainAngles, order.length)`, or allocate their angles jointly with level 0 parked lanes so no two agents share a coordinate.

3. **R64-3 (High). The Start lane picker offers lanes the bridge refuses (P650).** `src/ui/panels/DispatchPanel.jsx:258-276`, `src/ui/panels/runs.js:438-460` and `server/runs.js:955-967`.
   - `DispatchPanel` sets `activeKeys` to `null` whenever `GET /api/lanes` answers `chosen: false`. `projectRunLanes(agents, running, null)` then returns every non-orchestrator lane in `client.agents()`, including retired lanes, hidden lanes, built-in AGY lanes and inactive lanes. `server/runs.js:960` refuses all of them with `400 Pick the lanes for this project first.`.
   - Second, `DispatchPanel` reads `client.lanes()` only once per `[client]` mount and does not subscribe to `agents` or `family` notices. At wide layout (`>= 900px`), turning a lane off or hiding it in the Agents sidebar while Start is open leaves it selectable in `#project-run-lane` until `server/runs.js:966` refuses Start with `400 The lane KEY is not active. Add it in Agents first.`.
   - Third, the filter checks `lane?.active === true` without `lane?.hidden !== true`, and never clears a previously selected `projectLane` that disappears from `projectLanes`.
   - Fix: When `answer?.chosen === false`, set `activeKeys` to `new Set()` (empty) instead of `null`; filter on `lane?.active === true && lane?.hidden !== true`; reload `client.lanes()` on `agents` and `family` notices; and reset `projectLane` when it is no longer in `projectLanes`.

4. **R64-4 (High). The status line under each agent lies while queued, starting or thinking (P645).** `src/engine/agents.js:201-211` and `src/model/state.js:224-299`.
   - `doingText(entry)` returns `entry.label.toLowerCase()` whenever `entry.status` is `working` or `queued` and `entry.label` is non-empty. `state.js` writes `agent.label = 'done'` when a run succeeds (line 284), never clears `agent.label` on `run.queued` (line 224) or `run.start` (line 229), and never clears `agent.label` on `tool.end` (line 255).
   - Failing case: (a) Agent `claude` finishes run 1 with `ok: true` (`agent.label = 'done'`). Run 2 emits `run.queued` and then `run.start`. Before its first tool call, `doingText` returns `"done"` while `status` is `'queued'` and `'working'`. (b) If run 1 ended in error after `Edit src/a.js`, run 2 shows `"edit src/a.js"` while queued or starting. (c) After `tool.end` completes `Edit src/a.js` and the agent is thinking (`calls.size === 0`), `doingText` still shows `"edit src/a.js"`. Proved in Node against `createState`, `apply` and `doingText`.
   - Fix: Clear `agent.label = ''` on `run.queued` and `run.start`, delete the completed call from `agent.calls` on `tool.end` (or check `agentThinking(entry)` in `doingText`), and in `doingText` always return `'queued'` when `status === 'queued'` and `'thinking'` (or `'working'`) when `status === 'working'` with no open tool call.

5. **R64-5 (Medium). Engine and seat server disagree by 1 on `depth`, and `state.depthLimit` is never wired (P635, P637, P644).** `src/engine/hub.js:162-179`, `src/engine/room.js:1059-1065`, `server/seats.js:305,365-366` and `server/orchestrators.js:1441`.
   - `server/seats.js:305` computes `lastRing = Math.max(0, depth - 1)`. At `depth = 2`, ring 0 and ring 1 exist, and adding a sub on ring 2 is refused (`Ring 2 is past the subagent depth of 2.`). In `src/engine/hub.js:162-179`, `ringLevels(ladder, max)` caps sub levels at `max` itself: at `depth = 2`, `ringLayout` draws rings `0, 1, 2` (three rings), and at `depth = 1` it still draws ring 1. Proved in Node.
   - In `src/engine/room.js:1059-1065`, `frame()` watches `state.depthLimit`, but nothing in `Stage.jsx` or `state.js` loads `/api/agent-depth` into `state.depthLimit` or calls `room.setDepth`, so the room stays fixed at 4 rings regardless of the owner's setting.
   - In `server/orchestrators.js:1441`, the owner ladder save path checks moved/new subs with `seatCheck(..., action: 'turnOn')` instead of `addSub`, bypassing `server/seats.js:366`'s `level > lastRing` check that `seatCheck` enforces even for the owner.
   - Fix: Pick one depth convention across `hub.js` and `seats.js` (e.g. `depth` 1..4 = max ring index `depth - 1` or max sub ring `depth`), wire `/api/agent-depth` and its SSE notice to `room.setDepth` in `Stage.jsx`, and apply the same depth rule in `server/orchestrators.js:1441`.

6. **R64-6 (Medium). `Stage.jsx` drops `setChosenTop` on early fetch or room remount, and never resets it (hand commit `056f3f58`).** `src/Stage.jsx:858-860` and `src/Stage.jsx:935-968`.
   - `latestLabelsRef` is stored on fetch, re-applied when the room mounts (line 859), and cleared to `null` when `!live` (line 944) or `client.family()` throws (line 966). `056f3f58` added `roomRef.current?.setChosenTop?.(...)` only at line 960 with no ref, no mount replay and no reset.
   - Failing case: If `client.family()` resolves before `roomRef.current` is created, or if `data` changes and recreates the room while `[client, live]` stays the same, `setChosenTop` is never called on the new room and the chosen session falls off the top. Switching from live to replay or hitting a failed family read leaves the previous `chosenTop` active.
   - Fix: Keep `latestChosenTopRef = useRef('orchestrator')`, call `room.setChosenTop?.(latestChosenTopRef.current)` next to `room.setLabels` at line 859, and reset it to `'orchestrator'` in the `!live` and `catch` paths of `updateLabels`.

7. **R64-7 (Medium). Park rings ignore the dynamic lattice floor, and a sub overlaps its own middle lane (P635).** `src/engine/hub.js:12-16,224-235,559,606` and `src/engine/agents.js:816-824,859`.
   - `createHub` and `createAgents` call `ringLayout(ladder, parkedKeys, depth)` without passing the 4th `floor` argument, so rings always use static `RING_FLOOR_Y = -120` instead of `latticeLevels`. With `RING_FLOOR_GAP = 60`, a bottom ring at `y = -60` places a lane's `doing` sprite at `home.y - 190 = -160`, 40 units below `-120`.
   - `subHome` puts each sub at `mid = (arc.start + arc.end) / 2` and `y = ring.y + SUB_STAND_LIFT` (`ring.y + 150`). `sectorLaneAngles` puts an odd-count sector's middle lane (such as a 1-lane sub) at the exact same `mid` angle and `y = ring.y + PARK_LIFT` (`ring.y + 90`). The two agents share `(x, z)` and sit only 60 units apart vertically while their wireframes have ~120 unit radius and their click-picker spheres have 170 unit radius. Proved in Node: `sub-frontend` at `[-300, 90, 0]`, `opencode` at `[-300, 30, 0]`.
   - Fix: Pass the current lattice floor into `hub` and `agents` (and account for the sprite drop below `home.y`), and give the sub its own slot angle on the ring or lift it above the combined shape diameter so it does not intersect its middle lane.

8. **R64-8 (Medium). `taskCountSummary` disagrees with the Tasks list for non-running/non-failed open statuses (P648).** `src/ui/panels/TasksPanel.jsx:21-36,207-213`.
   - `openIssues` renders every issue whose status is not `done` or `cancelled`, including `todo`, `backlog` and `in_review` (all ranked in `OPEN_ORDER` at lines 7-13). `taskCountSummary` counts only `in_progress`, `blocked`, `done` and `cancelled`.
   - Failing case: Pass `[{ status: 'todo' }, { status: 'in_review' }]` to `TasksPanel`. The toolbar prints `No tasks` while the list renders two open task rows below. With one `in_progress` and two `todo` tasks, the toolbar prints `1 running` while three open rows render.
   - Fix: Count remaining open statuses (`todo`, `backlog`, `in_review`, or any other non-done/non-cancelled status) into an `open` bucket (`N open`) so the toolbar counts always sum to `issues.length`.

9. **R64-9 (Medium). Owner-facing UI copy still uses old menu and tab names (P646, P648).**
   - Still live on `HEAD`:
     - `src/ui/Waiting.jsx:91-92`: `"Press / or click ORCHESTRATOR at the top..."` (menu button is now `Chat`).
     - `src/ui/guide.js:23,27,68,70`: `"click ORCHESTRATOR"`, `"C opens the control drawer"`, `"Control and orchestrator"`, `"opens Control for tasks, runs and reviews"`.
     - `src/ui/emptyRoom.js:2`: `"start a lane in Dispatch with C."`.
     - `src/ui/panels/MetersPanel.jsx:10`: `"Meters need a newer bridge."` (tab is now `Cost`).
     - `src/ui/panels/reviews.js:77`: `"The owner confirmed this in Reviews."` (tab is now `Merge`).
     - `docs/agents/architecture/ROOM.md:285`: still describes the waiting card as telling a beginner to click `ORCHESTRATOR`.
   - Present at `c6513481` and fixed later in `dcfa4d79`: `src/ui/Waiting.jsx:49` (`Start one from Dispatch (C)`) and `server/lane-tasks.js:8` (`Lane runs start from Dispatch, not from a task.`).
   - Fix: Replace each stale menu or tab name above with `Chat`, `Work`, `Start`, `Cost` or `Merge` and update the matching tests.

10. **R64-10 (Medium). `GET /api/control/issues` spawns an uncached `git log` per poll, and `mergedBriefIds` misses combined merges and non-`P` briefs (P649).** `server/runs.js:145-147,2284` and `server/lane-tasks.js:202-209`.
    - `GET /api/control/issues` awaits `readMainSubjects()` on every request, spawning `git log --format=%H %cI %s refs/heads/main` against `REPO_ROOT` with no caching. That runs on every poll and reads MachineRoom's own git log even when the bridge serves another project.
    - `mergedBriefIds` matches `/^\d+\.\d+\.\d+: Merge (P\d+[a-z]?)\b/i`. On a combined merge subject like `0.1.402: Merge P648 and P649, plain names`, only `p648` is extracted and `p649` remains `blocked`. Non-`P` brief IDs (`S47`, `U167`, `Q44`), which `BRIEF_ID` in `lane-tasks.js:11` accepts, also never match. Proved in Node.
    - Fix: Cache `readMainSubjects()` on `refs/heads/main` changes (or a short TTL) and skip it for non-MachineRoom project roots; extract every brief ID token after `Merge` (matching `outcomeTable`).

11. **R64-11 (Low). An `agent.message` with an empty or missing `to` plays a beep from the root card (P647).** `src/ui/sound.js:389` and `src/Stage.jsx:608`.
    - `activitySounds` returns `[{ agent: activity.to, kind: 'message' }]` without checking `activity.to`. When `activity.to` is `''` or `undefined`, `Stage.jsx:608` evaluates `item.agent ? ... : roomRef.current?.soundAt(item.path)`, calling `soundAt(undefined)`. `nearestDrawnPath(undefined, ...)` falls back to `''` and plays a `message` beep from the root folder card. Proved in Node (`activitySounds` returns `[{ agent: '', kind: 'message' }]`).
    - Fix: Return `[]` in `activitySounds` when `typeof activity.to !== 'string' || activity.to.trim() === ''`, and branch on `Object.hasOwn(item, 'agent')` in `Stage.jsx:608`.

12. **R64-12 (Low). Tests that pass with their source change undone (P642, P644, P645, P647, P649).**
    - **P642** (`tests/family-tree.test.js:578-588`): The sibling-subs test exercises only P634's `familyBoxes`; reverting all of P642's CSS and `FamilyTree.jsx` changes leaves every test green.
    - **P644** (`src/engine/room.js:1059-1065`, `tests/room.test.js:220-251`): Commit `d55e50b6` added `state.depthLimit` polling in `room.js`, but `tests/room.test.js` only calls `room.setDepth(...)` directly; reverting the `room.js` hunk passes all tests.
    - **P645** (`src/engine/agents.js:1708`): No test checks `view.link.visible` when a terminal chip is closed vs open; reverting step 2 (`&& Boolean(terminals.isOpen?.(view.key))`) passes `tests/terminals.test.js`, `tests/agent-label.test.js` and `tests/roster-update.test.js`.
    - **P647** (`src/engine/room.js:753-755`, `src/ui/sound.js:572`): No test exercises `soundAtAgent` or the `0.3` peak gain in `sound.beep`; reverting both passes all tests in `tests/sound.test.js` and `tests/e2e-room.test.js`.
    - **P649** (`server/runs.js:2284,2291`): No bridge test hits `GET /api/control/issues` with a merged-on-main failed brief; reverting the `server/runs.js` wiring passes all tests in `tests/lane-tasks.test.js`.
    - Fix: Add one targeted test per gap and confirm each fails with its source hunk reversed.

## Merge and hand-commit grades

| Item | Commit | Grade | Reason |
| --- | --- | --- | --- |
| P631 | `6c472242` | A | Pre-range (`9a3039b6^1`). Clean doc sync for Docs audit 6 across README, PLAN, DESIGN-PANELS and architecture files. |
| P632 | `9a70e890` | A | Clean `portCheck` injection removes free-port races; real taken-port and post-build loss tests stay real and fail if undone. |
| P633 | `0de96c2c` | A | Exact two-block `LATTICE_CELLS = 2` change with matching `tests/void.test.js` and `ROOM.md` updates. |
| Hand | `136cc7a5` | A | Clean removal of the lens Height rail and `--lens-h-user` from `Stage.jsx` with direct assertion in `tests/stage-lens.test.js`. |
| P636 | `45f5ad59` | B- | Solid atomic seats file and pure `seatCheck`, but `turnOff` skips grant checks (R64-1), and initial scope/session gaps needed P637 fixes. |
| Hand | `d92c6d30` | A | One-line brief update in `TASKS.md` adding the two P636 review fixes into P637's brief. |
| P634 | `c26dae7e` | A- | Sound `POST /api/family/top` Origin/confirm/key checks, nested sub cycle breaking and `familyBoxes` data model. Top session `working` was initially hardcoded false (fixed later by P642/P643b). |
| P641 | `211c9e9e` | A | Clean removal of `lensSplit`, height helpers, `.is-inner` variant and `--lens-h-user` fallback, with tests confirming saved `lensSplit` is dropped. |
| P642 | `a0f5baf9` | B- | Tree box, indent and scroll CSS match the brief, and `familyBoxes` propagates session `working`, but its sibling-subs test passes with all P642 CSS/JSX undone (R64-12). Visual layout left to the orchestrator. |
| P635 | `2ba936d2` | C+ | Pure ring math and stacked level rings work, but never wire dynamic lattice floor, overlap a sub over its own middle lane (R64-7), and disagree by 1 on `depth` with `seats.js` (R64-5). |
| Hand | `056f3f58` | C+ | Wires `setChosenTop` in `Stage.jsx`, but omits a ref for early-fetch/remount replay and never resets on failure or replay (R64-6). |
| P637 | `9e953aa5` | B- | Good atomic check+write concurrency, glob containment (`containsGlob`), `createdBy`, and fresh seat lines on every turn. Leaves no-grant `turnOff` open in `POST /api/lanes/active` (R64-1) and skips depth cap on owner ladder writes (R64-5). |
| P644 | `2bb7b21d` | C+ | `topKeyFor` and `setChosenTop` work cleanly for 1-2 top agents, but 3+ top agents in `orbit` collide onto level 0 parked lanes (R64-2), `state.depthLimit` is unwired and untested (R64-5, R64-12), and `depth` disagrees with `seats.js`. |
| P645 | `7d1d5edb` | C | Hiding closed chips and adding `doing` sprite match the brief, but `doingText` shows `"done"` or prior commands while queued, starting or thinking (R64-4), and `view.link.visible` has no test (R64-12). |
| P646 | `850e429f` | B | Clean Chat rename, Settings dropdown and Control hint, with solid tests, but leaves `ORCHESTRATOR` and `Control` in `Waiting.jsx`, `guide.js` and `ROOM.md` (R64-9). |
| P647 | `588adfae` | B- | Fixes off-screen panning, gain floor, folder `list` sounds and nearest-card fallback. Leaves empty `agent.message.to` falling back to root card (R64-11), with no tests for `soundAtAgent` or peak `0.3` (R64-12). |
| P649 | `c34cd350` | B- | Fixes hand-merged `Merge PNNN` tasks in `lane-tasks.js`, but adds an uncached `git log` to every `/api/control/issues` poll, misses combined merges and non-`P` briefs (R64-10), and lacks a route test (R64-12). |
| P648 | `7d8821ee` | B- | Clean rename to Work/Start/Cost/Merge and folded done list, with `server/doctor.js` updated. `taskCountSummary` drops `todo`/`backlog`/`in_review` (R64-8), and old names remain in `Waiting.jsx` (fixed later in `dcfa4d79`), `guide.js`, `emptyRoom.js`, `MetersPanel.jsx` and `reviews.js` (R64-9). |
| P650 | `66d29dca` | C | Filters `projectRunLanes` when `chosen: true`, but leaves `activeKeys` null on `chosen: false` (offering lanes the bridge refuses), never refreshes on `agents`/`family` notices, and does not exclude `hidden` or clear stale selections (R64-3). |
| P651 | `c6513481` | A | Clean `runningBriefs` suppression for blocked records whose briefs are all open, with tests for running, alone and partial pairs. |

## Checked and found sound

- **Origin enforcement at bridge entry (`server/index.js:1763`)**: Disallowed `Origin` headers are rejected with 403 before any route runs; `POST /api/family/top` requires a page `Origin`, `confirmed: true` and an allowlisted `top` key.
- **Seat concurrency (`server/agents-config.js:676-690`, `server/active-lanes.js:395-435`, `server/orchestrators.js:1240-1452`)**: `readJsonBody` completes before the synchronous seat check and write, so concurrent requests serialize atomically in Node.
- **Glob containment (`server/seats.js:86-115`)**: `containsGlob` matches `src/model/hierarchy.js` prefix and `*`/`**` semantics, including rejecting literal file paths against single-segment wildcard patterns when `hierarchy.js` would treat the bare path as a directory prefix.
- **Seat line per turn (`server/orchestrator.js:2060-2075`)**: Both Claude (`--append-system-prompt` on every turn, including `--resume`) and OpenCode (appended on resumed turns) receive fresh seat counts.
- **P651 retry naming (`server/lane-tasks.js:58-68`)**: `runIdentity` extracts brief IDs cleanly across hyphenated lane keys (`claude-2-P650-...`) and `-retry` suffixes.

## Verification

- Focused single-file test runs (foreground): `npx vitest run tests/seats.test.js tests/agents-lines.test.js tests/sound.test.js tests/panels-format.test.js tests/panels-runs.test.js tests/lane-tasks.test.js` (6 files, 175 tests passed).
- Direct Node reproductions confirmed R64-1 (`seatCheck` `turnOff` with empty grants), R64-2 (exact coordinate collision in `createAgents`), R64-4 (`doingText` returning `"done"` and `"edit src/a.js"` on queued/starting/thinking states), R64-5 (`ringLayout` vs `seatCheck` depth mismatch), R64-7 (sub/lane overlap), R64-10 (`mergedBriefIds` on multi-brief and non-`P` subjects) and R64-11 (`activitySounds` on empty `to`).
- Visual layout checks by eye (P642 family tree rendering, P635/P644 3D ring appearance, P645 sprite spacing, P646/P648 menu/drawer look) are left to the orchestrator.
