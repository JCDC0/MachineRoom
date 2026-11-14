# Lowbeam trial and move

This is a plan, not a trial run. Lowbeam was read on 2026-11-14 at `main` 2a58f96. The owner chose MachineRoom lanes and Reviews for Lowbeam. Keep the play worktree and port 8041. Do not remove or reuse an old worktree until its owner has looked at it.

## Old worktrees

`git log --oneline main..BRANCH` counts commits by ancestry, not by equivalent work. Each worktree was clean in `git status --porcelain`; this does not inspect ignored files. Lowbeam's task guide says the six jobs were merged, and `main` has matching subjects under different hashes. These are evidence of copied or completed work, not proof every patch is identical. The shared WIP commit appears on five branches.

| Worktree | Branch `machineroom/queue-` plus | Commits not in main | Assessment |
| --- | --- | ---: | --- |
| agy | `20261024-211936` | 2 | W-01 street grade plus the junction WIP. Main has W-01 at 62f4f78 and completed junctions at fe54867. Looks superseded. |
| ccc | `20261024-211924` | 2 | Junction WIP and its finish. Main has the finish at fe54867. Looks superseded. |
| hermes | `20261024-211928` | 2 | B5 resupply WIP and its finish. Main has the finish at 5b5cfd9. Looks superseded. |
| oc5 | `20261024-211940` | 1 | HUD counts. Main has the same subject at e77a9b5. Looks superseded. |
| oc6 | `20261024-211944` | 2 | R-03 zebra crossings and junction WIP. Main has R-03 at 0adabe6 and the junction finish. Looks superseded. |
| opencode | `20261024-211932` | 2 | X-03 GPS turn cost and junction WIP. Main has X-03 at 91fc502 and the junction finish. Looks superseded. |

All six need the owner's look first: compare their patches and ignored files against main, especially the shared WIP and the two B5 commits. Preserve any still-wanted work on a named branch before removing a worktree. The separate `agy/b6-earn` branch named in the guide is not the agy worktree's current branch; do not delete it. Nothing here establishes that B6 is finished.

From the MachineRoom checkout, list the worktrees:

```powershell
npm run worktrees -- --project C:\GitHub\Lowbeam
```

The list checks ancestry, ahead count, changes and ignored files. Its `--clean` option removes only clean, merged, idle worktrees with no disallowed ignored files (`scripts/worktrees.mjs:157`, `scripts/worktrees.mjs:243`, `scripts/worktrees.mjs:302`). These six are ahead by ancestry, so it will not remove them just because equivalent work exists on main. After the owner has compared and explicitly decided a clean worktree is disposable, use Git's non-force removal for that specific path, for example:

```powershell
git -C C:\GitHub\Lowbeam worktree remove C:\GitHub\Lowbeam\.worktrees\oc5
```

Repeat only for individually approved paths. Do not delete branches as part of cleanup. If Git refuses, inspect the reason and keep the worktree; do not force it. Reviews lists configured lanes, not every orphan (`server/reviews.js:779`).

## Replace the old guide rules

These are proposed edits for the owner or a first lane. Line numbers below refer to Lowbeam's two guides, not MachineRoom. Preserve the other design and verification rules.

| Old location and sentence or passage | Replacement |
| --- | --- |
| `ARCHITECTURE.md:6-10`, desktop overseer is sole merger, each agent has its own fixed seat and CCC owns the repo | MachineRoom's lanes work from briefs in their own project worktrees. The owner reviews their branches in MachineRoom and merges them into `main` through Reviews. Each brief names its files. |
| `ARCHITECTURE.md:49-58`, overseer sets versions and owns main, tests branches and fast-forwards | Each task names its version, changelog and guide updates. Work in the lane's worktree and branch. The owner reviews the result and uses Reviews to fast-forward `main` after the checks and visual review. |
| `ARCHITECTURE.md:86-87`, fixed `your port` | `npm start` serves `main` on 8040. To inspect a lane, run `node tools/devserver.mjs <free port>` from that lane's worktree and open that port. |
| `ARCHITECTURE.md:92-100`, overseer owns 8040, fixed agent ports and old `Lowbeam-play` path | Port 8040 serves `main`; 8041 is Jc's play port. Use a free port other than those for a lane and stop its server after inspection. The play worktree is `C:\GitHub\Lowbeam\.worktrees\play`; check its state and hooks before relying on automatic updates. |
| `tasks/README.md:3-6`, CCC owns the repo and overseer tests every branch | Read this and the guide before touching a file. Each brief names the files its lane may change. The owner checks the lane's result before Reviews merges it to `main`. |
| `tasks/README.md:12-20`, fixed overseer, workers and version ranges | The owner chooses the work and the MachineRoom lanes. A task names its scope and version. Ask the owner when a version or scope is unclear. |
| `tasks/README.md:24-38`, fixed ownership and overseer updates versions on merge | Each task names its files, tests, version and changelog entry. The lane includes any required version and guide updates in its branch. The owner reviews those updates before merging. |
| `tasks/README.md:112-131`, fixed overseer, worktrees, ports and manual branch creation | MachineRoom creates or reuses `.worktrees/<lane>` and creates a task branch from the project's current branch. Keep `main` checked out and clean. Choose a free inspection port other than 8040 or 8041. |
| `tasks/README.md:133-137`, fixed folders and overseer for dependencies | Work and test in the lane's worktree. Ask the owner about missing dependencies. Read reference images from the project when needed. |
| `tasks/README.md:138-148`, manual rebase, commits, report and overseer scratch review | Run the task's checks and report the result. The owner reviews the branch and its checks in Reviews. If `main` has moved, prepare the branch against `main`, rerun checks and review it again before merging. |
| `tasks/README.md:149-153`, overseer tests the reported hash and alone fast-forwards | Report the branch, checks, observations and limits. The owner inspects the same result and confirms the fast-forward in Reviews. |

The old seat-specific rows and old folder table are historical, not current assignments. The project has no automatic version bump in the external-project merge path (`server/reviews.js:574`, `server/reviews.js:624`); the owner must choose and review that work explicitly. The queue makes its commit subject from the first task line and adds its own footer, so it does not enforce Lowbeam's version, trailer or changelog rules (`src/briefs/queue.js:33`, `src/briefs/queue.js:139`).

## Open and configure

Build MachineRoom first if needed, then from its checkout:

```powershell
npm run build
```

```powershell
npm run serve -- up --root C:\GitHub\Lowbeam --open
```

`up` enables lane and session sources (`bin/machine-room.mjs:215`). In the family tree add code lanes `codex` and `opencode2`, each using the owner's corresponding installed harness and subscription. These names do not collide with any of the seven existing Lowbeam worktree names above, even if all are kept. Add only subscriptions the owner actually uses. New lanes are made in the family tree (`src/ui/panels/AgentBuilder.jsx:6`); the bundled file starts with only the orchestrator (`config/lanes.json:1`).

Keep Lowbeam on `main` and clean. Dispatch a single small task with **Own worktree**, one lane at a time. The path is `C:\GitHub\Lowbeam\.worktrees\<lane>`, and the queue branch starts from the project's current HEAD (`src/briefs/run.js:288`, `scripts/run-lane.mjs:517`, `server/runs.js:797`). Dispatch refuses a dirty project for this path (`server/runs.js:1395`, `src/ui/panels/DispatchPanel.jsx:882`). The confirmation currently calls the worktree beside the project and says never on main; that wording is inaccurate (`src/ui/panels/DispatchPanel.jsx:1063`). Do not reuse the six old names: a clean named branch with unmerged commits can be detached for reuse (`scripts/run-lane.mjs:525`).

## Checks and merge

In Dispatch set **Check command** to `npm test`. An empty field also falls back to `npm test` when the project has a nonempty test script (`scripts/run-lane.mjs:599`). Ask the lane in the task to run `npm run check` too, and inspect its output. Before merging, the owner independently runs `npm run check` in that lane's worktree and confirms both results on the same head. The room runs one check command without a shell and rejects `&&`, `;` and other shell operators (`src/briefs/run.js:321`, `scripts/run-lane.mjs:647`). It cannot automatically guarantee both checks with the present Lowbeam scripts. A later task could add one npm script for both; this plan changes no Lowbeam file.

When the run finishes, open Reviews, select the lane and read its diff, check state and branch. Inspect the game as below. Choose Merge and confirm (`src/ui/panels/ReviewsPanel.jsx:480`, `src/ui/panels/ReviewsPanel.jsx:515`). Reviews uses the project's current branch, so first verify it is Lowbeam `main`. It checks the destination's tracked changes, lane cleanliness, head and known failed check, and requires `main` to be an ancestor of the lane head before `git merge --ff-only` (`server/reviews.js:574`, `server/reviews.js:587`, `server/reviews.js:599`, `server/reviews.js:614`, `server/reviews.js:624`). Untracked files are excluded from the destination status check, though Git can still refuse to overwrite one. A non-fast-forward needs preparation and another review; Reviews does not rebase automatically (`src/ui/panels/ReviewsPanel.jsx:509`). Unknown checks are not proof of a pass (`server/reviews.js:605`).

## See the change

After the run has ended and before merge, start a server yourself in the lane worktree, using a free port such as 8050:

```powershell
Set-Location C:\GitHub\Lowbeam\.worktrees\codex
```

```powershell
node tools/devserver.mjs 8050
```

Open `http://localhost:8050`, check the task's behavior, then stop that server. Replace `codex` with the actual lane. Do not use 8040 or 8041 for this preview. MachineRoom does not provide this interactive game check and tries to stop processes left in the worktree after a run (`scripts/run-lane.mjs:1831`).

## Three first tasks

Pick one at a time. These are bounded proposals from Lowbeam's open work, not claims that the files or acceptance criteria have already been verified against Lowbeam code. Each brief must name its version, guide and changelog work as needed.

1. **B6 pure earned nitrous.** Lowbeam's task guide names `src/vehicles/nitrous-earn.js` and `tests/nitrous-earn.test.mjs` for the pure module (`tasks/README.md:14`, `tasks/README.md:27`, `tasks/README.md:63`). Ask for the pure earning rules and tests only; leave Drive wiring for later. Owner checks the rules and tests, with no claim that the game already uses it.
2. **Built-in track vocal flags.** Open work says the Japanese tracks need vocal flags (`ARCHITECTURE.md:475-479`); propose `assets/music/tracks.json` and an appropriate music test if needed. Ask the lane to identify the actual vocal tracks from existing evidence and report uncertainty, not guess. In Settings, inspect the labels and vocal filter on 8050.
3. **Music player gamepad focus.** The task guide leaves gamepad focus for later (`tasks/README.md:59`). Start with focus movement among existing music controls; proposed files are `src/ui/music-panel.js` and its relevant tests. The lane must report if it needs more files. On 8050 use a gamepad to move focus and operate one control.

For each: the Dispatch confirmation should identify the lane and check; after starting, the agent should show work and file touches as reported by its harness (`src/ui/panels/DispatchPanel.jsx:593`, `src/model/state.js:213`, `src/model/state.js:225`). Open the lane conversation for its output (`src/ui/LaneConversation.jsx:118`). At completion inspect the check result and Reviews diff (`src/briefs/queue.js:128`, `src/ui/panels/ReviewsPanel.jsx:594`); after approval Reviews should report the merge (`src/ui/panels/ReviewsPanel.jsx:398`). A failed task, missing evidence for a vocal flag, a failing Lowbeam test, or a game defect is not by itself a MachineRoom failure. A wrong worktree or base, missing or false run/check result, incorrect diff, unsafe merge, or refusal inconsistent with a clean eligible branch is a room failure; save the run details and stop before merging.

## Limits to observe

The room cannot prove the six old branches are equivalent to main or remove them as merged based on equivalent patches (`scripts/worktrees.mjs:252`). It cannot identify all orphan worktrees in Reviews (`server/reviews.js:779`), safely protect unmerged commits in a reused clean named worktree (`scripts/run-lane.mjs:525`), start this Dispatch path on a dirty project (`server/runs.js:1395`), show the exact path and base correctly in the current confirmation (`src/ui/panels/DispatchPanel.jsx:1063`), run two independent checks in one check field (`src/briefs/run.js:321`), enforce Lowbeam's version and trailer policy (`src/briefs/queue.js:33`), do the interactive game or gamepad review, or automatically rebase a diverged branch (`server/reviews.js:614`). The owner must do those steps or assign separate work. The room's merge check only blocks a known failed check, so verify both commands and the inspected head yourself (`server/reviews.js:605`).
