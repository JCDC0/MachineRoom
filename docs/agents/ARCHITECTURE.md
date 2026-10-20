# MachineRoom architecture

Version 0.1.81. A browser viewer that shows coding agents working on one project as a 3D machine room. It can replay a recorded run or follow a live Paperclip instance.

## What it shows

- The middle is the hub: a flat ring where each agent parks at its own slot between runs.
- Each agent is a distinct wireframe shape. When it works it leaves the ring and stands beside the folder it works in, in front of it.
- Each agent has a terminal chip beside it, joined by a thin line. The chip shows the name and a status ring, and opens to show the log.
- The project folders are flat folder cards scattered in 3D space around the hub, joined parent to child by curved strings. Only the folders on the agents' paths open. An open folder shows at most 3 child folders and up to 3 faint folders behind it for the rest, and the folder that holds the file being touched lists up to 10 items.
- Colour has one meaning each: white is activity, red is failure, yellow is active, green is finished work.
  - A read or write flashes the file row and its card white.
  - The folder and the file an agent works on right now carry a dashed yellow outline, and the trace from its chip to the file is yellow.
  - A failed tool call, a failed run or a failed test flashes red and leaves the file red until it is written again.
  - A run that ends well turns the agent, its chip and every file it wrote in that run green.
- There is no randomness. The same recording always draws the same room.

## Commands

```
npm install
npm run dev        http://localhost:5173
npm run bridge     local bridge to Paperclip, port 5174 (see .env.example)
npm run serve      the built viewer and the bridge on one port, no Vite (npm run build first); --paperclip, --company, --root, --port, --dist; prints the address to open; npm run serve -- doctor checks a running Paperclip (it answers, its routes, the company, the project folder, a backup under a day old) and exits 1 on any failure
npm run pack-check what an npm pack would hold: fails when bin/machine-room.mjs reaches a file the pack leaves out, or the pack holds .env, tests, recordings, node_modules, .git or logs
npm run doctor     compare the running Paperclip's /api/openapi.json with the routes in server/surface.js; exits 1 and names each route or field that is missing
npm run decide-eval  compare decision models on the probe sets (see DECIDER-EVAL.md; needs your own OPENROUTER_API_KEY to run)
npm run run-lane -- hermes T2   start one lane on a brief, add --dry-run to print the command, --list prints the last 10 run records, --stats (with --since YYYY-MM-DD) prints runs, minutes and cost per lane and model, --model and --reasoning change the model for that run only
npm run run-recording -- 1      turn run 1 of that list into a recording in public/recordings/ again (run-lane already writes one after each run and prints its /?recording=<name>)
npm test           vitest, node environment, threads pool, no browser needed
npm run build
npm run fixtures -- <raw-events.jsonl> <sandbox-folder> <ids.json>
```

The lint command is the build. There is no separate linter yet.

## Layout of the code

```
src/model/        pure logic, no DOM, fully tested
  paths.js          path cleanup, ancestors, tree builder
  commands.js       files and folders a shell command touches
  parsers/          one parser per agent type (claude, hermes, opencode, agy), and unreadable.js (lines shaped like a tool call that no parser read, and a counter that joins lines split across chunks)
  pipeline.js       Paperclip frames -> activities (createPipeline for streams, buildActivities for a batch)
  log.js            activities -> event log lines and run markers
  state.js          activities -> room state (agents, files, folders)
  player.js         replay clock, seek, speed, idle compression
  source.js         parse and prepare a recording
  costs.js          costBoard: the control client's costs joined with the room's agents (rows, shares, quota windows)
  replay.js         fetch the recording from public/fixtures or public/recordings, and read public/recordings/index.json (parseRecordingIndex, loadRecordingIndex, describeRecording, filterRecordings)
src/engine/       three.js scene, no React
  layout.js         layoutCards: the folder cards in the view plane, no overlap, warm start (pure, tested); layoutTree: the older whole-tree 3D layout, kept for the collapse work
  route.js          the folders an agent passes between two folders (pure, tested)
  strings.js        curved strings between folders (curvePoint is pure, tested)
  room.js           builds the scene, runs the frame loop, reacts to activities, follow mode
  cards.js          folder cards from planFolderView, each a CSS3D element with a depth plane, glides and grows, rows for files (cardSize is pure, tested)
  labels.js         file name labels that rise and fade above a card when a file is read, written or fails
  agents.js         agent shapes, movement, link line to the chip, dashed trace to the file
  shapes.js         one distinct wireframe shape per agent, the orchestrator's own shape
  hub.js            the ring in the middle, agent slots, pulses
  void.js           the faint 3D lattice, coordinate labels and far dust
  terminals.js      CSS3D terminal chips beside their agents
  camera.js         orbit, zoom, focus, pointer drift, fit the overview to a set of spheres (pure fitView, tested)
  sprites.js        colours and helpers (copied from the portfolio void engine)
src/control/      the control client contract, its mock, the real client over the bridge, and `agents.js` (the agent lists and the checks for hire and update; see CONTROL-CLIENT.md)
src/briefs/       parses the briefs in TASKS.md and builds the full prompt for an agent from HOUSE-RULES.md and lanes.json (pure, tested)
src/decider/      decision model seam: Decisions API wire shape, `decide()`, fixed questions, stats, baselines and the comparison runner (see DECIDER-EVAL.md; not used by the app yet)
src/assistant/    request router: closed action list, rule based intent, key guard, model reply parser, and `dispatch.js` which runs a validated action against a host (the room, the HUD, the control client). Pure, tested; see CONTROL-PLANE.md
src/ui/           React HUD: agents, transport with run markers, event log, mode switch, help
  panels/           control drawer on `C`: dispatch, tasks and thread, approvals, meters (uses only the control client)
src/live/         live mode: agent discovery, socket, bridge client, live player, simulated feed
server/           the bridge: Paperclip frames, agent list and file tree for the browser, and the built viewer when started with staticDir (static.js)
bin/              machine-room.mjs, the one-port command behind npm run serve, and its doctor subcommand (server/doctor.js)
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
- `/?live&bridge=http://127.0.0.1:5174` goes through the bridge (`npm run bridge`). The bridge holds the Paperclip socket, lists the agents (with their Paperclip `role`, and a unique key each: the first agent of an adapter keeps the adapter key, later ones get the slug of their name), sends the project file list and pushes `tree` events when files appear. No proxy is needed. `GET /api/health` answers `{ ok, paperclip, paperclipVersion, surface, features, unparsed }`: the bridge reads Paperclip's `/api/openapi.json` at start, each time its socket opens and every 15 minutes, `paperclipVersion` comes from Paperclip's own `/api/health` (the spec's `info.version` is a fixed `1.0.0`), and `surface` is `{ ok: true }`, `{ ok: false, missing, changed }` (the routes from `server/surface.js` the spec no longer lists) or `{ ok: null, error }` with a plain sentence, each with `checkedAt`. `unparsed` is `{ total, byParser, since }`: the stdout lines shaped like a tool call that no parser could read since the bridge started, counted in `accept()` with `createUnreadableCounter` so lines split over two chunks count once. `features` names six parts (`room`, `backup`, `team`, `meters`, `tasks`, `approvals`, each route in `server/surface.js` carries one) and is false for a part whose routes the last check found missing or changed; the bridge routes of a part that is off answer 503 `Paperclip changed: FEATURE is off.` before calling Paperclip, and `room` off never stops the event stream, the agent list or the file tree. `GET /api/backup` gives the age of Paperclip's newest database backup and `POST /api/backup` with `{ confirmed: true }` asks for one (see `BACKUPS.md`); the page only ever gets the backup's file name. `POST /api/decide` asks the decision model (`server/decide.js` over `decide()` in `src/decider`), with the key from `OPENROUTER_API_KEY` and the model from the body, `DECISION_MODEL` or `typesafe/jev-1.14`; without a key it answers 404, and it logs only the model, the question names, the result and the time.
- `/?live&simulate&speed=3` plays the recording through the live path with no Paperclip, for testing. The badge reads `Demo`.

Query parameters: `recording` (replay a lane run from `public/recordings/<name>-*`, written by `npm run run-lane` after each run or by `npm run run-recording`; the name is the run's log name, and `public/recordings/index.json` lists the last 50 with lane, briefs, model, start, minutes, exit code and counts, newest first), `company` (company id), `root` (project folder name), `tree` (base URL of a bridge, to start with the full file list over the proxy route), `bridge`, `paperclip` (another Paperclip base URL), `speed` (simulated feed).

The HUD has a Replay and Live switch. The Live button is enabled when the proxy or the bridge answers. The switch changes the `live` query parameter and reloads the data without a page refresh.

- Without a file list, the room starts empty. A file or folder appears when an agent first touches it, and the scene rebuilds its layout each time the file list grows.
- Late join: through the bridge, the page asks `/events?history=1` on its first connect and gets the last 500 frames the bridge kept, so a run in progress replays from there. A reconnect sends `Last-Event-ID` and resumes after it. Through the proxy route only frames that arrive after the page connects are shown, and an agent already mid-run appears as working from its next tool call.
- Live shows a feed clock instead of the scrubber, and the log keeps the last 200 lines.
- Truncated chunks: Paperclip's live socket cuts a log chunk longer than 8192 characters to its last 8192 and sets `truncated`. A tool call whose JSON line is that large would lose its head and be missed. The bridge reads the full chunk from `/api/heartbeat-runs/:id/log?offset=` (paging by byte offset, keeping only chunks over 8192) and sends the restored frame. Frames stay in order while it reads. After 3 tries without a match the cut frame goes through unchanged. The proxy route has no bridge, so it can still miss such calls.

Code: `src/live/source.js` (agent discovery, socket with reconnect), `src/live/bridge.js` (bridge discovery, event stream, probe), `src/live/livePlayer.js` (same interface as the replay player), `src/live/simulated.js` (recorded frames as a fake socket), `server/index.js` (the bridge).

## Room behaviour

- Space: black, with a faint lattice in all three axes (2000 unit cells, brighter tick crosses, a few coordinate labels), a far shell of dust and fog. The camera drifts a little with the pointer, eased, and not at all under reduced motion.
- Hub: a flat ring at the middle, radius 300. Each agent has a slot on it in roster order and parks there when it has no run. A run start pulses the ring white, a run end pulses it green or red, and each slot marker takes its agent's colour.
- Folders: `planFolderView` (`src/model/folderView.js`) picks the cards from the files, the paths agents touch now, the recent touches (at most 8) made in the last 90 seconds of run time (`freshRecent` in `state.js`, measured against the newest activity, so folders close when later work moves on), plus any pinned folder. Closed cards are smallest, open cards larger, and a card that lists files is largest. A card that lists files has a row per item with read and write counts and a `+ N more` line. Cards face the camera.
- Card layout: `layoutCards` lays the cards out in the view plane of the overview camera. The root sits above the hub, top-level folders go left and right of it, and deeper folders form columns further out on their parent's side. Box relaxation keeps every card apart and clear of the hub. Deeper folders sit nearer the camera (the root 320 behind the hub, each level 260 nearer, at most 460 in front), so orbiting shows depth. A card that comes back takes its last place, and cards glide and grow to new places and sizes.
- Clicks: a card's head pins the folder open (its tab turns yellow) or unpins it. A row shows the full path and counts and flies the camera to it; a folder row also pins that folder.
- Depth: the WebGL canvas sits over the CSS3D layer with a clear background, and each card has an invisible plane that writes only depth. WebGL lines and shapes behind a card are hidden, and those in front of it draw over it.
- Agents: each has its own wireframe shape (`shapes.js`: Claude a compound, Hermes a knot, OpenCode a stellated solid, agy a geodesic, the orchestrator an armillary with a second ring, spare shapes for more). A working agent travels folder by folder from the root, then stands on the hub side of the card, a little in front of it. Its chip sits between it and the card, and a dashed trace runs from the chip to the row of the file it touches: yellow while working, green for 5 seconds after a good run, red on a failure. A tag above the agent shows its current command.
- Terminal chips: each chip follows its agent and faces the camera. Collapsed it shows the name and a status ring (yellow working, red error, green done). `T` opens the focused agent's chip to show its log, or opens or closes every chip when no agent is focused. `focusTerminal` opens the chip and flies to it.
- Camera: the overview fits the hub and every card from the overview angle (`fitView`), never closer than 1800. It refits when the cards change, but only when the frame would move more than 150 or change distance by more than 8 percent. `0` returns to it. `F` cycles follow mode: wide (the agent and its chip), close up (the agent and the file it touches), off. The camera moves to the agent that starts a tool call or a run and holds each agent for 2.5 seconds before it can switch. Clicking, `0` or `1` to `9` ends follow mode.
- Assistant: `/` opens the floating terminal. Typed requests become actions that `Stage.jsx` runs through `dispatch.js`. The room offers `focus(key, view)`, `focusTerminal(key)` (camera on the agent's terminal) and `focusPath(path)` (opens the folders on the way, flashes the target and flies to it). A toast at the bottom right shows results that need words (a created task, a refusal). Writes (a task, a budget) run only after the confirm card, and the dispatcher refuses them without an explicit `confirmed`. Panels open through the HUD's `controlTarget` prop.
- HUD: the scrubber carries run markers (white start, red failed end, green finished end) and clicking one seeks. Each agent row has a Log button that opens or closes its chip, and Overview has Show all, which reads Hide all when every chip is open. `L` opens the event log, built from the same activities as the terminals. `?` lists the keys.
- Labels: a file touch shows `read NAME` or `write NAME` in white and `failed NAME` in red above its card for 2.6 seconds. Labels that land close together stack upward.

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

## DOM contract for terminals and cards

`engine/terminals.js` and `engine/cards.js` build, and the stylesheet styles, these structures:

```
.mr-term.is-{idle|queued|working|error|done}[.is-open][.is-muted]
  .mr-term-title
  .mr-term-body
    .mr-line.is-{normal|dim|error|done}

.mr-card.is-{closed|open|files}[.is-active|.is-path][.is-pinned][.is-flash-white|.is-flash-red]
  .mr-card-backs
    .mr-card-back.is-back-{1|2|3}
  .mr-card-face
    .mr-card-head
      .mr-card-tab
      .mr-card-name
      .mr-card-meta
    .mr-card-items
      .mr-item.is-{file|dir}[.is-read|.is-written|.is-finished|.is-failed][.is-active][.is-flash-white|.is-flash-red][.is-inspected]
        .mr-item-name
        .mr-item-note
        .mr-item-detail
      .mr-card-more
```

A chip without `.is-open` hides its body.

Do not rename these classes without changing both sides.

## Conventions

- Plain words, short sentences. No em dashes. No single-line explanatory comments.
- Fonts: Jost and Space Mono, weights 400 and 500 only. Never bold.
- Colours: white, `#e5ff00` (active), `#ff2a2a` (failure), `#2aff80` (finished) on black. Spacing on an 8px base.
- Commit message: version prefix, then a sentence. Example: `0.1.1: Add the live bridge`.
- Keep large binaries and secrets out of git. Never print a key.

## Known limits

- The card layout compares every pair of drawn cards, which stays small because the folder plan draws only the folders on the agents' paths. The older whole-tree layout (`layoutTree`) took 0.13 seconds for 400 folders and 1.2 seconds for 1600.
- Hermes read lines carry only a file name. When two files share it, the parser picks the one in or nearest the folder of that run's last file; with no folder yet, or a tie, the name lands at the root.
- Failure is read from tool status and from output text such as a test marker. A tool that fails quietly shows as ok.
- In live mode without a file list, a Hermes read shows only a file name, so a file it reads before any other agent has touched it appears at the root until its real path is seen.
- The proxy route needs the dev server. The bridge route works with a production build too, and `npm run serve` serves that build from the bridge on one port.
- The bridge only allows pages on `localhost` or `127.0.0.1`.
- Through the proxy route (no bridge), a tool call whose log line is over 8192 characters is missed. A real run lost 3 of 58 calls this way, all reads outside the project.
- A card's depth plane matches its face, not its tab or the faint folders behind it, so a line can show through those.
- About half of the full test runs on this machine die inside `node.exe` 24.15.0 with 0xC0000409 (bash shows exit 127) while the test files that start a bridge run (`bridge`, `control-contract`, `bridge-reviews`). The Windows event log names Node itself at a fixed address, and a probe hit the libuv assertion `!(handle->flags & UV_HANDLE_CLOSING)` in `src\win\async.c` when a process exited right after `bridge.stop()`. The forks pool still crashes, and one worker avoids it but is 3.6 times slower (T15). A crashed run leaves its `mr-*` temp folders behind. Run the tests again; it is not a test failure.
- The card layout is fitted to the overview angle. From another angle cards can overlap until `0` returns to the overview.

## Open work

See `docs/agents/PLAN.md` for the order of work and `docs/agents/TASKS.md` for the briefs. The plan for the planner, orchestrator, budgets and routing is in `docs/agents/CONTROL-PLANE.md`. What Paperclip's code says about database backups (the one backup route, the age in `/api/health`, and restore by hand) is in `docs/agents/BACKUPS.md`.
