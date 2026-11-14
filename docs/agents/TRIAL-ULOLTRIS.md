# Trial plan: ulolTris

Goal: give MachineRoom one real coding task on `C:\GitHub\ulolTris`, isolate it from other agents working in that repo, verify it with `ulolTris` tests and on port `8123`, and merge it cleanly.

## Before you start

Inspection of `C:\GitHub\ulolTris` showed four things to check first:

- `C:\GitHub\ulolTris` is currently clean, but its checked-out branch is `machineroom/queue-20261024-192349` (`9eaf25b`, `package.json` version `2.2.2`), which is 6 commits ahead of `main` (`27f0e89`). Decide whether to switch `C:\GitHub\ulolTris` to `main` first (or in `Projects -> Repository`) or base the trial on `9eaf25b`. MachineRoom branches new worktrees from the current `HEAD` and merges back into that checked-out branch.
- Two older clean worktrees already exist there: `.worktrees/opencode` and `.worktrees/opencode2`. Keep the repo clean, and avoid reusing a dirty worktree.
- `C:\GitHub\ulolTris\node_modules` must hold the Windows `esbuild` package (as `C:\GitHub\ulolTris\AGENTS.md` warns), because MachineRoom junctions that `node_modules` folder into the lane worktree.
- Fresh `config/lanes.json` only lists `orchestrator` (`Main`). If you have not saved custom code lanes in `%LOCALAPPDATA%\MachineRoom\runs\agents.json`, open the `Agents` tab in MachineRoom and add one code lane (`+` on `Main`, or `Build a team`) before opening `Dispatch`.

## 1. Command to open MachineRoom on ulolTris

From `C:\GitHub\MachineRoom` (PowerShell 5.1, so use `;` rather than `&&` if chaining commands):

```powershell
npm run build
npm run serve -- up --root C:\GitHub\ulolTris --open
```

`npm run build` must run at least once first so `dist/index.html` exists. `up` turns on `--lanes` and `--sessions` automatically and opens the live room URL in the browser. (If using the linked `machineroom` CLI directly, `machineroom C:\GitHub\ulolTris` runs `up --root C:\GitHub\ulolTris --open`.) Pass `--no-open` if you want to open the printed URL yourself.

## 2. Check command the room uses

Set `Check command` in `Dispatch` to:

```text
npm test
```

Leaving `Check command` empty also defaults to `npm test` because `C:\GitHub\ulolTris\package.json` defines `scripts.test` (`node tests/run.mjs`, which bundles every `tests/*.test.mjs` for Node with `esbuild` and runs without a browser). Entering `npm test` once saves it for the project.

Do not put `npm test && npm run build` in `Check command`. MachineRoom rejects shell operators (`&`, `|`, `;`, `<`, `>`, backticks, `$(`, `%VAR%`) there. Instead, tell the lane in the task prompt to run `npm run build` so `game.js` is updated before tests and commit.

## 3. Lane worktree vs. folder, and staying out of other agents' files

Run the task in a **lane worktree** (`Own worktree` checked, which is the default in `Dispatch`), never directly in `C:\GitHub\ulolTris`.

Why and how MachineRoom keeps out of other agents' files:

- Other agents already use separate worktrees under `ulolTris` (`.worktrees/opencode` and `.worktrees/opencode2`), and human or external sessions may use the repo. Editing directly in `C:\GitHub\ulolTris` would collide with their branches and working tree.
- With `Own worktree` checked, MachineRoom sends even a single task through the queue runner (`scripts/run-lane.mjs` and `src/briefs/queue.js`).
- The runner creates or reuses a detached worktree at `C:\GitHub\ulolTris\.worktrees\<lane>`, adds `/.worktrees/` to `C:\GitHub\ulolTris\.git\info\exclude`, junctions `node_modules`, and creates a branch named `machineroom/queue-<lane>-<stamp>` from `ulolTris`'s current `HEAD`.
- All edits and `npm test` runs happen inside `.worktrees\<lane>`. If that worktree already exists and has uncommitted changes or unmerged commits ahead of `HEAD`, MachineRoom refuses to start rather than overwrite it.
- On exit, the runner stops leftover child processes started inside that worktree (`stopLeftovers`).

Two caveats in current code:

- `C:\GitHub\ulolTris` itself must have a clean git working tree when you click `Start`. Even with `Own worktree` checked, MachineRoom refuses to start if `C:\GitHub\ulolTris` is dirty (and hides `Allow uncommitted changes`).
- Before you click `Merge` in `Reviews`, `C:\GitHub\ulolTris` must still be clean and not have moved ahead of the branch point, because `Reviews` merges with `git merge --ff-only`.

## 4. Three small candidate tasks from ulolTris open work

All three come from `Next steps, in order` in `C:\GitHub\ulolTris\AGENTS.md`. Remember to include in the prompt: rebuild `game.js` with `npm run build`, update `tests/` where listed, and follow `ulolTris`'s `<version>: <sentence>` commit format with a matching `package.json` version bump.

### Candidate 1: TETR.IO attack table option for Modern style (item 4)

- **Scope**: Add an attack table setting (`Guideline` default, `TETR.IO` option) used only by Modern scoring (`rules.attack`), leaving Classic untouched.
- **Files touched**:
  - `js/scoring.js`
  - `js/settings.js`
  - `js/settings-defs.js`
  - `js/game.js`
  - `tests/content.test.mjs`
  - `game.js` (rebuilt via `npm run build`)
  - `package.json` (version bump)
- **Check on port `8123`**: Run `npm run serve` in the worktree (or in `C:\GitHub\ulolTris` after merging) and open `http://localhost:8123`. In `SETTINGS`, switch the attack table to `TETR.IO`. Start `40 Lines` or `Blitz`, clear back-to-back or combo lines, and verify the attack numbers shown by the HUD and attack bursts match TETR.IO while `Guideline` keeps the existing numbers.

### Candidate 2: Prevent accidental hard drops setting (item 6)

- **Scope**: Add the boolean `prevent accidental hard drops` toggle so hard drop is briefly suppressed right after a piece locks or spawns, avoiding double hard drops on `SPACE`.
- **Files touched**:
  - `js/settings.js`
  - `js/settings-defs.js`
  - `js/input.js`
  - `js/game.js`
  - `tests/handling.test.mjs` and `tests/engine.test.mjs`
  - `game.js` (rebuilt via `npm run build`)
  - `package.json` (version bump)
- **Check on port `8123`**: Open `http://localhost:8123`, turn on the new toggle under `SETTINGS`, and start `40 Lines`. Hard-drop a piece and press `SPACE` immediately as the next piece spawns: the new piece should wait at the top instead of dropping at once. Turn the toggle off and verify `SPACE` responds right away again.

### Candidate 3: 180-degree rotation key (item 10)

- **Scope**: Add 180-degree rotation on key `A` (`dir` of `2` in `tryRotate`), a 180 kick table, an entry in `CONTROL_ROWS` (only for rules/modes or wherever controls list rotations), finesse support so a 180 press does not score extra faults, and a touch button.
- **Files touched**:
  - `js/piece.js`
  - `js/input.js`
  - `js/game.js`
  - `js/finesse.js`
  - `js/menu.js`
  - `js/touch.js`
  - `index.html`
  - `style.css` (if touch cluster layout needs adjustment)
  - `tests/finesse.test.mjs`, `tests/menu.test.mjs`, `tests/touch.test.mjs`, `tests/engine.test.mjs`
  - `game.js` (rebuilt via `npm run build`)
  - `package.json` (version bump)
- **Check on port `8123`**: Open `http://localhost:8123`. Check `CONTROLS` in the main menu to see the 180 key listed. Play a game and press `A` on `T`, `L`, `J`, `S`, `Z`, and `I` pieces (including near walls) to confirm clean 180 flips. Enable touch controls on a narrow viewport and tap the 180 button.

## 5. What the room should show at each step

1. **Startup**: The 3D room loads connected to `C:\GitHub\ulolTris`. Configured code lanes sit idle in the room. `Projects -> Repository` shows `C:\GitHub\ulolTris` on its current branch (`machineroom/queue-20261024-192349` or whatever branch you switched to), with a clean tree.
2. **Dispatch form**: Pick one active code lane, leave `Own worktree` checked, enter `npm test` in `Check command`, and paste the task prompt. Clicking `Start` shows the confirmation notice naming `ulolTris/.worktrees/<lane>` and `npm test`.
3. **While the lane works**: That lane's character animates as working, file paths from `.worktrees\<lane>` are rewritten to repo-relative paths in the room feed, and live tool/step updates appear without modifying files in `C:\GitHub\ulolTris`.
4. **Test check and commit**: After the coding tool exits, MachineRoom runs `npm test` in `.worktrees\<lane>`. If edits remain uncommitted and tests pass, `runQueue` commits them with `git add -A` onto `machineroom/queue-<lane>-<stamp>`. Run records are written under `%LOCALAPPDATA%\MachineRoom\runs`.
5. **Ready for review**: The lane returns to idle. `Reviews` lists the lane branch ahead of `C:\GitHub\ulolTris`'s checked-out branch, showing the commit, diff (`Reviews -> Diff`), and a passing `npm test` status.
6. **Live browser check and merge**: You start `npm run serve` in the worktree (or after merging) and verify on `http://localhost:8123`. Clicking `Merge` in `Reviews` fast-forwards `C:\GitHub\ulolTris`'s branch to the lane's commit and clears the review item.

## 6. Failure of MachineRoom vs. failure of the task

Counts as a **task failure** (not MachineRoom):

- The agent writes buggy game logic, breaks a `ulolTris` test, skips `npm run build`, or makes a bad gameplay/UI choice seen on port `8123`.

Counts as a **MachineRoom failure**:

- `npm run serve -- up --root C:\GitHub\ulolTris --open` crashes, binds to MachineRoom instead of `ulolTris`, or drops live lane/session updates.
- With `Own worktree` checked, any file changes in `C:\GitHub\ulolTris` itself, touches `.worktrees/opencode` or `.worktrees/opencode2`, leaves `.worktrees/` untracked in `C:\GitHub\ulolTris`, or runs on `ulolTris`'s checked-out branch instead of `machineroom/queue-<lane>-<stamp>`.
- `node_modules` junctioning fails so `npm test` breaks in the worktree while passing in `C:\GitHub\ulolTris`, or background processes spawned by the run stay alive after exit.
- MachineRoom skips `npm test`, commits or marks a branch passed after `npm test` failed, or silently uses the wrong check command.
- The room keeps the lane stuck as idle while working or working after exit, loses live updates/logs, or fails to show the diff cleanly in `Reviews`.
- A clean, committed queue branch fails to appear in `Reviews`, or `Merge` fails or corrupts `C:\GitHub\ulolTris` even though `C:\GitHub\ulolTris` is clean and directly behind the queue branch.
- MachineRoom writes run state or logs inside `C:\GitHub\ulolTris` instead of `%LOCALAPPDATA%\MachineRoom\runs`.

## 7. Steps MachineRoom cannot do today

- **Run `npm test` and `npm run build` in `Check command`**: Shell operators like `&&` are rejected in `Check command`. MachineRoom also does not verify after a run that `game.js` was rebuilt to match `js/*.js`.
- **Enforce `ulolTris`'s commit message and version rule automatically**: If the agent leaves uncommitted files, MachineRoom's queue runner commits using the first 72 characters of the prompt plus a footer, without bumping `package.json` or enforcing `<version>: <sentence>`.
- **Start `ulolTris` on port `8123` or inspect it in a browser**: MachineRoom stops leftover worktree processes on exit and has no visual or gameplay test runner for `ulolTris`. You must run `npm run serve` and check `http://localhost:8123` yourself.
- **Start a worktree run when `C:\GitHub\ulolTris` is dirty**: MachineRoom blocks `--worktree` runs if the main checkout has uncommitted edits, and hides `Allow uncommitted changes` when `Own worktree` is selected.
- **Auto-rebase or merge diverged branches in `Reviews`**: `Reviews` only performs `git merge --ff-only`. If another agent advances `C:\GitHub\ulolTris` while the lane runs, `Merge` stops with a conflict status and requires `Ask to prepare` or a manual rebase.
- **Show orphan worktrees in `Reviews`**: `Reviews` only shows lanes listed in active lane configuration, so leftover worktrees from removed or custom lane names (such as `.worktrees/opencode2`) stay hidden there even if listed under storage/worktrees.
- **Offer a pre-built code lane on a fresh config**: Because `config/lanes.json` contains only `orchestrator` (`Main`), a brand-new setup requires adding a code lane in `Agents` first.
- **Exact worktree path and base branch wording in the confirm prompt**: `Dispatch` says the worktree sits "beside the project" and "never on main", whereas it actually creates `.worktrees/<lane>` inside `C:\GitHub\ulolTris` (hidden via `.git/info/exclude`) and branches from whatever branch is currently checked out (`machineroom/queue-20261024-192349` right now, not `main`).
