# Agent seats: agents that make their own agents

Status: plan, 2026-11-20. Not built. Builds on P634 (the Agents family tree with a chosen top) and P635 (one park ring per level of the agent tree).

## The owner's ask

Slash commands tell an agent it may make agents of its own. Because agents already have creation and on and off switches in Agents, an orchestrator that is allowed may create agents and turn them on itself, but never more than the owner allocates in the park rings.

## Today

- The owner creates lanes (`POST /api/lanes/create`) and turns them on (`POST /api/lanes/active`). Both refuse an orchestrator's token.
- An orchestrator can only propose a lane (`POST /api/family/proposals`), which the owner approves.
- Only the main orchestrator adds a sub (`POST /api/orchestrator/ladder`, `MAIN_LADDER_PROBLEM`), and only on its own harness (`sameHarnessProblem`, the owner's 2026-11-16 decision). A sub creates nothing.
- The subagent depth (1 to 4, `server/agent-depth.js`) only adds a line to each prompt that limits the harness's own subagents, such as Claude Code's Task tool. The room does not count those.
- The chat's room commands are `/compact`, `/clear`, `/help`, `/new` and `/stop` (`ROOM_COMMANDS` in `server/orchestrator.js`).

## The idea: seats

A seat is room for one agent on one park ring. The owner sets the seats of each ring. An agent the owner lets create agents spends seats; a full ring refuses.

- Ring 0, the orchestrator tree: its seats hold the lanes of the top and of the Orchestrator.
- Ring N (1 and up): its seats hold the subs of that level and their lanes. A sub that makes a sub puts it on the next ring down, so it spends a seat there.
- The rings that can exist stop at the subagent depth, and P635 keeps them above the lattice floor.
- Seats count agents that are turned on. A lane that is turned off frees its seat but stays in the list. Deleting it frees the seat for good.
- The owner's own agents count too, so the numbers on a ring are always true. The owner can still go past a full ring from Agents, after a confirm that names the ring.

## Who may do what

| Who | Without a grant | With a grant |
| --- | --- | --- |
| Owner | Everything, as today. | Not needed. |
| An orchestrator (main or sub) | Propose a lane, as today. | Create a lane under itself, turn its own lanes on and off, add a sub under itself on the next ring, within the free seats of those rings and within its grant. |

A grant names numbers: `lanes` (how many lanes this orchestrator may have turned on) and `subs` (how many subs it may have under it). The free seats of its rings still cap it. Rules that stay:

- Same harness: an agent makes agents only on its own harness, with a model that harness lists.
- Own branch only: an orchestrator turns on, turns off or deletes only agents under it. Each agent it made carries `createdBy`, shown in Agents as `made by NAME`, and only the owner or that maker deletes it.
- Depth: a sub on the last allowed ring has no `subs` grant, whatever the owner typed.
- The sub's `Scope` and `Restricted` pass down: a sub made by a restricted sub is restricted to the same scope or narrower.
- A grant is never self-given. Only the owner's page writes grants. An orchestrator's token can read its own grant, never write one.

## The slash commands

Typed by the owner in an orchestrator's chat tab. The room handles them and does not send them to the model as typed. Each one that changes a grant ends by posting a room notice to that agent, so it learns the change on its next turn.

- `/seats`: shows the agent's grant, what it uses, and the free seats of its rings. Changes nothing and sends no notice.
- `/grant LANES [SUBS]`: for example `/grant 3 1`. Lets this orchestrator keep up to 3 lanes turned on and have 1 sub. A confirm shows the numbers and the rings they draw on. The notice tells the agent what it may now do, the routes, and its limits.
- `/revoke`: sets the grant back to 0 and 0. Agents already made stay as they are; the notice says the agent may make no more and may only propose.
- `/agents`: lists the agents under this orchestrator with on or off, the seats they hold, and who made each.

Every turn's instruction also carries one line with the agent's current grant and the free seats, so an agent that missed a notice, or was compacted, still knows its limit.

## How it is enforced

The server checks every change against one pure function (`seatCheck` in a new `server/seats.js`), not the prompt. A refused change answers 409 with the reason, such as `Ring 1 is full: 4 of 4 seats are taken.` or `Your grant allows 3 lanes turned on; 3 are on.`.

- `POST /api/lanes/create` accepts an orchestrator's token when it has a grant, saves `createdBy` and the maker as the new lane's parent, and turns it on only if a seat is free.
- `POST /api/lanes/active` accepts an orchestrator's token for lanes under it.
- `POST /api/orchestrator/ladder` accepts any orchestrator's token to add a sub under itself (`parent` is the caller), keeping the same harness and model checks.
- Seats and grants are saved per project in the runs folder, beside the agent labels, and written atomically.
- Two changes at once cannot both take the last seat: the check and the write happen in one step in the server.

## What the owner sees

- Agents (P634's tree): each ring's level shows `Ring 1 · 3 of 4 seats`, a `Seats` number field per ring, and `made by NAME` on agents an orchestrator made.
- The room (P635): each park ring carries a small `3 / 4` label at its edge. A full ring's label turns yellow.
- The Team tab shows every create, turn on and turn off an orchestrator does, with the seat it took or freed.

## Briefs, in order

1. S1, the seat model: `server/seats.js` (rings, grants, `seatCheck`, atomic save), with pure tests for every rule above.
2. S2, enforcement: the three routes, `createdBy`, the own-branch rule, the 409 reasons, and the grant line in each turn's instruction.
3. S3, the slash commands: `/seats`, `/grant`, `/revoke` and `/agents` in `ROOM_COMMANDS`, handled by the room, with the confirm and the notice.
4. S4, the owner's view: seat counts and fields in Agents, ring labels in the room, Team tab lines.
5. S5, docs: `FREE-HIERARCHY.md`, `architecture/LIVE.md`, `architecture/ROOM.md`, and the runbook.

S1 and S2 run first. S3 and S4 can run side by side after S2. Each brief starts after P634 and P635 are merged.

## Choices for the owner

1. Seats per ring, as above, or also a cap per orchestrator? The plan uses the grant as the cap per orchestrator, so per ring is enough.
2. Do the harness's own subagents, such as Claude Code's Task tool, take seats? The plan says no: they live inside one agent's turn and the depth line already limits them.
3. Does an AGY agent get grants? AGY needs Bypass to call the bridge, so a grant works only for an AGY orchestrator in Bypass, such as Neon now.
