# Review 71: the review 70 fixes

Scope: `169c4125..b7a6127e` on `main` (merge `P691`, commits `96b51ad0`, `1dc7e3b5`, `4189e7c4`, `d7026fc9`, `0d89a413`; `ac4dd6f7`, `1944e3f2`, `dc53c192` are doc updates).

## Findings

| ID | Severity | Status | Commit | Location | Summary |
| --- | --- | --- | --- | --- | --- |
| R71-1 | Medium | A user can meet it | P691 | `src/engine/hub.js:156-169` | `seatRingPoint` still drops ring 0 by `70` with 1 sub (hitting session-reader names) and leaves the lowest ring colliding with `ORCHESTRATOR` at 2+ subs. |
| R71-2 | Low | Edge case only | P691 | `server/processTree.js:228-272,298-305` | `isRunnerCommand` misses `-pe`, `--env-file-if-exists` and other space-value flags, and `\\\\"` before a closing quote. |
| R71-3 | Low | Edge case only | P691 | `tests/process-tree.test.js:197-199` | The 30,000-character prompt test passes unchanged if the early-exit scan change in `isRunnerCommand` is undone. |

### Details

1. **R71-1 (Medium, a user can meet it): `seatRingPoint` does not close R70-2 for ring 0 session readers or 2+ subs (`src/engine/hub.js:156-169`, `4189e7c4`).**
   - P691 changed the drop to `Math.min(SEAT_LABEL_DROP, gap * 0.4)`. That stops labels on 3-ring and 4-ring stacks from crossing the ring below, but leaves two R70-2 overlaps open in layouts the room draws today:
   - On a 2-ring layout (1 sub, or 2+ flat subs), `ringDrop(1)` is `260`, so `gap * 0.4` is `104` and ring 0 still drops by `SEAT_LABEL_DROP` (`70`) to world `y = 130`. With no subs (`layout = null`), `gap` falls back to `RING_FLOOR_GAP` (`60`), dropping ring 0 by `24` to world `y = 176`, near session-reader rings (`y = 180`) and names (`y = 140`) at `READER_RADIUS = 420`.
   - On any layout with 2 or more subs (`arcs.length >= 3`), `sectorLabelRadius` pushes the `ORCHESTRATOR` sector label (`y = 160` at `sectorLabelAngle = 0.663` rad) into the lowest ring's seat label (`y = -84` at `angle = -OVERVIEW.yaw = -0.42` rad).
   - Failing cases (projected at `OVERVIEW` on `1280x800`):
     - A user runs `--lanes --sessions` with 1 sub, 2 main lanes and 2 session readers (Claude Code and OpenCode): ring 0's seat label (`(790.6, 421.9)`) sits `22.9 px` from reader 1's name (`(774.0, 437.7)` at `angle = 0`). With no subs, 1 lane and 2 readers, ring 0's label (`(791.4, 407.5)`) sits `16.9 px` from reader 1's ring and `17.9 px` from its name (`angle = 5.76`).
     - A user configures 2 flat subs (`arcs.length = 3`): ring 1's seat label (`(787.0, 486.7)`) lands `22.3 px` (`dy = 1.8 px`) from `ORCHESTRATOR` (`(764.8, 484.9)`). With 3, 4 or 5 flat subs, the distance drops to `17.3 px`, `12.9 px` and `9.9 px`. With 3 stacked subs (4 rings), ring 3's label lands `17.3 px` from `ORCHESTRATOR`.
   - Fix: Keep ring 0's seat label at or above ring height (`y >= 0`, clear of `y = 140` names and `y = 180` reader rings), or place seat labels at an angle away from `readerAngles` and `sectorLabelAngle`.

2. **R71-2 (Low, edge case only): `isRunnerCommand` misses `-pe`, extra space-value flags and `\\\\"` (`server/processTree.js:228-272,298-305`, `1dc7e3b5`).**
   - `NODE_EVAL_FLAGS` (`line 240`) omits combined `-pe` (valid in Node 24) and `-c`/`--check`, so `isRunnerCommand('node -pe scripts/run-lane.mjs', 'linux')` returns `true`.
   - `NODE_VALUE_FLAGS` (`lines 228-238`) omits Node 24 options that also accept a space-separated value (`--env-file-if-exists`, `--title`, `--watch-path`, `--redirect-warnings`, `--disable-warning`, `--dns-result-order`, `--icu-data-dir`), so `isRunnerCommand` mistakes their value for the script and returns `false`.
   - `nextCommandToken` (`lines 252-254`) handles `\"` without handling `\\`, so an even number of backslashes before a closing quote (`node --title="a\\\\" scripts/run-lane.mjs`) leaves `quote` open and swallows `scripts/run-lane.mjs` (`false`).
   - Edge case only: MachineRoom starts `run-lane.mjs` via `server/runs.js:658,1535` (`process.execPath` and `['scripts/run-lane.mjs', ...]`), `npm run run-lane` (`package.json:77`, which spawns `node scripts/run-lane.mjs` under `cmd.exe` or `sh`) or a plain shell `node` command. None of those pass extra Node flags or `\\\\"` before the script, and while `run-lane.mjs` is alive its `node` child sits in `parentChain`.
   - Fix: Consume `\\` pairs inside double quotes in `nextCommandToken`, add `-pe`, `-c` and `--check` to the rejected flags, and add the remaining space-value Node flags to `NODE_VALUE_FLAGS`.

3. **R71-3 (Low, edge case only): Long-prompt early-exit test passes with P691 undone (`tests/process-tree.test.js:197-199`, `1dc7e3b5`).**
   - `isRunnerCommand('claude -p "${prompt} scripts/run-lane.mjs"', 'linux')` and `isRunnerCommand('node scripts/run-lane.mjs "${prompt}"', 'linux')` already returned `false` and `true` under P690's full-string `commandTokens`. Reverting P691's `nextCommandToken` early exit leaves lines `197-199` green.
   - Edge case only: `server/processTree.js:280-309` does exit on token 0 (`claude`) and after the script token (`run-lane.mjs`), and lines `168-196` do fail if the flag or quote changes are undone.
   - Fix: Guard early exit directly (for example via a token-step limit or an internal cursor test) instead of checking only the boolean return value.

## Checked and found sound

- `server/lanes-source.js:556-578` (`waitingMeta` `firstSeen`): stores `Math.min(mtimeMs, current)` once, keeps retrying for `META_GRACE_MS` even when the folder stamp stays unchanged (`lines 588-595`), expires 10 seconds after `firstSeen` even under steady writes, and avoids double adoption via `seen.add(key)` before `beginRun` (`lines 581-582`).
- `tests/lanes-source.test.js:1439-1564`: `twinLog` at lines `1493-1496` fails if grace time is removed, and the growing-log test at lines `1509-1564` fails if `firstSeen` is reverted to `mtimeMs`.
- `tests/hub.test.js:807-846` and `tests/process-tree.test.js:168-196` fail when their production fixes are undone.

## Grade

| Merge | Commit | Grade | Reason |
| --- | --- | --- | --- |
| P691 | `b7a6127e` | B | Closes R70-3 and R70-4 cleanly and fixes R70-2's ring-crossing at depth 4, but leaves R70-2 open for ring 0 session readers and 2+ subs (`ORCHESTRATOR`), misses a few Node flags and `\\\\"` (R71-2), and lacks an undo-safe early-exit check (R71-3). |

## Verification

- `npx vitest run tests/process-tree.test.js tests/hub.test.js tests/lanes-source.test.js`: 3 files passed, 158 passed, 1 skipped (159 total).
- 3D screen projections at `OVERVIEW` (`1280x800`) computed via `THREE.PerspectiveCamera` and `projectPoint`. Visual check by eye in the browser is left to the orchestrator.
