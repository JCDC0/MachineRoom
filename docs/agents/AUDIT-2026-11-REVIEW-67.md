# Review 67: review 66 fixes, AGY updater, leftover check, seat lines, prompt fit, sub placement and folder click

Scope: `cd5506e2..HEAD` on `main` (7 merges: `P674`-`P677`, `P681`, `P679`, `P680`; 6 hand code commits: `e45682c3`, `c9413ca5`, `85f693b5`, `b076c605`, `6dc7bcfa`, `7294dbb9`; 7 brief/plan commits: `95a1c453`, `93e23cb8`, `03d6540c`, `22f89ea9`, `7761d8d6`, `c4b76107`, `b96c80ff`).

## Findings

| ID | Severity | Commit | Location | Summary |
| --- | --- | --- | --- | --- |
| R67-1 | High | P680 | `src/engine/cards.js:533-537`, `tests/e2e-room.test.js:1035` | `head` click listener still toggles `togglePop` on one click; `e2e-room.test.js` bypasses it. |
| R67-2 | Medium | `85f693b5` | `server/runs.js:951`, `scripts/run-lane.mjs:205,352` | `isTrackedLaneAlive` omits `spareAncestor`, wrapped `run-lane` hits live turns, `spareAncestor: 1` spares POSIX orphans. |
| R67-3 | Low | `b076c605` | `server/harness-probe.js:43` | `oneTurn` spawns `agy` without wrapping `env` in `quietAgy`. |
| R67-4 | Low | P677 | `server/orchestrator.js:2162-2173` | `freshPrompt === null` returns without `onReply` or `maybeStartTurn`, stranding queued messages. |

### Details

1. **R67-1 (High): Single head click still toggles lift in the browser (`src/engine/cards.js:533-537`, P680).**
   - `makeCard` binds `head.addEventListener('click', ...)` to call `togglePop(path)` when `event.detail <= 1`. `onCardClick` (`src/engine/room.js:460-466`) captures on `cssRenderer.domElement` and returns without `stopPropagation()`, so one click reaches `head` and runs `togglePop(path)`.
   - Failing case: Single-click a card head in the browser; it selects and lifts (`is-pinned`). Double-click it; click 1 lifts and `dblclick` (`room.js:480`) toggles lift off. `tests/e2e-room.test.js:1035` uses `fireCss` with a mock target and never fires `head`'s listener.
   - Fix: Remove `head`'s `click` listener in `src/engine/cards.js:533-537` and test real `head` clicks in `tests/e2e-room.test.js`.

2. **R67-2 (Medium): Leftover check gaps (`server/runs.js:951`, `scripts/run-lane.mjs:205,352`, `85f693b5`).**
   - `isTrackedLaneAlive` (`server/runs.js:951`) calls `leftoverProcesses` without `spareAncestor: process.pid`, so a live sibling orchestrator turn naming `tracked.worktree` makes `stopSectorLanes` flag the lane as `stillRunning`.
   - `scripts/run-lane.mjs:205,352` passes `spareAncestor: process.ppid`. When shell-wrapped (`cmd.exe` or `npm`), `process.ppid` is not the bridge, so live turns are refused; on POSIX with `process.ppid === 1`, `parentChain(byPid, orphan.pid).has(1)` spares reparented orphans.
   - Failing case: Proved with `leftoverProcesses`: POSIX orphan (`pid 12, ppid 1`, `spareAncestor: 1`) returned `[]`; shell-wrapped runner (`ppid 20`) caught live sibling `pid 22` (`ppid 10`); `server/runs.js:951` (`ownPid: 10`) flagged `pid 22` alive.
   - Fix: Pass `spareAncestor: process.pid` in `server/runs.js:951`; in `processTree.js` / `run-lane.mjs`, ignore `spareAncestor <= 1` and pass the bridge PID or active orchestrator PIDs.

3. **R67-3 (Low): Connection probe spawns `agy` without `quietAgy` (`server/harness-probe.js:43`, `b076c605`).**
   - `oneTurn` passes `env: { ...env, ...command.env }` directly to `spawn`. Calls to `probeHarness('agy', { env })` with a custom `env` missing `AGY_CLI_DISABLE_AUTO_UPDATE=true` (or holding `'1'`) spawn `agy` without the switch.
   - Fix: Wrap `{ ...env, ...command.env }` in `quietAgy` (`server/quiet-agy.js`), matching `server/harness-models.js:218`.

4. **R67-4 (Low): Too-long fresh prompt strands queued messages (`server/orchestrator.js:2162-2173`, P677).**
   - When `fitHarnessPrompt` returns `null`, `startTurnNow` sets `state` to `'idle'` and returns without `onReply` or `maybeStartTurn()`.
   - Failing case: Queue a 15,000-char message and a 1,000-char message on AGY with an 8,000-char instruction. `fitTurnText` keeps the first and pushes the second back to `pending` (`line 2007`); `fitHarnessPrompt` returns `null`, stranding the 1,000-char message, and a sub's parent is never woken (unlike `ENAMETOOLONG`).
   - Fix: Call `onReply?.(PROMPT_TOO_LONG_REPLY)` (when `!compaction`) and `maybeStartTurn()` after `setState('idle')`. (Note `claude`/`opencode` can still hit `ENAMETOOLONG` on `carried + instruction + message`, caught by `spawnErrorText`.)

## Checked and found sound

- **Review 66 (`P674`, `P675`, `e45682c3`)**: R66-1 (`orchestrators.js:1445`), R66-2 (`mock.js:920`), R66-3 (`Stage.jsx:980`), R66-4 (`FamilyTree.jsx:1831-1904`, `client.js:461-484`), R66-6 (`FamilyTree.jsx`, `family.js`), R66-7 (`runs.js:2362-2369`, `FREE-HIERARCHY.md:38`) and R66-8 (`build-chunks.test.js`, `control-contract.test.js`) all close their findings with tests that fail when reverted.
- **AGY switch (`c9413ca5`, `b076c605`, `7294dbb9`)**: `quiet-agy.js` (`'true'`, raising `'1'`) loads first in `server/index.js`, `scripts/run-lane.mjs` and `tests/helpers/isolate.js`; `childEnvironment` (`src/briefs/run.js:788`) and `runCommand` (`server/harness-models.js:218`) set `'true'`.
- **Seat lines (`P676`)**: `active-lanes.js:449-470`, `agents-config.js:700-716` and `orchestrators.js:1456-1476` emit `formatSeatAction` only for orchestrators, post-save, with post-change counts, once per lane/sub, via `find(actorId).addRoomReply(line)`.
- **Prompt fit and stop text (`P677`)**: `fitHarnessPrompt` (`orchestrator.js:919-932`) keeps instruction and newest message whole, dropping oldest history then summary; `spawnErrorText` uses `error.code` only and `cleanFailure` masks keys/paths.
- **Refused run wake (`P681`)**: `notifyRefusal` (`runs.js:1421-1458`) wakes only `startedBy` (else main) on non-zero exit with empty `record.log`, masked and capped at 600 chars (`orchestrator.js:3075-3079`).
- **Sub placement and labels (`P679`, `P680`)**: `sectorSubAngle` and `sectorLaneAngles` (`hub.js:181-202`) give sub arcs `lanes + 1` places matching `ringLayout` radius, `subHome` avoids collisions, sub labels stay visible, and head click does not move the camera.

## Grades

### Merges

| Merge | Commit | Grade | Reason |
| --- | --- | --- | --- |
| P674 | `9e467b80` | A | Closes R66-1, R66-4 and R66-6 with solid tests. |
| P675 | `a9257c2e` | A | Closes R66-2, R66-7 and R66-8; tests fail when undone. |
| P676 | `81e72c3a` | A | Clean `formatSeatAction` and actor-only post-save `addRoomReply` wiring. |
| P677 | `d46e81b6` | A- | Closes prompt fit and spawn errors; minor `pending` / `onReply` gap on `null` fit (R67-4). |
| P681 | `02c4defe` | A | Wakes starter once on pre-log refusal without affecting logged runs. |
| P679 | `c544dc53` | A | Ends sub-on-lane overlap and matches `ringLayout` slot counts. |
| P680 | `6f15782c` | C+ | Rightly skips Step 2 and restores sub labels, but `cards.js:533-537` still toggles lift on one click (R67-1). |

### Hand commits

| Commit | Grade | Reason |
| --- | --- | --- |
| `e45682c3` | A | Closes R66-3 in `Stage.jsx`. |
| `c9413ca5` | A | Keeps `AGY_CLI_DISABLE_AUTO_UPDATE` in `LANE_ENV_NAMES`. |
| `85f693b5` | B- | Spares direct bridge siblings; misses `runs.js:951`, wrapped runners and POSIX PID 1 (R67-2). |
| `b076c605` | A- | Covers `childEnvironment`, `harness-models.js` and `isolate.js`; misses `harness-probe.js` (R67-3). |
| `6dc7bcfa` | A | Allows `src/engine/**` on `agy`, keeping `agy2`/`agy3` restricted. |
| `7294dbb9` | A | Updates `quietAgy` and `childEnvironment` from `'1'` to `'true'`. |
| Briefs | A | `95a1c453`, `93e23cb8`, `03d6540c`, `22f89ea9`, `7761d8d6`, `c4b76107`, `b96c80ff` match the work. |

## Verification

- `npx vitest run tests/e2e-room.test.js`: 1 file, 34 passed.
- `npx vitest run tests/process-tree.test.js`: 1 file, 34 passed, 1 skipped (35 total).
- Node check on `leftoverProcesses`: `posix-init-orphan: []`, `shell-wrapped: [12, 22]`, `bridge-stopTree: [12, 22]`.
- Visual checks by eye (head-click glow, sub label/position in 3D) are left to the orchestrator.
