# Review 46

Reviewed `562a7441..ab0f54d1`, P429 to P436. Five findings remain.
The reviewed code matches this checkout. No product code was changed.

## R46-1 P1: Failover still gives some backups Bypass

File: `scripts/run-lane.mjs:1753`, `src/harnesses/claude.js:118`, `src/harnesses/agy.js:79` and `scripts/mr-agent.mjs:275`.
What goes wrong: Dropping carried Bypass to undefined selects the legacy permission flags. Claude and AGY use `--dangerously-skip-permissions`; the native agent has no Auto command guard. A backup saved as `choice` also loses its normal Auto default. FREE-HIERARCHY.md:30 promises this never happens.
How to see it: Fail a Bypass primary onto a Claude, AGY or native backup with no saved mode or with `choice`. An isolated startFailover probe and the real command builders confirmed the missing mode and skip flags. The new regression tests cover Codex backups only.
Fix: Select the backup harness's explicit defaultMode when rejecting carried Bypass, while keeping any fixed saved mode. Test Claude, AGY and native backups too.

## R46-2 P1: Prefixed lane messages bypass the sector check

File: `server/orchestrators.js:771` and `server/orchestrators.js:788`.
What goes wrong: The `lane:KEY` branch delivers to a running lane before reaching the new sector check for bare lane keys. A sub can give work or commands to a lane in another sector.
How to see it: With Scout holding only `inside`, send its token's message to `outside`, then to `lane:outside`. An isolated probe of message returned 403 for the first and 202 for the second, and the outside inbox received the text.
Fix: Apply the same sub-sector check before receiveLaneMessage for orchestrator tokens. Keep Main's access and the separate lane-ticket rules.

## R46-3 P1: A permitted start can fail over outside the sector

File: `server/runs.js:1407`, `scripts/run-lane.mjs:1743` and `scripts/run-lane.mjs:1803`.
What goes wrong: Runs and queues check only the first lane against the sub's sector. The runner then starts its configured fallback without checking that sector. The fallback keeps the original startedBy value. CHANGELOG.md:8 claims sub tokens can start only their own sector's lanes.
How to see it: Give Scout `inside`, set inside's fallback to another sector's `outside`, and start inside with Scout's token. A quota failure starts outside as Scout. The API and runner paths were traced; the isolated failover probe confirmed the outside target and unchanged startedBy. No real agent was started.
Fix: Carry the allowed lane set from the authenticated start to the runner and check the backup before taking its lock or changing its branch. Cover both task and queue starts.

## R46-4 P2: Saving the new config keeps the old harness program

File: `server/orchestrators.js:419` and `server/orchestrator.js:965`.
What goes wrong: saveSubSettings replaces the whole config with the new harness's config, including its program, but the live instance retains its original binOption. An unchanged ladder save now keeps that instance. A sub switched from Codex to Claude can run the Codex executable with Claude arguments.
How to see it: Configure distinct custom binaries for Codex and Claude, change a Codex sub to Claude through the route, save the unchanged ladder, and send a turn. A registry probe with a mocked spawn selected the old binary. The current test uses process.execPath for both harnesses and cannot catch this.
Fix: Update the instance's program override when its harness changes before recording the corresponding config. Test with distinct programs.

## R46-5 P2: A ladder save can lose the owner's new settings

File: `server/orchestrators.js:532`, `server/orchestrator.js:1330`, `server/orchestrator.js:1371` and `server/orchestrators.js:417`.
What goes wrong: A changed scope plus model or effort recreates the sub. restore then takes its old chat-file model and effort over the explicit new config. The save returns the requested ladder, but the live sub disagrees. P436's next saveSubSettings copies that stale model back into the ladder.
How to see it: Change a Codex sub through the routes to Sol/high. Save Terra/medium and a new scope together in the ladder. A registry probe returned Terra/medium while the live sub stayed Sol/high. Saving medium through the effort route then changed the ladder model back to Sol.
Fix: Make sub recreation honor explicitly supplied model and effort over saved chat settings. Test a ladder save that changes scope and settings together, then a later settings route.

## Checks

- All server git spawn sites use gitEnv for the four repository overrides. No missed server git spawn was found.
- Nine focused files passed 25/25 tests. No tests were added or removed. P429, P432, P433 and P434 assertions exercise the changed behavior; no mutation run was done.
- The audit has no related tests. The build passed with the existing large-chunk warning. Git stayed read-only; only this audit is left uncommitted.
- Main and page exceptions remain in the changed gates. Focused tests cover Main dispatch, stops and merge, and the owner's harness change.
- Direct and automatic task and queue starts use finishActor. Review reads remain shared reads. Family proposals need the owner's approval before creating a lane; a sub cannot approve them itself.
- P436 preserves route changes on an unchanged ladder save. The separate simultaneous owner-edit failure is R46-5.
- Probes used synthetic credentials, isolated dependencies or mocked spawn. Probe folders were removed. No live harness, full suite, load run or visual check was done.

Checked and fine
