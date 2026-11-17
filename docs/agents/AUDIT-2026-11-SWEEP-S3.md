# Sweep S3: lane runner and commands

Read at f98cf45b, version 0.1.401, on 2026-11-17. P508. Source changes: none.
Six findings. Synthetic probes use invented canary text, mocked process calls and isolated files. They do not read credentials or start a harness.

## S3-1. High: Hermes adds tool commands to the log without masking them

Location: `scripts/run-lane.mjs:1434`, especially `:1446`; `src/briefs/run.js:1093`.

After the streamed log has been masked and closed, `captureToolLines` exports the Hermes session and appends its tool command previews with plain `appendFileSync`. These lines never pass through `createLaneLog` or `maskKeys`. A credential in a terminal command is saved in the log. `formatSummary` can also print that command.

How to see it: return a synthetic Hermes session export with one terminal call whose command echoes the OpenRouter key variable set to an invented canary value, and a usage file naming that session. Complete `startLane` with the Hermes descriptor. The finished log contains the canary assignment unchanged. The probe reproduced this through the actual export and append path.

Fix: pass every exported tool line through the same credential scrubber as the streamed log before appending it or making the summary. Keep the raw export out of later output paths too.

## S3-2. High: the native harness key is allowed into the child but not masked in logs

Location: `src/briefs/run.js:747`, `:767`, `:871`; `scripts/run-lane.mjs:2243`.

`childEnvironment` passes `MACHINEROOM_API_KEY` to the native harness. `createLaneLog` masks known key formats and the lane ticket, but has no rule for this setting or for its actual value. Native keys can be arbitrary provider strings. Printing this environment setting saves its value in the run log.

How to see it: pass an invented value under `MACHINEROOM_API_KEY` through `childEnvironment` with harness `machineroom`. Push `MACHINEROOM_API_KEY=` plus that value into `createLaneLog` and flush. The probe's writer receives the invented value unchanged.

Fix: scrub the exact credential values passed to the harness, including this native key, across chunk boundaries. Add the setting name to assignment masking too.

## S3-3. High: a brief continuation can start on another branch or lane

Location: `scripts/run-lane.mjs:2177`, `:2190`, `:2220`, `:2286`.

`--continue-from` only requires a matching log name in the records. It reads the old branch but does not compare that branch, lane or brief list with the requested run. A nonempty continuation also skips the clean-tree and start-branch checks. The harness starts in the currently configured lane worktree, even if it holds unrelated work. The queue path has a branch check at `:1675`; the brief path has none.

How to see it: interrupt a brief, move its worktree to a different branch, then run `npm run run-lane -- LANE BRIEF --continue-from OLD_RUN`. The probe supplied a record for another lane, another brief and another branch, and confirmed that `startLane` still reached spawn in the supplied worktree.

Fix: before opening output files or spawning, require the saved lane, brief list, project kind and current branch to match the continuation. For a fallback, check the branch and worktree of the run that actually stopped.

## S3-4. Medium: a check's time limit can leave it waiting forever on Windows

Location: `scripts/merge-lane.mjs:143`; `scripts/review-lane.mjs:131`; `scripts/run-lane.mjs:894`. The called guard is `server/processTree.js:174`.

These timers call `killTree` and wait for `close` to settle their promises. If a command has exited but a descendant still holds stdout or stderr open, `close` has not fired. On Windows, `killTree` refuses an exited direct child. The timer then does nothing, no second deadline settles the check, and the descendant and pending review or merge remain. `startLane` has an exit-to-close timer, but these check runners do not.

How to see it: run a check wrapper that starts a long-lived worker inheriting its output handles and exits immediately. Let the check's time limit expire. A synthetic exited child with open streams left `defaultRunCommand` pending after its deadline; it settled only when the probe supplied `close`. No real Windows descendant was started.

Fix: track descendants before the wrapper exits, stop surviving descendants at the deadline, and bound the wait for pipe closure. Settle a timed-out check as failed even when cleanup fails.

## S3-5. Medium: a torn record consumes the next completed run

Location: `scripts/run-lane.mjs:63`, especially `:72`; reader at `:1474`.

The writer blindly appends to the current end of `runs.jsonl`. If a crash or a partial write leaves an incomplete final JSON object without a newline, the next valid record joins that fragment. The writer reports success, but the reader drops the combined invalid line. The next completed run disappears from the list and cost history too.

How to see it: in an isolated file, write the incomplete text `{"lane":"interrupted"`, then call `appendRunRecord({ lane: 'next' }, { file })`. It returns true, but neither record can be parsed. The probe reproduced this with the actual writer.

Fix: serialize appends and, under that guard, separate or quarantine an incomplete tail before adding the next complete line. Preserve already complete records.

## S3-6. Medium: stale port-lock takeover can remove a new owner's lock

Location: `scripts/run-lane.mjs:1141` to `:1144`.

Two allocators can both observe the old dead holder. One removes the stale lock and acquires it. The other still removes the path using its earlier observation, without checking the replacement owner. Both can then enter the offsets read and write section. They can choose the same free offset or overwrite an assignment that was just saved.

How to see it: leave a dead holder's `.port-offsets.lock` older than five seconds, then start two lanes together. The probe forced the competing replacement between the stale check and removal. `portOffsetFor` deleted the replacement lock and completed its own allocation. This proves the missing ownership check; a live parallel port collision was not run.

Fix: serialize stale takeover with an exclusive takeover guard respected by all allocators. Re-read and verify the holder while holding that guard before removing the stale lock.

## Verification

- `node .p508-probe.mjs`: passed, six of six synthetic checks. The probe and its isolated files were removed.
- `node node_modules/vitest/vitest.mjs run tests/lane-env.test.js tests/worktree-copies.test.js -t 'childEnvironment|createLaneLog|port offset'`: passed, 17 tests passed and 11 skipped in two files.
- Tests added or removed: zero. Those two files contain 28 tests before and after this audit. The selected existing tests pass despite these findings.
- No full suite, build, real agent call, credential read, destructive git call or live Windows process-tree check was run. No source file was changed.

## Checked and fine

- The reviewed spawn sites set `windowsHide: true`.
- Normal project worktree reuse refuses dirty files and commits absent from the project's HEAD before detaching. It does not force a checkout.
- Worktree copies reject paths outside the project and worktree, refuse `.git`, and use `COPYFILE_EXCL` to avoid replacing existing files.
- `worktrees --clean` uses no force flag and keeps worktrees with unmerged commits, dirty files, live lock holders or ignored files other than `node_modules`.
- Normal port allocation holds one shared lock and replaces the assignments file by rename. Saved offsets stay fixed, and exhaustion is refused. S3-6 concerns stale takeover.
- Stop checks the confirmed start time and rechecks the lane lock before leftover cleanup and release.
- Merge preparation refuses dirty worktrees and a live lane lock, and merges a resolved commit SHA. Review also pins its lane head and checks for branch movement.

Checked and fine
