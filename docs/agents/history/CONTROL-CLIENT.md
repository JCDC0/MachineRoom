# Control client: Storage and archive preview

Task P217 adds three storage methods to `src/control/client.js`, `src/control/mock.js`, `CLIENT_METHODS` and `tests/control-contract.test.js`:

| Method | Bridge route | Returns |
| --- | --- | --- |
| `storage()` | `GET /api/storage` | `{ runsFolder, projectRoot, kinds, totalBytes, worktrees }` |
| `previewStorageArchive({ days })` | `POST /api/storage/preview` | `{ days, cutoff, count, totalBytes, files }` |
| `archiveStorage({ days, confirmed = false })` | `POST /api/storage/archive` | `{ ok, days, count, totalBytes, moved }` |

`days` defaults to `30` and must be an integer from `1` to `365` (`Choose 1 to 365 days.`). `archiveStorage` sends `confirmed: false` unless passed `confirmed: true`, and refuses unconfirmed writes with `Confirm the archive before moving files.`. Archiving moves the previewed logs and unreferenced recordings into `<runs>/archive/<YYYY-MM>/`, updates counts on subsequent reads and moves nothing on a repeat call with the same `days`.

# Control client: MCP servers and tools

This note documents the MCP server and tool methods of the control client, task U63. The older methods of the contract are below. The real client (`src/control/client.js`) calls the bridge routes in `server/index.js`, and the mock (`src/control/mock.js`) keeps the same data in memory. Panels use only this object and never call `fetch`.

The five methods are also in `CLIENT_METHODS` in `src/control/mock.js`, so the shared suite (`tests/control-contract.test.js`) fails when either client leaves one out.

## Methods

| Method | Bridge route | Returns |
| --- | --- | --- |
| `mcpServers()` | `GET /api/mcp/servers` | `{ ok, servers }`, the saved server entries |
| `saveMcpServer({ name, transport = 'stdio', command = '', args = [], env = {}, url = '', enabled = true, confirmed = false, create = false })` | `POST /api/mcp/servers` | `{ ok, server, servers }` on the mock, the saved entry and the whole list |
| `deleteMcpServer({ name, confirmed = false })` | `POST /api/mcp/servers/NAME/delete` | `{ ok, deleted, servers }` on the mock |
| `mcpTools()` | `GET /api/mcp/tools` | `{ ok, tools, errors }`, the tools of every enabled server |
| `callMcpTool({ server, tool, arguments: toolArgs = {} })` | `POST /api/mcp/call` | `{ ok, result, problem }` |

A save or a delete sends `confirmed: false` unless the caller passes `confirmed: true`, so call either only after the owner confirmed. The bridge refuses an unconfirmed write, and the mock refuses it with `Confirm saving the MCP server first.` or `Confirm deleting the MCP server first.`

A name is 1 to 40 letters, digits, dashes or underscores, and the request path encodes it. A `stdio` server needs a non-empty `command`; an `http` server needs an `http` or `https` `url`. The mock refuses a bad entry with one sentence: `The server name must be 1 to 40 letters, digits, dashes or underscores.`, `Choose stdio or http.`, `A stdio server needs a command.` or `An http server needs an http or https address.` When `create: true` is passed, the real client sends `create: true` and both the bridge (409) and the mock refuse an existing name with `The MCP server NAME is already saved.` and leave the saved server unchanged. Without `create`, a save with an existing name replaces that entry, and fields left out keep their saved values, so a switch can send only `{ name, enabled, confirmed: true }`.

A server change sends `{ topic: 'mcp' }` to a listener from `subscribe`, so a panel reads `mcpServers()` again. A failed tool call answers `ok: false` with a `problem` sentence instead of rejecting. The mock answers `The MCP server NAME is not saved.`, `The MCP server NAME is off.` or `The server NAME has no tool TOOL.`; a call with no server or tool name rejects with `Choose an MCP server and a tool.`

## Shapes

```
McpServer  { name, transport: 'stdio' | 'http', command, args: string[], env: object, url, enabled: boolean }
McpTool    { server, name, description, inputSchema: object }
McpTools   { ok: boolean, tools: McpTool[], errors: string[] }
McpCall    { ok: boolean, result: { content: [{ type: 'text', text }], isError } | null, problem: string | null }
```

`mcpTools()` lists the tools of every enabled server, so a disabled server keeps its entry in `mcpServers()` and drops out of the tool list. The mock serves two servers, `filesystem` on stdio and `docs` on http, and three sample tools.

## Tests

`tests/control-contract.test.js` checks the URL, method and body of all five methods on the real HTTP client, including the encoded name, the confirm flags and `create: true`, and verifies that both the bridge and the mock refuse an existing name when `create: true` is sent while updates without `create` still work. It checks the same five methods on the mock: the sample list, a save, a replace that keeps the saved fields, a delete, the `mcp` notice, the tool list, one tool call and each refusal.

## The older contract

This note describes Paperclip, which was removed on 2026-10-24.

# Control client contract

The panels that start and steer work (dispatch, task thread, approvals, meters) talk to one object, the control client. A mock implements it (`src/control/mock.js`), and the real one (`src/control/client.js`) calls the bridge, which calls Paperclip. Panels must use only this object. They never call `fetch` themselves.

Every method is `async`, returns plain data, and rejects with an `Error` whose `message` is plain words fit to show the user.

## Methods

| Method | Returns |
| --- | --- |
| `agents()` | `Agent[]` |
| `issues({ status? })` | `Issue[]`, newest first |
| `createIssue(draft)` | `Issue` (removed in task S40) |
| `comments(issueId)` | `Comment[]`, oldest first |
| `postComment(issueId, body)` | `Comment` |
| `approvals()` | `Approval[]`, newest first |
| `decideApproval(id, decision, note?)` | `Approval` |
| `costs()` | `Costs` |
| `setAgentBudget(agentId, budgetMonthlyCents)` | `Agent` |
| `hireAgent(draft)` | `{ agent, approval }`. `approval` is `null` when no approval is needed (task C3c; removed in S40) |
| `updateAgent(agentId, patch)` | `Agent` (C3c; removed in S40) |
| `models()` | `ModelOption[]` |
| `suggestRoute(profile, { failures } = {})` | `RouteSuggestion`, the tier, the choice and the reason from `docs/agents/policy.json`, read by the bridge (C4b; the mock holds a copy of the policy) |
| `subscribe(listener)` | an `unsubscribe` function (not async) |
| `briefs()` | `Brief[]`, in file order (added with task T1a; the mock serves samples) |
| `briefPrompt(ids, lane)` | `BriefPrompt`, the full prompt for one or more briefs and one lane (T1a) |
| `runs()` | `{ project, running, recent }`, the name of the room's project folder, the runs this bridge started that have not ended (`RunInfo`) and the last 20 run records, newest first (T5) |
| `runStats({ since? })` | `RunStats`, runs, minutes and cost per lane and model over every run record, or from `since` (a `YYYY-MM-DD` day, UTC) on; a bad day is refused with `--since needs a date like 2026-10-19.` (T13b; the mock sums its own finished fake runs) |
| `outcomes()` | `OutcomeRow[]`, one row per lane and model with its merged, rejected and pending runs, merge rate, average review fixes and cost per merge from the decided runs (C6a, C6b; the newest outcome for a branch wins, and the mock serves rows built from sample runs) |
| `liveRuns()` | `LiveRun[]`, the queued and running Paperclip runs, newest first, at most 50 (W6a; a `liveRuns` change notice goes out on each `heartbeat.run.queued` and `heartbeat.run.status` frame; the mock serves one running run and adds one for the lane's agent while its own sample run from `startRun` lasts) |
| `orchestrator()` | `OrchestratorChat`: the state `idle`, `working` or `paused`, the model, the project folder and the last 200 messages (K1; the bridge mounts it only when the lane source is on) |
| `sendToOrchestrator(text, { confirmed })` | `{ id }`, the owner message it queued. The bridge refuses anything but `confirmed: true` with `Confirm the message first.`; the text is trimmed and must be 1 to 8000 characters. A turn starts at once, or the message waits for the running turn and goes with the rest of the wait. An `orchestrator` notice goes out (K1) |
| `stopOrchestrator({ confirmed })` | `{ ok: true }`, after it kills the running turn and sets the state `paused`. It refuses anything but `true` with `Confirm the stop first.`, and the next owner message clears the pause (K1) |
| `startRun(lane, { briefs } \| { task, allowDirty, checkCommand })` | `RunInfo`, the new running entry. `briefs` starts a brief run; `task` starts a run on the bridge's project folder and `allowDirty` lets a git project with uncommitted changes run. `checkCommand` is passed to `run-lane` as `--test`; without it a project run reads the saved project setting. It sends `confirmed: true`, so call it only after the user confirmed (U5a); a `runs` change notice goes out when the run starts and when it ends (T5; the mock runs a fake run that ends after `runMs` and adds a record). A task outside 1 to 4000 characters, this checkout or a lane worktree, and a dirty project without `allowDirty` are refused (L3) |
| `stopRun({ lane, startedAt, confirmed })` | `{ ok: true, lane, startedAt, output }`, stopping the lane's running run via `POST /api/control/runs/stop` only when `startedAt` matches. Sends `confirmed: true` by default (call only after owner confirmation); refuses a mismatch or finished run with one sentence, emits `runs` (and `orchestrator` for the head note), and records a stopped run on the mock with a `room` note in the sector head or Main (P219) |
| `projectSettings()` | `{ checkCommand, hasTestScript }`, the saved one-line check command for the room's project and whether its `package.json` has a `test` script (P224; the mock serves its own setting) |
| `saveProjectSettings({ checkCommand, confirmed })` | `{ checkCommand, hasTestScript }`, after saving or clearing the setting. It sends `confirmed: true`, needs the page Origin, and refuses a command longer than 500 characters or holding a line break (P224; the mock keeps it in memory) |
| `reviews()` | `Review[]`, one entry per lane with a worktree (W3a; the mock serves samples) |
| `reviewDiff(lane)` | `ReviewDiff`, what that lane did at its head on its branch compared with `main` (W3a) |
| `mergeReview(lane, { head, message })` | `MergeResult`, the new merge commit on `main`. It sends `confirmed: true`, so call it only after the user confirmed; `head` is the sha from `reviews()` (W3b; the mock merges a sample lane once) |
| `askPlanner(goal)` | `{ issueId, identifier }`, the plan task it created for the agent with the role `pm`. It sends `confirmed: true`, so call it only after the user confirmed (C5b; the mock creates a sample plan task) |
| `plan(issueId)` | `PlanAnswer`, the planner's answer, or `waiting` with empty lists while no comment from the planner holds a `{` (C5b; the mock answers one good brief and one problem). A ready answer holds `planId`, the id of the planner comment it read |
| `acceptPlan(issueId, ids, planId)` | `{ added }`, the ids of the briefs it added to `docs/agents/TASKS.md` in plan order. It sends `confirmed: true`, so call it only after the user confirmed (C5d; the mock adds the briefs to its own list). Send the `planId` from the answer the owner read; when the newest planner comment has another id it rejects with `The plan changed since you read it. Read it again.` (Q1b) |
| `decide({ state, questions, model? })` | `{ ok: true, model, answers, usage, ms, attempts }` from the decision model (D2; see `DECIDER-EVAL.md`). It rejects with `No key is set for the decision model.` when the bridge has no `OPENROUTER_API_KEY`, which is also what the mock always does |
| `backupStatus()` | `BackupStatus`, the age of Paperclip's newest database backup (W2b) |
| `backupNow()` | `BackupResult`. It asks Paperclip for a backup at once, so call it only after the user confirmed; it rejects with `A backup is already running.` while one runs (W2b) |

## Shapes

```
Agent        { id, key, name, adapterType, role, status, model: string|null, budgetMonthlyCents, spentMonthlyCents,
               reasoningEffort: low|medium|high|null, maxTurnsPerRun: number|null, timeoutSec: number|null,
               subagentsAllowed: boolean, subagentDepth: 0..3, instructions: string, reportsToAgentId: string|null }
             status: idle | running | paused | error | pending_approval
             A waiting agent cannot take a task, and neither can one Paperclip has terminated (shown as `error`); `createIssue` refuses both.
             role: one of the Paperclip roles; adapterType: one of the Paperclip adapter types (lists in src/control/agents.js)
AgentDraft   { name, adapterType, role? (engineer), model?, reasoningEffort?, maxTurnsPerRun? (1..200), timeoutSec? (10..7200),
               budgetMonthlyCents? (0), subagentsAllowed? (false), subagentDepth? (1..3, default 1 when allowed), instructions? (max 20000), reportsToAgentId? }
AgentPatch   { any AgentDraft field except adapterType, plus status?: active | paused }   at least one field; an unknown field is refused
Issue        { id, identifier ("JC-18"), title, description, status, priority, assigneeAgentId: string|null, parentId: string|null,
               overrides: { model?, maxTurnsPerRun?, timeoutSec?, subagentsAllowed? } | null, createdAt, updatedAt }
             status: backlog | todo | in_progress | in_review | done | blocked | cancelled
             priority: critical | high | medium | low
IssueDraft   { title, description?, assigneeAgentId, priority? (critical | high | medium | low), model? (max 120), maxTurnsPerRun? (1..200),
               timeoutSec? (10..7200), subagentsAllowed? (boolean) }   a value outside these is refused with the AgentDraft sentence
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
RouteSuggestion { tier, choice: { lane, model, reasoning, provider } | null, reason }
PlanAnswer   { status: waiting | ready, briefs: PlanBrief[], problems: string[], planId? }
PlanBrief    { id, title, owner, size: small | medium | large, files: string[], tests: string[], text, dependsOn: string[] }
RunInfo      { lane, briefs: string[], startedAt, lastLines: string[] (the last 5 lines the run printed) }
RunRecord    { lane, briefs, model: string|null, reasoning: string|null, startedAt, minutes: number|null, exitCode: number|null,
               killed: boolean, costUsd: number|null, log: string|null, branch, commits: string[],
               project?: string, task?: string }   (one line of runs.jsonl; a project run has empty briefs, the folder and the first 200 characters of its task)
Review       { lane, worktree, branch, head: string (full sha of the worktree HEAD), ahead: number (commits on top of main),
               commits: string[] (at most 50), dirty: boolean, files: number, added: number, deleted: number,
               lastRun: RunRecord | null }
             A worktree that is missing or is not a git repository gives { lane, worktree, error } instead.
ReviewDiff   { lane, branch, head, files: [{ path, added, deleted }], patch, truncated: boolean }
             head is the sha the patch was read at. patch is the diff of the lane branch at head against main,
             cut at 400 KB (truncated is true when it was cut).
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
             to divide by. An outcome counts once per branch, on the newest run that names the branch; an older run on
             that branch adds only its cost to decidedCostUsd of its own row.
BackupStatus { enabled: boolean, status: ok | warning | null, latestAt: string|null, ageHours: number|null, warnings: string[], checkedAt }
             warnings are Paperclip's codes: database_backup_missing | database_backup_stale | database_backup_last_failure | database_backup_check_failed.
             enabled is false and the rest null when Paperclip has automatic backups off.
BackupResult { ok: true, name (the file name, never its folder), sizeBytes: number|null, prunedCount: number|null, finishedAt: string|null }
LiveRun      { runId, agentId, agentName, adapterType, status: queued | running, issueId: string|null, startedAt: string|null,
               lastOutputAt: string|null }   a field Paperclip leaves out is null; a queued run has no startedAt yet
OrchestratorChat { state: idle | working | paused, model, project, messages: OrchestratorMessage[] }
OrchestratorMessage { id, from: owner | orchestrator | room, text, at }
               project is the absolute project folder, or an empty string when the bridge has none.
ChangeEvent  { topic: agents | issues | comments | approvals | costs | runs | liveRuns | orchestrator, id?: string }   (id is the issue id for comments)
```

Times are ISO strings. Money is whole cents. A budget of `0` means no budget is set. A quota window with `usedPercent: null` has no number (show its `detail`). A quota provider with `ok: false` could not be read (show `error`).

When the lane source is on and Paperclip does not answer, `costs()` comes from the lane run records: one row per lane with this calendar month's spend, no budget, null tokens and no quota, and the Backups section says Paperclip is not running.

Lane mode: with the lane source on and Paperclip not answering, `issues()` and `liveRuns()` read the lane runs, `comments()` and `approvals()` are empty, `postComment` rejects with `Lane runs start from Dispatch, not from a task.` (`createIssue` was removed in S40), and the real client's `health()` reads `/api/health` (`lanes: true`, `paperclip: false`). When `health()` says `lanes: true`, the Dispatch panel lists the lane agents with a command line and starts a task on the room's project folder with `startRun(lane, { task, allowDirty })` (L3).

## The orchestrator (K1)

The orchestrator is a lane in `docs/agents/lanes.json` (Claude Code on `opus`) that `run-lane` refuses, because it runs from the room. With the lane source on, `GET /api/orchestrator` answers the chat, `POST /api/orchestrator/messages` queues an owner message and starts a turn, and `POST /api/orchestrator/stop` kills the running turn and pauses. A turn spawns `claude -p` in the project with `docs/agents/ORCHESTRATOR-AGENT.md` appended as the system prompt, writes `orchestrator-chat-<stamp>.log` and its meta beside the run records, keeps a 60 minute limit, and appends a run record when it ends. Every lane run that ends wakes the orchestrator with a `room` message and the record, at most 30 times in a rolling hour. The bridge keeps the chat in `<runs>/orchestrator-<hash>.json` and resumes the same Claude session after a restart. Every new message and state change sends an `orchestrator` notice. The mock serves a short canned chat.

## Hiring and updating an agent (C3c)

`src/control/agents.js` held the lists, the number limits (`LIMITS`, `TEXT_LIMITS`) and the checks (`cleanAgentDraft`, `cleanAgentPatch`, `hireSummary`, and `fieldProblem(key, value)`, which gives the plain sentence for one bad field or `null`). These methods and validation checks were removed in task S40.

- `hireAgent` refuses a draft without a name or a harness, a value outside its range, an unknown setting, a name that is taken, and a `reportsToAgentId` that does not exist. Every refusal is a plain sentence.
- When approval is required (the Paperclip company flag `requireBoardApprovalForNewAgents`; the mock defaults to on, `createMockClient({ requireApproval: false })` turns it off) the new agent has status `pending_approval` and `approval` is a pending `hire_agent` approval with `agentId` set. Approving it makes the agent `idle`. Rejecting it terminates the agent, which both clients report as `error`. Asking for a revision leaves it waiting. When approval is not required the agent is `idle` and `approval` is `null`.
- `updateAgent` changes only the fields given. It refuses a waiting agent and a terminated one (shown as `error`), an empty patch, a change of harness, a depth while subagents are off, an agent that reports to itself, and a name that another agent's key already uses. Turning subagents off sets the depth to 0, and turning them on sets it to 1 unless a depth is given. `status: 'active'` resumes a paused agent (the agent is `idle` until it runs).
- A budget in a patch changes the same number as `setAgentBudget` and sends a `costs` notice as well as an `agents` notice.
- Notices: a hire sends `approvals` (when one is made) and `agents`. An update sends `agents`.
- The real client (merged as 0.1.45) reports `instructions` as an empty string and refuses an instructions change with "The instructions cannot be changed here yet.", because Paperclip keeps instructions in a separate bundle. `status: 'paused'` and `status: 'active'` go through Paperclip's pause and resume routes.
- Both clients map Paperclip's `terminated` status to `error`, so a panel sees `error` for a terminated agent, while both still refuse it a task and a settings change.
- The real client maps these onto `POST /api/companies/:id/agent-hires` and `PATCH /api/agents/:id`. Model, turn limit and time limit go in `adapterConfig`. Where Paperclip has no field for reasoning effort or subagents, the bridge keeps the value in `metadata` (`metadata.reasoningEffort` and `metadata.subagents = { allowed, depth }`), and no harness enforces it (see `docs/agents/history/PAPERCLIP-API.md`).

## Change notices

`subscribe(listener)` tells a panel that data it may hold is out of date, so it can fetch again without a Refresh button. The listener gets a change event and no data. A panel fetches again only for the topics it shows. The real client sends one when the bridge reports a Paperclip event that touches that topic (a run changes status, an issue or comment is added, an approval is decided, a cost is booked) and when a run it started begins or ends (`runs`), and may send a topic more than once. The mock sends one after each of its own writes, and `client.emit({ topic })` sends one by hand for tests.

## Notes for panel authors

- Show a loading state, an empty state and an error state for every call.
- A call can fail. The mock can be told to: `client.failNext('createIssue', 'message')` makes the next call of that method reject once.
- Disable the submit button while a call is running and do not send twice.
- Every call has a time limit: 30 seconds by default, and a longer one for the routes the bridge may take longer over (the backup, a merge, the review list and diff, a plan request, agent writes, the decision model); a call that runs out rejects with `The bridge did not answer within N seconds.`, which panels show as they show other errors, and the change stream keeps its own reconnect and gets no limit.
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
| `askPlanner`, `plan` | `GET /api/companies/:id/agents` for the agent with the role `pm`, `POST /api/companies/:id/issues` for the plan task, `GET /api/issues/:id/comments` for the answer |
| `liveRuns` | `GET /api/companies/:id/live-runs?limit=50`; Paperclip answers only queued and running runs by default (`minCount` 0), and the bridge drops any other status it pads with |
| `models` | our own list (the routing policy), not Paperclip |
| `backupStatus`, `backupNow` | the bridge's `GET` and `POST /api/backup`, which read `databaseBackup` from `GET /api/health` and call `POST /api/instance/database-backups` (see `BACKUPS.md`) |

Details of each call are in `docs/agents/history/PAPERCLIP-API.md`.
