# Review 9: the merges since the last push

Date: 2026-11-11
Scope: `origin/main` at `4425cf40` to `main` at `83a190d1`, first-parent merges `P24` (`54c5f963`), `P25` (`9bde5cc0`), `P26` (`d93f09e5`), `P27` (`d5ce7def`), `P29` (`83bc21cb`), `P30` (`569b078b`), `P31` (`d9492ed3`), `P32` (`4b15ca92`), `P33` (`14c2eec0`) and `P35` (`aade22c9`). `P19` (`bb725e18`) is already on `origin/main`, outside that range; its diff was read too.

## Findings

| # | Severity | File:line | The case and what goes wrong | Smallest fix |
| --- | --- | --- | --- | --- |
| 1 | High | `scripts/policy-propose.mjs:83` | The policy proposer builds its table as `outcomeTable(runs, outcomes)` without the main commit subjects. `outcomeTable` only counts an ungraded merge when its third `subjects` argument is passed (`server/outcomes.js:79`), and `run-lane --outcomes` passes `readMainSubjectsSync()` (`scripts/run-lane.mjs:708`) while `policy-propose` does not. Every run that main merged with no outcome row still reads as `pending`, so the merge rates and the reorder suggestions are computed from the graded subset, which is the bias P29 set out to remove. | Import `readMainSubjectsSync` and pass it as the third argument, then add a test with a run merged on main and no outcome row that `proposePolicy` sees as merged and ungraded. |
| 2 | High | `server/index.js:697-713` | `publishTree` computes only `addedPaths` and advances `treeClientVersion` even when a path left the list. A delete, or the old half of a rename, produces no `tree` event. The page's `addFiles` (`src/live/livePlayer.js:18-24`) only adds, so the removed path stays in the room until a full reload; a same-length rename sends only the new path and leaves both names. Proved with a real bridge: after `["a.js","b.js"]` became `["a.js"]`, the SSE stream stayed empty. | Send the removed paths with the event and delete them in `livePlayer`, or send a whole tree and rebuild the player's file map. Add a bridge test that a deletion reaches the stream. |
| 3 | Medium | `server/opencode-sessions.js:95,150-166,405-407` | `knownRows` only grows. `sessionRows` adds every row it sees and never deletes one, and `scan` rebuilds `includedSessions` from the whole map. A session deleted from `session_v2` stays in `knownRows`, is re-added to `sessions` after `forgetFinished` (`:448-465`), and can reappear in the room; the map also grows for the life of the bridge. | Rebuild `knownRows` from a full `sessionStmt.all()` on a timer or when the DB file changes, drop ids the DB no longer returns, and cap the map. |
| 4 | Medium | `scripts/merge-lane.mjs:519-523` | `finishMerge` runs `git add -u` and `git add docs/agents/`, so every tracked change and every untracked file under `docs/agents` in the main checkout is folded into the merge commit, not just the merge and the changelog line. A review doc another process wrote between `merge-lane` and `--finish` is committed to main. | Stage the merge's own changed files (read `git diff --cached --name-only` after the merge) plus `docs/agents/CHANGELOG.md` and the brief files only. |
| 5 | Medium | `server/index.js:369-375`, `server/policy.js:57-72,92-94` | `createPolicyApi` gets no `runsFolder`, so `/api/control/route/lane` reads costs from `defaultRunsFolder()` and `laneStatesFor` reads `<default>/<lane>.lock`. The bridge's runs folder is `options.runsFolder ?? options.orchestratorFolder ?? lanesSource.folder ?? runsFolder()` (`server/index.js:496`). When those differ (an embedded bridge or a test), the Auto preview can call a busy lane free or use the wrong spend. | Pass the same runs folder into `createPolicyApi`, computed before it or as `options.runsFolder ?? options.orchestratorFolder`. |
| 6 | Medium | `server/policy.js:104-115`, `server/runs.js:691-703` | The new lane route reads `<project>/docs/agents/lanes.json` through `readLaneConfig`, while a project task run starts from `laneFile`, which is `docs/agents/lanes.json` of the MachineRoom checkout unless `options.lanesFile` is set. A room whose project has its own lanes file can preview a lane the start path does not know, or preview a different route from the one the start takes. `createPolicyApi` is given `lanes: () => lanesSource` at `server/index.js:374` and never uses it. | Use the bridge's lanes source or the same lane file in `readLaneConfig`, not the project's copy. |
| 7 | Low | `src/ui/sound.js:385-404`, `src/Stage.jsx:1240-1246` | `activitySounds` runs after `apply` has set `exists: true` on a write, so its `exists` check cannot see a new file. The live path compensates by adding new paths to `missing` in `noteNewFiles` before the push, but the replay path has no `noteNewFiles` and starts `knownSoundRef` from `tree.created`, which is empty in a live recording. A replay write to a new file sounds `write`, not `created`. Proved with `createState`, `apply` and `activitySounds`: the kind was `write`. | Track new paths for the replay too, or check the player state before `apply`; add a replay test for a created beep. |
| 8 | Low | `server/policy.js:57-72`, `server/runs.js:721-730` | When no active-lanes choice exists, `laneStatesFor` makes `activeSet` empty, so every lane is inactive. The Dispatch picker offers `Auto` anyway (`src/ui/panels/DispatchPanel.jsx:526`), and the route answers 409 `Every lane is busy or turned off.` instead of the manual path's `Pick the lanes for this project first.` | Treat `saved === null` as all lanes active, or return the manual refusal for a room with no choice. |
| 9 | Low | `scripts/merge-lane.mjs:344` | Changed paths from the merged branch are passed straight after `vitest related --run`. A path that starts with `-` is parsed as a vitest option, so a branch can change what the check runs, or fail it, with a file name. | Insert `--` before `...changedFiles`, or prefix each path with `./`. |
| 10 | Low | `scripts/merge-lane.mjs:489-495,532-534` | The changelog line is checked for an em dash and a line break, but the commit subject and `--trailer` are only trimmed. A subject with an em dash breaks the house rule; a subject or trailer with a newline injects extra commit message lines. | Check `subject` and `trailer` with the same em dash and `[\r\n]` test as `line`. |
| 11 | Low | `server/opencode-sessions.js:155` | The incremental query uses `time_updated > highWater` and `highWater` is the maximum already seen. A session whose `time_updated` equals the current high-water mark, for example a child created in the same millisecond as its parent update, is never returned, so its row never enters `knownRows` and the room never shows it. | Use `>=` and skip ids already in `knownRows`, or query from `highWater - 1`. |
| 12 | Low | `server/lanes-source.js:626-632` | P30 moved the folder listing to a 2 second scan, but `tick` still runs every 200 ms and stats every quiet run, up to `QUIET_KEPT` 50. At rest that is up to 250 `statSync` calls a second for logs that are already finished. | Check a quiet run only when `pendingChecks` names its path, or move the stat loop into the 2 second scan. |

## Merge by merge

- `P19` (`bb725e18`, already on `origin/main`): `scripts/scale-live.mjs` adds the doctor read, the clean and dirty git states, the worktree add and reuse, the reviews list and a diff, and the plain folder read. The `.git` set-aside is restored in `readPlainFolder`'s `finally`, again before the final cleanup, and the worktree and branch are removed in the outer `finally`. No finding.
- `P24` (`54c5f963`): `src/model/folderView.js` keys each cached view on the folder version, the drawn children and the focus and touch marks, and caps items at 2000. `src/engine/cards.js` uses the `items` array identity and a lazily built row index. The key covers the inputs that change the rows, and no stale case was found.
- `P25` (`9bde5cc0`): the initial tree, the delta versions, the folder answer built once per version and the listener before the first read match the brief, but the delta has no removals (finding 2).
- `P26` (`d93f09e5`): the pipeline warms after the first frame, `learn` gets the touched paths and `dirSetFor` caches the folder set. The sound path keeps only created paths and loses the created kind in a replay (finding 7).
- `P27` (`d5ce7def`): `frameTimes` caps the room's animation at 0.1 second and the player at 1 second, and a hidden or empty dust layer is skipped. The material and geometry arrays line up. No finding.
- `P29` (`83bc21cb`): `outcomeTable` reads the main subjects and the ungraded merges, `--outcomes` passes them and the policy joins cut the model name to letters and digits. `policy-propose` was left behind (finding 1).
- `P30` (`569b078b`): the Claude meta listing follows the runs folder's change time, the OpenCode reader asks only for moved rows and the lane source scans every 2 seconds. The OpenCode row map is unbounded (finding 3), the equal-timestamp case is missed (finding 11) and the quiet runs are still stat'ed on every tick (finding 12).
- `P31` (`d9492ed3`): `routeLane` skips retired, turned-off and busy lanes and the actor helpers keep the main, sub and page rules of the old route. The policy API reads its own lanes and runs folder (findings 5 and 6), and Auto finds no lane before the owner picks lanes (finding 8).
- `P32` (`4b15ca92`): `peakTokens` is the largest input plus cache count of a step for Claude Code and OpenCode, the record carries it, `--list` prints it and `--stats` prints the median, the maximum and the count at or over 450,000. No finding.
- `P33` (`14c2eec0`): `merge-lane` refuses the right states, merges by sha, aborts on a failed check and records the outcome. The finish path stages too much (finding 4), passes paths as flags (finding 9) and does not check the subject (finding 10).
- `P35` (`aade22c9`): the archive is in the pack and the runtime reads, the archive cache follows its stamp, and `laneTaskState` adds an archived brief only when a run names an id that the current file does not hold. No finding.

## Proved and read

- Finding 1 was proved with a short script: `outcomeTable([run], [], [])` gave `merged 0, pending 1`; with a `0.1.401: Merge P1` subject it gave `merged 1, ungraded 1`.
- Finding 2 was proved with a real bridge on a temporary project: the first tree read `["a.js","b.js"]`, the next read `["a.js"]`, and the SSE stream received no tree event.
- Finding 7 was proved with `createState`, `apply` and `activitySounds`: after a write to a new file the sound was `write`, not `created`.
- Findings 3 to 6 and 8 to 12 were read against the code. No test in the repository covers the deletion delta (finding 2), the policy proposer's table (finding 1), the OpenCode row map (finding 3), the merge staging (finding 4), the replay created sound (finding 7) or the equal-timestamp case (finding 11).

## Proposed briefs

**P39. Make the policy proposer read the same outcome table as the room.**
1. In `scripts/policy-propose.mjs`, import `readMainSubjectsSync` from `../server/runs.js` and pass it as the third argument to `outcomeTable`, as `scripts/run-lane.mjs:708` does.
2. Add a test with a run that has a branch and a brief, no outcome row, and a `Merge P1` subject on main, and assert `proposePolicy` sees it as merged and ungraded.
Files: `scripts/policy-propose.mjs`, `tests/policy-propose.test.js`, `tests/outcomes.test.js`.

**P40. Let the room drop a deleted file.**
1. In `server/index.js`, compute the paths that left the file list in `publishTree` and send them with the tree event, or send the whole tree when the new list is not a superset, and do not advance a client's version past a change it did not receive.
2. In `src/live/livePlayer.js` and `src/Stage.jsx`, apply a removal to `state.files`, `state.dirs` and the folder plan.
3. Add a bridge test that a deleted file reaches the SSE stream and a live test that the room's file map loses it.
Files: `server/index.js`, `src/live/livePlayer.js`, `src/Stage.jsx`, `tests/tree-read.test.js`, `tests/live.test.js`.

**P41. Bound and refresh the OpenCode session rows.**
1. In `server/opencode-sessions.js`, rebuild `knownRows` from a full `sessionStmt.all()` on a timer or when the DB file changes, drop ids the DB no longer returns, and cap the map.
2. Query the incremental rows with `time_updated >= highWater` and skip ids already in `knownRows`, so a child created in the same millisecond as its parent is not lost.
3. Add a test with a deleted session and a same-millisecond child.
Files: `server/opencode-sessions.js`, `tests/opencode-sessions.test.js`.

## The orchestrator's corrections

Read back against the code on 2026-11-11. The review's own brief ids P39 to P41 were taken by then, so the fixes are P40 to P42.

- Findings 1, 5, 6, 8, 9, 10, 11 and 12 hold. Finding 1 is fixed by P40 with 9 and 10, findings 5, 6 and 8 by P41, and findings 3, 11 and 12 by P42.
- Finding 2 holds as written, but it is not a regression of P25: the page has only ever added files, and `architecture/LIVE.md` says so. A room that drops a deleted file changes what the owner sees, so it waits for the owner's yes. It is not High for a push.
- Finding 3 holds for the growth, which is bounded by the sessions the database has ever held. Before P30 every poll read every row, so a session no longer came back only once its row was gone; P42 restores that with a full read on a timer.
- Finding 4 does not hold as a defect. The helper refuses to prepare a merge on a checkout with uncommitted changes, and the orchestrator's small fixes and architecture lines between the two commands are meant to be in the merge commit, as the loop in `ORCHESTRATOR.md` says. The risk that another process writes under `docs/agents` in the main checkout in that window is accepted.
- Finding 5 holds only for an embedded bridge or a test: with no `runsFolder` option both sides resolve the same folder.
- Finding 7 holds and is left open: a replay sounds `write` where a live room sounds `created` for a new file.
- After this review P31 gained a fall back to this repository's `policy.json`, P39 gave a typed task its own tier, P34 moved the architecture detail and P37 gave cards move stamps; none of those is covered here.
