# Documentation audit for merges P70 to P76

Reviewed at version 0.1.401 on branch `feat/p91-do-the-docs`. Read each merge's changelog line and the lines of `docs/agents/architecture/LIVE.md`, `docs/agents/architecture/COMMANDS.md`, `docs/agents/architecture/CODE.md` and `docs/GUIDE.md` that describe what it changed, and checked each sentence against the code.

| Doc line | Code file:line | Sentence it should be |
| --- | --- | --- |
| `docs/GUIDE.md:353` | `server/agents-config.js:137`, `src/harnesses/codex.js:37` | `\| Codex \| Supported: a lane you make \| \`exec --json\` item lines \|` |
| `docs/GUIDE.md:304` | `scripts/run-lane.mjs:516-522`, `server/agents-config.js:83-104` | `A lane you make starts the program its harness names by default (OpenCode, AGY and Codex at their usual install folders, the others by name on PATH).` |
| `docs/agents/architecture/COMMANDS.md:18` | `scripts/run-lane.mjs:1275-1277` | `A lane with cli.commits runner, such as the codex lane, has its changes put on the brief's branch and committed by the runner after a run that ends with exit code 0 (P75).` |

## What was checked

### `23bad3c1` (P70)

Changelog: "The CLI review and merge find a lane the owner made, reviews read made lanes of a bridge started with a lanes folder, a failed tree list walks at once, the stop reads the harness children before it kills the harness, and scale-live refuses --server with no folder (P70)."

- CLI review and merge find owner-made lanes: checked `scripts/merge-lane.mjs:202-206, 250, 489` and `scripts/review-lane.mjs:51-55, 296`. Both call `readAllLanes({ lanesJson, runsFolder })` and resolve worktrees via `worktreeFromLane`. Matches `docs/agents/architecture/COMMANDS.md:21` and `:24`.
- Reviews read made lanes of a bridge started with a lanes folder: checked `server/index.js:471` passing `lanesSourceObject.folder` as `runsFolder` to `createReviewsApi`. Matches `docs/agents/architecture/LIVE.md:12`.
- A failed tree list walks at once: checked `server/index.js:174`. When `listed === null`, `readTree` returns `walkTree` at once without waiting for `deletedPromise`. Matches `docs/agents/architecture/LIVE.md:11`.
- The stop reads harness children before kill: checked `scripts/run-lane.mjs:1129-1133`. `harnessDescendants(child.pid)` is read before `killTree(child)`. Matches `docs/agents/architecture/COMMANDS.md:18`.
- Scale-live refuses `--server` with no folder: checked `scripts/scale-live.mjs:80`. Matches `docs/agents/architecture/COMMANDS.md:14`.

### `580a28cf` (P71)

Changelog: "Opening another project is refused while the lane source holds a run open, since the project route now gets the live lane source and not its settings (P71, from GPT 6.1 Sol's review)."

- Checked `server/index.js:634` passing `lanesSource: () => lanesSource` instead of settings, and `server/projects.js:359-361` checking `lanesSource()?.hasActiveRun?.()` and returning 409. Matches `docs/agents/architecture/LIVE.md:11` ("answers 409 while an orchestrator turn runs or a lane run is open").

### `909f00fa` (P74)

Changelog: "A Codex lane passes --add-dir for each folder in cli.addDirs, so the codex lane can write the main checkout's .git, and a Codex run becomes a recording (P74)."

- Checked `src/harnesses/codex.js:46-48` appending `--add-dir` for each directory in `cli.addDirs`.
- Checked `scripts/recording-files.mjs:31` allowing `codex` harness runs to be recorded.
- Matches `docs/agents/architecture/CODE.md:27` and `docs/agents/architecture/COMMANDS.md:29`.

### `1e027045` (P72)

Changelog: "Every tree event carries its version, the page reconnects from the newest one it applied, and a version the bridge no longer holds gets one full list, so files added or deleted while the page was away show after a reconnect (P72, from GPT 6.1 Sol's review)."

- Checked `server/index.js:267, 300, 809, 843, 1385, 1388`. `treeEvent` and `treeDeltaEvent` stamp `version: treeVersion`. A version no longer in recent versions receives a full list.
- Checked `src/live/bridge.js:35, 77-80`. The client requests `&since=${version}`, updates `cursor` with `tree.version`, and a full list resets `cursor`.
- Matches `docs/agents/architecture/LIVE.md:11` ("; every tree event carries `version`, the page asks `since` the newest it applied, a full list sets that version even when it is lower, as after a bridge restart, and a `since` the bridge no longer holds gets one full list, P72").

### `3bb13972` (P73)

Changelog: "A codex lane whose program is plain codex, with no codex on PATH, starts the newest codex.exe of the Codex app under %LOCALAPPDATA%\OpenAI\Codex\bin, and the harness check finds it too; the fleet's codex lane now names plain codex (P73, the first brief written by the codex lane)."

- Checked `server/agents-config.js:83-104` (`codexAppProgram`), `:137` (`isHarnessAvailable` checks `codexAppProgram`), `scripts/run-lane.mjs:516-522` (`codexLaneProgram`), and `docs/agents/lanes.json:367`.
- Matches `docs/agents/architecture/LIVE.md:12` and `docs/agents/architecture/CODE.md:27`.
- `docs/GUIDE.md:353` still lists Codex as "Supported: no lane yet" instead of "Supported: a lane you make".
- `docs/GUIDE.md:304` lists only OpenCode and AGY for usual install folders, omitting Codex.

### `b6bd90f7` (P75)

Changelog: "A lane with cli.commits runner, such as the codex lane, has its changes put on the brief's branch and committed by the runner after a run that ends with exit code 0 (P75)."

- Checked `scripts/run-lane.mjs:235-256` (`runnerCommit`) and `:1275-1277` (running `runnerCommit` on success when `lane.cli?.commits === 'runner'`).
- Missing from `docs/agents/architecture/COMMANDS.md:18`.

### `4a3eebce` (P76)

Changelog: "The runs folder defaults to %LOCALAPPDATA%\MachineRoom\runs on Windows and ~/.local/state/machineroom/runs elsewhere, every caller asks runsFolder, and an old %TEMP%\machineroom-runs is copied there once and never deleted (P76, after a disk cleanup emptied %TEMP%)."

- Checked `server/lanes-source.js:68-107` (`defaultRunsFolder`, `migrateRunsFolder`, `runsFolder`).
- Checked callers in `server/orchestrator.js:284`, `server/orchestrators.js:68`, `scripts/mcp-bridge.mjs:27`, `scripts/mr-agent.mjs:383`, `scripts/run-recording.mjs:15`.
- Matches `docs/agents/architecture/LIVE.md:12` and `docs/GUIDE.md:258`.
