# Review 53: the sweep fixes

P518. Read `f98cf45b..9f145b41`, matching main, on 2026-11-17. P513 is merged and included.
Reviewed P509 to P516 against S1, S2 and S3. Only this audit changes.
Synthetic probes used invented values and fake process callbacks. No real credentials were read.

## R53-1. High: a complete child credential can escape at the end of a log

Where: `src/briefs/run.js:933`, `src/briefs/run.js:934`, `src/briefs/run.js:983`.
The scrubber keeps a suffix that matches the start of a credential before masking complete occurrences. That can cut a complete credential into two unmasked pieces. Flush writes the kept piece unchanged.
See it: give `createLaneLog` the invented secret `canary-ab-canary`, push that value alone on stdout, then flush. The writer receives the whole value unchanged. An inline assertion reproduced this. The value exceeds the merge's eight-character minimum.
Fix: recognize complete credential matches before keeping an unfinished suffix. Add this repeated-prefix, end-of-stream case to the log test.

## R53-2. High: timeout cleanup can kill an unrelated process by a reused pid

Where: `server/processTree.js:255`, `server/processTree.js:273`.
The Windows snapshot saves descendant rows once, then `stopRecorded` calls taskkill using only each saved pid. It never checks whether that pid still belongs to the saved process.
See it: a wrapper exits with two workers. One keeps the output pipe open. The other is captured, exits, and its pid is reused before the deadline. Timeout kills the replacement too. A fake child and injected list and kill callbacks confirmed that cleanup uses the saved pid without a second identity read. No real process was killed by the probe.
Fix: re-read process identities before stopping recorded descendants and require the saved creation time to match. Refuse uncertain identities. Test a recycled descendant pid while another worker keeps the pipe open.

## R53-3. Medium: toggling an MCP server can rewrite its private arguments

Where: `server/mcp.js:194`. Caller: `src/ui/McpSettings.jsx:145`.
Restoring each masked argument with `previous.find` chooses the first private value with that display text. Two different private paths can have the same masked display, so saving an unchanged public list replaces the second path with the first.
See it: save arguments `C:\Users\someone\data` and `C:\Users\name\data`. Both display as `%USERPROFILE%\data`. Toggle enabled with the public server object. Both saved arguments become the first original path. An isolated-file assertion reproduced this.
Fix: restore unchanged arguments by their original positions. Reject ambiguous masked edits instead of guessing.

## R53-4. Medium: a Harnesses toggle still discards an unsaved program

Where: `src/ui/HarnessesSettings.jsx:184`. Callers: lines 316 and 341.
Every successful `applySetting` clears the program's dirty flag, including an enabled toggle that never saves the program. `mergeDrafts` then replaces the draft with an empty string.
See it: edit the Program field of a disabled harness, then turn on Offer in forms. The program input becomes empty. An inline render probe reproduced the lost draft. Turning the harness off takes the same save path.
Fix: clear `program:KEY` only when the successful payload contains a program change. Test a toggle with a dirty program field.

## R53-5. Medium: the stale-port regression test passes without the fix

Where: `tests/worktree-copies.test.js:111`, especially line 118.
The two calls share one JavaScript thread. The stale observation and removal have no await between them, so this test cannot put a replacement owner between those steps. It does not exercise the sweep's competing-removal race.
See it: run the new Promise.all and lock-removal assertions against `portOffsetFor` extracted from `f98cf45b`. They pass with offsets 0 and 10. An inline probe confirmed this without changing source.
Fix: force the replacement-owner interleaving with an injected hook, or coordinate two allocator processes at that point. Require the replacement lock to survive.

## R53-6. Medium: the linked-index regression test tests a directory

Where: `tests/static-links.test.js:48`, `tests/static-links.test.js:49`.
The fixture makes index.html a link to the outside directory. The original handler already returns 404 because readFile cannot read that directory. This never proves that a readable outside index file is refused.
See it: run both new root and client-route assertions against the static handler from `f98cf45b` with this same fixture. Both pass. An inline probe confirmed this with a real Windows junction.
Fix: link the index to a readable outside HTML file and verify that the old handler serves its marker while the new handler refuses it. Mark an unsupported file-link setup explicitly.

## Checks without another finding

- P509 compares lane, brief ids and project kind before opening the log. A saved empty brief branch matches only a successful detached-branch read; a failed git read returns null and is refused. Project queues retain their own branch check.
- P509 collects exact child credentials only at eight characters or more. Hermes exports and tool previews use the masking path. R53-1 concerns the streamed exact-value scrubber.
- P509 separates a torn record tail under the append lock and releases that lock in finally. The port takeover guard covers acquisition and stale removal. Source review found no additional permanent lock hold; R53-5 concerns its test.
- P510 now fails a check after its deadline and bounded pipe wait even when cleanup fails. The project check runner inherits its handles and has no private output pipe to keep its close event pending.
- P511 uses guarded storage and boundaries that show the fault message. The top boundary offers Reload. These contain render and effect faults; they do not claim to catch event handlers or rejected requests.
- P512 rejects older conversation and Reviews answers, including errors, and invalidates them on client or selection changes and unmount.
- P513 preserves dirty settings on background notices and unrelated saves, apart from R53-4.
- P514 checks real roots and targets, folds Windows path case, serves the resolved file and restricts music extensions. Normal files and outside junctions passed the focused tests. R53-6 concerns index fallback coverage.
- P515 keeps log, project, worktree, folder, path and cwd whole for the conversation reader while masking display text. Review patches are masked before truncation. MCP restoration has R53-3.
- P516 re-reads endpoints after model fetching, preserves another endpoint and refuses a changed or deleted target. Probe-folder creation is inside the slot-release finally path. Their focused regression tests passed.

No browser layout, real provider, real harness session or live Windows pid-reuse experiment was run. Screen checks remain with the orchestrator. Known sandbox baseline failures are excluded from findings.

Checked and fine
