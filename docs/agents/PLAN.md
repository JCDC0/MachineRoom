# Next plan, from 0.1.37

Written 2026-10-18. The task briefs are in `TASKS.md`, the design is in `CONTROL-PLANE.md`. This file puts them in order and says what comes first.

## Where we are

Built and merged: the 3D room with strings, travelling agents and follow modes; the bridge to Paperclip with truncation restore; four recorded scenarios (failing test then fix, edit across three files, rename on three agents, tool error); first-run screens; the control client contract and a mock; the control drawer (dispatch, tasks, approvals, meters) running on the mock; the assistant core (rules, action list, key guard). 306 tests pass.

Not built: nothing writes to the real Paperclip yet (C2), the assistant has no terminal (A2), no review and merge, no worktrees, no subagent recordings, no cost board in the room, no licence, a 20 line README, and the repository has no remote, so the whole project lives on one disk.

## The aim: stop being the messenger

Today you ask Claude, Claude writes a brief, you paste it into OpenCode or AGY, they report, and you paste the report back. The aim is that you type a goal in MachineRoom, a planner splits it, cheap workers do it in their own worktrees, you read the reports and the diffs in the room, and you merge with one click. Claude stays for design work and for long chats about many files at once. Once M3 below is reached, MachineRoom builds MachineRoom this way.

One rule until worktrees are on: no agent works inside `C:\GitHub\MachineRoom` itself. Without isolation an agent edits your checkout directly. Agents keep working in their own worktrees (as OpenCode and AGY do now) or in the sandbox.

## Milestones

| | Name | Exit test |
| --- | --- | --- |
| M1 | Control without copy and paste | From the drawer, create a task for Hermes on DeepSeek V4.1 Flash. Watch it move in the room. Read its comment back in the thread. Nothing else open. |
| M2 | Review and merge in the room | The branch of that task shows its diff and test result in MachineRoom. One click merges it locally. The backup age is visible. Nothing is pushed. |
| M3 | MachineRoom builds MachineRoom | A goal typed in MachineRoom is split by the planner into issues, built by cheap workers in worktrees, reviewed and merged in the room. A candidate build runs next to the stable one. |
| M4 | Public | Licence, clean README, CI, one command install, a compatibility check against Paperclip, and the repository on GitHub. |

The repository goes to GitHub as a private backup before M4 (G6 below). It goes public only at M4.

## Order of work

Each line is one brief in `TASKS.md`. Lines that start together can run at the same time, because they touch different files.

**Now, four lanes at once** (done so far: A1 to A3, C2, C3a to C3c, A4, D1, P6)

- OpenCode (Argon until 0.1.41, MiMo V2.6 Pro from C2b on, DeepSeek V4.1 Flash 1017 at max from 0.1.58, the owner's choices): **U4** (reject a foreign Host header), then **T1a** (briefs routes and client methods), then **C2b** (hire and update routes). Then **T5** (start a lane from the bridge, merged as 0.1.49) and **W3a** (read the lane branches, merged as 0.1.52). Then **B6** (late join replay, agent roles, unique keys, merged as 0.1.57). Then **U1** (route list and doctor, merged as 0.1.61; the first run on DeepSeek V4.1 Flash at max, 13 minutes, 12 cents). Later **U2**, **S1**.
- AGY (Argon for C3e and T1b, Flash for small things): **C3e** (HUD polish, checked by eye), then **T1b** (briefs menu in the dispatch panel), then **C3d** (agent builder form, against the mock), then **T7** (run a brief from the dispatch panel, after T5 is merged).
- Hermes (DeepSeek V4.1 Flash 1017, own worktree): **G5** (CI file), **P5** (recover cut tool lines), then **G3** (README draft).
- Claude: **M1** (exit test with a real Paperclip, needs the owner's yes), **A5** (cost board in the room), **G1** (history audit), then **C0 stage 2** when you say yes to worktrees. **D1** is built and waits for the owner's run.

**Getting off the terminals.** The aim is that nobody opens three harness windows and pastes prompts. T1a and T1b are the first step: the bridge builds the full prompt for any brief from `HOUSE-RULES.md`, `lanes.json` and `TASKS.md`, and the dispatch panel shows it with a Copy button. That removes Claude from writing prompts. The next steps remove the pasting: M1 sends a task to Hermes through Paperclip and reads the report back in the thread, C0 stage 2 gives each agent its own worktree through Paperclip so a task can run without a harness window, and W3 shows the diff and merges it. agy still needs a launcher that reads its issue through the API, so it is last.

**Then M1 check.** The real client is wired in Stage. Run the exit test with Hermes on DeepSeek V4.1 Flash, fix what breaks.

**The room, version 2 (the owner's redesign, 2026-10-19).** **V1** (folder view plan, Hermes, after T9), then **V2** to **V5** (Claude: the void, folders as folders, agents and the hub ring, terminals on demand, merged as 0.1.55) and the V5 buttons (**V5b**, AGY, next). Then **V6** (folders close after the work ends, Hermes, merged as 0.1.59). The owner chose Paperclip's Orchestrator agent as the orchestrator, and V2 records the portfolio look.

**Next, for M2**

- **C0 stage 2** (worktrees, needs your yes), **W3** (review and merge, OpenCode for the bridge and AGY for the panel), **W2** (backups), **W1** (supervisor and doctor), **T1** (load a brief into the dispatch form).

**Next, for M3**

- **D2** (decide route in the bridge, OpenCode), **D3** to **D5** (assistant fallback, routing policy and queue proposals through the decision model), **C4** (routing policy), **C5** (planner and orchestrator agents), **C6** (outcome log), **S2 and S3** (subagents in the room, after S1), **U3** (candidate build beside the stable one), the protected files list in `CONTROL-PLANE.md`.

**Next, for M4**

- **P1** (npx install), **P3** (scale), **P4** and **G2** (your decisions), **G4** (fresh screenshots), **G5** (CI), **G6** (publish).

## The decision model

A decision model returns typed answers (a choice, a yes probability, a score) instead of text. It is cheap and fast enough to sit between our rules and the big models: it can tell the orchestrator which tier a task needs, whether subagents are worth it, how risky a wrong result would be, and whether a typed request should become a queued routine. The thresholds and the floors stay in our code, and it is off by default. Which one to use is decided by measuring on our own cases (D1), not by the published rankings, which disagree. The provisional choice is `typesafe/jev-1.14`, with Perplexity Decider and Strands Decider as challenger and offline option. Full design in `CONTROL-PLANE.md`.

## Hermes on DeepSeek V4.1 Flash (H1, you)

You are setting Hermes to DeepSeek V4.1 Flash. Pick the model id from what Hermes itself lists, because the id differs between OpenRouter and the DeepSeek API, and a wrong id fails the run. Paperclip reports no usage for Hermes, so the cost board will say "not reported" for it. Watch the provider's own dashboard for its spend. Known limits of its output, for the parsers: a read shows only a file name, a bundle of commands shows only the first command and one exit code (a failure inside the bundle reads as ok), and long lines are wrapped at about 79 columns.

Use Hermes for cheap work with clear files: docs, small refactors, README text. The first goal worth giving it once worktrees are on is "draft the README from the docs", because a doc change is easy to review and the README is on the list anyway.

## Staying current while Paperclip moves on its own

Paperclip will change its API and its event stream without asking us. The rules that keep MachineRoom working:

1. **Unmodified and pinned.** We run an unmodified Paperclip at a recorded version. `PAPERCLIP-API.md` says which version it was checked against (2026.1012.0 today). We never edit its files.
2. **One door.** Only the bridge (`server/`) and `src/control/` talk to Paperclip. Everything else uses the client contract and the activity schema. When a route changes, one file changes.
3. **A list of the routes we use.** U1 adds `server/surface.js`: every Paperclip route we call, with the fields we read. `machine-room doctor` fetches `/api/openapi.json` from the running instance and compares it with that list. It reports only routes we use.
4. **The recordings are the tests for the event stream.** The four scenarios replay through the parsers on every `npm test`. After a Paperclip or harness upgrade, record the scenarios again with `frames-from-runs` and compare the activities. A harness CLI can change its output as well, so each parser is under the same check.
5. **Say so when it breaks.** U2 counts frames the parsers could not read and exposes the count, the Paperclip version and the route check at `/api/health`. The HUD shows a chip, for example "Paperclip changed: dispatch is off". Only the failing feature switches off. The room keeps drawing as long as frames parse, and unknown frame types are skipped already.
6. **Upgrade in this order.** Back up the database (W2). Install the new Paperclip into a separate folder on another port. Run `doctor` and the recorded scenarios against it with the free model. Switch only if both pass. Keep the old install for rollback.

## Building on itself safely

- Agents change MachineRoom only on a branch in a worktree. `main` moves only when you merge in the review panel (W3). Nothing is ever pushed by an agent.
- The merge button appears only when the worktree's `npm test` and `npm run build` have passed. The bridge runs them and stores the result on the issue.
- Some files need a second look. A diff that touches them is marked in the review panel: the bridge's host and origin checks, the assistant's key guard and confirmed action set (`src/assistant/intent.js`, `actions.js`), anything that reads or writes keys, anything that starts a process. The list lives in `CONTROL-PLANE.md`.
- The stable copy keeps running while a candidate runs. U3 starts the candidate from a worktree on another port (stable on 5174, candidate on 5175). Promote means merge, rebuild and restart through the supervisor (W1). A bad candidate costs nothing.
- Releases are tags on `main`. After G6 the app shows a "new version" chip from the GitHub tags and never updates itself without a click.

## Publishing to GitHub

You said: publish it with a clean README. Pushing leaves your machine, so nothing here happens without your yes, and Claude never pushes.

- **G1 (Claude).** Audit the full history for keys, e-mail addresses, your Windows profile name and local paths. Report what to scrub before anything goes out.
- **G2 (you).** Decide: the licence (MIT matches Paperclip), the repository and package name, whether to name Paperclip and the show at all (recommended: name Paperclip as the thing it controls, state that MachineRoom is not affiliated, and do not use the show's name, logo or imagery), and what to do with `src/engine/sprites.js`, which was copied from your graded portfolio (keep it with your own credit, or rewrite it).
- **G3 (Claude, Hermes drafts).** The README. Plain words, no em dashes, no emoji. Sections: what it is in two lines; a screenshot and a short loop; what you need (Node, Paperclip at the pinned version, at least one harness); three command quick start; demo mode that needs no Paperclip; how it works in five lines; supported harnesses and what each shows, with the known limits; what it does not do; the safety note (loopback only, keys never go through the assistant); where the plan lives; how agents contribute (`docs/agents/`); licence and credits.
- **G4 (AGY).** Fresh screenshots after the drawer and assistant exist: overview, close-up, control drawer, assistant, cost board.
- **G5 (OpenCode).** GitHub Actions: Node 24, `npm ci`, `npm test`, `npm run build`. Keep `package-lock.json` in sync.
- **G6 (you, with Claude's commands).** Create the repository as private first, push `main` and tags only (not the `feat/*` branches), check that the README renders and CI is green, then switch it to public. Claude gives the exact commands and runs nothing that pushes.

## Open questions for you

1. Worktrees (`enableIsolatedWorkspaces`): say yes when C2 is merged, and Claude will list the exact setting changes first.
2. Private GitHub repository now, as a backup? Recommended.
3. The names and licence in G2.
4. D1 needs your OpenRouter key in the environment of the shell that runs it, so it can try the decision models on our probe set. It costs cents. Say yes and run it yourself, or tell Claude to run it.
