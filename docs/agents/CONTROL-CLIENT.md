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
| `models()` | `ModelOption[]` |
| `subscribe(listener)` | an `unsubscribe` function (not async) |
| `briefs()` | `Brief[]`, in file order (added with task T1a; the mock serves samples) |
| `briefPrompt(ids, lane)` | `BriefPrompt`, the full prompt for one or more briefs and one lane (T1a) |

## Shapes

```
Agent        { id, key, name, adapterType, role, status, model: string|null, budgetMonthlyCents, spentMonthlyCents }
             status: idle | running | paused | error | pending_approval
Issue        { id, identifier ("JC-18"), title, description, status, priority, assigneeAgentId: string|null, parentId: string|null,
               overrides: { model?, maxTurnsPerRun?, timeoutSec?, subagentsAllowed? } | null, createdAt, updatedAt }
             status: backlog | todo | in_progress | in_review | done | blocked | cancelled
             priority: critical | high | medium | low
IssueDraft   { title, description?, assigneeAgentId, priority?, model?, maxTurnsPerRun?, timeoutSec?, subagentsAllowed? }
Comment      { id, issueId, authorAgentId: string|null, authorName, body, createdAt }
Approval     { id, type, status, summary, requestedByAgentId: string|null, createdAt, decisionNote? }
             type: hire_agent | approve_ceo_strategy | budget_override_required | request_board_approval
             status: pending | approved | rejected | revision_requested
decision     approve | reject | request-revision
Costs        { summary: { spendCents, budgetCents, utilizationPercent },
               byAgent: [{ agentId, agentName, costCents, inputTokens, outputTokens }],
               quota: [{ provider, ok, error?, windows: [{ label, usedPercent: number|null, resetsAt: string|null, detail: string|null }] }] }
ModelOption  { id, label, harness, tier: small | medium | large, free: boolean }
Brief        { id ("C3e"), title, ownerText, owners: (hermes | opencode | agy | claude)[], done: boolean, section, text }
BriefPrompt  { prompt, lane, model, branch }
ChangeEvent  { topic: agents | issues | comments | approvals | costs, id?: string }   (id is the issue id for comments)
```

Times are ISO strings. Money is whole cents. A budget of `0` means no budget is set. A quota window with `usedPercent: null` has no number (show its `detail`). A quota provider with `ok: false` could not be read (show `error`).

## Change notices

`subscribe(listener)` tells a panel that data it may hold is out of date, so it can fetch again without a Refresh button. The listener gets a change event and no data. A panel fetches again only for the topics it shows. The real client sends one when the bridge reports a Paperclip event that touches that topic (a run changes status, an issue or comment is added, an approval is decided, a cost is booked), and may send a topic more than once. The mock sends one after each of its own writes, and `client.emit({ topic })` sends one by hand for tests.

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

Details of each call are in `docs/agents/PAPERCLIP-API.md`.
