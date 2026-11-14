# Orchestrators in a ladder (built)

Status: built. The plan was written on 2026-10-24 at the owner's request. O1 to O7 are merged, O8 added each orchestrator's own token (merged as 0.1.356), and each step below gives its version. V23 made the sectors readable, V25 grouped the dock's agent list, V26 named each sector once, and S10 added the demo replay (`?replay&fixture=scenario-i`). The version 7 audit's X1 and X3 are fixed: the actor comes from the request and the sector gate uses each orchestrator's token, and the scope check reads uncommitted work as well as commits. Briefs O1 to O8 in `TASKS.md`.

## What the owner asked for

With ten OpenCode lanes, one orchestrator cannot keep them all busy on a big project such as LowBeam. The owner wants a ladder:

- The main orchestrator sits at the hub centre, as now. It talks to the owner.
- The owner, or the main orchestrator, can attach sub orchestrators. Attaching is optional: with none, the room works as today.
- Each sub orchestrator owns a sector of the hub ring and the lanes parked in it, and a part of the project's folders.
- A sub orchestrator's folders can be restricted (its lanes may change files only there) or open. The owner or the main orchestrator sets this, and only they can change it.
- Lanes are the subagents. A sub orchestrator plans for its own lanes, starts them, reviews and merges their work into its sector branch, and reports to the main orchestrator, which merges sector branches into the project and reports to the owner.

The aim is to spend the subscription well: the main orchestrator on a strong model for planning and final review, sub orchestrators on cheaper models, lanes on the cheapest.

## The model

A ladder is a small JSON object kept with the main orchestrator's state (`<runs>/orchestrator-<hash>.json`):

```
{
  "subs": [
    {
      "id": "frontend",
      "name": "Frontend",
      "harness": "opencode",
      "model": "opencode-go/deepseek-v4.1-flash",
      "lanes": ["opencode", "opencode2", "opencode3"],
      "scope": ["src/ui/**", "src/styles.css"],
      "restricted": true,
      "setBy": "owner"
    }
  ]
}
```

Rules, all checked by `src/model/hierarchy.js`:

- An id is lower case letters, digits and dashes, 1 to 24 characters, and never `orchestrator` or a lane key.
- A lane belongs to at most one sub orchestrator. Lanes in no sub belong to the main orchestrator.
- At most 5 sub orchestrators.
- A scope is a list of 1 to 20 folder or file globs relative to the project root, with no `..` and no absolute path.
- `restricted` and `scope` set by the owner (`setBy: "owner"`) cannot be changed by the main orchestrator.
- A sub orchestrator may use any harness the bridge can start on this computer (`activeHarnesses` from `GET /api/orchestrators`). Saving a ladder refuses a sub whose harness has no program on this computer with `harnessUnavailableProblem` (400), and `subOrchestratorAgent` reports each sub with its own harness, adapter type, parser and model (P331).

## How it runs

- The bridge reads the actor from the request, not from the body: an Origin is the owner and no Origin is an orchestrator. A request with no Origin that says `by: "owner"` or `from: "owner"` is refused with 403, and so is one that starts a run with `startedBy: "orchestrator"`. A page that says `by: "orchestrator"` or `from: "orchestrator"` is refused by the page rule, as before.
- Each orchestrator is one instance of what `server/orchestrator.js` does today: its own session, chat, state, turn limit and wake budget. The sub's instructions are `ORCHESTRATOR-AGENT.md` plus a short section that names its id, lanes, scope, whether it is restricted, its sector branch `machineroom/sector-<id>` and its parent.
- A lane run started by an orchestrator records `startedBy` (its id). The run's end wakes only that orchestrator.
- A sub orchestrator's run route refuses a lane outside its sector. Each orchestrator sends its own token in `X-MachineRoom-Orchestrator`, and a no-Origin request with a sub's token acts as that sub, so the sector gate stops a sub from starting another sector's lane (O8).
- Restricted scope is checked twice: the sub's task text names the scope, and the merge check refuses a lane branch whose commits or uncommitted work name a file outside the scope, with a room message saying which files (`branchChanges` reads `git status --porcelain --untracked-files=all` too).
- A sub orchestrator reports to its parent by a message in the parent's chat from `sub:<id>`, which wakes the parent like a room message.
- The owner can talk to any orchestrator from the chat (a tab per orchestrator). Attach, detach, scope and restriction are confirmed writes.

## Who talks to whom

| Who | Can send | To |
| --- | --- | --- |
| Owner | a chat message, a ladder change, a run start | the main orchestrator or any sub, from the chat tabs; any lane |
| Main | a chat reply, a goal message, a ladder change, a run start | the owner; any sub; any lane |
| Sub | its turn's answer, as `sub:<id>` | its parent only |
| Lane | one report when its run ends | the orchestrator named by `startedBy`, else the main |
| Harness subagent | its result as a tool result | the harness turn that started it |

A sub cannot message another sub. It asks its parent to pass the message on, and the main relays it in its own name. A sub's answer is its only message to its parent.

## How it looks

- The hub ring splits into one arc per sub orchestrator, plus the main orchestrator's own arc for lanes in no sub. Each arc has a thin gap at its ends and a small label with the sub's name.
- A sub orchestrator floats above the middle of its arc, smaller than the main orchestrator, with the same armillary shape family. A thin white line joins it to the main orchestrator.
- Its lanes park on its arc. Its own turns show in the room as `sub-<id>`.

## Context and autocompact

Each orchestrator session grows with every turn. The room reads the context use from each turn's result line (Claude Code's `usage`, OpenCode's step tokens) and shows it as a share of the model's window in the agent dock. With autocompact on (the default), when a session passes 80 percent the next turn starts a new session whose first message is a short summary of the chat so far, written by the orchestrator in its last turn before the switch. The owner can turn it off per orchestrator.

## Steps

These steps are merged. The version follows each one.

1. O1. The pure model and its tests, no server and no UI (0.1.282).
2. O2. The server: instances, `startedBy`, wake routing, the run route check, the scope merge check, sub reports, and the routes (0.1.305).
3. O3. The ring sectors and sub orchestrator shapes in the room (0.1.295).
4. O4. Chat tabs and the attach form (0.1.291).
5. O5. Context use and autocompact (0.1.311).
6. O6. The live ladder reaches the room from `client.orchestrators()` (0.1.298).
7. O7. The dock shows a sub orchestrator's sector, scope and restriction (0.1.316).

The next briefs made the ladder easier to see and use:

- V23. The sector arcs and labels are readable, and the subs sit apart (0.1.309).
- V25. The dock's agent list groups by sector (0.1.317).
- V26. Each sector is named once (0.1.318).
- S10. The demo replay where the subs and their lanes work (0.1.314). Open `?replay&fixture=scenario-i`.

Both version 7 audit points are fixed: X1 by the actor rule and O8's token, and X3 by the scope check that reads uncommitted work. Each orchestrator gets its own in-memory token, required in X-MachineRoom-Orchestrator, and the sector gate is enforced (O8, merged as 0.1.356). See `AUDIT-2026-10-V7.md`.
