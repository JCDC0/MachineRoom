# Changelog

## Unreleased

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
