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

## Taking the copy and paste out of the loop

Today OpenCode and AGY are driven by hand in their own windows, and their reports are pasted back. The fix is to run them as Paperclip agents in isolated worktrees:

- A task becomes an issue, and Claude (or the orchestrator) creates it through the API.
- Each agent works in its own git worktree workspace. This needs the instance flag `enableIsolatedWorkspaces` (off today) and a git project workspace, and each issue sets `executionWorkspacePreference: isolated_workspace` with `workspaceStrategy.type: git_worktree`.
- The report is the run result and the issue comments, which Claude reads through the API.
- OpenCode already fits (`opencode_local`, reports tokens).
- agy does not fit yet: its Paperclip agent uses the `process` adapter with the prompt fixed in its arguments. It needs a launcher that reads its issue through the Paperclip API.
- Argon and Gemini usage inside agy may not be visible to Paperclip's budgets. Check before trusting its budget meter.
- Headless runs replace the interactive windows, so decide per task which one you want.

## Order of work

1. C0 and C1 first. They cost no credit and remove the hand-off pain.
2. S1 to S3 (subagents) and P1 to P2 (install and polish) run alongside.
3. C2 and C3 (control client and surface).
4. C4 and C5 (policy, planner and orchestrator), tried first on tiny goals with the cheapest models.
5. C6 (outcome log, then the decision model). Start the log as soon as C4 exists.
