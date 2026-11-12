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
