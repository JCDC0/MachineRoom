# Review 47

Reviewed `ab0f54d1..d1d635c3`, P438 to P465, against the settled research plan.
Only this audit changed. Findings below come from read code and synthetic probes.

## R47-1 P1: Interrupting a backup restores the primary's permissions

File: `server/runs.js:1603`, `server/runs.js:1609` and `scripts/run-lane.mjs:1738`.
What goes wrong: A backup continuation gets the primary item's model and mode. The runner treats those command-line overrides as authoritative, even when the backup has a fixed guarded mode.
How to see it: Fail a Bypass primary onto a Plan backup, then message `lane:backup` with interrupts on. An isolated probe of interruptLane restarted backup with the primary model and Bypass.
Fix: Build the continuation from the active backup's effective settings, enforcing its saved permission boundary again.

## R47-2 P2: A backup continuation can leave the worktree holding its work

File: `server/runs.js:1606`, `scripts/run-lane.mjs:1545` and `scripts/run-lane.mjs:1998`.
What goes wrong: A project failover works in the primary's existing worktree. Its interrupt restarts backup with the original project-root request, so runQueueProject selects `.worktrees/backup` instead of the actual worktree. Uncommitted work and the branch stay behind.
How to see it: Start primary with Separate worktree, fail over, leave an edit, then interrupt backup. The restart probe kept the project root and worktree flag while changing the lane; the runner derives its path from that new lane.
Fix: Resume the validated project path and branch recorded for the interrupted run instead of deriving a worktree from the new lane name.

## R47-3 P2: A final native answer drops a reply fetched at the same time

File: `scripts/mr-agent.mjs:1603`, `scripts/mr-agent.mjs:1605` and `scripts/mr-agent.mjs:1657`.
What goes wrong: The inbox watch can finish after the model response. Its reply goes into heldInbox, but a final answer returns success before another iteration can read it.
How to see it: Have the first model call wait for an inbox poll, return a final answer, then finish the inbox response. A real native-agent probe against a local fake provider fetched the reply, made only one model call and exited 0. The race test at `tests/lane-replies-setting.test.js:214` uses a tool response, which guarantees another iteration.
Fix: Process a held reply before accepting a final answer, while still recording the completed call's usage.

## R47-4 P2: A failed interrupt consumes its replies

File: `server/orchestrators.js:875`, `server/runs.js:1574` and `server/runs.js:1588`.
What goes wrong: takeUnseen marks messages seen and interrupted before the stop succeeds. A failed stop leaves them in the inbox but excludes them from later interrupt prompts, and status falsely says interrupted.
How to see it: Make the stop command fail, then send another reply. The first callback consumes the first reply and interruptLane returns false; the next callback selects only the new reply. An isolated probe confirmed consumption on the failed path.
Fix: Acknowledge the selected replies only after a continuation starts, restoring queued state when delivery fails.

## R47-5 P2: Failover resets the interrupt-chain count

File: `server/runs.js:939`, `server/runs.js:1569` and `scripts/run-lane.mjs:1990`.
What goes wrong: The chain counter follows continues only. A failover clears continueFrom and records failoverFrom instead, so an interrupt of the backup loses the earlier interrupt history.
How to see it: Interrupt primary twice, fail over, then interrupt backup and send more replies. The counter probe returned 3 for the primary history and 1 at the backup record, allowing more than three interrupts from the first run.
Fix: Keep the interrupt count on the retained ticket across both continuations and failovers.

## R47-6 P1: An in-flight interrupt can restart after Stop sector

File: `server/runs.js:1374`, `server/runs.js:1484` and `server/runs.js:1603`.
What goes wrong: A sector stop gets busy for an already interrupting item and ignores that result. The interrupt can then launch its continuation without consulting the stopping gate or an owner cancellation marker.
How to see it: Hold an interrupt's stop command open, issue Stop sector, then let that command finish. The continuation path restarts; an isolated probe confirmed it never calls sectorStoppingError even with that gate set.
Fix: Cancel pending continuations when the sector stop begins and check that cancellation before starting them.

## R47-7 P2: An unreadable process list becomes a claim that a lane stopped

File: `server/runs.js:663`, `server/runs.js:1493` and `server/runs.js:1507`.
What goes wrong: A failed process listing becomes an empty array. After the tracked runner exits, a detached survivor absent from that array is reported in stoppedLanes rather than as unverified.
How to see it: Deny the Windows process-list query and run `tests/stop-tree.test.js:450`. It failed here: inside1 was reported stopped although the fixture left a child alive. The process-list helper returned zero rows in this sandbox.
Fix: Preserve process-list failure and report affected lanes as still running or unverified until their tree can be checked.

## R47-8 P2: Reviews omit retry attempts from their totals

File: `server/reviews.js:486`, `server/reviews.js:489` and `scripts/run-lane.mjs:2431`.
What goes wrong: linkedRuns starts from the newest run and follows only failoverFrom and continues. A plain repair or automatic startup retry has neither link, so its earlier attempt's cost, tokens and minutes disappear.
How to see it: Supply first.log with retried true and first-retry.log on the same task branch. The linkedRuns probe returned only first-retry.log. The new rollup tests cover failovers and continuations, not this retry.
Fix: Record and follow retry identity, and include earlier repair runs belonging to the reviewed task branch.

## R47-9 P2: Removed lanes lose their unreported-cost warning and tokens

File: `server/lane-costs.js:147`, `server/lane-costs.js:157` and `server/lane-costs.js:170`.
What goes wrong: The new missingCostRuns count is discarded unless removed lanes have positive known cost. With only unknown costs, their row and known tokens vanish and the summary shows 0.
How to see it: Pass no roster agents and one removed-lane record with costUsd null and 100 input tokens. The laneCosts probe returned spendCents 0 and no rows.
Fix: Retain removed rows with runs or usage and expose unknown or partial spend in the summary.

## R47-10 P2: Changing an MCP environment value keeps the old tool list

File: `server/mcp.js:528`, `server/mcp.js:536` and `server/mcp.js:547`.
What goes wrong: The cache key includes environment names but not values. Changing a server's workspace or feature selection can reuse another configuration's tool names and schemas for 60 seconds.
How to see it: List a server with ROOM=one, change only ROOM to two, then list again. A key probe confirmed both configurations have the same key. `tests/mcp-list-cache.test.js:104` changes args only.
Fix: Hash the complete normalized configuration, including environment values, without logging it.

Checks: The focused run completed 81 tests: 77 passed, 4 failed. Three lane-interrupt tests timed out, including cleanup hooks; the stop-tree survivor test failed as described above. These are additional to the brief's named baseline failures. No product or test file was changed. No full suite, mutation run, real provider or visual check was done.
The audit has no related tests. The production build passed with the existing chunk-size warning. Test scratch folders were removed and the leftover test processes were confirmed exited. Git stayed read-only.

Checked and fine
