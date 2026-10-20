# Machine Room

A browser viewer that shows coding agents working on one project as a 3D machine room. Each agent is a shape in the room. It follows a local Paperclip instance live, or replays a recording of a run.

Screenshots come with G4.

## What you see

- The hub: a flat ring in the middle. Each agent parks at its own slot there between runs.
- Agent shapes: each agent is its own wireframe shape. A working agent leaves the ring and stands in front of the folder it works in.
- Terminal chips: a chip beside each agent, joined by a thin line. It shows the name and a status ring, and opens to show the log.
- Folder cards: the project folders are flat cards around the hub, joined parent to child by curved strings. Only the folders on the agents' paths open.
- Four colours, one meaning each:
  - White is activity. A read or write flashes the file row and its card white.
  - Yellow is active. The folder and the file an agent works on right now carry a dashed yellow outline, and the trace from its chip to the file is yellow.
  - Red is failure. A failed tool call, run or test flashes red and leaves the file red until it is written again.
  - Green is finished work. A run that ends well turns the agent, its chip and every file it wrote in that run green.
- Health chip: under the Replay and Live switch, and only when something is wrong. It names a bridge that does not answer, a Paperclip that is not connected, or routes that changed.
- Control drawer on `C`: dispatch, tasks and their thread, approvals, meters, agents. Meters shows the spend and the age of Paperclip's newest database backup, with a Back up now button.

There is no randomness. The same recording always draws the same room.

## Run it

MachineRoom follows a Paperclip instance on this machine. It never starts Paperclip.

Start Paperclip yourself, in its own terminal:

```
paperclipai run
```

Then build the viewer and serve it with the bridge on one port:

```
npm install
npm run build
npm run serve -- up
```

`up` checks Paperclip first and prints one `ok` or `FAIL` line for each check:

- Paperclip answers, and its version.
- Its spec lists every route the bridge uses.
- The company is in Paperclip's list.
- The project folder exists.
- The newest database backup is under a day old.

Then it serves the room, whether the checks passed or not, and prints the address to open. A failed check does not close the room. A part whose routes changed stays off, and its panel says so.

`npm run serve -- doctor` runs those checks alone, starts nothing, and exits 1 when one fails. Flags: `--paperclip <url>`, `--company <id>`, `--root <folder>`, `--port <n>`. `PAPERCLIP_URL`, `PAPERCLIP_COMPANY_ID`, `PROJECT_ROOT` and `PORT` do the same.

### Without Paperclip

`npm run serve -- up` still serves the room. Its checks print FAIL, and the replay and the simulated feed work without Paperclip.

The first visit shows a connect screen, and the replay is one of its choices. An address skips the screen:

- `/?replay` plays the recorded run.
- `/?live&simulate` plays the same recording through the live path. The badge reads `Demo`.
- `/?recording=<name>` opens a recording of a lane run.
- `/?connect` shows the connect screen again.

Drag to turn the view. Scroll to zoom.

## Working with lanes

A lane is one agent with its own worktree and branch, listed in `docs/agents/lanes.json`. The room can give a lane a task and follow it.

- Give a task from the drawer. Press `C`, open Dispatch, pick a brief or write a title and a description, choose the agent, then Start task. Run now starts that lane on the brief in its own worktree, after a confirm card that says it spends money.
- Watch it in the room. The agent leaves the hub, stands at the folder it works in, and its chip shows the log. Yellow marks the file it touches now. Green marks a run that ends well.
- Read the reply in the thread. Press `C`, open Tasks, pick the task. The comments under it are the agent's answer.
- Try a lane's build beside the stable room. `npm run candidate -- <lane>` builds that worktree and serves it on port 5175, with its own bridge. Leave the stable room running and compare the two. It refuses a lane with no worktree, a worktree with uncommitted changes, and a port in use. See `docs/agents/CANDIDATE.md`.
- Merge only after a confirm. A merge goes through the bridge with the lane's head commit and an explicit confirm. It runs one merge at a time, needs a clean main checkout, stops on a conflict and leaves main as it was. It never pushes.

## Keys

- `Space` play or pause replay
- `0` overview camera
- `1` to `9` focus agent 1 to 9
- `F` follow the working agent: wide, close up, off
- `T` show or hide the log of the selected agent, or of every agent
- `Left` and `Right` seek backward or forward 5 seconds
- `[` and `]` decrease or increase replay speed
- `/` open the assistant terminal
- `L` toggle the event log
- `C` toggle the control drawer
- `?` toggle keyboard help

MachineRoom prints and stores no key. The bridge reads the key it needs from the environment, and the assistant refuses text that looks like a key.

## Recordings

Every lane run started with `npm run run-lane` writes a recording when it ends, and prints `room: /?recording=<name>`. `public/recordings/index.json` lists the last 50, newest first.

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
- `npm run doctor` compares a running Paperclip's spec with the routes the bridge uses, and names each missing one.
- `npm run history-audit` scans main, the tags and the tracked files for keys, e-mail addresses, Windows user paths, the profile name and paths into one private folder. A key shows only its first four characters and its length. It exits 1 on any finding.
- `npm run pack-check` checks what `npm pack` would hold. It fails on a file the one-port command needs but the pack leaves out, and on a key, test, recording, module or log file in the pack.

The code is described in `docs/agents/ARCHITECTURE.md`.
