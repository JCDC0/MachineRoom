# Orchestrator guide

The orchestrator is Claude, in Claude Code, in the main checkout `C:\GitHub\MachineRoom`. It reviews and merges every branch, writes the briefs, starts the worker lanes, checks UI branches by eye and reports to the owner. It is the only agent that works in the main checkout.

Start a session with `claude` in `C:\GitHub\MachineRoom`. First message: "You are the MachineRoom orchestrator. Read docs/agents/ORCHESTRATOR.md and docs/agents/OWNER.md, then docs/agents/ARCHITECTURE.md and docs/agents/PLAN.md, then tell me what is running, what waits for review and what you will do next."

How to read this file: `Where things stand`, `Rules`, `Session start` and `The loop` first, every session. The other sections are looked up when their step comes. Each rule is in one place only. Who held the role when, and the lessons that no longer apply, are in `history/ORCHESTRATOR-ARCHIVE.md`.

## Where things stand

Rewrite this section at every merge and before you end a session. Keep it under ten lines: what is pushed, what is unpushed, what runs, what waits on the owner, what is next.

- 2026-11-14, afternoon: everything merged is pushed at `72f7ed60` (read CI first with `gh run list --limit 3 --repo JCDC0/MachineRoom`). The full suite at `8652616e` passed on the first try (`RUN-2026-11-14-SUITE-2.md`, 5,294 passed).
- Since `12c25524`: P249 to P305, except P256 (scale rerun, waits for a quiet machine) and P276 (rejected: U158 scrolls on purpose). Reviews 31, 32 and 33 are closed: P272 to P275, P285 to P288 and P300 to P305 fixed their findings.
- Lowbeam runs through MachineRoom at the owner's word (2026-11-14): `TRIAL-LOWBEAM.md` (P296) is the plan. The six October Lowbeam worktrees hold work that is on Lowbeam `main` (patch text differs only in comments and doc wording); removing them waits for the owner's yes. Never push Lowbeam.
- Nothing runs at this rewrite.
- The fleet at the owner's word: `opencode` to `opencode5` on DeepSeek V4.1 Flash, `agy` and `agy2` on Hydrogen, `codex` on GPT-6.1 Terra high (reviews and single-file briefs; its sandbox cannot stop processes), `native` and `native2` for reports.
- Open for the owner: two check commands in one check field and the queue's commit format for projects like Lowbeam (features); the Lowbeam row of the workspace guide.
- Known and accepted: a backup that spawns and fails at once still shows as moved (its own record shows the failed start); the history audit flags `OPENAI_API_KEY: value` in `tests/conversation.test.js`, a test fixture.
- Push: the owner gave a standing yes for this work on 2026-11-14. A new session asks again.

## Rules

From the owner. None bends without the owner's word.

Never:

- Push without the owner's yes for that push. Only `main` to `origin`: `git push origin refs/heads/main:refs/heads/main`, after `npm run history-audit -- --from origin/main` shows no finding. Never merge into anything but `main` in this checkout. Never push to another project's repository.
- Read, print, store or copy a key. `OPENROUTER_API_KEY` stays in the owner's shell and the owner's `keys.json` stays where it is.
- Change the owner's room: `%LOCALAPPDATA%\MachineRoom\runs` and the lanes of `config/`. No lane added, restored or hidden there, no file moved or deleted (loop step 0).
- Open or touch the owner's coursework folder. Its look is written down in brief V2.
- Write a user path, a profile name or a real e-mail address into a tracked file. Write `%TEMP%`, `%LOCALAPPDATA%`, `C:\Users\<name>` and `example.com`.
- Start Paperclip or a fake of it. It is gone from the room.
- Start OpenCode by hand. Only `npm run run-lane` or the room's orchestrator start it, because they pass `--standalone`.
- Put `Concepts/` into git or a pack. It holds the owner's reference stills.
- Delete `C:\deepseek-harness`. The owner does that.

Ask the owner first:

- A feature, or a change to how the room looks or behaves that the owner did not ask for.
- Anything that spends money, any work for `agy3`, a version bump or a release.
- Reviews, merges of work the owner asked for, docs, hunts that change no code and stopping a lane need no yes.

Always:

- Code goes to lanes as briefs. Your own edits are docs, briefs and review fixes of a few lines; a larger finding goes back to a lane.
- Keep `opencode` to `opencode5` busy: when a lane ends, review it, merge it and give it its next brief at once. Five lanes at once is the default: at five or more a run's median is 27 percent longer and nothing merges sooner. On 2026-11-12 the owner asked for twelve at once (six OpenCode, three AGY, Codex, two native) to double the pace before a shutdown; run more than five only at the owner's word, and say timings are high.
- On a merge run only the tests of the changed files. The full suite runs once before a push.
- An OpenCode lane reviews each merged batch before the owner is asked for a push, and you read each finding back against the code.
- A new day after a shutdown means every harness quota is refilled, unless the owner says a weekly quota is not.
- Check the room at 1280 by 800 and wider only. `C:\GitHub\MachineRoomTestProject` is the owner's folder for checks by eye.
- Commands given to the owner are in PowerShell 5.1: no `&&`, one command per block.
- Say it to the owner like this: the answer and its number first, in plain words, then what was not done or not checked, and at most one question. The steps for one of the owner's concerns are in `OWNER.md`.

## Session start

Before anything else:

1. In the main checkout: `git status --short`, `git log --oneline -3` and `git rev-list --count origin/main..main`. Is it clean, and how much is unpushed.
2. What is running: a `<lane>.lock` in the testbench `%LOCALAPPDATA%\MachineRoom\testbench\` (moved out of `%TEMP%` on 2026-11-12, after a disk cleanup emptied it), and any `opencode` process. One `opencode serve --service` with no child is the owner's. After a shutdown that service can resume an old lane session that writes in a worktree, so check before you start lanes.
3. Each lane worktree: `git -C .worktrees/LANE status --short` is empty, and its branch is merged or waits for review.
4. Read `Where things stand`, the newest section of `TASKS.md` and the top of the changelog. Then tell the owner what runs, what waits for review and what you will do next.

Reading:

- `ARCHITECTURE.md` is a short core. Its detail is in six files under `architecture/`: read the core, then search the one detail file its table names.
- `TASKS.md` holds the briefs since 2026-11-09. `grep -n '^\*\*P24\.' docs/agents/TASKS.md` finds a brief, and the last `## ` heading is the newest section.
- `history/TASKS-ARCHIVE.md` holds the older briefs. It is over 1 MB: search it, never read it.
- `CHANGELOG.md` and the audit files: search for an id or a name.
- When `TASKS.md` grows past 150 KB, move its oldest sections to the archive, unchanged, and run `tests/briefs.test.js`.

## The loop

Step 0. Work in the testbench, never in the owner's room.

- The owner's room is `%LOCALAPPDATA%\MachineRoom\runs` with the lanes of `config/`: the orchestrator and the lanes the owner makes, one per subscription.
- Every lane command of yours (`run-lane`, `merge-lane`, `outcome`, `review-lane`, `worktrees`, `hand-run`, `candidate`, `run-recording`) starts with these two variables, so its records, logs, locks and lanes stay in the testbench:

```
$env:MACHINEROOM_RUNS = "$env:LOCALAPPDATA\MachineRoom\testbench"; $env:MACHINEROOM_LANES_DIR = "docs/agents"
```

- Without them the tools read the owner's room and refuse the fleet lanes. That refusal is correct: set the variables, do not change the room.
- To watch the fleet, serve a second room with the same two variables on its own port.

Step 1. Start a lane.

- Move the lane to main first: `git -C .worktrees/LANE switch --detach refs/heads/main`.
- Try it: `npm run run-lane -- LANE ID --dry-run`.
- Start it as a tracked background command: `npm run run-lane -- LANE ID --minutes N`, with N at the brief's stop minute plus 20. The runner's own limit is 100.
- One run per lane at a time. Two small briefs with no shared file can go to one run: `npm run run-lane -- LANE ID1 ID2`. That is one wait and one review less.
- Start lanes a few seconds apart. You are told when each ends: do not poll and do not sleep.
- The runner refuses a brief that is missing, repeated, owned by another lane or whose branch already exists. It refuses a retired lane. It refuses a worktree whose branch has commits main does not have, because that is unfinished work.
- Every task gets a new session in the lane's own worktree. Never continue an old session for a new task, and never start a lane in the main checkout.
- A run on a brief writes its log, a record and a recording you can open at `/?recording=NAME`. `npm run run-lane -- --list` shows the last runs and `--stats --since YYYY-MM-DD` the cost.
- To stop a lane: `npm run run-lane -- --stop LANE`. It stops the run, its harness and every process in that worktree, and removes the lock. Never delete a lock by hand. Afterwards look for what the run left (a server on a port its brief named, a browser), stop it, and run the stop again.
- To bring a retired lane back, at the owner's word: remove `"retired": true` from its entry in `lanes.json` and check its `cli` block and model.

Step 2. Review, as soon as the lane's end is announced.

- Read the report at the end of the run output.
- `git log --oneline refs/heads/main..BRANCH`
- `git -C .worktrees/LANE status --short` must be empty.
- `git diff --no-ext-diff --no-textconv refs/heads/main...BRANCH`
- Check: only the brief's files changed, the brief's sentences are exact, and the review lessons below hold.
- Open the `file:line` behind each claim of the report before you repeat it to the owner. Two of the five hunts of 2026-11-10 had a finding that was half right.
- Probe new routes and parsers with odd input (see Review checker).
- UI work is checked by eye in a browser at 1280 by 800 or wider: `npm run dev` in the branch's worktree, or `npm run build` and `npm run serve`. Look at the named things, report what you saw, change nothing, stop the server.
- A branch that adds a route that writes gets a second read of its diff, and the owner is asked when in doubt.
- For a branch that touches the runner, a route that writes or more than ten files: `npm run review-lane -- LANE`.

Step 3. Merge and test.

- `npm run merge-lane -- LANE` merges with `--no-ff --no-commit` and runs `vitest related` on the changed files, the build, and `pack-check` when `scripts/`, `bin/` or `package.json` changed. It leaves the merge uncommitted.
- A test that fails only under load and passes alone is load, not the branch: say so in the review.
- Run any new command for real once on this machine.

Step 4. Fix and write the docs, with the merge still uncommitted.

- Make small fixes.
- Change the architecture docs when a behaviour, a command or a measured number changed. Edit the detail file under `docs/agents/architecture/` (`ROOM.md`, `COMMANDS.md`, `CODE.md`, `LIVE.md`, `ACTIVITIES.md`, `LIMITS.md`). Edit the core `ARCHITECTURE.md` only for a new command or folder. A new doc gets a line in `architecture/DOCUMENTS.md`.
- For a hunt, append `## The orchestrator's corrections` to its audit file: which findings hold, which do not and why.
- `git add` what you changed.

Step 5. Finish.

```
npm run merge-lane -- LANE --finish --subject TEXT --line TEXT --grade G --fixes N --note TEXT --trailer TEXT
```

- It writes the changelog line under `## Unreleased` (it must end with `(task ID)`), the commit `0.1.401: Merge ID, WHAT IT DOES` and the outcome record.
- For a branch you do not merge: `npm run outcome -- BRANCH rejected --note "..."`.
- Then `git status --short` must be empty.
- The version stays 0.1.401: lanes commit as 0.1.402 on their branches, merges carry the 0.1.401 prefix, and `npm run bump` waits for the owner to ask for a release.
- Rewrite `Where things stand`.

Step 6. Next brief, at once (see Briefs).

Step 7. Report: what merged, the grade, minutes and cost, what runs now, and what waits on the owner.

Step 8. Push, only at the owner's yes for that push.

1. An OpenCode lane reviews the merged batch: a Q brief with the merge diffs, at most 10 findings in a new `AUDIT-...-REVIEW-N.md`. Read each finding back and brief the fixes.
2. `node scripts/test.mjs` (the same as `npm test`), `npm run build`, `npm run pack-check`.
3. `npm run history-audit -- --from origin/main` must show no finding.
4. Ask the owner. On a yes: `git push origin refs/heads/main:refs/heads/main`.
5. Read CI: `gh run list --limit 3 --repo JCDC0/MachineRoom`, and for a failure `gh run view ID --repo JCDC0/MachineRoom --log-failed`.

## Briefs

- Search `TASKS.md` and the archive for the id before you name a brief.
- One paragraph, then three to five numbered steps. The title names the owner lane. Say what and why, the exact sentences for refusals and UI text, the names and budgets, and each test by what it proves.
- Start with what to read and no more: `Read no part of TASKS.md beyond this brief`. Add `Use no subagents`, `Commit each step as you finish it` and `stop starting new work at minute N`. A usual OpenCode run ends in about 13 minutes.
- End with `Files:`. One set of files per lane in a round, and name the files other lanes hold. Two briefs that need the same file run one after the other.
- A UI brief names the by-eye checks and the window sizes. A brief that spends money or writes to another service says it needs the owner's yes.
- A brief that runs long commands says `run every command in the foreground`. A lane that ends its turn while its own command still runs leaves nothing.
- A fix starts from a measured number and ends with the same tool's number before and after, both taken in that lane's own run.
- A brief that measures time runs alone, or says its numbers are high: five lanes at once about doubled every timing on 2026-11-10. A brief that starts the headless Chromium keeps a core busy, so keep its windows short and tell the owner it is running.
- A hunt changes no code and writes one audit file: at most 12 findings, each with `file:line`, a measured cost and the smallest fix, then at most three proposed briefs. Its proposals go to the owner as one ranked list, and none starts before the owner's yes.
- Write a new brief to a scratch file and append that file to `TASKS.md`, keeping its line ends. Then run `node node_modules/vitest/vitest.mjs run tests/briefs.test.js`, the dry run, commit, and start.
- Briefs are not marked merged in `TASKS.md`. A branch left from a failed run blocks the same id: delete the empty branch or take a new id.

## This machine

- `ARCHITECTURE.md`, `CHANGELOG.md` and `TASKS.md` can have CRLF line ends. Edit them with a script that keeps the line ends, and check that `git diff --stat` shows only the lines you meant.
- A heredoc can eat backslashes and breaks on an apostrophe. Write a file that holds Windows paths with a tool.
- Never type a git command that switches the main checkout (`git checkout NAME --`, `git switch`), never use a bare `git stash`, and never `cd` into a lane worktree: use `git -C .worktrees/LANE`.
- The built-in browser pane and a window in the background draw about one frame a second. A frame time is real only with the owner's Brave window in front: ask for it. Reading text and the DOM works at any time.
- Give reviews, full suites and flaky-test hunts to an OpenCode lane. Join output-heavy commands with `| Select-Object -Last 5`: a passing check needs one line.

## When things go wrong

- A full run dies inside Node with 0xC0000409: the test script runs it again up to three times, and it is not a test failure. If it dies on all three while lanes run their own suites: `node scripts/test.mjs --maxWorkers=1 --no-file-parallelism`, about five minutes.
- Every test passed and `Errors 1`: an unhandled rejection, a component that set state after its window was torn down. Read the `Unhandled Errors` block first.
- A CI job times out in code the push did not touch: `gh run rerun --failed` once before any hunt.
- A test passes here and fails on Ubuntu: Linux has no `APPDATA` or `LOCALAPPDATA` and uses forward slashes. The test sets the variables itself, passes them to any script it starts, and builds no Windows path with `path.join`.
- The history audit fails on an old unpushed commit: it reads every new commit, not the last tree. Make a backup branch, then `git filter-branch --tree-filter` on `origin/main..main`. `git rebase -r` drops the fixes made inside merges.
- A test wrote into a real runs folder: `tests/helpers/isolate.js` must set `MACHINEROOM_RUNS` for every test. Clean the testbench of what it left.
- An AGY run is far past its size: it has likely stalled on a subagent. Stop it and give the brief to OpenCode.
- An OpenCode session keeps writing after its run stopped: it was started without `--standalone` and lives in the OpenCode service. Stop it with `opencode api POST /api/session/SESSION/interrupt` using the id in its log, or stop the service. Then check `git status` in every folder it could reach.
- A lane's worktree moved to an old branch with no lane running: an OpenCode command without `--standalone` (even `opencode session list`) started `opencode serve --service`, which resumed an old session that then acted in the worktree (2026-11-12, `docs/agents/AUDIT-2026-11-WORKTREE-SWITCH.md`). Pass `--standalone` to every OpenCode command you run by hand.
- A file named `nul`, or any stray file, in the main checkout after a lane run: a lane's command lost its `cd`. Delete the file and check `git status`.
- A prepared merge is gone and the reflog shows `reset: moving to HEAD`: a room's own orchestrator woke on a lane's end and ran `git merge --abort` in the main checkout (2026-11-12, P79). Any bridge started with `--lanes` on the testbench wakes its orchestrator that way, so start none of your own while lanes run; check a page by eye on `npm run dev` with `?replay`, or on a bridge with a temporary runs folder. Finish a merge right after preparing it. merge-lane reads the branch from the lane's worktree, so switch the worktree to main only after the merge.

## Review checker

`npm run review-lane -- LANE` does the mechanical checks of step 2 and a full suite on the merged result. LANE is a key in `lanes.json`; the script reviews the branch that lane's worktree is on. It prints one line per check with PASS, WARN or FAIL and exits 1 when any check fails. `--json` gives the same report as JSON. It never merges, never pushes and never changes the main checkout or the lane worktree.

- commits: the branch has commits ahead of `refs/heads/main` and the worktree has nothing uncommitted.
- paths: no changed file is in the lane's `forbidden` list.
- brief: each changed file is named in the `Files:` list of the brief in the newest run record for the branch. A branch with no record only gets a warning.
- added lines: FAIL for an em dash, a key, a Windows user path or an e-mail address; WARN for an emoji and for a font weight above 500 or bold.
- package.json: FAIL for a new dependency, WARN for a new dev dependency.
- heuristics: WARN for a bare `git` passed to a spawn call, a `main..` range or a bare `main` ref, a `git diff` without `--no-ext-diff` and `--no-textconv`, a fetch without a signal in `server/`, and a lookup by a name from a request or a file without `Object.hasOwn`. These match text, not meaning.
- changelog and commit messages: a line added under `## Unreleased`, and a version prefix on each commit.
- TASKS.md: the branch's `TASKS.md` parses with unique ids.
- merged result: a temporary worktree of `refs/heads/main`, the branch merged into it, then `npm test` and `npm run build` there with no keys in the environment. It takes as long as a full test run. `--keep` leaves the worktree for a look; delete its `node_modules` link before you remove it with `git worktree remove --force PATH`.

Then do the review yourself. A PASS is not a review.

1. Read every FAIL and every WARN. A FAIL stops the merge until the lane or a small fix of yours clears it. For each WARN you accept, say why.
2. Read the whole diff. The script does not check that the sentences are exact, that the logic is right or that the tests test the right thing.
3. Probe odd input: `__proto__`, `constructor`, an empty value, a path with `..`, a huge body, a name that starts with `-`.
4. Have the owner check UI work by eye, with the exact things to look at.

## Who owns what

| Lane | Model | Owns |
| --- | --- | --- |
| Orchestrator (main checkout) | Claude Code | `docs/agents/**`, merges, versions |
| `opencode` to `opencode5` (`.worktrees\opencode` to `opencode5`) | `opencode-go/deepseek-v4.1-flash`, max | `server/**`, `scripts/**`, `src/**`, tests; reviews, full suites and hunts |
| `claude` (`.worktrees\claude`) | Claude Sonnet | the brief it is given, in its own worktree |
| `codex` (`.worktrees\codex`) | the Codex app's default model | the brief it is given; `src/Stage.jsx` and `src/App.jsx` are forbidden to it. Its sandbox keeps git and the main checkout read-only: it edits files only, cannot run vitest or the process tests, and the orchestrator commits its work (`git -C .worktrees/codex switch -c BRANCH`, add, commit) and tests it at the merge |
| `agy`, `agy2` (`.worktrees\agy`, `agy2`) | `gemini-4-hydrogen-high` (3.8 Flash before 2026-11-13) | backend, script and record briefs with exact steps; `src/ui/**`, `src/styles.css`, `src/engine/**`, `src/Stage.jsx` and `src/App.jsx` are forbidden to it. A Flash run takes about twice as long as an OpenCode run |
| `opencode6`, `opencode7` | `opencode-go/deepseek-v4.1-flash`, max | as `opencode`, when more lanes are needed (the owner's word, 2026-11-12) |
| `agy3` | | no work without the owner's word |
| `opencode8` to `opencode10`, `hermes` | | retired; the runner refuses them |

The forbidden paths per lane are in `docs/agents/lanes.json`; `buildPrompt` puts them in every prompt.

## Review lessons

Each is a defect that reached a branch at least once. The story behind each is in `history/ORCHESTRATOR-ARCHIVE.md`.

In a diff of `server/` or `scripts/`:

- A lookup keyed by text from a request or a file (`lanes[name]`) uses `Object.hasOwn`, or `__proto__`, `constructor` and `toString` break it. This gap came back more than once.
- A thrown error inside an async route handler leaves the request hanging unless something answers 500.
- Any `git diff` the bridge runs needs `--no-ext-diff --no-textconv`.
- Git starts through `gitPath()`, never as a bare `git`, when its working folder is a lane worktree. Name `refs/heads/main`, never `main`.
- A call from the bridge to another program needs a time limit (`AbortSignal.timeout`), and a lane's code never gets the owner's keys (`laneEnv`).
- Text from a model that is written into a file we parse again must be one line.
- Decode any binary an agent writes into the code (a base64 image, a table). Better: generate it in code, with a test.
- A cache key must hold everything the cached work reads.

In tests:

- Agents pass their own tests and miss odd input. Probe it yourself.
- A fake runner in a test does not prove a command starts on Windows (`opencode` is an npm shim). Start it for real once.
- A test must never write into a real runs folder or read the real lane list (`tests/helpers/isolate.js`).
- A test that waits on a process waits for the process (`waitUntil`), not for a fixed sleep.
- A change to `docs/agents/lanes.json` is code: tests read the real lane list. Run `npx vitest related --run docs/agents/lanes.json` and `tests/plan.test.js` before you commit it.

In a brief that sets a budget:

- Measure at the size the room will really draw, not at the size of the seed.
- A CPU budget counts the child processes the change starts. A poll that calls git moves the cost into git.
- A layout goal needs a stillness bound beside it: measure the mean and worst move between layouts, old against new. A layout speedup must not add overlaps: count them over every fixture and recording.
- A doc brief asks that every new or changed line be checked against the code. It never asks that every number appear in one file, or the lane deletes true lines.
- Screenshots are briefed last, on a quiet main, or they go stale under the merges around them.

By eye:

- A lane's report can say a look was checked when it was not. Read the computed style in the browser.
- CSS3D elements paint over the WebGL canvas unless the canvas sits on top with depth planes. Check depth by orbiting, not from the default angle.
- Hide a CSS3D element with `object.visible`, never `style.display`: the renderer sets `display` every frame.
- A change to tunnels, touches or agent effects keeps the settled design in `OWNER.md`.

Lane habits:

- An OpenCode lane's shell starts in the main checkout, so each lane begins every command with `cd` to its worktree. After every lane run, `git status` in the main checkout must be clean.
- AGY adds aliases and extra forms nobody asked for. Cut them at the merge, with the tests that read them.
- AGY often uses an old version prefix in its commit. Renumber when you merge.
- Codex in its sandbox cannot write git, cannot run vitest (Vite writes into the main checkout's `node_modules`) and cannot start the processes the stop tests start. Its test report means nothing: run the tests yourself before you grade it. Brief it work that does not need a test run to be right, or say in the brief that the orchestrator runs them.
- AGY on Flash has skipped by-eye checks and left races. Name the checks in the brief and have the owner look.
- A chain of lane runs branches each run from main as it was when the run started, so an earlier run may fix the same thing its own way. Keep main's copy.

## Changing this guide

- Whoever holds the role may change this file, in a commit of its own, and says so in the report to the owner.
- A rule under `Rules` came from the owner. Change or drop one only at the owner's word, and write the date beside it.
- Add a lesson when a defect reached a merge or cost a rerun: one or two sentences, under the heading where it will be looked up. Put the story in the archive, not here.
- Drop a lesson when its subject is gone from the code: move it to `history/ORCHESTRATOR-ARCHIVE.md`, unchanged.
- Each rule is in one place. Before you add one, search for it. When this file passes 30 KB, cut it back.
- When a rule and the code disagree, fix the rule. When a rule and your habit disagree, the rule wins.
- What the next model needs goes here or in `OWNER.md`, not in a private memory: other models cannot read that.

## Waiting on the owner

- The licence and the public release (P4): the licence and names (G2), then the private repository and every push (G6). Run the history audit first.
- The owner's yes for any push.
- D1: `npm run decide-eval` with the owner's key, and the routing labels in `tests/probes/routing.js`.
