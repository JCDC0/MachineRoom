# Review 58: the runner batch P561, P562, P566 and P574

Read from the diffs against each merge's first parent, with the six touched test files run (161 passed). Nothing was run against a live lane. Line numbers are at `main` 662072a7.

## Findings

### R58-1 (medium) `--list` and `--stats` on a read-only runs folder hang and exit 1
`scripts/run-lane.mjs:1536` calls `appendRunRecord` for each lost run. On a folder that cannot be written, `takeLaneLock` fails and the loop at line 83 retries for 10 seconds, then the catch at line 99 sets `process.exitCode = 1` and prints an error.
Scenario: the runs folder is read-only (a shared or archived folder) and holds three metas with no record. `--list` waits about 30 seconds, prints three "run record was not saved" lines and exits 1, though it only reads.
Fix: in `recoverLostRuns`, skip the write when the folder is not writable (or call a variant that does not set `exitCode`), and still show the lost runs from memory.

### R58-2 (medium) `--stop` with no lock sweeps by worktree name and can kill the owner's processes
`scripts/run-lane.mjs:419` no longer returns when the lock is missing (only when `startedAt` is given). It falls through to `stopLeftovers` with `configuredLaneWorktree` (line 436), which kills every process whose command line names the lane worktree (`server/processTree.js:149`, `218`).
Scenario: the owner runs `npm run run-lane -- claude3 --stop` after a run ended. Their editor, a terminal `git` or a hand-started dev server whose command names `.worktrees/claude3` is killed with SIGKILL, one pid at a time with no tree.
Fix: with no lock, stop only pids in `saved.recorded` (matched by creation time); never sweep by name.

### R58-3 (low) The same name match runs in the final sweep of every run
`sweep()` (line 2384) at run end uses `stopLeftovers` with `worktree: sweepWorktree`, so any process naming the lane worktree is killed when the lane ends, for example a second window of the owner's tool or a `review-lane` check on that worktree. This was true before P562; the new `killProcess` kills a single pid, so the tree below it is left.
Fix: restrict the name match to processes created after the run's start time.

### R58-4 (low) A resumed Claude run ignores a changed brief
`scripts/run-lane.mjs:2243` and `2273`: with `resumedSessionId` the prompt becomes the interrupt text or "Continue your brief from where you stopped.", and `fullPrompt` is dropped. The brief ids are compared, the brief text is not.
Scenario: the orchestrator edits the brief in `TASKS.md` after a lane stopped, then continues it. The lane resumes the old conversation and never sees the change.
Fix: resume only when the brief text hash matches the one saved in the meta; otherwise start a fresh session.

### R58-5 (low) The Windows sampler dies on the first CIM error and is never restarted
`server/processTree.js` (`sampleProcesses`): `Get-CimInstance ... -ErrorAction Stop` ends the PowerShell loop on one transient error and stderr is ignored. After that no pid is recorded for the rest of the run, so the orphan sweep falls back to the name match.
Fix: wrap the query in try/catch inside the loop and emit an empty array on error.

### R58-6 (low) A timed-out body read is retried as a damaged answer
`scripts/mr-agent.mjs:1195`: the body read has `catch {}`. If the 300 s timeout fires after the headers arrive, the body is empty, it counts as damaged and the request is resent (up to `DAMAGED_RETRY_LIMIT`). With a cost limit it stops instead, which is correct. Each attempt also now gets a full 300 s, so one call can take about 25 minutes plus delays; before, the whole call had 120 s.
Fix: treat a body read error like a failed request, and cap the total time of one `post`.

### R58-7 (info) The lost-run sweep marks every meta with no record
`recoverLostRuns` writes one `lost` record for any `*.meta.json` with a log and no record, including runs whose record was never written for other reasons. On a first `--list` of an old runs folder this adds records in bulk. The legacy-name check limits it, and the lock check keeps live runs safe.

## Checked and found sound
- Live run marked lost: the lane lock is taken before the meta is written and released after the record, and `lostRunRecord` refuses while the lock holder or its child is alive. A failover run holds the target lane's own lock.
- Lost record written twice: `appendRunRecord` checks for an existing record by name under the append lock (line 82), so two `--list` calls racing write one.
- `--resume` with `--session-id`: `sessionId` is passed as `undefined` when resuming, so the harness (`src/harnesses/claude.js:135`) does not add it.
- Resume pointing at another worktree: `claudeResumeId` builds the transcript path from the worktree of this run and needs the file to exist. A queue task after the first starts a fresh session.
- Pid reuse in the sweep: recorded pids are used as roots only when the creation time matches, and `stopLane` marks a changed creation time as stale.
- Spawn without `windowsHide`: the new sampler spawn and the process list set it.
- The hand-settled merges: the `prev.record` to `record` change is applied everywhere in `runQueueProject` and `startLane`; the P566 and P562 `COMMANDS.md` edits do not contradict each other.
- Tests that pass with the change undone: none found. The P574 test checks the 300000 values and the retry count, the P561 test checks the last two arguments and the meta.

## Grades
- P566 (lost runs): B. R58-1 and R58-7.
- P562 (process sweep): C. R58-2, R58-3 and R58-5.
- P561 (Claude resume): B. R58-4.
- P574 (request timeout): B. R58-6.
