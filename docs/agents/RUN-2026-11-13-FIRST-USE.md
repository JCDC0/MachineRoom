# First use, 2026-11-13

A new owner's path through the commands that do not start a server, run in the OpenCode 5 worktree at `0.1.401` (`345dfc4b`). Node 24.22.1, npm 11.19.1, Windows. Every command ran in the foreground with a time limit and a fresh `MACHINEROOM_RUNS` folder under `%TEMP%`. No bridge ran with `--lanes` on the testbench runs folder.

Two things were missing before the run. `C:\GitHub\MachineRoomTestProject` does not exist on this machine. `README.md` does not name `doctor`, `pack-check` or `run-lane`. The commands below come from the brief, not from README. To see the success path of the dry run I used a scratch git project and a one-lane file under `%TEMP%`; both are described in the table and were deleted.

## Commands

| Command | Printed in short | Would a new owner know what to do next? | Wrong, unclear or missing |
| --- | --- | --- | --- |
| `npm run serve -- doctor` on this checkout | Six `ok` lines. `All checks passed.` `Press C in the room for Dispatch.` Exit 0. | Yes, it passed. | `Press C` only works inside a running room. Nothing says how to open the room or what Dispatch is. |
| `npm run serve -- doctor C:\GitHub\MachineRoomTestProject` | `Unknown option C:\GitHub\MachineRoomTestProject.` then the usage block. Exit 1. | Maybe. The usage block does not say doctor needs `--root`. | The brief's form fails. A folder argument looks natural but is refused. |
| `npm run serve -- doctor --root C:\GitHub\MachineRoomTestProject` | `FAIL The project folder ... does not exist.` Four `ok` lines follow. Exit 1. | No. | The named folder is not on this machine. The output still checks git and the viewer, which hides the one real block. |
| `npm run serve -- doctor --root <scratch git project under %TEMP%>` (extra) | `ok` for the folder, 1 file in 1 folder, git, viewer, runs and Orchestrator. `All checks passed.` Exit 0. | Yes. | None. |
| `npm run serve -- doctor --root <scratch folder with no git>` (extra) | `warn This folder is not a git repository.` then `All checks passed.` Exit 0. | Half. | A warning is counted as a pass and the exit code stays 0. |
| `npm run pack-check` | `Pack check passed: 154 files, 1.5 MB packed.` Exit 0. | Yes, it passed, but not what was checked. | One line only. A reader cannot tell what it checked: the packed file list, the unpacked start or both. |
| `npm run pack-check -- --help` (extra) | The same `Pack check passed` line. Exit 0. | No help. | `--help` is ignored and the full check runs. There is no usage line. |
| `npm run run-lane -- --list` | `no runs recorded yet`. Exit 0. | No. | It does not say where it looked or how to make a run. |
| `npm run run-lane -- --help` | `Unknown option --help.` Exit 1. | No. | No usage line and no flag list. |
| `npm run run-lane --` (extra) | `Name a lane to run, for example hermes.` Exit 1. | No. | `hermes` is retired in the development fleet and absent from the default lane list. No flag list. |
| `npm run run-lane -- opencode --project C:\GitHub\MachineRoomTestProject --task "Say hello." --dry-run` | `There is no lane named opencode.` Exit 1. | No. | The default `config/lanes.json` holds only the Orchestrator. The `opencode` lane exists only with `MACHINEROOM_LANES_DIR=docs/agents`. The error does not say how to add a lane. |
| The same dry run with `MACHINEROOM_LANES_DIR=docs/agents` (extra) | `The project folder C:\GitHub\MachineRoomTestProject does not exist.` Exit 1. | No. | Confirms the missing folder is the next block. The run stops before the command is shown. |
| The same dry run on the scratch project with a one-lane file (extra) | `file: %APPDATA%\...opencode.exe`, one `args` line, `cwd: %TEMP%\...`, `<prompt: 216 characters>`. Exit 0. | Yes. | The prompt is hidden. Nothing says this was a dry run and no run started. It does not print the run folder or log path. |
| `npm run serve -- --help` | Usage with `up` and `doctor` commands and nine options. Exit 0. | Yes. | The options are one list for both commands, so doctor's `--root` is not marked as its folder. |
| `npm run serve -- doctor --help` (extra) | The same usage block. Exit 0. | Yes. | Same as above. |
| `node bin/machineroom.mjs --help` (extra) | `Usage: machineroom [FOLDER] [options]` and four options. Exit 0. | Yes. | None. |
| `npm run build` (extra) | `192 modules transformed`, `built in 558ms`, one chunk-size warning. Exit 0. | Yes. | The warning about a 1.6 MB chunk is noise on a first build and suggests a fix the owner cannot make. |

## What is wrong, in short

- README's Quick start stops at `machineroom`. It never names `doctor`, `pack-check` or `run-lane`, so a new owner cannot find the checks that the brief calls first-use commands.
- There is no build lane in the default room. README says to add lanes in Settings, but `run-lane` gives no way to list lanes or tell whether one exists.
- Help is missing where it matters. `run-lane --help` fails. `pack-check --help` runs the check. Doctor rejects a folder argument.
- Doctor ends with `All checks passed` while a warning is present and the exit code stays 0.
- The dry run hides the prompt and the fact that nothing started.

## The five changes that would help a new owner most

1. Put a First run block in README with the exact commands and their expected one-line output. Include `npm run serve -- doctor`, `npm run pack-check` and `npm run run-lane -- --list`.
2. Make the default room ready to run one task, or make the first step explicit: add a lane in Settings before `run-lane`. Have the no-lane error list the lanes in the file, the file path, and how to add one.
3. Give `run-lane --help` a real usage block: flags, a lane name and examples from the default list. Replace the retired `hermes` example. Let `--list` say where it looked and how to start a run.
4. Fix doctor's ending and folder input: accept `doctor <folder>` as `--root`, and end with `All checks passed, 1 warning` or exit nonzero when the project is not a git repo.
5. Make the dry run complete: print the prompt or its first line, the run folder and log path, and a clear `Dry run, nothing started.` line. Give `pack-check` a usage line and say what it checked.

## What I did not run

- `npm install`: `node_modules` was already present. Not run.
- `npm link`: it writes to the machine's global npm and would affect other lanes. Not run.
- `machineroom` with no arguments, `npm run dev` and `npm run serve -- up`: they start a server. The brief excludes them. Left to the orchestrator in a browser.
