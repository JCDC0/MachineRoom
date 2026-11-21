# Review 68: the review 67 fixes and the ring seat labels

Scope: `6f15782c..HEAD` on `main` (4 merges: `P678`, `P682`, `P683`, `P684`; 2 test timing commits: `4586c8bf`, `8a0cac80`; 3 brief/plan commits: `b40850b4`, `14a94794`, `b8f387ca`, `b8b3e432` excluded as own brief).

## Findings

| ID | Severity | Commit | Location | Summary |
| --- | --- | --- | --- | --- |
| R68-1 | Medium | P684 | `src/engine/hub.js:181-195` | `seatRingPoint` avoids only `sectorLabelAngle`, so seat labels can still align with agent positions and names. |
| R68-2 | Low | P683 | `server/processTree.js:254`, `scripts/run-lane.mjs:361` | `refuseRunningLane` spares a live lane child under `MACHINEROOM_BRIDGE_PID` if its lock is missing or stale. |
| R68-3 | Low | P683 | `server/runs.js:1645`, `tests/stop-tree-unverified.test.js:25-38` | `runStopCommand` passing `MACHINEROOM_BRIDGE_PID` is untested; the test passes with line 1645 undone. |

### Details

1. **R68-1 (Medium): Ring seat labels ignore agent positions (`src/engine/hub.js:181-195`, P684).**
   - `seatRingPoint` passes only `sectorLabelAngle(arc)` values for that ring into `seatLabelAngle(angles)` and returns angle `0` when `layout` has no arcs on that ring. It follows P684's literal wording, so sector names stay clear (radius `ring.radius + 300` vs `ring.radius + 40` and opposite/widest-gap angle), and `rebuild()` keeps labels on their ring when the ladder or depth changes. However, it does not avoid `slotAngle`, `sectorSubAngle`, or `sectorLaneAngles`.
   - Failing cases:
     - With no subs (`layout === null`) and 4 or 8 lanes, `slotAngle(3, 4)` puts lane 3 at `2 * Math.PI` (`0` rad, name label at `(HUB_RADIUS, HUB_Y - 60, 0)`), while `seatRingPoint(0, null)` puts ring 0's seat label at angle `0` (`(HUB_RADIUS + 40, HUB_Y, 0)`).
     - With 1 sub and 3 lanes on ring 1 (`arc` from `0.055` to `2 * Math.PI - 0.055`), `sectorLabelAngle` is `0.672` rad and `seatLabelAngle` picks `3.814` rad, `0.099` rad (`5.7` degrees) from lane 1 at `3.913` rad.
   - Fix: Include the ring's agent angles (`slotAngle` when `layout` is null, or `sectorSubAngle` and `sectorLaneAngles` for that ring's arcs when `layout` is set) alongside `sectorLabelAngle` in `seatRingPoint` or `createHub`.

2. **R68-2 (Low): Live lane child under the bridge is spared if its lock is missing (`server/processTree.js:254`, `scripts/run-lane.mjs:361`, P683).**
   - `server/runs.js:1546` passes `MACHINEROOM_BRIDGE_PID` to `run-lane`, and `spareAncestorPid()` uses it in `stopLeftovers` and `refuseRunningLane`. `MACHINEROOM_BRIDGE_PID` is not in `LANE_ENV_NAMES` (`src/briefs/run.js:740`) or `runnerNames` (`scripts/run-lane.mjs:2350`), so it does not leak to lane harness children or test commands. Both `startRun` (`server/runs.js:1546`) and `runStopCommand` (`server/runs.js:1645`) pass it (covering `POST /api/control/runs`, `startProjectTask`, and `interruptLane`), and `processTree.js:233` ignores `spareAncestor <= 1`, catching POSIX orphans under PID 1 and Windows orphans whose parent `run-lane` exited.
   - Failing case: If bridge `pid 100` has a live `run-lane` `pid 200` (`ppid 100`) and live child `agy` `pid 201` (`ppid 200`, command naming `worktree`), and the `.lock` file was removed or no longer lists `201`, a second `run-lane` (`MACHINEROOM_BRIDGE_PID=100`) calling `refuseRunningLane` sees `parentChain(byPid, 201)` contains `100`, marks `201` as a sibling, and resolves.
   - Fix: In `leftoverProcesses` (`server/processTree.js:254`), do not treat a process as a `sibling` when its ancestor chain between `item.pid` and `spare` passes through a `run-lane` process (orchestrator turns spawn directly from the bridge with `shell: false`).

3. **R68-3 (Low): `runStopCommand` bridge PID is not tested (`server/runs.js:1645`, `tests/stop-tree-unverified.test.js:25-38`, P683).**
   - In `tests/stop-tree-unverified.test.js`, `FAKE_RUNNER` exits at line 37 when `--stop` is present before reaching `envFile` at line 41. Reverting `MACHINEROOM_BRIDGE_PID: String(process.pid)` at `server/runs.js:1645` leaves all tests in `tests/stop-tree-unverified.test.js` passing.
   - Fix: Write `stopBridgePid` in `FAKE_RUNNER` on the `--stop` branch and assert it equals `String(process.pid)`.

## Checked and found sound

- **P682 (R67-1, `src/engine/cards.js`, `tests/e2e-room.test.js`)**: Removing `head`'s `click` listener closes R67-1. One head click selects and inspects without lifting (`is-pinned`) or moving the camera (`src/engine/camera.js:214` ignores `.mr-card`, `src/engine/room.js:460-466` skips `anchor` and `togglePop`); `click(1)`, `click(2)`, `dblclick(2)` selects, holds, and toggles lift. The new `dispatchCss` and `doubleClickHead` tests in `tests/e2e-room.test.js` fail when the listener is restored. (`src/styles.css:5356` keeps tab-only yellow on `is-pinned` per P680's merge decision.)
- **P683 (R67-2, R67-3, R67-4)**:
  - R67-2: `server/runs.js:951` spares direct bridge siblings in `isTrackedLaneAlive`, and `server/processTree.js:233` ignores `spareAncestor <= 1`. `tests/process-tree.test.js:114`, `tests/leftover-recheck.test.js:209`, and `tests/stop-tree-unverified.test.js:213` fail if their production changes (other than `runs.js:1645`) are undone.
  - R67-3: `server/harness-probe.js:44` wraps `{ ...env, ...command.env }` in `quietAgy`. No unguarded `agy` spawn remains (`server/index.js:1`, `scripts/run-lane.mjs:2`, `src/briefs/run.js:788`, `server/harness-models.js:218`, `server/harness-probe.js:44`, `server/orchestrator.js:2222`). `tests/harness-probe.test.js:127` fails if `quietAgy` is undone.
  - R67-4: `server/orchestrator.js:2172-2177` calls `onReply(PROMPT_TOO_LONG_REPLY)` once when `!compaction` and calls `maybeStartTurn()` when `!stopped`. `turnMessages` were already spliced from `pending`, `pendingCompaction` was cleared, and an over-long message pushed into `messages` is dropped from `prior` by `fitHarnessPrompt` on the next turn, so it neither loops nor answers twice. `tests/orchestrator.test.js:4916` fails if either line is undone.
- **Test timing commits (`4586c8bf`, `8a0cac80`)**: Raising `waitFor` from 15s to 45s (and test timeouts to 120s / 90s) in `tests/orchestrators.test.js:2999,3013,3020` and `tests/claude-sessions.test.js:494,501` accounts for slow full-suite Windows CI load without weakening assertions.

## Grades

### Merges

| Merge | Commit | Grade | Reason |
| --- | --- | --- | --- |
| P678 | `ad81c8a1` | A | Review 67 audit. |
| P682 | `19678d7b` | A | Closes R67-1 cleanly; real DOM event-order tests fail when undone. |
| P683 | `6472df9d` | A- | Closes R67-2, R67-3, and R67-4; minor lockless lane-child edge (R68-2) and untested `--stop` env (R68-3). |
| P684 | `35a3b25f` | B+ | Matches its brief and clears sector names, but seat angles still ignore agent names (R68-1). |

### Hand commits

| Commit | Grade | Reason |
| --- | --- | --- |
| `4586c8bf` | A | Reasonable 45s log wait for Windows CI without relaxing assertions. |
| `8a0cac80` | A | Reasonable 45s wait for full-suite load without relaxing assertions. |
| Briefs/Plan | A | `b40850b4`, `14a94794`, `b8f387ca` match the work. |

## Verification

- `npx vitest run tests/e2e-room.test.js tests/process-tree.test.js tests/leftover-recheck.test.js tests/stop-tree-unverified.test.js tests/harness-probe.test.js tests/hub.test.js`: 7 files matched (including `tests/harness-probe.test.jsx`), 168 passed, 1 skipped (169 total).
- `npx vitest run tests/orchestrator.test.js -t "calls onReply with the stop text"`: 1 passed, 155 skipped (156 total).
- Visual checks by eye (head click lighting, ring seat label readability and placement relative to sector and agent names) are left to the orchestrator.
