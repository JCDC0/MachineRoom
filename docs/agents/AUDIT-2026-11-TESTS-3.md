# Test audit 3, November 2026

Read `git log 2cff726b..HEAD`: the merges of P526 to P555 that changed source or tests.

## Method

The first run was lost when the computer shut down, and the checks were done again. A whole-fix undo (`git apply -R` of a merge's source files) failed on most merges, because later briefs changed the same lines, and a half-applied undo broke imports and gave false failures. So the proof is per hunk. For each merge, a script took the source diff of the merge against its first parent, cut it into zero-context hunks, skipped imports, comments and braces, and for the largest hunks (2 to 8 per brief) it undid one hunk at a time, ran the brief's own test files, and restored the files with `git checkout`. No source file was left changed.

Limits of the proof:

- A hunk undo can break the syntax or leave a name undefined. A failure like that only shows the test loads the file. It is not an assertion proof. A fail is solid only when the test names an assertion.
- A `-` hunk and its `+` twin often form one moved block. When one of the pair fails and the other passes, the pair is treated as caught.
- STALE means the hunk no longer reverses cleanly because a later brief rewrote the lines.
- Only the largest hunks per brief ran. A small hunk that is not listed was not tried.
- Test files are the ones the merge changed. A test in another file that covers the same code was not run, except where named.
- The "what the test checks instead" column comes from the failing and passing test names and the hunk, not from a full read of each test. Read the test before you apply a fix.
- No full suite, no browser.

## Findings

Every finding is a fix hunk undone with the brief's test files still green.

| Id | Brief | Test file and name | Source lines undone | What the test checks instead | Fix to the test |
| --- | --- | --- | --- | --- | --- |
| T3-1 | P533 | `tests/bridge-routes.test.js`, the run route tests (`reads a run conversation from its record and log`) | `server/runs.js`: `const folder = realPath(recordsDir())`, `const path = realPath(join(folder, name))` and the `lockedLog` `matchesLockStart` line of `runLogInside` | Nothing puts the log under a redirected (junction or symlink) app folder, which is the P533 case. The tests pass with the real path calls undone. | Link a folder to the runs folder, put the record's `log` path through the link, and expect the conversation to open. Skip where the OS refuses to link. |
| T3-2 | P543 | `tests/bridge-routes.test.js`, `refuses ambiguous recovered logs unless the record or matching lock names them` | `server/runs.js`: `if (!item.logPath) item.logPath = findRunLog(folder, item.entry)` | The fallback call can go and the tests still pass: no test has a record with its own log path beside a newer log that would match the lane. | Add a record whose `log` names a file, and a second newer file that matches the lane, and expect the named file to open. |
| T3-3 | P529 | `tests/layout-css.test.js`, `the transport state word and the spend` | `src/styles.css`: the `.transport-orchestrators > .transport-orchestrator` block (82 lines) and the `.transport-lane:hover` block (33 lines) | The file reads a few selectors only: position, state word colours and the scroll rule. The grid and the hover are not read. | Read `display`, `grid-template-columns` and the hover colour of those two selectors with the helper the file already uses. |
| T3-4 | P528 | `tests/model-context-window.test.js`, `reported context windows` | `server/endpoints.js`: `if (Array.isArray(fetched.modelDetails)) {` | The tests give the fetch a well formed array. An answer with no `modelDetails` or a non array is not tried, which is what the guard is for. | Add a fetch stub that answers `{}` and one with `modelDetails: 'x'`, and expect the endpoint to keep its old details. |
| T3-5 | P528 | `tests/lane-tasks.test.js`, `reads a Codex rollout into a live lane` | `server/lanes-source.js`: `if ([...active.values()].some((run) => now() - run.contextCheckAt >= 2000)) {` | The test waits for the first read and never asks for a second read inside two seconds, so the throttle can go without a failure. | Read twice 500 ms apart on a fake clock and expect one file read, then a third read after 2000 ms and expect two. |
| T3-6 | P530 | `tests/lane-conversation.test.js`, the lane picker tests | `src/ui/LaneConversation.jsx`: `if (options.length === 0) return` | Every test gives the view at least one run. The empty case is not drawn. | Render the view for a lane with no runs and expect no picker and no crash. |
| T3-7 | P535 | `tests/git-tree.test.js`, `tests/void.test.js` | `src/engine/room.js`: `return gitTree.setState(state)` | The tests drive the git tree and the void directly. Nothing checks that the room hands its state to the git tree. | Build the room with a stub git tree and expect `setState` to be called with the state. |
| T3-8 | P539 | `tests/room-notice.test.js`, `run-end room notices` | `src/styles.css`: the `.mr-orch-line.is-run-notice` block (18 lines) | The tests read the summary text and the Details fold. The style that keeps the notice to one line is not read. | Read `white-space` and `overflow` of `.mr-orch-line.is-run-notice` from the stylesheet. |
| T3-9 | P540 | `tests/lane-conversation.test.js`, `tests/lane-send.test.jsx` | `src/ui/LaneConversation.jsx`: `const sendToRunning = onRecipientSend ? recipientRunning : running`; `server/orchestrators.js`: `const delivered = receiveLaneMessage(laneTarget, sender, text, clock(), identity)` | The test that rejects a message for a previous run is caught. The case where the viewed run has ended and a newer run is live, and the delivery time, are not asserted. | Show a lane whose viewed run ended and whose newer run is live, send, and expect the message to reach the live run. Expect the stored time to equal the fake clock. |
| T3-10 | P541 | `tests/lanes-source.test.js` | `server/lanes-source.js`: `contextAssistant: false,` | The assertion is about cumulative results against assistant usage. The starting `false` is not read. | Assert `contextAssistant` is `false` before any assistant line. |
| T3-11 | P542 | `tests/model-context-window.test.js`, `retries a partial detail with context length null after the delay` | `server/endpoints.js`: `failed.set(endpoint.name, Date.now() + 600000)` | The test covers the partial answer retry. The ten minute wait after a failed fetch is not pinned. | Fail a fetch, advance a fake clock 9 minutes, expect no second fetch, advance to 11 minutes, expect one. |
| T3-12 | P550 | `tests/sidebar-pins.test.jsx`, `tests/sidebar.test.js` | `src/ui/Sidebar.jsx`: the pin `<button` block (12 lines) and `src/styles.css`: `.mr-side .mr-side-pin` (11 lines) | The Hud half of the brief is caught. The one pin control in the sidebar is not pinned by a failing assertion. | Click the pin in the sidebar, expect the row to move and `aria-pressed` to flip. |
| T3-13 | P552 | `tests/layout-css.test.js`, `small control targets` | `src/styles.css`: the 4 line `width: 12px` hunk (the 32 line hunk is caught) | The test sweeps a hand written list of selectors for 24 pixel targets. A selector missing from the list is not swept. | Build the list from every button rule in the stylesheet instead of by hand. |

## Table of briefs checked

| Brief | Merge | Result |
| --- | --- | --- |
| P526 | 8d7037b3 | Caught. `readerAngles` and the roster-update test fail with the fix undone. |
| P527 | 1def4777 | Caught. Five source hunks fail named assertions; one styles hunk passes (its test was not run). |
| P528 | 8948c586 | Partly caught. T3-4, T3-5. |
| P529 | 5ba25ce2 | Partly caught. T3-3. |
| P530 | 82fa3ab9 | Partly caught. T3-6. |
| P531 | 6bcb2b37 | Caught. All four hunks fail. |
| P532 | 5449d02f | Not provable. All hunks stale: P543 rewrote the lines. See P543. |
| P533 | 6b2c5d01 | Not caught. T3-1. |
| P534 | 17f7b318 | Caught. The unknown harness test fails. |
| P535 | 327ca039 | Partly caught. T3-7. |
| P536 | a09d8e12 | Caught. The marks and rail tests fail. |
| P537 | 56d5d645 | Docs only. Nothing to check. |
| P538 | 34252865 | Caught. The token format tests fail. The `formatTokens` copies are duplicates. |
| P539 | db6dd2a7 | Partly caught. T3-8. |
| P540 | 987f35ce | Partly caught. T3-9. |
| P541 | bde06fd7 | Caught. T3-10 is a minor gap. |
| P542 | 1a8691ee | Partly caught. T3-11. |
| P543 | d33c7399 | Partly caught. The ambiguity tests fail; T3-2. |
| P544 | b9ede819 | Review brief. Docs only. |
| P545 | ee23b29d | Caught. |
| P546 | c192c754 | Caught. |
| P547, P548 | cdc947f7, 2482523c | Audit documents. No source. |
| P549 | 43972ab1 | Caught. The backup ticket and details tests fail. |
| P550 | f7f4d53c | Partly caught. The health chip fails; T3-12. |
| P551 | 16c5d84e | Caught. Needs you and the console colour fail. |
| P552 | 07f29234 | Partly caught. T3-13. |
| P553 | 66d41012 | Docs only. |
| P554 | cf461f21 | Review brief. Docs only. |
| P555 | d65d0633 | Caught. The Teams error and the family target height fail. |

## Checked and fine

- P526: `tests/reader-angles.test.js` and `tests/roster-update.test.js` fail on the undo with an assertion (the reader stays on the lane ray).
- P531: the orchestrator fetches model details on creation; undoing any call changes the call count the test pins.
- P534, P536, P538, P545, P546, P549, P551, P555: the largest hunk of each fails a named assertion, not only a load error.
- P527: the Plan line text and the lane recipient branch both fail named assertions.

## What this audit did not do

- Did not try every hunk. Small hunks were left.
- Did not run tests outside the files each merge changed.
- Did not change a test or a source file.
