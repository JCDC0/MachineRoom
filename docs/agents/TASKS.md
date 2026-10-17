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

## Open work

**B5. More recordings (OpenCode).** The Paperclip sandbox and the recorder are described in `docs/agents/RECORDING.md`. Record runs for: a failing test that the agent then fixes, an edit across three files, a file rename or delete, and a tool error. Add them under `public/fixtures/` through `npm run fixtures`, add parser tests that use them, and list any adapter behaviour the parsers get wrong. Do not edit parsers beyond what the new tests need.

**B6. Late join replay (OpenCode).** A viewer that opens during a run sees only frames that arrive after it connects. Let `/events` send the kept history to a client that connects without `Last-Event-ID`, behind a `?history=1` query so the viewer can ask for it. Test it in `tests/bridge.test.js`. The pipeline already drops frames it has seen.

**F7. Narrow windows (AGY).** At 1024 by 768 the left terminal sits under the title and legend. Move the legend into the right rail or fold it into the title block so the wall stays clear down to 1024 pixels wide. Do not touch `src/engine`.

**E1. Real Paperclip run (Claude).** Run the bridge against a live Paperclip with real agents, not the fake, and compare the room with the terminals.

**E2. Paperclip plugin page (Claude).** Check whether the viewer can ship as a page inside Paperclip instead of a separate app.

## Roadmap: subagents and a public release

The goal is a public application that turns Paperclip into an overview room where you watch agents, and the subagents they start through their own harnesses, move between folders and touch files. The recordings so far hold no real subagent events, so the data comes first.

**S1. Record subagent runs (OpenCode, extends B5).** One scenario per harness, tiny tasks, cheapest model that works: Claude Code starting a subagent with its Task tool, OpenCode starting one with its `task` tool, Hermes using `delegate_task`. Also record Paperclip's own delegation: the Orchestrator agent creating an issue for another agent (the `activity.logged` frame with `issue.created` carries the creator, the assignee and `parentId`). Report which signal in the raw log identifies the parent, the child and the child's tool calls.

**S2. Subagent schema and room (Claude).** Add `agent.spawn` (parent, child, label) to the activity schema, let the state and the room add agents while they run, draw the spawn as a new shape splitting off its parent along a string, and give each child a terminal on the wall.

**S3. Subagent parsers (OpenCode).** Detect the spawn in each harness and attribute the nested tool calls to the child. Needs S1 and S2's schema.

**P1. One command install (OpenCode).** `npx machine-room`: one process that serves the built viewer and the bridge on one port, with flags and env for the Paperclip URL, company and project folder, and no Vite or proxy needed. Add a `bin` entry and a test that packs the package and starts it.

**P2. First run and polish (AGY).** A connect screen (Paperclip URL, company picker, demo link), clear empty and error states, remembered settings, a name, logo and favicon, and screenshots for the README.

**P3. Scale (Claude).** Collapse and level of detail for projects with thousands of folders, layout in a worker, reduced motion for the 3D scene.

**P4. Release decisions (the owner).** Licence, repository name and the trademark check on the names Paperclip and POI (use neither logo nor name of the show), whether `sprites.js` (copied from the graded portfolio) may be published or should be rewritten, CI (test and build), and a short security note (the bridge binds 127.0.0.1 and allows only local pages).

## Roadmap: planner, orchestrator and budgets

Design and rules are in `docs/agents/CONTROL-PLANE.md`. Paperclip already has hiring, budgets, approvals, planning and worktrees, so these tasks use its APIs and do not rebuild them.

**C0. Run the dev agents inside Paperclip (Claude, with the owner).** Needs the owner's yes to switch on the instance flag `enableIsolatedWorkspaces`, and a git project workspace for the repo. Register OpenCode, AGY and Claude Code as Paperclip agents with isolated worktree workspaces, so tasks arrive as issues and reports come back as run results and comments. agy needs a launcher that reads its issue through the API, because its arguments hold a fixed prompt today. Try one tiny issue per agent. The owner picks the models first, because each run spends credit. Stage 1 is done: one issue to OpenCode Go with the free model `opencode/deepseek-v4.1-flash-free` fixed a typo in a throwaway repo and reported back through the API (see `PAPERCLIP-API.md`). Stage 2, worktrees, waits for the owner's yes on the flag.

**C1. Paperclip API audit (Claude, done).** Written up in `docs/agents/PAPERCLIP-API.md`. Open from it: the answers to a hire and an issue create, and a full plan flow, all need a throwaway write and the owner's OK.

**C2. Control client (OpenCode).** Bridge routes that pass hire, budget, dispatch (an issue with `assigneeAdapterOverrides`) and approval calls to Paperclip, local pages only, with tests against the fake Paperclip. Shapes are in `PAPERCLIP-API.md`.

**C3. Control surface (AGY).** In the HUD: an agent builder form, a dispatch panel (task, assignee, size, budget, subagents allowed), budget meters on the agent list and an approvals queue. Needs C2.

**C4. Routing policy, version 1 (Claude).** A pure module `src/policy/` with tests: task profile to tier, escalation, spend limits, and the policy file schema.

**C5. Planner and orchestrator agents (Claude).** Instruction bundles for both, hired through C2, first run on a tiny goal with the cheapest models and approvals on.

**C6. Outcome log and decision layer (Claude, OpenCode).** Log every run, build the success and cost tables, propose policy changes as diffs. Start logging as soon as C4 exists.
