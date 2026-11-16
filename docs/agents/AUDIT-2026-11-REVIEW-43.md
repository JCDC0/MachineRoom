# Review 43

Reviewed `99f7e3a6..66c4da38`. All six Review 42 findings are fixed. Two P2 follow-ups remain.

## Review 42 reproductions

R42-1 fixed: `server/reviews.js:369` refuses a failed changed-file read with 409. The git-failure reproduction left main unchanged. Retrying with the owner's `allowOutside: true` returned 200 through the exception at line 367.

R42-2 fixed: `server/reviews.js:360` adds `--no-renames`. Moving `docs/a.md` unchanged into `src/a.md` now returns 409 and lists the deleted outside path. Main stays unchanged.

R42-3 fixed: `server/orchestrator.js:2394` resets Bypass on a harness change. Restoring Claude without a saved mode and switching to Codex now gives Auto. The captured command has a sandbox and no dangerous Bypass flag. Saved Bypass also resets; saved Plan stays Plan.

R42-4 fixed: `scripts/run-lane.mjs:1750` leaves a fixed backup mode intact. A Choice primary running Bypass hit a rate limit and started its Codex Plan backup once. Its command used the read-only sandbox, and both run records kept the right modes.

R42-5 fixed: `server/orchestrator.js:1327` detects a conflicting saved harness; lines 1328, 1329 and 1330 keep the checked harness and model and discard its foreign session. The owner-remove-Codex, parent-add-Claude reproduction now answers Claude and its Claude model. The session assertions have the weakness below.

R42-6 fixed: `server/agents-config.js:515` and `server/agents-config.js:752` require a harness default for Choice. Hermes creation and update now return 400. Codex accepts Choice. A legacy Hermes Choice lane also passes a dry run through `scripts/run-lane.mjs:1583`; an explicit Plan request still refuses.

## R43-1 P2: A failed scope read has no override in the page

File: `server/reviews.js:371`; caller: `src/ui/panels/ReviewsPanel.jsx:513`.
What goes wrong: The new 409 has neither the outside marker nor the message that the page recognises. The API accepts an owner override, but the page never offers Merge anyway. A lasting read failure blocks every normal retry there.
How to see it: Return this read-failure response from the merge client, then confirm Merge in Reviews. A DOM probe showed the error and no Merge anyway button or outside confirmation. The existing API reproduction accepts the override.
Fix: Mark an unread scope response for the page's override flow, with a warning that the files could not be checked.

## R43-2 P2: The restore test erases the session it should test

File: `tests/sub-restore-harness.test.js:127`; removal persists again at `server/orchestrator.js:2886`.
What goes wrong: The test writes a foreign session and Plan while the old instance is alive. Removing that instance overwrites the fixture with its in-memory null session and Auto mode. The later null-session assertion does not test discarding a foreign session.
How to see it: Remove the five new session and conversation guards in restore in memory, while keeping the harness and model guards. Both tests in this file still pass, 2/2. No source file was changed for this check.
Fix: Write the foreign session fixture after removing the old sub, then add the new sub and assert that its session and conversation identifiers were cleared.

The original four focused files passed 20/20. A real bridge restart kept a same-harness sub's session, conversation identifier, messages and owner-set Plan, and the next command resumed that session. All 19 supported fixed backup modes survived selection and validation. The existing owner and parent overrides and the project fast-forward scope refusal passed.

The wider registry and restart check passed 88/89. The removed-sub process test timed out at `tests/orchestrators.test.js:1314`, then cleanup reported EPERM. This is outside the brief's named baseline list, so it is not claimed as a pass or a proven baseline failure. No full suite or visual check was run. The build passed.

Checked and fine
