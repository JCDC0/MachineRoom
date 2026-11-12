# Review 22: last merges before the shutdown

Reviewed at `69b6da776c9393cccabaa326eed4f4df1567763b` on 2026-11-13.

Read each merge with `git show -m --first-parent`: P132 `b06c625e`, P138 `e74e9c86`, P142 `55ed7e00`, P143 `2bf33102`, P144 `c149fa89`, P145 `5a3ba672` and P146 `f1c1123f`. Followed their current callers, saved fields and tests. Assumed one owner, several lanes and a long running conversation.

| Finding | File:line | What goes wrong and when | Smallest fix | Blocks a push? |
| --- | --- | --- | --- | --- |
| 1. Some chat strings still skip masking | `server/orchestrator.js:2397`, `server/orchestrator.js:2452`, `server/orchestrator.js:1222`, `server/orchestrator.js:1228`, `server/orchestrator.js:1245`, `server/orchestrator.js:1272`, `server/orchestrator.js:1992` | Renaming a current or saved conversation stores the title directly. Restore also keeps the current title, compact rules and both summaries directly. A compaction report becomes a raw summary. A profile path or key in those fields survives in the chat file. Titles reach the session list and rules reach the chat answer. Synthetic profile paths confirmed the current title, rules and summary survive restore and save; a rename also stayed raw. | Apply `maskText` to these fields when accepting or restoring them, before any length cap. Mask the compaction report before assigning the summary. Cover rename and restore with a regression test. | Yes. Saved strings and page fields can expose private text. |
| 2. Roaming AppData paths are returned unchanged | `server/orchestrator.js:362`, `server/orchestrator.js:398` | `printedRunsFolder` chooses `%APPDATA%` for a path under the roaming folder. `PROFILE_LABELS` omits that label, so `maskProfilePaths` returns the original full path. This happens on a normal Windows profile even though its home folder is configured. A synthetic roaming path remained in a chat message and its saved file. | Add `%APPDATA%` to `PROFILE_LABELS` and test a roaming path in both the answer and the saved chat. | Yes. Chat masking leaves a normal profile path exposed. |
| 3. Other project output still prints full paths | `scripts/run-lane.mjs:309`, `scripts/run-lane.mjs:1033`, `scripts/run-lane.mjs:1610` | A missing project under a profile folder is printed in full. The top level catch only replaces the runs folder. A completed queue with `--worktree` also sends the raw worktree path to `formatQueueSummary`, which prints it. An isolated CLI dry run confirmed the missing-project error; a direct summary call confirmed the worktree path. P144 covers lock refusals and dry-run headings but leaves these routes open. | Mask project paths in the project-folder errors and pass `printedRunsFolder(target.path)` into the queue summary. Apply the same treatment to the adjacent non-directory and non-git project errors. | Yes. Run output still exposes profile paths. |
| 4. A growing conversation closes its own menu | `src/ui/sidebar.js:151`, `server/orchestrator.js:2546`, `src/ui/Sidebar.jsx:521` | Current-row identity includes `startedAt`, but the bridge derives it from the oldest retained message. When message 201 arrives, the 200-message cap removes that message and changes the identity. The menu lookup then loses the row and closes the menu while the owner uses it. This was reproduced with a fixed title and one added background report in the same conversation. | Give the current conversation a stable identity that changes on new, open and fork, and keep it independent of the rolling message list. Test adding a report at the cap while the menu is open. | No. It interrupts menu use but does not move an action to another conversation. |

The masking findings include gaps in surrounding code that P132 and P144 leave open. They are not all new lines in those merges.

## Other checks

- P132 masks work-step and restored agent strings before their caps. Unknown restored sub and agent senders are checked against known identities.
- P138 uses the shared holder-start-time check for the runner and child. Inline assertions passed for a reused Windows pid, a live runner, a live child after its runner died, and one process-list read per check batch. Read the quiet-run finish path and the runs-route busy flag.
- P143 preserves a real list around prose apostrophes and ignores lists in backtick and tilde fences. Three inline assertions passed. Followed the list into brief validation, review scope and runner commit selection.
- P145 shares the pending check and rechecks stopped, running, paused and pending state before starting a turn. Read failure, timeout and close cleanup paths. No additional confirmed turn-start or concurrent-check finding.
- P146 has real failure conditions. The tree test asserts the exact ten partial reads before the full read. The git test waits for the first switch to enter its runner and asserts two write refusals before releasing it. A missed start fails by the test timeout. Read the slow merge-check timer and request assertions too.

## Verification limits

Three inline Node assertion commands passed. They used synthetic paths and temporary folders, which were removed. The targeted Vitest command could not start because this worktree has no `node_modules/vitest/vitest.mjs`. No Vitest test ran, and no test file changed. Suite totals before and after are unknown. No build or full suite was run. The browser menu check and checks under real shared-machine load remain with the orchestrator.

Only this audit file was changed. No code, changelog, branch or commit was changed. The runner owns the branch and commit.
