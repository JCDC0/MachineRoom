# Control plane plan

Status: plan only. Nothing here is built. It sets the order of work and the rules, so each agent can take a piece.

## Principle

Paperclip already runs the company: hiring, budgets, approvals, planning, workspaces, routines and reviews. MachineRoom does not rebuild any of that. MachineRoom adds three things on top:

1. See. The room, with subagents (exists, subagents open).
2. Steer. A control surface in the room that calls Paperclip's own APIs.
3. Decide. A policy and a decision layer that picks harness, model, effort and budget for each piece of work.

## What Paperclip already has

Checked in its README, its routes and its OpenAPI file (2026.1012.0). Request and answer shapes are in `docs/agents/PAPERCLIP-API.md` (task C1, done).

| Need | Paperclip feature | Route or note |
| --- | --- | --- |
| Create an agent with a harness, model and instructions | Agent hires, with board approval | `POST /api/companies/:id/agent-hires`, `/api/approvals/:id/approve` |
| Budgets, warnings, hard stops | Company, agent and project budgets | `/api/companies/:id/budgets`, `/api/agents/:id/budgets`, `budget-incidents/:id/resolve` |
| Cost by agent, issue, model | Cost tracking | `/api/issues/:id/cost-summary` |
| Delegation | Org chart, reporting lines, issues with `parentId` and blockers | an agent creates sub-issues |
| Planning | Deep planning: planning mode, revisioned plans, plan approvals | on its roadmap as done |
| One workspace per piece of work | Isolated execution workspaces (git worktrees) | `/api/projects/:id/workspaces` |
| Quality gates | Review cases, execution policies | `/api/companies/:id/review-cases` |
| Recurring work | Routines | `/api/companies/:id/routines` |
| Many models and harnesses | Multi-model, multi-harness teams | adapter and model per agent |

Paperclip lists these as not built: Self-Organization, Automatic Organizational Learning, Work Queues. The decision layer below sits in that gap.

## Roles

- Planner (large model, high reasoning). Takes a goal and writes a revisioned plan: sub-tasks, dependencies, a size label (small, medium or large) and the files each one will touch. Uses Paperclip's planning mode.
- Orchestrator (medium model). Reads the approved plan, applies the routing policy, creates the issues and assigns them. Hires a worker through an agent-hire request when the roster lacks the tier it needs. Sets the budget of each issue, says whether subagents are allowed, watches runs and sends a failed task up one tier.
- Workers, in tiers: small (cheap flash models), medium, large. A tier is not a separate agent. The orchestrator picks it per issue with `assigneeAdapterOverrides.adapterConfig` (model, turn limit, time limit) on the issue it creates, so one agent per harness is enough.
- Reviewer (optional, large model). Checks the diff before a task closes.

## Agent builder

Every agent is described by one record, and a preset is a saved record:

- harness (Claude Code, Hermes, OpenCode, agy, or another adapter) and model
- reasoning effort, turn limit and time limit (Paperclip already has `maxTurnsPerRun` and `timeoutSec`)
- monthly budget, and a per-issue budget
- may start subagents: yes or no, and the deepest allowed level (default 1)
- instructions bundle and skills
- reports to (the orchestrator, by default)

The room shows the builder as a form. Submitting it creates an agent-hire request. With `requireBoardApprovalForNewAgents` on (it is off today), the owner approves every hire an orchestrator makes. Turn it on before an orchestrator is allowed to hire. The builder is needed for a new harness or role. Choosing a model or limit for one task is an issue override, not a hire.

## Routing policy, version 1: rules

A policy file maps a task profile to a tier. The profile comes from the planner's labels: number of files, whether tests exist, how clear the task is, whether it is reversible, whether it touches secrets or deployment.

- Small: mechanical edit in two files or fewer with a test that already exists.
- Medium: several files, or a change that needs a new test.
- Large: design, an unclear bug, or anything that touches secrets, deployment or data.
- Escalate one tier after a failed test, a failed review or one failed attempt. Never skip a tier twice.
- Spend limits at four levels: run, issue, agent and company. Paperclip budgets only count billed cents, so they never stop a subscription run (Claude Code, probably agy). For those, limits are turns (`maxTurnsPerRun`), time (`timeoutSec`) and token meters we compute from the cost routes. Going over needs the owner's approval.
- The policy is a file in the repo. A change to it is a reviewed diff, never a silent edit.

## Decision layer, version 2: learn from outcomes

Version 1 only works if outcomes are logged from day one.

1. Outcome log. One record per run: harness, model, effort, task profile, result (tests pass, review accepted), tokens, cost, time, retries, tier escalations. Source: Paperclip run, cost and review data, joined by issue.
2. Analysis. A table of success rate and cost per profile, harness and model. Start with plain statistics.
3. Proposals. The decision layer suggests policy changes ("medium tasks with an existing test succeed 90 percent on small, so route them small") as a diff for the owner to approve.
4. Later, a small model labels the task profile, and a simple bandit tries one tier lower on a small share of runs (5 percent) so the table keeps learning.
5. Guards. No change takes effect without approval. No exploration run may exceed the small tier's budget.

This needs real data. Expect it to be useful after about 100 logged runs, not before.

## Subagents

- Each agent and each issue carries `subagents: allowed or not`, and a depth limit. The issue field `requestDepth` may carry the depth (to confirm).
- A child spends from its parent's issue budget.
- The room shows the child as a new shape that splits off its parent along a string, with its own terminal.
- Harness signals are unknown until S1 records them (see TASKS.md).

## Product decision: fork or bundle

Recommended, pending the owner's yes: ship MachineRoom as the one window in front of an unmodified Paperclip that it installs, pins and starts for you. Do not fork Paperclip now.

Facts behind it:

- Paperclip is MIT licensed (Copyright 2025 Paperclip AI), so a fork would be allowed.
- Its UI is a separate static folder (`@paperclipai/server/ui-dist`, 18 MB) that the server serves. The server runs the same whether anyone opens that page or not. Stripping the UI saves nothing at run time. It only removes the admin screens that MachineRoom does not build: skills, secrets, connections, company settings, approvals detail.
- Paperclip changes fast (the installed build is 2026.1012.0). A fork has to keep merging upstream to stay useful.
- Server side additions have an official path: Paperclip's plugin system (out-of-process workers, host services, tool exposure, UI contributions).

So: `machine-room up` (task W1) checks for a pinned Paperclip version, starts it and the bridge, and opens MachineRoom. You never open Paperclip's page except through a link for rare admin. Fork only if both hold: the plugin system cannot do something we need (for example enforcing routing inside the server), and keeping up with upstream is cheaper than the gap.

## What agy offers (checked on the installed agy 1.4.0)

- Per run flags: `--model`, `--effort` (low, medium, high, xhigh, max), `--mode` (accept-edits, auto, plan), `--agent`, `--print` with `--output-format stream-json`, `--print-timeout`, `--json-schema`, `--dangerously-skip-permissions`. The Paperclip `process` agent can pass these in its arguments, so the router can pick model and effort per task once agy has a launcher that reads its issue.
- `agy models` lists 13 ids: `gemini-4-argon-{low,medium,high}`, `gemini-3.8-flash-{low,medium,high}`, `claude-opus-5-5-{low,medium,high}`, `claude-sonnet-5-5-{low,medium,high}` and `gpt-oss-120b-medium`. So agy is a multi-model harness, and a Claude model run through agy counts against the Antigravity quota, not Claude's. Paperclip cannot see either.
- Subagents: secondary sources (not Google's own docs) say Antigravity has built-in browser and terminal subagents, that custom agents start with `--agent <name>` and are managed with `/agents`, and that a custom agent can name its own model (it inherits the parent's model if it names none). On this machine `agy agents` lists nothing and no plugin is installed, so no custom agent exists yet. Unverified: the file format of a custom agent, and whether the model field works. Test it before relying on it (task S1 can record an agy run that starts a subagent).

## Using subscriptions and credits well

Paperclip already reads subscription quota. `GET /api/companies/:id/costs/quota-windows` returned, for Anthropic over OAuth: the current session (percent used and reset time), the week for all models, and extra usage (not enabled). OpenAI's quota failed because the `codex` CLI is not installed. `GET /api/companies/:id/costs/window-spend` returns spend per provider for 5 hours, 24 hours and 7 days, but only in cents, so subscription runs show 0. Providers other than Anthropic give no quota percent.

The routing policy should therefore use quota windows where they exist: avoid a provider above a chosen percent of its window, prefer the free or cheap tier for small tasks, and show the quota meters in the HUD (C3). For providers without a quota number, the policy falls back to our own token counts per window.

## Large repositories

Daily use on large repositories needs P3 (collapse and level of detail). Today, layout takes about 1.2 seconds for 1600 folders, and a live tree relays out each time it grows. Treat P3 as required before relying on MachineRoom for a big repository.

## Product shape: working in MachineRoom

The goal is that you do your project work in MachineRoom, with Paperclip as the engine behind it. Paperclip is API first and can run without anyone opening its own web page, but it is not headless: it ships a full UI at its root address. MachineRoom does not replace that UI. It covers the daily loop and links to Paperclip's pages for rare admin work.

| Step of the daily loop | Where it happens | Built? |
| --- | --- | --- |
| See what every agent is doing, up close | MachineRoom room | yes, subagents open |
| Start work: write the task, pick agent, model, effort, budget, subagents allowed | MachineRoom panel, creates a Paperclip issue | no (C2, C3) |
| Talk to an agent or the planner about a task | MachineRoom panel, posts issue comments (`POST /api/issues/:id/comments`) | no (W5) |
| Approve hires, plans, budget overrides | MachineRoom queue, Paperclip approvals | no (C3) |
| Watch spend and limits | MachineRoom meters, Paperclip cost routes | no (C3) |
| Review the result: diff, tests, summary | MachineRoom panel, local git through the bridge | no (W3) |
| Merge | MachineRoom button, local git through the bridge, never a push | no (W3) |
| Rare admin: skills, secrets, connections, company settings | Paperclip's own UI, opened by a link | n/a |
| Writing code by hand, running the app, editing in your editor | outside both | n/a |

What this means in practice:

- Review and merge are ours to build. Paperclip has no branch diff or merge route (only a GitHub review hook and a workspace branch check), so the bridge runs a few local git commands: list the branch of each issue, show the diff, merge with a confirmation, stop on a conflict and hand over to a terminal. It never pushes.
- Text-heavy work (tasks, diffs, comments) needs panels. The 3D room is for awareness and navigation, and a click on an agent or folder opens its panel.
- The planner and orchestrator are Paperclip agents, so "talking to the project" means writing to them through issue comments (agent chat in Paperclip is still behind an experimental flag and off). They replace the copy and paste between harnesses. They do not replace an interactive coding session when you want one: a coding chat like this one stays useful for design and for work that touches many things at once.
- Paperclip becomes the record of your work (tasks, comments, runs, costs). It stores that in a local database and backs it up every 60 minutes of uptime. It is not a Windows service, so short sessions may never trigger a backup, and none exists yet. Check backups before trusting it.
- One Paperclip, one machine, loopback only. Using it from a phone or another PC needs Paperclip's authenticated mode and is out of scope for now.

## Taking the copy and paste out of the loop

Today OpenCode and AGY are driven by hand in their own windows, and their reports are pasted back. The fix is to run them as Paperclip agents in isolated worktrees:

- A task becomes an issue, and Claude (or the orchestrator) creates it through the API.
- Each agent works in its own git worktree workspace. This needs the instance flag `enableIsolatedWorkspaces` (off today) and a git project workspace, and each issue sets `executionWorkspacePreference: isolated_workspace` with `workspaceStrategy.type: git_worktree`.
- The report is the run result and the issue comments, which Claude reads through the API.
- OpenCode already fits (`opencode_local`, reports tokens).
- agy does not fit yet: its Paperclip agent uses the `process` adapter with the prompt fixed in its arguments. It needs a launcher that reads its issue through the Paperclip API.
- Argon and Gemini usage inside agy may not be visible to Paperclip's budgets. Check before trusting its budget meter.
- Headless runs replace the interactive windows, so decide per task which one you want.

## The assistant and the cost board

A small floating terminal that is always with you. You type what you want to see or change ("what is agy doing", "costs", "terminal for hermes", "go to src/engine", "allow hermes to start subagents"), and it takes you there or opens the right panel. It is a router, not a coding agent. It never writes code and never reads file contents.

How it decides, in order:

1. **Rules first.** `src/assistant/intent.js` turns the text into one of 14 actions from a closed list (`src/assistant/actions.js`): focus an agent, its terminal, a folder or file, overview, follow, open a panel (dispatch, tasks, approvals, meters), open an issue, open an agent's settings (general, model, budget, subagents, keys), open the event log, replay controls, help, and three proposals. Rules are free and instant and cover the common requests. No model is called.
2. **Names are resolved against the room.** An agent matches by name, key or the start of a word. A path matches by exact path, file name, folder name or part of a name. Two close matches become a question with buttons, never a guess.
3. **Reads run at once, writes are proposals.** Dispatching a task, setting a budget and allowing subagents show a card that says what will happen, and nothing is sent until you click. A model can never skip this step, because the validator marks those three actions as needing a confirmation.
4. **Keys never pass through the assistant.** If the text looks like a key or a password, the assistant stops, does not repeat it, does not send it anywhere, and opens the masked key form for the agent you named. The key goes from that form to Paperclip's secrets through the bridge (task A6).
5. **A model only for unclear phrasing.** When the rules return `unknown` (with `fallback: true`), the viewer may ask a cheap model. `src/assistant/llm.js` builds a prompt with the agent names and the action shapes, no paths and no file contents, with keys removed. The reply must be one JSON object and goes through the same validator. A path comes back as words and is matched on our side, so the model cannot invent one. If the model is off or fails, the assistant says so and the plain commands keep working.

Which model for step 5. It is a classification of one short sentence into a closed schema, so the smallest and cheapest model is enough, and speed matters more than skill.

| Choice | Notes |
| --- | --- |
| `opencode/deepseek-v4.1-flash-free` through `opencode run` (recommended) | Free. Measured at 2.3 seconds from command to reply against the running OpenCode service. Needs the OpenCode CLI and its background service. |
| `opencode/glm-5.3-flash-free`, `opencode/mimo-v2.6-flash-free`, `opencode/nemotron-3.5-lightning-free` | Other free ids from `opencode models`. Same route. Switch if one is slow or rate limited. |
| `gemini-3.8-flash` at low effort through `agy --print` | Needs no API key, but counts against the agy quota and starts slower. |
| `claude-haiku-5-5` | Paid or subscription. Reliable on JSON, but spends the same budget as the real work. |
| None | The default for a public release until the owner enables a model. Rules only. |

The model is a setting, not code. Do not send navigation through a Paperclip issue: a round trip through a heartbeat run took 24 to 35 seconds and leaves a task and a run behind.

### Cost board

Each harness reports usage differently. The rule is simple: show what is reported and say so when it is not. A harness that hides its usage shows "not reported" and is left out of totals. Nothing is estimated.

The board is a panel floating in the 3D room, drawn like a terminal (CSS3D), near the core. It shows spend and tokens per agent from `GET /api/companies/:id/costs/by-agent`, the company budget from `costs/summary`, and the quota windows from `costs/quota-windows` (percent used and reset time, or the error when a provider cannot be read). Clicking an agent row flies the camera to that agent. The assistant opens it with "costs". It reads through the control client (`costs()`), so it works on the mock today.

## Order of work

1. C0 and C1 first. They cost no credit and remove the hand-off pain.
2. S1 to S3 (subagents) and P1 to P2 (install and polish) run alongside.
3. C2 and C3 (control client and surface).
4. C4 and C5 (policy, planner and orchestrator), tried first on tiny goals with the cheapest models.
5. C6 (outcome log, then the decision model). Start the log as soon as C4 exists.
6. A1 to A6 (assistant and cost board). A1 is done. A2 and A5 can start against the mock.
