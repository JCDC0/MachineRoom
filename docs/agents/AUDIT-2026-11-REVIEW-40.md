# Review 40

Reviewed `99b01912..22e7a452`: P382, P384 and P385.

## R40-1: P2. A replacement leftover lets the lane start

File: `scripts/run-lane.mjs:286`.

The second list is checked only for the first list's pid and command.
If a leftover launches its worker and exits during the 500 ms wait, the worker
can still name the worktree, but the runner lets a new lane start beside it.
A process that changes its command while keeping its pid has the same problem.

How to see it: call `refuseRunningLane` with an injected list. Return pid 4141
running `node.exe C:/review-work/parent.js` first, then pid 4142 running
`node.exe C:/review-work/worker.js`. Use `C:/review-work` as the worktree.
The call resolves. An in-memory assertion reproduced this.

Fix: search the second list for leftovers in the same folders too. Refuse a
replacement that still names the worktree instead of treating it as clear.

## R40-2: P2. An oversized inbox batch loses its newest reply

File: `scripts/mr-agent.mjs:1359`.

The final fallback keeps the first 2000 characters of a user message.
An inbox batch lists replies oldest first. When that batch alone needs trimming,
a newer order near its end disappears. `readLaneInbox` has already marked the
reply seen at line 1389, so the next read does not restore it.

How to see it: use an 8000 character bound, a 1000 character system message,
the task, then one inbox batch with a 7500 character older reply followed by
`Newest order to keep.`. After `boundMessages`, that newest reply is absent.
An in-memory assertion reproduced this. The test at
`tests/review-39-fixes.test.js:418` checks only the newest batch's prefix.

Fix: trim inbox batches by individual replies, removing the oldest first and
keeping the newest reply. Add a test with two replies in one oversized batch.

Other checks found no issue in the changed model guards or command arrays.
The five CLI harnesses omit an empty model flag and keep a named model.
Direct API and endpoint model guards remain. The picker tests cover failed
saves and tab changes. The inbox loops finish and keep the initial task.
The bound can remain above its limit when protected messages alone are too big.
No real harness profile or screen check was run.

Checked and fine
