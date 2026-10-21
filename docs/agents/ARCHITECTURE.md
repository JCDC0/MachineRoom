# MachineRoom architecture

Version 0.1.133. A browser viewer that shows coding agents working on one project as a 3D machine room. It can replay a recorded run or follow a live Paperclip instance.

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
npm run serve      the built viewer and the bridge on one port, no Vite (npm run build first); --paperclip, --company, --root, --port, --dist; prints the address to open; npm run serve -- doctor checks a running Paperclip (it answers, its routes, the company, the project folder, a backup under a day old) and exits 1 on any failure; npm run serve -- up runs those checks, prints them, then serves the room whether they passed or not, and never starts Paperclip
npm run pack-check what an npm pack would hold: fails when bin/machine-room.mjs reaches a file the pack leaves out, or the pack holds .env, tests, recordings, node_modules, .git or logs; tests/pack-start.test.js packs for real, unpacks with scripts/untar.mjs (no shell tar) and starts the room from the unpacked folder with no node_modules
npm run doctor     compare the running Paperclip's /api/openapi.json with the routes in server/surface.js; exits 1 and names each route or field that is missing
npm run fake-paperclip -- [--port 3999] [--speed 4] [--missing ROUTE,...] [--slow ROUTE,...] [--fail ROUTE,...]   a Paperclip in memory (scripts/fake-paperclip.mjs, a dev tool left out of the pack): every route in server/surface.js, /api/health with a version and /api/openapi.json built from surface.js; one company and four agents (claude_local, hermes_local, opencode_local, process); a task for an agent plays that harness's run from public/fixtures (or a short built-in script) on /api/companies/:id/events/ws, then adds a reply comment; approvals, budgets, costs, quota windows and backups live in memory; --missing leaves a route out of the spec and answers 404, --slow never answers, --fail answers 500, and ROUTE is a surface.js path with an optional method ("GET /api/approvals/{id}"); it prints the company id. To look at it by eye: npm run fake-paperclip, then npm run build and npm run serve -- --paperclip http://127.0.0.1:3999 --company COMPANY, and add --root on a folder named agent-sandbox that holds the files of public/fixtures/sandbox-tree.json, since the recorded runs touch those; without them Hermes's reads land at the root (see Known limits)
npm run decide-eval  compare decision models on the probe sets (see DECIDER-EVAL.md; needs your own OPENROUTER_API_KEY to run)
npm run run-lane -- hermes T2   start one lane on a brief, add --dry-run to print the command, --list prints the last 10 run records, --stats (with --since YYYY-MM-DD) prints runs, minutes and cost per lane and model, --model and --reasoning change the model for that run only; it refuses, before anything starts, a brief that is missing, repeated, marked merged, owned by another lane or whose branch already exists (--force skips the merged and owner checks)
npm run hand-run -- agy W3c --minutes 40   record a run started by hand (AGY) in runs.jsonl with source hand, from the lane worktree's branch (--branch, --model, --exit), so npm run outcome accepts its branch; it refuses a lane with a command line, a brief briefProblems refuses and a branch that has a record
npm run outcome -- BRANCH merged --grade A- --fixes 0   record what happened to a lane run (merged or rejected, with --note; npm run run-lane -- --outcomes [--since] prints the table) in outcomes.jsonl beside runs.jsonl; GET /api/control/runs/outcomes and the client's outcomes() give the merge rate and cost per lane and model
npm run policy-propose -- [--since YYYY-MM-DD] [--min N]   build the outcome table, ask proposePolicy for a reorder of the routing policy and, when it finds one, write it as policy-STAMP.patch in the runs folder for the owner to read and git apply; it never writes docs/agents/policy.json
npm run history-audit   scan main, the tags and the tracked files for keys, e-mail addresses, Windows user paths, the profile name and paths into coursework; a key is never printed (first 4 characters and its length); --json; exits 1 on any finding
npm run review-lane -- hermes   review the branch in that lane's worktree against refs/heads/main: one PASS, WARN or FAIL line per check (commits ahead and nothing uncommitted, forbidden paths, the brief's Files: list from the newest run record, em dashes, keys, user paths and e-mail addresses in added lines, emoji and bold, new dependencies, heuristics for bare git, main refs, git diff flags, fetch without a signal and lookups without Object.hasOwn, the changelog line, commit prefixes, TASKS.md ids), then npm test and npm run build on the merge in a temporary worktree of main under the system temp folder, removed afterwards unless --keep; --json; exits 1 on a FAIL; never merges, pushes or changes either checkout
npm run bump -- 0.1.113   set the version in package.json, the two version lines of package-lock.json and the Version line of this file, and print each change; refuses a version that is not three whole numbers or not higher than the current one
npm run candidate -- opencode   build that lane's worktree and serve it on port 5175 (--port) beside the stable room, with --paperclip, --company and --root passed through; refuses a dirty worktree or a taken port (see CANDIDATE.md)
node scripts/agy-prompt.mjs V7a   write AGY's prompt for a brief to agy-V7a-prompt.txt in its worktree (--clean removes the older ones)
npm run run-recording -- 1      turn run 1 of that list into a recording in public/recordings/ again (run-lane already writes one after each run and prints its /?recording=<name>)
npm test           vitest through scripts/test.mjs, node environment, threads pool, no browser needed; it runs the tests again (3 tries in all) only when Node itself crashes with 0xC0000409
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
  strings.js        curved strings between folders, each with a strand of seeded points that turns yellow on a working agent's path (curvePoint and strandPoints are pure, tested)
  room.js           builds the scene, runs the frame loop, reacts to activities, follow mode
  cards.js          folder cards from planFolderView, each a CSS3D element with a depth plane, glides and grows, rows for files (cardSize is pure, tested)
  labels.js         file name labels that rise and fade above a card when a file is read, written or fails
  agents.js         agent shapes, movement, link line to the chip, dashed trace to the file, the CSS3D callout with the agent's command
  shapes.js         one distinct wireframe shape per agent, the orchestrator's own shape
  hub.js            the ring in the middle, agent slots, pulses
  void.js           the faint 3D lattice, coordinate labels and far dust
  terminals.js      CSS3D terminal chips beside their agents
  camera.js         orbit, zoom, focus, pointer drift, fit the overview to a set of spheres (pure fitView, tested)
  sprites.js        colours and helpers (copied from the portfolio void engine)
src/control/      the control client contract, its mock, the real client over the bridge, and `agents.js` (the agent lists and the checks for hire and update; see CONTROL-CLIENT.md)
src/policy/       route.js: the routing policy, version 1 (readPolicy, tierFor, escalate, chooseRoute) over docs/agents/policy.json; profile.js: profileFromBrief, the profile tierFor reads, from a brief; proposals.js: proposePolicy, policyText and policyDiff, a reorder of one tier suggested by the outcome table as a patch to review; pure, tested; the bridge answers POST /api/control/route with chooseRoute, quota and spend from Paperclip (server/policy.js), and the UI does not call it yet (C4c)
src/briefs/       parses the briefs in TASKS.md and builds the full prompt for an agent from HOUSE-RULES.md and lanes.json; review.js holds the checks behind npm run review-lane (pure, tested)
src/decider/      decision model seam: Decisions API wire shape, `decide()`, fixed questions, stats, baselines and the comparison runner (see DECIDER-EVAL.md; not used by the app yet)
src/assistant/    request router: closed action list, rule based intent, key guard, model reply parser, and `dispatch.js` which runs a validated action against a host (the room, the HUD, the control client). Pure, tested; see CONTROL-PLANE.md
src/ui/           React HUD: agents, transport with run markers, event log, mode switch, help
  panels/           control drawer on `C`: dispatch, tasks and thread, approvals, meters, agents, reviews (read a lane's branch and diff, merge it after a confirm card) (uses only the control client)
src/live/         live mode: agent discovery, socket, bridge client, live player, simulated feed
server/           the bridge: Paperclip frames, agent list and file tree for the browser, and the built viewer when started with staticDir (static.js)
bin/              machine-room.mjs, the one-port command behind npm run serve, and its doctor and up subcommands (server/doctor.js)
src/Stage.jsx     wires player, room and HUD together
src/App.jsx       chooses the first screen (connect, replay or live), loads the data, shows loading, empty and error states
src/startup.js    pure: which screen to open from the address and the saved connection (tested)
src/storage.js    safe access to localStorage
public/fixtures/  the recorded run, agent list and file tree
tests/            vitest; tests/helpers/loop.js starts the fake Paperclip and a bridge on port 0 for tests/e2e-loop.test.js and tests/soak.test.js; tests/helpers/tempRoot.js puts every test temp folder under %TEMP%\machineroom-tests\<process id>, and a run first deletes the folders of test processes that are gone (tests/helpers/cleanTemp.js)
```

## Data flow

1. Paperclip sends frames on `ws://HOST/api/companies/:id/events/ws`. A frame is `{id, companyId, type, createdAt, payload}`.
2. `pipeline.js` turns frames into activities. `heartbeat.run.log` carries raw agent output in `payload.chunk`; the parser for that agent turns it into tool calls.
3. `state.js` applies each activity to a mutable room state. `player.js` owns the clock and calls `onActivity` for each applied activity and `onReset` after a seek.
4. `room.js` reads the state every frame and reacts to activities with short animations (pulses, flashes, folder opening). Animations run on wall time. State changes run on replay time.

## Live mode

The first visit opens a connect screen (`src/ui/Connect.jsx`). The choice is saved in localStorage (`machineroom.settings`) with the replay speed, and the next visit reconnects by itself. A failed live connection returns to the connect screen with a message naming the address. While a live room has had no run yet, or the link is down, a waiting overlay (`Waiting.jsx`) says why. Addresses override the saved choice: `?connect` shows the screen, `?replay` opens the replay. Ways to connect:

- `/?live` goes straight to Paperclip's WebSocket through the Vite proxy. Paperclip's REST endpoints refuse a cross-origin browser, so REST calls go through the proxy at `/paperclip`, which Vite forwards to `http://127.0.0.1:3100`. A production build has no proxy.
- `/?live&bridge=http://127.0.0.1:5174` goes through the bridge (`npm run bridge`). The bridge holds the Paperclip socket, lists the agents (with their Paperclip `role`, and a unique key each: the first agent of an adapter keeps the adapter key, later ones get the slug of their name), sends the project file list and pushes `tree` events when files appear. No proxy is needed. `GET /api/health` answers `{ ok, paperclip, paperclipVersion, surface, features, unparsed, masked }`: the bridge reads Paperclip's `/api/openapi.json` at start, each time its socket opens and every 15 minutes, `paperclipVersion` comes from Paperclip's own `/api/health` (the spec's `info.version` is a fixed `1.0.0`), read before and after the spec so the version and the surface always come from one Paperclip (when the two reads differ the bridge reads all three again, and after 3 tries it reports `{ ok: null, error }`), and `surface` is `{ ok: true }`, `{ ok: false, missing, changed }` (the routes from `server/surface.js` the spec no longer lists) or `{ ok: null, error }` with a plain sentence, each with `checkedAt`. `unparsed` is `{ total, byParser, since }`: the stdout lines shaped like a tool call that no parser could read since the bridge started, counted in `accept()` with `createUnreadableCounter` so lines split over two chunks count once. `masked` is `{ total, since }`: `accept()` runs `maskKeys` (`src/briefs/audit.js`) on a frame's `chunk`, `message` and `error` before the frame goes into the history or to a page, so a key an agent prints reaches the page as `[key]`; the bridge never logs what it masked. `features` names six parts (`room`, `backup`, `team`, `meters`, `tasks`, `approvals`, each route in `server/surface.js` carries one) and is false for a part whose routes the last check found missing or changed; the bridge routes of a part that is off answer 503 `Paperclip changed: FEATURE is off.` before calling Paperclip, and `room` off never stops the event stream, the agent list or the file tree. `GET /api/backup` gives the age of Paperclip's newest database backup and `POST /api/backup` with `{ confirmed: true }` asks for one (see `BACKUPS.md`); the page only ever gets the backup's file name. `POST /api/decide` asks the decision model (`server/decide.js` over `decide()` in `src/decider`), with the key from `OPENROUTER_API_KEY` and the model from the body, `DECISION_MODEL` or `typesafe/jev-1.14`; without a key it answers 404, and it logs only the model, the question names, the result and the time.
- `/?live&simulate&speed=3` plays the recording through the live path with no Paperclip, for testing. The badge reads `Demo`.

Query parameters: `recording` (replay a lane run from `public/recordings/<name>-*`, written by `npm run run-lane` after each run or by `npm run run-recording`; the name is the run's log name, and `public/recordings/index.json` lists the last 50 with lane, briefs, model, start, minutes, exit code and counts, newest first), `company` (company id), `root` (project folder name), `tree` (base URL of a bridge, to start with the full file list over the proxy route), `bridge`, `paperclip` (another Paperclip base URL), `speed` (simulated feed). A `bridge`, `paperclip` or `tree` address in a link must be on this computer (`localhost`, `127.0.0.1`, `[::1]`), on the page's own origin, or a path such as `/paperclip`; any other address opens the connect screen with it filled in and `The link names ADDRESS, which is not on this computer. Check the address, then connect.` (`linkAddressAllowed` in `src/startup.js`), and a replay keeps the saved connection.

The HUD has a Replay and Live switch. The Live button is enabled when the proxy or the bridge answers. The switch changes the `live` query parameter and reloads the data without a page refresh.

- Without a file list, the room starts empty. A file or folder appears when an agent first touches it, and the scene rebuilds its layout each time the file list grows.
- Late join: through the bridge, the page asks `/events?history=1` on its first connect and gets the last 500 frames the bridge kept, so a run in progress replays from there. A reconnect sends `Last-Event-ID` and resumes after it. When the browser gives up on the stream (an answer that is not a 200 event stream), `openBridge` opens it again after 1 second, doubling up to 15 seconds, and the history replay fills the gap. Through the proxy route only frames that arrive after the page connects are shown, and an agent already mid-run appears as working from its next tool call.
- Live shows a feed clock instead of the scrubber, and the log keeps the last 200 lines.
- Truncated chunks: Paperclip's live socket cuts a log chunk longer than 8192 characters to its last 8192 and sets `truncated`. A tool call whose JSON line is that large would lose its head and be missed. The bridge reads the full chunk from `/api/heartbeat-runs/:id/log?offset=` (paging by byte offset, keeping only chunks over 8192) and sends the restored frame. Frames stay in order while it reads. After 3 tries without a match the cut frame goes through unchanged, and a 404 from the log route lets it through after the first try. The proxy route has no bridge, so it can still miss such calls.

Code: `src/live/source.js` (agent discovery, socket with reconnect), `src/live/bridge.js` (bridge discovery, event stream, probe), `src/live/livePlayer.js` (same interface as the replay player), `src/live/simulated.js` (recorded frames as a fake socket), `server/index.js` (the bridge).

## Room behaviour

- Space: black, with a faint lattice in all three axes (2000 unit cells, brighter tick crosses, a few coordinate labels), a far shell of dust and fog. The camera drifts a little with the pointer, eased, and not at all under reduced motion.
- Hub: a flat ring at the middle, radius 300. Each agent has a slot on it in roster order and parks there when it has no run. A run start pulses the ring white, a run end pulses it green or red, and each slot marker takes its agent's colour.
- Folders: `planFolderView` (`src/model/folderView.js`) picks the cards from the files, the paths agents touch now, the recent touches (at most 8) made in the last 90 seconds of run time (`freshRecent` in `state.js`, measured against the newest activity, so folders close when later work moves on), plus any pinned folder. Closed cards are smallest, open cards larger, and a card that lists files is largest. A card that lists files has a row per item with read and write counts and a `+ N more` line. Cards face the camera.
- Card layout: `layoutCards` lays the cards out in the view plane of the overview camera. The root sits above the hub, top-level folders go left and right of it, and deeper folders form columns further out on their parent's side. Box relaxation keeps every card apart and clear of the hub. Deeper folders sit nearer the camera (the root 320 behind the hub, each level 260 nearer, at most 460 in front), so orbiting shows depth. A card that comes back takes its last place, and cards glide and grow to new places and sizes.
- Clicks: a card's head pins the folder open (its tab turns yellow) or unpins it. A row shows the full path and counts and flies the camera to it; a folder row also pins that folder.
- Depth: the WebGL canvas sits over the CSS3D layer with a clear background, and each card has an invisible plane that writes only depth. WebGL lines and shapes behind a card are hidden, and those in front of it draw over it.
- Agents: each has its own wireframe shape (`shapes.js`: Claude a compound, Hermes a knot, OpenCode a stellated solid, agy a geodesic, the orchestrator an armillary with a second ring, spare shapes for more). A working agent travels folder by folder from the root, then stands on the hub side of the card, a little in front of it. Its chip sits between it and the card, and a dashed trace runs from the chip to the row of the file it touches: yellow while working, green for 5 seconds after a good run, red on a failure. A callout, a thin line up and to the side of the agent away from its chip, shows its name on a white block and its current command: yellow border while it works, red while its last tool call failed and for 5 seconds after a failed run, green with `FINISHED` for 5 seconds after a good run. It is hidden through the CSS3D object's `visible`, because the CSS3D renderer sets each element's `display` on every frame.
- Terminal chips: each chip follows its agent and faces the camera. Collapsed it shows the name and a status ring (yellow working, red error, green done). `T` opens the focused agent's chip to show its log, or opens or closes every chip when no agent is focused. `focusTerminal` opens the chip and flies to it.
- Camera: the overview fits the hub and every card from the overview angle (`fitView`), never closer than 1800. It refits when the cards change, but only when the frame would move more than 150 or change distance by more than 8 percent. `0` returns to it. `F` cycles follow mode: wide (the agent and its chip), close up (the agent and the file it touches), off. The camera moves to the agent that starts a tool call or a run and holds each agent for 2.5 seconds before it can switch. Clicking, `0` or `1` to `9` ends follow mode.
- Assistant: `/` opens the floating terminal. Typed requests become actions that `Stage.jsx` runs through `dispatch.js`. The room offers `focus(key, view)`, `focusTerminal(key)` (camera on the agent's terminal) and `focusPath(path)` (opens the folders on the way, flashes the target and flies to it). A toast at the bottom right shows results that need words (a created task, a refusal). Writes (a task, a budget) run only after the confirm card, and the dispatcher refuses them without an explicit `confirmed`. Panels open through the HUD's `controlTarget` prop.
- Meters panel: a Backups section reads the age of Paperclip's newest backup (`backupStatus()`), names its warnings in words, and offers Back up now behind a confirm card (`backupNow()`).
- HUD: the scrubber carries run markers (white start, red failed end, green finished end) and clicking one seeks. Each agent row has a Log button that opens or closes its chip, and Overview has Show all, which reads Hide all when every chip is open. Through a bridge, the HUD reads `/api/health` every 60 seconds and shows a chip under the Replay and Live switch only when something is wrong (the bridge not answering, Paperclip not connected, routes changed or not checked); a click lists the routes. `L` opens the event log, built from the same activities as the terminals. `?` lists the keys.
- Labels: a file touch shows `read NAME` or `write NAME` in white and `failed NAME` in red above its card for 2.6 seconds. Labels that land close together stack upward. A failed tool call also lays a red `FAILED NAME` band across the card's face for 2.6 seconds over red scanlines.
- Strands: each string between folders carries a strand of small points, about one per 24 units, scattered by a seed from the folder pair, white at low opacity. The strand into a folder on a working agent's path turns yellow and fades back over 1.5 seconds (at once under reduced motion).

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
    .mr-card-band[.is-failed]

.mr-callout.is-{working|error|done}
  .mr-callout-title
  .mr-callout-cmd
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
- The bridge and the scripts start git by its absolute path from PATH (`gitPath()` in `server/programPath.js`), because Node on Windows runs a `git.exe` from the child's working folder first when `NoDefaultCurrentDirectoryInExePath` is not set, and a lane worktree is such a folder. They name `refs/heads/main`, never `main`, so a tag cannot stand in for the branch. A run and its children stop through `killTree()` in `server/processTree.js` (`taskkill /T /F` on Windows, the process group elsewhere).
- The bridge allows a page only from `http://localhost:PORT` or `http://127.0.0.1:PORT` on its own port, from the Vite port 5173, and from each exact origin in `MACHINEROOM_ORIGINS` (a comma list of `http://localhost:N` or `http://127.0.0.1:N`; other entries are skipped with a printed line). Any other Origin gets 403; a request with no Origin, such as a same-origin GET or `curl`, still passes. A page on an allowed origin can still use every route, so a lane run, a merge and a backup each need `confirmed: true`, and a merge also needs the lane's exact head sha.
- Keys are masked one chunk at a time, so a key that Paperclip splits across two chunks reaches the page unmasked, and the proxy route (no bridge) masks nothing.
- Through the proxy route (no bridge), a tool call whose log line is over 8192 characters is missed. A real run lost 3 of 58 calls this way, all reads outside the project.
- A card's depth plane matches its face, not its tab or the faint folders behind it, so a line can show through those.
- About half of the full test runs on this machine die inside `node.exe` 24.15.0 with 0xC0000409 (bash shows exit 127) while the test files that start a bridge run (`bridge`, `control-contract`, `bridge-reviews`). The Windows event log names Node itself at a fixed address, and a probe hit the libuv assertion `!(handle->flags & UV_HANDLE_CLOSING)` in `src\win\async.c` when a process exited right after `bridge.stop()`. The forks pool still crashes, and one worker avoids it but is 3.6 times slower (T15). A crashed run leaves its `mr-*` temp folders behind. `npm test` runs them again by itself (T15b); it is not a test failure.
- On this machine a test that starts git or a bridge takes 1 to 4 seconds alone and up to 11 while a lane runs its own suite, so `vite.config.js` allows 20 seconds a test and a hook instead of the default 5.
- The card layout is fitted to the overview angle. From another angle cards can overlap until `0` returns to the overview.

## Open work

The orchestrator (Hermes from 0.1.90, Claude before) works from `docs/agents/ORCHESTRATOR.md`: the standing rules, the review and merge loop, who owns what and the review lessons. See `docs/agents/PLAN.md` for the order of work and `docs/agents/TASKS.md` for the briefs. The plan for the planner, orchestrator, budgets and routing is in `docs/agents/CONTROL-PLANE.md`. The October audit (`docs/agents/AUDIT-2026-10.md`) lists each security finding, its fix and the 17 left open with the reason. The UI audit (`docs/agents/AUDIT-2026-10-UI.md`) does the same for the code that runs in the browser: 10 findings fixed, 10 left open, briefs U6 to U10a. What Paperclip's code says about database backups (the one backup route, the age in `/api/health`, and restore by hand) is in `docs/agents/BACKUPS.md`.
