# Orchestrators in a ladder (planned)

Status: planned on 2026-10-24 at the owner's request. Briefs O1 to O5 in `TASKS.md`.

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

Rules, all checked by a pure module (`src/model/hierarchy.js`, O1):

- An id is lower case letters, digits and dashes, 1 to 24 characters, and never `orchestrator` or a lane key.
- A lane belongs to at most one sub orchestrator. Lanes in no sub belong to the main orchestrator.
- At most 5 sub orchestrators.
- A scope is a list of 1 to 20 folder or file globs relative to the project root, with no `..` and no absolute path.
- `restricted` and `scope` set by the owner (`setBy: "owner"`) cannot be changed by the main orchestrator.

## How it runs

- Each orchestrator is one instance of what `server/orchestrator.js` does today: its own session, chat, state, turn limit and wake budget. The sub's instructions are `ORCHESTRATOR-AGENT.md` plus a short section that names its id, lanes, scope, whether it is restricted, its sector branch `machineroom/sector-<id>` and its parent.
- A lane run started by an orchestrator records `startedBy` (its id). The run's end wakes only that orchestrator.
- A sub orchestrator's run route refuses a lane outside its sector.
- Restricted scope is checked twice: the sub's task text names the scope, and the merge check refuses a lane branch whose `git diff --name-only` names a file outside the scope, with a room message saying which files.
- A sub orchestrator reports to its parent by a message in the parent's chat from `sub:<id>`, which wakes the parent like a room message.
- The owner can talk to any orchestrator from the chat (a tab per orchestrator). Attach, detach, scope and restriction are confirmed writes.

## How it looks

- The hub ring splits into one arc per sub orchestrator, plus the main orchestrator's own arc for lanes in no sub. Each arc has a thin gap at its ends and a small label with the sub's name.
- A sub orchestrator floats above the middle of its arc, smaller than the main orchestrator, with the same armillary shape family. A thin white line joins it to the main orchestrator.
- Its lanes park on its arc. When it works, its tunnel runs to the folder card of its scope's top folder.

## Context and autocompact

Each orchestrator session grows with every turn. The room reads the context use from each turn's result line (Claude Code's `usage`, OpenCode's step tokens) and shows it as a share of the model's window in the agent dock. With autocompact on (the default), when a session passes 80 percent the next turn starts a new session whose first message is a short summary of the chat so far, written by the orchestrator in its last turn before the switch. The owner can turn it off per orchestrator.

## Steps

1. O1. The pure model and its tests (no server, no UI).
2. O2. The server: instances, `startedBy`, wake routing, the run route check, the scope merge check, sub reports, and the routes. After R3 and R4.
3. O3. The ring sectors and sub orchestrator shapes in the room. After R9.
4. O4. Chat tabs and the attach form. After I1 and R8.
5. O5. Context use and autocompact. After O2.
