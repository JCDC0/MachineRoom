# MachineRoom architecture

Version 0.1.200. A browser viewer that shows coding agents working on one project as a 3D machine room. It can replay a recorded run or follow a live Paperclip instance.

## What it shows

- The middle is the hub: a flat ring where each agent stays at its own slot, working or not; the orchestrator floats above the hub centre.
- Each agent is a distinct wireframe shape. A working agent shows it by its status ring, its chip and a slow pulse, and a yellow strip of three straight segments runs from it to the row of the file it touches, with four yellow corner brackets around that card.
- Each agent has a terminal chip beside it, joined by a thin line. The chip shows the name and a status ring, and opens to show the log.
- The project folders are flat folder cards on a sphere around the hub, joined by straight lines: each top-level folder and the root to the hub centre, every other folder to its parent. Every folder down to depth 2 is always there; deeper folders appear, with a short fade, only while they are on an agent's path. An open folder shows at most 3 child folders and up to 3 faint folders behind it for the rest, and the folder that holds the file being touched lists up to 10 items.
- Colour has one meaning each: white is activity, red is failure, yellow is active, green is finished work.
  - A read or write flashes the file row and its card white.
  - The folder and the file an agent works on right now carry a dashed yellow outline, and the strip from the agent to the file is yellow.
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
npm run scale-live -- [--files 200000] [--folders 20000] [--seed N] [--keep]   build a seeded git checkout under %TEMP%\machineroom-scale\FILES-SEED (reused when it matches, refused under 2 GB free, removed at the end unless --keep), start the bridge on it in a child process with a dead Paperclip port, and time the first tree read, the gzip folder answer, the bridge's memory, a new file reaching a page, and bursts of 2000 files into an untracked folder and a gitignored one (the bridge's own CPU share; git's is not counted); a dev tool left out of the pack
npm run scale-probe -- [--files 40000] [--folders 4000] [--seed N] [--replay]   time each stage of the room on a seeded tree in memory (readTree with a fake listDir, the tree event, makeTree, the state, planFolderView, layoutSphere, the Hermes pipeline) against 16 ms for work per frame or activity, 1 second at load and 2 MB for a tree event; --replay prints a digest of the activities, folder plans and layouts of each fixture and each public/recordings/*-run.jsonl, to diff two versions
npm run doctor     compare the running Paperclip's /api/openapi.json with the routes in server/surface.js; exits 1 and names each route or field that is missing
npm run fake-paperclip -- [--port 3999] [--speed 4] [--missing ROUTE,...] [--slow ROUTE,...] [--fail ROUTE,...]   a Paperclip in memory (scripts/fake-paperclip.mjs, a dev tool left out of the pack): every route in server/surface.js, /api/health with a version and /api/openapi.json built from surface.js; one company and four agents (claude_local, hermes_local, opencode_local, process); a task for an agent plays that harness's run from public/fixtures (or a short built-in script) on /api/companies/:id/events/ws, then adds a reply comment; approvals, budgets, costs, quota windows and backups live in memory; --missing leaves a route out of the spec and answers 404, --slow never answers, --fail answers 500, and ROUTE is a surface.js path with an optional method ("GET /api/approvals/{id}"); it prints the company id. To look at it by eye: npm run fake-paperclip, then npm run build and npm run serve -- --paperclip http://127.0.0.1:3999 --company COMPANY, and add --root on a folder named agent-sandbox that holds the files of public/fixtures/sandbox-tree.json, since the recorded runs touch those; without them Hermes's reads land at the root (see Known limits)
npm run decide-eval  compare decision models on the probe sets (see DECIDER-EVAL.md; needs your own OPENROUTER_API_KEY to run)
npm run run-lane -- opencode T2   start one lane on a brief, add --dry-run to print the command, --list prints the last 10 run records, --stats (with --since YYYY-MM-DD) prints runs, minutes and cost per lane and model, --model and --reasoning change the model for that run only; it refuses, before anything starts, a brief that is missing, repeated, marked merged, owned by another lane or whose branch already exists, and a lane marked retired in lanes.json (--force skips the merged, owner and retired checks)
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
  fileIndex.js      indexFor: a set and a base name map per file or folder list, kept in a WeakMap and caught up with entries pushed later, so a shell command (commands.js) or a Hermes read (resolveKnown) costs the same at any repo size
  replay.js         fetch the recording from public/fixtures or public/recordings, and read public/recordings/index.json (parseRecordingIndex, loadRecordingIndex, describeRecording, filterRecordings)
  scaleTree.js      makeScaleTree, scaleActivities and createScaleReplay: the seeded tree and activities behind `?scale=N` and `npm run scale-probe`
src/engine/       three.js scene, no React
  sphere.js         layoutSphere: folder cards on shells of a sphere around the hub (depth 1 at 1700, each level 1000 further out to depth 3, then 400 per level), the root below the hub, top-level folders by a Fibonacci spiral with the poles free, children in a cone around their parent; no two cards closer than half their diagonals plus 40, and no card but the root closer to an `obstacles` ball (`{ x, y, z, radius }`) than its half diagonal plus the radius plus 40; a warm start moves only the new or resized cards, a card that meets an obstacle, and their siblings (pure, tested)
  strings.js        straight lines between folders and to the hub centre, each with a strand of seeded points that turns yellow on a working agent's path (strandPoints is pure, tested)
  room.js           builds the scene, runs the frame loop, reacts to activities, follow mode
  cards.js          folder cards from planFolderView, each a CSS3D element with a depth plane, glides and grows, rows for files (cardSize is pure, tested)
  labels.js         file name labels that rise and fade above a card when a file is read, written or fails
  agents.js         agent shapes parked on the hub, link line to the chip, the strip to the touched file (stripPoints is pure, tested), the CSS3D callout with the agent's command
  shapes.js         one distinct wireframe shape per agent, the orchestrator's own shape
  hub.js            the ring in the middle, agent slots, pulses
  void.js           the faint 3D lattice, coordinate labels, far dust and the fine dust near the camera (setFineDust)
  terminals.js      CSS3D terminal chips beside their agents
  board.js          the cost board: boardLines and boardVisible (pure, tested), and the fixed screen panel at the bottom right, fed by costBoard
  camera.js         orbit, zoom, focus, pointer drift, fit the overview to a set of spheres (pure fitView, tested)
  sprites.js        colours and helpers (copied from the portfolio void engine)
src/control/      the control client contract, its mock, the real client over the bridge, and `agents.js` (the agent lists and the checks for hire and update; see CONTROL-CLIENT.md)
src/policy/       route.js: the routing policy, version 1 (readPolicy, tierFor, escalate, chooseRoute) over docs/agents/policy.json; profile.js: profileFromBrief, the profile tierFor reads, from a brief; proposals.js: proposePolicy, policyText and policyDiff, a reorder of one tier suggested by the outcome table as a patch to review; pure, tested; the bridge answers POST /api/control/route with chooseRoute, quota and spend from Paperclip (server/policy.js), and the dispatch form shows its suggestion with a Use button (C4c, `src/ui/panels/route.js`)
src/briefs/       parses the briefs in TASKS.md and builds the full prompt for an agent from HOUSE-RULES.md and lanes.json; review.js holds the checks behind npm run review-lane (pure, tested)
src/decider/      decision model seam: Decisions API wire shape, `decide()`, fixed questions, stats, baselines and the comparison runner (see DECIDER-EVAL.md; not used by the app yet)
src/assistant/    request router: closed action list, rule based intent, key guard, model reply parser, and `dispatch.js` which runs a validated action against a host (the room, the HUD, the control client). Pure, tested; see CONTROL-PLANE.md
src/ui/           React HUD: agents, transport with run markers, event log, mode switch, help
  panels/           control drawer on `C`: dispatch, tasks and thread (a task with a queued or running Paperclip run reads `running AGENT` or `queued AGENT`, from `liveRuns()` and the `liveRuns` notice), approvals, meters, agents, reviews (read a lane's branch and diff, merge it after a confirm card), plan (ask the planner, then add the ticked briefs to TASKS.md after a confirm card, never committed, and open each added brief in Dispatch with `Dispatch ID`) (uses only the control client)
src/live/         live mode: agent discovery, socket, bridge client, live player, simulated feed, and tree.js (readFileList: the file list in either shape)
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
- `/?live&bridge=http://127.0.0.1:5174` goes through the bridge (`npm run bridge`). The bridge holds the Paperclip socket, lists the agents (with their Paperclip `role`, and a unique key each: the first agent of an adapter keeps the adapter key, later ones get the slug of their name), sends the project file list and pushes `tree` events when files appear (a recursive watcher while the project is quiet; on the first change it closes the watcher and polls, starting a read no sooner than three times the last read's length after it, until no change for 2 seconds; a folder-shaped `GET /api/tree` may reuse a read from the last second) to each page that opened `/events` with a `tree` parameter (the control client's stream asks for none and gets none): a page's first one holds only the files added since the `version` of the list it read with `GET /api/tree` (the page sends it as `since`; the bridge keeps its last 4 versions), or the whole list when it names no version the bridge still has, and each later one only the files that page has not had, since the page only adds files. A page that opens `/events?tree=folders`, or asks `GET /api/tree` with `Accept: application/json; shape=folders` (a CORS-safe value, so no preflight), gets the whole list in the folder shape `{ root, shape: 'folders', folders: [[parent, name]], files: [[folder, name, ...]] }`, which names each folder once; the folder answer of `GET /api/tree` also carries `version`, and it is gzipped (async `zlib.gzip`) when the request's `Accept-Encoding` names gzip. `readFileList` in `src/live/tree.js` reads both shapes, so pages and bridges of different versions still agree. The bridge lists a git project with `git ls-files -z`, so names with non-ASCII letters arrive as they are. No proxy is needed. `GET /api/health` answers `{ ok, paperclip, paperclipVersion, surface, features, unparsed, masked }`: the bridge reads Paperclip's `/api/openapi.json` at start, each time its socket opens and every 15 minutes, `paperclipVersion` comes from Paperclip's own `/api/health` (the spec's `info.version` is a fixed `1.0.0`), read before and after the spec so the version and the surface always come from one Paperclip (when the two reads differ the bridge reads all three again, and after 3 tries it reports `{ ok: null, error }`), and `surface` is `{ ok: true }`, `{ ok: false, missing, changed }` (the routes from `server/surface.js` the spec no longer lists) or `{ ok: null, error }` with a plain sentence, each with `checkedAt`. `unparsed` is `{ total, byParser, since }`: the stdout lines shaped like a tool call that no parser could read since the bridge started, counted in `accept()` with `createUnreadableCounter` so lines split over two chunks count once. `masked` is `{ total, since }`: `accept()` passes each frame through `createSplitMasker` (`src/briefs/audit.js`), which runs `maskKeys` on a frame's `chunk`, `message` and `error` and masks a key cut across two log chunks of one run and stream, before the frame goes into the history or to a page, so a key an agent prints reaches the page as `[key]`; the bridge never logs what it masked. `features` names six parts (`room`, `backup`, `team`, `meters`, `tasks`, `approvals`, each route in `server/surface.js` carries one) and is false for a part whose routes the last check found missing or changed; the bridge routes of a part that is off answer 503 `Paperclip changed: FEATURE is off.` before calling Paperclip, and `room` off never stops the event stream, the agent list or the file tree. `GET /api/backup` gives the age of Paperclip's newest database backup and `POST /api/backup` with `{ confirmed: true }` asks for one (see `BACKUPS.md`); the page only ever gets the backup's file name. `POST /api/decide` asks the decision model (`server/decide.js` over `decide()` in `src/decider`), with the key from `OPENROUTER_API_KEY` and the model from the body, `DECISION_MODEL` or `typesafe/jev-1.14`; without a key it answers 404, and it logs only the model, the question names, the result and the time.
- `/?live&simulate&speed=3` plays the recording through the live path with no Paperclip, for testing. The badge reads `Demo`.

Query parameters: `fixture` (with `replay`, a fixture from `public/fixtures/<name>-*` whose name matches `scenario-` and one letter, for example `scenario-e`, the one with an orchestrator and three subagents; any other name opens the sandbox run; a `recording` wins), `recording` (replay a lane run from `public/recordings/<name>-*`, written by `npm run run-lane` after each run or by `npm run run-recording`; the name is the run's log name, and `public/recordings/index.json` lists the last 50 with lane, briefs, model, start, minutes, exit code and counts, newest first), `company` (company id), `root` (project folder name), `tree` (base URL of a bridge, to start with the full file list over the proxy route), `bridge`, `paperclip` (another Paperclip base URL), `speed` (simulated feed), `scale` (with `replay`, a whole number from 1000 to 500000: a seeded room of that many files in a tenth as many folders, with three agents touching files at random, from `src/model/scaleTree.js`, the same tree the scale probe uses) and `fps` (a line in the HUD's top left panel with the median and p95 frame time over the last 120 frames). A `bridge`, `paperclip` or `tree` address in a link must be on this computer (`localhost`, `127.0.0.1`, `[::1]`), on the page's own origin, or a path such as `/paperclip`; any other address opens the connect screen with it filled in and `The link names ADDRESS, which is not on this computer. Check the address, then connect.` (`linkAddressAllowed` in `src/startup.js`), and a replay keeps the saved connection.

The HUD has a Replay and Live switch. The Live button is enabled when the proxy or the bridge answers. The switch changes the `live` query parameter and reloads the data without a page refresh.

- Without a file list, the room starts empty. A file or folder appears when an agent first touches it, and the scene rebuilds its layout each time the file list grows.
- Late join: through the bridge, the page asks `/events?history=1` on its first connect and gets the last 500 frames the bridge kept, so a run in progress replays from there. A reconnect sends `Last-Event-ID` and resumes after it. When the browser gives up on the stream (an answer that is not a 200 event stream), `openBridge` opens it again after 1 second, doubling up to 15 seconds, and the history replay fills the gap. Through the proxy route only frames that arrive after the page connects are shown, and an agent already mid-run appears as working from its next tool call.
- Live shows a feed clock instead of the scrubber, and the log keeps the last 200 lines.
- Truncated chunks: Paperclip's live socket cuts a log chunk longer than 8192 characters to its last 8192 and sets `truncated`. A tool call whose JSON line is that large would lose its head and be missed. The bridge reads the full chunk from `/api/heartbeat-runs/:id/log?offset=` (paging by byte offset, keeping only chunks over 8192) and sends the restored frame. Frames stay in order while it reads. After 3 tries without a match the cut frame goes through unchanged, and a 404 from the log route lets it through after the first try. The proxy route has no bridge, so it can still miss such calls.

Code: `src/live/source.js` (agent discovery, socket with reconnect), `src/live/bridge.js` (bridge discovery, event stream, probe), `src/live/livePlayer.js` (same interface as the replay player), `src/live/simulated.js` (recorded frames as a fake socket), `server/index.js` (the bridge).

## Room behaviour

- Space: black, with a faint lattice in all three axes (2000 unit cells, brighter tick crosses, a few coordinate labels), a far shell of dust and fog. The camera drifts a little with the pointer, eased, and not at all under reduced motion, and the far dust stops turning.
- Hub: a flat ring at the middle, radius 300. Each agent has a slot on it in roster order and stays parked there, working or not; the orchestrator floats above the hub centre. A run start pulses the ring white, a run end pulses it green or red, and each slot marker takes its agent's colour. Under reduced motion the dash ring stops turning, slot markers do not grow, and pulses only change brightness where they end.
- Folders: `planFolderView` (`src/model/folderView.js`) picks the cards from the files, the paths agents touch now, the recent touches (at most 8) made in the last 90 seconds of run time (`freshRecent` in `state.js`, measured against the newest activity, so folders close when later work moves on), plus any pinned folder; with `alwaysDepth` from 1 to 3 (0, today's plan, until V16 passes a value) every folder down to that depth is in the plan all the time, closed unless it holds a touched file, at most `maxAlways` (300) with the root, a parent keeping its children with the most files and putting the rest in its faint back folders, and each such view carries `pinned: true`. Closed cards are smallest, open cards larger, and a card that lists files is largest. A card that lists files has a row per item with read and write counts and a `+ N more` line. Cards face the camera.
- Card layout: `layoutSphere` (`src/engine/sphere.js`) puts the cards on shells around the hub centre, the root below the hub, and the room passes `alwaysDepth` 2 to the plan (`room.setOptions({ alwaysDepth })` changes it). A card that enters the plan without `pinned`, and every list of items that opens, fades in over 0.4 seconds and out over 0.4 seconds when it leaves (at once under reduced motion). A card that comes back takes its last place, and cards glide and grow to new places and sizes (they jump to their place and size under reduced motion).
- Clicks: a card's head pins the folder open (its tab turns yellow) or unpins it. A row shows the full path and counts and flies the camera to it; a folder row also pins that folder.
- Depth: the WebGL canvas sits over the CSS3D layer with a clear background, and each card has an invisible mesh that writes only depth, shaped as its face, its tab and each faint folder behind it (`occluderParts` in `cards.js`, pure, tested), so the empty corners beside the tab and the backs stay see-through. WebGL lines and shapes behind a card are hidden, and those in front of it draw over it.
- Agents: each has its own wireframe shape (`shapes.js`: Claude a compound, Hermes a knot, OpenCode a stellated solid, agy a geodesic, the orchestrator an armillary with a second ring, spare shapes for more). Every agent stays parked at its hub slot, working or not, and the orchestrator floats above the hub centre. A working agent shows it by its status ring, its chip and a slow pulse, and a strip of three straight segments runs from it to the row of the file it touches, with four corner brackets around that card: yellow while working, green for 5 seconds after a good run, red on a failure. Shapes stop turning under reduced motion. A callout, a thin line up and to the side of the agent away from its chip, shows its name on a white block, the identifier of the Paperclip task its running run works on (`agentTasks` in `src/model/liveTasks.js`, read from `liveRuns()` and `issues()` on each `agents`, `issues` and `liveRuns` notice), and its current command: yellow border while it works, red while its last tool call failed and for 5 seconds after a failed run, green with `FINISHED` for 5 seconds after a good run. It is hidden through the CSS3D object's `visible`, because the CSS3D renderer sets each element's `display` on every frame.
- Terminal chips: each chip follows its agent (in one frame under reduced motion) and faces the camera. Collapsed it shows the name and a status ring (yellow working, red error, green done). `T` opens the focused agent's chip to show its log, or opens or closes every chip when no agent is focused. `focusTerminal` opens the chip and flies to it.
- Camera: the overview fits the hub, the root and the cards in the plan with `pinned: true` (`overviewSpheres` in `cards.js`, pure, tested) from the overview angle (`fitView`), never closer than 1800. A card on a deep touched path can be outside the overview; follow mode reaches it. It refits when the cards change, but only when the frame would move more than 150 or change distance by more than 8 percent. `0` returns to it. `F` cycles follow mode: wide (the touched card and its parent), close up (the touched card alone), off. The camera follows the card that holds the file being touched, not the agent (`followTarget` in `camera.js`, pure, tested): it holds each card at least 4 seconds, does not move when the next card is already inside the middle two thirds of the frame, and eases over 1.2 seconds (it jumps under reduced motion). While any agent works, every card off a working agent's path dims to 0.25 opacity with its line and strand, the cards on the path glow (full white border, a soft outer glow), and everything returns over 1 second when no agent works. Clicking, `0` or `1` to `9` ends follow mode.
- Assistant: `/` opens the floating terminal. Typed requests become actions that `Stage.jsx` runs through `dispatch.js`. The room offers `focus(key, view)`, `focusTerminal(key)` (camera on the agent's terminal) and `focusPath(path)` (opens the folders on the way, flashes the target and flies to it). A toast at the bottom right shows results that need words (a created task, a refusal). Writes (a task, a budget) run only after the confirm card, and the dispatcher refuses them without an explicit `confirmed`. Panels open through the HUD's `controlTarget` prop.
- Cost board: when there is a control client, Stage reads `agents()` and `costs()` at start, every 60 seconds and on an `agents` or `costs` notice, joins them with `costBoard` and hands the result to `room.setCosts`. The board is a fixed panel at the bottom right, 280 px wide, above the transport bar, on the surface element outside the screen effects filter, so fish eye and aberration never bend it (it sits above the vignette and grain too, and the control drawer opens over it); its rows scroll when it is taller than half the window. It shows the spend against the budget (red when over), a row per agent with cost, tokens and a share bar (`not reported` in dim white), the quota windows (an error in red), and `Costs not available.` when the read fails. A row click flies to that agent. It is hidden below 900 pixels wide, where the Meters tab covers costs. A click or a wheel on it does not move the camera. It takes no part in the card layout or the overview fit (V19); `layoutSphere` keeps its `obstacles` option, which the room no longer passes.
- Meters panel: a Backups section reads the age of Paperclip's newest backup (`backupStatus()`), names its warnings in words, and offers Back up now behind a confirm card (`backupNow()`).
- Settings: a Settings button in the HUD opens a panel (`src/ui/Settings.jsx`) with the folder depth (1 to 3, default 2, passed to `room.setOptions`) and five screen effects, each with a switch and a strength: fish eye, chromatic aberration, vignette, grain and fine dust. `effectSettings` in `src/ui/settings.js` fills defaults and clamps values, and they are saved in `machineroom.settings` beside the connection. The folder cards are CSS3D elements, so vignette and grain are a CSS overlay, fine dust is a WebGL point field, and chromatic aberration and fish eye are one SVG filter on the element that holds both layers (per channel `feOffset`, and `feDisplacementMap` over a barrel map that `src/ui/barrel.js` draws on a canvas at load, in sRGB). Fish eye and aberration start off; vignette, grain and dust start on at low strength. AGY measured each effect at under 4 ms of p95 at 40,000 files.
- HUD: the scrubber carries run markers (white start, red failed end, green finished end) and clicking one seeks. Each agent row has a Log button that opens or closes its chip, and Overview has Show all, which reads Hide all when every chip is open. Through a bridge, the HUD reads `/api/health` every 60 seconds and shows a chip under the Replay and Live switch only when something is wrong (the bridge not answering, Paperclip not connected, routes changed or not checked); a click lists the routes. `L` opens the event log, built from the same activities as the terminals. `?` lists the keys.
- Labels: a file touch shows `read NAME` or `write NAME` in white and `failed NAME` in red above its card for 2.6 seconds. Labels that land close together stack upward. Under reduced motion they appear in place and fade without rising. A failed tool call also lays a red `FAILED NAME` band across the card's face for 2.6 seconds over red scanlines.
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
| `agent.spawn` | `child` (the parent key, `~` and a number from 1 within the parent's run), `name` (at most 40 characters), `label`; `agent` is the parent |
| `agent.end` | `ok`; `agent` is the child |

The OpenCode and Hermes parsers emit `agent.spawn` and then `agent.end` at the time of a `subagent` or `delegate` line, since those harnesses report a child only when it has finished, and keep the `other` tool call for the same line. `state.js` adds a child to the roster with `parent` and `depth` (at most 3), and the parent's `run.end` ends its children still working. The engine adds a view for a child when it appears (S2d): the next spare shape at 0.6 of its parent's size beside the parked parent (`childPlace`), a short line to it, and a chip titled `PARENT > NAME`; since the harnesses report a child only at its end, it stays at full opacity for 6 seconds of wall time after it ends and then fades over 1.5 seconds (`childFade`, pure, tested; under reduced motion it goes at once after the 6 seconds). The HUD lists a child under its parent, indented 16px a level, with a `subagent` tag (`.hud-agent-row.is-subagent`, `.agent-subagent`); the number keys pick top agents only.

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
  .mr-card-bracket.is-{tl|tr|bl|br}   (built with every card, shown on .mr-card.is-targeted)

.mr-callout.is-{working|error|done}
  .mr-callout-title
  .mr-callout-task
  .mr-callout-cmd

.mr-board
  .mr-board-title
  .mr-board-summary[.is-over]
  .mr-board-rows
    .mr-board-row[.is-dim]
      .mr-board-row-head
        .mr-board-name
        .mr-board-cost
      .mr-board-row-meta
        .mr-board-tokens
      .mr-board-bar-track
        .mr-board-bar
  .mr-board-quotas
    .mr-board-quota[.is-error]
  .mr-board-empty
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

- The sphere layout compares every pair of cards on a shell; 300 cards take about 110 ms cold and about 1 ms for an added card.
- The overview fits only the root and the always-present cards (V18), so its distance in the seeded replay fell from a median of 13,753 units (largest 16,801) to 7,090 (7,474) at 40,000 files, and from 14,110 (17,377) to 7,196 (7,499) at 200,000 (`npm run scale-probe` prints the `overview distance` row). The cards are still small there; following the touched card (V15) is what makes them readable.
- Hermes read lines carry only a file name. When two files share it, the parser picks the one in or nearest the folder of that run's last file; with no folder yet, or a tie, the name lands at the root.
- Failure is read from tool status and from output text such as a test marker. A tool that fails quietly shows as ok.
- In live mode without a file list, a Hermes read shows only a file name, so a file it reads before any other agent has touched it appears at the root until its real path is seen.
- The proxy route needs the dev server. The bridge route works with a production build too, and `npm run serve` serves that build from the bridge on one port.
- The bridge and the scripts start git by its absolute path from PATH (`gitPath()` in `server/programPath.js`), because Node on Windows runs a `git.exe` from the child's working folder first when `NoDefaultCurrentDirectoryInExePath` is not set, and a lane worktree is such a folder. They name `refs/heads/main`, never `main`, so a tag cannot stand in for the branch. A run and its children stop through `killTree()` in `server/processTree.js` (`taskkill /T /F` on Windows, the process group elsewhere).
- The bridge allows a page only from `http://localhost:PORT` or `http://127.0.0.1:PORT` on its own port, from the Vite port 5173, and from each exact origin in `MACHINEROOM_ORIGINS` (a comma list of `http://localhost:N` or `http://127.0.0.1:N`; other entries are skipped with a printed line). Any other Origin gets 403; a request with no Origin, such as a same-origin GET or `curl`, still passes. A page on an allowed origin can still use every route, so a lane run, a merge and a backup each need `confirmed: true`, and a merge also needs the lane's exact head sha.
- The bridge masks a key that Paperclip splits across chunks of one run and stream (`createSplitMasker` in `src/briefs/audit.js`): it holds a chunk whose last line could still grow into a key, and every later frame, for at most 1 second. A key whose head was released after that second, unmasked because it was not yet a whole key, reaches the page as that head and `[key]` in the next frame. The proxy route (no bridge) masks in the page instead (`openStream` in `src/live/source.js`), with the same rule and the same 1 second hold. Both start a new line, so text from before a gap is never joined to the chunk after it, when a chunk's `seq` is not its run's last `seq` plus one, when a chunk still has `truncated: true`, and when the socket opens again (`reset()`, Q1c). Paperclip numbers `seq` per run across stdout and stderr: the 83 recorded runs have no gap in 5641 chunks.
- Through the proxy route (no bridge), a tool call whose log line is over 8192 characters is missed. A real run lost 3 of 58 calls this way, all reads outside the project.
- About half of the full test runs on this machine die inside `node.exe` 24.15.0 with 0xC0000409 (bash shows exit 127) while the test files that start a bridge run (`bridge`, `control-contract`, `bridge-reviews`). The Windows event log names Node itself at a fixed address, and a probe hit the libuv assertion `!(handle->flags & UV_HANDLE_CLOSING)` in `src\win\async.c` when a process exited right after `bridge.stop()`. The forks pool still crashes, and one worker avoids it but is 3.6 times slower (T15). A crashed run leaves its `mr-*` temp folders behind. `npm test` runs them again by itself (T15b); it is not a test failure. After the owner moved to Node 24.22.1 (2026-10-22), three full parallel runs in a row passed with no retry; the retry stays until more runs agree.
- On this machine a test that starts git or a bridge takes 1 to 4 seconds alone and up to 11 while a lane runs its own suite, so `vite.config.js` allows 20 seconds a test and a hook instead of the default 5.
- On a project of 40000 files `GET /api/tree` holds about 0.6 MB in the folder shape and 115 KB gzipped, and on 200000 files about 3.1 MB and 570 KB gzipped (P3d, P13); a page's first `tree` event then holds only the files added since that answer. A page older than P13 sends no `since` and gets the whole list again on the stream. The warm card layout takes about 14 ms for 122 cards on this machine, close to one frame. A warm layout stops as soon as no card overlaps another card, the hub or an obstacle, and the room runs the layout only when a card appears, goes or changes size (V10). In the seeded replay at 200,000 files, where three agents touch files at random, up to 165 cards are drawn; no two overlap since P14b, the layout grows to about 4900 units tall (3800 before), and the cards move over 150 units on average in 82 of 399 layouts (52 before), with the worst move no larger. `npm run scale-probe` prints the chain's overlaps, moves, worst move and height. After V11 (the folder plan runs only when the file count, the newest activity, an agent's focus or a pin changes, and resting cards and strands skip their DOM and buffer writes), AGY measured a median of 8 ms and a p95 of 36 ms at 200,000 files (9 and 40 before), and 11 and 33 at 40,000 (10 and 42), in a front window at 1280 by 800.
- On a real git checkout of 200,000 files (`npm run scale-live`, P15), the first tree read takes about 3.7 seconds, the bridge holds about 190 MB, the gzip folder answer takes about 0.2 seconds, a new file reaches a page in about 1.8 seconds, and in a burst of 2000 new files over 10 seconds the bridge itself uses about 7 percent of a core and the last file arrives 1.7 seconds after its write. Each `git ls-files` keeps about one core busy while it runs (0.4 seconds at 40,000 files, 3.7 at 200,000), and a burst starts a few (4 at 200,000 files, 6 at 40,000).

## Open work

The orchestrator (an interactive OpenCode session from 0.1.163; Claude and Hermes before) works from `docs/agents/ORCHESTRATOR.md`: the standing rules, the review and merge loop, who owns what and the review lessons. See `docs/agents/PLAN.md` for the order of work and `docs/agents/TASKS.md` for the briefs. The plan for the planner, orchestrator, budgets and routing is in `docs/agents/CONTROL-PLANE.md`. The October audit (`docs/agents/AUDIT-2026-10.md`) lists each security finding, its fix and the 17 left open with the reason. The UI audit (`docs/agents/AUDIT-2026-10-UI.md`) does the same for the code that runs in the browser: 10 findings fixed at the time, and the 10 it left open fixed since (U6 to U12, U14 and U19). The delta review (`docs/agents/AUDIT-2026-10-DELTA.md`) reads what changed from 0.1.121 to 0.1.152: 8 findings, all fixed by briefs Q1a to Q1f. Whether the room can also ship as a page inside Paperclip (yes for the viewer, through an iframe in a small plugin; no for lane runs, reviews and merges) is in `docs/agents/PLUGIN-PAGE.md`. What Paperclip's code says about database backups (the one backup route, the age in `/api/health`, and restore by hand) is in `docs/agents/BACKUPS.md`.
