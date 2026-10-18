# Task briefs

Three agents work on MachineRoom at the same time. Each one owns a set of paths and works on its own branch in its own git worktree. Stay inside your paths. If you need a change outside them, write it in your report and stop.

| Agent | Role | Branch and folder | Owns |
| --- | --- | --- | --- |
| Claude | Engine and merges | `main` in `C:\GitHub\MachineRoom` | `src/engine/**`, `src/Stage.jsx`, `src/App.jsx`, `docs/agents/ARCHITECTURE.md`, version bumps, merges |
| OpenCode | Backend and data | `feat/live-bridge` in `C:\GitHub\MachineRoom-opencode` | `src/model/**`, `server/**`, `scripts/**`, `public/fixtures/**`, `tests/` files for those, `.env.example`, `dependencies` in `package.json` |
| AGY | Frontend | `feat/hud` in `C:\GitHub\MachineRoom-agy` | `src/ui/**`, `src/styles.css`, `index.html` |

## Rules for every agent

- Read `AGENTS.md` (or `GEMINI.md`), then `docs/agents/ARCHITECTURE.md`, then your section below.
- Work in your own worktree. Never push. Never force anything. Never switch the main folder's branch.
- Commit small on your branch. Prefix: `0.1.1:` for OpenCode, `0.1.2:` for AGY, then one plain sentence. Claude renumbers on merge.
- Before you report, run `npm test` and `npm run build`. Both must pass.
- Add one line per change under `Unreleased` in `docs/agents/CHANGELOG.md`.
- Style: plain words, short sentences, no em dashes, no single-line explanatory comments, no bold fonts, no emoji in code or copy.
- Never read, print or commit a secret. Never write a key into a file, a log or a report.
- Stop every process you start (dev servers, bridges, browsers). Delete any log file you wrote.
- Report: files changed, commands run with pass or fail, and what you could not verify. Do not claim a pass you did not run.

## Done

- OpenCode B1 to B4 (merged as 0.1.5): incremental pipeline, bridge server with agent mapping, tree, SSE with replay after `Last-Event-ID`, tree watcher, and tests against a fake Paperclip.
- AGY F1 to F6 (merged as 0.1.7): HUD pass, run markers, event log drawer, terminal styling, mode switch and help overlay.
- Claude (0.1.4 to 0.1.8): one shared pipeline, bridge client in the viewer, markers, log and mode switch wired, live transport, simulated feed, layout, follow mode and labels.
- OpenCode B5 (merged as 0.1.21): four recorded scenarios under `public/fixtures/scenario-*`, `scripts/frames-from-runs.mjs` (rebuild frames from Paperclip's stored runs), renames and deletes count as writes. Findings are folded into P5 and P6 below.
- AGY F7 (merged as 0.1.11) and Claude E1 (a real Paperclip run compared with the terminals, 0.1.8 to 0.1.9).
- Claude A1 (0.1.20): the assistant core.
- AGY C3a (merged as 0.1.22): the control drawer with dispatch, tasks, approvals and meters, running on the mock.
- Claude D1 (0.1.27): the decision model seam, probe sets and comparison script. Waiting for the owner to run it.
- AGY A2 (merged as 0.1.28): the floating assistant terminal in the HUD.
- Claude A3 (0.1.31): the dispatcher. The assistant now moves the camera (agent, terminal, folder or file, overview, follow), controls replay, and runs confirmed writes (task, budget) through the control client. Opening a panel or a task thread needs AGY's C3b (`controlTarget`).

## Open work

**B6. Late join replay (OpenCode).** A viewer that opens during a run sees only frames that arrive after it connects. Let `/events` send the kept history to a client that connects without `Last-Event-ID`, behind a `?history=1` query so the viewer can ask for it. Test it in `tests/bridge.test.js`. The pipeline already drops frames it has seen.

**E2. Paperclip plugin page (Claude).** Check whether the viewer can ship as a page inside Paperclip instead of a separate app.

## Roadmap: subagents and a public release

The goal is a public application that turns Paperclip into an overview room where you watch agents, and the subagents they start through their own harnesses, move between folders and touch files. The recordings so far hold no real subagent events, so the data comes first.

**S1. Record subagent runs (OpenCode, extends B5).** One scenario per harness, tiny tasks, cheapest model that works: Claude Code starting a subagent with its Task tool, OpenCode starting one with its `task` tool, Hermes using `delegate_task`. Also record Paperclip's own delegation: the Orchestrator agent creating an issue for another agent (the `activity.logged` frame with `issue.created` carries the creator, the assignee and `parentId`). Report which signal in the raw log identifies the parent, the child and the child's tool calls. AGY's own session log for C3a shows it starting a subagent (a "Delegation" routine that invoked one named DeepCoder), so add one headless `agy --print --output-format stream-json` run with a task that makes it delegate, and report whether the stream carries the child.

**S2. Subagent schema and room (Claude).** Add `agent.spawn` (parent, child, label) to the activity schema, let the state and the room add agents while they run, draw the spawn as a new shape splitting off its parent along a string, and give each child a terminal on the wall.

**S3. Subagent parsers (OpenCode).** Detect the spawn in each harness and attribute the nested tool calls to the child. Needs S1 and S2's schema.

**P1. One command install (OpenCode).** `npx machine-room`: one process that serves the built viewer and the bridge on one port, with flags and env for the Paperclip URL, company and project folder, and no Vite or proxy needed. Add a `bin` entry and a test that packs the package and starts it.

**P2. First run and polish (AGY, merged as 0.1.16 and wired in 0.1.17).** A connect screen (Paperclip URL, company picker, demo link), clear empty and error states, remembered settings, a name, logo and favicon, and screenshots for the README.

**P3. Scale (Claude).** Collapse and level of detail for projects with thousands of folders, layout in a worker, reduced motion for the 3D scene. Required before daily use on large repositories.

**P4. Release decisions (the owner).** Licence, repository name and the trademark check on the names Paperclip and POI (use neither logo nor name of the show), whether `sprites.js` (copied from the graded portfolio) may be published or should be rewritten, CI (test and build), and a short security note (the bridge binds 127.0.0.1 and allows only local pages).

## Roadmap: planner, orchestrator and budgets

Design and rules are in `docs/agents/CONTROL-PLANE.md`. Paperclip already has hiring, budgets, approvals, planning and worktrees, so these tasks use its APIs and do not rebuild them.

**C0. Run the dev agents inside Paperclip (Claude, with the owner).** Needs the owner's yes to switch on the instance flag `enableIsolatedWorkspaces`, and a git project workspace for the repo. Register OpenCode, AGY and Claude Code as Paperclip agents with isolated worktree workspaces, so tasks arrive as issues and reports come back as run results and comments. agy needs a launcher that reads its issue through the API, because its arguments hold a fixed prompt today. Try one tiny issue per agent. The owner picks the models first, because each run spends credit. Stage 1 is done: one issue to OpenCode Go with the free model `opencode/deepseek-v4.1-flash-free` fixed a typo in a throwaway repo and reported back through the API (see `PAPERCLIP-API.md`). Stage 2, worktrees, waits for the owner's yes on the flag.

**C1. Paperclip API audit (Claude, done).** Written up in `docs/agents/PAPERCLIP-API.md`. Open from it: the answers to a hire and an issue create, and a full plan flow, all need a throwaway write and the owner's OK.

**C2. Control client (OpenCode, first in the queue).** Make the contract in `CONTROL-CLIENT.md` real. Bridge routes that pass dispatch (an issue with `assigneeAdapterOverrides`), comments, approvals, budgets and costs to Paperclip, local pages only. Then `src/control/client.js`, a browser object with every method of the contract that calls those routes. `subscribe` is fed by the bridge's event stream: when a Paperclip frame touches a topic (run status, issue, comment, approval, cost), send a change notice for it. Write one contract test file that runs the same checks against the mock and against the real client over a fake Paperclip, so the two cannot drift apart. Hire and update an agent wait for C3c. Shapes are in `PAPERCLIP-API.md`. Done when `/?live&bridge=...` passes the real client to the HUD and the drawer shows the live agents and costs.

**C3. Control surface (AGY, starts now against the mock).** The contract is `docs/agents/CONTROL-CLIENT.md` and the mock is `src/control/mock.js`, so the panels do not wait for C2. In the HUD: a dispatch panel (task, assignee, size, budget, subagents allowed), budget meters, quota meters (session and week percent, reset time), an approvals queue and a task thread. These are merged as C3a (0.1.22). The agent builder form is C3d. Real data needs C2.

**C4. Routing policy, version 1 (Claude).** A pure module `src/policy/` with tests: task profile to tier, escalation, spend limits, quota-aware choice (skip a provider above a set percent of its window), and the policy file schema.

**C5. Planner and orchestrator agents (Claude).** Instruction bundles for both, hired through C2, first run on a tiny goal with the cheapest models and approvals on.

**C6. Outcome log and decision layer (Claude, OpenCode).** Log every run, build the success and cost tables, propose policy changes as diffs. Start logging as soon as C4 exists.

## Roadmap: working in MachineRoom day to day

The daily loop and its limits are in `docs/agents/CONTROL-PLANE.md` under "Product shape". These tasks fill the gaps between "I can watch" and "I work here". C2 and C3 above are part of it.

**W1. Supervisor (OpenCode).** `machine-room up` and `machine-room doctor`: attach to a running Paperclip or start one, start the bridge, check health, and warn loudly when the last database backup is missing or older than a day. Extends P1.

**W2. Backups and recovery (Claude, then OpenCode).** Find Paperclip's backup route (there is a route file for instance database backups), add a "back up now" call and a visible backup age in the HUD, and write down how to restore.

**W3. Review and merge (OpenCode for the bridge, AGY for the panel).** Local git through the bridge: the branch of each issue, diff stat and patch, test result from the run report, merge with a confirmation, stop on a conflict, never push. Tests with a throwaway repo.

**W4. Projects (Claude).** A project and company picker. The bridge serves one project folder today. Several projects means one room per project.

**W5. Talk to the planner (Claude, AGY).** A comment thread panel on each issue, posting through `POST /api/issues/:id/comments`. Evaluate Paperclip's board chat stream (`POST /api/board/chat/stream`, experimental, off) after that.

**W6. Live status without polling (Claude).** Use the live-run routes (`/api/companies/:id/live-runs`, `/api/issues/:id/live-runs`) so the panels show which issue is running without reading the whole stream.

## Roadmap: the assistant and the cost board

The design is in `docs/agents/CONTROL-PLANE.md` under "The assistant and the cost board". The rule engine, the action list and the model reply parser exist and are tested.

**A1. Intent rules and action list (Claude, done as 0.1.20).** `src/assistant/actions.js`, `intent.js` and `llm.js` with `tests/assistant.test.js`. Pure code, no DOM. `interpret(text, context)` returns `{ kind: action | propose | ask | unknown | blocked, action?, say, options? }` where `context` is `{ agents: [{ key, name }], paths: [...] }`. The only way to run an action is `validateAction`.

**A2. Floating assistant terminal (AGY).** A React component `Assistant` for the HUD, in the style of the wall terminals. Props: `context` (as above), `onAction(action)`, and `ask(text)` (optional, async, returns the same result shape as `interpret`, used for the model fallback). It takes no key prop on purpose. Behaviour: opens with `/`, closes with Escape, draggable, remembers its position in `machineroom.settings`, history with the up arrow. Calls `interpret` on enter. For `action`, show the `say` line and call `onAction`. For `propose`, show a card with the `say` text and two buttons, and call `onAction` only on confirm. For `ask`, show the `options` as buttons that send the option's `text` back through `interpret`. For `blocked`, show the `say` line and open the masked key field if the result carries an `open_config` action with section `keys`. For `unknown`, call `ask` when given, otherwise show the help line. Never echo or store typed text that `containsSecret` flags. Use the mock for any data. Do not edit `src/engine` or `src/assistant`. Add a short test for any pure helper you write.

**A3. Dispatcher (Claude, built as 0.1.31).** `src/assistant/dispatch.js` maps each validated action to the room, the HUD and the control client: camera focus on an agent or folder, wall terminal focus, follow modes, panel tabs, issue and config views, replay controls, and the three confirmed writes through `client.createIssue`, `client.setAgentBudget` and the subagent setting.

**A4. Model fallback route (OpenCode).** `POST /api/assistant` in the bridge, local pages only. Body `{ prompt }` with a length limit of 2000 characters. It runs `opencode run -m <model> --format json` with a timeout of 8 seconds and returns the model text. The model id comes from an env variable or the settings file and defaults to `opencode/deepseek-v4.1-flash-free`. When no model is set, answer `404` with a plain message. Never log the prompt. Test it with a fake runner.

**A5. Cost board in the room (Claude).** A CSS3D panel floating near the core, fed by `client.costs()`. Per-agent spend and tokens, company budget, quota windows, and "not reported" for a harness that gives no numbers. Click an agent row to fly there. Also a plain HUD version for narrow windows.

**A6. Key form and Paperclip secrets (AGY for the form, OpenCode for the bridge route).** A masked field per agent that sends the value only to a bridge route, which writes it to Paperclip's secrets and never returns or logs it. Needs C2. Check `PAPERCLIP-API.md` for the secrets routes first.

## Roadmap: the next plan

The order and the milestones are in `docs/agents/PLAN.md`. These are the briefs it names that are not written elsewhere in this file.

**C3b. Change notices in the panels (AGY).** `client.subscribe(listener)` is in the contract (`CONTROL-CLIENT.md`, "Change notices") and in the mock. In each panel, subscribe on mount and fetch again for the topics it shows (tasks: `issues`; a thread: `comments` with its issue id; approvals: `approvals`, including the pending count on the tab; meters: `agents` and `costs`; dispatch: `agents`). Unsubscribe on unmount. Keep the Refresh buttons. The mock now sends a notice after each of its own writes, so the drawer should update without a click. Test the pure parts. Second part, so the assistant can open the drawer (A3): `Hud` takes an optional prop `controlTarget`, an object `{ tab, issueIdentifier?, nonce }` where `tab` is `dispatch`, `tasks`, `approvals` or `meters`. When `nonce` changes, the drawer opens on that tab, and if `issueIdentifier` is set and an issue with that identifier is in the list, its thread opens. Do not edit `src/control`, `src/engine` or `src/assistant`.

**C3c. Contract: hire and update an agent (Claude).** Add `hireAgent(draft)` and `updateAgent(id, patch)` to the contract and the mock, from `PAPERCLIP-API.md` (`POST /api/companies/:id/agent-hires` and the agent patch routes). A hire can wait for an approval, so it returns `{ agent, approval }`. Draft fields: name, adapter, model, reasoning effort, turn and time limits, monthly budget, subagents allowed, instructions.

**C3d. Agent builder form (AGY, after C3c).** A form in the control drawer: name, harness, model from `models()` grouped by tier, reasoning effort, limits, monthly budget, subagents allowed, instructions. It says when a hire waits for approval. This is where "hire Hermes on DeepSeek V4.1 Flash" happens once C2 is real.

**T1. Load a brief into the dispatch form (OpenCode for the route, AGY for the panel).** The bridge lists the briefs in `docs/agents/TASKS.md` (the format `**ID. Title (Owner).** text`) at `GET /api/briefs`, read only, local pages only. The dispatch panel gets a "Load a brief" menu that fills the title, description and assignee (the owner named in the brief, matched through the agent list). This replaces pasting briefs by hand. Tests with a sample file.

**U1. Paperclip route list and doctor (OpenCode).** `server/surface.js` lists every Paperclip route the bridge calls, with the fields it reads. `npm run doctor` fetches `/api/openapi.json` from the running Paperclip, compares it with the list, and prints in plain words each route that is missing or changed. Test with a fake whose spec drops a route.

**U2. Health fields and the unreadable counter (OpenCode for the bridge, AGY for the chip).** `/api/health` also returns `paperclipVersion`, `surface` (ok, or the routes that changed) and `unparsed` (chunks from a known adapter that no parser could read). The HUD shows a chip when something is not ok and says which feature is off.

**U3. Candidate beside stable (Claude).** A runbook and a script that start a candidate bridge and viewer from a worktree on other ports (stable 5174, candidate 5175), and the promote steps for the supervisor (W1).

**P5. Recover cut and redacted tool lines (Hermes, after P6).** Every OpenCode Go run loses one to three calls because Paperclip's `***REDACTED***` masking breaks the stored JSON line. Recover the tool name and path from a broken line with a narrow pattern, and count what cannot be recovered (feeds U2). Tests from the scenario fixtures. Also map the Hermes `grep` to the `search` kind.

**P6. Message text is not a file touch (Hermes).** `git commit -m "..."`, `curl -d '...'` and similar must not touch files that are named only inside the message. A quoted path that is an argument (`cat "src/math.js"`) still counts. The change goes in `touchesForCommand` in `src/model/commands.js`: before the command is split into segments, blank out the value of the message flags (`-m`, `--message`, `-d`, `--data`, `--data-raw`, `--data-binary`, with a space or `=` before the value) when the value is a double or single quoted string, and when the quote is never closed (the stored command labels are cut with a `~`) blank to the end of the text. Blanking first also stops a `;` or `&&` inside a message from splitting the command. Three tests currently pin the wrong behaviour and must change to the right one: `tests/commands.test.js` (the `git commit -m "rename docs/notes.md to docs/readme.md"` case) and the two rename commit lines in `tests/scenarios.test.js`. Add tests for each flag, for a cut message, for a message holding `;`, and for `cat "src/math.js"` still counting. Files: `src/model/commands.js`, `tests/commands.test.js`, `tests/scenarios.test.js`, nothing else.

**H1. Hermes on DeepSeek V4.1 Flash (the owner).** Set the model in Hermes, using an id that Hermes itself lists. See `PLAN.md`.

**G1 to G6. Publish to GitHub.** History audit (Claude), licence and names (the owner), README (Claude, Hermes drafts), fresh screenshots (AGY), CI (Hermes), private repository then public (the owner). Details in `PLAN.md`.

## Roadmap: the decision model

Design and the model comparison are in `docs/agents/CONTROL-PLANE.md` under "The decision model".

**D1. Probe set, seam and comparison run (Claude, built as 0.1.27, waiting for the owner to run it).** How to run it and read it: `docs/agents/DECIDER-EVAL.md`. Built: `src/decider/` holds the request builder, the answer parser and `decide(question set, state)` with an injected `fetch`, a timeout and a fallback to the rules. `scripts/decide-eval.mjs` runs every listed model id on the probe sets and prints, per model and per question: accuracy, coverage at 5 percent accepted-case error, calibration error, median latency, cost and the share of answers that change on a repeat. Baselines in the same table: our rules (`interpret`) and a small language model with structured output. Probe sets in `tests/probes/`: the assistant phrases from `tests/assistant.test.js`, and about 40 coding tasks with tier, splits and consequence labels that the owner reviews. Tests use a fake Decisions server. Running it needs `OPENROUTER_API_KEY` in the environment of whoever runs it (cents of spend). The key is never written to a file or printed.

**D2. Decide route in the bridge (OpenCode).** `POST /api/decide`, local pages only. Body `{ state, questions, model? }`, limit 32 KB. The bridge adds the key from `OPENROUTER_API_KEY`, calls the Decisions API with a 3 second timeout and one retry, and returns the answers and `usage`. With no key, answer 404 in plain words. Log only the model id, the question names and the probabilities. Test with a fake server. Do not hard code a model: `DECISION_MODEL` in the environment, default `typesafe/jev-1.14`.

**D3. Assistant fallback through the decider (Claude).** After D1 shows it matches the rules on the assistant probe set: choice over action types, agent keys and up to 20 candidate paths, through D2. It replaces the text model for A4, which stays as the second choice.

**D4. Routing policy uses the answers (Claude).** C4 takes `tier`, `harness`, `coordination`, `uncertainty`, `consequence`, `splits` and `effort`, applies the floors and the three bands from the design, and returns the dispatch settings (model, effort, limits, subagents allowed, approval needed). Unit tests with canned answers. No network in the tests.

**D5. Queue proposals (Claude, AGY).** `shape` turns a typed request into a routine proposal card in the assistant and the drawer. Needs the routines routes in `PAPERCLIP-API.md` (check them first), C2 and D2.

## Roadmap: Hermes lane

Hermes runs on DeepSeek V4.1 Flash (H1, set by the owner), works in its own worktree `C:\GitHub\MachineRoom-hermes`, and takes cheap tasks with named files and clear tests. One task at a time, one branch per task, never on `main`, never pushed. The prompt for each task says: the branch, the files it may touch, the test command, the commit prefix, and the report to give. Known limits to plan around: it may not see a long brief at once, so briefs stay short; its reads show only file names; and it tends to bundle commands, so the prompt asks for `npm test` after every change and a stop on a red test.

Order: **P6** (parser, small), **G5** (CI file), **P5** (parser, harder), **G3** (README draft, text only). Each is described elsewhere in this file or in `PLAN.md`. Claude reviews and merges each branch. Hermes does not touch `server/**` (OpenCode), `src/ui/**` (AGY) or `src/engine/**`, `src/Stage.jsx`, `src/App.jsx`, `src/control/**`, `src/assistant/**`, `src/decider/**` (Claude).
