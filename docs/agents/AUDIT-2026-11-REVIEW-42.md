# Review 42

Reviewed `a62c762f..164849c4`. Four P1 findings and two P2 findings.

## R42-1 P1: A failed scope read permits the merge

File: `server/reviews.js:362`.
What goes wrong: The catch returns no refusal when the changed-file read fails. Both the main merge and the project fast forward then continue without checking the restricted scope or telling the parent.
How to see it: Make the scope's `git diff --name-only` fail while the other git calls succeed. A probe with a git stub returned 200 and reached the merge.
Fix: Refuse the merge when its changed files cannot be read.

## R42-2 P1: Moving an outside file into scope passes the gate

File: `server/reviews.js:356`.
What goes wrong: Rename detection makes `--name-only` return only the destination. Moving an unchanged file from `docs/` to an allowed `src/` path hides the outside deletion, so a sub can merge it without the parent.
How to see it: Restrict a sub to `src/**`, move an unchanged outside file into `src/`, and merge. The read-only diff of the rename in `ac34c3de` confirms that this command omits the source path; adding `--no-renames` includes both paths.
Fix: Disable rename detection for the scope read so it checks both the deleted source and the added destination.

## R42-3 P1: A harness switch silently enables Codex Bypass

Files: `server/orchestrator.js:2389`, `src/control/modes.js:15`, `src/harnesses/codex.js:106`.
What goes wrong: An old Claude conversation without a saved mode inherits legacy Bypass. Switching it to Codex now retains that mode and adds the flag that removes approvals and the sandbox, although the owner only chose a harness.
How to see it: Restore a Claude conversation with no `mode`, then call `setHarness` for Codex. A probe returned mode `bypass` and produced `--dangerously-bypass-approvals-and-sandbox` without calling `setMode`.
Fix: Use Auto when changing into Codex unless the owner explicitly chooses Codex Bypass.

## R42-4 P1: Failover overwrites a backup lane's fixed mode

Files: `scripts/run-lane.mjs:1742`, `server/runs.js:1486`.
What goes wrong: The route protects only the primary lane. Failover copies its chosen mode over the backup's saved mode. An orchestrator can choose Bypass on a choice lane and reach a fixed Codex Plan backup in Bypass.
How to see it: Give a choice lane a Codex backup saved as Plan, choose Bypass, and trigger failover. A probe of the actual selection code produced a valid Codex Bypass command for that backup.
Fix: Check the backup's fixed mode before starting it and refuse failover when carrying the mode would override the owner's setting.

## R42-5 P2: A restored sub bypasses the same-harness check

Files: `server/orchestrators.js:924`, `server/orchestrator.js:1327`.
What goes wrong: The check trusts the requested harness, but restoring a sub conversation overwrites it with the saved harness. Removing a sub keeps its conversation, so reusing its id can create an agent on another harness.
How to see it: Have the owner create and remove a Codex sub. Let a Claude orchestrator add a Claude sub with that id. A probe found Claude in the saved ladder and Codex in the new instance's answer.
Fix: Keep the validated harness when restoring a newly added sub and clear saved session state that belongs to another harness.

## R42-6 P2: Choice is accepted for a harness with no modes

Files: `server/agents-config.js:515`, `server/agents-config.js:752`, `scripts/run-lane.mjs:1580`.
What goes wrong: Create and update accept `choice` for every harness. Hermes has no default mode, so the runner leaves `choice` unresolved and refuses the saved lane.
How to see it: Create a Hermes lane with `mode: 'choice'`. A probe got 200 from creation and then `has no permission modes` from runner validation.
Fix: Accept Choice only when the harness has a supported default mode, on both create and update.

Ordinary fixed-lane requests refuse orchestrator overrides. Owner run overrides remain available. Ask is absent from lane pickers and refused by lane validation. Saved scope reaches both merge strategies. Normal sub overrides require the owner or parent token, and repeat merge refusals notify once per lane head. The saved model display, spaced inbox sender, finite scrubber, rename retry helper, and direct chat worktree choice have focused coverage. Lane creation and team writes require the owner page. Split dispatch shows that tasks share the project folder when Separate worktree is off.

Checked and fine
