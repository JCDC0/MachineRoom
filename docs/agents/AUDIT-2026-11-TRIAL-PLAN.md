# ulolTris trial plan audit

Checked against HEAD `1a0d6f81`. This is a code review, not a trial run on ulolTris.

| Claim | True or false | Code | Correction for a false claim |
| --- | --- | --- | --- |
| `up` turns on lanes and sessions. | True | `bin/machine-room.mjs:218`, `bin/machine-room.mjs:222` | Sessions are on by default, but `--no-sessions` turns them off. |
| An empty check command uses `npm test` when the project has that script. | True | `scripts/run-lane.mjs:599`, `scripts/run-lane.mjs:671` | The script must be a non-empty string. |
| Dispatch sends one task with Own worktree through the queue runner into `PROJECT\.worktrees\LANE` and adds `/.worktrees/` to the git exclude file. | True | `src/ui/panels/runs.js:491`, `server/runs.js:797`, `scripts/run-lane.mjs:1387`, `src/briefs/run.js:288`, `scripts/run-lane.mjs:497`, `scripts/run-lane.mjs:512` | The exclude file is in the repository's common git directory, which is `.git\info\exclude` for a normal main checkout. |
| The runner junctions `node_modules` into the worktree. | False | `scripts/run-lane.mjs:479`, `scripts/run-lane.mjs:542` | If the project's `node_modules` exists and the worktree has no entry there, the runner links it with a Windows junction. Otherwise it leaves the existing entry alone or makes no link. |
| A dirty project refuses a Dispatch start even with Own worktree. | True | `src/ui/panels/runs.js:491`, `server/runs.js:1323`, `server/runs.js:1395`, `src/briefs/run.js:825`, `src/ui/panels/DispatchPanel.jsx:882` | This is the Dispatch queue path. A direct single-task CLI run with `--worktree --allow-dirty` takes a different path and can allow a dirty project (`scripts/run-lane.mjs:1163`, `scripts/run-lane.mjs:1388`). |
| A reused worktree with uncommitted changes or commits not in the project's HEAD refuses to start. | False | `scripts/run-lane.mjs:361`, `scripts/run-lane.mjs:464`, `scripts/run-lane.mjs:525` | The runner refuses uncommitted worktree changes except `node_modules` entries. It refuses commits absent from the project's HEAD only when the worktree is detached. A clean worktree on a named branch is detached at the project's HEAD even if that branch has extra commits; the branch still retains those commits. |
| Reviews merges with `--ff-only`. | True | `server/reviews.js:574`, `server/reviews.js:614`, `server/reviews.js:624`, `server/reviews.js:743` | This applies to another project such as ulolTris. Reviews uses `--no-ff` for MachineRoom's own checkout (`server/reviews.js:465`, `server/reviews.js:507`). The project status check excludes untracked files (`server/reviews.js:587`); Git can still refuse a merge that would overwrite one. |
| The queue branch is named `machineroom/queue-LANE-STAMP`. | True | `scripts/run-lane.mjs:39`, `scripts/run-lane.mjs:1182`, `scripts/run-lane.mjs:685`, `src/briefs/queue.js:109` | The stamp includes milliseconds. |

## Steps and guarantees the room cannot provide today

- A single Check command cannot chain `npm test` and `npm run build` with shell operators. The room does not verify that `game.js` matches the source (`src/briefs/run.js:321`, `scripts/run-lane.mjs:671`). The lane can be asked to run the build, but the owner must verify that it did.
- The queue's automatic commit does not enforce ulolTris's version or commit message rule. It takes the first line of the task as its subject and adds a footer (`src/briefs/queue.js:33`, `src/briefs/queue.js:139`).
- The room does not provide the planned interactive gameplay check on port 8123. The owner must start and inspect the game. The runner tries to stop leftover worktree processes after a run (`scripts/run-lane.mjs:150`, `scripts/run-lane.mjs:1831`).
- Dispatch cannot start this worktree queue from a dirty project. It hides the dirty override for Own worktree (`src/ui/panels/runs.js:499`, `server/runs.js:1395`, `src/ui/panels/DispatchPanel.jsx:882`).
- Reviews cannot automatically rebase or merge a diverged external project branch. It refuses a non-fast-forward; Ask to prepare can request help (`server/reviews.js:614`, `src/ui/panels/ReviewsPanel.jsx:470`).
- Reviews cannot discover every orphan worktree. It enumerates configured lanes (`server/reviews.js:779`).
- A fresh bundled configuration has no pre-built code lane, so the owner must add one (`config/lanes.json:1`).
- The confirmation cannot state the exact location and base accurately: it calls the worktree beside the project and says never on main, while the path is inside the project and starts at its current HEAD (`src/ui/panels/DispatchPanel.jsx:1063`, `src/briefs/run.js:288`, `scripts/run-lane.mjs:517`).
- The plan's guarantee that any reused worktree with unmerged commits refuses to start is not available for a named branch. Inspect the lane worktree and branch before reuse (`scripts/run-lane.mjs:529`).
