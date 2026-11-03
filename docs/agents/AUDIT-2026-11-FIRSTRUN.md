# AUDIT 2026-11: the first run on a new project

Version 0.1.401. Branch `feat/q34-hunt-of-the`. Read only, no code changed.

## What I read

`bin/machineroom.mjs`, `bin/machine-room.mjs`, `server/doctor.js`, `server/static.js`, `server/projects.js`, `scripts/pack-check.mjs`, `server/claude-sessions.js`, `server/opencode-sessions.js`. I also read the routes that answer for them in `server/index.js`, plus `server/runs.js` and `server/orchestrator.js` where a finding pointed there.

## How I tried it

Two folders under `%TEMP%\machineroom-firstrun`:

- `plain`: an empty folder.
- `gitproj`: `git init`, `README.md`, `src/a.js`, `src/b.js`, one commit `first commit`.

I ran, from the worktree:

```
npm run serve -- doctor --root %TEMP%\machineroom-firstrun\plain
npm run serve -- doctor --root %TEMP%\machineroom-firstrun\gitproj
npm run serve -- up --root <folder> --port 5199 --lanes --sessions
for p in health agents tree git lanes projects; do curl -s -o /dev/null -w "/api/$p %{http_code}\n" "http://127.0.0.1:5199/api/$p"; done
```

I also ran the short command `node bin/machineroom.mjs <folder> --no-open --port 5198`, a missing root, a subfolder of a git checkout, a second room on the same project, and `doctor` with the built viewer temporarily moved aside. I stopped each room with `taskkill /PID <listening pid> /T /F`. No lane was started and no owner project was opened.

The room answered 200 on all six routes on both folders. The static page answered 200 and a missing asset answered 404.

## Findings

| # | Severity | Where | Case and answer | Smallest fix |
|---|----------|-------|-----------------|--------------|
| 1 | High | `package.json:13`, `server/runs.js:200`, `scripts/pack-check.mjs:38` | The pack leaves out every script, so a packed room cannot start a lane. `npm pack --dry-run --json` lists 0 files under `scripts/`; `npm run pack-check` still prints `Pack check passed: 131 files, 1.3 MB packed.` The bridge starts a lane with `node scripts/run-lane.mjs`, which is not in the tarball. A run from the packed room cannot start; the bridge writes a failed run and shows the runner's last line. | Add `scripts/` to `files`, and add `scripts/run-lane.mjs` and `scripts/mr-agent.mjs` to `RUNTIME_READS` so the check covers the scripts the bridge spawns. |
| 2 | High | `bin/machine-room.mjs:198`, `server/index.js:855` | `up` starts on a folder that does not exist. Doctor prints `FAIL The project folder ... does not exist.`, then `Some checks failed. The room opens anyway.`, then `MachineRoom is running.` and serves it. `/api/tree` answers `200 {"root":"does-not-exist","files":[],"created":[]}` and `/api/health` answers `200 {"ok":true,...}`. A typo in the folder gives an empty room with no error. | In `up`, when the project folder check failed, print the FAIL and exit 1 instead of starting. A room on a missing folder cannot work. |
| 3 | Medium | `server/doctor.js:133`, `bin/machine-room.mjs:96` | `doctor` passes when the viewer was never built. With `dist` moved aside, `npm run serve -- doctor --root ...` prints 11 `ok` lines and exits 0; `npm run serve -- up --root ...` then exits 1 with `Build the viewer first with npm run build. Run it in <worktree>.` The check a new user runs first says the room is ready, and the next command does not start. | Add one check to `runDoctor`: `dist/index.html` exists. On failure print the build command and the folder to run it in, and let `up` keep the existing early exit. |
| 4 | Medium | `server/projects.js:176` | On a subfolder of a repo, `/api/git` and `/api/projects` disagree. Room rooted at `gitproj\src`: `/api/git` answers `200 {"git":true,"branch":"master",...}` while `/api/projects` answers `"current":{"path":"...\\gitproj\\src",...,"git":false}`. The Projects panel hides the Repository section for a folder that is inside a repo. | In `currentProject`, walk up from the root to the first folder that holds `.git`, or take `git` from the git route's cached answer. |
| 5 | Medium | `server/projects.js:254` | The recent list offers a lane worktree. `/api/projects` on both test folders answered `recent` with `C:\GitHub\MachineRoom\.worktrees\agy2`, a path that `shouldSkipProject` exists to hide. The skip runs when a project is recorded and never again when the list is read, so entries written before the rule stay and can be opened. | Filter `existing` through `shouldSkipProject` in `recentProjects` before it reads sessions and returns rows. |
| 6 | Medium | `server/doctor.js:67` | Doctor never says whether the project is a git repository. On the plain folder it printed `ok Git is found at ...` and all other checks passed, while `/api/git` answered `200 {"git":false}` and the room showed no Source control. Nothing told the user to run `git init`. | Give `gitLine` the project root and add a second line when `<root>/.git` is missing: `This folder is not a git repository. Run git init here for Source control.` Make it a warning, not a failure. |
| 7 | Medium | `server/doctor.js:204` | `up` never says how to make the room fill. It prints `The room fills when a lane or a session works on the project.` and `Press Ctrl+C in the terminal to stop the room.` A first-run user has no lane and no session and is not told how to start either. | Add one line: `Start a lane with npm run run-lane -- opencode T2, or press C in the room for Dispatch.` |
| 8 | Low | `server/index.js:829` | `/api/health` answers `ok:true` on a room that cannot work. It did so on the missing root. `ok` only reports which sources are on, not whether the root reads or the page can load. | Add `problems` to the answer: a missing root, a missing `index.html` and the last tree read error. Set `ok` false when the list is not empty. |
| 9 | Low | `bin/machine-room.mjs:38`, `bin/machineroom.mjs:13` | `machine-room up --no-open` is unknown. It prints `Unknown option --no-open.` and the usage block, and exits 1, though `ARCHITECTURE.md` describes the short command with `--no-open`. `node bin/machineroom.mjs --help` prints `Usage: machine-room ...` with no `machineroom FOLDER` line, so the linked command's own name, its folder argument and `--no-open` are never shown. | Accept `--no-open` in `FLAGS` as a no-op for `up`, and print one `machineroom [FOLDER] [--port N] [--no-open]` line at the top of the help. |
| 10 | Low | `bin/machine-room.mjs:227` | A passing doctor ends with the last lane line and no summary. All 11 lines start `ok`, then the prompt returns, with no `All checks passed.` and no next step. | Print `All checks passed.` after the loop, and the same next-step line as finding 7. |
| 11 | Low | `server/orchestrator.js:192` | The lock sentence gives advice the code no longer needs. A second `up` on a live room answered `Another room is already running on this project (process 20416). Wait for it to end, or delete ...orchestrator-<hash>.lock if no room is going.` I killed the room with `taskkill /F` and started again on the same port; the start succeeded with the stale lock still on disk. The user is told to hunt a hashed file for nothing. | Drop the delete clause when the pid in the lock is not alive, and say `Starting the room now.` |
| 12 | Low | `server/opencode-sessions.js:371` | The OpenCode reader swallows every error in `tick`. `try { ... } catch {}` covers the schema, the statements and the row mapping. `/api/health` still answers `"sessions":true`. A rename in `opencode.db` turns the session source off for good with no sentence anywhere. | Keep the last error on the reader and add `sessionsProblem` to `/api/health`, plus one line in the room's session panel. |
| 13 | Low | `server/claude-sessions.js:320` | The skip for a lane's own session is checked only when a session file is first seen. `skippedSessions()` runs inside the "new file" branch, so a `.meta.json` written after the session file was registered never hides that session, and a lane run appears twice. | Recompute the skipped set on every tick, or once a minute, and mark a known session skipped when its id joins the set. |
| 14 | Low | `server/projects.js:201` | `siblingFolders` lists the current folder itself. `/api/projects` rooted at `gitproj` returned `folders` with `gitproj` first, then `logs` and `plain`. The Projects panel shows a row that opens the project already open. | Skip the entry whose path matches `projectRoot`. |
| 15 | Low | `bin/machine-room.mjs:163` | The room prints no pid. I started `up` through npm in the background, the pid bash reported was already gone, and the bridge kept port 5199 listening under a different pid. Stopping that listening pid removed it. The printed block names no process to stop. | Print `machine-room: pid <pid>, port <port>` in the block, so a user who loses the terminal can stop the right process. |

## Checked and clean

- All six routes answered 200 on an empty folder and on a git folder with one commit: `/api/health`, `/api/agents`, `/api/tree`, `/api/git`, `/api/lanes`, `/api/projects`. No route answered 500 on either.
- `static.js` served the built page at `/` with 200, fell back to the page for an unknown path with 200, and answered `404 Not found` for a missing asset.
- The write routes kept their guards. `POST /api/projects/open` with no Origin answered 403, with no confirm answered 400 `Confirm opening the project first.`, and `GET` answered 405. `POST /api/projects/forget` with no Origin answered 403. `POST /api/git/switch` with no Origin answered 403.
- The Claude reader found 2 session files for this repository and started on the right folder.
- The OpenCode reader's two prepared statements ran against the live `opencode.db` (columns `id, session_id, type, seq, time_created, time_updated, data`), and a direct read found 110 session rows whose `directory` is this repository, so a new session there would be included. The reader itself emits nothing on its first tick by design: it primes at the current end of the session tables.
- Neither reader holds a file open between ticks: the Claude reader opens, reads to the current size and closes in `readStream`, and the OpenCode reader closes its `DatabaseSync` in `stop`, which the sessions source calls from the bridge's stop.
- A stale lock with a dead pid did not block the next start, so the lock check reads the pid, not just the file.
- `machineroom <folder> --no-open --port 5198` started on a folder with no git and answered `/api/health` 200.

## Features for the first ten minutes

1. **A doctor that ends with the next step.** Smallest: one line after the checks, `All checks passed. Start a lane with npm run run-lane -- opencode T2, or press C in the room for Dispatch.` When a check fails, print its fix line under it.
2. **A first-run check that reads the project once.** Smallest: add a `tree` line to `runDoctor` that lists `<root>` with the same reader `/api/tree` uses and prints `3 files in 2 folders.` or the read error. It catches a typo or a locked folder before the room opens.
3. **An empty room that says why it is empty.** Smallest: when the page has a tree with zero files and no working agent, show one line under the lens: `This folder is empty. Open another project in Projects, or start a lane in Dispatch with C.`
4. **A pid and port line in the start block.** Smallest: `machine-room: pid 1234, port 5199` above the address, so a user can stop the room after losing the terminal.
5. **Project rows with a state and one action.** Smallest: in the Projects list, drop worktrees and the open project, and put one line under a non-git row: `Not a git repository. Run git init here.` with a copy button.
6. **A pack check that starts what the bridge starts.** Smallest: after the import walk, spawn `node scripts/run-lane.mjs --list` from the unpacked pack with a 10 second limit and fail when it exits nonzero. It would have caught finding 1.

## Not reached

- The page by eye. I did not start a dev server or a browser. The orchestrator checks the lens, the empty state and the Projects rows.
- `npm test` and `npm run build`. The brief forbids the full suite and no code changed, so there is nothing for them to cover. The test count is 0 before and 0 after.
- A real lane run and a real new OpenCode session. The brief forbids starting a lane, so the packed-room run in finding 1 comes from the pack list and the spawn in `server/runs.js`, not from a run.
- The packed tarball was listed but not unpacked and started. `tests/pack-start.test.js` covers the start of the page, not a lane.
- The `--open` browser path. I did not want to open a window on the owner's desktop.
