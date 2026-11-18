# Task briefs

Several agents work on MachineRoom at the same time. Each one works on its own branch in its own git worktree, and Claude reviews and merges every branch. The rules every agent follows are in `docs/agents/HOUSE-RULES.md`. Who works where, on which model, and which paths each agent may not touch are in `docs/agents/lanes.json`. The bridge builds the prompt for a task from those two files and the brief below (`GET /api/control/brief-prompt`, task T1a), so nobody has to write or paste prompts by hand.

A brief is one paragraph that starts `**ID. Title (Owner).**`. Keep that shape: the parser reads it.

Older briefs are in `docs/agents/history/TASKS-ARCHIVE.md`.

## Permission modes for the orchestrator chat (2026-11-09)

The owner asked for a mode picker in the orchestrator chat, like Claude Code's and AGY's, offered only where the harness supports it, the native harness included, with the conversation screen showing how open the mode is. Five modes, from the most closed: Plan (read and plan only, no edits and no commands, so no lane starts), Ask (every write or command waits for the owner's Allow), Edits (file edits allowed, no commands), Auto (edits and commands, with the harness's own guard on risky ones), Bypass (everything allowed, today's flags). A mode belongs to one orchestrator, is saved in its chat file and applies from its next turn. Lane runs from `run-lane` keep today's flags. S47 adds the modes and their flags, S48 adds Ask after S47 merges, and U167 builds the page against the shapes below.

**S47. Orchestrator permission modes: the list per harness, the route and the flags (OpenCode).** Read no part of TASKS.md beyond this section and this brief. Use no subagents. Commit each step as you finish it, and stop starting new work at minute 50. Do not edit any file under `docs/`, `src/styles.css`, `src/engine/**`, `src/Stage.jsx` or `src/App.jsx`.

1. A new pure, browser-safe `src/control/modes.js`: `MODES` in order `plan`, `ask`, `edits`, `auto`, `bypass`, each with a label (`Plan`, `Ask`, `Edits`, `Auto`, `Bypass`) and one plain line saying what it allows; `modesFor(harness)`: `claude` all five, `machineroom` all five, `opencode` `plan`, `edits`, `auto`, `agy` `plan`, `edits`, `auto`, `bypass`, and every other harness none; `legacyMode(harness)`: the mode today's flags equal, `bypass` for `claude`, `agy` and `machineroom` and `auto` for `opencode`; and `defaultMode(harness)`: `auto` when listed, else `legacyMode`. Leave `ask` out of every list until S48 merges by exporting `ASK_READY = false` and filtering it while false.
2. `POST /api/orchestrator/mode` in `server/orchestrators.js` takes `{ id, mode, confirmed: true }`, needs a page Origin (403 without), refuses a mode `modesFor` does not list for that orchestrator's harness with 400 and one sentence, answers 409 while a turn runs, saves `mode` in the chat file and answers the orchestrator. `GET /api/orchestrator` and each row of `GET /api/orchestrators` add `mode` (the saved one, else `legacyMode`) and `modes` (`modesFor` of its harness, as `{ id, label, line }`). A chat file made new from now on saves `defaultMode`; one with no `mode` keeps `legacyMode`, so nothing changes until the owner picks. A harness change (`POST /api/orchestrator/harness`) keeps the mode when the new harness lists it and otherwise sets that harness's `defaultMode`. Add `setOrchestratorMode({ id, mode, confirmed })` to `src/control/client.js` and the mock.
3. The turn in `server/orchestrator.js` passes the mode. Claude Code: `plan` is `--permission-mode plan`, `edits` is `--permission-mode acceptEdits`, `auto` is `--permission-mode auto`, `bypass` keeps `--dangerously-skip-permissions`. OpenCode: `plan` adds `--agent plan`, `edits` keeps `--auto` and puts `"permission": { "bash": "deny" }` in the `OPENCODE_CONFIG` file, merged with the MCP servers when both apply, and `auto` is today's `--auto`. Other harnesses get `mode` in the object passed to `descriptor.command`: `src/harnesses/agy.js` passes `--mode plan`, `--mode accept-edits` or `--mode auto` in place of `--dangerously-skip-permissions`, and keeps it for `bypass` or no mode, so a lane run is unchanged; `src/harnesses/machineroom.js` sets `MACHINEROOM_PERMISSION_MODE` in the command's env.
4. `scripts/mr-agent.mjs` reads `MACHINEROOM_PERMISSION_MODE`: `plan` offers only `read_file`, `list_dir`, `search`, `web_search`, `web_fetch` and `mcp_list_tools`; `edits` also offers `write_file` and `edit_file` but not `run_shell` or `mcp_call_tool`; `auto` offers every tool, and `run_shell` refuses, with `Auto mode does not run this command.`, a command that deletes recursively (`rm -r`, `rm -rf`, `Remove-Item -Recurse`, `del /s`, `rmdir /s`), rewrites git history or the remote (`git push`, `git reset --hard`, `git clean`, `git checkout --`, `git branch -D`), formats or shuts down (`format`, `shutdown`, `mkfs`); `bypass` or no value is today's behaviour.

Add a test for each step: the lists and the legacy and default modes; the route's 403, 400, 409 and save, a new chat file's default and an old file's legacy mode, the harness change; the Claude, OpenCode and AGY arguments per mode and a lane run's unchanged AGY arguments; the merged OpenCode config; and mr-agent's offered tools per mode and an Auto refusal. Run `npx vitest related --run` on every file you changed, `npm run build` and `npm run pack-check`; all must pass.

Files: src/control/modes.js, src/control/client.js, src/control/mock.js, server/orchestrators.js, server/orchestrator.js, src/harnesses/agy.js, src/harnesses/machineroom.js, scripts/mr-agent.mjs, tests/.

**S48. Ask mode: the owner's Allow and Deny for each write or command (OpenCode).** Starts after S47 merges. Read no part of TASKS.md beyond this section, the S47 brief and this brief. Use no subagents. Commit each step as you finish it, and stop starting new work at minute 50. Do not edit any file under `docs/`, `src/styles.css`, `src/engine/**`, `src/Stage.jsx` or `src/App.jsx`.

1. The bridge holds approvals per orchestrator. `POST /api/orchestrator/approvals` takes `{ id, tool, input }` only from a no-Origin request with that orchestrator's valid `X-MachineRoom-Orchestrator` token (403 otherwise), adds `{ approvalId, tool, input, at }` to that orchestrator's `approvals` (the input passed through `maskKeys` and cut to 2000 characters), sends an `orchestrator` notice, and keeps the request open until it is answered: `{ allow: true }` or `{ allow: false, message }`. `POST /api/orchestrator/approvals/APPROVALID` takes `{ id, allow, confirmed: true }` from a page (403 without an Origin) and answers it. An approval not answered in 10 minutes, a Stop, a turn that ends and a bridge that stops each answer `{ allow: false, message: 'The owner did not answer.' }`. At most 20 wait per orchestrator; more answer 429. `GET /api/orchestrator` and `GET /api/orchestrators` add `approvals`. Add `answerApproval({ id, approvalId, allow, confirmed })` to `src/control/client.js` and the mock.
2. A new `scripts/mr-approve.mjs`: a stdio MCP server with one tool, `approve`, taking `{ tool_name, input }`; it posts to the route in step 1 with `MACHINEROOM_BRIDGE`, `MACHINEROOM_ORCHESTRATOR_ID` and `MACHINEROOM_ORCHESTRATOR_TOKEN` from its env and answers the text Claude Code's permission prompt tool expects: `{"behavior":"allow","updatedInput":INPUT}` or `{"behavior":"deny","message":MESSAGE}`. Add it to `files` in `package.json` so the pack holds it.
3. A Claude Code turn in `ask` runs with `--permission-mode manual --permission-prompt-tool mcp__machineroom-approve__approve`, and its MCP config file always holds the server `machineroom-approve` (node with `scripts/mr-approve.mjs` and the three env values), merged with the enabled MCP servers; the file is written with mode 0o600 and removed when the turn ends, as now.
4. `scripts/mr-agent.mjs` in `ask` offers every tool, and before `write_file`, `edit_file`, `run_shell` or `mcp_call_tool` it posts to the same route with the same env (the native harness's command passes them when the mode is `ask`); a deny returns that tool call as an error with the message.
5. Set `ASK_READY` to true in `src/control/modes.js`.

Add a test for each step: the route's token and Origin checks, the held answer, the timeout, the Stop and the 429; the MCP server's tool list and both answers against a fake bridge; the Claude arguments and config for `ask`; and mr-agent asking before a write and refusing on a deny. Run `npx vitest related --run` on every file you changed, `npm run build` and `npm run pack-check`; all must pass.

Files: server/orchestrators.js, server/orchestrator.js, scripts/mr-approve.mjs, scripts/mr-agent.mjs, src/harnesses/machineroom.js, src/control/modes.js, src/control/client.js, src/control/mock.js, package.json, tests/.

**U167. The mode picker, the conversation's frame by mode, and the approval cards (OpenCode).** Read no part of TASKS.md beyond this section, the S47 and S48 briefs, whose route and answer shapes you build against, and this brief. S47 and S48 may not be merged when you start: read `mode`, `modes` and `approvals` from the orchestrator answer and call `client.setOrchestratorMode` and `client.answerApproval` only when they exist, and test with a fake client. Use no subagents. Commit each step as you finish it, and stop starting new work at minute 55. Do not edit any file under `docs/`.

1. The chat input row in `src/ui/OrchestratorChat.jsx` gets `Mode: LABEL` beside Model and Effort, listing the orchestrator's `modes` in order, each with its line; it is left out when the list has fewer than two modes or the client has no `setOrchestratorMode`. Picking `bypass` opens a confirm card first, `Let ORCHESTRATOR run any command and edit any file without asking?`, with Cancel first and focused and its confirm in red, through `useDialogFocus`, and Escape closes the card alone; every other pick posts at once with `confirmed: true`. A 409 shows its sentence under the row, and the row says `Applies from the next turn.` for 4 seconds after a change.
2. The conversation column at 900 pixels and wider and the floating chat below it take `is-mode-plan`, `is-mode-ask`, `is-mode-edits`, `is-mode-auto` or `is-mode-bypass` from the open tab's orchestrator: Plan a 1 pixel dashed white frame, Ask a 1 pixel white frame, Edits a 1 pixel `#e5ff00` frame, Auto a 2 pixel `#e5ff00` frame with a soft yellow glow, Bypass a 2 pixel `#ff2a2a` frame with a soft red glow and faint red diagonal bands behind the messages, and the breadcrumb ends with `/ MODE` in the same colour. Nothing moves, and a chat with no `mode` draws no frame.
3. Each waiting approval shows as a card above the input: `ORCHESTRATOR wants to use TOOL`, its input in Space Mono cut to 12 lines with the rest scrolling, and Allow and Deny, which call `client.answerApproval({ id, approvalId, allow, confirmed: true })` and leave the card when the answer is in; the transport's orchestrator state word reads `waiting for you` while one waits.

Keep the fonts, weights and colours of the house rules: no bold, no new colour. Add a test for each step. Run `npx vitest related --run` on every file you changed and `npm run build`; both must pass.

Files: src/ui/OrchestratorChat.jsx, src/ui/orchestratorChat.js, src/ui/Transport.jsx, src/styles.css, tests/.

**Q44. The review of U166, U167, S47 and S48, the permission modes batch (OpenCode).** Read no part of TASKS.md beyond this brief and the U166, S47, S48 and U167 briefs it reviews. Read narrowly: the diffs, then only the functions they touch, and no subagents. Change no code.

Review `git diff 2eb9c4e4^1 2eb9c4e4` (U166), `git diff e1082c3e^1 e1082c3e` (U167), `git diff 93f8e52d^1 93f8e52d` with `git show fdc86e1a` (S47 and its fix at merge) and `git diff e530fe98^1 e530fe98` with `git show 819fe0dd` (S48 and its fix at merge). For each, say whether it does what its brief says and name any new fault with `file:line` and a concrete failing case. Look hard at these: a mode that lets an orchestrator write or run a command it should not (Plan on each harness, Edits on OpenCode and the native agent, an Auto command that slips past `AUTO_FORBIDDEN` by spacing, case, a flag order or another shell); an approval asked for or answered by the wrong orchestrator or with no token; an approval left waiting after Stop, the turn's end, a harness change or a bridge restart; the mode a chat file gets when it is new, when it has no `mode` and after a harness change to one that lists no modes; the MCP config of an Ask turn when MCP servers are also enabled, and whether it is removed; the approval cards and the mode picker on a sub's tab and on the Team tab; and a team apply in U166 whose sub had a lane the owner hid.

Report only what you can name a file, a line and a concrete failing case for, and read each one back against the code first. Saying a merge is sound is a good result. Write `docs/agents/AUDIT-2026-11-REVIEW-8.md`: a table of at most 10 findings, most severe first, then a line per merge saying sound or not, then at most two proposed briefs. Leave ARCHITECTURE and the changelog alone. No full test suite. Commit the file by minute 35.

Files: docs/agents/AUDIT-2026-11-REVIEW-8.md.

**U168. The native agent keeps to its mode at the tool call, and Auto's guard catches more forms (OpenCode).** Read no part of TASKS.md beyond this brief and findings 1 and 2 and the orchestrator's corrections in `docs/agents/AUDIT-2026-11-REVIEW-8.md`. Use no subagents. Commit each step as you finish it, and stop starting new work at minute 35. Do not edit any file under `docs/`.

1. `runTool` in `scripts/mr-agent.mjs` refuses, before it asks for an approval or dispatches, a tool name that `toolsForMode(PERMISSION_MODE)` does not offer, with the error `The NAME tool is not allowed in MODE mode.`, so a Plan run never writes and an Edits run never runs a command or an MCP tool, whatever the model asks for.
2. `AUTO_FORBIDDEN` also refuses: `rm` with an `r` in any flag group of the same command (`rm -f -r build`, `rm -fR x`); `rd` and `erase` beside `rmdir` and `del`; a git command whose own options sit before or among its words (`git -C . push`, `git reset HEAD --hard`, `GIT branch -D old`), by matching `git` and then the word within the same command, case insensitive; and `shutdown`, `format` and `mkfs` after a quote or a `-c`, `/c` or `/k` as well as at the start of a command. Refusing a harmless command now and then is fine; missing a listed one is not.
3. Rename the test at `tests/approvals.test.js:211` so it says four minutes, not ten.

Add a test for step 1 with a fake endpoint that names `write_file` in Plan and `run_shell` in Edits and checks the file is not written and the command does not run, and one test per case in step 2, plus two plain commands (`git log --oneline`, `rm notes.txt`) that still run. Run `npx vitest related --run` on every file you changed and `npm run build`; both must pass.

Files: scripts/mr-agent.mjs, tests/mr-agent.test.js, tests/approvals.test.js.

**U169. A sub orchestrator's waiting approval shows in the transport (OpenCode).** Read no part of TASKS.md beyond this brief and finding 3 and the orchestrator's corrections in `docs/agents/AUDIT-2026-11-REVIEW-8.md`. Use no subagents. Commit each step as you finish it, and stop starting new work at minute 25. Do not edit any file under `docs/`.

1. In `src/ui/Transport.jsx` the orchestrator state word reads `waiting for you` when the main or any sub in the orchestrators list has a non-empty `approvals` list.
2. `orchestratorChips` in `src/ui/transportOrchestrators.js` marks a sub with a waiting approval with `waiting: true`, and its chip's title ends with `, waiting for you`. Keep its dot and colours as they are. A click opens that sub's tab as now.

Add a test for each step: the main idle and a sub holding an approval reads `waiting for you`, and that sub's chip carries `waiting` and the title. Run `npx vitest related --run` on every file you changed and `npm run build`; both must pass.

Files: src/ui/Transport.jsx, src/ui/transportOrchestrators.js, tests/.

## Large repos and a lighter room (2026-11-10, the owner's request)

The owner asked whether the room is ready for large repos, and asked for lanes on ways to make it lighter: less memory, and no long stalls at start or while agents work, even on heavy folders at the lowest folder depth. P19 measures what was never measured. P20 to P23 are hunts: they change no code, measure what they can, and write findings with proposed briefs for the owner to choose from. Other lanes measure at the same time, so time each number three times and give the median.

**P19. Time worktrees, git checks, the doctor read and a plain folder on a big checkout, and run at 500,000 files (OpenCode).** Read no part of TASKS.md beyond this section. Use no subagents. Commit each step as you finish it, and stop starting new work at minute 70. Do not edit any file under `docs/`, `server/` or `src/`: this brief measures and reports, and fixes come in later briefs.

1. Add these rows to `runScaleLive` in `scripts/scale-live.mjs`, in the format of the rows it has, with each budget in `LIVE_BUDGET`, and print each row as soon as it is measured as well as the table at the end:
   - `doctor project read`: `readProjectLine(dir)` from `server/doctor.js`, its time and its line (10000 ms, its own `PROJECT_READ_LIMIT_MS`).
   - `GET /api/git, clean`: on the clean checkout (2000 ms).
   - `GET /api/git, 2000 untracked`: after the `out/` burst and before that folder is cleaned (2000 ms).
   - `GET /api/git, 1000 tracked files changed`: append a line to 1000 tracked files, read, then put them back with `git checkout -- PATHS` in the scale checkout (2000 ms). Wait more than 1.1 seconds between two `/api/git` reads, since `readGitState` keeps an answer for a second.
   - `worktree add`: `prepareWorktree(dir, 'opencode')` from `scripts/run-lane.mjs`, its time and the summed size of the files it wrote (30000 ms).
   - `worktree reuse`: a second `prepareWorktree(dir, 'opencode')` on the clean worktree (5000 ms).
   - `GET /api/control/reviews, one lane ahead`: after a branch in that worktree with one commit that changes one file (5000 ms), then `GET /api/control/reviews/opencode/diff` (5000 ms).
   - `plain folder read`: after the bridge has stopped, `readTree(dir)` from `server/index.js` with the checkout's `.git` renamed away for the read and put back in a `finally`. The walk is synchronous, so its time is how long a bridge on that folder blocks (1000 ms).
   At the end remove that worktree and its branch in the scale checkout, and only there.
2. Take `--files 500000 --folders 50000` and print the free space on the drive before the build. Run `npm run scale-live` at 40,000, 200,000 and 500,000 files, in that order, each with `--folders` a tenth of `--files` and `--seed 19`, so no other lane's checkout is touched. Give every row of all three in your report. If the 500,000 run cannot finish by minute 85, stop it and report the rows it printed and how far the build got.
3. Extend `tests/scale-live.test.js` at 2000 files: every new row is there, `.git` is back after the plain read, and the worktree and its branch are gone at the end. Run `npx vitest related --run` on every file you changed, `npm run build` and `npm run pack-check`; all must pass.

Files: scripts/scale-live.mjs, tests/scale-live.test.js.

**P20. Hunt what the bridge holds and does on a big project, at start and at rest (OpenCode).** Read no part of TASKS.md beyond this section, and of `docs/agents/AUDIT-2026-11-GROWTH.md` and `docs/agents/AUDIT-2026-11-FRAME.md` only their finding tables, so you do not report a finding again unless you find it still open, and then say so. Use no subagents. Change no code.

Build a checkout with `npm run scale-live -- --files 200000 --folders 20000 --seed 20 --keep` (seed 20 is yours; remove the folder at the end), and start a bridge on it in a child process as `scripts/scale-live.mjs` does, with the lane and session sources on. Measure the bridge's RSS and `v8.getHeapStatistics().used_heap_size`: after it starts, after the first `GET /api/tree`, with three pages on `/events?tree=folders`, after a burst of 2000 new files, and after 10 minutes at rest. Measure its CPU share over 60 seconds at rest. Name the five largest holders of memory, from a heap snapshot or by measuring each structure, and the work the bridge repeats at rest: the session reader ticks, the OpenCode database query, the lane log watch, the network check, the git state reads and the reads the page's polls cause. Read the start path from `machineroom up` to the first answer of `GET /api/tree`, and say how many times the whole project is read and listed before a page draws. Write `docs/agents/AUDIT-2026-11-LIGHT-BRIDGE.md`: a table of at most 12 findings, most costly first, each with `file:line`, what it costs with a measured number where one can be measured, and the smallest fix; then at most three proposed briefs. Commit the file by minute 55.

Files: docs/agents/AUDIT-2026-11-LIGHT-BRIDGE.md.

**P21. Hunt the page's start and memory on a big project (OpenCode).** Read no part of TASKS.md beyond this section, and of `docs/agents/AUDIT-2026-11-GROWTH.md` only its finding table, so you do not report a finding again unless you find it still open, and then say so. Use no subagents. Change no code.

Follow a project's file list from the bridge's answer to the first drawn room: `readFileList` in `src/live/tree.js`, the tree in `src/model/paths.js`, the state in `src/model/state.js`, the index in `src/model/fileIndex.js`, `planFolderView`, `layoutRing`, the cards, and the session recorder's kept frames. In Node, on the trees `makeScaleTree` gives at 40,000 and 200,000 files, time each stage cold and measure `process.memoryUsage().heapUsed` after each, with `--expose-gc` and a collection before each reading, as `scripts/scale-probe.mjs` sets its stages up. Count how many copies of the path list the page keeps, and what a stage builds that the first drawn room does not need yet. Write `docs/agents/AUDIT-2026-11-LIGHT-START.md`: a table of at most 12 findings, most costly first, each with `file:line`, its time or bytes and the smallest fix; then at most three proposed briefs, such as drawing the root and top-level cards before the rest is built. Commit the file by minute 55.

Files: docs/agents/AUDIT-2026-11-LIGHT-START.md.

**P22. Hunt heavy folders at the lowest folder depth, at start and while an agent works in them (OpenCode).** Read no part of TASKS.md beyond this section. Use no subagents. Change no code.

Take the tree `makeScaleTree` gives at 40,000 files and add one top-level folder that holds 50,000 files directly and one that holds 5,000 folders directly. With the folder depth at 1 and at 0 (`alwaysDepth`), time in Node: `planFolderView` cold and after one touch inside each heavy folder, the card's rows (`cardRows`, `rowWindow` and the item list `viewInput` builds in `src/engine/cards.js`), a write that adds one file to the heavy folder, a shell command that names it (`touchesForCommand`), and a Hermes read of a file in it. Read `src/engine/cards.js` and say what a card with 50,000 items builds in memory and in the DOM on its first draw and on each touch, and what is sorted or copied per touch. Say what a heavy folder that `isBulkFolder` does not name costs (`assets`, `.venv`, `Library`, `.gradle`, `Pods`, `.cache`, `.idea`), and whether a folder above some item count should stay closed like a bulk folder, with the count you measured it at. Write `docs/agents/AUDIT-2026-11-LIGHT-FOLDERS.md`: a table of at most 12 findings, most costly first, each with `file:line`, its time or bytes and the smallest fix; then at most three proposed briefs. Commit the file by minute 55.

Files: docs/agents/AUDIT-2026-11-LIGHT-FOLDERS.md.

**P23. Hunt the room's cost in a real browser: script, style, layout, heap and DOM, at load, at rest and at work (OpenCode).** Read no part of TASKS.md beyond this section, and of `docs/agents/AUDIT-2026-11-FRAME.md` only its finding table, so you do not report a finding again unless you find it still open, and then say so. Use no subagents. Change no code.

Run `npm run build`, then serve the built room from your worktree with `npm run serve -- --port 5185 --no-open`, and stop that server and the browser at the end. Drive the headless Chromium that `scripts/screenshots.mjs` finds and starts, at 1280 by 800, through the DevTools protocol. At `?replay&scale=40000` and `?replay&scale=200000`, read `Performance.getMetrics` (`ScriptDuration`, `RecalcStyleDuration`, `LayoutDuration`, `JSHeapUsedSize`, `Nodes`) and count long tasks over 50 ms: from navigation to the first drawn room, over 60 seconds paused, and over 60 seconds of replay at 1x. The browser renders on the CPU through SwiftShader, so give the script, style and layout time per second and the heap and node counts, which do not depend on the GPU, not the frame rate. Read the frame loop in `src/engine/room.js` and name what runs each frame while nothing changes: the CSS3D transforms of every card, chip and callout, the dust, the lattice, the compass, the strands and anything else, with the cost of each you can separate by turning it off in Settings or by a query parameter. Say whether the room could draw less often while nothing moves, and what that would cost the dust and the drift. Write `docs/agents/AUDIT-2026-11-LIGHT-BROWSER.md`: a table of at most 12 findings, most costly first, each with `file:line`, its measured cost and the smallest fix; then at most three proposed briefs. Commit the file by minute 45.

A first run of P23 was stopped at the owner's request while a game ran. Its probe is at `%TEMP%\opencode\p23\probe-first-run.mjs`; copy it into your worktree as an untracked file if it helps, and delete it before you commit. Measure again rather than reuse its load numbers, which were taken under that game. Run each 60 second window once at each size, not three times, so the run ends in time.

Files: docs/agents/AUDIT-2026-11-LIGHT-BROWSER.md.

## The first fixes for large repos, and how lanes are given work (2026-11-10, the owner's request)

The owner read the five hunts and said to apply the fixes that work best, and to check whether lanes can be given work better, by the orchestrator and by the room. P24 to P27 are the fixes with the largest measured cost and the least risk, one set of files each, so four lanes run side by side. P28 is a hunt and changes no code. Other lanes run at the same time, so a measured time is high: give the number before and after from the same run of the same tool.

**P24. A folder's plan costs the same at any size: key it by version and cap its items at 2,000 (OpenCode).** Read no part of TASKS.md beyond this section, and of `docs/agents/AUDIT-2026-11-LIGHT-FOLDERS.md` findings 3 to 10 and the orchestrator's corrections. Use no subagents. Commit each step as you finish it, and stop starting new work at minute 50. Do not edit any file under `docs/`, `server/`, `src/ui/` or `src/Stage.jsx`.

1. `folderKey` in `src/model/folderView.js` no longer walks every child and file of the folder. Build the key from the option key, the folder's `folderVersion`, its pinned mark, and only the paths that can change its view: the drawn children of that folder and the focused and touched paths inside it, each with its rank, found from the small sets (`drawn`, `focusSet`, `touchedSet`, `focusFolders`, `touchedFolders`) and not by a loop over the folder's content. Check that `folderVersion` changes whenever the folder's files or child folders change, and make it so where it does not. The plan must return the same views as before: run `npm run scale-probe -- --replay` before and after this step and say in the report that the two digests are equal, or give their diff.
2. Add and export `MAX_FOLDER_ITEMS`, 2000. A folder with more items than that gets a view of the focused and touched items first, then the rest in the order they have now up to the cap, and `hiddenItems` counts what is left out, with `limitItems` false too and for a bulk folder too. A focused or touched item is never left out. Do not sort the whole list to cut it: take the ranked few first and merge the lists that are already in order. Check that the card shows its `+ N more` row for such a folder, and make it so in `src/engine/cards.js` where it does not.
3. In `paintRows` in `src/engine/cards.js` (near line 739), a view whose items array is the one the card already holds is not mapped and joined into a key again, and `rowIndex` is built at its first lookup, not on every change.
4. Add a stage to `scripts/scale-probe.mjs`: the seeded tree plus one top-level folder that holds 50,000 files, then the plan after one touch inside it and after one touch elsewhere in the room, each against a 5 ms budget. Give the two rows before step 1 and after step 3.

Add tests: a touch inside a 50,000 file folder gives a view of 2,000 items with the touched path first and the right `hiddenItems`; a second plan with the same focus returns the same view object; a file added to a folder changes that folder's view and no other; a card with the fake element of `tests/cards-virtual.test.js` draws the same rows before and after step 3. Run `npx vitest related --run` on every file you changed and `npm run build`; both must pass.

Files: src/model/folderView.js, src/engine/cards.js, scripts/scale-probe.mjs, tests/.

**P25. The bridge lists the project once and keeps its answer ready (OpenCode).** Read no part of TASKS.md beyond this section, and of `docs/agents/AUDIT-2026-11-LIGHT-BRIDGE.md` findings 1, 3, 5 and 7 and the orchestrator's corrections. Use no subagents. Commit each step as you finish it, and stop starting new work at minute 55. Do not edit any file under `docs/` or `src/`.

1. Keep the packed folder body of `GET /api/tree`, its JSON bytes and its gzip bytes for the current `treeVersion`: build them at the first ask for that version and reuse them until the version changes. The gzip stays asynchronous, and two asks that arrive together share one build.
2. A folder-shaped `GET /api/tree` answers from `lastTree` at any age, since its answer carries `version` and the page's stream sends what was added after it. It starts a read only when there is no `lastTree` yet, and when a read is already in flight it waits for that one and starts no other. The plain shape keeps the rule it has.
3. `createBridge` takes an optional `initialTree`, the result of `readTree`, and uses it as its first tree with no read of its own. The doctor hands back the tree it read, and `bin/machine-room.mjs` passes it on, so `up` lists the project once before a page draws. Without an initial tree the bridge listens before its first read ends: `GET /api/health` and the built viewer answer at once, and `GET /api/tree` waits for the read in flight.
4. A page that opens `/events` with a `since` equal to the current version gets no tree event, and no Set of every path is built for it.
5. Keep one full file list, not four. For each of the last 4 versions keep only the paths added at that version, and build a late page's first tree event from those; a `since` older than the kept versions gets the whole list as now, and a page's own record of what it was sent holds no full copy either. If this step cannot be finished by minute 45, leave it out and say so.

Add a test for each step: a second folder ask makes no new pack and no new read (count them through a seam, not by time); `up` with a doctor tree calls the project reader once; a bridge with a slow reader answers `/api/health` before the read ends; a page at the current version gets no tree event; a page two versions behind gets exactly the files added since; a page with a version the bridge no longer keeps gets the whole list. Add two rows to `scripts/scale-live.mjs`: `second GET /api/tree, folder shape, gzip` (100 ms) and `bridge used heap after the bursts` (info), and run `npm run scale-live -- --files 200000 --folders 20000 --seed 25` once before step 1 and once at the end; give every row of both in the report. Run `npx vitest related --run` on every file you changed, `npm run build` and `npm run pack-check`; all must pass.

Files: server/index.js, server/doctor.js, bin/machine-room.mjs, scripts/scale-live.mjs, tests/.

**P26. Find and cut what the page does on each touch at 200,000 files (OpenCode).** Read no part of TASKS.md beyond this section, the orchestrator's corrections in `docs/agents/AUDIT-2026-11-LIGHT-BROWSER.md`, and rows 3, 7, 8 and 10 with the orchestrator's corrections in `docs/agents/AUDIT-2026-11-LIGHT-START.md`. Use no subagents. Commit each step as you finish it, and stop starting new work at minute 60. Do not edit any file under `docs/`, `server/` or `src/engine/`, nor `src/model/folderView.js`, which other lanes hold.

In Brave with a hardware GPU the room at `?replay&scale=200000` draws a frame in 12 ms paused and in 206 ms at play, against 36 ms at `?replay&scale=1000` at play. Over 6 seconds of play the long frames held 1.05 s of the room's `frame`, 0.86 s of React work and 0.73 s of style and layout. Nobody has yet named the component that renders on each activity or the part that grows with the file count.

1. Measure first. Run `npm run build` and `npm run serve -- --port 5186 --no-open` from your worktree, and drive the headless Chromium that `scripts/screenshots.mjs` finds, at 1280 by 800, through the DevTools protocol. Take a 20 second CPU profile (`Profiler.start` and `Profiler.stop`) at play at `?replay&scale=200000` and at `?replay&scale=1000`, and list the 15 functions of this repository's code and of React with the most self time and the most total time in each, leaving out the WebGL and shader calls, which the software renderer inflates. Say in the report which component renders on each activity, how often, and which functions cost more at 200,000 files than at 1,000. Take at most 6 profiles of 20 seconds, since the software renderer keeps a core busy, and stop the server and the browser at the end.
2. Fix the two largest costs that grow with the file count, in the files this brief lists, and give their profile rows before and after. When a cost sits in a file another lane holds, do not edit it: name it with `file:line` and its measured time.
3. At `src/Stage.jsx:1218`, `pipeline.learn` gets only the paths that are new since its last call, never a spread of every key.
4. `assistantPaths` is built when the assistant first needs it, not on every new file, and `knownSoundRef` holds only the created paths, with the room state answering for the rest.
5. `createPipeline` no longer builds its two indexes before the first frame. Stage warms both in an idle callback after the room's first frame (`requestIdleCallback`, or a timer where it is missing), and a shell command or a Hermes line that arrives first still gets the right answer, since `indexFor` builds on first use. Keep both indexes: a listing command reads the folder one. The folder check at `src/model/parsers/common.js:45` reads a Set, not `ctx.dirs.includes`.

Add a test for steps 3 to 5: `learn` is called with only the new paths; a Hermes line and an `ls` command resolve a known file and folder through a pipeline whose indexes were not warmed; a path is known to the sound check without a copy of every file. Run `npx vitest related --run` on every file you changed and `npm run build`; both must pass.

Files: src/Stage.jsx, src/ui/, src/model/pipeline.js, src/model/player.js, src/model/log.js, src/model/parsers/common.js, tests/.

**P27. A slow frame no longer loses replay time, and hidden dust does no work (OpenCode).** Read no part of TASKS.md beyond this section, and of `docs/agents/AUDIT-2026-11-LIGHT-BROWSER.md` findings 4 and 6 and the orchestrator's corrections. Use no subagents. Commit each step as you finish it, and stop starting new work at minute 30. Do not edit any file under `docs/`, `server/`, `src/ui/` or `src/model/`, nor `src/Stage.jsx` and `src/engine/cards.js`, which other lanes hold.

1. In `frame` in `src/engine/room.js` (near line 1031) the room's own animations keep their delta capped at 0.1 second, and `beforeFrame` gets the real time since the last frame, capped at 1 second so a tab that was hidden does not jump. Stage passes that time to `player.tick`, so a replay keeps 1x when frames are slow.
2. In `src/engine/void.js` a dust layer that is not drawn (its material hidden, or its draw count 0) is left out of the drift walk and uploads nothing, and the colour buffer is written and uploaded only while Pulse is on, and once when it turns off. Turning a layer on again shows its specks where their drift puts them at that time, with no jump back.

Add a test for each: a frame 250 ms after the last gives `beforeFrame` 250 and the room's animations 100; a frame 5 seconds after gives 1000; a hidden dust layer writes no position and no colour over 10 updates, counted through the buffers' `needsUpdate` or a seam; Pulse off writes no colour after its first update. Run `npx vitest related --run` on every file you changed and `npm run build`; both must pass.

Files: src/engine/room.js, src/engine/void.js, tests/.

**P28. Hunt how lanes are given work: the orchestrator's method and the room's own (OpenCode).** Read no part of TASKS.md beyond this section. Use no subagents. Change no code.

Read the run and outcome records in the runs folder (`MACHINEROOM_RUNS`, else `%TEMP%\machineroom-runs`): `runs.jsonl` and `outcomes.jsonl`, from 2026-10-28 on. Read `docs/agents/lanes.json`, `docs/agents/policy.json`, the review and merge loop in `docs/agents/ORCHESTRATOR.md`, `src/policy/`, `server/policy.js`, `server/outcomes.js`, `scripts/policy-propose.mjs`, `planLaneTasks` and the Dispatch panel under `src/ui/panels/`, and `server/active-lanes.js`. Measure, with a short script you delete at the end:

- Per lane and model: runs, the median and the 90th percentile of minutes, killed, failed, `startFailed` and `retried`. The same per kind of brief, from the letter of the brief id (H, P, Q, S, T, U and the rest), and per hunt or review against build briefs where the title says so.
- The wait: for each lane, the time from a run's end to that lane's next start on the same day. This is how long a finished lane waits for its review, its merge and its next brief. Give the median and the 90th percentile per lane, and the share of each working day a lane was running.
- The overlap: how many lanes ran at the same moment, as a table of minutes at 1, 2, 3, 4 and 5 or more lanes, and whether runs that started or ended failed, were killed or ran long more often at a higher overlap.
- The time limit: each run's minutes against the `stop starting new work at minute N` of its brief, where the brief says one.
- The outcome table: `npm run run-lane -- --outcomes --since 2026-10-28` shows most runs as pending (for the lane `opencode`, 48 runs, 13 merged and 35 pending) though nearly every branch was merged and recorded. Find why with `file:line`: the join, the branch names, a second run on one branch, or records never written.
- Grades and fixes at merge per lane and model from `outcomes.jsonl`.
- AGY on Flash, AGY on Argon and OpenCode on DeepSeek side by side for the same kinds of brief: minutes, kills, grades, fixes at merge, and the cost each reports.
- Tokens: the input and output tokens of a run against its minutes, and the runs that came near 500,000.
- The room's own routing: what `chooseRoute` and `policy.json` decide today and who calls them, what `npm run policy-propose -- --since 2026-10-28` prints, how Dispatch's `planLaneTasks` picks a lane, and what it would take for Dispatch and the orchestrator's `POST /api/control/runs` to pick a lane from the policy and the outcomes instead of the picker order.

Write `docs/agents/AUDIT-2026-11-LANES.md`: the tables, then at most 12 findings, each with its number and `file:line` where code is the cause, then two lists of recommendations, one for the orchestrator's method (how many lanes at once, which briefs to join into one run, which kind of brief to which harness and model, when a measuring brief must run alone) and one for the room (routing, Dispatch, the outcome table), then at most 4 proposed briefs. Never write a user path, a profile name, an e-mail address or a key: write the runs folder as `%TEMP%\machineroom-runs`. Commit the file by minute 45.

Files: docs/agents/AUDIT-2026-11-LANES.md.

**P29. The outcome table reads a merge it has no row for, and the policy joins are honest (OpenCode).** Read no part of TASKS.md beyond this brief, and of `docs/agents/AUDIT-2026-11-LANES.md` findings 1, 2, 3 and 7 and the orchestrator's corrections. Use no subagents. Commit each step as you finish it, and stop starting new work at minute 40. Do not edit any file under `docs/` or `src/ui/`, nor `server/index.js` and `src/Stage.jsx`, which other lanes hold.

1. `outcomeTable` in `server/outcomes.js` takes the subjects of the commits on `refs/heads/main` as an argument and stays pure. A run whose branch has no outcome row, but whose brief id stands as a whole word after `Merge` in one of those subjects (`0.1.401: Merge P21, the hunt` and the older `0.1.180: Merge OpenCode's bridge test (P15)` both count), is merged and not graded: it adds to the merge count and the merge rate and to a new `ungraded` count on its row, and takes no part in the mean of the fixes. `pending` is left for a run with no row and no such subject. A merged or rejected row always wins over a subject. The callers, `npm run run-lane -- --outcomes`, `GET /api/control/runs/outcomes` and `npm run policy-propose`, read the subjects once per call through `gitPath()` with a time limit, and pass an empty list when git fails. The printed table says `merged N (M not graded)`.
2. An older run on a branch that has a decision adds no cost to the decided cost, so a second run does not raise the cost of a merge.
3. A row whose runs report no cost has a cost per merge of null, printed as `not reported`, and `proposePolicy` treats it as not known, never as cheaper.
4. A policy choice joins a run row when the lane is equal and the two model names are equal once each is cut to its lower case letters and digits, so `Gemini 3.8 Flash (High)` joins `gemini-3.8-flash-high`. `npm run policy-propose` prints, for each choice, the row it joined and its decided runs.

Add a test for each step: a run with a merge subject and no row; a run with neither; a rejected row that wins over a subject; a brief id that is only part of another id in a subject (`P2` against `Merge P21`) is not merged; two runs on one branch; a row with no cost against one with a cost; the two model names. Run `npx vitest related --run` on every file you changed and `npm run build`; both must pass. Then run `npm run run-lane -- --outcomes --since 2026-10-28` and `npm run policy-propose -- --since 2026-10-28` for real and give their output in the report.

Files: server/outcomes.js, server/runs.js, src/briefs/run.js, scripts/run-lane.mjs, src/policy/proposals.js, scripts/policy-propose.mjs, tests/.

**P30. The idle bridge does less: list the runs folder on a change, and ask the session stores only for what is new (OpenCode).** Read no part of TASKS.md beyond this brief, and of `docs/agents/AUDIT-2026-11-LIGHT-BRIDGE.md` findings 4, 8 and 9 and the orchestrator's corrections. Use no subagents. Commit each step as you finish it, and stop starting new work at minute 45. Do not edit any file under `docs/` or `src/`, nor `server/index.js`, `server/runs.js` and `server/outcomes.js`, which other lanes hold.

With 584 logs in the runs folder the lane source's tick costs 5 ms, five times a second, while nothing runs. What the owner sees must not change: a new run still shows at once, and an open run's lines still arrive as fast as now.

1. In `server/lanes-source.js` the tick still reads the growth of every open log each `pollMs`. The listing of the runs folder for new logs runs when the folder's watcher reports a change, and on a timer of 2 seconds as the fallback, not on every tick. A new log is seen within 2 seconds even when the watcher is silent or cannot be armed.
2. The parsed lanes (`readAllLanes` and the agents built from them) are reused while the files they come from keep their size and change time, not parsed again on every tick.
3. In `server/opencode-sessions.js` a tick with nothing new reads no session rows: keep the highest update time seen and ask `session_v2` only for rows past it, by column as now. Check the column first, and when the table has none, leave the query as it is and say so. While no run is open the reader asks every 5 seconds, and every second while one is open.
4. In `server/claude-sessions.js` the `.meta.json` files of the runs folder are listed again only when that folder's own change time moved, so a tick with no new file lists nothing; a new meta file is still seen on the next tick.

Add a test for each step, counting calls through a seam and not by time: 100 ticks on a quiet folder list it at most once without a watcher event and once more after one; a log made with no watcher event shows within the fallback; an open log's new line arrives on the next tick; the lanes are parsed once across 100 ticks and again after the file changes; a quiet OpenCode store answers no rows on the second tick and a moved session is read; a new meta file is skipped by the session reader on the next tick. Then measure for real, with a temp runs folder that holds 500 old logs and 30 meta files: the median time of the lane source's tick and of the sessions tick over 200 ticks, before step 1 and at the end, and give both in the report. Run `npx vitest related --run` on every file you changed and `npm run build`; both must pass.

Files: server/lanes-source.js, server/claude-sessions.js, server/opencode-sessions.js, server/sessions-source.js, tests/.

## A lane picked by the policy, a run's peak context and a lighter workflow (2026-11-10, the owner's request)

The owner said yes to five changes: the room picks a lane from the routing policy, a run records its peak context, a helper does the mechanical part of a merge, `ARCHITECTURE.md` gets a short core, and merged briefs leave `TASKS.md`. On the same day the owner gave `agy` and `agy2` work again, on Gemini 3.8 Flash; `agy3` still gets none. P32 and P33 start at once on the AGY lanes. P31 starts after P26 and P29 merge, P35 on the next free OpenCode lane, and P34 last, when no other merge waits, since every merge adds a line to `ARCHITECTURE.md`.

**P31. The room picks a lane from the routing policy (OpenCode).** Read no part of TASKS.md beyond this brief, and of `docs/agents/AUDIT-2026-11-LANES.md` the section `The room's own routing`, findings 4, 5 and 6 and the orchestrator's corrections. Use no subagents. Commit each step as you finish it, and stop starting new work at minute 55. Do not edit any file under `docs/` but `docs/agents/policy.json`, nor `src/Stage.jsx`, `src/engine/` and `server/index.js`.

1. Add the pure `routeLane` to `src/policy/route.js`. It takes what `chooseRoute` takes and a list of lanes, each `{ key, eligible, active, busy }`. It walks the choices of the profile's tier in order, with the escalation, the quota skip and the spend limit `chooseRoute` has, and skips a choice whose lane is not in the list, not eligible, not active or busy, with a reason for each. When no choice of the tier is left it takes the first lane of the list that is eligible, active and not busy, with the reason `No lane of the TIER tier is free, so the first free lane was taken.` When none is free it answers no lane and `Every lane is busy or turned off.` It answers `{ lane, model, reasoning, tier, reason, skipped: [{ lane, why }] }`.
2. `POST /api/control/route/lane` takes `{ brief, task, failures }`, with a brief id or a task's text, and answers what `routeLane` answers. The profile comes from `profileFromBrief` for a brief and from the task's text by the same rules for a task. The lanes and their states come from the checks `POST /api/control/runs` already makes. It has the origin rules of the route beside it. Add `client.routeLane` and the same in the mock.
3. `POST /api/control/runs` with no `lane`, or with `lane: "auto"`, routes first and starts the run on the lane it gets; with no free lane it answers 409 and the reason. Its answer names the `lane` and adds `routed: { tier, reason }`. A named lane works as now. A sub orchestrator's token routes only among that sub's own lanes.
4. In Dispatch the lane picker gets `Auto` as its first choice, chosen at first when the client has `routeLane`. It asks the route 400 ms after the task text last changed and shows `Auto: LANE. REASON` under the picker. The confirm card names the lane as now and adds `Picked by the routing policy: REASON`. With `One lane per task`, `planLaneTasks` takes the idle lanes in the route's order for each task, not the roster's. A bridge without the method shows no `Auto`.
5. Bring `docs/agents/policy.json` in line with the lanes: small goes to `opencode2`, then `opencode3`, then `agy`; medium to `opencode`, then `opencode4`, then `agy2`; large to `opencode5`, then `opencode`, then the owner. Each model is the `cli.model` of that lane in `docs/agents/lanes.json`. Keep the file's shape, its quota skip and its limits.

Add a test for each step: the skip order and each reason; the fall to the first free lane; no free lane; the route for a brief and for a task; a run started with no lane, with `auto` and with a named lane; a sub's token; the Dispatch plan in the route's order; a client without the method. Run `npx vitest related --run` on every file you changed and `npm run build`; both must pass. The orchestrator checks Dispatch by eye at 1280 by 800: the `Auto` choice, its line under the picker and the confirm card.

Files: src/policy/route.js, server/policy.js, server/runs.js, src/control/client.js, src/control/mock.js, src/ui/panels/runs.js, src/ui/panels/DispatchPanel.jsx, docs/agents/policy.json, tests/.

**P32. A run records its peak context (AGY 2).** Read no part of TASKS.md beyond this brief, and of `docs/agents/AUDIT-2026-11-LANES.md` the section `Tokens` and finding 9. Use no subagents. Commit each step as you finish it, and stop starting new work at minute 40. Do not edit any file under `docs/`, `server/`, `src/ui/` or `src/policy/`.

A run's `inputTokens` is the sum over every step, 62 million for one run of 25 minutes, so nobody can see how near a run came to the 500,000 token compact rule, which is about one request.

1. The OpenCode harness summary also answers `peakTokens`: the largest input plus cache read plus cache write of any one `step_finish`. The Claude harness answers the largest `input_tokens` plus both cache counts of any one top-level assistant message. A log with no usage answers null, and so does every other harness.
2. `summarizeRun` returns it, `runRecord` writes `peakTokens` the way it writes `inputTokens`, and `scripts/run-lane.mjs` passes it at each place it passes `inputTokens`. A record without the field reads as before.
3. A `--list` line shows `peak N` when the record has one. `--stats` adds, per lane and model, `peak median N, max N` and how many runs peaked at or over 450,000.

Another lane is changing how the outcome table is built and printed (`formatOutcomes` in `src/briefs/run.js` and the `--outcomes` path of `scripts/run-lane.mjs`). Change nothing in or beside that code.

Add a test for each step: an OpenCode log with two steps of different sizes; a Claude log with two messages; a log with no usage; a record of the older shape; the `--list` line with and without a peak; the `--stats` line. Run `npx vitest related --run` on every file you changed and `npm run build`; both must pass. Then run `npm run run-lane -- --list` and `npm run run-lane -- --stats --since 2026-11-01` for real and give their output in the report.

Files: src/harnesses/opencode.js, src/harnesses/claude.js, src/harnesses/common.js, src/briefs/run.js, scripts/run-lane.mjs, tests/.

**P33. A helper does the mechanical part of a merge (AGY).** Read no part of TASKS.md beyond this brief, and steps 3 to 5 of `The loop` in `docs/agents/ORCHESTRATOR.md`. Use no subagents. Commit each step as you finish it, and stop starting new work at minute 50. Do not edit any file under `docs/`, `server/` or `src/`.

The orchestrator merges every lane by hand: the merge, the tests of the changed files, the build, the changelog line, the commit and the outcome record. A smaller model in that role skips a step or gets one wrong. Add `scripts/merge-lane.mjs` as `npm run merge-lane`, with exported functions the tests call and every program started through an argument array, git through `gitPath()`, each with a time limit.

1. `npm run merge-lane -- LANE` prepares. It refuses, with one sentence each, unless: it runs in the main checkout on `main` with nothing uncommitted and no merge in progress; LANE is a lane in `docs/agents/lanes.json` with a worktree; that worktree has nothing uncommitted; the lane's lock names no live run (`scripts/lane-lock.mjs`); and its branch has commits `refs/heads/main` does not have. It reads the branch as one commit sha, as `scripts/review-lane.mjs` does, and merges that sha with `--no-ff --no-commit`. On a conflict it prints the files, runs `git merge --abort` and exits 1.
2. It then checks the merge: `node node_modules/vitest/vitest.mjs related --run` on the changed files, the build, `npm run pack-check` when a changed file is under `scripts/` or `bin/` or is `package.json`, and `tests/briefs.test.js` when `docs/agents/TASKS.md` changed. When one fails it prints the last 40 lines of that check, aborts the merge so the checkout is as it was, and exits 1. When all pass it leaves the merge staged and not committed, and prints the changed files, a PASS line per check, the brief ids of the newest run record for that branch, whether the branch brought a line under `## Unreleased`, and the `--finish` command to run next.
3. `npm run merge-lane -- LANE --finish --subject TEXT --line TEXT --grade G --fixes N` with an optional `--note TEXT`, `--ids A,B` and `--trailer TEXT` finishes. It refuses when no merge is in progress or the merge in progress is not that lane's branch. It writes `- TEXT` as the first line under `## Unreleased` in `docs/agents/CHANGELOG.md`, keeping that file's line ends, and refuses a line that holds an em dash or a line break. It stages the files already changed and any new file under `docs/agents/`, commits as `VERSION: Merge IDS, SUBJECT` with the version of `package.json` and the trailer, when given, as the last line after a blank one, writes the outcome with the code `npm run outcome` uses, and ends by saying whether the checkout is clean. `--abort` aborts a merge in progress. It never pushes and never deletes a branch.

Keep the script out of the pack, as the other dev tools are, so `npm run pack-check` passes. Add tests in temporary git repositories, with the checks injected: a clean merge stays staged; a conflict leaves `main` as it was; a failing check aborts; `--finish` writes the changelog line with CRLF line ends kept, the commit subject and the outcome row; and each refusal. Run `npx vitest related --run` on every file you changed, `npm run build` and `npm run pack-check`; all must pass.

Files: scripts/merge-lane.mjs, scripts/outcome.mjs, scripts/pack-check.mjs, package.json, tests/.

**P34. A short core for ARCHITECTURE.md, with the detail in files read when needed (OpenCode).** Starts last, when no other merge waits. Read no part of TASKS.md beyond this brief. Use no subagents. Commit each step as you finish it, and stop starting new work at minute 50. Do not edit `docs/agents/ORCHESTRATOR.md`, `docs/agents/TASKS.md` or `docs/agents/CHANGELOG.md`, nor any file under `server/` or `src/ui/`.

`ARCHITECTURE.md` is about 200 KB. It is loaded into every orchestrator session and read at the start of every lane run, most of it for nothing.

1. Move the long sections, text unchanged, into files under `docs/agents/architecture/`: `ROOM.md` (What it shows, Room behaviour), `COMMANDS.md` (Commands), `CODE.md` (Layout of the code), `LIVE.md` (Live mode), `ACTIVITIES.md` (Activity schema, How each agent reports tool calls, the DOM contract) and `LIMITS.md` (Known limits). Every line of the old file must be in exactly one file afterwards. Prove it with a script you delete at the end, and give in the report how many old lines were found once, more than once and not at all.
2. `ARCHITECTURE.md` becomes the core, under 16 KB: its first two paragraphs and the `Version` line as they are, the Documents list with the six new files, one paragraph on what the room shows, each command as one line (its name and one sentence), the layout as one line per folder, Data flow, Conventions and Open work as they are, and a table `Where to read more` that names each detail file, what it holds and when to read it.
3. The lane prompt and the pointer files say so: where `src/briefs/briefs.js` or `src/briefs/run.js` tells a lane to read `ARCHITECTURE.md` first, add that it then reads only the detail file its work touches, and say the same in `AGENTS.md`. `CLAUDE.md` keeps its import of the core. `npm run bump` still sets the `Version` line.
4. Find every test and probe that reads `ARCHITECTURE.md` (`tests/assistant.test.js`, `tests/bump.test.js`, `tests/run-lane.test.js` and the files under `tests/probes/` among them), run them, and point each one that reads a moved section at the file that now holds it. When the pack lists `ARCHITECTURE.md`, it lists the new folder too.

Run `npx vitest related --run` on every file you changed, the tests of step 4, `npm run build` and `npm run pack-check`; all must pass. Give the sizes of the old file, the core and each detail file in the report.

Files: docs/agents/ARCHITECTURE.md, docs/agents/architecture/, src/briefs/briefs.js, src/briefs/run.js, AGENTS.md, package.json, tests/.

**P35. Merged briefs leave TASKS.md (OpenCode).** Read no part of TASKS.md beyond this brief: find its sections with `grep -n '^## ' docs/agents/TASKS.md` and never read the file whole. Use no subagents. Commit each step as you finish it, and stop starting new work at minute 45. Do not edit any file under `docs/` but `docs/agents/TASKS.md` and the new archive, nor `src/briefs/run.js`, `scripts/run-lane.mjs` and `server/runs.js`, which other lanes hold.

`TASKS.md` is over 1 MB. Every lane run and every Dispatch list parses all of it, and no agent can read it.

1. Move every section above `## Permission modes for the orchestrator chat (2026-11-09)` into the new `docs/agents/history/TASKS-ARCHIVE.md`, text unchanged and in order, with one line at its top that says what it is. `TASKS.md` keeps what stands before its first section, a line that says where the older briefs are, and every section from that one on. The orchestrator may add briefs at the end of `TASKS.md` while you work: move sections, do not rewrite the file from a copy you read earlier.
2. An id stays unique across both files: `tests/briefs.test.js` reads both and fails on an id that stands in either twice or in both.
3. `server/lane-tasks.js` takes the title of a run whose brief is not in `TASKS.md` from the archive, read only when it is needed and kept until the file changes.
4. Find every test that reads the real `TASKS.md` and expects a brief that moved (twenty test files name `TASKS.md`), run them, and point each that fails at the archive or at a brief written in the test. List each one in the report.

Run `npx vitest related --run` on every file you changed, the tests of step 4, `npm run build` and `npm run pack-check`; all must pass. Give the size of `TASKS.md` before and after, and the time of `npm run run-lane -- opencode P35 --dry-run` before and after.

Files: docs/agents/TASKS.md, docs/agents/history/TASKS-ARCHIVE.md, server/lane-tasks.js, tests/.

## A lighter watcher, a lighter frame and a batch review (2026-11-11)

The hunts of 2026-11-10 left two costs open: the bridge lists the whole project again each time a file appears, and the room's frame does work for every drawn card whether it moved or not. P36 and P37 cut them with no change to what the owner sees. P38 reviews what was merged since the last push. Other lanes measure at the same time, so time each number three times and give the median.

**P36. A new file is listed by its path, not by a read of the whole project (OpenCode).** Read no part of TASKS.md beyond this brief, and of `docs/agents/AUDIT-2026-11-LIGHT-BRIDGE.md` only its finding table. Use no subagents. Commit each step as you finish it, and stop starting new work at minute 50. Do not edit any file under `docs/`, `src/` or `scripts/` but `scripts/scale-live.mjs`.

On a checkout of 200,000 files each `git ls-files` keeps a core busy for 3.7 seconds, and a burst of new files starts three or four of them. The watcher in `server/index.js` already gets the name of what changed.

1. While the watcher is armed, collect the names its events carry. After the quiet time the bridge already waits, when it holds at most 200 distinct names and every event carried one, list only those: `git ls-files -z --cached --others --exclude-standard -- NAMES` through `gitPath()` with an argument array and the limits `readTree` has, so the ignore rules stay git's own and a named folder lists what is under it. Add the paths it answers that the bridge does not hold yet, and publish them through `publishTree` as a full read does, so the version, the kept added paths and the page events stay as they are. A name under `.git` or `.worktrees` is skipped as now.
2. Fall back to the full read, as now, when an event carries no name, when more than 200 names wait, when the partial list fails or times out, when the folder is not a git checkout, and when the watcher cannot be armed. Every tenth partial read in a row is followed by one full read, so a missed event cannot hide a file for long.
3. Tests with an injected lister and watcher: one new file costs one partial list and no full read; a new folder's files arrive; an ignored file does not; 201 names fall back; a failed partial list falls back; an event with no name falls back; the tenth partial read is followed by a full one; a page still gets only the paths it has not had.
4. Add to `npm run scale-live` how many full and partial lists a burst starts. Run it at 40,000 and 200,000 files with `--seed 36` and give, in your report, the burst's reads, the bridge's CPU share and the time from a file's write to the page, before and after.

Run `npx vitest related --run` on every file you changed, `npm run build` and `npm run pack-check`; all must pass.

Files: server/index.js, scripts/scale-live.mjs, tests/.

**P37. A card that did not move costs the frame nothing (OpenCode).** Read no part of TASKS.md beyond this brief, and of `docs/agents/AUDIT-2026-11-LIGHT-BROWSER.md` only its finding table and the orchestrator's corrections. Use no subagents. Commit each step as you finish it, and stop starting new work at minute 50. Do not edit any file under `docs/`, `server/` or `src/ui/`, nor `src/Stage.jsx`. Nothing the owner sees may change: no place, size, colour, timing or class of any card, string, strand or tunnel.

A profile of `?replay&scale=200000` at play (P26) put the room's `frame` at 3.9 seconds of a 20 second window, and what grows with the room is the work done for each drawn card on every frame: `update` and `build` in `src/engine/strings.js`, and `anchor`, `cardBaseWidth`, `cardAnchorOf` and `recompute` in `src/engine/cards.js`. That room draws 171 cards.

1. Give each card a move stamp that changes only when its place, lift, pop, scale or size changes. `cards.anchor` answers from a value kept per card and stamp, and computes `cardBaseWidth` and its size once per size change, not per call.
2. `strings.js` reads a string's two ends only when either card's stamp changed since its last write, and skips the string otherwise. The tunnel waypoints in `src/engine/agents.js` use the same kept anchors.
3. Keep every pure helper's answer the same. Add tests with a counter: a frame over 171 resting cards computes no anchor and writes no string; moving one card recomputes that card's anchor and only the strings that end on it; a size change recomputes its width once.
4. Measure in Node with a small fake for what the code needs of the DOM and three.js, 171 cards and their strings: the time of 1,000 frames at rest and of 1,000 frames with one card moving, before and after. Give the numbers in your report. Do not start a browser.

Run `npx vitest related --run` on every file you changed and `npm run build`; both must pass. The orchestrator checks the room by eye at 1280 by 800.

Files: src/engine/cards.js, src/engine/strings.js, src/engine/agents.js, tests/.

**P38. Review the merges since the last push (OpenCode).** Read no part of TASKS.md beyond this brief. Use no subagents. Change no code. Commit the file by minute 45.

Read `git log --first-parent origin/main..refs/heads/main` and review the code each merge of P19, P24 to P27, P29 to P33 and P35 brought, with `git show -m --first-parent SHA`, against the code around it. Hunt for what a test would not show: a cache that can answer stale data and what makes it fresh again, a refusal or an origin check that a refactor dropped or reordered (`server/runs.js` moved the checks of `POST /api/control/runs` into helpers in P31), a file read or a program started with a path a page can name, a list that grows without a bound, work that still runs on every tick, and a number in `docs/agents/ARCHITECTURE.md` or `docs/agents/CHANGELOG.md` that the code does not match. Run a finding's test or a short script when one would settle it, and say which findings you proved and which you only read. Write `docs/agents/AUDIT-2026-11-REVIEW-9.md`: a table of at most 12 findings, the one that would hurt the owner most first, each with `file:line`, what goes wrong and when, and the smallest fix; then at most three proposed briefs. Write no finding you cannot point to in the code.

Files: docs/agents/AUDIT-2026-11-REVIEW-9.md.

**P39. A task typed in Dispatch gets its tier from its text (OpenCode).** Read no part of TASKS.md beyond this brief. Use no subagents. Commit each step as you finish it, and stop starting new work at minute 35. Do not edit any file under `docs/`, `src/ui/` or `src/engine/`, nor `server/index.js` and `tierFor` in `src/policy/route.js`.

A task typed in Dispatch names no `Files:` list and no tests, so `profileFromBrief` calls it unclear and `tierFor` puts every task in the large tier, a one line typo fix included.

1. Add the pure `profileFromTask(text)` to `src/policy/profile.js`. It counts the distinct paths the text names, in backticks or bare, by the rule `isPath` has. It answers a profile that `tierFor` reads as small when the text is at most 300 characters and names at most 2 paths, as medium when it is at most 1500 characters and names at most 6 paths, and as large otherwise. A text that names a path `profileFromBrief` treats as secrets, deploy or data, or that says `needs the owner's yes` or `spends`, is large whatever its length. An empty text is large.
2. `POST /api/control/route/lane` in `server/policy.js` and the routed start of `POST /api/control/runs` in `server/runs.js` use it wherever they now build a task's profile with `profileFromBrief({ text })`. A queue of several tasks takes the largest tier among its tasks. A brief's profile stays as it is.
3. Tests: each boundary (300 and 301 characters, 2 and 3 paths, 1500 and 1501 characters, 6 and 7 paths), a bare path and a backticked one counted once, `package.json` and a path under `public/fixtures/` as large, the two phrases as large, the route answer for a short task naming the small tier, and a queue taking its largest task's tier.

Run `npx vitest related --run` on every file you changed and `npm run build`; both must pass.

Files: src/policy/profile.js, server/policy.js, server/runs.js, tests/.

## The fixes from review 9 (2026-11-11)

`docs/agents/AUDIT-2026-11-REVIEW-9.md` reviewed the merges since the last push. These three briefs fix the findings the orchestrator's corrections say hold. Other lanes run at the same time.

**P40. The policy proposer reads the merges on main, and the merge helper checks what it is given (AGY).** Read no part of TASKS.md beyond this brief, and of `docs/agents/AUDIT-2026-11-REVIEW-9.md` findings 1, 9 and 10. Use no subagents. Commit each step as you finish it, and stop starting new work at minute 35. Do not edit any file under `docs/`, `server/` or `src/`.

1. In `scripts/policy-propose.mjs`, pass `readMainSubjectsSync()` from `server/runs.js` as the third argument of `outcomeTable`, as `scripts/run-lane.mjs` does for `--outcomes`. Test: a run with a branch and a brief, no outcome row and a `Merge ID` subject on main counts as merged and not graded in the table the proposer builds.
2. In `scripts/merge-lane.mjs`, put `--` before the changed files in the `vitest related --run` command. Test: the command the check builds holds `--` right before the first file.
3. In `finishMerge`, refuse a `--subject` or a `--trailer` that holds an em dash or a line break, with one sentence each, before anything is written. Test each refusal, and that the changelog and the checkout are unchanged after it.

Run `npx vitest related --run` on every file you changed, `npm run build` and `npm run pack-check`; all must pass.

Files: scripts/policy-propose.mjs, scripts/merge-lane.mjs, tests/.

**P41. The lane route reads the lanes, the runs folder and the lane choice the run it starts reads (OpenCode).** Read no part of TASKS.md beyond this brief, and of `docs/agents/AUDIT-2026-11-REVIEW-9.md` findings 5, 6 and 8. Use no subagents. Commit each step as you finish it, and stop starting new work at minute 40. Do not edit any file under `docs/`, `src/engine/` or `scripts/`, and in `server/index.js` change only the options given to `createPolicyApi`.

1. `POST /api/control/route/lane` in `server/policy.js` takes its lanes from the same source `POST /api/control/runs` in `server/runs.js` takes them from, owner-made lanes included and the lanes the owner removed left out, never from a `lanes.json` inside the room's project. Share one function for the lane states between the two files, so the preview and the start cannot disagree.
2. `server/index.js` gives `createPolicyApi` the runs folder the bridge gives its other parts, so the lane locks and the spend are read from one folder.
3. On a project with no saved lane choice, the route and a routed start answer what a named lane answers there, 400 with `Pick the lanes for this project first.`, not 409. Dispatch shows that sentence after `Auto:`.
4. Tests: an owner-made lane can be picked by the route; a removed lane cannot; a `lanes.json` in the project is not read; a bridge with its own runs folder reads the lock and the spend there; no saved choice answers 400 with that sentence on both routes.

Run `npx vitest related --run` on every file you changed and `npm run build`; both must pass.

Files: server/policy.js, server/runs.js, server/index.js, src/ui/panels/DispatchPanel.jsx, tests/.

**P42. The session and lane readers at rest: a bounded row map, no missed row and no stat per tick (OpenCode).** Read no part of TASKS.md beyond this brief, and of `docs/agents/AUDIT-2026-11-REVIEW-9.md` findings 3, 11 and 12. Use no subagents. Commit each step as you finish it, and stop starting new work at minute 40. Do not edit any file under `docs/`, `src/` or `scripts/`, nor `server/index.js`.

1. In `server/opencode-sessions.js`, ask for the moved rows with `time_updated >= ?` and take a row only when it is new or its `time_updated` changed, so a row written in the same millisecond as the highest one seen is not lost. Change the tests that count the rows of a poll to match.
2. Once a minute, read every row as the first read does and drop from `knownRows`, and from what the reader holds for them, the ids the database no longer has.
3. In `server/lanes-source.js`, check the size of a quiet run only when a watcher event named its log or on the 2 second scan, not on every 200 ms tick. A log that grows after a quiet end still reopens its run within 2 seconds.
4. Tests with the injected clock, database and lister: a same-millisecond child is seen; a deleted session leaves the map after the full read and does not come back; a tick at rest makes no `statSync` call on a quiet log; a quiet log that grows reopens its run.

Run `npx vitest related --run` on every file you changed and `npm run build`; both must pass.

Files: server/opencode-sessions.js, server/lanes-source.js, tests/.

## A deleted file leaves the room, and a narrower partial list (2026-11-11, the owner's yes)

The owner said yes to a room that drops a file deleted from the project (review 9, finding 2). P36's partial list was rejected: one new file reached the page in 0.5 seconds where it took 1.9 at 200,000 files, but a burst of 2000 files took the bridge's CPU share from 6 to 37 percent and the last file from 2.6 to 3.9 seconds. P36b tries again, narrower, after P43 is merged, since both change the tree path in `server/index.js`.

**P43. A file deleted from the project leaves the room (OpenCode).** Read no part of TASKS.md beyond this brief, and of `docs/agents/AUDIT-2026-11-REVIEW-9.md` finding 2 and the orchestrator's corrections. Use no subagents. Commit each step as you finish it, and stop starting new work at minute 55. Do not edit any file under `docs/` or `scripts/`, nor `src/engine/`.

1. In `server/index.js`, `publishTree` also finds the paths that left the list, by the sorted merge walk the lists already allow, not by a set of the whole list. A version keeps its added and its removed paths, and `treeFilesSince` answers both. The `tree` event carries `removed` beside the added files, in the plain and the folder shape. A page that names a version the bridge no longer has gets the whole list, as now, and a page at the current version gets no event. `src/live/tree.js` reads `removed`, and a page and a bridge of different versions still agree: an older page ignores `removed`, and a newer page reads an event without it as no removals.
2. `src/live/livePlayer.js` gets `removeFiles(paths)`: it drops each path from `state.files`, drops a folder from `state.dirs` when no file is left under it, and leaves the root. `src/Stage.jsx` calls it with the event's `removed` beside `addFiles`, and the room rebuilds its plan as it does when files are added. A removed file an agent is touching or that a run wrote stays until that run ends, so its green or red mark is not lost mid-run.
3. A whole list from the bridge replaces the page's list: paths the page holds that the list does not are removed the same way.
4. Tests: a bridge whose second read drops `b.js` sends `removed: ['b.js']` on the stream in both shapes; a rename sends the old path removed and the new one added; a page at an old kept version gets both; the live player drops the file and an emptied folder but not the root; a file a running agent touches stays until the run ends; an event with no `removed` changes nothing.

Run `npx vitest related --run` on every file you changed and `npm run build`; both must pass. The orchestrator checks by eye that a deleted file's row and an emptied folder's card leave a live room at 1280 by 800.

Files: server/index.js, src/live/tree.js, src/live/livePlayer.js, src/Stage.jsx, src/model/state.js, tests/.

**P36b. A few new files are listed by their names, and a burst costs no more than before (OpenCode).** Starts after P43 is merged. Read no part of TASKS.md beyond this brief and P36 above it. Use no subagents. Commit each step as you finish it, and stop starting new work at minute 55. Do not edit any file under `docs/` or `src/`, nor any file under `scripts/` but `scripts/scale-live.mjs`.

Keep the watcher, the quiet times, the poll and every full read path of `server/index.js` exactly as they are on `main`. Change one thing: when a read is due and every watcher event since the last read carried a name, at most 50 distinct names, replace that one full read with `git ls-files -z --cached --others --exclude-standard -- NAMES` as P36 did. A name the list does not answer that the bridge held, or a folder name whose held files the list no longer answers, is a removal, published as P43 publishes one. Every other case, more than 50 names included, runs the full read as now. Every tenth partial read in a row is followed by a full read.

Tests with an injected lister and watcher: one new file costs one partial list; 51 names cost one full read and no partial one; a deleted named file is removed; a failed partial list falls back to a full read. Run `npm run scale-live` at 40,000 and 200,000 files with `--seed 36` on `main` and on your branch, and give in your report one new file's time to the page, the burst's reads, the bridge's CPU share and the last write's time to the page, for both. A burst must cost no more CPU and no more time than on `main`, within 10 percent; if it does, say so and stop.

Run `npx vitest related --run` on every file you changed, `npm run build` and `npm run pack-check`; all must pass.

Files: server/index.js, scripts/scale-live.mjs, tests/.

## The native agent up to the standard of Claude Code and OpenCode (2026-11-11, the owner's request)

The owner asked whether the native harness (`scripts/mr-agent.mjs`, the Direct API) works like Claude Code or OpenCode on DeepSeek. The orchestrator ran it against a scripted OpenAI-compatible server on a small project, since this computer has no key for it: on Windows `run_shell` runs `cmd.exe`, so the model's `ls -la` failed; `read_file` sent a 1.36 MB file whole, with no line numbers, and every later request carried it, so five steps cost 705,000 input tokens; `run_shell` kept the first 8,000 characters of a failing script and lost its error line at the end and its exit code; one 429 answer ended the run; the system prompt is two sentences and never names `AGENTS.md`, the system, the shell or the date; `search` reads gitignored folders; and nothing trims or compacts the conversation, which stops at 60 steps. P44 fixes the tools and P45 the loop. P45 starts after P44 is merged, since both change `scripts/mr-agent.mjs`.

**P44. The native agent's tools work like Claude Code's (OpenCode).** Read no part of TASKS.md beyond this brief and the section above it. Use no subagents. Commit each step as you finish it, and stop starting new work at minute 60. Edit only the files listed below. Keep the tool names, the stream-json lines the room reads, the permission modes, the Auto deny list, the approval path and the working folder check as they are.

1. `read_file` takes `offset` and `limit` (lines, 1-based), reads at most 2000 lines by default, prefixes each line with its number and a tab as Claude Code's Read does, cuts a line longer than 2000 characters, and ends a cut read with `[N more lines. Read again with offset to see them.]`. A binary file (a zero byte in its first 8 KB) answers that it is binary.
2. `run_shell` on Windows runs Git Bash when it finds it, `bash.exe` next to `gitPath()`'s `git.exe` (`..\bin\bash.exe` from its `cmd` folder) or `bash` on PATH through `programPath`, else `powershell.exe -NoProfile -Command`, never `cmd.exe`. Elsewhere it runs `/bin/sh -c` as now. It takes an optional `timeout` in seconds up to 600. Its answer keeps the first 2,000 and the last 6,000 characters with `[N characters cut]` between them, and ends with `exit N` when the exit code is not 0.
3. `search` takes `glob` (such as `*.js`) and `ignore_case`, and lists files with `git ls-files -z --cached --others --exclude-standard` through `gitPath()` when the folder is a git checkout, so gitignored folders are skipped, else walks as now. A match line is cut at 300 characters. Add `glob_files` (`pattern` and `path`): the files that match a glob, from the same list, at most 500, sorted by name.
4. `edit_file` takes `replace_all`. A write or an edit answers with the line count of the file it left.
5. Tests in `tests/mr-agent.test.js` with temporary folders: a paged read and its end line; a long line cut; a binary file; a failing command keeps its last line and `exit 1`; the head and tail cut; the shell chosen on Windows when bash is and is not found (injected); a search that skips a gitignored folder; `glob` and `ignore_case`; `glob_files`; `replace_all`.

Run `npx vitest related --run` on every file you changed, `npm run build` and `npm run pack-check`; all must pass.

Files: scripts/mr-agent.mjs, tests/mr-agent.test.js.

**P45. The native agent's loop: project instructions, retries and a bounded conversation (OpenCode).** Starts after P44 is merged. Read no part of TASKS.md beyond this brief and the section above P44. Use no subagents. Commit each step as you finish it, and stop starting new work at minute 60. Edit only the files listed below, and keep what P44 kept.

1. The system prompt says, in plain sentences: the working folder, the system and the shell `run_shell` uses, today's date, that it reads a file before it edits it, keeps changes small, runs the project's tests when it changed code, and ends with a short report of what it changed and what it could not check. It then adds the project's `AGENTS.md`, else `CLAUDE.md`, from the working folder, at most 20,000 characters, under a line naming the file.
2. A request that answers 429, 500, 502, 503 or 529, or fails on the network or the time limit, is tried again up to 4 times, waiting 2, 4, 8 and 16 seconds or the `retry-after` the answer gives, at most 60 seconds. A 400 or 401 is not tried again. The final error keeps its key masking.
3. Each `assistant` line carries `message.usage` with the request's input and output tokens, so `peakTokens` (P32) reads a native run as it reads Claude Code.
4. The conversation stays bounded. Before a request whose messages hold more than `MR_AGENT_CONTEXT_CHARS` (400,000 characters by default), replace the text of the oldest tool results, the newest 6 kept whole, with `[Output removed to save room. Run the tool again if it is needed.]` until it fits. Count characters, not tokens. The step limit becomes 200, and `MR_AGENT_MAX_STEPS` sets it.
5. Pass `--reasoning EFFORT` through as `reasoning: { effort }` when the run-lane command line or the orchestrator gives one, and `max_tokens` 32000.
6. On Windows, `run_shell` never takes a `bash.exe` under the Windows folder (`%SystemRoot%`), since that one starts WSL in another file system; it falls to PowerShell instead. Add a test with the paths injected.
7. Tests with a scripted OpenAI-compatible server on port 0, as the existing tests start one: the system prompt holds `AGENTS.md` and the shell name; a 429 then a good answer finishes well after one wait (injected clock or a short wait); a 401 is not retried; the usage on an assistant line; old tool results are replaced and the newest 6 kept; the step limit from the environment.

Run `npx vitest related --run` on every file you changed, `npm run build` and `npm run pack-check`; all must pass.

Files: scripts/mr-agent.mjs, src/harnesses/machineroom.js, tests/mr-agent.test.js.

**P46. An agent's beat ring reads as white, like the hub's (AGY 2).** The owner's choice on 2026-11-11. Read no part of TASKS.md beyond this brief. Use no subagents. Commit each step as you finish it, and stop starting new work at minute 30. Edit only the files listed below.

While music plays and Dance is on, each agent sends a ring from its status ring on a beat (`updateBeatRings` in `src/engine/agents.js`). It uses the hub's `RING_MAX_OPACITY` 0.32 times the beat's strength, and a small thin ring at that opacity reads as a faint grey loop under the agent, which the owner took for a stray line. Give the agent ring its own `AGENT_RING_MAX_OPACITY` in `src/engine/hub.js`, 0.8, and an opacity floor so a weak beat still draws at least 0.35 of it at its start, still fading to 0 at its end as `ringPulse` fades it now. The hub's ring, the pool size, the timing, the radius and reduced motion stay as they are. Add a test of the new opacity at the start and at the end of a ring for a weak and a strong beat. Run `npx vitest related --run` on every file you changed and `npm run build`; both must pass. The orchestrator checks it by eye with music playing.

Files: src/engine/hub.js, src/engine/agents.js, tests/.

**P47. Removing a lane removes it from that project only (OpenCode).** The owner's yes on 2026-11-11. Read no part of TASKS.md beyond this brief. Use no subagents. Commit each step as you finish it, and stop starting new work at minute 50. Do not edit any file under `docs/` or `src/engine/`.

On 2026-11-11 the owner removed lanes in a room open on another project, and since `POST /api/lanes/KEY/delete` adds a `lanes.json` lane to the `removed` list in `<runs>/agents.json`, which `readAllLanes` applies to every project, the lane runner then refused those lanes for MachineRoom's own briefs. A project already has its own hidden list, `project-lanes-<hash>.json` (`projectLanesFileFor` and `readHiddenLanes` in `server/active-lanes.js`), which the family tree, the lane states and a project run read.

1. The delete route, for a lane from `lanes.json`, adds it to the room's project hidden list and to nothing global, and takes it out of that project's active lanes as now. An owner-made lane is deleted as now, since it belongs to no project. The confirm card in the family tree and in Settings says `Remove NAME from PROJECT? It stays in your other projects.` for a `lanes.json` lane, and the sentence it says now for an owner-made lane.
2. `readAllLanes` no longer applies the global `removed` list. A list already saved there is read once when the bridge starts: each key in it is added to the hidden list of the bridge's own project, the `removed` list is emptied and saved, and the bridge prints one line naming the keys it moved. A brief run in this repository and `run-lane` never read a project's hidden list, so a lane hidden in another project still runs MachineRoom's briefs.
3. Settings lists the lanes hidden in this project with a Show button each, behind no card, so a removed lane can come back.
4. Tests: a delete in one project hides the lane there and not in another; `run-lane --dry-run` on a brief still takes a lane hidden in a project; an owner-made lane is deleted for every project; the start-up move of an old `removed` list; Show brings a lane back; the two confirm sentences.

Run `npx vitest related --run` on every file you changed and `npm run build`; both must pass. The orchestrator checks the confirm card and Settings by eye at 1280 by 800.

Files: server/agents-config.js, server/active-lanes.js, server/lanes-source.js, server/family.js, src/ui/FamilyTree.jsx, src/ui/LanesSettings.jsx, src/ui/family.js, src/control/client.js, src/control/mock.js, tests/.

## Review 10 (2026-11-11)

**P48. Review the merges since the last push (OpenCode).** Read no part of TASKS.md beyond this brief. Use no subagents. Change no code. Commit the file by minute 45.

Read `git log --first-parent 796ff863..refs/heads/main` and review the code each merge of P44, P45, P46, P36b and P47 brought, with `git show -m --first-parent SHA`, against the code around it. Hunt for what a test would not show: in `scripts/mr-agent.mjs`, a shell or path the model can steer outside the working folder, a retry that can loop or double a write, output or a conversation that can still grow without a bound, and a project instruction file read from outside the project; in `server/index.js`, a partial list that can miss a file or keep a deleted one for good, and a name from a watcher event that reaches git as an option; in `server/agents-config.js`, a hidden list written for the wrong project, a lane that `run-lane` still refuses or still starts against the owner's choice, and the startup move run twice. Run a finding's test or a short script when one would settle it, and say which findings you proved and which you only read. Write `docs/agents/AUDIT-2026-11-REVIEW-10.md`: a table of at most 10 findings, the one that would hurt the owner most first, each with `file:line`, what goes wrong and when, and the smallest fix; then at most three proposed briefs. Write no finding you cannot point to in the code.

Files: docs/agents/AUDIT-2026-11-REVIEW-10.md.

## The owner's room and the orchestrator's testbench (2026-11-11, the owner's yes)

The owner's room is for the owner's own subscriptions, one lane each, which they make in the room. The orchestrator's fleet (`opencode` to `opencode7`, `agy` to `agy3`, `claude`) is a development tool and must not appear there. Today every room reads the fleet from `docs/agents/lanes.json` and routes by `docs/agents/policy.json`, so the owner sees it on every project.

**P49. A room's lanes come from the room, and the fleet only from the testbench (OpenCode).** Read no part of TASKS.md beyond this brief and the paragraph above it. Use no subagents. Commit each step as you finish it, and stop starting new work at minute 65. Do not edit any file under `src/engine/` or `docs/` other than the two files named in step 1.

1. Add `config/lanes.json` with only the `orchestrator` entry of `docs/agents/lanes.json`, and `config/policy.json` with the same shape as `docs/agents/policy.json`, each tier holding only the `owner` entry and the limits copied as they are. Pack both (`scripts/pack-check.mjs`). `docs/agents/lanes.json` and `docs/agents/policy.json` stay as they are: they are the fleet.
2. Add one helper in `server/lanes-source.js` that answers the lanes folder: `MACHINEROOM_LANES_DIR` resolved when set, else `config/` in the repo. Every reader of `docs/agents/lanes.json` or `docs/agents/policy.json` by a fixed path reads through it: the bridge (`server/active-lanes.js`, `server/runs.js`, `server/policy.js`, `server/projects.js`, `server/doctor.js`, `server/lanes-source.js`) and the scripts (`run-lane`, `merge-lane`, `review-lane`, `hand-run`, `candidate`, `run-recording`, `agy-prompt`, `policy-propose`). `MACHINEROOM_LANES_FILE` still overrides the lanes file for `run-lane`. A project's own briefs folder (`server/briefs.js`, `server/reviews.js`) keeps reading that project's files as now.
3. `src/ui/panels/briefs.js` stops importing `docs/agents/lanes.json` at build time: `ownerToLane` and `runLaneFor` use the lanes their callers pass, which come from the bridge, and with none they answer no lane.
4. Without `MACHINEROOM_LANES_DIR`, on any project, MachineRoom's own checkout included, `GET /api/agents`, the family tree, Settings' lane list, `run-lane` and Auto list only `orchestrator` and the owner-made lanes in `<runs>/agents.json`; Auto with no lane for a tier says so in one plain sentence. With `MACHINEROOM_LANES_DIR=docs/agents` everything works as it does today.
5. Tests: the default lists only the orchestrator and a made lane on a project that has its own `docs/agents/lanes.json`; the dir lists the fleet; `run-lane` refuses `opencode` without the dir and accepts it with it; the briefs panel helpers answer no lane with none passed. Tests that need the fleet set the dir or pass the file; do not weaken any other assertion.

Run `npx vitest related --run` on every file you changed, `npm run build` and `npm run pack-check`; all must pass. In your report list every reader you changed and any you left on a fixed path, with the reason.

Files: config/, server/, scripts/, src/ui/panels/briefs.js and its callers in src/ui/, tests/.

## The fixes from review 10 (2026-11-11)

Each brief fixes findings of `docs/agents/AUDIT-2026-11-REVIEW-10.md`. Read only the findings it names.

**P50. The native agent's conversation stays under its bound (OpenCode).** Read no part of TASKS.md beyond this brief, and of the review only finding 2. Use no subagents. Commit each step as you finish it, and stop starting new work at minute 40. Edit only the files listed below.

1. In `scripts/mr-agent.mjs`, `boundMessages` keeps the system message and the first user message whole. Over the bound it first shortens old tool results as now, then replaces the text of old assistant messages and the `arguments` of old `write_file` and `edit_file` calls with a short note that names the path, oldest first, until the request fits. Keep each tool call's id and name so every tool result still answers a call.
2. If the newest six messages alone hold the request over the bound, shorten them too, the largest first, and keep the newest user or tool message readable to its first 2,000 characters.
3. Tests with a fake endpoint: after one 500 KB `write_file` with `MR_AGENT_CONTEXT_CHARS=2000` the next request is under 2,000 characters of message text plus the system prompt; every tool result still follows its call; the existing tests stay as they are.

Run `npx vitest related --run` on every file you changed; it must pass.

Files: scripts/mr-agent.mjs, tests/mr-agent.test.js.

**P51. The file list stays true after an unstaged delete and a missed event (OpenCode).** Read no part of TASKS.md beyond this brief, and of the review only findings 3 and 4. Use no subagents. Commit each step as you finish it, and stop starting new work at minute 45. Edit only the files listed below, and in `server/index.js` only the tree read and the watcher code.

1. `readTree` and `readTreePartial` leave out the paths `git ls-files -z --deleted` answers (with the same names after `--` for a partial read), through `gitPath()` with an argument array and the limits the reads have now, so a file deleted from the disk leaves the list and the page gets it as `removed` without a commit. If that list fails, keep the read as it is now.
2. After a partial read, when the watcher stays quiet for the quiet time the bridge already waits, run one full read, so a change the watcher missed is corrected with no further event. A burst still costs no more full reads than now.
3. Tests: an unstaged delete leaves the list after a full read and after a partial read; one watcher event and a second file only a full read knows reach the tree with no further event; a burst of 51 names starts the same reads as before.

Run `npx vitest related --run` on every file you changed and `npm run build`; both must pass. In your report give the full and partial reads of `npm run scale-live -- --seed 36` at 40,000 files, before and after.

Files: server/index.js, tests/.

**P52. The native agent stays inside the working folder and reads only the window (OpenCode).** Starts after P50 is merged. Read no part of TASKS.md beyond this brief, and of the review only findings 1, 5 and 6. Use no subagents. Commit each step as you finish it, and stop starting new work at minute 45. Edit only the files listed below.

1. `inside` compares real paths: the real path of the working folder against the real path of the target when it exists, else of its nearest existing parent. A junction or link that leads out is refused with the sentence a path outside gets now. `walkFiles` does not follow a link out of the working folder.
2. `read_file` reads only the bytes its window needs, line by line from the start of the file, and stops at the window's end; a file over 50 MB read with no `limit` is refused with one sentence that asks for `offset` and `limit`.
3. `search` and `glob_files` under a folder pass that folder to `git ls-files` as a pathspec after `--`, and `search` stops reading files at its match limit.
4. Tests: a junction from the working folder to a second temp folder is refused by `read_file`, `write_file`, `edit_file`, `search` and `glob_files`; a 60 MB file read at `limit: 5` returns five lines; a search under one folder lists only that folder.

Run `npx vitest related --run` on every file you changed; it must pass.

Files: scripts/mr-agent.mjs, tests/mr-agent.test.js.

## Review 11 (2026-11-12, before the push)

**P53. Review the merges of P49 to P52 (OpenCode).** Read no part of TASKS.md beyond this brief. Use no subagents. Change no code. Commit the file by minute 35.

Read `git log --first-parent 103edc8b..refs/heads/main` and review the code the merges of P50, P51, P52 and P49 brought, with `git show -m --first-parent SHA`, against the code around it. Hunt for what a test would not show: a reader of the lanes or the policy still on a fixed `docs/agents` path, so the owner's room shows or routes to a fleet lane, or the testbench loses one; a route or script that now refuses a lane the owner made; a git read that starts a process per event or doubles the work of a full read more than once; a quiet timer that can keep running after the bridge stops; a path check in `scripts/mr-agent.mjs` that a link or a name can still pass; and a conversation trim that drops a tool result its call needs. Run a finding's test or a short script when one would settle it, and say which findings you proved and which you only read. Write `docs/agents/AUDIT-2026-11-REVIEW-11.md`: a table of at most 8 findings, the one that would hurt the owner most first, each with `file:line`, what goes wrong and when, and the smallest fix; mark each one as a push blocker or not. Write no finding you cannot point to in the code.

Files: docs/agents/AUDIT-2026-11-REVIEW-11.md.

## The owner's room on its own, before the OpenCode subscription ends (2026-11-12, the owner's yes)

Since P49 the owner's room reads `config/lanes.json`, which holds only the orchestrator, and the owner makes one lane per subscription in the room. Every brief here works on a temporary runs folder and a temporary project: never read or write `%TEMP%\machineroom-runs`, the owner's room.

**P54. A lane the owner makes for any harness starts without the fleet (OpenCode).** Read no part of TASKS.md beyond this brief and the paragraph above it. Use no subagents. Commit each step as you finish it, and stop starting new work at minute 55. Do not edit any file under `docs/` or `src/engine/`.

`buildMadeLane` in `server/agents-config.js` copies a made lane's `harness` name and `cli.bin` from the first lane of that harness in the room's `lanes.json`. With `config/` there is no such lane but the orchestrator, so a made OpenCode or AGY lane gets `bin` set to the bare harness key and the key as its harness name.

1. Give each harness descriptor in `src/harnesses/` that `buildMadeLane` can be asked for a display name (the one `docs/agents/lanes.json` uses: `OpenCode`, `agy`, `Claude Code`, and the name each other harness already shows) and a default program: the same `%APPDATA%` or `%LOCALAPPDATA%` path the fleet uses on Windows where the fleet names one, else the name the harness uses now. Keep `docs/agents/lanes.json` as it is.
2. `buildMadeLane` uses a template lane when the room has one, as now, and the descriptor's name and program when it has none. A lane made before this change keeps working: its stored `cli` is not rewritten.
3. Tests with only `config/lanes.json` and a temp runs folder: a made lane for each of `opencode`, `agy`, `claude`, `codex`, `copilot` and `machineroom` has its display name and a program that is not a bare key where the fleet names a path; `run-lane --dry-run` on a made OpenCode lane prints the expanded program path; with `MACHINEROOM_LANES_DIR=docs/agents` a made lane still copies the fleet lane as now.

Run `npx vitest related --run` on every file you changed, `npm run build` and `npm run pack-check`; all must pass.

Files: src/harnesses/, server/agents-config.js, tests/.

**P55. What a deleted-file list costs on a large project (OpenCode).** Read no part of TASKS.md beyond this brief. Use no subagents. Change no code but `scripts/scale-live.mjs`. Commit by minute 60.

Since P51 every tree read runs `git ls-files --deleted` beside the list, and 30 seconds after the last partial read the bridge runs one full read. Run `npm run scale-live -- --seed 36` at 40,000 and 200,000 files on `refs/heads/main` and on a temp worktree of the commit before the P51 merge (removed after), three times each, and give the median: a full read's time and CPU, a burst's reads and CPU, one new file's time to the page, and the bridge's CPU over two quiet minutes after one new file. Add to `scale-live` whatever it needs to print these. Write `docs/agents/AUDIT-2026-11-TREE-COST.md`: the table, what grew and by how much, and at most two ways to cut it if a full read costs more than 30 percent more than before.

Files: scripts/scale-live.mjs, docs/agents/AUDIT-2026-11-TREE-COST.md.

**P56. The owner's room with only its own lanes (OpenCode).** Read no part of TASKS.md beyond this brief and the paragraph above P54. Use no subagents. Change no code. Commit by minute 50.

Start a bridge with `npm run serve -- up --lanes --sessions` on a temp git project, with `MACHINEROOM_RUNS` set to a temp folder and `MACHINEROOM_LANES_DIR` unset, make one lane through `POST /api/lanes/create` as the page would, and walk every route and panel that names lanes: the agents list, the family tree, Settings' lanes, the active lane choice, Dispatch with a brief and with a typed task, Auto routing at each tier, the Team panel, the cost board, policy proposals, reviews and the doctor. Read the code behind each, and run what a script can settle. Write `docs/agents/AUDIT-2026-11-OWNER-ROOM.md`: a table of at most 10 places that still assume the fleet, refuse a made lane, show an empty or wrong state, or read a fixed `docs/agents` path, the one that would hurt the owner most first, each with `file:line`, what the owner sees and the smallest fix; then at most three proposed briefs. Say which you proved and which you only read.

Files: docs/agents/AUDIT-2026-11-OWNER-ROOM.md.

**P57. A startup move that cannot write does not stop the room (OpenCode).** Read no part of TASKS.md beyond this brief, and of `docs/agents/AUDIT-2026-11-REVIEW-10.md` only finding 7. Use no subagents. Commit each step as you finish it, and stop starting new work at minute 25. Edit only `server/index.js` and tests.

1. In `start()`, the call to `moveRemovedLanesToProject` runs in a `try`; when it throws, the bridge prints `Could not move the old removed lanes: REASON` once and keeps starting.
2. A test with a runs folder whose `agents.json` holds a removed list and a project lanes file that cannot be written: `start()` resolves, the bridge answers `/api/health`, and the line is printed once.

Run `npx vitest related --run` on every file you changed; it must pass.

Files: server/index.js, tests/.

**P58. The README tells the owner how their room gets its lanes (AGY).** Read no part of TASKS.md beyond this brief and the paragraph above P54. Use no subagents. Commit by minute 35. Edit only `README.md`.

Read `README.md`, `config/lanes.json`, `src/ui/LanesSettings.jsx` and the lane create route in `server/agents-config.js`. Rewrite only the README's parts about lanes so they say: a new room has the orchestrator and no lane; the owner makes one lane per subscription in Settings (name, harness, model, effort), each runs in its own harness on the owner's account; Remove from project and Delete everywhere; and `MACHINEROOM_LANES_DIR` points a room at another lane list, which is how MachineRoom's own development runs its lanes. Plain words, short sentences, no em dashes, no bold. Name no lane of the development fleet, no user name and no home path.

Files: README.md.

**P59. The run-lane stop test passes under load (AGY).** Read no part of TASKS.md beyond this brief. Use no subagents. Commit each step as you finish it, and stop starting new work at minute 45. Edit only files under `tests/`, and `scripts/run-lane.mjs` only if a test proves a real fault there.

`tests/run-lane-stop.test.js` failed once on a merge on 2026-11-11 and passed on a retry, while other lanes ran their suites. Run the file 20 times alone and 10 times with `node scripts/test.mjs` running beside it, find which test fails and why (a fixed wait, a port, a process not yet started or a shared temp folder), and make it wait for the state it needs instead of a time. Do not raise a timeout to hide it. Give the runs and failures before and after in your report.

Files: tests/run-lane-stop.test.js, tests/helpers/, scripts/run-lane.mjs.

## The fixes from review 11 (2026-11-12)

Each brief fixes findings of `docs/agents/AUDIT-2026-11-REVIEW-11.md`. Read only the findings it names. Work on a temporary runs folder and project, never on `%TEMP%\machineroom-runs`.

**P60. Reviews, Auto and the doctor see the room's own lanes (AGY).** Read no part of TASKS.md beyond this brief, and of the review only findings 2, 4, 7 and 8. Use no subagents. Commit each step as you finish it, and stop starting new work at minute 50. Edit only the files listed below.

1. `server/reviews.js` builds its lane map from the room's lanes: `readAllLanes` over `lanesFolder()`, so the lanes the owner made in `<runs>/agents.json` can be reviewed and merged, and a project's own `docs/agents/lanes.json` is used only when the room was started with that folder as `MACHINEROOM_LANES_DIR`. The fleet's `ROOM_BRIEFS` fallback is gone.
2. Auto reads the policy from the same folder as the lanes (`server/policy.js`, `server/runs.js`), so on MachineRoom's own checkout without `MACHINEROOM_LANES_DIR` it reads `config/policy.json` and says `There is no lane for the TIER tier. Make one in the room.` when no lane fits.
3. `server/doctor.js` checks the program of every lane `readAllLanes` returns, the made lanes included.
4. `scripts/merge-lane.mjs` and `scripts/review-lane.mjs` name the lane file they read in their error, not `docs/agents/lanes.json`.
5. Tests with a temp runs folder holding one made lane and `config/` lanes: its review diff answers 200 and not 404; Auto on MachineRoom's checkout reads `config/policy.json`; the doctor lists the made lane's program; the error names the file read. With `MACHINEROOM_LANES_DIR=docs/agents` the fleet works as now.

Run `npx vitest related --run` on every file you changed, `npm run build` and `npm run pack-check`; all must pass.

Files: server/reviews.js, server/policy.js, server/runs.js, server/doctor.js, scripts/merge-lane.mjs, scripts/review-lane.mjs, tests/.

**P61. The native agent keeps the results of the turn it is in (OpenCode).** Read no part of TASKS.md beyond this brief, and of the review only finding 3. Use no subagents. Commit each step as you finish it, and stop starting new work at minute 35. Edit only the files listed below.

1. `boundMessages` in `scripts/mr-agent.mjs` never replaces a tool result that answers a call of the newest assistant message with `tool_calls`. It trims older turns first, and when the current turn's results alone are over the bound it cuts each one's text to the 2,000 characters P50 keeps, with the marker, instead of removing it.
2. Tests with a fake endpoint: seven parallel `list_dir` calls with `MR_AGENT_CONTEXT_CHARS=500` keep all seven results readable in the next request; an older turn is trimmed before the current one; the P50 tests stay as they are.

Run `npx vitest related --run` on every file you changed; it must pass.

Files: scripts/mr-agent.mjs, tests/mr-agent.test.js.

**P62. A tree read starts no git it does not need (OpenCode).** Starts after P57 is merged. Read no part of TASKS.md beyond this brief, and of the review only findings 5 and 6. Use no subagents. Commit each step as you finish it, and stop starting new work at minute 40. In `server/index.js` change only the tree read and the watcher code.

1. When the list call fails, `readTree` and `readTreePartial` skip the `--deleted` call, and the bridge keeps that the folder is not a git work tree until it restarts, so a plain folder walks with no git process and a watcher event on it goes straight to the walk.
2. The 30 second quiet full read is armed only after a partial read, and is cleared when a full read starts or polling takes over, as the docs say.
3. Tests: a plain folder's read starts no git process after the first; a watcher event on a plain folder starts none; a full read after an event arms no quiet read; a partial read still arms one.

Run `npx vitest related --run` on every file you changed and `npm run build`; both must pass.

Files: server/index.js, tests/.

## The fixes from the owner's room audit (2026-11-12)

Each brief fixes findings of `docs/agents/AUDIT-2026-11-OWNER-ROOM.md`. Read only the findings it names. Work on a temporary runs folder and project, never on `%TEMP%\machineroom-runs`.

**P63. A lane the owner makes is on at once, and Dispatch offers only lanes that run (OpenCode).** Read no part of TASKS.md beyond this brief, and of the audit only findings 2, 3, 9 and 10. Use no subagents. Commit each step as you finish it, and stop starting new work at minute 35. Do not edit any file under `docs/`, `src/engine/`, nor `server/reviews.js`, `server/policy.js`, `server/runs.js` or `server/doctor.js`.

1. When `POST /api/lanes/create` makes a lane and this project has no active lane choice yet, the new lane becomes the choice (`[key]`), so `/api/agents`, `/api/control/agents`, Team, Dispatch and Auto see it at once. An existing choice is left as it is.
2. `projectRunLanes` in `src/ui/panels/runs.js` leaves out `orchestrator`.
3. Saving a team with no active choice uses the lanes the family tree shows as eligible and not hidden, instead of `[]`.
4. The Team tab sentence `New lanes are added in docs/agents/lanes.json.` becomes `New lanes are made in the family tree.`
5. Tests: after create on a project with no choice, `/api/control/agents` holds the key and Auto does not answer `Pick the lanes for this project first.`; a project with a choice keeps it; `projectRunLanes` has no orchestrator; a team saved with no choice holds the eligible lanes; the Team tab text.

Run `npx vitest related --run` on every file you changed and `npm run build`; both must pass.

Files: server/agents-config.js, server/active-lanes.js, server/teams.js, src/ui/panels/runs.js, src/ui/panels/AgentBuilder.jsx, tests/.

**P64. Briefs and policy patches read the owner's lanes (OpenCode).** Read no part of TASKS.md beyond this brief, and of the audit only findings 4, 5 and 8 and its "Also seen" paragraph. Use no subagents. Commit each step as you finish it, and stop starting new work at minute 35. Do not edit any file under `docs/` or `src/engine/`, nor `server/reviews.js`, `server/policy.js`, `server/runs.js` or `server/doctor.js`.

1. `src/ui/panels/briefs.js` matches a lane to a brief's owner by the agent's `harness` field when the caller passes agents, so a made key such as `claude-1` or `opencode-1` runs a brief owned by `claude` or `opencode`; a key with no harness field still uses the key as now.
2. `server/briefs.js` builds its lane map with `readAllLanes`, so `GET /api/control/brief-prompt` finds a made lane, and its refusal names the lanes the room has instead of `Choose hermes, opencode or agy.`
3. `src/policy/proposals.js` writes the patch headers with the policy file's path relative to the checkout, so a patch of `config/policy.json` names `config/policy.json`.
4. In `src/policy/route.js`, when the policy sends a tier only to the owner and the first free lane is taken, the reason says `The policy sends the TIER tier to you, so the first free lane was taken.`
5. Tests for each: `claude-1` runs a `claude` brief; the prompt route answers 200 for a made lane and its refusal names no fleet lane; the patch header; the reason sentence.

Run `npx vitest related --run` on every file you changed and `npm run build`; both must pass.

Files: src/ui/panels/briefs.js, server/briefs.js, src/policy/proposals.js, src/policy/route.js, tests/.

## Left from the night of 2026-11-12

**P65. Reviews, Auto and the doctor see the room's own lanes (OpenCode).** A redo of P60, which AGY left unfinished on `refs/heads/feat/p60-reviews-auto-and`: read that branch's diff against `refs/heads/main` first and take what is right. Read no part of TASKS.md beyond this brief, and of `docs/agents/AUDIT-2026-11-REVIEW-11.md` only findings 2, 4, 7 and 8. Use no subagents. Commit each step as you finish it, and stop starting new work at minute 50. Edit only the files listed below. Work on a temporary runs folder and project.

1. `server/reviews.js` builds its lane map with `readAllLanes` over `lanesFolder()`, so a lane the owner made can be reviewed and merged; the fallback to the development `docs/agents` is gone. A made lane's worktree is `worktreeFor(projectRoot, lane)`.
2. A policy names lanes, so it is read from the folder the lanes come from: `server/policy.js` and `server/runs.js` read `lanesFolder()/policy.json` and no longer a project's own `docs/agents/policy.json`. With no lane for a tier Auto says `There is no lane for the TIER tier. Make one in the room.`
3. `server/doctor.js` checks the program of every lane `readAllLanes` returns, and its next step line names no lane the room lacks.
4. `scripts/merge-lane.mjs` and `scripts/review-lane.mjs` name the lane file they read in their error.
5. Tests with a temp runs folder holding one made lane and the `config/` lanes: its review diff answers 200; Auto on MachineRoom's own checkout reads `config/policy.json`; the doctor lists the made lane's program; the error names the file read; with `MACHINEROOM_LANES_DIR=docs/agents` the fleet works as now.

Run `npx vitest related --run` on every file you changed, `npm run build` and `npm run pack-check`; all must pass.

Files: server/reviews.js, server/policy.js, server/runs.js, server/doctor.js, scripts/merge-lane.mjs, scripts/review-lane.mjs, tests/.

**P66. The run-lane stop test passes under load (OpenCode).** A redo of P59. Read no part of TASKS.md beyond this brief. Use no subagents. Commit each step as you finish it, and stop starting new work at minute 40. Edit only files under `tests/`, and `scripts/run-lane.mjs` only if a test proves a real fault there. Run every command in the foreground and wait for it to end: your session is over the moment you stop, so never end a turn while a run is still going.

`tests/run-lane-stop.test.js` fails now and then while other lanes run their suites and passes on a retry. Run the file 15 times alone and 8 times with `node scripts/test.mjs` running beside it, find which test fails and why (a fixed wait, a process not yet started, a shared temp folder), and make it wait for the state it needs with the file's own `waitUntil`, never a busy loop and never a longer timeout alone. Give the runs and failures before and after in your report.

Files: tests/run-lane-stop.test.js, tests/helpers/, scripts/run-lane.mjs.

**P67. The cost of the deleted-file list, measured alone (OpenCode).** The redo of P55, which the time limit cut while four other lanes loaded the machine. Read P55 above for what to measure and no other part of TASKS.md. Use no subagents. Change no code but `scripts/scale-live.mjs`. Run every command in the foreground and wait for it; a turn that ends while a command still runs leaves nothing. Commit by minute 70.

1. Start from the unfinished work: `git merge --ff-only refs/heads/feat/p55-what-a-deleted` if it applies, else `git cherry-pick 1cfdc0d7`. Read what it added to `scale-live`, finish only what the table needs, and commit.
2. Measure in this order and write each number to the audit file as you get it, with a commit after each row: 40,000 files on `refs/heads/main`, 40,000 on the commit before the P51 merge (a temp worktree, removed after), then 200,000 on each. Three runs each and the median; when minute 50 has passed, one run of what is left and say so in the table.
3. `docs/agents/AUDIT-2026-11-TREE-COST.md`: the table, what grew and by how much, and at most two ways to cut it if a full read costs more than 10 percent over the commit before P51. No other lane runs, so say the numbers are from a quiet machine.

Run `npx vitest related --run scripts/scale-live.mjs` and `npm run build`; both must pass.

Files: scripts/scale-live.mjs, docs/agents/AUDIT-2026-11-TREE-COST.md.

**P68. The deleted-file list takes a tenth of the time (OpenCode).** Read no part of TASKS.md beyond this brief, and of `docs/agents/AUDIT-2026-11-TREE-COST.md` only `What grew` and `Ways to cut it`. Use no subagents. Run every command in the foreground and wait for it. Commit each step as you finish it, and stop starting new work at minute 40. In `server/index.js` change only the tree read.

Since P51 a tree read asks `git ls-files --deleted` for the tracked files missing from the folder, and that makes a full read about five times as long. `git diff --name-only -z --diff-filter=D` gives the same names in a tenth of the time.

1. Before any change: `node scripts/scale-live.mjs --files 40000 --folders 4000 --seed 36 --tree-only --keep`, and write down the full read's time.
2. `readTree` and `readTreePartial` get the deleted names from `git diff --name-only -z --diff-filter=D --no-ext-diff --no-textconv`, with `-- NAMES` and literal pathspecs for the partial read as the list has now. Start it the way the list starts git: the same git path, time limit and buffer. A diff that fails leaves the list as it is, as a failed `--deleted` does now. A plain folder still starts no git after the first read (P62), and the two calls of a full read still run side by side.
3. Tests, by what they prove: a tracked file deleted from the folder is not in a full read; it is not in a partial read of its name; a file removed with `git rm` is in neither; a name that starts with `-` is read as a path; the command carries `--no-ext-diff` and `--no-textconv`; a failed diff keeps the list. Keep the P51 and P62 tests passing, changing only the arguments they expect.
4. The same command as step 1 after the change, then once with `--files 200000 --folders 20000`. Remove the kept checkouts. Report the three numbers; a full read at 40,000 files should be under 700 ms.

Run `npx vitest related --run` on every file you changed and `npm run build`; both must pass.

Files: server/index.js, tests/.


## Review 12 (2026-11-12, before the push)

**P69. Review the merges of P65 to P68 (OpenCode).** Read no part of TASKS.md beyond this brief. Use no subagents. Change no code. Run every command in the foreground. Commit the file by minute 35.

Read `git log --first-parent ab673388..refs/heads/main` and review the code the merges of P65, P66, P67 and P68 brought, with `git show -m --first-parent SHA`, against the code around it. Skip the commits that touch only `docs/`. Hunt for what a test would not show: a review, merge, Auto or doctor path that now refuses or misses a lane the owner made, or reads a policy from a folder that does not hold one and fails instead of falling back; a made lane reviewed in the wrong worktree; a tree read where `git diff --diff-filter=D` and the old `git ls-files --deleted` disagree (a renamed file, a file removed with `git rm`, a submodule, a path with a space, a bracket or a star, an unmerged path, a sparse checkout, a repository with no commit yet), or where the diff writes to the index or runs a filter; a full read that now waits on the diff when the list has already failed; a stop test in `tests/run-lane-stop.test.js` that can pass when the stop did nothing; and a `scale-live` flag that changes the default run's numbers. Run a finding's test or a short script in a temp folder when one would settle it, and say which findings you proved and which you only read. Write `docs/agents/AUDIT-2026-11-REVIEW-12.md`: a table of at most 8 findings, the one that would hurt the owner most first, each with `file:line`, what goes wrong and when, and the smallest fix; mark each one as a push blocker or not. Write no finding you cannot point to in the code. An empty table with what you checked is a good answer.

Files: docs/agents/AUDIT-2026-11-REVIEW-12.md.

**P70. The fixes from review 12 (OpenCode).** Read no part of TASKS.md beyond this brief, and of `docs/agents/AUDIT-2026-11-REVIEW-12.md` only findings 1, 4, 5 and 7, its smaller notes and the orchestrator's corrections. Use no subagents. Run every command in the foreground. Commit each step as you finish it, and stop starting new work at minute 40. Work on a temporary runs folder and project, never on `%TEMP%\machineroom-runs`.

1. Finding 1: `scripts/review-lane.mjs` and `scripts/merge-lane.mjs` read the lanes with `readAllLanes`, and a made lane with no `worktree` uses `worktreeFor(root, lane)`, so `npm run review-lane -- LANE` and `npm run merge-lane -- LANE` work for a lane the owner made.
2. Finding 5: `createReviewsApi` gets `lanesSourceObject.folder` as its last runs folder fallback, as `createAgentsConfigApi` does.
3. Finding 7: when the list fails, `readTree` walks the disk without waiting for the deleted names.
4. Finding 4: the test `harness hangs after its result line` in `tests/run-lane-stop.test.js` reads the started pid, waits for it to be alive, stops, then checks it is gone and, on Windows, that `record.stoppedLeftovers` is above 0.
5. The smaller note: `parseLiveArgs` in `scripts/scale-live.mjs` refuses `--server` followed by nothing or by a flag, with `--server needs a folder.`
6. Tests, by what they prove: the CLI review and merge of a made lane find it; reviews lists a made lane of a bridge started with `lanesSource: { folder }`; a failed list walks in under 100 ms when the deleted names take 500 ms; the hanging-result test fails when the stop kills nothing; `--server --tree-only` is refused.

Run `npx vitest related --run` on every file you changed, `npm run build` and `npm run pack-check`; all must pass.

Files: scripts/review-lane.mjs, scripts/merge-lane.mjs, server/reviews.js, server/index.js, scripts/scale-live.mjs, tests/.


## Two findings from GPT 6.1 Sol's review (2026-11-12)

Sol read `fc3f87a6` and found both; the orchestrator checked each in the code. Both touch `server/index.js`, so they start after P70 is merged, and P72 after P71.

**P71. The project switch sees a run started from the command line (OpenCode).** Read no part of TASKS.md beyond this brief. Use no subagents. Run every command in the foreground. Commit each step as you finish it, and stop starting new work at minute 25. Work on a temporary runs folder and project, never on `%TEMP%\machineroom-runs`.

`createProjectsApi` in `server/index.js` gets `lanesSource: () => lanesSourceObject`, the lane settings, which has no `openRuns`. So `POST /api/projects/open` in `server/projects.js` never sees a run that `npm run run-lane` started, and the room can switch projects under it. The git and control routes already get the live source (`() => lanesSource`).

1. Pass `lanesSource: () => lanesSource` to `createProjectsApi`, as the git routes do.
2. Tests, by what they prove: with a bridge started with the lane source on and a run the source has opened (a run log growing in its runs folder, as `tests/live-runs.test.js` drives one), opening another project answers 409 with `A lane run is open. Stop it or wait, then open the project.` and `onOpenProject` is never called; after the source finishes that run, the same request answers 200 and calls it once; a bridge with the lane source off still opens a project.

Run `npx vitest related --run` on every file you changed and `npm run build`; both must pass.

Files: server/index.js, tests/.

**P72. A reconnect brings the file list up to date (OpenCode).** Read no part of TASKS.md beyond this brief. Use no subagents. Run every command in the foreground. Commit each step as you finish it, and stop starting new work at minute 40. Change nothing in `src/engine/`.

The page asks `/events?...&since=V` with the tree version of its first `/api/tree` read, and no tree event moves that version (`src/live/bridge.js`). The bridge keeps only 4 tree versions (`TREE_VERSIONS_KEPT`), so after five changes every reconnect sends an expired version, `treeFilesSince` answers null, and the bridge sends nothing (`server/index.js`, the `since` branch of `/events`). Files added or deleted while the page was away stay wrong until the page reloads; a later change brings only its own file.

1. Every tree event the bridge writes, delta or full, carries `version`: the tree version it brings the page to.
2. `openBridge` keeps the newest `version` it read, from the first read or a tree event, and its next stream asks `since` that version.
3. When `since` is expired or unknown and the bridge has a tree, it writes one full tree event (`treeEvent(lastTree, null, shape)`, with `full: true` and `version`) and counts the client as at the current version. A current `since` still gets only the delta, and an equal one nothing.
4. Tests, by what they prove: a client that applied a tree event reconnects with that event's version; a reconnect within the kept versions gets the additions and deletions it missed and no full list; a reconnect with an expired version gets one full list with no new file change; the page replaces its files on that full list (`player.replaceFiles`); a tree event with no `version` from an older bridge leaves the cursor where it was.

Run `npx vitest related --run` on every file you changed and `npm run build`; both must pass.

Files: server/index.js, src/live/bridge.js, src/live/tree.js, tests/.


## Codex as a lane (2026-11-12)

The owner gave the fleet a Codex lane. Codex here is the owner's Codex app: its `codex.exe` lives in `%LOCALAPPDATA%\OpenAI\Codex\bin\HASH\codex.exe`, where HASH changes when the app updates, and `codex` is not on PATH. `codex exec` waits for more input when its stdin is open; the runner already starts a harness with stdin closed.

**P73. A Codex lane finds the Codex app's program (Codex).** Read no part of TASKS.md beyond this brief. Do not commit: your sandbox keeps git read-only, so leave your work uncommitted in your worktree and the orchestrator commits it. Stop starting new work at minute 35. Run every command in the foreground and wait for it. `src/harnesses/` stays browser safe: no `fs`, no `process` there.

1. One function in `server/agents-config.js`, `codexAppProgram({ env, platform, listDir, statFile })`: on Windows, the newest `codex.exe` under `%LOCALAPPDATA%\OpenAI\Codex\bin\*\`, by the file's modified time; null on other systems, when the variable is not set, or when there is none.
2. `isHarnessAvailable('codex', ...)` answers true when the lane's program is not found but `codexAppProgram` finds one.
3. `scripts/run-lane.mjs` starts that program for a lane with `cli.harness` `codex` whose `cli.bin` is `codex` (or unset) and is not on PATH, and its dry run prints it with `%LOCALAPPDATA%` in place of the folder. A `cli.bin` that names a path is started as it is.
4. Tests, by what they prove: the newest of two hash folders wins; no folder, no variable or another system gives null; a lane with `bin: "codex"` and no `codex` on PATH runs the app's program in a dry run; a lane with a full `bin` path is left alone; the availability check finds the app's program. Use temp folders and pass `env`, never the real `%LOCALAPPDATA%`.
5. Start the real program once with `--version` on this machine and give its first line in your report.

Run `npx vitest related --run` on every file you changed and `npm run build`; both must pass.

Files: server/agents-config.js, scripts/run-lane.mjs, tests/.

**P74. A Codex lane can commit, and its run is recorded (OpenCode).** Read no part of TASKS.md beyond this brief and the paragraph above P73. Use no subagents. Run every command in the foreground. Commit each step as you finish it, and stop starting new work at minute 30. `src/harnesses/` stays browser safe.

The first Codex run stopped at once: `git switch -c` failed with access denied on `.git/worktrees/codex/index.lock`, because Codex's `workspace-write` sandbox lets it write only the worktree, and a worktree's git data lives in the main checkout's `.git`. `codex exec` takes `--add-dir DIR` for more writable folders. Separately, `scripts/recording-files.mjs` refuses a `codex` lane with `has no command line`, so its run gets no recording.

1. `codexHarness.command` in `src/harnesses/codex.js` adds `--add-dir DIR` before the prompt for each string in `cli.addDirs`, expanded with `expandBin` as `bin` is. Nothing else in its arguments changes.
2. `laneOf` in `scripts/recording-files.mjs` accepts a `codex` lane. Read how it records an `opencode` or `claude` run and make a Codex run's log into a recording the same way, with the frames `createCodexParser` gives; if that needs more than the harness check, stop and say what is missing in your report.
3. Tests, by what they prove: a lane with two `addDirs` gives two `--add-dir` pairs before the prompt; a lane with none gives the same arguments as now; an `addDirs` entry with `%LOCALAPPDATA%` is expanded; a recorded Codex run log (write a short one with `thread.started`, a `command_execution` item and `turn.completed`) becomes a recording.

Run `npx vitest related --run` on every file you changed and `npm run build`; both must pass.

Files: src/harnesses/codex.js, scripts/recording-files.mjs, tests/.

**P75. The runner commits a sandboxed lane's work (OpenCode).** Read no part of TASKS.md beyond this brief and the paragraph above P73. Use no subagents. Run every command in the foreground. Commit each step as you finish it, and stop starting new work at minute 40. Work on a temporary repository and runs folder, never on `%TEMP%\machineroom-runs`.

The codex lane runs in Codex's sandbox, which keeps git read-only, so it leaves its work uncommitted and the orchestrator puts it on a branch by hand. The runner should do that. A lane says it needs this with `"commits": "runner"` in its `cli` block.

1. In `scripts/run-lane.mjs`, after a brief run of a lane with `cli.commits` `runner` ends with exit code 0: if its worktree has changes, switch the worktree to a new branch named by `branchFor(brief)` from `src/briefs/briefs.js`, add every change and commit with the subject `0.1.402: ` and the brief's title, and the body `Written by the LANE lane in its sandbox; committed by the runner.` Use `gitPath()`, `--no-verify` is not used, and a commit that fails leaves the files as they are and prints `The runner could not commit the LANE lane's work: REASON` in the run output.
2. The run record names the new branch and commit as a lane's own commit would, so `merge-lane`, `review-lane` and the recording find them. A run with no changes commits nothing and says `The LANE lane changed no file.`
3. A lane without `cli.commits` behaves exactly as now.
4. Add `"commits": "runner"` to the `codex` lane's `cli` in `docs/agents/lanes.json`. Then run `npx vitest related --run docs/agents/lanes.json tests/plan.test.js tests/lanes-source.test.js`.
5. Tests, by what they prove, with a fake harness that writes a file and exits 0: a `runner` lane's change ends on the brief's branch in one commit with that subject and body, and the record names it; a fake that writes nothing gives no commit and the sentence; a fake that exits 1 commits nothing; a lane without the field is left uncommitted as now.

Run `npx vitest related --run` on every file you changed, `npm run build` and `npm run pack-check`; all must pass.

Files: scripts/run-lane.mjs, docs/agents/lanes.json, tests/.


## The runs folder leaves the temp folder (2026-11-12)

On 2026-11-12 a cleanup of the C drive emptied `%TEMP%`, and with it the owner's room: `agents.json` with the lane the owner made, `keys.json` with the owner's key, and every run record. A temp folder is the place cleaners empty first, and the room keeps state there that cannot be rebuilt. The owner said yes to moving it.

**P76. The room keeps its runs folder outside the temp folder (OpenCode).** Read no part of TASKS.md beyond this brief and the paragraph above it. Use no subagents. Run every command in the foreground. Commit each step as you finish it, and stop starting new work at minute 45. Work on temporary folders passed through `env`, never on the real `%LOCALAPPDATA%`, `%TEMP%` or home folder.

1. `runsFolder(env)` in `server/lanes-source.js` answers `MACHINEROOM_RUNS` when it is set, as now. Otherwise, on Windows `%LOCALAPPDATA%\MachineRoom\runs`; on other systems `$XDG_STATE_HOME/machineroom/runs`, or `~/.local/state/machineroom/runs` when that variable is not set. When none of those can be found, the temp folder as now.
2. The six other places that build `TEMP\machineroom-runs` themselves (`server/harness-models.js:28`, `server/orchestrator.js:284`, `server/orchestrators.js:69`, `scripts/mcp-bridge.mjs:29`, `scripts/mr-agent.mjs:386` and `:1016`, `scripts/run-recording.mjs:16`) call `runsFolder` instead, so there is one answer. `scripts/mr-agent.mjs` may import it only if that keeps it a single file that runs alone; if not, it gets a copy of the same rule with a test that the two agree.
3. The first time the bridge or a lane command finds no folder at the new place and a folder at the old `TEMP\machineroom-runs`, it copies the old folder there, once, and prints `Moved the runs folder from OLD to NEW.` with `%TEMP%` and `%LOCALAPPDATA%` in place of the real folders. It never deletes the old folder and never copies over an existing new one.
4. `docs/agents/architecture/LIVE.md` and `docs/GUIDE.md` name the new place; read only the lines that name `machineroom-runs`.
5. Tests, by what they prove: each system's answer with and without its variables; `MACHINEROOM_RUNS` still wins; the six callers give the same folder as `runsFolder`; the copy happens once, keeps the old folder, and never overwrites a new one; no path in a printed line holds the real folder names.

Run `npx vitest related --run` on every file you changed, `npm run build` and `npm run pack-check`; all must pass.

Files: server/lanes-source.js, server/harness-models.js, server/orchestrator.js, server/orchestrators.js, scripts/mcp-bridge.mjs, scripts/mr-agent.mjs, scripts/run-recording.mjs, docs/agents/architecture/LIVE.md, docs/GUIDE.md, tests/.


## The model list, and buttons that stop working (2026-11-12)

The owner asked for a model list with details, search, sorting and pinning, like AIRP's (`C:\GitHub\AIRP\lib\widgets\model_selector.dart` and `lib\services\strategies\openrouter_strategy.dart`; AIRP is read only). AIRP keeps, per model, its name, context length, prompt and completion price and creation date; its picker searches name and id, sorts by name A to Z and Z to A, price low to high and high to low, and newest, and puts bookmarked models first. MachineRoom keeps only model ids (`modelIdsFromAnswer` in `server/endpoints.js`) and shows them in a plain `<select>`. The owner also found that with the page scrolled down, away from the lens, the Settings buttons do nothing until the page is scrolled up. P77 and P79 can run together; P78 starts after P77.

**P77. The bridge keeps model details and pins (OpenCode).** Read no part of TASKS.md beyond this brief and the paragraph above it. Use no subagents. Run every command in the foreground. Commit each step as you finish it, and stop starting new work at minute 40. Work on a temporary runs folder, never on a real one.

1. `fetchEndpointModelList` keeps, for each model the answer gives, `{ id, name, contextLength, promptPrice, completionPrice, created }`: numbers or null, prices per token as the provider sends them, `name` falling back to the id. An answer of plain ids still works. `endpoints.json` keeps the ids as now and the details beside them in `modelDetails`, capped at the same `MAX_ENDPOINT_MODELS`, each string cut to 200 characters.
2. `GET /api/endpoints/NAME/models` answers the details with the ids.
3. Pins: `GET /api/model-pins` answers `{ pins: [...] }` and `PUT /api/model-pins` with `{ pins }` saves them in `model-pins.json` in the runs folder; at most 200 pins, each a string of at most 200 characters, refused with `A pin is a model name of at most 200 characters.` otherwise. The route takes the same write guard the other settings writes take.
4. Tests, by what they prove: an OpenRouter-shaped answer keeps all five details; an answer of ids keeps ids and nulls; a huge description or name is cut; pins save, read back and refuse a bad list; an old `endpoints.json` without details still loads.

Run `npx vitest related --run` on every file you changed and `npm run build`; both must pass.

Files: server/endpoints.js, server/index.js, tests/.

**P78. A model picker with search, sort and pins (OpenCode).** Starts after P77 is merged. Read no part of TASKS.md beyond this brief and the paragraph above P77. Use no subagents. Commit each step as you finish it, and stop starting new work at minute 50. Fonts Jost and Space Mono at 400 and 500, never bold; colours from `docs/agents/ARCHITECTURE.md`, Conventions.

1. One component, `src/ui/ModelPicker.jsx`, in place of every `<select>` that lists an endpoint's models in `src/ui/FamilyTree.jsx` and `src/ui/EndpointsPanel.jsx`: a button that shows the chosen model and opens a list with a search box (name and id, as you type), a sort menu (Name A to Z, Name Z to A, Price low to high, Price high to low, Newest, Context largest), and a pin button on each row. Pinned models come first in any sort; the chosen model shows at the top.
2. Each row: the name, the id in Space Mono, the context as `128K`, the price per million tokens as `$0.27 / $1.10` in and out, `free` when both are 0, and the date as `2026-10`. A model with no details shows its id alone.
3. Pins load from and save to `/api/model-pins`; the sort choice is kept in `localStorage` (wrapped in try).
4. Keyboard: the search box takes focus on open, Up and Down move, Enter picks, Escape closes.
5. Tests, by what they prove: search narrows by name and by id; each sort order; pinned first in every sort; a row's labels for a priced, a free and a bare model; Enter picks and Escape closes. Name the by-eye checks for the orchestrator at 1280 by 800: the list with 468 models, a search, a pin.

Run `npx vitest related --run` on every file you changed and `npm run build`; both must pass.

Files: src/ui/ModelPicker.jsx, src/ui/FamilyTree.jsx, src/ui/EndpointsPanel.jsx, src/styles.css, tests/.

**P79. Buttons work with the page scrolled down (OpenCode).** Read no part of TASKS.md beyond this brief and the paragraph above P77. Use no subagents. Commit each step as you finish it, and stop starting new work at minute 40. Change nothing in `src/engine/` beyond what the cause needs, and name the cause in your report.

The owner's window is about 620 pixels high, below the 900 at which the page stops scrolling. With the page scrolled to the bottom, Settings (open with the gear) shows its buttons, but Save key, Refresh models, Replace key, Delete and Custom endpoint do nothing; scrolled back up, they work.

1. Find the cause: in the headless Chromium the screenshot script uses, at 1280 by 620, open Settings, scroll the page to the bottom and ask `document.elementFromPoint` at the centre of each of those buttons. Write in your report which element takes the click and why (a layer over the panel, a pointer handler on the lens that keeps the event, or a panel placed by a rectangle measured before the scroll).
2. Fix that cause, so every button in Settings and in the lower half works at any scroll position.
3. Tests, by what they prove: the element at each button's centre is the button with the page scrolled to the bottom, in a jsdom or Chromium test, whichever can show the cause.

Run `npx vitest related --run` on every file you changed and `npm run build`; both must pass.

Files: the files the cause is in, src/styles.css, tests/.

**P80. Review the merges of P70 to P75 (MachineRoom native).** Read no part of TASKS.md beyond this brief. Change no code. Read only the diffs named here and the code around each change. Write the file by minute 30.

Review the code the merges `23bad3c1` (P70), `580a28cf` (P71), `909f00fa` (P74), `1e027045` (P72), `3bb13972` (P73) and `b6bd90f7` (P75) brought, with `git show -m --first-parent SHA` for each, against the code around it. Hunt for what a test would not show: a path that still refuses a lane the owner made; a reconnect that sends the full file list more often than it must, or never; a project switch that a run can still slip past; a Codex program search that picks the wrong `codex.exe` or reads a folder it should not; a runner commit that adds files it should not (a log, a key, a build folder) or commits on the wrong branch; and anything that writes outside the runs folder or the worktree. Write `docs/agents/AUDIT-2026-11-REVIEW-13.md`: a table of at most 8 findings, the most harmful first, each with `file:line`, what goes wrong and when, and the smallest fix, each marked as a push blocker or not. Write no finding you cannot point to in the code. An empty table with what you checked is a good answer.

Files: docs/agents/AUDIT-2026-11-REVIEW-13.md.


## The chat: message actions, talking to a lane, and the messages between agents (2026-11-12)

The owner asked for copy, branch and retry on chat messages, for a way to talk to a lane directly, and to see the messages agents send each other. The chat is `src/ui/OrchestratorChat.jsx` with its pure helpers in `src/ui/orchestratorChat.js`; the conversation lives in the bridge (`server/orchestrator.js`, `server/orchestrators.js`, routes under `/api/orchestrator`). The bridge already announces agent messages for the room's stars (`announce(from, to, kind)` with `order`, `report`, `wake` and `dispatch`), but their text never reaches the chat. P82 starts after P81, since both change the chat.

**P81. Copy, retry and branch on chat messages (OpenCode).** Read no part of TASKS.md beyond this brief and the paragraph above it. Use no subagents. Run every command in the foreground. Commit each step as you finish it, and stop starting new work at minute 50. Fonts Jost and Space Mono at 400 and 500, never bold; colours from `docs/agents/ARCHITECTURE.md`, Conventions.

1. Each message in the chat shows, on hover and on keyboard focus, small text buttons: `Copy` on every message, which puts its text on the clipboard and says `Copied` for 2 seconds; `Retry` on the newest reply and on a `The orchestrator stopped: ...` line, which sends the user message before it again; `Branch` on every message, which starts a new conversation that holds the messages up to and including that one.
2. Branch in the bridge: `POST /api/orchestrator/sessions/branch` with `{ index }` makes a new conversation, keeps the old one in the sessions list, and puts the earlier messages into the new one. A harness that keeps its own session (Claude Code, OpenCode) starts a fresh session whose first turn carries the earlier messages as a quoted transcript, cut to the context budget the chat already uses; the native harness takes them as its message history. The title is the old title with ` (branch)`.
3. Retry while a turn runs is refused with `Wait for the turn to end, or stop it.`; retry of a message with no user message before it is not offered.
4. Tests, by what they prove: copy writes the exact text; retry resends the right message and is refused while a turn runs; branch at message 3 of 6 gives a new conversation of 3 and keeps the old one of 6; the quoted transcript stays inside the budget; the buttons reach the keyboard.

Run `npx vitest related --run` on every file you changed and `npm run build`; both must pass. Name the by-eye checks for the orchestrator at 1280 by 800.

Files: src/ui/OrchestratorChat.jsx, src/ui/orchestratorChat.js, src/styles.css, server/orchestrator.js, server/orchestrators.js, tests/.

**P82. Talk to a lane, and see the messages between agents (OpenCode).** Starts after P81 is merged. Read no part of TASKS.md beyond this brief and the paragraph above P81. Use no subagents. Run every command in the foreground. Commit each step as you finish it, and stop starting new work at minute 50.

1. The chat's composer gets a `To` choice: the orchestrator (the default), each sub orchestrator, and each lane of the room that can run. A message to a lane starts that lane on the message as its task, the way Dispatch does with a typed task, and the lane's reply shows in the chat under the lane's name and colour. A lane already running answers `That lane is working. Wait for it, or stop it.`
2. Every agent message the bridge announces (`order`, `report`, `wake`, `dispatch`) also reaches the chat as one line with its text: `Orchestrator to Coder, order: TEXT`, in Space Mono, with the sender's colour, folded to its first 3 lines with `Show all`. Find where each kind's text is made and carry it with the announcement; a kind with no text shows its kind alone.
3. A `Show agent messages` toggle in the chat hides or shows those lines; the choice is kept in `localStorage` (wrapped in try).
4. Tests, by what they prove: a message to a lane starts it with that text and its reply lands in the chat; a busy lane refuses with the sentence; an order, a report, a wake and a dispatch each reach the chat with their text; the toggle hides them.

Run `npx vitest related --run` on every file you changed and `npm run build`; both must pass. Name the by-eye checks for the orchestrator at 1280 by 800.

Files: src/ui/OrchestratorChat.jsx, src/ui/orchestratorChat.js, src/styles.css, server/orchestrator.js, server/orchestrators.js, server/index.js, tests/.

**P83. The chat holds the conversation, and the work folds away (OpenCode).** Starts after P81 is merged, before P82. Read no part of TASKS.md beyond this brief and the paragraph above P81. Use no subagents. Run every command in the foreground. Commit each step as you finish it, and stop starting new work at minute 45.

The owner sees every terminal line of a turn saved into the chat, so the conversation drowns in tool output. The owner sent a message, saw nothing happen at the bottom, and found by scrolling up that the turn was already working.

1. Find where a turn's tool calls and their output enter the chat's messages or reply text (`server/orchestrator.js` and the harness `reply` functions it calls), and keep them out: a turn leaves in the chat the owner's message and the agent's final answer, nothing else.
2. A turn's work shows as one line under the owner's message: `Working: STEP` while it runs, the newest step only, and `Worked: N steps, M s` when it ends, in Space Mono. It opens to the list of steps (the tool and its target, one line each, no output), and closes again.
3. Sending a message scrolls to the bottom. While a turn runs, the view stays at the bottom unless the owner scrolled up; then a `Jump to newest` button shows at the bottom edge. The working line and a reply always land at the bottom.
4. Old conversations that already hold terminal lines still show, unchanged.
5. Tests, by what they prove: a turn with five tool calls leaves two messages and one folded line of 5 steps; the working line shows the newest step; a sent message scrolls to the bottom; scrolled up, new lines do not move the view and the button shows.

Run `npx vitest related --run` on every file you changed and `npm run build`; both must pass. Name the by-eye checks for the orchestrator at 1280 by 800.

Files: src/ui/OrchestratorChat.jsx, src/ui/orchestratorChat.js, src/styles.css, server/orchestrator.js, src/harnesses/, tests/.

**P84. A closed agent chip shows only its state (OpenCode).** Read no part of TASKS.md beyond this brief. Use no subagents. Run every command in the foreground. Commit each step as you finish it, and stop starting new work at minute 35. Change only `src/engine/terminals.js`, `src/styles.css` and tests.

The owner finds the chip beside each agent repeats the agent's name, which the label under the agent already shows. The owner chose a small state-only chip over removing it, since the chip is also how the owner opens an agent's terminal log.

1. A closed chip shows the state dot and the state word only (`WORKING`, `FINISHED`, `FAILED`, `IDLE`, as the chip shows them now), with no name. `chipTitle` answers an empty label for a closed chip; an open chip keeps its title (`NAME // STATUS`) and its log as now.
2. The closed chip shrinks to fit: `CHIP_W` becomes the width of the longest state word plus the dot and the padding, and `chipHalfWidth(false)` follows it, so the thin line still meets the chip's edge.
3. The chip keeps its `aria-label` with the agent's name and state, so a screen reader still hears whose chip it is, and a click still opens it.
4. The finished, failed and working colours stay as they are.
5. Tests, by what they prove: a closed chip's title is empty and its aria label holds the name; an open chip's title is unchanged; `chipHalfWidth(false)` is smaller than before and `chipHalfWidth(true)` unchanged. Name the by-eye checks for the orchestrator at 1280 by 800: a working, a finished and a failed chip, and an open one.

Run `npx vitest related --run` on every file you changed and `npm run build`; both must pass.

Files: src/engine/terminals.js, src/styles.css, tests/.

**P85. The session that starts the lanes sits at the top (OpenCode).** Read no part of TASKS.md beyond this brief. Use no subagents. Run every command in the foreground. Commit each step as you finish it, and stop starting new work at minute 50. Work on temporary runs folders and projects.

The owner watches the testbench room while the orchestrator, a Claude Code session in the main checkout, starts the fleet's lanes with `npm run run-lane`. The room shows that session as a side agent (`CLAUDE-SESSION`, from the sessions source) and its own idle orchestrator at the top, so the owner cannot see who runs the lanes. The owner wants the session that starts the lanes at the orchestrator's place, with the lanes under it.

1. `scripts/run-lane.mjs` writes `startedBy` into the run's record and its first log frame: `{ harness: 'claude', session: CLAUDE_CODE_SESSION_ID }` when that variable is set, `{ harness: 'opencode', session: ... }` when an OpenCode session variable is set (find its name in `server/opencode-sessions*.js` or the OpenCode docs the code cites), and nothing when neither is.
2. The lane source carries `startedBy` with the run. The sessions source names its agent so the two can be matched (the session id is already in its key).
3. In the room, when the room's own orchestrator is idle and a session started a lane run that is open now or ended in the last 10 minutes, that session takes the orchestrator's place at the top of the hub, and the room's orchestrator takes the session's old slot. The lane-start star and the lane's line run from that session. When the room's orchestrator starts a turn, it takes the top again. Find the placement code (search `src/model` and `src/engine/agents.js` for where the orchestrator's place is chosen) and keep the rule pure and tested there.
4. The Agents tab lists a session that started a lane run, under the orchestrator, with its state and its newest step, so the owner can find it there as well as in the room.
5. Tests, by what they prove: the Agents tab lists the matched session; a run started with `CLAUDE_CODE_SESSION_ID` set records it, one without records nothing; a matched session takes the top while the orchestrator is idle and gives it back when a turn starts; a session with no run in 10 minutes stays at the side; the lane-start star comes from the session.

Run `npx vitest related --run` on every file you changed and `npm run build`; both must pass. Name the by-eye checks for the orchestrator at 1280 by 800: a testbench room served with `MACHINEROOM_RUNS` and `MACHINEROOM_LANES_DIR` set, while a lane runs.

Files: scripts/run-lane.mjs, server/lanes-source.js, server/claude-sessions.js, the placement code it finds in src/model/ or src/engine/agents.js, src/ui/FamilyTree.jsx, tests/.

**P86. A command's text is not a file touch (OpenCode).** Read no part of TASKS.md beyond this brief. Use no subagents. Run every command in the foreground. Commit each step as you finish it, and stop starting new work at minute 35. Change only `src/model/commands.js` and tests.

The owner watched the orchestrator in the room and saw it write `run-lane.mjs`, which it never did. Its command was `cat > SCRATCH/p85.md <<'EOF'` followed by a brief that names `run-lane.mjs`, `lanes-source.js` and `claude-sessions.js`. `touchesForCommand` removes PowerShell here-strings (`withoutHereStrings`) but not bash heredocs, so every file named in the body counts as touched, and as written because the `>` comes first.

1. Remove bash heredoc bodies before the files are matched: `<<WORD`, `<<'WORD'`, `<<"WORD"` and `<<-WORD`, up to the line that holds only `WORD` (with leading tabs for `<<-`), or to the end when there is none.
2. A write operator writes only the file it points at: in `cmd > FILE`, `>> FILE`, `| tee FILE` and `Out-File FILE`, only FILE is written; other files the segment names stay reads.
3. Files named inside an inline program (`python -c "..."`, `node -e "..."`, `node --eval`, `pwsh -Command "..."`) are reads unless that program's own text opens them for writing, which the parser does not try to tell: keep them reads.
4. Tests, by what they prove: the owner's case above gives one write of `p85.md` (if it is in the tree) and no touch of the three names; `cat <<-EOF` with tabs; a heredoc with no end line; `echo a > out.txt; cat in.txt` writes out.txt and reads in.txt; `node -e "...writeFileSync('x.js')"` reads x.js only; the old here-string and message tests stay as they are.

Run `npx vitest related --run src/model/commands.js` and `npm run build`; both must pass.

Files: src/model/commands.js, tests/.


## Twelve lanes (2026-11-12, evening)

The owner asked for twelve lanes at once before the computer shuts down: six OpenCode, three AGY, Codex as the orchestrator's planner, and two native lanes on OpenRouter. These briefs are small and touch different files, so they run side by side; timings measured tonight are high, since the machine is loaded.

**P87. Why a lane's worktree moved to an old branch (AGY).** Read no part of TASKS.md beyond this brief. Change no code. Use no subagents. Run every command in the foreground. Write the file by minute 40.

On 2026-11-12 at 21:04 the `opencode` lane committed P75 on `feat/p75-the-runner-commits`. At 21:05 the runner crashed, because a disk cleanup had deleted its runs folder (`ENOENT ... runs.jsonl`). At 21:06:26 the reflog of `.worktrees/opencode` shows `checkout: moving from feat/p75-the-runner-commits to feat/p70-the-fixes-from`, an old merged branch. Read `scripts/run-lane.mjs` from the end of a run to its exit, and every place that switches a worktree's branch (`switch`, `checkout`, the move to a detached `refs/heads/main` before a run), and find what can switch a worktree to a branch named in an older run record when the newest record is missing. Prove it with a temp repository and runs folder if you can. Write `docs/agents/AUDIT-2026-11-WORKTREE-SWITCH.md`: what switched it, `file:line`, when it can happen again, and the smallest fix; or, if nothing in the code can, say so and list what else ran.

Files: docs/agents/AUDIT-2026-11-WORKTREE-SWITCH.md.

**P88. A native lane's run is recorded (AGY).** Read no part of TASKS.md beyond this brief. Use no subagents. Run every command in the foreground. Commit each step as you finish it, and stop starting new work at minute 30. Edit only the files listed.

`scripts/recording-files.mjs:31` refuses a `machineroom` lane with `has no command line, so its run cannot be recorded.`, so the native lanes' runs get no recording.

1. `laneOf` accepts a `machineroom` lane, and its run log becomes a recording with the frames `createClaudeParser` gives, as the machineroom harness reads its own log.
2. Tests, by what they prove: a short machineroom run log (an assistant line, a tool call, a result) becomes a recording; an unknown harness is still refused with the same sentence.

Run `npx vitest related --run scripts/recording-files.mjs` and `npm run build`; both must pass.

Files: scripts/recording-files.mjs, tests/run-recording.test.js.

**P89. The native agent stops at a cost limit (AGY).** Read no part of TASKS.md beyond this brief. Use no subagents. Run every command in the foreground. Commit each step as you finish it, and stop starting new work at minute 35. Edit only the files listed.

The native lanes run on the owner's OpenRouter key and `scripts/mr-agent.mjs` has a step limit but no cost limit.

1. `MR_AGENT_MAX_COST_USD`, when set to a number above 0, stops the agent before its next request once the cost it has counted from the answers' usage (`usageOf`) reaches the limit, and it prints `Stopped at the cost limit of $N.` as its last line and exits 3. Unset, nothing changes.
2. `src/briefs/run.js` passes `MR_AGENT_MAX_COST_USD` to a `machineroom` lane with its key names (`HARNESS_KEY_NAMES.machineroom`), and to no other harness.
3. Tests with a fake endpoint, by what they prove: two answers of $0.02 with a limit of $0.03 stop before the third request with the sentence and exit 3; no limit runs on; an answer with no cost counts as 0; the variable reaches only a machineroom lane.

Run `npx vitest related --run scripts/mr-agent.mjs src/briefs/run.js` and `npm run build`; both must pass.

Files: scripts/mr-agent.mjs, src/briefs/run.js, tests/.

**P90. Codex plans the next round with the orchestrator (Codex).** Read `docs/agents/OWNER.md`, the newest two sections of TASKS.md, `docs/agents/PLAN.md` and `docs/agents/AUDIT-2026-11-OWNER-ROOM.md`. Change no code. Do not commit: the runner commits your file.

Write `docs/agents/PLAN-CODEX-2026-11-12.md`: the next ten briefs you would give the fleet after P77 to P89, ranked by what the owner would notice most. For each: a one-line title, why, the files it touches, the lane kind that suits it (OpenCode for code, AGY for backend steps, Codex for reviews and plans, native for small reviews and doc checks), and whether it needs the owner's yes (a feature or a change of look does). Read the code each one names before you list it, and name `file:line` for each claim. Mark which ones can run at the same time without sharing a file.

Files: docs/agents/PLAN-CODEX-2026-11-12.md.

**P91. Do the docs match the code after P70 to P76 (MachineRoom native).** Read no part of TASKS.md beyond this brief. Change no code. Write the file by minute 30.

For each merge `23bad3c1`, `580a28cf`, `909f00fa`, `1e027045`, `3bb13972`, `b6bd90f7` and `4a3eebce`, read its changelog line and the lines of `docs/agents/architecture/LIVE.md`, `COMMANDS.md`, `CODE.md` and `docs/GUIDE.md` that describe what it changed, and check each sentence against the code. Write `docs/agents/AUDIT-2026-11-DOCS-P70-P76.md`: a table of each sentence that is wrong or missing, with the doc line, the code `file:line` and the sentence it should be. An empty table with what you checked is a good answer.

Files: docs/agents/AUDIT-2026-11-DOCS-P70-P76.md.


## The context size from the model, and a conversation menu (2026-11-12, night)

The owner found the chat's `Context size 16.5k / 200.0k` for DeepSeek v4.1 Flash on OpenRouter: `resolveContextWindow` in `server/model-list.js` knows a window only for the models in its own list, and gives `DEFAULT_CONTEXT_WINDOW` (200000) for every other, so autocompact fires at the wrong point for any model with a larger or smaller window. P77 keeps each endpoint model's `contextLength` in `endpoints.json`. The owner also asked for a conversation list managed like the Gemini app's or Claude Code's: one menu per row with Pin, Rename, Fork, Mark as unread, Archive and Delete. P92 starts after P77 is merged; P93 starts after P81 is merged, since it uses P81's branch route.

**P92. The context size comes from the model (OpenCode).** Starts after P77 is merged. Read no part of TASKS.md beyond this brief and the paragraph above it. Use no subagents. Run every command in the foreground. Commit each step as you finish it, and stop starting new work at minute 40. Work on a temporary runs folder, never on a real one.

1. `resolveContextWindow` takes, in order: a window the lane sets (`cli.contextWindow`), the `contextLength` the endpoint's saved `modelDetails` give for that model (a machineroom lane's endpoint, read from `endpoints.json` in the runs folder), the window in `MODELS`, and only then `DEFAULT_CONTEXT_WINDOW`. Find every caller (`server/orchestrator.js`, `server/orchestrators.js`, the lanes and agents answers) and pass what it needs; keep the function pure by passing the details in.
2. The chat says where the number came from when it is the default: `Context size 16.5k / 200.0k (assumed)`, in `src/ui/agentStrip.js`; a known window shows as now.
3. The autocompact point in tokens follows the new window when a model changes, and a saved percent stays a percent.
4. Tests, by what they prove: DeepSeek on OpenRouter with a saved `contextLength` of 1048576 gives that window; the lane's own window wins; a model with no details gives the default and the label says `(assumed)`; autocompact fires at the percent of the right window.

Run `npx vitest related --run` on every file you changed and `npm run build`; both must pass.

Files: server/model-list.js, server/models.js, server/orchestrator.js, server/orchestrators.js, server/endpoints.js, src/ui/agentStrip.js, tests/.

**P93. One menu for each conversation (OpenCode).** Starts after P81 is merged. Read no part of TASKS.md beyond this brief and the paragraph above P92. Use no subagents. Commit each step as you finish it, and stop starting new work at minute 50. Fonts Jost and Space Mono at 400 and 500, never bold; colours from `docs/agents/ARCHITECTURE.md`, Conventions.

The list is `renderSessionRow` in `src/ui/Sidebar.jsx` with helpers in `src/ui/sidebar.js`; it shows Pin, Star, Rename and Delete as a row of text buttons on every row but the current one, and the routes are in `server/orchestrators.js` under `/api/orchestrator/sessions`.

1. Each row, the current one too, gets one `...` button on hover and on keyboard focus, which opens a menu: Pin or Unpin, Rename, Fork, Mark as unread, Archive, and Delete in red. The menu shows each item's key (P, R, F, U, A, D), and with the menu open the key does the item; Escape closes it. Star leaves the row and its starred conversations count as pinned. The row of text buttons goes.
2. Fork starts a new conversation from the whole of that one, with P81's branch route at its last message. Mark as unread puts a yellow dot on the row until it is opened. Archive hides the row; a `Show archived` line at the end of the list shows them with Unarchive in their menu. Delete keeps its confirm. The current conversation cannot be archived or deleted, and its items are disabled with that reason.
3. A search box over the list filters by title as you type, and a sort choice (Newest, Oldest, Name) is kept in `localStorage` (wrapped in try); pinned rows come first in each.
4. The bridge keeps `unread` and `archived` beside `pinned`, with the same write guard the pin takes.
5. Tests, by what they prove: each menu item calls the right route; each key does its item and Escape closes; fork makes a new conversation of the same length; unread clears on open; archived rows hide and come back; the current row's archive and delete are disabled; search and each sort with pinned first.

Run `npx vitest related --run` on every file you changed and `npm run build`; both must pass. Name the by-eye checks for the orchestrator at 1280 by 800: the menu open on a row, an archived list, a search.

Files: src/ui/Sidebar.jsx, src/ui/sidebar.js, src/styles.css, server/orchestrator.js, server/orchestrators.js, tests/.


## A woken orchestrator leaves another's merge alone (2026-11-12, night)

At 22:02 a room's orchestrator woke on a lane's end, found a merge the Claude orchestrator had prepared in the main checkout, and ran `git merge --abort`, undoing it. A room turn (one no owner asked for) starts from `maybeStartTurn` in `server/orchestrator.js` after `addMessage('room', ...)`; nothing checks the project's git state first.

**P94. A room turn waits while a merge is in progress (OpenCode).** Read no part of TASKS.md beyond this brief and the paragraph above it. Use no subagents. Run every command in the foreground. Commit each step as you finish it, and stop starting new work at minute 35. Work on temporary repositories and runs folders, never the real ones. P81 also changes `server/orchestrator.js`: keep your change to the few lines it needs.

1. Before a room turn starts, the bridge asks git for the project's `MERGE_HEAD`, `REBASE_HEAD` and `CHERRY_PICK_HEAD` (`git rev-parse --git-path NAME`, then whether the file exists). If any exists, the turn waits and tries again on the next room timer, and the room message stays pending. An owner's message still starts a turn at once.
2. The orchestrator's own instructions (find where its system prompt is built) gain one sentence: `Never abort, reset or finish a merge, rebase or cherry-pick you did not start; if one is in progress, say so and wait.`
3. Tests, by what they prove: a pending room message does not start a turn while `MERGE_HEAD` exists in a temp repository, and starts once it is gone; an owner's message starts at once; the sentence is in the prompt.

Run `npx vitest related --run` on every file you changed and `npm run build`; both must pass.

Files: server/orchestrator.js, the file that builds the orchestrator's prompt, tests/.


## The runner keeps its record when the runs folder vanishes (2026-11-12, night)

P87 (`docs/agents/AUDIT-2026-11-WORKTREE-SWITCH.md`) found that the P75 run lost its record: a disk cleanup deleted the runs folder during the run, and `appendFileSync(runsFile(), ...)` at the end of `scripts/run-lane.mjs` threw `ENOENT`, so the runner died before it wrote the record or released the lane.

**P95. The runner writes its record into a runs folder that was deleted (AGY).** Read no part of TASKS.md beyond this brief and the paragraph above it. Use no subagents. Run every command in the foreground. Commit each step as you finish it, and stop starting new work at minute 30. Work on temporary runs folders passed through `env`, never a real one. P85 also changes `scripts/run-lane.mjs`: change only the lines this brief needs.

1. One helper in `scripts/run-lane.mjs` makes the runs folder (`mkdirSync(..., { recursive: true })`) and appends one record. The four `appendFileSync(runsFile(), ...)` calls (about lines 467, 902, 1347 and 1386) use it.
2. When the folder had to be made again, the runner prints `The runs folder was gone; made it again at PATH.` once, with `%LOCALAPPDATA%` or `%TEMP%` in place of the real folder.
3. Tests, by what they prove: a record is written after the runs folder is deleted, and the line is printed once; a normal append prints nothing.

Run `npx vitest related --run scripts/run-lane.mjs` and `npm run build`; both must pass.

Files: scripts/run-lane.mjs, tests/.


## The native agent survives one bad answer (2026-11-12, night)

The native lane's P80 review ran 27 minutes and 88 tool calls, then ended with `The API answer was not JSON.` and wrote nothing. `post` in `scripts/mr-agent.mjs` retries a failed request and the statuses in `RETRY_STATUS`, but an answer with status 200 whose body is not JSON (a cut stream, or a provider's error page) throws at once and ends the run.

**P96. A 200 answer that is not JSON is tried again (AGY).** Starts after P89 is merged, since both change `scripts/mr-agent.mjs`. Read no part of TASKS.md beyond this brief and the paragraph above it. Use no subagents. Run every command in the foreground. Commit each step as you finish it, and stop starting new work at minute 30.

1. In `post`, a body that does not parse as JSON, or parses without `choices`, is retried like a 502, up to `RETRY_LIMIT`, with the same delay. After the last try the error names the status and the first 200 characters of the body, cleaned with `sanitize` so no key can show: `The API answer was not JSON (200): TEXT.`
2. Tests with a fake endpoint, by what they prove: one non-JSON answer then a good one finishes the run; non-JSON on every try fails with the sentence and the body start; a key in the body never reaches the error.

Run `npx vitest related --run scripts/mr-agent.mjs` and `npm run build`; both must pass.

Files: scripts/mr-agent.mjs, tests/.

**P97. Review the merge of P76, the runs folder move (MachineRoom native).** Read no part of TASKS.md beyond this brief. Change no code. Read only the diff named here and the code around each change. Write the file by minute 25.

Review `git show -m --first-parent 4a3eebce` against the code around it. Hunt for what a test would not show: a caller that still builds `TEMP\machineroom-runs` itself; a copy from the old folder that can run twice, overwrite a newer folder, follow a link out of the folder, or copy `keys.json` anywhere but the new runs folder; a printed line or error that shows the real profile folder; a Linux or macOS answer that differs between the bridge and `scripts/mr-agent.mjs`. Write `docs/agents/AUDIT-2026-11-REVIEW-14.md`: a table of at most 6 findings, the most harmful first, each with `file:line`, what goes wrong and when, the smallest fix, and whether it blocks a push. Write no finding you cannot point to in the code. An empty table with what you checked is a good answer.

Files: docs/agents/AUDIT-2026-11-REVIEW-14.md.


## From the Codex plan (2026-11-12, night)

`docs/agents/PLAN-CODEX-2026-11-12.md` ranks ten next briefs, C1 to C10. These take C8 and C3.

**P98. The development fleet stays out of the owner's room (Codex, C8).** Read `docs/agents/OWNER.md` and this brief only. Change no code. Do not commit: the runner commits your file.

The owner's room must hold only the orchestrator and the lanes the owner made; the twelve development lanes belong to the testbench. Read every path that decides which lanes a bridge shows and runs: `lanesFolder` and `runsFolder` in `server/lanes-source.js`, the bridge's start in `bin/machine-room.mjs` and `server/index.js`, `server/agents-config.js`, and anything that reads `MACHINEROOM_LANES_DIR` or `docs/agents/lanes.json`. Find any way a bridge started the owner's way (`npm run serve -- up`, `machineroom FOLDER`, no variables set) can show, start or write a lane from `docs/agents/lanes.json`, read the testbench runs folder, or write into it. Write `docs/agents/AUDIT-2026-11-FLEET-ROOM.md`: each path with `file:line`, safe or not and why, and the smallest fix for any that is not. A short file that says every path is safe, with what you read, is a good answer.

Files: docs/agents/AUDIT-2026-11-FLEET-ROOM.md.

**P99. A lane's git hooks never run in the owner's merge (OpenCode, C3).** Read no part of TASKS.md beyond this brief and the paragraph above P98. Use no subagents. Run every command in the foreground. Commit each step as you finish it, and stop starting new work at minute 40. Work on temporary repositories, never the real ones.

The review git runner passes the whole process environment (`server/reviews.js`, near line 103), and the merge runs in the main checkout (near line 417). A lane branch could carry a `core.hooksPath` or a hook script that the merge then runs.

1. Every git command the review and merge routes run passes `-c core.hooksPath=` pointing at an empty folder the bridge owns, and drops `GIT_DIR`, `GIT_WORK_TREE` and `GIT_INDEX_FILE` from the environment it inherits. A merge that the owner starts from the room runs no hook from the project or the lane.
2. Tests with a temp repository, by what they prove: a `pre-merge-commit` and a `post-merge` hook set in the repository, and a `core.hooksPath` set in its config, do not run during the room's merge; the merge still lands; `GIT_DIR` set in the bridge's environment does not move the merge to another repository.

Run `npx vitest related --run server/reviews.js` and `npm run build`; both must pass.

Files: server/reviews.js, tests/.


## After the fleet audit (2026-11-12, night)

P98 (`docs/agents/AUDIT-2026-11-FLEET-ROOM.md`) found the owner's room safe, but a brief run started from the room reads `docs/agents/lanes.json` (`readText('lanes.json')` in `server/runs.js`, about line 748) instead of the room's own lane file.

**P100. A brief run reads the room's own lane file (OpenCode).** Read no part of TASKS.md beyond this brief and the paragraph above it. Use no subagents. Run every command in the foreground. Commit each step as you finish it, and stop starting new work at minute 30. Work on temporary folders, never the real ones.

1. The non-project branch of the brief-run route in `server/runs.js` reads its lanes from `laneFile` (the room's lane file, the same one the project branch uses) with `readStartLanes`, and still reads `TASKS.md` from where it does now. A room with no `MACHINEROOM_LANES_DIR` sees only `config/` lanes and the lanes the owner made.
2. Tests, by what they prove: with the variable unset, a brief run in a temp copy of the repository cannot name a lane that is only in `docs/agents/lanes.json`; with `MACHINEROOM_LANES_DIR=docs/agents` it can.

Run `npx vitest related --run server/runs.js` and `npm run build`; both must pass.

Files: server/runs.js, tests/.

**P101. Review tonight's merges (Codex).** Read `docs/agents/OWNER.md` and this brief only. Change no code. Do not commit: the runner commits your file.

Review what these merges brought, with `git show -m --first-parent SHA` for each, against the code around each change: `ecea6fcc` (P84), `2658b11e` (P79), `06ff081a` (P88), `d8380254` (P77), `505595cf` (P81), `b465fb47` (P89), `1c22ca48` (P95). Hunt for what a test would not show: a write route without the page-origin guard; a value from a provider or a file saved without a cap; a branch of a chat that loses or duplicates messages, or carries a summary into the wrong conversation; a cost limit that never fires because cost is null; a printed line that shows a real profile folder; a style that breaks the fonts or colours in `docs/agents/ARCHITECTURE.md`, Conventions. Write `docs/agents/AUDIT-2026-11-REVIEW-15.md`: a table of at most 8 findings, the most harmful first, each with `file:line`, what goes wrong and when, the smallest fix, and whether it blocks a push. Write no finding you cannot point to in the code. An empty table with what you checked is a good answer.

Files: docs/agents/AUDIT-2026-11-REVIEW-15.md.


## The fixes from review 13 (2026-11-12, night)

Review 13 (`docs/agents/AUDIT-2026-11-REVIEW-13.md`) read the P70 to P75 merges and found eight findings; 1 and 2 block a push. P102 takes the runner's findings (1, 2, 5, 7 and 8); P103 takes the bridge's (3, 4 and 6). They touch different files and run together.

**P102. A made lane runs, and the runner commits only the brief's files (OpenCode).** Read no part of TASKS.md beyond this brief, the paragraph above it, and findings 1, 2, 5, 7 and 8 of review 13. Use no subagents. Run every command in the foreground. Commit each step as you finish it, and stop starting new work at minute 45. Work on temporary repositories and runs folders, never the real ones. P85 also changes `scripts/run-lane.mjs`: keep each change to the lines it needs.

1. Finding 1: `scripts/run-lane.mjs` checks the lane against the lanes `readAllLanes` gives (the owner's made lanes too), and a made lane with no `worktree` gets `worktreeFor(mainCheckout(), key)`. `scripts/candidate.mjs` reads lanes the same way.
2. Finding 2: `runnerCommit` stages only the paths in the brief's `Files:` line (`briefFileList`), where a folder entry such as `tests/` covers the files under it. Any other changed path is left out of the commit and named in the lane log and the record's `note` as `Left out of the commit: PATH`. A path that looks like a key, a log or a build output (`keys.json`, `*.key`, `.env*`, `*.log`, `dist/`, `build/`, `out/`) is never staged, even when the brief names its folder.
3. Finding 5: a failure in the runner commit is written to the lane log before the log closes, and into the record's `note`.
4. Finding 7: the runner commit's version prefix comes from `package.json` at run time, the way `buildPrompt` finds it.
5. Finding 8: `scripts/recording-files.mjs` falls back to `record.base`, then `HEAD`, when a record has no branch and no commit.
6. Tests, by what they prove: a made lane in a temp runs folder starts with `--dry-run`; a Codex-style run that writes a brief file, a stray file and a `keys.json` commits only the brief file and names the others; a failing commit lands in the log and the note; the prefix follows `package.json`; a no-change run is recorded.

Run `npx vitest related --run` on every file you changed and `npm run build`; both must pass.

Files: scripts/run-lane.mjs, scripts/candidate.mjs, scripts/recording-files.mjs, tests/.

**P103. The bridge's fixes from review 13 (OpenCode).** Read no part of TASKS.md beyond this brief, the paragraph above P102, and findings 3, 4 and 6 of review 13. Use no subagents. Run every command in the foreground. Commit each step as you finish it, and stop starting new work at minute 40. Work on temporary folders, never the real ones.

1. Finding 3: the project switch in `server/projects.js` also refuses while a `LANE.lock` in the runs folder names a live process, with the same refusal it gives a running lane.
2. Finding 4: each bridge start gets a start id; the tree event carries it, the page sends it back with `since`, and a different id gets a full list.
3. Finding 6: the Codex app program search in `server/agents-config.js` skips a folder whose name is not 16 hex characters.
4. Tests, by what they prove: a live lock refuses the switch and a dead one does not; a page that reconnects to a restarted bridge with the same version number gets a full list; a newer folder with a non-hex name is skipped.

Run `npx vitest related --run` on every file you changed and `npm run build`; both must pass.

Files: server/projects.js, server/index.js, src/live/bridge.js, server/agents-config.js, tests/.


## The fixes from review 15 (2026-11-12, night)

Review 15 (`docs/agents/AUDIT-2026-11-REVIEW-15.md`, by Codex on GPT-6.1 Sol) found two push blockers: the native agent's cost limit never fires when answers give token counts but no dollar cost, and a branched chat loses its quoted transcript when another conversation is opened before its first turn. P104 and P105 touch different files and run together.

**P104. A cost limit never runs blind (AGY).** Read no part of TASKS.md beyond this brief, the paragraph above it, and the P1 finding on P89 in review 15. Use no subagents. Run every command in the foreground. Commit each step as you finish it, and stop starting new work at minute 30.

1. In `scripts/mr-agent.mjs`, when `MR_AGENT_MAX_COST_USD` is set and an answer reports usage with no usable dollar cost, the agent stops before its next request, prints `The cost limit is set but the provider did not report a cost; stopped.` as its last line, and exits 3. Unknown cost stays apart from a cost of 0: a reported 0 counts as 0 and goes on.
2. With no limit set, nothing changes.
3. Tests with a fake endpoint, by what they prove: a limit and an answer without cost stops before the second request with the sentence; a limit and reported costs of 0 runs on; no limit and no cost runs on.

Run `npx vitest related --run scripts/mr-agent.mjs` and `npm run build`; both must pass.

Files: scripts/mr-agent.mjs, tests/.

**P105. A branch keeps its transcript, and an edit keeps model details (OpenCode).** Read no part of TASKS.md beyond this brief, the paragraph above P104, and the P1 finding on P81 and the P2 finding on P77 in review 15. Use no subagents. Run every command in the foreground. Commit each step as you finish it, and stop starting new work at minute 45. Work on temporary runs folders, never the real ones.

1. `server/orchestrator.js`: an archived session saves its `branchTranscript` (capped as now) beside its summary, opening a session restores it, and it is cleared only once a turn that carried it has started.
2. `server/endpoints.js`, `src/control/client.js` and `src/ui/EndpointsPanel.jsx`: saving an endpoint whose draft has no `modelDetails` keeps the saved details of every model id it keeps; a model refresh saves the details from the same answer as the ids.
3. Tests, by what they prove: branch a Claude chat, open another conversation, open the branch again, and its first turn carries the quoted transcript; a second turn does not; an endpoint edit keeps the details of kept ids and drops those of removed ids; a refresh saves new details.

Run `npx vitest related --run` on every file you changed and `npm run build`; both must pass.

Files: server/orchestrator.js, server/endpoints.js, src/control/client.js, src/ui/EndpointsPanel.jsx, tests/.


**P106. The detail docs catch up with tonight's merges (AGY).** Read no part of TASKS.md beyond this brief. Use no subagents. Run every command in the foreground. Change no code. Commit each file as you finish it, and stop starting new work at minute 40.

Tonight merged P77 to P99. For each merge below, read its changelog line under `## Unreleased` in `docs/agents/CHANGELOG.md` and the code it names, then make the detail docs say what the code now does, in plain words and short sentences, no em dashes: `docs/agents/architecture/ROOM.md` (what the owner sees: the state-only chip P84, buttons with the page scrolled P79, the model picker P78, chat Copy, Retry and Branch P81, the folded work line and Jump to newest P83, the context size and `(assumed)` P92, the session at the top P85), `docs/agents/architecture/LIVE.md` (routes and files: `/api/model-pins` and `model-pins.json` P77, model details in `endpoints.json` P77, `/api/orchestrator/sessions/branch` P81, a room turn that waits during a merge P94, hooks off in review merges P99), `docs/agents/architecture/COMMANDS.md` (`MR_AGENT_MAX_COST_USD` P89, the runs folder made again P95, the retry of a non-JSON answer P96, native recordings P88, the session a run records P85), and `docs/agents/architecture/CODE.md` (one line for each new file: `src/ui/ModelPicker.jsx`, `src/model/laneStarter.js`). Change only the lines that are wrong or missing; check every sentence you write against the code and give `file:line` for it in your report.

Run `node node_modules/vitest/vitest.mjs run tests/briefs.test.js tests/docs.test.js` if they exist and `npm run build`; both must pass.

Files: docs/agents/architecture/ROOM.md, docs/agents/architecture/LIVE.md, docs/agents/architecture/COMMANDS.md, docs/agents/architecture/CODE.md.


**P107. Review the late merges (Codex).** Read `docs/agents/OWNER.md` and this brief only. Change no code. Do not commit: the runner commits your file.

Review what these merges brought, with `git show -m --first-parent SHA` for each, against the code around each change: `0486c7cf` (P86, the command parser), `5ca6cefb` (P85, the session at the top, merged with hand-resolved conflicts in `scripts/run-lane.mjs`), `79e9c364` (P96, the retry of a non-JSON answer), `da2017c2` (P94, a room turn waits during a merge), `1f17dda1` (P92, the context window from model details), `030fd52b` (P78, the model picker), `3cc8bede` (P99, hooks off in review merges), `babd7fd2` (P83, the folded work line). Hunt for what a test would not show: a parser case that now misses a real write or invents one; a session id or a profile path written into a record, frame or page; a retry that can resend a paid request after the provider took it; a git check that blocks the bridge's event loop for long; a context window taken from the wrong model; a picker or pin write without the page-origin guard or a cap; a git command in a review or merge that still runs a hook; a turn whose steps or answer land on the wrong message. Write `docs/agents/AUDIT-2026-11-REVIEW-16.md`: a table of at most 8 findings, the most harmful first, each with `file:line`, what goes wrong and when, the smallest fix, and whether it blocks a push. Write no finding you cannot point to in the code. An empty table with what you checked is a good answer.

Files: docs/agents/AUDIT-2026-11-REVIEW-16.md.


## The fixes from review 16 (2026-11-12, night)

Review 16 (`docs/agents/AUDIT-2026-11-REVIEW-16.md`, Codex on GPT-6.1 Sol) found three push blockers and five smaller findings in the late merges. P108 takes P92's two, P109 takes P96's, and P110 takes three of the smaller ones; they touch different files.

**P108. The context size comes from the right endpoint and follows a model change (OpenCode).** Read no part of TASKS.md beyond this brief, the paragraph above it, and the second and third P1 findings of review 16. Use no subagents. Run every command in the foreground. Commit each step as you finish it, and stop starting new work at minute 40. P105 also changes `server/orchestrator.js`: keep each change to the lines it needs.

1. `server/model-list.js`: for a model named `ENDPOINT/ID`, look only in that endpoint's details and match `ID` exactly. Match by suffix only when the endpoint is not named and exactly one detail matches.
2. `server/orchestrators.js` passes a sub orchestrator only the lane's own `contextWindow` override (or none), never a resolved size, so its window is resolved again from its current model when the model or harness changes.
3. Tests, by what they prove: endpoints `first` and `second` both list `model` at 1000000 and 32000, and `second/model` gives 32000; a sub orchestrator moved from a large model to a small one gets the small window; a lane's own override still wins.

Run `npx vitest related --run` on every file you changed and `npm run build`; both must pass.

Files: server/model-list.js, server/orchestrators.js, server/orchestrator.js, tests/.

**P109. A damaged answer is tried once more, not four times (AGY).** Starts after P104 is merged, since both change `scripts/mr-agent.mjs`. Read no part of TASKS.md beyond this brief, the paragraph above P108, and the first P1 finding of review 16. Use no subagents. Run every command in the foreground. Commit each step as you finish it, and stop starting new work at minute 30.

A provider may bill a generation whose body is then cut, so a retry of a damaged 200 answer can pay twice. The native runs tonight died on such answers, so one retry stays.

1. In `post` in `scripts/mr-agent.mjs`, a 200 answer whose body is not JSON or has no `choices` is retried at most once per step, then fails with the sentence P96 made. Refused statuses keep their retries as now.
2. The agent counts each damaged answer, and its result line carries `damagedAnswers: N` when N is above 0.
3. Tests with a fake endpoint, by what they prove: one damaged answer then a good one goes on, with `damagedAnswers: 1`; two damaged answers in a row fail after exactly two requests; a 502 still gets its retries.

Run `npx vitest related --run scripts/mr-agent.mjs` and `npm run build`; both must pass.

Files: scripts/mr-agent.mjs, tests/.

**P110. Three small fixes from review 16 (Codex).** Read `docs/agents/OWNER.md`, this brief, the paragraph above P108, and the three P2 findings of review 16 on `src/model/commands.js` (two) and `src/ui/ModelPicker.jsx` (one). Do not commit: the runner commits your files. Your sandbox cannot run the tests; write them, and say in your report that the orchestrator runs them.

1. `src/model/commands.js`: removing a heredoc keeps the rest of its opener line, so `cat <<EOF > out.txt` with its body still writes `out.txt`; a redirect marks as written only its own operand, and only when that exact operand is a known file, so `cat src/a.js > new.txt src/b.js` writes nothing known and reads both.
2. `src/ui/ModelPicker.jsx`: the pin buttons stay disabled until the saved pins have loaded; a read that was cancelled or failed is tried again when the picker opens; a pin never saves a list that lost the saved pins.
3. Tests in `tests/commands.test.js` and `tests/model-picker.test.js` for each case above.

Files: src/model/commands.js, src/ui/ModelPicker.jsx, tests/commands.test.js, tests/model-picker.test.js.


**P111. A Copilot reply keeps all of its answer (Codex).** Read `docs/agents/OWNER.md`, this brief, and the P2 finding of review 16 (`docs/agents/AUDIT-2026-11-REVIEW-16.md`) on `src/harnesses/common.js` and `src/harnesses/copilot.js`. Do not commit: the runner commits your files. Your sandbox cannot run the tests; write them, and say in your report that the orchestrator runs them.

1. The plain-text reply of a Copilot run keeps every paragraph of its final answer. Earlier progress is cut only at a line the Copilot parser already reads as a tool call or tool result, never at a blank line or at an ordinary word such as `Run`.
2. Escape codes stay stripped, and the replies of the other harnesses do not change.
3. Tests in `tests/copilot-harness.test.js`: a two-paragraph answer after two tool lines keeps both paragraphs; an answer line that starts with `Run the migration` stays; a run with no tool lines keeps its whole text.

Files: src/harnesses/common.js, src/harnesses/copilot.js, tests/copilot-harness.test.js.


## The native agent gets a clock (2026-11-12, night)

The native lanes went 0 for 5 tonight. Their logs show distinct, wandering commands (the P97 review ended reading `scripts/pack-check.mjs`), not a loop, and none wrote its file. Every brief says `Write the file by minute 25`, but `scripts/mr-agent.mjs` never tells the model the time or its limit, so it cannot follow that.

**P112. The native agent knows its minutes (AGY).** Read no part of TASKS.md beyond this brief and the paragraph above it. Use no subagents. Run every command in the foreground. Commit each step as you finish it, and stop starting new work at minute 35.

1. `run-lane` passes the run's minute limit to a `machineroom` lane as `MR_AGENT_MINUTES` (with the other names in `HARNESS_KEY_NAMES.machineroom` in `src/briefs/run.js`, and in `scripts/run-lane.mjs` where the child's environment is built).
2. `scripts/mr-agent.mjs` adds one short line to each tool result it sends back: `Minutes used: U of M.` When 60 percent of M has passed it adds once: `Time is past 60 percent. Stop reading; write your file or your change now, then report.` Unset, nothing changes.
3. Tests with a fake endpoint and a fake clock, by what they prove: the line appears with the right numbers; the 60 percent line appears once; unset adds nothing.

Run `npx vitest related --run scripts/mr-agent.mjs src/briefs/run.js scripts/run-lane.mjs` and `npm run build`; both must pass.

Files: scripts/mr-agent.mjs, src/briefs/run.js, scripts/run-lane.mjs, tests/.

## A lane task from the chat keeps the runner's guards (2026-11-13)

P82 (branch `feat/p82-talk-to-a`) lets the owner pick a lane in the orchestrator chat's To choice and send it a task. Review found that the new path in `server/orchestrators.js` calls `runs.startRun` directly through `startLaneTask` in `server/index.js`, so it skips every guard the bridge's own project-run route in `server/runs.js` applies: the lane must be active, the actor checks, `projectProblems` (the project must not be this repository, a lane worktree, the profile, the temp folder or the runs folder) and the dirty check. It also forces `allowDirty: true`, and it starts no worktree, so a lane could edit the owner's uncommitted checkout in place.

**P113. A lane task from the chat keeps the runner's guards (OpenCode).** Read no part of TASKS.md beyond this brief and the paragraph above it. Use no subagents. Run every command in the foreground. Commit each step as you finish it, and stop starting new work at minute 40.

1. Start with `git merge --no-edit refs/heads/feat/p82-talk-to-a`. Build on that branch's work; do not redo it.
2. In `server/runs.js`, move the checks the project-run route makes before `startRun` (lane known and active, task text, project folder, `gitCheckout` when a worktree is asked, `projectDirty` and `projectProblems`, the lane already running) into one exported async function, for example `startProjectTask({ lane, task, worktree, allowDirty, startedBy })`, that answers `{ status, body }`. The HTTP route calls it, so its answers do not change. `createRunsApi` returns it.
3. `startLaneTask` in `server/index.js` calls that function with `allowDirty: false` and `worktree: true` when the project is a git checkout, and `startedBy: 'orchestrator'`. The route in `server/orchestrators.js` awaits it and returns its status and error text to the page; it adds the owner message and announces the dispatch only when the start answered 202. Drop the second `dispatch` announce if `startRun` already sends one, so a dispatch shows once.
4. Tests, by what they prove: a chat task to a lane on a dirty project is refused with the runner's own dirty text and starts nothing; a chat task naming an inactive lane is refused; a chat task to a working lane gets 409; a good chat task starts the run once and shows one dispatch line. Keep P82's tests passing.
5. Run `node node_modules/vitest/vitest.mjs related server/runs.js server/orchestrators.js server/index.js --run` and `npm run build`. Report what passed.

## Review 17, the merges before the push (2026-11-13)

**P114. Review the merges before the push (Codex).** Read `docs/agents/OWNER.md` and this brief only. Change no code. Do not commit: the runner commits your file.

Review what these merges brought, with `git show -m --first-parent SHA` for each, against the code around each change: `44d01aa6` (P104, a cost limit stops when cost is unknown), `5ca9c8a7` (P110, three small fixes from review 16), `0cb7a073` (P111, a Copilot reply keeps all of its answer), `823223e4` (P109, one retry of a damaged answer), `edd309b9` (P103, the bridge's fixes from review 13, with the tree start id fix in `server/index.js` `treeSinceVersion` right after it), `59b6136b` (P100, a brief run reads the room's lane file), `676162cf` (P102, a made lane runs and the runner commits only the brief's files), `55fe5ecf` (P108, the context size from the right endpoint), `7954cfd4` (P105, a branch keeps its transcript), `6ea44c42` (P112, the native agent's minutes). Hunt for what a test would not show: a paid request sent twice; a limit that does not stop a run; a runner commit that takes a file outside the brief or misses one inside it; a lane lock or project switch refused or allowed wrongly; a tree delta sent with the wrong start or version after a bridge restart; a context window taken from the wrong endpoint; a transcript or model detail lost on a branch or an edit; a key, session id or profile path written into a record, frame, log or page. Write `docs/agents/AUDIT-2026-11-REVIEW-17.md`: a table of at most 8 findings, the most harmful first, each with `file:line`, what goes wrong and when, the smallest fix, and whether it blocks a push. Write no finding you cannot point to in the code. An empty table with what you checked is a good answer.

Files: docs/agents/AUDIT-2026-11-REVIEW-17.md.

## Finish the conversation menu (2026-11-13)

P93 ran out of time with five commits on `feat/p93-one-menu-for`: the bridge keeps `unread` and `archived`, every action sits behind one `...` menu, the current row has its menu, and the last commit holds unfinished edits (the current row's saved flags, a capturing key handler).

**P115. Finish the conversation menu (OpenCode).** Read the brief for P93 in TASKS.md and this brief only. Use no subagents. Run every command in the foreground. Commit each step as you finish it, and stop starting new work at minute 45.

1. Start with `git merge --no-edit refs/heads/feat/p93-one-menu-for`. Build on that work; do not redo it. Check the last commit's edits and keep them only if a test shows they are needed.
2. Read P93's five steps against the code and finish what is missing. Most likely missing: Fork, Mark as unread with its yellow dot, the `Show archived` line with Unarchive, the search box and the kept sort, and the tests of step 5.
3. Run `node node_modules/vitest/vitest.mjs related --run` on every file you changed and `npm run build`; both must pass. Report which of P93's steps are done and the by-eye checks it names.

## The fixes from review 17 (2026-11-13)

Review 17 (`docs/agents/AUDIT-2026-11-REVIEW-17.md`, P114) read the merges P100 to P112 and found five that block the push. These three briefs touch separate files and can run at once.

**P116. The runner commits only what the briefs allow (OpenCode).** Read review 17 findings 1, 3 and 5, and this brief only. Use no subagents. Run every command in the foreground. Commit each step as you finish it, and stop starting new work at minute 40.

1. Finding 1: `runnerCommit` in `scripts/run-lane.mjs` commits only the selected paths (`git commit --only -m ... -- <selected>`), so a file the lane staged itself never rides along.
2. Finding 3: `parseBriefs` in `src/briefs/briefs.js` keeps every line of a brief, from its bold heading to the next brief or section heading, in `text`, so a `Files:` line in a later paragraph is found. Check that the prompt and the brief list still show what they showed.
3. Finding 5: the commit's allowed files come from every brief of the run; the branch name and title still come from the first.
4. Tests, by what they prove: a file the lane staged outside the list stays out of the commit; a `Files:` line two paragraphs below the heading is read (use P114's layout); a run of two briefs commits both briefs' files.
5. Run `node node_modules/vitest/vitest.mjs related --run scripts/run-lane.mjs src/briefs/briefs.js` and `npm run build`. Report what passed.

**P117. A cost limit stops on a damaged answer, and a Copilot reply keeps its prose (AGY).** Read review 17 findings 2 and 6, and this brief only. Use no subagents. Run every command in the foreground. Commit each step as you finish it, and stop starting new work at minute 35.

1. Finding 2: in `scripts/mr-agent.mjs`, when `MR_AGENT_MAX_COST_USD` is set, a 200 answer that is damaged stops the run before any retry, with the same stop text P104 uses when cost is unknown. With no cost limit, the one retry of P109 stays.
2. Finding 6: in `src/harnesses/common.js`, reply extraction drops only lines that carry an unambiguous tool marker, not prose that begins with `Running`, `Reading`, `Writing` or `Editing`.
3. Tests, by what they prove: with a cost limit a damaged answer sends no second request and stops; without one it retries once; the review's four-line prose example keeps all its lines.
4. Run `node node_modules/vitest/vitest.mjs related --run scripts/mr-agent.mjs src/harnesses/common.js` and `npm run build`. Report what passed.

**P118. A branch keeps its transcript until a turn starts (OpenCode).** Read review 17 finding 4 and this brief only. Use no subagents. Run every command in the foreground. Commit each step as you finish it, and stop starting new work at minute 35.

1. In `server/orchestrator.js`, the carried branch transcript is cleared and saved only once the child has really started (its `spawn` event, or the first output) and not on a start error. On a start error the transcript stays and any provisional session id is cleared, so the next turn gets the history.
2. Tests, by what they prove: a child that emits a start error leaves the transcript for the next turn; a child that starts clears it once.
3. Run `node node_modules/vitest/vitest.mjs related --run server/orchestrator.js` and `npm run build`. Report what passed.

## Review 18, the last merges before the push (2026-11-13)

**P119. Review the last merges before the push (Codex).** Read `docs/agents/OWNER.md` and this brief only. Change no code. Do not commit: the runner commits your file. Files: docs/agents/AUDIT-2026-11-REVIEW-18.md.

Review what these merges brought, with `git show -m --first-parent SHA` for each, against the code around each change: `68dacfd4` (P113 with P82: the chat's To choice sends a task to a lane through `startProjectTask` in `server/runs.js`, and agent messages show in the chat), `a8203a93` (P117, a cost limit stops on a damaged answer; Copilot prose lines kept), `b432f9b2` (P115 with P93: one menu per conversation, unread and archived on the bridge, search and sort), `98eea768` (P118, a branch transcript kept until the child starts), `aa382b6e` (P116, the runner commits only the briefs' paths and reads a brief's whole body). Hunt for what a test would not show: a lane started from the chat on a dirty project, on this repository or without a worktree; a page or lane token that can start a lane it should not; an agent message that carries a key, a path or a session id to the page; a conversation write (archive, unread, fork, delete) without the page-origin guard or a cap, or one that can act on the current conversation; a fork that drops or duplicates messages; a menu key that reaches the room's shortcuts; a paid request sent twice; a runner commit that takes a file outside the briefs or misses one inside; a brief body that swallows the next brief. Write the file: a table of at most 8 findings, the most harmful first, each with `file:line`, what goes wrong and when, the smallest fix, and whether it blocks a push. Write no finding you cannot point to in the code. An empty table with what you checked is a good answer.

## The fixes from review 18 (2026-11-13)

Review 18 (`docs/agents/AUDIT-2026-11-REVIEW-18.md`, P119) read P113, P115 to P118 and found six findings that block the push and one that does not. These three briefs touch separate files and run at once.

**P120. Agent messages are masked, kept and resumed right (OpenCode).** Read review 18 findings 1, 4 and 5, and this brief only. Use no subagents. Run every command in the foreground. Commit each step as you finish it, and stop starting new work at minute 40. Files: server/orchestrator.js, tests/orchestrator.test.js, docs/agents/CHANGELOG.md.

1. Finding 1: in `server/orchestrator.js`, mask an agent message's stored text (`agent.text`) and its sender with the same masker the display text uses, before it is stored, persisted or returned to the page.
2. Finding 5: the saved-session and current-chat loaders keep validated agent messages and lane replies (sender a known lane key or `sub-` key), with their safe metadata, and mask their text on load.
3. Finding 4: the setup failure path before the spawn calls `failedToStart(turn)`, so a provisional session id never outlives a turn that did not start.
4. Tests, by what they prove: a key in an order or report never reaches the chat API or the saved file; an agent message survives a bridge restart and a fork; a setup write failure leaves no session id and the next turn carries the transcript.
5. Run `node node_modules/vitest/vitest.mjs related --run server/orchestrator.js` and `npm run build`. Report what passed.

**P121. A brief's file list ends with its paragraph, and a cost limit stops on a lost connection (AGY).** Read review 18 findings 2 and 3, and this brief only. Use no subagents. Run every command in the foreground. Commit each step as you finish it, and stop starting new work at minute 35. Files: src/briefs/briefs.js, scripts/mr-agent.mjs, tests/briefs.test.js, tests/mr-agent.test.js, docs/agents/CHANGELOG.md.

1. Finding 2: `briefFileList` in `src/briefs/briefs.js` reads only up to the end of the paragraph that holds the last `Files:` marker (the first blank line after it), so a later paragraph never adds files.
2. Finding 3: in `scripts/mr-agent.mjs`, when `MR_AGENT_MAX_COST_USD` is set, a fetch that rejects (no response) stops the run with the cost-unknown sentence of P104 and exit 3, before any retry. With no cost limit the retries stay.
3. Tests, by what they prove: the review's two-paragraph example lists only `src/allowed.js`; with a cost limit a rejected fetch sends no second request; without one it retries.
4. Run `node node_modules/vitest/vitest.mjs related --run src/briefs/briefs.js scripts/mr-agent.mjs` and `npm run build`. Report what passed.

**P122. Fork reads the current length, and a menu key never reaches the room (OpenCode).** Read review 18 findings 6 and 7, and this brief only. Use no subagents. Run every command in the foreground. Commit each step as you finish it, and stop starting new work at minute 35. Files: src/ui/Sidebar.jsx, src/ui/sidebar.js, tests/sidebar-menu-ui.test.js, tests/sidebar.test.js, docs/agents/CHANGELOG.md.

1. Finding 6: Fork reads the conversation's message count again (from the bridge, or the live chat for the current one) right before it sends the branch, and the list's counts refresh when a chat turn ends. Fork is enabled once messages arrive.
2. Finding 7: with the menu open, every menu key (P, R, F, U, A, D) is consumed even when its item is disabled; only enabled items act.
3. Tests, by what they prove: a fork after new messages carries all of them; F on a disabled Fork changes no room mode and the menu stays open.
4. Run `node node_modules/vitest/vitest.mjs related --run src/ui/Sidebar.jsx src/ui/sidebar.js` and `npm run build`. Report what passed.

## Run output names no profile folder (2026-11-13)

Review 15 (`docs/agents/AUDIT-2026-11-REVIEW-15.md`, finding 3) found that `run-lane` prints full paths that name the owner's profile folder: the `log:` and `record:` lines, and the runs-folder sentence of P95, which masks only TEMP and LOCALAPPDATA. This is the first brief for the AGY lanes on Gemini 4 Hydrogen High.

**P123. Run output names no profile folder (AGY).** Read review 15 finding 3 and this brief only. Use no subagents. Run every command in the foreground. Commit each step as you finish it, and stop starting new work at minute 35. Files: scripts/run-lane.mjs, tests/run-lane.test.js, docs/agents/CHANGELOG.md.

1. `printedRunsFolder` in `scripts/run-lane.mjs` also masks HOME, USERPROFILE and XDG_STATE_HOME, the longest matching prefix first, as `%TEMP%`, `%LOCALAPPDATA%`, `%USERPROFILE%`, `~` and `$XDG_STATE_HOME`. It compares Windows paths without regard to case.
2. Every path `run-lane` prints for the owner goes through it: the `log:` and `record:` lines, the recovery sentence, and the `--list` and `--stats` output if they print a path. The files written and the paths passed to the harness do not change.
3. Tests, by what they prove: a log path under the profile prints with `%USERPROFILE%`; a Linux runs folder under HOME prints with `~`; the longest prefix wins (`%LOCALAPPDATA%` over `%USERPROFILE%`); a path outside them all prints as it is. Write the Windows cases so they run on Linux too, by passing the variables and using `path.win32` where the code needs it, or mark them Windows only with `it.skipIf(process.platform !== 'win32')`.
4. Run `node node_modules/vitest/vitest.mjs run tests/run-lane.test.js` and `npm run build`. Report what passed.

## The last batch before the 4 am shutdown (2026-11-13)

Each brief below touches its own files. Every lane stops starting new work at minute 35, because the machine shuts down at 4 am.

**P124. The merge check no longer blocks the bridge (OpenCode).** Read review 16 (`docs/agents/AUDIT-2026-11-REVIEW-16.md`, the P94 row) and this brief only. Use no subagents. Run every command in the foreground. Commit each step as you finish it. Files: server/orchestrator.js, tests/orchestrator.test.js, docs/agents/CHANGELOG.md.

1. `gitOperationInProgress` in `server/orchestrator.js` uses `spawnSync` on the bridge's event loop. Make it async with `spawn` and the same timeout, and have `maybeStartTurn` await it (or start it and continue in its callback), so a slow git never freezes requests, streams or timers. A check that fails or times out still answers false, as now.
2. Guard against two checks at once: while one runs, a second `maybeStartTurn` waits for it rather than starting another git.
3. Tests, by what they prove: a git that takes long does not delay a timer or another request; a merge in progress still defers a room turn; a failed check lets the turn start.
4. Run `node node_modules/vitest/vitest.mjs related --run server/orchestrator.js` and `npm run build`. Report what passed.

**P125. A project switch reads a lane lock the way the runner does (AGY).** Read this brief only. Use no subagents. Run every command in the foreground. Commit each step as you finish it. Files: server/projects.js, scripts/lane-lock.mjs, tests/projects.test.js, tests/lane-lock.test.js, docs/agents/CHANGELOG.md.

1. `laneLockRunning` in `server/projects.js` counts a lock as live when its pid answers `process.kill(pid, 0)`. On Windows a pid is reused, so a stale lock can block a project switch forever. `scripts/lane-lock.mjs` already has `isHolderAlive`, which also compares the process start time with the lock file's time (`isLockHolderStale`). Export it and use it in `projects.js` for both the pid and the child pid, so both places decide the same way.
2. Tests, by what they prove: a lock whose pid is alive but started after the lock was written does not block a switch on Windows; a live holder still blocks; a dead pid does not.
3. Run `node node_modules/vitest/vitest.mjs related --run server/projects.js scripts/lane-lock.mjs` and `npm run build`. Report what passed.

**P126. Review the merges since review 18 (Codex).** Read `docs/agents/OWNER.md` and this brief only. Change no code. Do not commit: the runner commits your file. Files: docs/agents/AUDIT-2026-11-REVIEW-19.md.

Review, with `git show -m --first-parent SHA` or `git show SHA`, against the code around each change: `4782700c` (P120, agent messages masked, kept on load, a failed setup clears the session id), `0be42340` (P121, a brief's file list ends at its paragraph; a cost limit stops on a rejected fetch), `4c7404e9` (P122, fork reads the live length, menu keys consumed), `0b802e9e` and `57ca054b` (CI test fixes in `tests/run-lane.test.js` and `scripts/scale-probe.mjs`), `612bfce3` and `67ca5cfc` (the lane models in `docs/agents/lanes.json` and `server/model-list.js`). Hunt for: a key or profile path that still reaches the page, a log or a record; a saved message from an unknown sender accepted on load; a file list that drops a real file or keeps a wrong one; a paid request sent twice; a fork or menu key that acts on the wrong row; a test fix that hides a real failure on one platform; a lane model id the harness cannot run. Write the file: a table of at most 8 findings, the most harmful first, each with `file:line`, what goes wrong and when, the smallest fix, and whether it blocks a push. Write no finding you cannot point to in the code. An empty table with what you checked is a good answer.

**P127. The detail docs catch up with P113 to P123 (OpenCode).** Read this brief, `docs/agents/ARCHITECTURE.md` and the detail files it names. Use no subagents. Commit each step as you finish it. Change no code. Files: docs/agents/architecture/ROOM.md, docs/agents/architecture/LIVE.md, docs/agents/architecture/COMMANDS.md, docs/agents/architecture/CODE.md.

1. Read the merges since `6ea44c42` with `git log --first-parent --oneline 6ea44c42..HEAD` and `git show -m --first-parent`. Bring the four detail files in line with the code: the chat's To choice and agent message lines (P113), one menu per conversation with search, sort, unread, archive and fork (P115, P122), agent messages kept on load and masked (P120), the runner's commit rules and a brief's whole body (P116, P121), the cost limit stops (P117, P121), and the AGY lanes on Gemini 4 Hydrogen.
2. Plain words, short sentences, no em dashes. Where a doc disagrees with the code, the code wins; name each such fix in your report.

**P128. The file-index test follows the new append rule (OpenCode).** Read this brief only. Use no subagents. Run every command in the foreground. Commit each step as you finish it. Files: tests/file-index.test.js, docs/agents/CHANGELOG.md.

1. `tests/file-index.test.js`, "matches the old walk on every shell command in the recordings", compares `touchesForCommand` with the file index against an old walk. Since P110 a command such as `cat >> name~` reads rather than writes, and the old walk in the test still expects a write, so the test fails wherever `public/recordings` holds such a command (the owner's machine; CI has none).
2. Make the old walk in the test follow the same rule as `src/model/commands.js` now does, by importing the rule or the helper, not by copying it. Do not change `src/`.
3. Add one small recording-free case with `cat >> name~` so the rule is covered on CI too.
4. Run `node node_modules/vitest/vitest.mjs run tests/file-index.test.js`. Report what passed.

**P129. Two tests that fail only under load (OpenCode).** Read this brief only. Use no subagents. Run every command in the foreground. Commit each step as you finish it. Files: tests/tree-partial.test.js, tests/git.test.js, docs/agents/CHANGELOG.md.

1. In a full local run, `tests/tree-partial.test.js` "follows the tenth partial read with a full one" (near line 552, `expect(counts.full).toBe(0)`) and `tests/git.test.js` "refuses a concurrent write with 409 while a write is running" sometimes fail, and pass when run alone. Find the timing each one depends on (a watcher debounce, a fixed wait, a write that ends before the second request) and make the test wait for the state it needs, not for time. Do not change `server/` or `src/` unless the test shows a real bug; then stop and report it instead.
2. Run each file ten times in a row with `--maxWorkers=1` and once with the full suite's worker count, and report the counts.

**P130. The plan and the core guide say what is open (OpenCode).** Read this brief, `docs/agents/PLAN.md` and `docs/agents/ARCHITECTURE.md`. Use no subagents. Commit each step as you finish it. Change no code. Files: docs/agents/PLAN.md, docs/agents/ARCHITECTURE.md, docs/agents/architecture/DOCUMENTS.md.

1. `PLAN.md` "Next" still lists N5, N6 and N12 as open, but `docs/agents/AUDIT-2026-10.md` marks N6 fixed (S42) and N5 and N12 accepted. Rewrite "Open now" from the audits' own status columns (reviews 13 and 15 to 18 in `docs/agents/AUDIT-2026-11-REVIEW-*.md`, the V3, V6, V7, UI and delta audits) and the briefs still open in `TASKS.md`.
2. `ARCHITECTURE.md` "Open work": name reviews 13 and 15 to 18 and that their blocking findings are fixed (P104 to P122). Keep the file short.
3. `architecture/DOCUMENTS.md` lists every file in `docs/agents`; add the review and audit files it lacks.

**P131. Tests for a lane task started from the chat (AGY).** Read this brief only. Use no subagents. Run every command in the foreground. Commit each step as you finish it, and stop starting new work at minute 30. Change no file outside the list. Files: tests/project-task.test.js, docs/agents/CHANGELOG.md.

1. P113 moved the project-run guards of `server/runs.js` into `startProjectTask`, which both the runs route and the chat's lane dispatch (`startLaneTask` in `server/index.js`) call. No test calls `startProjectTask` directly. Write `tests/project-task.test.js` with a fake runner command (see how `tests/project-dispatch.test.js` builds `createRunsApi`), so no real lane starts.
2. Cover, by what each proves: a git project with `worktree: true` passes `--worktree` to the runner; a project that is not git runs without `--worktree`; a dirty git project is refused with the dirty sentence and starts nothing; the project being this repository is refused; an inactive or unknown lane is refused; a second start of a running lane answers 409; a good start answers 202 once, and the runner gets `--started-by orchestrator` when asked.
3. If a case shows a real bug, keep its test marked `it.fails` with one line saying what is wrong, and name it in your report. Do not fix `server/`.
4. Run `node node_modules/vitest/vitest.mjs run tests/project-task.test.js`. Report what passed.

## The fixes from review 19 (2026-11-13)

Review 19 (`docs/agents/AUDIT-2026-11-REVIEW-19.md`, P126) found five findings that block a push and one that does not. These three briefs touch separate files. Stop starting new work at minute 30: the machine shuts down at 4 am.

**P132. Every saved chat string is masked, whole, before it is cut (OpenCode).** Read review 19 findings 1, 2, 3 and 6, and this brief only. Use no subagents. Run every command in the foreground. Commit each step as you finish it. Files: server/orchestrator.js, tests/orchestrator.test.js, docs/agents/CHANGELOG.md.

1. Finding 2: in `restoredAgent` and every other place in `server/orchestrator.js` that caps a string from a saved or incoming message, mask the whole string first, then cut it.
2. Finding 1: `cleanWork` masks each `work.steps[].tool` and `target` string, whole, before it shortens it, for both the current and the saved conversations.
3. Finding 3: the shared message sanitizer (`maskText`) also replaces a profile folder prefix (the user profile, HOME, LOCALAPPDATA and TEMP, case-insensitive on Windows) with `%USERPROFILE%`, `~`, `%LOCALAPPDATA%` or `%TEMP%`, longest first, and keeps the rest of the path. Reuse `printedRunsFolder` from `scripts/run-lane.mjs` if it can be imported without side effects; otherwise share a small helper.
4. Finding 6: a saved `sub-` or `sub:` sender is kept only when that sub exists, and an agent message's `from` and `to` only when each is a known lane key, a known sub, `orchestrator` or `owner`.
5. Tests, by what they prove: a key in a saved step's target never reaches the chat answer or the file; a key at offset 61 of a long name is masked; a profile path in an agent report prints masked; an invented sub sender is dropped on load.
6. Run `node node_modules/vitest/vitest.mjs related --run server/orchestrator.js` and `npm run build`. Report what passed.

**P133. A brief's file list is the real Files line, not a quoted one (AGY).** Read review 19 finding 5 and this brief only. Use no subagents. Run every command in the foreground. Commit each step as you finish it. Files: src/briefs/briefs.js, tests/briefs.test.js, docs/agents/CHANGELOG.md.

1. `briefFileList` takes the last `Files:` marker. Briefs P116 and P121 quote the marker later inside backticks, so their lists come back empty. Ignore a marker inside backticks or quotes, then take the last real one, then keep P121's paragraph cutoff.
2. Tests, by what they prove: the real bodies of P116, P121, P124 and P132 (parse `docs/agents/TASKS.md` itself) each give the files on their `Files:` line; a quoted marker adds nothing; the review's two-paragraph example still gives one file.
3. Run `node node_modules/vitest/vitest.mjs related --run src/briefs/briefs.js` and `npm run build`. Report what passed.

**P134. The conversation menu never acts on a row that left the list (Codex).** Read review 19 finding 4 and this brief only. Change only the files listed; the runner commits them. Files: src/ui/Sidebar.jsx, tests/sidebar-menu-ui.test.js.

1. In `src/ui/Sidebar.jsx`, when the menu's row is no longer in the rows on screen, or its current flag changed, close the menu and drop its key listener. Never act from the saved row snapshot.
2. Add a test to `tests/sidebar-menu-ui.test.js`, following the tests already there: open the menu on the current row, change which conversation is current so that row leaves the list, press F, and no fork or branch call is made.
3. You cannot run vitest here. Check your change by reading the existing menu tests and say in your report which test you added and what it asserts.

**P135. Review P123, P125, P128 and P131 (AGY).** Read `docs/agents/OWNER.md` and this brief only. Change no code. Commit only your file. Stop at minute 25. Files: docs/agents/AUDIT-2026-11-REVIEW-20.md.

Review, with `git show -m --first-parent SHA` for each, against the code around each change: `2ab7f858` (P123, run-lane masks profile paths in what it prints), `a558636b` (P125, a project switch uses the runner's stale lock check), `cc1cf0ee` (P128, the file-index test takes its write rule from `src/model/commands.js`), `26adbf0e` (P131, tests for `startProjectTask`). Hunt for: a printed path that still names a profile folder, or a masked path that hides which folder a run used; a live lane lock counted as stale, or a stale one counted as live; a test that can no longer fail; a test that starts a real lane or writes outside its temp folder. Write the file: a table of at most 6 findings, the most harmful first, each with `file:line`, what goes wrong and when, the smallest fix, and whether it blocks a push. Write no finding you cannot point to in the code. An empty table with what you checked is a good answer.

**P136. Run the full suite and sort its failures (OpenCode).** Read this brief only. Use no subagents. Change no file except your report. Stop at minute 25. Files: docs/agents/RUN-2026-11-13-SUITE.md.

1. Run `node scripts/test.mjs` once in the foreground and keep its output.
2. For each failing test, run its file alone three times with `node node_modules/vitest/vitest.mjs run FILE`. Sort each failure as: fails alone every time (a real failure), fails only in the full run (load or order), or fails only on this machine (it reads `public/recordings` or another ignored local folder).
3. Write `docs/agents/RUN-2026-11-13-SUITE.md`: the commit you ran at, the totals, then one line per failure with its file, test name, first assertion line and its sort. Commit it.

**P137. Up to three small open findings from reviews 13, 15 and 16 (OpenCode).** Read this brief, then the finding tables of `docs/agents/AUDIT-2026-11-REVIEW-13.md`, `docs/agents/AUDIT-2026-11-REVIEW-15.md` and `docs/agents/AUDIT-2026-11-REVIEW-16.md`. Use no subagents. Run every command in the foreground. Commit each fix as you finish it, and stop starting new work at minute 30. Do not touch `server/orchestrator.js`, `src/briefs/briefs.js`, `tests/tree-partial.test.js` or `tests/git.test.js`: other lanes hold them. Files: any others, plus docs/agents/CHANGELOG.md.

1. For each finding marked as not blocking a push, check the code: is it still there, or did a later brief fix it? List each with its state in your report.
2. Fix at most three that are still there, the smallest and safest first, each with a test that proves it. Skip any that needs a design choice or touches a held file, and say why.
3. Run `node node_modules/vitest/vitest.mjs related --run` on every file you changed and `npm run build`. Report what passed.

## The fixes from review 20 (2026-11-13)

Review 20 (`docs/agents/AUDIT-2026-11-REVIEW-20.md`, P135, the first review on Gemini 4 Hydrogen) found two findings that block a push and four that do not. These three briefs touch separate places. Stop starting new work at minute 25: the machine shuts down at 4 am.

**P138. Every lane lock check uses the runner's stale test (AGY).** Read review 20 findings 2, 4 and 5, and this brief only. Use no subagents. Run every command in the foreground. Commit each step as you finish it. Files: server/lanes-source.js, server/runs.js, tests/lanes-source.test.js, tests/runs-folder.test.js, docs/agents/CHANGELOG.md.

1. `laneLockAlive` in `server/lanes-source.js` and in `server/runs.js` use `isHolderAlive(holder.pid, path) || isHolderAlive(holder.child, path)` from `scripts/lane-lock.mjs`, as `server/projects.js` does since P125.
2. Do not change `scripts/run-lane.mjs`; finding 4 there goes to P140.
3. Tests, by what they prove: a stale lock whose pid was reused on Windows does not keep an orphan run open or mark a lane busy; a live child keeps it open.
4. Run `node node_modules/vitest/vitest.mjs related --run server/lanes-source.js server/runs.js` and `npm run build`. Report what passed.

**P139. The file-index test checks write modes on its own (OpenCode).** Read review 20 finding 1 and this brief only. Use no subagents. Run every command in the foreground. Commit each step as you finish it. Files: tests/file-index.test.js, docs/agents/CHANGELOG.md.

1. P128 made the test's reference walk call `touchesForCommand` for write modes, so a write-mode bug in `src/model/commands.js` shows on both sides and the test cannot catch it. Give the reference walk its own small write-target helper again (redirect operands, the file a writer such as `tee` or `Set-Content` names, `sed -i` outside quotes, and the mutators), with the P110 rule that `cat >> name~` reads. Strip heredocs as `commands.js` does.
2. Prove the test can fail: break one write rule in a scratch copy of the logic inside the test (not in `src/`), see the test fail, and leave a short test that keeps that proof.
3. Run `node node_modules/vitest/vitest.mjs run tests/file-index.test.js`. Report what passed.

**P140. Dry runs and lock refusals print no profile folder (Codex).** Read review 20 findings 3, 4 and 6, and this brief only. Change only the files listed; the runner commits them. Files: scripts/run-lane.mjs, scripts/lane-lock.mjs, tests/run-lane.test.js, tests/lane-lock.test.js.

1. Finding 3: `printCommand` in `scripts/run-lane.mjs` passes every path it prints (the program, the MCP config, the usage file and any runs-folder path inside `args`) through `printedRunsFolder`, and masks `APPDATA` as `%APPDATA%` too. Keep the `%TEMP%` paths the existing tests assert.
2. Finding 4: `refuseRunningLane` checks the child with `isHolderAlive(holder.child, lock)`.
3. Finding 6: the lock refusal sentences in `takeProjectLock` and in `running()` of `scripts/lane-lock.mjs` print the lock path through `printedRunsFolder`; update the test that builds that sentence.
4. You cannot run vitest here. Say in your report which tests you added or changed and what each asserts.

**P141. Review P133, P134, P139 and P140 (Codex).** Read `docs/agents/OWNER.md` and this brief only. Change no code. Do not commit: the runner commits your file. Stop at minute 20. Files: docs/agents/AUDIT-2026-11-REVIEW-21.md.

Review, with `git show -m --first-parent SHA`, against the code around each change: `d59a4929` (P133, `briefFileList` masks quoted spans before it finds the `Files:` marker), `b8126a17` (P134, the conversation menu closes when its row leaves the list), `61e2eb3d` (P139, the file-index test has its own write rules again), `99b41a3b` (P140, dry runs and lock refusals mask profile folders; the lock refusal is masked where `run-lane` prints errors). Hunt for: a real file list lost or a wrong one kept, including a brief with an apostrophe in its prose; a menu that closes while in use or acts on another row; a test that cannot fail; a printed path that still names a profile folder, or a masked one that breaks a command the owner copies. Write the file: a table of at most 6 findings, the most harmful first, each with `file:line`, what goes wrong and when, the smallest fix, and whether it blocks a push. An empty table with what you checked is a good answer.

## The fixes from review 21 (2026-11-13)

Review 21 (`docs/agents/AUDIT-2026-11-REVIEW-21.md`, P141) found four findings that block a push. These three briefs touch separate files. Stop starting new work at minute 18: the machine shuts down at 4 am.

**P142. The menu knows which conversation is current (OpenCode).** Read review 21's first finding and this brief only. Use no subagents. Run every command in the foreground. Commit each step as you finish it. Files: src/ui/Sidebar.jsx, src/ui/sidebar.js, tests/sidebar-menu-ui.test.js, docs/agents/CHANGELOG.md.

1. The bridge always names the current conversation `id: 'current'`, so the menu's key survives a switch. When the menu opens, keep a second identity for its row (for the current row, its start time and title, or a session id if the answer carries one) and close the menu when that identity changes.
2. Change the P134 test so the switch keeps `id: 'current'` as the bridge does, and press P: no pin reaches the new conversation.
3. Run `node node_modules/vitest/vitest.mjs related --run src/ui/Sidebar.jsx src/ui/sidebar.js` and `npm run build`. Report what passed.

**P143. A brief's file list ignores only code, not prose quotes (AGY).** Read review 21's second and fourth findings and this brief only. Use no subagents. Run every command in the foreground. Commit each step as you finish it. Files: src/briefs/briefs.js, tests/briefs.test.js, docs/agents/CHANGELOG.md.

1. In `briefFileList`, mask only code: fenced blocks of three or more backticks or tildes, closed by a fence of the same character and at least the same length, and inline backtick spans. Do not mask single or double quotes: prose apostrophes such as `'em` and `agents'` and `René's` must never hide the marker.
2. Tests, by what they prove: the review's four-backtick and tilde fence examples give `src/real.js`; both apostrophe sentences give `src/real.js`; the real bodies of P116, P121, P124 and P132 still give their files.
3. Run `node node_modules/vitest/vitest.mjs related --run src/briefs/briefs.js` and `npm run build`. Report what passed.

**P144. Project paths in run-lane output are masked too (OpenCode).** Read review 21's third finding and this brief only. Use no subagents. Run every command in the foreground. Commit each step as you finish it. Files: scripts/run-lane.mjs, tests/run-lane.test.js, docs/agents/CHANGELOG.md.

1. The two project-lock refusals in `takeProjectLock`, and the project and worktree lines of queue and worktree dry runs, print the project through `printedRunsFolder`. The paths the runner uses do not change.
2. A test with a project below a profile folder and the runs folder elsewhere: the refusal and the dry run name the project with the profile masked.
3. Run `node node_modules/vitest/vitest.mjs run tests/run-lane.test.js` and `npm run build`. Report what passed.

**P145. Finish P124, the merge check that does not block the bridge (OpenCode).** Read the brief for P124 in TASKS.md and this brief only. Use no subagents. Run every command in the foreground. Commit each step as you finish it, and stop starting new work at minute 18. Files: server/orchestrator.js, tests/orchestrator.test.js, docs/agents/CHANGELOG.md.

1. Start with `git merge --no-edit refs/heads/feat/p124-the-merge-check`. Its last commit holds the unfinished work of a run that hit its time limit. Build on it; do not redo it.
2. Finish only what P124 still lacks, then run `node node_modules/vitest/vitest.mjs related --run server/orchestrator.js` and `npm run build`. If they do not pass by minute 20, commit what you have and say what is left.

**P146. Finish P129, two tests that fail only under load (OpenCode).** Read the brief for P129 in TASKS.md and this brief only. Use no subagents. Run every command in the foreground. Commit each step as you finish it, and stop starting new work at minute 18. Files: tests/tree-partial.test.js, tests/git.test.js, docs/agents/CHANGELOG.md.

1. Start with `git merge --no-edit refs/heads/feat/p129-two-tests-that`. Its last commit holds the unfinished work of a run that hit its time limit. Build on it; do not redo it.
2. Run each of the two files five times alone; report the counts. If either still fails, commit what you have and say what is left.

**P147. The detail docs catch up with P125 to P142 (OpenCode).** Read this brief, `docs/agents/ARCHITECTURE.md` and the detail files below. Use no subagents. Commit each step as you finish it, and stop starting new work at minute 18. Change no code. Files: docs/agents/architecture/ROOM.md, docs/agents/architecture/LIVE.md, docs/agents/architecture/COMMANDS.md, docs/agents/architecture/CODE.md.

1. Read the merges since `9d03cec2` with `git log --first-parent --oneline 9d03cec2..HEAD` and `git show -m --first-parent`. Bring the four files in line with the code: lane lock liveness (P125, P138), masked paths in run-lane output and dry runs (P123, P140), the brief file list rules (P133), the conversation menu closing on a changed row (P134, P142), the file-index test (P128, P139) and the new tests file `tests/project-task.test.js` (P131).
2. Plain words, short sentences, no em dashes. Where a doc disagrees with the code, the code wins.

**P148. The path masker gets its own module (OpenCode).** Read this brief only. Use no subagents. Run every command in the foreground. Commit each step as you finish it, and stop starting new work at minute 15. Files: server/printed-path.js, scripts/run-lane.mjs, server/orchestrator.js, tests/printed-path.test.js, docs/agents/architecture/CODE.md, package.json.

1. Move `printedRunsFolder` and the helpers only it uses (`isWindowsPath`, `matchPathPrefix`, `testPrefix`, `readEnv` and the real-path helper it needs) from `scripts/run-lane.mjs` into a new `server/printed-path.js` with no other imports than `node:` modules. `scripts/run-lane.mjs` imports it from there and re-exports `printedRunsFolder` so its tests still pass.
2. `server/orchestrator.js` imports it from `server/printed-path.js`, not from `scripts/run-lane.mjs`. Change only that import line in `server/orchestrator.js`: another lane edits the rest of it.
3. Add `server/printed-path.js` to the `files` list of `package.json` if the list names server files one by one, and one line for it in `docs/agents/architecture/CODE.md`. Move the masking tests that call `printedRunsFolder` directly into `tests/printed-path.test.js` only if that is a plain move.
4. Run `node node_modules/vitest/vitest.mjs related --run server/printed-path.js scripts/run-lane.mjs server/orchestrator.js`, `npm run build` and `npm run pack-check`. Report what passed.

**P149. Review the last merges before the shutdown (Codex).** Read `docs/agents/OWNER.md` and this brief only. Change no code. Do not commit: the runner commits your file. Stop at minute 12. Files: docs/agents/AUDIT-2026-11-REVIEW-22.md.

Review, with `git show -m --first-parent SHA`, against the code around each change: `b06c625e` (P132, saved chat strings masked whole before they are cut), `e74e9c86` (P138, lane lock liveness in the lane source and the runs route), `55ed7e00` (P142, the menu row identity), `2bf33102` (P143, a brief file list ignores only code), `c149fa89` (P144, project paths masked in run-lane output), `5a3ba672` (P145, the async merge check), `f1c1123f` (P146, the two load tests). Hunt for: a key or profile path that still reaches the page or a saved file; a live lane counted as stale or a stale one as live; a menu that closes while in use; a real file list lost; a turn that never starts, or two git checks at once; a test that cannot fail. Write the file: a table of at most 6 findings, the most harmful first, each with `file:line`, what goes wrong and when, the smallest fix, and whether it blocks a push. An empty table with what you checked is a good answer.

**P150. Run the full suite before the shutdown (OpenCode).** Read this brief only. Change no file except your report. Stop at minute 15. Files: docs/agents/RUN-2026-11-13-SUITE-2.md.

1. Run `node scripts/test.mjs` once in the foreground.
2. For each failing test, run its file alone twice. Write `docs/agents/RUN-2026-11-13-SUITE-2.md`: the commit, the totals, and one line per failure with its file, test name, first assertion line and whether it fails alone. Commit it.

**P151. Every chat string the bridge saves is masked (OpenCode).** Read review 22's first finding in `docs/agents/AUDIT-2026-11-REVIEW-22.md` and this brief only. Use no subagents. Run every command in the foreground. Commit each step as you finish it, and stop starting new work at minute 18. Files: server/orchestrator.js, tests/orchestrator.test.js, docs/agents/CHANGELOG.md.

1. In `server/orchestrator.js`, pass through `maskText` before any length cap: the current title and a saved session's title when the owner renames them, and on restore the current title, the compact rules and both summaries. Mask a compaction report before it becomes the summary. Change only these spots: another lane edits the conversation identity in the same file.
2. Tests, by what they prove: a rename with a synthetic profile path and a fake key is saved masked; a chat file that holds a raw title, rules and summary is masked after restore and the next save.
3. Run `node node_modules/vitest/vitest.mjs related --run server/orchestrator.js` and `npm run build`. Report what passed.

**P152. Project errors and the queue summary in run-lane print masked paths (OpenCode).** Read review 22's third finding in `docs/agents/AUDIT-2026-11-REVIEW-22.md` and this brief only. Use no subagents. Run every command in the foreground. Commit each step as you finish it, and stop starting new work at minute 18. Files: scripts/run-lane.mjs, tests/run-lane.test.js, docs/agents/CHANGELOG.md.

1. The missing-project, not-a-folder and not-a-git-repo errors name the project through `printedRunsFolder`. A finished queue with `--worktree` passes `printedRunsFolder(target.path)` to `formatQueueSummary`. The paths the runner uses do not change.
2. A test for each route with the project below a profile folder and the runs folder elsewhere: the printed text holds the masked path and not the raw one. Mark a test Windows only with `it.skipIf(process.platform !== 'win32')` only if it uses `%LOCALAPPDATA%` or `%TEMP%`.
3. Run `node node_modules/vitest/vitest.mjs run tests/run-lane.test.js` and `npm run build`. Report what passed.

**P153. The current conversation keeps one identity while it grows (AGY).** Read review 22's fourth finding in `docs/agents/AUDIT-2026-11-REVIEW-22.md` and this brief only. Use no subagents. Run every command in the foreground. Commit each step as you finish it. Files: server/orchestrator.js, src/ui/sidebar.js, src/ui/Sidebar.jsx, tests/orchestrator.test.js, tests/sidebar.test.js, docs/agents/CHANGELOG.md.

1. The bridge gives the current conversation a stable id that changes only on new, open and fork, and sends it with the sessions answer (as `sessionId` or in place of `startedAt` from the oldest kept message). It is saved with the chat so a restart keeps it. Change only the conversation identity in `server/orchestrator.js`: another lane edits the title and summary masking in the same file.
2. `sessionRowIdentity` in `src/ui/sidebar.js` uses that id for the current row. The menu still closes when the conversation is switched, opened or forked.
3. Tests, by what they prove: with 200 messages kept, one more report leaves the current row's identity and the open menu unchanged; a new conversation changes it.
4. Run `node node_modules/vitest/vitest.mjs related --run server/orchestrator.js src/ui/sidebar.js src/ui/Sidebar.jsx` and `npm run build`. Report what passed.

**P154. Trace why the masked log line test fails on Linux (OpenCode).** Read this brief only. Use no subagents. Run every command in the foreground. Commit each step as you finish it, and stop starting new work at minute 18. Files: tests/run-lane.test.js, server/printed-path.js, scripts/run-lane.mjs, tests/lane-env.test.js, tests/made-lane-defaults.test.js, tests/run-project.test.js, tests/run-queue.test.js, tests/run-worktree.test.js, docs/agents/CHANGELOG.md.

1. The test `masks the printed log and record lines in startLane without changing written files or record paths` in `tests/run-lane.test.js` is Windows only since `0ad86747` (its `shortcut:` comment). On Ubuntu CI it failed: the printed lines did not include `log: ~/custom-runs/run-masked.log`. Read the test's environment (TEMP, HOME, USERPROFILE, LOCALAPPDATA, XDG_STATE_HOME) against `printedRunsFolder` in `server/printed-path.js` and the print sites in `startLane`. Find the cause by reading and by calling `printedRunsFolder` with posix-style paths and env in a Node one-liner. If `wsl` answers on this machine, run the test there too.
2. If you find and fix the cause, remove the `skipIf` and the `shortcut:` comment. If you cannot prove it, leave the skip and write the likely cause in the changelog line.
3. Remove the `printedRunsFolder` imports no test uses in the five other test files listed above.
4. Run `node node_modules/vitest/vitest.mjs related --run server/printed-path.js scripts/run-lane.mjs` and `npm run build`. Report what passed.

**P155. The detail docs catch up with P143 to P148 (Codex).** Read this brief, `docs/agents/ARCHITECTURE.md` and the detail files below. Change no code. Do not commit: the runner commits your files. Stop at minute 15. Files: docs/agents/architecture/ROOM.md, docs/agents/architecture/LIVE.md, docs/agents/architecture/COMMANDS.md, docs/agents/architecture/CODE.md, docs/agents/architecture/LIMITS.md.

1. Read the merges since `2061a5a6` with `git log --first-parent --oneline 2061a5a6..HEAD` and `git show -m --first-parent`: P143 (a brief's file list ignores only code), P144 (project paths masked in run-lane output), P145 (the merge check no longer blocks the bridge), P146 (two load tests wait for state) and P148 (`server/printed-path.js`). Bring the five files in line with the code. Add to `LIMITS.md` that the masked log line test in `tests/run-lane.test.js` runs on Windows only until its Linux case is traced.
2. Plain words, short sentences, no em dashes. Where a doc disagrees with the code, the code wins. Change nothing that is already right.

**P156. The stop test that fails now and then (OpenCode).** Read this brief only. Use no subagents. Run every command in the foreground. Commit each step as you finish it, and stop starting new work at minute 18. Files: tests/run-lane-stop.test.js, scripts/run-lane.mjs, docs/agents/CHANGELOG.md.

1. `--stop kills the run, the harness and the grandchild before it writes` in `tests/run-lane-stop.test.js` failed once at line 182 (`expect(stopped.code).toBe(0)`) during P151's related run, then passed alone. Run the file alone ten times and note each result. Print `stopped.stdout` and `stopped.stderr` when the code is not 0 so a failure says why.
2. Find why `--stop` can exit non-zero: read the stop path in `scripts/run-lane.mjs` against the test's timing. Fix the cause in the test if the test races, or in the stop path if a real stop can fail the same way. Do not raise a timeout to hide it.
3. Run the file ten times again and report both counts. Run `node node_modules/vitest/vitest.mjs related --run scripts/run-lane.mjs` and `npm run build` if you changed the script. Report what passed.

**P157. P153 again, with the tests that check the sessions answer (AGY).** Read the brief for P153 in TASKS.md, review 22's fourth finding and this brief only. Use no subagents. Run every command in the foreground. Commit each step as you finish it. Files: server/orchestrator.js, src/ui/sidebar.js, src/ui/Sidebar.jsx, src/control/mock.js, tests/orchestrator.test.js, tests/orchestrators.test.js, tests/control-contract.test.js, tests/sidebar.test.js, docs/agents/CHANGELOG.md.

1. Do P153's steps. P153 stopped because `tests/orchestrators.test.js` checks the empty sessions answer with `toEqual`. Update that assertion, and the mock and its contract test if they shape the same answer, to carry the new stable id. Keep `startedAt` as it is: add the id as its own field.
2. P151 is merged and edits the title and summary lines of `server/orchestrator.js`; start from current main and change only the conversation identity there.
3. Run `node node_modules/vitest/vitest.mjs related --run server/orchestrator.js src/ui/sidebar.js src/ui/Sidebar.jsx src/control/mock.js` and `npm run build`. Report what passed.

**P158. The merge check's related tests run again (OpenCode).** Read this brief only. Use no subagents. Run every command in the foreground. Commit each step as you finish it, and stop starting new work at minute 15. Files: scripts/merge-lane.mjs, tests/merge-lane.test.js, docs/agents/CHANGELOG.md, docs/agents/architecture/COMMANDS.md.

1. Since `a192ffd4`, `runChecks` in `scripts/merge-lane.mjs` runs `vitest related --run -- FILES`. With the `--`, vitest 5 sees no files, prints `No changed files found, exiting with code 0` and passes, so the check has run no test since 2026-11-11. Check it: `node node_modules/vitest/vitest.mjs related --run -- scripts/run-lane.mjs` runs nothing, and without `--` it runs the related files.
2. Drop the `--`. Keep the reason it was added: a changed file whose name starts with `-` is passed as `./NAME`. A check whose output says `No changed files found` fails with that sentence, so a silent skip can never pass again. A change with only docs still passes.
3. Replace the test from `a192ffd4` with tests by what they prove: no `--` before the files; a file named `-x.js` is passed as `./-x.js`; an output of `No changed files found` fails the check. Correct COMMANDS.md if it describes the command.
4. Run `node node_modules/vitest/vitest.mjs related --run scripts/merge-lane.mjs` and `npm run build`. Report what passed and how many test files the related run ran.

**P159. Run the full suite on today's merges (OpenCode).** Read this brief only. Change no file except your report. Stop at minute 18. Files: docs/agents/RUN-2026-11-13-SUITE-3.md.

1. The merge check ran no tests from 2026-11-11 until P158, so run `node scripts/test.mjs` once in the foreground.
2. For each failing test, run its file alone twice. Write `docs/agents/RUN-2026-11-13-SUITE-3.md`: the commit, the totals, and one line per failure with its file, test name, first assertion line and whether it fails alone. Commit it.

**P160. Review today's merges (Codex).** Read `docs/agents/OWNER.md` and this brief only. Change no code. Do not commit: the runner commits your file. Stop at minute 15. Files: docs/agents/AUDIT-2026-11-REVIEW-23.md.

Review, with `git show -m --first-parent SHA`, against the code around each change: `e7e679d4` (P152, run-lane project errors and queue summary masked), `c9dd917e` (P154, a posix path keeps `~` when USERPROFILE is set), `4aefbf9c` (P151, chat titles, rules and summaries masked), `9122ea82` (two tests expect masked paths), `0bfb0964` (P156, a stop counts a gone process as stopped), `f6846d14` (P158, the merge check's related tests run again) and `eff20dd9` (P157, a stable current conversation id). Hunt for: a profile path or key that still reaches the page, a saved file or run output; a Windows path masked with `~` or a posix path with a Windows label; a stop that reports success while a process lives, or a reused pid; a merge check that passes without running tests, or fails a docs-only merge; a conversation id that changes while the conversation stays, or stays across new, open and fork; a test that cannot fail. Write the file: a table of at most 6 findings, the most harmful first, each with `file:line`, what goes wrong and when, the smallest fix, and whether it blocks a push. An empty table with what you checked is a good answer.

**P161. Compaction rules are masked on save, and a profile path with a space is masked (OpenCode).** Read review 23's second and third findings in `docs/agents/AUDIT-2026-11-REVIEW-23.md` and this brief only. Use no subagents. Run every command in the foreground. Commit each step as you finish it, and stop starting new work at minute 18. Files: server/orchestrator.js, tests/orchestrator.test.js, docs/agents/CHANGELOG.md.

1. In `setAutocompact`, pass non-null `body.rules` through `maskText` before the existing length limit. Test a live save: the answer and the saved chat file hold the masked rules.
2. In the chat masker, replace each known profile prefix (`profileEnv`) with its label before scanning `PATH_TOKEN`, only at a path boundary, and case-insensitive for Windows paths. A profile folder whose name holds a space is then masked. Test a quoted Windows path under a profile folder with a space, and a word that only starts like the prefix is left alone.
3. Run `node node_modules/vitest/vitest.mjs related --run server/orchestrator.js` and `npm run build`. Report what passed.

**P162. Project refusals print masked paths, and a Windows path never gets ~ (OpenCode).** Read review 23's fourth and fifth findings in `docs/agents/AUDIT-2026-11-REVIEW-23.md` and this brief only. Use no subagents. Run every command in the foreground. Commit each step as you finish it, and stop starting new work at minute 18. Files: scripts/run-lane.mjs, server/printed-path.js, tests/run-lane.test.js, tests/printed-path.test.js, docs/agents/CHANGELOG.md.

1. Both print loops of `projectRefusals` sentences in `scripts/run-lane.mjs` (the project run and the queue run) print the project through `printedRunsFolder`. The paths the runner uses do not change. Test a dirty project below a profile folder: the refusal holds the masked path and not the raw one.
2. In `server/printed-path.js`, `$XDG_STATE_HOME` and `~` are candidates only for posix paths, as the Windows labels are only for Windows paths since P154. Test the inverse of P154's case: a Windows path below a Windows HOME that is longer than USERPROFILE gets `%USERPROFILE%`, not `~`.
3. Run `node node_modules/vitest/vitest.mjs related --run scripts/run-lane.mjs server/printed-path.js` and `npm run build`. Report what passed.

**P163. A stop never kills a reused descendant pid (AGY).** Read review 23's first finding in `docs/agents/AUDIT-2026-11-REVIEW-23.md` and this brief only. Use no subagents. Run every command in the foreground. Commit each step as you finish it. Files: scripts/run-lane.mjs, tests/run-lane-stop.test.js, docs/agents/CHANGELOG.md.

1. `stopLane` captures the harness descendants before it kills the harness tree. Keep each descendant's creation time from that process list. Before each later kill in `stopDescendants`, read the current row for that pid and skip it, counted as stopped, when the pid is gone or its creation time changed. Use the process list the stop already reads where you can; do not add a list read per pid.
2. Test with injected lists: a descendant whose pid is reused by a newer process is not killed and the lock is removed; a descendant that is still the same process is killed.
3. Run `node node_modules/vitest/vitest.mjs related --run scripts/run-lane.mjs` and `npm run build`. Report what passed.

**P164. What stands between the owner and daily use of MachineRoom (Codex).** Read `docs/agents/OWNER.md`, `README.md`, `docs/agents/ARCHITECTURE.md`, `docs/agents/PLAN.md` (its Next section) and the detail files under `docs/agents/architecture/` you need. Change no code. Do not commit: the runner commits your file. Stop at minute 25. Files: docs/agents/AUDIT-2026-11-READINESS.md.

The owner wants to start using MachineRoom on their own projects. Read the code along the path they will take: `npm install`, `npm run build`, `npm run serve -- doctor` and `up`, `machineroom FOLDER`, the connect screen, the live room with `--lanes --sessions`, the chat with the orchestrator, starting a lane from the room, a task or a queue on another project, and the review and merge routes. Write the file with three tables, the most important first in each:

1. Blockers, at most 8: what fails, confuses or loses work on that path today. Each with `file:line`, what goes wrong and when, and the smallest fix.
2. Bug patches, at most 8: smaller defects found on the way, same columns.
3. Suggested features, at most 6: what the owner will miss in daily use, each with why, the smallest version, and the files it touches. Mark each `needs the owner's yes`.

Prefer what you confirmed by reading the code or by a command over a guess, and say which. An item already listed as open in PLAN.md or an audit gets its id, not a new row.

**P165. The claude sessions test that fails now and then on Windows CI (OpenCode).** Read this brief only. Use no subagents. Run every command in the foreground. Commit each step as you finish it, and stop starting new work at minute 18. Files: tests/claude-sessions.test.js, server/claude-sessions.js, docs/agents/CHANGELOG.md.

1. `notices a lane meta file written after the session file was registered` in `tests/claude-sessions.test.js` failed once on Windows CI at `8091f05d` with `expected [ { type: 'heartbeat.run.log', …(3) } ] to deeply equal []`. It passes alone here. Run the file ten times alone, then ten times while `node scripts/test.mjs` runs beside it, and note each result.
2. Find the race by reading the test against the reader's polling and meta file timing. Fix the test when it races (wait for a state, not a time), or the reader when a real lane could hit it. Do not raise a timeout to hide it.
3. Run the file ten times again and report both counts. Run `node node_modules/vitest/vitest.mjs related --run server/claude-sessions.js` and `npm run build` if you changed the reader. Report what passed.

**P166. Try the first-use commands the way a new owner would (OpenCode).** Read `README.md` and this brief only. Use no subagents. Run every command in the foreground with a time limit. Change no code. Stop at minute 18. Files: docs/agents/RUN-2026-11-13-FIRST-USE.md.

1. Set `MACHINEROOM_RUNS` to a new folder under `%TEMP%` for every command, and never start a bridge with `--lanes` on the testbench runs folder. Run, in order, the commands README gives a new owner that do not start a server: `npm run serve -- doctor` on this checkout and on `C:\GitHub\MachineRoomTestProject`, `npm run pack-check`, `npm run run-lane -- --list`, `npm run run-lane -- opencode --project C:\GitHub\MachineRoomTestProject --task "Say hello." --dry-run`, and each command's help or usage line.
2. Write the file: one row per command with what it printed in short, whether a new owner would know what to do next, and anything wrong, unclear or missing. End with the five changes that would help a new owner most. Stop every process you started. Commit the file.

**P167. run-lane helps a new owner (OpenCode).** Read `docs/agents/RUN-2026-11-13-FIRST-USE.md` and this brief only. Use no subagents. Run every command in the foreground. Commit each step as you finish it, and stop starting new work at minute 18. Files: scripts/run-lane.mjs, tests/run-lane.test.js, docs/agents/CHANGELOG.md, docs/agents/architecture/COMMANDS.md.

1. `npm run run-lane -- --help` and `-h` print a usage block and exit 0: the forms (a brief, `--project` with `--task` or `--task-file`, `--queue`, `--list`, `--stats`, `--outcomes`, `--stop`) and the common flags, each in one short line. A bare run with no lane prints the same block on stderr and exits 1. Replace the retired `hermes` example with a lane from the lane file in use.
2. `There is no lane named X.` adds the lane names in the lane file in use and its path, masked with `printedRunsFolder`, and says a lane is added in the room's Settings.
3. `--list` with no runs says which runs folder it read, masked, and how to start a run. A dry run ends with `Dry run, nothing started.` and prints the first line of the prompt after the character count.
4. A test for each. Run `node node_modules/vitest/vitest.mjs related --run scripts/run-lane.mjs` and `npm run build`. Report what passed.

**P168. doctor, pack-check and README for a new owner (OpenCode).** Read `docs/agents/RUN-2026-11-13-FIRST-USE.md` and this brief only. Use no subagents. Run every command in the foreground. Commit each step as you finish it, and stop starting new work at minute 18. Files: bin/machine-room.mjs, server/doctor.js, scripts/pack-check.mjs, tests/machine-doctor.test.js, tests/serve.test.js, tests/pack-check.test.js, README.md, docs/agents/CHANGELOG.md, docs/agents/architecture/COMMANDS.md.

1. `machine-room doctor FOLDER` takes the folder as `--root FOLDER`, as `machineroom FOLDER` does. Giving both is refused with one sentence.
2. When a check warns, doctor ends with `All checks passed, 1 warning.` (or N warnings) instead of `All checks passed.`; the exit code stays 0. When the project folder fails, the checks after it that read the project are skipped, so the one real block is the last thing printed.
3. `npm run pack-check -- --help` prints a usage line and exits 0 without running the check. A passing check also says what it checked in one line.
4. README's Quick start gets a short First run block: `npm install`, `npm run build`, `npm run serve -- doctor`, `machineroom FOLDER` (or `npm run serve -- up --root FOLDER`), each with the one line it prints when all is well. Plain words, short sentences, no em dashes.
5. Tests in the listed test files for steps 1 to 3. Run `node node_modules/vitest/vitest.mjs related --run bin/machine-room.mjs server/doctor.js scripts/pack-check.mjs` and `npm run build`. Report what passed.

**P169. A merge lands only on the branch its card named (AGY).** Read readiness findings R1 and Q4 in `docs/agents/AUDIT-2026-11-READINESS.md` and this brief only. Use no subagents. Run every command in the foreground. Commit each step as you finish it. Files: server/reviews.js, src/control/client.js, src/control/mock.js, src/ui/panels/ReviewsPanel.jsx, src/ui/panels/reviews.js, tests/project-reviews.test.js, tests/bridge-reviews.test.js, tests/reviews-panel.test.js, tests/control-contract.test.js, docs/agents/CHANGELOG.md.

1. Each review row carries its destination branch, that branch's head and the merge strategy (`fast-forward` on another project, `merge-commit` on MachineRoom). The merge request sends the destination branch and head beside the lane head. Under the existing write lock, the server refuses with one sentence, before any git write, when the project is now on another branch or that branch moved.
2. The confirm card hides the message field for a fast forward and says the lane's commits are kept as they are; the MachineRoom merge commit keeps its message field. The mock and the contract test follow the new fields.
3. Tests, by what they prove: a card for `trunk` confirmed after a switch to `release` is refused and `release` does not move; a card confirmed after `trunk` advanced is refused; a fresh card merges; a fast-forward card has no message field.
4. Run `node node_modules/vitest/vitest.mjs related --run server/reviews.js src/control/client.js src/control/mock.js src/ui/panels/ReviewsPanel.jsx src/ui/panels/reviews.js` and `npm run build`. Report what passed.

**P170. A merge never offers a head whose checks failed (AGY).** Read readiness findings R2 and Q2 in `docs/agents/AUDIT-2026-11-READINESS.md`, the brief for P169 and this brief only. Use no subagents. Run every command in the foreground. Commit each step as you finish it. Files: server/reviews.js, src/ui/panels/ReviewsPanel.jsx, src/ui/panels/reviews.js, tests/project-reviews.test.js, tests/reviews-panel.test.js, docs/agents/CHANGELOG.md.

1. `lastRunFor` matches the run's project to the reviewed project (a brief run counts for MachineRoom only), so a lane used on two projects shows each project its own last run. Test two projects sharing one lane.
2. Each review row carries a check state for its exact head: `passed` when the matching run's tests passed at that head, `failed` when they failed, `unchecked` otherwise. A clean worktree or a zero harness exit is not `passed`, and neither is a queue that found no test command (its summary says `tests: none`). The server refuses a merge whose head is `failed` with one sentence. The confirm card says the check state in one line, and `unchecked` reads as a warning. The Merge button stays as it is.
3. Tests, by what they prove: a failed head is refused and the branch does not move; an unchecked head merges with the warning in the card; a passed head merges.
4. Run `node node_modules/vitest/vitest.mjs related --run server/reviews.js src/ui/panels/ReviewsPanel.jsx src/ui/panels/reviews.js` and `npm run build`. Report what passed.

**P171. The connect screen's replay and recovery lines say what they do (OpenCode).** Read readiness findings Q3 and Q5 in `docs/agents/AUDIT-2026-11-READINESS.md` and this brief only. Use no subagents. Run every command in the foreground. Commit each step as you finish it, and stop starting new work at minute 15. Files: src/ui/Connect.jsx, tests/guide.test.js, tests/startup.test.js, docs/agents/CHANGELOG.md, docs/agents/architecture/ROOM.md.

1. The replay entry on the connect screen says it replays what this page has seen, with no fixed duration. The tour stays the sample entry point. Change only the words.
2. The recovery line leads with `machineroom YOUR-PROJECT`, and the npm form says to run it in the MachineRoom folder.
3. Update the tests that read these lines. Run `node node_modules/vitest/vitest.mjs related --run src/ui/Connect.jsx` and `npm run build`. Report what passed.

**P172. A queue finds its test command after each task (OpenCode).** Read readiness finding Q1 in `docs/agents/AUDIT-2026-11-READINESS.md` and this brief only. Use no subagents. Run every command in the foreground. Commit each step as you finish it, and stop starting new work at minute 18. Files: scripts/run-lane.mjs, src/briefs/queue.js, tests/run-queue.test.js, tests/run-worktree.test.js, docs/agents/CHANGELOG.md.

1. An explicit `--test` is kept. Otherwise the queue reads the default test command from the prepared worktree after each task that ends well, so a test script that a task adds, or one already on the project's head when a worktree is reused, is found. Another lane edits run-lane's help text; change only the queue's test choice.
2. Tests, by what they prove: a task that adds a `package.json` test script gets that script run after it; a reused worktree picks up a script on the project's head; `--test` wins over both.
3. Run `node node_modules/vitest/vitest.mjs related --run scripts/run-lane.mjs src/briefs/queue.js` and `npm run build`. Report what passed.

**P173. README and run-lane say where lanes are made, and how to run npm when PowerShell refuses it (OpenCode).** Read readiness findings R3 and the OWNER-ROOM #10 note in `docs/agents/AUDIT-2026-11-READINESS.md` and this brief only. Use no subagents. Run every command in the foreground. Commit each step as you finish it, and stop starting new work at minute 15. Files: README.md, scripts/run-lane.mjs, tests/run-lane.test.js, docs/agents/CHANGELOG.md.

1. README's Lanes section says a lane is made in the Agents tab: open the family tree, press Add child on the orchestrator, and fill in the label, harness, model and effort. Settings only shows or removes lanes. Read `src/ui/FamilyTree.jsx` and `src/ui/Settings.jsx` to get the words right.
2. README's First run block adds one short note for Windows PowerShell: when script policy refuses `npm`, use `npm.cmd` (and `npm.cmd link`); leave the execution policy as it is.
3. run-lane's missing-lane sentence ends with `Add a lane in the room's Agents tab.` instead of Settings. Update its test.
4. Run `node node_modules/vitest/vitest.mjs related --run scripts/run-lane.mjs` and `npm run build`. Report what passed.

**P174. Review the merges since the last push (Codex).** Read `docs/agents/OWNER.md` and this brief only. Change no code. Do not commit: the runner commits your file. Stop at minute 15. Files: docs/agents/AUDIT-2026-11-REVIEW-24.md.

Review, with `git show -m --first-parent SHA`, against the code around each change: `e75baac8` (the project-lock refusal test expects `~` on Linux), `59f34b62` (P165, the claude sessions meta test), `08e596d5` (P171, connect screen words), `8628117d` (P168, doctor takes a folder, counts warnings, stops at a missing folder; pack-check help; README First run), `44effcf2` (P167, run-lane help, missing-lane text, list and dry-run lines), `b88898ca` (P172, a queue finds its test command after each task) and `541429d8` (P173, where lanes are made). Hunt for: a profile path or key printed by the new help, list, dry-run or doctor lines; a flag or argument the new parsing now takes wrongly (a task text that starts with `-`, `--help` inside a task); a doctor or up run that now skips a check it needs; a queue that runs tests where it should not, or reports passed tests when none ran; README steps that do not match what the commands print; a test that cannot fail. Write the file: a table of at most 6 findings, the most harmful first, each with `file:line`, what goes wrong and when, the smallest fix, and whether it blocks a push. An empty table with what you checked is a good answer.

**P175. Review 24's four findings (OpenCode).** Read `docs/agents/AUDIT-2026-11-REVIEW-24.md` and this brief only. Use no subagents. Run every command in the foreground. Commit each step as you finish it, and stop starting new work at minute 18. Files: scripts/run-lane.mjs, tests/run-lane.test.js, tests/run-queue.test.js, README.md, docs/agents/CHANGELOG.md, docs/agents/architecture/COMMANDS.md.

1. A dry run prints the prompt only as `<prompt: N characters>`, as before P167. Remove the `prompt:` first-line output and its test.
2. `projectTestCommand` returns `''` only when `package.json` is absent or has no test script. An unreadable or invalid `package.json` gives a test command that fails with one sentence naming the file, so the queue stops on that task instead of committing it. Test a task that breaks `package.json`.
3. `--help` and `-h` count as help only where an option is expected. A value taken by `--task`, `--test`, `--model` or another value flag stays its value. Test `--task "--help" --dry-run`.
4. README's `npm run serve -- up --root FOLDER` fallback adds `--open`, so the room opens in the browser as the next line says.
5. Run `node node_modules/vitest/vitest.mjs related --run scripts/run-lane.mjs` and `npm run build`. Report what passed.

**P176. A broken package.json fails the queue task directly (OpenCode).** Read review 24's second finding in `docs/agents/AUDIT-2026-11-REVIEW-24.md` and this brief only. Use no subagents. Run every command in the foreground. Commit each step as you finish it, and stop starting new work at minute 15. Files: scripts/run-lane.mjs, tests/run-queue.test.js, docs/agents/CHANGELOG.md.

1. P175 handles an unreadable `package.json` by returning a `node -e` command as the test command. That command holds the node program path and is printed on the queue's `tests:` line, and its message names the raw file path. Remove `packageFileFailure`. `projectTestCommand` throws one error, `The package.json at FILE could not be read, so the tests cannot run.`, with FILE through `printedRunsFolder`. The queue's `runTests` catches it, prints the sentence and returns a failed outcome, so the task stops as `failed: tests` and nothing is committed. A dry run prints the sentence on its `tests:` line.
2. The P175 test for a broken `package.json` still passes; add assertions that the output holds no node program path and the masked file path.
3. Run `node node_modules/vitest/vitest.mjs related --run scripts/run-lane.mjs` and `npm run build`. Report what passed.

**P177. P170 again, with the run record fields it needs (AGY).** Read the brief for P170 in TASKS.md, readiness findings R2 and Q2 in `docs/agents/AUDIT-2026-11-READINESS.md` and this brief only. Use no subagents. Run every command in the foreground. Commit each step as you finish it. Files: scripts/run-lane.mjs, src/briefs/run.js, server/reviews.js, src/control/mock.js, src/ui/panels/ReviewsPanel.jsx, src/ui/panels/reviews.js, tests/run-lane.test.js, tests/run-queue.test.js, tests/project-reviews.test.js, tests/reviews-panel.test.js, tests/control-contract.test.js, docs/agents/CHANGELOG.md.

1. P170 stopped because run records hold neither the head a run ended on nor whether tests ran. A project run's record (single task and each queue task) gains `head`, the full SHA of the folder it worked in when its record is written, and `tests`: `passed`, `failed` or `none` (no test command found), or no field when the run does not test. Another lane changes `projectTestCommand` in `scripts/run-lane.mjs`; change only the record writing there.
2. Then do P170's steps 1 to 3 with these fields: `passed` only when a record's `tests` is `passed` and its `head` is the review head; `failed` when `tests` is `failed` at that head; `unchecked` otherwise, including `none`. The mock's sample reviews carry a check state and its merge refuses a `failed` head, and the contract test covers both.
3. Run `node node_modules/vitest/vitest.mjs related --run scripts/run-lane.mjs src/briefs/run.js server/reviews.js src/control/mock.js src/ui/panels/ReviewsPanel.jsx src/ui/panels/reviews.js` and `npm run build`. Report what passed.

**P178. What breaks after days of daily use (Codex).** Read `docs/agents/OWNER.md`, `docs/agents/AUDIT-2026-11-READINESS.md`, `docs/agents/architecture/LIMITS.md` and this brief only. Change no code. Do not commit: the runner commits your file. Stop at minute 25. Files: docs/agents/AUDIT-2026-11-READINESS-2.md.

P164 read the path to a first merged change. Read the code for what happens when the owner leaves the room running for days on several projects: the bridge's memory and timers, the growth of `runs.jsonl`, run logs, recordings, chat files, saved sessions and lane worktrees, and whether anything trims or rotates them; the page after hours open (frame rate, listeners, the live log and the session recorder); a bridge restart or a machine sleep in the middle of a lane run, a chat turn or a merge; two rooms open on the same project; and what the owner must clean by hand. Write the file with two tables, the most harmful first: at most 8 problems (`file:line`, what goes wrong and after how long or how much, the smallest fix) and at most 4 suggested features, each marked `needs the owner's yes`. Prefer what you confirmed by reading or a command over a guess, and say which. An item already in P164's audit or LIMITS.md gets its id, not a new row.

**P179. A full saved list never drops the current conversation (OpenCode).** Read finding D1 in `docs/agents/AUDIT-2026-11-READINESS-2.md` and this brief only. Use no subagents. Run every command in the foreground. Commit each step as you finish it, and stop starting new work at minute 18. Files: server/orchestrator.js, tests/orchestrator.test.js, docs/agents/CHANGELOG.md.

1. Before `archiveCurrentSession` archives or clears anything (new, open and fork), check whether the archive would fit: it fits when the list is below the limit or an older unpinned entry can be dropped. When it would not fit, answer 409 with one sentence that says the saved list is full of pinned conversations and to unpin or delete one, and keep the current conversation and its messages. Keep the limit. Another lane edits the chat recovery in the same file; change only the archive path.
2. Tests, by what they prove: with 50 pinned entries, New session answers 409 and the current messages stay; with 49 pinned and one unpinned older entry, New session archives the current one and drops that older entry; open and fork refuse the same way.
3. Run `node node_modules/vitest/vitest.mjs related --run server/orchestrator.js` and `npm run build`. Report what passed.

**P180. Chat recovery picks only its own turn's log (AGY).** Read finding D2 in `docs/agents/AUDIT-2026-11-READINESS-2.md` and this brief only. Use no subagents. Run every command in the foreground. Commit each step as you finish it. Files: server/orchestrator.js, tests/orchestrator.test.js, docs/agents/CHANGELOG.md.

1. When a chat turn starts, save the exact name of its `orchestrator-chat-*.log` with the conversation. On restore, recover only that log. For a chat file saved before this change, take only candidates whose metadata names this project, and write no record when more than one matches. Another lane edits the archive path in the same file; change only the turn log and recovery.
2. Tests, by what they prove: two projects share a runs folder, A restarts after an interrupted turn while B has the newest unfinished log, and A's record points at A's log while B's log gets none; an old chat file with two matching candidates writes no record.
3. Run `node node_modules/vitest/vitest.mjs related --run server/orchestrator.js` and `npm run build`. Report what passed.

**P181. A reconnect after a gap or a bridge restart resets the room (OpenCode).** Read finding D4 in `docs/agents/AUDIT-2026-11-READINESS-2.md` and this brief only. Use no subagents. Run every command in the foreground. Commit each step as you finish it, and stop starting new work at minute 20. Files: server/index.js, src/live/bridge.js, src/model/pipeline.js, src/Stage.jsx, tests/bridge-stream.test.js, tests/bridge-client.test.js, docs/agents/CHANGELOG.md, docs/agents/architecture/LIVE.md.

1. Activity event ids carry the bridge's start identity (as the tree already does). When a client reconnects with a cursor from another bridge, or one older than the kept history, the bridge first sends a reset frame and the current state of each live run, then the kept frames. The page clears the pipeline's seen ids and the room's run state on that reset and applies what follows.
2. Tests, by what they prove: a run whose finish fell out of the 500 kept frames is not left `working` after a reconnect; a cursor from a restarted bridge gets the reset; a normal reconnect inside the history gets no reset.
3. Run `node node_modules/vitest/vitest.mjs related --run server/index.js src/live/bridge.js src/model/pipeline.js` and `npm run build`. Report what passed.

**P182. Old Claude session files are not replayed as new work (OpenCode).** Read finding D6 in `docs/agents/AUDIT-2026-11-READINESS-2.md` and this brief only. Use no subagents. Run every command in the foreground. Commit each step as you finish it, and stop starting new work at minute 18. Files: server/claude-sessions.js, tests/claude-sessions.test.js, docs/agents/CHANGELOG.md.

1. When the reader evicts an idle session's state, keep a small marker of the file's size and change time (or the consumed position) so a later discovery of that unchanged file reads nothing, and an append reads only the new bytes. A file created after the reader started is still read from its start.
2. Tests, by what they prove: 201 idle files through several eviction cycles emit no old tool call; an append to a forgotten file emits only the new call.
3. Run `node node_modules/vitest/vitest.mjs related --run server/claude-sessions.js` and `npm run build`. Report what passed.

**P183. The session recorder has a frame and size ceiling (OpenCode).** Read finding D8 in `docs/agents/AUDIT-2026-11-READINESS-2.md` and this brief only. Use no subagents. Run every command in the foreground. Commit each step as you finish it, and stop starting new work at minute 15. Files: src/model/sessionRecorder.js, tests/session-recorder.test.js, docs/agents/CHANGELOG.md, docs/agents/architecture/LIVE.md.

1. Beside the time window, the recorder keeps at most 20,000 frames and about 20 MB of payload text, trimming the oldest first, and `recorderToReplay` marks the replay `truncated: true` when it trimmed for size. Keep the rolling time window as it is.
2. Tests, by what they prove: 30,000 frames at one timestamp keep 20,000 and mark the replay truncated; one oversized frame does not grow the kept size past the ceiling; a normal feed is not marked truncated.
3. Run `node node_modules/vitest/vitest.mjs related --run src/model/sessionRecorder.js` and `npm run build`. Report what passed.

**P184. A full disk or a failed record write is said, not hidden (OpenCode).** Read finding D3 in `docs/agents/AUDIT-2026-11-READINESS-2.md` and this brief only. Use no subagents. Run every command in the foreground. Commit each step as you finish it, and stop starting new work at minute 18. Files: scripts/run-lane.mjs, server/orchestrator.js, tests/run-lane.test.js, tests/orchestrator.test.js, docs/agents/CHANGELOG.md.

1. Every write stream run-lane opens for a lane log has an error listener: on an error it prints one sentence naming the log (masked with `printedRunsFolder`) and the error code, stops writing to that log, and lets the run go on to its record. A failed `appendRunRecord` prints one sentence and sets a non-zero exit code.
2. In the orchestrator, a chat run record that cannot be appended adds one room message saying the record was not saved and why, instead of being swallowed.
3. Tests with an injected failing stream and a failing append. Delete nothing and add no retention rule. Run `node node_modules/vitest/vitest.mjs related --run scripts/run-lane.mjs server/orchestrator.js` and `npm run build`. Report what passed.

**P185. A slow page cannot fill the bridge's memory (OpenCode).** Read finding D7 in `docs/agents/AUDIT-2026-11-READINESS-2.md` and this brief only. Use no subagents. Run every command in the foreground. Commit each step as you finish it, and stop starting new work at minute 18. Files: server/index.js, tests/bridge-stream.test.js, docs/agents/CHANGELOG.md, docs/agents/architecture/LIVE.md.

1. Every SSE write (frames, tree, keepalive, reset) goes through one helper that checks the response's `writableLength` after writing. Past 8 MB pending, the bridge ends that client's response and drops it from its client sets. The page reconnects and the P181 reset brings it back up to date.
2. Tests, by what they prove: a response whose `write` returns false and never drains is ended once its pending bytes pass the cap; a normal client is not ended; other clients keep receiving frames.
3. Run `node node_modules/vitest/vitest.mjs related --run server/index.js` and `npm run build`. Report what passed.

**P186. Run the full suite on the readiness merges (OpenCode).** Read this brief only. Change no file except your report. Stop at minute 18. Files: docs/agents/RUN-2026-11-13-SUITE-4.md.

1. Run `node scripts/test.mjs` once in the foreground.
2. For each failing test, run its file alone twice. Write `docs/agents/RUN-2026-11-13-SUITE-4.md`: the commit, the totals, and one line per failure with its file, test name, first assertion line and whether it fails alone. Commit it.

**P187. Review the readiness merges (Codex).** Read `docs/agents/OWNER.md` and this brief only. Change no code. Do not commit: the runner commits your file. Stop at minute 20. Files: docs/agents/AUDIT-2026-11-REVIEW-25.md.

Review, with `git show -m --first-parent SHA`, against the code around each change: `8f3269ca` (P175), `798d759e` (P176), `c30f8e2f` (P177, run records carry head and tests, review check states, failed-head refusal), `87555c4c` (P183, recorder ceiling), `e9e17fed` (P182, forgotten Claude session positions), `792b1745` (P179, a full pinned list refuses new, open and fork), `8b42589c` (P180, chat recovery by exact turn log) and `314e92b6` (P181, reset on a stale or foreign cursor). Hunt for: a merge allowed on a failed head or refused on a passed one; a run record whose `head` is not the commit its tests ran on; a conversation lost or refused wrongly at the saved limit; a recovery record on the wrong log, or none where one is due; a reconnect that leaves a finished run working, or resets on every reconnect; old session lines replayed, or new ones missed; a replay that grows past its ceiling; a test that cannot fail. Write the file: a table of at most 6 findings, the most harmful first, each with `file:line`, what goes wrong and when, the smallest fix, and whether it blocks a push. An empty table with what you checked is a good answer.

**P188. A check result is never erased or put on the wrong commit (AGY).** Read findings R1 and R2 in `docs/agents/AUDIT-2026-11-REVIEW-25.md` and this brief only. Use no subagents. Run every command in the foreground. Commit each step as you finish it. Files: server/reviews.js, scripts/run-lane.mjs, tests/project-reviews.test.js, tests/run-queue.test.js, docs/agents/CHANGELOG.md.

1. `checkStateFor` takes the newest record for this project, lane and head that has `tests` of `passed` or `failed`; a record without a test result never replaces one. Test a failed head followed by an untested retry: still `failed`, and both merge paths refuse it.
2. A queue task whose tests failed while its working tree differs from HEAD keeps its run record with `tests: 'failed'` but no `head`. Change `tests/run-queue.test.js` around line 712 to that. Test a passing task that made H, then a failing task, then its edits discarded: H reads `passed` and merges.
3. Run `node node_modules/vitest/vitest.mjs related --run server/reviews.js scripts/run-lane.mjs` and `npm run build`. Report what passed.

**P189. The recorder frees what it trims (OpenCode).** Read finding R3 in `docs/agents/AUDIT-2026-11-REVIEW-25.md` and this brief only. Use no subagents. Run every command in the foreground. Commit each step as you finish it, and stop starting new work at minute 12. Files: src/model/sessionRecorder.js, tests/session-recorder.test.js, docs/agents/CHANGELOG.md.

1. When the recorder drops a frame, it clears that array slot after subtracting its bytes. Keep the batched compaction.
2. Test 60 one-MiB payloads: the slots before `head` hold no frame, and `size()` and the replay length match the ceiling.
3. Run `node node_modules/vitest/vitest.mjs related --run src/model/sessionRecorder.js` and `npm run build`. Report what passed.

**P190. A forgotten Claude session keeps its run number (OpenCode).** Read finding R4 in `docs/agents/AUDIT-2026-11-REVIEW-25.md` and this brief only. Use no subagents. Run every command in the foreground. Commit each step as you finish it, and stop starting new work at minute 15. Files: server/claude-sessions.js, tests/claude-sessions.test.js, docs/agents/CHANGELOG.md.

1. The forgotten marker keeps `number` beside the offset, and a session rebuilt from it starts at that number.
2. Test with 201 files: an append to a forgotten session goes through the same live pipeline that took the first turn, and the pipeline emits the new tool call.
3. Run `node node_modules/vitest/vitest.mjs related --run server/claude-sessions.js` and `npm run build`. Report what passed.

**P191. A reconnect resets whenever any frame is missing, and replays in order (OpenCode).** Read findings R5 and R6 in `docs/agents/AUDIT-2026-11-REVIEW-25.md` and this brief only. Use no subagents. Run every command in the foreground. Commit each step as you finish it, and stop starting new work at minute 18. Files: server/index.js, tests/bridge-stream.test.js, docs/agents/CHANGELOG.md, docs/agents/architecture/LIVE.md.

1. `eventResetNeeded` resets when any sequence number between the cursor and the latest one is missing from the kept history, not only when the first one after the cursor is. Keep the cases the current tests cover (a current cursor, a following frame, a foreign cursor, an empty history after the cursor).
2. On a reset, the bridge sends the reset event and then the kept history once, in sequence order. Remove the separate `currentRunFrames` send if nothing else needs it, since the history already holds the pinned run starts.
3. Tests, by what they prove: cursor 1 with pinned start 2 and frames 15 onward resets; after a reset of a run that was queued then running, the final state through the real pipeline and state reducer is running.
4. Run `node node_modules/vitest/vitest.mjs related --run server/index.js` and `npm run build`. Report what passed.

**P192. Run the full suite on the review 25 fixes (OpenCode).** Read this brief only. Change no file except your report. Stop at minute 18. Files: docs/agents/RUN-2026-11-13-SUITE-5.md.

1. Run `node scripts/test.mjs` once in the foreground.
2. For each failing test, run its file alone twice. Write `docs/agents/RUN-2026-11-13-SUITE-5.md`: the commit, the totals, and one line per failure with its file, test name, first assertion line and whether it fails alone. Commit it.

**P193. Review the review 25 fixes (Codex).** Read `docs/agents/OWNER.md`, `docs/agents/AUDIT-2026-11-REVIEW-25.md` and this brief only. Change no code. Do not commit: the runner commits your file. Stop at minute 18. Files: docs/agents/AUDIT-2026-11-REVIEW-26.md.

Review, with `git show -m --first-parent SHA`, against the code around each change: the merges of P185 (an SSE client past 8 MB of backlog is ended; the check runs before each write), P189 (the recorder clears dropped slots), P184 (log and record write failures are said), P190 (a forgotten Claude session keeps its run number), P191 (reset on any missing frame, history replayed once in order) and P188 (check results kept across untested runs; a failed dirty queue task records no head). Find each with `git log --first-parent --oneline -12`. Say for each of review 25's R1 to R6 whether it is fixed. Hunt for: a client cut while it keeps up, or never cut while stuck; a reset on every normal reconnect; a passed head recorded while its tree was dirty; a failure that still writes no sentence or exits 0; a test that cannot fail. Write the file: a table of at most 6 findings, the most harmful first, each with `file:line`, what goes wrong and when, the smallest fix, and whether it blocks a push. An empty table with what you checked is a good answer.

**P194. The stream cap frees a stuck client and never cuts a late joiner (OpenCode).** Read findings R1 and R2 in `docs/agents/AUDIT-2026-11-REVIEW-26.md` and this brief only. Use no subagents. Run every command in the foreground. Commit each step as you finish it, and stop starting new work at minute 18. Files: server/index.js, tests/bridge-stream.test.js, docs/agents/CHANGELOG.md, docs/agents/architecture/LIVE.md.

1. A client dropped for its backlog is destroyed (`res.destroy()`), not ended, so its queued output is let go. Test with a real Node `ServerResponse` on a transport that never completes a write: after the drop its socket is destroyed.
2. The writes made while a client connects (the reset, the history replay and the first tree) are not checked against the cap. After them, the client may hold its backlog at that moment plus 8 MB; past that it is dropped. The history is at most 500 frames, so this stays bounded.
3. Test a late joiner through the real bridge with twelve one-MiB frames kept and a client that reads all the time: it receives all twelve and is not cut. Keep the stuck-client test.
4. Run `node node_modules/vitest/vitest.mjs related --run server/index.js` and `npm run build`. Report what passed.

**P195. The run cache reads in chunks and stops copying its whole history (AGY).** Read finding D5 in `docs/agents/AUDIT-2026-11-READINESS-2.md` and this brief only. Use no subagents. Run every command in the foreground. Commit each step as you finish it. Files: server/runs.js, server/reviews.js, server/lane-costs.js, server/control.js, tests/runs-cache.test.js, docs/agents/CHANGELOG.md, docs/agents/architecture/LIMITS.md.

1. `cachedRunRecords` reads an unread part of `runs.jsonl` in fixed chunks of at most 4 MB, carrying a cut line over to the next chunk, instead of one buffer the size of everything unread.
2. It stops returning a fresh copy of the whole array on every read: return the cached array as read only (frozen, or documented and never written), and change any caller that writes to it to copy only what it changes. Read every caller first.
3. Tests, by what they prove: a 10 MB unread delta parses the same records as one read, with a line cut across a chunk edge; a caller cannot change the cached records; a growing file still appends.
4. Run `node node_modules/vitest/vitest.mjs related --run server/runs.js server/reviews.js server/lane-costs.js server/control.js` and `npm run build`. Report what passed and the time of a 10 MB cold read before and after.

**P196. The lane source stops relisting and rechecking old logs (AGY).** Read finding D5 in `docs/agents/AUDIT-2026-11-READINESS-2.md` and this brief only. Use no subagents. Run every command in the foreground. Commit each step as you finish it. Files: server/lanes-source.js, tests/lanes-source.test.js, docs/agents/CHANGELOG.md, docs/agents/architecture/LIVE.md.

1. Lane discovery lists the runs folder only when its change time moved since the last list (the way the Claude sessions reader does), with a full list at least every 60 seconds as a safety net.
2. A log whose run has a record and has not grown for an hour is dropped from the watched set, so old startup logs are not checked every ten seconds forever. A dropped log that grows again is picked up by the next list.
3. Tests, by what they prove: an unchanged folder is not listed again within the minute; a new log appears after the folder changes; an old finished log leaves the watched set and comes back when it grows.
4. Run `node node_modules/vitest/vitest.mjs related --run server/lanes-source.js` and `npm run build`. Report what passed.

**P197. What misleads or fails in the room's panels on another project (Codex).** Read `docs/agents/OWNER.md`, `docs/agents/AUDIT-2026-11-READINESS.md`, `docs/agents/AUDIT-2026-11-READINESS-2.md` and this brief only. Change no code. Do not commit: the runner commits your file. Stop at minute 25. Files: docs/agents/AUDIT-2026-11-READINESS-3.md.

The two readiness audits read the command path and long use. Read the code of what the owner clicks in a live room open on another project: the Dispatch panel (task, queue, worktree), the Reviews panel, the Repository section, the Agents family tree (making, editing and removing a lane), Settings, the chat with its menus, and the cost and run meters. Look for a button that does something other than its label says, a state the panel shows wrongly or late, an error the owner never sees, a confirm card that names one thing and acts on another, and anything that works only on MachineRoom itself. Write the file with two tables, the most harmful first: at most 8 problems (`file:line`, what goes wrong and when, the smallest fix) and at most 4 suggested features, each marked `needs the owner's yes`. Prefer what you confirmed by reading or a command over a guess, and say which. An item already in the two readiness audits gets its id, not a new row.

**P198. Review the stream cap fix (OpenCode).** Read findings R1 and R2 in `docs/agents/AUDIT-2026-11-REVIEW-26.md` and this brief only. Change no code. Use no subagents. Run every command in the foreground. Commit only your file, and stop at minute 20. Files: docs/agents/AUDIT-2026-11-REVIEW-27.md.

Review the merge of P194 with `git show -m --first-parent 9036d11c` against `createSseWriter`, `allowBacklog` and every caller of the writer in `server/index.js`. Say whether R1 and R2 are fixed. Hunt for: an allowance that is never set, so a client is held to the plain cap; an allowance that grows on each reconnect or each frame, so a stuck client is never dropped; a write after `res.destroy()` that throws; an allowance kept in a map after the client closes; a connect write that is still checked against the cap; a test that cannot fail. Run `node node_modules/vitest/vitest.mjs run tests/bridge-stream.test.js` and say what passed. Write the file: a table of at most 5 findings, the most harmful first, each with `file:line`, what goes wrong and when, the smallest fix, and whether it blocks a push. An empty table with what you checked is a good answer.

**P199. A queue failure records exit code 1 instead of 2 on Ubuntu (OpenCode).** Read this brief only. Use no subagents. Run every command in the foreground. Commit each step as you finish it, and stop starting new work at minute 25. Files: scripts/run-lane.mjs, tests/run-queue.test.js, docs/agents/CHANGELOG.md.

CI on Ubuntu (run 43392354399, commit 9036d11c) failed `tests/run-queue.test.js` > `a queue that stops` > `writes head and tests: none when the project has no test command, and omits tests on harness exit`: at line 892 the last record had `exitCode: 1` where the test expects 2. The fake lane's `run` file is `process.exit(2)`. The same test passed on Ubuntu one commit earlier and passes on Windows, and nothing between them touched the queue, so it is intermittent or Linux only.

1. Read the code path from the harness exit to the record: `scripts/run-lane.mjs` around lines 1040 to 1130 (`finishPending`, the queue status), 1480 to 1540 (`harnessExitCode`, `child.exitCode`, `killTree`) and 1640 to 1700 (the records). Find every way the second run can record 1: a `failed: tests` status, a queue that throws, a race between the child's `exit` and `close` events, a kill of the process tree that wins over the real exit, a worktree reused at the old commit so `node run` fails to start. Name the cause you confirm and say how you confirmed it.
2. Fix the cause in the code if the code records the wrong exit code. Change the test only if the test itself is wrong, and keep it able to fail.
3. Run the test 20 times in a row (`node node_modules/vitest/vitest.mjs run tests/run-queue.test.js -t "omits tests on harness exit"` in a loop) and report how many passed. Then run `node node_modules/vitest/vitest.mjs related --run scripts/run-lane.mjs` and report what passed.

**P200. Retry resends to the conversation that owns the reply (OpenCode).** Read finding P197-1 in `docs/agents/AUDIT-2026-11-READINESS-3.md` and this brief only. Use no subagents. Run every command in the foreground. Commit each step as you finish it, and stop starting new work at minute 25. Files: src/ui/OrchestratorChat.jsx, tests/orchestrator-chat.test.js, docs/agents/CHANGELOG.md.

1. Retry under a reply sends the prompt to the conversation that reply belongs to, passed to `deliver` explicitly, whatever To says now. A sub's retry goes to that sub, never to Main.
2. Tests, by what they prove: a reply from Main retried after To changed to a lane goes to Main; a sub's reply retried goes to that sub. Each test must fail on the code before your change.
3. Run `node node_modules/vitest/vitest.mjs related --run src/ui/OrchestratorChat.jsx` and `npm run build`. Report what passed.

**P201. Auto starts the lane its confirm card names (OpenCode).** Read finding P197-2 in `docs/agents/AUDIT-2026-11-READINESS-3.md` and this brief only. Use no subagents. Run every command in the foreground. Commit each step as you finish it, and stop starting new work at minute 25. Files: src/ui/panels/DispatchPanel.jsx, tests/dispatch-auto-ui.test.js, docs/agents/CHANGELOG.md.

1. The Auto preview routes the whole task list the owner submits (every queue task, not only the first), so the card names the lane the server would choose for all of it.
2. Confirm sends the lane the card names, not `auto`. If that lane is no longer free, the existing start guard refuses it and the panel asks for a fresh preview; it never starts another lane.
3. Tests, by what they prove: a queue whose tasks have different tiers previews the lane for the highest tier; Confirm sends that lane's name; a refused start shows the refusal and starts nothing. Each must fail before your change.
4. Run `node node_modules/vitest/vitest.mjs related --run src/ui/panels/DispatchPanel.jsx` and `npm run build`. Report what passed.

**P202. A deleted lane's key is never given to a new lane (OpenCode).** Read finding P197-3 in `docs/agents/AUDIT-2026-11-READINESS-3.md` and this brief only. Use no subagents. Run every command in the foreground. Commit each step as you finish it, and stop starting new work at minute 25. Files: server/agents-config.js, tests/agents-config.test.js, docs/agents/CHANGELOG.md.

1. The lane key allocation keeps the highest number it has handed out for each harness in the saved agent configuration, and a new lane takes the next one, so a key a deleted lane used is never handed out again. A configuration saved before this change starts from the highest number its current entries and its kept run records show, whichever is larger. Read the records only through the existing run readers.
2. Tests, by what they prove: create, delete and create again gives a new key; the same after the configuration is read again from disk (a bridge restart); existing entries keep their keys.
3. Run `node node_modules/vitest/vitest.mjs related --run server/agents-config.js` and `npm run build`. Report what passed.

**P203. Spent this month keeps a deleted lane's spend (OpenCode).** Read finding P197-7 in `docs/agents/AUDIT-2026-11-READINESS-3.md` and this brief only. Use no subagents. Run every command in the foreground. Commit each step as you finish it, and stop starting new work at minute 25. Files: server/lane-costs.js, tests/lane-costs.test.js, src/ui/panels/MetersPanel.jsx, tests/meters-panel.test.js, docs/agents/CHANGELOG.md.

1. The month and today totals count every recorded run with a cost, including runs of lanes no longer in the roster.
2. The cost of runs whose lane is not in the roster shows as one row named `Removed lanes`, after the other rows, only when it is above zero, so the rows add up to the total.
3. Tests, by what they prove: the total does not drop when a lane with positive spend leaves the roster; the Removed lanes row holds that spend; no such row appears when nothing is unmatched. Do not change how an unknown or all-zero cost reads (that is N16).
4. Run `node node_modules/vitest/vitest.mjs related --run server/lane-costs.js src/ui/panels/MetersPanel.jsx` and `npm run build`. Report what passed.

**P204. Replace key acts on the endpoint row it is clicked on (OpenCode).** Read finding P197-4 in `docs/agents/AUDIT-2026-11-READINESS-3.md` and this brief only. Use no subagents. Run every command in the foreground. Commit each step as you finish it, and stop starting new work at minute 25. Files: src/ui/EndpointsPanel.jsx, server/endpoints.js, tests/endpoints-panel.test.js, tests/endpoints.test.js, docs/agents/CHANGELOG.md.

1. Replace key carries the clicked endpoint's name and key slot to the save, and the card names that endpoint. The save changes only that endpoint's key and never creates or changes another endpoint.
2. A row whose key cannot be replaced this way (a Custom provider row with no preset) shows the button disabled with a one-sentence reason instead of a failing click.
3. Tests, by what they prove: a row named Work on the OpenRouter preset with slot Work saves to Work and leaves OpenRouter alone; the Custom row's button is disabled. Each must fail before your change.
4. Run `node node_modules/vitest/vitest.mjs related --run src/ui/EndpointsPanel.jsx server/endpoints.js` and `npm run build`. Report what passed.

**P205. Add MCP server refuses a name that is already saved (AGY).** Read finding P197-5 in `docs/agents/AUDIT-2026-11-READINESS-3.md` and this brief only. Use no subagents. Run every command in the foreground. Commit each step as you finish it. Files: src/ui/McpSettings.jsx, server/mcp.js, tests/mcp-settings.test.js, tests/mcp-server.test.js, docs/agents/CHANGELOG.md.

1. Adding a server whose name is already saved is refused with one sentence naming it, in the form and on the server (a create-only check on the add path). The on and off action keeps its current update behaviour.
2. Tests, by what they prove: the add route refuses an existing name and leaves the saved server unchanged; the form shows the sentence; on and off still works. Each new test must fail before your change.
3. Run `node node_modules/vitest/vitest.mjs related --run src/ui/McpSettings.jsx server/mcp.js` and `npm run build`. Report what passed.

**P206. Dispatch history shows this project's runs and why a run failed (AGY).** Read finding P197-6 and the Q2 paragraph under Existing IDs in `docs/agents/AUDIT-2026-11-READINESS-3.md`, and this brief only. Use no subagents. Run every command in the foreground. Commit each step as you finish it. Files: server/runs.js, src/ui/panels/runs.js, tests/panels-runs.test.js, tests/project-dispatch.test.js, docs/agents/CHANGELOG.md.

1. `GET /api/control/runs` (around `server/runs.js:775`) answers only the runs of the room's own project: brief runs when the room is this repository, project runs whose project is the room's folder otherwise. Compare resolved folders the way the Reviews lookup already does, and reuse its helper.
2. A finished row in Dispatch shows the run's task (first line, cut to one line) for a project run, and the saved `note` when the run failed or was refused, with any queue or test status, so the reason stays after the running row goes. Change only the formatter in `src/ui/panels/runs.js` unless the panel cannot show the text without a change, and then say why.
3. Tests, by what they prove: a GET for project A returns no record of project B; a refused start's note shows on its finished row; a project run's task shows. Each must fail before your change.
4. Run `node node_modules/vitest/vitest.mjs related --run server/runs.js src/ui/panels/runs.js` and `npm run build`. Report what passed.

**P207. The other claude sessions meta test moves the folder time too (Codex).** Read this brief only. Change only the file below. Do not commit: the runner commits your file. Stop at minute 15. Files: tests/claude-sessions.test.js.

Windows CI (run 43395304274, commit 4f2f6c24) failed `tests/claude-sessions.test.js` > `reads the runs meta again when a later session file appears` at line 348: frames were sent where none were expected. The reader rereads the runs folder only when the folder's change time moves, and on a fast Windows runner the meta file written after the first `tick()` can land in the same time step, so the late session is read as an owner session. P165 fixed the test just above it (`git show 8b9a1fe5`) by setting the runs folder's time a minute later with `utimesSync` after writing the meta file. Do the same in this test: after writing `claude-S7a-20261024-130000.meta.json`, move the runs folder time forward the way P165 did, before the second `tick()`. Change nothing else. Read every other test in the file that writes a meta file after a first `tick()` and say whether it has the same race; fix only those that do, the same way, and name them.

**P208. Add MCP server refuses a name that is already saved, through the client (AGY).** Read finding P197-5 in `docs/agents/AUDIT-2026-11-READINESS-3.md` and this brief only. P205 stopped because its Files list left out the client; this brief replaces it. Use no subagents. Run every command in the foreground. Commit each step as you finish it. Files: src/ui/McpSettings.jsx, src/control/client.js, src/control/mock.js, server/mcp.js, tests/mcp-settings.test.js, tests/mcp-server.test.js, tests/control-contract.test.js, docs/agents/CHANGELOG.md, docs/agents/history/CONTROL-CLIENT.md.

1. `saveMcpServer` in the real client and the mock passes a `create: true` field when it is given one. `POST /api/mcp/servers` with `create: true` refuses a name that is already saved with one sentence naming it (409), and changes nothing. Without `create`, the route keeps its current update behaviour, so the on and off action is unchanged.
2. Add MCP server in `McpSettings.jsx` sends `create: true` and shows the refusal sentence. The mock refuses the same way, and the contract suite checks both clients.
3. Tests, by what they prove: the route refuses an existing name with `create: true` and leaves the saved server unchanged; the form shows the sentence; on and off still works; the contract holds for the real client and the mock. Each new test must fail before your change.
4. Run `node node_modules/vitest/vitest.mjs related --run src/ui/McpSettings.jsx server/mcp.js src/control/client.js src/control/mock.js` and `npm run build`. Report what passed.

**P209. Run the full suite on the panel fixes (OpenCode).** Read this brief only. Change no file except your report. Use no subagents. Run every command in the foreground. Commit only your report, and stop at minute 25. Files: docs/agents/RUN-2026-11-13-SUITE-6.md.

Run `npm test` once at `72e00c76` or later. For every failing test, run its file alone twice and say whether it fails again. Write the file: the commit, the totals, each failure with its file, test name, error line and whether it repeated alone, and the time the run took. Do not fix anything.

**P210. Review the panel fixes and the run caches (Codex).** Read `docs/agents/OWNER.md`, `docs/agents/AUDIT-2026-11-READINESS-3.md` and this brief only. Change no code. Do not commit: the runner commits your file. Stop at minute 25. Files: docs/agents/AUDIT-2026-11-REVIEW-28.md.

Review, with `git show -m --first-parent SHA`, against the code around each change, the merges listed by `git log --first-parent --oneline 4f2f6c24..72e00c76`: P195 (the run cache returns one frozen array of frozen records), P196 (the lane source lists the runs folder only on a change time move or once a minute, and drops quiet finished logs), P199 (queue branches carry milliseconds), P200 (Retry goes to the conversation on screen), P201 (Auto freezes the lane its card names), P202 (lane numbers are never handed out twice), P203 (Removed lanes keeps deleted lanes' spend), P204 (Replace key saves to the clicked endpoint's slot), P206 (the runs list is scoped to the room's project) and P208 (Add MCP server refuses a saved name). Say for each of P197-1 to P197-7 whether it is fixed. Hunt for: a caller that now writes to a frozen record or array and throws; a new log or a regrown log the lane source misses for more than a minute; a confirm that still starts a lane other than the one named; a key number reused or an agents.json write that loses the count; a total that counts a run twice; a key saved to the wrong slot; another project's runs still shown or this project's hidden; an MCP add that still replaces; a test that cannot fail. Write the file: a table of at most 6 findings, the most harmful first, each with `file:line`, what goes wrong and when, the smallest fix, and whether it blocks a push. An empty table with what you checked is a good answer.

**P211. An overlapping lane edit or delete never loses a new lane (OpenCode).** Read finding R28-1 in `docs/agents/AUDIT-2026-11-REVIEW-28.md` and this brief only. Use no subagents. Run every command in the foreground. Commit each step as you finish it, and stop starting new work at minute 25. Files: server/agents-config.js, tests/agents-config.test.js, docs/agents/CHANGELOG.md.

1. The Update and Delete routes in `createAgentsConfigApi` read the request body first, and only then read the latest saved configuration, run their lane checks and edit and save it, with no `await` between that read and the save. Do the same anywhere else in the file that reads the configuration, awaits, then saves.
2. Tests, by what they prove: a Delete whose body is held open while a Create finishes keeps the new lane and its count, and the next Create gets a fresh key; the same for an Update held open. Hold the body with a request stream you control. Each must fail on the code before your change.
3. Run `node node_modules/vitest/vitest.mjs related --run server/agents-config.js` and `npm run build`. Report what passed.

**P212. Removed lanes rounds its spend the way the other rows do (OpenCode).** Read finding R28-2 in `docs/agents/AUDIT-2026-11-REVIEW-28.md` and this brief only. Use no subagents. Run every command in the foreground. Commit each step as you finish it, and stop starting new work at minute 20. Files: server/lane-costs.js, tests/lane-costs.test.js, docs/agents/CHANGELOG.md.

1. The Removed lanes row's month and today cents are the sum of each removed lane's own rounded cents, by the same rule the roster rows use, so deleting lanes never changes the total.
2. Test: two lanes with $0.006 each total 2 cents while present and still 2 cents after both are removed, for the month and for today. It must fail before your change.
3. Run `node node_modules/vitest/vitest.mjs related --run server/lane-costs.js` and `npm run build`. Report what passed.

**P213. What the live room gets wrong on another project (Codex).** Read `docs/agents/OWNER.md`, `docs/agents/AUDIT-2026-11-READINESS.md`, `docs/agents/AUDIT-2026-11-READINESS-2.md`, `docs/agents/AUDIT-2026-11-READINESS-3.md` and this brief only. Change no code. Do not commit: the runner commits your file. Stop at minute 25. Files: docs/agents/AUDIT-2026-11-READINESS-4.md.

The three readiness audits read the commands, long use and the panels. Read what the owner sees when the room first opens on another project and runs for an afternoon: `machineroom FOLDER` and `npm run serve -- up` (the doctor's checks and the first page), the connect screen, the Claude Code and OpenCode session readers (`--sessions`) on a project whose sessions folder is new, empty, huge or renamed, the file tree and watcher on a large or deep project (ignored folders, symlinks, a folder deleted while watched), the folder cards and the tunnel to a file outside the tree, the replay recorder, and the Repository section's branch reads on a repository with no commits, a detached HEAD or many branches. Look for a room that stays empty with no sentence saying why, a session that shows on the wrong project or not at all, a watcher that stops without saying so, a path or name from another project shown, a crash or a hang, and anything that works only on MachineRoom itself. Write the file with two tables, the most harmful first: at most 8 problems (`file:line`, what goes wrong and when, the smallest fix) and at most 3 suggested features, each marked `needs the owner's yes`. Prefer what you confirmed by a probe on a synthetic folder over a guess, and say which. An item already in the three readiness audits gets its id, not a new row.

## The owner's yes of 2026-11-13: N16 and five features

**P214. Costs show what was reported, and zero when zero was spent (OpenCode).** The owner's word on N16: the cost board reports the true result. Read N16 in `docs/agents/AUDIT-2026-10.md` and this brief only. Use no subagents. Run every command in the foreground. Commit each step as you finish it, and stop starting new work at minute 25. Files: server/lane-costs.js, src/model/costs.js, tests/lane-costs.test.js, tests/costs.test.js, tests/cost-board.test.js, tests/meters-panel.test.js, docs/agents/CHANGELOG.md, docs/agents/architecture/ROOM.md.

1. `laneCosts` in `server/lane-costs.js` tracks, per lane, whether any run this month reported a numeric `costUsd`. A lane with runs this month and no reported cost sends `costCents: null` and `todayCents: null`. A lane with no runs this month, or whose runs reported 0, sends 0. Tokens follow the same rule (null only when runs exist and none reported them).
2. `src/model/costs.js` treats only null as not reported, so a real 0 reads as `$0.00` and 0 tokens, and `not reported` appears only when the harness gave no number.
3. Tests, by what they prove: a lane with no runs shows 0; a lane whose runs reported 0 shows 0; a lane whose runs reported no cost shows not reported; a mix sums only the reported costs. Update existing tests that expected `not reported` for a true 0, and name each one you changed.
4. Run `node node_modules/vitest/vitest.mjs related --run server/lane-costs.js src/model/costs.js` and `npm run build`. Report what passed.

**P215. Ask the orchestrator to prepare a merge from Reviews (OpenCode).** The owner said yes to suggested feature 2 of `docs/agents/AUDIT-2026-11-READINESS.md`; read that row and this brief only. Use no subagents. Run every command in the foreground. Commit each step as you finish it, and stop starting new work at minute 28. Files: src/ui/panels/ReviewsPanel.jsx, src/ui/panels/reviews.js, tests/reviews-panel.test.js, docs/agents/CHANGELOG.md, docs/agents/architecture/ROOM.md.

1. A review row whose fast forward is refused, or whose branch is behind its destination, offers `Ask to prepare`. It opens a confirm card naming the lane, the branch, its head (short SHA) and the destination branch.
2. Confirm sends one message to Main through the client's existing `sendOrchestrator`: the lane, branch, full head SHA and destination, asking the orchestrator to rebase or merge the branch onto the destination in the lane's worktree, run the project's checks, and report, without merging to the destination and without discarding work. Build the text in `reviews.js` as a pure, tested function. Show `Sent to Main.` or the client's error under the row. Offer nothing when the client has no `sendOrchestrator` or the orchestrator is not connected.
3. Tests, by what they prove: the button shows only on a refused or behind row; the confirm names the right lane and head; the sent text carries the full SHA and destination; an error shows under the row.
4. Run `node node_modules/vitest/vitest.mjs related --run src/ui/panels/ReviewsPanel.jsx src/ui/panels/reviews.js` and `npm run build`. Report what passed.

**P216. Hand a failed queue to the orchestrator (OpenCode).** The owner said yes to suggested feature 3 of `docs/agents/AUDIT-2026-11-READINESS.md`; read that row and this brief only. Use no subagents. Run every command in the foreground. Commit each step as you finish it, and stop starting new work at minute 28. Files: src/ui/panels/DispatchPanel.jsx, src/ui/panels/runs.js, tests/panels-runs.test.js, tests/project-dispatch.test.js, docs/agents/CHANGELOG.md, docs/agents/architecture/ROOM.md.

1. A finished queue row in Dispatch whose `queueStatus` says it stopped or failed offers `Ask for recovery`. It opens a confirm card naming the lane, the project, the queue branch, the failed task's number and first line, and how many tasks did not run.
2. Confirm sends one message to Main through the client's existing `sendOrchestrator`, built by a pure, tested function in `runs.js`: the project folder name, the queue branch, the failed task in full, the tasks that did not run in full, and the note. It asks the orchestrator to inspect the uncommitted work first, report what it found, and propose how to continue; it must not discard changes or rerun the queue by itself. Show `Sent to Main.` or the error under the row.
3. If a record lacks the task list, read what the record holds and say in the message which parts are missing rather than guessing. Read the queue record fields first in `scripts/run-lane.mjs` and say which you used.
4. Tests, by what they prove: the button shows only on a stopped or failed queue row; the message holds the failed task and the remaining ones; nothing is sent before Confirm.
5. Run `node node_modules/vitest/vitest.mjs related --run src/ui/panels/DispatchPanel.jsx src/ui/panels/runs.js` and `npm run build`. Report what passed.

**P217. Storage use and a cleanup preview (AGY).** The owner said yes to feature 1 of `docs/agents/AUDIT-2026-11-READINESS-2.md` (F1); read that row, finding D5 and this brief only. Use no subagents. Run every command in the foreground. Commit each step as you finish it. Files: server/storage.js, server/index.js, src/control/client.js, src/control/mock.js, src/ui/StorageSettings.jsx, src/ui/Settings.jsx, tests/storage.test.js, tests/storage-settings.test.js, tests/control-contract.test.js, docs/agents/CHANGELOG.md, docs/agents/architecture/ROOM.md, docs/agents/architecture/LIVE.md, docs/agents/history/CONTROL-CLIENT.md.

1. `server/storage.js` measures the runs folder by kind: run logs and their meta and usage files, recordings, saved conversations, and lane worktrees of the room's project (`.worktrees/*`), each as a count and a size in bytes. `GET /api/storage` answers it. A missing folder counts as 0.
2. A preview lists what an archive would move: logs, meta and usage files of finished runs older than a number of days the owner picks (30 by default, 1 to 365), never a file of a running run or a run whose lane lock is held, never a recording that a kept record names, never a saved conversation. `POST /api/storage/preview` answers the list with its total size; `POST /api/storage/archive` with `confirmed: true` and the same days moves exactly those files into `<runs>/archive/<YYYY-MM>/`, keeping their names, and answers what it moved. It deletes nothing. It refuses a request from a page Origin the bridge does not allow, like the other write routes.
3. Worktrees are not moved. The panel lists each clean, merged worktree that `npm run worktrees -- --project ... --clean` would remove and shows that command; it does not run it.
4. A Storage section in Settings shows the sizes, the days field, Preview, and a confirm card naming the count and size before Archive. Real client and mock, with the contract suite.
5. Tests, by what they prove: sizes by kind on a synthetic runs folder; a running run's log and a held lane's log are never in the preview; archive moves exactly the previewed files and nothing else; a second archive of the same days moves nothing.
6. Run `node node_modules/vitest/vitest.mjs related --run server/storage.js server/index.js src/ui/StorageSettings.jsx src/control/client.js src/control/mock.js` and `npm run build`. Report what passed.

**P218. Export a conversation (OpenCode).** The owner said yes to feature 2 of `docs/agents/AUDIT-2026-11-READINESS-2.md` (F2); read that row and this brief only. Use no subagents. Run every command in the foreground. Commit each step as you finish it, and stop starting new work at minute 28. Files: src/ui/Sidebar.jsx, src/ui/sidebar.js, tests/sidebar-menu-ui.test.js, tests/sidebar.test.js, docs/agents/CHANGELOG.md, docs/agents/architecture/ROOM.md.

1. Each conversation row's `...` menu gains `Export` with the key E. It reads the conversation's saved messages and summary the way the read-only preview does, and saves one Markdown file named after the conversation's title and start date (unsafe filename characters replaced), through a Blob download in the browser.
2. The file holds the title, the project folder name, the start time, the summary when there is one, then each message with its role and time. It carries no key, and it says at the top how many messages it holds and that the room keeps at most 200 per conversation.
3. Build the Markdown in `sidebar.js` as a pure, tested function. While the menu is open the E key is consumed like the other keys.
4. Tests, by what they prove: the Markdown for a two-message conversation with a summary; the filename for a title with slashes; the menu item and its key.
5. Run `node node_modules/vitest/vitest.mjs related --run src/ui/Sidebar.jsx src/ui/sidebar.js` and `npm run build`. Report what passed.

**P219. Stop a running lane from the room, and tell its head (AGY).** The owner's word: the owner can stop any running lane from the room, and the orchestrator above that lane is told its run was stopped. Read this brief only. Use no subagents. Run every command in the foreground. Commit each step as you finish it. Files: server/runs.js, server/orchestrator.js, src/control/client.js, src/control/mock.js, src/ui/panels/DispatchPanel.jsx, src/ui/Inspector.jsx, tests/project-dispatch.test.js, tests/orchestrator.test.js, tests/control-contract.test.js, tests/dispatch-stop-ui.test.js, tests/inspector-ui.test.js, docs/agents/CHANGELOG.md, docs/agents/architecture/ROOM.md, docs/agents/architecture/LIVE.md, docs/agents/history/CONTROL-CLIENT.md.

1. `POST /api/control/runs/stop` with `{ lane, startedAt, confirmed: true }` stops that lane's current run only when its `startedAt` matches the running run, by running the runner's existing `--stop LANE` the way the bridge already starts the runner, and answers what the stop printed. A mismatched or finished run is refused with one sentence. It refuses a request from a page Origin the bridge does not allow, like the other write routes.
2. After a stop, the bridge tells the lane's head: the sub orchestrator whose sector holds the lane, else Main. Read how the hierarchy names a lane's orchestrator before writing this. Add one line to that orchestrator's saved conversation, `The owner stopped LANE's run on TASK at TIME.`, shown in the chat as a dim note, and carried as the first line of that orchestrator's next turn so it knows. Read how the chat saves lines first, and use the existing save path.
3. Dispatch's running rows and the Inspector's view of a running lane gain `Stop`, with a confirm card naming the lane, its task or briefs and its start time.
4. Tests, by what they prove: the route stops a matching run and refuses a mismatch; the head's conversation gets the note and the next turn carries it; the Stop button sends the lane and start time it shows. Use the fake lane and runner the existing tests use, never a real harness.
5. Run `node node_modules/vitest/vitest.mjs related --run server/runs.js server/orchestrator.js src/ui/panels/DispatchPanel.jsx src/ui/Inspector.jsx` and `npm run build`. Report what passed.

**P220. A source that stops is said in the room (OpenCode).** Read finding P213-3 in `docs/agents/AUDIT-2026-11-READINESS-4.md` and this brief only. Use no subagents. Run every command in the foreground. Commit each step as you finish it, and stop starting new work at minute 25. Files: src/ui/healthNotice.js, src/ui/Hud.jsx, tests/health-notice.test.js, docs/agents/CHANGELOG.md, docs/agents/architecture/ROOM.md.

1. When `/api/health` answers `ok: true` with a nonempty `problems` list, the existing health notice shows them through its existing text and details, one sentence per problem, and the room stays connected. Keep the current behaviour when `problems` is empty.
2. Tests, by what they prove: a failed tree with `ok: true` shows its sentence; a stopped OpenCode reader shows its sentence; an empty list shows nothing. Each must fail before your change.
3. Run `node node_modules/vitest/vitest.mjs related --run src/ui/healthNotice.js src/ui/Hud.jsx` and `npm run build`. Report what passed.

**P221. A failed git read is never shown as a clean repository (OpenCode).** Read finding P213-2 in `docs/agents/AUDIT-2026-11-READINESS-4.md` and this brief only. Use no subagents. Run every command in the foreground. Commit each step as you finish it, and stop starting new work at minute 28. Files: server/git.js, src/ui/RepositoryPanel.jsx, src/ui/repository.js, src/ui/Inspector.jsx, src/ui/inspector.js, tests/git.test.js, tests/repository.test.js, tests/repository-panel-ui.test.js, docs/agents/CHANGELOG.md, docs/agents/architecture/ROOM.md.

1. When the status read fails or times out, the git answer carries `statusError` with one sentence and leaves `dirty` and `changeCount` null, never false and 0. A failed branch or log read carries `refsError` or `logError` with one sentence instead of an empty list.
2. The Repository section and the inspector's git view show that sentence in place of the clean state or the empty list, and never say there are no uncommitted changes when the status read failed.
3. Tests, by what they prove: an injected status failure gives null counts and the sentence; an injected ref failure and an injected log failure each give their sentence; the panel shows the sentence and no clean line. Each must fail before your change.
4. Run `node node_modules/vitest/vitest.mjs related --run server/git.js src/ui/RepositoryPanel.jsx src/ui/repository.js src/ui/Inspector.jsx` and `npm run build`. Report what passed.

**P222. The first OpenCode conversation on a new install is shown (Codex).** Read finding P213-5 in `docs/agents/AUDIT-2026-11-READINESS-4.md` and this brief only. Do not commit: the runner commits your files. Stop at minute 28. Files: server/opencode-sessions.js, tests/opencode-sessions.test.js, docs/agents/CHANGELOG.md.

1. The OpenCode session reader sets its startup time when it starts, whether or not the database exists. A database that already existed at start keeps today's rule: its old history is skipped. A database that first appears after start is read from the startup time, so messages made after the reader started become frames.
2. Tests, by what they prove: a database created after start emits the first conversation's run; a database present at start still skips its old messages. The first must fail before your change.
3. Run `npx.cmd vitest related --run server/opencode-sessions.js` and `npm.cmd run build`, and report what passed.

**P223. A queue's record holds what did not run (OpenCode).** P216's Ask for recovery tells Main the remaining tasks only when the record holds them, and today it does not. Read this brief only. Use no subagents. Run every command in the foreground. Commit each step as you finish it, and stop starting new work at minute 25. Files: scripts/run-lane.mjs, src/briefs/run.js, tests/run-queue.test.js, docs/agents/CHANGELOG.md, docs/agents/architecture/COMMANDS.md.

1. Every queue task's record carries `queueSize`, the number of tasks in the queue. The record of the task where the queue stopped (a failed task, failed tests, or a stop) also carries `queueRemaining`: the text of each task after it, in order, each masked with the same key masking `runRecord` uses for `task` and cut to 200 characters. A queue that ends well carries no `queueRemaining`.
2. Name the fields exactly as above, since `src/ui/panels/runs.js` will read them; do not change that file.
3. Tests, by what they prove: a three-task queue that fails on task 2 records `queueSize: 3` and task 3's text in `queueRemaining`; a queue that ends well has no `queueRemaining`; a task holding a key-shaped text is masked.
4. Run `node node_modules/vitest/vitest.mjs related --run scripts/run-lane.mjs src/briefs/run.js` and `npm run build`. Report what passed.

**P224. A check command per project (OpenCode).** The owner said yes to suggested feature 1 of `docs/agents/AUDIT-2026-11-READINESS.md`; read that row and this brief only. Use no subagents. Run every command in the foreground. Commit each step as you finish it, and stop starting new work at minute 28. Files: server/runs.js, server/project-settings.js, src/ui/panels/DispatchPanel.jsx, src/ui/panels/runs.js, src/control/client.js, src/control/mock.js, tests/project-dispatch.test.js, tests/panels-runs.test.js, tests/project-settings.test.js, tests/control-contract.test.js, docs/agents/CHANGELOG.md, docs/agents/architecture/ROOM.md, docs/agents/architecture/LIVE.md, docs/agents/history/CONTROL-CLIENT.md.

1. `server/project-settings.js` keeps one small JSON file per project in the runs folder, named the way the hidden lanes file is (read `projectLanesFileFor` in `server/agents-config.js` and reuse its naming), holding `checkCommand`: 1 to 500 characters, one line, or absent. `GET /api/control/project-settings` reads it for the room's project; `POST` with `confirmed: true` saves or clears it, refusing a page Origin the bridge does not allow, like the other write routes.
2. The project form in Dispatch shows `Check command` under the task, filled from the saved value, with the hint `Runs after each task; the task is committed only when it passes. Empty uses npm test when package.json has one.` Saving happens on Start. The confirm card names the command it will use, or `npm test`, or `No check: this project has no npm test script.` when neither applies.
3. A project run and a queue started from Dispatch pass the command to the runner as its existing `--test` option. Read how `server/runs.js` builds the runner arguments for a project run first.
4. Real client and mock, with the contract suite.
5. Tests, by what they prove: the setting saves, reads back and clears; a too-long or two-line command is refused with one sentence; a queue started with a saved command passes it as `--test`; the confirm card names it.
6. Run `node node_modules/vitest/vitest.mjs related --run server/runs.js server/project-settings.js src/ui/panels/DispatchPanel.jsx src/control/client.js src/control/mock.js` and `npm run build`. Report what passed.

**P225. Filter the Repository branches (OpenCode).** The owner said yes to feature 2 of `docs/agents/AUDIT-2026-11-READINESS-4.md`; read that row and this brief only. Use no subagents. Run every command in the foreground. Commit each step as you finish it, and stop starting new work at minute 25. Files: src/ui/RepositoryPanel.jsx, src/ui/repository.js, tests/repository.test.js, tests/repository-panel-ui.test.js, docs/agents/CHANGELOG.md, docs/agents/architecture/ROOM.md.

1. The branch list gains a text filter above it (case-insensitive substring). It shows at most 200 matching rows, the current branch always first when it matches, and a line `Showing N of M branches.` when it cuts or filters.
2. The switch and create confirm cards keep naming the exact branch picked; filtering never changes the picked branch.
3. Build the filter and cut in `repository.js` as a pure, tested function.
4. Tests, by what they prove: 10,000 branches render at most 200 rows with the count line; a filter finds a branch past the first 200; the current branch stays first; the confirm names the branch picked from a filtered list.
5. Run `node node_modules/vitest/vitest.mjs related --run src/ui/RepositoryPanel.jsx src/ui/repository.js` and `npm run build`. Report what passed.

**P226. Keep an unsent Dispatch draft per project (OpenCode).** The owner said yes to feature 2 of `docs/agents/AUDIT-2026-11-READINESS-3.md`; read that row and this brief only. Start after P224 is merged. Use no subagents. Run every command in the foreground. Commit each step as you finish it, and stop starting new work at minute 25. Files: src/ui/panels/DispatchPanel.jsx, src/ui/panels/runs.js, tests/project-dispatch.test.js, tests/panels-runs.test.js, docs/agents/CHANGELOG.md, docs/agents/architecture/ROOM.md.

1. The project task or queue text, the chosen lane and the check command field are kept per project for the life of the page, in a small module-level store in `runs.js`, so closing Control, opening another panel or switching projects and back brings the draft back.
2. A successful start clears that project's draft. A `Discard draft` button beside the text clears it after one confirm. Nothing is written to disk or browser storage.
3. Tests, by what they prove: a draft survives unmounting and mounting the panel; two projects keep separate drafts; a start clears it; Discard clears it.
4. Run `node node_modules/vitest/vitest.mjs related --run src/ui/panels/DispatchPanel.jsx src/ui/panels/runs.js` and `npm run build`. Report what passed.

**P227. Use the room by hand on MachineRoom and a small project (Codex).** The owner asked for one agent to check the room in person. Read `docs/agents/OWNER.md`, `docs/agents/architecture/ROOM.md` and this brief only. Change no repository file except your report. Do not commit: the runner commits your file. Stop at minute 40. Files: docs/agents/RUN-2026-11-13-HANDS-ON.md.

1. In your worktree run `npm.cmd run build`. Start the room with `node bin/machine-room.mjs up --root <your worktree> --port 5190 --no-open --sessions`, with `MACHINEROOM_RUNS` set to a new empty folder under `%TEMP%` and without `--lanes`. Never use port 5173, the testbench runs folder or the owner's runs folder, and never start a lane, an orchestrator turn or any paid model call.
2. Drive the page with the Playwright Chromium already on this machine (as `scripts/screenshots.mjs` does), headless, at 1280 by 800 and at 1920 by 1080, from a script you keep under `%TEMP%`. Visit: the connect screen and the room; the menu row; the sidebar's Chat, Projects and Agents tabs and a conversation's `...` menu with Export; the Control drawer's Dispatch (fill a task and open the confirm card, then Cancel), Reviews, Repository (the branch filter if present), Meters and Settings (Storage if present); the Inspector on an agent, a folder card, a file and the git tree; the replay switch; Help and the guide. Read the console after each step.
3. Then stop that room, make a small git project under `%TEMP%` (a package.json with a test script, three source files in two folders, one commit), and repeat the room part of step 2 on it on port 5191.
4. Save a screenshot of each view under `%TEMP%`, not in the repository. Write the report: for each view what you did, what you saw, every console error or warning with its text, and anything that looked wrong, misleading, cut off, overlapping or slow (say how slow), most harmful first. Mark each item `seen` or `inferred`. Stop every process you started and say so.

**P228. A file outside the project is never drawn on the project's card (OpenCode).** Read finding P213-1 in `docs/agents/AUDIT-2026-11-READINESS-4.md` and this brief only. Use no subagents. Run every command in the foreground. Commit each step as you finish it, and stop starting new work at minute 28. Files: src/model/paths.js, src/model/parsers/common.js, src/model/pipeline.js, src/live/bridge.js, server/index.js, tests/paths.test.js, tests/parsers.test.js, tests/bridge-client.test.js, docs/agents/CHANGELOG.md, docs/agents/architecture/ACTIVITIES.md.

1. The bridge's tree answer already names the project root by its folder name. Add the project's full resolved path to that answer as `rootPath` (in `server/index.js`, where `/api/tree` builds its answer), and carry it from `src/live/bridge.js` into the live pipeline.
2. When `rootPath` is known, an absolute tool path is inside the project only when it lies under that full path, compared with the platform's rules (case-insensitive on Windows, either slash), and is made relative to it. Any other absolute path is an outside touch, even when it holds a folder with the project's name. A path inside the project that repeats the root's name (`project/src/project/a.txt`) stays `src/project/a.txt`.
3. A recording that carries only the root's name keeps today's rule; do not change replay.
4. Tests, by what they prove: another folder named like the project is outside; a repeated root name inside the project keeps its full relative path; a Windows path in a different case is inside; a recording without `rootPath` behaves as before. Each new test must fail before your change.
5. Run `node node_modules/vitest/vitest.mjs related --run src/model/paths.js src/model/parsers/common.js src/model/pipeline.js src/live/bridge.js server/index.js` and `npm run build`. Report what passed.

**P229. Claude sessions started in a subfolder of the project are shown (OpenCode).** Read finding P213-6 in `docs/agents/AUDIT-2026-11-READINESS-4.md` and this brief only. Use no subagents. Run every command in the foreground. Commit each step as you finish it, and stop starting new work at minute 28. Files: server/claude-sessions.js, tests/claude-sessions.test.js, docs/agents/CHANGELOG.md, docs/agents/architecture/LIVE.md.

1. Session discovery reads every Claude project folder whose slug is the room root's slug or starts with the root's slug followed by `-`, so a session started in a subfolder of the project is found. The existing per-line `cwd` check stays and still decides: a line whose `cwd` is not the root or inside it is skipped, so a sibling project whose slug only shares a prefix (`app` and `app-old`) is never shown.
2. Keep the list of matching folders between ticks and relist the projects folder only when its change time moves, as the reader does for its own folder.
3. Tests, by what they prove: a session started in `root/packages/web` is read; a sibling project `root-old` is not shown although its slug matches the prefix; the root's own session still is. The first must fail before your change.
4. Run `node node_modules/vitest/vitest.mjs related --run server/claude-sessions.js` and `npm run build`. Report what passed.

**P230. The file tree says when it cannot read, and follows git again (AGY).** Read findings P213-4, P213-7 and P213-8 in `docs/agents/AUDIT-2026-11-READINESS-4.md` and this brief only. Use no subagents. Run every command in the foreground. Commit each step as you finish it. Files: server/index.js, server/doctor.js, tests/tree-read.test.js, tests/tree.test.js, tests/machine-doctor.test.js, docs/agents/CHANGELOG.md, docs/agents/architecture/LIVE.md.

1. P213-4: the plain folder walker reports a failed listing instead of returning what it had. A failed root listing is an error the tree source reports (and `/api/health` lists in `problems`); a failed child listing keeps the last good list of that subtree and adds a problem sentence naming the folder relative to the root. The doctor fails a root it cannot read.
2. P213-7: a failed git listing on a folder that git says is a work tree is a read failure, not a plain tree: keep the last good tree, say so in `problems`, and try git again on the next read. Only `git rev-parse --is-inside-work-tree` answering false makes a plain tree, and a plain tree checks again every 60 seconds whether it has become a git work tree.
3. P213-8: a change to `.git/index` or `.git/info/exclude` (or, for a worktree, the same files in its git folder) schedules a tree read through the existing reader. Other `.git` writes stay ignored.
4. Tests, by what they prove: an unreadable root reports an error, not an empty tree; an unreadable child keeps its old files; a git timeout keeps the git tree and the next read uses git again; a folder made a repository after start is read with git within the minute; an index-only change adds a force-added file to the tree. Each must fail before your change.
5. Run `node node_modules/vitest/vitest.mjs related --run server/index.js server/doctor.js` and `npm run build`. Report what passed.

**P231. The screenshot helper says why it cannot find the browser (OpenCode).** P227's hands-on check found that `chromePath()` in `scripts/screenshots.mjs` reports `No Playwright Chromium found` when the folder could not be read at all. Read this brief only. Use no subagents. Run every command in the foreground. Commit each step as you finish it, and stop starting new work at minute 18. Files: scripts/screenshots.mjs, tests/screenshots.test.js, docs/agents/CHANGELOG.md.

1. When the Playwright folder cannot be read, the helper says `Could not read FOLDER: CODE. Set MACHINEROOM_CHROME to the browser program.` with the folder masked like the other printed paths, and keeps today's sentence only when the folder was read and holds no Chromium.
2. Export the lookup with its directory reader injectable, and test both sentences.
3. Run `node node_modules/vitest/vitest.mjs run tests/screenshots.test.js` and `npm run build`. Report what passed.

**P232. Three small layout fixes from the hands-on check (OpenCode).** Read findings 3, 7 and 8 in `docs/agents/RUN-2026-11-13-HANDS-ON-2.md` and this brief only. Use no subagents. Run every command in the foreground. Commit each step as you finish it, and stop starting new work at minute 25. Files: src/styles.css, src/Stage.jsx, tests/layout-css.test.js, docs/agents/CHANGELOG.md, docs/agents/architecture/ROOM.md.

1. At 900 pixels and wider, the transport's orchestrator state word and the spend `$X.XX TODAY` never overlap. Keep at least 8 pixels between them. When space is short, the state word shrinks first and ends in an ellipsis, with its full text in `title`. Read how `.transport-spend` and the transport middle are laid out in `src/styles.css` (around lines 2599 and 9215) before you change them.
2. The Refresh buttons in the Meters and Reviews panels look like the Refresh button in Team: same size, type and border. Do this with one rule for a button directly inside `.panel-toolbar`, not with a class on each button. Check that no other `.panel-toolbar` button changes size in a way the owner would notice, and list the panels it reaches.
3. The `Days to keep` label in Settings, Storage stays on one line beside its number box at 1280 pixels wide.
4. Tests, by what they prove: the stylesheet holds a rule that keeps the gap and the ellipsis on the state word, and a `.panel-toolbar > button` rule exists. Read how `tests/autocompact.test.js` reads `src/styles.css` first, and put the new checks in a new `tests/layout-css.test.js`.
5. Run `node node_modules/vitest/vitest.mjs related --run src/styles.css src/Stage.jsx` and `npm run build`. Report what passed.

**P233. The doctor masks the paths it prints (OpenCode).** Read finding 6 in `docs/agents/RUN-2026-11-13-HANDS-ON-2.md` and this brief only. Use no subagents. Run every command in the foreground. Commit each step as you finish it, and stop starting new work at minute 20. Files: server/doctor.js, tests/machine-doctor.test.js, docs/agents/CHANGELOG.md, docs/agents/architecture/COMMANDS.md.

1. Every path the doctor prints goes through `printedRunsFolder` from `server/printed-path.js`, the way the other printed paths do: the runs folder, a lane program's resolved path (`The NAME lane starts from PATH.`), the project root and any other path in its lines. The checks themselves still use the real paths.
2. Tests, by what they prove: with `HOME` or `USERPROFILE` set to a test folder, no doctor line holds that folder, and a lane program under it prints with the masked form. The test must fail before your change.
3. Run `node node_modules/vitest/vitest.mjs related --run server/doctor.js` and `npm run build`. Report what passed.

**P234. Dispatch and replay say what to do next (OpenCode).** Read findings 1 and 5 in `docs/agents/RUN-2026-11-13-HANDS-ON-2.md` and this brief only. Start after P226 is merged. Use no subagents. Run every command in the foreground. Commit each step as you finish it, and stop starting new work at minute 25. Files: src/ui/panels/DispatchPanel.jsx, src/ui/panels/runs.js, src/ui/lowerHalf.js, src/ui/Hud.jsx, tests/project-dispatch.test.js, tests/lower-half.test.js, docs/agents/CHANGELOG.md, docs/agents/architecture/ROOM.md.

1. When Dispatch cannot show the project form, it says why, in place of the form. Without lanes mode: `Runs start from a room opened with --lanes: npm run serve -- up --lanes.` With lanes mode and no code lane: `No code lane is set up. Add one in Agents, Build a team.` Put the choice in a pure, tested function in `runs.js`.
2. A replay inside a live room, where the page has a bridge it is connected to, says `This is a replay. Switch to Live to talk to the orchestrator.` and shows no CONNECT button. A replay with no bridge keeps today's sentence and button. Read how `src/ui/lowerHalf.js` picks the sentence first.
3. Tests, by what they prove: each Dispatch case shows its sentence; a connected replay shows the Live sentence and no CONNECT; a replay with no bridge is unchanged.
4. Run `node node_modules/vitest/vitest.mjs related --run src/ui/panels/DispatchPanel.jsx src/ui/panels/runs.js src/ui/lowerHalf.js` and `npm run build`. Report what passed.

**P235. A small project's overview and the git labels read clearly (OpenCode).** Read findings 2 and 4 in `docs/agents/RUN-2026-11-13-HANDS-ON-2.md` and this brief only. Use no subagents. Run every command in the foreground. Commit each step as you finish it, and stop starting new work at minute 28. Files: src/model/folderView.js, src/engine/room.js, src/engine/gitTree.js, src/engine/camera.js, tests/folder-view.test.js, tests/git-tree.test.js, tests/camera.test.js, docs/agents/CHANGELOG.md, docs/agents/architecture/ROOM.md.

1. Finding 2: on a project with one to four folders, no two folder cards overlap on screen in the overview from Center, no card is hidden behind the orchestrator, and no card is drawn more than twice the size of another. First find whether the cause is the card positions (a child card placed on its parent, or a ring too small for few cards) or the overview camera. Fix it there. Do not change the layout of projects with more folders. Say in the report which it was.
2. Finding 4: git labels whose screen positions would overlap are merged into one label at that commit, `main +4` style (the first name in today's order, then the count), with every name in its title or tooltip. Do this in a pure, tested function in `gitTree.js`. It never drops a branch without counting it.
3. Tests, by what they prove: three top-level folders and one child give card positions with no two closer than a card's width; five labels on neighbouring commits give one merged label naming the count; labels far apart stay separate.
4. Run `node node_modules/vitest/vitest.mjs related --run src/model/folderView.js src/engine/room.js src/engine/gitTree.js src/engine/camera.js` and `npm run build`. Report what passed.

**P236. Storage usage answers faster (AGY).** Read finding 9 in `docs/agents/RUN-2026-11-13-HANDS-ON-2.md` and this brief only. Use no subagents. Run every command in the foreground. Commit each step as you finish it. Files: server/storage.js, tests/storage.test.js, docs/agents/CHANGELOG.md, docs/agents/architecture/LIMITS.md.

1. Measure first. Time `measureStorage` on a seeded folder under `%TEMP%` with 17 worktree folders of about 3,000 files each. Put the numbers in your report.
2. `measureDirectoryBytes` today awaits one `lstat` per file in turn. Read each folder's files with a bounded number of `lstat` calls at once (at most 64 in flight in the whole scan), and measure the worktrees side by side under that same bound. Keep skipping symbolic links, and keep a failed read counted as 0 bytes as it is now. The answer's shape and numbers do not change.
3. Tests, by what they prove: the byte totals equal the old sequential walk's on a seeded tree with nested folders and a symbolic link; no more than 64 `lstat` calls are ever in flight (inject the stat function to count them).
4. Measure again on the same seed and write both numbers in `LIMITS.md`.
5. Run `node node_modules/vitest/vitest.mjs related --run server/storage.js` and `npm run build`. Report what passed.

**P237. A change to git's index reads the tree again (AGY).** This is step 3 of P230, which stopped at the owner's word after steps 1 and 2 were merged. Read finding P213-8 in `docs/agents/AUDIT-2026-11-READINESS-4.md` and this brief only. Use no subagents. Run every command in the foreground. Commit each step as you finish it. Files: server/index.js, tests/tree-read.test.js, docs/agents/CHANGELOG.md, docs/agents/architecture/LIVE.md.

1. A change to `.git/index` or `.git/info/exclude` schedules a tree read through the existing reader and its quiet timer. For a worktree, the same files in its git folder count (`git rev-parse --git-dir`, read once at start and again after a failed read). Other `.git` writes stay ignored, as `IGNORED_WATCH` ignores them now. Do not start a second watcher on the whole `.git` folder; watch only those two files, or their folder with a name filter.
2. Tests, by what they prove: an index-only change (a force-added file, `git add -f` of an ignored file) adds that file to the tree; a write to `.git/logs/HEAD` alone does not read the tree; a worktree's index change is seen. The first must fail before your change.
3. Run `node node_modules/vitest/vitest.mjs related --run server/index.js` and `npm run build`. Report what passed.

**P238. Each reader lifetime keeps its own run in a replay (OpenCode).** Read finding D4 in `docs/agents/AUDIT-2026-11-READINESS-4.md` (the replay case at its end) and this brief only. Use no subagents. Run every command in the foreground. Commit each step as you finish it, and stop starting new work at minute 28. Files: server/claude-sessions.js, server/opencode-sessions.js, tests/claude-sessions.test.js, tests/opencode-sessions.test.js, tests/session-recorder.test.js, docs/agents/CHANGELOG.md, docs/agents/architecture/LIVE.md.

1. A session reader's run id carries a token made once when the reader is created, `SESSION:TOKEN:NUMBER` (eight hex characters from `randomBytes(4)`), so a restarted reader never reuses a run id the page has already seen. Do the same in the OpenCode reader if it builds its run ids the same way. First grep `server` and `src` for code that parses these run ids, and change it with them if any does.
2. Tests, by what they prove: two reader lifetimes over the same session file give different run ids; six frames kept by one recorder from two lifetimes give two tool calls after `recorderToReplay` and `prepare`, not one. The second must fail before your change.
3. Run `node node_modules/vitest/vitest.mjs related --run server/claude-sessions.js server/opencode-sessions.js` and `npm run build`. Report what passed.

**P239. Review the batch since the last push (Codex).** Read `docs/agents/OWNER.md` and this brief only. Change no code. Do not commit: the runner commits your file. Stop at minute 35. Files: docs/agents/AUDIT-2026-11-REVIEW-29.md.

Review the merges listed by `git log --first-parent --oneline 1bb54a0f..4224921d`, using `git show -m --first-parent SHA` and reading the code around each change. Spend most of your time on the ones that write, move or run things:
- P219: the stop route and the note to the head.
- P217: the storage preview and the archive, which moves files.
- P224: the saved check command, which reaches the runner as `--test`.
- P218: conversation export.
- P216 and P223: queue recovery and `queueRemaining`.
- P215: Ask to prepare.
- The P230 merge: tree read failures and the git recheck.
- P229: session folders by slug prefix.

Hunt for:
- A write route that a page from another Origin, or a request with no Origin and no token, can reach.
- A saved check command that runs through a shell, or with arguments the owner did not type, or in a folder other than the lane's worktree.
- An archive that can overwrite, delete, or move a file outside the runs folder, or a file a running lane still writes.
- An export or a recovery message that carries an unmasked key or a home path.
- A stop that ends a lane other than the one named, or tells the wrong head.
- A tree read failure that empties the room or never recovers.
- A sibling project's sessions shown.
- A test that cannot fail.

Write the file: a table of at most 8 findings, the most harmful first. Give each its `file:line`, what goes wrong and when, the smallest fix, and whether it blocks a push. An empty table that lists what you checked is a good answer.

**P240. The storage archive stays in the runs folder and moves only what was shown (AGY).** Read findings 1 and 7 in `docs/agents/AUDIT-2026-11-REVIEW-29.md` and this brief only. Use no subagents. Run every command in the foreground. Commit each step as you finish it. Files: server/storage.js, src/ui/StorageSettings.jsx, src/control/client.js, src/control/mock.js, tests/storage.test.js, tests/storage-settings.test.js, tests/control-contract.test.js, docs/agents/CHANGELOG.md, docs/agents/architecture/LIVE.md.

1. Finding 1: before any move, resolve the archive folder and the month folder with `realpath`, and refuse the archive with one sentence when either is a symbolic link or junction, or resolves outside the real runs folder. Move each file with an operation that fails when the destination already exists, never one that overwrites it.
2. Finding 7: the page sends the names it showed in the preview, as `files`. The server makes a fresh preview and moves only the files that are in both lists. It answers with what it moved and what it skipped because the file is no longer eligible. A request with no `files` is refused. Change the real client, the mock and the contract suite together.
3. Tests, by what they prove: a junction or symbolic link at `archive` or at the month folder refuses the archive, and the source file stays in place (skip the test where the platform cannot make one, and say so); a file that became eligible after the preview is not moved; an existing destination is never overwritten. Each must fail before your change.
4. Run `node node_modules/vitest/vitest.mjs related --run server/storage.js src/ui/StorageSettings.jsx src/control/client.js src/control/mock.js` and `npm run build`. Report what passed.

**P241. The check command runs without a shell, and every task start accepts it (OpenCode).** Read findings 2, 4 and 6 in `docs/agents/AUDIT-2026-11-REVIEW-29.md` and this brief only. Use no subagents. Run every command in the foreground. Commit each step as you finish it, and stop starting new work at minute 30. Files: scripts/run-lane.mjs, src/briefs/run.js, tests/run-lane.test.js, tests/run-queue.test.js, tests/run-project.test.js, tests/run-worktree.test.js, docs/agents/CHANGELOG.md, docs/agents/architecture/COMMANDS.md.

1. Finding 2: the runner splits the check command into a program and its arguments (double quotes group words), and launches it with `shell: false`. On Windows, `npm` and `npx` launch through Node and npm's own JavaScript entry point, not `npm.cmd`. The working folder stays the lane's worktree. A command holding `|`, `&`, `;`, `<`, `>`, `` ` ``, `$(` or `%NAME%` is refused before the run starts, with `The check command cannot use shell syntax; put it in an npm script.` Put the splitting and the refusal in pure, tested functions in `src/briefs/run.js`.
2. Finding 4: `--test` is accepted by the single-task argument parser, and a single task (with or without `--worktree`) runs the check after its task the way a queue task does. Read how the queue path runs it first, and reuse it.
3. Finding 6: a queue task whose harness exits nonzero or is killed writes `queueStatus: 'failed'` (or `'stopped'` for a stop), as the test-failure path already does.
4. Tests, by what they prove:
   - `npm test -- --runInBand` splits into its parts.
   - `npm test && rm x` is refused with the sentence.
   - The single-task parser accepts `--test` and passes it on.
   - A queue whose harness exits 3 records `queueStatus: 'failed'` with `queueRemaining`.
   - Each must fail before your change, and at least one test must go through the real parser, not a fake runner.
5. Run `node node_modules/vitest/vitest.mjs related --run scripts/run-lane.mjs src/briefs/run.js` and `npm run build`. Report what passed.

**P242. A write route with no Origin needs a token even without lanes (AGY).** Read finding 3 in `docs/agents/AUDIT-2026-11-REVIEW-29.md` and this brief only. Use no subagents. Run every command in the foreground. Commit each step as you finish it. Files: server/runs.js, tests/bridge-routes.test.js, tests/run-lane-route.test.js, docs/agents/CHANGELOG.md, docs/agents/architecture/LIVE.md.

1. In `readActor` in `server/runs.js`, a request with no Origin and no orchestrator registry is refused with 403 and `NO_TOKEN_PROBLEM`, not let through. First grep for every caller of `readActor`, and for tests and scripts that call the runs routes with no Origin, and keep the ones that must work (say which and why in the report).
2. Tests, by what they prove: on a bridge started without `--lanes`, a run start and a stop with no Origin and no token are refused with 403, and the same requests from an allowed page Origin still work. The refusal must fail before your change.
3. Run `node node_modules/vitest/vitest.mjs related --run server/runs.js` and `npm run build`. Report what passed.

**P243. A queue's stored tasks hide home paths (OpenCode).** Read finding 8 in `docs/agents/AUDIT-2026-11-REVIEW-29.md` and this brief only. Start after P241 is merged. Use no subagents. Run every command in the foreground. Commit each step as you finish it, and stop starting new work at minute 18. Files: src/briefs/run.js, src/ui/panels/runs.js, tests/run-queue.test.js, tests/panels-runs.test.js, docs/agents/CHANGELOG.md.

1. `maskedQueueTasks` masks the profile and home paths the same way the runner already masks other printed paths, as well as keys. Find that helper and reuse it, don't write a new one. The recovery message built in `src/ui/panels/runs.js` masks them too, for records written before this change.
2. Tests, by what they prove: a remaining task that holds a path built from `homedir()` is stored and sent without it. Each must fail before your change.
3. Run `node node_modules/vitest/vitest.mjs related --run src/briefs/run.js src/ui/panels/runs.js` and `npm run build`. Report what passed.

**P244. A failed tree read tries again on its own (OpenCode).** Read finding 5 in `docs/agents/AUDIT-2026-11-REVIEW-29.md` and this brief only. Use no subagents. Run every command in the foreground. Commit each step as you finish it, and stop starting new work at minute 25. Files: server/index.js, tests/tree-read.test.js, docs/agents/CHANGELOG.md, docs/agents/architecture/LIVE.md.

1. While the last full tree read failed or left unreadable folders, the bridge schedules another full read through the existing reader: after 5 seconds, then doubling to at most 60 seconds. A successful full read with no unreadable folders cancels it, and so does shutdown. One retry timer at most.
2. The folder-shaped `/api/tree` answer is the same age rule as the plain one: a stale `lastTree` while a read is failing still answers, but `/api/health` keeps the problem until a read succeeds.
3. Tests, by what they prove: with a reader that fails once and then succeeds, and with no file event or new GET, the new file appears and the health problem clears; shutdown leaves no timer. Use fake timers. Each must fail before your change.
4. Run `node node_modules/vitest/vitest.mjs related --run server/index.js` and `npm run build`. Report what passed.

**P245. Check the review 29 fixes (Codex).** Read `docs/agents/AUDIT-2026-11-REVIEW-29.md` and this brief only. Change no code. Do not commit: the runner commits your file. Stop at minute 30. Files: docs/agents/AUDIT-2026-11-REVIEW-30.md.

For each finding 1 to 7 of review 29, read its fix with `git show -m --first-parent SHA` and the code around it, then say whether it is fixed, partly fixed or not fixed:
- Finding 1 and finding 7: P240.
- Findings 2, 4 and 6: P241.
- Finding 3: P242.
- Finding 5: P244.

Find each merge's SHA with `git log --first-parent --oneline 4224921d..HEAD`. Repeat your synthetic case where you can. Then look at what each fix could break:
- A check command the owner may type today that the new refusal or splitting now rejects or runs differently, such as quoted paths, `npm run check`, or `node --test`.
- A route the page or a script still calls with no Origin.
- An archive that now refuses on a normal Windows runs folder under `%LOCALAPPDATA%`.
- A retry timer that runs while the room is idle and healthy.
- Whether the folder-shaped `/api/tree` now reads the whole tree on every request after the first second, and what that costs on a large project.

Write the file: one row per finding, with `fixed`, `partly` or `not fixed` and why, then a table of at most 5 new findings, most harmful first. Give each new finding its `file:line`, the case, the smallest fix, and whether it blocks a push.

**P246. An archived file is checked in place before its source is removed (AGY).** Read finding 1 in `docs/agents/AUDIT-2026-11-REVIEW-30.md` and this brief only. Use no subagents. Run every command in the foreground. Commit each step as you finish it. Files: server/storage.js, tests/storage.test.js, docs/agents/CHANGELOG.md, docs/agents/architecture/LIVE.md.

1. In `moveFileSafe` (and its caller near the `beforeMove` seam), after the exclusive link or copy makes the destination and before the source is removed, resolve the destination's real path and check that it lies under the real runs folder's `archive` folder. When it does not, remove the destination just made, keep the source, count the file as skipped with the reason `The archive folder changed during the move.`, and go on with the next file.
2. Do not add a second watcher or lock. Say in the report what race remains, if any, and why it no longer removes a source.
3. Tests, by what they prove: using the `beforeMove` seam, a month folder replaced by a junction (or a symbolic link where junctions are not available) to an outside folder leaves the source in place, leaves nothing in the outside folder, and reports the file skipped. It must fail before your change.
4. Run `node node_modules/vitest/vitest.mjs related --run server/storage.js` and `npm run build`. Report what passed.

**P247. The check command keeps escaped quotes, and the bridge refuses what the runner refuses (OpenCode).** Read findings 2 and 3 in `docs/agents/AUDIT-2026-11-REVIEW-30.md` and this brief only. Start after P243 is merged. Use no subagents. Run every command in the foreground. Commit each step as you finish it, and stop starting new work at minute 25. Files: src/briefs/run.js, server/project-settings.js, server/runs.js, tests/run-lane.test.js, tests/project-settings.test.js, tests/project-dispatch.test.js, docs/agents/CHANGELOG.md, docs/agents/architecture/COMMANDS.md.

1. Finding 2: `splitCheckCommand` treats `\"` inside or outside quotes as a literal double quote, and `\\` as one backslash. A backslash before any other character stays as it is, so Windows paths keep working. An unclosed quote is refused before the run with `The check command has an unclosed quote.`
2. Finding 3: the bridge's saved setting and the Dispatch start use the runner's shell-syntax check (import it from `src/briefs/run.js`) as well as the length and newline checks. A refused command is answered with the runner's sentence and is never saved.
3. Tests, by what they prove:
   - `node --test --test-name-pattern="^a\"b$" x.test.cjs` splits to the argument `--test-name-pattern=^a"b$`.
   - `node "C:\Program Files\x.js"` keeps its backslashes.
   - An unclosed quote is refused.
   - Saving `npm test && npm run build` is refused with 400 and the runner's sentence.
   - Each must fail before your change.
4. Run `node node_modules/vitest/vitest.mjs related --run src/briefs/run.js server/project-settings.js server/runs.js` and `npm run build`. Report what passed.

**P248. Run the full suite on the review fixes (OpenCode).** Read this brief only. Change no file except your report. Use no subagents. Run every command in the foreground. Commit only your report, and stop at minute 25. Files: docs/agents/RUN-2026-11-13-SUITE-7.md.

Run `npm test` once at `fdef59e2` or later. For every failing test, run its file alone twice and say whether it fails again. Write the file: the commit, the totals, each failure with its file, test name, error line and whether it repeated alone, and the time the run took. Do not fix anything.

**P249. A lane run's conversation can be read from the bridge (OpenCode).** The owner said yes to a conversation view for each agent. This brief is its reading half; P250 builds the view on it. Read this brief only. Use no subagents. Run every command in the foreground. Commit each step as you finish it, and stop starting new work at minute 30. Files: src/model/conversation.js, server/runs.js, src/control/client.js, src/control/mock.js, tests/conversation.test.js, tests/bridge-routes.test.js, tests/control-contract.test.js, docs/agents/CHANGELOG.md, docs/agents/architecture/LIVE.md, docs/agents/history/CONTROL-CLIENT.md.

1. `src/model/conversation.js` exports a pure `conversationFromLog(harness, text)`. It turns a run-lane log into a list of entries `{ role, text, tool, at }`:
   - `role` is `prompt` for the task the runner gave the agent, `agent` for the agent's own words, `tool` for a tool call (`tool` holds its name, `text` its one-line label, as the activity labels read today), `result` for the run's end line, or `line` for anything it cannot read.
   - Read how each parser in `src/model/parsers/` reads its harness's lines, and reuse those readers rather than writing new JSON handling. Cover `claude`, `opencode`, `codex` and `agy`; any other harness gives `line` entries.
   - Keep at most the last 2,000 entries, cut each `text` to 4,000 characters, and mask keys with the existing key masker and home paths with `maskProfilePaths` from `src/briefs/run.js`.
2. `GET /api/control/runs/conversation?lane=NAME&startedAt=ISO` finds that run's record, reads its log from the runs folder only, and answers `{ lane, startedAt, harness, running, entries }`.
   - Refuse with one sentence: an unknown lane or run (404), and a log path that resolves outside the runs folder (400).
   - It is a read, so the bridge's existing Host and Origin gate applies and no token is needed.
   - A log over 8 MB is read from its last 8 MB, and the answer says `cut: true`.
3. `runConversation({ lane, startedAt })` goes on the real client and the mock, with the contract suite.
4. Tests, by what they prove:
   - A Claude, an OpenCode and a Codex log, each from the existing parser fixtures, give the prompt, at least one agent entry and the tool calls in order.
   - A key and a home path in the log are masked.
   - A log path outside the runs folder is refused.
   - An unknown run answers 404.
   - The new tests must fail before your change.
5. Run `node node_modules/vitest/vitest.mjs related --run src/model/conversation.js server/runs.js src/control/client.js src/control/mock.js` and `npm run build`. Report what passed.

**P250. Open any lane's conversation, with Stop (OpenCode).** The owner said yes to a conversation view for each agent, where the owner can read it and stop the agent. Read this brief only. Start after P249 and P251 are merged. Use no subagents. Run every command in the foreground. Commit each step as you finish it, and stop starting new work at minute 30. Files: server/runs.js, server/index.js, tests/bridge-routes.test.js, src/ui/LaneConversation.jsx, src/ui/laneConversation.js, src/ui/Hud.jsx, src/ui/Inspector.jsx, src/ui/FamilyTree.jsx, src/styles.css, tests/lane-conversation.test.js, tests/inspector-ui.test.js, tests/family-tree-ui.test.js, docs/agents/CHANGELOG.md, docs/agents/architecture/ROOM.md, docs/agents/architecture/LIVE.md.

0. A run started from the command line has no record in `runs.jsonl` until it ends, so P249's `GET /api/control/runs/conversation` answers 404 for it while it is live. When no record matches, the route looks in the lanes source's `openRuns()` (it has `lane`, `startedAt` and `name`) and reads `RUNSFOLDER/NAME.log` with `running: true`, under the same runs-folder check. Pass the lanes source into `createRunsApi` the way `server/index.js` already passes its other sources. Test: a live run with no record answers its entries and `running: true`; the test must fail before your change.

1. A lane's row in the family tree gets the same chat button the orchestrator rows have, and the Inspector on a lane gets `Open conversation` under its log lines. Either one opens `LaneConversation` in the middle column of the lower half, where the orchestrator chat sits, at 900 pixels and wider. It has a breadcrumb `PROJECT / LANE / run TIME` and a Back control that returns to the chat. Read how the orchestrator chat is placed in `Hud.jsx` first, and reuse that placement.
2. The view reads `runConversation` for the lane's newest run, with a picker of its last 10 runs from the runs list Stage already has.
   - The prompt is first, folded to three lines with Show all.
   - The agent's words are in the centred message column, in the chat's message style.
   - Each tool call is one compact line in the agent's colour, and calls in a row fold under one `N tool calls` line.
   - While the run is live, it reads again on each frame for that lane, at most once every 2 seconds, and keeps the view at the bottom unless the owner scrolled up.
   - Put the folding and the read throttle in `laneConversation.js` as pure, tested functions.
3. While the run is live, a Stop button in the view's header uses the existing P219 stop route and confirm card, so the lane's head gets its note as it does from Dispatch. When the run ends, the header says how it ended.
4. Below 900 pixels the view opens as the same fixed panel the orchestrator chat uses there.
5. Tests, by what they prove:
   - The tree's chat button and the Inspector's button open the view for that lane.
   - Ten tool calls in a row fold to one line and open on a click.
   - A live run shows Stop, and confirming calls the stop route with the run's `startedAt`.
   - A finished run shows no Stop.
   - The throttle reads at most once in 2 seconds.
6. Run `node node_modules/vitest/vitest.mjs related --run src/ui/LaneConversation.jsx src/ui/laneConversation.js src/ui/Hud.jsx src/ui/Inspector.jsx src/ui/FamilyTree.jsx` and `npm run build`. Report what passed.

**P251. The waiting card and the orchestrator's state say what is true (OpenCode).** The owner chose both wordings. Read this brief only. Use no subagents. Run every command in the foreground. Commit each step as you finish it, and stop starting new work at minute 18. Files: src/ui/Waiting.jsx, src/ui/agentContext.js, src/ui/Inspector.jsx, tests/waiting.test.js, tests/inspector.test.js, tests/inspector-ui.test.js, docs/agents/CHANGELOG.md, docs/agents/architecture/ROOM.md.

1. The waiting card counts only agents that can work: the orchestrators and the lanes. Session readers (the `Claude Code session` and `OpenCode session` agents; find how they are marked on the agent list) are named on their own line: `Watching Claude Code and OpenCode sessions.`, or the one that is there. With none of them, that line is left out. Example: `1 agent ready: Orchestrator.` then `Watching Claude Code and OpenCode sessions.`
2. The Inspector's state for the main orchestrator reads `WAITING FOR YOU` when the transport would say `waiting for you` for it (read how `Transport.jsx` decides that, and share that decision rather than copy it). Lanes and subs keep their state words.
3. Tests, by what they prove: the card with two session readers and one orchestrator says `1 agent ready: Orchestrator.` and the watching line; with no readers there is no watching line; an idle main orchestrator's Inspector state reads `WAITING FOR YOU` while an idle lane reads `IDLE`.
4. Run `node node_modules/vitest/vitest.mjs related --run src/ui/Waiting.jsx src/ui/agentContext.js src/ui/Inspector.jsx` and `npm run build`. Report what passed.

**P252. Check the detail docs against the code (Codex).** Read `docs/agents/OWNER.md` and this brief only. Change no code. Do not commit: the runner commits your file. Stop at minute 35. Files: docs/agents/AUDIT-2026-11-DOCS-2.md.

Read `docs/agents/architecture/ROOM.md`, `LIVE.md` and `COMMANDS.md` against the code at `HEAD`. Spend most of your time on what changed since `1bb54a0f` (`git log --first-parent --oneline 1bb54a0f..HEAD`). For every sentence that the code contradicts, give the doc line, what the code does instead with its `file:line`, and the corrected sentence in the docs' style (plain words, short sentences, no em dashes). Also list any route, flag or panel added since `1bb54a0f` that no doc names. Write the file as one table, ordered by how much a reader would be misled.

**P253. Tests wait for what they check instead of sleeping (OpenCode).** Read this brief only. Use no subagents. Run every command in the foreground. Commit each step as you finish it, and stop starting new work at minute 30. Files: tests/*.test.js except tests/bridge-routes.test.js, tests/control-contract.test.js, tests/conversation.test.js, tests/waiting.test.js, tests/inspector.test.js and tests/inspector-ui.test.js; docs/agents/CHANGELOG.md.

1. Twice today a test failed only under load because it slept a fixed time and then asserted something another task had not finished: the tree retry timer and the storage usage refresh. Find tests that do the same: a `sleep`, `setTimeout` or `settle(N)` with N above 0, followed by an assertion on state that something asynchronous sets. Also find tests whose own timeout is under 10 seconds and that start processes.
2. Change each one to wait for its condition with the waiting helper its file already uses (or `waitFor` from `tests/helpers/bridge.js`), with a bound of at least 10 seconds. Never change product code, and never weaken an assertion.
3. Commit in groups of at most 10 files. Run each changed file alone after the change.
4. Report every file changed and what each wait now waits for, and any case you left alone and why.

**P254. The folder tree answer is reused while the watcher is healthy (OpenCode).** Read finding 4 in `docs/agents/AUDIT-2026-11-REVIEW-30.md` and this brief only. Use no subagents. Run every command in the foreground. Commit each step as you finish it, and stop starting new work at minute 22. Files: server/index.js, tests/tree-read.test.js, docs/agents/CHANGELOG.md, docs/agents/architecture/LIVE.md.

1. A folder-shaped `/api/tree` answers from the last tree, without a new read, while all three hold: the file watcher is armed (not polling), the last full read succeeded with no unreadable folders, and no read is due. In any other case it keeps today's one-second rule. The plain `/api/tree` keeps today's one-second rule. P244's retry stays as it is.
2. Tests, by what they prove: with a healthy watcher, three folder GETs a few seconds apart make no new read; after a failed read, a folder GET reads again; on polling, a folder GET older than one second reads again. The first must fail before your change.
3. Run `node node_modules/vitest/vitest.mjs related --run server/index.js` and `npm run build`. Report what passed.

**P255. Find the tests that cannot fail (OpenCode).** Read this brief only. Change no file except your report. Use no subagents. Run every command in the foreground. Commit only your report, and stop at minute 30. Files: docs/agents/AUDIT-2026-11-TESTS.md.

For each merge in `git log --first-parent --oneline 1bb54a0f..HEAD`, read the tests it added or changed. Find tests that would pass with the change undone: a fake that records the call but never runs the real code (as P224's dispatch test did with the runner), an assertion on a value the test itself built, a `toBeTruthy` on a string that is always set, or a check inside a branch that never runs. Where you can, prove it by undoing the change in a scratch copy under `%TEMP%` and running the test there; never undo it in the worktree. Write the file as a table: test file and name, why it cannot fail, how you proved it (or `inferred`), and the smallest real assertion.

**P256. Measure the room's large-project paths after this batch (AGY).** Read `docs/agents/architecture/LIMITS.md` and this brief only. Change no file except your report. Commit only your report. Files: docs/agents/RUN-2026-11-13-SCALE.md.

1. Set `MACHINEROOM_RUNS` to a new empty folder under `%TEMP%` for every command, never the testbench or the owner's runs folder, and never use port 5173.
2. Run `npm run scale-probe` and `npm run scale-live` as `COMMANDS.md` describes them. Run each twice.
3. Write the file: each number beside the one `LIMITS.md` gives, and the change in percent. Flag any path more than 20 percent slower, and say which merge since `1bb54a0f` most likely caused it (P236, P237, P240, P244 and P246 touched the tree and storage paths). Stop every process you started and say so.

**P257. Start the room from a fresh clone (AGY).** Read `docs/agents/OWNER.md`, `README.md` and this brief only. Change no repository file except your report. Commit only your report. Files: docs/agents/RUN-2026-11-13-FRESH-CLONE.md.

1. Clone this repository's `main` into a new folder under `%TEMP%` (`git clone --branch main` from the checkout's own path). Then follow `README.md` exactly as a new owner would: install, build, the doctor and `up` with `--no-open` on port 5196, with `MACHINEROOM_RUNS` set to a new empty folder under `%TEMP%`, and without `--lanes`. Never start a lane, an orchestrator turn or a paid model call.
2. Read `/api/health`, `/api/tree` and `/api/agents` from the running room with a plain HTTP client, and record what each says.
3. Write the file: every command you ran, with the time it took and whether it did what the README says. Name every step where the README is wrong, unclear or missing something, and every error or warning, with its text and any profile path masked. Stop every process you started, delete the clone and the runs folder, and say so.

**P258. Check every command against COMMANDS.md (OpenCode).** Read `docs/agents/architecture/COMMANDS.md` and this brief only. Change no file except your report. Commit only your report, and stop at minute 30. Files: docs/agents/RUN-2026-11-13-COMMANDS.md.

For each command the doc lists, run its help form (`--help`, or no arguments where the doc says that prints usage). Run it with `MACHINEROOM_RUNS` set to a new empty folder under `%TEMP%`, and never run anything that starts a lane, pushes, merges, removes worktrees or calls a paid model. Compare what it prints with what the doc says: the flags, the defaults and the output lines. Write the file as a table: command, what the doc says, what it printed, and the one-sentence fix (doc or code). Delete the folder you made.

**P259. The README says what a new owner will see (AGY).** Read `docs/agents/RUN-2026-11-13-FRESH-CLONE.md` (its README section) and this brief only. Commit each step as you finish it. Files: README.md, docs/agents/CHANGELOG.md.

1. Fix README findings 1 to 10 of that report in `README.md`, in its own style: plain words, short sentences, no em dashes, PowerShell first. Say what each command prints in a sentence, not as a line count, and say the build's chunk-size warning is expected. Show `--port`, `--no-open`, `--no-sessions` and `--help` for `up`, and say that `up` turns on the lane and session sources by default and that Ctrl+C stops the room. Name `MACHINEROOM_RUNS` and where the runs folder is by default, using `%LOCALAPPDATA%`, never a real profile path.
2. Check every command and flag you write against `node bin/machine-room.mjs --help` and `COMMANDS.md`, and keep the README under its current length plus 40 lines.
3. Run `node node_modules/vitest/vitest.mjs run tests/docs.test.js` if it exists, and `npm run build`. Report what passed.

**P260. A lane that hits its quota hands its run to a backup lane (OpenCode).** The owner said yes to lane failover. Read this brief only. Use no subagents. Run every command in the foreground. Commit each step as you finish it, and stop starting new work at minute 32. Files: scripts/run-lane.mjs, src/briefs/run.js, src/harnesses/claude.js, src/harnesses/opencode.js, src/harnesses/codex.js, src/harnesses/agy.js, src/harnesses/machineroom.js, tests/run-lane.test.js, tests/run-failover.test.js, tests/harnesses.test.js, docs/agents/CHANGELOG.md, docs/agents/architecture/COMMANDS.md.

1. Each harness descriptor gets `limited(log)`. It answers `quota`, `rate-limit`, `overloaded` or `''` from the run's log text. Base it on the errors each harness really prints; read the descriptor's existing `failure(log)` first and extend it, don't duplicate it:
   - Claude: usage limit reached, `rate_limit_error`, `overloaded_error`, HTTP 429 and 529.
   - Codex: its usage limit and rate limit messages.
   - OpenCode: 429, rate limit, insufficient balance or quota.
   - AGY: `RESOURCE_EXHAUSTED`, quota, 503 and `UNAVAILABLE`.
   - The native harness: the provider's 429 and 402.
   Only match lines the harness printed as errors, never the agent's own text or tool output.
2. A lane in `lanes.json` may name `fallback`: another lane's key. The runner refuses at start, with one sentence, a fallback that is unknown, retired, the lane itself, or the orchestrator.
3. When a brief run or a single project task ends with exit code not 0, `limited` answers non-empty or the start failed (the existing `startFailed` test), and its lane has a `fallback`, the runner does four things:
   - It writes the failed run's record with `failover: { kind, to }`.
   - It prints `moving the run to LANE because KIND`.
   - It starts the same briefs or task once on the fallback lane, on a new branch named like the first with `-on-LANE` added, so it never meets the failed run's branch.
   - It marks the second record `failoverFrom: { lane, startedAt }`.
   A run that is itself a failover never fails over again. A fallback lane whose lock is held is skipped with the sentence `The backup lane LANE is busy, so the run stays failed.` Queues are left alone; their recovery stays with P216.
4. Tests, by what they prove:
   - Each harness's `limited` reads a real error line and ignores the same words in agent text.
   - A brief run whose fake harness prints a 429 and exits 1 starts once on the fallback lane with the `-on-` branch and both records linked.
   - A failover run that fails again does not move.
   - A busy fallback leaves the run failed with the sentence.
   - A bad `fallback` is refused at start.
   - Use the fake-harness pattern the existing run-lane tests use.
5. Run `node node_modules/vitest/vitest.mjs related --run scripts/run-lane.mjs src/briefs/run.js src/harnesses/claude.js src/harnesses/opencode.js src/harnesses/codex.js src/harnesses/agy.js src/harnesses/machineroom.js` and `npm run build`. Report what passed.

**P261. The room reads each provider's quota from the runs (AGY).** The owner said yes to real quota readings, so routing can skip a provider near its limit. Read `src/policy/route.js` (`providerOver`) and `src/model/costs.js` (the quota rows) and this brief only. Commit each step as you finish it. Files: server/lane-costs.js, src/harnesses/codex.js, src/harnesses/claude.js, tests/lane-costs.test.js, tests/quota-read.test.js, docs/agents/CHANGELOG.md, docs/agents/architecture/LIVE.md.

1. Look at real lane logs first. Open at most five recent `codex-*.log` files, and any Claude logs, in the testbench runs folder; never open `keys.json`. Find the rate-limit fields each harness prints (Codex's token-count events carry `rate_limits` with a used percent, a window length and a reset time). In the report, write what each harness gives, with one sample line where every value but the field names is replaced.
2. Each harness descriptor that prints such fields gets `quotaFrom(line)`. It answers `{ windows: [{ label, usedPercent, resetsAt }] }` or null.
3. `server/lane-costs.js` fills `quota` with the newest reading per provider from the runs' logs, through the existing records cache. Read only the last 64 KB of each run's log, and only the newest run per lane. Each entry is `{ provider, windows, at }`, with the provider name the routing policy uses for that harness (`docs/agents/policy.json` names `opencode` and `antigravity`; use the harness key for the others). A reading older than its window's reset time is left out.
4. Tests, by what they prove: a Codex log line gives the right window; a reading past its reset is left out; `chooseRoute` skips a provider whose reading is above `quotaSkipPercent` (test this through `lane-costs` output, not a hand-built list).
5. Run `node node_modules/vitest/vitest.mjs related --run server/lane-costs.js src/harnesses/codex.js src/harnesses/claude.js` and `npm run build`. Report what passed.

**P262. Choose a backup lane, and see a run move (OpenCode).** The owner said yes to lane failover. Read this brief only. Start after P250 and P260 are merged. Use no subagents. Run every command in the foreground. Commit each step as you finish it, and stop starting new work at minute 32. Files: server/agents-config.js, server/runs.js, src/ui/FamilyTree.jsx, src/ui/Inspector.jsx, src/ui/panels/DispatchPanel.jsx, src/ui/panels/runs.js, src/control/client.js, src/control/mock.js, tests/agents-config.test.js, tests/family-tree-ui.test.js, tests/project-dispatch.test.js, tests/inspector-ui.test.js, tests/control-contract.test.js, docs/agents/CHANGELOG.md, docs/agents/architecture/ROOM.md, docs/agents/architecture/LIVE.md.

1. The lane editor in the family tree gets `Backup lane`, a select of the other active lanes, with `None` as the first choice. It is saved through the existing lane save as `fallback`, with the same refusals as P260.
2. Dispatch's project form gets `Model for this run` under the lane, listing the chosen lane's models (as the lane editor lists them), with `The lane's model` as the default. A choice reaches the runner as `--model`. The confirm card names the model, and names the backup lane when the lane has one.
3. When the bridge reads a new run record that carries `failover`, it adds a room message for that lane's head through the same `addNote` that P219's stop uses: `LANE hit KIND and its run moved to BACKUP.` The Inspector on either lane shows `Moved to BACKUP: KIND` or `Taken over from LANE: KIND` under its state.
4. Tests, by what they prove:
   - The backup lane saves and reads back, and a bad one is refused.
   - A chosen model reaches the run body.
   - A record with `failover` adds exactly one note, even when read twice.
   - The Inspector shows both lines.
5. Run `node node_modules/vitest/vitest.mjs related --run server/agents-config.js server/runs.js src/ui/FamilyTree.jsx src/ui/Inspector.jsx src/ui/panels/DispatchPanel.jsx src/control/client.js src/control/mock.js` and `npm run build`. Report what passed.

**P263. The native agent keeps working until its task is done (OpenCode).** Twice tonight the native lane on P258 ended its run as a success after a few minutes with no file written. The logs end with a tool result followed directly by the final `result` line, and its `result` text is the agent's first sentence. Read this brief and the end of the two logs (`native-P258-*.log` in the testbench runs folder) only. Use no subagents. Run every command in the foreground. Commit each step as you finish it, and stop starting new work at minute 25. Files: scripts/mr-agent.mjs, tests/mr-agent.test.js, docs/agents/CHANGELOG.md.

1. Find why `scripts/mr-agent.mjs` leaves its loop after a tool result. Likely causes: an empty assistant reply, a reply that holds only reasoning, a provider error read as a stop, or a turn limit. Say which, with the log line that proves it.
2. Fix the loop. An empty or reasoning-only reply gets one nudge (`Continue with the task. Use tools, or say you are done.`) and then counts as the end. A provider error is reported as a failure with exit code 1, never as a success. The final `result` text is the agent's last message, not its first.
3. Tests, by what they prove: with a fake provider that returns an empty reply once and then a tool call, the loop goes on; a provider error exits 1; the result text is the last message. Each must fail before your change.
4. Run `node node_modules/vitest/vitest.mjs related --run scripts/mr-agent.mjs` and `npm run build`. Report what passed.

**P264. The detail docs say what the code does (Codex).** Read `docs/agents/AUDIT-2026-11-DOCS-2.md` and this brief only. Change only docs. Commit each step as you finish it, and stop at minute 30. Files: docs/agents/architecture/ROOM.md, docs/agents/architecture/LIVE.md, docs/agents/architecture/COMMANDS.md, docs/agents/AUDIT-2026-11-DOCS-2.md, docs/agents/CHANGELOG.md.

1. For rows 2, 3, 4, 5, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16 and 17, check the row against the code at `HEAD` once more, then replace the doc sentence with the corrected one. Keep the docs' style: plain words, short sentences, no em dashes. Edit the sentence in place; the lines are long, so change only the sentences the row names.
2. Leave rows 1 and 6 alone: P265 changes the code to match those docs.
3. Add a `Status` column to the audit table: `fixed in P264`, `code fix in P265`, or `no change` for rows 18 to 20.
4. Run `node node_modules/vitest/vitest.mjs run tests/briefs.test.js` and report what passed.

**P265. A chat-started lane uses the saved check command, and the dock sees every orchestrator (OpenCode).** Rows 1 and 6 of `docs/agents/AUDIT-2026-11-DOCS-2.md` found two places where the code does less than the docs say. Read those two rows and this brief only. Use no subagents. Run every command in the foreground. Commit each step as you finish it, and stop starting new work at minute 25. Files: server/index.js, server/runs.js, src/ui/Hud.jsx, tests/project-dispatch.test.js, tests/hud-orchestrator-focus.test.js, tests/agent-dock-ui.test.js (new), docs/agents/CHANGELOG.md.

1. The chat's lane start (`startLaneTask` in `server/index.js`) passes the project's saved check command to `runs.startProjectTask`, read the same way `POST /api/control/runs` reads it when the body leaves it out. Reuse that read; do not copy it.
2. `Hud.jsx` passes the full orchestrator list it already keeps (`orchestratorList`) to each `AgentDock` mount, so a sub's dock shows its lanes, scope and restriction, and a lane's dock shows its sector. Read how `src/ui/agentContext.js` looks up a sub before you change the prop.
3. Tests, by what they prove: a chat-started lane task with a saved command starts the real `parseRunArgs` path with `--test` and that command (not only a fake runner's argv); a sub's dock shows its sector rows when Hud is given two orchestrators. Each must fail before your change.
4. Run `node node_modules/vitest/vitest.mjs related --run server/index.js server/runs.js src/ui/Hud.jsx` and `npm run build`. Report what passed.

**P266. The four tests that could not fail can fail now (AGY).** Read `docs/agents/AUDIT-2026-11-TESTS.md` and this brief only. Use no subagents. Run every command in the foreground. Never change product code. Commit each step as you finish it, and stop starting new work at minute 25. Files: tests/storage.test.js, tests/project-dispatch.test.js, tests/machine-doctor.test.js, docs/agents/AUDIT-2026-11-TESTS.md, docs/agents/CHANGELOG.md.

1. For each of the four rows in the table, add the smallest real assertion the row proposes, or one that proves the same thing. The project-dispatch `--test` row may assert through `parseRunArgs` rather than starting the real runner.
2. Prove each new assertion fails with the change undone, the same way the audit did: in a scratch copy under `%TEMP%`, never in the worktree. Delete the copy after.
3. Add a `Fixed` column to the audit table naming the test that now fails.
4. Run each changed test file alone and report what passed.

**P267. Every command answers --help (OpenCode).** `docs/agents/RUN-2026-11-13-COMMANDS.md` found seven commands with no help form and four doc lines that miss a case. Read that report and this brief only. Use no subagents. Run every command in the foreground. Stop starting new work at minute 30. Commit each step as you finish it. Files: scripts/scale-live.mjs, scripts/scale-probe.mjs, scripts/screenshots.mjs, scripts/hand-run.mjs, scripts/history-audit.mjs, scripts/agy-prompt.mjs, scripts/run-recording.mjs, and the test file each script already has under tests/, docs/agents/architecture/COMMANDS.md, docs/agents/CHANGELOG.md.

1. Each of the seven commands the report marks `Code: ... --help` accepts `--help` and `-h`, prints one usage line and its flags as the report quotes them, and exits 0 before doing any work (the screenshots command before its room check). Read how `npm run run-lane -- --help` prints its usage first, and keep each script's own wording for its flags.
2. COMMANDS.md gets the report's four doc fixes: the `run-lane` unknown-lane line names the Agents tab and says the path is masked only under a known root; `--stats` with no runs prints `No runs recorded.`; `--outcomes` with no runs prints `No runs yet.`; and the help form of each of the seven commands.
3. Tests, by what they prove: each `--help` exits 0, prints its usage and does no work (no file written, no port opened). Each must fail before your change.
4. Run `node node_modules/vitest/vitest.mjs related --run` on the seven scripts and `npm run build`. Report what passed.

**P268. Tests that time out only under load (OpenCode).** Read this brief only. Use no subagents. Run every command in the foreground. Never change product code, and never weaken an assertion. Commit each step as you finish it, and stop starting new work at minute 28. Files: tests/git.test.js, tests/helpers/bridge.js, tests/*.test.js that you name in your report, docs/agents/CHANGELOG.md.

1. Tonight, with eight lanes running, `tests/git.test.js` `git write limits > keeps the short limit on reads and gives the switch and the new branch the long one` failed twice with `TimeoutError: The operation was aborted due to timeout`, and passed alone. Find the fetch or `AbortSignal.timeout` that aborts, and give it the same 10 second bound P253 gave the waits.
2. Search the other tests for an `AbortSignal.timeout` or fetch helper bound under 10 seconds in a test that starts a bridge or a process, and raise each the same way.
3. Run each changed file alone. Report every bound you changed, from what to what, and any you left alone and why.

**P269. Review the batch since the last push (Codex).** Read this brief only. Change no code. Do not commit: the runner commits your file. Stop at minute 35. Files: docs/agents/AUDIT-2026-11-REVIEW-31.md.

Review `git diff 12c25524..HEAD` (`git log --first-parent --oneline 12c25524..HEAD` lists the merges). Spend most of your time on P249's conversation route (`server/runs.js`, `src/model/conversation.js`), P254's tree reuse (`server/index.js`), P260's failover (`scripts/run-lane.mjs`, `src/briefs/run.js`, `src/harnesses/*.js`), P263's native loop (`scripts/mr-agent.mjs`) and P265's check command and dock list. Look for: a path read outside the runs folder, a key or home path that reaches a response or record unmasked, a failover that runs twice, uses the wrong worktree or branch, or moves a run that succeeded, a stale tree served after a change, and a native run that reports success after an error. Write the file as a table ordered by severity: finding, `file:line`, a concrete failure, and the smallest fix. Say which findings block a push.

**P270. The doctor's double-folder refusal ends at its sentence (native).** Read this brief only. Commit each step as you finish it, and stop at minute 20. Files: bin/machine-room.mjs, tests/machine-doctor.test.js, docs/agents/CHANGELOG.md.

1. `npm run serve -- doctor . --root .` prints `Give the project folder once, as FOLDER or --root FOLDER.` and then the full usage block. Print only that sentence and exit 1, as the other refusals in `bin/machine-room.mjs` do. Read how they print first.
2. Test: the double-folder refusal's output is that one sentence and exit code 1. It must fail before your change.
3. Run `node node_modules/vitest/vitest.mjs run tests/machine-doctor.test.js` and `npm run build`. Report what passed.

**P271. The room reads Codex's quota through the runner (OpenCode).** This replaces P261, which stopped correctly: `codex exec --json` prints no rate limits, and Codex writes them only to its own session rollout file under the owner's home folder. Read the summary of P261's findings below and this brief only. Commit each step as you finish it. Files: scripts/run-lane.mjs, src/harnesses/codex.js, src/briefs/run.js, server/lane-costs.js, tests/codex-harness.test.js, tests/lane-costs.test.js, tests/quota-read.test.js, docs/agents/CHANGELOG.md, docs/agents/architecture/LIVE.md.

P261 found: the log's `thread.started` line carries `thread_id`; the rollout file is `CODEX_HOME/sessions/YYYY/MM/DD/rollout-*-THREADID.jsonl` (with `CODEX_HOME` defaulting to `.codex` under the home folder); its `event_msg` lines with `payload.type` `token_count` carry `payload.rate_limits.primary` and `secondary`, each with `used_percent`, `window_minutes` and `resets_at`.

1. `src/harnesses/codex.js` gets `quotaFrom(line)`: from one rollout `token_count` line it answers `{ windows: [{ label, usedPercent, resetsAt }] }` (label `primary` or `secondary`, `resetsAt` as an ISO time) or null.
2. When a codex lane run ends, the runner finds that rollout file by the thread id from the run's log, reads only its last 64 KB, and keeps only the newest reading. It writes it into the run record as `quota: { windows, at }`. Nothing else from the rollout file is copied, read or printed, and a missing file leaves `quota` out. The bridge never reads outside the runs folder.
3. `server/lane-costs.js` fills `quota` from the newest record per provider that has one: `{ provider, windows, at }`, with `codex` as the provider. A window whose `resetsAt` has passed is left out.
4. Tests, by what they prove: a rollout line gives the right windows; a run record gets `quota` from a fake rollout file under a temporary `CODEX_HOME`; a reading past its reset is left out; `chooseRoute` skips `codex` when the lane-costs reading is above `quotaSkipPercent`.
5. Run `node node_modules/vitest/vitest.mjs related --run scripts/run-lane.mjs src/harnesses/codex.js server/lane-costs.js` and `npm run build`. Report what passed.

**P272. A conversation's raw lines are masked as data, not text (OpenCode).** Read finding R31-1 in `docs/agents/AUDIT-2026-11-REVIEW-31.md` and this brief only. Use no subagents. Run every command in the foreground. Commit each step as you finish it, and stop starting new work at minute 25. Files: src/model/conversation.js, tests/conversation.test.js, docs/agents/CHANGELOG.md.

1. Where `conversationFromLog` keeps a raw line (the fallback for a harness it cannot read, and an unknown event from one it can), a line that parses as JSON is masked as data: every string value goes through the key masker and `maskProfilePaths`, a field whose name says it holds a secret (key, token, secret, password, authorization) has its value replaced, and the safe object is serialized again. A line that is not JSON keeps today's masking.
2. Tests, by what they prove: a native log line with a JSON-escaped Windows profile path (`C:\Users\NAME\...`) shows no `NAME`; an unknown event with an `OPENAI_API_KEY` field shows no value; the same for a Claude log's unknown event. Each must fail before your change.
3. Run `node node_modules/vitest/vitest.mjs related --run src/model/conversation.js` and `npm run build`. Report what passed.

**P273. Failover keeps the worktree check, the backup prompt and the backup's record (OpenCode).** Read findings R31-2, R31-3, R31-4 and R31-7 in `docs/agents/AUDIT-2026-11-REVIEW-31.md` and this brief only. Use no subagents. Run every command in the foreground. Commit each finding's fix as you finish it, and stop starting new work at minute 32. Files: scripts/run-lane.mjs, src/briefs/run.js, tests/run-failover.test.js, docs/agents/CHANGELOG.md.

1. R31-2: before taking the backup lane's lock, apply the same `briefWorktreeProblems()` check the normal brief start uses to the backup's worktree. A refused backup prints the problem and the run stays failed.
2. R31-3: the readiness retry passes `promptFor` along with `branchSuffix` and `failoverFrom`.
3. R31-4: a project task or queue that fails over returns the backup's full result (its record, start head and branch), so the single-task check and the queue's bookkeeping use the backup's run. The queue keeps its metadata and base, and reports the branch the backup really used.
4. R31-7: a spawn error (`result.error`, an empty log) counts as a failed start for the record's `startFailed` and for failover.
5. Tests, by what they prove, one per finding, each failing before its fix, using the fake-harness pattern already in `tests/run-failover.test.js`.
6. Run `node node_modules/vitest/vitest.mjs run tests/run-failover.test.js tests/run-lane.test.js tests/run-project.test.js` and `npm run build`. Report what passed.

**P274. A native run that never finishes its answer is a failure (Codex).** Read finding R31-5 in `docs/agents/AUDIT-2026-11-REVIEW-31.md` and this brief only. Commit each step as you finish it, and stop at minute 25. Files: scripts/mr-agent.mjs, tests/mr-agent.test.js, docs/agents/CHANGELOG.md.

1. After the one nudge, a second reply with no text and no tool call ends the run as a failure with exit code 1 and the result `The agent stopped without a final answer.` A run succeeds only through a reply with text and no tool call.
2. Tests, by what they prove: a fake provider that answers a tool error, then two reasoning-only replies, makes the run exit 1 with that result; a final text reply still succeeds. The first must fail before your change.
3. Run `npx.cmd vitest run tests/mr-agent.test.js` and `npm run build`. Report what passed.

**P275. The folder tree is not reused while git's metadata watcher is down (native).** Read finding R31-6 in `docs/agents/AUDIT-2026-11-REVIEW-31.md` and this brief only. Commit each step as you finish it, and stop at minute 22. Files: server/index.js, tests/tree-read.test.js, docs/agents/CHANGELOG.md.

1. `folderTreeReuseAllowed()` in `server/index.js` also answers false while `gitMetaDirty` is set or an expected git metadata watcher is missing. Read how the git metadata watchers are armed and how their error handler sets `gitMetaDirty` first.
2. Test: with the project watcher armed and the git metadata watcher failed, a folder GET more than one second after the last read reads again. It must fail before your change. `gitMetaDirty` starts true and is cleared by a later read, so P254's healthy-watcher test (three folder GETs, one read) must still pass; if it does not, gate on the watcher's failure instead.
3. Run `node node_modules/vitest/vitest.mjs run tests/tree-read.test.js` and `npm run build`. Report what passed.

**P276. The page stays window-high at 1280x800 (OpenCode).** Rejected: U158 made the page scroll at the owner's request, and ARCHITECTURE.md was stale; it is fixed instead. Read this brief only. Use no subagents. Run every command in the foreground. Commit each step as you finish it, and stop starting new work at minute 28. Files: src/styles.css, src/ui/Hud.jsx, tests/layout-css.test.js, docs/agents/CHANGELOG.md, docs/agents/architecture/ROOM.md.

1. ARCHITECTURE.md says the page is one menu row, the lens and the lower half in a window-high frame, so it does not scroll at 900 pixels and wider. In a live room at 1280x800, `document.documentElement.scrollHeight` is 1548 and the lower half starts at y=837, below the window. Builds from before P250 do the same, so it is older. Find which rule lets the frame grow past the window height (read the frame, lens and lower-half rules in `src/styles.css` and the wrapper elements in `Hud.jsx`), and fix that rule so the lens and the lower half share the window height at 900 pixels and wider. Change no layout below 900 pixels.
2. Test in `tests/layout-css.test.js`, by what it proves: the frame's height rule at 900 pixels and wider is bounded by the window (for example `100dvh` or `100vh` with no `min-height` larger than it). It must fail before your change.
3. Run `node node_modules/vitest/vitest.mjs run tests/layout-css.test.js` and `npm run build`. Report what passed, the rule that caused it and the line you changed.

**P277. Review the batch since review 31 (Codex).** Read this brief only. Change no code. Do not commit: the runner commits your file. Stop at minute 35. Files: docs/agents/AUDIT-2026-11-REVIEW-32.md.

Review `git diff 1122d2cf..HEAD` (`git log --first-parent --oneline 1122d2cf..HEAD`). Check that each review 31 finding is really fixed: R31-1 by P272, R31-2, R31-3, R31-4 and R31-7 by P273, R31-5 by P274, R31-6 by P275. Then review what else changed: P250's conversation view and its stop of a run started from the command line (`server/runs.js`, the stop route), P271's Codex quota read (it opens a file under the owner's home folder), P267's help forms and P270's refusal. Look for: a path read outside the runs folder or the Codex sessions folder, a key or home path reaching a response or record, a stop that ends the wrong run or a run the owner did not start from this room, and a failover that runs twice or on the wrong worktree. Write the file as a table ordered by severity: finding, `file:line`, a concrete failure, the smallest fix, and whether it blocks a push.

**P278. Run the full suite on main (OpenCode).** Read this brief only. Change no file except your report. Use no subagents. Run every command in the foreground. Commit only your report, and stop at minute 30. Files: docs/agents/RUN-2026-11-14-SUITE.md.

1. Run `npm test` once in your worktree on `main`.
2. For each failing test, run its file alone. A test that passes alone is a load flake; one that fails alone is a real failure.
3. Write the file: the totals, then a table of every failing test with its file, its error's first line, whether it passed alone, and for a real failure the merge that most likely caused it (`git log --first-parent --oneline 12c25524..HEAD`).

**P279. A conversation masks secret fields only where they hold text (OpenCode).** Read this brief only. Use no subagents. Run every command in the foreground. Commit each step as you finish it, and stop starting new work at minute 18. Files: src/model/conversation.js, tests/conversation.test.js, docs/agents/CHANGELOG.md.

1. P272 replaces the value of every field whose name matches `key`, `token`, `secret`, `password` or `authorization`, so counts like `input_tokens: 120` show as masked. Replace only string values of those fields; numbers, booleans and null keep their value, and objects and arrays are still walked.
2. Tests, by what they prove: `input_tokens: 120` shows 120; `api_key: "sk-..."` is still masked; a nested `{ auth: { token: "x" } }` is still masked. The first must fail before your change.
3. Run `node node_modules/vitest/vitest.mjs related --run src/model/conversation.js` and `npm run build`. Report what passed.

**P280. Plan the ulolTris trial (AGY).** The owner accepted a real-project trial on ulolTris before a release. Read `docs/agents/OWNER.md`, `docs/agents/architecture/ROOM.md` (Dispatch and the project form), `C:\GitHub\ulolTris\AGENTS.md` and this brief only. Read ulolTris; never change, commit, push or start anything in it. Change no MachineRoom file except your report. Commit only your report. Files: docs/agents/TRIAL-ULOLTRIS.md.

Write the plan the owner will follow to give MachineRoom one real task on ulolTris: the command that opens the room on it; the check command the room will use (ulolTris's own test command, as its AGENTS.md gives it); whether the task runs in a lane worktree or in the folder, and why (ulolTris is worked by several agents; say how the room keeps out of their files); three small candidate tasks taken from ulolTris's own open work, each with the files it touches and how the owner can see it worked (ulolTris serves on port 8123); what the room should show at each step; and what would count as a failure of MachineRoom rather than of the task. Name any step the room cannot do today.

**P281. The core guide names this week's work (AGY).** Read `docs/agents/ARCHITECTURE.md`, `docs/agents/architecture/DOCUMENTS.md` and this brief only. Change only docs. Commit each step as you finish it. Files: docs/agents/ARCHITECTURE.md, docs/agents/architecture/DOCUMENTS.md, docs/agents/CHANGELOG.md.

1. ARCHITECTURE.md's Open work ends at review 18. Add, in its style (plain words, short sentences, no em dashes), one sentence each for: reviews 29, 30 and 31 and the briefs that fixed them (read the top of each `AUDIT-2026-11-REVIEW-*.md`), the docs audit `AUDIT-2026-11-DOCS-2.md` and the test audit `AUDIT-2026-11-TESTS.md`, lane failover (P260, P273) and Codex quota readings (P271), and the per-lane conversation view (P249, P250).
2. DOCUMENTS.md lists every file in `docs/agents`. Add every file there that it does not name (`ls docs/agents`), with one line each on what it is for.
3. Keep ARCHITECTURE.md's Version line as it is.

**P282. Check the detail docs against this week's code (native).** Read this brief only. Change no code. Commit only your report, and stop at minute 30. Files: docs/agents/AUDIT-2026-11-DOCS-4.md.

Read `docs/agents/architecture/ROOM.md`, `LIVE.md` and `COMMANDS.md` against the code at `HEAD`, only for what changed since `12c25524` (`git log --first-parent --oneline 12c25524..HEAD`): the conversation route and view, failover and `fallback`, Codex quota in records and lane costs, tree reuse, the help forms, and the native agent's nudge. For every sentence the code contradicts, give the doc line, what the code does with its `file:line`, and the corrected sentence in the docs' style. List any route, flag, record field or panel added since `12c25524` that no doc names. Write the file as one table.

**P283. Find this week's tests that cannot fail (native).** Read this brief only. Change no file except your report. Commit only your report, and stop at minute 30. Files: docs/agents/AUDIT-2026-11-TESTS-2.md.

For each merge in `git log --first-parent --oneline 12c25524..HEAD`, read the tests it added or changed. Find tests that would pass with the change undone: a fake that records a call but never runs the real code, an assertion on a value the code under test stamped itself (P250's run picker test checked `run.lane === 'opencode'` on runs the function had just labelled `opencode`), a `toBeTruthy` on a value always set, or a check inside a branch that never runs. Where you can, prove it in a scratch copy under `%TEMP%`, never in the worktree. Write the file as a table: test file and name, why it cannot fail, how you proved it (or `inferred`), and the smallest real assertion.

**P284. The run list marks a run that moved (OpenCode).** Read this brief only. Use no subagents. Run every command in the foreground. Commit each step as you finish it, and stop starting new work at minute 18. Files: src/briefs/run.js, tests/run-lane.test.js, docs/agents/architecture/COMMANDS.md, docs/agents/CHANGELOG.md.

1. `runListLine` in `src/briefs/run.js` adds `| moved to LANE (KIND)` to a record with `failover`, and `| taken over from LANE` to a record with `failoverFrom`.
2. Tests, by what they prove: a record with `failover: { kind: 'quota', to: 'agy' }` lists with `moved to agy (quota)`; one with `failoverFrom: { lane: 'opencode' }` lists with `taken over from opencode`; a record with neither lists as today. The first two must fail before your change.
3. Run `node node_modules/vitest/vitest.mjs run tests/run-lane.test.js` and `npm run build`. Report what passed.

**P285. A stop ends only the run it names (OpenCode).** Read finding R32-1 in `docs/agents/AUDIT-2026-11-REVIEW-32.md` and this brief only. Use no subagents. Run every command in the foreground. Commit each step as you finish it, and stop starting new work at minute 30. Files: src/briefs/run.js, scripts/run-lane.mjs, server/runs.js, tests/run-lane-stop.test.js, tests/project-dispatch.test.js, docs/agents/CHANGELOG.md, docs/agents/architecture/COMMANDS.md.

1. `laneLockText` also writes the run's `startedAt` (ISO), and the runner passes it when it takes a lane lock for a run.
2. `npm run run-lane -- --stop LANE --started-at ISO` reads the lock just before it kills anything and refuses, with one sentence and exit 1, when the lock's `startedAt` is missing or differs: `The LANE lane is running a different run now, so nothing was stopped.` Without `--started-at` it behaves as today.
3. The bridge's stop route passes `--started-at` with the start time the owner confirmed, for runs it started and for runs it found in the lanes source.
4. Tests, by what they prove: a stop naming an older start time leaves the newer run's process alive and prints the sentence; a stop naming the current start time ends it; the bridge's stop sends `--started-at`. The first must fail before your change.
5. Run `node node_modules/vitest/vitest.mjs run tests/run-lane-stop.test.js tests/project-dispatch.test.js` and `npm run build`. Report what passed.

**P286. A queue keeps its failed record, and a quota read never costs a record (OpenCode).** Read findings R32-2, R32-3 and R32-5 in `docs/agents/AUDIT-2026-11-REVIEW-32.md` and this brief only. Use no subagents. Run every command in the foreground. Commit each finding's fix as you finish it, and stop starting new work at minute 30. Files: scripts/run-lane.mjs, tests/run-failover.test.js, tests/quota-read.test.js, docs/agents/CHANGELOG.md.

1. R32-2: when a queue task's backup is refused (busy, worktree problem or branch), `startLane` returns the failed record, and the queue writes it once after its bookkeeping and reports the failed task. No exception.
2. R32-3: `findCodexRollout` resolves the sessions folder and the candidate with `realPath` and refuses a candidate outside the sessions folder or one that is a symbolic link (`lstatSync`).
3. R32-5: `readCodexQuota` catches a read error, closes the descriptor and answers null.
4. Tests, by what they prove, one per finding, each failing before its fix: a queue whose backup is busy records the failed task and ends without throwing; a rollout link pointing outside the sessions folder gives no quota; a read that throws gives null and the run record is still written.
5. Run `node node_modules/vitest/vitest.mjs run tests/run-failover.test.js tests/quota-read.test.js tests/run-queue.test.js` (skip any file that does not exist) and `npm run build`. Report what passed.

**P287. The conversation view shows only the run it names (Codex).** Read finding R32-4 in `docs/agents/AUDIT-2026-11-REVIEW-32.md` and this brief only. Commit each step as you finish it, and stop at minute 25. Files: src/ui/LaneConversation.jsx, tests/lane-conversation.test.js, docs/agents/CHANGELOG.md.

1. A conversation answer or error whose lane and start time are not the ones selected now is ignored. Choosing another run clears the shown conversation and its running state until the new answer arrives, so Stop never shows for a run that is not selected.
2. Test, by what it proves: with a slow answer for run A and a fast one for run B, choosing A then B shows B's entries and B's state when A's answer arrives last. It must fail before your change.
3. Run `npx.cmd vitest run tests/lane-conversation.test.js` and `npm run build`. Report what passed.

**P288. Every parsed JSON value in a conversation is masked (OpenCode).** Start after P279 is merged. Read finding R32-6 in `docs/agents/AUDIT-2026-11-REVIEW-32.md` and this brief only. Use no subagents. Run every command in the foreground. Commit each step as you finish it, and stop starting new work at minute 18. Files: src/model/conversation.js, tests/conversation.test.js, docs/agents/CHANGELOG.md.

1. Where `conversationFromLog` keeps a raw line that parses as JSON, mask the parsed value before serializing it, whatever its type: a string, a number, an array or an object. A line that does not parse keeps today's text masking.
2. Test, by what it proves: a raw line that is a JSON string holding `C:\\Users\\NAME\\project` shows no `NAME`, for a harness the reader knows and for one it does not. It must fail before your change.
3. Run `node node_modules/vitest/vitest.mjs related --run src/model/conversation.js` and `npm run build`. Report what passed.

**P289. CODE.md lists every file (AGY).** Read `docs/agents/architecture/CODE.md` and this brief only. Change only docs. Commit each step as you finish it. Files: docs/agents/architecture/CODE.md, docs/agents/CHANGELOG.md.

1. CODE.md gives one line per file of the code. List every file under `src/`, `server/`, `scripts/`, `bin/` and `tests/` that CODE.md does not name (`git ls-files src server scripts bin tests`). This week's `src/model/conversation.js`, `src/ui/LaneConversation.jsx`, `src/ui/laneConversation.js`, `tests/quota-read.test.js`, `tests/run-failover.test.js` and `tests/lane-conversation.test.js` are among them.
2. Add one line for each, in the section and order CODE.md uses, saying what the file owns, in its style: plain words, short sentences, no em dashes. Read each file's exports and first lines before writing its line.
3. Remove any line that names a file that no longer exists.
4. Report how many lines you added and removed.

**P290. Three tests that fail only under load (OpenCode).** Read this brief and `docs/agents/architecture/LIMITS.md` (T26 and T28) only. Use no subagents. Run every command in the foreground. Never change product code, and never weaken an assertion. Commit each step as you finish it, and stop starting new work at minute 30. Files: tests/candidate.test.js, tests/claude-sessions.test.js, tests/run-lane-stop.test.js, tests/helpers/*.js, docs/agents/architecture/LIMITS.md, docs/agents/CHANGELOG.md.

With ten lanes running, three tests failed and then passed alone:
- `tests/candidate.test.js` `runCandidate > prints the last 20 build lines and exits 1`: `Error: Port 56212 is in use. Pass --port.` The test picks a port that another process takes before the candidate checks it.
- `tests/claude-sessions.test.js` `reads a session started in a subfolder of the project`: `expected [] to have a length of 1 but got +0` at line 491, a wait that ends before the reader sees the file.
- `tests/run-lane-stop.test.js` `--stop kills the run, the harness and the grandchild before it writes`: the stop marked the descendants stale instead of printing `leftover: stopped`.

1. For each, find why load breaks it and fix the test: ask the OS for a free port at the moment of use (listen on port 0) or retry on that exact error, wait for the condition with a bound of at least 10 seconds, or wait until the descendants are listed before the stop.
2. Run each file alone three times, and report each fix and what it now waits for. Add a line to LIMITS.md under T26 and T28 if the stop test's cause is the same.

**P291. Check the ulolTris trial plan against the code (Codex).** Read `docs/agents/TRIAL-ULOLTRIS.md` and this brief only. Change no code. Do not commit: the runner commits your file. Stop at minute 30. Files: docs/agents/AUDIT-2026-11-TRIAL-PLAN.md.

The plan makes claims about what MachineRoom does on another project. Check each against the code at `HEAD`, with `file:line`: that `up` turns on lanes and sessions; that an empty check command falls back to `npm test` when the project has that script; that `Own worktree` sends a single task through the queue runner into `PROJECT\.worktrees\LANE` and adds `/.worktrees/` to `.git\info\exclude`; that `node_modules` is joined into the worktree; that a dirty project refuses to start even with `Own worktree`; that a worktree with uncommitted changes or unmerged commits refuses to start; that Reviews merges with `--ff-only`; and the branch name `machineroom/queue-LANE-STAMP`. Write the file as a table: claim, true or false, `file:line`, and the corrected sentence for any false claim. Then list any step of the plan the room cannot do today.

**P292. The README names this week's features (AGY).** Read `README.md`, `docs/agents/OWNER.md` and this brief only. Change only `README.md` and `docs/agents/CHANGELOG.md`. Commit each step as you finish it.

1. The README tells a new owner what the room shows and what they can do. Add, in its style and in the section that fits, short plain sentences for: opening any lane's conversation from its row in Agents or its Inspector, with Stop while it runs; a lane's backup lane (`fallback` in the lane file), which takes a run that hit its quota or failed to start; and `npm run run-lane -- --list` marking a run that moved.
2. Check each sentence against `docs/agents/architecture/ROOM.md` and `COMMANDS.md` before writing it. Keep the README's PowerShell syntax for commands.

**P293. The Dispatch confirm card says where the worktree is and what it starts from (AGY).** Read the last section of `docs/agents/AUDIT-2026-11-TRIAL-PLAN.md` and this brief only. Commit each step as you finish it. Files: src/ui/panels/DispatchPanel.jsx, src/ui/panels/runs.js, tests/project-dispatch.test.js, docs/agents/CHANGELOG.md, docs/agents/architecture/ROOM.md.

1. With Own worktree, the confirm card says `The lane works in its own worktree, .worktrees/LANE inside the project, on a new branch from the project's current branch.` with the real lane and the branch the project has checked out when the card opens (read how the card already gets the project's details). Drop `beside the project` and `never on main`, which are not true.
2. Test, by what it proves: the confirm card for a project on branch `work` names `.worktrees/opencode` and `work`. It must fail before your change.
3. Run `node node_modules/vitest/vitest.mjs run tests/project-dispatch.test.js` and `npm run build`. Report what passed.

**P294. A reused worktree on a named branch with unmerged commits refuses to start (OpenCode).** Start after P285 and P286 are merged. Read the row on reused worktrees in `docs/agents/AUDIT-2026-11-TRIAL-PLAN.md` and this brief only. Use no subagents. Run every command in the foreground. Commit each step as you finish it, and stop starting new work at minute 25. Files: scripts/run-lane.mjs, tests/run-worktree.test.js, docs/agents/CHANGELOG.md, docs/agents/architecture/COMMANDS.md.

1. Before a project run reuses `PROJECT\.worktrees\LANE`, the runner refuses, with one sentence naming the branch and the count, when the worktree is on a named branch that has commits not in the project's current HEAD: `The LANE worktree is on BRANCH with N commits not in the project yet. Merge or remove it first.` A detached worktree keeps today's check.
2. Test, by what it proves: a worktree left on a named branch with one extra commit refuses with that sentence; one on a branch already merged starts. The first must fail before your change.
3. Run `node node_modules/vitest/vitest.mjs run tests/run-worktree.test.js` and `npm run build`. Report what passed.

**P295. The tests that could not fail can fail now, round two (AGY).** Read `docs/agents/AUDIT-2026-11-TESTS-2.md` and this brief only. Never change product code. Commit each step as you finish it. Files: tests/tree-read.test.js, tests/lane-conversation.test.js, tests/history-audit.test.js, tests/runs-folder.test.js, tests/scale.test.js, tests/scale-live.test.js, tests/screenshots.test.js, tests/hand-run.test.js, tests/bridge-routes.test.js, tests/conversation.test.js, docs/agents/AUDIT-2026-11-TESTS-2.md, docs/agents/CHANGELOG.md.

1. For each row of the audit's table, add the smallest real assertion the row proposes, or one that proves the same thing: literal usage lines and refusal sentences instead of the imported constants, a literal 4000 for the text cut, the exact call in the open-chat test, and for the two tree-read rows a test that separates the guard it names (a failed git watcher with `gitMetaDirty` already cleared; a polling bridge that still has a watcher object).
2. Prove each new assertion fails with its change undone, in a scratch copy under `%TEMP%`, never in the worktree. Delete the copy after.
3. Add a `Fixed` column to the audit table naming the test that now fails.
4. Run each changed test file alone and report what passed.

**P296. Plan Lowbeam's move to MachineRoom, and check it against the code (Codex).** The owner chose Lowbeam for the real-project trial, and from now on Lowbeam's work runs through MachineRoom: MachineRoom's lanes do the work, and its Reviews merge into Lowbeam's `main`. Lowbeam's old setup (an overseer in the desktop app who alone fast-forwarded `main`, and six worktrees from an October MachineRoom run: `.worktrees/agy`, `ccc`, `hermes`, `oc5`, `oc6`, `opencode`, each on a `machineroom/queue-...` branch) is months old and gives way to MachineRoom's rules. Read `docs/agents/OWNER.md`, `docs/agents/AUDIT-2026-11-TRIAL-PLAN.md` (what the room cannot do on another project), `C:\GitHub\Lowbeam\docs\agents\ARCHITECTURE.md` (Conventions, Verification and Open work), `C:\GitHub\Lowbeam\docs\agents\tasks\README.md`, and this brief only. Read Lowbeam; never change, commit, push, test or start anything in it. Change no MachineRoom file except your report. Do not commit: the runner commits your file. Stop at minute 35. Files: docs/agents/TRIAL-LOWBEAM.md.

Write the plan the owner will follow, with `file:line` in MachineRoom for every claim about what the room does:
1. The old worktrees: for each of the six, its branch, how many commits it has that `main` does not (`git -C C:\GitHub\Lowbeam log --oneline main..BRANCH`), and whether its work looks merged, superseded or still wanted. Say how the owner removes the ones that are done (the room's worktree list, `npm run worktrees -- --project C:\GitHub\Lowbeam`, or git), and which need the owner's look first. Remove nothing.
2. Lowbeam's own guide: list the sentences in its `ARCHITECTURE.md` and `tasks/README.md` that the new rules make wrong (the overseer, who owns `main`, per-agent ports and worktrees), and write the replacement sentences in that guide's style, for the owner or a first MachineRoom task to apply.
3. The command that opens the room on Lowbeam, and the code lanes the owner adds (their names must not clash with a worktree the owner keeps).
4. The check command (Lowbeam's `npm test` and `npm run check`; say how the room runs both, since a check command refuses shell operators).
5. The merge: how a lane's branch reaches Lowbeam's `main` through Reviews, and what Reviews requires (a clean `main`, a fast-forward).
6. The dev server: Lowbeam's `npm start` serves `main` on 8040. Say how the owner sees a lane's change before merging, on a port that is not 8040 or 8041.
7. Three small first tasks from Lowbeam's own open work, each with the files it touches, and what the room should show at each step. Say what would count as a failure of MachineRoom rather than of the task, and name every step the room cannot do today.

**P297. The detail docs say what this week's code does (native).** Read `docs/agents/AUDIT-2026-11-DOCS-3.md` and this brief only. Change only docs. Commit each step as you finish it, and stop at minute 25. Files: docs/agents/architecture/ROOM.md, docs/agents/architecture/LIVE.md, docs/agents/architecture/COMMANDS.md, docs/agents/AUDIT-2026-11-DOCS-3.md, docs/agents/CHANGELOG.md.

1. For rows 1 to 14 and the unnamed parts in row 18, check the row against the code at `HEAD` once more, then replace the doc sentence with the corrected one. These lines are long: change only the sentence the row names, and keep the docs' style (plain words, short sentences, no em dashes).
2. Add a `Status` column to the audit table: `fixed in P297` or `no change`.
3. Run `node node_modules/vitest/vitest.mjs run tests/briefs.test.js` and report what passed.

**P298. Review the batch since review 32 (Codex).** Read this brief only. Change no code. Do not commit: the runner commits your file. Stop at minute 35. Files: docs/agents/AUDIT-2026-11-REVIEW-33.md.

Let BASE be the commit that added `docs/agents/AUDIT-2026-11-REVIEW-32.md` (`git log --format=%h --diff-filter=A -1 -- docs/agents/AUDIT-2026-11-REVIEW-32.md`). Review `git diff BASE..HEAD` (`git log --first-parent --oneline BASE..HEAD`). Check that each review 32 finding is really fixed: R32-1 by P285, R32-2, R32-3 and R32-5 by P286, R32-4 by P287, R32-6 by P288. Then review what else changed: P262's backup lane choice and model choice in Dispatch, P290's test waits, P293's confirm card, P295's test changes, and the docs of P282, P292 and P297. Look for: a stop that ends a run other than the one the owner confirmed, including a run started from the command line and found in the lanes source; a failed record written twice or lost; a Codex rollout read outside the sessions folder; a key or home path reaching a response, record or conversation entry; and a test that would still pass with its change undone. Write the file as a table ordered by severity: finding, `file:line`, a concrete failure, the smallest fix, and whether it blocks a push.

**P299. Run the full suite on main (OpenCode).** Read this brief only. Change no file except your report. Use no subagents. Run every command in the foreground. Commit only your report, and stop at minute 30. Files: docs/agents/RUN-2026-11-14-SUITE-2.md.

1. Run `npm test` once in your worktree on `main`.
2. For each failing test, run its file alone. A test that passes alone is a load flake; one that fails alone is a real failure.
3. Write the report: the totals, each failure with its file, its message and whether it passed alone, and the run time.

**P300. A failed-over project run keeps its branch and commits in its record (OpenCode).** Read this brief only. Use no subagents. Run every command in the foreground. Commit each step as you finish it, and stop starting new work at minute 25. Files: scripts/run-lane.mjs, tests/run-failover.test.js, docs/agents/CHANGELOG.md.

Since P286, when a project run with a deferred record fails over and the backup starts, `startLane` in `scripts/run-lane.mjs` writes the failed record with `appendRunRecord` after the backup returns, with only `head`. Before P286 it went through `writeProjectRecord`, which also set `branch` and `commits` from the project's git state.

1. Read the failed run's branch and commits (`gitRead(project, ['branch', '--show-current'])` and the log from `projectStart.head`, as `writeProjectRecord` does through `projectRunGit`) at the same moment `failedHead` is read, before the backup starts, and put them on the failed record when it is written. A refused backup keeps today's path, where the queue writes the record.
2. Test, by what it proves: a project run whose lane fails over to a backup that starts writes the failed record with the branch the failed run was on. It must fail before your change.
3. Run `node node_modules/vitest/vitest.mjs run tests/run-failover.test.js tests/run-queue.test.js` and `npm run build`. Report what passed.

**P301. The folder tree test proves the poll guard (OpenCode).** Read row 2 of `docs/agents/AUDIT-2026-11-TESTS-2.md` and this brief only. Use no subagents. Run every command in the foreground. Commit each step as you finish it, and stop starting new work at minute 25. Files: server/index.js, tests/tree-read.test.js, docs/agents/AUDIT-2026-11-TESTS-2.md, docs/agents/CHANGELOG.md.

1. Change the test `keeps the one-second rule for a folder ask while the bridge polls` so the bridge has a working watcher and a poll timer at once, and a folder ask reads again only because of the poll. If the bridge cannot reach that state through its options, add the smallest option to `createBridge` that lets a test arm the poll beside a watcher, and use it only in the test.
2. Prove it: with `pollTimer` taken out of `folderTreeReuseAllowed` the test fails, and with it in the test passes. Say how you proved it.
3. Mark row 2 fixed in the audit file, add one changelog line, and run `node node_modules/vitest/vitest.mjs run tests/tree-read.test.js` and `npm run build`. Report what passed.

**P302. The lanes source takes a run's start time only from the lock of that run (OpenCode).** Read finding R33-1 in `docs/agents/AUDIT-2026-11-REVIEW-33.md` and this brief only. Use no subagents. Run every command in the foreground. Commit each step as you finish it, and stop starting new work at minute 28. Files: src/briefs/run.js, scripts/run-lane.mjs, server/lanes-source.js, tests/lanes-source.test.js, tests/run-lane-stop.test.js, docs/agents/CHANGELOG.md, docs/agents/architecture/LIVE.md.

1. `laneLockText` also writes `log`, the base name of the run's log file, and the runner passes it when it takes the lane lock for a run (the same place it passes `startedAt`). Add `laneLockLog(text)` beside `laneLockStartedAt`.
2. In `server/lanes-source.js`, `beginRun` takes the lock's `startedAt` only when the lock's `log` is the base name of the log it is opening. Otherwise it keeps `now()`, so a Stop from the room names a start time no lock holds and the runner refuses it.
3. Tests, by what they prove: two logs on one lane, the old one discovered after a newer run took the lock, give the old log no lock start time and the new log the lock's; a lock with no `log` gives `now()`. The first must fail before your change.
4. Run `node node_modules/vitest/vitest.mjs run tests/lanes-source.test.js tests/run-lane-stop.test.js` and `npm run build`. Report what passed.

**P303. A stop leaves a newer run's processes alone (OpenCode).** Read finding R33-2 in `docs/agents/AUDIT-2026-11-REVIEW-33.md` and this brief only. Use no subagents. Run every command in the foreground. Commit each step as you finish it, and stop starting new work at minute 25. Files: scripts/run-lane.mjs, tests/run-lane-stop.test.js, docs/agents/CHANGELOG.md, docs/agents/architecture/COMMANDS.md.

1. In `stopLane`, read the lock again after the run's own processes and descendants are stopped and before `stopLeftovers`. When its text differs from the text read at the start, skip the worktree leftover search, print `kept the LANE lock: a newer run took it while the stop ran`, and exit 0 as today.
2. Test, by what it proves: a stop whose `kill` stub writes a new lock (a newer holder) before the leftover search does not call `kill` for a process in the worktree that is not the stopped run's. It must fail before your change. Use the `list`, `kill` and `alive` options of `stopLane` rather than real processes.
3. Run `node node_modules/vitest/vitest.mjs run tests/run-lane-stop.test.js` and `npm run build`. Report what passed.

**P305. A Codex rollout read checks the file it opened (AGY).** Read finding R33-4 in `docs/agents/AUDIT-2026-11-REVIEW-33.md` and this brief only. Commit each step as you finish it, and stop starting new work at minute 25. Files: scripts/run-lane.mjs, tests/quota-read.test.js, docs/agents/CHANGELOG.md.

1. In `readCodexQuota`, after `openSync`, compare `fstatSync(fd)` with the `lstatSync` of the path taken before the open (`dev` and `ino`, with `{ bigint: true }` on both). When they differ, or the lstat was a symbolic link, close the descriptor and answer null. `findCodexRollout` passes the checked path as today.
2. Test, by what it proves: a rollout replaced between the check and the open (stub the open step, or replace the file through an injected hook) answers null. It must fail before your change. Keep the test working on Windows and Linux.
3. Run `node node_modules/vitest/vitest.mjs run tests/quota-read.test.js` and `npm run build`. Report what passed.

**P304. A failover writes the failed record once, even when the backup throws, and says a move only when the backup starts (OpenCode).** Start after P300 is merged. Read findings R33-3 and R33-5 in `docs/agents/AUDIT-2026-11-REVIEW-33.md` and this brief only. Use no subagents. Run every command in the foreground. Commit each finding's fix as you finish it, and stop starting new work at minute 28. Files: scripts/run-lane.mjs, server/runs.js, tests/run-failover.test.js, tests/project-dispatch.test.js, docs/agents/CHANGELOG.md.

1. R33-3: when `startFailover` throws for a deferred project run, the failed run's record is still written exactly once, and the queue does not also write a generic record for it. A refused backup keeps today's path.
2. R33-5: a failed record keeps `failover.to` only when the backup started. A refused backup records `failover: { kind, to, refused: true }`, and the bridge's room note for it says `LANE hit KIND and its backup TO could not start.` instead of `moved to`.
3. Tests, by what they prove, each failing before its fix: a backup whose start throws leaves one failed record of the first lane; a busy backup gives a record with `refused: true` and the note `could not start`.
4. Run `node node_modules/vitest/vitest.mjs run tests/run-failover.test.js tests/run-queue.test.js tests/project-dispatch.test.js` and `npm run build`. Report what passed.

**P306. A check holds one command per line, and the runner runs each in order (OpenCode).** The owner said yes to two checks in one check field, for Lowbeam's `npm test` and `npm run check`. Read this brief only. Use no subagents. Run every command in the foreground. Commit each step as you finish it, and stop starting new work at minute 32. Files: src/briefs/run.js, scripts/run-lane.mjs, server/project-settings.js, server/runs.js, tests/run-lane.test.js, tests/run-queue.test.js, tests/project-dispatch.test.js, tests/project-settings.test.js, docs/agents/CHANGELOG.md, docs/agents/architecture/COMMANDS.md, docs/agents/architecture/LIVE.md.

1. The check command is one string that may hold up to 4 non-empty lines (`\n` or `\r\n`), each one command. `checkCommandProblem` in `server/project-settings.js` accepts line breaks, refuses a fifth line with `A check holds at most 4 commands, one per line.`, and checks each line with the runner's rule (no shell operators, no open quote). Keep `CHECK_COMMAND_LIMIT` for the whole string.
2. The bridge passes one `--test` per line, in order (`server/runs.js`, where `testArgs` is built). `parseRunArgs` and the queue's argument parser accept `--test` more than once and keep the list.
3. The runner runs the commands in order in the run's folder and stops at the first that fails. A task passes only when every command passes. The log and the summary name each command with `passed` or `failed`, and the record's `tests` stays `passed` or `failed`. One `--test` behaves as today, and an empty check still falls back to `npm test` when the project has that script.
4. Tests, by what they prove, each failing before your change: a saved two-line check is accepted and a five-line one refused; the bridge sends `--test npm test --test npm run check` for a two-line check; a queue task whose second command fails is not committed and records `failed: tests`; a task whose two commands pass is committed.
5. Run `node node_modules/vitest/vitest.mjs run tests/run-lane.test.js tests/run-queue.test.js tests/project-dispatch.test.js tests/project-settings.test.js` (skip a file that does not exist) and `npm run build`. Report what passed.

**P307. The Dispatch check box takes one command per line (AGY).** The owner said yes to two checks in one check field. Start after P306 is merged. Read this brief only. Commit each step as you finish it. Files: src/ui/panels/DispatchPanel.jsx, src/ui/panels/runs.js, tests/project-dispatch.test.js, docs/agents/CHANGELOG.md, docs/agents/architecture/ROOM.md.

1. The `Check command` box under the task is a two-row text area that grows to four rows. The hint reads `One command per line, run in order after each task; the task is committed only when all pass. Empty uses npm test when package.json has one.`
2. `projectCheckLine` names every line in order: `Check: npm test, then npm run check.` for two lines, and today's wording for one line or none.
3. Tests, by what they prove: typing two lines sends a body whose `checkCommand` holds both lines, and the confirm card reads `Check: npm test, then npm run check.` They must fail before your change.
4. Run `node node_modules/vitest/vitest.mjs run tests/project-dispatch.test.js` and `npm run build`. Report what passed.

**P308. A project queue keeps the lane's own commits and signs its own (OpenCode).** The owner said yes to queue commits that follow the project's commit format. Read this brief only. Use no subagents. Run every command in the foreground. Commit each step as you finish it, and stop starting new work at minute 32. Files: src/briefs/queue.js, scripts/run-lane.mjs, src/harnesses/*.js, tests/run-queue.test.js, tests/harnesses.test.js, docs/agents/CHANGELOG.md, docs/agents/architecture/COMMANDS.md.

A project such as Lowbeam tells its agents in its own guide how to commit (a version prefix, a sentence, a body and a `Co-Authored-By` trailer). Today the queue commits each task itself with the task's first line as the subject and its own body, and a task where the lane already committed is recorded as `no change`.

1. When the lane committed during a task (HEAD moved past the task's start) and the tree is clean, the queue keeps those commits, adds none, and records `committed` with the newest sha. When HEAD moved and the tree is dirty, the queue commits the rest as today. When HEAD did not move, today's path stays.
2. The queue's own commit message ends with a trailer naming the lane's agent: `Co-Authored-By: LABEL (MODEL) <ADDRESS>`, where each harness descriptor gains a `commitAuthor` with its label and a noreply address (for example `OpenCode` and `noreply@opencode.ai`, `Claude` and `noreply@anthropic.com`, `Codex` and `noreply@openai.com`), and MODEL is the run's model when known. A harness without `commitAuthor` adds no trailer.
3. Tests, by what they prove, each failing before your change: a task where the fake lane commits leaves exactly that commit and records its sha as `committed`; a task where the fake lane leaves changes gets a queue commit whose message ends with the trailer for its harness.
4. Run `node node_modules/vitest/vitest.mjs run tests/run-queue.test.js tests/harnesses.test.js` (skip a file that does not exist) and `npm run build`. Report what passed.

**P309. A Reviews merge moves the project's play worktree to the new head (OpenCode).** The owner said yes. Read this brief only. Use no subagents. Run every command in the foreground. Commit each step as you finish it, and stop starting new work at minute 28. Files: server/reviews.js, src/ui/panels/ReviewsPanel.jsx, tests/project-reviews.test.js, tests/reviews-panel.test.js, docs/agents/CHANGELOG.md, docs/agents/architecture/LIVE.md, docs/agents/architecture/ROOM.md.

Lowbeam keeps a play worktree at `PROJECT\.worktrees\play`, detached on the latest `main`, for the owner's port 8041. Its own `post-merge` hook used to move it, but Reviews runs git with `core.hooksPath` set to an empty folder on purpose (`defaultGitRunner` in `server/reviews.js`), so the hook never runs after a Reviews merge. Keep hooks off.

1. After a Reviews merge succeeds, when `PROJECT\.worktrees\play` is a git worktree of the project, detached, with a clean `git status --porcelain`, run `git checkout --detach COMMIT` in it with the same runner (hooks off). The merge answer gains `play: 'moved'`, `'dirty'`, `'not detached'` or `'failed'`, and no field when there is no play worktree. A play step that fails never turns the merge into a failure.
2. Reviews shows one line under `Merged as SHA.`: `The play worktree moved to SHA.`, or `The play worktree has changes, so it stayed on OLD.` or `The play worktree is on a branch, so it stayed.` for the other answers.
3. Tests, by what they prove, each failing before your change: a merge in a project with a clean detached play worktree leaves it on the merged commit and answers `play: 'moved'`; a dirty one stays and answers `'dirty'`; a project without one answers no `play` field. Set a git identity in the test's git calls (no global git config on CI), and run the tests once with `GIT_CONFIG_GLOBAL=/dev/null` (bash) to check.
4. Run `node node_modules/vitest/vitest.mjs run tests/project-reviews.test.js tests/reviews-panel.test.js` and `npm run build`. Report what passed.

**P310. Test helpers wait for a child's output before they read it (OpenCode).** Read this brief only. Use no subagents. Run every command in the foreground. Never change product code and never weaken an assertion. Commit each step as you finish it, and stop starting new work at minute 25. Files: tests/machine-doctor.test.js, tests/made-lane-defaults.test.js, tests/pack-start.test.js, tests/run-failover.test.js, tests/run-lane-stop.test.js, tests/run-lane.test.js, tests/run-project.test.js, tests/run-worktree.test.js, tests/serve.test.js, tests/helpers/*.js, docs/agents/architecture/LIMITS.md, docs/agents/CHANGELOG.md.

On Ubuntu CI, `tests/run-project.test.js` `still lists a project run with --list and --stats` failed with `expected '' to contain 'opencode'`: the helper `runLane` resolves on the child's `exit` event, which can fire before its stdout pipe is drained, so the test reads an empty stdout. The same `child.once('exit', (code) => ...)` pattern is in the nine files above.

1. In each helper that spawns a child and then reads its collected stdout or stderr, resolve on `close` (which fires after the streams end) instead of `exit`, keeping the exit code from `close`'s first argument. Where a helper waits on `exit` only to know the process ended and never reads its output, leave it.
2. Run each changed file once with `node node_modules/vitest/vitest.mjs run FILE`, and report the counts. Add one line under the existing test-flake limit in LIMITS.md naming the cause.

**P311. The doctor and the orchestrators find the Codex app's program too (OpenCode).** The owner said yes. Read this brief only. Use no subagents. Run every command in the foreground. Commit each step as you finish it, and stop starting new work at minute 28. Files: server/agents-config.js, server/doctor.js, server/orchestrator.js, scripts/run-lane.mjs, tests/machine-doctor.test.js, tests/agents-config.test.js, tests/orchestrator*.test.js, docs/agents/CHANGELOG.md, docs/agents/architecture/COMMANDS.md, docs/agents/architecture/LIVE.md.

The Codex app no longer puts `codex` on PATH. Its program sits in `%LOCALAPPDATA%\OpenAI\Codex\bin\HASH\codex.exe`. `codexAppProgram` in `server/agents-config.js` finds the newest one (P73), and the runner (`codexLaneProgram` in `scripts/run-lane.mjs`) and `isHarnessAvailable` use it, so Codex lanes start. Two places do not: the doctor's `laneProgram` in `server/doctor.js` prints `FAIL The Codex lane program was not found: codex.`, and `binFor` in `server/orchestrator.js` hands a Codex orchestrator or sub orchestrator the bare name `codex`, so its turn cannot start.

1. Add one exported helper to `server/agents-config.js`, `codexProgramFor(harness, bin, { env, platform })`: when the harness is `codex`, the bin is `codex` or empty, and `codex` is not on PATH, it answers `codexAppProgram(...)`; otherwise null. Make `codexLaneProgram` in run-lane use it, with no change in behaviour.
2. The doctor's lane check uses it, so a Codex lane with `bin: "codex"` prints `ok The Codex lane starts from %LOCALAPPDATA%\OpenAI\Codex\bin\HASH\codex.exe.` when the app has one.
3. `binFor` in `server/orchestrator.js` uses it for the codex harness, so a Codex orchestrator's turn starts the app's program. A `bin` that names a path, and every other harness, stay as they are.
4. Tests, by what they prove, each failing before your change: the helper answers the newest app program for codex with no PATH entry, and null for a full path, for another harness and when `codex` is on PATH; the doctor prints the ok line for such a lane; an orchestrator on the codex harness spawns the app's program. Use temp folders and pass `env`; never read the real `%LOCALAPPDATA%`.
5. Run `node node_modules/vitest/vitest.mjs run` on each changed test file and `npm run build`. Report what passed.

**P312. Review the batch since review 33 (Codex).** Read this brief only. Change no code. Do not commit: the runner commits your file. Stop at minute 35. Files: docs/agents/AUDIT-2026-11-REVIEW-34.md.

Let BASE be the commit that added `docs/agents/AUDIT-2026-11-REVIEW-33.md` (`git log --format=%h --diff-filter=A -1 -- docs/agents/AUDIT-2026-11-REVIEW-33.md`). Review `git diff BASE..HEAD` (`git log --first-parent --oneline BASE..HEAD`). Check that each review 33 finding is really fixed: R33-1 by P302, R33-2 by P303, R33-3 and R33-5 by P304, R33-4 by P305. Then review what else changed: P300's failed-over project record, P306's check of one command per line, P307's Dispatch check box, P308's queue commits and commit authors, P309's play worktree move after a Reviews merge, P310's test helpers and P311's Codex program lookup in the doctor and the orchestrators. Look for: a check line that runs through a shell when it should not, or lets one line run two commands; a queue commit that drops or rewrites the lane's own commits; a play worktree moved while it has changes or sits on a branch; a Reviews merge that runs project hooks; a Codex program taken from a folder an attacker could write; a key or home path reaching a response, record or conversation entry; and a test that would still pass with its change undone. Also read the docs the range changed (`git diff --stat BASE..HEAD -- docs`, leaving out TASKS.md and the audit files) and list each sentence that the code contradicts, with the code's `file:line`. Write the file as a table ordered by severity: finding, `file:line`, a concrete failure, the smallest fix, and whether it blocks a push. Put the doc sentences in a second table: doc `file:line`, the sentence, what the code does.

Review 34 (`docs/agents/AUDIT-2026-11-REVIEW-34.md`) fixes, P313 to P319. Each brief reads only its finding rows in that file and its own text. R34-4 (a parent-folder junction race on the Codex rollout read) is accepted as a limit in P319: it needs a same-user process rewriting `.codex\sessions`, which can already do worse.

**P313. A stop takes its leftovers only from the run it confirmed (OpenCode).** Read finding R34-1 in `docs/agents/AUDIT-2026-11-REVIEW-34.md` and this brief only. Use no subagents. Run every command in the foreground. Commit each step as you finish it, and stop starting new work at minute 28. Files: scripts/run-lane.mjs (only `stopLane`, `stopLeftovers` and `stopDescendants`), tests/run-lane-stop.test.js, docs/agents/CHANGELOG.md.

1. After the lock check, `stopLane` kills only processes from the process list it took before that check (the confirmed run's snapshot), matched by pid and creation time. It never takes a fresh process list to find leftovers by worktree after it killed the runner. When the snapshot is missing, it stops nothing by worktree and says so in one line.
2. Test, failing before your change: an injected second `list()` call installs a new lock and returns the new run's harness in the same worktree; the stop leaves that harness alive and keeps the new lock.
3. Run `node node_modules/vitest/vitest.mjs run tests/run-lane-stop.test.js` and report the counts.

**P314. A refused backup keeps the failed run's branch, and a queue signs each task with the lane that did it (OpenCode).** Read findings R34-7 and R34-8 in `docs/agents/AUDIT-2026-11-REVIEW-34.md` and this brief only. Use no subagents. Run every command in the foreground. Commit each step as you finish it, and stop starting new work at minute 30. Files: scripts/run-lane.mjs (only the failover and queue paths: `startFailover`, `writeProjectRecord` and the queue's author choice), src/briefs/queue.js, tests/run-failover.test.js, tests/run-queue.test.js, docs/agents/CHANGELOG.md.

1. R34-7: when a backup is refused or throws after its branch was made, the failed record keeps the branch and commits captured before the backup started; `writeProjectRecord` does not read them again from the folder.
2. R34-8: the queue picks the commit author for each task from the run that succeeded for it, the backup's lane and model when the task failed over. The lane's own commits are never amended.
3. After each task the queue checks the worktree is still on the queue branch (`git branch --show-current`). When the lane left it on another branch, the task fails with `failed: the lane left the queue branch for NAME` and the queue stops.
4. Tests, each failing before your change: a backup that throws after making its branch leaves the failed record on the primary's branch with its commits; a task that fails over from an OpenCode lane to a Codex lane is signed with the Codex trailer; a lane that switches to another branch fails its task. Set GIT_AUTHOR_* and GIT_COMMITTER_* in every git call the tests make (CI has no global git identity), and run them once with `GIT_CONFIG_GLOBAL=/dev/null` in bash.
5. Run `node node_modules/vitest/vitest.mjs run tests/run-failover.test.js tests/run-queue.test.js` and report the counts.

**P315. A refused backup never reads as a move (OpenCode).** Read finding R34-9 in `docs/agents/AUDIT-2026-11-REVIEW-34.md` and this brief only. Use no subagents. Run every command in the foreground. Commit each step as you finish it, and stop starting new work at minute 25. Files: src/briefs/run.js (only `runListLine`), src/ui/Inspector.jsx (only the failover line), tests/run-lane.test.js, tests/inspector.test.js, tests/inspector-ui.test.js, docs/agents/CHANGELOG.md.

1. A record whose `failover.refused` is true reads ` | backup BACKUP could not start (KIND)` in `--list` and `Backup BACKUP could not start: KIND` in the Inspector. A started move reads as before.
2. Tests, each failing before your change: the list line and the Inspector line for a refused record, beside the started one.
3. Run `node node_modules/vitest/vitest.mjs run tests/run-lane.test.js tests/inspector.test.js tests/inspector-ui.test.js` and report the counts.

**P316. Commit text on a run record is masked (OpenCode).** Read finding R34-3 in `docs/agents/AUDIT-2026-11-REVIEW-34.md` and this brief only. Use no subagents. Run every command in the foreground. Commit each step as you finish it, and stop starting new work at minute 25. Files: src/briefs/run.js (only `projectRunGit`), server/runs.js (only where a run record's `commits` reach a response), tests/run-project.test.js, tests/project-dispatch.test.js, docs/agents/CHANGELOG.md.

1. `projectRunGit` passes each commit line through `maskKeys` (`src/briefs/audit.js`) and `maskProfilePaths` (`src/briefs/run.js`) before it is stored. The branch name and the project path used to match runs stay as they are.
2. `GET /api/control/runs` masks the `commits` of every record it returns the same way, so records written before this change are masked too.
3. Tests, each failing before your change: a commit subject holding a fake key (build it from parts, never a real one) and a `C:\Users\NAME\notes.txt` path is masked in the saved record and in the runs response.
4. Run `node node_modules/vitest/vitest.mjs run tests/run-project.test.js tests/project-dispatch.test.js` and report the counts.

**P317. A bare carriage return ends a check line (OpenCode).** Read finding R34-6 in `docs/agents/AUDIT-2026-11-REVIEW-34.md` and this brief only. Use no subagents. Run every command in the foreground. Commit each step as you finish it, and stop starting new work at minute 25. Files: src/briefs/run.js (only `checkCommandLines` and `checkCommandProblem`), server/project-settings.js, src/control/mock.js (only its check command rule), tests/project-settings.test.js, tests/run-lane.test.js, tests/control-mock.test.js, docs/agents/CHANGELOG.md.

1. `checkCommandLines` splits on `\r\n`, `\r` and `\n`, so a bare carriage return starts a new command and counts toward the four. The mock uses the same rule.
2. Tests, each failing before your change: a saved setting and a `--test` value with a carriage return inside a quoted argument count as two commands; five commands split by carriage returns are refused.
3. Run `node node_modules/vitest/vitest.mjs run tests/project-settings.test.js tests/run-lane.test.js tests/control-mock.test.js` and report the counts.

**P318. The play move never overwrites an ignored file, and the Codex lookup refuses links (AGY).** Read findings R34-2 and R34-5 in `docs/agents/AUDIT-2026-11-REVIEW-34.md` and this brief only. Commit each step as you finish it, and stop starting new work at minute 30. Run every command in the foreground. Files: server/reviews.js (only `movePlayWorktree`), server/agents-config.js (only `codexAppProgram`), tests/project-reviews.test.js, tests/agents-config.test.js, docs/agents/CHANGELOG.md.

1. R34-2: the play move runs `git checkout --no-overwrite-ignore --detach COMMIT`, so a merged file that would replace an ignored local file fails the move (`play: 'failed'`) and leaves the file as it was.
2. R34-5: `codexAppProgram` skips a hash folder or a `codex.exe` that is a symbolic link or junction (`lstatSync`), and skips a program whose real path is not under the `OpenAI\Codex\bin` folder it listed.
3. Tests, each failing before your change: a play worktree with an ignored `config.json` that the merged commit tracks keeps its file and answers `failed`; a junction hash folder and a linked `codex.exe` are skipped. Make the link tests run on Windows only (`it.runIf(process.platform === 'win32')`), set a git identity in the test's git calls, and use temp folders.
4. Run `node node_modules/vitest/vitest.mjs run tests/project-reviews.test.js tests/agents-config.test.js` and report the counts.

**P319. The docs say what review 34 found (OpenCode).** Read the second table and finding R34-4 in `docs/agents/AUDIT-2026-11-REVIEW-34.md` and this brief only. Use no subagents. Change no code except the one hint string named below and its test. Commit each step as you finish it, and stop starting new work at minute 30. Files: docs/agents/architecture/COMMANDS.md, docs/agents/architecture/LIVE.md, docs/agents/architecture/ROOM.md, docs/agents/architecture/LIMITS.md, docs/agents/history/CONTROL-CLIENT.md, docs/agents/TRIAL-LOWBEAM.md, docs/agents/ARCHITECTURE.md (only the Open work paragraph), docs/agents/lanes.json (only the codex lane), src/ui/panels/DispatchPanel.jsx (only the check hint), tests/panels-runs.test.js, docs/agents/CHANGELOG.md.

Leave the rows about stop (R34-1), refused backups (R34-7, R34-9) and queue authors (R34-8) alone: P313 to P315 make the code match those sentences. Leave CHANGELOG entries already written alone.

1. COMMANDS.md, ROOM.md and the Dispatch hint: say that a lane may commit during its task, and that only the queue's own commit waits for every check to pass. Hint: `One command per line, run in order after each task; the queue commits what is left only when all pass. Empty uses npm test when package.json has one.`
2. LIVE.md and CONTROL-CLIENT.md: the check is up to 4 non-empty commands and 500 characters in all; a refused backup's note says it could not start; the first read of the records posts no note for old failovers.
3. LIMITS.md: one line each for R34-4 (accepted: a same-user process that rewrites `.codex\sessions` folders while a run reads the rollout), and for check lines on Windows starting only real programs and `npm` or `npx` (a `pnpm` or `yarn` shim fails to start).
4. TRIAL-LOWBEAM.md: say at the top that the trial ran: the six October worktrees were removed with their branches kept, the first task merged through Reviews as `f3255a3` (0.12.56), and since P309 Reviews moves `.worktrees\play` itself because hooks stay off. Fix the sentence that names seven existing Lowbeam worktrees.
5. ARCHITECTURE.md Open work: reviews 32 to 34 join the closed list, with review 34's fixes P313 to P319.
6. lanes.json codex lane: model `gpt-6.1-terra`, effort `high`, and a modelHint saying the owner chose GPT-6.1 Terra at high effort on 2026-11-13.
7. Run `node node_modules/vitest/vitest.mjs run tests/panels-runs.test.js tests/briefs.test.js` and report the counts.

The last OpenCode batch, P320 to P325 (2026-11-15). The owner's OpenCode Go plan ends on 2026-11-17 and OpenCode leaves the fleet after this batch. P325 maps what depends on it.

**P320. The play line names the play worktree's own head (OpenCode).** Read this brief only. Use no subagents. Run every command in the foreground. Commit each step as you finish it, and stop starting new work at minute 25. Files: server/reviews.js (only `movePlayWorktree`), src/ui/panels/ReviewsPanel.jsx (only `playNotice` and its caller), tests/project-reviews.test.js, tests/reviews-panel.test.js, docs/agents/architecture/ROOM.md, docs/agents/architecture/LIVE.md, docs/agents/CHANGELOG.md.

A dirty play worktree answers `play: 'dirty'`, and Reviews says `The play worktree has changes, so it stayed on OLD.` with OLD taken from the destination's old head, not from play.

1. `movePlayWorktree` adds `playHead` (play's `git rev-parse HEAD`) to the `dirty` and `not detached` answers, and the merge answer carries it. `playNotice` names that head, cut to 7 characters, and falls back to the sentence with no SHA when it is missing.
2. Tests, each failing before your change: a dirty play worktree on a commit other than the old main is named by its own head in the answer and the line. Set a git identity in the test's git calls and run them once with `GIT_CONFIG_GLOBAL=/dev/null` in bash.
3. Remove the accepted exception about the old `main` from nothing but ROOM.md and LIVE.md's sentence about this line. Run `node node_modules/vitest/vitest.mjs run tests/project-reviews.test.js tests/reviews-panel.test.js` and report the counts.

**P321. After a queue failover the branch check expects the backup's branch (OpenCode).** Read this brief only. Use no subagents. Run every command in the foreground. Commit each step as you finish it, and stop starting new work at minute 28. Files: src/briefs/queue.js (only `runQueue`), scripts/run-lane.mjs (only the `runTask` callback in `runQueueProject`), tests/run-queue.test.js, tests/run-failover.test.js, docs/agents/CHANGELOG.md.

P314 made the queue fail a task when the lane leaves the queue branch. After a failover it reads the current branch and accepts whatever it is. A backup branch is always named `BEFORE-on-BACKUP` (`scripts/run-lane.mjs`, `${branchBefore}-on-${target}`), where BEFORE is the branch the task started on.

1. `runQueue` reads the current branch before each task. The `runTask` callback returns `backupLane` (the backup lane's key) when the task failed over, and no branch of its own. The queue then expects `BEFORE-on-BACKUP` after a failover and BEFORE otherwise.
2. Tests, each failing before your change: a backup that ends on a third branch fails its task with `failed: the lane left the queue branch for NAME`; a backup that stays on `BEFORE-on-BACKUP` commits as before, including when the queue started on a branch that is not `machineroom/queue-...` (the existing `work-x` case). Set GIT_AUTHOR_* and GIT_COMMITTER_* in the tests' git calls and run them once with `GIT_CONFIG_GLOBAL=/dev/null` in bash.
3. Run `node node_modules/vitest/vitest.mjs run tests/run-queue.test.js tests/run-failover.test.js` and report the counts.

**P322. A stop counts only what it stopped (OpenCode).** Read this brief only. Use no subagents. Run every command in the foreground. Commit each step as you finish it, and stop starting new work at minute 22. Files: scripts/run-lane.mjs (only `stopLeftovers`), tests/run-lane-stop.test.js, docs/agents/CHANGELOG.md.

P313's `stopLeftovers` adds a leftover to `stopped` when its pid is already gone, and when its pid now belongs to another process (`stale: PID was not this run`).

1. A gone leftover prints `leftover: PID had already ended` and a reused pid prints `stale: PID was not this run`; neither counts as stopped. `Nothing was running for the LANE lane.` still prints when nothing was stopped, found or failed.
2. Tests, each failing before your change: a gone leftover and a reused pid each leave `stopped` at 0 and print their line.
3. Run `node node_modules/vitest/vitest.mjs run tests/run-lane-stop.test.js` and report the counts.

**P323. The queue dispatch test waits for its run without a fixed ten seconds (OpenCode).** Read this brief only. Use no subagents. Run every command in the foreground. Never weaken an assertion. Commit each step as you finish it, and stop starting new work at minute 28. Files: tests/project-dispatch.test.js, tests/helpers/bridge.js, docs/agents/architecture/LIMITS.md, docs/agents/CHANGELOG.md.

On 2026-11-15 `tests/project-dispatch.test.js > the runs route with a queue > writes the queue file and starts run-lane with --queue` failed once with `Timed out waiting for the run to end.` (`waitFor` in `tests/helpers/bridge.js`) while seven lanes ran on the machine, and passed on a rerun.

1. Find what the test waits for and why it can take over ten seconds under load: read the fake runner it starts and the route's end path. Report the cause in one paragraph.
2. Make the wait end on the event the test needs (the run's end notice or record) rather than on a short fixed limit. When a limit stays, it is the file's other run waits' limit, never shorter.
3. Run the file five times in a row with `node node_modules/vitest/vitest.mjs run tests/project-dispatch.test.js` and report each count. Add one line to the test-flake limit in LIMITS.md.

**P324. Review the fixes from review 34 (OpenCode).** Read this brief only. Change no code. Use no subagents. Run every command in the foreground. Commit only your report, and stop at minute 32. Files: docs/agents/AUDIT-2026-11-REVIEW-35.md.

Let BASE be the commit that added `docs/agents/AUDIT-2026-11-REVIEW-34.md` (`git log --format=%h --diff-filter=A -1 -- docs/agents/AUDIT-2026-11-REVIEW-34.md`). Review `git diff BASE..HEAD`. Check that each review 34 finding is fixed: R34-1 by P313, R34-2 and R34-5 by P318, R34-3 by P316, R34-6 by P317, R34-7 and R34-8 by P314, R34-9 by P315, the doc rows by P319, and R34-4 recorded in LIMITS.md. For each fix, name the test that proves it and say whether that test would still pass with the fix undone (read the code path; do not edit files to check). Look also for a key or home path reaching a record or response, a stop that ends another run, and a merge of the play worktree that loses a local file. Write the file as a table ordered by severity: finding, `file:line`, a concrete failure, the smallest fix, and whether it blocks a push. End with one line per review 34 finding: fixed, partly fixed, or open.

**P325. Map what depends on OpenCode before it leaves the fleet (OpenCode).** Read this brief only. Change no code. Use no subagents. Run every command in the foreground. Commit only your report, and stop at minute 32. Files: docs/agents/OPENCODE-RETIREMENT.md.

The owner is removing OpenCode from the fleet after 2026-11-17. The lanes that stay are `codex` (GPT-6.1 Terra high), `agy` and `agy2` (Gemini 4 Hydrogen XHigh), the Claude Code lanes, and `native` and `native2` (MachineRoom's own harness on OpenRouter, DeepSeek V4.1 Flash only).

1. Search the repository (`git grep -n -i opencode`, leaving out `docs/agents/TASKS.md`, `docs/agents/CHANGELOG.md`, the audit files and `docs/agents/history/`) and sort every hit into three tables: fleet config (`docs/agents/lanes.json`, `docs/agents/policy.json`, `fallback` entries, lane notes), orchestrator rules and docs that tell the orchestrator to use OpenCode lanes (`ORCHESTRATOR.md`, `HOUSE-RULES.md`, `PLAN.md` and others), and product code (the OpenCode harness, the sessions source, the orchestrator's OpenCode support, defaults such as `DEFAULT_OPENCODE_MODEL`, the assistant router).
2. For each fleet and docs row, give `file:line`, what it does today, and a proposed replacement from the lanes that stay. For each product code row, say what a user who still runs OpenCode would lose if it were removed, and mark it `keep` unless it only serves this fleet.
3. End with the smallest ordered list of changes that retires OpenCode from the fleet without removing OpenCode support from the product.

**P326. Can a Codex orchestrator reach the bridge? (Codex).** Read this brief only. Change no code. Do not commit: the runner commits your file. Stop at minute 35. Files: docs/agents/CODEX-ORCHESTRATOR.md.

The owner wants a family tree with Codex (GPT-6.1 Terra high) as a sub orchestrator over the two AGY lanes. Since P311 a Codex orchestrator turn starts the Codex app's program. An orchestrator does its work by calling the bridge over HTTP on 127.0.0.1 with its token (`X-MachineRoom-Orchestrator`): it starts lane runs, reads their reports and replies to its parent.

1. Trace one Codex orchestrator turn: `server/orchestrator.js` (the branch for harnesses other than claude and opencode, `binFor`, the instruction and token it builds), `src/harnesses/codex.js` (`command`), `src/model/hierarchy.js` (the sub's instructions) and `server/orchestrators.js` (how a sub's token is checked). Say how the turn learns the bridge address and its token, and which of `mcpConfig`, `token`, `bridgeUrl` and `mode` the Codex command uses or drops.
2. Say whether `codex exec --sandbox workspace-write` lets a shell command in the turn reach `http://127.0.0.1:PORT` on this machine. Name the Codex setting that governs it, from the Codex program's own help (`codex exec --help`, `codex --help`) or its config docs under `%USERPROFILE%\.codex` if present. Do not change any Codex config. If you can run a harmless check inside your own sandbox (for example a request to a port where nothing listens, reading the error kind), report what it shows.
3. Say whether a Codex sub can do each step of its job: start a lane run, read the run's end, merge a lane branch into its sector branch (its sandbox keeps git read-only), and send its answer to its parent.
4. End with the smallest set of changes that would make a Codex sub work, keeping Codex in its sandbox, each with `file:line`, and what stays impossible.

**P327. What a live ladder on Lowbeam needs (AGY).** Read this brief only. Change no code. Commit only your report, and stop at minute 32. Run every command in the foreground. Files: docs/agents/LADDER-READINESS.md.

The ladder (`docs/agents/HIERARCHY.md`, O1 to O8) is built and tested, and the demo replay shows it, but no saved orchestrator state has ever held a sub orchestrator. The owner wants to try it on Lowbeam (`C:\GitHub\Lowbeam`), where the rules are: lanes work in `.worktrees\LANE` on task branches, `main` stays checked out and clean, and the owner merges through Reviews, which fast-forwards `main`. The flat setup (every lane reports to the main orchestrator) is the fallback.

1. Read `src/model/hierarchy.js`, `server/orchestrators.js`, `server/orchestrator.js` (where a sub's turn runs: its `cwd` and the folder it may change), `server/runs.js` (the sector gate and the scope check) and `server/reviews.js` (which branches Reviews lists and merges).
2. Answer, each with `file:line`: where a sub orchestrator's turn runs and whether it can change Lowbeam's main checkout; where the sector branch `machineroom/sector-ID` is made and by whom; whether Reviews can show or merge a sector branch; what happens to a lane branch a sub merged into its sector branch; whether two subs can start lanes that change the same file; and what the owner sees in the room for each step.
3. List each gap that would break Lowbeam's rules or lose work, ordered by severity, with the smallest fix and whether it needs the owner's yes as a feature.
4. End with a short go or no-go for a supervised trial with one sub orchestrator and two lanes, and the steps the owner would take.

Review 35 (`docs/agents/AUDIT-2026-11-REVIEW-35.md`) fixes, P328 to P330. OpenCode stays in the fleet (the owner, 2026-11-15).

**P328. A brief run's commit text is masked on disk, and a refused backup keeps the failed head (OpenCode).** Read findings R35-1 and R35-2 in `docs/agents/AUDIT-2026-11-REVIEW-35.md` and this brief only. Use no subagents. Run every command in the foreground. Commit each step as you finish it, and stop starting new work at minute 28. Files: scripts/run-lane.mjs (only where a brief run builds `commits`, and `writeProjectRecord`), tests/run-lane.test.js, tests/run-failover.test.js, docs/agents/CHANGELOG.md.

1. R35-1: a brief run's `commits` go through `maskProfilePaths(maskKeys(line).text)`, as `projectRunGit` does, before the record is written.
2. R35-2: when `keepGit` is true, `writeProjectRecord` keeps the failed run's captured head too and does not read HEAD from the folder.
3. Tests, each failing before your change: a brief run whose lane commit subject holds a fake key (built from parts) and a `C:\Users\NAME\notes.txt` path is masked in `runs.jsonl`; a backup that commits and then throws leaves the failed record's head on the failed run's commit. Set GIT_AUTHOR_* and GIT_COMMITTER_* in every git call the tests make, and run them once with `GIT_CONFIG_GLOBAL=/dev/null` in bash.
4. Run `node node_modules/vitest/vitest.mjs run tests/run-lane.test.js tests/run-failover.test.js` and report the counts.

**P329. The room lists GPT-6.1 Terra for Codex (OpenCode).** Read finding R35-3 in `docs/agents/AUDIT-2026-11-REVIEW-35.md` and this brief only. Use no subagents. Run every command in the foreground. Commit each step as you finish it, and stop starting new work at minute 20. Files: server/model-list.js, tests/agents-config.test.js, docs/agents/CHANGELOG.md.

1. Add `{ id: 'gpt-6.1-terra', label: 'GPT-6.1 Terra', harness: 'codex', ... }` beside Sol, with the tier and `free` value Sol has.
2. Update the codex list expectation in `tests/agents-config.test.js` and add one assertion that `modelAllowed('codex', 'gpt-6.1-terra')` is true.
3. Run `node node_modules/vitest/vitest.mjs run tests/agents-config.test.js` and report the counts.

**P330. A stop keeps the lock when its process list misses the run (OpenCode).** Read finding R35-4 in `docs/agents/AUDIT-2026-11-REVIEW-35.md` and this brief only. Use no subagents. Run every command in the foreground. Commit each step as you finish it, and stop starting new work at minute 25. Files: scripts/run-lane.mjs (only `stopLane`), tests/run-lane-stop.test.js, docs/agents/CHANGELOG.md.

1. When the snapshot is not empty but holds neither the lock holder's run pid nor its child pid while that pid is alive, the stop counts it as failed, prints `could not see the LANE run in the process list, so the lock stays`, and keeps the lock.
2. Test, failing before your change: a non-empty snapshot without the holder's pids, with the pid alive, leaves the lock in place and exits non-zero.
3. Run `node node_modules/vitest/vitest.mjs run tests/run-lane-stop.test.js` and report the counts.

The free hierarchy, P331 to P334. The owner said yes on 2026-11-15. The goal: the owner's harnesses (Claude, Codex, AGY, OpenCode, native) work together with free choice of who coordinates whom, they can message each other, and the owner watches their file access in the room. Worktrees stay a workflow choice, and the permission modes guard against an agent going outside the project. A probe on 2026-11-15 showed a `codex exec --sandbox workspace-write` turn reaches a server on 127.0.0.1, so a Codex orchestrator can call the bridge; its sandbox keeps git read-only.

**P331. Any harness can be a sub orchestrator (AGY).** Read this brief only. Commit each step as you finish it, and stop starting new work at minute 32. Run every command in the foreground. Change no engine file and no styles. Files: src/ui/ladderForm.js, src/ui/FamilyTree.jsx, src/ui/FamilyTeam.jsx (only the sub form's harness choice), server/lanes-source.js (only `subOrchestratorAgent`), server/orchestrators.js (only the ladder save path), tests/ladder-form.test.js, tests/family-ladder-ui.test.js, tests/orchestrators.test.js, tests/lanes-source.test.js, docs/agents/HIERARCHY.md, docs/agents/architecture/ROOM.md, docs/agents/CHANGELOG.md.

Today `subFromForm` keeps only `claude` or `opencode` (`src/ui/ladderForm.js`), and `subOrchestratorAgent` shows every other sub as `claude` (`server/lanes-source.js`).

1. The sub form offers every harness the room can start (the harnesses the orchestrators route already lists as available, `activeHarnesses` in `server/orchestrators.js`), and `subFromForm` keeps any of them. An unknown harness falls back to `claude` as before.
2. `subOrchestratorAgent` uses the sub's own harness and model, so a `codex`, `agy` or `machineroom` sub shows with its own shape and parser.
3. Saving a ladder refuses a sub whose harness has no program on this machine, with `harnessUnavailableProblem` from `server/agents-config.js`.
4. Tests, each failing before your change: the form keeps `codex` and `agy`; the roster names a `codex` sub as codex; a ladder save with an unavailable harness answers 400.
5. Run `node node_modules/vitest/vitest.mjs run tests/ladder-form.test.js tests/family-ladder-ui.test.js tests/orchestrators.test.js tests/lanes-source.test.js` and `npm run build`. Report the counts.

**P332. Codex orchestrators get Plan and Auto modes (Codex).** Read this brief only. Do not commit: your sandbox keeps git read-only, so leave your work uncommitted in your worktree and the runner commits it. Write every file the brief names in your worktree; your reply is not the report. Stop starting new work at minute 30. Files: src/control/modes.js, src/harnesses/codex.js, tests/modes.test.js, tests/harness-modes.test.js, tests/codex-harness.test.js, docs/agents/architecture/LIVE.md, docs/agents/CHANGELOG.md.

1. `modesFor('codex')` lists `plan` and `auto`, and its default is `auto`. There is no `bypass` for Codex: it keeps its sandbox.
2. `codexHarness.command` reads `mode`: `plan` runs `--sandbox read-only`; every other mode runs `--sandbox workspace-write` as today. Lane runs, which pass no mode, are unchanged.
3. LIVE.md: one sentence that a Codex orchestrator reaches the bridge from its `workspace-write` sandbox (probe of 2026-11-15) and cannot write git, so it coordinates and its lanes or the owner merge.
4. Tests, each failing before your change: the codex mode list; `plan` gives `read-only`; no mode gives `workspace-write`.
5. Run `node node_modules/vitest/vitest.mjs run tests/modes.test.js tests/harness-modes.test.js tests/codex-harness.test.js` and report the counts.

**P333. Orchestrators message each other freely (AGY, Gemini 4 Argon).** Read this brief only. Commit each step as you finish it, and stop starting new work at minute 35. Run every command in the foreground. Files: server/orchestrators.js (only `message` and the sub's reply path), src/model/hierarchy.js (only the sub's instruction lines), docs/agents/ORCHESTRATOR-AGENT.md, docs/agents/HIERARCHY.md (only "Who talks to whom"), tests/orchestrators.test.js, tests/hierarchy.test.js, docs/agents/architecture/LIVE.md, docs/agents/CHANGELOG.md.

Today only the main orchestrator's token may send a message (`MAIN_MESSAGE_PROBLEM`), and a sub's answer goes only to the main orchestrator.

1. `POST /api/orchestrator/messages` with any orchestrator's token may send to any other orchestrator by id (`orchestrator` or a sub id), never to itself. The recipient receives it with `deliver`, from `orchestrator` or `sub:ID`, it wakes as a room message does, and the Team view records it with `announce(from, to, 'message', text)`. The owner, with an Origin, may still send to anyone.
2. Loop guard: each sender may send at most 6 such messages in any 10 minutes; the seventh answers 429 with `Too many messages from this orchestrator. Wait, or ask the owner.` Each recipient's existing wake budget still applies.
3. The sub's instruction lines and ORCHESTRATOR-AGENT.md say how to message any orchestrator: `POST {{BRIDGE}}/api/orchestrator/messages` with `{ "to": "ID", "text": "..." }` and the `X-MachineRoom-Orchestrator` header. A sub's turn answer still goes to its parent.
4. HIERARCHY.md's table: subs can message any orchestrator; lanes still send one report when their run ends.
5. Tests, each failing before your change: a sub's token sends to another sub and to the main orchestrator; a sub cannot message itself (400); the seventh message in ten minutes answers 429; a message with no token and no Origin is refused.
6. Run `node node_modules/vitest/vitest.mjs run tests/orchestrators.test.js tests/hierarchy.test.js` and report the counts.

**P334. A ladder test from start to report, on harnesses other than Claude (AGY).** Read this brief only. Change no product code: only tests. Commit each step as you finish it, and stop starting new work at minute 32. Run every command in the foreground. Files: tests/ladder-e2e.test.js, docs/agents/CHANGELOG.md.

1. Read `tests/orchestrator-e2e.test.js` and `tests/orchestrators.test.js` for how they build orchestrators with fake programs. Write `tests/ladder-e2e.test.js`: a main orchestrator and one sub on the `codex` harness with two lanes in its sector, using fake programs that print the harness's JSON lines. The sub's turn starts a lane run through the runs route with its token; the run's end wakes the sub; the sub's answer reaches the main orchestrator as `sub:ID`; and a lane outside the sector is refused with 403.
2. If a step fails because of product code, keep that test as `it.fails` with a one-line comment naming the file and line, and report it. Do not change product code.
3. Run `node node_modules/vitest/vitest.mjs run tests/ladder-e2e.test.js` and report the counts.

A lane messages its coordinator mid-run, P335 to P337. The owner said yes on 2026-11-15, as the next step of the free hierarchy (P331 to P334). Today a lane sends one report when its run ends. After these briefs, a lane run that the bridge started may send short messages to the orchestrator that started it (or to any orchestrator) while it works. It still receives nothing mid-run: a run is one non-interactive call, and the coordinator answers by starting a follow-up run. The contract the three briefs share:

- The bridge gives each run it starts a ticket: 32 random hex characters, made when the run starts and dead when it ends.
- The runner gets it in the env var `MACHINEROOM_LANE_TICKET`, with `MACHINEROOM_BRIDGE` set to the bridge address. The name avoids KEY, SECRET and TOKEN because Codex drops env vars with those words from its shell.
- A lane sends `POST BRIDGE/api/orchestrator/messages` with the header `X-MachineRoom-Lane: TICKET` and `{ "text": "..." }`, and optionally `"to": "ID"` for another orchestrator. With no `to`, it goes to the orchestrator that started the run (`startedBy`), else the main orchestrator.
- The recipient receives it from `lane:KEY` and wakes as for a room message.

**P335. The bridge takes a lane's message mid-run (OpenCode).** Read this brief and the contract above only. Use no subagents. Run every command in the foreground. Commit each step as you finish it, and stop starting new work at minute 32. Files: server/runs.js (only run start, run end and a ticket lookup), server/orchestrators.js (only `message`), server/index.js (only passing the lane header and the lookup), tests/orchestrators.test.js, tests/project-dispatch.test.js, docs/agents/architecture/LIVE.md, docs/agents/HIERARCHY.md (only "Who talks to whom"), docs/agents/CHANGELOG.md.

1. When the runs route starts a run, it makes the ticket, keeps `{ lane, startedBy, startedAt }` for it while the run is in `running`, passes `MACHINEROOM_LANE_TICKET` and `MACHINEROOM_BRIDGE` in the runner's env, and drops the ticket when the run ends or is stopped. The ticket never goes into a record, a log line the bridge writes, a response or a notice.
2. `message` accepts the `X-MachineRoom-Lane` header when there is no Origin and no orchestrator token. An unknown or ended ticket answers 403 `That lane run has ended or is not known.` A known one delivers the text from `lane:KEY` to `to` (any orchestrator) or the run's `startedBy`, else `orchestrator`, records it in the Team view with `announce('lane:KEY' as the lane's agent key, recipient, 'message', text)`, and answers 202. Each ticket may send at most 4 messages; the fifth answers 429 `This lane run has sent its 4 messages.` Text is 1 to the existing message limit.
3. Tests, each failing before your change: a started run's runner env has both variables; a message with its ticket reaches `startedBy` from `lane:KEY`; `to` reaches another orchestrator; after the run ends the ticket answers 403; the fifth message answers 429; the ticket appears in no runs response.
4. LIVE.md and HIERARCHY.md say what a lane can send and that it receives nothing mid-run.
5. Run `node node_modules/vitest/vitest.mjs run tests/orchestrators.test.js tests/project-dispatch.test.js` and report the counts.

**P336. The runner hands a lane its ticket and tells it how to message (OpenCode).** Read this brief and the contract above only. Use no subagents. Run every command in the foreground. Commit each step as you finish it, and stop starting new work at minute 28. Files: src/briefs/run.js (only `LANE_ENV_NAMES` and `unattendedPrompt` or the lane prompt builder), src/briefs/briefs.js (only if the lane prompt is built there), scripts/run-lane.mjs (only where it builds the harness env and prompt), tests/run-lane.test.js, tests/briefs.test.js, docs/agents/architecture/COMMANDS.md, docs/agents/CHANGELOG.md.

1. `MACHINEROOM_LANE_TICKET` and `MACHINEROOM_BRIDGE` pass through `childEnvironment` to the harness when the runner has them.
2. When both are set, the lane's prompt gains one paragraph: `You may send your coordinator a short message while you work, for a question or a blocker: POST $MACHINEROOM_BRIDGE/api/orchestrator/messages with the header X-MachineRoom-Lane: $MACHINEROOM_LANE_TICKET and the JSON body {"text": "..."}. Read both values from your environment; never print the ticket. You get no reply during this run, so keep working on what you can, and send at most 4.` With either missing, the prompt is unchanged.
3. Tests, each failing before your change: the harness env carries both variables when the runner has them and neither when it has not; the prompt holds the paragraph only when both are set; the prompt never holds the ticket's value.
4. Run `node node_modules/vitest/vitest.mjs run tests/run-lane.test.js tests/briefs.test.js` and report the counts.

**P337. The chat shows a lane's message by the lane's name (OpenCode).** Read this brief and the contract above only. Use no subagents. Run every command in the foreground. Change no engine file and no styles. Commit each step as you finish it, and stop starting new work at minute 22. Files: src/ui/orchestratorChat.js, src/ui/sidebar.js, tests/orchestrator-chat.test.js, tests/sidebar.test.js, docs/agents/architecture/ROOM.md, docs/agents/CHANGELOG.md.

1. A message whose `from` is `lane:KEY` shows with the lane's label (from the lanes the chat already has, else KEY), the way `sub:ID` shows the sub's label today, in the chat and in the sidebar's conversation preview.
2. Tests, each failing before your change: a `lane:opencode` message shows `OpenCode`; an unknown lane key shows the key.
3. Run `node node_modules/vitest/vitest.mjs run tests/orchestrator-chat.test.js tests/sidebar.test.js` and report the counts.

The modes reach lane runs, and the room shows a touch outside the project, P338 to P340. The owner's goal (2026-11-15) names the permission modes as the guard against an agent that leaves the project, and wants to see file access in the room. Two parts are missing: a lane run takes no mode (a Claude lane always runs with every permission, an OpenCode lane always with `--auto`), and a path outside the project draws nothing. These three briefs touch different files from P335 to P337 and run beside them.

**P338. A lane run takes a permission mode (Codex, GPT-6.1 Terra).** Read this brief only. Your sandbox keeps git read-only: write the files in your worktree and the runner commits them. Run every command in the foreground. Files: src/harnesses/claude.js, src/harnesses/opencode.js (only `command`), src/briefs/run.js and scripts/run-lane.mjs (any part this brief needs: the argument parser, the usage text, the check that refuses a bad mode before a folder, lock or worktree is made, the place a lane's command is built, the run record and `runListLine`; nothing else in them), tests/lane-mode.test.js (new; add no test to another file), docs/agents/architecture/COMMANDS.md, docs/agents/CHANGELOG.md.

1. `npm run run-lane -- LANE ID --mode M` passes `mode` to the harness's `command`. A lane entry may also name `"mode"` in its `cli`; the flag wins. With no mode, every command line is exactly what it is today: prove this with a test per harness.
2. The mode must be in `LISTS` of `src/control/modes.js` for the lane's harness. Another value is refused before anything starts: `The MODE mode is not one LANE's harness has. It has: plan, edits, auto.`
3. Claude lanes: `plan` gives `--permission-mode plan`, `edits` gives `--permission-mode acceptEdits`, `auto` gives `--permission-mode auto`, each in place of the flag that skips permissions; `bypass` and no mode keep that flag. `ask` is refused for a lane: `A lane run has nobody to ask, so the ask mode is for orchestrators only.`
4. OpenCode lanes: map `plan` and `edits` the way `server/orchestrator.js` maps a turn's mode for OpenCode (search `needsOpencodeConfig`). If that needs a config file the runner cannot give a lane in this brief, refuse that mode for OpenCode lanes with a plain sentence and say so in COMMANDS.md. `auto` and no mode keep `--auto`.
5. Codex and AGY lanes: their `command` already reads `mode`; only pass it.
6. The run record gains `mode` when one was given, and `--list` shows it after the model.
7. Tests in `tests/lane-mode.test.js`, each failing before your change: the command line per harness and mode; the refusals; the record field; no mode changes nothing.
8. Run `node node_modules/vitest/vitest.mjs run tests/lane-mode.test.js tests/run-lane.test.js tests/harnesses.test.js` and report the counts. Do not run the full suite.

**P339. The room shows a touch outside the project (AGY, Hydrogen).** Read this brief only. Commit each step as you finish it. Run every command in the foreground. Change no engine file and no styles. Files: src/model/pipeline.js, src/model/state.js, src/ui/inspector.js, src/ui/Inspector.jsx, tests/outside-paths.test.js (new; add no test to another file), docs/agents/architecture/ACTIVITIES.md, docs/agents/architecture/ROOM.md, docs/agents/CHANGELOG.md.

1. Find what the pipeline does today with a read, write or edit whose path is absolute and outside the project root (and outside the lane worktrees that map into it). Write the answer at the top of your report.
2. Such an activity keeps `outside: true` and `outsidePath`: the path with the home folder masked by `maskProfilePaths` of `src/briefs/run.js` (or the same masking if that file cannot load in the browser; do not import a Node module into `src/model`). It draws no card and no tunnel, as today. A path inside the project is unchanged: no new field.
3. The state keeps, per agent, the last 20 distinct outside paths with the kind of the newest touch (read, write, edit) and a count. A seek rebuilds it like every other state.
4. The Inspector of an agent with at least one shows a section `Outside the project` with the count and the paths, newest first, each with its kind. With none, the Inspector is exactly what it is today. Use the classes the Inspector's other lists use; add no style.
5. Tests in the new file, each failing before your change: a write to `C:\Windows\x.txt` and to `/etc/hosts` is marked and listed; a path in the project and a path in a lane worktree are not; the home folder is masked; a seek back drops the paths after that time; the list stops at 20.
6. ACTIVITIES.md gains the two fields, and ROOM.md the Inspector section.
7. Run `node node_modules/vitest/vitest.mjs run tests/outside-paths.test.js tests/pipeline.test.js tests/state.test.js tests/inspector.test.js` and report the counts. Do not run the full suite.

**P340. The owner's test tree, as a test and a runbook (AGY, Hydrogen).** Read this brief only. Commit each step as you finish it. Run every command in the foreground. Change no file in `src`, `server` or `scripts`. Files: tests/owner-tree.test.js (new), docs/agents/FREE-HIERARCHY.md (new), docs/agents/architecture/DOCUMENTS.md (one line for the new doc), docs/agents/CHANGELOG.md.

The owner's test tree: the main orchestrator is Claude (Opus 5.5 high). Under it, one sub orchestrator on Codex (GPT-6.1 Terra high) with two AGY lanes (Hydrogen XHigh), and one sub orchestrator on the native harness (`machineroom`, GLM 5.3 Flash) with three OpenCode lanes. The simple form: no subs, every lane reports to the main.

1. `tests/owner-tree.test.js`, built the way `tests/ladder-e2e.test.js` builds its rig (read it first; reuse its helpers, and pass `harnessAvailable` so the test does not need the real programs): save this exact tree through the ladder route, then prove with fake harness programs that the Codex sub and the native sub each take a turn, each sub starts a run on one of its own lanes, a sub is refused a lane of the other sub, the two subs message each other, and each lane's end report reaches its own sub. Then save the simple form and prove a lane's report reaches the main. If a step cannot pass on main as it is, keep the test with `it.fails` and say why in your report: do not change source.
2. `docs/agents/FREE-HIERARCHY.md`, under 120 lines, in plain words: what the owner's goal is (any harness coordinates any other, they message each other, the owner watches file access, worktrees are a choice, modes guard the edges); for each part, what works today and the brief that made it, read from the code and `HIERARCHY.md`, not from memory; what does not work yet (a lane receives nothing mid-run; lane modes are P338; a touch outside the project is P339); and a step-by-step runbook for the owner to build the test tree in the room on a project of their own and run a first supervised ladder: which screen, which button, which harness and model per row, which mode to start with (Plan first, then Auto), what to watch in the room and how to stop everything. Name each screen and button as the code names it (`src/ui/FamilyTree.jsx`, `src/ui/ladderForm.js`).
3. Run `node node_modules/vitest/vitest.mjs run tests/owner-tree.test.js tests/ladder-e2e.test.js tests/briefs.test.js` and report the counts. Do not run the full suite.

A lane reads its replies mid-run, P341 to P343. P335 to P337 let a lane send. A run is still one non-interactive call, so nothing can be pushed into it, but a lane can ask: the bridge keeps an inbox per running ticket and the lane reads it when it chooses. That closes the loop for the owner's goal: orchestrators and lanes of any harness message each other while they work. The contract, on top of the P335 contract:

- Anyone who may send (an orchestrator with its token, a lane with its ticket) may name `"to": "lane:KEY"`. The text goes to the inbox of that lane's running bridge-started run. With no such run the answer is 409 `The lane KEY has no run that can read a message now.` A lane's send to a lane counts toward its 4.
- A lane reads `GET BRIDGE/api/orchestrator/messages` with the header `X-MachineRoom-Lane: TICKET`. The answer is `{ "messages": [{ "from": "orchestrator" | "sub:ID" | "lane:KEY", "text": "...", "at": "ISO time" }] }`, every message for this run, oldest first. An inbox keeps the newest 20. An unknown or ended ticket answers 403 as in P335.
- The inbox dies with the ticket. Nothing of it goes into a record or a log the bridge writes.

**P341. The bridge keeps an inbox for a running lane (OpenCode).** Read this brief, the contract above and the P335 contract only. Use no subagents. Run every command in the foreground. Commit each step as you finish it, and stop starting new work at minute 30. Files: server/runs.js (only the ticket registry P335 added), server/orchestrators.js (only `message` and the GET beside it), server/index.js (only if the GET needs passing), tests/lane-inbox.test.js (new; add no test to another file), docs/agents/architecture/LIVE.md, docs/agents/HIERARCHY.md (only "Who talks to whom"), docs/agents/CHANGELOG.md.

1. The ticket registry gains the inbox and a lookup from a lane key to its running tickets.
2. `message` takes `to: "lane:KEY"` from an orchestrator token or a lane ticket, as the contract says, announces it in the Team view like every other message, and answers 202. The sender's caps stay: 6 per 10 minutes for an orchestrator, 4 per run for a lane. A lane may not message itself.
3. The GET answers a ticket with its inbox and nothing else. It needs no Origin and refuses a request that has one, like the POST's ticket path. An orchestrator token on the GET is refused with 403.
4. Tests in the new file, each failing before your change: an orchestrator's message reaches a running lane's inbox; a sub's does, as `sub:ID`; a lane's does, as `lane:KEY`, and counts toward its 4; no running run answers 409; the GET with another run's ticket never shows this run's messages; an ended ticket answers 403; the inbox stops at 20; no runs response holds a message.
5. LIVE.md and the HIERARCHY.md table say what a lane can now read and from whom.
6. Run `node node_modules/vitest/vitest.mjs run tests/lane-inbox.test.js tests/orchestrators.test.js` and report the counts. Do not run the full suite.

**P342. A lane and its coordinators are told how replies work (OpenCode).** Read this brief and the two contracts above only. Use no subagents. Run every command in the foreground. Commit each step as you finish it, and stop starting new work at minute 24. Files: src/briefs/run.js (only `laneMessageNote`), src/model/hierarchy.js (only the instruction lines a sub gets), server/orchestrator.js (only the instruction text the main orchestrator gets about lanes and messages; if there is none, add nothing there and say so), tests/lane-replies.test.js (new; add no test to another file), tests/run-lane.test.js (only the tests that quote the P336 paragraph), docs/agents/CHANGELOG.md.

1. The lane's paragraph (P336) changes its last sentence. In place of `You get no reply during this run, so keep working on what you can, and send at most 4.` it says: `Send at most 4. A reply does not interrupt you: read your replies with GET on the same address and header, which answers {"messages": [{"from", "text", "at"}]}, after you ask and once more before you finish. Keep working on what you can meanwhile. To message another lane that is running, add "to": "lane:KEY".`
2. A sub's instruction lines gain one line: `A lane may message you while it runs, as lane:KEY. To answer it while it still runs, POST {{BRIDGE}}/api/orchestrator/messages with { "to": "lane:KEY", "text": "..." }; a 409 means its run has ended, so start a follow-up run.` The main orchestrator gets the same line where its instructions are built, with the address filled the way its other lines fill it.
3. Tests, each failing before your change: the paragraph holds the new sentences only when both variables are set and never holds the ticket's value; a sub's lines hold the new line with `{{BRIDGE}}` in place.
4. Run `node node_modules/vitest/vitest.mjs run tests/lane-replies.test.js tests/run-lane.test.js tests/hierarchy.test.js` and report the counts. Do not run the full suite.

**P343. The bridge starts a lane run in a mode (OpenCode).** Read this brief only. It builds on P338 (`npm run run-lane -- LANE ID --mode M`). Use no subagents. Run every command in the foreground. Change no file in `src/ui`. Commit each step as you finish it, and stop starting new work at minute 24. Files: server/runs.js (only where a start request is checked and the runner's arguments are built), src/control/client.js and src/control/mock.js (only the run start), tests/run-mode-route.test.js (new; add no test to another file), docs/agents/architecture/LIVE.md, docs/agents/CHANGELOG.md.

1. A run start request may name `mode`. The bridge checks it against `LISTS` of `src/control/modes.js` for the lane's harness and refuses another value, and `ask` for a lane, with 400 and the sentences P338 uses (read them in `src/briefs/run.js` after P338 is merged; if P338 is not on main yet, use `The MODE mode is not one LANE's harness has. It has: LIST.` and `A lane run has nobody to ask, so the ask mode is for orchestrators only.`). A good mode adds `--mode M` to the runner's arguments. No mode adds nothing.
2. The control client's run start passes `mode` when given, and the mock accepts it.
3. Tests in the new file, each failing before your change: a start with `plan` runs the runner with `--mode plan`; a mode outside the harness's list answers 400 and starts nothing; `ask` answers 400; no mode gives today's arguments.
4. LIVE.md gains the field.
5. Run `node node_modules/vitest/vitest.mjs run tests/run-mode-route.test.js tests/project-dispatch.test.js tests/control-contract.test.js` and report the counts. Do not run the full suite.

**P344. Lane modes get their tests and their docs (OpenCode).** Read this brief only. P338 is merged as code only: `laneModeProblem`, `laneWithOverrides` and `commandFor` in `src/briefs/run.js`, `runOptions` in `scripts/run-lane.mjs` and `command` in `src/harnesses/claude.js`. Use no subagents. Run every command in the foreground. Commit each step as you finish it, and stop starting new work at minute 24. Files: tests/lane-mode.test.js (new; add no test to another file), docs/agents/architecture/COMMANDS.md, src/briefs/run.js and scripts/run-lane.mjs and server/agents-config.js (only to fix a defect a test of yours finds; say each one in your report).

1. Read the P338 code first and write what it does per harness at the top of your report.
2. Tests in the new file: with no mode, the command line of a Claude, OpenCode, Codex and AGY lane is exactly what `commandFor` gave before P338 (write the expected arguments out in full); a Claude lane gets `--permission-mode plan`, `acceptEdits` and `auto` in place of the flag that skips permissions, and keeps that flag for `bypass`; a Codex lane in `plan` gets its read-only sandbox; an AGY lane gets `--mode plan`; `ask` is refused for a lane; a mode outside the harness's list is refused and the sentence names the lane and the list; OpenCode `plan` and `edits` are refused; a harness with no list (`hermes`) refuses every mode with a sentence that reads well, so fix the sentence if the list is empty; `laneWithOverrides` lets `--mode` win over the lane's `cli.mode`; `runRecord` keeps `mode` only when given; `runListLine` shows it after the model; a lane file whose entry names `"mode"` in `cli` loads (fix `server/agents-config.js` if it drops or refuses the field).
3. Prove one refusal end to end: `node scripts/run-lane.mjs` with a lane file in a temp folder and `--mode nonsense --dry-run` exits non-zero, prints the sentence, and makes no folder, lock or worktree. Use the helpers `tests/run-lane.test.js` uses for a temp lane file.
4. COMMANDS.md: the `run-lane` line gains `--mode M`, what each harness does with it and the refusals.
5. Run `node node_modules/vitest/vitest.mjs run tests/lane-mode.test.js tests/run-lane.test.js tests/harnesses.test.js` and report the counts. Do not run the full suite.

**P345. A Codex or native orchestrator's turn uses its effort (Codex, GPT-6.1 Terra).** Read this brief only. P340 found it: the owner's tree names a Codex sub on high effort, the room saves the effort, and the turn's command drops it. Your sandbox keeps git read-only: write the files in your worktree and the runner commits them. Never run `npm install`; the worktree has no `node_modules`, so run tests as `node ../../node_modules/vitest/vitest.mjs run FILES` from your worktree. Files: server/orchestrator.js (only where a turn's command is built for a harness other than Claude and OpenCode, where a saved effort is loaded and `setEffort`), tests/orchestrator-effort.test.js (new), tests/owner-tree.test.js (only the `it.fails` test, which becomes `it`), docs/agents/architecture/LIVE.md (only the sentence on effort, if there is one), docs/agents/CHANGELOG.md.

1. A turn on a harness whose descriptor has `command` (Codex, the native `machineroom` harness, AGY and the rest) passes the orchestrator's effort as `reasoning`, the name those descriptors already read for a lane. With no effort the command is exactly what it is today.
2. The effort levels a harness accepts come from one place per harness. Codex takes low, medium, high and xhigh. For the others, read what the descriptor or its program accepts and keep today's list where you cannot tell. `setEffort` and the loader of a saved effort use the same list, so a saved effort the harness does not take is dropped on load as today.
3. This holds for a main orchestrator and for a sub.
4. Tests, each failing before your change: a Codex sub's turn command holds `model_reasoning_effort=high`; a native sub's holds `--reasoning high`; no effort leaves both commands as they were; `xhigh` is accepted for Codex and refused for OpenCode; the `it.fails` test in `tests/owner-tree.test.js` passes as a plain `it`.
5. Run `node ../../node_modules/vitest/vitest.mjs run tests/orchestrator-effort.test.js tests/owner-tree.test.js tests/orchestrator.test.js` and report the counts. If a test cannot run in your sandbox, say which and why; the files still must be written.

**P346. Touches outside the project, the small way (AGY, Hydrogen).** Read this brief only. P339 is on the branch `feat/p339-the-room-shows` and was not merged, for two reasons: it reads every log line a second time in a tracker of 250 lines that repeats each parser, and `tests/scenario-e.test.js` fails because the digests of the recorded fixtures changed. Start by merging that branch into yours: `git merge --no-edit refs/heads/feat/p339-the-room-shows`. Commit each step as you finish it. Run every command in the foreground. Change no engine file and no styles. Files: src/model/pipeline.js, src/model/parsers/common.js, the parsers in src/model/parsers that call `fileTouch`, src/model/state.js, src/ui/inspector.js, src/ui/Inspector.jsx, tests/outside-paths.test.js, docs/agents/architecture/ACTIVITIES.md, docs/agents/architecture/ROOM.md, docs/agents/CHANGELOG.md.

1. Remove the path tracker from `pipeline.js`, with its imports and constants. `pipeline.js` ends with no second reader of a run's chunks.
2. `fileTouch` in `src/model/parsers/common.js` already holds the raw path. When the path is absolute and `relativeTo` answers null, it also returns `outsidePath`: the raw path, masked. Each parser that calls `fileTouch` passes `outside: true` and `outsidePath` into the activity it builds for that call, in one shared helper if the parsers allow it. A path inside the project, a relative path and a path in a lane worktree give no new field. For the lane worktrees, use what the context already knows (`ctx.rootPath` and the agent's worktree); if a parser's context does not have the worktree, add it where the context is made.
3. Masking: do not import `src/briefs/run.js` into `src/model`. Put the home-folder masking in a small pure function under `src/model` (or move the existing one there and import it from `src/briefs/run.js`, keeping its export), with one source of truth.
4. The digests: find which fixture changed and why. A fixture that really holds a touch outside the project gets its digest in `tests/scenario-e.test.js` updated, with the fixture and the path named in your report. A digest that changed for another reason is a defect of yours: fix it.
5. `tests/outside-paths.test.js` still proves what P339 asked (marked and listed; not for project and worktree paths; masked; seek; the limit of 20) and gains one test per harness parser.
6. Run `node node_modules/vitest/vitest.mjs run tests/outside-paths.test.js tests/scenario-e.test.js tests/pipeline.test.js tests/state.test.js tests/inspector.test.js tests/parsers.test.js` and then `node node_modules/vitest/vitest.mjs related --run src/model/pipeline.js src/model/parsers/common.js src/model/state.js`, and report the counts.

**P347. Review 36: lane messages, lane modes and the effort fix (Codex, GPT-6.1 Sol).** Read this brief only. This is a review: change no source file and no test. Your sandbox keeps git read-only. Write the file `docs/agents/AUDIT-2026-11-REVIEW-36.md` in your worktree; your reply is not the report, and a review with no file is a failed run. Never run `npm install`; the worktree has no `node_modules`, so a test you want to run is `node ../../node_modules/vitest/vitest.mjs run FILE` from your worktree, and a test that cannot run in your sandbox is not a finding. Stop reading at minute 22 and write the file.

Read the merged work with `git diff bde6c710..refs/heads/main -- server src scripts tests` (P335 to P338, P340 and P345), and the four branches that are not merged yet, each with `git diff refs/heads/main...refs/heads/NAME`: `feat/p341-the-bridge-keeps` (a lane's inbox), `feat/p342-a-lane-and` (the prompt lines), `feat/p343-the-bridge-starts` (a run start names a mode) and `feat/p344-lane-modes-get` (the lane mode tests). The briefs are P335 to P345 at the end of `docs/agents/TASKS.md`.

Look for defects that matter, in this order:

1. The lane ticket (`server/runs.js`, `server/orchestrators.js`, `server/index.js`): can a page, another lane, an ended run or a request with no ticket send or read as a lane; can a ticket outlive its run (a failed start, a stop, a bridge stop, a failover to a backup lane); does the ticket or a message reach a record, a log the bridge writes, a response or a notice; can a lane wake an orchestrator more than 4 times a run; does an inbox grow without a limit.
2. Lane modes (`src/briefs/run.js`, `scripts/run-lane.mjs`, `src/harnesses/claude.js`, `server/runs.js`): a path where a mode is named and the harness still runs with every permission; a mode that passes the bridge's check and fails the runner's; a queue or failover run that drops the mode; a default that changed for a lane with no mode.
3. The effort fix (`server/orchestrator.js`): a harness that now gets a `reasoning` value it does not take; a saved effort that is lost on load.
4. Tests that would pass with their change undone.
5. A sentence in `docs/agents/HIERARCHY.md`, `architecture/LIVE.md`, `architecture/COMMANDS.md` or `FREE-HIERARCHY.md` that the code contradicts.

The file: one section per finding, numbered R36-1 on, most serious first, each with the file and line, what happens, how to see it (a request or a command) and the smallest fix. At most 12 findings. End with one line per area you read and found sound. Write only what you checked in the code; a guess is marked as a guess.

Review 36 fixes, P348 to P351. GPT-6.1 Sol read P335 to P345 (`docs/agents/AUDIT-2026-11-REVIEW-36.md`). R36-4 was fixed at the P343 merge, and R36-8 and R36-9 are doc fixes by the orchestrator. Each brief below: read the brief and its findings in the review file only, use no subagents, run every command in the foreground, put new tests in the new file named, commit each step as you finish it, stop starting new work at minute 14 and do not run the full suite.

**P348. A lane's ticket never shows in output, a log or a record (OpenCode).** Fixes R36-1. Files: server/runs.js (only where runner output becomes `lastLines` and a record's `note`), src/briefs/audit.js (the masker), src/briefs/run.js (only `createLaneLog`), tests/lane-ticket-mask.test.js (new), docs/agents/CHANGELOG.md.

1. The bridge masks the run's own ticket value in every line it keeps or sends from that run's runner: `lastLines`, the tail, a failed start's `note`. Split chunks count: a ticket cut across two chunks is still masked.
2. `maskKeys` masks the value after `X-MachineRoom-Lane:` and after `MACHINEROOM_LANE_TICKET=`, so the runner's log and every other masked text lose it.
3. Tests, each failing before your change: a fake runner that prints the header with its ticket, and one that prints the bare ticket, leave no ticket in `GET /api/control/runs`, in the run's record or in the lane log; a ticket split across two chunks is masked.
4. Run `node node_modules/vitest/vitest.mjs run tests/lane-ticket-mask.test.js tests/project-dispatch.test.js tests/audit.test.js` and report the counts.

**P349. A failover run gets no ticket of the failed lane and keeps its mode (OpenCode).** Fixes R36-2 and R36-3. Files: scripts/run-lane.mjs (only `startFailover` and the env a backup's harness gets), tests/failover-ticket-mode.test.js (new), docs/agents/architecture/COMMANDS.md (one sentence), docs/agents/CHANGELOG.md.

1. The backup lane's harness gets neither `MACHINEROOM_LANE_TICKET` nor `MACHINEROOM_BRIDGE`, and its prompt has no message paragraph: the ticket names the failed lane, so the backup does not message until the bridge can give it its own.
2. The backup runs in the failed run's effective mode, whether that came from `--mode` or from the primary lane's `cli.mode`. If the backup's harness does not have that mode, the failover is refused with the mode sentence and the backup does not start with more permission than the primary had.
3. Tests, each failing before your change: a primary with `cli.mode` `plan` and a Claude backup with no mode gives a backup command with `--permission-mode plan`; a backup whose harness lacks the mode does not start; the backup's harness env has neither variable and its prompt has no message paragraph. Build the rig the way `tests/run-failover.test.js` does.
4. Run `node node_modules/vitest/vitest.mjs run tests/failover-ticket-mode.test.js tests/run-failover.test.js tests/lane-mode.test.js` and report the counts.

**P350. An orchestrator keeps its lane messages over a restart and drops an effort its new harness lacks (OpenCode).** Fixes R36-5 and R36-6. Files: server/orchestrator.js (only `knownSender`, the pending-message loader and `setHarness`), tests/orchestrator-lane-restore.test.js (new), docs/agents/CHANGELOG.md.

1. A saved message from `lane:KEY`, in the current conversation, a saved session or `pending`, is restored when KEY is a known lane, as a bare lane key is today.
2. `setHarness` keeps the effort only when the new harness's list has it, else clears it before saving.
3. Tests, each failing before your change: a current, an archived and a pending `lane:worker` message survive a reload; Claude on `max` switched to Codex starts a turn with no `model_reasoning_effort`; an effort both harnesses take is kept.
4. Run `node node_modules/vitest/vitest.mjs run tests/orchestrator-lane-restore.test.js tests/orchestrator-effort.test.js tests/orchestrator.test.js` and report the counts.

**P351. The sidebar preview knows the lanes (OpenCode).** Fixes R36-7. Files: src/ui/Sidebar.jsx (only where it calls `previewLines`), src/ui/sidebar.js (only if the call needs it), tests/sidebar-preview-ui.test.js, docs/agents/CHANGELOG.md. Change no style.

1. The Sidebar passes the lanes it already has to `previewLines`, so a preview of a message from `lane:opencode` shows the lane's label. An unknown lane still shows its key.
2. A test through the real component, failing before your change: a preview with a `lane:KEY` message and the Sidebar's real lanes shows the label.
3. Run `node node_modules/vitest/vitest.mjs run tests/sidebar-preview-ui.test.js tests/sidebar.test.js` and report the counts.

The owner's tree, walked in the room, P352 to P354. On 2026-11-15 the orchestrator built the owner's test tree in the owner's room on Lowbeam through the page, as `FREE-HIERARCHY.md` says to. Four things went wrong on the way. None stops the tree; each makes the owner doubt the room. Not started: they wait for the owner's word.

**P352. The model list finds OpenCode and Codex the way the runner does (OpenCode).** Read this brief only. Use no subagents. Run every command in the foreground. Commit each step as you finish it. Files: server/harness-models.js (only `resolveHarnessProgram` and its callers' arguments), tests/harness-models-program.test.js (new), docs/agents/CHANGELOG.md.

1. In a room with no OpenCode lane in `lanes.json`, `GET /api/harnesses/opencode/models` answers with the error `The program for opencode was not found.`, because `resolveHarnessProgram` looks for the bare name on the PATH and npm installs only a `.cmd` shim there. `isHarnessAvailable` of `server/agents-config.js` already falls back to the descriptor's `defaultProgram`: do the same, with the same expansion of `%APPDATA%`.
2. For Codex use `codexProgramFor` of `server/agents-config.js`, as the runner and the doctor do, so the desktop app's program counts.
3. A lane made in the family tree (`agents.json`) counts as a lane with a program too, if the callers do not pass those today.
4. Tests, each failing before your change: with no lane and a fake `%APPDATA%` that holds the default OpenCode program, the program is found; with a Codex app program and no `codex` on the PATH, it is found; with neither, the error stays.
5. Run `node node_modules/vitest/vitest.mjs run tests/harness-models-program.test.js tests/harness-models.test.js` and report the counts.

**P353. A sub keeps the effort its form named, and the chat offers its harness's levels (OpenCode).** Read this brief only. Use no subagents. Run every command in the foreground. Change no style. Commit each step as you finish it. Files: server/orchestrators.js (only where a ladder save makes or updates a sub), server/orchestrator.js (only what a sub needs to take an effort at creation), src/ui/OrchestratorChat.jsx and src/ui/orchestratorChat.js (only the effort menu's levels), tests/sub-effort.test.js (new), docs/agents/CHANGELOG.md.

1. `Add sub orchestrator` with effort `high` confirms `Codex · gpt-6.1-terra · high` and then `GET /api/orchestrators` shows the sub with `effort: null`. Find where the effort is lost between the form, the ladder save and the sub's instance, and keep it. An effort the sub's harness does not take is refused at the save with the sentence `setEffort` uses.
2. The chat tab's `Effort:` menu says `No effort levels for this harness.` for a Codex orchestrator. It offers the levels the bridge lists for that harness (`efforts` in the harness list, the source `Edit <sub>` already uses), for every harness.
3. Tests, each failing before your change: a ladder save with a Codex sub on `high` gives a sub whose effort is `high` and whose first turn command holds `model_reasoning_effort=high`; an effort the harness lacks is refused; the chat's effort levels for Codex are low, medium, high and xhigh.
4. Run `node node_modules/vitest/vitest.mjs run tests/sub-effort.test.js tests/orchestrators.test.js tests/orchestrator-chat.test.js tests/owner-tree.test.js` and report the counts.

**P354. The add-agent form takes the effort it offers (OpenCode).** Read this brief only. Use no subagents. Run every command in the foreground. Change no style. Commit each step as you finish it. Files: src/ui/family.js (only `childFormProblem` and what it needs), src/ui/FamilyTree.jsx (only if the saved value needs it), tests/family.test.js, docs/agents/CHANGELOG.md.

1. The form offers `default` for the effort and `childFormProblem` refuses it with `Choose an effort for this harness.` when the harness has effort levels. `default` means the harness's own default: accept it and save the lane with no effort, as the confirmation line `Effort default` already says. A value that is neither empty nor one of the harness's levels is still refused.
2. Tests, each failing before your change: `default` passes for Claude Code, OpenCode and Codex and the saved lane has no effort; a level the harness lacks is refused; a harness with no levels still refuses a level.
3. Run `node node_modules/vitest/vitest.mjs run tests/family.test.js tests/family-ladder-ui.test.js` and report the counts.

Harnesses in Settings, and forms that offer only what is ready, P355 to P358. The owner asked on 2026-11-15: a place in the Settings drawer to add harnesses and natives, and add-lane forms that show only the harnesses that are installed and ready. Today `GET /api/harnesses` says `available` when a program is found on the PATH, which counts a shim that does not run (GitHub Copilot through VS Code's shim), and the forms always offer Direct API, even with no key. The contract the four briefs share:

- The bridge keeps `harnesses.json` in the runs folder: `{ "programs": { "KEY": "ABSOLUTE PATH" }, "off": ["KEY"] }`. A saved program is where the room looks first for that harness. A key in `off` is not offered in any form.
- `GET /api/harnesses` lists every harness in `harnessByKey` of `src/harnesses/index.js` (Hermes and ACP too), each with the fields it has today plus `ready` (true when its program was found and answered a version check, or for `machineroom` when a key or an endpoint is saved), `enabled` (false when in `off`), `program` (the path found, with the home folder masked by `maskProfilePaths`, or empty), `version` (the first line the check printed, at most 80 characters, or empty) and `reason` (empty when ready, else one sentence: `No program was found.`, `The program did not answer a version check.` or `No key or endpoint is saved.`).
- The version check runs the program with `--version`, no shell, a 5 second limit and the bridge's own env, once per harness per 10 minutes, cached in memory. `POST /api/harnesses/check` (page only, `confirmed: true`) clears the cache and checks again.
- `POST /api/harnesses/settings` (page only, `confirmed: true`) takes `{ key, program }` (an absolute path to a file that `isProgram` accepts, or `""` to clear) or `{ key, enabled }` (a boolean). Another key, a relative path, a missing file or a folder answers 400 with one sentence. It answers the new harness row.

**P355. The bridge checks each harness and keeps the owner's harness settings (Codex, GPT-6.1 Terra).** Read this brief and the contract above only. Your sandbox keeps git read-only: write the files in your worktree and the runner commits them. Never run `npm install`; run tests as `node ../../node_modules/vitest/vitest.mjs run FILES` from your worktree. Files: server/harness-settings.js (new: read, write, the version check and its cache), server/agents-config.js, server/harness-models.js, server/orchestrators.js and server/orchestrator.js (only where a new sub, a ladder save or a harness change checks that a harness exists), tests/harness-settings.test.js (new; add no test to another file except to keep an existing one passing), docs/agents/architecture/LIVE.md, docs/agents/CHANGELOG.md.

1. `harness-settings.js` holds the file, the check and the cache as the contract says. A file that does not parse reads as empty, and a write is atomic, as `server/endpoints.js` writes its file.
2. `isHarnessAvailable` and `resolveHarnessProgram` look at a saved program first. A lane made in the family tree (`/api/lanes/create`) takes the saved program as its `bin` when there is one.
3. `GET /api/harnesses` and the two POST routes do what the contract says. Only the two POST routes refuse a request with no Origin, as `/api/lanes/create` does; `GET /api/harnesses` stays open to the page as it is today. A first run stopped here on 2026-11-15 and left commit `470e575e` on the branch `feat/p355-first-run`: read it with `git show 470e575e` and carry its files into your worktree as the start of your work (your git is read-only, so write the files; do not merge), and finish the tests step 5 lists that it does not have yet (the masked home folder, the 10 minute cache, Direct API ready by an endpoint, the sub refusal) and the docs.
4. A new lane, a new sub, a ladder save or an orchestrator's harness change that names a harness in `off` is refused with `That harness is turned off in Settings.` A lane or sub that already uses it keeps working.
5. Tests, each failing before your change: a fake program that prints a version is ready and shows its version; one that exits 1, or sleeps past the limit, is not ready with its reason; the check runs once in 10 minutes and again after `POST /api/harnesses/check`; a saved program is found when the PATH has none; a relative path, a folder and a missing file are refused; `off` gives `enabled: false` and refuses a new lane; `machineroom` is ready only with a key or an endpoint; the home folder is masked in `program`. Fake programs are `.mjs` files run by node, as other tests in `tests/` make them.
6. Run `node ../../node_modules/vitest/vitest.mjs run tests/harness-settings.test.js tests/agents-config.test.js tests/harness-models.test.js tests/harness-models-program.test.js` and report the counts. If a test cannot run in your sandbox, say which and why; the files must still be written.

**P356. Settings has a Harnesses section (AGY, Hydrogen).** Read this brief and the contract above only. Write against the contract; P355 builds the bridge side at the same time, so use the mock client in tests. Commit each step as you finish it. Run every command in the foreground. Add no style: use the classes `src/ui/LanesSettings.jsx` and `src/ui/EndpointsPanel.jsx` use. Files: src/ui/HarnessesSettings.jsx (new), src/ui/harnessesSettings.js (new, pure helpers), src/ui/Settings.jsx (one line: the section goes before `EndpointsPanel`), src/control/client.js and src/control/mock.js (only `harnesses`, `checkHarnesses` and `harnessSettings`), tests/harnesses-settings.test.js (new), docs/agents/architecture/ROOM.md, docs/agents/CHANGELOG.md.

1. The section `Harnesses` lists every harness the bridge returns, one row each: its name; its state word, `Ready` in `#2aff80`, `Not ready` in `#ff2a2a` with the reason under it, or `Off` in white at half opacity; the version and the program path when known; a switch `Offer in forms`; and `Program`, a text field with `Save` and `Clear`. Saving a program or turning a harness off asks first in the room's confirm style, as `LanesSettings` does.
2. One button `Check again` at the top runs `POST /api/harnesses/check` and redraws the rows.
3. The Direct API row (`machineroom`) is the native one: in place of `Program` it says how many keys and endpoints are saved and that they are added in `Direct API` below. Nothing else in `EndpointsPanel` changes.
4. A refusal from the bridge shows its sentence under the row, in red. With no bridge, the section says `Harnesses are listed when the room runs live.`
5. The mock client answers the three calls with sample rows: Claude Code, OpenCode and AGY ready, Codex not ready, GitHub Copilot off, Direct API with no key.
6. Tests, each failing before your change: the rows and their state words from the mock; `Offer in forms` sends `{ key, enabled: false }` after the confirm; `Save` sends the program; a refusal shows; the Direct API row has no program field.
7. Check it by eye in a replay at 1280 by 800 (`npm run dev`, open Settings): every row fits the drawer, nothing overflows, and the colours are the room's. Say what you saw.
8. Run `node node_modules/vitest/vitest.mjs run tests/harnesses-settings.test.js tests/settings.test.js tests/control-contract.test.js` and report the counts.

**P357. Every harness picker offers only what is ready (AGY, Hydrogen).** Read this brief and the contract above only. Write against the contract; P355 builds the bridge side at the same time. Commit each step as you finish it. Run every command in the foreground. Add no style. Files: src/ui/family.js (only `harnessGroups`, `childHarnesses`, `directHarness`, `childDraft` and what they need), src/ui/ladderForm.js (only `orchestratorHarnesses`), src/ui/FamilyTree.jsx and src/ui/FamilyTeam.jsx (only the harness selects and pills and the line under them), tests/ready-harnesses.test.js (new), docs/agents/architecture/ROOM.md, docs/agents/CHANGELOG.md.

1. One pure function decides what a picker offers: a harness is offered when `ready` is true and `enabled` is not false. When the bridge sends no `ready` field (an older bridge), `available` decides, as today.
2. The add-agent pills, the sub form's select, the team form's select and an orchestrator's harness select all use it. Direct API is offered only when it is ready (a key or an endpoint is saved), not always.
3. An orchestrator's or a lane's own current harness stays in its edit select even when it is not ready, marked `(not ready)`, so the form never hides what is in use.
4. A picker with nothing to offer shows `No harness is ready. Add one in Settings, under Harnesses.` and its Create button stays off.
5. Tests, each failing before your change: a not-ready Copilot, a turned-off Codex and a Direct API with no key are not offered in any of the four pickers; an older bridge's `available` still decides; a current harness that is not ready stays in its edit select; an empty picker shows the sentence.
6. Check it by eye in a replay at 1280 by 800 with the mock client (`npm run dev`): open the add-agent form and the sub form and say which harnesses each offered.
7. Run `node node_modules/vitest/vitest.mjs run tests/ready-harnesses.test.js tests/family.test.js tests/ladder-form.test.js tests/family-ladder-ui.test.js` and report the counts.

**P358. The runner and the doctor use the saved program (OpenCode).** Read this brief and the contract above only. Start it after P355 is merged: it reads `server/harness-settings.js`. Use no subagents. Run every command in the foreground. Commit each step as you finish it. Files: scripts/run-lane.mjs (only where a lane's program is chosen), server/doctor.js (only the harness lines), tests/run-lane-saved-program.test.js (new), docs/agents/architecture/COMMANDS.md, docs/agents/CHANGELOG.md.

1. When a lane's `cli.bin` is the harness's default program, or missing, and `harnesses.json` names a program for that harness, the runner starts the saved one. A lane that names its own `bin` keeps it.
2. The runner refuses a lane whose harness is in `off`: `That harness is turned off in Settings.`, before a folder, lock or worktree is made.
3. `npm run serve -- doctor` prints one line per harness: `ok NAME is ready (VERSION).`, `warn NAME is not ready: REASON` or `info NAME is turned off in Settings.`
4. Tests, each failing before your change: the saved program is the one spawned; a lane's own `bin` wins; an `off` harness is refused with nothing made; the doctor's three line forms.
5. Run `node node_modules/vitest/vitest.mjs run tests/run-lane-saved-program.test.js tests/run-lane.test.js tests/machine-doctor.test.js` and report the counts.

**P355b. Finish the bridge side of harness settings (OpenCode).** Read this brief, the contract above P355 and P355 itself only. Codex ran P355 twice and stopped both times: its sandbox cannot run `taskkill`, so `tests/harness-models.test.js` "handles command timeout" fails there, and it stops on a red test. Its work is on `feat/p355-the-bridge-checks` (commit `7e8bb6b7`). Start by merging it into your branch: `git merge --no-edit refs/heads/feat/p355-the-bridge-checks`. Use no subagents. Run every command in the foreground. Commit each step as you finish it, and stop starting new work at minute 30. Files: those P355 names.

1. Read what the merged commit does against P355 steps 1 to 4, and write the gaps at the top of your report. Fix each gap. Undo the change to `runCommand`'s timeout in `server/harness-models.js` unless `killTree` really returns false when it fails; say which.
2. Add the tests P355 step 5 names that the commit lacks: the masked home folder in `program`, the 10 minute cache and `POST /api/harnesses/check`, Direct API ready by an endpoint alone, a new sub on a turned-off harness refused while an existing one keeps it, and the two POST routes refusing a request with no Origin while `GET /api/harnesses` still answers.
3. LIVE.md and the changelog, as P355 says.
4. Run `node node_modules/vitest/vitest.mjs run tests/harness-settings.test.js tests/agents-config.test.js tests/harness-models.test.js tests/harness-models-program.test.js tests/orchestrators.test.js` and report the counts.

Models by name, no hidden defaults, P359 to P362. The owner asked on 2026-11-15: a Claude Code lane or orchestrator that nobody gave a model shows `opus` in the model selector, because `opus` is written in as a default; and pickers and rows show provider paths such as `opencode/deepseek/deepseek-v4.1-flash-1017` where the owner only wants the model's name. The stored id stays the full id the harness needs; only what the room shows and what it fills in by itself change.

**P359. No model is filled in that the owner did not choose (OpenCode).** Read this brief only. Use no subagents. Run every command in the foreground. Commit each step as you finish it. Files: server/orchestrator.js (only `DEFAULT_LANE` and where a turn's model is chosen), server/orchestrators.js (only the fallback model of a new sub), server/family.js (only `mainModel`), server/model-list.js (only a new export `MODEL_ALIASES`; leave the labels to P360), config/lanes.json, src/control/mock.js (only the orchestrator row's model), tests/model-defaults.test.js (new; add no test to another file except to keep an existing one passing), docs/agents/CHANGELOG.md.

1. Remove every written-in `'opus'`: `DEFAULT_LANE`, the turn fallback, `mainModel` in `server/family.js`, `config/lanes.json` and the mock. With no model chosen, the stored model is empty, the harness is started with no model flag so it uses its own default, and the room shows `Harness default` where it shows a model.
2. A new sub with no model chosen gets an empty model, not the first listed one and not a written-in OpenCode id.
3. `MODEL_ALIASES` maps the Claude aliases `opus`, `sonnet`, `haiku` to the full ids in `MODELS` (`claude-opus-5-5`, `claude-sonnet-5-5`, `claude-haiku-5-5`). A lanes file or ladder saved before that holds an alias is read as the full id, so the selector shows the real model, and the next save writes the full id.
4. Tests, each failing before your change: a fresh orchestrator with no lanes file has an empty model and its Claude command line has no `--model`; a new sub with no model is saved empty; a lane saved with `opus` reads back as `claude-opus-5-5`; no file under `server`, `src` or `config` holds `opus` alone as a model value (read the files in the test).
5. Run `node node_modules/vitest/vitest.mjs run tests/model-defaults.test.js tests/orchestrator.test.js tests/orchestrators.test.js tests/family-api.test.js` (skip a file that does not exist) and report the counts.

**P360. The room shows a model's name, not its provider path (OpenCode).** Read this brief only. Use no subagents. Run every command in the foreground. Commit each step as you finish it. Add no style. Files: src/ui/modelRefresh.js, src/ui/ModelRefresh.jsx, src/ui/OrchestratorChat.jsx (only the model menu and the Model button), src/ui/family.js (only `familyMeta` and `childDetail`), src/ui/Inspector.jsx (only the Model row), server/model-list.js (only the `label` fields), tests/model-names.test.js (new; add no test to another file except to keep an existing one passing), docs/agents/architecture/ROOM.md, docs/agents/CHANGELOG.md.

1. One pure function `modelName(id, choices)` in `src/ui/modelRefresh.js`: the label of the matching choice when there is one, else the last segment of the id after its last `/`. An empty id gives `Harness default`.
2. Labels in `MODELS` name the model only: `DeepSeek v4.1 Flash (OpenRouter)` becomes `DeepSeek v4.1 Flash`, `(Go)` goes, and so does any other provider or route name in a label. Keep `free` where a label has it: that is the price, not the provider.
3. `modelChoiceText` shows the name only, never `label (id)`. The chat's model menu drops the second line that repeats the id. When two choices in one picker have the same name, those two, and only those, add the first segment of their id after the name in the muted style the menu already has, so the owner can still tell them apart.
4. The family tree row (`familyMeta`), the child form's line (`childDetail`), the Model button and the Inspector's Model row use `modelName`. The `title` tooltip of a choice keeps the full id, for the owner who wants to look.
5. Tests, each failing before your change: `opencode/deepseek-v4.1-flash-free`, `deepseek/deepseek-v4.1-flash-1017` and `opencode-go/deepseek-v4.1-flash` show no provider; two choices with the same name show their first segments and a third does not; an empty model shows `Harness default`; a family row shows the name.
6. Check it by eye in a replay at 1280 by 800 (`npm run dev`): open the chat's model menu and a family tree row and say what each showed.
7. Run `node node_modules/vitest/vitest.mjs run tests/model-names.test.js tests/model-refresh.test.js tests/family.test.js tests/orchestrator-chat.test.js` (skip a file that does not exist) and report the counts.

**P361. A review of how friendly the forms are (Codex, GPT-6.1 Sol, report).** Read this brief only. Change no file except the one you write. Write `docs/agents/UI-FRIENDLY.md` in your worktree; the runner commits it. Your reply is not the report: the file is. Read `src/ui/FamilyTree.jsx`, `src/ui/FamilyTeam.jsx`, `src/ui/family.js`, `src/ui/ladderForm.js`, `src/ui/OrchestratorChat.jsx`, `src/ui/ModelRefresh.jsx`, `src/ui/modelRefresh.js`, `src/ui/Settings.jsx`, `src/ui/HarnessesSettings.jsx`, `src/ui/LanesSettings.jsx` and `src/ui/EndpointsPanel.jsx`, and `docs/agents/architecture/ROOM.md` for what they are meant to do.

1. The owner's words: the forms should be friendlier; they do not want redundant information, such as a provider path next to a model, or a default they did not choose. P359 and P360 fix those two; do not repeat them.
2. List at most 15 findings, ranked by how much each costs the owner, each with: the screen and control as the code names it, the file and line, what the owner sees today, what is redundant, confusing or missing, and one concrete change in plain words that a lane can build in one brief. Prefer removing a word, a field or a step to adding one.
3. Look at least at: the add-agent and sub forms (how many fields, their order, what the defaults are, what a beginner must know), the ladder editor, the effort and mode pickers, the model picker's search and refresh, the order of the sections in Settings, the confirms (is each worth its click), and the empty and error sentences.
4. End with a short section `Do not change` naming what already works well, so a later brief does not break it.
5. Under 160 lines. Plain words, no em dashes.

**P362. The guides catch up with P335 to P360 (AGY, Hydrogen).** Read this brief only. Commit each step as you finish it. Run every command in the foreground. Change no file in `src`, `server`, `scripts`, `tests` or `config`. Files: docs/agents/architecture/CODE.md, docs/agents/architecture/ROOM.md, docs/agents/architecture/LIVE.md, docs/agents/architecture/COMMANDS.md, docs/agents/FREE-HIERARCHY.md, docs/agents/HARNESSES.md, docs/agents/architecture/DOCUMENTS.md, docs/agents/CHANGELOG.md (one line).

1. Read `docs/agents/CHANGELOG.md` from 0.1.380 on, then the code each entry names. The code is the authority: where a guide disagrees with it, the guide changes.
2. CODE.md gains one line for each file added since 0.1.380 that it does not list (for example `server/harness-settings.js`, `src/ui/HarnessesSettings.jsx`, `src/ui/harnessesSettings.js`) and loses any line for a file that no longer exists.
3. FREE-HIERARCHY.md's runbook starts with Settings, under Harnesses: check that each harness the owner wants is `Ready`, turn off the ones they do not use, and save a program path when one is not found. Its "what works today" list gains lane messages and replies (P341, P342), lane modes (P338, P343) and the outside-the-project list (P339), each with what it does in one sentence.
4. HARNESSES.md says how a harness is found (a saved program, then the lane's `bin`, then the descriptor's default, then the Codex app) and what `ready` means.
5. ROOM.md, LIVE.md and COMMANDS.md: fix each sentence the code contradicts. Do not restate what a section already says.
6. List in your report every sentence you changed and the code line that made you change it.

Friendlier forms, first part, P363 to P365. `docs/agents/UI-FRIENDLY.md` (P361, GPT-6.1 Sol) ranks 15 findings. These three briefs fix the ones where a form says or does the wrong thing: findings 1 to 7, 14 and 15. Findings 8 to 13 change a layout or remove a step and wait for the owner. Read only your findings in that file, and its `Do not change` section.

**P363. The chat sends where it shows and says the mode it runs in (OpenCode).** Start it after P360 is merged. Read this brief, findings 1, 3 and 14 (the chat part) of `docs/agents/UI-FRIENDLY.md` and its `Do not change` section. Use no subagents. Run every command in the foreground. Commit each step as you finish it. Add no style. Files: src/ui/OrchestratorChat.jsx, src/ui/orchestratorChat.js, tests/chat-friendly.test.js (new; add no test to another file except to keep an existing one passing), docs/agents/architecture/ROOM.md, docs/agents/CHANGELOG.md.

1. Finding 1: opening an orchestrator's tab sets `To` to that orchestrator. Choosing a lane in `To` by hand still works until another tab opens.
2. Finding 3: the start text says the current mode's label and its line from `src/control/modes.js` in place of `with full permissions`, for the main and for a sub. With no known mode, it says nothing about permissions.
3. Finding 14, chat part: with no effort levels for the harness, the chat shows no Effort control at all. A saved effort is not changed.
4. Tests, each failing before your change: a sub's tab sets To; a start text in Plan mode names Plan and not full permissions; a harness with no effort levels draws no Effort control.
5. Run `node node_modules/vitest/vitest.mjs run tests/chat-friendly.test.js tests/orchestrator-chat.test.js` (skip a file that does not exist) and report the counts.

**P364. The family forms keep what they show (OpenCode).** Start it after P357 is merged. Read this brief, findings 2, 4, 5, 6 and 14 (the editor part) of `docs/agents/UI-FRIENDLY.md` and its `Do not change` section. Use no subagents. Run every command in the foreground. Commit each step as you finish it. Add no style. Files: src/ui/FamilyTree.jsx, src/ui/ladderForm.js (only `subFromForm`), src/ui/family.js (only the team shortage sentence), tests/family-friendly.test.js (new; add no test to another file except to keep an existing one passing), docs/agents/architecture/ROOM.md, docs/agents/CHANGELOG.md.

1. Finding 2: `subFromForm` keeps the effort the owner chose, and the bridge saves it (P353 taught the bridge to take it; check `server/orchestrators.js`). An empty effort stays empty.
2. Finding 4: a lane from lanes.json shows its harness, model, effort and backup lane as plain text with `Edit this agent in lanes.json.`, not as controls. Its Label and its Hide or Remove actions stay.
3. Finding 5: when the Direct API model read failed, the form shows that error and Retry, not `Add a Direct API key in Settings first.` The key sentence stays for a Direct API with nothing saved.
4. Finding 6: the team shortage sentence becomes `Need N more agents outside existing teams. Add agents or make the team smaller.`
5. Finding 14, editor part: an orchestrator whose harness has no effort levels shows no Effort select.
6. Tests, each failing before your change: a sub made with effort `high` is saved with `high`; a lanes.json lane has no Model select; a failed Direct API read shows its error and not the key sentence; the new shortage sentence; no Effort select for a harness without levels.
7. Run `node node_modules/vitest/vitest.mjs run tests/family-friendly.test.js tests/family.test.js tests/ladder-form.test.js tests/family-ladder-ui.test.js` and report the counts.

**P365. Settings stops offering a step that cannot work (Codex, GPT-6.1 Terra).** Read this brief, findings 7 and 15 of `docs/agents/UI-FRIENDLY.md` and its `Do not change` section. Your sandbox keeps git read-only: write the files in your worktree and the runner commits them. Never run `npm install`; run tests as `node ../../node_modules/vitest/vitest.mjs run FILES` from your worktree. Add no style. Files: src/ui/EndpointsPanel.jsx, src/ui/LanesSettings.jsx, tests/settings-friendly.test.js (new; add no test to another file except to keep an existing one passing), docs/agents/CHANGELOG.md.

1. Finding 7: the custom endpoint form shows no model refresh button until its name is a saved endpoint, and says `Save first, then use Refresh models on its row.` beside Models.
2. Finding 15: when the lanes read failed, `No lanes are listed.` is not shown; the error stands alone.
3. Tests, each failing before your change: a new custom endpoint form has no refresh button and has the sentence; a failed lanes read shows the error and not the empty sentence.
4. Run `node ../../node_modules/vitest/vitest.mjs run tests/settings-friendly.test.js tests/endpoints-panel.test.js tests/lanes-settings.test.js` (skip a file that does not exist) and report the counts. If a test cannot run in your sandbox, say which and why.

**P366. A review of the harness settings and model batch (Codex, GPT-6.1 Sol, report).** Read this brief only. Change no file except the one you write. Write `docs/agents/AUDIT-2026-11-REVIEW-37.md` in your worktree; the runner commits it. Your reply is not the report: the file is. Review `git diff e9684294..HEAD` (P352 to P365): the harness readiness checks and `harnesses.json` (`server/harness-settings.js`, `server/agents-config.js`, `server/harness-models.js`, `scripts/run-lane.mjs`, `server/doctor.js`), Settings under Harnesses, the ready-only pickers, the model defaults and aliases (`server/orchestrator.js`, `server/orchestrators.js`, `server/model-list.js`), the model names (`src/ui/modelRefresh.js`, `src/ui/ModelPicker.jsx`) and the friendlier forms.

1. Look for: a path or key that reaches the page or a log unmasked; a POST that writes without an Origin or `confirmed: true`; a program path that runs something the owner did not save; a version check that can hang the bridge or `up`; a harness turned off that still starts; a stored model id changed when only its display should change; a picker that hides a model or harness in use; a test that would pass with its change undone.
2. Each finding: a number `R37-N`, a severity (P1 blocks a push, P2 should be fixed soon, P3 small), the file and line, what goes wrong, how to see it, and one fix in plain words. At most 12. No finding without a file and line you read.
3. End with `Checked and fine`, a short list of what you looked at and found right.
4. Under 120 lines. Plain words, no em dashes.

Review 37 fixes, P367 to P369. `docs/agents/AUDIT-2026-11-REVIEW-37.md` (P366, GPT-6.1 Sol) lists R37-1 to R37-7. Read only your findings there; each names its file, line, how to see it and the fix. One meaning of `off` holds for all three: nothing new starts on a harness that is off. No new lane, sub or harness change, and no lane run, a failover run included. An orchestrator or sub that already uses it keeps taking turns.

**P367. The harness check masks what it prints, and Program starts empty (OpenCode).** Read this brief, R37-1 and R37-7 only. Use no subagents. Run every command in the foreground. Commit each step as you finish it. Add no style. Files: server/harness-settings.js, src/ui/harnessesSettings.js, src/ui/HarnessesSettings.jsx, tests/harness-settings-mask.test.js (new; add no test to another file except to keep an existing one passing), docs/agents/CHANGELOG.md.

1. R37-1: the version line is masked before it is cut to 80 characters: profile paths with `maskProfilePaths` of `src/model/paths.js`, and keys with the masking `maskRunText` in `server/runs.js` uses (import it or the helper it calls; do not copy a second pattern). The masked value is the only one stored, so the page and the doctor both get it.
2. R37-7: the Program field starts empty. The masked current path shows beside it as text. Save stays off until the owner types a path.
3. Tests, each failing before your change: a fake program whose version line holds the home folder and a `sk-` style key comes back with neither; the Program field is empty with a saved program, shows the masked path as text, and Save is off until typed.
4. Run `node node_modules/vitest/vitest.mjs run tests/harness-settings-mask.test.js tests/harness-settings.test.js tests/harnesses-settings.test.js` and report the counts.

**P368. Chat and subs use the saved program, the sub list sees it, and a sub's effort change applies (OpenCode).** Read this brief, R37-2, R37-3 and R37-5 only. Use no subagents. Run every command in the foreground. Commit each step as you finish it. Files: server/orchestrator.js (only `binFor` and the effort setter it needs), server/orchestrators.js (only the harness list's availability calls, `subConfig`'s bin, `sameConfig` and the update path), tests/orchestrator-saved-program.test.js (new; add no test to another file except to keep an existing one passing), docs/agents/CHANGELOG.md.

1. R37-2: when no explicit bin and no lane names its own program, the main orchestrator and each sub start the program saved for their harness in `harnesses.json` (`readHarnessSettings` of `server/harness-settings.js`). A lane's own custom bin still wins.
2. R37-3: the orchestrator harness list passes the runs folder to every availability check, so a harness ready only through a saved program is listed.
3. R37-5: a ladder save that changes only a sub's effort applies it to the idle sub through its effort setter and keeps its saved state in step. While that sub works, the save is refused with one sentence, as other changes to a working sub are.
4. Tests, each failing before your change: a saved Claude program with no Claude lane is the one spawned for a chat turn and for a sub's turn; a lane's custom bin wins over it; the harness list holds a harness found only through a saved program; an effort-only save changes the live sub's effort from high to low; the same save on a working sub is refused.
5. Run `node node_modules/vitest/vitest.mjs run tests/orchestrator-saved-program.test.js tests/orchestrator.test.js tests/orchestrators.test.js tests/sub-effort.test.js` and report the counts.

**P369. The forms see a settings change at once, and failover respects off (Codex, GPT-6.1 Terra).** Read this brief, R37-4 and R37-6 only. Your sandbox keeps git read-only: write the files in your worktree and the runner commits them. Never run `npm install`; run tests as `node ../../node_modules/vitest/vitest.mjs run FILES` from your worktree. Files: server/agents-config.js (only the two harness POST routes), src/ui/FamilyTree.jsx and src/ui/FamilyTeam.jsx (only where harness rows are read), scripts/run-lane.mjs (only the failover start and `startLane`'s checks), docs/agents/HARNESSES.md (only the sentences on `off`), tests/harness-notice.test.js (new; add no test to another file except to keep an existing one passing), docs/agents/CHANGELOG.md.

1. R37-4: after a successful settings write or check, the bridge sends the same notice the mock sends (read `src/control/mock.js`), and the family tree and the team form read the harness rows again when it arrives.
2. R37-6: `startLane` refuses a lane whose harness is off with `That harness is turned off in Settings.` before any lock, branch or worktree, so a failover to a backup on an off harness records the refusal and starts nothing.
3. HARNESSES.md states the one meaning of `off` from the top of these briefs.
4. Tests, each failing before your change: a settings write sends the notice; the family tree reads harness rows again on it; a failover to a backup whose harness is off starts nothing and takes no lock.
5. Run `node ../../node_modules/vitest/vitest.mjs run tests/harness-notice.test.js tests/agents-config.test.js tests/run-lane-saved-program.test.js tests/family-tree-ui.test.js` and report the counts. If a test cannot run in your sandbox, say which and why.

Friendlier forms, second part, P370 to P373. The owner said yes on 2026-11-15 to findings 8 to 13 of `docs/agents/UI-FRIENDLY.md` (P361, GPT-6.1 Sol). Read only your findings there and its `Do not change` section, which every brief keeps: the confirms for team Apply or Copy, removals, deletion, Stop, compaction and first start; the Bypass confirm; ModelPicker's search, Current, pins and keys. Model names follow P360: `modelName` of `src/ui/modelRefresh.js`, never a provider path.

**P370. Settings starts with what gets agents ready, and a ready harness folds its program details (OpenCode).** Read this brief, findings 8 and 13 only. Use no subagents. Run every command in the foreground. Commit each step as you finish it. Add no style: reuse the classes Settings already has, and a `<details>` element is fine. Files: src/ui/Settings.jsx (only the order of the sections), src/ui/HarnessesSettings.jsx, src/ui/harnessesSettings.js, tests/settings-order.test.js (new; add no test to another file except to keep an existing one passing), docs/agents/architecture/ROOM.md, docs/agents/CHANGELOG.md.

1. Finding 8: Settings shows Harnesses, Direct API (`EndpointsPanel`), Keys and Lanes first, in that order, then the other sections in their current order.
2. Finding 13: a `Ready` harness row shows its name, state word and `Offer in forms`, with the version, the program path, the Program field and its buttons folded under `Program details`. A `Not ready` row keeps them open. The program-change confirm stays.
3. Tests, each failing before your change: the section order; a ready row folds its details and a not-ready row does not.
4. Run `node node_modules/vitest/vitest.mjs run tests/settings-order.test.js tests/settings.test.js tests/harnesses-settings.test.js tests/harness-settings-mask.test.js` and report the counts.

**P371. The ladder checklist names each agent's team, and a label saves in one click (OpenCode).** Read this brief, findings 10 and 11 only. Use no subagents. Run every command in the foreground. Commit each step as you finish it. Add no style. Files: src/ui/FamilyTree.jsx (only the sub editor's Agents list and Save label), src/ui/family.js (only a helper for the parent label, if one is needed), tests/family-checklist.test.js (new; add no test to another file except to keep an existing one passing), docs/agents/architecture/ROOM.md, docs/agents/CHANGELOG.md.

1. Finding 10: each checkbox in a sub's Agents list shows the agent's label and, in place of its internal id, the label of its current parent (`Orchestrator` or the sub's label). The transfer warning and its confirm stay.
2. Finding 11: Save label saves a valid changed label at once, with no confirm card. Validation, the data the bridge needs (send `confirmed: true` as the confirm did) and inline errors stay. An unchanged label leaves Save off.
3. Tests, each failing before your change: a lane under another sub shows that sub's label; a lane under the main shows `Orchestrator`; Save label calls the client once with no confirm card; an invalid label shows its error and saves nothing.
4. Run `node node_modules/vitest/vitest.mjs run tests/family-checklist.test.js tests/family-tree-ui.test.js tests/family.test.js tests/family-friendly.test.js` and report the counts.

**P372. The chat's model and effort apply when picked, through the shared picker (Codex, GPT-6.1 Terra).** Read this brief, findings 9 (the chat part) and 12 only. Your sandbox keeps git read-only: write the files in your worktree and the runner commits them. Never run `npm install`; run tests as `node ../../node_modules/vitest/vitest.mjs run FILES` from your worktree. Add no style. Files: src/ui/OrchestratorChat.jsx (only the model and effort controls), src/ui/ModelPicker.jsx (only if it needs a prop for the chat's placement; change no behaviour another form uses), tests/chat-pickers.test.js (new; add no test to another file except to keep an existing one passing), docs/agents/architecture/ROOM.md, docs/agents/CHANGELOG.md.

1. Finding 9, chat part: the chat's model control is `ModelPicker`, with the chat's current refresh and save handlers, so it has the same search, Current, pins and keys as the family forms.
2. Finding 12: picking a different model or effort applies it at once (the request sends `confirmed: true`, as the Set step did), with the existing save errors shown where they are today. Picking the current value only closes the list. The `Set the model` and `Set the effort` cards go. The mode picker and its Bypass confirm do not change.
3. Tests, each failing before your change: the chat renders a ModelPicker; picking another model calls the client once with that id and no Set card; picking the current one calls nothing; picking an effort applies it at once; a save error still shows.
4. Run `node ../../node_modules/vitest/vitest.mjs run tests/chat-pickers.test.js tests/orchestrator-chat.test.js tests/chat-friendly.test.js tests/model-picker.test.js` and report the counts. If a test cannot run in your sandbox, say which and why.

**P373. Build a team uses the shared model picker (AGY, Hydrogen).** Read this brief and finding 9 (the Build a team part) only. Commit each step as you finish it. Run every command in the foreground. Add no style. Files: src/ui/FamilyTeam.jsx (only the Model field), tests/team-picker.test.js (new; add no test to another file except to keep an existing one passing), docs/agents/CHANGELOG.md.

1. The Model field of `Build a team` is `ModelPicker`, as the add-agent form uses it in `src/ui/FamilyTree.jsx`, with the team form's current model list and refresh. What the form saves does not change.
2. Tests, each failing before your change: the team form renders a ModelPicker; picking a model puts its id in the team plan; the preview and Save behave as before.
3. Run `node node_modules/vitest/vitest.mjs run tests/team-picker.test.js tests/family-team.test.js tests/model-picker.test.js` and report the counts.

Review, plan and one gap, P374 to P376. The owner asked on 2026-11-15 (night) for GPT-6.1 Sol and Gemini 4 Argon to review and help orchestrate, while OpenCode, AGY Hydrogen and Codex Terra code. OpenCode has about 5 percent of its plan left: give it only small briefs.

**P374. Review 38: the friendlier forms batch (Codex, GPT-6.1 Sol, report).** Read this brief only. Change no file except the one you write. Your sandbox keeps git read-only: write the file in your worktree and the runner commits it. Files: docs/agents/AUDIT-2026-11-REVIEW-38.md.

1. Review `git diff cedd5100..HEAD` (P370 to P373 and the commits beside them): Settings order and the folded program details, the ladder checklist and one-click label, the chat's ModelPicker with apply on pick, Build a team's ModelPicker.
2. Look for: a choice applied that the owner did not make (a picker that saves on open, on arrow keys or on a refresh); a save that sends a stale id; a confirm removed that `UI-FRIENDLY.md`'s `Do not change` kept; an error that no longer shows; a test that would pass with its change undone; focus lost or Escape broken; a folded control that hides a `Not ready` reason.
3. Each finding: `R38-N`, a severity (P1 blocks a push, P2 should be fixed soon, P3 small), the file and line, what goes wrong, how to see it, one fix in plain words. At most 10. No finding without a file and line you read.
4. End with `Checked and fine`. Under 100 lines. Plain words, no em dashes.

**P375. What the free hierarchy needs next (AGY, Gemini 4 Argon High, report).** Read this brief only. Change no file except the one you write. Commit it when done. Files: docs/agents/PLAN-NEXT-ARGON.md.

1. Read `docs/agents/FREE-HIERARCHY.md` (the goal, what works, what does not work yet), `docs/agents/HIERARCHY.md`, `docs/agents/UI-FRIENDLY.md` and the code each names. The code is the authority.
2. Propose the next 8 briefs toward the owner's goal (any harness coordinates any other, they message each other, the owner watches file access, worktrees are a choice, modes guard the edges), ranked by how much each closes the gap between the goal and today. Each: a title, the gap it closes in one sentence with the file and line that shows the gap, the files it would touch, the tests that would prove it, its size (one lane run of 30 minutes or less), and the harness that fits (AGY Hydrogen or Codex Terra for most; OpenCode only for a brief under 15 minutes).
3. Mark any brief that changes what the owner sees or removes a step as `needs the owner's yes`.
4. Do not propose P376 (OpenCode lane modes, already briefed).
5. Under 120 lines. Plain words, no em dashes.

**P376. OpenCode lanes take plan and edits (Codex, GPT-6.1 Terra).** Read this brief only. Your sandbox keeps git read-only: write the files in your worktree and the runner commits them. Never run `npm install`; run tests as `node ../../node_modules/vitest/vitest.mjs run FILES` from your worktree. Files: src/briefs/run.js (only `runnerModeProblem` or the line that refuses OpenCode plan and edits), scripts/run-lane.mjs (only where a lane's OpenCode config file is written and passed), server/runs.js (only if the bridge's mode check names the same refusal), tests/opencode-lane-mode.test.js (new; add no test to another file except to keep an existing one passing), docs/agents/architecture/COMMANDS.md, docs/agents/FREE-HIERARCHY.md (only the line that says OpenCode lanes take no plan or edits), docs/agents/CHANGELOG.md.

1. An OpenCode lane run in `plan` or `edits` mode gets the same permission config the orchestrator writes for an OpenCode turn (read `server/orchestrator.js` near `needsOpencodeConfig`: `edits` denies `bash`, `plan` denies `edit` and `bash`), merged with the MCP config the runner already writes when MCP servers are on. The file is written with mode 0o600, passed as `OPENCODE_CONFIG`, and removed when the run ends, as the MCP file is today.
2. The refusal `OpenCode lanes cannot use MODE mode because it needs a permission config.` goes, for the runner and the bridge. `ask` stays refused for every lane.
3. Tests, each failing before your change: `--mode plan` on an OpenCode lane passes `OPENCODE_CONFIG` pointing at a file whose permission denies edit and bash; `edits` denies bash only; with MCP servers on, the file holds both the servers and the permission; no mode writes no file; the file is gone after the run.
4. Run `node ../../node_modules/vitest/vitest.mjs run tests/opencode-lane-mode.test.js tests/lane-mode.test.js tests/run-mode-route.test.js tests/run-lane.test.js` and report the counts. If a test cannot run in your sandbox, say which and why.

Found in the room on 2026-11-15 (night), checked at 1280 by 800 against a fresh bridge, P377 and P378. A fresh Claude Code orchestrator reads `Harness default` and a pick applies at once, as P359 and P372 meant. Three things are still wrong. The chat's ModelPicker stacks its `MODEL:` label above a wide trigger, so the strip row is taller than the To, Effort and Mode controls beside it, and its list opens down over the Mode and Compact row. A family row shows the raw id `claude-opus-5-5`, not `Claude Opus 5.5`. And the add-agent form fills in a model (`DeepSeek v4.1 Flash`) that the owner did not choose.

**P377. The chat's model picker sits in the strip like its neighbours (Codex, GPT-6.1 Terra).** Read this brief only. Your sandbox keeps git read-only: write the files in your worktree and the runner commits them. Never run `npm install`; run tests as `node ../../node_modules/vitest/vitest.mjs run FILES` from your worktree. Files: src/ui/ModelPicker.jsx (only a new optional prop for a compact inline placement, and a list that opens upward with it; every other form stays as it is), src/ui/OrchestratorChat.jsx (only the props it passes to the chat's ModelPicker), src/styles.css (only rules scoped to the new placement), tests/chat-picker-layout.test.js (new), docs/agents/CHANGELOG.md.

1. In the chat strip the picker reads `Model: NAME` on one line, with the label inline before the trigger as `Effort:` is, and the trigger as wide as its text, up to 220 pixels, with an ellipsis past that and the full name in its title.
2. Its list opens upward, above the strip, so it covers neither the Mode nor the Compact row. Search, Current, pins, keys and refresh stay.
3. The family forms' pickers do not change: test that the prop is off by default.
4. Tests, each failing before your change: the chat passes the prop; with it the label is inline and the list has the upward class; without it neither.
5. Also fix R38-2 and R38-3 of `docs/agents/AUDIT-2026-11-REVIEW-38.md` (read those two only): a chat model or effort save, and its error, belong to the agent it was sent for, so a reply that lands after the owner opened another tab changes nothing there; and closing the ModelPicker by Escape or a pick returns focus to its trigger, in every form. Add a test for each that fails before the fix.
6. The orchestrator checks it by eye; you need not.
7. Run `node ../../node_modules/vitest/vitest.mjs run tests/chat-picker-layout.test.js tests/chat-pickers.test.js tests/model-picker.test.js tests/orchestrator-chat.test.js` and report the counts.

**P378. The forms start at Harness default, and a family row names its model (AGY, Hydrogen).** Read this brief only. Commit each step as you finish it. Run every command in the foreground. Files: src/ui/family.js (only `childDraft`, `teamDraft`, `childFormProblem`, `familyMeta` and what they need), src/ui/FamilyTree.jsx (only `subDraftFor`, the sub form's model check and where `familyMeta` gets its model list), src/ui/FamilyTeam.jsx (only `harnessProblem`'s model check), src/ui/ModelPicker.jsx (only if `Harness default` needs to be a choice in the list), tests/form-defaults.test.js (new; add no test to another file except to keep an existing one passing), docs/agents/architecture/ROOM.md, docs/agents/CHANGELOG.md.

1. The add-agent, sub and team forms start with no model chosen: the picker reads `Harness default`, and an empty model is a valid choice that saves as empty, so the harness starts with its own default (P359 made the bridge and runner accept it). The owner can still pick any listed model. Direct API keeps needing a model, because its endpoint has no default: there `Choose a model for this harness.` stays.
2. `Harness default` is the first row of every family form's list, so the owner can go back to it after picking a model.
3. A family tree row names its model with `modelName` and the harness's model list when the room has one (`Claude Opus 5.5`), and the id's last segment when it has none.
4. Tests, each failing before your change: a new child, sub and team draft has an empty model and no form problem; Direct API with no model still has the problem; choosing `Harness default` after a model empties it; a row with `claude-opus-5-5` and a model list reads `Claude Opus 5.5`.
5. Run `node node_modules/vitest/vitest.mjs run tests/form-defaults.test.js tests/family.test.js tests/family-tree-ui.test.js tests/family-team.test.js tests/team-picker.test.js tests/ready-harnesses.test.js` and report the counts.


**P379. A rename keeps to its own agent, and Direct API shows why it is not ready (OpenCode).** Read this brief, R38-1 and R38-4 of `docs/agents/AUDIT-2026-11-REVIEW-38.md` only. This is a small brief: stop at minute 15. Use no subagents. Run every command in the foreground. Commit each step as you finish it. Files: src/ui/FamilyTree.jsx (only `askLabel`), src/ui/HarnessesSettings.jsx (only where the not-ready reason renders), tests/review-38-fixes.test.js (new), docs/agents/CHANGELOG.md.

1. R38-1: when a label write finishes, the draft takes the new label only if the same agent and the same submitted label are still open.
2. R38-4: the not-ready reason renders outside the program details, so the Direct API row shows `No key or endpoint is saved.`
3. Tests, each failing before your change: a delayed rename of one agent does not change another agent's open draft; a not-ready Direct API row shows its reason.
4. Run `node node_modules/vitest/vitest.mjs run tests/review-38-fixes.test.js tests/family-checklist.test.js tests/settings-order.test.js` and report the counts.

From Argon's plan, P380 and P381. `docs/agents/PLAN-NEXT-ARGON.md` (P375, Gemini 4 Argon) ranks eight briefs; items 3 and 4 change nothing the owner sees and are briefed here. Items 1, 2 and 5 to 8 wait for the owner's yes.

**P380. A native lane reads its replies between turns (AGY, Hydrogen).** Read this brief and item 3 of `docs/agents/PLAN-NEXT-ARGON.md` only. Commit each step as you finish it. Run every command in the foreground. Files: scripts/mr-agent.mjs (only the turn loop and one helper that reads the inbox), tests/mr-agent-inbox.test.js (new; add no test to another file except to keep an existing one passing), docs/agents/architecture/LIVE.md (only the lane inbox paragraph), docs/agents/CHANGELOG.md.

1. When `MACHINEROOM_BRIDGE` and `MACHINEROOM_LANE_TICKET` are both set, the native agent reads `GET BRIDGE/api/orchestrator/messages` with the header `X-MachineRoom-Lane: TICKET` once before each model call after the first, with a 3 second limit. Messages it has not seen yet (compare by `at` and `text`) go into the conversation as one user message: `Messages for you while you work:` and then one line per message, `FROM: TEXT`.
2. A failed or slow read changes nothing and is not retried in that turn. The ticket is never printed, logged or put in the conversation. With either variable missing, no request is made.
3. Tests, each failing before your change: with a fake bridge that returns one message after the first call, the second model request holds it once and the third does not repeat it; a 403 or a timeout adds nothing; no variables makes no request; the ticket appears in no output line.
4. Run `node node_modules/vitest/vitest.mjs run tests/mr-agent-inbox.test.js tests/mr-agent.test.js` and report the counts.

**P381. Lane messages survive a failover (Codex, GPT-6.1 Terra).** Read this brief and item 4 of `docs/agents/PLAN-NEXT-ARGON.md` only. Your sandbox keeps git read-only: write the files in your worktree and the runner commits them. Never run `npm install`; run tests as `node ../../node_modules/vitest/vitest.mjs run FILES` from your worktree. Files: server/runs.js (only the ticket registry and how a failover is recorded against it), scripts/run-lane.mjs (only the failover start's prompt and env), tests/failover-messages.test.js (new; add no test to another file except to keep an existing one passing), docs/agents/FREE-HIERARCHY.md (only the line `A failover backup does not message`), docs/agents/CHANGELOG.md.

1. When a bridge-started run fails over, the backup run gets the same `MACHINEROOM_LANE_TICKET` and `MACHINEROOM_BRIDGE` and the same lane message paragraph in its prompt. The bridge's ticket now speaks for the backup lane: a message it sends reads `from: "lane:BACKUP"`, `to: "lane:PRIMARY"` reaches the backup's inbox, and the 4 sends a run may make are shared by the primary and the backup, not reset.
2. The ticket ends when the backup's run ends, as it does for a run with no failover.
3. Tests, each failing before your change: the backup's env holds both variables and its prompt holds the paragraph; a backup send is recorded from the backup lane; a message to the primary's key reaches the backup's inbox; the shared limit of 4 holds across the two; the ticket is refused after the backup ends.
4. Run `node ../../node_modules/vitest/vitest.mjs run tests/failover-messages.test.js tests/lane-inbox.test.js tests/failover-ticket-mode.test.js tests/run-lane.test.js` and report the counts. If a test cannot run in your sandbox, say which and why.

**P381b. A failover backup keeps the primary's ticket (Codex, GPT-6.1 Terra).** Read this brief only. It replaces P381, which stopped because the bridge learns of a failover only after the backup ends. Your sandbox keeps git read-only: write the files in your worktree and the runner commits them. Never run `npm install`; run tests as `node ../../node_modules/vitest/vitest.mjs run FILES` from your worktree. Two baseline failures in your sandbox are known and not yours: a process-lock assertion in `tests/run-lane.test.js` and an `EPERM` worktree test. Files: scripts/run-lane.mjs (only the failover start's prompt and env), tests/failover-ticket-mode.test.js (update the assertions that say a backup gets no ticket), tests/failover-messages.test.js (new), docs/agents/FREE-HIERARCHY.md (only the line `A failover backup does not message`), docs/agents/architecture/COMMANDS.md (only the sentence on what a failover backup receives), docs/agents/CHANGELOG.md.

1. The bridge does not change. When a run that has `MACHINEROOM_LANE_TICKET` and `MACHINEROOM_BRIDGE` fails over, the backup's env holds the same two variables and its prompt holds the same lane message paragraph. Its messages go out under the primary's ticket, so they read as from the primary lane, and it reads the primary's inbox. The 4 sends are shared because the ticket is one.
2. FREE-HIERARCHY.md says: a failover backup keeps messaging under the primary lane's name and reads the primary's inbox.
3. Tests, each failing before your change: the backup's env holds both variables with the primary's values; its prompt holds the paragraph; a run with no ticket gives the backup none.
4. Run `node ../../node_modules/vitest/vitest.mjs run tests/failover-messages.test.js tests/failover-ticket-mode.test.js` and report the counts.

**P382. The runner refuses a lane only for a leftover that is still there (AGY, Hydrogen).** Read this brief only. Commit each step as you finish it. Run every command in the foreground. Files: scripts/run-lane.mjs (only `refuseRunningLane`), src/briefs/run.js (only `laneStopProblem`), tests/leftover-recheck.test.js (new; add no test to another file except to keep an existing one passing), docs/agents/architecture/COMMANDS.md (only the leftover sentence), docs/agents/CHANGELOG.md.

On 2026-11-15 the runner twice refused the opencode lane with `The opencode lane still has leftover process N`, and each time process N had already exited when the orchestrator looked. Something short-lived named the worktree on its command line at the moment of the check.

1. `refuseRunningLane` lists processes, and when it finds a leftover, waits 500 milliseconds, lists again and refuses only for a process that is in both lists with the same pid and the same command line.
2. The refusal names the leftover's program name too (the first word of its command line, with the home folder masked by `maskProfilePaths` of `src/model/paths.js`): `The opencode lane still has leftover process N (node.exe); stop it with npm run run-lane -- --stop opencode.`
3. Tests, each failing before your change: a process in the first list and gone from the second is not a refusal; one in both is, and its message names its program; a pid in both lists with a different command line (a reused pid) is not a refusal. Pass the process lister and the wait in as arguments so the tests need no real processes.
4. Run `node node_modules/vitest/vitest.mjs run tests/leftover-recheck.test.js tests/run-lane.test.js tests/process-tree.test.js` (skip a file that does not exist) and report the counts.

**P383. Review 39: lane modes, the forms' defaults and lane messages (Codex, GPT-6.1 Sol, report).** Read this brief only. Change no file except the one you write. Your sandbox keeps git read-only: write the file in your worktree and the runner commits it. Files: docs/agents/AUDIT-2026-11-REVIEW-39.md.

1. Review `git diff 117e8b36..HEAD`: P376 (OpenCode lanes in plan and edits), P377 (the chat's inline picker, focus, stale replies), P378 (forms start at Harness default, row names), P379 (rename draft, Direct API reason), P380 (the native agent reads its inbox) and P381b (a failover backup keeps the ticket).
2. Look for: a permission config that grants more than its mode, or a config file left on disk or readable by others; an OpenCode lane run whose mode is lost on failover; an empty model saved where the harness needs one (Direct API, an endpoint); a picker whose keyboard index no longer matches its rows; a ticket printed, logged or put where a page can read it; an inbox read that can hang or flood a native run; a backup that can send more than the shared 4; a test that would pass with its change undone.
3. Each finding: `R39-N`, a severity (P1 blocks a push, P2 should be fixed soon, P3 small), the file and line, what goes wrong, how to see it, one fix in plain words. At most 10. No finding without a file and line you read.
4. End with `Checked and fine`. Under 100 lines. Plain words, no em dashes.

Review 39 fixes, P384 and P385. `docs/agents/AUDIT-2026-11-REVIEW-39.md` (P383, GPT-6.1 Sol): R39-1 blocks the push.

**P384. A code agent made at Harness default saves and runs (Codex, GPT-6.1 Terra).** Read this brief and R39-1 only. Your sandbox keeps git read-only: write the files in your worktree and the runner commits them. Never run `npm install`; run tests as `node ../../node_modules/vitest/vitest.mjs run FILES` from your worktree. Files: server/agents-config.js (only the model check in lane creation and update), src/harnesses/claude.js, src/harnesses/opencode.js, src/harnesses/hermes.js (only where `command` puts the model on the command line), tests/empty-model-lane.test.js (new; add no test to another file except to keep an existing one passing), docs/agents/architecture/LIVE.md (only the `/api/lanes/create` sentence on the model), docs/agents/CHANGELOG.md.

1. `POST /api/lanes/create` and the lane update accept an empty model for a CLI harness and save the lane with no model. `machineroom` (Direct API) and a lane with an endpoint still need a model the bridge knows, with today's refusal. A non-empty model is still checked as today.
2. Each harness `command` leaves the model flag out when the lane has no model: Claude Code drops `--model`; OpenCode drops `--model` and with it the `#effort` suffix, since OpenCode takes effort only on a model; Hermes drops `-m`. Codex and AGY already leave it out: prove it with a test.
3. Tests, each failing before your change: the real `createAgentLane` path saves an OpenCode lane with an empty model; the same for Direct API is refused; each harness's command line for an empty model holds no model flag and nothing empty; a lane with a model keeps today's command line exactly.
4. Run `node ../../node_modules/vitest/vitest.mjs run tests/empty-model-lane.test.js tests/agents-config.test.js tests/harnesses.test.js tests/lane-mode.test.js tests/run-lane.test.js` and report the counts. If a test cannot run in your sandbox, say which and why.

**P385. The chat keeps a second model pick, and inbox replies stay inside the native context (AGY, Hydrogen).** Read this brief, R39-2 and R39-3 only. Commit each step as you finish it. Run every command in the foreground. Files: src/ui/OrchestratorChat.jsx (only `saveModel` and the picker's props), scripts/mr-agent.mjs (only `boundMessages` and the inbox message it adds), tests/review-39-fixes.test.js (new; add no test to another file except to keep an existing one passing), docs/agents/CHANGELOG.md.

1. R39-2: while a model save waits, the chat's model picker is disabled, so a second pick cannot be made and lost. When the save ends it is enabled again, on the same tab only.
2. R39-3: `boundMessages` drops the oldest injected inbox messages (the ones that start `Messages for you while you work:`) until the conversation fits `MR_AGENT_CONTEXT_CHARS`, keeping the first task message and the newest inbox message.
3. Tests, each failing before your change: with a delayed save, the picker is disabled until the save ends; six inbox batches with an 8000 character limit end under the limit with the task and the newest batch kept.
4. Run `node node_modules/vitest/vitest.mjs run tests/review-39-fixes.test.js tests/chat-pickers.test.js tests/chat-picker-layout.test.js tests/mr-agent-inbox.test.js tests/mr-agent.test.js` and report the counts.

**P386. Choosing a harness keeps Harness default (OpenCode).** Read this brief only. Commit each step as you finish it. Run every command in the foreground. Files: src/ui/FamilyTree.jsx (only `chooseChildHarness`, `chooseSubHarness`, `chooseNodeHarness` and the model checks in `askSetup`), src/ui/family.js (only the no-models check in `childFormProblem`), tests/harness-default-pick.test.js (new; add no test to another file except to keep an existing one passing), docs/agents/CHANGELOG.md.

On 2026-11-15 the orchestrator opened Add child, clicked the OpenCode pill and saw its first model (`beam-free`) picked instead of Harness default. P378 made the forms start at Harness default, but the three harness pickers still set `model` to the harness's first model.

1. `chooseChildHarness`, `chooseSubHarness` and `chooseNodeHarness` set `model` to `''` for every harness except `DIRECT_HARNESS`, which keeps today's first model (the effects that fill a Direct API model stay).
2. `childFormProblem` and `askSetup` accept an empty model for a CLI harness even when its model list is empty or failed: `This harness has no models.` and `Choose a model for this harness.` apply only to Direct API or to a non-empty model. `askSetup` saves an empty model as Harness default.
3. Tests, each failing before your change: after choosing OpenCode in Add child the draft model is empty; the same for Direct API picks its first model; `childFormProblem` for a CLI harness with no models and an empty model returns no problem; Direct API with no models still returns its problem.
4. Run `node node_modules/vitest/vitest.mjs run tests/harness-default-pick.test.js tests/family.test.js tests/family-tree.test.js` (skip a file that does not exist) and report the counts.

**P387. Review 40: the leftover recheck, empty models on the command line and the inbox bound (Codex, GPT-6.1 Sol, report).** Read this brief only. Change no file except the one you write. Your sandbox keeps git read-only: write the file in your worktree and the runner commits it. Files: docs/agents/AUDIT-2026-11-REVIEW-40.md.

1. Review `git diff 99b01912..22e7a452`: P382 (the runner rechecks a leftover process before it refuses), P384 (an agent at Harness default saves and runs with no model flag) and P385 (the chat picker waits for a save; `boundMessages` drops old inbox messages).
2. Look for: a lane still refused for a process that is gone, or let through while a real leftover runs; a home path or key in the refusal; an empty model that reaches a harness that needs one (Direct API, an endpoint, Codex or AGY with a profile); a command line with an empty argument or a dangling flag; a model check skipped for a non-empty model; a picker left disabled after a failed save or on another tab; `boundMessages` dropping the task message or the newest inbox message, or looping when one message alone is over the limit; a test that would pass with its change undone.
3. Each finding: `R40-N`, a severity (P1 blocks a push, P2 should be fixed soon, P3 small), the file and line, what goes wrong, how to see it, one fix in plain words. At most 10. No finding without a file and line you read.
4. End with `Checked and fine`. Under 100 lines. Plain words, no em dashes.

Review 40 fixes, P388 and P389. `docs/agents/AUDIT-2026-11-REVIEW-40.md` (P387, GPT-6.1 Sol): two P2 findings.

**P388. A leftover that hands off to a worker still blocks the lane (AGY, Hydrogen).** Read this brief and R40-1 only. Commit each step as you finish it. Run every command in the foreground. Files: scripts/run-lane.mjs (only `refuseRunningLane`), tests/leftover-recheck.test.js (add tests here), docs/agents/CHANGELOG.md.

1. After the 500 millisecond wait, `refuseRunningLane` refuses for any process in the second list that names the lane's worktree or folder the same way the first list's check does, not only for a first-list pid whose command is unchanged. A process that was in the first list and is gone from the second, with nothing new naming the worktree, still lets the lane start.
2. The refusal names the process found in the second list (its pid and program).
3. Tests, each failing before your change: pid 4141 running `node.exe C:/review-work/parent.js` in the first list and pid 4142 running `node.exe C:/review-work/worker.js` in the second, with `C:/review-work` as the worktree, refuses and names 4142; the same pid whose command changed but still names the worktree refuses; today's three P382 tests still pass.
4. Run `node node_modules/vitest/vitest.mjs run tests/leftover-recheck.test.js tests/run-lane.test.js` and report the counts.

**P389. An oversized inbox batch keeps its newest reply (Codex, GPT-6.1 Terra).** Read this brief and R40-2 only. Your sandbox keeps git read-only: write the files in your worktree and the runner commits them. Never run `npm install`; run tests as `node ../../node_modules/vitest/vitest.mjs run FILES` from your worktree. One baseline failure in your sandbox is known and not yours: `mr-agent > stops the whole shell tree on the time limit` needs `taskkill`; go on past it. Files: scripts/mr-agent.mjs (only `boundMessages` and the helpers it calls), tests/review-39-fixes.test.js (add tests here), docs/agents/CHANGELOG.md.

1. When an injected inbox message (one that starts `Messages for you while you work:`) must be cut, `boundMessages` drops its oldest replies first and keeps its heading and newest reply whole, instead of keeping the first 2000 characters. If the newest reply alone is over the limit, keep its last characters, not its first.
2. Other user messages are cut as today.
3. Tests: an 8000 character bound, a 1000 character system message, the task, then one inbox batch with a 7500 character older reply followed by `Newest order to keep.` ends under the bound with `Newest order to keep.` present and the task kept (this one fails before your change); a batch of two short replies under the bound is unchanged (a guard that passes before and after).
4. Run `node ../../node_modules/vitest/vitest.mjs run tests/review-39-fixes.test.js tests/mr-agent-inbox.test.js tests/mr-agent.test.js` and report the counts.

**P390. The orchestrator takes a harness at Harness default (OpenCode).** Read this brief only. Commit each step as you finish it. Run every command in the foreground. Files: server/orchestrator.js (only `setHarness`), tests/orchestrator-harness-default.test.js (new; add no test to another file except to keep an existing one passing), docs/agents/CHANGELOG.md.

Since P386 the orchestrator editor sends an empty model when the owner picks a new harness and leaves Harness default. `setHarness` in `server/orchestrator.js` refuses any empty model with `modelUnavailableProblem`, so the save fails with 400.

1. `setHarness` accepts an empty model for every harness except `machineroom` (Direct API), and saves the orchestrator with no model, as a fresh orchestrator already runs. A non-empty model is checked with `modelAllowed` as today. `machineroom` with an empty model is refused as today.
2. `setModel` does not change.
3. Tests, through the real `setHarness` (no mocked bridge), each failing before your change: a switch to `opencode` with model `''` and `confirmed: true` answers 200 and the orchestrator's model is empty; the same for `machineroom` answers 400; a switch with an unknown non-empty model still answers 400.
4. Run `node node_modules/vitest/vitest.mjs run tests/orchestrator-harness-default.test.js tests/orchestrator.test.js tests/control-contract.test.js` and report the counts.

**P391. Review 41: Harness default in the forms and the orchestrator, the leftover recheck and the inbox cut (Codex, GPT-6.1 Sol, report).** Read this brief only. Change no file except the one you write. Your sandbox keeps git read-only: write the file in your worktree and the runner commits it. Two baseline failures in your sandbox are known and not yours: the process tests in `tests/run-lane-stop.test.js` and `mr-agent > stops the whole shell tree on the time limit` need real processes and `taskkill`. Files: docs/agents/AUDIT-2026-11-REVIEW-41.md.

1. Review `git diff 7bd90c3d..620da061`: P386 (a harness pick keeps Harness default in Add child, a sub and the orchestrator editor), P388 (the leftover recheck refuses any process naming the worktree in the second list), P389 (an oversized inbox batch keeps its newest reply) and P390 (the orchestrator's `setHarness` takes an empty model).
2. Look for: an empty model sent to a route that still refuses it (follow each form's save to its real bridge route, not a mock); Direct API or an endpoint saved with no model; an orchestrator at an empty model whose command line, context window or label breaks; a lane refused forever by a process that is the runner itself or its parent; `boundMessages` dropping the task, looping, or keeping a cut reply that starts mid-word in a way that confuses the agent; a test that would pass with its change undone.
3. Each finding: `R41-N`, a severity (P1 blocks a push, P2 should be fixed soon, P3 small), the file and line, what goes wrong, how to see it, one fix in plain words. At most 10. No finding without a file and line you read.
4. End with `Checked and fine`. Under 100 lines. Plain words, no em dashes.

Review 41 fixes, P392 to P394. `docs/agents/AUDIT-2026-11-REVIEW-41.md` (P391, GPT-6.1 Sol): three P2 findings, and one gap the orchestrator saw in the room.

**P392. Harness default survives a restart and reaches a new sub (Codex, GPT-6.1 Terra).** Read this brief, R41-1 and R41-2 only. Your sandbox keeps git read-only: write the files in your worktree and the runner commits them. Never run `npm install`; run tests as `node ../../node_modules/vitest/vitest.mjs run FILES` from your worktree. Known sandbox baseline failures, not yours: process tests in `tests/run-lane-stop.test.js` and `tests/run-lane.test.js` that need real processes, `taskkill` or a worktree (EPERM). Files: server/orchestrator.js (only the saved-model restore near line 1328 and the constructor's model choice near line 962), server/orchestrators.js (only `subConfig`'s model near line 367), tests/harness-default-restart.test.js (new; add no test to another file except to keep an existing one passing), docs/agents/CHANGELOG.md.

1. R41-1: when the saved state holds `model` as a string, restore it even when it is empty, so an orchestrator saved at Harness default stays at Harness default after a restart. A saved state with no `model` key keeps today's lane fallback.
2. R41-2: an explicit empty model passed to the constructor, or saved on a sub, stays empty; the lane's model fills in only when no model was given at all (`undefined` or `null`). `machineroom` (Direct API) keeps needing a model as today.
3. Tests, through the real routes and a real restart on the same runs folder, each failing before your change: a main lane configured as Claude with `opus`, switched to OpenCode at `''`, then a new registry on the same folder, still has an empty model; a new OpenCode sub at `''` with an OpenCode lane that has a model answers with an empty model; a sub given a named model keeps it.
4. Run `node ../../node_modules/vitest/vitest.mjs run tests/harness-default-restart.test.js tests/orchestrator-harness-default.test.js tests/orchestrator.test.js tests/orchestrators.test.js` (skip a file that does not exist) and report the counts.

**P393. A cut inbox reply says it was cut (AGY, Hydrogen).** Read this brief and R41-3 only. Commit each step as you finish it. Run every command in the foreground. Files: scripts/mr-agent.mjs (only the inbox tail cut in `boundMessages`), tests/review-39-fixes.test.js (add tests here), docs/agents/CHANGELOG.md.

1. When the newest inbox reply must be cut to its tail, the kept text starts at a word boundary, keeps the reply's sender (`name:`) in front, and marks the cut: `name: [start cut] ...rest`. The whole message still fits the bound.
2. Tests, each failing before your change: R41-3's case keeps the sender and `[start cut]`, and the kept text never starts mid-word; the bound still holds and the task is kept.
3. Run `node node_modules/vitest/vitest.mjs run tests/review-39-fixes.test.js tests/mr-agent-inbox.test.js tests/mr-agent.test.js` and report the counts.

**P394. The orchestrator and lane editors offer Harness default (OpenCode).** Read this brief only. Commit each step as you finish it. Run every command in the foreground. Files: src/ui/FamilyTree.jsx (only the two node editor `ModelPicker`s near lines 1759 and 1865), tests/harness-default-pick.test.js (add tests here), docs/agents/CHANGELOG.md.

On 2026-11-15 the orchestrator switched the room's orchestrator to OpenCode in its editor. It saved at Harness default, but the editor's picker read `Choose a model` and had no Harness default row.

1. Both node editor pickers get `allowDefault` and the placeholder `Harness default` for every harness except `DIRECT_HARNESS`, the same way the Add child picker near line 2040 does.
2. Tests, each failing before your change: the orchestrator editor with OpenCode shows `Harness default` on its trigger and lists a Harness default row first; with Direct API it shows no default row.
3. Run `node node_modules/vitest/vitest.mjs run tests/harness-default-pick.test.js tests/family-tree.test.js` and report the counts.

## 2026-11-16: OpenCode batch (P395 to P400)

The owner asked for all OpenCode lanes on coding for an hour and a half. These six fix bugs and gaps found on 2026-11-15 and 2026-11-16; none adds a feature.

**P395. The ladder route checks a sub's model (OpenCode).** Read this brief only. Commit each step as you finish it. Run every command in the foreground. Files: server/orchestrators.js (only the ladder check loop after `readLadder` near line 899), tests/ladder-sub-model.test.js (new; add no test to another file except to keep an existing one passing), docs/agents/CHANGELOG.md.

`POST /api/orchestrator/ladder` checks each sub's harness but never its model, so a sub can be saved with a model its harness does not list, or a Direct API (`machineroom`) sub with no model.

1. In the loop that checks each sub's harness, for a sub that is new or whose harness or model changed from the saved ladder: a non-empty model must pass `modelAllowed(harness, model, folder)`, and a `machineroom` sub must have a model. Otherwise answer 400 with `modelUnavailableProblem(model, harness)`, collected like the harness problems. A sub that is saved and unchanged is not checked, so an old ladder still saves.
2. An empty model on any other harness is Harness default and passes.
3. Tests through the real ladder route, each failing before your change: a new OpenCode sub with an unknown model answers 400; a new `machineroom` sub with an empty model answers 400; a new OpenCode sub with an empty model answers 200; an unchanged saved sub with an unknown model does not block saving another sub.
4. Run `node node_modules/vitest/vitest.mjs run tests/ladder-sub-model.test.js tests/orchestrators.test.js tests/harness-default-restart.test.js` (skip a file that does not exist) and report the counts.

**P396. A model picker shows a saved model that is not in its list (OpenCode).** Read this brief only. Commit each step as you finish it. Run every command in the foreground. Files: src/ui/ModelPicker.jsx (only `shown` and `triggerText`), tests/model-picker-unlisted.test.js (new; add no test to another file except to keep an existing one passing), docs/agents/CHANGELOG.md.

On 2026-11-15 the chat's model picker read `Harness default` while the orchestrator ran `claude-opus-5-5`: its model list was still loading, so `shown` was null and the trigger fell back to the default text.

1. When `value` is not empty and no row matches it, the trigger shows `modelName(value)` (from `src/ui/modelRefresh.js`), never the default text or the placeholder. An empty `value` keeps today's text.
2. Tests, each failing before your change: a picker with `value="claude-opus-5-5"`, `allowDefault`, `placeholder="Harness default"` and no choices shows a name for that model, not `Harness default`; the same picker while loading does the same; an empty value with `allowDefault` still shows `Harness default`.
3. Run `node node_modules/vitest/vitest.mjs run tests/model-picker-unlisted.test.js tests/model-picker.test.js tests/chat-pickers.test.js tests/harness-default-pick.test.js` and report the counts.

**P397. A cut inbox reply keeps a sender name that has spaces (OpenCode).** Read this brief only. Commit each step as you finish it. Run every command in the foreground. Files: scripts/mr-agent.mjs (only the sender match in the inbox cut of `boundMessages`, near line 1368), tests/review-39-fixes.test.js (add tests here), docs/agents/CHANGELOG.md.

`readLaneInbox` writes each reply as `from: text`, and `from` can be a label with spaces such as `Eye check agent`. The cut's sender pattern `[^\s:]+` matches no such name, so the cut reply loses its sender.

1. The sender is the text before the first `: ` on the reply's first line, when that text is at most 80 characters. Keep today's behaviour otherwise.
2. Tests, each failing before your change: a cut reply from `Eye check agent` starts `Eye check agent: [start cut] `; the bound still holds and the task is kept.
3. Run `node node_modules/vitest/vitest.mjs run tests/review-39-fixes.test.js tests/mr-agent-inbox.test.js` and report the counts.

**P398. The scale probe retries a locked .git rename on Windows (OpenCode).** Read this brief only. Commit each step as you finish it. Run every command in the foreground. Files: scripts/scale-live.mjs (only `readPlainFolder` and `restoreGitFolder`), tests/scale-live-rename.test.js (new; add no test to another file except to keep an existing one passing), docs/agents/CHANGELOG.md.

CI on 2026-11-16 failed once on windows-latest: `tests/scale-live.test.js` threw `EPERM: operation not permitted, rename '...\2000-11\.git' -> '...\2000-11-git-away'`. A git process that had just exited still held the folder; a rerun passed.

1. Add a small rename helper in `scripts/scale-live.mjs` that retries `renameSync` on `EPERM`, `EBUSY` or `EACCES` up to 10 times, 100 milliseconds apart, and throws the last error after that. Any other error is thrown at once. Use it for the three renames in `readPlainFolder` and `restoreGitFolder`. Pass the rename and the wait in as arguments so the test needs no locked folder.
2. Tests, each failing before your change: a rename that fails twice with `EPERM` and then works succeeds; one that always fails with `EPERM` throws after 10 tries; one that fails with `ENOENT` throws at once.
3. Run `node node_modules/vitest/vitest.mjs run tests/scale-live-rename.test.js tests/scale-live.test.js` and report the counts.

**P399. LIMITS.md names the browser's six connections (OpenCode).** Read this brief only. Commit when done. Files: docs/agents/architecture/LIMITS.md (one new short section), docs/agents/CHANGELOG.md.

On 2026-11-16 three tabs of one room on the same address stalled every request for 30 seconds, and the page said `The bridge did not answer within 30 seconds.` while the bridge answered curl in 28 milliseconds. Each live room page holds two event streams (`src/live/bridge.js` and `src/control/client.js`), and a browser opens at most six connections to one host over HTTP/1.1.

1. Read both files to confirm the two streams. Then add a section to LIMITS.md: what happens, the numbers (two streams a page, six connections a host, so a third tab of the same room stalls the rest), how to see it, and what to do (close the other tabs, or open the room once on `127.0.0.1` and once on `localhost`, which count as two hosts). Plain words, short sentences, no em dashes, at most 12 lines.
2. Run `node node_modules/vitest/vitest.mjs run tests/docs.test.js` if it exists and report the counts.

**P400. The replay scrubber never gets NaN (OpenCode).** Read this brief only. Commit each step as you finish it. Run every command in the foreground. Files: src/ui/Transport.jsx (only the scrubber's `max` and `value`), tests/transport-scrubber.test.js (new; add no test to another file except to keep an existing one passing), docs/agents/CHANGELOG.md.

The test run prints `Received NaN for the max attribute` and `Received NaN for the value attribute`. The scrubber's range input in `src/ui/Transport.jsx` near line 247 rounds `duration` and `position`, which can be NaN before a recording loads.

1. The scrubber's `max` and `value` are finite numbers at all times: a duration or position that is not a finite number counts as 0, and the value never goes above the max.
2. Tests, each failing before your change: rendering the transport with `duration` and `position` as NaN gives the range input `max="0"` and `value="0"` and logs no NaN warning; a normal duration and position keep today's numbers.
3. Run `node node_modules/vitest/vitest.mjs run tests/transport-scrubber.test.js tests/transport-lanes.test.js tests/transport-orchestrators.test.js tests/transport-spend.test.js` and report the counts.

## 2026-11-16: The owner's answers to Argon's plan (P401 to P406)

On 2026-11-16 the owner answered `PLAN-NEXT-ARGON.md`: items 1, 2, 5, 6 and 8 are approved, 1 and 6 with additions, and item 7 is replaced by a same-harness rule. Each brief below names its plan item; read that item in `docs/agents/PLAN-NEXT-ARGON.md` too.

**P401. Codex offers Edits and Bypass (OpenCode). Plan item 8.** Read this brief and plan item 8 only. Commit each step as you finish it. Run every command in the foreground. Files: src/control/modes.js (only the `codex` list), src/harnesses/codex.js (only where a mode becomes command line flags), tests/codex-modes.test.js (new; add no test to another file except to keep an existing one passing), docs/agents/architecture/ROOM.md (only the sentence that lists each harness's modes, if there is one), docs/agents/CHANGELOG.md.

1. Run `codex exec --help` once on this machine and read which sandbox and approval flags it takes. Do not start a Codex run.
2. `modesFor('codex')` returns plan, edits, auto and bypass, in that order. Edits maps to the flags that let Codex write in its workspace with the narrowest command rights `codex exec --help` offers (for example `--sandbox workspace-write` with an approval policy that refuses commands, or `--full-auto` if nothing narrower exists; say in your report which and why). Bypass maps to `--dangerously-bypass-approvals-and-sandbox`. Plan and auto keep today's flags exactly.
3. Tests, each failing before your change: `modesFor('codex')` lists the four ids; the codex command for `edits` and for `bypass` holds the chosen flags; plan and auto command lines are unchanged.
4. Run `node node_modules/vitest/vitest.mjs run tests/codex-modes.test.js tests/harnesses.test.js tests/orchestrator-modes.test.js tests/lane-mode.test.js` (skip a file that does not exist) and report the counts.

**P402. A restricted sub's out-of-scope merge waits for the agent above (OpenCode). Plan item 6.** Read this brief and plan item 6 only. Commit each step as you finish it. Run every command in the foreground. Files: server/reviews.js (only the two merge routes and a helper they share), src/ui/panels/ReviewsPanel.jsx (only how a refused merge shows), tests/reviews-scope.test.js (new; add no test to another file except to keep an existing one passing), docs/agents/FREE-HIERARCHY.md (one short paragraph), docs/agents/CHANGELOG.md.

The owner's addition: the agent above the one whose lane went out of scope manages that review and is told about it.

1. A merge of a lane whose starter sub has `restricted: true` and whose branch changes files outside that sub's `scope` (use `outsideScope` from `src/model/hierarchy.js`) answers 409 with the list of files, unless the request says `allowOutside: true` and comes from the owner's page or from the orchestrator above that sub (its parent, by its token). The sub itself, and any other orchestrator, cannot allow it.
2. On the first refusal for a lane branch, the bridge posts one message to the orchestrator above the sub naming the lane and the files (use the existing orchestrator message path the room already uses for lane warnings). Do not post again for the same branch head.
3. Reviews shows the 409's files under the lane and a button `Merge anyway` that sends `allowOutside: true` after a confirm.
4. Tests through the real merge route, each failing before your change: a restricted sub's out-of-scope lane answers 409 with its files; the same with `allowOutside` from the owner page merges; from the sub's own token it still answers 409; from the parent's token it merges; the parent gets one message; an unrestricted sub merges as today.
5. Run `node node_modules/vitest/vitest.mjs run tests/reviews-scope.test.js tests/reviews.test.js` and report the counts.

**P403. A lane's mode in Agents and Dispatch, with an orchestrator's choice (Codex, GPT-6.1 Terra). Plan item 1.** Read this brief and plan item 1 only. Your sandbox keeps git read-only: write the files in your worktree and the runner commits them. Never run `npm install`; run tests as `node ../../node_modules/vitest/vitest.mjs run FILES` from your worktree. Known sandbox baseline failures, not yours: process tests in `tests/run-lane-stop.test.js` and `tests/run-lane.test.js` that need real processes, `taskkill` or a worktree (EPERM). Files: server/agents-config.js (only lane create and update), server/runs.js (only the run start's mode choice), src/ui/FamilyTree.jsx (only the Add child form and the lane editor), src/ui/panels/DispatchPanel.jsx (only a mode picker for the run), src/ui/panels/runs.js (only passing the mode), scripts/run-lane.mjs (only where the lane's saved mode is read, near line 1578), server/active-lanes.js and server/lanes-source.js (only adding the saved mode to the lane rows Agents and Dispatch read), tests/lane-mode-picker.test.js (new; add no test to another file except to keep an existing one passing), docs/agents/FREE-HIERARCHY.md (one short paragraph), docs/agents/CHANGELOG.md.

The owner's addition: a lane's mode can be set to `Orchestrator's choice`, and then the agent above it picks the mode for each run.

1. Creating or editing a lane saves `cli.mode`: one of `modesFor(harness)` (from `src/control/modes.js`), or `choice`, or nothing (today's default). Any other value is refused with 400.
2. Add child and the lane editor show a Mode select with the harness's modes and `Orchestrator's choice`, starting at the harness default.
3. Dispatch shows a Mode select for a run, starting at the lane's saved mode, and sends `mode` to `POST /api/control/runs`.
4. At run start: the owner's page may pick any of the lane's modes. An orchestrator's run takes the requested mode only when the lane's mode is `choice`; for a lane with a fixed mode, an orchestrator's different mode is refused with 400 naming the lane's mode. A `choice` lane with no mode requested runs at the harness default. The same holds in `run-lane`: a saved `choice` runs at the harness default unless `--mode` names a mode, so `src/briefs/run.js` never sees `choice`.
5. Tests, each failing before your change: a lane saved with `edits` keeps `cli.mode`; `choice` saves; an unknown mode is refused; Dispatch sends the chosen mode; an orchestrator's mode on a `choice` lane is used; on a fixed lane it is refused; the owner's mode on a fixed lane is used.
6. If one more file must change only to pass the saved mode through, change it and name it in your report; do not stop for that. Run `node ../../node_modules/vitest/vitest.mjs run tests/lane-mode-picker.test.js tests/agents-config.test.js tests/lane-mode.test.js` and report the counts.

**P404. An orchestrator makes new agents only on its own harness (OpenCode). Replaces plan item 7.** Read this brief only. Commit each step as you finish it. Run every command in the foreground. Files: server/family.js (only the proposal route), server/orchestrators.js (only the ladder route's check for subs an orchestrator adds), tests/same-harness-agents.test.js (new; add no test to another file except to keep an existing one passing), docs/agents/FREE-HIERARCHY.md (one short paragraph), docs/agents/CHANGELOG.md.

The owner's rule: subscriptions and usage change too often for an orchestrator to start agents on another harness. An orchestrator may make a new agent only on its own harness, with any model that harness lists; an AGY orchestrator on Argon may make a Hydrogen agent. The owner may make any agent.

1. A lane proposal from an orchestrator's token (`POST /api/family/proposals`) whose harness is not that orchestrator's harness answers 400 with `An orchestrator can add agents only on its own harness (HARNESS).`. The owner's proposals and approvals are not limited.
2. A ladder change from an orchestrator's token that adds a new sub on another harness than that orchestrator's answers 400 with the same message. A sub already saved is not checked again.
3. Tests through the real routes, each failing before your change: a Claude orchestrator proposing an OpenCode lane is refused; proposing a Claude lane with another Claude model is accepted; an AGY orchestrator adding an AGY sub on another model is accepted; adding a Codex sub is refused; the owner's page proposing any harness is accepted.
4. Run `node node_modules/vitest/vitest.mjs run tests/same-harness-agents.test.js tests/family.test.js tests/orchestrators.test.js tests/ladder-sub-model.test.js` (skip a file that does not exist) and report the counts.

**P405. A sub orchestrator's scope and restriction in Agents (AGY, Hydrogen). Plan item 2.** Read this brief and plan item 2 only. Commit each step as you finish it. Run every command in the foreground. Files: src/ui/FamilyTree.jsx (only the sub form, the sub editor and `subDraftFor`), src/ui/ladderForm.js, tests/sub-scope-form.test.js (new; add no test to another file except to keep an existing one passing), docs/agents/CHANGELOG.md.

1. The sub form and the sub editor show a Scope field (one glob a line, `**` by default) and a `Restricted` checkbox (off by default) with one plain line under it: `A restricted sub's lanes cannot merge files outside its scope without the orchestrator above.`
2. Saving sends `scope` as a list of trimmed, non-empty lines and `restricted` as a boolean through `saveLadder`; an empty scope saves `['**']`. Reopening the editor shows what was saved.
3. Tests, each failing before your change: creating a sub with scope `src/ui/**` and Restricted on saves both; editing a sub to `server/**` saves and reopens with it; an empty scope saves `['**']`.
4. Run `node node_modules/vitest/vitest.mjs run tests/sub-scope-form.test.js tests/family-tree-ui.test.js tests/ladder-form.test.js tests/family-ladder-ui.test.js` (skip a file that does not exist) and report the counts.

**P406. Chat dispatch and split runs offer a worktree choice (OpenCode). Plan item 5.** Read this brief and plan item 5 only. Commit each step as you finish it. Run every command in the foreground. Files: server/index.js (only `startLaneTask` near line 812), the route in server/orchestrators.js that calls `startLaneTask` (only passing `worktree` through), src/ui/OrchestratorChat.jsx (only a worktree toggle beside the lane send and passing it), src/ui/panels/runs.js (only `startSplitRun`), src/ui/panels/DispatchPanel.jsx (only a worktree toggle for split runs), tests/worktree-choice.test.js (new; add no test to another file except to keep an existing one passing), docs/agents/CHANGELOG.md. P403 also edits DispatchPanel.jsx and runs.js for a mode picker: touch only the worktree lines.

1. `startLaneTask(lane, taskText, { worktree })` uses the given boolean; when none is given it keeps today's `await isGitCheckout(projectRoot)`. A worktree is never used outside a git checkout, whatever is asked.
2. A chat message sent straight to a lane carries the owner's choice from a `Separate worktree` checkbox beside the send (on by default in a git checkout, as today). An orchestrator's own dispatch keeps today's default.
3. `startSplitRun` sends the Dispatch panel's `Separate worktree` choice (on by default) instead of always `true`.
4. Tests, each failing before your change: a direct lane message with the box off starts the task with `worktree: false`; a split run with the box off sends `worktree: false`; with no choice given both keep today's value; outside a git checkout `worktree: true` is never used.
5. Run `node node_modules/vitest/vitest.mjs run tests/worktree-choice.test.js tests/project-task.test.js tests/control-panels.test.js` and report the counts.

**P407. Lane mode pickers leave out Ask (OpenCode).** Read this brief only. Commit each step as you finish it. Run every command in the foreground. Files: src/control/modes.js (add one exported helper only), src/ui/FamilyTree.jsx (only the two lane Mode selects P403 added), src/ui/panels/DispatchPanel.jsx (only the run's Mode select), server/agents-config.js (only the two mode checks P403 added), tests/lane-mode-picker.test.js (add tests here), docs/agents/CHANGELOG.md.

P403 offers every mode of `modesFor(harness)` for a lane, but a lane run is headless: `server/runs.js` refuses Ask with `A lane run has nobody to ask, so the ask mode is for orchestrators only.` So the owner can pick a mode that always fails.

1. Add `laneModesFor(harness)` to `src/control/modes.js`: `modesFor(harness)` without `ask`.
2. The Add child and lane editor Mode selects and the Dispatch run's Mode select use `laneModesFor`. Orchestrator mode pickers keep `modesFor`.
3. Lane create and update in `server/agents-config.js` accept `choice` or an id of `laneModesFor(harness)`; `ask` is refused with the same 400 as an unknown mode.
4. Tests, each failing before your change: `laneModesFor('claude')` has no `ask`; the Add child Mode select for Claude Code lists no Ask; saving a lane with `ask` answers 400.
5. Run `node node_modules/vitest/vitest.mjs run tests/lane-mode-picker.test.js tests/modes.test.js tests/agents-config.test.js` and report the counts.

**P408. The chat's Separate worktree choice reaches the bridge (OpenCode).** Read this brief only. Commit each step as you finish it. Run every command in the foreground. Files: src/control/client.js (only `sendOrchestrator`), src/control/mock.js or the mock client file next to it (only its `sendOrchestrator`, if it has one), tests/worktree-choice.test.js (add tests here), docs/agents/CHANGELOG.md.

P406 added a `Separate worktree` box beside a chat message sent to a lane and calls `client.sendOrchestrator(text, { id, worktree })`, but the real `sendOrchestrator` in `src/control/client.js` sends only `text`, `id` and `confirmed`, so the bridge never sees the choice. P406's test used a mock client.

1. `sendOrchestrator(text, { id, worktree })` adds `worktree` to the body when it is a boolean; otherwise the body is as today.
2. Tests through the real `createClient` with a stubbed `fetch`, each failing before your change: `worktree: false` is in the posted body; leaving it out sends no `worktree` key.
3. Run `node node_modules/vitest/vitest.mjs run tests/worktree-choice.test.js tests/control-client.test.js` (skip a file that does not exist) and report the counts.

**P409. Review 42: the owner's plan items and the OpenCode batch (Codex, GPT-6.1 Sol, report).** Read this brief only. Change no file except the one you write. Your sandbox keeps git read-only: write the file in your worktree and the runner commits it. Known sandbox baseline failures, not yours: process tests in `tests/run-lane-stop.test.js`, `tests/run-lane.test.js` and `mr-agent > stops the whole shell tree on the time limit` need real processes and `taskkill`. Files: docs/agents/AUDIT-2026-11-REVIEW-42.md.

1. Review `git diff a62c762f..164849c4`: P395 (ladder sub models), P396 (unlisted saved model), P397 and P400 (inbox sender, scrubber NaN), P398 (rename retry), P401 (Codex Edits and Bypass), P402 (restricted sub merges), P403 and P407 (lane modes, Orchestrator's choice, no Ask), P404 (same-harness agents), P405 (sub scope fields), P406 and P408 (worktree choice).
2. Look for: an orchestrator that can set a fixed lane's mode, or pick Bypass for a lane the owner did not set to choice; a Codex Bypass reached without the owner choosing it; an out-of-scope merge that a sub can allow for itself, or that slips through the project fast forward; a parent never told, or told on every poll; an orchestrator that can still add an agent on another harness by any route (proposal, ladder, lane create, team build); a worktree used outside a git checkout, or several lanes started in one folder with no warning; a saved scope that does not reach the merge check; a picker or route that refuses a mode the runner accepts, or the reverse; a test that would pass with its change undone.
3. Each finding: `R42-N`, a severity (P1 blocks a push, P2 should be fixed soon, P3 small), the file and line, what goes wrong, how to see it, one fix in plain words. At most 10. No finding without a file and line you read.
4. End with `Checked and fine`. Under 100 lines. Plain words, no em dashes.

Review 42 fixes, P410 to P413. `docs/agents/AUDIT-2026-11-REVIEW-42.md` (P409, GPT-6.1 Sol): four P1 and two P2 findings. Read only the findings your brief names.

**P410. The scope gate refuses when it cannot read the files, and sees renames (OpenCode).** Read this brief, R42-1 and R42-2 only. Commit each step as you finish it. Run every command in the foreground. Files: server/reviews.js (only `scopeRefusal`), tests/reviews-scope.test.js (add tests here), docs/agents/CHANGELOG.md.

1. R42-1: when the changed-file read fails for a restricted sub's lane, the merge answers 409 with `The bridge could not read the lane's changed files, so it was not merged.` (unless `allowOutside` is allowed as today).
2. R42-2: the changed-file read passes `--no-renames`, so a moved file names both its old and new path.
3. Tests through the real merge route, each failing before your change: a git stub that fails only the changed-file read gives 409; a lane restricted to `src/**` that moves `docs/a.md` to `src/a.md` gives 409 naming `docs/a.md`.
4. Run `node node_modules/vitest/vitest.mjs run tests/reviews-scope.test.js tests/reviews.test.js` and report the counts.

**P411. Switching an orchestrator's harness never carries an implied Bypass (OpenCode).** Read this brief and R42-3 only. Commit each step as you finish it. Run every command in the foreground. Files: server/orchestrator.js (only how `setHarness` picks the new mode, near line 2389), tests/harness-switch-mode.test.js (new; add no test to another file except to keep an existing one passing), docs/agents/CHANGELOG.md.

1. On a harness change, the new mode is the owner's saved mode (the `mode` variable as saved, never `legacyMode`) when the new harness offers it and it is not `bypass`; otherwise it is `defaultMode(newHarness)`. Bypass is set only by `setMode`, which the owner confirms.
2. Tests through the real `createOrchestrator`, each failing before your change: a restored Claude orchestrator with no saved mode switched to Codex runs in `auto` and its command has no `--dangerously-bypass-approvals-and-sandbox`; one saved in `bypass` switched to Codex is `auto`; one saved in `plan` switched to Codex stays `plan`.
3. Run `node node_modules/vitest/vitest.mjs run tests/harness-switch-mode.test.js tests/orchestrator.test.js tests/orchestrator-modes.test.js tests/orchestrator-harness-default.test.js` and report the counts.

**P412. A failover keeps the backup's fixed mode, and Choice needs a harness with modes (AGY, Hydrogen).** Read this brief, R42-4 and R42-6 only. Commit each step as you finish it. Run every command in the foreground. Files: scripts/run-lane.mjs (only `startFailover`'s mode, near line 1742, and the saved `choice` read near line 1580), server/agents-config.js (only the two mode checks), tests/failover-mode.test.js (new; add no test to another file except to keep an existing one passing), docs/agents/CHANGELOG.md.

1. R42-4: in `startFailover`, a backup lane whose saved `cli.mode` is a fixed mode (not empty and not `choice`) runs in its own saved mode; the primary's mode is carried only to a backup saved as `choice` or with no mode.
2. R42-6: lane create and update accept `choice` only when `defaultMode(harness)` is not null; otherwise 400 with today's unknown-mode message. In `run-lane`, a saved `choice` on such a harness is treated as no mode.
3. Tests, each failing before your change: a choice primary run in `bypass` failing over to a Codex backup saved as `plan` starts the backup in `plan`; a backup saved as `choice` gets the primary's mode; creating a Hermes lane with `choice` answers 400.
4. Run `node node_modules/vitest/vitest.mjs run tests/failover-mode.test.js tests/failover-ticket-mode.test.js tests/lane-mode-picker.test.js tests/agents-config.test.js` and report the counts.

**P413. A new sub keeps the harness it was checked for (OpenCode).** Read this brief and R42-5 only. Commit each step as you finish it. Run every command in the foreground. Files: server/orchestrator.js (only the saved-state restore near line 1327), server/orchestrators.js (only where a sub's instance is made), tests/sub-restore-harness.test.js (new; add no test to another file except to keep an existing one passing), docs/agents/CHANGELOG.md. P411 also edits server/orchestrator.js, in `setHarness` only: touch only the restore.

1. When a sub's instance is made with a harness and its saved state names another harness, the restore keeps the given harness and model and drops the saved session ids, mode and model that belonged to the other harness. A restore with the same harness is as today.
2. Tests through the real routes, each failing before your change: the owner creates and removes a Codex sub, then a Claude orchestrator adds a Claude sub with that id; the new instance answers `claude`; a sub restored on its own harness keeps its session.
3. Run `node node_modules/vitest/vitest.mjs run tests/sub-restore-harness.test.js tests/orchestrators.test.js tests/same-harness-agents.test.js tests/harness-default-restart.test.js` and report the counts.

**P414. Review 43: the review 42 fixes (Codex, GPT-6.1 Sol, report).** Read this brief and `docs/agents/AUDIT-2026-11-REVIEW-42.md` only. Change no file except the one you write. Your sandbox keeps git read-only: write the file in your worktree and the runner commits it. Known sandbox baseline failures, not yours: process tests in `tests/run-lane-stop.test.js`, `tests/run-lane.test.js` and `mr-agent > stops the whole shell tree on the time limit`. Files: docs/agents/AUDIT-2026-11-REVIEW-43.md.

1. Review `git diff 99f7e3a6..66c4da38`: P410 (scope read refuses on failure, `--no-renames`), P411 (no implied Bypass on a harness switch), P412 (failover keeps a backup's fixed mode, Choice needs modes) and P413 (a new sub keeps its checked harness).
2. For each of R42-1 to R42-6, say whether it is fixed, with the line that fixes it, and try the finding's own reproduction again. Then look for what the fixes broke: a restricted merge refused forever when the owner allows it; an orchestrator that loses a mode the owner set; a failover that now refuses where it worked; a sub that loses its own conversation after a restart; a test that would pass with its change undone.
3. Each new finding: `R43-N`, a severity, the file and line, what goes wrong, how to see it, one fix. At most 8. No finding without a file and line you read.
4. End with `Checked and fine`. Under 80 lines. Plain words, no em dashes.

## 2026-11-16: After the shutdown (P415 to P418)

Small follow-ups found while merging P395 to P413. None adds a feature.

**P415. ROOM.md and FREE-HIERARCHY.md describe the new controls (AGY, Argon, docs).** Read this brief only. Commit each step as you finish it. Run every command in the foreground. Change only docs. Files: docs/agents/architecture/ROOM.md, docs/agents/FREE-HIERARCHY.md, docs/agents/architecture/LIVE.md (only the routes these change), docs/agents/CHANGELOG.md.

1. Read the code, not the briefs, for each of these and write what the owner sees and what the bridge does, in plain words, short sentences, no em dashes: the lane Mode select in Add child, the lane editor and Dispatch, with `Orchestrator's choice` and no Ask (`src/ui/FamilyTree.jsx`, `src/ui/panels/DispatchPanel.jsx`, `server/runs.js`); the sub Scope field and Restricted box (`src/ui/FamilyTree.jsx`); a restricted sub's out-of-scope merge and `Merge anyway` (`server/reviews.js`, `src/ui/panels/ReviewsPanel.jsx`); the `Separate worktree` box in the chat and for split runs (`src/ui/OrchestratorChat.jsx`, `src/ui/panels/runs.js`); Codex Edits and Bypass (`src/control/modes.js`, `src/harnesses/codex.js`); an orchestrator adds agents only on its own harness (`server/family.js`, `server/orchestrators.js`); a ladder sub's model check (`server/orchestrators.js`).
2. Put each in the one place it belongs (ROOM.md for what the owner sees, FREE-HIERARCHY.md for who may do what, LIVE.md for a route's body and answers). Fix any sentence these changes made wrong. Add nothing the code does not do.
3. Run `node node_modules/vitest/vitest.mjs run tests/docs.test.js tests/briefs.test.js` (skip a file that does not exist) and report the counts.

**P416. The sub scope box and the chat's worktree box use classes, not inline styles (OpenCode).** Read this brief only. Commit each step as you finish it. Run every command in the foreground. Files: src/ui/FamilyTree.jsx (only the scope `textarea` near line 80), src/ui/OrchestratorChat.jsx (only the `mr-orch-worktree` label near line 309), src/styles.css (two new rules), tests/inline-style.test.js (new; add no test to another file except to keep an existing one passing), docs/agents/CHANGELOG.md.

1. Move the scope textarea's inline `style` to a class `mr-side-scope` in `src/styles.css`, and the worktree label's inline `style` to its existing class `mr-orch-worktree`. Same look: keep the values. Use the 8px spacing base where a value is close (4px stays 4px).
2. Tests, each failing before your change: neither element has a `style` attribute when rendered; `src/styles.css` holds both rules.
3. Run `node node_modules/vitest/vitest.mjs run tests/inline-style.test.js tests/sub-scope-form.test.js tests/worktree-choice.test.js` and report the counts.

**P417. Codex's Edits mode says what it really allows (OpenCode).** Read this brief only. Commit each step as you finish it. Run every command in the foreground. Files: src/control/modes.js (only how a mode's line is chosen), tests/codex-modes.test.js (add tests here), docs/agents/CHANGELOG.md.

Codex has no edits-only sandbox, so P401 maps Codex Edits to `--sandbox workspace-write`, the same as Auto. The shared Edits line `Edits files. Runs no commands.` is then false for Codex.

1. `modesFor('codex')` returns Edits with the line `Edits files and can run commands inside its workspace sandbox. Codex has no edits-only mode.` Every other harness's lines stay as they are.
2. Tests, each failing before your change: Codex's Edits line is the new one; Claude Code's Edits line is unchanged.
3. Run `node node_modules/vitest/vitest.mjs run tests/codex-modes.test.js tests/modes.test.js tests/orchestrator-modes.test.js` and report the counts.

**P418. The inbox cut in `boundMessages` is shorter (OpenCode).** Read this brief only. Commit each step as you finish it. Run every command in the foreground. Files: scripts/mr-agent.mjs (only the inbox branch of `boundMessages`), docs/agents/CHANGELOG.md. Add no test and change no test.

P393 and P397 left about 40 lines for one rule: keep the inbox heading, keep the newest reply's sender, mark `[start cut]`, start on a whole word, fit the bound.

1. Rewrite that branch to do the same in as few plain lines as you can. Keep behaviour identical: every test in `tests/review-39-fixes.test.js`, `tests/mr-agent-inbox.test.js` and `tests/mr-agent.test.js` must pass unchanged.
2. Run `node node_modules/vitest/vitest.mjs run tests/review-39-fixes.test.js tests/mr-agent-inbox.test.js tests/mr-agent.test.js` before and after and report both counts, and the line count of the branch before and after.

**P419. The inspector shows the orchestrator's live harness and model (OpenCode).** Read this brief only. Commit each step as you finish it. Run every command in the foreground. Files: src/ui/agentContext.js (only `withOrchestratorData`), tests/inspector-orchestrator-harness.test.js (new; add no test to another file except to keep an existing one passing), docs/agents/CHANGELOG.md.

On 2026-11-16 the room's orchestrator ran on OpenCode at Harness default (`/api/orchestrator` said `opencode`, model `""`), but the inspector said `Harness claude`: `withOrchestratorData` copies only the context numbers and autocompact from the live orchestrator, so the harness and model come from the lane config.

1. `withOrchestratorData` also copies `harness` from the live main orchestrator row when it is a non-empty string, and `model` when it is a string; an empty model shows as `Harness default` (use `modelName` from `src/ui/modelRefresh.js` if it already gives that for an empty id, else the plain text).
2. Tests, each failing before your change: an orchestrator agent whose lane says `claude` with a live row saying `opencode` and model `""` gives harness `opencode` and model `Harness default`; a live row with `claude-opus-5-5` gives that model's name.
3. Run `node node_modules/vitest/vitest.mjs run tests/inspector-orchestrator-harness.test.js tests/agent-context.test.js tests/inspector.test.js` (skip a file that does not exist) and report the counts.

**P420. A harness's model list command is read from its subcommands only (OpenCode).** Read this brief only. Commit each step as you finish it. Run every command in the foreground. Files: server/harness-models.js (only `parseHelpForListCommand` and the no-list-command answer after it), tests/help-list-command.test.js (new; add no test to another file except to keep an existing one passing), docs/agents/CHANGELOG.md.

On 2026-11-16 the Codex model picker showed a red `The command failed with exit code 1.` while its list was fine. `parseHelpForListCommand` falls back to `\bmodel\b` anywhere in `codex --help`, which matches the `-m, --model <MODEL>` option, so the room runs `codex model`, which does not exist.

1. Only a subcommand counts: a line of the help text that starts with whitespace, then `models list`, `model list`, `list-models`, `models` or `model` as its first word, then whitespace or the end of the line. Options such as `--model` and words inside sentences never count.
2. When there is no list command, answer the static models with no `error`, so the picker shows the known models without a red line.
3. Tests, each failing before your change: Codex-like help text with only `-m, --model <MODEL>` and sentences that say "model" gives no list command; help with a `  models     List models` line gives `['models']`; a harness with no list command answers its static models and no error.
4. Run `node node_modules/vitest/vitest.mjs run tests/help-list-command.test.js tests/harness-models.test.js` (skip a file that does not exist) and report the counts.

Review 43 fixes, P421 and P422. `docs/agents/AUDIT-2026-11-REVIEW-43.md` (P414, GPT-6.1 Sol): all six R42 findings are fixed; two P2 findings remain.

**P421. A failed scope read still offers Merge anyway (OpenCode).** Read this brief and the review 43 finding about failed scope reads only. Commit each step as you finish it. Run every command in the foreground. Files: server/reviews.js (only the 409 body `scopeRefusal` answers when the changed-file read fails), src/ui/panels/ReviewsPanel.jsx (only if it needs a change to offer `Merge anyway` for that answer), tests/reviews-scope.test.js (add tests here), docs/agents/CHANGELOG.md.

1. The 409 for a failed changed-file read carries `outside: true` and `files: []`, so the page treats it like an out-of-scope refusal: it shows the error and offers `Merge anyway`, which sends `allowOutside: true` as today. With no files, the page shows the error line and no file list.
2. Tests, each failing before your change: the failed-read 409 body has `outside: true`; the Reviews panel given that refusal shows `Merge anyway`.
3. Run `node node_modules/vitest/vitest.mjs run tests/reviews-scope.test.js tests/reviews.test.js` and report the counts.

**P422. The sub restore test fails when the fix is undone (OpenCode).** Read this brief and the review 43 finding about the sub restore test only. Commit each step as you finish it. Run every command in the foreground. Files: tests/sub-restore-harness.test.js only. Change no source file.

1. Make the test keep the saved conversation of the old harness on disk until the new sub restores it (do not overwrite the fixture before the restore), so it checks that P413 drops that conversation's sessions and mode.
2. Prove it: undo P413's guards in `server/orchestrator.js` locally, run the test and see it fail, then restore the file exactly (`git checkout -- server/orchestrator.js`) and see it pass. Commit only the test.
3. Run `node node_modules/vitest/vitest.mjs run tests/sub-restore-harness.test.js tests/orchestrators.test.js` and report the counts, and the failing count with the guards undone.

**P423. Three tests that fail under load or inside a merge (OpenCode).** Read this brief only. Commit each step as you finish it. Run every command in the foreground. Files: tests/git.test.js, tests/bridge.test.js, tests/lanes-source.test.js, tests/helpers/ (only if a shared helper fixes more than one), server/lanes-source.js (only `mainCheckoutOf`, and only if step 3 shows the cause is there), docs/agents/CHANGELOG.md. Change no other source file.

On 2026-11-16 these failed once each during `npm run merge-lane` while other lanes were running tests, and passed alone:
- `tests/git.test.js` > `creates a new branch without switching to it and sends notice`: `listenForChange` aborted after its fixed 10 second timer (line 130).
- `tests/bridge.test.js` > `returns the file tree for both git repositories and plain folders`: `TimeoutError` after about 11 seconds.
- `tests/lanes-source.test.js` > X15 `shows a worktree run when the room root is the repository main checkout`: `mainCheckoutOf(worktree)` answered the real `C:\GitHub\MachineRoom` instead of the test's temporary repository (line 672).

1. For the two timeouts: find what waits, and make the wait follow the test's own timeout or a shared constant, not a short fixed timer, so a busy machine does not fail them. Do not just raise a number without saying why in one line.
2. For X15: find why git resolved the real repository. Check whether a `GIT_DIR`, `GIT_WORK_TREE`, `GIT_INDEX_FILE` or `GIT_COMMON_DIR` from the parent process (a merge or hook) reaches the test's git calls or `mainCheckoutOf`. If so, the test helpers run git with those variables removed, and `mainCheckoutOf` does the same if it spawns git. Prove it: run the X15 test with `GIT_DIR` set to this repository's `.git` and see it fail before your change and pass after.
3. Run `node node_modules/vitest/vitest.mjs run tests/git.test.js tests/bridge.test.js tests/lanes-source.test.js` and report the counts, and the X15 result with `GIT_DIR` set before and after.

**P424. Review 44: the follow-ups after the shutdown (Codex, GPT-6.1 Sol, report).** Read this brief only. Change no file except the one you write. Your sandbox keeps git read-only: write the file in your worktree and the runner commits it. Known sandbox baseline failures, not yours: process tests in `tests/run-lane-stop.test.js`, `tests/run-lane.test.js` and `mr-agent > stops the whole shell tree on the time limit`. Files: docs/agents/AUDIT-2026-11-REVIEW-44.md.

1. Review `git diff 66c4da38..ba2a37a9`: P415 (docs for the new controls), P416 (classes for the scope and worktree boxes), P417 (Codex Edits line), P418 (shorter inbox cut), P419 (inspector shows the live orchestrator), P420 (model list command from subcommands only), P421 (failed scope read offers Merge anyway), P422 (sub restore test).
2. Look for: a doc sentence the code contradicts; an inbox cut whose behaviour changed (sender, `[start cut]`, word start, bound); a harness whose real model list command is no longer found (check the help text of `opencode`, `agy`, `codex` and `copilot` if their help is in the tests or fixtures); an inspector that shows a sub's or lane's harness wrongly now; a Merge anyway that sends `allowOutside` for a refusal that is not a scope refusal; a test that would pass with its change undone.
3. Each finding: `R44-N`, a severity, the file and line, what goes wrong, how to see it, one fix. At most 8. No finding without a file and line you read.
4. End with `Checked and fine`. Under 80 lines. Plain words, no em dashes.

Review 44 fixes, P425 and P426. `docs/agents/AUDIT-2026-11-REVIEW-44.md` (P424, GPT-6.1 Sol): two P2 findings.

**P425. Only Main takes Main's live harness in the inspector and dock (OpenCode).** Read this brief and R44-1 only. Commit each step as you finish it. Run every command in the foreground. Files: src/ui/agentContext.js (only `withOrchestratorData` or the line that calls it), tests/inspector-orchestrator-harness.test.js (add tests here), docs/agents/CHANGELOG.md.

1. The live harness and model from P419 apply only when the selected agent is Main itself: its `key` or `id` is `orchestrator` or `agent-orchestrator`, not any name holding `orchestrat`. The context numbers and autocompact keep today's rule.
2. Tests, each failing before your change: a Codex lane named `Codex orchestrator helper` with Main's row on `claude` and `opus` keeps `codex` and its own model; a sub named `UI orchestrator` keeps its own harness; Main still shows its live harness.
3. Run `node node_modules/vitest/vitest.mjs run tests/inspector-orchestrator-harness.test.js tests/agent-context.test.js` and report the counts.

**P426. FREE-HIERARCHY.md says a failed scope read sends no message (OpenCode).** Read this brief and R44-2 only. Commit when done. Change only docs. Files: docs/agents/FREE-HIERARCHY.md (only lines 24 and 45 and the sentences they repeat), docs/agents/CHANGELOG.md.

1. Say that the parent is told once per branch head only when the lane changed files outside the scope. A refused merge because the changed files could not be read sends no message; the owner or the orchestrator above can still allow it with `Merge anyway`. Read `server/reviews.js` `scopeRefusal` to confirm before writing. Plain words, no em dashes.
2. Run `node node_modules/vitest/vitest.mjs run tests/docs.test.js` if it exists and report the counts.

**P427. Plan the next round of fixes (AGY, Argon, plan).** Read this brief, `docs/agents/FREE-HIERARCHY.md`, `docs/agents/architecture/LIMITS.md` and the last three review files (`AUDIT-2026-11-REVIEW-42.md` to `-44.md`) only. Change no file except the one you write. Commit when done. Files: docs/agents/PLAN-NEXT-ARGON-2.md.

1. Find up to 8 gaps in the code on `main` that are bugs, missing checks, untested paths or docs the code contradicts, in the free hierarchy (orchestrators, subs, lanes, modes, scopes, worktrees, messages, failover, reviews). Read the code for each; no gap without a file and line you read.
2. Leave out anything that changes what the owner sees or adds a feature; list such ideas separately at the end under `Needs the owner's yes`, one line each.
3. For each gap: the gap in one or two sentences with file and line, the files a fix touches, the test that would fail before the fix, a size (minutes) and a harness (OpenCode for small, Codex Terra for server work across files, AGY Hydrogen for UI that touches no CSS).
4. Rank by risk to the owner's work. Under 90 lines. Plain words, no em dashes.

**P428. Review 45: P423 to P426 (Codex, GPT-6.1 Sol, report).** Read this brief only. Change no file except the one you write. Your sandbox keeps git read-only: write the file in your worktree and the runner commits it. Known sandbox baseline failures, not yours: process tests in `tests/run-lane-stop.test.js`, `tests/run-lane.test.js` and `mr-agent > stops the whole shell tree on the time limit`. Files: docs/agents/AUDIT-2026-11-REVIEW-45.md.

1. Review `git diff ba2a37a9..562a7441`: P423 (three load flakes and the GIT_ variables stripped from the main checkout lookup), P424 (review 44), P425 (only the main orchestrator takes the live harness in the inspector), P426 (FREE-HIERARCHY doc fix).
2. Look for: a git call in `server/` that still inherits GIT_DIR, GIT_WORK_TREE, GIT_INDEX_FILE or GIT_COMMON_DIR from a parent process and so reads the wrong repository; the same env stripping written twice where one helper would do; a test made less strict by the flake fixes (a timeout that hides a real hang, a wait that passes on any state); an agent other than the main orchestrator that still shows the live harness, or the main one that no longer does; a doc sentence the code contradicts.
3. Each finding: `R45-N`, a severity, the file and line, what goes wrong, how to see it, one fix. At most 8. No finding without a file and line you read.
4. End with `Checked and fine`. Under 80 lines. Plain words, no em dashes.

Review 45 fixes, P429. `docs/agents/AUDIT-2026-11-REVIEW-45.md` (P428, GPT-6.1 Sol): two findings, both about the git variables a parent process passes down.

**P429. Every server git call drops the parent's repository variables (Codex, Terra).** Read this brief and `docs/agents/AUDIT-2026-11-REVIEW-45.md` only. Known sandbox baseline failures, not yours: process tests in `tests/run-lane-stop.test.js`, `tests/run-lane.test.js` and `mr-agent > stops the whole shell tree on the time limit`. Files: server/programPath.js (add the helper), server/git.js, server/index.js, server/runs.js, server/orchestrators.js, server/orchestrator.js, server/reviews.js, server/lanes-source.js, tests/helpers/gitEnv.js, tests/git-env.test.js (new), docs/agents/CHANGELOG.md. If one more server file spawns git and must change only to use the helper, change it and name it; do not stop for that.

1. Add `gitEnv(base = process.env)` beside `gitPath` in `server/programPath.js`: a copy of `base` with GIT_DIR, GIT_WORK_TREE, GIT_INDEX_FILE and GIT_COMMON_DIR removed in any letter case. Every other key stays.
2. Use it at every git spawn in `server/`: `server/git.js:101`, `server/index.js:152` and `:193`, `server/runs.js:108` and `:132`, `server/orchestrators.js:94`, `server/orchestrator.js:1596`, `server/reviews.js:105` (replace its three-name loop) and `server/lanes-source.js:166` (replace its loop). Keep each caller's own settings (`GIT_TERMINAL_PROMPT`, `extraEnv`, hooks path) layered on top. Do not touch the spawns of agents, only of git.
3. `tests/helpers/gitEnv.js` reuses the server helper instead of its own set.
4. Tests in `tests/git-env.test.js`, each failing before your change: `gitEnv` drops all four names in mixed case and keeps others; the review runner (`defaultGitRunner` in `server/reviews.js`) with GIT_COMMON_DIR set to another repository's git directory still reads its own worktree's HEAD; `server/git.js`'s runner with GIT_DIR set to another repository reads the folder it was given (a plain temp folder rejects).
5. Run `node node_modules/vitest/vitest.mjs run tests/git-env.test.js tests/git.test.js tests/reviews.test.js tests/reviews-scope.test.js tests/lanes-source.test.js tests/orchestrators.test.js` and report the counts.

Argon's second plan, P430 to P434. `docs/agents/PLAN-NEXT-ARGON-2.md` (P427, Gemini 4 Argon) lists eight gaps. Each brief below adds its tests in a file of its own so the merges do not collide. If a gap does not reproduce on `main`, write that in your report with the file and line you read, and change nothing for it.

**P430. Failover never carries the primary's mode onto a backup with no saved mode (OpenCode).** Read this brief and item 1 of `docs/agents/PLAN-NEXT-ARGON-2.md` only. Commit each step as you finish it. Run every command in the foreground. Files: scripts/run-lane.mjs (only `startFailover`), tests/failover-default-mode.test.js (new), docs/agents/CHANGELOG.md.

1. In `startFailover`, the primary's mode is carried only when the backup's saved `cli.mode` is `choice`. A backup with no saved mode, or an empty one, runs at its own harness's default as if it had started alone, never at the primary's mode. A fixed backup mode stays as today.
2. Tests, each failing before your change: a `claude` primary in `bypass` failing over to a `codex` backup with no `cli.mode` builds codex args with `--sandbox workspace-write` and without `--dangerously-bypass-approvals-and-sandbox`; a primary in `plan` failing over to a `choice` backup still carries `plan`. Follow how `tests/failover-mode.test.js` builds its lanes and reads the args.
3. Run `node node_modules/vitest/vitest.mjs run tests/failover-default-mode.test.js tests/failover-mode.test.js tests/run-failover.test.js` and report the counts.

**P431. A sub token cannot start, stop or merge outside its own sector (Codex, Terra).** Read this brief and items 2, 3 and 4 of `docs/agents/PLAN-NEXT-ARGON-2.md` only. Known sandbox baseline failures, not yours: process tests in `tests/run-lane-stop.test.js`, `tests/run-lane.test.js` and `mr-agent > stops the whole shell tree on the time limit`. Files: server/orchestrators.js (the bare-lane branch of the message route and `POST /api/orchestrator/stop`), server/runs.js (`POST /api/control/runs/stop`), server/reviews.js (the merge route's caller check), tests/sub-token-gates.test.js (new), tests/reviews-scope.test.js and tests/orchestrators.test.js (only to update an existing test whose expected status this brief changes, such as the 409 for `other-token` at `tests/reviews-scope.test.js:286` that becomes 403, or to add the sector lookup to a registry fixture), docs/agents/CHANGELOG.md, docs/agents/FREE-HIERARCHY.md (one sentence if it says otherwise). If one more file must change only to pass the actor through or to keep an existing test's fixture working, change it and name it; do not stop for that. Also a known flake, not yours: the removed-sub test in `tests/orchestrators.test.js` can time out with an EPERM cleanup error inside your sandbox. Do not install or copy `node_modules` into the worktree; run vitest as `node ../../node_modules/vitest/vitest.mjs`.

1. Messages: when a token caller (no Origin) names a bare lane key in `to`, apply the run route's gate (`readActor` and `finishActor` in `server/runs.js`, or the same `registry.sector(actor).lanes` check): Main may start any lane, a sub only a lane in its sector, else 403 with the run route's sector text. A token caller's message is added to Main's chat under its own sender (`orchestrator` or `sub:ID`), never as `owner`. The page path (Origin) stays exactly as today.
2. Stop: `POST /api/orchestrator/stop` from a sub token stops only that sub (`body.id` equal to the actor, or no id), else 403; Main's token and the page stop any. `POST /api/control/runs/stop` from a sub token passes `finishActor(actor, body.lane)` first, so a lane outside its sector answers 403.
3. Merge: `POST /api/control/reviews/LANE/merge` from a sub token answers 403 unless LANE is in that sub's sector. Main's token and the page are unchanged. Keep `allowOutside` rules from P402 as they are.
4. Tests in `tests/sub-token-gates.test.js`, each failing before your change: a sub token messaging a bare lane outside its sector gets 403 and starts no run; inside its sector it starts one and the chat line is not `owner`; a sub token stopping Main gets 403; a sub token stopping a lane outside its sector gets 403; a sub token merging a lane outside its sector gets 403 and `main` does not move; Main's token can do all four.
5. Run `node ../../node_modules/vitest/vitest.mjs run tests/sub-token-gates.test.js tests/orchestrators.test.js tests/reviews-scope.test.js` and report the counts.

**P432. The turn-end scope check sees both sides of a rename (OpenCode).** Read this brief and item 5 of `docs/agents/PLAN-NEXT-ARGON-2.md` only. Commit each step as you finish it. Run every command in the foreground. Files: server/orchestrators.js (only `branchChanges`), tests/branch-changes-renames.test.js (new), docs/agents/CHANGELOG.md.

1. `branchChanges` passes `--no-renames` to its `git diff`, as `server/reviews.js` does since R42-2.
2. Test, failing before your change: in a temp repo, a lane branch that runs `git mv docs/a.md src/a.md` makes `branchChanges` return both `docs/a.md` and `src/a.md`. Export `branchChanges` for the test only if it is not exported yet.
3. Run `node node_modules/vitest/vitest.mjs run tests/branch-changes-renames.test.js tests/orchestrators.test.js` and report the counts.

**P433. An existing sub cannot be moved to another harness by a ladder save (OpenCode).** Read this brief and item 7 of `docs/agents/PLAN-NEXT-ARGON-2.md` only. Commit each step as you finish it. Run every command in the foreground. Files: server/orchestrators.js (only `ladderChange`'s same-harness check), tests/same-harness-change.test.js (new), docs/agents/CHANGELOG.md.

1. The same-harness check (`sameHarnessProblem`) runs for a new sub and for an existing sub whose harness changes (`!previous || harnessFor(previous) !== harness`), like the `off` check beside it. It still applies only to an orchestrator token, never to the page.
2. Tests, each failing before your change: an `agy` orchestrator token that saves the ladder with an existing `agy` sub changed to `codex` gets 400 with `sameHarnessProblem('agy')`'s text and the sub stays `agy`; the page can still make that change. Follow how `tests/same-harness-agents.test.js` sets up.
3. Run `node node_modules/vitest/vitest.mjs run tests/same-harness-change.test.js tests/same-harness-agents.test.js` and report the counts.

**P434. Lane proposals read the saved harness settings (OpenCode).** Read this brief and item 8 of `docs/agents/PLAN-NEXT-ARGON-2.md` only. Commit each step as you finish it. Run every command in the foreground. Files: server/family.js (only the proposals route's harness check), tests/proposal-harness-settings.test.js (new), docs/agents/CHANGELOG.md.

1. `POST /api/family/proposals` refuses a harness listed in `readHarnessSettings(runsDir).off` with 400 `HARNESS_OFF_PROBLEM`, and passes `runsFolder: runsDir` to `isHarnessAvailable` so a program path saved in `harnesses.json` counts, as the approve route does.
2. Tests, each failing before your change: with `opencode` turned off, a proposal for `opencode` gets 400 with `HARNESS_OFF_PROBLEM`; with a saved `codex` program that exists, a proposal for `codex` gets 200 even when `codex` is not on PATH. Follow how `tests/owner-tree.test.js` sets up.
3. Run `node node_modules/vitest/vitest.mjs run tests/proposal-harness-settings.test.js tests/owner-tree.test.js` and report the counts.

Item 6 (sub harness, model and effort routes leave the ladder stale) waits for P429 and P431, since it touches the same routes.

**P430b. Failover never hands Bypass to a backup that did not save it (OpenCode).** Replaces P430, whose rule broke `tests/failover-ticket-mode.test.js`: a backup with no saved mode keeps taking the primary's mode on purpose (a Plan run stays Plan on its backup). Read this brief only. Commit each step as you finish it. Run every command in the foreground. Files: scripts/run-lane.mjs (only `startFailover`), tests/failover-default-mode.test.js (new), docs/agents/CHANGELOG.md, docs/agents/FREE-HIERARCHY.md (the failover sentence on line 30).

1. In `startFailover`, when the mode to carry is `bypass` and the backup's saved `cli.mode` is not `bypass`, carry nothing: the backup runs at its own saved mode, or its harness default when it has none or `choice`. Every other carry stays exactly as today.
2. Tests, each failing before your change except the last: a `claude` primary in `bypass` failing over to a `codex` backup with no `cli.mode` builds codex args with `--sandbox workspace-write` and without `--dangerously-bypass-approvals-and-sandbox`; the same with a `choice` backup; a backup saved as `bypass` still runs in bypass. Follow how `tests/failover-ticket-mode.test.js` builds its lanes and reads the args.
3. FREE-HIERARCHY.md line 30 adds that a Bypass run never passes Bypass to a backup lane that is not saved as Bypass.
4. Run `node node_modules/vitest/vitest.mjs run tests/failover-default-mode.test.js tests/failover-ticket-mode.test.js tests/failover-mode.test.js tests/run-failover.test.js` and report the counts.

**P435. The ladder end-to-end tests wait for their own steps (OpenCode).** Read this brief only. Commit each step as you finish it. Run every command in the foreground. Files: tests/ladder-e2e.test.js, docs/agents/CHANGELOG.md. Change no source file.

1. Both tests in `tests/ladder-e2e.test.js` hit vitest's 20 second test limit while their own waits allow 12, 15 and 15 seconds in turn (lines 345 to 373 and 413 to 433), so under load they fail with `Test timed out in 20000ms` before a wait gives its own message. Give each test (or the describe) a limit larger than the sum of its waits plus setup, as P423 did for the slow tests. Do not shorten or loosen any wait or expectation.
2. Run `node node_modules/vitest/vitest.mjs run tests/ladder-e2e.test.js` three times and report each count.

**P436. A sub's harness, model and effort changes reach the ladder (Codex, Terra).** Read this brief and item 6 of `docs/agents/PLAN-NEXT-ARGON-2.md` only. If the gap does not reproduce on `main`, say so with the file and line you read and change nothing. Known sandbox baseline failures, not yours: process tests in `tests/run-lane-stop.test.js`, `tests/run-lane.test.js`, `mr-agent > stops the whole shell tree on the time limit`, and the removed-sub test in `tests/orchestrators.test.js` (timeout with an EPERM cleanup). Do not install or copy `node_modules` into the worktree; run vitest as `node ../../node_modules/vitest/vitest.mjs`. Files: server/orchestrators.js (the sub harness, model and effort routes, and `configs` or the saved ladder they must update), tests/sub-settings-ladder.test.js (new), docs/agents/CHANGELOG.md. If one more file must change only to pass the new value through, change it and name it; do not stop for that.

1. When `POST /api/orchestrator/harness`, `/api/orchestrator/model` or `/api/orchestrator/effort` changes a sub, the saved ladder entry and the sub's entry in `configs` take the new harness, model and effort, so a later ladder save keeps them and `sync()` sees no config change. A harness change keeps the existing rules (P411 mode reset, P413 restore).
2. Tests in `tests/sub-settings-ladder.test.js`, each failing before your change: after a sub's effort is changed through its route, a ladder save that only changes that sub's scope keeps the new effort; after a sub's model is changed, the same save keeps the new model; a ladder save that changes nothing about a working sub does not close its running turn.
3. Run `node ../../node_modules/vitest/vitest.mjs run tests/sub-settings-ladder.test.js tests/sub-effort.test.js tests/orchestrators.test.js tests/same-harness-change.test.js` and report the counts.

**P437. Review 46: P429 to P436 (Codex, GPT-6.1 Sol, report).** Read this brief only. Change no file except the one you write. Your sandbox keeps git read-only: write the file in your worktree and the runner commits it. Known sandbox baseline failures, not yours: process tests in `tests/run-lane-stop.test.js`, `tests/run-lane.test.js`, `mr-agent > stops the whole shell tree on the time limit`, and the removed-sub test in `tests/orchestrators.test.js`. Do not install or copy `node_modules` into the worktree. Files: docs/agents/AUDIT-2026-11-REVIEW-46.md.

1. Review `git diff 562a7441..ab0f54d1`: P429 (`gitEnv` at every server git call), P430b (no Bypass on failover to a backup not saved as Bypass), P431 (sub tokens gated to their sector for lane messages, stops and merges), P432 (`--no-renames` in `branchChanges`), P433 (same-harness check on an existing sub's harness change), P434 (proposals read saved harness settings), P435 (ladder e2e time limit), P436 (sub harness, model and effort saved to the ladder and `configs`).
2. Look for: a server git spawn still without `gitEnv`; a way for a sub token to reach another sector's lane through a route P431 did not touch (runs start, queues, review reads, messages to `lane:KEY`, family proposals); a Main token or the owner page refused where it was allowed before; a failover path that still carries Bypass; a ladder save that now writes a sub's live values over a change the owner made in the same save; a doc sentence the code contradicts; a test that passes with its change undone.
3. Each finding: `R46-N`, a severity, the file and line, what goes wrong, how to see it, one fix. At most 8. No finding without a file and line you read.
4. End with `Checked and fine`. Under 80 lines. Plain words, no em dashes.

The owner's answers on `PLAN-NEXT-ARGON-2.md` "Needs the owner's yes" (2026-11-16 evening): all four approved. P438 to P441 build them.

**P438. A reply to a running lane waits for its next turn or interrupts it, as Settings say (Codex, Terra).** The named baseline failures below fail before your change in your sandbox; they do not stop you and the house rule on red tests does not apply to them. Read this brief, `docs/agents/FREE-HIERARCHY.md` and `docs/agents/architecture/LIVE.md` (the lane inbox paragraph) only. Known sandbox baseline failures, not yours: process tests in `tests/run-lane-stop.test.js`, `tests/run-lane.test.js`, `mr-agent > stops the whole shell tree on the time limit`, and the removed-sub test in `tests/orchestrators.test.js`. Do not install or copy `node_modules`; run vitest as `node ../../node_modules/vitest/vitest.mjs`. Files: server/harness-settings.js (the saved choice), the Settings route that already saves `harnesses.json`, src/ui/HarnessesSettings.jsx (one select, existing classes only, no CSS), server/orchestrators.js (where a lane message is received), server/runs.js and scripts/run-lane.mjs (the interrupt and the continuation run), scripts/mr-agent.mjs (abort the model call in flight), tests/lane-interrupt.test.js (new), docs/agents/CHANGELOG.md, docs/agents/FREE-HIERARCHY.md, docs/agents/architecture/LIVE.md. You may also change `server/agents-config.js` and `tests/harness-settings.test.js`, any existing test whose expectation this brief changes, and up to three more files that must change to pass the choice or the run through; name each in your report. Do not stop for file scope.

1. Settings save `laneReplies`: `next-turn` (default, today's behaviour) or `interrupt`. Settings shows one select, `Replies to a working lane`, with `Wait for its next turn` and `Interrupt it at once`.
2. With `interrupt`, a message accepted for a running bridge-started lane run (the same route and checks as today) also interrupts it:
   - The native agent (`machineroom` harness): `mr-agent` polls its inbox at most once a second while a model call runs, aborts that call when a new message arrives, and starts the next call with the message, as it does today between calls.
   - A CLI harness run: stop that run's process tree as Stop does, keep the worktree and branch as they are, and start a continuation run on the same lane, branch and worktree with the same ticket and inbox. Its prompt is the original brief, then a paragraph saying the run was interrupted, its work so far is in the worktree, and the new messages follow, then the unseen messages as `FROM: TEXT` lines. Where the harness can resume its own session (the lane meta already holds `sessionId` for Claude), resume it instead and send only the paragraph and the messages; otherwise use the fresh prompt. The run record marks `interruptedBy` with the sender, and the continuation record names `continues` with the first runId.
   - At most 3 interrupts per run; past that, messages wait for the next turn and the sender gets the 202 as today.
   - The continuation start skips the dirty worktree check and the branch creation (it keeps the interrupted run's branch and uncommitted work), and reuses the first run's `sessionId` where the harness resumes by it (Claude `--resume`), instead of making a new one.
3. Tests in `tests/lane-interrupt.test.js`, each failing before your change: the choice saves and reads back with `next-turn` as the default; with `next-turn` a message never stops a run; with `interrupt` a fake CLI run is stopped and a continuation starts on the same branch and worktree with the message in its prompt; the fourth interrupt does not stop the run; the native agent aborts a slow model call and its next call carries the message.
4. Docs: FREE-HIERARCHY.md moves "Nothing interrupts a lane run" from what does not work to what works, with the choice; LIVE.md's inbox paragraph names the choice and the interrupt.
5. Run `node ../../node_modules/vitest/vitest.mjs run tests/lane-interrupt.test.js tests/orchestrators.test.js tests/mr-agent.test.js` (skip a file that does not exist) and report the counts.

**P439. A failover backup messages under its own name and keeps the primary's replies (OpenCode).** Read this brief and `docs/agents/FREE-HIERARCHY.md` line 34 only. Commit each step as you finish it. Run every command in the foreground. Files: scripts/run-lane.mjs (`startFailover` and the ticket it passes), server/orchestrators.js (the lane ticket registry and `lane:KEY` delivery), tests/failover-inbox-identity.test.js (new), docs/agents/CHANGELOG.md, docs/agents/FREE-HIERARCHY.md. If one more file must change only to pass the backup's name through, change it and name it; do not stop for that.

1. A failover backup run sends its messages as `lane:BACKUP`, not as the primary. Its inbox still holds the replies already sent to the primary's run, and a message sent to `lane:PRIMARY` or `lane:BACKUP` while the backup runs reaches the backup. The 4-message cap counts the primary's and the backup's sends together.
2. Tests, each failing before your change: a backup's message reaches its coordinator from `lane:BACKUP`; a reply sent to the primary before the failover is in the backup's inbox; a reply sent to `lane:PRIMARY` after the failover reaches the backup; the primary's 3 sends leave the backup 1.
3. FREE-HIERARCHY.md moves line 34 from what does not work to what works.
4. Run `node node_modules/vitest/vitest.mjs run tests/failover-inbox-identity.test.js tests/failover-messages.test.js tests/orchestrators.test.js` and report the counts.

**P440. Lanes cannot write outside the project, except in Bypass (OpenCode).** Read this brief and `docs/agents/FREE-HIERARCHY.md` only. Commit each step as you finish it. Run every command in the foreground. Files: scripts/run-lane.mjs (the OpenCode config near line 1834), src/harnesses/*.js only where a flag must change, src/control/modes.js (the mode lines), tests/outside-writes.test.js (new), docs/agents/CHANGELOG.md, docs/agents/FREE-HIERARCHY.md, docs/agents/architecture/LIMITS.md.

1. What each harness does today, to confirm by reading the descriptors and run-lane: Codex `workspace-write` and `read-only` keep writes inside the worktree and `--add-dir` folders; Claude's modes other than `bypassPermissions` refuse an edit outside the folder in print mode; the native agent refuses a path outside its folder (`scripts/mr-agent.mjs` near line 531). Write each in your report with the line you read. If one does not hold, fix it in its descriptor.
2. OpenCode: every OpenCode lane run that is not Bypass gets an `OPENCODE_CONFIG` whose `permission` sets `external_directory` to `deny`, merged with the mode's own `bash` and `edit` rules and the MCP config as today. Check the installed OpenCode's config schema or help for the key; if OpenCode has no such key, say so and leave the config as it is.
3. AGY runs with `--dangerously-skip-permissions` and has no folder guard. Do not change AGY's flags. LIMITS.md says AGY, and shell commands in any harness, can still write outside the project, and the Inspector's `Outside the project` list is how the owner sees them.
4. Each mode line in `src/control/modes.js` that allows writes says writes stay in the project, and Bypass says it can write anywhere.
5. Tests in `tests/outside-writes.test.js`, each failing before your change: an OpenCode run in `auto`, `edits` and `plan` gets `external_directory: deny` in its config; in `bypass` it gets none; the mode lines say so.
6. Run `node node_modules/vitest/vitest.mjs run tests/outside-writes.test.js tests/run-lane.test.js tests/modes.test.js` (skip a file that does not exist) and report the counts.

**P441. A Mode picker when adding or editing a sub orchestrator (AGY, Hydrogen).** Read this brief and `src/ui/FamilyTree.jsx` near line 2093 only. Commit each step as you finish it. Run every command in the foreground. Files: src/ui/FamilyTree.jsx, src/ui/ladderForm.js, server/orchestrators.js (only `saveSubSettings`, to keep `mode` too), tests/sub-mode-picker.test.jsx (new), docs/agents/CHANGELOG.md, docs/agents/architecture/ROOM.md. No CSS: reuse the classes of the lane Mode select in the same file.

1. Add sub and the sub's editor in Agents show a `Mode` select from `modesFor(harness)` (orchestrators may use Ask), defaulting to `defaultMode(harness)`; a harness without modes shows none. On save, the page calls `client.setMode({ id, mode })` (the `/api/orchestrator/mode` route) for that sub after the ladder save succeeds, and shows the route's error if it refuses.
2. `saveSubSettings` in `server/orchestrators.js` saves `mode` with harness, model and effort, so a later ladder save keeps it.
3. Tests, each failing before your change: the editor shows the select with the harness's modes; saving sends `setMode` with the chosen mode after `setLadder`; a later ladder save keeps the sub's mode.
4. ROOM.md names the sub Mode select.
5. Run `node node_modules/vitest/vitest.mjs run tests/sub-mode-picker.test.jsx tests/sub-settings-ladder.test.js` and report the counts.

Research round, P442a to P442c and P443 (2026-11-16 evening, at the owner's request). Three researchers survey on their own, then merge into one plan. The owner's note: harnesses as a broad subject, and mainly what users want.

**P442. Survey of coding agent harnesses and what their users want (research).** The same brief for three researchers, each on their own, without reading the others' files: P442a Claude (Opus 5.5 High) writes `docs/agents/research/HARNESS-SURVEY-CLAUDE.md`, P442b Codex (GPT-6.1 Sol High) writes `docs/agents/research/HARNESS-SURVEY-SOL.md`, P442c AGY (Gemini 4 Argon High) writes `docs/agents/research/HARNESS-SURVEY-ARGON.md`. Use your web search. If you have no web search tool, write that as the first line of your file and stop. Read `docs/agents/ARCHITECTURE.md` and `docs/agents/FREE-HIERARCHY.md` first so you know what MachineRoom is today. Change no file except your own. Commit when done, or leave it for the runner if your git is read-only.

1. What users want, the main part. Read what programmers say in public about coding agent harnesses and multi-agent tools: forums, issue trackers, discussions, posts, release notes and their comments, surveys. Group the wants and the complaints into themes (for example cost and quota, trust and permissions, review of agent work, parallel agents, worktrees, context and memory, speed, setup for a beginner, control for an expert, observability, failure and recovery). For each theme: what users ask for, how strongly (how often, by whom), and two or three sources with their address and date.
2. How harnesses are built. Survey the main harnesses and orchestrators of coding agents (CLI agents, IDE agents, multi-agent and orchestration tools, open source and commercial). For each: the loop, tools, permissions and sandbox, sessions and resume, subagents or parallel agents, how a human watches and steers, and how it is extended. One short paragraph each, with sources.
3. What MachineRoom should take. Ranked list of up to 15 ideas that would make MachineRoom more efficient, freer of bugs, easier for a beginner or more capable for an expert. For each: the user want it answers (theme from step 1), what other tools do, what MachineRoom has today (name the file or doc), the change, a size (small, medium, large) and whether it changes what the owner sees.
4. Rules: only claims you read in a source; say when a source is a vendor's own claim; dates for everything time-sensitive. Under 250 lines. Plain words, no em dashes.

**P443. One plan from the three surveys (merge).** After P442a to P442c are on `main`. Argon drafts `docs/agents/PLAN-RESEARCH.md` from the three surveys: the user wants all three agree on, where they disagree and why, and one ranked plan of up to 15 items with briefs-sized steps. Sol then reviews the draft against the three surveys and the code, and writes its changes in a section `Sol's review`. Claude settles each disagreement in a section `Settled` and the owner decides what to build.

Review 46 fixes, P444 to P447. `docs/agents/AUDIT-2026-11-REVIEW-46.md` (P437, GPT-6.1 Sol): five findings. Each brief adds its tests in a new file.

**P444. A failover that drops Bypass picks the backup's own default mode (OpenCode).** Read this brief and R46-1 in `docs/agents/AUDIT-2026-11-REVIEW-46.md` only. Commit each step as you finish it. Run every command in the foreground. Files: scripts/run-lane.mjs (only `startFailover`), tests/failover-bypass-default.test.js (new), docs/agents/CHANGELOG.md.

1. When `startFailover` refuses to carry Bypass (P430b), it sets the backup's mode to `defaultMode(backup harness)` explicitly, unless the backup has a fixed saved mode, which it keeps. A harness whose `defaultMode` is null keeps today's behaviour.
2. Tests, each failing before your change: a Bypass primary failing over to a Claude backup with no saved mode builds Claude args without `--dangerously-skip-permissions`; the same for an AGY backup and for a native (`machineroom`) backup's mode; a `choice` backup gets its harness default; a backup saved as `bypass` still runs in Bypass. Follow `tests/failover-default-mode.test.js`.
3. Run `node node_modules/vitest/vitest.mjs run tests/failover-bypass-default.test.js tests/failover-default-mode.test.js tests/failover-mode.test.js` and report the counts.

**P445. A sub's `lane:KEY` message is held to its sector too (OpenCode).** Read this brief and R46-2 only. Commit each step as you finish it. Run every command in the foreground. Files: server/orchestrators.js (only the `lane:KEY` branch of the message route for orchestrator tokens), tests/lane-message-sector.test.js (new), docs/agents/CHANGELOG.md.

1. Before `receiveLaneMessage`, a sub token (not Main, not the page, not a lane ticket) whose sector does not hold the lane gets 403 with the same text as the bare lane key check (P431). Main's token, the page and lane tickets keep today's rules.
2. Tests, each failing before your change: a sub token messaging `lane:outside` gets 403 and the outside inbox stays empty; `lane:inside` still answers 202; Main's token can message `lane:outside`. Follow `tests/sub-token-gates.test.js`.
3. Run `node node_modules/vitest/vitest.mjs run tests/lane-message-sector.test.js tests/sub-token-gates.test.js` and report the counts.

**P446. A failover stays inside the sector that started the run (OpenCode).** Read this brief and R46-3 only. Commit each step as you finish it. Run every command in the foreground. Files: server/runs.js (where a task or queue start spawns the runner), scripts/run-lane.mjs (`startFailover` and the option parsing), tests/failover-sector.test.js (new), docs/agents/CHANGELOG.md. If one more file must change only to pass the allowed lanes through, change it and name it; do not stop for that.

1. When a sub starts a task or a queue, the runner gets the sub's allowed lanes (a new `--allowed-lanes a,b,c` option or an environment variable, your choice; name it in the report). Main's and the owner's starts pass nothing and keep today's behaviour.
2. `startFailover` refuses a backup not in the allowed lanes before it takes the backup's lock or touches its branch, prints `The backup lane KEY is outside the sector that started this run.`, and the run ends failed as when no backup exists.
3. Tests, each failing before your change: a sub start whose lane's fallback is outside the sector does not start the fallback and prints the line; the same through a queue start; a Main start still fails over to that lane. Follow `tests/run-failover.test.js`.
4. Run `node node_modules/vitest/vitest.mjs run tests/failover-sector.test.js tests/run-failover.test.js tests/sub-token-gates.test.js` and report the counts.

**P447. A sub's saved settings and its live instance agree (AGY, Hydrogen).** Read this brief and R46-4 and R46-5 only. Commit each step as you finish it. Run every command in the foreground. Files: server/orchestrators.js (`saveSubSettings` and the sub recreation in `sync`), server/orchestrator.js (the program override on a harness change, and `restore` taking an explicit model and effort over the saved chat file), tests/sub-settings-live.test.js (new), docs/agents/CHANGELOG.md. If one more file must change only to pass the program through, change it and name it; do not stop for that.

1. R46-4: when a sub's harness changes through its route, the live instance takes the new harness's program as well, so a later ladder save never runs the old harness's program with the new harness's arguments.
2. R46-5: when a ladder save recreates a sub with a model or effort given in that save, the new instance uses the given values over the ones in its saved chat file. Values not given still come from the chat file as today.
3. Tests, each failing before your change: with distinct fake programs for Codex and Claude, a sub changed from Codex to Claude through the route and then an unchanged ladder save spawns the Claude program; a ladder save that changes a sub's scope and its model and effort together leaves the live sub on the saved model and effort; a later effort route change keeps the saved model.
4. Run `node node_modules/vitest/vitest.mjs run tests/sub-settings-live.test.js tests/sub-settings-ladder.test.js tests/sub-effort.test.js` and report the counts.

P438 is split in two (Terra stopped three times on its size). P438a is the setting and the native agent; P438b is the CLI continuation.

**P438a. The Settings choice for replies to a working lane, and the native agent's interrupt (OpenCode).** Read this brief and P438 above only. Commit each step as you finish it. Run every command in the foreground. Files: server/harness-settings.js, server/agents-config.js (the Settings save route, if it lives there), src/ui/HarnessesSettings.jsx (one select, existing classes only, no CSS), src/control/client.js (only if the save call needs the new field), scripts/mr-agent.mjs, tests/harness-settings.test.js (update the default shape), tests/lane-replies-setting.test.js (new), docs/agents/CHANGELOG.md, docs/agents/architecture/LIVE.md. You may change any existing test whose expectation this brief changes; name it.

1. `harnesses.json` keeps `laneReplies`: `next-turn` (the default when missing or unknown) or `interrupt`. `readHarnessSettings` returns it, the Settings route saves it, and Settings shows the select `Replies to a working lane` with `Wait for its next turn` and `Interrupt it at once`.
2. The bridge passes the choice to a lane run it starts as `MACHINEROOM_LANE_REPLIES` (where it already passes `MACHINEROOM_LANE_TICKET`). With `interrupt`, `scripts/mr-agent.mjs` polls the inbox at most once a second while a model call runs (same route, ticket and 3 second limit as today), aborts the call with an AbortController when an unseen message arrives, and makes the next call at once with the messages added as today. With `next-turn` nothing changes.
3. Tests, each failing before your change: the choice saves and reads back, with `next-turn` as the default; the Settings select shows and saves it; with `interrupt` the native agent aborts a slow fake model call when a message appears and its next call carries the message; with `next-turn` it waits for the call to end.
4. LIVE.md's inbox paragraph names the choice.
5. Run `node node_modules/vitest/vitest.mjs run tests/lane-replies-setting.test.js tests/harness-settings.test.js tests/mr-agent.test.js` and report the counts. `mr-agent > stops the whole shell tree on the time limit` may fail under load; rerun it alone.

**P438b. Interrupt a CLI lane run and continue it on the same branch (AGY, Hydrogen; Terra stopped four times).** A test that fails before your change and cannot clean its temporary folder is not a reason to stop; note it and go on. Starts after P438a is on `main`. The named baseline failures below fail before your change in your sandbox; they do not stop you. Known sandbox baseline failures: process tests in `tests/run-lane-stop.test.js`, `tests/run-lane.test.js`, `mr-agent > stops the whole shell tree on the time limit`, and the removed-sub test in `tests/orchestrators.test.js`. Do not install or copy `node_modules`; run vitest as `node ../../node_modules/vitest/vitest.mjs`. Read this brief only. Files: server/orchestrators.js (`receiveLaneMessage` near line 685), server/runs.js (`stopRun` near line 1049 and the start of a lane run), scripts/run-lane.mjs (`startLane` near line 1847 and option parsing), tests/lane-interrupt.test.js (new), docs/agents/CHANGELOG.md, docs/agents/FREE-HIERARCHY.md. You may change any existing test whose expectation this brief changes, and up to three more files the continuation must pass through; name each. Do not stop for file scope. The design is fixed below; do not redesign it.

1. When `readHarnessSettings(runsDir).laneReplies` is `interrupt` and `receiveLaneMessage` accepts a message for a running bridge-started run whose harness is not `machineroom` (the native agent handles its own, P438a), the bridge, after answering 202:
   - writes the run's unseen inbox messages to `<runs>/<runName>.interrupt.txt` as one paragraph (`You were interrupted. Your work so far is in this worktree on this branch, committed or not. Read these messages, then carry on with the brief.`) and the messages as `FROM: TEXT` lines;
   - stops the run as `stopRun` does (process tree, lock released);
   - starts the same lane with the same brief, task or queue item and project as the first run, plus `--continue-from <runName>`, with the same ticket in `MACHINEROOM_LANE_TICKET` so the inbox and the send cap carry over.
2. `run-lane.mjs --continue-from NAME` reads that run's record: it skips the clean worktree check and the branch move in `startLane` and stays on the first run's branch with its uncommitted work, appends the interrupt file's text to the prompt, and writes `continues: NAME` in the new record and `interruptedBy: SENDER` in the first run's record. Resuming a harness's own session is not part of this brief.
3. At most 3 interrupts per first run (count the chain of `continues`); past that, the message waits for the next turn as today.
4. Tests in `tests/lane-interrupt.test.js`, each failing before your change, with fake CLI lanes as `tests/run-failover.test.js` uses: with `next-turn` a message never stops a run; with `interrupt` the run is stopped and a continuation starts on the same branch and worktree, its prompt holds the paragraph and the message, its record names `continues`; uncommitted work in the worktree survives into the continuation; the fourth interrupt in a chain does not stop the run.
5. FREE-HIERARCHY.md moves "Nothing interrupts a lane run" to what works, naming the choice.
6. Run `node ../../node_modules/vitest/vitest.mjs run tests/lane-interrupt.test.js tests/orchestrators.test.js tests/run-failover.test.js` and report the counts.

**P439b. A lane ticket can take over only its own lane's backup name (OpenCode).** Read this brief and P439 above only. Commit each step as you finish it. Run every command in the foreground. Files: server/orchestrators.js (`takeOver` and `receiveLaneMessage`), tests/failover-inbox-identity.test.js, docs/agents/CHANGELOG.md.

P439's `POST /api/orchestrator/failover` lets any running lane's ticket claim any lane key, and `receiveLaneMessage` checks claimed names before the real lane's own ticket. So a running lane can send as another lane and catch that lane's messages.

1. `takeOver` accepts `body.lane` only when it is the `fallback` of the ticket's own lane in the current lanes (`allLanes[held.lane].fallback`); any other key answers 403 `A lane can take over only its own backup lane.` A ticket can claim at most once.
2. `receiveLaneMessage` prefers the lane's own running ticket (`lastLaneTicket(lane)`) and uses a claimed backup only when the lane has no run of its own.
3. Tests, each failing before your change: a ticket claiming a lane that is not its fallback gets 403 and messages to that lane still reach that lane's own run; a second claim gets 403; when the backup lane has its own running run, a message to `lane:BACKUP` reaches that run, not the claimed ticket.
4. Run `node node_modules/vitest/vitest.mjs run tests/failover-inbox-identity.test.js tests/failover-messages.test.js` and report the counts.

**P443b. Sol's review of the research plan (Codex, GPT-6.1 Sol, report).** Read this brief, `docs/agents/PLAN-RESEARCH.md` and the three surveys in `docs/agents/research/` only, then the code each item names. Change no file except `docs/agents/PLAN-RESEARCH.md`, and in it only the section `Sol's review`. Your sandbox keeps git read-only: write the file in your worktree and the runner commits it. Do not install or copy `node_modules`. Files: docs/agents/PLAN-RESEARCH.md.

1. For each of the 15 items: does it answer a user want the surveys show (cite the survey line), is its `Today` true of the code (file and line you read), is the step the smallest one that does it, and is the size and harness right. One line each when it holds; a short paragraph when it does not, with your change.
2. Name anything the three surveys agree on that the plan leaves out, and anything in the plan no survey supports.
3. Give your own order of the 15, with one line on why it differs from Argon's where it does.
4. Under 90 lines in the section. Plain words, no em dashes.

**P438c. The native agent never drops a reply that arrives as its model call ends (OpenCode).** Read this brief and `startInboxWatch` and its use in `main` in `scripts/mr-agent.mjs` only. Commit each step as you finish it. Run every command in the foreground. Files: scripts/mr-agent.mjs, tests/lane-replies-setting.test.js, docs/agents/CHANGELOG.md.

`readLaneInbox` marks messages as seen when it reads them. With `interrupt`, if the model call resolves while the watcher is inside `readLaneInbox`, `watch.stop()` runs, the loop returns at `if (stopped) return` without calling `onMessage`, and the messages it just marked seen are never added to the conversation.

1. The watcher always hands over what it read: after `readLaneInbox` returns non-empty text, it calls `onMessage` even when stopped. In `main`, after a successful call, stop the watch, `await watch.done`, and if it handed over text, keep it in `heldInbox` for the next call, as the abort path does.
2. Test, failing before your change: a fake model call that resolves while a slow fake inbox read is in flight; the read's message reaches the next model call.
3. Run `node node_modules/vitest/vitest.mjs run tests/lane-replies-setting.test.js tests/mr-agent.test.js` and report the counts. `mr-agent > stops the whole shell tree on the time limit` may fail under load; rerun it alone.

**P448. One event stream a page, so three tabs no longer stall the room (OpenCode).** Item 13 of `docs/agents/PLAN-RESEARCH.md`, with Sol's narrower step. Read this brief, item 13 and its line in `Sol's review`, and the `Six connections a host` section of `docs/agents/architecture/LIMITS.md` only. Commit each step as you finish it. Run every command in the foreground. Files: src/live/bridge.js, src/control/client.js, src/control/notices.js or src/ui/panels/notices.js (whichever subscribes to control notices), src/Stage.jsx or src/App.jsx only where the two streams are wired, tests/one-stream.test.js (new), docs/agents/architecture/LIMITS.md, docs/agents/architecture/LIVE.md, docs/agents/CHANGELOG.md. You may change any existing test whose expectation this brief changes; name it.

1. Each page opens one `/events` stream, not two. The server already sends control change notices to `/events` clients (`server/index.js` near lines 931 and 1667): the control client takes its notices from the stream the live bridge already holds, and stops opening its own. Frames, frame cursors and reconnects behave as today. A page with no live bridge (a replay, the mock client) still gets its notices the way it does today.
2. Tests, each failing before your change: a page that starts the live bridge and the control client opens exactly one `EventSource`; a control notice sent on that stream reaches the control client's subscribers; after the stream reconnects, notices still arrive; closing the page closes the one stream.
3. LIMITS.md's `Six connections a host` section says a page now holds one stream, so six tabs fit before a stall; LIVE.md names the shared stream.
4. Run `node node_modules/vitest/vitest.mjs run tests/one-stream.test.js tests/bridge.test.js tests/client.test.js` (skip a file that does not exist) and `npm run build`, and report the counts.

The owner chose all 15 items of `docs/agents/PLAN-RESEARCH.md`, in Sol's order, each as its first step only as Sol narrowed it in `Sol's review` (2026-11-16 night). P449 to P455 are the first batch; each brief adds its tests in a new file. Codex briefs: known sandbox baseline failures, not yours, are process tests in `tests/run-lane-stop.test.js` and `tests/run-lane.test.js`, `mr-agent > stops the whole shell tree on the time limit` and the removed-sub test in `tests/orchestrators.test.js`; they and a temp folder your sandbox cannot remove do not stop you. Do not install or copy `node_modules`; run vitest as `node ../../node_modules/vitest/vitest.mjs`. You may change any existing test whose expectation your brief changes, and up to three more files your change must pass through; name each. Do not stop for file scope.

**P449. Item 1: say plainly how each lane is guarded (AGY, Hydrogen).** Read this brief, item 1 of `PLAN-RESEARCH.md` and its paragraph in `Sol's review` only. Commit each step as you finish it. Run every command in the foreground. Files: src/control/modes.js (a new `sandboxSummary(harness, mode)`), src/ui/Inspector.jsx (one `Sandbox` row beside Harness, Model and Effort near line 481), scripts/acp-run.mjs (only a log line), tests/inspector-sandbox.test.jsx (new), docs/agents/CHANGELOG.md, docs/agents/architecture/ROOM.md. No CSS. Do not change how ACP answers permission requests.

1. `sandboxSummary(harness, mode)` returns one plain line from the effective mode, never more than the harness gives: Codex Plan `Read-only OS sandbox`, Codex Edits or Auto `OS sandbox, writes stay in the worktree`, Codex Bypass `No sandbox`; Claude Bypass `No permission checks`, other Claude modes `Permission checks, file edits stay in the project; shell commands are not sandboxed`; OpenCode Bypass `No permission rules`, other OpenCode modes `Permission rules, file edits stay in the project; no OS sandbox`; native (`machineroom`) `File tools stay in the project; shell commands are not sandboxed`; AGY `No permission checks`; ACP `Approves every request the agent asks for`; any other harness `Unknown`.
2. The Inspector shows `Sandbox` with that line for a lane, a sub and Main.
3. `scripts/acp-run.mjs` writes one line at start: `This ACP agent's permission requests are approved automatically.` (P-R1's enforced ACP modes wait for a later yes.)
4. Tests, each failing before your change: the summary for each harness and mode above; the Inspector row for a Codex Auto lane and an AGY lane; the ACP start line.
5. Run `node node_modules/vitest/vitest.mjs run tests/inspector-sandbox.test.jsx tests/modes.test.js` (skip a file that does not exist) and `npm run build`, and report the counts.

**P450. Item 6: Stop a sector, or everything, in one call (AGY, Hydrogen; Terra stopped before writing).** Read this brief, item 6 and its paragraph in `Sol's review` only. Commit each step as you finish it. Run every command in the foreground; the removed-sub test in `tests/orchestrators.test.js` may time out under load and is not yours. Two things Terra found: a refused failover claim (P439b) is ignored by the runner on purpose, so the stop must also find a backup run by its lane; and the lane stop can report a run finished before its process closes, so `stillRunning` must come from checking the process tree after the stop limit, not from the stop answer. Files: server/orchestrators.js, server/runs.js, tests/stop-tree.test.js (new), docs/agents/CHANGELOG.md, docs/agents/architecture/LIVE.md. The design is fixed; do not redesign it.

1. `POST /api/orchestrator/stop-tree` takes `{ id, confirmed: true }`. The page and Main's token may name any orchestrator id; a sub's token only its own id (else 403). `id: "orchestrator"` means the whole tree.
2. While it runs, the target sector refuses new lane starts, lane messages that start work, and failovers into it with 409 `That sector is stopping.` (reuse the P431 and P446 gates to know which lanes are in the sector).
3. It stops each target orchestrator's turn the way `POST /api/orchestrator/stop` does, then every running lane run in the sector the way `stopRun` does (including a failover or continuation run of those lanes), and answers `{ stoppedOrchestrators: [...], stoppedLanes: [...], stillRunning: [...] }`, where `stillRunning` lists what did not end within the existing stop limit. The gate lifts when it answers.
4. Tests, each failing before your change: a sub's tree stop ends its turn and its two running fake lanes and leaves a lane outside its sector running; a start into that sector during the stop gets 409; a sub token naming another sub gets 403; Main's tree stop ends every orchestrator and lane; a lane that will not stop shows in `stillRunning`.
5. LIVE.md names the route. Run `node ../../node_modules/vitest/vitest.mjs run tests/stop-tree.test.js tests/sub-token-gates.test.js tests/orchestrators.test.js` and report the counts.

**P451. Item 2: a review shows what was checked, separately from what the agent said (OpenCode).** Read this brief, item 2 and its paragraph in `Sol's review` only. Commit each step as you finish it. Run every command in the foreground. Files: server/reviews.js (`laneReview` near line 535), tests/reviews-evidence.test.js (new), docs/agents/CHANGELOG.md, docs/agents/architecture/LIVE.md.

1. Each lane review answer gains `evidence`: `{ checkedHead, checks: [{ command, result, at }] }` from the existing check state (`checkStateFor`), only when its head equals the branch head, else `checkedHead: null` and `checks: []` with `stale: true`; and `claims`: the last run's report text as the agent wrote it, kept apart from `evidence`.
2. It gains `runs`: every run of this task, found by following `failoverFrom` (lane and startedAt) and, once P438b lands, `continues`, not by branch name alone; each with lane, harness, model, minutes, and `costUsd` and tokens only when the record has them (missing stays `null`, never 0). A total sums only known values and says `partial: true` when any run has none. Name it run minutes, not elapsed time.
3. Tests, each failing before your change: a review whose checks ran on an older head shows `stale: true` and no checks; a failover chain on two branches lists both runs; a run with no cost makes the total `partial`.
4. Run `node node_modules/vitest/vitest.mjs run tests/reviews-evidence.test.js tests/reviews-scope.test.js` and report the counts. The Reviews panel display is a later brief.

**P452. Item 7: the cost board says what it does not know (OpenCode).** Read this brief, item 7 and its paragraph in `Sol's review` only. Commit each step as you finish it. Run every command in the foreground. Files: server/lane-costs.js (`laneCosts` near line 70), src/ui/panels/MetersPanel.jsx, tests/lane-costs-honest.test.js (new), docs/agents/CHANGELOG.md, docs/agents/architecture/ROOM.md. No CSS.

1. Each cost row gains `missingCostRuns` (runs with no `costUsd`) and `failedCost` (cost of runs that failed or were stopped). Do not call it waste.
2. The Meters panel labels a total with `(N runs not reported)` when `missingCostRuns > 0`, shows `Failed or stopped: $X` when non-zero, and shows the quota window's `at` (as `seen HH:MM`) and `resetsAt` (as `resets HH:MM`) that `server/lane-costs.js` already returns. Cache tokens are not part of this brief.
3. Tests, each failing before your change: the two counts from a record set; the panel's label and lines.
4. Run `node node_modules/vitest/vitest.mjs run tests/lane-costs-honest.test.js tests/lane-costs.test.js` (skip a file that does not exist) and report the counts.

**P453. Item 11: readiness says what it checked, and doctor asks for a project guide (OpenCode).** Read this brief, item 11 and its paragraph in `Sol's review` only. Commit each step as you finish it. Run every command in the foreground. Files: server/doctor.js (near line 230), src/ui/HarnessesSettings.jsx (only the Ready line's title or help text), tests/doctor-guide.test.js (new), docs/agents/CHANGELOG.md, docs/agents/architecture/COMMANDS.md. Keep the version display as it is.

1. `Ready` means the program was found and answered its version; the Settings help text and `doctor` say so: `Ready means the program was found. It does not prove sign-in, a model or the sandbox.`
2. `doctor` warns `warn The project has no agent guide (AGENTS.md, CLAUDE.md or GEMINI.md).` when the project root has none of those files, and says which it found otherwise.
3. Tests, each failing before your change: the warning for a bare folder; the found line for a folder with `AGENTS.md`; the Ready help text.
4. Run `node node_modules/vitest/vitest.mjs run tests/doctor-guide.test.js tests/doctor.test.js` and report the counts.

**P454. Item 4: the native agent notices a loop, and the room notices a silent run (OpenCode).** Read this brief, item 4 and its paragraph in `Sol's review` only. Commit each step as you finish it. Run every command in the foreground. Files: scripts/mr-agent.mjs (the step loop near line 1503), tests/native-loop.test.js (new), docs/agents/CHANGELOG.md, docs/agents/architecture/LIVE.md.

1. The native agent counts consecutive tool calls with the same tool, the same arguments and the same error. On the third it adds to that tool result: `This call has failed the same way three times. Try something else or stop and report.` On the fifth it ends the run with a failed result naming the call. A success or a different call resets the count.
2. Tests, each failing before your change: three identical failures add the line; five end the run; a success in between resets.
3. Run `node node_modules/vitest/vitest.mjs run tests/native-loop.test.js tests/mr-agent.test.js` and report the counts. `mr-agent > stops the whole shell tree on the time limit` may fail under load; rerun it alone. The attention list in the room is a later brief.

**P455. Item 14: MCP tool lists are cached briefly and never twice at once (OpenCode).** Read this brief, item 14 and its paragraph in `Sol's review` only. Commit each step as you finish it. Run every command in the foreground. Files: server/mcp.js (`listAllMcpTools` near line 502), tests/mcp-list-cache.test.js (new), docs/agents/CHANGELOG.md.

1. `listAllMcpTools` keeps each server's tool list for 60 seconds, keyed by the runs folder and the server's full effective config (command, arguments, environment names and URL). A change to `mcp.json` or the config clears it. A failed list is not cached. Two calls at once for the same key share one request.
2. Tests, each failing before your change: two lists within 60 seconds start the server once; a config change starts it again; a failure is retried on the next call; two parallel calls start it once.
3. Run `node node_modules/vitest/vitest.mjs run tests/mcp-list-cache.test.js tests/mcp.test.js` (skip a file that does not exist) and report the counts. Progress-aware call timeouts are a later brief.

Research plan, second batch, P456 to P460 (first steps as Sol narrowed them). Items 5 and 8 wait for P438b. Codex briefs keep the paragraph above P449 about baseline failures, `node_modules` and file scope.

**P456. Item 3: warn before two lanes work on the same declared files (OpenCode).** Read this brief, item 3 and its paragraph in `Sol's review` only. Commit each step as you finish it. Run every command in the foreground. Files: src/briefs/plan.js (or a new src/briefs/overlap.js), src/ui/panels/runs.js, src/ui/panels/DispatchPanel.jsx, server/harness-settings.js, src/ui/HarnessesSettings.jsx, tests/dispatch-overlap.test.js (new), docs/agents/CHANGELOG.md, docs/agents/architecture/ROOM.md. No CSS: reuse the warning class Dispatch already uses.

1. `overlappingLanes({ files, active })` compares a task's declared files (`briefFileList` in `src/briefs/briefs.js`) with the declared files of running lane tasks, after normalizing slashes and case on Windows, and answers `[{ lane, files }]`. A task with no file list answers `unknown`.
2. Dispatch's confirm card shows `Also declared by LANE: a, b` for each overlap, `Overlap unknown: this task names no files.` for a free-text task, and the number of lanes running now.
3. Settings keep `laneCountWarning` (a whole number, 0 by default meaning off). When it is above 0 and the start would make more running lanes than it, the card adds `N lanes will be running.` It never blocks a start.
4. Tests, each failing before your change: two briefs sharing a file overlap; case and slash differences still match; a free-text task is unknown; the count line shows only above a set threshold.
5. Run `node node_modules/vitest/vitest.mjs run tests/dispatch-overlap.test.js tests/harness-settings.test.js` and `npm run build`, and report the counts.

**P457. Item 10: a compaction says where the full history is (OpenCode).** Read this brief, item 10 and its paragraph in `Sol's review` only. Commit each step as you finish it. Run every command in the foreground. Files: server/orchestrator.js (the compaction end near line 2151 and `COMPACTED_MESSAGE`), tests/compaction-links.test.js (new), docs/agents/CHANGELOG.md, docs/agents/architecture/LIMITS.md.

1. When a compaction succeeds, the room message names what was kept and where the earlier turns are: the chat file's saved messages (still shown) and the turn logs in the runs folder by name, with the limits that apply today (the chat cap and the saved-session history bound, read from the code).
2. The kept summary starts with a line naming the source turn logs it summarized, so a later reader can open them.
3. LIMITS.md states the retention limits in one short section.
4. Tests, each failing before your change: the compaction message names the logs and limits; the summary's first line names the logs.
5. Run `node node_modules/vitest/vitest.mjs run tests/compaction-links.test.js tests/orchestrator.test.js` (skip a file that does not exist) and report the counts.

**P458. Item 12: a first task for a new project, and a plain note on where records live (AGY, Hydrogen).** Read this brief, item 12 and its paragraph in `Sol's review` only. Commit each step as you finish it. Run every command in the foreground. Files: src/ui/panels/DispatchPanel.jsx, src/ui/Connect.jsx, README.md, tests/first-task-card.test.jsx (new), docs/agents/CHANGELOG.md, docs/agents/architecture/ROOM.md. No CSS: reuse existing card classes.

1. When the project has no recorded runs, Dispatch shows a `First task` card that picks the first ready lane whose harness offers Plan, sets Plan for this run only, and fills the task `Read this repository and say what it does, how to run it and how to test it. Change nothing.` The owner can edit or dismiss it; it never starts by itself. No lane with Plan means no card. It never substitutes Bypass or Auto.
2. Connect and README say in one sentence each: `MachineRoom keeps its records, logs and costs on this computer; the agents still send your code to their model providers.`
3. Tests, each failing before your change: the card shows for a project with no runs and a Plan-capable lane; it is absent with runs or with no Plan-capable lane; it sets Plan only for that run.
4. Run `node node_modules/vitest/vitest.mjs run tests/first-task-card.test.jsx` and `npm run build`, and report the counts.

**P459. Item 9: one setup command for a new lane worktree (OpenCode).** Read this brief, item 9 and its paragraph in `Sol's review` only. Commit each step as you finish it. Run every command in the foreground. Files: scripts/run-lane.mjs (`prepareWorktree` near line 621), server/harness-settings.js, src/ui/HarnessesSettings.jsx, tests/worktree-setup.test.js (new), docs/agents/CHANGELOG.md, docs/agents/architecture/LIVE.md. No CSS.

1. Settings keep `worktreeSetup`: one command line, empty by default. When it is set, `prepareWorktree` runs it once in a worktree it has just made (not on reuse), with a 5 minute limit, and the run log records `worktree setup: COMMAND (N s, exit X)`. A failing setup stops the run with that line and leaves the worktree. No file copying and no port handling in this brief.
2. Settings shows a `Worktree setup command` field with the help `Runs once in each new lane worktree, for example npm ci.`
3. Tests, each failing before your change: a new worktree runs the command and logs its time; a reused one does not; a failing command stops the run; empty runs nothing.
4. Run `node node_modules/vitest/vitest.mjs run tests/worktree-setup.test.js tests/harness-settings.test.js` and report the counts.

**P460. Item 15: every run records when it finished, and outcomes count repair runs (OpenCode; Terra stopped on file scope).** Read this brief, item 15 and its paragraph in `Sol's review` only. Commit each step as you finish it. Run every command in the foreground. You may change any existing test whose expectation this brief changes, such as `tests/outcomes.test.js`; name it. Files: src/briefs/run.js (the run record near line 1172), server/outcomes.js, server/runs.js (the merge subject readers near line 122, to read commit times too), scripts/run-lane.mjs (only the `--outcomes` printer near line 1343), tests/outcomes.test.js, tests/outcomes-repair.test.js (new), docs/agents/CHANGELOG.md, docs/agents/architecture/COMMANDS.md. The design is fixed; do not redesign it.

1. Each new run record gains `finishedAt` (ISO time). Older records have none and stay unknown.
2. `outcomeTable` counts, per brief, the runs before its merge that were not failovers or continuations (`failoverFrom`, `continues`) beyond the first, as `repairRuns`, and the minutes from the last run's `finishedAt` to the merge commit's time as `reviewWaitMinutes` when both are known, else `null`. Read merge commit times with `git log --format=%H %cI` where it already reads subjects.
3. `--outcomes` prints both columns, `?` for unknown.
4. Tests, each failing before your change: a record gains `finishedAt`; two plain runs before a merge make `repairRuns: 1`; a failover does not count; a missing time gives `null` and `?`.
5. Run `node node_modules/vitest/vitest.mjs run tests/outcomes-repair.test.js tests/outcomes.test.js` and report the counts.

**P438d. An interrupt never rewrites `runs.jsonl` (AGY, Hydrogen).** Read this brief and P438b above only. Commit each step as you finish it. Run every command in the foreground. Files: scripts/run-lane.mjs (the function that sets `interruptedBy` on an earlier record), server/runs.js (only if it reads `interruptedBy` from the first record), src/briefs/run.js, tests/lane-interrupt.test.js, docs/agents/CHANGELOG.md.

P438b sets `interruptedBy` by reading all of `runs.jsonl`, changing the earlier run's line and writing the whole file back. Many runs append to that file at once, so a record appended between the read and the rename is lost.

1. Remove the rewrite. The continuation's own record carries `continues: NAME` and `interruptedBy: SENDER`; nothing else writes to an earlier line. Anything that showed `interruptedBy` on the first run reads it from the record that `continues` it. If P438b changed `cachedRunRecords` only to notice in-place edits, put that change back.
2. Tests, each failing before your change: an interrupt leaves every earlier line of `runs.jsonl` byte for byte as it was; the continuation record holds `continues` and `interruptedBy`; a record appended by another writer during the interrupt is still there afterwards.
3. Run `node node_modules/vitest/vitest.mjs run tests/lane-interrupt.test.js tests/run-failover.test.js` and report the counts.

**P457b. A compaction names only the logs it summarized, at most ten (OpenCode).** Read this brief and P457 above only. Commit each step as you finish it. Run every command in the foreground. Files: server/orchestrator.js (`turnLogNames`, `compactedMessage`, `compactedSummary`), tests/compaction-links.test.js, docs/agents/CHANGELOG.md.

P457 lists every chat turn log the orchestrator ever wrote, so after weeks of use the room message and the summary fed back to the model carry hundreds of names.

1. Name only the turn logs written since the previous compaction (or since the session began when there was none). Show at most the 10 newest, then `and N earlier` when there are more.
2. Tests, each failing before your change: with 30 logs and a compaction after the 20th, the next compaction names only the 10 written since; with 15 since, it names 10 and says `and 5 earlier`.
3. Run `node node_modules/vitest/vitest.mjs run tests/compaction-links.test.js tests/orchestrator.test.js` and report the counts.

Research plan, third batch, P461 and P462 (first steps as Sol narrowed them; both need P438b and P438d on main).

**P461. Item 5: a lane message gets an id and a status the sender can read (OpenCode).** Read this brief, item 5 and its paragraph in `Sol's review` only. Commit each step as you finish it. Run every command in the foreground. Files: server/orchestrators.js (`receiveLaneMessage`, `laneInbox`, the two `{ id: null }` replies in `message`, the `/api/orchestrator/messages` route), tests/lane-message-status.test.js (new), docs/agents/CHANGELOG.md, docs/agents/architecture/LIVE.md. No UI in this brief.

1. `receiveLaneMessage` gives each inbox entry a stable id (`randomUUID`) and a status `queued`. When `laneInbox` hands the entry to the lane it becomes `fetched` with `fetchedAt`; when an interrupt takes it (`takeUnseen`) it becomes `interrupted`. `fetched` means the lane's runner read it, not that the model acted on it: say so in LIVE.md.
2. Both lane-message replies answer `{ id }` instead of `{ id: null }`.
3. `GET /api/orchestrator/messages/status?id=ID` answers `{ id, status, at, fetchedAt? }`. Only the sender may read it: the same lane ticket, or the same orchestrator token, or the page. Anyone else gets 404 with no hint that the id exists. Ended runs keep the status while the entry is still in the inbox; past `LANE_INBOX_LIMIT` it is 404. The inbox the lane reads keeps its present fields and adds only `id`.
4. Tests, each failing before your change: a sent message answers an id and reads `queued`; after the target lane reads its inbox it reads `fetched`; an interrupt makes it `interrupted`; another lane's ticket gets 404; the page can read it.
5. Run `node node_modules/vitest/vitest.mjs run tests/lane-message-status.test.js tests/orchestrators.test.js` and report the counts.

**P462. Item 8: each lane run records its checkpoint, with no rewind (OpenCode).** Read this brief, item 8 and its paragraph in `Sol's review` only. Commit each step as you finish it. Run every command in the foreground. Files: scripts/run-lane.mjs (where `startHead` and `runBase` are read, near lines 1556 and 2071), src/briefs/run.js (`runRecord`), server/runs.js (only the run entry it serves), src/ui/Inspector.jsx (one read-only row), tests/run-checkpoint.test.js (new), docs/agents/CHANGELOG.md, docs/agents/architecture/LIVE.md. No CSS. Nothing in this brief moves a branch, resets a file or deletes anything.

1. Before the agent starts, the runner records `checkpoint: { head, branch, dirty, dirtyFiles }` on the run record: the worktree's HEAD, its branch, whether `git status --porcelain` showed changes, and at most 20 of those paths (then a count). A continuation (`--continue-from`) records its own checkpoint, so dirty work carried in from the interrupted run is visible.
2. When the worktree is dirty at start, the runner also writes a recovery ref with `git stash create` (which does not touch the worktree or the stash list) and records it as `checkpoint.recovery`. When `stash create` prints nothing, there is no `recovery` field. Never run bare `git stash`.
3. The run entry served by `server/runs.js` carries `checkpoint`, and Inspector shows one row `Checkpoint: SHORT_HEAD on BRANCH` plus `, N changed files kept as RECOVERY_SHORT` when dirty. Older records have none and show nothing.
4. Tests, each failing before your change: a clean start records head and branch with `dirty: false`; a dirty start records the files and a recovery ref that `git cat-file -t` reads as a commit, and the worktree is unchanged afterwards; a continuation records its own checkpoint; Inspector shows the row.
5. Run `node node_modules/vitest/vitest.mjs run tests/run-checkpoint.test.js tests/lane-interrupt.test.js` and `npm run build`, and report the counts.

**P463. Item 2, UI step: Reviews shows what was checked apart from what the agent said (OpenCode).** Read this brief, item 2 and its paragraph in `Sol's review` only. Commit each step as you finish it. Run every command in the foreground. Files: src/ui/panels/reviews.js (the row built near line 180), src/ui/panels/ReviewsPanel.jsx (the row near line 694), tests/reviews-evidence.test.jsx (new), docs/agents/CHANGELOG.md, docs/agents/architecture/ROOM.md. No CSS: reuse the classes the row already uses. No server change: P451 already serves `evidence`, `claims`, `runs` and `runTotals` on each lane review (`server/reviews.js` near line 699).

1. Under the existing check line, a row shows `Checked on HEAD_SHORT: passed` (or `failed`) from `evidence`, or `Not checked on this head` when `evidence.checkedHead` is null, plus `(an older head was checked)` when `evidence.stale`.
2. A separate line headed `The agent said:` shows `claims` text, at most 3 lines with a `More` toggle; none means no line. Never mix it into the check line.
3. When `runs` has more than one entry, a line lists them in order as `LANE (MODEL), N min` joined by ` then `, and a totals line `R runs, M run minutes, $C` where any unknown value shows `?` and `partial` adds ` (some runs did not report)`. Never show 0 for an unknown.
4. Tests, each failing before your change: checked head shown; not checked shown; stale note; claims apart from checks; two linked runs and a partial total with `?`.
5. Run `node node_modules/vitest/vitest.mjs run tests/reviews-evidence.test.jsx tests/reviews-panel.test.js` (skip a file that does not exist) and `npm run build`, and report the counts.

**P464. Item 6, UI step: stop an orchestrator together with its lanes (AGY, Hydrogen).** Read this brief, item 6 and its paragraph in `Sol's review` only. Commit each step as you finish it. Run every command in the foreground. Files: src/control/client.js (next to `stopOrchestrator` near line 253), src/control/mock.js, src/ui/OrchestratorChat.jsx (the stop confirm near line 1512 and `stopConfirmed`), tests/control-contract.test.js, tests/control-mock.test.js, tests/orchestrator-stop-tree.test.jsx (new), docs/agents/CHANGELOG.md, docs/agents/architecture/ROOM.md. No CSS: reuse `mr-orch-confirm-btn is-stop`. No server change: P450 serves `POST /api/orchestrator/stop-tree` with `{ id, confirmed: true }` and answers `{ stoppedOrchestrators, stoppedLanes, stillRunning }`.

1. The client gains `stopTree({ id, confirmed = true })` that posts to `/api/orchestrator/stop-tree`, leaving out `id` for Main; the mock answers the same shape.
2. The stop confirm keeps `Stop` and adds `Stop with its lanes`, which calls `stopTree` for the selected orchestrator. For Main its label is `Stop everything`.
3. After it answers, the confirm area shows `Stopped N lanes.` and, when `stillRunning` is not empty, `Still running: a, b.` It never says a lane stopped unless the server listed it.
4. Tests, each failing before your change: the client posts the right body for a sub and for Main; the mock shape matches; the button calls `stopTree` and shows both lines; a failure shows the server's error.
5. Run `node node_modules/vitest/vitest.mjs run tests/orchestrator-stop-tree.test.jsx tests/control-contract.test.js tests/control-mock.test.js tests/orchestrator-chat.test.js` and `npm run build`, and report the counts.

**P462b. A checkpoint says which changed files its recovery ref does not keep (AGY, Hydrogen; OpenCode stopped at its monthly quota).** Read this brief and P462 above only. Commit each step as you finish it. Run every command in the foreground. Files: scripts/run-lane.mjs (`checkpointFor`), src/briefs/run.js (`checkpointField`), src/ui/Inspector.jsx (the checkpoint row), tests/run-checkpoint.test.js, docs/agents/CHANGELOG.md, docs/agents/architecture/LIVE.md.

`git stash create` keeps changes to tracked files only, but the Inspector says every changed file was kept.

1. The checkpoint also records `untrackedCount`, the number of `??` lines in the status. `recovery` is written only when at least one tracked file changed.
2. The Inspector row's text drops its own `Checkpoint:` prefix (the row label already says it) and reads `SHORT_HEAD on BRANCH`, then `, N changed files kept as RECOVERY_SHORT` for the tracked ones, then `, U untracked files not kept` when there are any. Untracked only reads `, U untracked files not kept`.
3. Tests, each failing before your change: an untracked-only worktree has no `recovery` and the row says the files were not kept; a mixed worktree counts both; the row has no doubled `Checkpoint`.
4. Run `node node_modules/vitest/vitest.mjs run tests/run-checkpoint.test.js` and report the counts.

**P465. Item 4, second step: a short list of what needs the owner (AGY, Hydrogen).** Read this brief, item 4 and its paragraph in `Sol's review` only. Commit each step as you finish it. Run every command in the foreground. Files: scripts/mr-agent.mjs (the loop stop near line 1704 and `finish` near line 1537), scripts/run-lane.mjs (only where the run record takes `exitCode: result.code`, near lines 2386 and 2443), src/briefs/run.js (`runRecord`), src/briefs/attention.js (new), server/runs.js (the `GET /api/control/runs` answer near line 1816), src/ui/panels/DispatchPanel.jsx (above the recent runs list near line 1724), tests/attention.test.js (new), tests/native-loop.test.js (its exit code expectation), tests/bridge-routes.test.js (the exact `GET /api/control/runs` answer), package.json (add `src/briefs/attention.js` to `files`), docs/agents/CHANGELOG.md, docs/agents/architecture/ROOM.md. You may change any existing test whose expectation this brief changes; name it. No CSS: reuse `runs-entry` and its `is-failed` class.

1. A native run (`machineroom` harness) that P454's loop check stops exits with code 4, and its run record gains `stopReason: 'repeated failure'`. No other harness and no other exit code sets it.
2. `attentionItems(records)` in `src/briefs/attention.js` takes the newest record of each lane and answers `[{ lane, startedAt, text }]` for: a failure that the owner did not stop (`exitCode` not 0, `killed` false): `LANE failed on BRIEFS.`; a start failure: `LANE could not start.`; `stopReason: 'repeated failure'`: `LANE stopped: the same call failed five times.` It leaves out runs that ended 0 with no commits (plan and review work), runs the owner stopped, and a failure whose `failover.to` backup ran later. Silence is never an item.
3. `GET /api/control/runs` adds `attention` from the visible records. Dispatch shows `Needs you` with at most 5 lines above the recent runs when the list is not empty, and nothing otherwise. An item leaves when the lane has a newer run.
4. Tests, each failing before your change: a loop stop records the reason; a plain failure is an item; a stopped run, a 0-exit run with no commits and a failure taken over by its backup are not; a newer run clears the item; Dispatch shows the heading only with items.
5. Run `node node_modules/vitest/vitest.mjs run tests/attention.test.js tests/mr-agent.test.js` (skip a file that does not exist) and `npm run build`, and report the counts.

**P461b. Item 5: the sender reads a lane message's status (Codex, Terra; OpenCode stopped at its monthly quota after P461's first two steps, AGY ran out of credits and the Claude lane's sign-in expired).** Read this brief and P461 above only. Commit each step as you finish it. Run every command in the foreground. Files: server/orchestrators.js (the `/api/orchestrator/messages` route near line 1180, and a `messageStatus` function beside `laneInbox`), tests/lane-message-status.test.js, tests/lane-inbox.test.js (only if an expectation changes; name it), docs/agents/CHANGELOG.md, docs/agents/architecture/LIVE.md. No UI.

P461 gives each inbox entry an `id` and a `status` (`queued`, `fetched` with `fetchedAt`, `interrupted`) and answers a lane message with `{ id }`. Nothing reads the status yet.

1. `GET /api/orchestrator/messages/status?id=ID` answers `{ id, status, at, fetchedAt? }`. Only the sender may read it: the same lane ticket (`lane:LANE` sender), the same orchestrator token (`orchestrator` or `sub:ID` sender), or the page. Anyone else, an unknown id, or an entry pushed out past `LANE_INBOX_LIMIT` gets 404 with the same body, so a caller cannot tell which.
2. Keep each entry's sender identity on the entry when it is made, so the check never depends on the display `from` text alone.
3. Tests, each failing before your change: the sending lane reads `queued`, then `fetched` after the target reads its inbox; the orchestrator that sent reads its own; another lane's ticket and another sub's token get 404; the page reads any; an unknown id gets the same 404.
4. Run `node node_modules/vitest/vitest.mjs run tests/lane-message-status.test.js tests/lane-inbox.test.js` and report the counts.

**P466. Review 47: P438 to P465 (Codex, GPT-6.1 Sol, report).** Read this brief only. Change no file except the one you write. Your sandbox keeps git read-only: write the file in your worktree and the runner commits it. Known sandbox baseline failures, not yours: process tests in `tests/run-lane-stop.test.js`, `tests/run-lane.test.js`, `mr-agent > stops the whole shell tree on the time limit`, and the removed-sub test in `tests/orchestrators.test.js`. Do not install or copy `node_modules` into the worktree. Files: docs/agents/AUDIT-2026-11-REVIEW-47.md.

1. Review `git diff ab0f54d1..d1d635c3`: the four approved ideas (P438a to P438d lane replies and interrupts, P439 and P439b takeover, P440 OpenCode modes, P441 sub modes), the review 46 fixes (P444 to P447), and the research plan first steps (P448 to P465 with P457b, P461b and P462b). `docs/agents/PLAN-RESEARCH.md` says what each item promised.
2. Look for, first: a route that P450 stop-tree, P461b message status, P459 worktree setup or P465 attention opens to a caller it should not (a lane ticket, a sub token outside its sector, a cross-origin page); a lane ticket or token that can read another sender's message status; an interrupt or continuation that loses a reply, rewrites `runs.jsonl`, or loops past its chain limit; a checkpoint or `stash create` that changes the worktree; the worktree setup command running on a reused worktree or without the owner's own settings; a cost, token or minute total that shows 0 for unknown; a doc sentence the code contradicts; a test that passes with its change undone.
3. Each finding: `R47-N`, a severity, the file and line, what goes wrong, how to see it, one fix. At most 10. No finding without a file and line you read.
4. End with `Checked and fine`. Under 100 lines. Plain words, no em dashes.

Review 47 fixes, P467 to P471. `docs/agents/AUDIT-2026-11-REVIEW-47.md` (P466, GPT-6.1 Sol): ten findings, read back by the orchestrator. OpenCode is retired at its monthly quota and AGY is out of credits, so each brief runs on Codex (Terra). Every brief: read the brief and its findings only; leave your changes uncommitted, the runner commits them; tests that make their own temporary git repositories are allowed; run every command in the foreground; you may change any existing test whose expectation the brief changes, and name it; known sandbox baseline failures, not yours: process tests in `tests/run-lane-stop.test.js`, `tests/run-lane.test.js`, `mr-agent > stops the whole shell tree on the time limit`, and the removed-sub test in `tests/orchestrators.test.js`; do not install or copy `node_modules`.

**P467. R47-1, R47-2 and R47-5: an interrupted backup continues as itself (Codex, Terra).** Read this brief and R47-1, R47-2 and R47-5 only. Leave your changes uncommitted; the runner commits them. Tests that make their own temporary git repositories are allowed. Run every command in the foreground. You may change any existing test whose expectation this brief changes; name it. Files: server/runs.js (`interruptLane` near line 1563 and `continuesChainCount`), scripts/run-lane.mjs (only where `--continue-from` picks the worktree and branch, near lines 1482 to 1545), tests/interrupt-backup.test.js (new), docs/agents/CHANGELOG.md.

1. When the interrupted run is a backup (the active lane is not `item.entry.lane`), the continuation takes the backup lane's own saved model and mode, never the primary's `item.model` and `item.mode`; a fixed saved mode on the backup always wins.
2. A continuation resumes in the worktree and branch recorded for the interrupted run, not one derived from the new lane name.
3. The chain limit counts continuations and failovers together on the retained ticket, so three interrupts in all is the limit across a failover.
4. Tests, each failing before your change: Bypass primary failed over to a Plan backup, then interrupted, restarts in Plan with the backup's model; the continuation's worktree is the interrupted run's; two interrupts, a failover and a third interrupt make a fourth refused.

**P468. R47-4 and R47-6: a failed interrupt keeps its replies, and Stop sector cancels a pending continuation (Codex, Terra).** Read this brief and R47-4 and R47-6 only. Leave your changes uncommitted; the runner commits them. Tests that make their own temporary git repositories are allowed. Run every command in the foreground. You may change any existing test whose expectation this brief changes; name it. Files: server/orchestrators.js (`takeUnseen` in `receiveLaneMessage` near line 875), server/runs.js (`interruptLane` and `stopSectorLanes`), tests/interrupt-cancel.test.js (new), docs/agents/CHANGELOG.md.

1. Replies are marked seen and `interrupted` only after the continuation has started. When the stop fails or no continuation starts, they stay `queued` and the next interrupt or inbox read still gets them.
2. Stop sector (and Stop everything) marks every interrupt in progress inside its target as cancelled before it stops lanes, and `interruptLane` checks that mark and `isLaneStopping` right before `startRun`; a cancelled interrupt starts nothing.
3. Tests, each failing before your change: a failed stop leaves the reply queued and the next interrupt sends it; an interrupt held open while Stop sector runs never restarts the lane.

**P469. R47-3: a native final answer never drops a reply read at the same time (Codex, Terra).** Read this brief and R47-3 only. Leave your changes uncommitted; the runner commits them. Tests that make their own temporary git repositories are allowed. Run every command in the foreground. You may change any existing test whose expectation this brief changes; name it. Files: scripts/mr-agent.mjs (the step loop near lines 1600 to 1660), tests/native-reply-final.test.js (new), docs/agents/CHANGELOG.md.

1. When a model call ends with a final answer while `heldInbox` holds a reply, the agent records that call's usage, adds the reply as a user message and makes one more model call instead of finishing.
2. Test, failing before your change: the model returns a final answer while an inbox poll is in flight; the reply is delivered and a second model call happens.

**P470. R47-7 and R47-8: a stop is never claimed without proof, and review totals include retries (Codex, Terra).** Read this brief and R47-7 and R47-8 only. Leave your changes uncommitted; the runner commits them. Tests that make their own temporary git repositories are allowed. Run every command in the foreground. You may change any existing test whose expectation this brief changes; name it. Files: server/runs.js (`safeListProcesses` near line 663 and `stopSectorLanes`), server/reviews.js (`linkedRuns` near line 475), tests/stop-tree-unverified.test.js (new), tests/review-retries.test.js (new), docs/agents/CHANGELOG.md, docs/agents/architecture/LIVE.md.

1. When the process list cannot be read, `stopSectorLanes` reports each lane it could not check in `stillRunning` (never `stoppedLanes`), and LIVE.md says so.
2. `linkedRuns` also includes earlier runs of the same lane on the same task branch that were retries or plain repair runs, so their minutes, cost and tokens reach the totals; unknown values stay unknown.
3. Tests, each failing before your change: a failing process list puts the lane in `stillRunning`; a retried run and its retry both appear in the review's runs and totals.

**P471. R47-9 and R47-10: removed lanes keep their unknown costs, and the MCP cache key covers environment values (Codex, Terra).** Read this brief and R47-9 and R47-10 only. Leave your changes uncommitted; the runner commits them. Tests that make their own temporary git repositories are allowed. Run every command in the foreground. You may change any existing test whose expectation this brief changes; name it. Files: server/lane-costs.js (the removed-lane rows near line 147), server/mcp.js (the cache key near line 528), tests/lane-costs-removed.test.js (new), tests/mcp-list-cache.test.js, docs/agents/CHANGELOG.md.

1. A removed lane with runs keeps its row when its costs are unknown, with its known tokens and its `missingCostRuns`, and the summary marks spend as partial instead of showing 0.
2. The MCP list cache key is a hash of the whole normalized server configuration, environment values included; the values are never logged or stored in plain text.
3. Tests, each failing before your change: a removed lane with only unknown cost and 100 input tokens keeps its row and the partial mark; changing only an environment value lists the tools again.

**P472. CI: the interrupt test's repository has its own git identity (Codex, Terra).** Read this brief only. Leave your changes uncommitted; the runner commits them. Tests that make their own temporary git repositories are allowed. Run every command in the foreground. Files: tests/lane-interrupt.test.js (only `makeRepo` near line 77), docs/agents/CHANGELOG.md.

CI at `bfeeae12` fails `interrupting a working CLI lane run > stops the run, keeps uncommitted work and branch...` on Ubuntu and Windows: `expected 'M  readme.txt\nA  wip.txt' to be ''`. The test gives only its own git calls an identity (`GIT_IDENTITY`); the runner that the bridge starts makes the queue commit with the machine's identity, and the CI runners have none, so the add works and the commit fails. Running the test with `GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1` shows the same failure locally.

1. `makeRepo` sets `user.name` and `user.email` in the new repository's own config (the values in `GIT_IDENTITY`) right after `git init`, so every commit in it works with no global identity.
2. Run `GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1 node node_modules/vitest/vitest.mjs run tests/lane-interrupt.test.js` in a bash shell (in PowerShell set the two variables with `$env:` first) and report the counts. It must pass with no global identity.

Research plan, later steps the owner approved on 2026-11-17 ("Yes, go"): items 14, 12, 5 and 1, in that order. Each brief stands alone.

**P473. Item 14, second step: a long MCP tool call that reports progress does not time out (Claude, Sonnet).** Read this brief, item 14 and its paragraph in `Sol's review` only. Commit each step as you finish it. Run every command in the foreground. Never use git stash. Files: server/mcp.js (`stdioSession` and its `readLine` near line 280, `httpSession`, and `callMcpTool` near line 497), tests/mcp-progress.test.js (new), docs/agents/CHANGELOG.md, docs/agents/architecture/LIMITS.md.

1. `tools/call` sends `_meta: { progressToken }` with a fresh token. A `notifications/progress` message with that token resets an inactivity timer of `MCP_CALL_TIMEOUT_MS`; other notifications are still ignored.
2. A hard ceiling, `MCP_CALL_CEILING_MS` = 10 minutes, ends the call however much progress arrives, with its own message. `tools/list` keeps its fixed time limit.
3. LIMITS.md states both numbers in one sentence.
4. Tests, each failing before your change: a fake stdio server that sends progress every 5 seconds for 40 seconds (use fake timers) answers successfully; one that sends nothing still times out at the inactivity limit; one that sends progress forever stops at the ceiling; a progress notice with another token does not reset the timer.
5. Run `node node_modules/vitest/vitest.mjs run tests/mcp-progress.test.js tests/mcp.test.js tests/mcp-list-cache.test.js` (skip a file that does not exist) and report the counts. Commit your work when done.

**P474. Item 12, second step: a project can start its lanes in Plan by default (AGY, Hydrogen).** Read this brief, item 12 and its paragraph in `Sol's review` only. Commit each step as you finish it. Run every command in the foreground. Files: the project settings route and its saved file (find them from `client.projectSettings` and `client.saveProjectSettings` in src/control/client.js), src/control/client.js, src/control/mock.js, src/ui/panels/DispatchPanel.jsx (the effect that picks `projectMode` near line 205), tests/plan-default.test.jsx (new), tests/control-contract.test.js, tests/control-mock.test.js, docs/agents/CHANGELOG.md, docs/agents/architecture/ROOM.md. No CSS. You may change any existing test whose expectation this brief changes; name it.

1. Project settings keep `planByDefault` (true or false, false by default), saved with the project's other settings.
2. When it is true, Dispatch's `Mode for this run` starts at Plan for any lane whose harness offers Plan, instead of the lane's saved mode or `defaultMode`. A lane without Plan keeps its usual start and the confirm card says `This lane has no Plan mode.` It never substitutes Bypass or Auto, and the owner can still pick another mode for the run.
3. Dispatch shows a checkbox `Start new runs in Plan` next to the project's other settings, saved on change.
4. Tests, each failing before your change: the setting saves and reads back; with it on, a Plan-capable lane starts in Plan; a lane without Plan shows the line and keeps its mode; with it off nothing changes.
5. Run `node node_modules/vitest/vitest.mjs run tests/plan-default.test.jsx tests/control-contract.test.js tests/control-mock.test.js tests/first-task-card.test.jsx` and `npm run build`, and report the counts.

**P475. Item 5, UI step: send a lane a message and see whether it was read (AGY, Hydrogen).** Read this brief, item 5 and its paragraph in `Sol's review` only. Commit each step as you finish it. Run every command in the foreground. Files: server/orchestrators.js (`message` near line 960: the page path for a `lane:KEY` target, and `receiveLaneMessage`), src/control/client.js, src/control/mock.js, src/ui/LaneConversation.jsx, tests/lane-send.test.jsx (new), tests/control-contract.test.js, tests/control-mock.test.js, docs/agents/CHANGELOG.md, docs/agents/architecture/ROOM.md, docs/agents/architecture/LIVE.md. No CSS: reuse the classes LaneConversation already uses. You may change any existing test whose expectation this brief changes; name it.

1. The owner page may send to `lane:KEY` through `POST /api/orchestrator/messages`; the sender is `owner`, and a lane with no live run answers the existing 409. The body may carry `interrupt: true` or `false`, which overrides the `laneReplies` setting for that one message; without it the setting decides as today. A lane on the `machineroom` harness ignores `interrupt: true` as today.
2. The client gains `sendLaneMessage({ lane, text, interrupt })` and `laneMessageStatus(id)`; the mock answers the same shapes.
3. LaneConversation shows, for a running lane, a text box with `Send` and `Send and interrupt`. Each sent message appears under the box with its status read from `GET /api/orchestrator/messages/status` (`Queued`, `Read by the runner`, `Interrupted the run`), refreshed every 5 seconds while the run is live and once more when it ends. `Read by the runner` must not claim the model acted on it.
4. Tests, each failing before your change: the page can send to a running lane and gets an id; `interrupt: false` does not interrupt when the setting is `interrupt`, and `interrupt: true` does when it is `next-turn`; the view shows both buttons only for a running lane and updates the status line.
5. Run `node node_modules/vitest/vitest.mjs run tests/lane-send.test.jsx tests/lane-message-status.test.js tests/lane-replies-setting.test.js tests/control-contract.test.js tests/control-mock.test.js` and `npm run build`, and report the counts.

**P476. Item 1, second step: the ACP runner enforces Plan, Auto and Bypass (Codex, Sol; Terra stopped on the file list).** Read this brief, item 1 and its paragraph in `Sol's review` only. Leave your changes uncommitted; the runner commits them. Tests that make their own temporary git repositories are allowed. Run every command in the foreground. Known sandbox baseline failures, not yours: process tests in `tests/run-lane-stop.test.js`, `tests/run-lane.test.js`, `mr-agent > stops the whole shell tree on the time limit`, and the removed-sub test in `tests/orchestrators.test.js`; do not stop on them. Do not install or copy `node_modules`. Files: scripts/acp-run.mjs (`answerRequest` near line 185, `acpRunCommand` near line 64 and the argument parser), scripts/run-lane.mjs (`laneSpawn` near line 1006 and its call near line 2157, to pass the effective mode), src/control/modes.js (`LISTS`, `LEGACY` and `sandboxSummary` for `acp`), tests/acp-permissions.test.js (new), tests/inspector-sandbox.test.jsx, docs/agents/CHANGELOG.md, docs/agents/FREE-HIERARCHY.md. You may change any existing test whose expectation this brief changes; name it.

1. `acp-run.mjs` takes `--mode plan|auto|bypass`, and `laneSpawn` passes the lane's effective mode. `modes.js` lists `plan`, `auto` and `bypass` for `acp`; its legacy mode is `bypass`, so a saved lane with no mode behaves as today.
2. Each `session/request_permission` is decided from the request's `toolCall.kind` and `toolCall.locations`. Plan: allow `read`, `search` and `think`; refuse everything else. Auto: also allow `edit`, `delete` and `move` only when every location resolves inside `--cwd` (after resolving `..` and links); refuse `execute`, `fetch`, `other`, any kind not listed, and any request with no kind, or with no locations where locations are needed. Bypass: allow as today. A refusal picks a `reject_once` (or other `reject` kind) option, else answers `cancelled`, and the run log gets one line `refused KIND: REASON`.
3. `sandboxSummary('acp', mode)` says what each mode does in one line, for example `Allows reads only` and `Allows reads and edits inside the project; refuses commands`, and Bypass keeps `Approves every request the agent asks for`.
4. FREE-HIERARCHY.md says in one sentence that ACP modes are enforced by the runner from the agent's own request kinds, so an agent that mislabels a request can still get past them.
5. Tests, each failing before your change: Plan refuses an edit; Auto allows an edit inside the folder and refuses one outside it, one through `..`, and an execute; a request with no kind is refused in Plan and Auto; Bypass allows all; `laneSpawn` passes `--mode`.
6. Run `node node_modules/vitest/vitest.mjs run tests/acp-permissions.test.js tests/inspector-sandbox.test.jsx tests/acp-run.test.js` (skip a file that does not exist) and report the counts.

**P477. Review 48: P473 to P476 (Codex, GPT-6.1 Sol, report).** Read this brief only. Change no file except the one you write. Your sandbox keeps git read-only: write the file in your worktree and the runner commits it. Known sandbox baseline failures, not yours: process tests in `tests/run-lane-stop.test.js`, `tests/run-lane.test.js`, `mr-agent > stops the whole shell tree on the time limit`, and the removed-sub test in `tests/orchestrators.test.js`. Do not install or copy `node_modules` into the worktree. Files: docs/agents/AUDIT-2026-11-REVIEW-48.md.

1. Review `git diff 77b0deb9..HEAD`: the research plan second steps for items 14 (P473, MCP progress and the ten-minute ceiling), 12 (P474, Plan by default), 5 (P475, the owner sends a lane a message) and 1 (P476, the ACP runner enforces Plan, Auto and Bypass). `docs/agents/PLAN-RESEARCH.md` says what each item promised.
2. Look for, first: an MCP call that runs past ten minutes, or a progress notice from another call or a malformed one that keeps a call alive; a `planByDefault` save that wipes other project settings or reaches a lane with no Plan as Bypass or Auto; a `lane:KEY` message that a lane ticket, a sub token outside its sector or a cross-origin page can send, or whose `interrupt` flag any sender other than the owner page can set; a status line that says the model acted on a message; an ACP request that Plan or Auto allows when it should refuse (a link or `..` out of the folder, a missing kind, a missing location, a path that does not exist yet under a link), or a mode that does not reach the runner (a run-level mode, a `choice` lane, a backup lane); a saved `choice` ACP lane whose default changed from Bypass without a doc saying so; a doc sentence the code contradicts; a test that passes with its change undone.
3. Each finding: `R48-N`, a severity, the file and line, what goes wrong, how to see it, one fix. At most 10. No finding without a file and line you read.
4. End with `Checked and fine`. Under 100 lines. Plain words, no em dashes.

Review 48 fixes, P478 to P480. `docs/agents/AUDIT-2026-11-REVIEW-48.md` (P477, GPT-6.1 Sol): five findings, read back by the orchestrator. Every brief: read the brief and its findings only; commit each step as you finish it unless the brief says the runner commits; run every command in the foreground; never use git stash; you may change any existing test whose expectation the brief changes, and name it.

**P478. R48-1 and R48-2: MCP progress is checked and read whole (Claude, Sonnet).** Files: server/mcp.js (`isProgress` near line 259 and `readStream` near line 478), tests/mcp-progress.test.js, docs/agents/CHANGELOG.md.

1. `isProgress` resets the timer only for a notification: no `id`, `method` `notifications/progress`, a token of this call, and a finite number `params.progress`. Anything else is ignored.
2. `readStream` reads only complete SSE events, accepts both `\n\n` and `\r\n\r\n` separators, and keeps an incomplete event whole for the next chunk.
3. Tests, each failing before your change: a notice with an `id` or without a numeric `progress` does not keep a call alive on stdio or HTTP; HTTP progress with CRLF separators resets the timer; an event split after its first byte still resets it.
4. Run `node node_modules/vitest/vitest.mjs run tests/mcp-progress.test.js tests/mcp.test.js tests/mcp-list-cache.test.js` (skip a file that does not exist) and report the counts.

**P479. R48-3 and R48-5: ACP Auto refuses `..` and the choice default is written down (Codex, Sol).** Leave your changes uncommitted; the runner commits them. Tests that make their own temporary folders are allowed. Known sandbox baseline failures, not yours: process tests in `tests/run-lane-stop.test.js`, `tests/run-lane.test.js`, `mr-agent > stops the whole shell tree on the time limit`, and the removed-sub test in `tests/orchestrators.test.js`. Do not install or copy `node_modules`. Files: scripts/acp-run.mjs (`permissionRefusal` near line 116), tests/acp-permissions.test.js, docs/agents/CHANGELOG.md, docs/agents/FREE-HIERARCHY.md.

1. Auto refuses any location whose path has a `..` component (split on both `/` and `\`) with `A location uses .. in its path.`, before any resolve.
2. CHANGELOG and FREE-HIERARCHY each say in one sentence that a saved ACP lane with mode `choice` now starts in Auto, and that `cli.mode: "bypass"` keeps the old behaviour.
3. Tests, each failing before your change: `escape/../victim.txt` and `..\x` are refused in Auto; a plain path inside the folder is still allowed.
4. Run `node node_modules/vitest/vitest.mjs run tests/acp-permissions.test.js tests/inspector-sandbox.test.jsx` and report the counts.

**P480. R48-4: split tasks honour Start new runs in Plan (AGY, Hydrogen).** Files: src/ui/panels/DispatchPanel.jsx (the split start near line 887), src/ui/panels/runs.js (`startSplitRun` near line 369), tests/plan-default.test.jsx, docs/agents/CHANGELOG.md. No CSS.

1. With `planByDefault` on, each split pair whose lane offers Plan starts with `mode: 'plan'`. A pair whose lane has no Plan keeps its usual mode, and the confirm shows `This lane has no Plan mode.` once per such lane. With it off nothing changes.
2. Tests, each failing before your change: with the setting on, two split tasks on Plan-capable lanes each send `mode: 'plan'`; a lane without Plan sends no mode and shows the line; with it off no mode is sent.
3. Run `node node_modules/vitest/vitest.mjs run tests/plan-default.test.jsx tests/first-task-card.test.jsx` and `npm run build`, and report the counts.

**P481. CI: stopLane tests never ask the real process table (AGY, Hydrogen).** Read this brief only. Commit each step as you finish it. Run every command in the foreground. Never use git stash. Files: tests/run-lane-stop.test.js only.

1. CI on ubuntu-latest at `95a8fa8e` failed `stopLane creation time rules > treats a process missing from the list as gone` with `expected 1 to be +0`: `stopLane` (scripts/run-lane.mjs near line 391) calls the real `processAlive` for the fake pids 100 and 200, and on a Linux runner those pids can be real processes.
2. Give every `stopLane(...)` call in the file that uses fake pids an `alive` stub that answers from the test's own fake process list (or `() => false` where the test means the run is gone), so no test depends on which pids exist on the machine. Change no expectation.
3. Run `node node_modules/vitest/vitest.mjs run tests/run-lane-stop.test.js` and report the counts.

**P482. CI: the projects.json test does not depend on test file order (AGY, Hydrogen).** Read this brief only. Commit each step as you finish it. Run every command in the foreground. Never use git stash. Files: tests/projects.test.js only.

1. CI on windows-latest at `ea8dc51d` failed `projects api > records projects.json under the test temp root and not under %TEMP%\machineroom-runs when runsFolder is unset` (tests/projects.test.js near line 945): `stored.recent[0].path` was another test file's repository (`mr-git-repo-...` from tests/git.test.js). Test files in the same process share `MACHINEROOM_RUNS`, so a bridge started at the same time can record its project first.
2. Assert that `stored.recent` contains an entry whose path is `resolve(env.root)`, not that it is first. Keep every other expectation.
3. Run `node node_modules/vitest/vitest.mjs run tests/projects.test.js tests/git.test.js` and report the counts.

**P483. Checks open no console windows on Windows (AGY, Hydrogen).** The owner, 2026-11-17: terminal pop-ups from the checks are intrusive while they use the computer. Read this brief only. Commit each step as you finish it. Run every command in the foreground. Never use git stash. Do not run the full suite: run only the files named in step 5. Files: tests/helpers/isolate.js (the vitest setup file in vite.config.js), tests/helpers/hide-windows.mjs (new), scripts/pack-check.mjs, scripts/scale-live.mjs, scripts/screenshots.mjs, scripts/test.mjs, tests/windows-hide.test.js (new), docs/agents/CHANGELOG.md, docs/agents/architecture/COMMANDS.md.

1. `tests/helpers/hide-windows.mjs` wraps `spawn`, `spawnSync`, `execFile`, `execFileSync`, `exec`, `execSync` and `fork` of `node:child_process` so their options default to `windowsHide: true` (an explicit `windowsHide: false` still wins, and the argument shapes without an options object still work), then calls `syncBuiltinESMExports()` from `node:module` so ESM named imports see the wrapped functions. Importing it twice wraps once.
2. `tests/helpers/isolate.js` imports it first, and adds `--import=<file URL of hide-windows.mjs>` to `process.env.NODE_OPTIONS` (kept once, other options kept) so node processes that tests start (run-lane, the bridge, fake lane scripts) hide their own children too.
3. Every `child_process` call in `scripts/pack-check.mjs`, `scripts/scale-live.mjs`, `scripts/screenshots.mjs` and `scripts/test.mjs` passes `windowsHide: true`.
4. `tests/windows-hide.test.js`, the audit check: it reads every `.js`, `.mjs` and `.cjs` file under `server/`, `scripts/` and `bin/`, finds each call of `spawn(`, `spawnSync(`, `execFile(`, `execFileSync(`, `exec(`, `execSync(` or `fork(` that comes from `child_process`, and fails with the file and line of any call whose options do not set `windowsHide` (an options object built by a shared helper such as `treeSpawnOptions` counts when that helper sets it). It also checks that a wrapped `spawnSync` from step 1 defaults `windowsHide` to true and keeps an explicit false.
5. Run `node node_modules/vitest/vitest.mjs run tests/windows-hide.test.js tests/process-tree.test.js tests/pack-check.test.js tests/agents-config.test.js` and report the counts.

## Research plan, later steps (2026-11-17)

The owner, 2026-11-17, before sleeping: continue until all goals are fulfilled; Codex Terra codes, Sol reviews. The remaining later steps of `docs/agents/PLAN-RESEARCH.md` go in the order 4, 15, 2, 11, 3, 7, 10, 9, then 8 (rewind) last. Each brief stands alone. Known sandbox baseline failures for Codex, not yours: process tests in `tests/run-lane-stop.test.js`, `tests/run-lane.test.js`, `mr-agent > stops the whole shell tree on the time limit`, the removed-sub test in `tests/orchestrators.test.js`, and `tests/inspector-sandbox.test.jsx > ACP start log line`; do not stop on them.

**P484. Item 4, later step: a repeated failing call is flagged for every harness (Codex, Terra).** Read this brief, item 4 and its paragraph in `Sol's review` only. Leave your changes uncommitted; the runner commits them. Tests that make their own temporary folders or git repositories are allowed. Run every command in the foreground. Do not install or copy `node_modules`. Files: src/briefs/run.js (`summarizeRun` near line 1135, `summaryOf`, `runRecord` near line 1253), scripts/run-lane.mjs (only where the run record is built from the summary), src/briefs/attention.js (`attentionText`), tests/repeated-failure.test.js (new), tests/attention.test.js, docs/agents/CHANGELOG.md, docs/agents/architecture/ROOM.md. You may change any existing test whose expectation this brief changes; name it.

1. From the activities `summarizeRun` already parses (any harness: Claude, Codex, AGY, OpenCode, ACP), find the longest run of consecutive failed tool calls by the same agent with the same tool and the same target or input. When it is 5 or more, the summary carries `repeatedFailure: { tool, count }`, and the run record keeps it. Read-only calls that succeed, a run with no tool calls and failures spread over different calls are not flagged.
2. The runner does not stop the run for this; it only records it. The native harness keeps its own loop stop as today.
3. `attentionItems` shows a newest run with `repeatedFailure` as `LANE repeated one failing TOOL call COUNT times.`, even when the run exited 0, unless a later run of that lane exists. A native loop stop keeps its own line.
4. Tests, each failing before your change: five failed identical Claude calls and five failed identical Codex calls are flagged with tool and count; four are not; five failures across different targets are not; the attention line appears for an exit 0 run with `repeatedFailure`.
5. Run `node node_modules/vitest/vitest.mjs run tests/repeated-failure.test.js tests/attention.test.js tests/run-summary.test.js` (skip a file that does not exist) and report the counts.

**P485. Item 15, later step: Edit from a finished Plan run, with the owner's approval (AGY, Hydrogen).** Read this brief, item 15 and its paragraph in `Sol's review` only. Commit each step as you finish it. Run every command in the foreground. Never use git stash. Do not run the full suite. Files: src/ui/LaneConversation.jsx, src/control/client.js (only if a method is missing), src/control/mock.js (same), tests/plan-handoff.test.jsx (new), docs/agents/CHANGELOG.md, docs/agents/architecture/ROOM.md. No CSS: reuse the classes LaneConversation and the Dispatch confirm cards already use.

1. When the run picked in LaneConversation finished with exit code 0 and its record's `mode` is `plan`, the view shows `Edit from this plan`. Any other run shows nothing new.
2. The button opens a confirm card: an editable text box filled with `Carry out this plan:` and the run's final report text, a mode select with the lane's modes except Plan (from `laneModesFor`, starting at the lane's saved mode or `defaultMode`), `Start` and `Cancel`. Nothing starts until the owner presses Start. Start calls `client.startRun(lane, { tasks: [text], mode })` once and shows the answer line the Dispatch panel shows for a start, or its error.
3. The handoff is manual only: no run starts by itself after a Plan run.
4. Tests, each failing before your change: the button shows only for a finished exit-0 Plan run; the card fills the text and offers no Plan mode; Start sends the edited text and chosen mode once; Cancel sends nothing.
5. Run `node node_modules/vitest/vitest.mjs run tests/plan-handoff.test.jsx tests/lane-send.test.jsx` and `npm run build`, and report the counts.

**P486. Item 2, later step: a review groups files by risk, flags files outside the brief and warns on size (Claude, Sonnet).** Read this brief, item 2 and its paragraph in `Sol's review` only. Commit each step as you finish it. Run every command in the foreground. Never use git stash. Do not run the full suite. Files: server/reviews.js (`laneReview` near line 730, where `parseNumstat` already reads the branch's files near line 738), src/briefs/briefs.js (reuse `parseBriefs` and `briefFileList`; change them only if a bug blocks you), src/ui/panels/reviews.js, src/ui/panels/ReviewsPanel.jsx, tests/reviews-scope.test.js (new), tests/reviews-scope.test.jsx (new), docs/agents/CHANGELOG.md, docs/agents/architecture/LIVE.md, docs/agents/architecture/ROOM.md. No CSS: reuse the classes the review row already uses and its yellow warning class.

1. Each lane review gains `fileGroups`: counts and paths under `server`, `ui` (`src/`), `scripts`, `tests`, `docs` and `other`, from the branch's own numstat. `largeDiff` is true when added plus deleted lines pass 400; the number is a named constant, not a measured user need, and the docs say so.
2. Declared scope: when the newest linked run names brief ids and the project's `docs/agents/TASKS.md` (or the briefs file the runner already reads) holds those briefs, the review lists `outsideBrief`: changed paths that no brief's `Files:` list names. A changelog or architecture doc the brief names counts as named. When no brief or no Files list is found, `outsideBrief` is `null` and the row says `Scope unknown`, never an empty list.
3. ReviewsPanel shows one line per review: the group counts (`server 2, ui 1, tests 3`), `N files outside the brief` with their paths folded, and `Large change: N lines` in the yellow warning class when `largeDiff` holds.
4. Tests, each failing before your change: groups are counted from numstat; a file outside the brief's Files list is reported and one inside is not; a run with no brief gives `null` and the row says `Scope unknown`; a 401-line diff sets `largeDiff` and shows the warning, and 400 does not.
5. Run `node node_modules/vitest/vitest.mjs run tests/reviews-scope.test.js tests/reviews-scope.test.jsx tests/reviews-evidence.test.js tests/reviews-evidence.test.jsx` and `npm run build`, and report the counts. Commit your work when done.

**P487. Item 11, later step: Test connection sends one short prompt through a harness (Claude, Sonnet).** Read this brief, item 11 and its paragraph in `Sol's review` only. Commit each step as you finish it. Run every command in the foreground. Never use git stash. Do not run the full suite. Files: server/agents-config.js (the `/api/harnesses` routes near line 586), server/harness-probe.js (new), src/harnesses/*.js (read their `command` builders; change one only if it cannot run a one-turn prompt), src/control/client.js, src/control/mock.js, src/ui/HarnessesSettings.jsx, tests/harness-probe.test.js (new), tests/harness-probe.test.jsx (new), tests/control-contract.test.js, tests/control-mock.test.js, package.json (add the new server file to `files` if server files are listed there), docs/agents/CHANGELOG.md, docs/agents/architecture/LIVE.md, docs/agents/architecture/ROOM.md. No CSS: reuse the classes HarnessesSettings already uses.

1. `POST /api/harnesses/KEY/probe` with `confirmed: true`, from the owner page only (the same origin and confirm rules as `/api/harnesses/settings`), runs the harness once through its own descriptor `command`, with the prompt `Reply with the word OK and nothing else.`, its saved program and default model, in Plan or its most read-only mode, inside a new empty temporary folder that is removed afterwards, with `windowsHide: true`, and a 60-second limit that kills the process tree (reuse `killTree`).
2. The answer is `{ key, status, line, seconds }`: `reached` when the harness's own reply parser finds a reply containing `OK`, `failed` with the first error line (keys and home paths masked, at most 200 characters) when it exits non-zero or prints a sign-in or quota failure, and `unknown` when it times out or replies something else. A harness that is off, not found, or `machineroom` without a Direct API key answers 409 with the existing plain sentence. One probe per harness at a time: a second request while one runs answers 409 `A connection test is already running.`
3. The client gains `probeHarness(key)`; the mock answers the same shape.
4. HarnessesSettings shows `Test connection` on each ready, enabled harness. It opens a confirm line `This sends one short prompt to KEY, which may use a little quota.` with `Test` and `Cancel`, then shows `Reached in Ns`, `Failed: LINE` or `Unknown: no clear reply in Ns`. Nothing runs on page load.
5. Tests, each failing before your change: a fake harness program that prints a reply gives `reached`; one that exits 1 with a sign-in line gives `failed` with that line masked; one that sleeps past a short test limit gives `unknown` and is killed; a cross-origin or unconfirmed request is refused; a second probe while one runs gets 409; the UI shows the button only for ready harnesses, asks first and shows each result.
6. Run `node node_modules/vitest/vitest.mjs run tests/harness-probe.test.js tests/harness-probe.test.jsx tests/control-contract.test.js tests/control-mock.test.js` and `npm run build`, and report the counts. Commit your work when done.

**P488. Item 3, later step: Dispatch warns about files a running lane is editing now (AGY, Hydrogen).** Read this brief, item 3 and its paragraph in `Sol's review` only. Commit each step as you finish it. Run every command in the foreground. Never use git stash. Do not run the full suite. Files: server/runs.js (the running entries of the `GET /api/control/runs` answer), src/briefs/run.js (reuse `summarizeRun`; do not change it), src/briefs/plan.js (`overlappingLanes` near line 50), src/ui/panels/runs.js (`overlapCardLines` near line 121), src/ui/panels/DispatchPanel.jsx (`runningLaneFiles` near line 1041), tests/live-touch-overlap.test.js (new), tests/dispatch-overlap.test.js, tests/bridge-routes.test.js (only if its exact runs answer changes), docs/agents/CHANGELOG.md, docs/agents/architecture/LIVE.md, docs/agents/architecture/ROOM.md. No CSS.

1. Each running entry in `GET /api/control/runs` gains `touched`: the project-relative paths the run has written so far, from `summarizeRun` on its live log (`written`), at most 50, keys and home paths masked. Reuse one parse per log while its size and modified time are unchanged; a log over 8 MB or unreadable gives `touched: null`, never an empty list that claims nothing was touched.
2. `overlappingLanes` also matches the new task's declared files against each running lane's `touched`, and returns which source matched. `overlapCardLines` shows `Now editing in LANE: FILES` for a touched match, beside the existing `Also declared by LANE: FILES`. A task with no declared files still says `Overlap unknown: this task names no files.`
3. The warning stays advisory: it never blocks a start.
4. Tests, each failing before your change: a running lane whose log wrote `src/a.js` makes a task that declares `src/a.js` show `Now editing in`; a log that only read the file does not; an unreadable log gives `touched: null` and no line; the parse is reused while the log is unchanged.
5. Run `node node_modules/vitest/vitest.mjs run tests/live-touch-overlap.test.js tests/dispatch-overlap.test.js tests/bridge-routes.test.js` and `npm run build`, and report the counts.

**P489. Item 7, later step: the cost board shows cache reads and writes per provider (AGY, Hydrogen).** Read this brief, item 7 and its paragraph in `Sol's review` only. Commit each step as you finish it. Run every command in the foreground. Never use git stash. Do not run the full suite. Files: src/harnesses/claude.js, src/harnesses/codex.js, src/harnesses/opencode.js (their `usage(log)`), src/briefs/run.js (`runRecord`), scripts/run-lane.mjs (only where the record takes usage), server/lane-costs.js (`laneCosts`), src/ui/panels/MetersPanel.jsx, tests/cache-usage.test.js (new), tests/lane-costs-honest.test.js, docs/agents/CHANGELOG.md, docs/agents/architecture/ROOM.md. No CSS.

1. `usage(log)` returns `cacheReadTokens` and `cacheWriteTokens` where the harness reports them: Claude `cache_read_input_tokens` and `cache_creation_input_tokens`; OpenCode `tokens.cache.read` and `tokens.cache.write`; Codex `cached_input_tokens` as reads, with writes unknown. Any harness or field not reported stays `null`, never 0. Keep `inputTokens` as today unless a recorded log in `tests/` shows Codex's `input_tokens` already includes `cached_input_tokens`; if it does, stop counting it twice and say so in the changelog.
2. The run record keeps both fields when they are numbers. `laneCosts` sums them per lane with `cacheKnownRuns`, the number of runs that reported them.
3. Meters shows, per lane with any known cache numbers, `Cache: N% of input read from cache (K of M runs reported)`, where N is cache reads over input tokens of the reporting runs only. A lane with no reporting runs shows nothing new.
4. Tests, each failing before your change: each of the three harnesses reports its fields from a small recorded log line; a missing field is `null`; the sum and share use only reporting runs; Meters shows the line and hides it with no data.
5. Run `node node_modules/vitest/vitest.mjs run tests/cache-usage.test.js tests/lane-costs-honest.test.js` and `npm run build`, and report the counts.

**P490. Item 10, later step: the room's own task state survives a compaction (Claude, Sonnet).** Read this brief, item 10 and its paragraph in `Sol's review` only. Commit each step as you finish it. Run every command in the foreground. Never use git stash. Do not run the full suite. Files: server/orchestrator.js (`createOrchestrator` near line 958, the compaction end near line 2219 where `summary` is set, and where the next session's first prompt uses `summary`), server/orchestrators.js (only to pass a state reader into `createOrchestrator`), server/index.js (only if the wiring lives there), src/briefs/taskState.js (new, pure), tests/task-state.test.js (new), tests/compaction-links.test.js, docs/agents/CHANGELOG.md, docs/agents/architecture/LIMITS.md, docs/agents/architecture/LIVE.md.

1. `taskStateBlock({ running, reviews, scopes })` in `src/briefs/taskState.js` builds a short plain text block from data the room already has, never from the model's summary: `Running lanes:` (lane, brief ids or the first task line, branch), `Waiting for review:` (lane and branch of each unmerged review branch), and `Sub scopes:` (each sub orchestrator's sector folders, if any). Each list holds at most 20 lines, keys and home paths masked; an empty list says `none`, and a source that could not be read says `unknown`, never `none`.
2. `createOrchestrator` takes an optional `readTaskState()` that returns those three inputs. At the end of a successful compaction the block is read fresh and put above the model's summary under `Room state at compaction (from the room, not the model):`. With no reader the summary is as today.
3. When the next session starts from the summary, it gets the block too, read fresh again at that moment under `Room state now:` if it differs from the one at compaction.
4. Tests, each failing before your change: the block lists two running lanes and one review branch and says `none` for scopes; a throwing reader gives `unknown`; a compaction stores the block above the summary; the next session's first prompt carries it; without a reader nothing changes.
5. Run `node node_modules/vitest/vitest.mjs run tests/task-state.test.js tests/compaction-links.test.js tests/orchestrator.test.js` and report the counts. Commit your work when done.

**P491. Item 9, later step: a new lane worktree can get exact file copies and its own port number (Codex, Terra).** Read this brief, item 9 and its paragraph in `Sol's review` only. Leave your changes uncommitted; the runner commits them. Tests that make their own temporary folders or git repositories are allowed. Run every command in the foreground. Do not install or copy `node_modules`. Files: scripts/run-lane.mjs (`prepareWorktree` near line 650 and the lane's spawn environment near line 2157), server/harness-settings.js (`readHarnessSettings`, `worktreeSetupOf` and the settings save), src/ui/HarnessesSettings.jsx (beside the worktree setup field), tests/worktree-copies.test.js (new), tests/worktree-setup.test.js, docs/agents/CHANGELOG.md, docs/agents/architecture/LIVE.md, docs/agents/architecture/ROOM.md. No CSS. You may change any existing test whose expectation this brief changes; name it.

1. Harness settings keep `worktreeCopies`: a list of at most 20 project-relative file paths the owner typed (for example `.env.local`), empty by default. Saving refuses an absolute path, a path with a `..` component, a folder, and anything under `.git`, with one plain sentence each.
2. Only when `prepareWorktree` makes a new worktree, each listed file is copied from the project to the same path in the worktree, after resolving both ends with `realpathSync` and refusing any that resolves outside its root (a link out of the project). A file that is missing in the project is skipped with a `worktree copy: skipped PATH (missing)` line. A file that already exists in the worktree is never overwritten (`skipped PATH (exists)`). A reused worktree copies nothing. Copied files are never committed: add each to the worktree's `info/exclude` the way `excludeWorktrees` already does for `.worktrees`. Nothing is copied that the owner did not list; there is no default list.
3. Each lane run gets `MACHINEROOM_PORT_OFFSET` in its environment: the lane's slot index in the lanes file times 10 (0 for the first lane), so a lane's dev server can add it to its base port. The docs say it does not reserve a port across projects.
4. Settings shows a `Copy into new worktrees` text box, one path a line, saved with the setup command, and the LIVE.md and ROOM.md text says the copies are exact, opt-in and never committed.
5. Tests, each failing before your change: a listed file is copied into a new worktree and excluded; a reused worktree gets nothing; an existing file is not overwritten; a link that resolves outside the project is refused; a missing file is skipped with its line; saving `../x`, `/abs` or `.git/config` is refused; a run's environment carries the offset.
6. Run `node node_modules/vitest/vitest.mjs run tests/worktree-copies.test.js tests/worktree-setup.test.js` and report the counts.

**P492. Item 8, later step: a guarded rewind of a lane's last run, with a recovery ref (Claude, Sonnet).** Read this brief, item 8 and its paragraph in `Sol's review` and `Settled` only. Commit each step as you finish it. Run every command in the foreground. Never use git stash. Do not run the full suite. Files: server/reviews.js (beside `laneReview` and its routes), src/control/client.js, src/control/mock.js, src/ui/panels/reviews.js, src/ui/panels/ReviewsPanel.jsx, tests/reviews-rewind.test.js (new), tests/reviews-rewind.test.jsx (new), tests/control-contract.test.js, tests/control-mock.test.js, docs/agents/CHANGELOG.md, docs/agents/architecture/LIVE.md, docs/agents/architecture/ROOM.md. No CSS: reuse the Reviews confirm card classes. Every git call passes `windowsHide: true` and uses the existing git helpers.

1. `GET /api/control/reviews/LANE/rewind` answers a preview for the lane's newest run record that has a `checkpoint`: `{ checkpointHead, head, commits, files }`, where `commits` is `checkpoint.head..HEAD` and `files` the paths that would change, or `{ allowed: false, reason }`.
2. `POST /api/control/reviews/LANE/rewind` with `confirmed: true` and `expectedHead`, from the owner page only, moves the lane's worktree branch back to `checkpoint.head` only when all of these hold, and otherwise answers 409 with the first failing reason in one plain sentence: the lane has no live run; HEAD equals `expectedHead`; the worktree is clean (no tracked or untracked changes); the branch equals `checkpoint.branch`; `checkpoint.dirty` is false (a run that started on unsaved work cannot be rewound to it); `checkpoint.head` is an ancestor of HEAD; and every commit in `checkpoint.head..HEAD` appears in that run record's `commits` (its lines start with the abbreviated hash), so a commit made by hand or by another run is never dropped.
3. Before moving, it writes `refs/machineroom/recovery/LANE-STARTEDAT` at the current HEAD, never deleted by the room, and moves with `git reset --keep CHECKPOINT`. The answer names the recovery ref and the command to get the work back (`git reset --keep REF` in the worktree).
4. Chat rule: a rewind changes code only. The run's log, its conversation and the orchestrator chat stay as they were. The room adds one room message `LANE was rewound to SHORT; its last run's commits are kept at REF.` so the orchestrator and the owner both see it.
5. Reviews shows `Rewind last run` on a lane whose preview is allowed. It opens a confirm card listing the commits and files to be dropped and the recovery ref to be written, with `Rewind` and `Cancel`; Rewind sends the preview's `head` as `expectedHead`. A refused preview shows its reason and no button.
6. Tests, each failing before your change, in temporary git repositories: a clean run rewinds and the recovery ref holds the old HEAD; a dirty worktree, a hand commit after the run, a moved HEAD (`expectedHead` mismatch), a live run and a dirty checkpoint are each refused with their sentence and move nothing; a cross-origin or unconfirmed request is refused; the room message is added; the UI shows the preview and sends `expectedHead`.
7. Run `node node_modules/vitest/vitest.mjs run tests/reviews-rewind.test.js tests/reviews-rewind.test.jsx tests/control-contract.test.js tests/control-mock.test.js` and `npm run build`, and report the counts. Commit your work when done.

**P493. Review 49: P483 to P492 (Claude, Sonnet, report; Codex hit its usage limit and AGY ran out of credits).** Also review P492 (item 8, the guarded rewind, `server/reviews.js` `rewindState` and `rewindLane`): look first for any path that drops a commit the run did not make, moves a branch without the recovery ref, or runs while a writer is active. Commit the review file when done. Leads from Sol before its limit, to check first: the worktree copies write to the shared exclude file of the main checkout; the probe skips OpenCode's normal Plan configuration; the probe passes an empty model to Direct API. Read this brief only. Change no file except the one you write. Your sandbox keeps git read-only: write the file in your worktree and the runner commits it. Known sandbox baseline failures, not yours: process tests in `tests/run-lane-stop.test.js`, `tests/run-lane.test.js`, `tests/process-tree.test.js`, `mr-agent > stops the whole shell tree on the time limit`, the removed-sub test in `tests/orchestrators.test.js`, `tests/inspector-sandbox.test.jsx > ACP start log line` and the real npm pack test. Do not install or copy `node_modules` into the worktree. Files: docs/agents/AUDIT-2026-11-REVIEW-49.md.

1. Review `git diff 7d9d9ac3..a87833b5`: P483 (checks open no console windows), and the research plan later steps P484 (item 4, repeated failing call), P485 (item 15, Edit from a Plan run), P486 (item 2, review scope and risk), P487 (item 11, Test connection), P488 (item 3, live touched files), P489 (item 7, cache share), P490 (item 10, task state across compaction) and P491 (item 9, worktree copies and port offset). `docs/agents/PLAN-RESEARCH.md` says what each item promised.
2. Look for, first: a child process that can still open a console window, or a `windowsHide` wrapper that changes an argument shape; a probe that runs without the owner's confirm, outside an empty folder, without a time limit, or leaves a process or folder behind; a worktree copy that follows a link out of the project, overwrites work, ignores a file in the main checkout it should not, or copies a credential the owner did not list; a cost or cache share that counts tokens twice (Codex `input_tokens` and `cached_input_tokens`) or shows 0 for unknown; a touched-file or review-scope list that claims `none` when it does not know; a task state block that trusts the model, leaks a key or path, or blocks a compaction; a repeated-failure flag that fires on different calls or exposes full inputs in the record; a Plan handoff that starts a run without the owner; a doc sentence the code contradicts; a test that passes with its change undone.
3. Each finding: `R49-N`, a severity, the file and line, what goes wrong, how to see it, one fix. At most 10. No finding without a file and line you read.
4. End with `Checked and fine`. Under 100 lines. Plain words, no em dashes.

Review 49 fixes, P494 and P495. `docs/agents/AUDIT-2026-11-REVIEW-49.md` (P493, Claude Sonnet): ten findings, read back by the orchestrator. Codex is at its usage limit and AGY is out of credits, so both run on the Claude lane, one after the other. Every brief: read the brief and its findings only; commit each step as you finish it; run every command in the foreground and wait for it to end before you end your turn; never use git stash; do not run the full suite; you may change any existing test whose expectation the brief changes, and name it.

**P494. R49-1, R49-2, R49-9 and R49-10: the rewind holds the lane, says what it can prove and never answers failed after it moved (Claude, Sonnet).** Files: server/reviews.js (`rewindState`, `rewindLane`, `recoveryRefFor`), scripts/run-lane.mjs (the lane run's `commits` near line 2434 and `MACHINEROOM_PORT_OFFSET` near line 2215), scripts/lane-lock.mjs (reuse `takeLaneLock` and its release), src/ui/panels/ReviewsPanel.jsx (the confirm card text only), tests/reviews-rewind.test.js, tests/worktree-copies.test.js, docs/agents/CHANGELOG.md, docs/agents/architecture/LIVE.md.

1. R49-1: the POST takes the lane's run lock (the same lock `run-lane` takes) before its checks and releases it in `finally`; when the lock is held it answers 409 `The lane has a run going, so stop it first.` A test holds the lock and sees the refusal with nothing moved.
2. R49-2: a lane run records `commits` as `checkpoint.head..HEAD` (as project runs already do), not `main..HEAD`, when it has a checkpoint. The rewind's refusal text becomes `The lane has commits from before the last run, so it was not rewound.`, and the confirm card says `Commits on this branch since the run started` above the list, since a hand commit made during the run cannot be told apart. A test shows an earlier run's commit is refused.
3. R49-10: after `reset --keep` succeeds, the answer is 200 even if the room message or the notice throws (each in its own try). `update-ref` passes the zero hash as the old value so an existing ref is never replaced, and `recoveryRefFor` keeps the lane key's characters distinct (encode `/` and `-` differently, or add a short hash of the raw key). Tests: a throwing `deliver` still answers 200; a second rewind of the same run is refused because the ref exists.
4. R49-9: `MACHINEROOM_PORT_OFFSET` comes from a stable slot: a hash of the lane key into 0 to 99, times 10, so adding or removing a lane does not move another lane's offset. A lane missing from the lanes file gets its own hash, never the first lane's 0 by default. Update the docs sentence; a test checks two keys give different, stable offsets.
5. Run `node node_modules/vitest/vitest.mjs run tests/reviews-rewind.test.js tests/reviews-rewind.test.jsx tests/worktree-copies.test.js` and `npm run build`, and report the counts. Commit your work when done.

**P495. R49-3 to R49-8: copies, cache share, probes, touched lists and the brief source say only what is true (Claude, Sonnet).** Files: scripts/run-lane.mjs (`copyWorktreeFiles` near line 650), src/harnesses/codex.js (`codexUsage` near line 85), src/harnesses/opencode.js (only if the probe needs a title), server/harness-probe.js, server/runs.js (the `touched` entry near line 940), src/ui/panels/runs.js (`overlapCardLines`), server/reviews.js (where `briefsText` is read near line 778), src/ui/HarnessesSettings.jsx (the copies help text only), tests/worktree-copies.test.js, tests/cache-usage.test.js, tests/harness-probe.test.js, tests/live-touch-overlap.test.js, tests/reviews-scope-brief.test.js, docs/agents/CHANGELOG.md, docs/agents/architecture/LIVE.md, docs/agents/architecture/ROOM.md.

1. R49-3: write the exclude line only after the copy succeeds, only when the same line is not already there, and skip it when `git check-ignore` in the main checkout already ignores the path. The Settings help text says the ignore line is shared with the main checkout. Tests: two new lanes add the line once; a failed copy adds none.
2. R49-4: Codex `inputTokens` is `input_tokens` alone (it already includes the cached part), and `cacheReadTokens` is `cached_input_tokens`. Fix `tests/cache-usage.test.js` (and any test that pins the old sum, named) so 1500 with 500 cached shows 33 percent. Say in the changelog that Codex input counts were high by the cached amount before.
3. R49-5 and R49-6: the probe takes Direct API's model from the first enabled `machineroom` lane, else the first endpoint model, and answers `unknown` with `Set a Direct API model first.` when there is none. OpenCode gets a title `MachineRoom connection test` and its Plan config the way a Plan lane run gets it, or the docs say plainly that OpenCode is probed in an empty folder without Plan. Tests for both.
4. R49-7: `touched` is `{ paths, partial }`-free: keep `touched` a list, and add `touchedPartial: true` when the log shows shell calls the parser could not place on a file. The overlap card adds `LANE may also be editing by shell.` for such a lane when the task declares files. A test with a shell-only write log shows the line.
5. R49-8: the review scope reads `docs/agents/TASKS.md` from the lanes folder, else from the base ref (`git show BASE:docs/agents/TASKS.md` in the worktree), never the worktree's own copy. A test edits the worktree copy and the scope ignores it.
6. Run `node node_modules/vitest/vitest.mjs run tests/worktree-copies.test.js tests/cache-usage.test.js tests/harness-probe.test.js tests/live-touch-overlap.test.js tests/reviews-scope-brief.test.js tests/lane-costs.test.js tests/codex-harness.test.js` and `npm run build`, and report the counts. Commit your work when done.

**P496. Review 50: P494 and P495, and a last bug hunt over the bridge (Claude, Sonnet, report; Codex is at its usage limit until 2026-11-19 and AGY is out of credits).** Read this brief only. Change no file except the one you write. Your sandbox keeps git read-only: write the file in your worktree and the runner commits it. Known sandbox baseline failures, not yours: process tests in `tests/run-lane-stop.test.js`, `tests/run-lane.test.js`, `tests/process-tree.test.js`, `mr-agent > stops the whole shell tree on the time limit`, the removed-sub test in `tests/orchestrators.test.js`, `tests/inspector-sandbox.test.jsx > ACP start log line` and the real npm pack test. Do not install or copy `node_modules` into the worktree. Do not run the full suite. Files: docs/agents/AUDIT-2026-11-REVIEW-50.md.

1. Review `git diff 643976d8..cd931ceb`: P494 (the rewind takes the lane lock, run commits from the checkpoint, the recovery ref name, the hashed port offset) and P495 (copies write the exclude line once, Codex input tokens, the probe's model and OpenCode config, `touchedPartial`, the review scope's brief source). Each fix answers a finding in `docs/agents/AUDIT-2026-11-REVIEW-49.md`: check that it fixes the finding and adds no new fault.
2. Then read, for real bugs only: `server/reviews.js` (`rewindState`, `rewindLane`), `server/harness-probe.js`, `scripts/run-lane.mjs` (`copyWorktreeFiles`, `prepareWorktree`), `server/runs.js` (the running entry and its `touched` cache), `src/briefs/taskState.js`. Look first for: a lock that is not released on every path, a git call without `windowsHide`, a path that reaches outside the project, a cache that never invalidates or grows without bound, a refusal that leaves something half done, a key or home path in a response, a test that passes with its change undone.
3. Each finding: `R50-N`, a severity, the file and line, what goes wrong, how to see it, one fix. At most 10. No finding without a file and line you read.
4. End with `Checked and fine`. Under 100 lines. Plain words, no em dashes.

**P497. Review 50 fixes, R50-1 to R50-8, and the worktree setup help line (Claude, Sonnet).** Read this brief and `docs/agents/AUDIT-2026-11-REVIEW-50.md` only. Commit each step as you finish it. Run every command in the foreground and wait for it to end before you end your turn. Never use git stash. Do not run the full suite. You may change any existing test whose expectation this brief changes; name it. Every git call passes `windowsHide: true`. Files: scripts/run-lane.mjs (`portOffsetFor` near line 1123, its caller near the lane spawn environment, `copyWorktreeFiles` near line 650), server/reviews.js (`rewindState` near line 1049, `rewindLane` near line 1072), server/runs.js (the `touched` entry near line 949), src/ui/HarnessesSettings.jsx (the worktree fields near line 400 only), tests/worktree-copies.test.js, tests/worktree-setup.test.js, tests/reviews-rewind.test.js, tests/live-touch-overlap.test.js, docs/agents/CHANGELOG.md, docs/agents/architecture/LIVE.md.

1. R50-1: a lane named in the lanes file gets its offset from its place in the sorted list of lane keys (index times 10, as before P494), so no two listed lanes share ports; only a key not in the list falls back to the hash. `hermes` and `native2` collide today. A test over the keys of `docs/agents/lanes.json` asserts every offset is distinct.
2. R50-2 and R50-8: after the copy, run `check-ignore` in the worktree; when it says not ignored, write the exclude line once. If anything after the copy throws, remove the copied file before rethrowing. A test makes the exclude write fail and sees no copied file left behind.
3. R50-3: the refusal says `The lane has commits the last run did not record, so it was not rewound.`; rename the test to match.
4. R50-4: only a lock held by a live run answers 409 `The lane has a run going, so stop it first.`; any other lock error answers 500 with a plain failure line and no path.
5. R50-5: before `update-ref`, check whether the recovery ref exists; when it does, answer 409 `This run was already rewound.` Update `refuses a second rewind of the same run` to expect 409.
6. R50-6: after a 200, a 409 from `rewindState` and a 500, assert the lane lock file is gone.
7. R50-7: `touchedPartial` is also true when the written list was cut at the limit. A test with more writes than the limit shows it.
8. Settings: the line `Runs once in each new lane worktree, for example npm ci.` sits right under the worktree setup command input, above `Copy into new worktrees`, so each help line is under its own field. One Save stays.
9. Run `node node_modules/vitest/vitest.mjs run tests/worktree-copies.test.js tests/worktree-setup.test.js tests/reviews-rewind.test.js tests/reviews-rewind.test.jsx tests/live-touch-overlap.test.js tests/harness-settings.test.js` and `npm run build`, and report the counts. Commit your work when done.

**P498. Every Harnesses confirm card blanks the room in Chrome (Codex, Terra).** Found by eye on 0.1.401: pressing `Test connection` (or any button that opens the Harnesses confirm card) unmounts the whole page. Chrome logs `Failed to execute 'querySelector' on 'Document': '[aria-controls=".hud-settings-section[aria-label="Harnesses"] button"]' is not a valid selector.` `useDialogFocus` in `src/ui/dialogFocus.js` takes `openerSelector` as an `aria-controls` id, but `src/ui/HarnessesSettings.jsx` near line 73 passes a CSS selector. jsdom accepts the bad selector, so `tests/harness-probe.test.jsx` passes. Read this brief only. Leave your changes uncommitted; the runner commits them. Run every command in the foreground. Never use git stash. Do not run the full suite. Files: src/ui/HarnessesSettings.jsx, src/ui/dialogFocus.js, tests/dialog-focus-ui.test.js, docs/agents/CHANGELOG.md.

1. The Harnesses confirm card gets an id (`mr-harness-confirm`), each button that opens it gets `aria-controls="mr-harness-confirm"`, and the hook gets `openerSelector: 'mr-harness-confirm'`.
2. `useDialogFocus` builds the lookup with `CSS.escape` when it exists and wraps the lookup in `try`, so a bad value falls back to the active element and never throws.
3. Tests: a static check that every `openerSelector` passed in `src/` is a plain id (`/^[A-Za-z][\w-]*$/`); a test where `document.querySelector` throws on the lookup and the hook still focuses the card.
4. Run `node node_modules/vitest/vitest.mjs run tests/harness-probe.test.jsx tests/harnesses-settings.test.js tests/dialog-focus-ui.test.js` and `npm run build`, and report the counts. Leave your changes uncommitted.

Owner's visual fixes, 2026-11-17 (P499, P500). The owner sent screenshots: the Control count badge floats over the button's corner, the transport's orchestrator name runs into the lane chips beside it, and the conversation sort row should be one `Sort by` dropdown with pins shown the way AIRP shows bookmarked chats (a pinned group above the rest, a mark on each pinned row, a one-click toggle). Codex, Terra. Every brief: read the brief only; leave your changes uncommitted, the runner commits them; run every command in the foreground; never use git stash; do not run the full suite; you may change any existing test whose expectation the brief changes, and name it. The check by eye at 1280x800 is left to the orchestrator.

**P499. The Control badge and the transport orchestrator name stop overlapping (Codex, Terra).** Files: src/styles.css (`.hud-action-badge` near line 1971 and `.transport-orchestrators > .transport-orchestrator` near line 9203 only), src/ui/Hud.jsx (only where the badge is rendered in the menu row, if the fix needs the markup), tests/hud-badge-layout.test.js (new), docs/agents/CHANGELOG.md, docs/agents/architecture/ROOM.md.

1. Badge: today it is `position: absolute; top: -6px; right: -6px` on `.hud-action-slot`, so at the top of the menu row it sits half outside the button and over its border. Put the count inside the button, after the key hint, as an inline yellow chip with the same size and colours; the button grows to fit and nothing overlaps its border. Keep its accessible name (`Open Reviews, 1 lane branch has commits ahead`).
2. Transport: measured at 1280x800 with seven lanes, the orchestrator button is 51 px wide while its title needs 97 px (`flex: 0 10 auto; min-width: 0` with `overflow: visible`), so `ORCHESTRATOR` is drawn over the first lane chip. The orchestrator title never shrinks (`flex-shrink: 0` on the button, or `min-width: max-content`); when the row is short of room the lane chips shrink and cut their text with an ellipsis instead. No text may draw outside its own button.
3. Test: a CSS check that `.hud-action-badge` is not absolutely placed with a negative offset, and that the orchestrator button cannot shrink below its title.
4. Run `node node_modules/vitest/vitest.mjs run tests/hud-badge-layout.test.js tests/hud-menu.test.js tests/hud-style.test.js` and `npm run build`, and report the counts.

**P500. The conversation list gets a Sort by dropdown and visible pins (Codex, Terra).** Files: src/ui/Sidebar.jsx (the `mr-side-sort` group near line 752 and `renderSessionRows`), src/ui/sidebar.js (`SESSION_SORTS`, the row groups near line 168, `sessionMenuItems`), src/styles.css (the `.mr-side-sort` rules and new `.mr-side-pin` rules only), tests/sidebar.test.js, tests/sidebar-pins.test.jsx (new), docs/agents/CHANGELOG.md, docs/agents/architecture/ROOM.md.

1. Replace the three sort buttons with one labelled `<select>` (`Sort by`, options Newest, Oldest, Name) beside the search box, same saved key and default. Style it with the room's existing select style.
2. Pins already exist (`isPinned`, the `pinned` group, the row menu's `Pin`/`Unpin` through `updateOrchestratorSession({ pinned })`) but nothing shows them. Show a `Pinned` label above the pinned rows and a `Recent` label above the rest, only when both groups have rows. Each row gets a small pin toggle button (aria-label `Pin` or `Unpin` with the title, `aria-pressed`) that calls the same update as the menu; a pinned row shows it lit in yellow, an unpinned row shows it only on hover or focus. The current conversation stays first. Search filters both groups; sort applies inside each group.
3. Tests: the select changes the order and saves the key; pinning a row moves it under `Pinned` and calls the update with `pinned: true`; the labels hide when one group is empty.
4. Run `node node_modules/vitest/vitest.mjs run tests/sidebar.test.js tests/sidebar-pins.test.jsx` and `npm run build`, and report the counts.

**P501. Review 51: P497 to P500 and the badge seam fix (Claude, Sonnet, report).** Read this brief only. Change no file except the one you write. Commit the file on your branch. Known sandbox baseline failures, not yours: process tests in `tests/run-lane-stop.test.js`, `tests/run-lane.test.js`, `tests/process-tree.test.js`, `mr-agent > stops the whole shell tree on the time limit`, the removed-sub test in `tests/orchestrators.test.js`, `tests/inspector-sandbox.test.jsx > ACP start log line`, the real npm pack test, and any test that fails only because the sandbox denies the home folder. Do not run the full suite. Files: docs/agents/AUDIT-2026-11-REVIEW-51.md.

1. Review `git diff 76112d8e..9289153b` plus the P500 merge after it: P497 (review 50 fixes: listed lanes get offsets by sorted index, copy cleanup and the worktree ignore check, rewind refusals, the lock error split, `touchedPartial` on a cut list, the setup help line), P498 (the Harnesses confirm id and the dialog focus lookup), P499 and `9289153b` (the Control count inside its button and on the lens seam, the transport orchestrator width), P500 (the Sort by select, the pin toggle, the Pinned and Recent labels).
2. Look first for: two lanes that can still share ports (a lane not in the file, a lanes file read from the wrong folder, an offset that shifts while a lane runs); a copy left behind or an exclude line written twice; a rewind path that leaves the lock held or answers the wrong status; a focus hook that returns focus to the wrong opener; a badge or pin that a keyboard user cannot reach or that has no accessible name; a select that loses the saved sort; a pin toggle that acts on the wrong row (it uses `items[0]` of the row menu) or on the current conversation when it should not; a doc sentence the code contradicts; a test that passes with its change undone.
3. Each finding: `R51-N`, a severity, the file and line, what goes wrong, how to see it, one fix. At most 10. No finding without a file and line you read.
4. End with `Checked and fine`. Under 100 lines. Plain words, no em dashes.

Audit follow-ups, 2026-11-17 (P502, P503). Codex, Terra. Every brief: read the brief only; leave your changes uncommitted, the runner commits them; run every command in the foreground; never use git stash; do not run the full suite; you may change any existing test whose expectation the brief changes, and name it. Every git call passes `windowsHide: true`.

**P502. The Reviews list answers in under a second when nothing changed (Codex, Terra).** Measured on 0.1.401 with 21 lanes: `GET /api/control/reviews` takes 4.8 to 5.1 seconds on every open, while `GET /api/control/runs` takes 5 ms. Files: server/reviews.js (`laneReview` near line 768 and the list near line 1285), tests/reviews-cache.test.js (new), docs/agents/CHANGELOG.md, docs/agents/architecture/LIMITS.md.

1. First measure: time each git call `laneReview` makes for one lane (a temporary log you remove before you finish) and name the slow ones in your report.
2. Cache each lane's entry keyed on what it is computed from: the lane's `HEAD`, the base ref's hash, the worktree's status signature (`git status --porcelain` output hash, or the index mtime plus `HEAD`), the brief text's hash and the runs record size. A hit skips the slow calls; any change recomputes. Drop the cache on the existing `invalidateGitCache` and after a merge or rewind. Keep the cache bounded by the number of lanes.
3. Tests: a second list call with nothing changed makes no `diff`/`merge-tree`/`log` git calls (count them through the existing git seam); a new commit on the lane, a change to its worktree, or a new run record recomputes that lane only.
4. In `LIMITS.md`, give the before and after times you measured. Run `node node_modules/vitest/vitest.mjs run tests/reviews-cache.test.js tests/bridge-reviews.test.js tests/reviews-scope.test.js tests/reviews-rewind.test.js tests/project-reviews.test.js` and `npm run build`, and report the counts.

**P503. Reviews shows the rewind line only when there is something to rewind (Codex, Terra).** Files: src/ui/panels/ReviewsPanel.jsx (the rewind preview near line 286), src/ui/panels/reviews.js (only if a helper fits there), tests/reviews-rewind.test.jsx, docs/agents/architecture/ROOM.md.

1. Today every lane card prints `Rewind unavailable: REASON`, so an idle fleet shows a column of `No run of this lane recorded a checkpoint.` and `The lane is not on the branch the run started on.` lines. Show nothing when the lane has no commits ahead of main and no run with a checkpoint. Keep the line when the lane has commits ahead (the owner may want to know why it cannot rewind) and keep the button when the rewind is allowed.
2. The Reviews panel opens one rewind request per lane at once (21 requests). Ask for a lane's rewind state only for lanes with commits ahead, and the rest when the owner expands a card, if cards expand; otherwise only the lanes with commits ahead.
3. Tests: a lane with 0 commits ahead shows no rewind line and makes no rewind request; a lane with commits ahead and a refusal shows the line.
4. Run `node node_modules/vitest/vitest.mjs run tests/reviews-rewind.test.jsx tests/reviews-scope.test.jsx tests/reviews-evidence.test.jsx` and `npm run build`, and report the counts.

Review 51 fixes, P504 and P505. `docs/agents/AUDIT-2026-11-REVIEW-51.md` (P501, Codex Sol): three findings, read back by the orchestrator. Codex, Terra. Every brief: read the brief and its findings only; leave your changes uncommitted, the runner commits them; run every command in the foreground; never use git stash; do not run the full suite; you may change any existing test whose expectation the brief changes, and name it. Sandbox baseline failures you may ignore: process tests and any test that fails only because the sandbox denies the home folder.

**P504. R51-1 and R51-2: every lane keeps one saved port offset (Codex, Terra).** Files: scripts/run-lane.mjs (`portOffsetFor` near line 1127 and its caller near the lane spawn environment), tests/worktree-copies.test.js, tests/worktree-setup.test.js, docs/agents/CHANGELOG.md, docs/agents/architecture/LIVE.md.

1. Keep the assignments in `port-offsets.json` in the runs folder (`{ "lane": offset }`, written atomically with the existing `writeAtomic` helper or a temp file and rename). A lane that has an offset keeps it forever, whatever the lanes files say. A lane without one, whether from `lanes.json` or a room-made lane in `agents.json`, gets the lowest multiple of 10 from 0 to 990 that no saved lane holds, and it is saved before the lane's process starts. Take the assignment under the lane lock the run already holds, and re-read the file just before writing so two lanes starting at once cannot take the same offset; if the write races, re-read and pick again.
2. When all 100 offsets are taken, fail the start with `No free port offset is left; remove old lanes from port-offsets.json.` and no process.
3. `LIVE.md` says what is true: offsets are saved per lane in the runs folder, never move, and are given lowest-free first.
4. Tests: `opencode` and `opencode-11` get different offsets; adding a key that sorts first does not move a saved lane; two assignments in one folder never repeat; a full table refuses.
5. Run `node node_modules/vitest/vitest.mjs run tests/worktree-copies.test.js tests/worktree-setup.test.js tests/lane-env.test.js` and `npm run build`, and report the counts.

**P505. R51-3: a test that guards the Control count on the lens seam (Codex, Terra).** Files: tests/stage-seam.test.js, tests/hud-badge-layout.test.js. Change no source file.

1. In `tests/stage-seam.test.js`, build a menu with a `.hud-action-slot` holding a `.hud-action` and a `.hud-action-badge`, run the seam pass with the real `SEAM_TOP` selector from `src/Stage.jsx` (import it, or read it from the source if it is not exported), and assert the badge gets `--seam-y` and `--seam-r`. Assert a badge inside the Orchestrator `.hud-action` button does not get its own pose.
2. In `tests/hud-badge-layout.test.js`, assert `.hud-action-slot > .hud-action-badge` is in the seam transform rule in `src/styles.css`.
3. Show each new assertion fails with its line removed from the source (save a patch and apply it in reverse, then restore; never commit the removal), and say so in the report.
4. Run `node node_modules/vitest/vitest.mjs run tests/stage-seam.test.js tests/hud-badge-layout.test.js` and report the counts.

## Audit sweep, 2026-11-17 evening (P506 to P508)

The owner asked for one more audit sweep of MachineRoom at 0.1.401 (`7e597108`), with Codex lanes and Sol reviews. Three Sol sweeps, one area each, run at once. Every brief: read this brief only, then the code; change no file except the one you write; your sandbox keeps git read-only, so write the file in your worktree and the runner commits it; do not run the full suite; run only the tests you need to prove a finding. Known sandbox baseline failures, not findings: process tests in `tests/run-lane-stop.test.js`, `tests/run-lane.test.js`, `tests/process-tree.test.js`, `mr-agent > stops the whole shell tree on the time limit`, the removed-sub test in `tests/orchestrators.test.js`, `tests/inspector-sandbox.test.jsx > ACP start log line`, the real npm pack test, and any test that fails only because the sandbox denies the home folder. Report real faults only: something that breaks, loses data, leaks a key or path, hangs, or misleads the owner. No style notes. Each finding: `SN-N` (S1, S2 or S3 for the brief), a severity, the file and line, what goes wrong, how to see it (a command, a request or a click), one fix. At most 10, most severe first. No finding without a file and line you read. End with `Checked and fine`. Under 120 lines. Plain words, no em dashes. The last sweep found that every Harnesses confirm card blanked the page in Chrome because a CSS selector was passed where an id was wanted, and jsdom accepted it: look for faults of that kind, which pass in tests and fail in a real browser or on a real machine.

**P506. Sweep S1: the bridge (Codex, Sol, report).** Files: docs/agents/AUDIT-2026-11-SWEEP-S1.md. Read `server/` (start at `server/index.js` and its route table). Look first for: a route that writes without the confirm, origin or host check the others use; a path from a request that can leave the project or the runs folder (`..`, absolute, a link, a Windows drive or UNC path, a mixed-case drive); a response that carries a key, a token or a home path unmasked; a git or process call without `windowsHide` or without a time limit; a cache that never drops an entry or serves stale data after a write; a lock or write guard not released on an error path; a JSON body read without a size limit; a route that answers 500 with an internal message where the owner needs a plain one.

**P507. Sweep S2: the page (Codex, Sol, report).** Files: docs/agents/AUDIT-2026-11-SWEEP-S2.md. Read `src/ui/`, `src/control/client.js`, `src/live/` and the stage component in `src/` that mounts the lens (read only; lanes may not edit it, so a fix there is the orchestrator's). Look first for: anything that throws during render or in an effect and unmounts the whole page (there is no error boundary above the HUD: say so if true, and name what one would cover); a `querySelector` built from text that may hold quotes, brackets or `#`; an interval, listener, observer or EventSource not cleaned up on unmount; a fetch that sets state after unmount or races an older answer over a newer one; the same request fired many times on load (the page asks `/api/orchestrator` six times in a row at startup: find why and whether it matters); a control a keyboard user cannot reach or that has no accessible name; text that overflows its box at 1280x800; a value from `localStorage` used without a try or a check.

**P508. Sweep S3: the lane runner and its commands (Codex, Sol, report).** Files: docs/agents/AUDIT-2026-11-SWEEP-S3.md. Read `scripts/run-lane.mjs`, `scripts/lane-lock.mjs`, `scripts/merge-lane.mjs`, `scripts/review-lane.mjs`, `scripts/acp-run.mjs`, `scripts/worktrees.mjs`, `src/briefs/run.js` and the harness descriptors they call in `src/harnesses/`. Look first for: a git command that can drop or overwrite work (a reset, checkout, clean or branch delete) on a path the owner did not confirm; a lock, temp file or child process left behind after a crash, a time limit or Stop; a child process tree that outlives its run on Windows; a spawn without `windowsHide`; a record line in `runs.jsonl` that can be torn or written twice; a lane started in the wrong worktree or on the wrong branch; a port offset, copy or exclude line that can collide between lanes started at once; a key from a lane's environment written to a log or a record.

Sweep S3 fixes, P509 and P510. `docs/agents/AUDIT-2026-11-SWEEP-S3.md` (P508, Codex Sol): six findings, read back by the orchestrator (S3-1 confirmed at `scripts/run-lane.mjs:1446`). Codex, Terra. Every brief: read the brief and its findings only; leave your changes uncommitted, the runner commits them; run every command in the foreground; never use git stash; do not run the full suite; you may change any existing test whose expectation the brief changes, and name it. Every spawn passes `windowsHide: true`. Tests use invented canary values, never a real key. Sandbox baseline failures you may ignore: process tests and any test that fails only because the sandbox denies the home folder.

**P509. S3-1, S3-2, S3-3, S3-5 and S3-6: the runner masks every key it writes, continues only the run it names, and keeps records and port locks whole (Codex, Terra).** Files: scripts/run-lane.mjs, src/briefs/run.js, tests/lane-env.test.js, tests/worktree-copies.test.js, tests/run-records.test.js (new), tests/continue-from.test.js (new), docs/agents/CHANGELOG.md, docs/agents/architecture/COMMANDS.md.

1. S3-1: `captureToolLines` passes every exported tool line through the same masking the streamed log uses (`maskKeys`, the lane ticket and the exact values below) before it appends them, and the summary uses only the masked lines.
2. S3-2: `createLaneLog` also masks the exact values of every credential the runner hands the child (`MACHINEROOM_API_KEY`, the lane ticket and any other key-named variable `childEnvironment` passes), across chunk boundaries, and masks `MACHINEROOM_API_KEY=` assignments by name.
3. S3-3: before any output file opens or any spawn, `--continue-from` refuses unless the saved run's lane, brief ids and project kind match the request and the lane worktree's current branch is the saved run's branch. Each refusal names what differs and starts nothing.
4. S3-5: `appendRunRecord` takes a short append lock in the records folder (reuse the lane lock helpers), and under it, when the file does not end with a newline, writes a newline first so a torn tail stays one bad line and the new record stays whole.
5. S3-6: the stale port lock takeover renames the stale lock to a unique name (an atomic claim) instead of removing it by path, then checks the renamed file still names the dead holder before deleting it; if the rename fails or the holder changed, it waits and tries again.
6. Tests for each: a Hermes export line with a canary key is masked in the log; a canary `MACHINEROOM_API_KEY` value split across two chunks is masked; a continuation for another lane, brief or branch is refused before spawn; a torn tail does not swallow the next record; two takeovers of one stale lock leave exactly one holder.
7. Run `node node_modules/vitest/vitest.mjs run tests/lane-env.test.js tests/worktree-copies.test.js tests/run-records.test.js tests/continue-from.test.js tests/lane-interrupt.test.js` and `npm run build`, and report the counts.

**P510. S3-4: a check's time limit always ends the check on Windows (Codex, Terra).** Files: scripts/merge-lane.mjs (near line 143), scripts/review-lane.mjs (near line 131), server/processTree.js (near line 174, only if the fix needs it), tests/check-timeout.test.js (new), docs/agents/CHANGELOG.md.

1. When a check's time limit passes, stop the whole process tree, including descendants of a direct child that has already exited (track the tree while the child lives, or stop by the tree you recorded), and settle the check as failed with `The check passed its time limit.` within a bounded wait (5 seconds) even if `close` never comes or cleanup fails.
2. Apply the same bounded wait in both commands; reuse one helper rather than two copies.
3. Test: a fake child that emits `exit` but never `close` settles as failed within the bounded wait after the time limit.
4. Run `node node_modules/vitest/vitest.mjs run tests/check-timeout.test.js tests/merge-lane.test.js tests/review-lane.test.js` and `npm run build`, and report the counts.

Sweep S2 fixes, P511 to P513. `docs/agents/AUDIT-2026-11-SWEEP-S2.md` (P507, Codex Sol): four findings, read back by the orchestrator (S2-1 confirmed at `src/ui/Assistant.jsx:37`; the only error boundary is `src/ui/panels/PanelBoundary.jsx` around Control panels). Codex, Terra. Every brief: read the brief and its findings only; leave your changes uncommitted, the runner commits them; run every command in the foreground; never use git stash; do not run the full suite; you may change any existing test whose expectation the brief changes, and name it. No new CSS colours or fonts. The check by eye is left to the orchestrator.

**P511. S2-1: denied storage no longer blanks the room, and a fault in one part of the HUD stays in that part (Codex, Terra).** Files: src/ui/Assistant.jsx, src/ui/Hud.jsx (wrapping only), src/ui/panels/PanelBoundary.jsx, src/main.jsx, src/ui/RoomBoundary.jsx (new), src/styles.css (one rule for the room fallback, reuse `.panel-boundary-message` where it fits), tests/storage-denied.test.jsx (new), tests/panel-boundary.test.js, docs/agents/CHANGELOG.md, docs/agents/architecture/ROOM.md.

1. Assistant's storage default goes through the existing guarded storage helper, so a throwing `localStorage` getter never throws in render. Grep `src/` for any other bare `window.localStorage` or `localStorage.` read outside a try and route each through the same helper; name them.
2. In `Hud.jsx`, wrap each independent part (the sidebar, the conversation, the inspector, Settings, the Assistant, the Log drawer) in `PanelBoundary` with a part name, so one part's render fault shows `This panel stopped: ...` in that part and the rest of the room keeps working. Give `PanelBoundary` an optional `label` prop for the text; keep its current text when no label is given.
3. `src/main.jsx` wraps `<App />` in a new `RoomBoundary`: on a fault above the HUD it shows one plain line, `The room stopped: MESSAGE.`, and a `Reload` button (`location.reload()`), on the black page in the room's fonts, instead of a blank page. The message is cut to 120 characters and never includes a stack.
4. Tests: rendering the HUD with a `localStorage` getter that throws does not throw; a part that throws in render shows its boundary text while a sibling part still renders; `RoomBoundary` shows the line and the button.
5. Run `node node_modules/vitest/vitest.mjs run tests/storage-denied.test.jsx tests/panel-boundary.test.js tests/hud-menu.test.js tests/hud-style.test.js` and `npm run build`, and report the counts.

**P512. S2-2 and S2-3: an older answer never replaces a newer one in the lane conversation or Reviews (Codex, Terra).** Files: src/ui/LaneConversation.jsx (the read near line 308), src/ui/panels/ReviewsPanel.jsx (`loadReviews` near line 365), tests/lane-conversation-order.test.jsx (new), tests/reviews-order.test.jsx (new), docs/agents/CHANGELOG.md.

1. Each lane conversation read takes a sequence number; only the newest read's answer or error is applied, and the sequence moves on when the client or the selected run changes or the view unmounts.
2. `loadReviews` uses the existing `latestOnly()` from `src/ui/panels/notices.js` so a slow older list never replaces a newer one, invalidated on client change and unmount.
3. Tests: two overlapping reads answered newest first leave the newest result on screen (the final report stays, Stop stays gone; the newer lane list stays).
4. Run `node node_modules/vitest/vitest.mjs run tests/lane-conversation-order.test.jsx tests/reviews-order.test.jsx tests/reviews-rewind.test.jsx tests/reviews-scope.test.jsx` and `npm run build`, and report the counts.

**P513. S2-4: background notices keep the owner's unsaved Harnesses edits (Codex, Terra).** Files: src/ui/HarnessesSettings.jsx (`loadAll` near line 132 and the saves near line 175), tests/harnesses-drafts.test.jsx (new), docs/agents/CHANGELOG.md.

1. Track which fields the owner has edited and not saved (program drafts per harness, the lane warning count, the worktree setup command, the copy list). A background `loadAll` updates every other field but keeps those drafts. A successful save of a field clears its dirty mark and adopts the saved value; saving one field never resets another field's draft.
2. Test: edit the setup command and the copy list, fire a family notice, and both drafts stay; save the setup and the saved value shows while a program draft in another row stays.
3. Run `node node_modules/vitest/vitest.mjs run tests/harnesses-drafts.test.jsx tests/harnesses-settings.test.js tests/harness-probe.test.jsx tests/worktree-copies.test.js` and `npm run build`, and report the counts.

Sweep S1 fixes, P514 to P516. `docs/agents/AUDIT-2026-11-SWEEP-S1.md` (P506, Codex Sol): six findings, read back by the orchestrator (S1-1 confirmed: `server/static.js` checks the spelled path and never the real one). Codex, Terra. Every brief: read the brief and its findings only; leave your changes uncommitted, the runner commits them; run every command in the foreground; never use git stash; do not run the full suite; you may change any existing test whose expectation the brief changes, and name it. Tests use invented canary values, never a real key, and make links only inside their own temporary folders. Sandbox baseline failures you may ignore: process tests and any test that fails only because the sandbox denies the home folder.

**P514. S1-1: static and music files are served only from inside their real roots (Codex, Terra).** Files: server/static.js, server/music.js, tests/static-links.test.js (new), docs/agents/CHANGELOG.md, docs/agents/architecture/LIVE.md.

1. Resolve the root once with `realpath` and each target with `realpath` before `stat`, `readFile` or a stream opens it; answer 404 when the real target is outside the real root (compare with `relative`, refusing `..` and absolute results, case-insensitive on Windows).
2. Music serves only names whose extension is in its audio list, after the same real-path check.
3. Tests: a junction (Windows) or symlink (elsewhere) inside a temporary static root and music root pointing at an outside temporary file answers 404; a normal file still answers 200; a non-audio name under music answers 404.
4. Run `node node_modules/vitest/vitest.mjs run tests/static-links.test.js` plus the existing static and music tests (name them) and `npm run build`, and report the counts.

**P515. S1-3, S1-4 and S1-5: MCP replies, run history and review diffs mask keys and home paths (Codex, Terra).** Files: server/mcp.js (`publicMcpServer` near line 117 and the call reply near line 747), server/runs.js (`maskRecordCommits` near line 1831 and the recent and last lists near line 1995), server/reviews.js (the diff reply near line 828), tests/public-masking.test.js (new), docs/agents/CHANGELOG.md.

1. Reuse `maskKeys` and `maskProfilePaths` (already imported in these files or beside them). MCP: the public server's args and URL, every tool result and every problem text are masked; the saved private settings stay unmasked and an edit of a masked display never replaces a saved value.
2. Runs: the recent, last and attention lists return a masked public copy of each record's free text (note, task, error lines) and profile paths in displayed log paths; the record on disk stays as it is.
3. Reviews: the diff reply masks the patch before it is cut to size; merges keep using git's own bytes.
4. Tests: a canary assignment and a `C:\Users\someone` path in each of the three places come back masked.
5. Run `node node_modules/vitest/vitest.mjs run tests/public-masking.test.js tests/bridge-reviews.test.js tests/mcp-server.test.js tests/mcp-settings.test.js` and `npm run build`, and report the counts.

**P516. S1-2 and S1-6: a late model fetch keeps newer endpoint edits, and a failed temp folder frees the connection test (Codex, Terra).** Files: server/endpoints.js (quick connect near line 551), server/harness-probe.js (near line 80), tests/endpoints-quick-race.test.js (new), tests/harness-probe.test.js, docs/agents/CHANGELOG.md.

1. After the model fetch, quick connect reads the current list again and updates only the same endpoint, and only when its connection settings still match; a deleted or changed entry is left alone, and the answer says so plainly.
2. The probe adds the harness to its running set inside the `try` whose `finally` removes it, and removes the temp folder only if it was made.
3. Tests: a second endpoint saved during the fetch survives; a first probe whose temp folder fails leaves the next probe free to run.
4. Run `node node_modules/vitest/vitest.mjs run tests/endpoints-quick-race.test.js tests/harness-probe.test.js tests/endpoints.test.js` and `npm run build`, and report the counts.

**P517. Review 52: the sweep fixes P509 to P516 (Codex, Sol, report).** Read this brief, the three sweep files (`docs/agents/AUDIT-2026-11-SWEEP-S1.md`, `-S2.md`, `-S3.md`) and the code only. Change no file except the one you write. Your sandbox keeps git read-only: write the file in your worktree and the runner commits it. Do not run the full suite. Known sandbox baseline failures, not findings: process tests, the removed-sub test in `tests/orchestrators.test.js`, `tests/inspector-sandbox.test.jsx > ACP start log line`, the real npm pack test, and any test that fails only because the sandbox denies the home folder. Files: docs/agents/AUDIT-2026-11-REVIEW-52.md.

1. Review `git diff f98cf45b..HEAD` on main for P509 (runner masking, continuation checks, record append lock, port lock takeover), P510 (`runCheck`), P511 (storage and boundaries), P512 (answer ordering), P514 (real-path static and music), P515 (public masking), P516 (quick connect race, probe slot). P513 (Harnesses drafts) is included if it is merged when you start. Check each fix closes its sweep finding and adds no new fault.
2. The orchestrator changed three things at merge; check them first: P509 lets a brief run continue from a run that saved an empty branch only when the worktree is detached, masks only credential values of 8 characters or more, and applies its branch check to brief runs only (project runs keep the queue branch check); P515 keeps `log`, `project`, `worktree`, `folder`, `path` and `cwd` whole in public run records because the conversation reader opens them.
3. Look first for: a mask that hides a value the page needs to act on (a path, a head, a run name); an append or port lock that can be left held forever; a boundary that hides an error the owner needs to see, or that catches nothing because the fault is in an event handler; a real-path check that refuses a normal file on a case-insensitive or junctioned Windows path; `runCheck` stopping an unrelated process by a reused pid; a doc sentence the code contradicts; a test that passes with its change undone.
4. Each finding: `R52-N`, a severity, the file and line, what goes wrong, how to see it, one fix. At most 10. No finding without a file and line you read. End with `Checked and fine`. Under 100 lines. Plain words, no em dashes.

**P518. Review 53 by Sol: the sweep fixes P509 to P516 (Codex, Sol, report).** The room orchestrator gave P517 to a DeepSeek agent, so this is the same review for Sol under its own number. Read this brief, the three sweep files (`docs/agents/AUDIT-2026-11-SWEEP-S1.md`, `-S2.md`, `-S3.md`) and the code only. Change no file except the one you write. Your sandbox keeps git read-only: write the file in your worktree and the runner commits it. Do not run the full suite. Known sandbox baseline failures, not findings: process tests, the removed-sub test in `tests/orchestrators.test.js`, `tests/inspector-sandbox.test.jsx > ACP start log line`, the real npm pack test, and any test that fails only because the sandbox denies the home folder. Files: docs/agents/AUDIT-2026-11-REVIEW-53.md.

1. Review `git diff f98cf45b..HEAD` on main for P509 (runner masking, continuation checks, record append lock, port lock takeover), P510 (`runCheck`), P511 (storage and boundaries), P512 (answer ordering), P514 (real-path static and music), P515 (public masking), P516 (quick connect race, probe slot). P513 (Harnesses drafts) is included if it is merged when you start. Check each fix closes its sweep finding and adds no new fault.
2. The orchestrator changed three things at merge; check them first: P509 lets a brief run continue from a run that saved an empty branch only when the worktree is detached, masks only credential values of 8 characters or more, and applies its branch check to brief runs only (project runs keep the queue branch check); P515 keeps `log`, `project`, `worktree`, `folder`, `path` and `cwd` whole in public run records because the conversation reader opens them.
3. Look first for: a mask that hides a value the page needs to act on (a path, a head, a run name); an append or port lock that can be left held forever; a boundary that hides an error the owner needs to see, or that catches nothing because the fault is in an event handler; a real-path check that refuses a normal file on a case-insensitive or junctioned Windows path; `runCheck` stopping an unrelated process by a reused pid; a doc sentence the code contradicts; a test that passes with its change undone.
4. Each finding: `R53-N`, a severity, the file and line, what goes wrong, how to see it, one fix. At most 10. No finding without a file and line you read. End with `Checked and fine`. Under 100 lines. Plain words, no em dashes.

**P519. Review 52A: the runner, the process tree and the public replies (Codex, report).** This is the first half of P517, split because two runs of P517 ran out of time reading the whole sweep. Read this brief, `docs/agents/AUDIT-2026-11-SWEEP-S1.md` and `docs/agents/AUDIT-2026-11-SWEEP-S3.md`, and the code only. Change no file except the one you write. Your sandbox keeps git read-only: write the file in your worktree and the runner commits it. Do not run the full suite and do not read `src/ui/**` or its tests. Files: docs/agents/AUDIT-2026-11-REVIEW-52A.md.

1. Read only these parts of `git diff f98cf45b..HEAD` on main: `scripts/run-lane.mjs`, `scripts/merge-lane.mjs`, `scripts/review-lane.mjs`, `server/processTree.js`, `server/static.js`, `server/music.js`, `server/mcp.js`, `server/runs.js`, `server/reviews.js`, `server/endpoints.js`, `server/harness-probe.js`, `src/briefs/run.js`, and the tests that cover them (`tests/continue-from.test.js`, `tests/check-timeout.test.js`, `tests/static-links.test.js`, `tests/public-masking.test.js`, `tests/run-records.test.js`, `tests/endpoints-quick-race.test.js`, `tests/harness-probe.test.js`, `tests/lane-env.test.js`, `tests/worktree-copies.test.js`). Check that P509 (runner masking, continuation checks, record append lock, port lock takeover), P510 (`runCheck`), P514 (real-path static and music), P515 (public masking) and P516 (quick connect race, probe slot) each close their sweep finding and add no new fault.
2. The orchestrator changed three things at merge; check them first: P509 lets a brief run continue from a run that saved an empty branch only when the worktree is detached, masks only credential values of 8 characters or more, and applies its branch check to brief runs only (project runs keep the queue branch check); P515 keeps `log`, `project`, `worktree`, `folder`, `path` and `cwd` whole in public run records because the conversation reader opens them.
3. Look first for: a mask that hides a value the page needs to act on (a path, a head, a run name); an append or port lock that can be left held forever; a real-path check that refuses a normal file on a case-insensitive or junctioned Windows path; `runCheck` stopping an unrelated process by a reused pid; a `git diff` without `--no-ext-diff --no-textconv`; a call to another program with no time limit; a doc sentence the code contradicts; a test that passes with its change undone.
4. Each finding: `R52A-N`, a severity, the file and line, what goes wrong, how to see it, one fix. At most 8. No finding without a file and line you read. End with `Checked and fine`. Under 80 lines. Plain words, no em dashes.

**P520. Review 52B: the room side, storage, ordering and drafts (Codex, report).** This is the second half of P517, split because two runs of P517 ran out of time reading the whole sweep. Read this brief, `docs/agents/AUDIT-2026-11-SWEEP-S2.md`, and the code only. Change no file except the one you write. Your sandbox keeps git read-only: write the file in your worktree and the runner commits it. Do not run the full suite and do not read `server/**` or `scripts/**`. Files: docs/agents/AUDIT-2026-11-REVIEW-52B.md.

1. Read only these parts of `git diff f98cf45b..HEAD` on main: `src/main.jsx`, `src/ui/Hud.jsx`, `src/ui/RoomBoundary.jsx`, `src/ui/panels/PanelBoundary.jsx`, `src/ui/Assistant.jsx`, `src/ui/LaneConversation.jsx`, `src/ui/panels/ReviewsPanel.jsx`, `src/ui/HarnessesSettings.jsx`, `src/styles.css`, and the tests that cover them (`tests/storage-denied.test.jsx`, `tests/lane-conversation-order.test.jsx`, `tests/reviews-order.test.jsx`, `tests/harnesses-drafts.test.jsx`). Check that P511 (storage and boundaries), P512 (answer ordering) and P513 (Harnesses drafts) each close their sweep finding and add no new fault.
2. Look first for: a boundary that hides an error the owner needs to see, or that catches nothing because the fault is in an event handler; a render fault that still blanks the whole room; an older answer that can still replace a newer one when the two overlap; a draft that is overwritten by a background notice; a test that passes with its change undone.
3. Each finding: `R52B-N`, a severity, the file and line, what goes wrong, how to see it, one fix. At most 8. No finding without a file and line you read. End with `Checked and fine`. Under 80 lines. Plain words, no em dashes.

**P522. Review 53 fixes: the log scrubber and the port lock test (Codex, Terra).** Fixes R53-1 and R53-5 in `docs/agents/AUDIT-2026-11-REVIEW-53.md`. Read that file first. Known sandbox baseline failures, not yours: process tests, the removed-sub test in `tests/orchestrators.test.js`, `tests/inspector-sandbox.test.jsx > ACP start log line`, the real npm pack test, and any test that fails only because the sandbox denies the home folder. Files: src/briefs/run.js, tests/lane-env.test.js, scripts/run-lane.mjs, tests/worktree-copies.test.js.

1. R53-1: in `createLaneLog` (`src/briefs/run.js`), mask every complete credential occurrence in the buffered text before keeping a held suffix that could start a credential, so a value like `canary-ab-canary` pushed alone and flushed never reaches the writer whole or in pieces. Keep the cross-chunk masking that exists today.
2. Test in `tests/lane-env.test.js`: the repeated-prefix value pushed alone then flushed; the same value split across two chunks; a value whose prefix repeats inside normal text. Build fake keys from pieces so the history audit does not flag them.
3. R53-5: give `portOffsetFor` (`scripts/run-lane.mjs`) a test-only hook option (for example `{ beforeStaleRemove }`) called between the stale-holder check and the removal, with no change to normal behaviour. In `tests/worktree-copies.test.js`, use the hook to place a live replacement lock at that point and require that lock to survive and the second allocator to wait for it or refuse. The test must fail against the code at `f98cf45b` (check by reading that version with `git show`).
4. Run `node node_modules/vitest/vitest.mjs run tests/lane-env.test.js tests/worktree-copies.test.js` and `npm run build`, and report the counts.

**P523. Review 53 fixes: pid reuse in timeout cleanup and the index link test (Codex, Terra).** Fixes R53-2 and R53-6 in `docs/agents/AUDIT-2026-11-REVIEW-53.md`. Read that file first. Same sandbox baseline list as P522. Files: server/processTree.js, tests/check-timeout.test.js, tests/static-links.test.js.

1. R53-2: in `runCheck` (`server/processTree.js`), before `stopRecorded` kills a saved descendant, list processes again and kill a saved pid only when a row with that pid has the same `created` time as the saved row. Skip a pid whose identity is missing, changed or has no creation time. Keep the failed-check settle when cleanup fails.
2. Test in `tests/check-timeout.test.js` with injected list and kill callbacks: a recycled pid (same pid, new `created`) is not killed while another saved worker with matching identity is.
3. R53-6: in `tests/static-links.test.js`, link `index.html` to a readable HTML file outside the root that holds a marker, and require the root and a client route to refuse it (no marker in the body). If a file link cannot be made on this machine, skip that case with a clear reason rather than pass silently. Read `server/static.js` at `f98cf45b` with `git show` and say in your report whether the new test would fail against it.
4. Run `node node_modules/vitest/vitest.mjs run tests/check-timeout.test.js tests/static-links.test.js` and `npm run build`, and report the counts.

**P521. Review 53 fixes: MCP argument restore and the Harnesses toggle draft (Codex, Terra).** Fixes R53-3 and R53-4 in `docs/agents/AUDIT-2026-11-REVIEW-53.md`. Read that file first. Same sandbox baseline list as P522. Files: server/mcp.js, tests/public-masking.test.js, src/ui/HarnessesSettings.jsx, tests/harnesses-drafts.test.jsx.

1. R53-3: in `server/mcp.js`, restore an unchanged masked argument from the saved argument at the same position, not the first saved argument with the same display. When the masked list changes length or an argument whose display matches more than one saved value moves, refuse the save with a plain message instead of guessing.
2. Test in `tests/public-masking.test.js`: two saved arguments under different home folders with the same masked display survive a toggle of `enabled` unchanged.
3. R53-4: in `src/ui/HarnessesSettings.jsx`, clear the program's dirty flag only when the saved payload changed the program. An enabled toggle, Offer in forms or any other setting keeps an unsaved program draft.
4. Test in `tests/harnesses-drafts.test.jsx`: type into the Program field, toggle Offer in forms and the harness switch, and the typed text stays.
5. Run `node node_modules/vitest/vitest.mjs run tests/public-masking.test.js tests/harnesses-drafts.test.jsx tests/mcp*.test.js` and `npm run build`, and report the counts. The Harnesses check by eye is left to the orchestrator.

**P524. A run started outside the room never wakes the room's orchestrator (Codex, Terra).** Found on 2026-11-17: lane runs the Claude orchestrator started from its own session record `startedBy` as an object (`{ harness, session }`). The run-end wake in `server/orchestrator.js` (near line 2885) reads only a string starter, so it treated those runs as the room orchestrator's own, woke it with `kind: 'wake'`, and that orchestrator (in Auto) started its own runs and wrote briefs into the main checkout. Known sandbox baseline failures, not yours: process tests, the removed-sub test in `tests/orchestrators.test.js`, `tests/inspector-sandbox.test.jsx > ACP start log line`, the real npm pack test, and any test that fails only because the sandbox denies the home folder. Files: server/orchestrator.js, tests/orchestrator.test.js, tests/orchestrators.test.js, docs/agents/architecture/LIVE.md.

1. In the run-end handler, a record whose `startedBy` is an object (an outside session) sends no wake to any orchestrator. Any non-empty string starter keeps today's behaviour, including a removed sub. A record with no `startedBy` at all, from a plain terminal run, sends no wake either. A run the room started keeps today's behaviour: its starter is the string `orchestrator` or a sub's key, and only that orchestrator is woken. Keep the removed-sub note for a record that names a sub that no longer exists.
2. Do not change the `room` note that lists a finished run in the chat; only the wake that starts a turn changes. If both come from the same call, split them so the note stays.
3. Tests in `tests/orchestrator.test.js`: a record with `startedBy: { harness: 'claude', session: 'x' }` ends and the orchestrator takes no turn; a record with no `startedBy` ends and it takes no turn; a record with `startedBy: 'orchestrator'` still wakes it; a sub's run still wakes only that sub. Each new test must fail with the handler change undone.
4. Add one sentence to `docs/agents/architecture/LIVE.md` where the run-end wake is described (search for `wake`), saying that only runs the room started wake an orchestrator.
5. Run `node node_modules/vitest/vitest.mjs run tests/orchestrator.test.js tests/orchestrators.test.js tests/orchestrator-e2e.test.js tests/orchestrator-chat.test.js` and `npm run build`, and report the counts.

**P525. A new agent is drawn by the one that made it, line by line (Codex, Terra).** The owner's visual change on 2026-11-17: when an agent spawns another agent, show the parent drawing the new agent's assigned shape, in the manner of the 1982 film Tron, where a bright line travels out and traces the shape. Today a new agent fades and grows in over `PRESENCE_GROW_MS` (`src/engine/agents.js`). Known sandbox baseline failures, not yours: process tests, the removed-sub test in `tests/orchestrators.test.js`, `tests/inspector-sandbox.test.jsx > ACP start log line`, the real npm pack test, and any test that fails only because the sandbox denies the home folder. Files: src/engine/agents.js, tests/agent-spawn-draw.test.js, docs/agents/architecture/ROOM.md.

1. Which agents: only a view added by `syncViews` after the room's first sync (the `added` list near line 1197), never the agents present when the page loads, and never after a replay seek or reset. The parent is the view its line already runs to: `view.parentKey` for a child, else `lineParentKey(view.key, currentLadder)` (the orchestrator or a sub orchestrator). If the parent has no view, use the orchestrator; if there is none, skip the effect.
2. The effect, on wall time like the room's other animations, about 1.6 seconds in all:
   - A pen: one bright line in the parent's colour leaves the parent's place and runs to the new agent's home, like a light cycle trail, over about 0.4 second.
   - The draw: the new agent's own `LineSegments` grows with `geometry.setDrawRange`, segment by segment in the order its edge array already holds, over about 1.2 seconds, in the new agent's colour at full brightness, with a small bright head at the newest segment end (a short line or a point; no new texture).
   - After it, the shape settles to its normal opacity and the pen line fades out over about 0.4 second. Label, rings, chip and callout may appear when the draw ends.
   Use the presence values so the rest of the view code still works; clear the draw range when done so pulses and dances see the full geometry. A new view's geometry must be its own, not shared with another agent; check `shapeGeometry` and clone if it is shared.
3. Reduced motion (the room's existing reduced flag) and a hidden tab: show the agent at once with no pen and no draw. No randomness: the same order of events draws the same frames. Dispose of the pen line's geometry and material when it ends or the view is removed (see `tests/engine-dispose.test.js`).
4. Put the timing in pure exported helpers (for example `spawnDrawState(elapsedMs, segmentCount, reduced)` returning the pen progress, the number of segments to draw and the pen opacity) and test them in the new `tests/agent-spawn-draw.test.js`: start, middle, end, reduced, zero segments. Add one test through `createAgents` (copy the setup in `tests/agent-presence.test.js`) that an agent added after the first sync starts with a draw range below its full count and reaches the full count after the effect, and that an agent present at the first sync has the full count at once.
5. One sentence in `docs/agents/architecture/ROOM.md` where agents appearing is described.
6. Run `node node_modules/vitest/vitest.mjs run tests/agent-spawn-draw.test.js tests/agent-presence.test.js tests/engine-dispose.test.js tests/agent-thinking.test.js` and `npm run build`, and report the counts. The check by eye is left to the orchestrator.

**P526. A session reader never sits on a lane's line of sight (Codex, Terra).** Seen in the bench room on 2026-11-17: with two session readers (`claude-session`, `opencode-session`) and two lanes, a lane created live landed directly behind the Claude Code session's shape from the default camera, so its P525 drawing could not be seen. The cause is in `src/engine/hub.js` and `src/engine/agents.js`: `readerPoint(index, count)` and `laneHome` both take their angle from `slotAngle(index, count)`, and both sit at `HUB_Y + PARK_LIFT`. Reader N and lane N therefore share one ray from the hub centre, the reader at 1.4 times the hub radius and the lane at the hub radius, and one hides the other whenever the counts line up. Known sandbox baseline failures, not yours: process tests, the removed-sub test in `tests/orchestrators.test.js`, `tests/inspector-sandbox.test.jsx > ACP start log line`, the real npm pack test, and any test that fails only because the sandbox denies the home folder. Files: src/engine/hub.js, src/engine/agents.js, tests/reader-angles.test.js, tests/roster-update.test.js, tests/agents-lines.test.js, docs/agents/architecture/ROOM.md.
1. Add a pure function in `src/engine/hub.js`, `readerAngles(laneAngles, readerCount)`, that returns one angle per reader, each in the middle of a gap between lane angles, filling the widest gaps first and splitting a gap evenly when it takes more than one reader. With no lanes, keep today's angles (`slotAngle(index, readerCount)`), so a room with no lanes looks the same. Give the same answer for the same input: no randomness.
2. In `placeViews` in `src/engine/agents.js`, collect the angles the lanes on the main ring actually use (the `slotAngles` map from the ladder, or `slotAngle(index, parkedKeys.length)`), and place each reader at `readerAngles(...)[readerIndex]` on `READER_RADIUS` at the same height as today. Lanes on the sub ring do not count, since that ring is lower and smaller. Use the same reader angle when the orchestrator takes the reader's place (`topView`). Keep `readerPoint` working for its callers, either by giving it an optional angle or by adding a sibling function. Readers must re-place when lanes are added or removed, as lanes already do in `setRoster`, without moving the camera.
3. Tests in `tests/reader-angles.test.js`: for lane counts 0 to 8 and reader counts 1 to 3, every reader angle is at least a quarter of the smallest lane spacing away from every lane angle (compare angles modulo 2 pi). Two readers and two lanes, the case seen in the bench room, gives readers away from both lanes. The same input gives the same output. A test through the room's `setRoster` (extend `tests/roster-update.test.js`, which already imports `readerPoint`) shows that adding a lane moves a reader off that lane's ray. Update the expectations in `tests/agents-lines.test.js` and `tests/roster-update.test.js` that assume `readerPoint(0, 1)` only where the new rule changes them.
4. ROOM.md: say where a session reader parks (in a gap between lane slots, outside the ring) where `readerPoint` is described today.
5. Run `node node_modules/vitest/vitest.mjs run tests/reader-angles.test.js tests/roster-update.test.js tests/agents-lines.test.js tests/agent-spawn-draw.test.js tests/hub.test.js` (drop any file that does not exist) and `npm run build`, and report the counts. The check by eye is left to the orchestrator.

**P527. The chat is clean and talks to any agent (Codex, Terra).** The owner's review of the orchestrator chat on 2026-11-17, with screenshots. The owner wants it clean and simple. Today the chat has three problems. A status row ("Orchestrator is waiting for you") sits above the log. A "Show agent messages" checkbox bar sits under that row. The mode menu shows each mode as a title with a description under it. The To: picker already sends to a sub or a lane (`deliver` in `src/ui/OrchestratorChat.jsx` calls `sendToLane`), but the log always shows the orchestrator, so the owner cannot see the window of the agent they are talking to. Known sandbox baseline failures, not yours: process tests, the removed-sub test in `tests/orchestrators.test.js`, `tests/inspector-sandbox.test.jsx > ACP start log line`, the real npm pack test, and any test that fails only because the sandbox denies the home folder. Files: src/ui/OrchestratorChat.jsx, src/ui/orchestratorChat.js, src/control/modes.js, src/ui/LaneConversation.jsx, src/ui/laneConversation.js, src/ui/Hud.jsx, src/styles.css (chat and mode menu rules only), tests/orchestrator-chat.test.js, tests/modes.test.js, tests/harness-modes.test.js, tests/codex-modes.test.js, docs/agents/architecture/ROOM.md. Do not edit `src/ui/agentStrip.js` or `src/ui/Transport.jsx`; P528 and P529 own them.
1. Remove the status row from above the log. Show the status in one quiet footer line under the composer, where the context size line is today: the state dot, the short state word (`Waiting for you`, `Working`, `Paused`), a middle dot, then the context line from `contextLine`. Keep `role="status"` and `aria-live` on it.
2. Remove the `mr-orch-toggle-bar`. "Show agent messages" becomes a small toggle button in the composer's tool row beside Compact, labelled `Agent messages`, with `aria-pressed` and the same stored preference.
3. Each mode is one line in the menu, label then a short line on the same row, never wrapped at the menu's width: `Plan - Reads and plans. No edits or commands.`, `Ask - Asks before each edit or command.`, `Edits - Edits in the project. No commands.`, `Auto - Edits and runs commands in the project.`, `Bypass - Edits and runs anything, anywhere.` Shorten the harness overrides in `LINES` to the same style (codex edits: `Edits and runs commands in its sandbox.`, acp auto: `Reads and edits in the project. No commands.`). Update the tests that pin the old text.
4. Picking a lane in To: shows that lane's window in place of the orchestrator log. Reuse `LaneConversation` (the per-lane view Hud already swaps in through `laneChat`) on the lane's newest run, with live reads. Give it a message box at the bottom that sends to that lane through the same path as `sendToLane`, with the placeholder `Message NAME`. Show the lane's state and, when its live run reports one, its context size in the same footer line. Picking Orchestrator (or Back) returns to the orchestrator chat. A sub keeps its own tab as today. For a lane with no runs, read what `sendLaneMessage` does today with such a lane and say exactly that under the empty log.
5. ROOM.md: describe the new status line, the toggle, the one-line modes and the recipient view.
6. Run `node node_modules/vitest/vitest.mjs run tests/orchestrator-chat.test.js tests/modes.test.js tests/harness-modes.test.js tests/codex-modes.test.js` plus any test file that names `LaneConversation`, and `npm run build`, and report the counts. The check by eye is left to the orchestrator.

**P528. The context window is read, never assumed (Codex, Terra).** The owner's review on 2026-11-17: the chat reads `Context size 116.8k / 200.0k (assumed)` for `OpenRouter/deepseek/deepseek-v4.1-flash-1017`. The owner wants no assumed or hard-coded window. Today `resolveContextWindow` in `server/model-list.js` falls back to `DEFAULT_CONTEXT_WINDOW` (200000), and `MODELS` hard-codes `contextWindow` for the Claude models. The endpoint path exists (`detailContextLength`, O15, c69936d9, 92d4c055), but the bench's OpenRouter endpoint holds 248 model ids and no `modelDetails`. That list was saved without details, and only a model fetch (`fetchEndpointModelList`, `server/endpoints.js` near line 551) writes them. OpenRouter's model list gives `context_length` for every model. Known sandbox baseline failures, not yours: process tests, the removed-sub test in `tests/orchestrators.test.js`, `tests/inspector-sandbox.test.jsx > ACP start log line`, the real npm pack test, and any test that fails only because the sandbox denies the home folder. Files: server/model-list.js, server/models.js, server/endpoints.js, server/orchestrator.js, server/orchestrators.js, src/harnesses/claude.js, src/harnesses/codex.js, src/ui/agentStrip.js, src/ui/autocompact.js, src/ui/AutocompactInput.jsx, src/ui/contextRing.js, scripts/run-lane.mjs and src/briefs/run.js (where lane runs start and read Codex rollout files), tests for each, docs/agents/architecture/LIVE.md, and any other file under `server/`, `scripts/`, `src/` or `tests/` the change needs (for example `src/ui/agentContext.js`, `src/ui/Inspector.jsx`, `server/runs.js`, `server/index.js`); do not stop to ask about scope, and list each file in your report. The only files you must not edit are `src/ui/OrchestratorChat.jsx`, `src/ui/Hud.jsx`, `src/ui/LaneConversation.jsx`, `src/ui/Transport.jsx`, `src/ui/transportLanes.js` or `src/styles.css`; keep `contextLine` and the `contextWindow` fields in the shapes they have, so P527 and P529 need no change.
1. The window comes from what reports it, in this order: a `contextWindow` the owner typed for that lane or orchestrator, then the harness's own report from its latest turn (Claude Code's `result` line has `modelUsage[model].contextWindow`; Codex's `token_count` event has `model_context_window`; read the real field names in a saved log before you rely on them), then the endpoint's model details, then nothing. Remove `DEFAULT_CONTEXT_WINDOW` and the hard-coded `contextWindow` numbers in `MODELS`.
2. When an orchestrator or lane runs a model on an endpoint whose saved details have no entry for that model, fetch the endpoint's model list once in the background with the stored key (the existing fetch, its timeout and its 409 guard), save the details, and send the notice that makes the page re-read. Never print or log the key. After a failed fetch, wait 10 minutes before fetching that endpoint again.
3. With no known window, `contextLine` reads `Context size 116.8k` with no window and no `(assumed)`. Remove the `assumed` path. The context ring shows tokens only, with no share. An autocompact rule in percent waits until a window is known, and the Autocompact input says `Waits for the model's context window`; a rule in tokens works as today.
4. Tests: the DeepSeek case (details missing, then fetched with `context_length` 163840 from a faked fetch) ends at `116.8k / 163.8k`; a Claude result line with `modelUsage` gives its `contextWindow`; nothing known gives the bare line; no test imports `DEFAULT_CONTEXT_WINDOW`.
5. LIVE.md: say where the window comes from.
6. Run the related tests (`npx vitest related --run` on your changed source files, or list them) and `npm run build`, and report the counts.

**P529. The footer is clean and readable (Codex, Terra).** The owner's review of the live footer (`src/ui/Transport.jsx`) on 2026-11-17, with a marked screenshot: the sub chips and lane pills in a row become tiny truncated boxes (`CO_ P_ 266M`) that cannot be read, and the owner struck out the `Live // connected` badge and the `Orchestrator waiting for you` text. Known sandbox baseline failures, not yours: process tests, the removed-sub test in `tests/orchestrators.test.js`, `tests/inspector-sandbox.test.jsx > ACP start log line`, the real npm pack test, and any test that fails only because the sandbox denies the home folder. Files: src/ui/Transport.jsx, src/ui/transportOrchestrators.js, src/ui/transportLanes.js, src/styles.css (transport rules only), tests/transport-lanes.test.js, tests/transport-orchestrators.test.js, tests/transport-spend.test.js, tests/layout-css.test.js, any other test that pins the removed footer markup, docs/agents/architecture/ROOM.md. Do not edit `src/ui/OrchestratorChat.jsx` or `src/ui/agentStrip.js`.
1. Remove the `Live // connected` badge. While the bridge is connected the footer shows nothing for it. When it is not, show one red word in its place, the same text the badge shows today for that state, so a lost connection is still seen.
2. Remove the orchestrator title and state button from the footer; the chat shows the state (P527). The context ring stays and still opens the chat. A waiting approval still shows, in yellow, on the summary below.
3. Replace the sub chips and lane pills with one button in the middle of the footer, where the chips start today: `N agents`, with `· M working` when any work and `· K waiting` in yellow when any wait for the owner. Clicking it opens a list above the footer, one readable row per sub and lane: full name, state word, task id, minutes running (write `12 min`, not `12M`, which reads as megabytes). A row does what its chip or pill did (open that sub's chat, inspect that lane). Escape and a click outside close it. Nothing in the footer is cut to a few letters.
4. Keep Center on the left, and the spend, ring and clock on the right.
5. ROOM.md: describe the new footer.
6. Run `node node_modules/vitest/vitest.mjs run tests/transport-lanes.test.js tests/transport-orchestrators.test.js tests/transport-spend.test.js tests/transport-scrubber.test.js` and `npm run build`, and report the counts. The check by eye is left to the orchestrator.

**P530. The lane view shows every lane's runs, and the agents list fits (Codex, Terra).** Found by eye on 2026-11-17 after P527 and P529. First, picking Coder (`machineroom-1`) in the chat's To: shows `Nothing has been said yet.` and `The lane machineroom-1 has no run that can read a message now.`, though Coder has five recorded runs (P517 to P520). `GET /api/control/runs` answers `running`, the 20 newest runs in `recent` and the newest run of each lane in `last`. `runOptions` in `src/ui/laneConversation.js` reads only `running` and `recent`, so a lane whose runs are older than the fleet's 20 newest has none. Second, that note contradicts the placeholder `Start Coder with a message` and names the key, not the label. Third, with 17 agents the footer's agents list (P529) runs up past the top of the window and covers the menu row. Known sandbox baseline failures, not yours: process tests, the removed-sub test in `tests/orchestrators.test.js`, `tests/inspector-sandbox.test.jsx > ACP start log line`, the real npm pack test, and any test that fails only because the sandbox denies the home folder. Files: src/ui/laneConversation.js, src/ui/LaneConversation.jsx, src/ui/Transport.jsx, src/control/client.js, server/runs.js, src/styles.css (the lane view and `.transport-agents-list` rules only), tests/lane-conversation.test.js, tests/transport-orchestrators.test.js, tests/layout-css.test.js, any other test that pins the markup you change, docs/agents/architecture/ROOM.md. Do not stop to ask about scope: decide, and list every decision and file in your report.
1. `runOptions` also reads `last`, so a lane's newest run always shows. When the view needs a lane's older runs (the run picker), ask the bridge for that lane's runs. If `GET /api/control/runs` has no lane filter, add `?lane=KEY` that answers that lane's runs, newest first, at most 20, through the same masking as today.
2. Remove the `has no run that can read a message now` note. Under an empty log, say one thing that matches the box: `No runs yet.` when the lane has none, and nothing more. Use the lane's label, never its key, in any text the owner reads.
3. The agents list above the footer never reaches past the lens top: cap its height to the space between the footer and the menu row, minus 16 pixels, and scroll inside it. Rows keep one line each, with the name, state, task and minutes in aligned columns.
4. ROOM.md: say the lane view lists the lane's own runs, and the list's height cap.
5. Run `node node_modules/vitest/vitest.mjs run tests/lane-conversation.test.js tests/transport-orchestrators.test.js tests/layout-css.test.js` plus any test of `server/runs.js` you touch, and `npm run build`, and report the counts. The check by eye is left to the orchestrator.

**P531. The model details are fetched when the orchestrator loads, not only on a turn (Codex, Terra).** Seen in the bench room after P528 on 2026-11-18: the OpenRouter endpoint still has no `modelDetails`, so the orchestrator shows no context window until it next starts a turn. In `server/orchestrator.js`, `refreshModelDetails` runs only in `startTurnNow`. Known sandbox baseline failures, not yours: process tests, the removed-sub test in `tests/orchestrators.test.js`, `tests/inspector-sandbox.test.jsx > ACP start log line`, the real npm pack test, and any test that fails only because the sandbox denies the home folder. Files: server/orchestrator.js, server/orchestrators.js, tests/orchestrator.test.js, tests/orchestrators.test.js, any other test that pins this behaviour, docs/agents/architecture/LIVE.md. Do not stop to ask about scope: decide, and list every decision and file in your report.
1. Call the same refresh, with the same update of `contextWindow` and `notify()`, once when an orchestrator or sub is created and again after each model or harness change (`setModel`, `setHarness`), as well as at the start of a turn as today. Its own guards (one fetch at a time per endpoint, 10 minutes after a failure, nothing when details exist) stay as they are.
2. A test: an orchestrator created on an endpoint model with no saved details calls the refresh once at creation, and its `contextWindow` changes from null to the fetched value with a notice, with no turn started. Another: `setModel` to a second endpoint model calls it again.
3. LIVE.md: say when the details are fetched.
4. Run `node node_modules/vitest/vitest.mjs run tests/orchestrator.test.js tests/orchestrators.test.js tests/model-context-window.test.js` and `npm run build`, and report the counts.

**P532. A run's conversation opens even when its record lost the log path (Codex, Terra).** Seen in the bench room on 2026-11-18 after P530: Coder (`machineroom-1`) lists its five runs, but each one answers `The run's log is missing.` from `GET /api/control/runs/conversation`. Their records in `runs.jsonl` have `log: null`, though the logs exist in the runs folder, for example `machineroom-1-P520-20261117-184650.log` for the run started at `2026-11-17T10:46:50.116Z` (the name uses the lane, the brief ids and the machine's local start time). The bridge writes such a record itself in `server/runs.js` (near line 1182, `...(item.logPath ? { log: item.logPath } : {})`) when the runner refused, failed or was stopped, and `item.logPath` is often unset there. Known sandbox baseline failures, not yours: process tests, the removed-sub test in `tests/orchestrators.test.js`, `tests/inspector-sandbox.test.jsx > ACP start log line`, the real npm pack test, and any test that fails only because the sandbox denies the home folder. Files: server/runs.js, src/briefs/run.js, scripts/run-lane.mjs, tests/lane-conversation.test.js, tests/public-masking.test.js, any other test of these files, docs/agents/architecture/LIVE.md. Do not stop to ask about scope: decide, and list every decision and file in your report.
1. When the bridge writes a run record, it fills `log` from the run's lane lock (`laneLockLog`) or from the log the runner created, whenever that file exists. Never leave `log` empty for a run whose log exists.
2. When a record has no `log`, the conversation route looks for the log the runner would have named for that run (lane, brief ids joined as the runner joins them, local start stamp), only inside the runs folder, with the same path checks and masking as today. Allow a few seconds of difference between the record's `startedAt` and the stamp in the name, and pick the closest match for that lane. If none is found, answer as today.
3. Tests: a record with `log: null` and a log named for its lane, briefs and start time opens its conversation; a log for another lane or outside the runs folder is never used; a bridge-written record for a refused run carries the log path when the file exists.
4. LIVE.md: say how the route finds a run's log.
5. Run the tests you changed plus `tests/lane-conversation.test.js tests/public-masking.test.js`, and `npm run build`, and report the counts.

**P533. A run's log inside a redirected app folder is still inside the runs folder (Codex, Terra).** Seen in the bench room on 2026-11-18: when the room or its lanes run inside a packaged Windows app (the Claude desktop app), Windows redirects new files under `%LOCALAPPDATA%` to the app's own copy (`%LOCALAPPDATA%\Packages\<app>\LocalCache\Local\...`). `realPath` of the runs folder gives the real folder, but `realPath` of a log written there gives the redirected copy, so `pathInside` fails. Every lane conversation then answers `The run's log is outside the runs folder.` (400) from `GET /api/control/runs/conversation`, and the P532 lookup in `findRunLog` (`server/runs.js`) finds nothing. A room started from a normal terminal is not redirected and works. Known sandbox baseline failures, not yours: process tests, the removed-sub test in `tests/orchestrators.test.js`, `tests/inspector-sandbox.test.jsx > ACP start log line`, the real npm pack test, and any test that fails only because the sandbox denies the home folder. Files: server/runs.js, src/briefs/run.js, tests/bridge-routes.test.js, any other test of these files, docs/agents/architecture/LIVE.md. Do not stop to ask about scope: decide, and list every decision and file in your report.
1. Write one helper the conversation route, `findRunLog`, the refusal record and the other run-log reads in `server/runs.js` share: a log is inside the runs folder when its real path is inside the folder's real path (today's rule), or when its plain resolved path is inside the folder's plain resolved path and no part of the path below the folder is a symbolic link or junction (check each part with `lstatSync`). Refuse everything else as today.
2. Use it wherever `server/runs.js` checks a run log against the runs folder today, without loosening any other check.
3. Tests: a log reached through a junction or symbolic link to a folder outside the runs folder is still refused; a log whose real path differs from its plain path only because the whole folder is reached differently (simulate it with an injected `realPath`) is accepted; P532's lookup finds a log in that case.
4. LIVE.md: one sentence on the rule.
5. Run `node node_modules/vitest/vitest.mjs run tests/bridge-routes.test.js tests/lane-conversation.test.js tests/public-masking.test.js tests/static-links.test.js` and `npm run build`, and report the counts.

**P534. A MachineRoom lane's conversation reads like a Claude lane's (Codex, Terra).** Seen in the bench room on 2026-11-18: Coder (`machineroom-1`, harness `machineroom`) opens its run conversation, but after the prompt every entry is a raw JSON line such as `{"type":"assistant","message":...}`. The `machineroom` harness writes Claude stream-json (`src/harnesses/machineroom.js` uses `createClaudeParser`), but `conversationFromLog` in `src/model/conversation.js` only reads `claude`, `opencode`, `codex` and `agy` and shows every other harness as raw lines. Known sandbox baseline failures, not yours: process tests, the removed-sub test in `tests/orchestrators.test.js`, `tests/inspector-sandbox.test.jsx > ACP start log line`, the real npm pack test, and any test that fails only because the sandbox denies the home folder. Files: src/model/conversation.js, tests/conversation.test.js, any other test of this file, docs/agents/architecture/LIVE.md. Do not stop to ask about scope: decide, and list every decision and file in your report.
1. `conversationFromLog` reads a `machineroom` log with the Claude reader: prompt, text, tool calls, results and the end line, the same entries a `claude` log of the same lines gives. Keep the raw-line fallback for every harness with no reader.
2. Tests: a `machineroom` log of Claude stream-json lines gives the same entries as the same lines read as `claude`, and no entry is a raw JSON line; an unknown harness still shows raw lines.
3. LIVE.md: one sentence naming the harnesses whose logs read as a conversation.
4. Run `node node_modules/vitest/vitest.mjs run tests/conversation.test.js tests/lane-conversation.test.js` and `npm run build`, and report the counts.

**P535. The grid spans from the top of the internet to the bottom of the git tree, one block smaller (Codex, Terra).** The owner's design note of 2026-11-18: the lattice of the void (`src/engine/void.js`, `latticeLines`, `latticeTicks`, `createVoid`) reaches far above the internet globe and far below the git tree. Its floor and ceiling layers sit at `-LATTICE_LAYER * LATTICE_STEP` and `+LATTICE_LAYER * LATTICE_STEP`, and it spans `LATTICE_CELLS` (5) blocks each way. Known sandbox baseline failures, not yours: process tests, the removed-sub test in `tests/orchestrators.test.js`, `tests/inspector-sandbox.test.jsx > ACP start log line`, the real npm pack test, and any test that fails only because the sandbox denies the home folder. Files: src/engine/void.js, src/engine/room.js, src/engine/gitTree.js, src/engine/internet.js, tests/void.test.js, any other test of these files, docs/agents/architecture/ROOM.md. Do not stop to ask about scope: decide, and list every decision and file in your report.
1. The ceiling layer of the lattice sits at the top of the internet globe (`INTERNET_HOME.y + INTERNET_RADIUS`), and the floor layer at the bottom of the git tree (the lowest commit point or label the tree draws). The vertical lines run from floor to ceiling. Before the tree has drawn, the floor sits where the git tree's top will start, so the room never shows a grid with no floor.
2. The tree grows and shrinks with history, so the floor follows it: `createVoid` returns a way to set the floor and ceiling, `room.js` passes the git tree's bottom when it changes, and the lattice rebuilds only when the floor moves by more than a small step, never every frame. Write one pure helper for the levels so it is tested without three.js.
3. The lattice spans one block less each way (`LATTICE_CELLS` 4, not 5).
4. Tests: the ceiling equals the globe top, the floor equals a given tree bottom, the lattice has 4 blocks each way, a small floor move does not rebuild and a larger one does. Update the tests that pin the old levels.
5. ROOM.md: say where the grid starts and ends.
6. Run `node node_modules/vitest/vitest.mjs run tests/void.test.js` plus any other test you changed, and `npm run build`, and report the counts.

**P536. The height rail sits beside the zoom rail, and both read like rulers (Codex, Terra).** The owner's design note of 2026-11-18: remove the lens Height rail from the left edge and keep it close to the Zoom rail on the right, and give the rails ruler marks. `src/ui/LensRail.jsx` draws one rail per `side`; `.lens-rail.is-left` in `src/styles.css` is hidden and then shown again at 900 pixels and wider. The page passes `side="left"` for Height today; after your change the orchestrator will pass `side="right" inner` for Height by hand, so you do not edit the page. Known sandbox baseline failures, not yours: process tests, the removed-sub test in `tests/orchestrators.test.js`, `tests/inspector-sandbox.test.jsx > ACP start log line`, the real npm pack test, and any test that fails only because the sandbox denies the home folder. Files: src/ui/LensRail.jsx, src/ui/lensResize.js, src/styles.css, tests/lens-rail.test.js, tests/lens-resize.test.js, any other test of these files, docs/agents/architecture/ROOM.md, docs/agents/architecture/CODE.md. Do not stop to ask about scope: decide, and list every decision and file in your report.
1. `LensRail` takes an `inner` prop. An inner right rail sits just left of the outer right rail, close beside it with a small gap, and shows when the pointer is near the right edge, the same as the zoom rail. Its label and value never overlap the zoom rail's.
2. Each rail's track carries ruler marks: a long mark every quarter, a short mark every twentieth, in white at low opacity, drawn in CSS or SVG with no canvas. The marks never take pointer events away from the track.
3. Remove the left-edge rule that shows `.lens-rail.is-left` at 900 pixels and wider. Keep `side="left"` working for any other caller.
4. Tests: an inner rail gets its class and position, the near check for an inner rail answers true near the right edge, and the track renders the quarter and twentieth marks.
5. ROOM.md: say where the two rails sit and what the marks are. CODE.md if a file's line changes.
6. Run `node node_modules/vitest/vitest.mjs run tests/lens-rail.test.js tests/lens-resize.test.js` and `npm run build`, and report the counts.

**P537. Review 54 by Sol: the chat, footer, context window and lane conversation work P526 to P534 (Codex, Sol, report).** Read this brief and the code only. Change no file except the one you write. Your sandbox keeps git read-only: write the file in your worktree and the runner commits it. Do not run the full suite. Known sandbox baseline failures, not findings: process tests, the removed-sub test in `tests/orchestrators.test.js`, `tests/inspector-sandbox.test.jsx > ACP start log line`, the real npm pack test, and any test that fails only because the sandbox denies the home folder. Files: docs/agents/AUDIT-2026-11-REVIEW-54.md.
1. Review `git diff 2cff726b..17f7b318` on main: P526 (reader slots in the widest hub gaps), P527 (one-line modes, the status line under the composer, the Agent messages toggle, To: a lane opens that lane's conversation), P528 and P531 (the context window from the owner's setting, the harness report or the endpoint's model details, never assumed; background model detail fetch), P529 and P530 (the footer's one agents button and list, the lane filter on the runs list, an idle lane started from its conversation), P532 and P533 (finding a run's log when the record lost it, and inside a redirected app folder), P534 (MachineRoom logs read with the Claude reader).
2. The orchestrator changed these at merge; check them first: the background model fetch keeps the saved models list; context counts use `formatCount`; `heartbeat.run.context` frames send only the live runs notice and never enter history; `agentTasks` keeps its lookup order; the orchestrator's fixed `contextWindow` was removed from both lanes files.
3. Look first for: a context window or percent still assumed anywhere (a constant, a default, a model name table); a fetch that runs on every turn or never stops retrying; a lane message sent to the wrong run or to a lane that is not running; a log lookup that can open a file outside the runs folder or another lane's log; a footer list that overflows the window or hides a working agent; a button with no accessible name; a doc sentence the code contradicts; a test that passes with its change undone.
4. Each finding: `R54-N`, a severity, the file and line, what goes wrong, how to see it, one fix. At most 10. No finding without a file and line you read. End with `Checked and fine`. Under 100 lines. Plain words, no em dashes.

**P538. Token counts past a million read in millions (Codex, Terra).** Seen in the bench room on 2026-11-18 at 1280x800: the Costs panel reads `30206.3k in / 284.4k out` and the chat's status line `Context size 116.8k / 1048.6k`. Four copies of the same formatter only know thousands: `formatCount` in `src/ui/agentStrip.js`, `formatTokens` in `src/ui/agentContext.js`, `src/ui/panels/MetersPanel.jsx` and `src/engine/board.js`. Known sandbox baseline failures, not yours: process tests, the removed-sub test in `tests/orchestrators.test.js`, `tests/inspector-sandbox.test.jsx > ACP start log line`, the real npm pack test, and any test that fails only because the sandbox denies the home folder. Files: src/ui/agentStrip.js, src/ui/agentContext.js, src/ui/panels/MetersPanel.jsx, src/engine/board.js, src/ui/contextRing.js, any test that pins a count these print, docs/agents/architecture/ROOM.md. Do not stop to ask about scope: decide, and list every decision and file in your report.
1. Keep one formatter (`formatCount` in `src/ui/agentStrip.js`) and use it in the other three places; `board.js` may import it since it is pure. Under 1,000 it prints the whole number, under a million `N.Nk`, and from a million `N.NM`, dropping a trailing `.0` in both (`1M`, `30.2M`, `12k`). A value that rounds up to 1000.0k prints `1M`. Unknown stays `?`.
2. Tests: 999, 1000, 1500, 999950, 1000000, 1048576, 30206300 and an unknown value; each panel or line that used its own copy prints the shared form. Update every test that pins the old text.
3. ROOM.md: one sentence on how counts read, where the doc names a count.
4. Run the tests you changed and `npm run build`, and report the counts.

**P539. A run's end reads as one line in the chat, with its details folded (Codex, Terra).** The owner asked for a clean, simple chat. Each lane run's end shows in the orchestrator chat as a `room` line of two dense sentences, for example `Run codex2-P536-20261118-012152 on lane codex2 ended: succeeded.` then `lane codex2 | briefs P536 | exit 0 | branch feat/... | commits a2d359be 0.1.402: ... | cost not reported`. The bridge writes that text (`server/orchestrator.js` near line 2918) and the orchestrator model reads it, so keep the text it sends exactly as it is; change only how the chat shows it (`src/ui/OrchestratorChat.jsx`, near the `mr-orch-line` render). Known sandbox baseline failures, not yours: process tests, the removed-sub test in `tests/orchestrators.test.js`, `tests/inspector-sandbox.test.jsx > ACP start log line`, the real npm pack test, and any test that fails only because the sandbox denies the home folder. Files: src/ui/OrchestratorChat.jsx, src/ui/roomNotice.js (new, pure), tests/room-notice.test.js (new), any other test of the chat that pins a room line, src/styles.css, docs/agents/architecture/ROOM.md. Do not stop to ask about scope: decide, and list every decision and file in your report.
1. A pure `roomNoticeSummary(text)` reads a run-end room line and answers `{ lane, briefs, status, subject }` (subject is the first commit's sentence without its hash and version, or null) or null for any other text.
2. The chat shows such a line as one row: the lane name in its colour, the briefs, the status word (green for succeeded, red for failed or stopped, yellow otherwise) and the subject cut to one line. A Details button with `aria-expanded` shows the full text as today. Every other room line renders as today.
3. Tests: the summary of a succeeded line with a commit, a failed line with no commits, a stopped line, and plain text; the row renders the short form and the toggle shows the full text.
4. ROOM.md: one sentence.
5. Run the tests you changed and `npm run build`, and report the counts.

**P540. Review 54 fixes: a lane conversation sends only to its own live run, and keeps live context (Codex, Terra).** Fixes R54-1 and R54-3 in `docs/agents/AUDIT-2026-11-REVIEW-54.md`. Read that file first. Known sandbox baseline failures, not yours: process tests, the removed-sub test in `tests/orchestrators.test.js`, `tests/inspector-sandbox.test.jsx > ACP start log line`, the real npm pack test, and any test that fails only because the sandbox denies the home folder. Files: src/ui/LaneConversation.jsx, src/ui/laneConversation.js, src/control/client.js, src/control/mock.js, server/orchestrators.js, server/orchestrator.js, tests/lane-conversation.test.js, any other test of these files, docs/agents/architecture/LIVE.md. Do not stop to ask about scope: decide, and list every decision and file in your report.
1. R54-1: the composer sends (and Send and interrupt shows) only when the selected run is the lane's live run. A finished run shows no composer, or an idle-lane start when no run is live, as today for an idle lane. The page sends the selected run's start time with the message, and `POST /api/orchestrator/messages` refuses with 409 `That run is no longer running.` when a `startedAt` is given and the lane's live run started at another time. A message with no `startedAt` keeps today's behaviour.
2. R54-3: when `runs.running` and `liveRuns` both hold the same lane and start time, the option keeps the live context fields (`contextTokens`, `contextWindow` and any other field the live entry adds).
3. Tests for both, each failing with its change undone. LIVE.md: one sentence each.
4. Run the tests you changed and `npm run build`, and report the counts.

**P541. Review 54 fixes: Claude's reported window by its real model, and current context over whole-run usage (Codex, Terra).** Fixes R54-2 and R54-6 in `docs/agents/AUDIT-2026-11-REVIEW-54.md`. Read that file first. Known sandbox baseline failures, not yours: process tests, the removed-sub test in `tests/orchestrators.test.js`, `tests/inspector-sandbox.test.jsx > ACP start log line`, the real npm pack test, and any test that fails only because the sandbox denies the home folder. Files: src/harnesses/claude.js, server/lanes-source.js, server/orchestrator.js, tests/model-context-window.test.js, tests/lanes-source.test.js, any other test of these files, docs/agents/architecture/LIVE.md. Do not stop to ask about scope: decide, and list every decision and file in your report.
1. R54-2: the window reader matches the model the harness reports (the `model` of the init or assistant line, or the single `modelUsage` key), not only the saved model string, so an empty Harness default or an alias still finds the reported window. When `modelUsage` holds more than one model and none matches, answer null.
2. R54-6: the live lane reader keeps the newest assistant line's context as the current context and uses a result line's usage only when no assistant usage was seen in that run, the same precedence `contextTokensFromLog` has over a whole log.
3. Tests for both, each failing with its change undone. LIVE.md where it states the precedence.
4. Run the tests you changed and `npm run build`, and report the counts.

**P542. Review 54 fixes: the model detail fetch waits after a partial or missing answer (Codex, Terra).** Fixes R54-4 and R54-5 in `docs/agents/AUDIT-2026-11-REVIEW-54.md`. Read that file first. Known sandbox baseline failures, not yours: process tests, the removed-sub test in `tests/orchestrators.test.js`, `tests/inspector-sandbox.test.jsx > ACP start log line`, the real npm pack test, and any test that fails only because the sandbox denies the home folder. Files: server/endpoints.js, server/orchestrator.js, tests/model-context-window.test.js, tests/endpoints.test.js, any other test of these files, docs/agents/architecture/LIVE.md. Do not stop to ask about scope: decide, and list every decision and file in your report.
1. R54-4: a saved detail counts as complete only with a positive whole `contextLength`. A detail without one is fetched again, but no sooner than the retry delay used after a failed fetch.
2. R54-5: an answer that omits the selected model sets the same retry delay for that model, so a turn never fetches again inside the delay.
3. Tests: a partial detail is fetched once and then waits; an omitted model is fetched once over two quick calls; both fetch again after the delay (use an injected clock). Each fails with its change undone.
4. LIVE.md: one sentence. Run the tests you changed and `npm run build`, and report the counts.

**P543. Review 54 fix: a recovered run log must belong to its lane (Codex, Terra).** Fixes R54-7 in `docs/agents/AUDIT-2026-11-REVIEW-54.md`. Read that file first. Known sandbox baseline failures, not yours: process tests, the removed-sub test in `tests/orchestrators.test.js`, `tests/inspector-sandbox.test.jsx > ACP start log line`, the real npm pack test, and any test that fails only because the sandbox denies the home folder. Files: server/runs.js, src/briefs/run.js, tests/bridge-routes.test.js, tests/lane-conversation.test.js, any other test of these files, docs/agents/architecture/LIVE.md. Do not stop to ask about scope: decide, and list every decision and file in your report.
1. `findRunLog` refuses a candidate whose name another lane of the lanes file could also claim (another lane key that starts with this lane's key and a hyphen, or this lane's key plus a brief id equal to another lane's key), unless the run's lane lock or its record names that exact log. When it refuses, the route answers as for a missing log.
2. Tests: R54-7's case (lanes `test` and `test-P1`) is refused; a plain match still opens.
3. LIVE.md: one sentence. Run the tests you changed and `npm run build`, and report the counts.

**P544. Review 55 by Sol: the grid, the rails, counts, run-end rows and the review 54 fixes, P535 to P543 (Codex, Sol, report).** Read this brief and the code only. Change no file except the one you write. Your sandbox keeps git read-only: write the file in your worktree and the runner commits it. Do not run the full suite. Known sandbox baseline failures, not findings: process tests, the removed-sub test in `tests/orchestrators.test.js`, `tests/inspector-sandbox.test.jsx > ACP start log line`, the real npm pack test, and any test that fails only because the sandbox denies the home folder. Files: docs/agents/AUDIT-2026-11-REVIEW-55.md.
1. Review `git diff 4e7cc494..d33c7399` on main: P535 (lattice from the globe top to the git tree bottom, 4 blocks), P536 and the page change (Height rail beside Zoom, ruler marks), P538 (one count formatter with millions), P539 (one-line run ends in the chat), P540 (lane messages carry the run's start time), P541 (Claude's reported window, live context precedence), P542 (model detail retry per model), P543 (recovered logs must belong to their lane).
2. The orchestrator changed these at merge; check them first: P538 was committed by the orchestrator after the run hit its usage limit; LIVE.md conflicts between P540, P541 and P542 were settled by hand.
3. Look first for: a lattice rebuilt every frame or never after the tree changes; a rail whose marks or label take pointer events or overlap the other rail; a count that rounds wrongly near 1000 or a million; a run-end row that hides a failure or drops the Details actions; a message refused for a run that is still live (start time format); a context number that jumps between assistant and result usage; a retry map that grows forever; a lane whose own logs are now refused; a doc sentence the code contradicts; a test that passes with its change undone.
4. Each finding: `R55-N`, a severity, the file and line, what goes wrong, how to see it, one fix. At most 10. No finding without a file and line you read. End with `Checked and fine`. Under 100 lines. Plain words, no em dashes.

**P545. The Agents tab shows the agents first, with the team tools folded below (Codex, Terra).** Seen in the bench room on 2026-11-18 at 1280x800, and the owner asked for a clean, simple UI: the Agents tab of the sidebar opens with the Teams block (`No saved teams yet.`, a `Save as team` field and Save, a `Copy from` picker and Copy), then `Build a team`, and only then the agents list, so the agents sit below the fold of a short sidebar. `renderAgents` in `src/ui/Sidebar.jsx` places `FamilyTeams` (`src/ui/FamilyTree.jsx`), `FamilyTeam` (`src/ui/FamilyTeam.jsx`) and `FamilyTree` in that order. Known sandbox baseline failures, not yours: process tests, the removed-sub test in `tests/orchestrators.test.js`, `tests/inspector-sandbox.test.jsx > ACP start log line`, the real npm pack test, and any test that fails only because the sandbox denies the home folder. Files: src/ui/Sidebar.jsx, src/ui/FamilyTree.jsx, src/ui/FamilyTeam.jsx, src/styles.css, tests/family-tree-ui.test.js, tests/family-tree.test.js, tests/setup.test.js, any other test that pins this order or text, docs/agents/architecture/ROOM.md. Do not stop to ask about scope: decide, and list every decision and file in your report.
1. The agents list (`FamilyTree`) comes first in the Agents tab.
2. Below it, one `Teams` head, a button with `aria-expanded`, closed by default, that reads `Teams` with the saved count when there is one (`Teams 2`). Opening it shows the saved teams and the Save as team and Copy from tools as today. Remember open or closed per viewer in `localStorage`, wrapped in try and catch.
3. `Build a team` keeps its own head and behaviour, after Teams.
4. Every action, confirmation and error message works as today. No feature is removed.
5. Tests: the order of the three parts, Teams closed by default and opening on click, the count in the head, and the saved open state. Update the tests that pin the old order.
6. ROOM.md: the sentence that describes the Agents tab.
7. Run the tests you changed and `npm run build`, and report the counts.

**P546. The footer agents list sits above its button, and its states read in colour (Codex, Terra).** Seen in the bench room on 2026-11-18 at 1280x800: the list that opens from `17 agents · 2 working` (`.transport-agents-list` in `src/ui/Transport.jsx`) runs from 146 to 746 pixels while its button sits at 726 to 762, so the last row covers the button that closes it. Every word in a row is the same white, so `working` and `failed` look alike, and a failure from weeks ago (OpenCode 6, P103) reads the same as one from today. Known sandbox baseline failures, not yours: process tests, the removed-sub test in `tests/orchestrators.test.js`, `tests/inspector-sandbox.test.jsx > ACP start log line`, the real npm pack test, and any test that fails only because the sandbox denies the home folder. Files: src/ui/Transport.jsx, src/ui/transportLanes.js, src/styles.css, tests/transport-lanes.test.js, tests/transport-orchestrators.test.js, tests/layout-css.test.js, any other test of these files, docs/agents/architecture/ROOM.md. Do not stop to ask about scope: decide, and list every decision and file in your report.
1. The list's bottom edge stays at least 8 pixels above the top of its button in every window from 1280x800 up, and it scrolls inside when the rows do not fit. Measure from the button, not from a fixed number.
2. The state word takes the room's colours: working `#e5ff00`, waiting `#e5ff00`, failed `#ff2a2a`, finished or succeeded `#2aff80`, idle dim white. Use classes, not inline colours.
3. A failed or finished row with an end time shows its age in the last column (`5 min`, `3 h`, `2 d`), the same short form the working rows use for minutes.
4. Tests: the position rule (a pure helper that takes the button and window sizes), the class for each state, and the age text. Each fails with its change undone.
5. ROOM.md: the sentence on the footer list.
6. Run the tests you changed and `npm run build`, and report the counts.

**P547. UI audit 3 by Sol: a clean, simple HUD at 1280x800 (Codex, Sol, report).** The owner asked for a full clean UI. Read this brief, `docs/agents/architecture/ROOM.md`, the Conventions in `docs/agents/ARCHITECTURE.md`, and the code under `src/ui/` and `src/styles.css` only. Change no file except the one you write. Your sandbox keeps git read-only: write the file in your worktree and the runner commits it. Do not run the full suite. Known sandbox baseline failures, not findings: process tests, the removed-sub test in `tests/orchestrators.test.js`, `tests/inspector-sandbox.test.jsx > ACP start log line`, the real npm pack test, and any test that fails only because the sandbox denies the home folder. Files: docs/agents/AUDIT-2026-11-UI-3.md.
1. Find what makes the HUD busy or inconsistent for an owner at 1280x800 and wider: two controls that do the same thing in different places; a panel that opens with tools before the content the owner came for; labels that name the same thing two ways; text that can overflow or overlap at 1280 wide; a control under 24 pixels; a colour outside white, `#e5ff00`, `#ff2a2a`, `#2aff80` and `#2a9dff` on black (greys of white are fine); a font other than Jost and Space Mono, a weight other than 400 or 500, or bold; an em dash in shown text; a message the owner cannot act on.
2. Skip what the owner settled already: the one-line modes, the status line under the composer, the Agent messages toggle, the footer agents button and list, the Height and Zoom rails on the right, one-line run ends in the chat, the Teams fold, and the tunnel, star and bracket colours.
3. Each finding: `UI3-N`, a severity (P1 confusing, P2 cluttered, P3 polish), the file and line, what the owner sees, one fix that removes or merges rather than adds. At most 15. No finding without a file and line you read. End with `Checked and fine`. Under 120 lines. Plain words, no em dashes.

**P548. Docs audit 4: the architecture files against the code (Codex, Sol, report).** Many briefs since 0.1.380 changed `docs/agents/architecture/LIVE.md`, `ROOM.md`, `CODE.md` and `ACTIVITIES.md`, and the orchestrator settled three merge conflicts in LIVE.md and ROOM.md by hand on 2026-11-18. Read this brief, `docs/agents/ARCHITECTURE.md`, the four files above and the code they describe only. Change no file except the one you write. Your sandbox keeps git read-only: write the file in your worktree and the runner commits it. Do not run the full suite. Known sandbox baseline failures, not findings: process tests, the removed-sub test in `tests/orchestrators.test.js`, `tests/inspector-sandbox.test.jsx > ACP start log line`, the real npm pack test, and any test that fails only because the sandbox denies the home folder. Files: docs/agents/AUDIT-2026-11-DOCS-4.md.
1. Find sentences the code contradicts: a constant, default, route, status code, message text, file name, order or colour that differs; a feature described that no longer exists; a sentence that says something is pending or will happen that has happened; two sentences in the docs that disagree; a sentence that repeats another in the same file.
2. Start with the sentences that name P526 to P546, the context window rule, the footer list, the lane conversation, the rails, the grid, run-end rows and the Teams fold.
3. Each finding: `D4-N`, the doc file and line, the code file and line, what the doc says, what the code does, and the corrected sentence. At most 25. No finding without both lines read. End with `Checked and fine`. Plain words, no em dashes.

**P549. Review 55 fixes: backup run messages, unambiguous log recovery and the retry map (Codex, Terra).** Fixes R55-1, R55-2 and R55-3 in `docs/agents/AUDIT-2026-11-REVIEW-55.md`. Read that file first. Known sandbox baseline failures, not yours: process tests, the removed-sub test in `tests/orchestrators.test.js`, `tests/inspector-sandbox.test.jsx > ACP start log line`, the real npm pack test, and any test that fails only because the sandbox denies the home folder. Files: server/orchestrators.js, server/runs.js, server/endpoints.js, scripts/run-lane.mjs, tests/lane-conversation.test.js, tests/bridge-routes.test.js, tests/model-context-window.test.js, tests/orchestrators.test.js, any other test of these files, docs/agents/architecture/LIVE.md. Do not stop to ask about scope: decide, and list every decision and file in your report.
1. R55-1: when a lane fails over to its backup, the ticket records the backup run's start time, so a message carrying the backup's start time is delivered and one carrying the first run's start time answers 409 as today.
2. R55-2: a longer lane key refuses a candidate only when a brief or `project` segment remains between that key and the time stamp. The two-brief ambiguous case stays refused.
3. R55-3: expired entries leave the retry map before each check, and a model's entry is removed once its window is known.
4. Tests for each, each failing with its change undone. LIVE.md where a sentence changes.
5. Run the tests you changed and `npm run build`, and report the counts.

**P550. UI audit 3 fixes: chat tab dots, one word for Branch, one pin control, a runner warning that says what to do (Codex, Terra).** Fixes UI3-1, UI3-6, UI3-10 and UI3-11 in `docs/agents/AUDIT-2026-11-UI-3.md`. Read that file first. Known sandbox baseline failures, not yours: process tests, the removed-sub test in `tests/orchestrators.test.js`, `tests/inspector-sandbox.test.jsx > ACP start log line`, the real npm pack test, and any test that fails only because the sandbox denies the home folder. Files: src/styles.css, src/ui/orchestratorChat.js, src/ui/OrchestratorChat.jsx, src/ui/Sidebar.jsx, src/ui/sidebar.js, src/ui/healthNotice.js, src/ui/Hud.jsx, any test that pins these, docs/agents/architecture/ROOM.md. Do not stop to ask about scope: decide, and list every decision and file in your report.
1. UI3-1: the chat tab dot takes the room's state colours: working and waiting `#e5ff00`, failed `#ff2a2a`, idle dim white. No green dot for a resting or waiting orchestrator.
2. UI3-6: a conversation row has no pin button; Pin or Unpin stays in its menu, and the Pinned group still shows.
3. UI3-10: every shown word for that action is Branch, including the menu item and its empty-conversation message. Function names may stay.
4. UI3-11: when the runner looks stopped and there are no detail lines, the notice itself says how to restart it in one short sentence and is not a button that opens an empty popup.
5. Tests for each. Update tests that pin the old text or controls. ROOM.md where a sentence changes.
6. Run the tests you changed and `npm run build`, and report the counts.

**P551. UI audit 3 fixes: what the owner came for comes first, a dock that fits, one console colour (Codex, Terra).** Fixes UI3-2, UI3-4, UI3-7 and UI3-9 in `docs/agents/AUDIT-2026-11-UI-3.md`. Read that file first. Known sandbox baseline failures, not yours: process tests, the removed-sub test in `tests/orchestrators.test.js`, `tests/inspector-sandbox.test.jsx > ACP start log line`, the real npm pack test, and any test that fails only because the sandbox denies the home folder. Files: src/ui/panels/DispatchPanel.jsx, src/ui/Sidebar.jsx, src/ui/RepositoryPanel.jsx, src/ui/AgentDock.jsx, src/styles.css, any test that pins these, docs/agents/architecture/ROOM.md. Do not stop to ask about scope: decide, and list every decision and file in your report.
1. UI3-2: Dispatch shows Needs you before the project run form, one copy only.
2. UI3-4: the Projects tab shows the current and recent projects first and the Repository block after them.
3. UI3-7: the dock's address button reads `Open address`, with the full address in its title, so Focus, Log and the address never clip at a 280 pixel column.
4. UI3-9: the command console uses the white activity style, with no cyan text, border, glow or tinted fill. Remove the cyan variable if nothing else uses it.
5. Tests for each order and text. ROOM.md where a sentence changes.
6. Run the tests you changed and `npm run build`, and report the counts.

**P552. UI audit 3 fix: one 24 pixel hit area for small controls (Codex, Terra).** Fixes UI3-5 in `docs/agents/AUDIT-2026-11-UI-3.md`. Read that file first. Known sandbox baseline failures, not yours: process tests, the removed-sub test in `tests/orchestrators.test.js`, `tests/inspector-sandbox.test.jsx > ACP start log line`, the real npm pack test, and any test that fails only because the sandbox denies the home folder. Files: src/styles.css, tests/layout-css.test.js, any other test that pins these sizes, docs/agents/architecture/ROOM.md. Do not stop to ask about scope: decide, and list every decision and file in your report.
1. The controls UI3-5 names (failure tray Clear, the Reviews count, conversation menus, agent switches, Add and Chat, lane selection boxes) get at least a 24 pixel hit area through one shared rule, keeping their icons and visible size where a larger box would crowd the row (a transparent padding or pseudo element is fine).
2. A CSS test checks each selector reaches 24 pixels.
3. Run the tests you changed and `npm run build`, and report the counts.

**P553. Docs audit 4 fixes: the architecture files say what the code does (Codex, Terra).** Fixes D4-1 to D4-21 in `docs/agents/AUDIT-2026-11-DOCS-4.md`. Read that file first. Change docs only. Files: docs/agents/architecture/LIVE.md, docs/agents/architecture/ROOM.md, docs/agents/architecture/CODE.md, docs/agents/architecture/ACTIVITIES.md, docs/agents/ARCHITECTURE.md. Do not stop to ask about scope: decide, and list every decision and file in your report.
1. For each finding, read the code lines it names, then replace the doc sentence with its corrected sentence, or a better one if the code says otherwise. Remove the repeated block D4-5 names. Keep plain words and no em dashes.
2. Where another doc sentence repeats the same wrong claim, fix it too and name it in your report.
3. Run `node node_modules/vitest/vitest.mjs run tests/docs-links.test.js tests/static-links.test.js` if they exist, and any test that reads these docs, and report the counts.

**P554. Review 56 by Sol: the UI cleanup P545 to P553 (Codex, Sol, report).** Read this brief and the code only. Change no file except the one you write. Your sandbox keeps git read-only: write the file in your worktree and the runner commits it. Do not run the full suite. Known sandbox baseline failures, not findings: process tests, the removed-sub test in `tests/orchestrators.test.js`, `tests/inspector-sandbox.test.jsx > ACP start log line`, the real npm pack test, and any test that fails only because the sandbox denies the home folder. Files: docs/agents/AUDIT-2026-11-REVIEW-56.md.
1. Review `git diff d33c7399..07f29234` on main, skipping the audit and brief files: P545 (agents first, Teams fold), P546 (footer list placement, state colours, ages), P550 (tab dots, Branch wording, pin control, runner notice), P551 (Needs you first, Projects order, Open address, white console), P552 (24 pixel hit areas through `::after`), P553 (doc fixes).
2. The orchestrator settled merge conflicts by hand in ROOM.md (P546, P551) and `tests/layout-css.test.js` (P552); check those first.
3. Look first for: a hit area that covers a neighbouring control or catches clicks meant for the row; a list that can open off screen; a state with no colour class; an age shown for a run with no end time; a Teams state that hides an error the owner needs; a Needs you row that lost its action; a test that passes with its change undone; a doc sentence the code contradicts.
4. Each finding: `R56-N`, a severity, the file and line, what goes wrong, how to see it, one fix. At most 10. No finding without a file and line you read. End with `Checked and fine`. Under 100 lines. Plain words, no em dashes.

**P555. Review 56 fixes: Teams errors show while folded, family targets stay in their row, one doc line (Codex, Terra).** Fixes R56-1 to R56-3 from review 56 (`docs/agents/AUDIT-2026-11-REVIEW-56.md`, merged after you start; the findings are here). Known sandbox baseline failures, not yours: process tests, the removed-sub test in `tests/orchestrators.test.js`, `tests/inspector-sandbox.test.jsx > ACP start log line`, the real npm pack test, and any test that fails only because the sandbox denies the home folder. Files: src/ui/FamilyTree.jsx, src/styles.css, tests/family-tree-ui.test.js, tests/layout-css.test.js, any other test of these files, docs/agents/architecture/CODE.md, docs/agents/architecture/ROOM.md. Do not stop to ask about scope: decide, and list every decision and file in your report.
1. R56-1: `FamilyTeams` (`src/ui/FamilyTree.jsx` near line 515, alert near 622) reads teams while closed, but its error alert sits inside the folded body. Show a read error outside the fold, so a failure is visible while Teams stays closed.
2. R56-2: the Add, Chat and trash buttons in a family row are 18 pixels high, and their centred 24 pixel `::after` targets (`src/styles.css` near line 10784, row layout near 9662 and 9672) reach 3 pixels into the Edit button above and below the row. Reserve at least 24 pixels of height for the actions row, keeping the visible icons at 18 pixels, so no target crosses another button.
3. R56-3: `docs/agents/architecture/CODE.md` near line 54 says the Repository section is at the top of Projects; it now follows the project rows.
4. Tests: a failed read shows its alert while closed; the actions row holds 24 pixels (a CSS test). Each fails with its change undone.
5. Run the tests you changed and `npm run build`, and report the counts.

**P556. Needs you holds only what the owner can act on, and the brief picker shows the newest first (Claude, Sonnet).** An earlier run left partial work on branch `feat/p556-partial`: merge it into your branch first (`git merge refs/heads/feat/p556-partial`), then check and finish it. Seen in the bench room on 2026-11-18 at 1280x800: Control, Dispatch, Needs you lists `machineroom-1 failed on P520.`, `agy2 failed on P493.`, `opencode2 failed on P462b.`, `opencode failed on P461.` and `codex | P538 | failed | cost unknown | 3.5 min | 2026-11-17T17:28:04.824Z`: some days old, P538 fixed by a later merge, two row formats, no age and no action. The Brief picker below lists 556 open briefs oldest first. `attentionItems` is in `src/briefs/attention.js` (served from `server/runs.js` as `attention`), the rows render in `src/ui/panels/DispatchPanel.jsx` near line 1068, and the picker near line 1610. Known sandbox baseline failures, not yours: process tests, the removed-sub test in `tests/orchestrators.test.js`, `tests/inspector-sandbox.test.jsx > ACP start log line`, the real npm pack test, and any test that fails only because the sandbox denies the home folder. Files: src/briefs/attention.js, server/runs.js, src/ui/panels/DispatchPanel.jsx, src/styles.css, tests/attention.test.js, any other test of these files, docs/agents/architecture/ROOM.md, docs/agents/architecture/LIVE.md. Do not stop to ask about scope: decide, and list every decision and file in your report.
1. A failure leaves Needs you when a later run of the same brief (or the same task) on any lane succeeded, or when the owner dismissed it.
2. Every row reads the same way: `LANE failed on WORK · AGE` (age as `5 min`, `3 h`, `2 d`), with two small buttons: Open, which opens that lane's conversation at that run (the same event the footer list and family tree use), and Dismiss, which hides that row for this viewer (`localStorage`, keyed by lane and start time, wrapped in try and catch).
3. The Brief picker lists the newest briefs first within each group.
4. Tests: a failure followed by a success of the same brief is gone; the row text and age; Dismiss hides and remembers; the picker order. Each fails with its change undone.
5. ROOM.md and LIVE.md where a sentence changes. Run the tests you changed and `npm run build`, and report the counts.

**P557. Reviews shows only lanes with something to review, and Team names the harness (Claude, Sonnet).** An earlier run left partial work on branch `feat/p557-partial`: merge it into your branch first (`git merge refs/heads/feat/p557-partial`), then check and finish it. Seen in the bench room on 2026-11-18 at 1280x800: Control, Reviews lists all 18 lanes, most of them `unchecked`, `0 commits ahead`, `0 files +0 -0`, so the one lane with work is buried (`src/ui/panels/ReviewsPanel.jsx`, `src/ui/panels/reviews.js`). Control, Team shows each lane as `claude_local // claude-opus-5-5` or `opencode_local // ...`, the old adapter names (`src/ui/panels/AgentBuilder.jsx` near line 98). Known sandbox baseline failures, not yours: process tests, the removed-sub test in `tests/orchestrators.test.js`, `tests/inspector-sandbox.test.jsx > ACP start log line`, the real npm pack test, and any test that fails only because the sandbox denies the home folder. Files: src/ui/panels/ReviewsPanel.jsx, src/ui/panels/reviews.js, src/ui/panels/AgentBuilder.jsx, src/harnesses/index.js, server/control.js, src/control/client.js, src/control/mock.js, tests/control-contract.test.js, tests/live-runs.test.js, src/styles.css, any test of these files, docs/agents/architecture/ROOM.md. `server/control.js` drops the harness key from the Team answer today; add it (the key only, no secrets) where Team needs it. Do not stop to ask about scope: decide, and list every decision and file in your report.
1. Reviews lists a lane only when its branch is ahead of main or its worktree has changes. The others fold into one line, `N lanes have nothing to review`, a button with `aria-expanded` that shows them when opened. With no lane to review, the panel says `Nothing to review.` above that line.
2. Team shows each lane's harness name from the harness registry (`Claude Code`, `OpenCode`, `Codex`, and so on) and its model, as `HARNESS · MODEL`, never the adapter type. An unknown harness shows its key.
3. Tests for both, each failing with its change undone. Update tests that pin the old text.
4. ROOM.md where a sentence changes. Run the tests you changed and `npm run build`, and report the counts.

**P558. Test audit 3: today's tests fail when their change is undone (Codex, Sol, report).** Read this brief, `docs/agents/AUDIT-2026-11-TESTS.md` for the method, and the code and tests only. Change no file except the one you write. Your sandbox keeps git read-only: write the file in your worktree and the runner commits it. Do not run the full suite. Known sandbox baseline failures, not findings: process tests, the removed-sub test in `tests/orchestrators.test.js`, `tests/inspector-sandbox.test.jsx > ACP start log line`, the real npm pack test, and any test that fails only because the sandbox denies the home folder. Files: docs/agents/AUDIT-2026-11-TESTS-3.md.
1. For each brief merged in `git log 2cff726b..HEAD` on main that added or changed a test (P526 to P555), pick the test that claims to pin its fix. In your worktree, undo the fix by hand (revert the source lines only), run that one test file, and restore the source. Record whether the test failed.
2. List every test that still passes with its fix undone, and every fix with no test at all.
3. Each finding: `T3-N`, the brief, the test file and name, the source lines you undid, what the test checks instead, one fix to the test. At most 20. End with a table of every brief checked and its result, then `Checked and fine`. Plain words, no em dashes. Leave every source file as you found it.

**P559. Settings opens on a short list of sections, and each setting sits in its section (Claude, Sonnet).** Seen in the bench room on 2026-11-18 at 1280x800: Settings is one long scroll of eleven sections (Harnesses, Direct API, Keys, Lanes, Screen effects, Replay, Sound, Subagents, MCP tools, Web search, Storage) with 90 buttons and 34 fields. Four lane settings sit at the top under Harnesses (`src/ui/HarnessesSettings.jsx` near lines 380 to 435: Replies to a working lane, Warn above this many running lanes, Worktree setup command, Copy into new worktrees) though a Lanes section exists. Known sandbox baseline failures, not yours: process tests, the removed-sub test in `tests/orchestrators.test.js`, `tests/inspector-sandbox.test.jsx > ACP start log line`, the real npm pack test, and any test that fails only because the sandbox denies the home folder. Files: src/ui/Settings.jsx, src/ui/HarnessesSettings.jsx, src/ui/KeysSettings.jsx, src/styles.css, tests/harnesses-settings.test.js, tests/harnesses-drafts.test.jsx, tests/keys-settings.test.js, tests/agent-depth-settings.test.js, any other test that pins the Settings layout, docs/agents/architecture/ROOM.md. Do not stop to ask about scope: decide, and list every decision and file in your report.
1. Settings shows a row of section tabs at the top (one per section, with `role="tablist"` and arrow keys), and shows one section at a time. Remember the open section per viewer in `localStorage`, wrapped in try and catch. The first visit opens Harnesses.
2. Move the four lane settings into the Lanes section, keeping their behaviour, drafts and saves.
3. Never read, show or prefill a saved key; the key fields stay write-only as today.
4. Tests: the tabs show one section at a time, the open section is remembered, the four lane settings render under Lanes, and every existing save still works. Update tests that pin the old layout.
5. ROOM.md: the sentence on Settings. Run the tests you changed and `npm run build`, and report the counts.

**P560. The interrupt cap test waits as long as Windows CI needs (Codex, Terra).** CI on Windows failed on `eb08995a` (run 44227679465) and passed on the next push: `tests/lane-interrupt.test.js > interrupting a working CLI lane run > allows at most three interrupts per first run and lets the fourth wait for the next turn` took 33 seconds and threw `Timed out waiting for continuation CLI invocation 4.` Each continuation spawns real processes, and the waits near line 424 (15 s) and 435 (20 s) are tight on a slow Windows runner. Known sandbox baseline failures, not yours: process tests, the removed-sub test in `tests/orchestrators.test.js`, `tests/inspector-sandbox.test.jsx > ACP start log line`, the real npm pack test, and any test that fails only because the sandbox denies the home folder. Files: tests/lane-interrupt.test.js, tests/helpers/*.js if a shared wait helper lives there, any other test that uses the same waits. Do not stop to ask about scope: decide, and list every decision and file in your report.
1. Find why the fourth continuation can take more than 20 seconds on Windows: if the test waits on something it could observe sooner (the interrupt file, the run record, the lane lock), wait on that first; otherwise give these waits and the test's own timeout enough room for a slow runner (for example scale them by a factor when `process.env.CI` is set) without slowing a local run.
2. Keep every assertion. Do not mock the processes away.
3. Run `node node_modules/vitest/vitest.mjs run tests/lane-interrupt.test.js` three times and report each time and count.

**P561. A continued run on a Claude lane resumes its session, so the lane keeps its context (Codex, Terra).** The owner wants Sonnet lanes never to lose the context they build up, and to compact on their own at 500k. Today `run-lane --continue-from` (and the interrupt path that uses it) starts every run with a fresh `randomUUID()` session (`scripts/run-lane.mjs` near line 2111) and passes `--session-id` (`src/harnesses/claude.js` near line 135), so a continued Claude run starts from nothing. The previous run's `<run>.meta.json` already holds its `sessionId`, and `claudeProjectSlug` in `server/claude-sessions.js` gives the folder of Claude's session files. Known sandbox baseline failures, not yours: process tests, the removed-sub test in `tests/orchestrators.test.js`, `tests/inspector-sandbox.test.jsx > ACP start log line`, the real npm pack test, and any test that fails only because the sandbox denies the home folder. Files: scripts/run-lane.mjs, src/harnesses/claude.js, server/claude-sessions.js only if a helper belongs there, tests of these files (`tests/harnesses*.test.js`, `tests/run-lane*.test.js`, `tests/lane-interrupt.test.js`), docs/agents/architecture/COMMANDS.md, docs/agents/architecture/LIVE.md. Do not stop to ask about scope: decide, and list every decision and file in your report.
1. When `--continue-from` names a run on the same lane, the lane's harness is `claude`, the previous meta.json has a `sessionId`, and that session's file exists in the lane worktree's Claude project folder, pass `--resume <sessionId>` instead of `--session-id <new id>`, and record the same `sessionId` (plus `resumed: true`) in the new meta.json so a later continue resumes it again.
2. A resumed run's prompt is the interrupt text, or `Continue your brief from where you stopped.` when there is none, since the brief is already in the session. Keep the lane rules that the first prompt carries in the first prompt only.
3. When any condition in step 1 fails, keep today's behaviour: a new session with the full prompt.
4. Other harnesses keep today's behaviour. Add tests for the resume, the missing-file fallback and another harness, and say in COMMANDS.md and LIVE.md what a continued Claude run does.

**P562. The runner stops every process its lane started, even one that lost its parent (Codex, Terra).** Seen on 2026-11-18: the first test audit 3 run on the Sonnet lane `claude3` started a bash script, `/tmp/p558/run.sh`, that reverse-applied patches in its worktree and ran vitest on each. The run ended after 4.4 minutes and the runner's sweep stopped about 25 leftovers, but not this script: its parent had exited, so it no longer descended from the harness child, and its command line names `/tmp`, not the worktree, so `leftoverProcesses` in `server/processTree.js` (near line 148) matched neither rule. It kept changing tracked files in `.worktrees/claude3` for minutes after the run. The next start refused with `The claude3 lane still has leftover process 7860 (node)` (a vitest it had just started), while `run-lane -- --stop claude3` printed `Nothing was running for the claude3 lane.` (`scripts/run-lane.mjs` near lines 374 and 447). Known sandbox baseline failures, not yours: process tests, the removed-sub test in `tests/orchestrators.test.js`, `tests/inspector-sandbox.test.jsx > ACP start log line`, the real npm pack test, and any test that fails only because the sandbox denies the home folder. Files: server/processTree.js, scripts/run-lane.mjs, src/briefs/run.js if a message lives there, tests of these files, docs/agents/architecture/COMMANDS.md, docs/agents/architecture/LIMITS.md. Do not stop to ask about scope: decide, and list every decision and file in your report.
1. While a run is alive, note the process ids (with their start times, so a reused id is never stopped) of every descendant of the harness child, sampled often enough to catch a short-lived parent. At the end, stop each noted process that is still alive and still has the same start time, together with its own descendants, as well as what today's rules find.
2. `--stop LANE` stops the same leftovers the start check refuses on, so the message it prints and the start check never disagree. When it stops leftovers, it says how many.
3. Keep `windowsHide` on every spawn, and never stop a process outside the lane's run: test that a process with a reused id and another start time stays alive.
4. Say in COMMANDS.md what the sweep stops, and remove the limit from LIMITS.md if one names it.

**P563. Small wording fixes in Reviews (Claude, Sonnet).** P557 left the fold line as `1 lanes have nothing to review` for one lane. Known sandbox baseline failures, not yours: process tests and any test that fails only because the sandbox denies the home folder. Files: src/ui/panels/ReviewsPanel.jsx, tests/reviews-order.test.jsx, tests/reviews-panel.test.js. Do not stop to ask about scope: decide, and list every decision and file in your report.
1. One lane reads `1 lane has nothing to review`; two or more read `N lanes have nothing to review`. Test both.
