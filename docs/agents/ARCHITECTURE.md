# MachineRoom architecture

Version 0.1.0. A browser viewer that shows coding agents working on one project as a 3D machine room. The first mode replays a recorded run. A later mode will follow a live Paperclip instance.

## What it shows

- The core in the middle is the Machine: the Paperclip control plane.
- Each agent is a wireframe shape on a ring around the core. It moves above the folder it is working in.
- Each agent has a terminal on the terminal wall above the room, joined to its agent by a thin line.
- The project folders are flat tiles on the floor. Each file is a plane. A folder opens when an agent touches it: root first, then each subfolder in turn.
- Colour has one meaning each: white is activity, red is failure, yellow is finished work.
  - A read or write flashes the file white.
  - A failed tool call, a failed run or a failed test flashes red and leaves the file red until it is written again.
  - A run that ends well turns the agent, its terminal and every file it wrote in that run yellow.
- There is no randomness. The same recording always draws the same room.

## Commands

```
npm install
npm run dev        http://localhost:5173
npm test           vitest, node environment, no browser needed
npm run build
npm run fixtures -- <raw-events.jsonl> <sandbox-folder> <ids.json>
```

The lint command is the build. There is no separate linter yet.

## Layout of the code

```
src/model/        pure logic, no DOM, fully tested
  paths.js          path cleanup, ancestors, tree builder
  commands.js       files and folders a shell command touches
  parsers/          one parser per agent type (claude, hermes, opencode, agy)
  pipeline.js       Paperclip frames -> activities (batch)
  state.js          activities -> room state (agents, files, folders)
  player.js         replay clock, seek, speed, idle compression
  source.js         parse and prepare a recording
  replay.js         fetch the recording from public/fixtures
src/engine/       three.js scene, no React
  layout.js         deterministic folder layout (pure, tested)
  room.js           builds the scene, runs the frame loop, reacts to activities
  clusters.js       folder tiles and file planes
  agents.js         agent shapes, movement, link lines
  terminals.js      CSS3D terminals on the wall
  core.js           the Machine
  camera.js         orbit, zoom, focus
  sprites.js        colours and helpers (copied from the portfolio void engine)
src/ui/           React HUD
src/Stage.jsx     wires player, room and HUD together
src/App.jsx       loads the recording, shows loading, empty and error states
public/fixtures/  the recorded run, agent list and file tree
tests/            vitest
```

## Data flow

1. Paperclip sends frames on `ws://HOST/api/companies/:id/events/ws`. A frame is `{id, companyId, type, createdAt, payload}`.
2. `pipeline.js` turns frames into activities. `heartbeat.run.log` carries raw agent output in `payload.chunk`; the parser for that agent turns it into tool calls.
3. `state.js` applies each activity to a mutable room state. `player.js` owns the clock and calls `onActivity` for each applied activity and `onReset` after a seek.
4. `room.js` reads the state every frame and reacts to activities with short animations (pulses, flashes, folder opening). Animations run on wall time. State changes run on replay time.

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

A touch is `{path, mode, kind}`. `kind` is `file` or `dir`. `mode` is `read`, `write` or `list`. `path` is relative to the project root, and `''` is the root.

## How each agent reports tool calls

| Agent | Adapter | Signal in `payload.chunk` |
| --- | --- | --- |
| Claude Code | `claude_local` | JSON lines `acpx.tool_call`; the call name carries the path ("Read C:\...", "Edit src\math.js") or the command text for Terminal |
| Hermes | `hermes_local` | Plain lines such as `┊ 📖 read  strings.js  1.2s`; shown after the call finishes; reads show only the file name |
| OpenCode | `opencode_local` | JSON lines `tool_use` with `part.tool` and `part.state.input` |
| agy | `process` | JSON lines `step_update`; `ACTIVE` starts a tool, `DONE` ends it |

A shell command touches files only when its text names a known file or folder. See `commands.js` and its tests.

## DOM contract for terminals

`engine/terminals.js` builds, and the stylesheet styles, this structure:

```
.mr-term.is-{idle|queued|working|error|done}[.is-muted]
  .mr-term-title
  .mr-term-body
    .mr-line.is-{normal|dim|error|done}
```

Do not rename these classes without changing both sides.

## Conventions

- Plain words, short sentences. No em dashes. No single-line explanatory comments.
- Fonts: Jost and Space Mono, weights 400 and 500 only. Never bold.
- Colours: white, `#e5ff00`, `#ff2a2a` on black. Spacing on an 8px base.
- Commit message: version prefix, then a sentence. Example: `0.1.1: Add the live bridge`.
- Keep large binaries and secrets out of git. Never print a key.

## Known limits

- The folder layout is a radial tree. Many folders at one level will crowd each other.
- Hermes read lines carry only a file name. A name shared by two files cannot be resolved.
- Failure is read from tool status and from output text such as a test marker. A tool that fails quietly shows as ok.
- Only a recorded run is wired in. The live mode is in `TASKS.md`.

## Open work

See `docs/agents/TASKS.md`.
