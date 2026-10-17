# Task briefs

Three agents work on MachineRoom at the same time. Each one owns a set of paths and works on its own branch in its own git worktree. Stay inside your paths. If you need a change outside them, write it in your report and stop.

| Agent | Role | Branch and folder | Owns |
| --- | --- | --- | --- |
| Claude | Engine and merges | `main` in `C:\GitHub\MachineRoom` | `src/engine/**`, `src/Stage.jsx`, `src/App.jsx`, `docs/agents/ARCHITECTURE.md`, version bumps, merges |
| OpenCode | Backend and data | `feat/live-bridge` in `C:\GitHub\MachineRoom-opencode` | `src/model/**`, `server/**`, `scripts/**`, `public/fixtures/**`, `tests/` files for those, `.env.example`, `dependencies` in `package.json` |
| AGY | Frontend | `feat/hud` in `C:\GitHub\MachineRoom-agy` | `src/ui/**`, `src/styles.css`, `index.html` |

## Rules for every agent

- Read `AGENTS.md` (or `GEMINI.md`), then `docs/agents/ARCHITECTURE.md`, then your section below.
- Work in your own worktree. Never push. Never force anything. Never switch the main folder's branch.
- Commit small on your branch. Prefix: `0.1.1:` for OpenCode, `0.1.2:` for AGY, then one plain sentence. Claude renumbers on merge.
- Before you report, run `npm test` and `npm run build`. Both must pass.
- Add one line per change under `Unreleased` in `docs/agents/CHANGELOG.md`.
- Style: plain words, short sentences, no em dashes, no single-line explanatory comments, no bold fonts, no emoji in code or copy.
- Never read, print or commit a secret. Never write a key into a file, a log or a report.
- Stop every process you start (dev servers, bridges, browsers). Delete any log file you wrote.
- Report: files changed, commands run with pass or fail, and what you could not verify. Do not claim a pass you did not run.

## OpenCode: backend and data

Goal: let the viewer follow a live Paperclip instance instead of a recording. The browser will talk only to a small local bridge.

Do B1 to B4 in order. B5 is optional.

**B1. Incremental pipeline.** In `src/model/pipeline.js` add `createPipeline({ agents, tree })` that returns `{ push(frame), flush() }`. `push` takes one Paperclip frame and returns the new activities, in order. Keep `buildActivities` and make it use the new function. Add a test in `tests/` that feeds the recorded frames one by one and proves the activities equal those from `buildActivities`. In live use, frames can arrive slightly out of order. Say in your report how the pipeline copes with that.

**B2. The bridge.** Create `server/index.js`, Node 24, ES modules, no framework, no production dependencies. Use `node:http` and the built-in `WebSocket` client.

- Configuration comes from the environment. Put placeholders only in `.env.example`: `PAPERCLIP_URL` (default `http://127.0.0.1:3100`), `PAPERCLIP_COMPANY_ID`, `PROJECT_ROOT` (absolute path), `PORT` (default `5174`). Add `npm run bridge`.
- `GET /api/health` returns `{ ok, paperclip }` where `paperclip` says whether the upstream socket is open.
- `GET /api/agents` reads `PAPERCLIP_URL/api/companies/:id/agents` and returns `[{ id, key, name, adapterType, parser }]`. `parser` is `claude` for `claude_local`, `hermes` for `hermes_local`, `opencode` for `opencode_local`. For `process` match the agent name (`agy`). Anything else gets a slug of its name and no parser.
- `GET /api/tree` returns `{ root, files, created: [] }`. `root` is the folder name of `PROJECT_ROOT`. `files` come from `git ls-files --cached --others --exclude-standard` run in `PROJECT_ROOT`, sorted, with `/` separators. If it is not a git repo, walk the folder and skip `.git`, `node_modules`, `dist`.
- `GET /events` is Server-Sent Events. Send every Paperclip frame for the company as `event: frame` with the frame JSON as `data`. Give each an `id`. Keep the last 500 frames and replay those after `Last-Event-ID`. Send a comment line every 15 seconds. The viewer does not use this yet (it opens Paperclip's WebSocket through its dev proxy), so build `/api/tree` and the watcher first and `/events` after them.
- Connect to `ws://PAPERCLIP_URL/api/companies/:id/events/ws`. Reconnect with a delay that grows from 1 to 15 seconds.
- Bind to `127.0.0.1` only. Allow CORS only for origins on `localhost` or `127.0.0.1` on any port (the viewer runs on 5173 or 5180). Do not log frame bodies. The viewer reads the file list with `/?live&tree=http://127.0.0.1:5174`, so `/api/tree` must answer that cross-origin request.

**B3. Tree watcher.** Watch `PROJECT_ROOT` with `fs.watch` (recursive), debounce 300 ms, ignore `.git` and `node_modules`. When the file list changes, send `event: tree` on `/events` with `{ root, files }`.

**B4. Tests.** Test the bridge against a fake Paperclip: an HTTP server for the REST calls and a WebSocket server for the events. You may add `ws` as a dev dependency for the fake only. Cover: the agent mapping, the tree endpoint, a frame arriving over SSE, replay after `Last-Event-ID`, and reconnect after the upstream closes.

**B5 (optional). More recordings.** The Paperclip sandbox and the recorder are described in `docs/agents/RECORDING.md`. Record runs for: a failing test that the agent then fixes, an edit across three files, a file rename or delete, and a tool error. Add them under `public/fixtures/` through `npm run fixtures`, add parser tests that use them, and list any adapter behaviour the parsers get wrong in your report. Do not edit parsers beyond what the new tests need.

Done when: `npm test` and `npm run build` pass, `npm run bridge` starts against a fake or real Paperclip, and `curl -N http://127.0.0.1:5174/events` shows frames.

## AGY: frontend

Goal: turn the working HUD into the final one. The 3D room is not yours: do not touch `src/engine`.

Do F1 to F5 in order. F6 is the check.

**Contract.** `src/ui/Hud.jsx` receives these props today: `snapshot` (`{ position, duration, playing, speed, agents: [{ key, name, status, label, runs }] }`), `focused`, `speeds`, `rootName`, `onToggle`, `onSeek`, `onSpeed`, `onFocus`, `onOverview`. Keep them working. Any new prop must be optional with a safe default. List the new props in your report so Claude can wire them.

**F1. HUD pass.** Keep the agent list, the overview button, the colour legend and the transport. Improve spacing, alignment and states. The terminal wall takes the top middle of the screen at about 30% height. The HUD must never cover it. Put the legend and title where they cannot collide with it at 1280 by 720.

**F2. Run markers on the scrubber.** Add an optional `markers` prop to `Transport`: `[{ at, tone }]` where `at` is milliseconds on the same scale as `position` and `tone` is `start`, `error` or `done`. Draw small ticks on the track in white, red and yellow. Clicking a tick seeks there.

**F3. Event log drawer.** Add an optional `log` prop to `Hud`: `[{ time, agent, text, tone }]` with `tone` of `normal`, `dim`, `error` or `done`. Toggle it with the `L` key and a button. Show the last 50 lines, newest at the bottom, in Space Mono, with the same tone colours as the terminals.

**F4. Terminals.** Style only the `.mr-*` rules in `src/styles.css`, following the DOM contract in `docs/agents/ARCHITECTURE.md`. Add a blinking caret after the last line while `.is-working`. Add a soft glow on the border for `.is-error` and `.is-done`. Keep the text readable at 800 pixels wide. Do not change the class names.

**F5. Mode switch and help.** Add a Replay and Live segmented control with props `mode`, `onMode` and `liveAvailable`. Live is disabled when `liveAvailable` is false. Add a keyboard help overlay on `?` that lists: Space, 0, 1 to 9, left and right arrows, `[` and `]`, `L`.

**F6. Check.** Run `npm run dev` and look at 1280 by 720 and 1920 by 1080. No horizontal scroll. Keyboard focus is always visible. Text contrast is at least AA. Respect `prefers-reduced-motion`. Read the browser console: no errors. Save no screenshots in the repo.

Style: black, white, `#e5ff00`, `#ff2a2a`. Jost and Space Mono at 400 and 500 only. Spacing on an 8px base. Labels in capitals with letter spacing. All copy in plain words, no em dashes.

Done when: `npm test` and `npm run build` pass, F1 to F5 work in the browser, and your report lists the new props.
