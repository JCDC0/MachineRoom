# Changelog

## Unreleased

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
