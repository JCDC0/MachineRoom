# Machine Room

A 3D view of coding agents working on one project. Agents appear as wireframe shapes around a core. Each has a terminal on a wall above the room. When an agent reads or writes, the folders on the floor open one after another and the files light up. White is activity, red is failure, yellow is finished work.

By default it replays a recorded run of four agents (Claude Code, Hermes, OpenCode and agy) working through Paperclip. With Paperclip running, open `/?live` to follow your own agents as they work, or run `npm run bridge` (see `.env.example`) and open `/?live&bridge=http://127.0.0.1:5174`. Add `&simulate` to try live mode without Paperclip.

```
npm install
npm run dev
```

Open `http://localhost:5173`. Space plays and pauses, `0` returns to the overview, `1` to `4` focus an agent, `F` follows whichever agent is working (wide, close up, off), `L` opens the event log, `?` shows the keys, the arrow keys seek, `[` and `]` change the speed. Drag to look around and scroll to zoom.

Run `npm test` for the tests and `npm run build` for a production build. The code is described in `docs/agents/ARCHITECTURE.md`.
