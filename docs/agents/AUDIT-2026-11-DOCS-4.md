# Docs audit 4

2026-11-18. P548. Read against commit `12a5da8f`, version 0.1.401.

Scope: `architecture/LIVE.md`, `ROOM.md`, `CODE.md` and `ACTIVITIES.md`, with `ARCHITECTURE.md` as the core guide. This is a source audit. No screen check was made. Only this file changes.

## D4-1: The chat still claims a guessed context window

- Doc: `docs/agents/architecture/ROOM.md:55`.
- Code: `server/model-list.js:125`, `server/model-list.js:130`, `server/model-list.js:135`, `server/orchestrator.js:2212`, `src/ui/agentStrip.js:39`.
- The doc says the window falls back to the known list and the chat marks a default window as `(assumed)`. It says this twice. This disagrees with `docs/agents/architecture/LIVE.md:12`.
- The code uses the explicit window, then the harness report, then endpoint details. The resolver returns null without a window. The chat formatter has no assumed marker.
- Corrected sentence: "The context window comes from the owner's setting, then the harness report, then endpoint model details; when none reports a window, the chat shows the token count alone."

## D4-2: The orchestrator usage paragraph still prefers result totals

- Doc: `docs/agents/architecture/LIVE.md:23`.
- Code: `server/orchestrator.js:787`, `server/orchestrator.js:799`, `server/orchestrator.js:827`.
- The doc says the last top-level result line supplies Claude's context use. The newer rule at `docs/agents/architecture/LIVE.md:12` says assistant usage comes first.
- The code keeps the newest top-level assistant usage and returns it before the newest result iteration or result total.
- Corrected sentence: "Claude context use comes from the newest top-level assistant usage, then the newest usable result iteration, then the result total, adding input tokens and both cache counts."

## D4-3: The model map still promises static context windows

- Doc: `docs/agents/architecture/CODE.md:98`.
- Code: `server/model-list.js:1`, `server/model-list.js:30`, `server/model-list.js:115`, `server/model-list.js:135`.
- The doc calls this the static model list and its context windows.
- The static rows have no context windows. The resolver reads an explicit window or endpoint details and otherwise returns null.
- Corrected sentence: "model-list.js holds the static model choices, aliases and context resolver, which uses an explicit window or endpoint model details and otherwise returns null."

## D4-4: The Inspector can show lane context

- Doc: `docs/agents/architecture/ROOM.md:29`.
- Code: `src/ui/agentContext.js:195`, `src/ui/agentContext.js:439`, `src/ui/Inspector.jsx:593`.
- The doc says the Inspector shows context for an orchestrator and `context not reported` for a lane.
- The code reads context from the selected agent or its run for either kind. It shows tokens alone without a window, or percent and tokens with one.
- Corrected sentence: "The Inspector shows reported context for a lane or orchestrator, with tokens alone when its window is unknown, and shows `context not reported` only when no token count is available."

## D4-5: The chat description contains a repeated block

- Doc: `docs/agents/architecture/ROOM.md:55`.
- Code: `src/ui/OrchestratorChat.jsx:1289`, `src/ui/OrchestratorChat.jsx:1512`, `src/ui/OrchestratorChat.jsx:1541`.
- The sentences beginning `Each chat message shows Copy and Branch`, `A turn leaves`, `The context window comes` and `The first owner message` each occur twice. The second block starts directly after `unknown.` with no space.
- The code has one message action renderer, one work fold and one jump control. The repeated prose describes those same controls again.
- Corrected sentence: "Each chat message shows Copy and Branch on hover and focus, and the newest reply and each stopped line show Retry; Branch starts a new conversation from that message and keeps the old one in the list." Keep this and the following work and confirmation sentences once, remove the second block, and replace the context sentence as D4-1 says.

## D4-6: The code map describes the old footer controls

- Doc: `docs/agents/architecture/CODE.md:54`.
- Code: `src/ui/Transport.jsx:163`, `src/ui/Transport.jsx:194`, `src/ui/Transport.jsx:201`, `src/ui/Transport.jsx:206`.
- The doc describes a transport state, a chip per sub and a pill per busy or failed lane.
- The transport renders one agents count button and a list of subs and lanes, including idle lanes. The old helpers now supply rows in that list.
- Corrected sentence: "Transport.jsx holds replay controls and, in live mode, Center, one agents count button with a list of subs and lanes above it, spend, the main context ring and the clock; transportOrchestrators.js and transportLanes.js supply the list rows."

## D4-7: CLI lane messages can interrupt a run

- Doc: `docs/agents/architecture/LIVE.md:23`.
- Code: `server/orchestrators.js:875`, `server/orchestrators.js:883`, `server/runs.js:1795`, `server/runs.js:1821`, `server/runs.js:1830`.
- The doc says nothing interrupts a CLI lane run. This disagrees with the per-message interrupt description at `docs/agents/architecture/LIVE.md:24`.
- The bridge can stop a CLI lane and start a continuation carrying the unseen messages. It excludes the native harness from that bridge interrupt path.
- Corrected sentence: "A CLI lane can be interrupted when the page requests it or Settings chooses interrupt; the bridge stops the run and starts a continuation with the unseen messages, while the native agent reads replies through its own polling."

## D4-8: The scope wake uses the saved run base first

- Doc: `docs/agents/architecture/LIVE.md:23`.
- Code: `server/orchestrators.js:133`, `server/orchestrators.js:154`, `server/orchestrators.js:163`, `server/orchestrators.js:168`, `server/orchestrators.js:516`.
- The doc says a restricted sub's wake checks its lane branch against the project's current branch. `docs/agents/architecture/CODE.md:70` instead names the newest run's base.
- The code prefers the newest lane record's base, falls back to the project branch, and includes uncommitted and untracked paths.
- Corrected sentence: "For a restricted sub, the bridge checks changes from the newest lane record's base to HEAD, or from the project branch when no base is saved, together with uncommitted and untracked paths; an outside path adds the scope warning to the wake."

## D4-9: Closing Control keeps a split launch going

- Doc: `docs/agents/architecture/CODE.md:64`.
- Code: `src/ui/panels/ControlDrawer.jsx:78`, `src/ui/panels/ControlDrawer.jsx:121`, `src/ui/Hud.jsx:1137`, `src/ui/panels/DispatchPanel.jsx:166`, `src/ui/panels/DispatchPanel.jsx:306`.
- The doc says closing the drawer ends the split start loop.
- Closing changes the drawer's open prop and returns no panel without unmounting the drawer. Its cleanup cancels only on unmount. Split progress lives outside Dispatch, and a project change cancels it separately.
- Corrected sentence: "A split launch keeps going when Control closes or changes tabs; Stop, a project change or leaving the page ends further starts, while runs already started keep running."

## D4-10: The lane source does not list the folder every two seconds

- Doc: `docs/agents/architecture/CODE.md:75`.
- Code: `server/lanes-source.js:25`, `server/lanes-source.js:26`, `server/lanes-source.js:556`, `server/lanes-source.js:559`.
- The doc says the runs folder is listed on a watcher event and every two seconds. `docs/agents/architecture/LIVE.md:22` describes the newer change-time gate.
- The two-second scan returns before listing when the folder stamp stayed the same, no list was requested and the sixty-second full-list interval has not elapsed.
- Corrected sentence: "lanes-source.js checks for work every two seconds, but lists the runs folder only when its change time moves, a log watcher event requests a list or sixty seconds have passed."

## D4-11: Routing does not use a project policy fallback

- Doc: `docs/agents/architecture/CODE.md:50`.
- Code: `server/policy.js:46`, `server/policy.js:63`.
- The doc says both routing paths read this repository's policy when the project has none. `docs/agents/architecture/LIVE.md:22` says policy comes from the lanes folder.
- The code reads `policy.json` beside the configured lanes file, or from `lanesFolder()`. It does not try the project's policy first.
- Corrected sentence: "Both routing paths read policy.json from the room's lanes folder, beside its lanes.json, and never from the opened project's folder."

## D4-12: Small card layouts do not start at twelve o'clock

- Doc: `docs/agents/architecture/CODE.md:31`.
- Code: `src/engine/cards.js:346`, `src/engine/ring.js:98`, `src/engine/ring.js:202`, `src/engine/ring.js:215`.
- The doc says the first top-level folder sits at twelve o'clock without an exception. `docs/agents/architecture/ROOM.md:30` names the small-layout turn.
- Cards requests the small layout when at most four non-root cards are drawn. It uses `smallRingAngle`, which adds 0.3 of a slot.
- Corrected sentence: "The first top-level folder sits at twelve o'clock, except with one to four drawn non-root cards, when the ring starts 0.3 of a slot clockwise from it."

## D4-13: The child row spacing names the wrong constant

- Doc: `docs/agents/architecture/CODE.md:31`.
- Code: `src/engine/ring.js:20`, `src/engine/ring.js:21`, `src/engine/ring.js:161`.
- The doc labels the later 380-unit child rows as `CHILD_STEP`.
- `CHILD_STEP` is 450. Each later row adds `SHOTGUN_ROW_STEP`, which is 380.
- Corrected sentence: "A folder's child grid starts 450 units out (`CHILD_STEP`), and each later row adds 380 units (`SHOTGUN_ROW_STEP`)."

## D4-14: Strand points do not travel along the links

- Doc: `docs/agents/architecture/CODE.md:32`.
- Code: `src/engine/strings.js:107`, `src/engine/strings.js:234`, `src/engine/strings.js:269`, `src/engine/strings.js:338`.
- The doc says a strand turns yellow and travels on a working path. `docs/agents/architecture/ROOM.md:69` says its points stand still.
- The code caches point fractions and rewrites positions when link ends move. Its per-frame callback changes colour and opacity, with no travel phase.
- Corrected sentence: "Each link carries seeded points that stay in place along it, turn yellow on a working path and fade back over 1.5 seconds after the path moves on."

## D4-15: Main does not take a colour from the seven-colour cycle

- Doc: `docs/agents/architecture/ROOM.md:26`.
- Code: `src/engine/sprites.js:18`, `src/engine/sprites.js:22`, `src/engine/agents.js:1238`, `src/engine/agents.js:1164`.
- The doc says each agent takes one of seven colours by roster order, with a child taking its parent's colour.
- Main takes yellow and does not advance the colour index. Other roster agents, including subs, advance it. Children inherit their parent's colour.
- Corrected sentence: "Main is yellow; the other roster agents take the seven AGENT_COLORS in order without counting Main, and a child takes its parent's colour."

## D4-16: The activity tool list omits task and MCP calls

- Doc: `docs/agents/architecture/ACTIVITIES.md:14`.
- Code: `src/model/parsers/claude.js:131`, `src/model/parsers/claude.js:132`, `src/model/parsers/claude.js:140`, `src/model/parsers/claude.js:141`, `src/model/parsers/claude.js:146`.
- The schema lists `read`, `write`, `edit`, `shell`, `search`, `web` and `other` as tool kinds.
- The Claude parser also emits `mcp` and `task` as tool kinds.
- Corrected sentence: "A tool.start activity carries id, tool (`read`, `write`, `edit`, `shell`, `search`, `web`, `mcp`, `task` or `other`), label and touches, with optional outside-project fields."

## D4-17: Run start activities can carry starter metadata

- Doc: `docs/agents/architecture/ACTIVITIES.md:11`, `docs/agents/architecture/ACTIVITIES.md:12`.
- Code: `src/model/pipeline.js:106`, `src/model/pipeline.js:110`, `src/model/pipeline.js:120`, `src/model/pipeline.js:123`.
- The schema says `run.queued` and `run.start` have no extra fields.
- Both can carry `startedBy` and `session` when the frame provides them.
- Corrected sentence: "run.queued and run.start may carry startedBy and session when the source reports who started the run."

## D4-18: A successful child tool result does not always end the child

- Doc: `docs/agents/architecture/ACTIVITIES.md:21`.
- Code: `src/model/parsers/claude.js:143`, `src/model/parsers/claude.js:154`, `src/model/parsers/claude.js:163`.
- The doc says a Task or Agent tool result ends its child, failed when `is_error` is set.
- A failed result ends the child. A successful result ends it only for a foreground Task, or a foreground Agent whose child output was seen. A background launch result leaves the child open.
- Corrected sentence: "A failed Task or Agent result ends the child; a successful foreground Task result ends it, and a successful foreground Agent result ends it only after child output was seen, while a background launch result leaves it working."

## D4-19: The test map still says the run picker holds ten runs

- Doc: `docs/agents/architecture/CODE.md:262`.
- Code: `src/ui/laneConversation.js:1`, `src/ui/laneConversation.js:51`, `tests/lane-conversation.test.js:75`.
- The doc calls this a ten-run picker.
- The helper caps it at twenty. The test already expects thirteen options from its twelve recent runs and live run.
- Corrected sentence: "lane-conversation.test.js covers the twenty-run picker, folding, live context, message start-time guards and the poll throttle."

## D4-20: The test map still says the folder cap is three

- Doc: `docs/agents/architecture/CODE.md:229`.
- Code: `src/model/folderView.js:8`, `src/model/folderView.js:160`, `tests/folder-view.test.js:428`.
- The doc names a three-card cap.
- Inner folders can draw ten children. The root keeps all top-level folders, and the test asserts ten.
- Corrected sentence: "folder-view.test.js covers focus expansion, the ten-child cap below the root, all top-level folders under the root and outlines."

## D4-21: The test map names an old active-lane route

- Doc: `docs/agents/architecture/CODE.md:142`.
- Code: `server/active-lanes.js:323`, `server/active-lanes.js:338`.
- The doc names `/api/control/active-lanes`.
- The API reads `/api/lanes` and saves through `/api/lanes/active`.
- Corrected sentence: "active-lanes.test.js covers server/active-lanes.js, GET /api/lanes and POST /api/lanes/active: project hashes, save cleanup and eligible lanes."

## Other checks

- The recent context precedence, endpoint retry delay and live picker context merge match `LIVE.md:9`, `LIVE.md:10` and `LIVE.md:12`. Evidence: `server/orchestrators.js:869`, `server/orchestrators.js:1067`, `src/ui/laneConversation.js:35`, `server/endpoints.js:412`, `server/endpoints.js:425`.
- The footer list opens above its button, fits below the menu, and colours working, queued and waiting yellow, failed and paused red, finished and succeeded green, and idle dim white. Evidence: `src/ui/transportLanes.js:141`, `src/ui/Transport.jsx:115`, `src/styles.css:9284`.
- Height and Zoom are on the right, Height inside Zoom. The 0.3 to 1 height range, default 1, transport height cap, 64-pixel reveal, one-second wheel hold, ruler marks and reduced-motion fade match the docs. Evidence: `src/Stage.jsx:1625`, `src/Stage.jsx:1636`, `src/ui/lensResize.js:1`, `src/ui/lensResize.js:11`, `src/ui/LensRail.jsx:4`, `src/ui/LensRail.jsx:136`, `src/styles.css:8546`, `src/styles.css:8569`.
- The grid uses 2000-unit cells and four cells each way, with its floor following the git tree and its ceiling at the internet globe's top. Evidence: `src/engine/void.js:6`, `src/engine/void.js:183`, `src/engine/void.js:187`, `src/engine/room.js:1069`, `src/engine/room.js:1275`.
- Run-end rows show the lane, briefs, status and subject with Details holding the full message. Evidence: `src/ui/OrchestratorChat.jsx:1478`, `src/ui/OrchestratorChat.jsx:1485`, `src/ui/OrchestratorChat.jsx:1491`.
- Teams starts closed, remembers `machineroom:teams-open`, and shows its saved count. Evidence: `src/ui/FamilyTree.jsx:286`, `src/ui/FamilyTree.jsx:508`, `src/ui/FamilyTree.jsx:512`.
- The lane prompt folds at three lines or 360 characters, live reads wait two seconds, and the DOM card and terminal classes inspected match the documented contract. Evidence: `src/ui/laneConversation.js:2`, `src/ui/laneConversation.js:3`, `src/engine/terminals.js:155`, `src/engine/cards.js:505`, `src/engine/cards.js:532`.

Checked and fine
