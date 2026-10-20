# Control client contract

The panels that start and steer work (dispatch, task thread, approvals, meters) talk to one object, the control client. Today a mock implements it (`src/control/mock.js`). Later the real one calls the bridge, which calls Paperclip (task C2). Panels must use only this object. They never call `fetch` themselves.

Every method is `async`, returns plain data, and rejects with an `Error` whose `message` is plain words fit to show the user.

## Methods

| Method | Returns |
| --- | --- |
| `agents()` | `Agent[]` |
| `issues({ status? })` | `Issue[]`, newest first |
| `createIssue(draft)` | `Issue` |
| `comments(issueId)` | `Comment[]`, oldest first |
| `postComment(issueId, body)` | `Comment` |
| `approvals()` | `Approval[]`, newest first |
| `decideApproval(id, decision, note?)` | `Approval` |
| `costs()` | `Costs` |
| `setAgentBudget(agentId, budgetMonthlyCents)` | `Agent` |
| `hireAgent(draft)` | `{ agent, approval }`. `approval` is `null` when no approval is needed (task C3c; the mock has it, the real client waits for C2b) |
| `updateAgent(agentId, patch)` | `Agent` (C3c, same note) |
| `models()` | `ModelOption[]` |
| `subscribe(listener)` | an `unsubscribe` function (not async) |
| `briefs()` | `Brief[]`, in file order (added with task T1a; the mock serves samples) |
| `briefPrompt(ids, lane)` | `BriefPrompt`, the full prompt for one or more briefs and one lane (T1a) |
| `runs()` | `{ running, recent }`, the runs this bridge started that have not ended (`RunInfo`) and the last 20 run records, newest first (T5) |
| `runStats({ since? })` | `RunStats`, runs, minutes and cost per lane and model over every run record, or from `since` (a `YYYY-MM-DD` day, UTC) on; a bad day is refused with `--since needs a date like 2026-10-19.` (T13b; the mock sums its own finished fake runs) |
| `outcomes()` | `OutcomeRow[]`, one row per lane and model with its merged, rejected and pending runs, merge rate, average review fixes and cost per merge from the decided runs (C6a, C6b; the newest outcome for a branch wins, and the mock serves rows built from sample runs) |
| `startRun(lane, briefs)` | `RunInfo`, the new running entry; a `runs` change notice goes out when the run starts and when it ends (T5; the mock runs a fake run that ends after `runMs` and adds a record) |
| `reviews()` | `Review[]`, one entry per lane with a worktree (W3a; the mock serves samples) |
| `reviewDiff(lane)` | `ReviewDiff`, what that lane did on its branch compared with `main` (W3a) |
| `mergeReview(lane, { head, message })` | `MergeResult`, the new merge commit on `main`. It sends `confirmed: true`, so call it only after the user confirmed; `head` is the sha from `reviews()` (W3b; the mock merges a sample lane once) |
| `decide({ state, questions, model? })` | `{ ok: true, model, answers, usage, ms, attempts }` from the decision model (D2; see `DECIDER-EVAL.md`). It rejects with `No key is set for the decision model.` when the bridge has no `OPENROUTER_API_KEY`, which is also what the mock always does |
| `backupStatus()` | `BackupStatus`, the age of Paperclip's newest database backup (W2b) |
| `backupNow()` | `BackupResult`. It asks Paperclip for a backup at once, so call it only after the user confirmed; it rejects with `A backup is already running.` while one runs (W2b) |

## Shapes

```
Agent        { id, key, name, adapterType, role, status, model: string|null, budgetMonthlyCents, spentMonthlyCents,
               reasoningEffort: low|medium|high|null, maxTurnsPerRun: number|null, timeoutSec: number|null,
               subagentsAllowed: boolean, subagentDepth: 0..3, instructions: string, reportsToAgentId: string|null }
             status: idle | running | paused | error | pending_approval | terminated
             A waiting or terminated agent cannot take a task (`createIssue` refuses it).
             role: one of the Paperclip roles; adapterType: one of the Paperclip adapter types (lists in src/control/agents.js)
AgentDraft   { name, adapterType, role? (engineer), model?, reasoningEffort?, maxTurnsPerRun? (1..200), timeoutSec? (10..7200),
               budgetMonthlyCents? (0), subagentsAllowed? (false), subagentDepth? (1..3, default 1 when allowed), instructions? (max 20000), reportsToAgentId? }
AgentPatch   { any AgentDraft field except adapterType, plus status?: active | paused }   at least one field; an unknown field is refused
Issue        { id, identifier ("JC-18"), title, description, status, priority, assigneeAgentId: string|null, parentId: string|null,
               overrides: { model?, maxTurnsPerRun?, timeoutSec?, subagentsAllowed? } | null, createdAt, updatedAt }
             status: backlog | todo | in_progress | in_review | done | blocked | cancelled
             priority: critical | high | medium | low
IssueDraft   { title, description?, assigneeAgentId, priority?, model?, maxTurnsPerRun?, timeoutSec?, subagentsAllowed? }
Comment      { id, issueId, authorAgentId: string|null, authorName, body, createdAt }
Approval     { id, type, status, summary, requestedByAgentId: string|null, agentId?: string|null, createdAt, decisionNote? }
             agentId names the agent a hire_agent approval is about.
             type: hire_agent | approve_ceo_strategy | budget_override_required | request_board_approval
             status: pending | approved | rejected | revision_requested
decision     approve | reject | request-revision
Costs        { summary: { spendCents, budgetCents, utilizationPercent },
               byAgent: [{ agentId, agentName, costCents, inputTokens, outputTokens }],
               quota: [{ provider, ok, error?, windows: [{ label, usedPercent: number|null, resetsAt: string|null, detail: string|null }] }] }
ModelOption  { id, label, harness, tier: small | medium | large, free: boolean }
Brief        { id ("C3e"), title, ownerText, owners: (hermes | opencode | agy | claude)[], done: boolean, section, text }
BriefPrompt  { prompt, lane, model, branch }
RunInfo      { lane, briefs: string[], startedAt, lastLines: string[] (the last 5 lines the run printed) }
RunRecord    { lane, briefs, model: string|null, reasoning: string|null, startedAt, minutes: number|null, exitCode: number|null,
               killed: boolean, costUsd: number|null, log: string|null, branch, commits: string[] }   (one line of runs.jsonl)
Review       { lane, worktree, branch, head: string (full sha of the worktree HEAD), ahead: number (commits on top of main),
               commits: string[] (at most 50), dirty: boolean, files: number, added: number, deleted: number,
               lastRun: RunRecord | null }
             A worktree that is missing or is not a git repository gives { lane, worktree, error } instead.
ReviewDiff   { lane, branch, files: [{ path, added, deleted }], patch, truncated: boolean }
             patch is the diff of the lane branch against main, cut at 400 KB (truncated is true when it was cut).
MergeResult  { ok: true, lane, branch, head, commit }
             commit is the new sha of main. A merge that stops on a conflict rejects with
             The merge stopped on a conflict. Nothing changed.
RunStats     { rows: RunStatsRow[] (sorted by lane, then model), total: RunStatsRow (lane and model are "all") }
RunStatsRow  { lane, model ("model unknown" when a record has none), runs, finished, killed, failed, minutesTotal, minutesMedian, costTotal (USD), costRuns }
OutcomeRow   { lane, model ("model unknown" when a record has none), runs, merged, rejected, pending, mergeRate: number|null,
               averageFixes: number|null, costUsd (USD), decidedCostUsd (USD), costPerMerge: number|null }
             pending counts runs whose branch has no outcome, including runs with no branch. mergeRate is merged over
             merged plus rejected; averageFixes is over the merged runs; decidedCostUsd is the cost of the merged and
             rejected runs only, and costPerMerge is decidedCostUsd over merged. A rate is null when there is nothing
             to divide by.
BackupStatus { enabled: boolean, status: ok | warning | null, latestAt: string|null, ageHours: number|null, warnings: string[], checkedAt }
             warnings are Paperclip's codes: database_backup_missing | database_backup_stale | database_backup_last_failure | database_backup_check_failed.
             enabled is false and the rest null when Paperclip has automatic backups off.
BackupResult { ok: true, name (the file name, never its folder), sizeBytes: number|null, prunedCount: number|null, finishedAt: string|null }
ChangeEvent  { topic: agents | issues | comments | approvals | costs | runs, id?: string }   (id is the issue id for comments)
```

Times are ISO strings. Money is whole cents. A budget of `0` means no budget is set. A quota window with `usedPercent: null` has no number (show its `detail`). A quota provider with `ok: false` could not be read (show `error`).

## Hiring and updating an agent (C3c)

`src/control/agents.js` holds the lists, the number limits (`LIMITS`, `TEXT_LIMITS`) and the checks (`cleanAgentDraft`, `cleanAgentPatch`, `hireSummary`, and `fieldProblem(key, value)`, which gives the plain sentence for one bad field or `null`). The mock uses them, and the bridge should use the same ones, so a bad request is refused the same way in both.

- `hireAgent` refuses a draft without a name or a harness, a value outside its range, an unknown setting, a name that is taken, and a `reportsToAgentId` that does not exist. Every refusal is a plain sentence.
- When approval is required (the Paperclip company flag `requireBoardApprovalForNewAgents`; the mock defaults to on, `createMockClient({ requireApproval: false })` turns it off) the new agent has status `pending_approval` and `approval` is a pending `hire_agent` approval with `agentId` set. Approving it makes the agent `idle`. Rejecting it makes the agent `terminated`. Asking for a revision leaves it waiting. When approval is not required the agent is `idle` and `approval` is `null`.
- `updateAgent` changes only the fields given. It refuses a waiting or a terminated agent, an empty patch, a change of harness, a depth while subagents are off, an agent that reports to itself, and a name that another agent's key already uses. Turning subagents off sets the depth to 0, and turning them on sets it to 1 unless a depth is given. `status: 'active'` resumes a paused agent (the agent is `idle` until it runs).
- A budget in a patch changes the same number as `setAgentBudget` and sends a `costs` notice as well as an `agents` notice.
- Notices: a hire sends `approvals` (when one is made) and `agents`. An update sends `agents`.
- The real client (merged as 0.1.45) differs from the mock in one place: it reports `instructions` as an empty string and refuses an instructions change with "The instructions cannot be changed here yet.", because Paperclip keeps instructions in a separate bundle. `status: 'paused'` and `status: 'active'` go through Paperclip's pause and resume routes.
- The real client (task C2b) maps these onto `POST /api/companies/:id/agent-hires` and `PATCH /api/agents/:id`. Model, turn limit and time limit go in `adapterConfig`. Where Paperclip has no field for reasoning effort or subagents, the bridge says so in plain words instead of pretending.

## Change notices

`subscribe(listener)` tells a panel that data it may hold is out of date, so it can fetch again without a Refresh button. The listener gets a change event and no data. A panel fetches again only for the topics it shows. The real client sends one when the bridge reports a Paperclip event that touches that topic (a run changes status, an issue or comment is added, an approval is decided, a cost is booked) and when a run it started begins or ends (`runs`), and may send a topic more than once. The mock sends one after each of its own writes, and `client.emit({ topic })` sends one by hand for tests.

## Notes for panel authors

- Show a loading state, an empty state and an error state for every call.
- A call can fail. The mock can be told to: `client.failNext('createIssue', 'message')` makes the next call of that method reject once.
- Disable the submit button while a call is running and do not send twice.
- The mock waits 120 ms per call and keeps its data in memory. A reload resets it.

## How it maps to Paperclip (task C2, for the real client)

| Method | Paperclip |
| --- | --- |
| `agents` | `GET /api/companies/:id/agents`, plus `costs/by-agent` for spend |
| `issues`, `createIssue` | `GET` and `POST /api/companies/:id/issues`; `model`, `maxTurnsPerRun` and `timeoutSec` go in `assigneeAdapterOverrides.adapterConfig` |
| `comments`, `postComment` | `GET` and `POST /api/issues/:id/comments` |
| `approvals`, `decideApproval` | `GET /api/companies/:id/approvals`, `POST /api/approvals/:id/approve`, `reject`, `request-revision` |
| `costs` | `costs/summary`, `costs/by-agent`, `costs/quota-windows` |
| `setAgentBudget` | `PATCH /api/agents/:id/budgets` |
| `models` | our own list (the routing policy), not Paperclip |
| `backupStatus`, `backupNow` | the bridge's `GET` and `POST /api/backup`, which read `databaseBackup` from `GET /api/health` and call `POST /api/instance/database-backups` (see `BACKUPS.md`) |

Details of each call are in `docs/agents/PAPERCLIP-API.md`.
