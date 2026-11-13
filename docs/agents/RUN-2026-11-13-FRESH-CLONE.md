# Fresh clone run: 2026-11-13

Report for task P257. Cloned `main` (`ddeb194a`) from `C:\GitHub\MachineRoom\.worktrees\agy2` into `%TEMP%\machineroom-fresh-clone-p257` on Windows 11 (PowerShell 5.1, Node `v24.22.1`, Git `2.56.1.windows.1`, execution policy `RemoteSigned`). Ran `install`, `build`, `doctor`, and `up` with `--no-open` on port `5196` and `MACHINEROOM_RUNS` pointed at a new empty folder `%TEMP%\machineroom-runs-p257`, without `--lanes`, and without starting any lane, orchestrator turn, or model call.

Note: `npm link` was skipped because this clone lived in `%TEMP%` and had to be deleted after the run. Following `README.md` ("Without `npm link`"), `up` was launched via `npm run serve -- up ...`.

## Commands run and timings

| Step | Command | Time | Exit | Matched README |
| --- | --- | --- | --- | --- |
| Pre-check | `node -v; git --version; Get-ExecutionPolicy` | < 1s | 0 | Prereqs met (Node >= 24, git). |
| Env check | Check `env:MACHINEROOM_*` and port `5196` | < 1s | 1 (port free) | Not in README; found `MACHINEROOM_RUNS` pre-set in parent env to `C:\Users\<name>\AppData\Local\MachineRoom\testbench`. |
| Clone | `New-Item` empty runs dir + `git clone --branch main C:\GitHub\MachineRoom\.worktrees\agy2 "%TEMP%\machineroom-fresh-clone-p257"` | 3.82s | 0 | Not in README (README starts inside the repo folder). |
| Install | `npm install` (in clone) | 3.72s | 0 | Printed `added 43 packages`, plus funding and audit lines (6 lines, not 1 line). |
| Build | `npm run build` (in clone) | 1.23s | 0 | Printed `built in 463ms`, plus 20 asset lines and a Vite chunk-size warning (29 lines, not 1 line). |
| Doctor | `npm run serve -- doctor` with `MACHINEROOM_RUNS="%TEMP%\machineroom-runs-p257"` | 0.93s | 0 | Printed `All checks passed.`, preceded by 6 `ok` lines and a Dispatch tip (10 lines, not 1 line). |
| CLI help | `npm run serve -- --help` | 0.68s | 0 | Needed to find `--port` and `--no-open`; not mentioned in README. |
| Start room | `npm run serve -- up --root "%TEMP%\machineroom-fresh-clone-p257" --no-open --port 5196` with `MACHINEROOM_RUNS="%TEMP%\machineroom-runs-p257"` | Ready < 8s (kept up ~57s) | Running until stopped | Printed `MachineRoom is running.` and the URL, plus 6 doctor lines, pid/port, and 3 tips (15 lines, not 1 line). |
| Read health | `GET http://127.0.0.1:5196/api/health` | 99.9ms | HTTP 200 | Not in README. |
| Read tree | `GET http://127.0.0.1:5196/api/tree` | 406.9ms | HTTP 200 | Not in README. |
| Read agents | `GET http://127.0.0.1:5196/api/agents` | 20.9ms | HTTP 200 | Not in README. |
| Check index and runs dir | `GET http://127.0.0.1:5196/` and list `%TEMP%\machineroom-runs-p257` | < 2s | HTTP 200 | Viewer HTML served (669 bytes); `orchestrator-3680fe68.json` and `.lock` created in runs dir. |
| Stop and clean | Cancel background task, verify port `5196` free, delete clone and runs folder | < 10s | -1 then 0 | First cleanup pass matched its own PowerShell PID before deleting; second pass (excluding `$PID`) exited 0, confirmed port free, and removed both folders. |

## Output of `doctor` and `up`

`npm run serve -- doctor` printed:

```text
> machine-room@0.1.401 serve
> node bin/machine-room.mjs doctor

ok The project folder %TEMP%\machineroom-fresh-clone-p257 exists.
ok The project holds 717 files in 32 folders.
ok Git is found at C:\Program Files\Git\cmd\git.exe.
ok The built viewer is ready in %TEMP%\machineroom-fresh-clone-p257\dist.
ok The runs folder %TEMP%\machineroom-runs-p257 is ready.
ok The Orchestrator lane starts from %USERPROFILE%\.local\bin\claude.exe.
Press C in the room for Dispatch.
All checks passed.
```

`npm run serve -- up --root "%TEMP%\machineroom-fresh-clone-p257" --no-open --port 5196` printed:

```text
> machine-room@0.1.401 serve
> node bin/machine-room.mjs up --root C:\Users\<name>\AppData\Local\Temp\machineroom-fresh-clone-p257 --no-open --port 5196

ok The project folder %TEMP%\machineroom-fresh-clone-p257 exists.
ok The project holds 717 files in 32 folders.
ok Git is found at C:\Program Files\Git\cmd\git.exe.
ok The built viewer is ready in %TEMP%\machineroom-fresh-clone-p257\dist.
ok The runs folder %TEMP%\machineroom-runs-p257 is ready.
ok The Orchestrator lane starts from %USERPROFILE%\.local\bin\claude.exe.
All checks passed.
MachineRoom is running.
machine-room: pid 26544, port 5196
machine-room: open http://127.0.0.1:5196/?live&bridge=http://127.0.0.1:5196
The room fills when a lane or a session works on the project.
Press C in the room for Dispatch.
Press Ctrl+C in the terminal to stop the room.
```

## HTTP endpoints read

### `GET /api/health`

HTTP `200`, `244` bytes, `99.9ms`:

```json
{"ok":true,"problems":[],"lanes":true,"sessions":true,"orchestrator":true,"unparsed":{"total":0,"byParser":{"claude":0,"hermes":0,"opencode":0,"agy":0},"since":"2026-11-13T14:41:37.973Z"},"masked":{"total":0,"since":"2026-11-13T14:41:37.968Z"}}
```

Note that `"lanes":true` and `"sessions":true` were active even though `--lanes` was not passed to `up`.

### `GET /api/tree`

HTTP `200`, `20543` bytes, `406.9ms`. JSON object with 4 keys (`root`, `files`, `created`, `start`):

- `root`: `"machineroom-fresh-clone-p257"`
- `files`: array of `717` repository paths, starting with `".env.example"`, `".gitattributes"`, `".github/workflows/ci.yml"`, `".gitignore"`, `".nvmrc"` and ending with `"tests/untar.test.js"`, `"tests/void.test.js"`, `"tests/waiting.test.js"`, `"tests/worktrees.test.js"`, `"vite.config.js"`
- `created`: `[]`
- `start`: `"ea06690b1fd66fa6"`

### `GET /api/agents`

HTTP `200`, `452` bytes, `20.9ms`:

```json
[{"id":"agent-orchestrator","key":"orchestrator","name":"Orchestrator","adapterType":"claude_local","parser":"claude","role":null,"harness":"claude","model":"opus"},{"id":"agent-claude-session","key":"claude-session","name":"Claude Code session","adapterType":"claude_local","parser":"claude","role":null},{"id":"agent-opencode-session","key":"opencode-session","name":"OpenCode session","adapterType":"opencode_local","parser":"opencode","role":null}]
```

## Errors and warnings

1. Vite chunk-size warning during `npm run build` (exit `0`, viewer built `dist/assets/index-D7SBm_Zo.js` at `1,664.79 kB`):

```text
[plugin builtin:vite-reporter] 
(!) Some chunks are larger than 500 kB after minification. Consider:
- Using dynamic import() to code-split the application
- Use build.rolldownOptions.output.codeSplitting to improve chunking: https://rolldown.rs/reference/OutputOptions.codeSplitting
- Adjust chunk size limit for this warning via build.chunkSizeWarningLimit.
```

2. `doctor`, `up`, and `/api/health` reported zero errors and zero warnings (`All checks passed.`, `"ok":true,"problems":[]`).
3. Cleanup pass 1 exited `-1` before deleting temp folders because the PowerShell process query matched its own command line; cleanup pass 2 excluded `$PID` and exited `0`.

## Where `README.md` is wrong, unclear, or missing something

1. **Wrong ("prints one line")**: `README.md` says "Each command prints one line when all is well" for `npm install`, `npm run build`, and `npm run serve -- doctor`, and "It prints the same line" (`MachineRoom is running.` and the address) for `up`. Every command prints multiple lines (6, 29, 10, and 15 lines).
2. **Missing build warning**: `README.md` does not mention the Vite `> 500 kB` chunk-size warning during `npm run build`, which may alarm a new owner.
3. **Missing `up` flags and `--help`**: `README.md` only shows `npm run serve -- up --root FOLDER --open` and `machineroom FOLDER`. It omits `--port <n>` (`PORT`), `--no-open`, `--dist <folder>`, `--lanes`, `--sessions`, `--no-sessions`, and `--help`, and does not state the default port or what happens when `--open` and `--no-open` are both omitted. It also does not note that `--no-open` still prints `machine-room: open http://...` in the terminal.
4. **Unclear `--root FOLDER` and demo tour setup**: `README.md` shows `FOLDER` as part of `up` and `machineroom`, then says "No project at hand? Open `/?replay&fixture=scenario-i&tour` on the room's address to take the demo tour." It does not say whether `--root` is optional (defaulting to the current folder) or how to start the server when no project folder is at hand.
5. **Unclear default sources (`--lanes` and `--sessions`)**: `README.md` never mentions `--lanes`, `--sessions`, or `--no-sessions`. Running `up` without `--lanes` still enabled both `"lanes":true` and `"sessions":true` in `/api/health` (matching `--help`'s `up` description, while `--help` still lists `--lanes` as an opt-in flag and only provides `--no-sessions`).
6. **Missing `MACHINEROOM_RUNS` and disk state note**: `README.md` mentions `MACHINEROOM_LANES_DIR` under `Lanes`, but never mentions `MACHINEROOM_RUNS`, `PORT`, `PROJECT_ROOT`, or that `up` writes `orchestrator-<hash>.json` and `.lock` inside the runs folder.
7. **Unclear `npm link` persistence**: `README.md` recommends `npm link` without explaining that it binds globally to the current folder (and moving or deleting the clone breaks `machineroom`, or requires `npm unlink`).
8. **Missing how to stop the room**: `README.md` does not state how to stop a running room (`Press Ctrl+C in the terminal to stop the room.` only appears after `up` starts).
9. **Unclear agent list wording**: `README.md` says "A new room has the orchestrator and no lane." That is true for custom lanes, though `/api/agents` returns three entries (`Orchestrator`, `Claude Code session`, and `OpenCode session`).
10. **PowerShell env var syntax**: `README.md` includes a PowerShell note for `npm.cmd`, yet mentions `MACHINEROOM_LANES_DIR` without showing PowerShell env var syntax (`$env:...`).

## Cleanup confirmation

- Stopped the background `npm run serve -- up` task (`task-28`, pid `26544`).
- Verified port `5196` is free and no process with `machineroom-fresh-clone-p257` in its command line remains.
- Deleted `%TEMP%\machineroom-fresh-clone-p257` and `%TEMP%\machineroom-runs-p257` (`Test-Path` returned `False` for both).
