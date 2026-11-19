# Docs audit 6

2026-11-19. P625. Read against commit `8cc3e892`, version `0.1.401`.

Scope: `docs/agents/ARCHITECTURE.md`, every file under `docs/agents/architecture/` (`ACTIVITIES.md`, `CODE.md`, `COMMANDS.md`, `DOCUMENTS.md`, `LIMITS.md`, `LIVE.md`, `ROOM.md`), `docs/agents/PLAN.md`, `docs/agents/DESIGN-PANELS.md` and `README.md`. This is a source and build audit. No screen check was made. Only this file changes.

## Contradicted sentences

### D6-1: Architecture core still places task reads in server/control.js

- Doc: `docs/agents/ARCHITECTURE.md:5`.
- Code: `server/control.js:217-289`, `server/runs.js:2266-2293`, `server/lane-tasks.js:380-386`.
- The doc says the drawer reads tasks, live runs and costs from `server/control.js` and `server/lane-costs.js`.
- P588 moved `GET /api/control/issues` out of `server/control.js` into `server/runs.js`, where `laneTaskState` builds the issues and `maskRecordCommits` masks keys and profile paths. `server/control.js` serves `models`, `agents`, `live-runs`, `comments`, `approvals`, `budget` and `costs`.
- Corrected sentence: "The drawer reads tasks from `server/runs.js` (`GET /api/control/issues`), runs from `server/runs.js` (`GET /api/control/runs`), and live runs, agents and costs from `server/control.js` and `server/lane-costs.js` through a shared byte-offset cache on `runs.jsonl`; approvals and comments are empty, and a comment or budget write is refused."

### D6-2: Architecture core stops the review range at 58

- Doc: `docs/agents/ARCHITECTURE.md:102`.
- Code: `docs/agents/architecture/DOCUMENTS.md:109-122` and `docs/agents/` tracked files.
- The last sentence says reviews 37 to 58 and the later docs and test audits are listed in `architecture/DOCUMENTS.md`.
- Reviews now run through `AUDIT-2026-11-REVIEW-62.md` (59 to 62), alongside `AUDIT-2026-11-DESIGN-2.md`, `AUDIT-2026-11-DESIGN-3.md`, `AUDIT-2026-11-DOCS-5.md` and `AUDIT-2026-11-TESTS-4.md`.
- Corrected sentence: "Later reviews, 37 to 62, and the later design, docs and test audits are listed in `architecture/DOCUMENTS.md`."

### D6-3: Activity parser table and web summary omit four harnesses

- Doc: `docs/agents/architecture/ACTIVITIES.md:27-32`, `docs/agents/architecture/ACTIVITIES.md:36`.
- Code: `src/harnesses/index.js:10-14`, `src/model/parsers/index.js:6-12`, `src/model/parsers/codex.js:26-30,101-106`, `src/model/parsers/copilot.js:3-7,67-85,142-148`, `src/harnesses/acp.js:7-28,125-222,341-348`, `src/harnesses/machineroom.js:1,87-93,114`, `src/model/parsers/claude.js:10,126-130`.
- The table lists only Claude Code (`claude_local`), Hermes (`hermes_local`), OpenCode (`opencode_local`) and agy (`process`). Line 36 names web calls only for those four harnesses.
- Eight harnesses register parsers in `src/harnesses/index.js`: Codex (`codex_local`, JSON lines including `command_execution`, `file_change` and `web_search`), GitHub Copilot (`copilot_local`, JSON tool events and plain text fallback including web search and fetch), ACP (`acp_local`, `session/update` `tool_call` and `tool_call_update` JSON lines) and MachineRoom (`machineroom_local`, sharing `createClaudeParser` with `web_search` and `web_fetch`).
- Corrected sentence: Add table rows for Codex (`codex_local`), GitHub Copilot (`copilot_local`), ACP (`acp_local`) and MachineRoom (`machineroom_local`), and update line 36 to add "Codex's `web_search`, GitHub Copilot's web tool and plain-text web lines, and MachineRoom's `web_search` and `web_fetch` (while ACP `fetch` maps to `other`)."

### D6-4: Commands and Live docs give the wrong model for agy3

- Doc: `docs/agents/architecture/COMMANDS.md:23`, `docs/agents/architecture/LIVE.md:24`.
- Code: `docs/agents/lanes.json:312-320` (and stale note at `docs/agents/lanes.json:329`).
- Both docs state that `agy` and `agy2` run Gemini 4 Hydrogen at XHigh and `agy3` runs Gemini 4 Hydrogen at High.
- Commit `2042c86a` changed `agy3` in `lanes.json` to `Gemini 4 Neon (High)` (`gemini-4-neon-high`).
- Corrected sentence: "the `agy` and `agy2` lanes run Gemini 4 Hydrogen (XHigh) and `agy3` runs Gemini 4 Neon (High)."

### D6-5: Live doc omits six active fleet lanes and keeps a capitalization typo

- Doc: `docs/agents/architecture/LIVE.md:24`.
- Code: `docs/agents/lanes.json:357-563`.
- The fleet summary names `opencode` to `opencode7`, `agy` to `agy3`, `claude`, `codex`, `native` and `native2`, plus retired `hermes` and `opencode8` to `opencode10`. It also contains `and When GET /api/control/runs`.
- `lanes.json` also defines six active lanes not named there: `claude2`, `claude3`, `codex2`, `codex3`, `native3` and `native4`.
- Corrected sentence: "for the fleet (`opencode` to `opencode7`, `agy` to `agy3`, `claude` to `claude3`, `codex` to `codex3` and `native` to `native4`, with `hermes` and `opencode8` to `opencode10` retired)... and when `GET /api/control/runs` reads a record with `failover`..."

### D6-6: Live and Plan still call AGY a backend-only lane

- Doc: `docs/agents/architecture/LIVE.md:24`, `docs/agents/PLAN.md:22`.
- Code: `docs/agents/lanes.json:276-277,299-300,322-323`, `server/active-lanes.js:131`.
- Both docs describe AGY as a backend lane kept out of eligible owner worker lanes unless the owner creates one.
- Commit `72f2de0c` updated `agy`, `agy2` and `agy3` in `lanes.json` so they own UI briefs moved from Codex (`src/ui/**`, `src/styles.css`) alongside backend paths, and removed `src/styles.css` from their `forbidden` lists. `server/active-lanes.js:131` still excludes built-in `agy` lanes from `eligibleLanes`.
- Corrected sentence: "In `lanes.json`, AGY lanes own backend paths and UI briefs moved from Codex (`src/ui/**`, `src/styles.css`), while `eligibleLanes` in `server/active-lanes.js` still omits built-in AGY lanes unless the owner creates one."

### D6-7: Needs you shows up to two unresolved failures per lane, not one

- Doc: `docs/agents/architecture/LIVE.md:50`.
- Code: `src/briefs/attention.js:79-108`.
- The doc says `GET /api/control/runs` includes `attention` and "It shows the newest unresolved failure per lane."
- Commit `543ddba8` changed `attentionItems` to iterate `newestByLaneAndMode(list)`, keeping both the newest `plan` failure and the newest non-`plan` failure for a lane when both are unresolved.
- Corrected sentence: "It checks the newest Plan run and the newest non-Plan run per lane and returns each one that is still an unresolved failure."

### D6-8: Build size limit, warning status and module count in Limits are stale

- Doc: `docs/agents/architecture/LIMITS.md:50`.
- Code: `vite.config.js:8` and `npm run build` at commit `8cc3e892`.
- The doc reports `index` at `967.28 kB` raw / `278.99 kB` gzip (`171` `src/` modules), `index.css` at `176.46 kB` raw / `27.81 kB` gzip, and `build.chunkSizeWarningLimit` at `970` so the chunks fit without warning.
- Running `npm run build` at `8cc3e892` transforms 201 modules and emits `index` at `972.89 kB` raw (`972,895` bytes) / `282.49 kB` gzip (`168` `src/` modules inside `176` chunk modules), `index.css` at `175.60 kB` raw / `28.14 kB` gzip, `react` at `218.78 kB` raw (`218,787` bytes) / `68.26 kB` gzip (`11` modules), `three` at `586.48 kB` raw (`586,483` bytes) / `147.27 kB` gzip (`13` modules) and `index.html` at `0.82 kB` raw / `0.45 kB` gzip. Because `index` exceeds `970 kB`, Vite prints its chunk-size warning. (`src/` has 185 tracked files in all.)
- Corrected sentence: "At `8cc3e892`, `npm run build` transforms 201 modules and emits `react` (218.78 kB raw, 68.26 kB gzip), `three` (586.48 kB raw, 147.27 kB gzip), `index` (972.89 kB raw, 282.49 kB gzip; 168 `src/` modules in 176 chunk modules with no lazy-loading), `index.css` (175.60 kB raw, 28.14 kB gzip) and `index.html` (0.82 kB raw, 0.45 kB gzip); because `index` now exceeds `build.chunkSizeWarningLimit` (970 kB), Vite prints its chunk-size warning."

### D6-9: Code map assigns /api/control/issues to control.js instead of runs.js

- Doc: `docs/agents/architecture/CODE.md:79`, `docs/agents/architecture/CODE.md:98`.
- Code: `server/control.js:217-289`, `server/runs.js:2266-2293`.
- Line 79 describes `control.js` as `/api/control routes: agents, issues, comments, approvals, live runs, costs and models`. Line 98 describes `runs.js` without mentioning `GET /api/control/issues` or `maskRecordCommits`.
- `server/control.js` has no `issues` route; `server/runs.js` handles `GET /api/control/issues` using `laneTaskState` and masks returned records with `maskRecordCommits`.
- Corrected sentence: Line 79: "`control.js        /api/control routes: agents, comments, approvals, live runs, budget refusal, costs and models`". Line 98: append "`GET /api/control/issues` via `laneTaskState`, and `maskRecordCommits` on returned records".

### D6-10: Code map omits six runtime/bridge files, vite.config.js and 121 test files

- Doc: `docs/agents/architecture/CODE.md:51-67`, `docs/agents/architecture/CODE.md:69-112`, `docs/agents/architecture/CODE.md:117-122`, `docs/agents/architecture/CODE.md:124-441`.
- Code: `server/codex-rollout.js`, `server/harness-probe.js`, `src/briefs/attention.js`, `src/briefs/taskState.js`, `src/ui/RoomBoundary.jsx`, `src/ui/roomNotice.js`, `vite.config.js`, and 121 tracked files under `tests/`.
- The code map lists "The files in each folder, one line each" (`CODE.md:3`).
- Tracked files missing from their `CODE.md` sections are: 2 of 47 `server/` files (`codex-rollout.js`, `harness-probe.js`), 4 of 185 `src/` files (`src/briefs/attention.js`, `src/briefs/taskState.js`, `src/ui/RoomBoundary.jsx`, `src/ui/roomNotice.js`), build config `vite.config.js` (referenced in `LIMITS.md:50`), and 121 of 445 tracked files under `tests/` (118 of 422 `tests/*.test.js(x)` files plus `tests/helpers/gitEnv.js`, `tests/helpers/hide-windows.mjs` and `tests/helpers/timeout.js`).
- Corrected sentence: Add one-line entries for `server/codex-rollout.js`, `server/harness-probe.js`, `src/briefs/attention.js`, `src/briefs/taskState.js`, `src/ui/RoomBoundary.jsx`, `src/ui/roomNotice.js`, `vite.config.js` and the 121 missing files under `tests/`.

### D6-11: Documents index omits six markdown files in docs/agents

- Doc: `docs/agents/architecture/DOCUMENTS.md:30-34`, `docs/agents/architecture/DOCUMENTS.md:114`, `docs/agents/architecture/DOCUMENTS.md:122`.
- Code: Tracked files `docs/agents/AUDIT-2026-11-DESIGN-2.md`, `docs/agents/AUDIT-2026-11-DESIGN-3.md`, `docs/agents/AUDIT-2026-11-REVIEW-60.md`, `docs/agents/AUDIT-2026-11-REVIEW-61.md`, `docs/agents/AUDIT-2026-11-REVIEW-62.md` and `docs/agents/AUDIT-2026-11-TESTS-4.md`.
- `DOCUMENTS.md` aims to list every doc in `docs/agents/`. It stops at `AUDIT-2026-11-DESIGN.md`, `AUDIT-2026-11-DOCS-5.md`, `AUDIT-2026-11-REVIEW-59.md` and `AUDIT-2026-11-TESTS-3.md`.
- Six of the 179 tracked markdown files under `docs/agents/` have no entry in `DOCUMENTS.md`.
- Corrected sentence: Add bullet entries under `docs/agents/architecture/DOCUMENTS.md` for `AUDIT-2026-11-DESIGN-2.md`, `AUDIT-2026-11-DESIGN-3.md`, `AUDIT-2026-11-REVIEW-60.md`, `AUDIT-2026-11-REVIEW-61.md`, `AUDIT-2026-11-REVIEW-62.md`, `AUDIT-2026-11-TESTS-4.md` (and `AUDIT-2026-11-DOCS-6.md`).

### D6-12: Room and Plan say only Claude Code and OpenCode receive enabled MCP servers

- Doc: `docs/agents/architecture/ROOM.md:68`, `docs/agents/PLAN.md:25`.
- Code: `scripts/run-lane.mjs:2194-2221`, `server/orchestrator.js:1957-1995,2054-2095`, `scripts/acp-run.mjs:319-320`, `scripts/mcp-bridge.mjs:40-50`, `scripts/mr-agent.mjs:13,1072-1098`.
- Both docs state that enabled MCP servers from Settings are passed only to Claude Code and OpenCode lane runs and orchestrator turns.
- `run-lane.mjs` and `server/orchestrator.js` write per-run config files for `claude` and `opencode`, while `acp-run.mjs` (`mcpServersForAcp()` on `session/new`) and `mr-agent.mjs` (`listAllMcpTools` / `callMcpTool` reading `<runs>/mcp.json`) also receive or invoke enabled MCP servers for both lane runs and orchestrator turns.
- Corrected sentence: "Enabled MCP servers are passed to Claude Code and OpenCode via per-run config files, and to ACP (`session/new`) and MachineRoom (`mcp_list_tools` and `mcp_call_tool`) from `<runs>/mcp.json`, for both lane runs and orchestrator turns."

### D6-13: Plan claims an Overview card and permanent narrow-screen Settings above Costs

- Doc: `docs/agents/PLAN.md:18`.
- Code: `src/ui/Hud.jsx:1023-1042,1142-1222`, `src/ui/AgentDock.jsx:68-124`.
- The line describes "the lower half with the sidebar, the conversation and the Overview card, the dock below 900 pixels with the agent list, the selected agent's context and the settings above the cost board".
- There is no Overview card in `.hud-lower` (`Hud.jsx:1199-1222` and `AgentDock.jsx` show the selected agent context, Meters, Reviews and Tasks). Below 900 pixels, `Settings` renders inside `.hud-dock-side` only while `settingsOpen` is true (`Hud.jsx:1040-1042`), not always above the cost board.
- Corrected sentence: "The page: the lens with its corner labels, the lower half with the sidebar, the conversation and the right dock (selected agent context, Meters, Reviews and Tasks), the dock below 900 pixels with the agent list, selected agent context, panels and Settings when open, the guide, and a short agent list with one idle row."

### D6-14: Plan still lists P167 to P172 and Quick start as waiting

- Doc: `docs/agents/PLAN.md:70`.
- Code: `docs/agents/CHANGELOG.md:828-846`.
- Line 70 says `R1 and Q4 run as P169, R2 and Q2 as P170 after it, Q3 and Q5 as P171, Q1 as P172. R3, the rest of Q5 and the README line on making lanes wait for P168, which rewrites the Quick start.`
- P167 through P172 all merged and their changes are recorded in `CHANGELOG.md:828-846`.
- Corrected sentence: "4. Daily use (`AUDIT-2026-11-READINESS.md`, P164) and first-use fixes (P166): P167 through P172 merged the readiness items, Quick start rewrite, connect-screen copy and review merge guards; only the three suggested features wait for the owner."

### D6-15: README states a 500 kB Vite chunk-size warning threshold instead of 970 kB

- Doc: `README.md:42`.
- Code: `vite.config.js:8` and `npm run build` output at `8cc3e892`.
- Line 42 says `npm run build` prints `Some chunks are larger than 500 kB`.
- `vite.config.js:8` sets `chunkSizeWarningLimit: 970`, so Vite warns `Some chunks are larger than 970 kB after minification.` (currently triggered by `index` at `972.89 kB`).
- Corrected sentence: "`npm run build` writes the built viewer, prints the asset list, `built in` with the time, and a Vite chunk-size warning when any chunk exceeds 970 kB (`Some chunks are larger than 970 kB`)."

### D6-16: README names Add child and omits Mode when making a lane

- Doc: `README.md:104`.
- Code: `src/ui/FamilyTree.jsx:2302,2521,2632-2641`.
- Line 104 says `Make a lane in the Agents tab: open the family tree, press Add child on the orchestrator, and fill in the label, harness, model and effort.`
- The Agents section header (`Agents`) has a `+` button (`Add a lane`) that adds under Main, and an orchestrator row's kebab has `Add a lane under this…`; the form has no `Add child` label and includes a `Mode` selector when modes exist for the chosen harness (`FamilyTree.jsx:2302`).
- Corrected sentence: "Make a lane in the Agents tab: press `+` (`Add a lane`) in the `Agents` header (or `Add a lane under this…` in an orchestrator row's menu), and fill in the label, harness, model, mode (if offered) and effort."

### D6-17: README caps the lane conversation run picker at 10 instead of 20

- Doc: `README.md:106`.
- Code: `src/ui/laneConversation.js:1,51`.
- Line 106 says the lane conversation opens `with a picker for its last 10 runs`.
- `LANE_RUN_LIMIT` is `20`, so the Run picker lists up to 20 recent runs.
- Corrected sentence: "It loads the lane's newest run with a picker for its last 20 runs, updates while the run is live, and shows Stop while it runs."

### D6-18: README says Settings only shows or removes lanes

- Doc: `README.md:108`.
- Code: `src/ui/Settings.jsx:171-172`, `src/ui/HarnessesSettings.jsx:447,562-639`.
- Line 108 says `Settings only shows or removes lanes.`
- Settings's `Lanes` tab renders `LaneSettingsFields` (four saved runner settings: replies to a working lane, warn above N running lanes, worktree setup command, files to copy to new worktrees) above `LanesSettings`.
- Corrected sentence: "Settings's Lanes tab holds four runner settings (reply handling, running-lane warning count, worktree setup command and files to copy) above the list to hide, show or delete lanes."

### D6-19: Lower-panel controls break DESIGN-PANELS height, native select, hit-area and focus rules

- Doc: `docs/agents/DESIGN-PANELS.md:17`, `docs/agents/DESIGN-PANELS.md:19`, `docs/agents/DESIGN-PANELS.md:21`.
- Code: `src/ui/FamilyTree.jsx:552,619,1946,2302`, `src/ui/FamilyTeam.jsx:352,369,386`, `src/ui/Sidebar.jsx:756`, `src/ui/ModelPicker.jsx:394-412,429-434`, `src/styles.css:6053-6075,8687-8731,11403-11414`.
- The spec requires every control in the three areas to be 28 px tall, never show a native `<select>` in browser styling, keep at least a 24 px hit area and use a `1px solid var(--white)` focus ring.
- Inside those three areas: `FamilyTree.jsx`, `FamilyTeam.jsx`, `Sidebar.jsx` (`Sort by`) and `ModelPicker.jsx` (`Sort models`) still render native `<select>` elements styled with `.mr-side-select` (22 px high, `#1b1b1b` fill, yellow focus border with `outline: none`) or `.mr-picker-sort` (24 px high, `#1b1b1b` fill); `FamilyTree.jsx` inline inputs/buttons use 22 px `.mr-side-input` and 24 px `.mr-side-primary`; non-inline `ModelPicker` triggers use `.mr-picker-trigger` instead of `Chip`; and `.mr-orch-line-action` hover message buttons have `< 24px` height and `outline: 2px solid var(--yellow)`.
- Corrected sentence: "Chips and new toolbar selects use 28 px shared controls (`Chip`, `Select`), while sidebar/Agents forms, the Sort by and Sort models native selects, non-inline `ModelPicker` triggers and `.mr-orch-line-action` hover buttons still keep their legacy heights, native `<select>` controls or yellow focus styles."

### D6-20: DESIGN-PANELS markdown list omits italics and tables

- Doc: `docs/agents/DESIGN-PANELS.md:38`.
- Code: `src/ui/markdown.jsx:5,10,29,52-62`.
- Line 38 lists `headings, lists, bold, inline code, code blocks and links`.
- `markdown.jsx` also parses single-marker `*...*` / `_..._` emphasis as `<em>` and pipe tables (`TABLE_DIVIDER`, `tableHeader`) as `<table>`.
- Corrected sentence: "Markdown in agent, orchestrator and lane messages is rendered by one shared renderer: headings, lists, bold, italics, tables, inline code, code blocks and links. It builds React elements and never injects HTML."

### D6-21: DESIGN-PANELS omits the running-lane kebab and conditional To/Worktree rules

- Doc: `docs/agents/DESIGN-PANELS.md:45`.
- Code: `src/ui/LaneConversation.jsx:836-848`, `src/ui/Composer.jsx:3-11`.
- Line 45 says a lane's toolbar left side is `To`, `Run` and `Worktree` (described as lanes in `To` + `Run` + `Worktree`).
- When `selectedRunning` is true, `LaneConversation.jsx` hides the `Worktree` switch and shows `<Menu label="Lane message options">` with `Send and interrupt`. It also omits `Worktree` when `!canCompose` or `!onRecipientSend`, renders `To` only when `recipientOptions` is provided, and populates `To` with Orchestrator, subs and runnable lanes.
- Corrected sentence: "In a lane's conversation the left side shows `To` (Orchestrator, subs and runnable lanes, when `recipientOptions` is passed), `Run`, `Worktree` (only when composable on a non-running selection), and `Lane message options` (`Send and interrupt`, only while the selected run is running)."

### D6-22: DESIGN-PANELS omits lane context text and red paused/failed dot

- Doc: `docs/agents/DESIGN-PANELS.md:46`.
- Code: `src/ui/LaneConversation.jsx:29,251-256`, `src/styles.css:5840-5846`.
- Line 46 gives the lane status example `● Finished · Run 11:20:16` without mentioning lane context or failed/stopped tone.
- In a composable lane, when `currentRun?.contextTokens` is numeric, `LaneConversation.jsx` appends `· Context ...` after `Run HH:MM:SS`, and `failed` or `stopped` runs take the `'paused'` tone (`var(--red)` dot in `styles.css:5844-5846`).
- Corrected sentence: "One status line under the box, Space Mono 11, muted: a dot in the status colour (`--yellow` working, `--green` waiting or finished, `--red` paused, failed or stopped), then the status, then `Run HH:MM:SS` in a composable lane plus `· Context ...` whenever context tokens are reported; in history mode the run time shows on the `Run` chip only (P618)."

### D6-23: DESIGN-PANELS omits the breadcrumb dot and header tool bars in LaneConversation

- Doc: `docs/agents/DESIGN-PANELS.md:50`.
- Code: `src/ui/LaneConversation.jsx:621-642`.
- Line 50 says the header is just the breadcrumb on the left and `Back` on the right.
- `LaneConversation.jsx` puts an 8 px `.mr-agent-dot` in the lane's room colour inside the breadcrumb before the uppercase lane name, and renders `.mr-lane-conv-tools` bars directly below the header for `Edit from this plan` (finished Plan run) and `Retry` (history read failure).
- Corrected sentence: "One header row, 40px: the breadcrumb on the left (`project /` plus an 8px colour dot and uppercase lane name), `Back` on the right as a text chip, and an optional `.mr-lane-conv-tools` bar below it for `Edit from this plan` or history `Retry`."

### D6-24: Teams and Build a team headers do not match the Agents header layout

- Doc: `docs/agents/DESIGN-PANELS.md:57`.
- Code: `src/ui/FamilyTeam.jsx:328-338`, `src/ui/FamilyTree.jsx:527-542`.
- Line 57 says `TEAMS` and `BUILD A TEAM` use the same header as `AGENTS` (hover `+` and kebab).
- `Build a team` uses `.mr-side-head.is-button` with `.mr-side-twist` (`+` or `-` text) instead of `.mr-family-heading` and `.ui-chip-chevron`, and `Teams` uses `.mr-family-heading` with a count chip and chevron rather than `+` and kebab actions.
- Corrected sentence: "`AGENTS` uses the header with `+` (`Add a lane`) and kebab on hover or focus; `TEAMS` uses a collapsible `.mr-family-heading` with a count badge and chevron, and `BUILD A TEAM` uses `.mr-side-head.is-button` with a `+`/`-` twist."

### D6-25: Paused orchestrator rows show a red dot while reading waiting

- Doc: `docs/agents/DESIGN-PANELS.md:58`.
- Code: `src/ui/FamilyTree.jsx:2515-2516,2573`, `src/styles.css:9778-9780`.
- Line 58 says the 8 px dot is yellow working, white idle or `--text-faint` off, and lists `waiting` as a row status word.
- `FamilyTree.jsx` maps `paused` orchestrator state to status word `waiting`, keeps `dot = state` (`paused`), and `.mr-family-dot.is-paused` paints the dot `var(--red)`.
- Corrected sentence: "An agent row is a two line `.ui-row`: an 8px status dot (yellow working, red paused, white idle/waiting, `--text-faint` off) and the name in Jost 14; on the right one muted word (`working`, `waiting`, `idle` or `off`)."

### D6-26: Row chat labels and kebab items differ from DESIGN-PANELS

- Doc: `docs/agents/DESIGN-PANELS.md:60`.
- Code: `src/ui/FamilyTree.jsx:2520-2541,2587-2591`.
- Line 60 says every row has chat label `Open conversation` and a kebab with `Add a lane under this…`, `Turn off` / `Turn on`, and `Delete…`.
- In `FamilyTree.jsx`, session rows show no trailing actions (`trailing` is empty), chat buttons are labelled `Open conversation with <name>` (lanes) or `Open chat with <name>` (orchestrators), lane kebabs start with `Make sub from this lane…` (while orchestrators use `Add a lane under this…`), only lanes get `Turn off`/`Turn on`, and only lanes and subs get `Delete…` (Main never gets `Delete…`).
- Corrected sentence: "Trailing actions on non-session rows, shown on hover or focus: a chat icon button (`Open conversation with <name>` for lanes, `Open chat with <name>` for orchestrators) and a kebab starting with `Make sub from this lane…` (lanes) or `Add a lane under this…` (orchestrators), plus `Turn off` or `Turn on` (lanes only) and red `Delete…` (lanes and subs only)."

### D6-27: Bulk select bar chip reads Make sub instead of Make sub orchestrator

- Doc: `docs/agents/DESIGN-PANELS.md:62`.
- Code: `src/ui/FamilyTree.jsx:2473-2474`.
- Line 62 says the bar above the list shows the chips `Make sub orchestrator`, `Clear` and `Done`.
- `FamilyTree.jsx:2473` sets the visible chip `label` to `"Make sub"` (`aria-label="Make sub orchestrator"`).
- Corrected sentence: "a bar above the list says `N selected` with the chips `Make sub` (`aria-label="Make sub orchestrator"`), `Clear` and `Done`."

### D6-28: Expanded Agents fold label and class name differ from DESIGN-PANELS

- Doc: `docs/agents/DESIGN-PANELS.md:63`.
- Code: `src/ui/FamilyTree.jsx:2497`, `src/styles.css:9569-9589`.
- Line 63 says the fold row reads `Show 17 more lanes` with a chevron, in the row style.
- When expanded, line 2497 flips the label to `Hide N more lanes`, and the button uses `.mr-family-more-head` (with `.ui-chip-chevron`), not `.ui-row`.
- Corrected sentence: "The fold button uses `.mr-family-more-head` with `.ui-chip-chevron`, reading `Show N more lanes` when closed and `Hide N more lanes` when open."

### D6-29: Hover card includes current task, omits session run info and shows paused

- Doc: `docs/agents/DESIGN-PANELS.md:64`.
- Code: `src/ui/FamilyTree.jsx:2515,2544-2549`.
- Line 64 lists `name, harness and model, effort and mode, status, and the last run's time and outcome.`
- `HoverCard` puts the current task in the status line (`Status STATE · TASK`), uses raw `state` (so a paused orchestrator shows `Status paused` even though its row says `waiting`), and for session rows omits `Effort ... · Mode ...` and shows `node.step` instead of a last run.
- Corrected sentence: "Hover card on a row: name, harness and model, effort and mode (omitted on session rows), `Status STATE` with optional ` · TASK` (using raw `paused` rather than `waiting`), and the last run's time and outcome (or the current step on a session row)."

## Behaviours merged since P582 not named in any doc

1. **CI test step has a 25-minute timeout**
   - Commit: `15d74507`.
   - Code: `.github/workflows/ci.yml:33`.
   - Target doc: `docs/agents/architecture/COMMANDS.md:40`.
   - Sentence that would be true: "The `npm test` step in CI runs with `timeout-minutes: 25` on Ubuntu and Windows."

2. **`/api/control/issues` moved to `server/runs.js`, masks returned records, and `attentionItems` emits separate Plan and edit failures per lane**
   - Commits: `aa771a94` (P588) and `543ddba8`.
   - Code: `server/runs.js:2266-2293`, `src/briefs/attention.js:85-108`.
   - Target docs: `docs/agents/ARCHITECTURE.md:5`, `docs/agents/architecture/CODE.md:79,98`, `docs/agents/architecture/LIVE.md:50`.
   - Sentence that would be true: "`GET /api/control/issues` is served by `server/runs.js` (`laneTaskState`) and masks keys and profile paths on every returned record through `maskRecordCommits`; `attentionItems` tracks the newest Plan failure and newest non-Plan failure separately per lane."

3. **Four Gemini 4 Neon models added for AGY and `agy3` switched to Neon High**
   - Commits: `52f84597` (P611) and `2042c86a`.
   - Code: `server/model-list.js:20-23`, `docs/agents/lanes.json:312-320`.
   - Target docs: `docs/agents/architecture/COMMANDS.md:23`, `docs/agents/architecture/LIVE.md:24`, `docs/agents/architecture/CODE.md:107`.
   - Sentence that would be true: "`server/model-list.js` defines `gemini-4-neon-low`, `gemini-4-neon-medium`, `gemini-4-neon-high` and `gemini-4-neon-xhigh` for AGY, and `agy3` in `lanes.json` runs `Gemini 4 Neon (High)` (`gemini-4-neon-high`)."

4. **AGY lanes now own UI briefs moved from Codex (`src/ui/**`, `src/styles.css`)**
   - Commits: `72f2de0c`, `a9edf144`.
   - Code: `docs/agents/lanes.json:276-277,299-300,322-323`.
   - Target docs: `docs/agents/architecture/LIVE.md:24`, `docs/agents/PLAN.md:22`.
   - Sentence that would be true: "From 0.1.402, `agy`, `agy2` and `agy3` in `lanes.json` own UI briefs (`src/ui/**`, `src/styles.css`) moved from Codex in addition to backend paths, with `src/styles.css` removed from their `forbidden` lists."

5. **Repository branch list keeps `Show all` when clearing the branch filter**
   - Commit: `6444603f`.
   - Code: `src/ui/RepositoryPanel.jsx:205,241-243,284-289`.
   - Target doc: `docs/agents/architecture/ROOM.md:42`.
   - Sentence that would be true: "In `RepositoryPanel.jsx`, pressing `Show all N branches` expands the local branch list and changing or clearing the filter keeps `showAll` enabled."

6. **Marker chooser anchors to the clicked marker, flips above/below, and repositions on scroll or resize**
   - Commit: `2554a707`.
   - Code: `src/ui/Transport.jsx:61-105,123`, `src/styles.css:2674-2695`.
   - Target doc: `docs/agents/architecture/ROOM.md:70`.
   - Sentence that would be true: "Opening the `.scrubber-overflow` marker chooser sets `--marker-x`, `--marker-edge` and `data-side` (`above` when `top >= 64` or `top >= spaceBelow`, otherwise `below`) from the trigger button, and updates its placement on window `resize` and `scroll`."

7. **Run-end `'room'` notices preserve `firstCommit` semicolons through structured metadata**
   - Commit: `0e08b782` (P592).
   - Code: `server/orchestrator.js:1191,2991-2992`, `src/ui/roomNotice.js:1-14`.
   - Target docs: `docs/agents/architecture/CODE.md:57-67`, `docs/agents/architecture/ROOM.md:58`.
   - Sentence that would be true: "Run-end `room` notices store and restore `firstCommit` from `record.commits[0]` so `roomNoticeSummary` (`src/ui/roomNotice.js`) keeps semicolons inside commit subjects instead of splitting the summary line on `; `."

## Other checks

- `src/model/pipeline.js:106-123` (`startedBy`, `session` on `run.queued`/`run.start`) and `src/model/parsers/claude.js:131-166` (`mcp` and `task` tools and child completion rules) match `docs/agents/architecture/ACTIVITIES.md:14,21`.
- `src/ui/Transport.jsx:263-310` and `src/ui/controls.jsx:6-28,181-209,274-276` match `docs/agents/architecture/CODE.md:54,63` and `docs/agents/DESIGN-PANELS.md:25`.
- `src/engine/sprites.js:18-34`, `src/engine/shapes.js:33-43` and `src/engine/agents.js:1238-1265` match `docs/agents/architecture/ROOM.md:29,58` on Main yellow, roster palette order and scene child colour inheritance.
- `bin/machine-room.mjs:8-27,50-92,113-190` matches the documented `machine-room` CLI flags and `up`/`doctor` subcommands.
- `docs/agents/architecture/CODE.md` lists all 27 files in `scripts/` and both files in `bin/`, and has no stale entries for deleted files across `bin/`, `scripts/`, `server/`, `src/` or `tests/`.
- `docs/agents/architecture/LIMITS.md:34` documents the P602/P605 `runsViewFor` cache, 30-second path cache with 1,024-key cap, 5-second `isThisRepo` floor and `cachedRunRecords` head/tail/inode checks.
- `docs/agents/architecture/ROOM.md:70` matches `Hud.jsx` on the P620 menu band (`/` + open chat, Team or lane), and `docs/agents/DESIGN-PANELS.md:46` matches P618 (`9aa7d741`) on history mode showing the run time on the `Run` chip only.

## Not verified

- Visual layout, spacing, pixel alignment, contrast and browser focus/hover behaviour by eye in a live browser (`npm run dev` / `npm run serve`), left to the orchestrator.
- Running the full test suite (`npm test`), skipped per brief rules because other lanes share the host.
