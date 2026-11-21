# Review 70: the review 69 fixes and the seat label drop

Scope: `1576f9b1..fa471e22` on `main` (merges `P688` and `P689`, and briefs `a8acc8a6`, `36bfda2c`; `0794311b` excluded as own brief).

## Findings

| ID | Severity | Commit | Location | Summary |
| --- | --- | --- | --- | --- |
| R70-1 | Medium | P688 | `server/processTree.js:228-275` | `isRunnerCommand` misses runners with node value flags or escaped quotes, accepts `-e`/`-p`, and scans full prompt lines. |
| R70-2 | Medium | P688, P689 | `src/engine/hub.js:39-40,156-165` | `SEAT_LABEL_DROP = 70` puts ring 0 seat labels in agent-name height (hitting session readers) and pushes upper-ring labels onto lower rings at depth 4. |
| R70-3 | Low | P688 | `server/lanes-source.js:556-569` | `waitingMeta` checks `now() - mtimeMs <= META_GRACE_MS`, so a log without meta that keeps receiving writes waits forever. |
| R70-4 | Low | P688 | `tests/lanes-source.test.js:1442-1501` | The expired-meta test passes unchanged if P688 step 3 is undone. |

### Details

1. **R70-1 (Medium): `isRunnerCommand` misses real runners with value flags or quote escapes, accepts `-e`/`-p`, and scans entire prompt strings (`server/processTree.js:228-275`, P688).**
   - Line `272` takes `tokens.slice(1).find((arg) => !arg.startsWith('-'))` as the script path. Any `node` option that takes a separate value before the script (`-r`, `--require`, `--import`, `--loader`, `--env-file`, `-C`, `--conditions`) causes `find` to pick that option's value instead of `run-lane.mjs`. Conversely, `node -e scripts/run-lane.mjs` treats inline code as the script path.
   - `commandTokens` (`lines 228-259`) ignores backslash escapes (`\"`), opens quotes mid-token (`--title=don't`), and copies the entire `command` string into all tokens before checking `tokens[0]`, scanning 100 KB+ orchestrator prompts (`claude -p`, `agy --print`) on every `isSparedSibling` call.
   - Failing cases:
     - `isRunnerCommand('node -r dotenv/config scripts/run-lane.mjs agy-4', 'linux')` returns `false` (`script` becomes `'dotenv/config'`), so `isSparedSibling` spares a live child under `spareAncestor`.
     - `isRunnerCommand('node --title="a \\"b\\" c" scripts/run-lane.mjs agy-4', 'linux')` returns `false` because `\"` closes the quote and splits `b\"` as `script`.
     - `isRunnerCommand('node --title="a \\" scripts/run-lane.mjs \\" b" other.js', 'linux')` returns `true` on `other.js`.
     - `isRunnerCommand('node --title=don\'t scripts/run-lane.mjs agy-4', 'linux')` returns `false` because `'` swallows the rest of the line.
   - Note: `cmd.exe /c node scripts/run-lane.mjs` and `sh -c "node scripts/run-lane.mjs"` also return `false` by P688's `node`-only rule, though while `run-lane.mjs` is alive its `node` process sits in `parentChain` (and after `node` exits, orphans no longer reach `spareAncestor`).
   - Fix: Read tokens one at a time and stop as soon as token 0 is not `node`/`node.exe` or the script token is resolved; handle `\"` escapes inside quotes; open quotes only at token start or after `=`; skip values of Node's value-taking flags; reject `-e`/`--eval`/`-p`/`--print`.

2. **R70-2 (Medium): `SEAT_LABEL_DROP = 70` overlaps session-reader and lane names on ring 0 and leaves its ring at depth 4 (`src/engine/hub.js:39-40,156-165`, P688, P689).**
   - `seatRingPoint` puts every ring's label at `angle = -OVERVIEW.yaw` (`-0.42` rad), `r = radius + 160`, and `y = ring.y - 70`.
   - On ring 0 (`HUB_Y = 200`), lane and session-reader name sprites (`src/engine/agents.js:965-966`) sit at `y = 200 + 90 - 150 = 140`, and session readers stand at `READER_RADIUS = 420`. Moving ring 0's seat label from `y = 200` down to `y = 130` puts it in the same vertical band as agent names while standing `40` units outside `READER_RADIUS`.
   - On multi-level layouts (`ringDrop(3) = 260 / 3 = 86.67` at default `RING_LEVEL_MAX = 4`), `SEAT_LABEL_DROP = 70` drops each upper label 81% of the way to the next ring (only `16.67` units above it, while the `60`-unit sprite spans `+-30` in `y`).
   - Failing cases (projected at `OVERVIEW` on `1280x800`):
     - With 1 main lane and 2 session readers (`reader 1` at `5.76` rad, `r = 420`), ring 0's seat label (`(790.6, 421.9)`) lands `17.6 px` from the reader's name (`(774.8, 414.3)`). With 2 lanes and 2 readers (`reader 1` at `0` rad), the gap is `22.9 px`.
     - With 3 subs (`depth = 4`) and `<= 18` slots per ring (`r = 300`), ring 0's seat label (`y = 130`, screen `y = 421.9`) crosses ring 1's plane (`y = 113.3`, screen edge `y = 427.3`), sitting `5.4 px` from ring 1 vs `20.7 px` from ring 0.
     - With 2+ subs (`arcs.length >= 3`), `sectorLabelRadius` pushes `ORCHESTRATOR` (`(759.9, 482.0)` at 1 sub) further toward ring 1's seat label (`(786.3, 500.3)`).
   - Fix: Cap the drop per ring by `ringDrop` (for example `Math.min(SEAT_LABEL_DROP, gap * 0.4)`, or keep ring 0 at ring height above `y = 140` while only dropping rings below a sector name), and keep `readerAngles` clear of `-OVERVIEW.yaw`.

3. **R70-3 (Low): `waitingMeta` resets its 10-second grace timer on every write (`server/lanes-source.js:556-569`, P688).**
   - `adoptLog` tests `now() - statFile(path).mtimeMs <= META_GRACE_MS` (`line 565`) without tracking when the log was first seen.
   - Failing case: An external-project log created without `.meta.json` that keeps receiving output every few seconds refreshes `mtimeMs` on every write, so `waitingMeta` keeps re-reading the missing `.meta.json` on every scan for the entire run instead of marking it `seen` after 10 seconds. (Double adoption is prevented by `seen.add(key)` before `beginRun`, and foreign `.meta.json` projects are skipped at `line 551`.)
   - Fix: Store `firstSeen` in `waitingMeta` on first encounter (`Math.min(mtimeMs, current)`) and expire the entry once `current - firstSeen > META_GRACE_MS`.

4. **R70-4 (Low): Expired-meta test passes with P688 step 3 undone (`tests/lanes-source.test.js:1442-1501`, P688).**
   - Every assertion in `still skips a log with no meta older than 10 seconds on an external project` expects `openRuns()` and `frames` to be `[]`. Reverting `waitingMeta` in `server/lanes-source.js` still skips both logs immediately and leaves the test green. (The earlier test at `1395-1440` does fail when undone.)
   - Fix: Assert that a twin log created at the same timestamp is still adopted at `9s` while the expired log is skipped after `10s`, or verify meta retries stop after `10s` under ongoing log writes.

## Checked and found sound

- `tests/process-tree.test.js:137-166` and `tests/hub.test.js:807-823,843-914,925-970` all fail when their P688 or P689 production changes are undone.
- `tests/lanes-source.test.js:1395-1440` fails when `waitingMeta` is undone.

## Grades

| Merge | Commit | Grade | Reason |
| --- | --- | --- | --- |
| P688 | `40b66984` | B+ | Stabilizes seat label angle and fixes basic prompt-text and missing-meta cases; misses node value flags, quote escapes, long-line early exit (R70-1), write-resetting grace (R70-3), and an undo-safe expiry test (R70-4). |
| P689 | `fa471e22` | B | Moves ring 1's label below `ORCHESTRATOR` for 1 sub, but fixed `70` drop hits ring 0 session-reader names and crosses lower rings at depth 4 (R70-2). |
| Briefs | `a8acc8a6`, `36bfda2c` | A | Match the work. |

## Verification

- `npx vitest run tests/process-tree.test.js tests/hub.test.js tests/lanes-source.test.js`: 3 files passed, 155 passed, 1 skipped (156 total).
- Visual check by eye of ring seat labels at overview with session readers and 3 sub levels is left to the orchestrator.
