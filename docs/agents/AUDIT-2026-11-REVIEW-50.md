# Review 50: P494, P495 and the bridge

Range `643976d8..cd931ceb`. Method: read the diff, then the touched functions and their callers. I ran no tests.

Of the ten findings in review 49, nine are fixed as written. R49-9 is fixed in a way that brings a new fault (R50-1). R49-10 is fixed; its test pins an odd status (R50-5). I found no key, no home path and no git call without `windowsHide` in the changed code.

### R50-1 (medium) Hashed port offset can give two lanes the same ports

`scripts/run-lane.mjs:1123`. `portOffsetFor` keeps 100 buckets (`% 100`, times 10). The old offset was the lane's index in `lanes.json`, so it never collided. Now 10 lanes collide about 37 percent of the time, and 14 lanes about 61 percent. Two colliding lanes take the same ports, so the second run's dev server fails to start or reaches the first lane's server. See it: call `portOffsetFor` for the keys in the owner's `lanes.json` and look for a repeat. The test (`tests/worktree-copies.test.js`) only checks that `lane1` and `lane2` differ, so it passes with a collision.

Fix: keep the hash only as the start of a probe. Take the offset from the sorted lane list when `lanes` is known, and use the hash only for a key that is not in `lanes.json`. Add a test over the real lane keys that asserts all offsets are distinct.

### R50-2 (medium) A failed exclude write leaves a copied file that git does not ignore

`scripts/run-lane.mjs:683-695`. P495 moved `copyFileSync` before the `rev-parse` and the exclude append. If `rev-parse --git-common-dir` fails, or the append throws, the file is already in the worktree. The error stops the start, and the next start finds the target and logs `skipped (exists)`, so the exclude line is never written. The copied file (often an env file with secrets) then shows as untracked and a lane's `git add -A` can commit it. See it: make `info/exclude` read-only, run `prepareWorktree` with a copy, then restore it and run again.

Fix: on any error after the copy, `rmSync(target)` before rethrowing. Or write the exclude line first and copy second, as before, but skip the line when `ignored`.

### R50-3 (low) Rewind refusal message is wrong for a commit made after the run

`server/reviews.js:1049`. The check is "every commit in `checkpoint..HEAD` is in the run's recorded list". A commit made by hand after the run is also not in that list, and the message now says `commits from before the last run`. That is false for this case, and the owner is sent to look in the wrong place. The test `refuses a commit made before the last run` keeps the old by-hand case under the new name. Fix: say `commits that the last run did not record`.

### R50-4 (low) Any lock error answers "the lane has a run going"

`server/reviews.js:1072`. The `catch` around `takeLaneLock` hides every error: a missing runs folder, a permission error or a half done takeover all say a run is going. Fix: answer with that sentence only when the error message starts with `The ` and contains `is already running`; answer 500 with the plain failure otherwise.

### R50-5 (low) Second rewind of the same run answers 500

`server/reviews.js:1081`, test at `tests/reviews-rewind.test.js` (`refuses a second rewind of the same run`). The recovery ref already exists, `update-ref` with the zero old value fails, and the `catch` answers 500 `The rewind failed.`. Nothing moves, so it is safe, but a refusal should be a 409. Fix: run `git rev-parse --verify --quiet <ref>` before `update-ref` and answer 409 `This run was already rewound.`.

### R50-6 (low) No test shows the lane lock is released

`tests/reviews-rewind.test.js`. The new tests check a held lock refuses, but none checks `lane1.lock` is gone after a 200, a 409 from `rewindState` or a 500. A missing release in one branch would block the lane's next start and no test would fail. Fix: after each of the three outcomes, assert `existsSync(join(runsFolder, 'lane1.lock'))` is false.

### R50-7 (low) `touchedPartial` is not set when the list was cut at the limit

`server/runs.js:949`. `partial` comes only from `shellUnplaced`. When `summary.written` is longer than `LIVE_TOUCH_LIMIT`, the loop stops and the list is also not complete, but no flag says so. The overlap card then reads `Now editing in` with a short list. Fix: `partial = summary.shellUnplaced > 0 || summary.written.length > touched.length` after dedupe, or set a flag in the `break` branch.

### R50-8 (low) Copy ignore check reads the main checkout, not the worktree

`scripts/run-lane.mjs:683`. `check-ignore` runs in `project`, so a file ignored by the main checkout's `.gitignore` is skipped, but the lane's branch can have a different `.gitignore`. On a branch that no longer ignores the file, it shows as untracked in the worktree. Fix: run `check-ignore` with `cwd: worktree` after the copy, and write the exclude line only if that says not ignored.

## Checked and fine

- Rewind: `releaseLaneLock` is in `finally`, so it runs on 409, 500 and 200. It removes the file only when the pid is the bridge's own, so it cannot delete a lock a run took.
- Rewind: `beginRepoWrite` is taken before the lane lock and released last, so two rewinds cannot interleave. `rewindState` with `held` skips only the alive check; the GET preview still refuses on a live run.
- Rewind: the recovery ref is written with a zero old value before `reset --keep`, so an existing ref is never overwritten and a failed ref stops the reset. The post-reset notify block is in its own `try`, so a throwing orchestrator no longer turns a done rewind into a 500.
- Recovery ref name: lane and start time parts are cleaned to `[A-Za-z0-9.-]`, and the six character hash separates `lane.1` from `lane-1`. No path part can reach outside `refs/machineroom/recovery/`.
- Run commits from the checkpoint head: `checkpoint?.head` is a 40 character hash from `rev-parse`; falls back to `refs/heads/main..HEAD` when there is none.
- Codex input tokens: `tokenCount(usage.input_tokens)` with cache read kept apart; the tests and the cache share now agree.
- Probe: Direct API with no model answers `unknown` before any spawn; the OpenCode config is a file inside the probe's own temp folder, and that folder is removed in `finally`. Spawn uses the existing `windowsHide` path in `oneTurn`.
- `touchedCache`: entries are keyed by the resolved log inside the runs folder, dropped on every refusal path, on log change and on `clear()` (line 1794), so growth follows the number of open logs only.
- Review scope brief source: `git show base:docs/agents/TASKS.md` reads the base ref, so a lane cannot change its own brief text. The `catch {}` leaves `briefsText` undefined, which the caller already handles.
- Copies: `check-ignore` and `rev-parse` both set `windowsHide`; the copy keeps `COPYFILE_EXCL` and the realpath checks before it.

I could not run the suite here. The sandbox's process tests are the known baseline.
