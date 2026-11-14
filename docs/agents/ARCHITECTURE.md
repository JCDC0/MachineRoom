# MachineRoom architecture

Version 0.1.401. A browser viewer that shows coding agents working on one project as a 3D machine room. It follows the room's own sources live: runs started with `run-lane` (`--lanes`), task queues on a project (S8, S8b) and the owner's Claude Code and OpenCode sessions (`--sessions`, S7a and S7b). It replays a recorded run too.

MachineRoom grew out of Paperclip: it began as its viewer and took its idea of a company of agents with tasks, budgets and approvals. Paperclip was removed on 2026-10-24, and the room now reads its own sources. S6a (0.1.233) shows lane runs live from the run-lane logs. The drawer reads tasks, live runs and costs from the lane records (`server/control.js`, `server/lane-costs.js`; L1 and L2) through a shared byte-offset cache on `runs.jsonl`; approvals and comments are empty, and a comment or budget write is refused.

## Documents

The code is the first authority, then this file, then every other doc. A doc that disagrees with the code is fixed in the same change that finds it.

This file is the core. `architecture/DOCUMENTS.md` lists every file in `docs/agents` and what it is for. The detail behind the core is under `architecture/`:

- `architecture/ACTIVITIES.md`: the activity schema, how each agent reports tool calls, and the DOM contract.
- `architecture/CODE.md`: the layout of the code, one line per file.
- `architecture/COMMANDS.md`: every command, its flags and what it prints.
- `architecture/LIMITS.md`: the known limits, with the measurement behind each one.
- `architecture/LIVE.md`: live mode, the bridge, the sources and the query parameters.
- `architecture/ROOM.md`: what the room shows and how it behaves.

## Where to read more

| File | Holds | Read it when |
| ---- | ---- | ---- |
| `architecture/ROOM.md` | What the room shows and how it behaves. | You change what the owner sees: a card, an agent, the hub, the inspector, the sidebar, the chat or a key. |
| `architecture/COMMANDS.md` | Every command, its flags and what it prints. | You run or change a script, or need the exact flag or output of one. |
| `architecture/CODE.md` | The layout of the code, one line per file. | You look for the file that owns a behaviour, or you add one. |
| `architecture/LIVE.md` | The connect screen, the bridge, the lane and session sources, the query parameters and the live code. | You work on live mode, a source, the bridge's frames or an address. |
| `architecture/ACTIVITIES.md` | The activity schema, how each agent reports tool calls, and the DOM contract for terminals and cards. | You add a parser, an activity, a chip class or a card class. |
| `architecture/LIMITS.md` | The known limits, with the measurement behind each one. | You need to know what the room does not do, or you measure a number. |
| `architecture/DOCUMENTS.md` | Every file in `docs/agents` and what it is for. | You need a doc other than the six detail files. |

## The room in short

At 900 pixels and wider, the menu row, the lens and the transport fill the first screen, and the page scrolls to the lower half beneath them (U158). The lens holds the 3D room: a flat hub ring with the orchestrator above it, each lane on its own slot or inside its sub orchestrator's arc, and a flat ring of folder cards around the hub, joined by faint strings to the root card under the hub. Each agent is a distinct wireframe shape in its own colour, with a terminal chip beside it and a callout above it that names its task and command. A working agent sends a grey tunnel to the file it touches, along the lit folder links, and a star runs down it; the card and the file row carry camera brackets in the agent's colour. A run that ends well turns the agent and every file it wrote green, and a failure turns them red. The lower half holds the sidebar, the conversation and the inspector at 900 pixels and wider. White is activity, blue is the web, red is failure, yellow is active, and green is finished work. There is no randomness: the same recording always draws the same room.

## Commands in short

- `npm install` installs the dependencies.
- `npm run dev` serves the page from Vite at http://localhost:5173.
- `npm run preview` serves the built viewer through Vite on its own port, with no bridge.
- `npm run serve` serves the built viewer and the bridge on one port, and its `doctor` and `up` subcommands check the project first.
- `machineroom [FOLDER]` runs `up` on that folder after `npm link`, with `--no-open` to keep the browser closed.
- `npm run pack-check` lists what an npm pack would hold and starts the room from the unpacked folder.
- `npm run scale-live` builds a seeded checkout, starts the bridge on it and times the large-project paths.
- `npm run scale-probe` times the room's stages in memory against the frame budget.
- `npm run screenshots` takes the five room screenshots from a room that `npm run serve` already serves.
- `npm run decide-eval` compares decision models on the probe sets.
- `npm run run-lane` starts one lane on a brief, a project task or a queue, and its `--list`, `--stats`, `--outcomes` and `--stop` read or end runs.
- `npm run hand-run` records a run started by hand.
- `npm run outcome` records what happened to a lane run.
- `npm run merge-lane` prepares a lane merge, runs the checks and can finish it.
- `npm run policy-propose` writes a suggested routing policy change as a patch.
- `npm run history-audit` scans main, the tags and the tracked files for keys, e-mail addresses and home paths.
- `npm run review-lane` reviews a lane branch against main and runs the checks on the merge.
- `npm run worktrees` lists the lane worktrees of a project and can remove the clean, merged ones.
- `npm run bump` sets the version in package.json, package-lock.json and the Version line of this file.
- `npm run candidate` builds one lane's worktree and serves it beside the stable room.
- `node scripts/agy-prompt.mjs V7a` writes AGY's prompt for a brief to a file in its worktree.
- `npm run run-recording` turns a run from the list into a recording again.
- `npm test` runs vitest with no browser.
- `npm run build` builds the viewer and catches a broken import.
- `npm run fixtures` builds a fixture from frames or raw events.

## Code in short

- `src/` mounts the page: `main.jsx`, `App.jsx`, `Stage.jsx`, `startup.js`, `storage.js` and `styles.css`.
- `src/model/` pure logic with no DOM, fully tested: paths, commands, folder plans, parsers, the pipeline, state, the player, costs and the scale tree.
- `src/harnesses/` one browser-safe descriptor per harness.
- `src/engine/` the three.js scene, with no React.
- `src/control/` the control client contract, its real client and its mock.
- `src/policy/` the routing policy, its profiles and its proposals.
- `src/briefs/` brief parsing, the lane prompt, plans, queues, the runner's pure helpers, recordings, reviews, audits and the test retry.
- `src/decider/` the decision model seam and its eval.
- `src/assistant/` the request router.
- `src/ui/` the React HUD, its panels and their helpers.
- `src/live/` live mode: agent discovery, the bridge stream, the live player, the simulated feed and the tree read.
- `server/` the bridge: the routes, the sources, the orchestrators, the git and review routes and the doctor.
- `scripts/` the commands behind `npm run`.
- `bin/` `machine-room`, the one-port command, and `machineroom`, the short linked command.
- `config/` the owner's room defaults: `lanes.json` with only the orchestrator and `policy.json` that routes to the owner. The orchestrator's fleet is in `docs/agents/` and loads only with `MACHINEROOM_LANES_DIR=docs/agents`.
- `public/fixtures/` the recorded run, agent list and file tree.
- `tests/` vitest and its helpers.

## Data flow

1. A source sends frames: the lane source from a `run-lane` log, or the sessions source from a session file. A frame is `{id, companyId, type, createdAt, payload}`.
2. `pipeline.js` turns frames into activities. A live page builds the pipeline's file and folder indexes in an idle callback after the room's first frame (`pipeline.warm`), a shell command or Hermes line that comes first builds them on first use, and `pipeline.learn` gets only the paths a frame touched (P26). `heartbeat.run.log` carries raw agent output in `payload.chunk`; the parser for that agent turns it into tool calls.
3. `state.js` applies each activity to a mutable room state. `player.js` owns the clock and calls `onActivity` for each applied activity and `onReset` after a seek.
4. `room.js` reads the state every frame and reacts to activities with short animations (pulses, flashes, folder opening). Animations run on wall time. State changes run on replay time. The room's own animations take a frame's time capped at 0.1 second, and the player takes the real time since the last frame, capped at 1 second (`frameTimes` in `room.js`, pure, tested), so a replay keeps 1x when frames are slow and a tab that was hidden does not jump (P27).
5. `src/model/sessionRecorder.js` keeps the frames a page receives as a rolling log: nothing until a frame starts a recording, then every frame back at most a set number of minutes (10 by default, 1 to 240). A frame starts it when its type begins `heartbeat.run.` or its payload names a `runId` or an `agentId`; the session readers open a run for each conversation, so a conversation's first frame starts the log. `recorderToReplay` builds the object `prepare` builds, with `createdAt` and `payload.ts` from 0 at the oldest kept frame, and answers null when nothing was kept. `src/App.jsx` keeps one recorder for the page, `src/Stage.jsx` pushes every frame the live source receives into it, and a plain `?replay` with no `recording`, `fixture`, `tour` or `scale` plays `recordedReplay` of it with the agents and tree of the live room (V34). Before the first conversation the room says `Nothing recorded yet. Replay starts with the first conversation.`, and `recordMinutes` sets the window.

## Conventions

- Plain words, short sentences. No em dashes. No single-line explanatory comments.
- Fonts: Jost and Space Mono, weights 400 and 500 only. Never bold.
- Colours: white, `#e5ff00` (active), `#ff2a2a` (failure), `#2aff80` (finished), `#2a9dff` (web) on black. Spacing on an 8px base.
- Commit message: version prefix, then a sentence. Example: `0.1.1: Add the live bridge`.
- Keep large binaries and secrets out of git. Never print a key.

## Open work

The orchestrator is Claude, in Claude Code, in the main checkout. Claude held the role before 0.1.90 and from 0.1.124 to 0.1.162, Hermes from 0.1.90 to 0.1.123, and OpenCode from 0.1.163 until Claude took it back. It works from `docs/agents/ORCHESTRATOR.md`: the standing rules, the review and merge loop, who owns what and the review lessons. See `docs/agents/PLAN.md` for the order of work, and `docs/agents/TASKS.md` for the briefs. The plan for the planner, orchestrator, budgets and routing is in `docs/agents/CONTROL-PLANE.md`. The October audit (`docs/agents/AUDIT-2026-10.md`) lists each security finding, its fix and the 17 it left open at the time. The audit of the room, version 3 (`docs/agents/AUDIT-2026-10-V3.md`, Q3) lists 16 findings from 0.1.177 to 0.1.201; V16 was fixed at its merge, V3 stays by the owner's choice and Q3a to Q3d fixed the rest. The UI audit (`docs/agents/AUDIT-2026-10-UI.md`) does the same for the code that runs in the browser: 10 findings fixed at the time, and the 10 it left open fixed since (U6 to U12, U14 and U19). The delta review (`docs/agents/AUDIT-2026-10-DELTA.md`) reads what changed from 0.1.121 to 0.1.152: 8 findings, all fixed by briefs Q1a to Q1f. The Paperclip-era notes (the source survey, the Paperclip API notes, the control client contract, the backup notes and the plugin page study) are in `docs/agents/history/`. The plan for sub orchestrators, each with a sector of the hub ring, its own lanes and a part of the folders, is in `docs/agents/HIERARCHY.md` (O1 to O8 are merged; the version 7 audit's X1 and X3 are fixed). The plan for pluggable harnesses (one descriptor per harness and a registry, so a later harness is one file and one lanes entry) is in `docs/agents/HARNESSES.md`; H1 to H4 are merged as H5, H6, H7 and H8, and the `acp` harness runs any Agent Client Protocol agent through `scripts/acp-run.mjs`. The V6 audit (`docs/agents/AUDIT-2026-10-V6.md`, R6) lists W1 to W12; W10 was fixed by R3, R4 added the room message of W4, Q6a fixed W1, W5, W6, W7 and the bridge half of W9, and Q6b fixed the rest. The version 7 audit (`docs/agents/AUDIT-2026-10-V7.md`, Q9) reads 0.1.276 to 0.1.307 and lists X1 to X13; Q12a to Q12h, Q13a and Q13b fixed them, and the sector gate stays advisory until each sub has its own token. Reviews 13 and 15 to 18 are closed: their blocking findings are fixed by P102 to P123, and review 16's smaller merge-check finding is P124. Reviews 29 to 31 (`docs/agents/AUDIT-2026-11-REVIEW-29.md`, `AUDIT-2026-11-REVIEW-30.md` and `AUDIT-2026-11-REVIEW-31.md`) are closed: P240 to P244 fixed review 29, P246, P247 and P254 fixed review 30, and P272 to P275 fixed review 31. The docs audit (`docs/agents/AUDIT-2026-11-DOCS-2.md`, P252) found 17 contradicted doc sentences (fixed by P264 and P265), and the test audit (`docs/agents/AUDIT-2026-11-TESTS.md`, P255) found four tests that could pass with their change undone (fixed by P266). Lane failover (P260, P273) lets a lane name `fallback` in `lanes.json` so a failed start or quota, rate-limit or overload failure runs once on the backup lane on a `-on-LANE` branch, and Codex runs record the newest `rate_limits` reading from their session rollout file so `server/lane-costs.js` feeds active windows to `chooseRoute` to skip `codex` above `quotaSkipPercent` (P271). The per-lane conversation view (P249, P250) reads a lane's run or live log from `GET /api/control/runs/conversation` with keys and home paths masked, and opens from a lane's family tree row or Inspector in the lower half with a run picker, folded prompt and tool calls, live reads and Stop.
