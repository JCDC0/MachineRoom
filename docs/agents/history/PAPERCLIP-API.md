This note describes Paperclip, which was removed on 2026-10-24.

# Paperclip API notes

Task C1. Paperclip 2026.1012.0 in `local_trusted` mode (no sign-in), base URL `http://127.0.0.1:3100`.

## How this was checked

- Request shapes come from Paperclip's own OpenAPI file: `GET /api/openapi.json` (OpenAPI 3.0.0, 749 paths, 1.2 MB). Most answer bodies are not typed there ("record"), so answer shapes below come from read-only calls against the live server.
- Server code is in `node_modules/@paperclipai/server/dist/routes` inside the global `paperclipai` install, and the validators are in `@paperclipai/shared`.
- Only GET calls were made. No agent ran, nothing was created. Where an answer needs a write to see it, it says "not observed".
- Values from the owner's data (ids, paths, keys) are left out. Money is in cents. Ids are UUIDs.

## Conventions

- Prefix `/api`. Failed validation answers `400 { error, details: { formErrors, fieldErrors } }`. Unknown route answers `404 { error: "API route not found" }`.
- A company has `budgetMonthlyCents` and `spentMonthlyCents`. `0` means no budget is set.
- Budget windows: `calendar_month_utc` or `lifetime`. The only metric is `billed_cents`.

## Agents

Record (read): `id, companyId, name, role, title, icon, appearance, status, reportsTo, capabilities, adapterType, adapterConfig, runtimeConfig, defaultEnvironmentId, budgetMonthlyCents, spentMonthlyCents, pauseReason, pausedAt, errorReason, permissions, lastHeartbeatAt, metadata, createdAt, updatedAt, urlKey, avatarUrl, orgChainHealth`.

- `status`: `active | paused | idle | running | error | pending_approval | terminated`.
- `role`: `ceo | cto | cmo | cfo | security | engineer | designer | pm | qa | devops | researcher | general`.
- `adapterType`: `process | http | claude_local | codex_local | paperclip_runner | cursor_cloud | gemini_local | grok_local | hermes_gateway | hermes_local | kimi_local | opencode_local | pi_local | cursor | openclaw_gateway`.
- `adapterConfig` (observed for `claude_local`): `cwd, model, graceSec, timeoutSec, maxTurnsPerRun, instructionsFilePath, instructionsRootPath, instructionsEntryFile, instructionsBundleMode, dangerouslySkipPermissions`. Other adapters have their own keys (the `process` adapter has `command` and `args`).
- `runtimeConfig.heartbeat`: `enabled, cooldownSec, intervalSec, wakeOnDemand, maxConcurrentRuns`. `runtimeConfig.aiConnection`: `mode, method, provider` (observed `responsible_user`, `subscription`, `anthropic`).
- `permissions`: `canCreateAgents, canCreateSkills`, plus `trustPreset: standard | low_trust_review` and an `authorizationPolicy` block.

### Hire an agent

`POST /api/companies/:companyId/agent-hires`

```
name: string (required)
role?, title?, icon?, appearance?           look and role
reportsTo?: uuid | null                     who it reports to
capabilities?: string | null
desiredSkills?: skill[]
adapterType?, adapterConfig?: record        harness and its settings (model, timeouts, turns)
instructionsBundle?: { entryFile?, files: record }   the agent's AGENTS.md style files
runtimeConfig?: { heartbeat?, aiConnection?, debug? }
defaultEnvironmentId?: uuid | null
budgetMonthlyCents?: integer
permissions?: { canCreateAgents?, canCreateSkills?, trustPreset?, authorizationPolicy? }
metadata?: record
sourceIssueId?, sourceIssueIds?: uuid[]
inheritRuntimeFrom?: "caller"               agent-authored hires only
```

Update with `PATCH /api/agents/:agentId` (same fields, all optional, plus `status`, `replaceAdapterConfig`). Wake with `POST /api/agents/:id/wakeup` `{ source?: timer|assignment|on_demand|automation, triggerDetail?: manual|ping|callback|system, reason?, payload?, idempotencyKey? }`.

Not observed live: the answer to a hire. The installed server code (read for C2b) answers `201` with `{ agent, approval }`. The company flag `requireBoardApprovalForNewAgents` (now `false`) decides whether a hire waits for approval (`pending_approval` agent plus an approval of type `hire_agent`).

Found in the installed server code while building C2b (2026-10-19):

- Reasoning effort lives in `adapterConfig` under a different key per harness: `claude_local` `effort`, `codex_local` `modelReasoningEffort`, `grok_local` `reasoningEffort`, `kimi_local` `effort`, `opencode_local` `variant`, `pi_local` `thinking`, `paperclip_runner` `modelReasoningEffort`. The others (`hermes_local`, `hermes_gateway`, `gemini_local`, `cursor`, `cursor_cloud`, `openclaw_gateway`, `process`, `http`) have no field; Paperclip's own Hermes form appends `--reasoning-effort` to `extraArgs` instead.
- No harness has a field for subagents or their depth. The bridge keeps `metadata.subagents = { allowed, depth }` and, where there is no effort field, `metadata.reasoningEffort`. Paperclip stores `metadata` but never hands it to an adapter, so these are records for MachineRoom, not limits Paperclip enforces.
- `adapterConfig` in a PATCH is a shallow merge unless `replaceAdapterConfig: true`. A key sent as `null` stays as `null`.
- Instructions are not a plain field: a hire takes `instructionsBundle`, and changing them later needs the instructions bundle routes with a base revision. The bridge refuses an instructions change for now.
- Pause and resume have their own routes, `POST /api/agents/:id/pause` and `POST /api/agents/:id/resume`. Pause also cancels the agent's active runs, and resume checks the reporting chain first. A PATCH accepts `status` too but skips both, so the bridge uses the routes.

## Budgets

- `GET /api/companies/:id/budgets/overview` answers `{ companyId, policies: [], activeIncidents: [], pausedAgentCount, pausedProjectCount, pendingApprovalCount }`. Now: no policies, no incidents.
- `PATCH /api/companies/:id/budgets` and `PATCH /api/agents/:id/budgets`, body `{ budgetMonthlyCents: integer }`.
- `POST /api/companies/:id/budgets/policies`, body `{ scopeType: company|agent|project, scopeId: uuid, metric?: billed_cents, windowKind?: calendar_month_utc|lifetime, amount: integer, warnPercent?: 1..99 (default 80), hardStopEnabled?: boolean (default true), notifyEnabled?, isActive? }`.
- `POST /api/companies/:id/budget-incidents/:incidentId/resolve`, body `{ action: keep_paused | raise_budget_and_resume, amount?: integer (required to raise), decisionNote? }`.
- There is no GET for a single policy. Read them through the overview.

## Costs and usage

- `GET /api/companies/:id/costs/summary` answers `{ companyId, spendCents, budgetCents, utilizationPercent }`. Now: 6 cents spent in total.
- `GET /api/companies/:id/costs/by-agent` answers a list of `{ agentId, agentName, agentStatus, costCents, inputTokens, cachedInputTokens, outputTokens, apiRunCount, subscriptionRunCount, subscriptionInputTokens, subscriptionCachedInputTokens, subscriptionOutputTokens }`.
- `GET /api/companies/:id/costs/by-agent-model` adds `provider, biller, billingType, model` per agent. Observed: Claude Code shows `billingType: subscription_included` with `costCents: 0`.
- `GET /api/issues/:id/cost-summary` answers `{ issueId, issueCount, includeDescendants, costCents, inputTokens, cachedInputTokens, outputTokens, runCount, runtimeMs }`.
- Other cost routes: `costs/by-biller, by-project, by-provider, finance-summary, finance-events, quota-windows, window-spend`. A write route exists for `cost-events`.

Finding: budgets count `billed_cents` only. A run on a subscription (Claude Code, and probably agy) bills 0 cents, so a Paperclip budget never stops it. Tokens and run time are still reported for those runs. Limits for subscription harnesses must use `maxTurnsPerRun`, `timeoutSec` and our own token counts.

## Approvals

- Types: `hire_agent | approve_ceo_strategy | budget_override_required | request_board_approval`.
- `GET /api/companies/:id/approvals` (now an empty list), `POST /api/companies/:id/approvals` `{ type, requestedByAgentId?, payload: record, issueIds? }`.
- `POST /api/approvals/:id/approve | reject | request-revision` with `{ decisionNote? }`, `POST .../resubmit` with `{ payload? }`, `POST .../comments` with `{ body }`. `GET /api/approvals/:id`, `/comments`, `/issues`.
- Issues link to approvals with `POST /api/issues/:id/approvals`.
- Checked against the installed server code (2026.1012.0) while building C2: an approval row has `id, companyId, type, requestedByAgentId, requestedByUserId, status, payload, decisionNote, decidedByUserId, decidedAt, createdAt, updatedAt` and no top-level summary. The text for a person lives in `payload.summary` or `payload.title` (a `budget_override_required` payload carries `scopeName, budgetAmount, observedAmount, guidance`). Deciding an approval that is no longer pending or revision requested answers `422`, and deciding it to the same status twice answers `200` with `applied: false`.
- `GET /api/issues/:id/comments` returns newest first unless `?order=asc` is given. A comment row has `authorAgentId` and `authorUserId` and no author name, so a client must look the name up in the agent list.
- Cost events: `POST /api/companies/:id/cost-events` logs an `activity.logged` frame with `entityType: cost_event` and `action: cost.reported`, and a finished run books its usage on the terminal `heartbeat.run.status`. The bridge sends a `costs` change notice for both.

## Workspaces

- Project workspace: `GET|POST /api/projects/:id/workspaces`. Fields: `name, sourceType (local_path | git_repo | remote_managed | non_git_path), cwd, repoUrl, repoRef, defaultRef, visibility, setupCommand, cleanupCommand, remoteProvider, remoteWorkspaceRef, sharedWorkspaceKey, metadata, runtimeConfig, isPrimary`. The sandbox project is `non_git_path`, primary.
- Execution workspace (one per run context): `GET /api/companies/:id/execution-workspaces`. Fields: `projectWorkspaceId, sourceIssueId, mode, strategyType, name, status, deliveryState, cwd, repoUrl, baseRef, branchName, providerType, openedAt, closedAt, config, metadata.workspaceRealization`. Observed: `mode: shared_workspace`, `strategyType: project_primary`, copy realization. `GET /api/companies/:id/workspace-overview` lists them with `linkedIssues` and `runningServiceCount`.
- Per issue: `executionWorkspacePreference: inherit | shared_workspace | isolated_workspace | operator_branch | reuse_existing | agent_default` and `executionWorkspaceSettings: { mode, sharedWorkspaceConcurrency: auto|serialize|allow, environmentId, workspaceStrategy: { type: project_primary | git_worktree | adapter_managed | cloud_sandbox, baseRef, branchTemplate, existingBranch, worktreeParentDir, provisionCommand, teardownCommand }, networkEgress }`.
- Git worktrees need the instance flag `enableIsolatedWorkspaces`, which is `false` now, and a `git_repo` project workspace.

## Issues, planning and routing

Issue write fields (the create body is not typed in the spec; the update body is): `projectId, projectWorkspaceId, goalId, parentId, blockedByIssueIds, title, description, status (backlog|todo|in_progress|in_review|done|blocked|cancelled), workMode (standard|ask|planning|skill_test), priority (critical|high|medium|low), reviewPolicy (anyone|not_creator|human_only), assigneeAgentId, assigneeUserId, requestDepth, billingCode, assigneeAdapterOverrides, executionPolicy, executionWorkspace*`.

- `assigneeAdapterOverrides: { adapterConfig?: record, useProjectWorkspace?: boolean }` changes the assignee's adapter settings for this one issue. This is how the router can pick a model, turn limit or time limit per task without hiring more agents.
- `requestDepth` is a counter on the issue. Its meaning is not documented, so confirm it records the delegation depth before using it as a subagent depth limit.
- `executionPolicy: { mode: normal|auto, commentRequired, stages: [{ type: review|approval, participants, approvalsNeeded }], maxReviewRounds, monitor }` sets review gates.
- Planning mode: an issue with `workMode: planning` produces a plan document. Documents live at `/api/issues/:id/documents/:key` with `/revisions` and restore. `POST /api/issues/:id/accepted-plan-decompositions` with `{ acceptedPlanRevisionId, children: [...] }` creates the child issues from an accepted plan. `GET` lists them (now empty). Interactions on an issue (`/interactions`, `accept`, `reject`, `respond`) carry plan confirmations. This is switched off by the instance flag `enableIssuePlanDecompositions` (`false` now).
- `GET /api/issues/:id/children` lists sub-issues.
- `GET /api/companies/:id/live-runs` answers the queued and running heartbeat runs, newest first, with `agentName`, `adapterType`, `issueId` (from the run's context), `startedAt`, `lastOutputAt`, `createdAt` and the runtime status (`currentToolName`, `currentStatusMessage`, `lastAssistantSnippet`). `limit` defaults to 50 and cannot go higher; `minCount` defaults to 0 and, when set, pads the list with ended runs; `distinctTasks=true` picks one run per task for Paperclip's dashboard instead. `GET /api/issues/:issueId/live-runs` gives the same rows for one issue, with no limit and no `issueId` field. The bridge reads the company route (W6a, read in the installed 2026.1012.0 on 2026-10-22).

## Paperclip's own decision features

`decisions`, `decision-queues`, `decision-training` (with `export.jsonl`) and `decisions/stats?groupBy=ruleKey`. They look like inbox triage rules with training data, behind `enableDecisions` (`false` now). Not explored. They are separate from our routing decision layer, but the training export is worth reading before building C6.

## Instance flags that matter

Read from `GET /api/instance/settings/experimental`. Changing one changes the owner's Paperclip, so ask first.

| Flag | Now | Needed for |
| --- | --- | --- |
| `enableIsolatedWorkspaces` | false | git worktree per issue (C0) |
| `enableIssuePlanDecompositions` | false | plan to child issues (C5) |
| `enableDecisions` | false | Paperclip's decision features (C6, to read) |
| `enableBuiltInAgents` | false | built-in agent templates (not explored) |
| `enableAiConnectionRouters` | false | possible model routing (not explored) |
| `enablePipelines`, `enableCases` | false | pipelines and review cases (not explored) |

## What this changes in the plan

1. Routing by issue. One agent per harness plus a per-issue `assigneeAdapterOverrides` replaces "hire a worker per tier". The agent builder is only needed for a new harness or role.
2. Worktrees (C0) need the flag `enableIsolatedWorkspaces`, a git project workspace and an issue preference of `isolated_workspace` with `workspaceStrategy.type: git_worktree`. The sandbox project today is a shared, non-git folder.
3. Budgets cannot stop subscription runs. Pair budgets with turn and time limits, and read tokens from the cost routes for our own meters.
4. The subagent depth limit may be able to ride on `requestDepth` (to confirm).
5. Still to observe, with the owner's OK and one throwaway record each: the answer to a hire and a full plan flow with the flag on. The project create and issue create answers were observed in the C0 test below.

## Observed in the C0 test (2026-10-17)

One throwaway project and one tiny issue, dispatched to the OpenCode Go agent with a model override. Nothing in the owner's other projects was touched.

- `POST /api/companies/:id/projects` with `{ name, description, workspace: { name, sourceType: "git_repo", cwd, isPrimary: true } }` answered 201 with the project: `id, name, status, goals, executionWorkspacePolicy, codebase { workspaceId, localFolder, effectiveLocalFolder, origin }, workspaces[], primaryWorkspace`.
- `POST /api/companies/:id/issues` with `{ title, description, assigneeAgentId, projectId, projectWorkspaceId, priority, status: "todo", assigneeAdapterOverrides }` answered 201 with the full issue (`id`, `identifier` such as `JC-18`, `status`, `assigneeAdapterOverrides` stored as sent).
- Assigning the issue woke the agent at once (agent heartbeat is off, `wakeOnDemand` is on). The issue went `todo`, `in_progress`, `done` in 24 seconds.
- The override worked: `assigneeAdapterOverrides.adapterConfig.model = "opencode/deepseek-v4.1-flash-free"`. The run's `usageJson` shows that model, `costUsd: 0`, 20 039 input tokens, 2 062 output tokens, 35 seconds. Model ids differ by plan: the free models are under `opencode/` (Zen), while `opencode-go/deepseek-v4.1-flash` is the paid one that failed earlier.
- The agent edited the repo and committed in the project folder (shared workspace, so on the repo's own branch, with the owner's git identity).
- The report comes back in three places: `resultJson.summary` on the run (`GET /api/heartbeat-runs/:id`), the issue comments (`GET /api/issues/:id/comments`, here two near-identical agent comments), and `GET /api/issues/:id/cost-summary`.
- A run record is not linked to its issue by a top-level `issueId`. Use `contextSnapshot.issueId` (also `projectId`, `paperclipWorkspace`, `executionWorkspaceId`).
- Run record fields with data: `usageJson` (`model, biller, provider, costUsd, costStatus, billingType, inputTokens, outputTokens, ...`), `resultJson` (`summary, stdout, stderr, stopReason, timeoutFired, effectiveTimeoutSec, ...`), `contextSnapshot`.
