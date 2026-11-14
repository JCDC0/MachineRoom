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

**P282. Check the detail docs against this week's code (native).** Read this brief only. Change no code. Commit only your report, and stop at minute 30. Files: docs/agents/AUDIT-2026-11-DOCS-3.md.

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
