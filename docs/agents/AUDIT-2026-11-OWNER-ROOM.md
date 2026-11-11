# Audit of the owner's room with only its own lanes, November 2026

Written 2026-11-12 by OpenCode 5 on the branch `feat/p56-the-owner-s`, from `76889469` (0.1.401), for brief P56. The bridge ran and the code was read at `88ba9cc4`; every cited file is unchanged between `88ba9cc4` and `76889469`. This is a report only. No code changed. The only file this brief writes is this one. File and line numbers are those of `76889469`.

The brief asks for a room with `config/lanes.json` and no `MACHINEROOM_LANES_DIR`: the orchestrator and the lanes the owner makes. I served a temp git project with `npm run serve -- up --lanes --sessions`, `MACHINEROOM_RUNS` on a temp folder and `MACHINEROOM_LANES_DIR` unset, made one lane with `POST /api/lanes/create` as the page sends it, and walked the routes and panels. The OpenCode lane could not be made (finding 1), so the made lane is `claude-1` (name Coder, Claude Haiku 5.5, effort max). I then turned it on with `POST /api/lanes/active` and walked the same routes again.

## Severity

- High: a normal first use shows the room wrong or refuses the only lane the owner has.
- Medium: a normal case in a named panel shows an empty or wrong state, with a fix in one place.
- Low: a wrong path or sentence in copy, with no blocked work.

## Findings

| # | Severity | Where | The case and what the owner sees | Check | Fix |
| --- | --- | --- | --- | --- | --- |
| 1 | High | `server/programPath.js:27`; `server/agents-config.js:104`, `:111`; `server/doctor.js:56` | The OpenCode harness is reported unavailable, so the owner cannot make the lane for their OpenCode subscription. `programPath('opencode')` returns null because the Windows lookup tries only `.com` and `.exe`; the CLI on this machine is an npm `.cmd` shim. `opencode --version` prints 2.0.32. The page's harness picker leaves OpenCode out, and `POST /api/lanes/create` answers `The harness opencode is not available on this computer.` | Proved: `/api/harnesses` had `opencode: false`; `programPath('opencode')` returned null; `opencode --version` printed 2.0.32; the create answered 400. | Resolve `.cmd` and `.bat` on Windows, and start a `.cmd` through `cmd.exe /c` in the lane runner and the orchestrator. Add a test with a temp `.cmd`. Read P54 first: its brief covers the program path of a made lane. |
| 2 | High | `server/lanes-source.js:342-350`; `server/runs.js:807-809`; `server/policy.js:121-124` | A lane the owner just made is missing from the room until the owner finds the switch in the family tree. `/api/agents` lists Orchestrator and the session readers, not Coder; `/api/control/agents` lists only Orchestrator. The Team tab and the Dispatch lane menu therefore show only Orchestrator. Auto answers `Pick the lanes for this project first.` and a typed run is refused with the same sentence. Settings and the family tree do list Coder, so the room disagrees with itself. After `POST /api/lanes/active` with `claude-1`, both lists include Coder and Auto works. | Proved: the two lists before and after the active call; the 400 from `/api/control/route/lane`. | In `createAgentLane`, when no active choice exists, write `[key]` to the active lanes file. Test that after create, `/api/control/agents` holds the key and Auto does not answer `Pick the lanes`. |
| 3 | Medium | `src/ui/panels/runs.js:189-209`; `server/runs.js:785-787` | After a lane is on, the Dispatch lane menu lists Orchestrator and Coder. Choosing Orchestrator and pressing Run answers `The orchestrator lane runs from the room, not as a lane run.` The owner wastes a dispatch and has to learn that the orchestrator runs from the chat. | Read: `/api/control/agents` returns `key: orchestrator`; `projectRunLanes` has no skip for it; the refusal is at `server/runs.js:786`. I did not POST a run. | Skip `agent.key === 'orchestrator'` in `projectRunLanes`. A one-line test on the pure function. |
| 4 | High | `src/ui/panels/briefs.js:3-10`, `:19`, `:63-68` | With `claude-1` on, every brief shows `This brief is not for an agent` and no Run now button. `laneHarness('claude-1')` returns null because the key check expects a harness name or a harness name plus digits, with no dash. `ownerToLane` then returns null even when the brief's owner is `claude`. | Proved: a direct call to `validLanes` with `claude-1`, `opencode-1`, `opencode2`, `claude`, `agy-1` and `codex-1` returned only `opencode2` and `claude`; `ownerToLane({ owner: 'claude' }, ...)` returned `claude`, not `claude-1`. | Read the lane's `harness` field from the agent instead of guessing from the key, or accept a trailing `-N`. Test the made keys `claude-1` and `opencode-1`. |
| 5 | High | `server/briefs.js:18`, `:84-86` | The prompt route reads the project's `docs/agents/lanes.json` and checks the lane there, so a made lane is never found. The answer is `Choose hermes, opencode or agy.`, which names three development fleet lanes. A project without `docs/agents` answers `The brief files are missing.` | Proved: on the temp project with a one-brief `TASKS.md` and an orchestrator-only `lanes.json`, `GET /api/control/brief-prompt?ids=Z9&lane=claude-1` answered 400 with that message. | Build the lane map with `readAllLanes` from `server/agents-config.js`, which adds `<runs>/agents.json`, and name the lane the owner has. Remove the three fleet names from the message. |
| 6 | Medium | `server/reviews.js:26`, `:268-273`, `:670-675` | With `claude-1` on, `GET /api/control/reviews` returns `{"lanes":[]}` and the Reviews tab says `No lanes to review.` The route falls back to the development checkout's `docs/agents` when the project has no `lanes.json`, and iterates that fleet list. A worktree named `claude` is listed as lane `claude`, a fleet name, while Coder is never listed. | Proved: the empty answer with Coder on; then `.worktrees/claude` made the same route list lane `claude`. | Read the project's lanes with `readAllLanes` (config plus agents.json) and make a worktree for a made lane. Do not fall back to the development `docs/agents`. |
| 7 | Medium | `server/doctor.js:13`, `:153-171`, `:194` | The doctor checks only `lanes.json`. It printed `All checks passed` with no Coder line, then `Start a lane with npm run run-lane -- opencode T2`, but `opencode` is not a lane in this room and is not available as a harness here. | Proved: the doctor command output. | Build the lane list with `readAllLanes` (or add `<runs>/agents.json` to `laneLines`) and change `NEXT_STEP` to `Press C in the room for Dispatch.` or name a lane the room has. |
| 8 | Medium | `src/policy/proposals.js:6-7`; `scripts/policy-propose.mjs:18`; `server/lanes-source.js:24-27` | `npm run policy-propose` reads `config/policy.json` but writes a patch headed `a/docs/agents/policy.json` and `b/docs/agents/policy.json`. The owner applies it in the checkout and the room does not change, because the room reads `config/policy.json`. | Proved: a direct `policyDiff` call printed those two headers. Read: the script's policy path comes from `lanesFolder()`. | Pass the policy file's relative path into `policyDiff` and use it in both headers. |
| 9 | Medium | `server/teams.js:159-170`, `:180`; `src/ui/FamilyTree.jsx:326` | Saving a team before the owner turns a lane on stores `lanes: []`. The card says `It takes this project's lanes, labels and sub orchestrators`, but the team has no lanes; applying it later turns every lane off. | Proved: with the active choice file renamed, `POST /api/teams` returned `{"lanes":[]}`. | When no active choice exists, use the visible eligible lanes, or refuse with `Turn on a lane first.` |
| 10 | Low | `src/ui/panels/AgentBuilder.jsx:6`, `:81`; `src/ui/panels/ControlDrawer.jsx:188-190` | The Team tab says `New lanes are added in docs/agents/lanes.json.` The owner has no such file. A made lane lives in `<runs>/agents.json` and is made in the family tree (or in Settings after the P58 change). | Read: the constant at line 6 and the mount in the Team tab. | Say `New lanes are made in the family tree.` or name the new Settings flow, with no path. |

## Also seen, not in the table

Auto answers the right lane after Coder is on, but the sentence is wrong. Failures 0, 1 and 2 returned `small`, `medium` and `large`, each with `claude-1`, and each said `No lane of the ... tier is free, so the first free lane was taken.` The policy sends every tier to the owner, and the free-lane fallback takes Coder. The sentence at `src/policy/route.js:237-247` should say that the policy sends the tier to the owner and the first free lane was taken instead. I left it out of the table to keep the ten places there.

## What was checked and found sound

- `GET /api/lanes` and `GET /api/family` list Coder before the active choice. The family tree switch uses `POST /api/lanes/active` and turned Coder on.
- After the switch, `GET /api/agents`, `GET /api/control/agents` and `GET /api/control/costs` include Coder. The cost board shows zero spend because the lane has no run.
- `readStartLanes` in `server/runs.js:212-223` reads `readAllLanes`, so a typed project run sees the made lane after the active choice. I did not start one.
- The doctor's Orchestrator line is right: it starts from the Claude Code program.
- The harness list has the right models and efforts for the available harnesses. OpenCode is the exception in finding 1.
- Settings' lane list shows Coder before the active choice. It lists, shows and deletes lanes; it does not create them. Creation is in the family tree, which is a brief wording mismatch, not a code fault.

## What this session could not check

- Anything that needs a screen. No dev server was started, as the house rules ask for a check by eye to be left to the orchestrator. The look of the Team tab, the Dispatch menu, the family tree and the Reviews empty state is left to the orchestrator.
- A real typed run, a brief run or an agent start. The brief and the house rules forbid it. The run start checks are read from `server/runs.js`, not run.
- The OpenCode lane start after a `.cmd` fix. The fix would need a code change, and this brief allows none.
- The policy patch applied to a real checkout. I proved the headers and the room's policy path, not the apply.
- A review of a made-lane worktree. A made lane has no `worktree` field, and the review route only iterates the fleet list. This is read from the code.
- The full test suite. The house rules say not to run it, and this brief changes no code or test. The number of tests is unchanged.
- The doctor on a machine with an OpenCode `.exe`. Finding 1 is about the npm `.cmd` shim on this machine.

## Commands run

- `git switch -c feat/p56-the-owner-s refs/heads/main`.
- `npm run serve -- up --lanes --sessions --root <temp>\project --port 18765 --no-open`: the doctor passed and the bridge answered `/api/health` with `ok: true`, `lanes: true`, `sessions: true`.
- `npm run serve -- doctor --root <temp>\project`: passed, with the output in finding 7.
- `opencode --version`: `2.0.32`.
- `node -e` with `programPath('opencode')`: null. The same call for `claude` found the program.
- `node -e` with `validLanes` and `ownerToLane`: the made keys are dropped.
- `node -e` with `policyDiff`: the headers name `docs/agents/policy.json`.
- GET `/api/harnesses`, `/api/agents`, `/api/lanes`, `/api/family`, `/api/teams`, `/api/control/agents`, `/api/control/costs`, `/api/control/reviews`, `/api/control/issues`, `/api/control/live-runs` and `/api/control/briefs`.
- POST `/api/lanes/create` with `opencode` (400) and with `claude` (200, `claude-1`), `/api/lanes/active` (200), `/api/control/route/lane` at failures 0, 1 and 2, `/api/control/brief-prompt` with `Z9` and `claude-1` (400), and `/api/teams` with the active file renamed (`lanes: []`).
- `npm run build`: passed.
- No test file changed, so no `npx vitest related` run. The full suite was not run, by rule.
- No key was read or printed.

## Proposed briefs

1. An OpenCode lane the owner makes on Windows can start. Fix the Windows program lookup to accept `.cmd` and `.bat`, and start a `.cmd` through `cmd.exe /c` in the lane runner and the orchestrator. Add a test with a temp `.cmd`. Files: `server/programPath.js`, `server/agents-config.js`, `server/doctor.js`, `src/briefs/run.js`, `server/orchestrator.js`, `tests/`. Check P54 first, because it may already own part of this.
2. A lane the owner makes is on, and Dispatch offers only runnable lanes. Write the first made lane into the active choice, and skip the orchestrator in `projectRunLanes`. Files: `server/agents-config.js`, `server/lanes-source.js`, `src/ui/panels/runs.js`, `src/ui/emptyRoom.js`, `tests/`.
3. Briefs and reviews read the owner's lanes. Match a lane by its `harness` field, build the brief prompt from `readAllLanes`, and make the review list from the room's lanes and their worktrees. Files: `src/ui/panels/briefs.js`, `server/briefs.js`, `server/reviews.js`, `tests/`.

The doctor, policy patch, team save and Team tab copy are one-line fixes. They can go into the next housekeeping brief without a new design.

## The orchestrator's corrections

- Finding 1 was fixed by P54, merged after this audit's base: each harness descriptor names a default program, and with only `config/` lanes `isHarnessAvailable` answers true for `opencode` and `agy` on this machine. The `.cmd` lookup in `programPath` stays as it is.
- Findings 6 and 7 are covered by P60 (reviews and the doctor read the room's lanes).
- Findings 2, 3, 9 and 10 go to P63; findings 4, 5 and 8 go to P64. The Auto sentence under "Also seen" goes to P64 too.
