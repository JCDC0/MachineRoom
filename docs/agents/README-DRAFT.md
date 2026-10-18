# MachineRoom

A 3D room that shows coding agents working on one project. Agents are wireframe shapes around a core, each with a terminal on the wall above the room, and the project folders open as the agents touch them.

You can replay a recorded run with no Paperclip at all, or follow a live Paperclip instance.

## Screenshots

![The room from the overview](docs/images/overview.png)

![Follow view on one agent](docs/images/closeup.png)

![The connect screen](docs/images/connect.png)

## What you need

- Node 24, the version the CI workflow uses.
- A browser with WebGL.
- For live mode only: Paperclip 2026.1012.0 in local_trusted mode, and at least one coding agent harness. The pinned version and the API notes are in docs/agents/PAPERCLIP-API.md.

The replay and the demo need no Paperclip and no harness.

## Quick start: replay

Three commands in the project folder.

```
npm install
npm run dev
start http://localhost:5173/?replay
```

On macOS or Linux, run `open` in place of `start`. The replay plays one recorded run with four agents: Claude Code, Hermes, OpenCode and agy.

## Quick start: demo mode

No Paperclip, no harness. Open this address while the dev server runs.

```
http://localhost:5173/?live&simulate&speed=3
```

The badge reads Demo. The recording plays through the live path, so the room behaves as it does with a real connection.

## How live mode connects

Proxy: `/?live` sends the browser to Paperclip through the Vite dev server, which forwards `/paperclip` to http://127.0.0.1:3100. This needs the dev server and has no production build.

Bridge: `/?live&bridge=http://127.0.0.1:5174` sends the browser to `npm run bridge`. The bridge holds the Paperclip socket, lists the agents, sends the project file list, and restores log chunks that Paperclip cut at 8192 characters.

Set the variables from `.env.example` in your shell before you start the bridge. Nothing reads a `.env` file.

## How it works

1. Paperclip sends frames on its events socket. Each frame holds a chunk of agent output.
2. The parser for that harness turns the chunk into tool calls, each with a label and the files it touches.
3. The model layer turns those calls into activities, and the room state applies them in time order.
4. The replay clock or the live feed hands each activity to the scene, which reacts with pulses, flashes, opening folders and moving agents.
5. The same recording always draws the same room. There is no randomness.

## Supported harnesses

| Agent | What the room shows | Known limit |
| --- | --- | --- |
| Claude Code | Tool calls from `acpx.tool_call` lines. The call name carries the path, or the command text for Terminal. | A call whose log line is over 8192 characters is missed through the proxy route. |
| Hermes | Plain lines such as `read strings.js`, shown after the call finishes. | A read line carries only the file name, so a name shared by two files cannot be resolved. |
| OpenCode | `tool_use` lines with the tool name and its input. | A line that Paperclip masks is dropped unless it still holds a tool name and a command or a path. |
| agy | `step_update` lines. ACTIVE starts a call and DONE ends it. | No harness specific limit is recorded in ARCHITECTURE.md. |

Limits that apply to every harness:

- Failure is read from the tool status and from output text such as a test marker. A tool that fails quietly shows as ok.
- The terminal wall holds five terminals per row and adds rows above for more agents.
- The layout compares every pair of folders. About 400 folders take 0.13 seconds and 1600 take 1.2 seconds.

## What it does not do yet

- The control panels run on a mock unless the viewer is connected through the bridge.
- The assistant runs on rules. The room does not call a model today.
- The bridge has a helper model route, `POST /api/assistant`, which runs OpenCode. It answers 404 when `ASSISTANT_MODEL` is off, and nothing in the room calls it yet.

## Safety

- The bridge listens on 127.0.0.1 only. It refuses a foreign Origin header and a foreign Host header.
- The assistant never reads an API key. Text that looks like a key is refused before it goes anywhere.
- The assistant proposes writes, such as a new task or a budget change, and the owner confirms them on a card. A write without that confirmation is refused.

## Where the plan lives

docs/agents/PLAN.md holds the order of work and the milestones. docs/agents/TASKS.md holds the briefs. docs/agents/ARCHITECTURE.md holds the design.

## How agents contribute

- Read docs/agents/ARCHITECTURE.md first, then the brief in docs/agents/TASKS.md.
- One branch per task, in the agent's own worktree.
- Touch only the files the brief names. Run `npm test` and `npm run build` before a commit.
- No pushes. Claude reviews and merges each branch.

## Non affiliation

MachineRoom is an independent project. It is not made by, and is not endorsed by, Paperclip or any agent vendor named here.

## Licence

Licence: to be chosen.
