# Review 69: the review 68 fixes and the refused-run test rig

Scope: `35a3b25f..HEAD` on `main` (merges `P685` and `P686`, hand commit `fd495a7f`, and briefs `b8b3e432`, `6001a069`, `8616310e`).

## Findings

| ID | Severity | Commit | Location | Summary |
| --- | --- | --- | --- | --- |
| R69-1 | Medium | P686 | `server/processTree.js:228-242` | `isRunnerCommand` matches `run-lane.mjs` inside an orchestrator turn's prompt, so its children are not spared. |
| R69-2 | Medium | P686 | `src/engine/hub.js:181-204,702`, `tests/hub.test.js:925-926` | Numeric `createHub` passes `0` for `parkedCount`; seat labels still jump on lane changes, stack across rings, and share angles with session readers. |
| R69-3 | Low | `fd495a7f` | `server/lanes-source.js:545-556` | `adoptLog` permanently marks a log `seen` when `.meta.json` is not written first on an external project; all current production writers write meta first. |

### Details

1. **R69-1 (Medium): Orchestrator turn children are not spared when the prompt mentions `run-lane.mjs` (`server/processTree.js:228-242`, P686).**
   - `isRunnerCommand` tests `/(?:^|[\s"'/])run-lane\.mjs(?:$|[\s"'])/` against the whole command line. Orchestrator turns (`server/orchestrator.js:2113-2230`) pass prompts on the command line (`claude -p`, `opencode run`, `agy --print`, `codex exec`). Any turn whose prompt names `scripts/run-lane.mjs` (such as review or runner briefs) matches `isRunnerCommand`.
   - Failing case: Bridge `pid 100` runs an orchestrator turn `pid 300` (`ppid 100`) whose prompt contains `scripts/run-lane.mjs`, and `pid 300` spawns child `pid 301` (`ppid 300`) naming `C:\work\lane`. In `isSparedSibling(byPid, 301, 100, 'win32')`, the parent chain passes through `300`, `isRunnerCommand` returns `true` for `300`, and `301` is treated as a leftover instead of a spared sibling. `refuseRunningLane` refuses the lane run and `stopLeftovers` kills `301`.
   - Fix: Restrict `isRunnerCommand` to `node` (or shell wrapper) script invocations before prompt flags, instead of matching anywhere inside command arguments.

2. **R69-2 (Medium): Numeric hubs pass `0` lanes, and seat labels still jump, stack across rings, and overlap session readers (`src/engine/hub.js:181-204,702`, `tests/hub.test.js:925-926`, P686).**
   - `syncSeatLabels` (`src/engine/hub.js:702`) passes `parkedKeys.length` instead of `count` to `seatRingPoint`, so `createHub(scene, N)` passes `0` and defaults ring 0's label to angle `0`. `tests/hub.test.js:918,925-926` pins this bug (`createHub(scene, 3)` asserts `(HUB_RADIUS + SEAT_LABEL_OUT, 0, 0)`).
   - `seatRingPoint` also ignores `readerAngles` (`src/engine/agents.js:1228-1230`), ignores other rings' seat and sector angles, and recomputes the widest lane gap whenever lanes join or leave (`setRoster` -> `rebuild`).
   - Failing cases:
     - Numeric hub: `createHub(scene, 4)` puts ring 0's label at angle `0`, directly outside lane 3 (`slotAngle(3, 4) = 2 * Math.PI`).
     - Ring-to-ring stack: With 1 lane on `orchestrator` (ring 0) and 1 sub with 0 lanes on ring 1, both rings call `seatLabelAngle([0.672, Math.PI])` and place their labels at `5.048` rad (`r = 340`).
     - Session reader angle: With no subs, 4 lanes, and 1 active session reader, `readerAngles` and `seatRingPoint(0, null, 4)` both pick `Math.PI / 4`.
     - Jumping on lane changes: With no subs, changing from 1 to 2 to 3 to 4 lanes jumps ring 0's label from `4.712` to `3.142` to `2.618` to `0.785` rad; with 1 sub on ring 1, going from 0 to 3 lanes jumps across `5.048`, `3.142`, `2.113`, and `1.599` rad.
   - Fix: Pass `count` at `src/engine/hub.js:702` and update `tests/hub.test.js:925-926`; place each ring's seat label at a stable ring angle (or avoid earlier rings' seat angles and reader angles without chasing every lane count change).

3. **R69-3 (Low): `adoptLog` permanently skips a log created before its meta on an external project (`server/lanes-source.js:545-556`, `fd495a7f`).**
   - When `worktreeRunsShown` is `false` (external `projectRoot` such as `tests/orchestrators.test.js`), `adoptLog` reads `metaFor(path)` once; if `.meta.json` does not exist yet, `metaProject === '' && !worktreeRunsShown` adds `key` to `seen` and returns, so the run is skipped for good.
   - Check of all run-log writers:
     - `scripts/run-lane.mjs`: `startLane` (`2329-2330`) writes `.meta.json` synchronously (`writeFileSync`) before `openLog(logPath)`. Brief runs, `--project`, `runQueueProject` (`1790`), retries (`2700`), and `startFailover` (`2176`) all go through `startLane`.
     - `server/orchestrator.js`: `startTurn` writes `metaPath` synchronously (`2049`) before opening `logPath` (`2201`).
     - `scripts/hand-run.mjs`: writes only a `runs.jsonl` record (`log: null`, lines `148,156`).
     - Tests: `tests/orchestrators.test.js:2911-2912` (`fd495a7f`), `tests/live-touch-overlap.test.js:78-79`, `tests/room-notice.test.js:140-141`, `tests/stop-tree.test.js:430-431`, `tests/family.test.js:1418-1421`, and `tests/lanes-source.test.js:1325-1326` write `.meta.json` before `.log`. (`tests/orchestrators.test.js:2911,3004` writes `startedBy: 'frontend'` as a string while `startedByOf` at `server/lanes-source.js:303-308` expects `{ harness, session }`, though `orchestrator.js:3058` reads `runs.jsonl`.)
   - Failing case: Any external writer or test on a non-repo `projectRoot` that creates `.log` before `.meta.json` is skipped forever once `watchFolder` fires.
   - Fix: Before permanently adding a log with no `.meta.json` to `seen`, allow a short grace window (or retry on the next scan while the log is new).

## Checked and found sound

- **R68-1 tests (`tests/hub.test.js:872-906`)**: Both new tests fail when their `seatRingPoint` changes in `src/engine/hub.js` are undone.
- **R68-2 (`npm`/shell runs and undo check)**: When `run-lane.mjs` starts through `npm` or a shell, live children still have `run-lane.mjs` in their `parentChain` before `spareAncestor`, so `isSparedSibling` returns `false`; if `run-lane.mjs` exits, orphans no longer descend from `spareAncestor` on Windows (dead `ppid`) or POSIX (`ppid 1`). `tests/process-tree.test.js:126-135` fails when `isSparedSibling` is reverted.
- **R68-3 (`server/runs.js:1645`, `tests/stop-tree-unverified.test.js:28,240-241`)**: `FAKE_RUNNER` records `MACHINEROOM_BRIDGE_PID` on `--stop` and fails if line `1645` is undone.
- **Hand commit `fd495a7f`**: Commit claim matches `adoptLog` and `run-lane.mjs` and fixes the CI race in `tests/orchestrators.test.js`.

## Grades

| Item | Commit | Grade | Reason |
| --- | --- | --- | --- |
| P685 | `933b7df1` | A | Clear Review 68 report; all three findings real. |
| P686 | `c9dec434` | B+ | Closes R68-3; R68-2 matches prompt text (R69-1) and R68-1 keeps count, reader, multi-ring, and jump issues (R69-2). |
| `fd495a7f` | `fd495a7f` | A- | Fixes the test rig race accurately; leaves `adoptLog`'s missing-meta `seen` edge open (R69-3). |
| Briefs | `b8b3e432`, `6001a069`, `8616310e` | A | Match the work. |

## Verification

- `npx vitest run tests/hub.test.js tests/process-tree.test.js tests/stop-tree-unverified.test.js`: 3 files passed, 107 passed, 1 skipped (108 total).
- `npx vitest run tests/orchestrators.test.js -t "refused run wake"`: 3 passed, 82 skipped (85 total).
- Visual check by eye of ring seat labels against sector names and agent shapes is left to the orchestrator.
