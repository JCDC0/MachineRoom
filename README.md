# Machine Room

A browser viewer that shows coding agents working on one project as a 3D machine room. The agents park on a hub and the project folders sit on a sphere around them. It can follow a local Paperclip instance live, or replay a recorded run.

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

## What you see

- The hub: a flat ring in the middle. Each agent parks at its own slot there, between runs and while it works. The orchestrator floats above the middle of the ring.
- Agent shapes: each agent is its own wireframe shape. A working agent shows it by its status ring, its chip and a slow pulse of its shape.
- Subagents: a child reported by an OpenCode or Hermes run appears beside its parent as a smaller shape with its own chip, joined to the parent by a short line. It fades out after 1.5 seconds, because the harness reports it only when it ends.
- Terminal chips: a chip beside each agent, joined by a thin line. It shows the name and a status ring, and opens to show the log.
- Agent callouts: a thin line from an agent to a block with its name, the task its run works on and the command it runs now. The border is yellow while it works, red on a failure and green with `FINISHED` for 5 seconds after a good run.
- Folder sphere: flat cards on shells around the hub, always facing the camera. The root sits below the hub. Top-level folders spread around the sphere, and deeper folders sit farther out near their parent. Straight lines join each top-level folder and the root to the hub centre, and every deeper folder to its parent.
- The tree: every folder down to depth 2 is always drawn, up to 300 cards. The rest stay as faint folders behind their parent. Folders below that depth appear, with a short fade, while they are on an agent's path. A folder that holds a file being touched lists up to 10 items.
- The strip: while an agent works, a yellow strip of three straight segments runs from it to the row of the file it touches, and four yellow corner brackets sit around that card. The strip is green for 5 seconds after a good run and red when the run fails.
- Follow mode: `F` cycles wide, close up and off. Wide shows the touched card and its parent, and close up shows the card alone. The camera holds each card at least 4 seconds and eases over 1.2 seconds. Clicking an agent, `0` or `1` to `9` ends it.
- Each colour has one meaning:
  - White is activity. A read or write flashes the file row and its card white.
  - Yellow is active. The folder and the file an agent works on right now carry a dashed yellow outline, and the strip to the file is yellow.
  - Red is failure. A failed tool call, run or test flashes red and leaves the file red until it is written again. The strip turns red when the run fails.
  - Green is finished work. A run that ends well turns the agent, its chip and every file it wrote in that run green. The strip stays green for 5 seconds.
- While any agent works, cards off the working agents' paths dim to 0.25 with their lines, and the cards on a path to a touched file glow with a soft light on the border.
- Settings: the Settings button at the top right opens a panel. Folder depth is a slider from 1 to 3, 2 by default, for how many folder levels are always drawn. Five screen effects have an on switch and a strength: fish eye, chromatic aberration, vignette, grain and fine dust. Fish eye and chromatic aberration start off. Vignette, grain and fine dust start on at low strength. The choices are saved in this browser with the connection.
- Cost board: below the hub. It shows the spend against the budget, a row per agent with cost, tokens and a share bar, and the provider quota windows. It is hidden under 900 pixels wide.
- Health chip: under the Replay and Live switch, and only when something is wrong. It names a bridge that does not answer, a Paperclip that is not connected, routes that changed or a route check that did not run.
- Control drawer on `C`: Dispatch, Tasks, Approvals, Meters, Plan, Agents and Reviews. The drawer section below describes each tab.

There is no randomness. The same recording always draws the same room.

## Run it

MachineRoom follows a Paperclip instance on this machine. It never starts Paperclip. You need Node 24 or newer.

Start Paperclip yourself, in its own terminal:

```
paperclipai run
```

Then build the viewer and serve it with the bridge on one port:

```
npm install
npm run build
npm run serve -- up --company <id>
```

`--company` is the company to follow, from Paperclip's company list. `PAPERCLIP_COMPANY_ID` does the same. The project folder defaults to the folder you start in; `--root <folder>` or `PROJECT_ROOT` names another. The bridge listens on port 5174 by default; `--port <n>` or `PORT` changes it, and `--paperclip <url>` or `PAPERCLIP_URL` names another Paperclip.

`up` runs the checks, prints one `ok` or `FAIL` line for each, then serves the room and prints the address to open:

- Paperclip answers, and its version.
- Its spec lists every route the bridge uses.
- The company is in Paperclip's list.
- The project folder exists.
- The newest database backup is under a day old.

A failed check does not close the room. A part whose routes changed stays off, and its panel says so.

`npm run serve -- doctor` runs those checks alone, starts nothing, and exits 1 when one fails. `doctor` takes `--paperclip`, `--company` and `--root`. `serve` and `up` also take `--port <n>`. The environment variables `PAPERCLIP_URL`, `PAPERCLIP_COMPANY_ID` and `PROJECT_ROOT` do the same; `PORT` sets the port for `serve` and `up`.

### Without Paperclip

After a build, `npm run serve -- up` still serves the room. The Paperclip checks print FAIL, and the replay and the simulated feed work without Paperclip.

The first visit shows a connect screen, and the replay is one of its choices. An address skips the screen:

- `/?replay` plays the recorded run.
- `/?replay&scale=200000` plays a seeded room of 200000 files in a tenth as many folders, with three agents touching files at random. The number is a whole number from 1000 to 500000.
- `&fps` adds a line in the HUD's top left panel with the median and p95 frame time over the last 120 frames.
- `/?live&simulate` plays the same recording through the live path. The badge reads `Demo`. Add `&speed=3` to play faster; the speed is clamped from 0.25 to 64.
- `/?recording=<name>` opens a recording of a lane run.
- `/?live&bridge=http://127.0.0.1:5174` follows Paperclip through a bridge.
- `/?connect` shows the connect screen again.

Drag to turn the view. Scroll to zoom.

## Big repositories

The room was measured on seeded trees of 40000 and 200000 files.

- `GET /api/tree` holds about 0.6 MB in the folder shape at 40000 files, and 115 KB gzipped. At 200000 files it holds about 3.1 MB, and 570 KB gzipped.
- The answer carries a version. A page's first `tree` event holds only the files added since the list it read, and each later event only the files that page has not had.
- Shell commands and Hermes reads look names up from an index, so they cost the same at any repository size.
- The sphere layout compares every pair of cards on a shell. A cold layout of 300 cards takes about 110 ms, and an added card about 1 ms. The room runs it when a card appears, leaves or changes size.
- The overview fits every drawn card. At 40000 files a deep path can span about 9700 units from the lowest card to the highest, so the cards are small in the overview. Follow mode is the way to read the card an agent touches.

Try it with the dev server:

```
npm run dev
```

Open `/?replay&scale=200000&fps`. The frame line sits in the top left panel. `npm run scale-probe` times each stage of the room on a seeded tree in memory and prints the overlaps, moves, worst move and height; `--files` and `--folders` change its size.

## The control drawer

The drawer needs a control client. It is there in replay, the demo and a live room through a bridge; it is not there when the page talks to Paperclip directly through the Vite proxy. With a control client, the drawer has up to seven tabs.

- Dispatch: pick an open brief to see its prompt and route, or write a task for an agent. The Route row suggests a lane and model, with a Use button when the policy names one, and the Runs list shows running and recent lane runs.
- Tasks: open and finished tasks. A task with a live Paperclip run reads `running AGENT` or `queued AGENT`. Open one to read its thread and post a comment.
- Approvals: pending requests with Approve, Request changes and Reject, an optional note, and a list of decided ones.
- Meters: company and agent budgets, spend, provider quotas, and the age of the newest Paperclip backup. Back up now sits behind a confirm card.
- Plan: write a goal and ask the planner behind a confirm card. Each brief shows its size, files, tests and route. Tick the ones to add to `docs/agents/TASKS.md` behind a second confirm card, then open one in Dispatch with `Dispatch <id>`.
- Agents: hire an agent, or edit its name, harness, role, model, limits, budget and instructions.
- Reviews: each lane's branch, commits ahead, files and last run. Click a row for the diff. Merge opens a confirm card with a message and merges the head you read.

## Working with lanes

A lane is one agent with its own worktree and branch, listed in `docs/agents/lanes.json`. The drawer can start a local lane run on an open brief and show the result.

- Start a lane run. Press `C`, open Dispatch, pick a brief, then Run now. The confirm card names the lane, model and brief and says it spends money. Confirm starts the lane in its own worktree. The Runs list shows its last lines and its record.
- See it in the room. A lane run is not a Paperclip run, so the live room does not draw it. When it ends, it writes a recording under `public/recordings/` and prints `room: /?recording=<name>`; open that address to replay it in the room.
- Try a lane's build beside the stable room. `npm run candidate -- <lane>` builds that worktree and serves it on port 5175, with its own bridge. Leave the stable room running and compare the two. It refuses a lane with no worktree, a worktree with uncommitted changes, and a port in use. See `docs/agents/CANDIDATE.md`.
- Review and merge. Press `C`, open Reviews. Each lane shows its branch, commits ahead, files and last run; click it for the diff. Merge is offered on a lane with commits ahead and no uncommitted changes, after a confirm card with a one-line message. The bridge merges one lane at a time, needs the main checkout on main with no uncommitted changes, a clean lane and the lane's exact head, stops on a conflict and leaves main as it was. It never pushes.

## What it never does

- It never starts or stops Paperclip. Start it yourself with `paperclipai run`.
- It never pushes to a remote.
- It merges a lane only after the Reviews confirm card. The bridge also refuses a merge without an explicit confirm and the lane's exact head.
- It starts a lane run or asks the planner only after a confirm card that says it spends money. `Start task` is different: it creates a task in Paperclip, which can wake its agent at once, so that path can spend without a card.

## Keys

- `Space` play or pause replay
- `0` overview camera
- `1` to `9` focus agent 1 to 9
- `F` follow the card an agent is touching: wide, close up, off
- `T` show or hide the log of the selected agent, or of every agent
- `Left` and `Right` arrows seek backward or forward 5 seconds
- `[` and `]` decrease or increase replay speed
- `/` open the assistant terminal
- `L` toggle the event log
- `C` toggle the control drawer
- `?` toggle keyboard help

MachineRoom prints and stores no key. The bridge reads the key it needs from the environment, and the assistant refuses text that looks like a key. The bridge masks key-shaped text in the log chunks, messages and errors it sends, including a key split across two or more chunks; a held chunk delays frames by at most 1 second. The proxy route has no bridge; the page masks the frames it reads itself, with the same rule and the same 1 second hold.

## Recordings

Every run started with `npm run run-lane`, including Run now in Dispatch, writes a recording under `public/recordings/` when it ends, and prints `room: /?recording=<name>`. If it cannot write one, it prints why. The name is the run's log name. `public/recordings/index.json` lists the last 50, newest first, with lane, briefs, model, start, minutes, exit code, frames and tool calls. `npm run run-recording -- 1` writes a recording from the newest run record again. The folder is not in git.

## Checks

```
npm test
npm run build
npm run doctor
npm run history-audit
npm run pack-check
```

- `npm test` runs vitest in Node with no browser.
- `npm run build` also catches broken imports.
- `npm run doctor` compares a running Paperclip's spec with the routes and fields the bridge uses, and names each missing or changed one.
- `npm run history-audit` scans main, the tags and the tracked files for keys, e-mail addresses, Windows user paths, the profile name and paths into one private folder. A key shows only its first 4 characters and its length. It exits 1 on any finding.
- `npm run pack-check` checks what `npm pack` would hold. It fails on a file the one-port command needs but the pack leaves out, and on `.env`, tests, recordings, `node_modules`, `.git` or a log file in the pack.

The code is described in `docs/agents/ARCHITECTURE.md`.
