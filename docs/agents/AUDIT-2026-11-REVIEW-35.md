# Batch review 35

Reviewed `bf2bb79d..ead926b4` on 2026-11-15. The base is the commit that added review 34. This review reads the fixes P313 to P319 and the new code around them. No code was changed. The suite for the changed files passed, and the build passed.

## Findings

| Finding | `file:line` | Concrete failure | Smallest fix | Blocks a push |
| --- | --- | --- | --- | --- |
| P1 R35-1. A lane run still stores a commit subject without masking. R34-3 is fixed only for project records and the runs response. | `scripts/run-lane.mjs:2034` | A brief run, not a `--project` run, copies `git log --oneline` into `record.commits` unchanged. A key or `C:\Users\<name>` in a lane commit subject is written to `runs.jsonl`. `GET /api/control/runs` masks it on the way out, but the record on disk and a recording made by `recordRoom` keep it. No test covers a lane run with a keyed subject. | Send those lines through `maskProfilePaths(maskKeys(...).text)`, the same way `projectRunGit` does, and add a lane-run test with a keyed subject. | Yes |
| P2 R35-2. A refused backup can still replace the failed run's head. | `scripts/run-lane.mjs:837` | `keepGit` keeps the branch and commits, but `writeProjectRecord` still sets `record.head` from the current folder. A backup that commits and then throws leaves a record whose branch names the failed run and whose head is a commit on the backup branch. The run-failover test stops before the backup commits, so it does not see this. | Keep the captured failed head when `keepGit` is true, and extend the exception test to make one backup commit before the throw. | No |
| P2 R35-3. The codex lane names a model the room does not list. | `server/model-list.js:33` | `docs/agents/lanes.json:368` now selects `gpt-6.1-terra`, but the static list holds only `gpt-6.1-sol`. `modelAllowed` refuses Terra for a `--model` override or a lane update, and the Agents picker shows Sol for the codex lane. The lane itself runs because `commandFor` forwards the id unchanged. | Add `gpt-6.1-terra` to `server/model-list.js` and update the codex list expectation at `tests/agents-config.test.js:343`. | No |
| P3 R35-4. A partial process list unlocks a live run. | `scripts/run-lane.mjs:345` | When the snapshot is not empty but omits the holder's child or run pid, the stop skips that pid with no message and then removes the lock at `scripts/run-lane.mjs:393`. The run keeps working with no lock, so a second run can start in the same worktree. | Treat a holder pid missing from a non-empty snapshot as a failed stop and keep the lock. | No |
| P3 R35-5. The closed-review sentence is too strong. | `docs/agents/ORCHESTRATOR.md:14` | It says reviews 31 to 34 are closed while R35-1 leaves R34-3's key leak open for lane records. | Land R35-1, or say R34-3 stays open until it lands. | No |

## Each review 34 finding

| Finding | Fix | Test that proves it | Would the test pass with the fix undone |
| --- | --- | --- | --- |
| R34-1 stop kills a newer run | P313 | `tests/run-lane-stop.test.js`: `leaves a newer run alive and keeps its lock when it appears inside the leftover list`, `takes leftover targets from the snapshot and skips a reused pid`, `stops nothing by worktree and says so when the process list is missing`. | No. Without the snapshot rule the second list finds the new harness at `scripts/run-lane.mjs:160` and the test's `killed` gets 400. |
| R34-2 play overwrites an ignored file | P318 | `tests/project-reviews.test.js`: `keeps an ignored config.json in play when the merged commit tracks it and answers failed`. | No. Without the flag the checkout returns moved, the file holds the lane text and the response is not `failed`. |
| R34-3 private commit text in the failover record | P316 | `tests/run-project.test.js`: `masks a key and a home path in a commit subject before it is stored`; `tests/project-dispatch.test.js`: `masks a key and a home path in commits written before the change`. | No. Both leave the key when the masks are removed. There is no test of the runner's own saved failed record, only of `projectRunGit` and the runs response. |
| R34-4 rollout race | P319 records it in `docs/agents/architecture/LIMITS.md:30`. | No test. The limit is accepted by the owner, as `docs/agents/ORCHESTRATOR.md:14` says. | Not applicable. |
| R34-5 Codex app lookup follows a link | P318 | `tests/agents-config.test.js`: `skips a junction hash folder in the Codex app bin`, `skips a linked codex.exe in the Codex app bin`, `skips a codex.exe whose real path is outside the Codex app bin folder`. | No. The junction and linked-file tests return the outside program when the `lstat` and `realpath` checks are removed. Both Windows-only tests ran on this machine. |
| R34-6 bare carriage return hides a command | P317 | `tests/run-lane.test.js`: `ends a check line at a bare carriage return`, `refuses five commands split by carriage returns`; `tests/project-settings.test.js`: `refuses a carriage return inside a quoted argument and never saves it`; `tests/control-mock.test.js`: `counts commands split by carriage returns and refuses five`. | No. The quoted CR passes validation and the five CR lines pass the count when the split is `\r?\n` only. |
| R34-7 refused backup overwrites the saved branch | P314 | `tests/run-failover.test.js`: `keeps the failed branch and commits when the backup throws after making its branch`. | No. Without `keepGit` the branch becomes `work-x-on-agy` and the test's `records[0].branch` assertion fails. The head remains open as R35-2. |
| R34-8 a queue signs a backup's work with the primary | P314 | `tests/run-queue.test.js`: `signs the queue commit with the backup lane harness after a failover`. | No. Without the per-record author the trailer is OpenCode and the test's `not.toContain('OpenCode')` fails. |
| R34-9 a refused backup reads as moved | P315 | `tests/run-lane.test.js`: `marks a refused backup as one that could not start beside a started move`; `tests/inspector-ui.test.js`: `shows a refused backup as one that could not start beside a started move`. | No. Both renderers print `moved` or `Moved to` without the `refused` branch. |
| The doc rows | P319 | Read against the code. No test. | Not applicable. |

The doc rows are fixed, except `docs/agents/architecture/ROOM.md:10`, which still names the destination's base head through the sentence `The play worktree has changes, so it stayed on OLD.` `docs/agents/ORCHESTRATOR.md:18` records that as a known and accepted exception, so it is not a new finding.

The queue branch check at `src/briefs/queue.js:159` is new work beyond R34-8. It accepts the branch a successful backup ended on. `docs/agents/ORCHESTRATOR.md:18` records that as accepted. Its test, `fails the task when the lane leaves the queue branch`, passes.

No stop path now ends another run through the race review 34 described. The play move keeps the ignored file. The key check found R35-1.

## Verification

`npx vitest run` on the 12 changed test files: 12 files passed, 559 tests passed, 3 skipped. `npx vitest related --run` on the 9 changed source files: 138 files passed, 2902 tests passed, 4 skipped. `npm run build` passed. No live visual check was made, and no fake was used to prove a process starts.

R34-1: fixed.
R34-2: fixed.
R34-3: partly fixed, because R35-1 leaves the same leak in a lane run record.
R34-4: fixed as an accepted limit in LIMITS.md.
R34-5: fixed.
R34-6: fixed.
R34-7: fixed for the branch and commits, with the head left open as R35-2.
R34-8: fixed.
R34-9: fixed.
The doc rows: fixed, with ROOM.md:10 accepted and ORCHESTRATOR.md:14 too strong until R35-1 lands.
