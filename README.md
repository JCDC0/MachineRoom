# Machine Room

MachineRoom shows coding agents working on one project as a 3D machine room in your browser. It follows the room's lane runs, task queues and your own Claude Code and OpenCode sessions live, and it can replay a recorded run.

## What you need

- Node 24 or newer. The version is pinned in `package.json` and `.nvmrc`.
- git on the PATH. Worktrees and queues need a git project.
- OpenCode or Claude Code installed and signed in. A lane uses the program its entry in `docs/agents/lanes.json` names. The orchestrator uses Claude Code, or OpenCode when its entry says so.
- A browser with WebGL.

## Start it on your project

Run these in the MachineRoom folder:

```
npm install
npm run build
npm run serve -- up --root <your project folder>
```

`up` checks the project folder, git, the runs folder and the lane programs. It prints one line for each check, then serves the room on one port. Open the address it prints, for example `http://127.0.0.1:5174/?live&bridge=http://127.0.0.1:5174`. The page opens live, on your folder.

- `up` turns both sources on. `--lanes` shows the runs started by the lane runner and by Dispatch. `--sessions` shows your own Claude Code and OpenCode sessions on that folder.
- `--no-sessions` leaves your sessions out. `--port <n>` picks another port.
- Quote the folder when its path has spaces.

Press Ctrl+C in the terminal to stop the room.

## What you see

- The hub: a flat ring in the middle. Each agent parks at its own slot, working or not. The orchestrator floats above the centre.
- Sectors: when sub orchestrators are set, the ring splits into one named arc for each sub and one for the main orchestrator. Each lane parks inside its arc. A sub orchestrator floats above its arc, smaller than the main one and joined to it by a thin line. `?replay&fixture=scenario-i` plays a two minute demo where two sub orchestrators and their lanes work. With no ladder the ring is as above.
- Folder cards: flat cards in a packed sphere around the hub, always facing you. The root sits below the hub and has no line. Lines join each top-level folder to the hub centre. The centre stands for the root and carries the project name. Every other folder joins its parent. Folders down to depth 2 are always drawn, up to 300 cards. Deeper folders appear while an agent works on them. They also appear if they were touched in the last 90 seconds, or if you pin them.
- The tunnel: while an agent works, one straight solid line runs from it to the row of the file it touches. It is yellow, with yellow stripes and small packets running toward the file. Four yellow corner brackets sit around that card.
- Colours:
  - White is activity. A read or write flashes the file row and its card white.
  - Yellow is active. The folder and the file an agent works on right now carry a dashed yellow outline, and the tunnel is yellow.
  - Green is finished work. A run that ends well turns the agent, its chip and the files it wrote green.
  - Red is failure. A failed tool call, test or run flashes red and leaves the file red until it is written again. A failed run turns the agent, its chip and the tunnel red.
- Terminal chips: a chip beside each agent, joined by a thin line. It shows the name and a status word: yellow working, red error, green done. Click it, or the Log button in the agent list, to read its log. `T` opens the focused agent's chip, or every chip when no agent is focused.
- The page: a menu across the top, the room in a wide lens below it, and a dock under the lens that scrolls. The dock holds the agent list on the left, the selected agent's context in the middle, and the settings and the cost board on the right. The context shows status, model, task, command, cost and the last log lines. An orchestrator also shows its context share and an Autocompact switch. Below 1280 pixels the columns stack in that order. Below 900 pixels the menu folds into one button. On a phone the lens keeps 300 pixels, the transport stacks, and the orchestrator chat is a full-width panel over the dock. The orchestrator chat stays fixed at the bottom right.
- The agent list, in the dock: one row for each agent, with its lane key, status and a Log button. With a ladder, the list groups under the main orchestrator, then a header for each sub with its name, state and lane count, then a `Main` header for the lanes in no sub. Working, queued, failed and recently finished lanes come first in each group. The rest sit under one collapsible idle row.
- A subagent appears beside its parent as a smaller shape with its own chip.
- Follow mode: `F` cycles wide, close up and off. It follows the card an agent is touching. A click in the room, `0` or `1` to `9` ends it.
- CONTROL at the top right, or `C`: opens the drawer with Dispatch, Tasks, Meters, Plan, Team and Reviews.
- ORCHESTRATOR beside it, or `/`: opens the chat with the room's orchestrator. It is there when the room runs with `--lanes`.
- The cost board in the dock shows this month's spend per lane from the run records.
- While any agent works, cards off its path dim, and the cards on the path glow.
- There is no randomness. The same recording always draws the same room.

## Ask the orchestrator for work

With `--lanes` on, click ORCHESTRATOR or press `/`. Write what you want built, press Send, then Start on the confirm card. Stop asks for confirmation before it stops a turn.

The orchestrator reads your project's own guide (`AGENTS.md`, `CLAUDE.md` or `docs/agents`) before it plans. It asks short questions, at most three at a time, and waits for the answers. Then it:

- splits the work into tasks that touch different files;
- starts each task as a lane run in its own git worktree beside your project, named `<project folder>-mr-<lane>`; the bridge starts them, so a run keeps going after the orchestrator's turn ends;
- wakes when a run ends, reads its log and record, checks the branch, and runs your project's tests and build;
- merges a passing branch into your project's current branch with a straight-line history, and makes no merge commit;
- writes a follow-up task when a branch fails;
- reports what landed, what failed and what is next.

It starts at most one run per lane. It never pushes. It ends its turn after it starts the runs, so the runs do not stop when the turn does.

When a session passes 80 percent of its context window, the orchestrator writes a short summary of the work and starts a new session from it. The Autocompact switch in the dock turns this off.

### Sub orchestrators

With the chat open, Attach adds a sub orchestrator. Give it a name, an id, a harness and model, the lanes it owns, one scope glob per line, and Restricted, which is on by default. A restricted sub is expected to change only the files in its scope. The bridge warns its parent when a lane branch goes outside it. Each sub gets its own sector of the ring and its own tab in the chat. Detach stops it behind a confirm card and returns its lanes to the main orchestrator. Lanes in no sub stay with the main orchestrator.

## Start one lane by hand

A lane is one agent on one harness. Press `C` or click CONTROL, then open Dispatch. The `Run on this project` section appears when the room runs with `--lanes`.

- Pick a lane, such as OpenCode or Claude Code.
- Write one task in the box.
- Press Run, then Confirm. The confirm card says the run spends money.
- Own worktree is on by default: the lane works in `<project folder>-mr-<lane>` beside your project, on its own queue branch, so several lanes can work at once and your folder is never touched. Each task is committed there when your project's tests pass.
- With Own worktree off, one task runs in your project folder itself. The runner then makes no branch, writes no recording, and does not run your tests.
- For several tasks, put a line with only `---` between them. The button reads `Run N tasks in order`. A queue needs a clean git folder: commit or stash first.
- To give several tasks to different lanes, turn on `One lane per task`. The button reads `Run N tasks on N lanes`. The confirm card lists each task with the idle lane it goes to, and each run starts in its own worktree. The button refuses when there are fewer idle lanes than tasks.
- A queue makes the branch `machineroom/queue-<lane>-<stamp>`. It runs your project's tests after each task, using `npm test` when `package.json` has a test script. It commits each task that passes and stops at the first failed task or test. It never touches your current branch and never pushes. It leaves the folder on the queue branch. `git switch -` goes back.

The Runs list in the panel shows the running and recent runs with their last lines.

## Replay a recorded run

- `/?replay` plays the recorded run that ships with the room. It needs no lane and no project.
- `/?replay&fixture=scenario-i` plays the demo ladder: two sub orchestrators and their lanes work, so the sectors and the chat tabs have something to show.
- A lane run on a brief writes a recording under `public/recordings/` in the MachineRoom folder and prints `room: /?recording=<name>`. Run `npm run build` again so the built room serves it, then open that link on the room's address.
- A run on a project and a queue write no recording. They are live only.
- `?replay&scale=200000` plays a seeded room of 200000 files in a tenth as many folders. `&fps` adds a frame time line. `?live&simulate` plays the recording through the live path with no lane and the badge reads `Demo`.

## Where the logs and records are

Every lane run writes its log to `%TEMP%\machineroom-runs` on Windows, or the system temp folder elsewhere.

- `<lane>-<briefs>-<stamp>.log` for a run on briefs.
- `<lane>-project-<stamp>.log` for one task on a project.
- `<lane>-queue-<stamp>-<number>.log` for a task in a queue.
- `<log name>.meta.json` beside a run on a project, with the lane, the project folder and the session id, and the queue branch when there is one.
- `runs.jsonl` has one record for each run: lane, model, start, minutes, exit code, cost, tokens, log and branch.
- `outcomes.jsonl` has the outcomes you record with `npm run outcome`.
- The orchestrator's chat and session live in `orchestrator-<hash>.json`, and each turn writes `orchestrator-chat-<stamp>.log`.

The runner prints `log:` and `record:` at the end of a run.

## Five common problems

### A lane program is not found

The doctor prints `FAIL The OpenCode lane program was not found: <path>.` or the same for another lane. The room still opens, but that lane cannot start.

Install the program, sign in, and check that it starts in the same shell (`opencode --version`, `claude --version`). If it is installed somewhere else, put its full path in `cli.bin` for that lane in `docs/agents/lanes.json`, then run the doctor again.

### The doctor prints FAIL lines

Run the doctor on the folder you watch:

```
npm run serve -- doctor --root <your project folder>
```

It checks that the project folder exists, git is on the PATH, the runs folder can be written, and every lane program is found. It prints `ok` or `FAIL` for each line and exits 1 on a failure. Fix the failed line and run it again. `up` prints the same lines and opens the room anyway, with `Some checks failed. The room opens anyway.`

A line that names an environment variable that is not set means the lane's `cli.bin` uses `%NAME%`. Set that variable, or use a full path.

### A dirty project is refused

The run is refused with `The project folder <folder> has uncommitted changes. Commit or discard them, or pass --allow-dirty.` Commit or stash your work, then start the run again. In Dispatch, a single task can start with `Allow uncommitted changes` turned on. A queue always needs a clean folder, so that switch stays off for several tasks.

### A port is taken

The room stops with `machine-room could not start:` and a message that the address is already in use. Another room or program has the port, 5174 by default. Pick another one:

```
npm run serve -- up --root <your project folder> --port 5175
```

Or set `PORT`. The room prints the new address. `--port 0` picks a free port.

If another room is already running on the same project, the message names that room instead, and a new port does not help. Open the address the first room printed, or stop that room.

### No agents are shown

When `--lanes` is on, the room lists one agent for each lane in `docs/agents/lanes.json` that is not retired. If the list is empty:

- You started `npm run serve` without `--lanes` or without `up`. Start with `up`, or add `--lanes`.
- The page is in replay mode. Open the `/?live&bridge=...` address the command printed, or press Live.
- The bridge is not answering. The waiting card says the feed is unreachable. Start the room again and open the printed address.

## Screenshots

![The overview of the room](docs/images/overview.png)

The overview, with the hub, the parked agents and the folder sphere.

![One touched card, close up](docs/images/closeup.png)

Follow mode close up on the card an agent is touching.

![The connect screen](docs/images/connect.png)

The connect screen.

![The control drawer](docs/images/drawer.png)

The control drawer open on Dispatch.

![A seeded room](docs/images/scale.png)

A seeded room at 40000 files.

## Harnesses

| Harness | State | What the room reads |
| --- | --- | --- |
| OpenCode | In use: lanes `opencode`, `opencode2` to `opencode10` | `tool_use` lines, with the tool, its file or command and its result |
| Claude Code | In use: lane `claude` and the orchestrator | stream-json `tool_use` and `tool_result` lines, and a `Task` or `Agent` child while it works |
| Hermes | Supported, retired | plain `read` and `delegate` lines |
| AGY | Supported, retired | `step_update` lines, and `invoke_subagent` for a subagent |
| ACP | Supported: no lane yet | `tool_call` updates, with each kind and location mapped to a touch |

Hermes and AGY are retired for now in `docs/agents/lanes.json`. Remove `"retired": true` from one entry to bring it back, then check its `cli` block and model. Any Agent Client Protocol agent can be added as a lane with its own `cli.bin` and args; it runs through `scripts/acp-run.mjs`. The harness plan is in `docs/agents/HARNESSES.md`.

## Develop it

`npm run dev` serves the viewer on port 5173, with no build. It needs a bridge for live data: run `npm run build` once, start `npm run serve` in another terminal, then open `http://localhost:5173/?live&bridge=http://127.0.0.1:5174`. `npm run build` then `npm run serve` serves the built viewer and the bridge on one port. `npm run preview` serves the built viewer through Vite, with no bridge.

The project folder defaults to the folder you start in; `--root <folder>` or `PROJECT_ROOT` names another. The bridge listens on port 5174 by default; `--port <n>` or `PORT` changes it.

## Big repositories

The room was measured on seeded trees of 40000 and 200000 files.

- `GET /api/tree` holds about 0.6 MB in the folder shape at 40000 files, and 115 KB gzipped. At 200000 files it holds about 3.1 MB, and 570 KB gzipped.
- The answer carries a version. A page's first `tree` event holds only the files added since the list it read, and each later event only the files that page has not had.
- Shell commands and Hermes reads look names up from an index, so they cost the same at any repository size.
- The sphere layout compares pairs only on the top-level shell, so stacks and fans take one pass. The room runs the layout when a card appears, leaves or changes size, and a warm start keeps every card whose role did not change.
- The overview fits the hub, the root and the always-present cards. At 40000 files its distance is about 4200 units (largest about 4700), so the cards are small in the overview. Follow mode is the way to read the card an agent touches.

Try it with the dev server:

```
npm run dev
```

Open `/?replay&scale=200000&fps`. The frame line sits in the top left panel. `npm run scale-probe` times each stage of the room on a seeded tree in memory and prints the covered top cards, the tallest layout and the overview distance; `--files` and `--folders` change its size.

## The control drawer

The drawer needs a control client. It is there in replay, the demo and a live room through a bridge. With a control client, the drawer has up to six tabs.

- Dispatch: pick an open brief to see its prompt and route, or run a task on your project when `--lanes` is on. The Route row suggests a lane and model, with a Use button when the policy names one. The Runs list shows running and recent lane runs.
- Tasks: open and finished tasks from the lane runs. A task with a live run reads `running AGENT` or `queued AGENT`. Open one to read its thread. A write is refused.
- Meters: this month's spend per lane from the run records. A budget change is refused.
- Plan: write a goal and ask the planner behind a confirm card; the bridge answers that plans come from lane runs. Each brief shows its size, files, tests and route. Tick the ones to add to `docs/agents/TASKS.md` behind a second confirm card, then open one in Dispatch with `Dispatch <id>`.
- Team: the lanes from `docs/agents/lanes.json`. New lanes are added in that file.
- Reviews: each lane's branch, commits ahead, files and last run. Click a row for the diff. Merge opens a confirm card with a message and merges the head you read.

## Working with lanes

A lane is one agent. On this repository, each lane has its own worktree and branch, listed in `docs/agents/lanes.json`. Ten OpenCode lanes (`opencode` and `opencode2` to `opencode10`) and the `claude` lane are live. `hermes` and `agy` are retired, so `npm run run-lane` refuses them. Remove `"retired": true` from a lane entry to bring it back. The drawer can start a local lane run on an open brief and show the result.

- Start a lane run. Press `C`, open Dispatch, pick a brief, then Run now. The confirm card names the lane, model and brief and says it spends money. Confirm starts the lane in its own worktree. The Runs list shows its last lines and its record.
- Start one from a terminal. `npm run run-lane -- opencode <brief>` starts a lane on the open brief you name. The `claude` lane runs Claude Code, and `npm run run-lane -- claude --project <folder> --task "Fix the failing test."` starts it on another folder. `--dry-run` prints the command, `--list` shows the last 10 runs, and `--stats` shows runs, minutes and cost per lane and model.
- Record an outcome. `npm run outcome -- <branch> merged --grade A-` records how a lane run ended. `npm run run-lane -- --outcomes [--since YYYY-MM-DD]` prints the merge table.
- See it in the room. With `--lanes`, the room draws a run live as its log grows, with its reads and writes on the project's cards, and turns the lane green or red when the run ends. A run on a brief also writes a recording under `public/recordings/` and prints `room: /?recording=<name>`.
- Try a lane's build beside the stable room. `npm run candidate -- <lane>` builds that worktree and serves it on port 5175, with its own bridge. Leave the stable room running and compare the two. It refuses a lane with no worktree, a worktree with uncommitted changes, and a port in use. See `docs/agents/CANDIDATE.md`.
- Clean up the worktrees a project leaves. `npm run worktrees -- --project <folder>` lists each `<project folder>-mr-<lane>` with its branch, commits ahead of the project's branch, uncommitted changes and whether it is merged. Add `--clean` to remove only the clean merged ones. It never deletes a branch and never forces a removal. It leaves a lane whose lock file names a live process.
- Review and merge. Press `C`, open Reviews. Each lane shows its branch, commits ahead, files and last run; click it for the diff. Merge is offered on a lane with commits ahead and no uncommitted changes, after a confirm card with a one-line message. The bridge merges one lane at a time, needs the main checkout on main with no uncommitted changes, a clean lane and the lane's exact head, stops on a conflict and leaves main as it was. It never pushes.

## Run a lane from a terminal

To start a lane on a folder without Dispatch, name the folder with `--project` and give it a task or a UTF-8 file that holds it:

```
npm run run-lane -- opencode --project <folder> --task "Fix the failing test."
npm run run-lane -- opencode --project <folder> --task-file task.md
```

Add `--dry-run` to print the program, its arguments and the folder, and start nothing.

The runner refuses the MachineRoom checkout, a lane worktree and a git folder with uncommitted changes. Pass `--allow-dirty` to allow a dirty folder. It runs the harness in that folder, makes no branch, reads no brief and writes no recording. The room shows the run live, with its reads and writes on that folder's cards.

Add `--worktree` to run in a git worktree of the project instead of the project itself. The runner puts the worktree beside the project at `<parent of the project>/<project folder name>-mr-<lane>`. It makes the worktree from the project's HEAD when it is missing, and reuses it when it is there and clean. It refuses a worktree with uncommitted changes and names its path. When the project has `node_modules`, the worktree gets a junction to it on Windows or a symlink elsewhere. A queue with `--worktree` makes its branch in the worktree. The run's record names the worktree as the project, so a room started on the project still shows the run. `--dry-run` prints the worktree path and whether it would be made.

To run a queue of tasks on that folder, write them in a plain text file with a line that holds only `---` between them, then:

```
npm run run-lane -- opencode --project <folder> --queue queue.txt --test "npm test"
```

A queue needs a clean git folder, so keep the queue file outside it or commit it first. Before the first task the runner makes the branch `machineroom/queue-<lane>-<stamp>` from the folder's current HEAD. Each task runs as its own run, then the test command runs. A task that ends well and passes its tests is committed on that branch with its first line as the subject; a task with no change is noted and the queue goes on. The first failed task or failed test stops the queue and leaves that task's changes uncommitted for you to look at. `--test` defaults to `npm test` when the folder's `package.json` has a test script, and to none otherwise, so a task then passes on the exit code alone. `--minutes` limits each task. The queue never pushes and never touches the main branch. It leaves the folder on the queue branch and prints the branch and one line per task; `git switch -` goes back.

With `--lanes`, the Dispatch panel can start the same kind of run on the room's own folder: pick a lane, write one task or several separated by a line of `---`, and turn on `Allow uncommitted changes` when the folder has them and you run a single task. A queue needs a clean folder, so that switch is off then.

With `--sessions`, the room follows your own Claude Code and OpenCode sessions on that folder too. Start it with `npm run serve -- up --sessions --root <folder>`. It reads the session files Claude Code keeps in `.claude/projects` under your profile for that folder. It keeps only the lines whose `cwd` is the folder or inside it. It shows each prompt as a run and each tool call on the room's cards, and follows a subagent through its own file. A run that `run-lane` starts on the same folder is skipped, because the runner names its session and the bridge leaves that session out. The room does not show it twice. OpenCode sessions come from OpenCode's own database (`.local/share/opencode/opencode.db` under your profile), opened read-only. The bridge reads only its two session tables, never the ones that hold your accounts and keys. Only tool calls and their results reach the room, never your prompts or the replies.

A lane's `cli.model` can name a `provider/model` from any OpenAI-compatible provider in OpenCode's own config. The key stays in that config or an environment variable, never in `docs/agents/lanes.json` or this repository. MachineRoom does not set up a provider and does not read the key.

## What it never does

- It never pushes to a remote.
- The Reviews panel merges a lane only after its confirm card. The bridge also refuses a merge without an explicit confirm and the lane's exact head.
- The room starts a lane run from a button only after a confirm card that says it spends money. The orchestrator starts the runs you asked it for after you confirm your first message.
- A run on a project refuses the MachineRoom checkout and the lane worktrees in `docs/agents/lanes.json`.

## Keys

- `Space` play or pause replay
- `0` overview camera
- `1` to `9` focus agent 1 to 9
- `F` follow the card an agent is touching: wide, close up, off
- `T` show or hide the log of the selected agent, or of every agent
- `Left` and `Right` arrows seek backward or forward 5 seconds
- `[` and `]` decrease or increase replay speed
- `/` open the orchestrator chat, or the assistant terminal when the room has no orchestrator
- `L` toggle the event log
- `C` toggle the control drawer
- `?` toggle keyboard help

MachineRoom prints and stores no key. The bridge needs no key to run: the assistant route runs OpenCode, which uses the login on this computer, and only the optional decision route reads `OPENROUTER_API_KEY` from the environment (without it that route answers 404). The assistant refuses text that looks like a key. The bridge masks key-shaped text in the log chunks, messages and errors it sends, including a key split across two or more chunks; a held chunk delays frames by at most 1 second.

## Recordings

Every run started with `npm run run-lane` on a brief, including Run now in Dispatch for a brief, writes a recording under `public/recordings/` when it ends, and prints `room: /?recording=<name>`. If it cannot write one, it prints why. A project run and a queue run write no recording; they show live in the room with `--lanes`. The name is the run's log name. `public/recordings/index.json` lists the last 50, newest first, with lane, briefs, model, start, minutes, exit code, frames and tool calls. `npm run run-recording -- 1` writes a recording from the newest run record again. The folder is not in git.

The built room serves the recordings from `dist/recordings`, so run `npm run build` again after a new one.

## Checks

```
npm test
npm run build
npm run serve -- doctor --root <your project folder>
npm run history-audit
npm run pack-check
```

- `npm test` runs vitest in Node with no browser.
- `npm run build` also catches broken imports.
- `npm run serve -- doctor --root <folder>` checks the project folder, git, the runs folder and the lane programs, starts nothing, and exits 1 when a check fails.
- `npm run history-audit` scans main, the tags and the tracked files for keys, e-mail addresses, Windows user paths, the profile name and paths into one private folder. A key shows only its first 4 characters and its length. It exits 1 on any finding.
- `npm run pack-check` checks what `npm pack` would hold. It fails on a file the one-port command needs but the pack leaves out, and on `.env`, tests, recordings, `node_modules`, `.git` or a log file in the pack.

## Working on MachineRoom

The guide is `docs/agents/ARCHITECTURE.md`. The order of work is in `docs/agents/PLAN.md`, the briefs are in `docs/agents/TASKS.md` and the rules every agent follows are in `docs/agents/HOUSE-RULES.md`.

- One branch per task, in the agent's own worktree.
- Touch only the files the brief names.
- Run `npm test` and `npm run build` before a commit. Both must pass.
- Never push. The orchestrator reviews and merges each branch.

## Licence

The licence is not chosen yet.

## History

MachineRoom grew out of [Paperclip](https://github.com/paperclipai/paperclip), where its idea of a company of agents with tasks, budgets and approvals comes from. It is an independent project, not made by or endorsed by Paperclip. The room now runs its agents through its own lane runner (`npm run run-lane`) and follows your own sessions.
