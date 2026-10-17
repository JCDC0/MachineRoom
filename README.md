# Machine Room

A 3D view of coding agents working on one project. Agents appear as wireframe shapes around a core. Each has a terminal on a wall above the room. When an agent reads or writes, the folders on the floor open one after another and the files light up. White is activity, red is failure, yellow is finished work.

![Machine Room overview](docs/images/overview.png)

![Machine Room close-up follow view](docs/images/closeup.png)

![Machine Room connect screen](docs/images/connect.png)

The first time you open it, a connect screen lets you connect through the bridge (run `npm run bridge`, see `.env.example`), connect to Paperclip directly, watch a demo, or open a recorded replay of four agents (Claude Code, Hermes, OpenCode and agy). It remembers your connection and replay speed. Skip the screen with an address: `/?replay`, `/?live` (Paperclip through the dev proxy), `/?live&bridge=http://127.0.0.1:5174`, `/?live&simulate`, or `/?connect` to see the screen again.

```
npm install
npm run dev
```

Open `http://localhost:5173`. Space plays and pauses, `0` returns to the overview, `1` to `4` focus an agent, `F` follows whichever agent is working (wide, close up, off), `L` opens the event log, `?` shows the keys, the arrow keys seek, `[` and `]` change the speed. Drag to look around and scroll to zoom.

Run `npm test` for the tests and `npm run build` for a production build. The code is described in `docs/agents/ARCHITECTURE.md`.
