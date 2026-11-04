# Full audit, November 2026: what to do next

Date: 2026-11-03. Version 0.1.401. Claude read the five audits below, checked their top claims against the code, and looked at the room in a browser at 1440 by 900. Numbers such as E1 point to a finding in the audit it came from.

- E: `AUDIT-2026-11-ENGINE.md`
- P: `AUDIT-2026-11-UI.md` (the page)
- B: `AUDIT-2026-11-BACKEND.md`
- C: `AUDIT-2026-11-CORE.md`
- D: `AUDIT-2026-11-DESIGN.md`

The docs were fixed in the same pass (Q22): about 34 sentences across seven docs, and `RECORDING.md` rewritten, because it still described the Paperclip recorder.

No finding leaks a key, writes outside the project, or starts a run the owner did not confirm.

## Faults, ranked

Checked means Claude read the code and the fault is there. Reported means a lane read it and Claude has not.

| Rank | Finding | What goes wrong | Size | State |
| --- | --- | --- | --- | --- |
| 1 | B3 | Opening another project stops every running lane with no warning. Only an orchestrator turn is checked first. | Small | Checked |
| 2 | P2 | A `One lane per task` run cannot be stopped. Closing the drawer leaves it starting lanes, and only a page reload ends it. | Small | Checked |
| 3 | P1 | The room's key handler ignores keys already handled, so an arrow key in the Control tabs also jumps the replay 5 seconds. | Small | Checked |
| 4 | B2, B8 | The assistant runs OpenCode without `--standalone`, and a timed out `mr-agent` shell tool leaves its children running. Both leave processes behind. | Small | Checked |
| 5 | E1 | A folder of about 200,000 items overflows the call stack at `items.push(...all)`, and the card never builds. Reproduced in Node, not in a browser. | Small | Checked |
| 6 | E7, E8, C3, B6, B7 | A long live room grows without a bound: touch log, finished subagents, Claude sessions checked every second, and OpenCode's sent keys. | Medium | Checked in part |
| 7 | P7 | The page re-renders 8 times a second even on a paused replay, because each snapshot is a new object. | Small | Checked |
| 8 | B5 | `GET /api/control/reviews` reads and parses all of `runs.jsonl` once per lane, and the cost routes read it on every request. | Small | Checked |
| 9 | C2 | A Claude subagent that makes no tool call stays `working` until its parent's run ends. | Small | Checked |
| 10 | C6 | `npm run review-lane` reads only backticked paths after `Files:`, so a brief without backticks makes every touched file look unlisted. | Small | Checked |
| 11 | P3 | Help, the setup card, the folder picker and the sidebar confirm say they are modal, but do not hold focus, so Tab reaches the page behind them. | Small | Reported |
| 12 | P4 | The event log jumps to the bottom on each new line while the owner is reading above. | Small | Reported |
| 13 | B4 | `search.json`, the active lane file and queue files are written in place, so a crash can leave them empty. | Small | Checked |
| 14 | E2, E3, E5, E6 | Frame cost at scale: a row scan per agent per frame, a full plan for each new file, links rebuilt every frame, and one draw call per folder link. | Medium | Reported |
| 15 | E16, setLabels | A renamed agent keeps its old name on the floating label, and a subagent stays put when its parent moves. | Small | Checked in part |
| 16 | C7, C8, C9, C10, C11 | Small parser faults: a capitalized OpenCode tool name reads as `other`, repeated paths break a base name match, and Copilot sends run events the pipeline also sends. | Small | Checked in part |
| 17 | B1 | `POST /api/orchestrator/stop` takes no token, so a local process can stop a turn. Other sites are already refused and it needs `confirmed`, so this is low, not high. | Small | Checked |

Fixed while auditing: the scrolled menu strip from U111 hid the top of the lower half. The fix is in commit b9fc6de.

## What the lanes got wrong

These are recorded so nobody acts on them.

- B12: `server/mcp.js` has no `fetch(` call of the kind it describes.
- B14: `resolveWorktree` does not exist.
- B's What to delete: all three items are false. The code named is in use, and `server/runs.js` has no Paperclip fields.
- B1 was rated high, and the code it quotes is not in the file.
- C1 is low, not high: the lane source already rewrites worktree paths to the root, so only a session started inside a worktree can reach it.
- C4 is not a fault. One page shows one project, and `extendIndex` rebuilds when the list stops matching.
- C's What to delete: `cardFirst` is called by `Assistant.jsx`. With `CONFIRMED` empty it does nothing, so it can be simplified, not just removed.

## What to delete

Each was named by a lane. Delete, build and check by eye, because a class name built from strings cannot be ruled out by a text search.

- About 130 unused class names in `styles.css`: `.plan-*`, `.dispatch-route-*`, most of `.strip-*`, and the old `.mr-orch-*` and `.mr-side-*` groups.
- `scripts/record-events.mjs`, the old Paperclip recorder. Nothing refers to it.
- In the engine: `rowMark`, `rowNote`, `cards.onPath`, `cards.moving`, `agents.hubCenter`, `followFocus.end` and `cardClickEndsFollow`.
- In the mock: the Paperclip write handlers the bridge refuses (C12, C19), with their tests.

## What the design review found

The room is strongest as a sight and weakest as a place to work. At the default height nothing but the lens is on screen, so the owner cannot tell what needs them without scrolling.

- Nothing above the fold lists the lanes, their tasks, the cost, or what needs the owner. Reviews waiting, proposals waiting and scope violations have no signal at all.
- `WORKING 0 / 2` can show while the orchestrator and a sub are visibly working, because the counter leaves them out.
- A failure fades in seconds. The band lasts 2.6 seconds, the callout 5, and the newest log line replaces it at once. Live mode has no failure count.
- The brightest thing on screen is a finished agent's solid green chip, which outshines the agent working now.
- The waiting card says the chat opens at the bottom right, but at 900 pixels and wider it is below the fold, and `/` focuses it without scrolling there.
- Clutter: the project name four times, an agent's name up to three times, coordinate numbers in the void, and two compass tapes.
- Scrolling to the chat loses the room and the transport. The inspector and the Agent drawer show the same rows in two places, and panels open in four different places.
- With 10 agents, up to 30 boxes pile on the hub and follow mode jumps every 4 seconds. On a large project the biggest folders take the card slots, so `node_modules` is the largest card in the room.

## Features

None of these moves the layout. Listed in the order Claude would build them.

| # | Feature | Smallest version | Size |
| --- | --- | --- | --- |
| 1 | Action badges | Yellow counts on Control and Orchestrator for reviews, proposals and orchestrators waiting. | Small |
| 2 | Failure tray | Unread failures stay in the lens corner with agent, tool and time, until cleared or the lane passes. | Small |
| 3 | Lane pills | One pill per active or failed lane in the transport: name, task, minutes, queue step. | Small |
| 4 | Spend in the transport | Today and this month beside the context ring. | Small |
| 5 | Follow one agent | `F` while an agent is focused follows only that agent's cards. | Small |
| 6 | Bulk folders stay closed | `node_modules`, `dist`, `vendor` and the like stay one closed card until touched, and child cards rank by touches and changes before file count. | Medium |
| 7 | Changes in the inspector | A lane's changed files and diff beside its log, with a link to Reviews. | Medium |
| 8 | Fewer callouts when crowded | Above 4 working agents, full callouts only for the focused, hovered and 2 newest. | Small |

## Design changes that need the owner

Each of these touches something the owner has chosen or asked for, so none goes to a lane without a yes.

| # | Change | Why it is the owner's call |
| --- | --- | --- |
| 1 | One screen: lens about 56 percent, the transport always visible, the lower half always visible. Height rail still reaches 85, and idle still fills the window. | It is the largest change, about 500 lines, and it gives up the full window lens the owner set as default. It answers most of the findings above. |
| 2 | Remove the bottom compass numbers and thin the top ones to `N`, `NE`, `E`. Keep the curve. | The compass tapes were asked for. |
| 3 | Remove the coordinate numbers in the void and the `/PROJECT` label in the lens. | Part of the look. |
| 4 | Fade the Height and Zoom rails until the pointer is near. | The rails were asked for. |
| 5 | One-line chips, and finished chips as a green outline instead of solid green. | Changes how finished work reads at a glance. |
| 6 | One inspector in the right column, in place of the in-lens panel and the Overview card. | The in-lens inspector was asked for. Depends on change 1. |

Plain fixes with no design choice in them, which can simply be done: the waiting card's sentence, `/` scrolling to the chat, and counting orchestrators in the corner counter.

## Proposed briefs

| Lane | Work |
| --- | --- |
| OpenCode | Keys and focus: P1, P3, P4, P5, P6, P8, and P2's Stop button. |
| OpenCode 2 | The page's render rate P7, its polling, and the plain fixes above. Then features 1 to 4. |
| OpenCode 3 | Engine: E1, E2, E5, E7, E8, E9, E10, E15, E16, the label sprite, and the engine deletions. |
| AGY | Bridge: B1 to B10 as corrected above. |
| AGY 2 | Logic: C2, C3, C5 to C11, the mock clean up, `record-events.mjs`, and the review check for fake classes. |
| AGY 3 on Argon | Review the results when they merge. |

The `styles.css` deletion goes last, alone, so it cannot collide with the others.

## Not checked

- The page audit did not reach `Settings.jsx`, `EndpointsPanel.jsx`, `McpSettings.jsx`, `SearchSettings.jsx`, `MusicPlayer.jsx`, `FamilyTeam.jsx`, `Guide.jsx` or `Connect.jsx`, and read `FamilyTree.jsx`, `Inspector.jsx` and `OrchestratorChat.jsx` only in part.
- Settings and Log were not looked at by eye.
- No frame time was measured with 10 real agents. The figures for that case come from reading the code.
- Why the session eviction test timed out once (T32) is still not known.

## Later hunts

Four more lanes then hunted what the first five did not reach: `AUDIT-2026-11-PANELS.md`, `AUDIT-2026-11-ORCHESTRATOR.md`, `AUDIT-2026-11-RUNNER.md` and `AUDIT-2026-11-CONTRACT.md`. Their findings go to briefs U117, S26, S27 and S28.

## Later work

Written on 2026-11-03, when AGY's quota ran out. Pick it up from here when AGY has quota again. The features and design changes above still wait for the owner's yes.

S26, S27, S28 and U117 merged on 2026-11-04. S27 was stopped by a shutdown before it wrote a report, so its rows were read from the diff.

For AGY, on the backend:

- Finding 11 of `AUDIT-2026-11-RUNNER.md` stays open on purpose: the end of a run still looks for leftovers by the worktree's path, because that is what finds an orphaned harness server, so an editor open in a lane worktree can still be stopped.
- Finding 2 of `AUDIT-2026-11-ORCHESTRATOR.md` in part: a run end before the orchestrator has a session or an owner message is still ignored, by design.
- The nine parser findings in `AUDIT-2026-11-LOGS.md`. The first two matter most: an AGY error step never ends and is never marked failed, and a read-only command that quotes a failure word turns its file red.
- `server/assistant.js` starts OpenCode with `execFile`, which has no process group on Linux, so its time limit stops only that process there. `mr-agent` had the same fault and now uses `spawn` with `detached`.
- B7's rest: `server/opencode-sessions.js` still queries every known session once a second, even one that went quiet long ago. S25 only dropped their rows from memory.
- B11 and B13 in `AUDIT-2026-11-BACKEND.md`, which nobody has checked.
- A test for the music stream fix from S25 (`res.on('close')` in `server/music.js`), which has none.

For AGY 3 on Argon: review the merged fixes U114 to U116, S25, Q26, S26 to S28 and U117, with narrow reading and no subagents.

For OpenCode, because AGY lanes may not touch `src/engine` or `src/styles.css`:

- The engine's efficiency findings E3, E4, E6 and E11 to E14.
- The unused class names in `styles.css`, last and alone, checked by eye.

For the orchestrator, at 1440 by 900 in a browser: keys behind the Control drawer, dialog focus, `/` scrolling to the chat, the waiting card, the corner counter, a subagent fading with `?replay&fixture=scenario-e` at 8x, Settings and Log by eye, and the chat when its list read fails.

Finding 5 of `AUDIT-2026-11-CONTRACT.md` is fixed by S28. A key glued straight to a letter, as in `xsk-`, is still not masked, on purpose, so words such as `risk-` stay whole.
