# Machine Room

A browser viewer that shows coding agents working on one project as a 3D machine room. Each agent is a shape in the room. It follows a local Paperclip instance live, or replays a recording of a run.

![Machine Room overview](docs/images/overview.png)

![Machine Room close-up follow view](docs/images/closeup.png)

![Machine Room connect screen](docs/images/connect.png)

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

There is no randomness. The same recording always draws the same room.

## Run it

```
npm install
npm run dev
```

Open `http://localhost:5173`. The first visit shows a connect screen with four choices: the bridge, Paperclip directly, the demo, or the recorded replay. The choice and the replay speed are remembered.

Start the bridge in another terminal for the first choice:

```
npm run bridge
```

It listens on port 5174. See `.env.example`.

An address skips the connect screen:

- `/?connect` shows the connect screen again.
- `/?replay` opens the recorded replay.
- `/?live` goes straight to Paperclip through the Vite proxy.
- `/?live&bridge=http://127.0.0.1:5174` goes through the bridge.
- `/?live&simulate` plays the recording through the live path with no Paperclip.
- `/?recording=<name>` opens a lane run recording.

Drag to turn the view. Scroll to zoom.

## One port

```
npm run build
npm run serve
```

`npm run serve` starts the bridge and serves the built viewer on one port, 5174 by default, with no Vite and no proxy. It prints the address to open.

Flags: `--paperclip <url>`, `--company <id>`, `--root <folder>`, `--port <n>`, `--dist <folder>`, `--help`. The first four also read `PAPERCLIP_URL`, `PAPERCLIP_COMPANY_ID`, `PROJECT_ROOT` and `PORT`.

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

## Recordings

Every lane run started with `npm run run-lane` writes a recording of that run. It prints `room: /?recording=<name>` when the run ends. Open that address to watch the run again. `public/recordings/index.json` lists the last 50 recordings, newest first.

## Checks

```
npm test
npm run build
npm run doctor
```

`npm test` runs vitest in Node with no browser. `npm run build` also catches broken imports. `npm run doctor` compares the routes of a running Paperclip with the routes the bridge uses, and names each missing one.

The code is described in `docs/agents/ARCHITECTURE.md`.
