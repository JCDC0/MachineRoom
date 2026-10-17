# Changelog

## Unreleased

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
