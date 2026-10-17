# MachineRoom architecture

Version 0.1.23. A browser viewer that shows coding agents working on one project as a 3D machine room. It can replay a recorded run or follow a live Paperclip instance.

## What it shows

- The core in the middle is the Machine: the Paperclip control plane.
- Each agent is a wireframe shape on a ring around the core. It moves above the folder it is working in.
- Each agent has a terminal on the terminal wall above the room, joined to its agent by a thin line.
- The project folders are tiles floating in 3D space around the Machine, at different heights, joined parent to child by sagging strings (curved lines). Each file is a plane. A folder opens when an agent touches it: root first, then each subfolder in turn.
- Colour has one meaning each: white is activity, red is failure, yellow is finished work.
  - A read or write flashes the file white.
  - A failed tool call, a failed run or a failed test flashes red and leaves the file red until it is written again.
  - A run that ends well turns the agent, its terminal and every file it wrote in that run yellow.
- There is no randomness. The same recording always draws the same room.

## Commands

```
npm install
npm run dev        http://localhost:5173
npm run bridge     local bridge to Paperclip, port 5174 (see .env.example)
npm test           vitest, node environment, no browser needed
npm run build
npm run fixtures -- <raw-events.jsonl> <sandbox-folder> <ids.json>
```

The lint command is the build. There is no separate linter yet.

## Layout of the code

```
src/model/        pure logic, no DOM, fully tested
  paths.js          path cleanup, ancestors, tree builder
  commands.js       files and folders a shell command touches
  parsers/          one parser per agent type (claude, hermes, opencode, agy)
  pipeline.js       Paperclip frames -> activities (createPipeline for streams, buildActivities for a batch)
  log.js            activities -> event log lines and run markers
  state.js          activities -> room state (agents, files, folders)
  player.js         replay clock, seek, speed, idle compression
  source.js         parse and prepare a recording
  replay.js         fetch the recording from public/fixtures
src/engine/       three.js scene, no React
  layout.js         deterministic 3D folder layout, no overlap, warm start on growth (pure, tested)
  route.js          the folders an agent passes between two folders (pure, tested)
  strings.js        curved strings between folders (curvePoint is pure, tested)
  room.js           builds the scene, runs the frame loop, reacts to activities, follow mode
  clusters.js       folder tiles and file planes, glides to new positions, recolours only what changed
  labels.js         file name labels that rise and fade when a file is read, written or fails
  agents.js         agent shapes, movement, link lines
  terminals.js      CSS3D terminals on the wall
  core.js           the Machine
  camera.js         orbit, zoom, focus, fit to the bounding sphere (pure fitDistance, tested)
  sprites.js        colours and helpers (copied from the portfolio void engine)
src/control/      the control client contract and its mock (see CONTROL-CLIENT.md)
src/assistant/    request router: closed action list, rule based intent, key guard, model reply parser (pure, tested; see CONTROL-PLANE.md)
src/ui/           React HUD: agents, transport with run markers, event log, mode switch, help
  panels/           control drawer on `C`: dispatch, tasks and thread, approvals, meters (uses only the control client)
src/live/         live mode: agent discovery, socket, bridge client, live player, simulated feed
server/           the bridge: Paperclip frames, agent list and file tree for the browser
src/Stage.jsx     wires player, room and HUD together
src/App.jsx       chooses the first screen (connect, replay or live), loads the data, shows loading, empty and error states
src/startup.js    pure: which screen to open from the address and the saved connection (tested)
src/storage.js    safe access to localStorage
public/fixtures/  the recorded run, agent list and file tree
tests/            vitest
```

## Data flow

1. Paperclip sends frames on `ws://HOST/api/companies/:id/events/ws`. A frame is `{id, companyId, type, createdAt, payload}`.
2. `pipeline.js` turns frames into activities. `heartbeat.run.log` carries raw agent output in `payload.chunk`; the parser for that agent turns it into tool calls.
3. `state.js` applies each activity to a mutable room state. `player.js` owns the clock and calls `onActivity` for each applied activity and `onReset` after a seek.
4. `room.js` reads the state every frame and reacts to activities with short animations (pulses, flashes, folder opening). Animations run on wall time. State changes run on replay time.

## Live mode

The first visit opens a connect screen (`src/ui/Connect.jsx`). The choice is saved in localStorage (`machineroom.settings`) with the replay speed, and the next visit reconnects by itself. A failed live connection returns to the connect screen with a message naming the address. While a live room has had no run yet, or the link is down, a waiting overlay (`Waiting.jsx`) says why. Addresses override the saved choice: `?connect` shows the screen, `?replay` opens the replay. Ways to connect:

- `/?live` goes straight to Paperclip's WebSocket through the Vite proxy. Paperclip's REST endpoints refuse a cross-origin browser, so REST calls go through the proxy at `/paperclip`, which Vite forwards to `http://127.0.0.1:3100`. A production build has no proxy.
- `/?live&bridge=http://127.0.0.1:5174` goes through the bridge (`npm run bridge`). The bridge holds the Paperclip socket, lists the agents, sends the project file list and pushes `tree` events when files appear. No proxy is needed.
- `/?live&simulate&speed=3` plays the recording through the live path with no Paperclip, for testing. The badge reads `Demo`.

Query parameters: `company` (company id), `root` (project folder name), `tree` (base URL of a bridge, to start with the full file list over the proxy route), `bridge`, `paperclip` (another Paperclip base URL), `speed` (simulated feed).

The HUD has a Replay and Live switch. The Live button is enabled when the proxy or the bridge answers. The switch changes the `live` query parameter and reloads the data without a page refresh.

- Without a file list, the room starts empty. A file or folder appears when an agent first touches it, and the scene rebuilds its layout each time the file list grows.
- Late join: only frames that arrive after the page connects are shown. An agent already mid-run appears as working from its next tool call.
- Live shows a feed clock instead of the scrubber, and the log keeps the last 200 lines.
- Truncated chunks: Paperclip's live socket cuts a log chunk longer than 8192 characters to its last 8192 and sets `truncated`. A tool call whose JSON line is that large would lose its head and be missed. The bridge reads the full chunk from `/api/heartbeat-runs/:id/log?offset=` (paging by byte offset, keeping only chunks over 8192) and sends the restored frame. Frames stay in order while it reads. After 3 tries without a match the cut frame goes through unchanged. The proxy route has no bridge, so it can still miss such calls.

Code: `src/live/source.js` (agent discovery, socket with reconnect), `src/live/bridge.js` (bridge discovery, event stream, probe), `src/live/livePlayer.js` (same interface as the replay player), `src/live/simulated.js` (recorded frames as a fake socket), `server/index.js` (the bridge).

## Room behaviour

- Layout: the root sits in front of the Machine. Top-level folders spread around it on a shell at staggered heights, and each deeper folder fans outward from its parent in a cone. A fixed number of relaxation passes then pushes every pair of folders apart (no randomness, so the same tree gives the same room) and keeps them out of the core. When a live tree grows, folders that already exist keep their place and the new ones settle around them, and the tiles glide to their new positions. A folder with more than 20 files switches to a dense grid (up to 14 columns) and its planes shrink down to 40 percent.
- Agents: an agent travels from folder to folder along the strings (starting at the root), then hovers above the exact file it touches, with a tether to it. A tag above the agent shows its current command.
- Camera: the overview centers on the bounding sphere of the folders, the core and the terminal wall, and backs off as the room or the window narrows, never below the default. `0` returns to it. `F` cycles follow mode: wide (the agent and its terminal), close up (the agent and the file it touches), off. The camera moves to the agent that starts a tool call or a run and holds each agent for 2.5 seconds before it can switch. Clicking, `0` or `1` to `9` ends follow mode.
- HUD: the scrubber carries run markers (white start, red failed end, yellow finished end) and clicking one seeks. `L` opens the event log, built from the same activities as the terminals. `?` lists the keys.
- Labels: a file touch shows `read NAME` or `write NAME` in white and `failed NAME` in red above the plane for 2.6 seconds. Labels that land close together stack upward.

## Activity schema

Every activity has `time` (ms since epoch), `agent` (key), `runId` and `order`.

| type | extra fields |
| --- | --- |
| `run.queued` | none |
| `run.start` | none |
| `run.end` | `ok`, `error` |
| `tool.start` | `id`, `tool` (read, write, edit, shell, search, other), `label`, `touches` |
| `tool.end` | `id`, `ok` |
| `error` | `text` |

A touch is `{path, mode, kind}`. `kind` is `file` or `dir`. `mode` is `read`, `write` or `list`. `path` is relative to the project root, and `''` is the root.

## How each agent reports tool calls

| Agent | Adapter | Signal in `payload.chunk` |
| --- | --- | --- |
| Claude Code | `claude_local` | JSON lines `acpx.tool_call`; the call name carries the path ("Read C:\...", "Edit src\math.js") or the command text for Terminal |
| Hermes | `hermes_local` | Plain lines such as `┊ 📖 read  strings.js  1.2s`; shown after the call finishes; reads show only the file name |
| OpenCode | `opencode_local` | JSON lines `tool_use` with `part.tool` and `part.state.input` |
| agy | `process` | JSON lines `step_update`; `ACTIVE` starts a tool, `DONE` ends it |

A shell command touches files only when its text names a known file or folder. See `commands.js` and its tests.

## DOM contract for terminals

`engine/terminals.js` builds, and the stylesheet styles, this structure:

```
.mr-term.is-{idle|queued|working|error|done}[.is-muted]
  .mr-term-title
  .mr-term-body
    .mr-line.is-{normal|dim|error|done}
```

Do not rename these classes without changing both sides.

## Conventions

- Plain words, short sentences. No em dashes. No single-line explanatory comments.
- Fonts: Jost and Space Mono, weights 400 and 500 only. Never bold.
- Colours: white, `#e5ff00`, `#ff2a2a` on black. Spacing on an 8px base.
- Commit message: version prefix, then a sentence. Example: `0.1.1: Add the live bridge`.
- Keep large binaries and secrets out of git. Never print a key.

## Known limits

- The layout compares every pair of folders. About 400 folders take 0.13 seconds and 1600 take 1.2 seconds, and a live tree relays out each time it grows. There is no collapsing or level of detail for very large projects yet.
- Hermes read lines carry only a file name. A name shared by two files cannot be resolved.
- Failure is read from tool status and from output text such as a test marker. A tool that fails quietly shows as ok.
- In live mode without a file list, a Hermes read shows only a file name, so a file it reads before any other agent has touched it appears at the root until its real path is seen.
- The proxy route needs the dev server. The bridge route works with a production build too.
- The bridge only allows pages on `localhost` or `127.0.0.1`.
- Through the proxy route (no bridge), a tool call whose log line is over 8192 characters is missed. A real run lost 3 of 58 calls this way, all reads outside the project.
- The terminal wall holds five terminals per row and adds rows above for more agents.

## Open work

See `docs/agents/PLAN.md` for the order of work and `docs/agents/TASKS.md` for the briefs. The plan for the planner, orchestrator, budgets and routing is in `docs/agents/CONTROL-PLANE.md`.
