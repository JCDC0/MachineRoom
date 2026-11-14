# Layout of the code

The files in each folder, one line each.

## Layout of the code

```
src/model/        pure logic, no DOM, fully tested
  paths.js          path cleanup, ancestors, tree builder by a sorted prefix walk
  commands.js       files and folders a shell command touches
  folderView.js     planFolderView: the cards to draw from the files, the focus, recent touches, pins and alwaysDepth, with at most `MAX_CHILD_CARDS` (10) child folders under an inner folder and every top-level folder under the root, and `limitItems` false keeps every folder and file item a card holds up to `MAX_FOLDER_ITEMS` (2000), with the focused and touched items first and never left out, and `hiddenItems` counting the rest (P24); a bulk folder (`isBulkFolder` over `BULK_FOLDERS`, pure, tested) stays one closed card with no child cards until an agent touches a path inside it, a pin names it or the owner clicks it; the child folders a card draws rank by focus and recent touches, then by the optional `changed` files, then by file count; it keys each cached folder view on that folder's version, its drawn children and the focused and touched paths inside it, never by a walk of its content, so one touch rebuilds only the folders it changes and a plan costs the same beside a folder of 50,000 files (0.08 ms after a touch inside it, 16 ms before P24)
  liveTasks.js      agentTasks: the task label per agent for the callout and the family tree row
  online.js         isOnlineCall: an agent tool call that reaches the network, from a web tool, a shell command that runs git push, git pull, git fetch, git clone, git ls-remote, gh, curl, wget, Invoke-WebRequest, Invoke-RestMethod, ssh, scp, ngrok, cloudflared, localtunnel or lt --port, or a browser or fetch tool from an MCP server; false for a local address, a quoted word, a commit message and any file read or write; laneNeedsNetwork and isLocalAddress, pure, tested
  hierarchy.js      readLadder, ownerOf, inScope, outsideScope, canChange, sectorArcs, subPrompt and agentDepthLine: the sub orchestrator ladder, its glob scopes, its ring sectors, its instructions and the subagent depth sentence
  parsers/          claude.js, hermes.js, opencode.js, agy.js, codex.js and copilot.js (one parser per agent type), common.js (the line reader and small helpers), index.js (the parser picker over the harness registry), and unreadable.js (lines shaped like a tool call that no parser read, and a counter that joins lines split across chunks)
  pipeline.js       frames -> activities (createPipeline for streams, buildActivities for a batch)
  log.js            activities -> event log lines and run markers
  state.js          activities -> room state (agents, files, folders), where a finished child leaves the agents 7.5 seconds after it ends on replay time, and a file version that lets the view list append one new file
  player.js         replay clock, seek, speed, idle compression
  source.js         parse and prepare a recording
  sessionRecorder.js createSessionRecorder (the last minutes of live frames, from the first run or conversation frame) and recorderToReplay, which builds the replay prepare would build, with time from 0
  costs.js          costBoard: the control client's costs joined with the room's agents (rows, shares, quota windows)
  fileIndex.js      indexFor: a set and a base name map per file or folder list, kept in a WeakMap and caught up with entries pushed later, so a shell command (commands.js) or a Hermes read (resolveKnown) costs the same at any repo size
  replay.js         fetch the recording from public/fixtures or public/recordings, read public/recordings/index.json (parseRecordingIndex, loadRecordingIndex, describeRecording, filterRecordings), and decide the plain replay (recordedReplayRequested, recordedReplay)
  recordLimits.js   the session replay's record time: 10 minutes by default, 1 to 240, and clampRecordMinutes
  scaleTree.js      makeScaleTree, scaleActivities and createScaleReplay: the seeded tree and activities behind `?scale=N` and `npm run scale-probe`
  laneStarter.js    laneStarterTop and sessionKeyFor: the session agent that started the lanes to place it at the top of the room (pure, tested)
  conversation.js   conversationFromLog turns Claude, OpenCode, Codex or AGY log lines into masked prompt, agent, tool, line and result entries capped at 2,000 entries and 4,000 characters (pure, tested)
src/harnesses/    one browser-safe descriptor per harness, each with the `laneName` and `defaultProgram` a lane the owner makes takes when the room's `lanes.json` has no lane of that harness (P54): claude.js, opencode.js, hermes.js, agy.js, acp.js, codex.js, copilot.js and machineroom.js, which runs scripts/mr-agent.mjs, a small coding agent over any OpenAI-compatible key that prints Claude Code's stream-json lines and, since H12, has web_search and web_fetch tools; since P44 its `read_file` reads 2000 numbered lines at a time with `offset` and `limit`, `run_shell` runs Git Bash on Windows (else PowerShell, never cmd.exe) and keeps the first 2,000 and last 6,000 characters with the exit code, `search` takes `glob` and `ignore_case` and skips gitignored files in a git checkout, `glob_files` lists files by a glob, and `edit_file` takes `replace_all`; since P45 its system prompt names the working folder, the system, the shell and the date and carries the project's `AGENTS.md` or `CLAUDE.md` up to 20,000 characters, it retries 429, 5xx, network and time-out failures 4 times with 2 to 16 second waits or `retry-after` up to 60, never a 400 or 401, each assistant line carries its usage for `peakTokens`, the oldest tool results past `MR_AGENT_CONTEXT_CHARS` (400,000) are replaced with a marker, then old assistant text and old `write_file` and `edit_file` arguments (each call keeps its id, name and path), and last the results of the newest turn are cut to 2,000 characters but never removed, so a turn with many parallel calls keeps every result (P50, P61), every path is checked by its real path so a junction or link that leads out is refused, `read_file` reads only its line window and refuses a file over 50 MB with no `limit`, and `search` and `glob_files` list only the start folder (P52), the step limit is 200 (`MR_AGENT_MAX_STEPS`), `--reasoning` becomes `reasoning: { effort }` with `max_tokens` 32000, and a `bash.exe` under the Windows folder (WSL) is never used; opencode and claude descriptors have an optional pure failure(log) for the last printed error; common.js holds the shared line reader and token helpers; index.js holds HARNESSES, harnessByKey, harnessByAdapter, AGENT_ORDER and the brief owner order
src/engine/       three.js scene, no React
  ring.js           layoutRing: the flat ring (V27), whose folder queue is walked with an index. The top-level folders sit on one ring in the hub's level plane, the first at 12 o'clock straight back from the overview camera and the rest clockwise at equal angles (`ringAngle`), on a radius from the hub centre that grows with their count so the cards do not overlap and never goes under 900 (`ringRadius`, from each card's diagonal plus a 40 unit gap). Up to 12 top-level folders hold the base ring (`RING_MAX_TOP`), and the rest spray outward from 12 o'clock in a square-like grid of rows 380 units apart (`SHOTGUN_ROW_STEP`, `shotgunOffset`). A folder's children follow the same shotgun grid from its radial line, the first row 450 units out and each later row 380 (`CHILD_STEP`), level by level, so four children form a 2 by 2 grid. The root card sits directly beneath the hub circle at the ring's centre, at 0 on x and z (`ROOT_PLACE`), with its top edge 240 units below the plane, so a taller root card grows downward and never reaches the hub circle or the ring's projected front edge at the overview pitch. A clicked card lifts 140 units out of the plane (`SPRAY_LIFT`). A warm start keeps every card whose parent and slot did not change, and a card whose slot did change glides to its new place (pure, tested)
  strings.js        straight lines from the root card's tab to each top-level folder's tab and from each folder's tab to its parent's tab, faint grey at rest and bright only while a working agent's path runs through them, each with a strand of seeded points that turns yellow and travels on that path, and every frame reads both tab anchors and rewrites a line and its strand only when an end moves, so a lifting, gliding or popped card keeps its strings attached (tabAnchorOffset, strandPoints and linkOnPath are pure, tested); each card carries a move stamp that changes only with its place, lift, scale or height, `cards.anchor` answers from a tab point kept per stamp and camera basis, and a string whose two ends carry the stamps of its last write is skipped, so a frame over resting cards computes no anchor and writes no string (P37)
  room.js           builds the scene, runs the frame loop, reacts to activities, follow mode, the card hold and park, inspect and the open calls and file touches behind the inspector, setBloom, setLadder, setRoster, setTasks, setCosts, setGitState, focusGitTree, gitAt and setOnline; its world hands the agents each card's tab anchor for the tunnel waypoints
  cards.js          folder cards from planFolderView, each a CSS3D element with a depth plane and up to three folder backs, glides and grows, rows for files up to `maxFiles` with a list that scrolls past it, any number of items listed by scrolling, a path to index map on each card, and above 60 items only the rows in the scroll window plus four on each side, drawn between two spacers that keep the scrollbar's height and position and redrawn on the list's `scroll` event, while a row's marks and `.is-inspected` come from its path when it is drawn and a row out of view is looked up from the card's centre and edge (clampFileLimit, cardRows, rowWindow, cardSize and backOffsets are pure, tested), `viewInput` appends one new file to its cached list, the frame loop walks the card map in place and rebuilds a card's class string only when its inputs change, its row pass visits only the cards whose rows a flash or a run end marked and `markRows()` marks them all, and `bottom(dir)`, the card's y minus half its height times its scale, and `anchor(path, out)` puts a string's end on the card's tab in its drawn place, lift and pop included
  labels.js         file name labels that rise and fade above a card tab when a file is read, written or fails, on replay time
  agents.js         each agent's home on its hub slot or inside its sector arc, a sub orchestrator above its arc, a faint grey line from each lane to the orchestrator that leads it and a thin white one from each sub to the main (orchestratorLineEnds and lineParentKey are pure, tested), link line to the chip, the thinking spinner: two faint white rings at right angles round the shape at 1.35 times its bounding sphere's radius, each with a bright quarter arc that sweeps once a second out of phase, built once per agent with only its rotation and opacity changed per frame (`agentThinking`, `thinkingLevel` and `thinkingArc` are pure, tested), the grey tunnel as two Line2 trails from the agent's centre to the touched card's tab along the lit folder chain, a 2 pixel core and a 9 pixel sheath at a quarter of the core's opacity, both sharing one LineGeometry, whose LineMaterial resolution follows the lens (litChain, tunnelRoute, speckPolyline, stripPoints and tunnelLevel are pure, tested; a missing card falls back to the straight tunnel), the blue online beam as the same light trail of `#2a9dff` with a thinner core from the agent to the INTERNET shape, an `onRemove` callback when a view goes, the CSS3D callout with the agent's command, which keeps only its name block above four agents at work except for the focused, hovered and two newest (fullCalloutKeys is pure, tested), setRoster: views added and removed in place, a removed child's shape goes back to the spare list, a child's home taken from its parent's home on every layout change, and setLabels: the callout and the name sprite together, and a shape's pulse writes its vertices only when its band levels or its pulse scale changed since its last write, so a resting shape uploads nothing
  stars.js          the stars: one pool of 48 points, each a 22 pixel core and a 40 pixel halo at 0.35, flying a route at 1800 units a second in 0.25 to 0.9 seconds on replay time, following a moving card through its `follow` callback, with `cancel` and `land` for a failed call, a run end and a removed agent (agentStar, starDuration, starEase, starPoint, starAdvance, starRoute, starSlot and touchLabelPoint are pure, tested)
  shapes.js         one distinct wireframe shape per agent, the armillary for the orchestrator and each sub orchestrator
  hub.js            the ring in the middle, its sector arcs and labels, agent slots, pulses, the sector at work and which agents take a slot (takesHubSlot, parkedKeysFor, sectorLaneAngles, sectorIdForKey, sectorGlow and workingKeys are pure, tested), and an equal ladder rebuilds nothing, a slot's colour and opacity are written only when they change (`writeColor` and `writeOpacity`), and the working sectors are one reused set
  internet.js       the INTERNET shape high above the hub: a wireframe sphere whose vertices breathe by a seeded phase and swing computed once (morphOffsets, pure, tested), a small label under it and a soft glow while an agent is on the web; setOnline(false) turns the wireframe and label `#ff2a2a` with `NO CONNECTION` and leaves the breathing on
  gitTree.js        layoutGitTree: the project's commits beneath the root project card as a horizontal timeline, its trunk `GIT_ROOT_GAP` 120 units under the card's bottom, oldest on the left and newest on the right at a step capped at `GIT_MAX_WIDTH` 1400 units, the current branch's first parent chain, or the commit a detached checkout stands on, as the trunk on the hub's axis and every other branch leaning out from where it leaves the trunk or the branch it forks from at its own angle in name order, each branch commit keeping its x by its level while it leans below the trunk over the half circle around the x axis, the leftover commits on the same half circle oldest first, with a segment per parent link and at most 12 branch name labels just above their tips (current first, then newest), all pure and tested; createGitTree draws one white LineSegments and one vertex coloured Points, the current head in `#e5ff00`, rebuilds only when the sha list, the current branch or the head changes, follows the card's bottom with `setTop`, answers the middle of the trunk with no allocation per frame, hides a 60 unit hit box around the whole tree that the raycaster still hits, holds still under reduced motion and takes no part in the overview fit
  void.js           the faint 3D lattice, the far dust and the dust motes through the room, each speck with its own seeded 3-axis velocity, wander rate, phase and pulse that soft-bounces at its shell, and no dust layer turns as a group (motePoints, moteOpacity, dustPoints, driftSpecks, driftPoint, speckPulse and bounceRadius are pure, tested; setFineDust)
  bloom.js          the bloom screen: a second transparent WebGL canvas over the room's own canvas, inside the lens clip and with `mix-blend-mode: screen` and no pointer events, that renders the same scene and camera into a half float target and copies only the bloom from three's `UnrealBloomPass` with its alpha (`BLOOM_THRESHOLD` 0.15, `BLOOM_RADIUS` 0.4); the canvas is the full lens size in CSS, but its scene pass, its target and the pass's blur targets are `BLOOM_SCALE` 0.5 of the lens's pixel width and height (`bloomPixels`, pure, tested), stretched back over the lens, and its renderer has antialias off and a pixel ratio of 1 whatever the screen's ratio; it exists only while the effect is on, resizes them with the lens at the same half size, and disposes them all when it turns off
  terminals.js      CSS3D terminal chips beside their agents, one line when closed and a log when open, and the cyan console above an agent that runs a command
  board.js          the cost board: boardLines and boardVisible (pure, tested), boardHost (the dock slot), and the board itself, fed by costBoard
  camera.js         orbit, zoom, focus, pointer drift that reads the surface rect on a resize and again after a page scroll, not on every pointer move, a held card, fit the overview to a set of spheres, and the text scale that keeps a sector label readable (pure fitView and minTextScale, tested)
  sprites.js        the room's palette (WHITE, YELLOW, RED, GREEN and WEB, for activity, active, failure, finished work and the web), the seven agent colours `AGENT_COLORS` with `agentColor`, `TUNNEL_GREY`, the seeded random numbers behind its layout, the easing helpers, `still()`: one shared reading of `prefers-reduced-motion` that follows its `change` event, released by `disposeStill()` when the room goes, the glow texture, the Space Mono 400 text sprite and the additive line material (seeded, easeInOut and easeRate are pure, tested)
src/control/      the control client contract, its mock (mock.js), the real client over the bridge (client.js), and `agents.js` (the reasoning efforts)
  modes.js          MODES, ASK_READY, modesFor, legacyMode and defaultMode for orchestrator permission modes
src/policy/       route.js: the routing policy, version 1 (readPolicy, tierFor, escalate, chooseRoute) over docs/agents/policy.json; profile.js: profileFromBrief, the profile tierFor reads, from a brief; proposals.js: proposePolicy, policyText and policyDiff, a reorder of one tier suggested by the outcome table as a patch to review; pure, tested; the bridge answers POST /api/control/route with chooseRoute, quota and spend from the lane costs (server/policy.js); routeLane walks a tier's choices as chooseRoute does and skips a lane that is not in the room, retired, turned off or busy, with a reason for each, falls to the first free lane and answers no lane when none is free; POST /api/control/route/lane takes `{ brief, task, failures }` and answers `{ lane, model, reasoning, tier, reason, skipped }`, POST /api/control/runs with no `lane` or `lane: "auto"` routes first, answers 409 with the reason when no lane is free and adds `routed: { tier, reason }`, a sub orchestrator's token routes only among its own lanes, and both read this repository's policy.json when the room's project has none; Dispatch's lane picker has `Auto` first, shows `Auto: LANE. REASON` under it 400 ms after the task text last changed, and its confirm card adds `Picked by the routing policy: REASON`; a task typed in Dispatch gets its tier from `profileFromTask`: small at 300 characters and 2 named paths or fewer, medium at 1500 characters and 6 paths or fewer, large beyond that or when it names a secrets, deploy or data path or says it needs the owner's yes, and a queue takes the largest tier among its tasks (P31, P39); the route and a routed start share `laneStatesFor` and `readStartLanes` in `server/runs.js`, so both read this repository's lanes with the owner-made ones and without the removed ones, the bridge's runs folder for the locks and the spend, and a project with no saved lane choice answers 400 `Pick the lanes for this project first.` on both, which Dispatch shows after `Auto:` (P41)
src/briefs/       briefs.js parses TASKS.md, keeps a brief's whole body down to the next heading, reads the last real Files list up to its paragraph, ignoring a Files marker only inside matched inline backticks or closed backtick or tilde code fences, so prose quotes and apostrophes do not hide it (P133, P143), and builds the prompt from HOUSE-RULES.md, lanes.json and the subagent depth sentence, plan.js builds and parses a plan, queue.js holds the plain text task queue, run.js holds the lane runner's pure command, argument, stats and record helpers and the summaries over the harness registry, recording.js builds a recording's frames, agents, tree and index and shares its line reader with the live lane source, review.js holds the checks behind npm run review-lane, audit.js finds and masks keys (pure, tested)
src/decider/      decision model seam: wire.js (Decisions API shapes), decide.js (`decide()`), questions.js (the fixed questions), stats.js, baseline.js, and eval.js (the comparison runner; see DECIDER-EVAL.md; not used by the app yet)
src/assistant/    request router: actions.js (the closed action list), intent.js (rule based intent), and dispatch.js (runs a validated action against a host: the room, the HUD, the control client). Pure, tested; see CONTROL-PLANE.md
src/ui/           React HUD: Hud.jsx (menu, dock, agents, event log, mode switch, help), AgentDock.jsx (the selected agent's context in the dock), Inspector.jsx (the click inspector, opened by a click on an agent, folder, file row, the INTERNET sphere or the git tree and by the machineroom:inspect event; it shows the agent rows from agentContext, the folder explorer, the plain file preview, the connection and agents on the web, and Source control with the branch, the changes and the commit graph) with its helper inspector.js (the state word, the explorer rows, the breadcrumb, the effort lookup, the preview notices, the path cut and gitGraphRows, U94 and U97), OrchestratorChat.jsx (the chat, with a tab per orchestrator and, once a sub exists, a read-only Team tab after them that merges every orchestrator's messages by time and opens an orchestrator's tab from a line, a To select that sends to the orchestrator, a sub or a lane, agent message lines in the sender's colour with `Show all` and a saved Show agent messages switch, a `/` at the start of the draft opens its command list under the box, the room's own commands never reach a turn, and a sub that leaves the list loses its chat, loaded and started marks), Sidebar.jsx (the left sidebar in three tabs, Chat, Projects and Agents; Chat has one menu per conversation with its keys, a search box, a kept sort, unread dots and archived rows), SidebarTabs.jsx (the square Chat, Projects and Agents tabs, U45), RepositoryPanel.jsx (the Repository section at the top of Projects, U92) with its helper repository.js (the current branch, the branch rows and their switch reasons, the new branch name checks and the confirm sentences), FamilyTree.jsx (the agent family tree, its node editors, Add child and the Requests group, U43), FamilyTeam.jsx (Build a team: the orchestrator and coder counts, the harness and model, the lane preview and the confirm card, U81), family.js (the tree order and depth, the row state and task text, the harness labels and form lists, the proposal rows, the OpenCode-first child defaults, the convert plan, the subs that lose lanes, the team lane pool and plan), AutocompactInput.jsx (the autocompact switch, value, unit and compact rules) with its helpers autocompact.js, MusicPlayer.jsx (the playlist select, the music list, transport and volume in Settings, driven by musicQueue.js), musicQueue.js (the page's music queue, order, loop, shuffle, ended listener and saved music choices, so playback goes on with Settings closed), SearchSettings.jsx (the Web search provider, its SearXNG address and the Tavily and Brave key boxes in Settings), sound.js (the beep and dance engine, with the pan, gain, band group, beat, delete and rate helpers), EndpointsPanel.jsx (the Direct API quick key, endpoint rows and custom endpoint form in Settings, U85), McpSettings.jsx (the MCP servers, the add server form and the tool tester in Settings, U64), ModelRefresh.jsx (the shared circular refresh button and model select) with its helper modelRefresh.js (the live and saved list merge, search and groups, U47), ModelPicker.jsx (the model picker with search by name and id, six sort orders, pinned models first, and each row with its context, price and date), Guide.jsx (the first visit guide and the outlined tour), SetupCard.jsx (the first run choice of how many agents), Launcher.jsx (the project picker on first load), Transport.jsx (transport with run markers, the live link tag, the orchestrator's state, its context ring, a chip per sub, a pill per busy or failed lane and the spend) with its helpers transportOrchestrators.js (the chip list and its tones, U80), transportLanes.js (the lane pills and the click that inspects a lane, U120) and transportSpend.js (the spend text and the click that scrolls the cost board into view, U120), Assistant.jsx, Connect.jsx, Waiting.jsx, Notice.jsx, Settings.jsx, KeysSettings.jsx (the saved key names in Settings, never a value, and their delete card, U124), emptyRoom.js (the empty room sentence, U124), lens.js (the working lane count and newest activity for the lens corners), liveLadder.js (the /api/orchestrators answer as a ladder), ladderForm.js (the ladder edits and their pure helpers), agentList.js (the short agent list and the number keys), ladderGroups.js (the agent rows grouped by the ladder), agentContext.js (the dock's rows), orchestratorChat.js (chat text, Markdown blocks, state, agent line names and colours, the runnable lane list, and the Team merge with its where and who tags), slashCommands.js (the slash list filter, its key action and the room command parse, pure, tested), contextRing.js (the context share, colour and label), and the helpers settings.js, aberration.js (the radial map values, the map placement on the lens, the channel scales and the canvas map url), grain.js (the white noise frame and its redraw), guide.js, sidebar.js (session groups, sort, search and archived rows, ages, the conversation menu items and keys, the row identity that closes the menu when its row leaves or changes (P142), the lane count line and choice, the tab list and the wait for a reopened bridge), setup.js, launcher.js, assistantHistory.js, brand.js, healthNotice.js, terminalButtons.js, useBridgeHealth.js, lensResize.js (the rail share clamp and its drag, wheel and key steps), lowerHalf.js (the lower half's breadcrumb and current session title), idleView.js (the 60 second idle turn), agentStrip.js (the agent strip rows and their autocompact values), dialogFocus.js (the shared dialog focus trap and its return), logScroll.js (the event log's follow only while it sits at the bottom), AgentStrip.jsx (the strip in the dock), LensRail.jsx (the Height and Zoom rails and the pure `railNear` behind their fade) and MenuIcon.jsx (the folded menu button)
  AgentDepthSettings.jsx  Subagents section in Settings to pick depth 1 or 2, or unlock 3 and 4 behind a confirm card
  LaneConversation.jsx    per-lane conversation view with run picker, folded prompt and tool calls, live polling and Stop
  LanesSettings.jsx       Lanes section in Settings to list lanes, show hidden lanes and remove or delete lanes behind a confirm card
  StorageSettings.jsx     Storage section in Settings showing usage by kind, clean merged worktrees, days preview and archive confirm card
  badges.js               reviewBadgeCount, proposalBadgeCount, orchestratorBadgeCount and actionBadges for HUD button counts
  failureTray.js          emptyFailureTray, addFailureActivities, failureRows and failureAge for recent failed tool calls and runs
  laneConversation.js     runOptions, foldToolCalls, foldPrompt, readDue, runOutcome, liveRunLane, runClock and toolText for LaneConversation
  panels/           control drawer on `C` (ControlDrawer.jsx): DispatchPanel.jsx, TasksPanel.jsx with IssueThread.jsx, MetersPanel.jsx, AgentBuilder.jsx and ReviewsPanel.jsx, with PanelBoundary.jsx and the helpers briefs.js, format.js, notices.js, reviews.js and runs.js (Dispatch starts brief runs and project task runs only, and while the room is offline its confirm card adds `There is no connection, so this agent will likely fail.` for a lane whose model is not on a local endpoint, still letting the owner start it; a task with a queued or running live run reads `running AGENT` or `queued AGENT`, from `liveRuns()` and the `liveRuns` notice; the project section has a `One lane per task` switch that pairs several tasks with idle lanes in picker order by planLaneTasks, lists each task with its lane on the confirm card, refuses when there are too few idle lanes, and starts one run per task in its own worktree three seconds apart, with a Stop button on the confirm card or the progress line that ends the run before the next task starts and says how many started while the runs already started keep running, and closing the drawer or a change of project ends the loop the same way while a new run starts uncancelled; Tasks lists the lane runs and its thread shows comments, both read only; Team lists the lanes from the room's `lanes.json` read only; reviews reads a lane's branch and diff and merges it after a confirm card, and when the room's root is another project it reads the lane's worktree beside that project, compares each lane against the project's current branch and merges by fast forward; no issue, comment, agent or plan write is offered) (uses only the control client)
src/live/         live mode: source.js (agent discovery and the roster diff), bridge.js (bridge discovery, event stream, probe), livePlayer.js (same interface as the replay player), simulated.js (recorded frames as a live feed), and tree.js (readFileList: the file list in either shape)
server/           the bridge: frames from the lane runs and the sessions, the agent list and file tree for the browser, and the built viewer when started with staticDir (static.js); lanes-source.js watches the run-lane logs and turns them into frames, sessions-source.js ticks the session readers server/harnesses lists, and orchestrators.js runs the ladder of orchestrators
  index.js          the bridge server: agents, tree, health, SSE, the control routes, the MCP routes, the agent depth route and the orchestrator routes
  music.js          /api/music and /music/NAME or /music/PLAYLIST/NAME: the music folder, the top-level tracks, one playlist per subfolder, content types and byte ranges; POST /api/music/open needs a page Origin, makes the folder when it is missing, and starts explorer.exe, open or xdg-open with an argument array, no shell and no kept output, answering 204 or 501
  orchestrator.js   one orchestrator: chat file, session, turn, stop, restart, room wake with one shared asynchronous git check per orchestrator for a merge, rebase or cherry-pick in progress (P145), context use, autocompact, the agent message lines it keeps and masks on load, the session list with its unread and archived flags and its fork, and the slash command scan and expansion behind `GET /api/orchestrator/commands`
  orchestrators.js  the ladder: the main orchestrator and one per sub, the routes (including `/api/orchestrator/commands`), the ladder save, the restricted scope check (it diffs the base commit the newest run record for the lane names, and the project's current branch only when no record names one), startedBy routing, and a chat message to a lane that starts a lane task through the runner
  harnesses/        claude.js and opencode.js: the Node half of each descriptor, with createSessionsReader; index.js joins them to the browser descriptors and lists SESSION_HARNESSES
  claude-sessions.js   the Claude Code session reader: session files, subagent files, kept tool items; it lists the runs folder for meta files only when that folder's change time moves (P30)
  opencode-sessions.js  the OpenCode session reader: the two session tables in opencode.db, read only; after its first read it asks only for the session rows whose time_updated passed the highest it has seen, once a second while a run is open and every 5 seconds at rest, so a new OpenCode session can show up to 5 seconds late, and once a minute it reads every row and forgets the sessions the database no longer holds (P30, P42)
  sessions-source.js  ticks every registered session reader once a second
  lanes-source.js   watches the run-lane and orchestrator logs, turns them into frames, and lists the lane and sub orchestrator agents; it lists the runs folder on a watcher event and every 2 seconds, not on every 200 ms tick, checks a finished log's size only on a watcher event that names it or on that scan, and reads the lanes again only when lanes.json or agents.json changes; it ends a quiet run only when its lane lock has no live run or child pid, by the runner's stale test (P30, P42, P138)
  control.js        /api/control routes: agents, issues, comments, approvals, live runs, costs and models
  lane-costs.js     this month's and today's cost per lane from the run records, and the tokens they carry
  lane-tasks.js     the lane runs as tasks for the drawer, with the live run and the brief title
  assistant.js      /api/assistant: run the local OpenCode model
  decide.js         /api/decide: the Decisions API proxy
  endpoints.js      provider presets, OpenAI-compatible endpoints in `<runs>/endpoints.json` and the quick key route (H10)
  mcp.js            MCP servers in `<runs>/mcp.json`, JSON-RPC tool lists and calls over stdio or http, and the /api/mcp routes (H14)
  briefs.js         /api/control/briefs and brief-prompt
  plans.js          /api/control/plans
  reviews.js        /api/control/reviews, diff and merge, against main or the project's current branch; the lane reviews run concurrently up to a small bound while keeping their order, the merge takes the same repo-wide write lock as the git routes, invalidates the git state and sends a `git` notice, and a lane's last run comes from every record, not the newest 20; its reads keep `GIT_TIMEOUT_MS` (10 seconds) and its merge, its fast forward and its merge abort get `GIT_WRITE_TIMEOUT_MS` (120 seconds), and a write that times out answers a sentence with the state of the checkout and puts the checkout back when it can
  policy.js         /api/control/route
  git.js            /api/git, /api/git/switch and /api/git/branch: the project's branches, commits and uncommitted changes, switching and making a branch; reads keep `GIT_TIMEOUT_MS` (10 seconds) and the switch and the new branch get `GIT_WRITE_TIMEOUT_MS` (120 seconds), and a timed-out write answers a sentence with the branch, whether the checkout is clean and whether the new branch exists
  files.js          /api/file: a read-only text preview inside the project root, with the page Origin check, the real path check, the refused names, the 256 KB cut and key masking
  network.js        /api/network: the online check over a TCP connection to 1.1.1.1, cached for 30 seconds while a page asks
  search.js         /api/search-provider and the SearXNG, Tavily, Brave and DuckDuckGo search behind the harness web tools
  active-lanes.js   active lane choice, /api/lanes and /api/lanes/active
  agents-config.js  owner-made lanes, /api/harnesses, /api/lanes/create, update, delete
  family.js         the family tree, key slots, proposals and agent labels
  agent-depth.js    the subagent depth in <runs>/agent-depth.json: limit and unlocked, the default of 2, GET and POST /api/agent-depth with the page Origin check and no orchestrator write
  runs.js           run and outcome records, the command behind a run, and a task or a queue run on the room's project (L3, S8b); startProjectTask starts a lane task for the bridge and the chat with the lane, task, project and dirty checks, and a runner that fails to start, dies by a signal or exits nonzero without writing a record leaves a failed one behind; its busy test reads a lane lock through the same holder check (P138)
  outcomes.js       outcomeTable: merge rate and cost per lane and model
  models.js         the model list, with each saved endpoint's models for the machineroom harness as NAME/MODEL
  model-list.js     the static model list per harness and its context windows, with the four Gemini 4 Hydrogen tiers for `agy`
  harness-models.js /api/harnesses/KEY/models: live model lists per harness, cached in <runs>/harness-models.json for 6 hours; modelAllowed validation helper (H13)
  doctor.js         the checks behind machine-room doctor and up, and the one project read that counts files and folders
  projects.js       recent projects, sibling folders, restart and forget, and a project switch that refuses while a lane lock names a live holder (run or child pid, by the runner's stale test, P125); GET /api/projects, POST /api/projects/open, POST /api/projects/forget
  static.js         the built viewer
  programPath.js    programPath and gitPath: absolute program paths from PATH
  processTree.js    killTree: stop a child and its descendants; processListCommand, parseProcessList, listProcesses and leftoverProcesses list the processes whose parent chain reaches a child or whose command line names a folder
  printed-path.js   printedRunsFolder: a path printed with %TEMP%, %LOCALAPPDATA%, %APPDATA%, %USERPROFILE%, $XDG_STATE_HOME or ~ in place of the profile, realPath, the real path of a folder, and isWindowsPath; run-lane and orchestrator import it directly, and run-lane still exports printedRunsFolder (P148)
  project-settings.js  readProjectSettings, writeProjectSettings, checkCommandProblem, hasNpmTestScript, readProjectCheckCommand and createProjectSettingsApi for /api/control/project-settings
  storage.js        measureStorage, previewStorageArchive, applyStorageArchive, worktreesCleanCommand and createStorageApi for /api/storage, /api/storage/preview and /api/storage/archive
  teams.js          readTeams, saveTeams and createTeamsApi for /api/teams, /api/teams/copy, apply and delete routes over teams.json
scripts/          the commands behind npm run: run-lane.mjs with lane-lock.mjs (one JSON line per lane lock with the run pid, the harness pid and the worktree, read beside the old plain pid), its runner commit that takes only the paths the briefs' Files lists name, and its printed log, record, recovery and dry-run paths and project-lock refusals with the longest profile prefix masked, including project and worktree paths (P123, P140, P144), acp-run.mjs (the ACP client loop), mr-agent.mjs (a small coding agent on an OpenAI-compatible key or a saved endpoint, which stops at `MR_AGENT_MAX_COST_USD` before a retry when cost is unknown, an answer is damaged or the request is lost), mcp-bridge.mjs (the MCP JSON-RPC client behind the harness tools), worktrees.mjs, review-lane.mjs, pack-check.mjs, history-audit.mjs, candidate.mjs, bump.mjs, scale-probe.mjs, scale-live.mjs, decide-eval.mjs, build-fixtures.mjs, screenshots.mjs, run-recording.mjs with recording-files.mjs, outcome.mjs, policy-propose.mjs, hand-run.mjs, agy-prompt.mjs, test.mjs, untar.mjs and acp-probe.mjs (a dev probe)
  merge-lane.mjs    prepareMerge, runChecks, checkMerge, finishMerge, abortMerge and parseMergeArgs for npm run merge-lane
  mr-approve.mjs    stdio MCP server machineroom-approve forwarding approve calls to /api/orchestrator/approvals
bin/              machine-room.mjs, the one-port command behind npm run serve, with its doctor and up subcommands (server/doctor.js), and machineroom.mjs, the short command behind npm link that runs up on a folder
src/main.jsx      mounts App
src/styles.css    stylesheet for the HUD, cards, chips, callout, cost board and screen effects
src/Stage.jsx     wires player, room and HUD together, with the ladder, the dock data, the inspector and the wait for a live room
src/App.jsx       chooses the first screen (connect, replay or live), loads the data, keeps the page's session recorder and shows loading, empty and error states
src/startup.js    pure: which screen to open from the address and the saved connection (tested)
src/storage.js    safe access to localStorage
public/fixtures/  the recorded run, agent list and file tree
tests/            vitest; tests/helpers/bridge.js starts a bridge on port 0 over a temp runs folder and lane scripts; tests/helpers/tempRoot.js puts every test temp folder under %TEMP%\machineroom-tests\<process id>, and a run first deletes the folders of test processes that are gone (tests/helpers/cleanTemp.js); tests/file-index.test.js keeps its own reference walk for the read and write modes, with a case that proves the walk can fail, and tests/project-task.test.js covers startProjectTask and the chat's lane dispatch (P131, P139); tests/tree-partial.test.js queues the next watcher name inside each partial read and checks ten partial reads before a full one, and tests/git.test.js waits for the first switch to reach the runner before testing concurrent write refusals (P146)
  fakeDecisions.js                  startFakeDecisions, oracle and truthOf fake Decisions HTTP server and ground truth helpers
  helpers.js                        loadRecording, loadScenario and testContext fixture loaders
  helpers/httpJson.js               requestJson HTTP helper with timeout and JSON parsing
  helpers/isolate.js                sets MACHINEROOM_RUNS to testRunsFolder() and clears MACHINEROOM_LANES_DIR
  helpers/lanePrograms.js           withLanePrograms stub lane CLI executables in a temp PATH bin folder
  helpers/uiDom.js                  createTestDom, withDom, click, settle, type, buttonWithText and classesOf React DOM test harness
  probes/assistant.js               ACTION_CASES natural-language assistant test probes
  probes/context.js                 sample context agents and paths for assistant and decider probes
  probes/routing.js                 TASKS and routingProbes labeled routing dataset
  fixtures/acp-opencode-updates.jsonl  recorded ACP OpenCode session updates and result fixture
  fixtures/fake-acp-agent.mjs       fake ACP stdio agent supporting model, reasoning, child updates and tool calls
  fixtures/fake-claude              fake Claude CLI script for orchestrator end-to-end tests
  fixtures/fake-claude.cmd          Windows batch wrapper invoking fake-claude
  fixtures/fake-lane.cjs            fake lane runner fixture writing lane-note.txt, optional commit and tool_use JSON
  fixtures/hermes-run.log           sample Hermes CLI run output log fixture
  fixtures/hermes-session.jsonl     sample exported Hermes session JSON fixture
  fixtures/opencode-run-json.jsonl  sample OpenCode JSON stream events fixture
  aberration.test.js                src/ui/aberration.js: radial aberration map offsets, corners, RGBA bytes and cached data URL
  acp-harness.test.js               src/harnesses/acp.js and scripts/acp-run.mjs: ACP descriptor, CLI args, runner startup and update mapping
  action-badges-ui.test.js          src/ui/Hud.jsx: review, proposal and paused orchestrator badge counts and click navigation
  active-lanes.test.js              server/active-lanes.js and /api/control/active-lanes: project hash, save cleanup and eligible lanes
  agent-callout-crowd.test.js       src/engine/agents.js: fullCalloutKeys cap, newest two, focused and hovered callout selection
  agent-colors.test.js              src/engine/agents.js, sprites.js, terminals.js: main yellow, sub counting, child parent color and CSS var
  agent-context.test.js             src/ui/agentContext.js, AgentDock.jsx: idle/working lane rows, run task fallback and missing cost rows
  agent-depth-settings.test.js      src/ui/AgentDepthSettings.jsx, Settings.jsx: depth 1 or 2 selection and unlock 3 or 4 confirm card
  agent-depth.test.js               server/agent-depth.js and /api/agent-depth: default 2, unlock persistence and corrupt file fallback
  agent-dock-ui.test.js             src/ui/Hud.jsx, Transport.jsx: agent dock display showing a lane's sub with multiple orchestrators
  agent-label-sprite.test.js        src/engine/agents.js, sprites.js: Space Mono text sprites, canvas reuse and callout updates
  agent-label.test.js               src/engine/agents.js: nameLabel uppercasing, 32-character cap with trailing tilde and non-text handling
  agent-list.test.js                src/ui/agentList.js: agent ordering, done/failed placement, idle toggle and number key lookup
  agent-presence.test.js            src/engine/agents.js: agentPresence dimming of never-run idle lanes while keeping active and queued full
  agent-strip.test.js               src/engine/agents.js, src/ui/agentStrip.js: stripPoints segment copies and orchestratorLineEnds
  agent-thinking.test.js            src/engine/agents.js: agentThinking state while a run is open and thinkingDue 250 ms wait
  agent-view.test.js                src/engine/agents.js, hub.js, terminals.js: failed call colors, child chip removal and hook cleanup
  agents-config.test.js             server/agents-config.js, server/index.js: made-lane key allocation, config file and template copying
  agents-lines.test.js              src/engine/agents.js: lineParentKey routing lanes to main or their sub orchestrator
  agy-prompt.test.js                scripts/agy-prompt.mjs: --help and -h usage output without writing a prompt
  agy-subagent.test.js              src/model/state.js: AGY child conversation spawn order, tool attribution and real-run checks
  approvals.test.js                 server/orchestrator.js, orchestrators.js: token-gated approvals queue, input cap, masking and timeout
  assistant-drag-ui.test.js         src/ui/Assistant.jsx: Escape drag cancel and pointer listener cleanup on unmount
  assistant-route.test.js           server/assistant.js: resolveOpencodeBinary lookup and leading-dash prompt rejection
  assistant-ui.test.js              src/ui/Assistant.jsx, assistantHistory.js: command history limit, deduplication and arrow navigation
  assistant.test.js                 src/assistant/actions.js, intent.js: action validation bounds, agent/path resolution and safe action set
  autocompact-draft-ui.test.js      src/ui/AutocompactInput.jsx: keeping edited fields across polls and save card toggle wording
  autocompact.test.js               src/ui/AutocompactInput.jsx, autocompact.js, AgentDock.jsx: mode/value/rules parsing and defaults
  badges.test.js                    src/ui/badges.js: reviewBadgeCount, proposalBadgeCount, orchestratorBadgeCount and actionBadges
  bloom.test.js                     src/engine/bloom.js: half-resolution bloom sizing, DPR fallback and transparent room layer
  bridge-client.test.js             src/live/bridge.js, tree.js: openBridge SSE open, version resume and full-list reset
  bridge-reviews.test.js            server/reviews.js, git.js: branch commits, diffs, dirty worktrees and single runs.jsonl scan
  bridge-routes.test.js             server/index.js, assistant.js, runs.js: /api/assistant timeout/Origin checks, 415 type and 413 body limit
  bridge-safety.test.js             server/index.js, src/briefs/briefs.js: prototype-key lane names and 500 handler containment
  bridge-stream.test.js             server/index.js, src/model/pipeline.js: SSE frame replay on Last-Event-ID, history=1 and reset ordering
  bridge.test.js                    server/index.js: Origin and Host allowlist, Vite block in serve mode and health/agents fields
  briefs.test.js                    src/briefs/briefs.js: parseBriefs across task/archive files, body slices, branchFor and owners
  browser-imports.test.js           checks that the browser bundle reaches no Node module from the page entry
  build-fixtures.test.js            scripts/build-fixtures.mjs, src/model/replay.js: sandbox file markers and fixture/sandbox agent lists
  bump.test.js                      scripts/bump.mjs: version comparison, four-slot updates, CRLF preservation and bad input rejection
  camera.test.js                    src/engine/camera.js: camera rig yaw/pitch drag, clamping, overview reset and idle park turn
  candidate.test.js                 scripts/candidate.mjs: parseCandidateArgs option parsing, port defaults, error checks and readLanes
  cards-frames.test.js              src/engine/cards.js: card depth mesh placement, dance lift ordering and missing-card tab anchors
  cards-virtual.test.js             src/engine/cards.js: spacer virtualization past 60 rows and focused row pinning past 2,000 items
  cards.test.js                     src/engine/cards.js: tab anchor offset, visible row sizing and faint back folder widening
  chat-newest-answer.test.js        src/ui/OrchestratorChat.jsx: keeping the newest chat response when an older read finishes last
  chat-open-ui.test.js              src/ui/Hud.jsx, transportOrchestrators.js: narrow viewport chat open, sub tab select and overlay close
  claude-sessions.test.js           server/claude-sessions.js, sessions-source.js: folder slugging, tool turn parsing, 2,000-char cap and tailing
  claude-stream.test.js             src/model/parsers/claude.js, src/briefs/recording.js: background subagent tracking, tool touches and cleanup
  client-timeout.test.js            src/control/client.js: per-route timeout tiers, absence of backup methods and request aborts
  codex-harness.test.js             src/harnesses/codex.js, src/model/parsers/codex.js: codex exec args, reasoning override, env and --add-dir
  commands.test.js                  src/model/commands.js: touchesForCommand extracting read, write and list paths from shell commands
  context-ring.test.js              src/ui/contextRing.js, Transport.jsx: context window share, warning colors and label formatting
  control-agents.test.js            src/control/agents.js: EFFORTS list of allowed reasoning efforts
  control-backup.test.js            src/control/mock.js, src/briefs/run.js: mock spend totals, bad day error and empty decide answer
  control-client-stream.test.js     src/control/client.js: SSE reconnect backoff from 1s to 15s and listener cleanup
  control-contract.test.js          src/control/client.js, mock.js, server/control.js: mock and bridge contract parity and write rules
  control-mock-briefs.test.js       src/control/mock.js, src/policy/profile.js: mock brief shapes, tier mapping, prompt building and errors
  control-mock.test.js              src/control/mock.js: contract methods, agent/issue filters and bridge write refusals
  conversation.test.js              src/model/conversation.js: Claude, OpenCode, Codex and AGY log parsing, masking and fallback lines
  copilot-harness.test.js           src/harnesses/copilot.js, src/model/parsers/copilot.js: CLI flags, reasoning override, env and event parsing
  cost-board.test.js                src/engine/board.js, src/model/costs.js: boardLines formatting for reported, zero, unreported and over budget
  costs.test.js                     src/model/costs.js: costBoard roster ordering, today/month cents and unrostered lane sorting
  decide-eval.test.js               src/decider/eval.js, scripts/decide-eval.mjs: planEval estimates and runEval calls against fakeDecisions
  decider-decide.test.js            src/decider/decide.js: Decisions bearer calls, missing config checks, error text and single 5xx retry
  decider-questions.test.js         src/decider/questions.js, baseline.js: fixed assistant/routing questions and state secret omission
  decider-stats.test.js             src/decider/stats.js: argmax, calibrationError, coverageAtError, flipRate and majorityAccuracy
  decider-wire.test.js              src/decider/wire.js: Decisions question builders and parseAnswers defaults
  dialog-focus-ui.test.js           src/ui/dialogFocus.js, Launcher.jsx, SetupCard.jsx, Sidebar.jsx, ControlDrawer.jsx: focus trap and return
  dispatch-auto-ui.test.js          src/ui/panels/DispatchPanel.jsx, runs.js: 400 ms Auto route preview, queue tiers and stale drop
  dispatch-offline-ui.test.js       src/ui/panels/DispatchPanel.jsx: offline warning on confirm cards for remote-model lanes
  dispatch-split-ui.test.js         src/ui/panels/DispatchPanel.jsx, ControlDrawer.jsx: background split-run loop across closes and stops
  dispatch-stop-ui.test.js          src/ui/panels/DispatchPanel.jsx: Stop action failure notice and hiding Stop when unavailable
  dispatch-target-deps.test.js      checks DispatchPanel target brief effect dependencies
  dispatch.test.js                  src/assistant/dispatch.js: running assistant actions, unknown targets and replay/settings answers
  e2e-room.test.js                  src/engine/room.js, src/model/pipeline.js: end-to-end recorded run layout, 12-card cap and room clock
  empty-room.test.js                src/ui/emptyRoom.js: empty live room sentence visibility in live, replay and demo states
  endpoints-form-lock.test.js       src/ui/EndpointsPanel.jsx: locking custom form inputs while save confirm card is open
  endpoints-panel.test.js           src/ui/EndpointsPanel.jsx, server/endpoints.js: presets, model parsing, URL rules and quick API order
  endpoints-quick-ui.test.js        src/ui/EndpointsPanel.jsx: closing quick key confirm on key edit and syncing key slots
  endpoints.test.js                 server/endpoints.js, models.js: provider presets, remote HTTPS vs local HTTP rules and config file
  engine-dispose.test.js            src/engine/agents.js: disposing Three.js geometries, materials, textures and scene objects
  failure-tray.test.js              src/ui/failureTray.js: recording failed calls and runs, deduplication and removed-lane cleanup
  family-ladder-ui.test.js          src/ui/FamilyTree.jsx, FamilyTeam.jsx: stale-ladder abort when subs change under open cards
  family-team.test.js               src/ui/family.js: team lane pool ordering and Team 1 / Team 2 plan construction
  family-tree-ui.test.js            src/ui/FamilyTree.jsx, FamilyTeam.jsx, family.js: read failure notice, rows, off dots and layout
  family-tree.test.js               src/ui/family.js: tree walk order, off states, duplicate filtering and key/proposal lists
  family.test.js                    server/family.js, /api/family: buildFamilyNodes defaults, custom labels and proposal responses
  files-network.test.js             server/files.js, network.js: Origin/Sec-Fetch-Site checks, symlink/secret blocks and 404/400 status
  folder-view.test.js               src/model/folderView.js, src/engine/cards.js: planFolderView focus expansion, 3-card cap and outlines
  follow-card.test.js               src/engine/camera.js: followTarget hold window, root fallback and middle-two-thirds deadband
  frame-cost.test.js                src/engine/agents.js, hub.js, sprites.js: skipping vertex writes while resting or band levels hold steady
  git-init-hint-ui.test.js          src/ui/Launcher.jsx, Sidebar.jsx: git init copy action, clipboard fallback and non-git markers
  git-tree.test.js                  src/engine/gitTree.js: layoutGitTree trunk placement, sorted branch angles and merge parent links
  grain.test.js                     src/ui/grain.js: monochrome noiseFrame seeding, 1px clamp and redraw interval
  guide.test.js                     src/ui/Guide.jsx, guide.js: five guide steps, clamping and first-visit guide flag
  hand-run.test.js                  scripts/hand-run.mjs: usage output, lane validation refusals and recording manual runs
  harness-models.test.js            server/harness-models.js, model-list.js: parsing AGY/OpenCode model output, list flags and caching
  harness-modes.test.js             src/briefs/run.js, src/harnesses/agy.js, src/harnesses/machineroom.js: permission mode flags and environment vars
  harnesses.test.js                 src/harnesses/index.js: AGENT_ORDER, OWNER_ORDER, adapter lookups and command building
  health-notice.test.js             src/ui/healthNotice.js, useBridgeHealth.js: filtering junk/unreachable bridge states and stopped runner warning
  hierarchy.test.js                 src/model/hierarchy.js: readLadder validation, defaults and sector geometry rules
  history-audit.test.js             src/briefs/audit.js, scripts/history-audit.mjs: --help usage and redacting matched token patterns
  hub.test.js                       src/engine/hub.js, src/model/hierarchy.js: even lane placement inside non-empty sector arcs
  hud-keys-focus.test.js            src/ui/Hud.jsx: key handling separation, Help/Settings focus traps and focus return on close
  hud-keys.test.js                  src/ui/Hud.jsx: hudKeyBlocked blocking room keys inside dialogs and form inputs
  hud-menu.test.js                  src/ui/Hud.jsx: rendering a single folded menu button closed at mount
  hud-orchestrator-focus.test.js    src/ui/Hud.jsx, Transport.jsx: wide-layout / chat focus shortcut and sub dock details
  hud-style.test.js                 src/ui/Hud.jsx, AgentStrip.jsx, Assistant.jsx, ControlDrawer.jsx, MetersPanel.jsx, Waiting.jsx: markup classes
  idle-view.test.js                 src/ui/idleView.js: idleAllowed layout/scroll checks and connected-room is-idle toggle
  inspector-ui.test.js              src/ui/Inspector.jsx, inspector.js: agent/file/chat views, waiting text and opening lane conversation
  inspector.test.js                 src/ui/inspector.js, agentContext.js: thinking/working/idle/failed words and waitingForOwner
  internet.test.js                  src/engine/internet.js: deterministic morphOffsets breathing, seed variance and placement
  issue-thread-ui.test.js           src/ui/panels/IssueThread.jsx, TasksPanel.jsx: discarding stale comment and task target fetches
  keys-settings.test.js             src/ui/KeysSettings.jsx, Settings.jsx: saved key names only and delete confirm card with Escape
  labels.test.js                    src/engine/labels.js: replay speed scaling, pause hold and bad-speed fallback
  ladder-form.test.js               src/ui/ladderForm.js: idFromName normalization, reserved main id and scopeLines deduplication
  ladder-groups.test.js             src/ui/ladderGroups.js, Hud.jsx: flat vs ladder-grouped agent lists and sub headers
  lane-conversation.test.js         src/ui/LaneConversation.jsx, laneConversation.js, Hud.jsx: 10-run picker, folding and poll throttle
  lane-costs.test.js                server/lane-costs.js: month spend/token aggregation, null vs zero and removed lanes totals
  lane-env.test.js                  scripts/run-lane.mjs, src/briefs/run.js: childEnvironment allowlist stripping parent secrets per harness
  lane-lock.test.js                 scripts/lane-lock.mjs, server/orchestrator.js: JSON/plain lock format, live process checks and stale lock cleanup
  lane-starter.test.js              src/model/laneStarter.js: laneStarterTop lifting active or recent starter sessions while idle
  lane-tasks.test.js                server/lane-tasks.js, src/model/liveTasks.js: building task items, archive titles and OS log path reads
  lanes-settings-ui.test.js         src/ui/LanesSettings.jsx: listing/unhiding lanes and remove/delete confirm cards
  lanes-source.test.js              server/lanes-source.js, active-lanes.js: lane discovery, retired filtering, sub agents and live watcher
  launcher-open-cancel.test.js      src/ui/Launcher.jsx: preventing Close or Escape from cancelling an active folder switch
  launcher.test.js                  src/ui/launcher.js: storage flag, non-git auto-open and folder row normalization
  layout-css.test.js                src/styles.css: spacing, shrink priority and button sizing rules in transport and panels
  lens-rail.test.js                 src/ui/LensRail.jsx: railNear 64px edge check and opacity fade near top and left lens edges
  lens-resize.test.js               src/ui/lensResize.js: share clamping, pointer drag, key steps and camera distance sync
  lens.test.js                      src/ui/lens.js: lensProject formatting, replay/live clocks and lensStatus working count
  live-ladder.test.js               src/ui/liveLadder.js, src/model/hierarchy.js: ladderFromAnswer normalizing subs and dropping main
  live-runs.test.js                 server/control.js, src/control/mock.js, TasksPanel.jsx: /api/control/runs order and liveRuns notice
  live-tasks.test.js                src/model/liveTasks.js: agentTasks running over queued priority and directional-control stripping
  live.test.js                      src/live/source.js, livePlayer.js: agent discovery, parser lookup, sorting and field updates
  log.test.js                       src/model/log.js: createLogger and buildTimeline lines for calls, agent chat and failed labels
  lower-half.test.js                src/ui/lowerHalf.js, Hud.jsx: project breadcrumb capitalization and current conversation title fallback
  machine-doctor.test.js            server/doctor.js: doctor checks across folder, git, runs folder and lane binaries with path masking
  machine-up.test.js                server/doctor.js: up checks, startup URL output, --no-sessions and --open/--no-open flags
  made-lane-defaults.test.js        server/agents-config.js, src/harnesses/index.js: made-lane defaults with and without MACHINEROOM_LANES_DIR
  mask-split.test.js                src/briefs/audit.js, src/model/pipeline.js, source.js: masking keys split across chunk boundaries
  mcp-server.test.js                server/mcp.js: mcp.json registry reading, validation normalization and trailing newline writes
  mcp-settings.test.js              src/ui/McpSettings.jsx, Settings.jsx: MCP server/tool display, quoted arg parsing and save confirm
  merge-lane.test.js                scripts/merge-lane.mjs: parseMergeArgs subcommand/flag validation and insertUnreleasedLine
  meters-panel.test.js              src/ui/panels/MetersPanel.jsx: live vs sample labels, month/token totals, zero rows and removed lanes
  model-context-window.test.js      server/model-list.js, orchestrator.js: resolveContextWindow precedence across lane, endpoints and default
  model-picker.test.js              src/ui/ModelPicker.jsx: formatting context/prices/dates, search, six sort orders and pins first
  model-pins.test.js                /api/model-pins, server/endpoints.js: pin validation, persistence, Origin guard and PUT preflight
  model-refresh.test.js             src/ui/ModelRefresh.jsx, modelRefresh.js: live/saved list merge, search, current-model grouping and options
  modes.test.js                     src/control/modes.js: five mode ordering, per-harness filtering and legacyMode/defaultMode
  motes.test.js                     src/engine/void.js: motePoints spherical shell placement, determinism and moteOpacity gating
  motion.test.js                    src/engine/camera.js, hub.js, labels.js, sprites.js, void.js: easeRate and prefers-reduced-motion checks
  mr-agent-mcp.test.js              scripts/mcp-bridge.mjs: MCP config reading, stdio/HTTP tool calls and ACP server shaping
  mr-agent-web.test.js              server/search.js, scripts/mr-agent.mjs: web_search provider routing and web_fetch loopback guard
  mr-agent.test.js                  scripts/mr-agent.mjs: stream-json output, prompt instruction cap, 429 retry and 401/key masking
  mr-approve.test.js                scripts/mr-approve.mjs: stdio MCP server approve tool bridge forwarding and deny handling
  music-player-ui.test.js           src/ui/MusicPlayer.jsx, musicQueue.js: track duration formatting, reload persistence and seeking
  music.test.js                     server/music.js: music folder resolution, audio filtering, playlist subfolders and track cap
  no-undefined-names.test.js        scans src/ui/*.jsx to catch undeclared state setter calls
  notice-empty.test.js              src/ui/Notice.jsx: empty replay copy, Back to live/Settings buttons and Escape handling
  occluder.test.js                  src/engine/cards.js: occluderBox sizing for open/closed faces, folder blocks and file rows
  online.test.js                    src/model/online.js: isOnlineCall, isLocalAddress and laneNeedsNetwork classification
  opencode-sessions.test.js         server/opencode-sessions.js: SQLite session polling, run ids, forgotten cap and delete cleanup
  orchestrator-chat.test.js         src/ui/OrchestratorChat.jsx, orchestratorChat.js: status/tone mapping, masking and Team unread tags
  orchestrator-e2e.test.js          server/orchestrator.js: end-to-end turn, lane worktree run, wake cycle and sub scope wake
  orchestrator-list-share.test.js   src/ui/Hud.jsx, OrchestratorChat.jsx: skipping duplicate list polls when room shares orchestrators
  orchestrator-name.test.js         src/engine/agents.js: orchestratorNameLift raising main label clear of sub callouts
  orchestrator.test.js              server/orchestrator.js: orchestrator lane entry, session resume, folded steps and working state
  orchestrators.test.js             server/orchestrators.js: branchChanges diffs against project branch, base commits and untracked files
  outcomes.test.js                  server/outcomes.js: outcome command validation, newest-win recording and outcomeTable aggregation
  pack-check.test.js                scripts/pack-check.mjs: walkImports relative tracing, isForbidden secret/asset rules and findPackProblems
  pack-start.test.js                scripts/pack-check.mjs, untar.mjs: unpacked bundle health serving and dry-run/loading mr-agent
  panel-boundary.test.js            src/ui/panels/PanelBoundary.jsx: 120-character error cap and React error boundary capture
  panel-refresh-error.test.js       src/ui/panels/MetersPanel.jsx, AgentBuilder.jsx, TasksPanel.jsx: manual refresh failure notices
  panels-agent-form.test.js         src/ui/panels/AgentBuilder.jsx: read-only Team lane list and empty-lanes message
  panels-briefs.test.js             src/ui/panels/briefs.js: formatBriefTitle formatting and ownerToLane mapping
  panels-format.test.js             src/ui/panels/format.js, MetersPanel.jsx: dollars/cents, clamped meter percent, tones and relative ages
  panels-missing-methods.test.js    src/ui/panels/AgentBuilder.jsx, ControlDrawer.jsx, MetersPanel.jsx, TasksPanel.jsx: bare client fallbacks
  panels-notices.test.js            src/ui/panels/notices.js: matchesNotice topic/id filters and createNoticeBatcher
  panels-read-only.test.js          src/ui/panels/ControlDrawer.jsx, DispatchPanel.jsx, IssueThread.jsx: read-only tabs and dispatch controls
  panels-resolve.test.js            src/ui/panels/notices.js: resolveIssue cached hit, single reload fallback and rejection handling
  panels-runs.test.js               src/ui/panels/runs.js, DispatchPanel.jsx: resultWord, timeSinceStart and live run helpers
  parsers.test.js                   src/model/parsers/*, pipeline.js: Claude, OpenCode, Hermes and AGY call touches and error ends
  paths.test.js                     src/model/paths.js: relativeTo, ancestors, makeTree, resolveKnown and visibleText
  plan.test.js                      src/briefs/plan.js: planPrompt rules/format/em-dash checks and pathAllowed
  plans.test.js                     /api/plans, server/plans.js: refusing unconfirmed/invalid plan writes and bad percent encodings
  policy-lane.test.js               src/policy/route.js: routeLane selecting eligible active free lanes, skip reasons and quota checks
  policy-profile.test.js            src/policy/profile.js: profileFromBrief path counting while excluding tests and changelog
  policy-proposals.test.js          src/policy/proposals.js: proposePolicy tier swaps gated by merge rate margin, cost and min runs
  policy-propose.test.js            scripts/policy-propose.mjs: generating git-apply patches and validating --min and --since
  policy-route.test.js              server/index.js: POST /api/control/route validation, tier escalation and fallback selection
  policy.test.js                    src/policy/route.js: tierFor size/risk tiering, chooseRoute and escalate
  printed-path.test.js              server/printed-path.js: printedRunsFolder profile prefix order and POSIX $XDG_STATE_HOME
  process-tree.test.js              server/processTree.js: Windows CIM vs POSIX ps process listing and leftoverProcesses filters
  program-path.test.js              server/programPath.js: Windows .com/.exe precedence, gitPath and skipping repo-planted binaries
  project-dispatch.test.js          server/runs.js, src/ui/panels/DispatchPanel.jsx: task run failure records and --project/--allow-dirty args
  project-reviews.test.js           server/reviews.js, src/ui/panels/ReviewsPanel.jsx: cross-project reviews, check heads and merge guards
  project-settings.test.js          server/project-settings.js: /api/control/project-settings read/write/validation and hasNpmTestScript
  projects.test.js                  server/projects.js, /api/projects: root tracking, sibling git detection, 20-entry cap and path skips
  quota-read.test.js                scripts/run-lane.mjs: reading newest Codex rollout quota from last 64 KB under CODEX_HOME
  record-limits.test.js             src/model/recordLimits.js: clamping replay record minutes to 1..240 with default 10
  recording.test.js                 src/briefs/recording.js, src/model/pipeline.js: frame order, monotonic timestamps and partial flushes
  replay.test.js                    src/model/replay.js, sessionRecorder.js: parseRecordingIndex key whitelist, 50-item cap and cleaning
  repository-panel-ui.test.js       src/ui/RepositoryPanel.jsx: branch list, worktree lock notes and switch/create confirm cards
  repository.test.js                src/ui/repository.js, inspector.js: branch/detached SHA headlines and branch row statuses
  review-lane.test.js               scripts/review-lane.mjs, src/briefs/review.js: forbiddenHits glob/traversal matching and brief checks
  reviews-panel.test.js             src/ui/panels/ReviewsPanel.jsx, reviews.js: canMerge, merge commit text, behind checks and row copy
  reviews-row-keys.test.js          src/ui/panels/ReviewsPanel.jsx: separating diff toggle key actions from Merge buttons
  ring.test.js                      src/engine/ring.js: 12-card base ring layout, overflow spray, 900 min radius and non-overlap
  room-follow-reset.test.js         src/engine/room.js: createFollowFocus seek reset and createWorkingMask activity cache
  room-keys.test.js                 src/Stage.jsx: handleRoomKey playback/seek shortcuts and ignoring handled/drawer/input keys
  room-lanes.test.js                server/reviews.js, policy.js, doctor.js, scripts/: made lanes and MACHINEROOM_LANES_DIR consistency
  room-stars.test.js                src/model/state.js: touch stars following path hierarchy, landing on tabs, yellow tint and failures
  roster-update.test.js             src/engine/hub.js, agents.js: allocating hub slots for lanes while excluding orchestrators and sessions
  run-failover.test.js              scripts/run-lane.mjs, src/briefs/run.js: single quota/start failover onto -on- branch with linked records
  run-lane-route.test.js            server/index.js: auto-routing brief/task/queue starts, busy skips and 409 when all lanes are busy
  run-lane-stop.test.js             scripts/run-lane.mjs, lane-lock.mjs, server/processTree.js: --stop/timeout process-tree kill and locks
  run-lane.test.js                  scripts/run-lane.mjs, src/briefs/run.js: CLI builders for Hermes, OpenCode, AGY and Claude Code
  run-project.test.js               scripts/run-lane.mjs: parseRunArgs for --project, --task, --task-file and check command validation
  run-queue.test.js                 src/briefs/queue.js, scripts/run-lane.mjs: parseQueue --- separation, blank trim and 20-task limit
  run-recording.test.js             src/briefs/recording.js, scripts/recording-files.mjs: framesFromRun timeline for OpenCode and Hermes
  run-usage.test.js                 src/briefs/run.js: OpenCode step token totals, missing stat nulls and replyText across harnesses
  run-worktree.test.js              scripts/run-lane.mjs, src/briefs/run.js: worktreeFor paths, Windows separators and worktreeProblems
  runs-cache.test.js                server/runs.js, lane-costs.js: incremental byte-offset runs.jsonl cache, resets and frozen arrays
  runs-folder.test.js               server/runs.js, scripts/: OS fallback runs folder across Windows LocalAppData, XDG and temp
  scale-live.test.js                scripts/scale-live.mjs: parseLiveArgs, --help usage and live tree check skipping ignored files
  scale-tree.test.js                src/model/scaleTree.js: seeded synthetic trees, deterministic activities, unique names and replays
  scale.test.js                     scripts/scale-probe.mjs, server/index.js: seeded scale trees, readTree integration and CLI flags
  scenario-e.test.js                scripts/scale-probe.mjs, src/model/state.js: orchestrator and subagents replay scenario and digests
  scenarios.test.js                 scripts/scale-probe.mjs: fixed scenarios A and B tool touches and failing-then-passing test runs
  screenshots.test.js               scripts/screenshots.mjs: --help usage and masked Playwright Chromium error reporting
  search-settings.test.js           src/ui/SearchSettings.jsx, Settings.jsx: saved provider defaults, key slots and SearXNG URL checks
  search.test.js                    server/search.js: SearXNG, Tavily, Brave and DuckDuckGo search clients and missing key errors
  sectors.test.js                   src/engine/hub.js, agents.js, shapes.js: sector slot angles, sub lane spread and visible sector arcs
  serve.test.js                     server/index.js: static index.html serving, Host/Origin checks first, HEAD and API 404 JSON
  session-recorder.test.js          src/model/sessionRecorder.js: clampRecordMinutes bounds and createSessionRecorder live capture
  settings-record-time.test.js      src/ui/Settings.jsx: persisting record window changes on Enter and unmount close
  settings-sync-guard.test.js       src/ui/EndpointsPanel.jsx, McpSettings.jsx, SearchSettings.jsx: displaying sync read errors immediately
  settings.test.js                  src/ui/settings.js, Settings.jsx: defaults, localStorage persistence, legacy pruning and JSON fallback
  setup.test.js                     src/ui/SetupCard.jsx, setup.js: count prompt clamping, lane selection order and save payload
  shapes.test.js                    src/engine/shapes.js: shape pulse vertex bands matching audio bands and vertex scale caps
  sidebar-menu-ui.test.js           src/ui/Sidebar.jsx: conversation menu shortcuts, Markdown export, pin, rename, fork, archive and delete
  sidebar-preview-ui.test.js        src/ui/Sidebar.jsx: list error state, dropping stale previews and Projects tab in replay
  sidebar.test.js                   src/ui/Sidebar.jsx, sidebar.js: short session ages, pinned/recent grouping and 6-row cap
  simulated.test.js                 src/live/simulated.js: simulatedSpeed bounds (0.25..64) and loadDemo playback
  slash-chat-ui.test.js             src/ui/OrchestratorChat.jsx: slash popup open/filter/empty states and click argument insertion
  slash-commands.test.js            src/ui/slashCommands.js, server/orchestrator.js: slash query parsing, ranked filtering and cap
  soak.test.js                      server/index.js, src/live/livePlayer.js: 500-frame bridge history retention under sustained writes
  sound-engine.test.js              src/ui/sound.js, src/Stage.jsx: beat detection on kicks/soft tracks, Dance/Pulse toggles and seek
  sound.test.js                     src/ui/sound.js: screen-X pan, offscreen culling and rolling beat energy detector
  sprites.test.js                   src/engine/sprites.js: seeded deterministic PRNG in [0, 1) and easeInOut curve
  stage-lens.test.js                src/Stage.jsx, src/ui/Hud.jsx: lens labels, live empty-room text, link tag and offline borders
  stage-live-files.test.js          src/Stage.jsx: touchedFiles extraction and afterIdle callback vs timer fallback
  stage-seam.test.js                src/Stage.jsx: animation-frame seam batching, changed pose writes and popover exclusions
  stage-snapshot.test.js            src/Stage.jsx: sameSnapshot equality check skipping duplicate React commits
  stars.test.js                     src/engine/stars.js: star label anchoring, seven-color palette cycling and arc routing
  startup.test.js                   src/startup.js: chooseRoute selection across first visit, saved bridge, replay and foreign-link checks
  state-focus.test.js               src/model/state.js: tracking agent focus paths per call and deduplicating recent touched paths
  state-runs.test.js                src/model/state.js: run-id gating before ending agents/children, stale ends and failed call labels
  state-subagents.test.js           src/model/state.js: subagent spawning down to depth 3, sibling keys and parent end cascading
  storage-settings.test.js          src/ui/StorageSettings.jsx: method gating, usage/worktrees display, days check and archive confirm
  storage.test.js                   server/storage.js: git clean merged worktrees, Origin/confirm guards and safe symlink-free archive moves
  strands.test.js                   src/engine/strings.js: strandPoints determinism, seed spacing and array/curve endpoint shapes
  strings.test.js                   src/engine/strings.js: buffer geometry realloc only on growth, explicit link list and shared glow texture
  subagent-place.test.js            src/engine/agents.js, Hud.jsx: childOrbit radius, even sibling spacing, 40s orbit and tilt
  team-read-ui.test.js              src/ui/OrchestratorChat.jsx: showing failed sub read notices in Team tab instead of empty text
  teams.test.js                     server/teams.js: teams.json 20-team limit, Origin/confirm route guards and name length checks
  temp-root.test.js                 tests/helpers/tempRoot.js, cleanTemp.js: PID-scoped test temp roots and dead-process folder sweep
  terminal-buttons.test.js          src/ui/terminalButtons.js, Hud.jsx: checking open terminal sets and Hide all/Show all label
  terminals.test.js                 src/engine/terminals.js: chipTitle and chipAriaLabel labels across closed and open chip states
  text-keys.test.js                 src/engine/shapes.js, src/live/source.js, src/ui/panels/*: prototype-safe status, owner and shape maps
  transport-lanes.test.js           src/ui/transportLanes.js: lane pills for working/queued/failed lanes while filtering non-lane agents
  transport-orchestrators.test.js   src/ui/transportOrchestrators.js, Transport.jsx: sub chip order, approval badges, tones and cap
  transport-spend.test.js           src/ui/transportSpend.js, Transport.jsx: today/month spend text, missing-cost hiding and scroll click
  tree-format.test.js               src/live/tree.js, server/index.js: folder tree array serialization, under-1-MB size and root files
  tree-read.test.js                 server/index.js: non-blocking /api/health during tree reads, rerun queue and shutdown guard
  tree.test.js                      server/index.js: readTree partial read errors, git work-tree check and refusing disk fallback on error
  unreadable.test.js                src/model/parsers/unreadable.js: flagging malformed Claude, Hermes and OpenCode lines
  untar.test.js                     scripts/untar.mjs: archive extraction, long prefix joins, folder skips and traversal blocks
  void.test.js                      src/engine/void.js: upper/lower lattice grids, vertical struts, layer ticks and sprite exclusion
  waiting.test.js                   src/ui/Waiting.jsx: responsive chat location text, close button and status-change reopen
  worktrees.test.js                 scripts/worktrees.mjs: parseWorktreeList state fields and worktreeLane sibling directory matching
```
