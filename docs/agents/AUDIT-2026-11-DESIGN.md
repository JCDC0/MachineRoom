# Design audit, November 2026: how the room shows its work

Date: 2026-11-03
Author: agy3 (Gemini Argon)
Branch: `feat/q25-a-design-review`
Base commit: `0.1.401`
Brief: Q25

## What was inspected

Both addresses were opened and captured through the Chrome DevTools browser tool at `1280 x 800` and `1920 x 1080`:

- `http://localhost:5188/?replay&fixture=scenario-i` at `1280 x 800` and `1920 x 1080`: `/agent-sandbox` with the `Frontend` and `Backend` sub-orchestrator sectors, the `opencode` and `claude` lanes, the `AGENT-SANDBOX/`, `SRC/`, `SERVER/` and `TEST/` cards, and the replay transport.
- `http://localhost:5188/?live&bridge=http://localhost:5188` at `1280 x 800` and `1920 x 1080` (plus a full-page capture): `/crowd` in live mode before the first run, showing `WEB/`, `ASSETS/` and `NODE_MODULES/` (`50 items 50 folders`), the `WAITING FOR THE FIRST RUN` overlay, the live transport, and the three-column lower half below the fold.
- Code and docs read: `What it shows` and `Room behaviour` in `docs/agents/ARCHITECTURE.md`, `src/Stage.jsx`, `src/ui/Hud.jsx`, `src/ui/Transport.jsx`, `src/ui/lens.js`, `src/ui/panels/ControlDrawer.jsx`, `src/briefs/review.js` and `scripts/review-lane.mjs`.

## 1. What the owner cannot tell at a glance

At desktop widths (`900px` and wider), the default lens height (`lensShare = 0.8`, `calc(100vh - var(--menu-h) - var(--transport-h))`) fills the viewport from the menu to the transport. At `scrollY = 0` on both `1280 x 800` and `1920 x 1080`, the entire lower half (`.hud-lower`: the sidebar with `Chat`, `Projects` and `Agents`, the orchestrator conversation, and the `Overview` column) sits below the fold. An owner looking at the room sees only the menu bar, the 3D lens, and the transport bar.

### Who is working on what

- No agent roster is visible above the fold on desktop. In `src/ui/Hud.jsx:831`, `.hud-dock` (which holds `.hud-agents`) mounts only when `!wide` (`< 900px`). At `1280 x 800` and `1920 x 1080`, the owner must scroll down past the lens and switch the sidebar from `Chat` (the default tab) to `Agents` to see a list of lanes and tasks.
- The top-right corner counter (`Working N / M` from `lensStatus` in `src/ui/lens.js:33-47`) filters out the main orchestrator and every sub-orchestrator (`!isOrchestratorAgent(agent) && !isSubOrchestrator(agent)`), and counts only top-level lanes whose status is `'working'`. In `scenario-i` at `00:00:39`, `ORCHESTRATOR` and sub-orchestrator `BACKEND` both carry yellow `WORKING` chips in the 3D hub while the corner counter reads `WORKING 0 / 2`.
- A lane that is between tool calls (`thinking` while a run is open and no tool call is open) is not distinguished in the corner counter or the transport from an idle lane.
- Inside the 3D lens, a working agent's task (`JG-19`) and command (`read src/ui/Hud.jsx`) appear only inside its CSS3D `.mr-callout` and `.mr-term-console`, which shrink with camera distance and overlap neighbouring wireframes, sector labels and folder cards. In `scenario-i` at `1280 x 800`, `BACKEND`'s callout text above `ORCHESTRATOR` is too small to read from the overview camera.
- Nothing on screen shows which git branch or worktree a lane is running in, how long a current run has been open against its time limit (`100` minutes by default), or where a lane stands inside a multi-task queue (`task 2 of 6`).

### What needs the owner

Four events require the owner to act, and three of them have no signal above the fold:

- Orchestrator or sub-orchestrator waiting for input: the live transport shows `ORCHESTRATOR waiting for you` and up to four sub chips (`+N` past four). Each sub chip (`src/ui/transportOrchestrators.js`) has only a colour dot (yellow while working, dim when idle, red when paused or failed), so a sub that just finished a report and is waiting on the owner looks identical to a sub that has never run.
- Finished lane branches waiting for review and merge: completed runs sit in `Control -> Reviews` (`ReviewsPanel.jsx`). The `CONTROL C` button in the menu bar carries no count badge, and nothing in the lens or transport tells the owner that one or more lane branches are ready to review and merge.
- Pending agent proposals: when an orchestrator proposes a new lane or sub, the proposal lands in the `Requests` group at the top of `FamilyTree.jsx` inside the `Agents` tab of the lower-half sidebar, with `Approve` and `Decline`. Neither the menu bar, the transport, nor the `Agents` tab icon shows a badge when a proposal is waiting.
- Scope violations on a restricted sub: when a lane touches files outside its sub's glob scope, the wake message starts `Outside the scope, do not merge:`, which is visible only after scrolling to the chat and opening that orchestrator's tab.

### What failed

- Transient 3D failure cues vanish in seconds: a failed tool call lays a red `FAILED NAME` band across its folder card for `2.6` seconds (`ARCHITECTURE.md:245`), and a failed run turns the agent's callout red for `5` seconds (`ARCHITECTURE.md:233`). If the owner looks away for `6` seconds, both cues are gone, leaving only the agent's red chip in the 3D hub and a red file row inside the folder card.
- Shell and test failures highlight the wrong file or no file: during a tool call that names no file (such as `npm test` or `npm run build`), the agent keeps its last touched file as its focus (`ARCHITECTURE.md:352`). A failing test suite therefore flashes the last file the agent read or edited rather than reporting a test failure on the run.
- Red file rows hide inside closed or scrolled cards: if the file that failed is beyond the first `6` rows (`maxFiles = 6`) of its card, or inside an unexpanded child folder, its red state is hidden until the owner scrolls that card or opens the folder.
- The bottom-right lens corner (`lens.activity` in `src/Stage.jsx:1398`) displays only the single newest log entry (`entries[entries.length - 1]`). In a multi-agent room, if `agy2` fails a run and `opencode` reads a file `100ms` later, the white `OPENCODE READ ...` line immediately overwrites the red failure line.
- Live mode has no failure timeline or counter: replay mode draws red `.scrubber-tick.is-error` ticks along the scrubber bar (`src/ui/Transport.jsx:195-210`), but live mode replaces the scrubber with a static text line (`Transport.jsx:108-178`). There is no persistent error count in the live transport or menu row.

### What it costs

- Zero cost data is visible above the fold at `1280 x 800` or `1920 x 1080`: the menu bar, lens corners and transport show no dollar spend and no token totals.
- Below the fold, cost is still hidden behind a click: `.hud-lower-right` renders `OverviewCard` (`src/ui/Hud.jsx:132-153`), which contains only two buttons (`Agent` and `Costs`) and no numbers. The owner must scroll down to the lower half and click `Costs` (or press `C` and click `Meters`) to mount `#hud-dock-costs`.
- Only calendar-month totals exist: `server/lane-costs.js` sums run records for the current calendar month per lane. The room does not show the cost of the currently running turn or lane run, today's spend, or the cost of the active session.
- Context window fullness is shown only for the main orchestrator: the `22px` `ContextRing` in the live transport (`src/ui/Transport.jsx:55-94`) reads `main.contextTokens / main.contextWindow` (showing an empty ring with `context not reported` until a turn ends). Sub-orchestrators have no context ring in the transport, and lane runs do not report live context fullness.

## 2. What the eye goes to first, and whether that is right

### In `scenario-i` (agents at work, `1280 x 800` and `1920 x 1080`)

The eye goes first to three high-contrast elements:

1. The solid bright green rectangle of the finished sub-orchestrator chip (`FRONTEND / SUB-FRONTE... FINISHED` in `#2aff80` with black text) on the left of the hub, and the solid white header blocks of `ORCHESTRATOR` and `OPENCODE`.
2. The oversized foreground folder card `SRC/` at the bottom center of the lens (`1.8x` file-card scale plus perspective foreshortening, making `styles.css` the largest text on screen, sliced through by the bottom compass ticks).
3. The yellow-striped `SERVER/` card on the right with its four yellow corner brackets and the floating `write lane-costs.js` badge above it.

Only the third item (`SERVER/` being written right now) deserves primary attention. A finished agent (`FRONTEND`) has the highest luminance fill on screen (`#2aff80` solid background), outshining the thin wireframe and thin yellow tunnel of the agent that is actively working. Meanwhile, `SRC/` dominates the bottom center of the viewport simply because its slot on the ring happens to be closest to the camera, even though no agent is touching it and it is dimmed to `0.25` opacity.

### In live mode before a run (`/crowd`, `1280 x 800` and `1920 x 1080`)

The eye goes first to:

1. The large `WAITING FOR THE FIRST RUN` card (`Waiting.jsx`) in the lower center of the lens, topped by a solid white banner (`CONNECTED`).
2. The `NODE_MODULES/` card (`50 items 50 folders`, listing `pkg03/` through `pkg09/`) on the right of the lens, with three stacked folder backs and white fan lines shooting off the right edge of the viewport.
3. The collision at the hub center where the 3D `ORCHESTRATOR` ring title sits directly across the header of the `ASSETS/` card.

This hierarchy is backwards. First, `NODE_MODULES/` is dependency noise, yet `planFolderView` ranks unexpanded child cards by file count (`MAX_CHILD_CARDS = 10`, ordered by most files), making `NODE_MODULES/` the largest card in the room. Second, the `WAITING FOR THE FIRST RUN` overlay gives wrong instructions on desktop: it reads `Press / or click ORCHESTRATOR at the top, and the chat opens at the bottom right.` At `900px` and wider (`floatingChat === false` in `src/ui/Hud.jsx:259`), the chat is not a bottom-right panel; it is inline in `.hud-lower-main` below the fold, and pressing `/` (`Hud.jsx:536`) only increments `chatFocus` without scrolling the window down to the chat.

## 3. What is clutter

- Four copies of the project name: at `1280 x 800` and `1920 x 1080`, the project name is drawn at top-left in `.hud-band-project` (`/agent-sandbox`), at top-center in `.lens-corner.is-center` (`/AGENT-SANDBOX`), on the root card in the middle of the lens (`AGENT-SANDBOX/`), and in the lower-half breadcrumb (`AGENT-SANDBOX / New conversation`). The top-center lens label sits directly above the main orchestrator's wireframe and chip.
- Two opposing azimuth compass tapes (`LensCompass` in `src/Stage.jsx:340-427`): the top edge draws far-rim bearings (`240`, `255`, `W 270`, `NW 315`, `N 000`, `NE 045`) and the bottom edge draws near-rim bearings (`225 SW`, `180 S`, `135 SE`, `090 E`) with ticks every `5` degrees. Compass bearings do not map to anything in a repository. Worse, the bottom tape's labels and ticks sit inside the lens over the bottom of the 3D scene, colliding with foreground folder cards (`SRC/styles.css` in `scenario-i`) and the git tree under the root card (`/crowd`).
- 3D world-coordinate labels (`src/engine/void.js`): monospace strings such as `-8000, -2000, 2000` and `4000, -2000, -8000` float in the lattice behind folder cards (`TEST/` and `SERVER/` in `scenario-i`), competing with file names and read/write counters (`r 1`, `w 1`).
- Redundant truncated keys inside terminal chips (`src/engine/terminals.js`): every closed `.mr-term` chip renders the agent name on the top bar (`ORCHESTRATOR`, `FRONTEND`, `OPENCODE`) and then a second line with the agent key cut by an ellipsis (`ORCHESTRAT...`, `SUB-FRONTE...`, `OPENCODE`) next to the status word (`WORKING`, `FINISHED`). Repeating the identifier on two stacked lines doubles the chip height in the crowded hub center.
- Center-column text pileup in the 3D hub: because the camera looks across the flat ring toward the center, the top-center `/PROJECT` label, the `INTERNET` sphere label, the main `ORCHESTRATOR` chip, the 3D `ORCHESTRATOR` ring label, the back-sector sub-orchestrator chip, the hub slot names (`CLAUDE CODE`, `OPENCODE`), the root folder card, and the git tree all project onto the same narrow vertical strip in the middle of the lens.
- The `Overview` placeholder card in `.hud-lower-right` (`src/ui/Hud.jsx:132-153`): at desktop widths, the right column (`280px` wide) defaults to a box containing the heading `OVERVIEW` and two buttons (`Agent` and `Costs`), leaving 85 percent of that column empty black space until the user clicks one.
- Permanent `HEIGHT` and `ZOOM` rails (`LensRail.jsx`): the vertical sliders on the left and right edges of the lens stay visible with `HEIGHT / 1.0x` and `ZOOM / 1.0x` labels at all times (until the 60-second idle spin), even though mouse-wheel zoom works anywhere in the lens and viewport split height is a set-once preference.

## 4. How the lens, the transport and the lower half work together

At desktop resolutions (`1280 x 800` and `1920 x 1080`), the three bands do not work together as one workspace; they act as two separate full-screen apps stacked on a vertical page scroll:

- Full-viewport lens pushes all text controls off screen: because the default `lensShare` (`0.8`) resolves in `src/ui/lensResize.js` to `calc(100vh - var(--menu-h) - var(--transport-h))`, the lens and transport consume 100 percent of the viewport height. The lower half (`.hud-lower`, which is itself `calc(100vh - var(--menu-h))` tall) is completely invisible at `scrollY = 0`.
- Scrolling to the chat hides both the room and the transport: `.transport` sits in normal document flow between `.lens` and `.hud-lower` (`src/ui/Hud.jsx:940-978`). When the owner clicks `ORCHESTRATOR waiting for you` in the transport (or scrolls down to type a message, switch branches in `Projects`, or manage lanes in `Agents`), the page scrolls `.hud-lower-main` to the top of the viewport. Both the 3D lens and the transport bar scroll off the top of the screen, so the owner can no longer see the agents working, the live link badge, the sub-orchestrator chips, or the context ring while reading or writing in the chat.
- Keyboard shortcut `/` fails to scroll to the inline chat on desktop: clicking the transport's orchestrator button calls `openConversation()` (`src/ui/Transport.jsx:34-42`), which calls `scrollIntoView` on `.hud-lower-main` and focuses `.mr-orch-input`. Pressing `/` or clicking `ORCHESTRATOR /` in the top menu (`src/ui/Hud.jsx:533-536, 756-759`) only increments `chatFocus` (`setChatFocus(v => v + 1)`), while `preventScroll: true` is used on focus, leaving the user looking at the lens if the page was at the top.
- Two competing inspector surfaces across the fold: clicking an agent in the lens opens `Inspector.jsx` inside the right edge of the lens (`src/Stage.jsx:1400-1421`) and sets `focused`, which simultaneously updates `AgentDock.jsx` inside `.hud-lower-right` (`Hud.jsx:1044`) below the fold. Both panels render the same `agentContext` rows, monthly cost, last 12 log lines and autocompact controls in two different places.
- Four inconsistent panel locations:
  1. `Inspector` opens inside the right edge of the lens.
  2. `Log L` and `Settings` open as floating dropdowns under the top-right menu over the lens (`Hud.jsx:952-975`).
  3. `Control C` (`ControlDrawer.jsx`) covers the lower half.
  4. `Agent` and `Costs` open inside `.hud-lower-right` by replacing `OverviewCard`.

## 5. What happens at scale: 1 agent, 10 agents, and 40,000 files

### With 1 agent

- The hub ring (`radius = 300`) holds one lane slot and the floating orchestrator. A single yellow tunnel connects the lane through the root card to one folder card, follow mode (`F`) tracks that card without thrashing, and `lens.activity` at the bottom right of the lens shows that agent's steps without interleaving.
- However, at `1920 x 1080`, roughly 80 percent of the viewport is empty black space around one wireframe shape, while the agent's actual output (its log lines, task description, and file diff) is either capped at `12` lines inside the narrow lens inspector or hidden below the fold.

### With 10 agents (plus sub-orchestrators and subagents)

- Hub ring congestion: 10 top-level lanes park along the `300`-unit radius ring (`~188` units apart), up to 4 sub-orchestrators float at `0.7x` size above their sector arcs, and spawned subagents (`PARENT~N`) park at `0.6x` size beside their parents (`ARCHITECTURE.md:264`).
- CSS3D label pileup: each working agent displays its wireframe, a `.mr-term` chip (`name + status`), a `.mr-callout` (`name + task + command`), and, during any `shell` or `other` tool call, a 5-line cyan `.mr-term-console` above its head that lingers for `6` seconds (`ARCHITECTURE.md:236`). With 10 agents working at once, up to 30 CSS3D boxes project onto the central hub, occluding one another and the root card.
- Tunnel and packet saturation: 10 yellow tunnels all route from the hub through the central root card (`litChain` in `src/engine/agents.js`) before branching out to folders, turning the center of the ring into a solid bundle of yellow lines and `240` moving packet points (`24` per agent), crossed by blue web beams to `INTERNET` and `6`-point inter-agent message bursts.
- Follow mode thrashing: `followTarget` (`src/engine/camera.js`) follows the touched folder card rather than a chosen agent, holding each card for `4` seconds (`ARCHITECTURE.md:237`). When 10 agents touch different folders across the ring, the camera jumps every `4` seconds from sector to sector, and no cards dim to `0.25` opacity because almost every sector has an active path.
- HUD truncation and unreachable keys: `lens.activity` at the bottom right of the lens flickers between 10 interleaved logs and becomes unreadable; the transport caps sub-orchestrator chips at `4` (`+N` for the rest); and keyboard shortcuts `1` to `9` (`Hud.jsx:492`, `Stage.jsx:1137`) cannot focus the 10th lane or any subagent.

### With a project of 40,000 files (in 4,000 folders)

- Frame time holds, but legibility drops: the data pipeline (`GET /api/tree` with `shape=folders`, `fileIndex.js`, `planFolderView` capped at `maxAlways = 300` folders at `alwaysDepth = 2`, and virtualized card scrolling past `60` rows) keeps layout and frame cost low (`~11 ms` median, `33 ms` p95 at `1280 x 800`, `ARCHITECTURE.md:363`).
- Overview camera pull-back makes text unreadable: when a repository has more than `12` top-level folders (`RING_MAX_TOP = 12` in `src/engine/ring.js`), the extra top-level folders spray behind 12 o'clock in a square grid (`380` units per row), and depth-2 children fan outward (`450` then `380` units). To fit up to `300` cards, `fitView` pulls the overview camera back to `~1,754` units (`ARCHITECTURE.md:350`). Because card text scales in 3D perspective with distance, every folder name and file row is microscopic from the overview, and the flat horizontal ring fills the middle band of the lens while leaving the top and bottom of the lens empty.
- Deep sibling fans overlap: only the top-level ring spaces cards by their diagonals (`ringRadius`). Child folders (`CHILD_STEP`) use a fixed offset per sibling in one pass, so siblings in deep or expanded fans overlap one another (`ARCHITECTURE.md:349`).
- File-count ranking highlights bulk folders over source code: below the root, `planFolderView` (`src/model/folderView.js`) picks at most `MAX_CHILD_CARDS = 10` child folders ordered by the most files (`ARCHITECTURE.md:56, 229`). In a `40,000`-file repo, folders holding thousands of generated assets, test fixtures, or vendored files claim the 10 card slots, while core source folders with fewer files stay hidden inside scrollable card rows until an agent touches them.
- Unexpanded child folders bury files inside card lists: when a folder has `200` subdirectories and `10` are drawn as child cards, the other `190` subdirectories are inserted as `'dir'` rows at the top of the parent card's `6`-row scroll viewport (`maxFiles = 6`), pushing the parent folder's own files far down the scrollbar.

## Features (at most 8)

### 1. Persistent live lane strip in the transport

- Who it helps: the owner watching multiple lanes and sub-orchestrators at once without scrolling down to the sidebar.
- Smallest version: extend the middle of the live `Transport` (`src/ui/Transport.jsx`) so that beside the orchestrator and sub chips it renders one compact pill per active or recently failed lane (`lane label · brief/task id · state dot`, plus queue step `2/5` when `queue: true` and elapsed minutes). Clicking a pill focuses and inspects that lane in the lens; right-clicking or clicking its chat icon opens its log or sub chat.
- Size: Small.

### 2. Action-needed badges on `CONTROL` and `ORCHESTRATOR` (`Reviews`, `Proposals`, `Waiting`)

- Who it helps: the owner who runs lanes in background worktrees and needs to know immediately when a branch is ready to merge, an agent proposal needs approval, or an orchestrator turn stopped for input.
- Smallest version: compute three counts from data `Stage.jsx` and `Hud.jsx` already poll or receive via SSE notices (`reviews` branches with commits ahead, `family` pending `proposals`, and orchestrators in `waiting` or `paused` state) and render a yellow count pill on `CONTROL C` (opening `Control -> Reviews` when clicked on the badge) and on `ORCHESTRATOR /`.
- Size: Small.

### 3. Sticky failure tray in the lens corner

- Who it helps: the owner when a test run, tool call, or lane run fails while other lanes continue generating log lines.
- Smallest version: in `src/ui/lens.js` and `src/Stage.jsx`, keep a list of unacknowledged failed runs and failed tool calls from the current session above the single-line `lens.activity` readout at the bottom right of the lens. Each red row shows `AGENT · failed tool or exit code · time ago`, clicks through to inspect that agent's log at the failure line, and has a `Clear` button (or clears when that lane starts a new passing run).
- Size: Small.

### 4. Live spend and current-run cost readout in the transport

- Who it helps: the owner tracking API burn across Claude Code, OpenCode and Direct API lanes during long sessions.
- Smallest version: beside the `ContextRing` in the live `Transport` (`src/ui/Transport.jsx`), add a compact monospace spend button (`$X.XX today · $Y.YY mo`) computed from `dockCosts` and the open run records, and render `AgentDock` + `CostBoard` directly in `.hud-lower-right` at all times instead of hiding them behind the two-button `OverviewCard`.
- Size: Small.

### 5. Follow-agent lock (`1-9` and click-to-follow) in `camera.js`

- Who it helps: the owner debugging or watching one specific lane while nine other lanes are touching files across the room.
- Smallest version: add an `agentKey` filter to `followTarget` in `src/engine/camera.js` so pressing `F` while an agent is focused (or clicking a `Follow` toggle in `Inspector.jsx`) follows only the cards touched by that agent (or its sub-orchestrator sector) instead of jumping across every working agent in the room every `4` seconds.
- Size: Small.

### 6. Inline diff and test-output tab in the in-lens `Inspector`

- Who it helps: the owner verifying what a working or finished lane actually changed without leaving the lens or opening `Control -> Reviews`.
- Smallest version: when `Inspector.jsx` is open on a lane agent (`target.kind === 'agent'`), add a `Changes (N)` tab beside its 12-line log that calls the existing review/diff client method for that lane's worktree branch and lists the changed files and unified diff in place, with a `Review & Merge` button that opens `ReviewsPanel` on that lane.
- Size: Medium.

### 7. Activity-weighted folder planning and dependency-folder folding

- Who it helps: the owner opening a large or real-world repository (`40,000` files, or a repo with `node_modules`, `dist`, `vendor`, or `.worktrees`) where untouched bulk folders currently dominate the 3D ring.
- Smallest version: in `src/model/folderView.js` (`planFolderView`), demote known bulk/generated directory names (`node_modules`, `dist`, `build`, `coverage`, `vendor`, `.next`, `target`) so they stay collapsed as single closed cards unless an agent touches a file inside them, and rank `MAX_CHILD_CARDS` by recent agent touch count and git-dirty status before raw file count.
- Size: Medium.

### 8. Single-screen split mode (`55%` lens / `45%` lower half visible together)

- Who it helps: the owner who talks to the orchestrator and watches the 3D room at the same time all day on a `1280 x 800` or `1920 x 1080` monitor.
- Smallest version: change `LENS_SHARE_DEFAULT` in `src/ui/lensResize.js` from `0.8` (which special-cases to `100vh` minus menu and transport) to `0.55` on live rooms with an active orchestrator, and make `.transport` sticky between `.lens` and `.hud-lower` so the lens, the transport bar, the orchestrator chat, and the right-hand agent/cost dock are all visible on one non-scrolling `1080p` screen.
- Size: Medium.

## Design changes (at most 8)

Every change below keeps the owner's chosen visual identity: the bowed lens seam (`LENS_BOW = 28`), the transparent menu and transport bars along the curve, the `#000000` / `#ffffff` / `#e5ff00` palette with `#ff2a2a`, `#2aff80` and `#2a9dff` accents, the Jost and Space Mono fonts at weights `400` and `500`, and the distinct 3D wireframe agent shapes.

### 1. Remove the duplicate top-center `/PROJECT` lens label and the 3D coordinate numbers

- What changes: delete `.lens-corner.is-center` (`/AGENT-SANDBOX` in `src/Stage.jsx:1383-1385`), which duplicates `.hud-band-project` (`/agent-sandbox`) in the top-left menu and collides with the main orchestrator's wireframe and chip; and remove the floating `-8000, -2000, 2000` coordinate text sprites in `src/engine/void.js`.
- What stays as it is: the curved lens, the top-left `/project` title in the transparent menu bar, the `AGENT-SANDBOX/` root folder card, the faint 3D lattice lines, tick crosses and drifting dust motes, the black/white/yellow palette, Jost and Space Mono, and the wireframe agents.

### 2. Replace the bottom compass numbers with a clean bowed rule, and tone down the top compass

- What changes: remove the degree and cardinal text labels (`180 S`, `165°`, `135 SE`) and tall ticks from the bottom `LensEdge` (`side="bottom"` in `src/Stage.jsx:340-402`) so only the bowed hairline, corner brackets and center `+` lubber mark remain at the bottom seam, stopping the text collision with foreground folder cards and the git tree; reduce the top compass labels to cardinal/intercardinal marks (`N`, `NE`, `E`, `SE`, `S`, `SW`, `W`, `NW`) every `45` degrees instead of numbers every `15` degrees.
- What stays as it is: the `28px` quadratic bowed top and bottom lens seams (`lensBowAt`), the `seamPose` tilt on the transparent menu and transport controls, the red `is-disconnected` seam state, the two fonts, the colour palette, and the wireframe agents.

### 3. Single-line closed terminal chips and outline-only `FINISHED` chips

- What changes: in `src/engine/terminals.js` and `src/styles.css`, remove the redundant second row on closed `.mr-term` chips that repeats the truncated agent key (`ORCHESTRAT...`, `SUB-FRONTE...`), keeping a compact single-line chip (`dot + label + state word`); and change `.mr-term.is-done` (`FINISHED`) from a solid `#2aff80` filled block to a black chip with a `#2aff80` border and `#2aff80` status text so finished agents do not outshine active `#e5ff00` agents.
- What stays as it is: the wireframe agent shapes, the thin white leader line from each agent to its chip, the `#e5ff00` active accent, `#ff2a2a` error accent and `#2aff80` finished accent, Space Mono at weight `400`/`500`, and the curved lens.

### 4. Auto-hide the `HEIGHT` and `ZOOM` rails until hover or drag

- What changes: fade `.lens-rail` (`src/ui/LensRail.jsx`) to `0.18` opacity with no text labels at rest, revealing the full rail, label (`HEIGHT`, `ZOOM`) and multiplier (`1.0x`) only when the pointer is within `64px` of the left or right lens edge or while dragging or wheel-zooming.
- What stays as it is: both rails' exact position, log-scale zoom and height-share math (`src/ui/lensResize.js`), keyboard accessibility, the curved lens, transparent header and footer, colours, fonts, and wireframe agents.

### 5. Replace `OverviewCard` in `.hud-lower-right` with an always-open `Agent + Costs` stack

- What changes: remove the two-button `OverviewCard` (`src/ui/Hud.jsx:132-153`) that leaves `.hud-lower-right` mostly empty, and render `AgentDock` (top) and `#hud-dock-costs` (`CostBoard`, bottom) directly in the right column of `.hud-lower` at `900px` and wider, matching the information density of the narrow dock without an extra click.
- What stays as it is: `AgentDock` and `CostBoard` markup and styling, the three-column `.hud-lower` grid, the curved lens, transparent menu and transport, black/white/yellow colours, Jost and Space Mono fonts, and the wireframe agents.

### 6. Include orchestrators and thinking lanes in the top-right lens status corner

- What changes: update `lensStatus` (`src/ui/lens.js:33-47`) so the top-right lens readout reports active orchestrators and lanes together (for example, `WORKING 2 LANES · 1 SUB` or counts `working` and `thinking` runs across all roster agents), instead of displaying `WORKING 0 / 2` while the main orchestrator and a sub-orchestrator are visibly working in the hub.
- What stays as it is: the `.lens-corner.is-right` placement, clock, progress bar, Space Mono typography, black/white/yellow colours, curved lens, transparent menu and transport, and wireframe agents.

### 7. Fix `Waiting.jsx` copy and make `/` scroll to the inline chat on desktop

- What changes: update the desktop text in `src/ui/Waiting.jsx` so it does not claim `the chat opens at the bottom right` when `window.innerWidth >= 900`, and make pressing `/` or clicking `ORCHESTRATOR /` in `src/ui/Hud.jsx:533-536, 756-759` call the same smooth `openConversation()` scroll-and-focus helper that the transport orchestrator button uses (`src/ui/Transport.jsx:34-42`).
- What stays as it is: the `Waiting` card's black/white/yellow styling and position at the bottom center of the lens, the curved lens, transparent menu and transport, fonts, and wireframe agents.

### 8. Cap 3D callout density when more than 4 agents work at once

- What changes: in `src/engine/agents.js` and `src/engine/terminals.js`, when more than `4` agents are simultaneously in `working` state, show the full `.mr-callout` (`name + task + command`) and `.mr-term-console` only for the focused agent, the hovered agent, and the `2` most recently active agents, keeping the remaining working agents on their compact single-line `.mr-term` chip until hovered or focused.
- What stays as it is: every wireframe agent shape, status ring, yellow tunnel and packet stream, the curved lens, transparent header and footer, black/white/yellow colours, and Jost and Space Mono fonts.

## A full design (one page)

If the desktop display (`1280 x 800` and `1920 x 1080`) were arranged again for the person who runs MachineRoom all day, the page would stop acting like two separate screens joined by a full-window scroll. Instead, it would fit into a single `100vh` locked desktop frame with an adjustable split between the 3D lens on top (`56%` of viewport height by default, draggable from `35%` to `85%`) and the workbench below (`44%` of viewport height), with the bowed transport bar anchored between them as the permanent status spine.

```
+--------------------------------------------------------------------------------------------------+
| /project [v Main]   [REPLAY | LIVE]          [Reviews 2] [Proposals 1] [Control C] [Settings] [?]|
+-------------------------------------( bowed top lens seam )--------------------------------------+
|  [Height]                                                                     01:28:00  2/4 busy |
|                                      ( INTERNET )                             [FAILED: agy2 test]|
|                                     ( ORCHESTRATOR )                                             |
|     [SRC/]                         /       |        \                            [SERVER/]       |
|                           (SUB: FRONT)     |     (SUB: BACK)                     lane-costs.js   |
|                              /    \        |        /    \                                       |
|                          [oc1]   [oc2]  [ROOT/]  [claude] [agy3]                           [Zoom]|
|                                        +--git--+                                                 |
+------------------------------------( bowed bottom lens seam )------------------------------------+
| [LIVE // CONNECTED] [Center] | ORCH: waiting | [oc1: U114 4m] [claude: Q25 8m] | 42% ctx  $1.84  |
+------------------------------+---------------+---------------------------------+-----------------+
| [Chat] [Projects] [Agents 1] | MAIN / SUB: FRONT / SUB: BACK / TEAM   [Diff]   | AGENT & COSTS   |
| + New conversation           | ----------------------------------------------- | claude · opus   |
| > Current session            | Owner: Audit how the room shows its work.       | Task: Q25 (8m)  |
|   Branch: main (clean)       | Orch: Dispatched Q25 to agy3, U114 to oc1.      | Tool: edit_file |
|   2 branches ready to merge  | [Room: oc1 passed tests, 1 commit ahead]        | Last 8 log lines|
|                              | ----------------------------------------------- | --------------- |
|   Family tree (compact):     | [ Ask the orchestrator...                     ] | Today:    $1.84 |
|   - Orchestrator (idle)      | [Model: opus] [Effort: high] [Compact]   [Send] | Month:   $48.20 |
|     - oc1: working U114      |                                                 | [oc1]  === $12  |
|     - agy3: working Q25      |                                                 | [agy3] ==  $9   |
+------------------------------+-------------------------------------------------+-----------------+
```

### How the four zones work together

1. Top menu bar (transparent, bowed with `seamPose` as now): holds `/project` and the conversation picker on the left, `REPLAY | LIVE` in the center-left, and action badges on the right (`Reviews N` in yellow when lane branches have unmerged commits, `Proposals N` when an agent request is pending, `Control C`, `Settings`, `?`). `Log L` is folded into the lower workbench as a tab beside `Team` and `Diff` so there is only one log surface.
2. The 3D lens (`56%` height by default, `35%` to `85%` on the auto-hiding `Height` rail): shows the wireframe hub, sub-orchestrator sectors, yellow active tunnels, folder cards and horizontal git tree. The duplicate top-center `/PROJECT` label, the 3D coordinate numbers, and the bottom compass degree labels are gone. At the top right, under the clock and `N / M busy` bar, a sticky red failure tray lists any unacknowledged run or test failure (`FAILED: agy2 test`) until cleared or re-run. Closed agent chips are single-line, and when more than `4` lanes work at once, full callouts appear only on the focused, hovered, and two newest active agents.
3. The bowed transport bar (always visible between lens and workbench, never scrolled off screen):
   - Left: `LIVE // CONNECTED` and `Center` (plus a `Follow: OFF / WIDE / AGENT` pill).
   - Center: the main orchestrator state (`ORCH: waiting`), sub-orchestrator chips, and compact live lane pills (`[oc1: U114 4m]`, `[claude: Q25 8m]`) showing every active or failed lane's task id and elapsed minutes at a glance. Clicking any pill focuses that agent in the lens and loads it in the right-hand dock.
   - Right: the `22px` context ring (`42% ctx`), today's and this month's spend (`$1.84`), and elapsed session time. In replay mode, this bar swaps to `Play/Pause`, the scrubber with start/done/error ticks, and `1x-8x` speed buttons.
4. The lower workbench (`44%` height, always visible below the transport in three independent scroll columns):
   - Left column (`280px`): `Chat`, `Projects` (with the branch status and a one-click link to `Reviews` when branches are ahead), and `Agents` (with the family tree and a badge count for pending proposals).
   - Middle column (flexible): the orchestrator tabs (`Main`, each sub, `Team`), plus `Log` and `Diff / Reviews` tabs so the owner can read the event log or inspect and merge a finished lane diff in the wide center column without covering the lens.
   - Right column (`300px`): a single unified `Agent & Costs` inspector that replaces both the in-lens `Inspector` and the empty `OverviewCard`. Clicking an agent, folder, file, `INTERNET` sphere, or git commit in the lens loads its details, preview, or diff here while the bottom third of the column pins today's and this month's cost bars.

### What stays and what it costs

- What stays: the `28px` bowed lens top and bottom curves (`lensBowAt`) and `seamPose` angled controls; the transparent header and transport; the `#000000`, `#ffffff` and `#e5ff00` palette with `#ff2a2a`, `#2aff80` and `#2a9dff` semantic colours; Jost and Space Mono at weights `400` and `500`; every 3D wireframe shape (`shapes.js`), sector arc (`hub.js`), yellow tunnel and packet stream (`agents.js`, `strings.js`), folder card ring (`ring.js`, `cards.js`), and horizontal git tree (`gitTree.js`); and all existing bridge routes.
- What it costs:
  - Layout and CSS (`src/styles.css`, `src/Stage.jsx`, `src/ui/Hud.jsx`, `src/ui/lensResize.js`): medium change (`~250` lines) to lock `.stage` to `100vh` at `>= 900px`, default `lensShare` to `0.56`, keep `.transport` fixed between `.lens` and `.hud-lower`, and merge `Inspector` and `OverviewCard` into `.hud-lower-right`.
  - Transport and lens status (`src/ui/Transport.jsx`, `src/ui/lens.js`): small change (`~120` lines) to render active lane pills, the sticky failure tray, action-needed badges, and the live spend total.
  - 3D scene cleanup (`src/engine/void.js`, `src/engine/terminals.js`, `src/engine/agents.js`, `src/model/folderView.js`): small-to-medium change (`~150` lines) to drop 3D coordinate labels, simplify closed `.mr-term` chips to one line, cap simultaneous `.mr-callout` boxes past `4` working agents, and demote bulk folders like `node_modules` in `planFolderView`.
  - Visual trade-off: the default lens height drops from `~90%` of the window to `56%` (`~600px` tall on `1080p`, `~448px` on `800p`), trading vertical sky and floor void above and below the flat ring for permanent, zero-scroll visibility of the chat, roster, failure state, and spend, while keeping the `Height` rail so the owner can still pull the lens to `85%` or let the 60-second idle mode expand the room to full screen.
