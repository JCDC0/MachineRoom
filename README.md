# Machine Room

A 3D view of coding agents working on one project. Agents appear as wireframe shapes around a core. Each has a terminal on a wall above the room. When an agent reads or writes, the folders on the floor open one after another and the files light up. White is activity, red is failure, yellow is finished work.

This version replays a recorded run of four agents (Claude Code, Hermes, OpenCode and agy) working through Paperclip. A live mode is planned.

```
npm install
npm run dev
```

Open `http://localhost:5173`. Space plays and pauses, `0` returns to the overview, `1` to `4` focus an agent, the arrow keys seek, `[` and `]` change the speed. Drag to look around and scroll to zoom.

Run `npm test` for the tests and `npm run build` for a production build. The code is described in `docs/agents/ARCHITECTURE.md`.
