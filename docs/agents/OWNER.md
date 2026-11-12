# What the owner wants, and how to act on it

Read this before you answer the owner or brief work for them. It is short on purpose. It holds what the owner has said the room is for, the design they settled, and the steps for one of their concerns. A smaller model follows it as a checklist. When this file and the code disagree, fix this file.

## What the room is for

- The owner has several AI subscriptions, each locked in its own program. MachineRoom lets them work on one project together, and shows that work as a clear picture: who touches which file, now.
- The owner's room holds the orchestrator and the lanes the owner makes, one lane per subscription. It never holds a fleet of copies of one program.
- The fleet in `docs/agents/lanes.json` is the orchestrator's own tool for building MachineRoom. It runs in the testbench (`ORCHESTRATOR.md`, loop step 0) and never appears in the owner's room.
- The proof of the room is other projects: ulolTris first, the small one, then Lowbeam. Nothing is pushed to them from here.

## Settled, do not reopen

- Colours: white is activity, yellow is active, red is failure, green is finished, blue is the web. Fonts are Jost and Space Mono at 400 and 500, never bold.
- The tunnel is grey. One star in the agent's colour travels a line, and the label and the row flash wait for it to land. Nothing sprays points or dust.
- Camera brackets in an agent's colour mean that agent touches the file. A touch flashes only the file row. A failure flashes the card red.
- Stars, labels and flashes run on replay time: they hold on pause and clear on a seek.
- The room is checked at 1280 by 800 and wider. No narrow or tablet checks.
- CI stays on Ubuntu and Windows.

## One concern from the owner, step by step

1. Say the concern back in one sentence, as the result the owner wants, not as the symptom. When two readings fit, ask one question before any change. Example of the wrong reading: the owner deleted lanes from their room, the tools then refused those lanes, and the orchestrator put the lanes back. The owner wanted them gone from their room and run somewhere else.
2. Find the cause in the code. `architecture/CODE.md` names the file that owns a behaviour; search it, do not read whole docs.
3. Sort it. A bug, or a thing the owner asked for: brief it. A new feature, a change of look or behaviour they did not ask for, a cost, a push or a release: ask first.
4. Never fix a concern by changing the owner's room: no lane added, restored or hidden there, no file moved or deleted in `%LOCALAPPDATA%\MachineRoom\runs`, no key read or copied.
5. A fix of a few lines is yours. Anything larger is a brief for a lane (`ORCHESTRATOR.md`, Briefs).
6. A change the owner sees is not done until it was seen on screen. Say which window size, and say when only tests were run.
7. Report: the answer first in plain words, then what was not done or not checked, then at most one question.

## What saves time and tokens

- Read `ORCHESTRATOR.md` sections `Where things stand`, `The loop` and `Working method`, and nothing else until a task needs it. Search large files (`TASKS.md`, `CHANGELOG.md`, the audits) for an id or a name; never read them whole.
- Use the scripts, not hand-made git: `npm run merge-lane -- LANE` runs the merge and the checks, and `--finish` writes the changelog line, the outcome and the commit.
- On a merge run only the tests of the changed files. The full suite runs once before a push.
- Give reviews, full suites and flaky-test hunts to an OpenCode lane, and read each finding back against the code.
- Start lanes as tracked background commands and wait for the notice. Do not poll and do not sleep.
- Join output-heavy commands with `| Select-Object -Last 5` or `| tail -5`. A passing check needs one line.
- Commands for the owner are in PowerShell 5.1: no `&&`, one command per block.
