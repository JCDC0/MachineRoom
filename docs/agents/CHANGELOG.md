# Changelog

## Unreleased

- Hire and update an agent (task C3c): `hireAgent(draft)` and `updateAgent(id, patch)` in the control client contract and the mock, with the checks in `src/control/agents.js` (Paperclip roles and harnesses, limits, plain-words refusals). With approval required a hire makes a `pending_approval` agent and a pending `hire_agent` approval, approving it makes the agent ready and rejecting it terminates it, and a waiting or terminated agent cannot take a task. Agents carry effort, limits, subagent settings and instructions. The dispatcher can now change the subagent setting through the mock. New brief C2b for the real routes and a fuller C3d for the builder form.
- Prompts come from the repository (task T1): `docs/agents/HOUSE-RULES.md` holds the rules every agent follows, `docs/agents/lanes.json` holds each agent's worktree, model and forbidden paths, and `src/briefs/briefs.js` parses the briefs in `TASKS.md` and builds the full prompt for one or more briefs and one lane. The mock client serves sample briefs through `briefs()` and `briefPrompt(ids, lane)`. TASKS.md loses its old rules and branch table. New briefs: T1a (routes), T1b (panel), G5 (CI), and a sharper P5.
- Stage passes the real control client to the HUD when the viewer is connected through the bridge (`createClient({ baseUrl })`), so the drawer, the assistant and its confirmed writes talk to Paperclip. Demo and replay still use the mock. PAPERCLIP-API.md gains the approval, comment order and cost event findings from C2. New briefs U4 (reject a foreign Host header), C3e (HUD polish) and the M1 exit test.
- Hermes P6: the value of a commit message or a request body (`-m`, `--message`, `-d`, `--data`, `--data-raw`, `--data-binary`, quoted with `"`, `'` or `\"`) no longer counts as a file touch. A cut message with no closing quote is blanked to the end. A quoted path that is an ordinary argument still counts. Four scenario lines that pinned the old behaviour now expect no touches.
- The assistant now acts (task A3). `src/assistant/dispatch.js` runs each validated action against a host: it moves the camera to an agent, a terminal, a folder or a file, controls the overview, follow and replay, and creates a task or sets a budget through the control client after the confirm card. The room gains `focusTerminal` and `focusPath`. `Stage.jsx` passes the paths of the project, the action handler and a `controlTarget` to the HUD, and shows results in a toast. The control plane agent is matched by the room's agent id, then by key, then by name.
- Change notices in the panels and drawer opening from outside (task C3b): panels subscribe to change notices with pure 100 ms batching, and Hud accepts controlTarget to open tabs and task threads.
- Real control client (`src/control/client.js`), bridge control routes (`/api/control/*`), SSE `change` notices on `/events`, assistant model fallback route (`POST /api/assistant`), and shared contract test suite (`tests/control-contract.test.js`).
- Floating assistant terminal (task A2): draggable terminal in the style of wall terminals, opened with / and closed with Escape, history ring of 20 lines, position remembered in settings and clamped to the window, bottom docked under 900px, proposal confirmations, and secret blocking.
- Decision model comparison tool (task D1): `src/decider/` (Decisions API request and answer shapes, `decide()` with a time limit, retries and key scrubbing, the fixed assistant and routing questions, stats, baselines, runner), `npm run decide-eval` and 138 probes in `tests/probes/` (98 assistant phrases, 40 coding tasks). It makes no call without `--run`, reads the key only from your environment, and sends it only over https or to this machine. Tests use a fake Decisions server. `rankPaths` in the assistant narrows the path options. The assistant test now takes its phrases from `tests/probes/`.
- The decision model: design, rules for acting on its answers, what is sent, a comparison of 27 listed models (Jev 1.14, Perplexity Decider, Clef, Mercury Decide, Microsoft-Decision-1 and local open ones), and tasks D1 to D5. The choice is to be measured on our own probe set.
- Next plan (`docs/agents/PLAN.md`): milestones M1 to M4, the order of work for OpenCode, AGY and Claude, rules for staying current while Paperclip changes by itself, rules for MachineRoom building on itself, and the steps to publish on GitHub.
- The control client contract gains `subscribe` (change notices) and an `overrides` field on issues. The mock sends a notice after each write and keeps the dispatch limits on the issue. Tests run in the threads pool, because the forks pool crashed on Windows in `tests/bridge.test.js` about once in eight full runs (exit code 3221226505); 40 runs in a row pass now.
- Merged OpenCode's four recorded scenarios and the stored-run frame tool, and AGY's control drawer (dispatch, tasks, approvals, meters on the mock). Removed a debug line that put the client on `window`.
- Assistant core (`src/assistant/`): a closed list of 14 actions with a validator, rule based intent with agent and path resolution, a guard that stops keys before they go anywhere, and a parser for a cheap fallback model. Tests in `tests/assistant.test.js`. The plan and the cost board are in `docs/agents/CONTROL-PLANE.md` and tasks A1 to A6.
- Fix keyboard handling, agent spend mapping, and typography in the control drawer panels.
- Control drawer with dispatch form, tasks list and thread, approvals queue and spend and quota meters against the control client.
- Control client contract (`docs/agents/CONTROL-CLIENT.md`) and a mock (`src/control/mock.js`) with tests, so the dispatch, thread, approvals and meter panels can be built before the real client exists. The demo and replay pass the mock to the HUD as `client`.
- First run: a connect screen (bridge, Paperclip directly, demo, replay) opens on the first visit, remembers the choice and the replay speed, and comes back with a clear message when a live connection fails. A waiting overlay explains an empty or dropped live room. The start-up choice is a tested pure module.
- Merged AGY's first-run components, settings module and README images.
- Add `src/ui/brand.js`, `src/ui/settings.js` with `tests/settings.test.js`, `src/ui/Connect.jsx`, `src/ui/Waiting.jsx` and improved `src/ui/Notice.jsx` with retry support.
- Add overview, close-up and connect screen screenshots under `docs/images/` and link them in `README.md`.
- Folders float in 3D space at different heights and are joined by sagging strings. The layout is a fixed-pass relaxation, so it is deterministic, keeps tiles apart and out of the core, and a growing live tree keeps existing folders in place while tiles glide to new positions.
- Agents travel along the strings from folder to folder and hover above the exact file they touch, with a tether and a floating tag with the current command.
- Follow mode on `F` now cycles wide, close up and off.
- The overview camera centers on the bounding sphere of the room, so deep folders stay in view.
- Fold the colour legend into the title block so the HUD clears the terminal wall at narrow widths, and align the event log columns.
- Four recorded scenarios under `public/fixtures/` (failing test then fix, edit across three files, rename on three agents, tool error) with parser tests that pin the files, modes and results of every tool call.
- A shell command that renames or deletes files now touches them as writes, so a `git mv` or `rm` shows on both names.
- Fixture building scrubs email addresses along with the Windows profile name, and still refuses to write when a frame looks like it holds a key.
- `scripts/frames-from-runs.mjs` rebuilds a frame file from Paperclip's stored run data, so a recording is complete even where the live socket truncates large log chunks. The frame building is unit tested with fake API answers.
- `npm run fixtures` also takes plain frame files and an optional output name, so one fixture set per recording can live under `public/fixtures/`.
- The bridge restores truncated log frames from Paperclip's run log, so large tool calls are no longer lost in live mode. Frames keep their order and the restored chunk is replayed after a reconnect.
- Merged OpenCode's bridge (`server/index.js`, `npm run bridge`) and `createPipeline`. The viewer's own copy is gone: `createPipeline` also carries `learn` and `context`.
- Merged AGY's HUD: run markers, event log drawer on `L`, mode switch, help overlay on `?`, caret and glow on terminals.
- Viewer connects through the bridge with `/?live&bridge=URL`, and adds files when the bridge reports them.
- Replay and Live switch in the HUD without a page refresh. Live mode shows a feed clock instead of the scrubber.
- Log lines and run markers come from `src/model/log.js`.
- The bridge accepts any `localhost` or `127.0.0.1` page, not only port 5173.
- Live mode: the viewer follows a running Paperclip over its WebSocket, with agent discovery, reconnect, an incremental pipeline and a live player. Open `/?live`.
- The scene rebuilds its folders when the file list grows, so a live room can start empty.
- Agents get their own key, so two agents with the same adapter no longer collide. Terminal wall gains rows.
- Vite proxies `/paperclip` to Paperclip for REST calls.
- Simulated live feed: `/?live&simulate&speed=3` plays the recording through the live path, with a Demo badge.
- Layout rewrite: folders no longer overlap, big folders use a dense grid and the overview camera fits the room.
- Follow mode on `F`: the camera tracks the agent that is working.
- File name labels for reads, writes and failures. Clusters recolour only the planes that changed.

## 0.1.0

- Scaffold: Vite, React 19 and three.js, with vitest.
- Model: path cleanup, command to file mapping, parsers for Claude Code, Hermes, OpenCode and agy, event pipeline, room state and a replay player with idle compression.
- Engine: deterministic folder layout, folder tiles with file planes, agent shapes that move over their folder, terminal wall, the Machine core, orbit camera with agent focus. Copied `sprites.js` from the portfolio void engine.
- HUD: agent list, colour legend and transport with speed.
- Recording: one 5 minute run of four agents in a sandbox repo, with the file tree and agent list.
