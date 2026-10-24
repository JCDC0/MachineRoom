# Orchestrator guide

The orchestrator is Claude, in Claude Code, in the main checkout `C:\GitHub\MachineRoom`. Claude held the role before 0.1.90 and from 0.1.124 to 0.1.162, Hermes from 0.1.90 to 0.1.123, and OpenCode from 0.1.163 to 0.1.259. The orchestrator reviews and merges every branch, writes the briefs, starts the worker lanes, checks UI branches by eye and reports to the owner. It is the only agent that works in the main checkout.

Start a session with `claude` in `C:\GitHub\MachineRoom`. First message: "You are the MachineRoom orchestrator. Read docs/agents/ORCHESTRATOR.md, then docs/agents/ARCHITECTURE.md and docs/agents/PLAN.md, then tell me what is running, what waits for review and what you will do next."

The worker lanes are separate. `npm run run-lane -- opencode ID` starts an OpenCode run in its own worktree, and the same command takes `opencode2` to `opencode5` and `claude`. One run per lane at a time. Your own session never works in those worktrees. The `claude` lane runs Claude Code headless; the orchestrator is the interactive Claude Code session in the main checkout.

The live lanes are `opencode`, `opencode2`, `opencode3`, `opencode4`, `opencode5` and `claude`. `hermes` and `agy` are retired in `docs/agents/lanes.json`: give them no brief and do not start them. To bring one back, remove `"retired": true` from its entry and check its `cli` block and model.

You cannot see the screen. A branch that changes what the room or the drawer looks like is checked by eye before it merges: run `npm run dev` in the branch's worktree, or `npm run build` and `npm run serve`, look at the named things at 1280 by 800 and 1024 by 768, report what you saw, change nothing, and stop the server. A branch that adds a route that writes (a merge, a backup, any write to Paperclip) gets a second read of the diff before the merge, and the owner is asked when in doubt.

## Where things stand

- `main` is 0.1.259; this docs branch is 0.1.260. The room follows lane runs (`--lanes`), task queues (`run-lane --queue` and several tasks in Dispatch) and the owner's Claude Code and OpenCode sessions (`--sessions`). Paperclip is optional. It was uninstalled on 2026-10-24 at the owner's word (`npm uninstall -g paperclipai`; `~\.paperclip` kept), and the lane runner is the room's source (`SOURCES.md`).
- When Paperclip does not answer, the drawer reads tasks, live runs and costs from the lane records. Approvals are empty then, and backups belong to Paperclip.
- The five OpenCode lanes and the `claude` lane are live, each with its own worktree. The OpenCode lanes each have their own `npm ci` and run the same model. Hermes and AGY are retired. Only the first OpenCode lane may start the real Paperclip, and only to check the shape of GET routes; everyone else uses `npm run fake-paperclip` on a free port.
- The room, version 3 (the owner's redesign, see `PLAN.md`), is merged. The planner loop runs in the drawer. The cost board is a screen panel at the bottom right (V19).
- The next milestone is the owner's queue on ulolTris, then LowBeam. H1 to H4 wait for the owner (`HARNESSES.md`).

## Standing rules from the owner

- Push only when the owner says yes for that push, and only `main` to `origin` (`git push origin refs/heads/main:refs/heads/main`), after `npm run history-audit` shows no finding in the new commits. Never merge into anything but `main` in this checkout.
- Never open or touch `C:\GitHub\coursework`. The owner's portfolio lives there; its look is written down in brief V2.
- Never change a Paperclip setting, start Paperclip or start a Paperclip agent run without the owner's yes in the same session. MachineRoom never starts Paperclip.
- Never read, print or store a key. `OPENROUTER_API_KEY` stays in the owner's shell.
- The owner deletes `C:\deepseek-harness` themselves.
- `Concepts/` holds the owner's reference stills. It stays out of git (`.gitignore`) and out of every pack.
- Fix only small review findings yourself (a few lines). Anything larger goes back to a lane as a brief.

## The loop

1. Start a lane. `npm run run-lane -- opencode ID` or `npm run run-lane -- opencode2 ID`, in the background, one task per lane at a time; two briefs with disjoint files can go to one run (`-- opencode2 Q1d G8`). Never start Hermes or AGY: they are retired, and the runner refuses them. The runner refuses a brief that is missing, repeated, marked merged, owned by another lane or whose branch already exists. A run on a brief writes its log and a record under `%TEMP%\machineroom-runs\` and a recording you can open at `/?recording=NAME`; a project or queue run writes no recording but shows live with `--lanes`. `npm run run-lane -- --list` shows the last runs and `--stats --since YYYY-MM-DD` the cost. Every new task gets a new session (the owner's rule): the runner starts a one-shot harness session (`opencode run` or `claude -p`) in that lane's own worktree, the prompt carries the house rules and the brief, and the agent reads its `AGENTS.md` and `docs/agents/ARCHITECTURE.md` first. Never continue an old session for a new task, and never start a lane in the main checkout.
2. A retired lane. Hermes and AGY have no brief. If the owner brings one back, remove `"retired": true` from its entry in `lanes.json`, check its `cli` block and model, and start it through `npm run run-lane` like any other lane. A project run through `--project` works too.
3. Review. Run `npm run review-lane -- LANE` first (see Review checker below). Read the report at the end of the run output. Then `git log refs/heads/main..BRANCH` and `git diff --no-ext-diff --no-textconv refs/heads/main...BRANCH`. Check that only the brief's files changed, the brief's sentences are exact, and the review lessons below hold. Probe new routes and parsers with hostile input. For UI work, check it by eye in a browser.
4. Test. `node scripts/test.mjs` (the same as `npm test`) and `node node_modules/vite/bin/vite.js build`. About half the full runs on this machine die inside Node with 0xC0000409; the test script runs them again up to three times. That is not a test failure. While several worker lanes run their own suites it can crash on all three tries; then run `node scripts/test.mjs --maxWorkers=1 --no-file-parallelism`, which takes about five minutes and does not crash. Run any new command for real once on this machine. After every push, read CI: `gh run list --limit 3 --repo JCDC0/MachineRoom`, and for a failure `gh run view ID --repo JCDC0/MachineRoom --log-failed`. CI runs on Linux too, where `LOCALAPPDATA` and `APPDATA` are not set: a test that starts a script must pass every Windows variable the script reads.
5. Merge. `git merge --no-ff --no-commit BRANCH`. The changelog merges by union, so check the top of `docs/agents/CHANGELOG.md` for a stray blank line. Make small fixes and add a `Review fix on ID:` line for each. Bump the version with `npm run bump -- X`, which sets `package.json`, the two version lines of `package-lock.json` and the `Version` line of `ARCHITECTURE.md` and prints each change. Mark the brief `(LANE, merged as X)` in `TASKS.md` and update the plan if the brief is listed there. Run `node node_modules/vitest/vitest.mjs run tests/briefs.test.js` after any edit to `TASKS.md`. Commit as `X: Merge LANE's TITLE (ID)`. Record every review: `npm run outcome -- BRANCH merged --grade A- --fixes N`, or `rejected` with a `--note`.
6. Next brief. Search `TASKS.md` for the id first. One paragraph: the owner lane in the title, what and why, exact sentences for refusals and UI text, the tests by name, the files it may touch. A UI brief names the by-eye checks and the window sizes. A brief that spends money or writes to Paperclip says it needs the owner's yes.
7. Report. What merged, the grade, minutes and cost, what runs now, and what waits on the owner.

## Review checker

`npm run review-lane -- LANE` turns the mechanical part of step 3 into checks. Run it first, in the main checkout, for every branch before you read the diff. LANE is a key in `lanes.json`; the script reviews the branch that lane's worktree is on. It prints one line per check with PASS, WARN or FAIL, the files and lines under each, and a summary line. It exits 1 when any check fails. Add `--json` for the same report as JSON.

- commits: the branch has commits ahead of `refs/heads/main` and the worktree has nothing uncommitted.
- paths: no changed file is in the lane's `forbidden` list (case and `.` or `..` folded).
- brief: each changed file is named in the `Files:` list of the brief in the newest run record for the branch. A branch with no record only gets a warning.
- added lines: FAIL for an em dash, a key, a Windows user path or an e-mail address; WARN for an emoji and for a font weight above 500 or bold. A key is never printed.
- package.json: FAIL for a new dependency, WARN for a new dev dependency.
- heuristics: WARN, in `server/`, `scripts/` and `src/`, for a bare `git` passed to a spawn call, a `main..` range or a bare `main` ref, a `git diff` without `--no-ext-diff` and `--no-textconv`, a fetch without a signal in `server/`, and a lookup by a name from a request or a file without `Object.hasOwn`. These match text, not meaning: each can be a false alarm, and a clean line proves nothing.
- changelog and commit messages: a line added under `## Unreleased`, and a version prefix on each commit.
- TASKS.md: the branch's `TASKS.md` parses with unique ids.
- merged result: a temporary worktree of `refs/heads/main` under the system temp folder, the branch merged into it with `--no-ff --no-commit`, then `npm test` and `npm run build` there with `node_modules` linked from the main checkout and no keys in the environment. It reports the test counts and removes the worktree. `--keep` leaves it for a look; delete its `node_modules` link before you remove it with `git worktree remove --force PATH`. This takes as long as a full test run and a build. A 0xC0000409 crash is retried as in `npm test`.

The script never merges into main, never pushes and never changes the main checkout or the lane worktree.

Then do the review yourself:

1. Read every FAIL and every WARN. A FAIL stops the merge until the lane or a small fix of yours clears it. For each WARN you accept, say why in the review.
2. Read the whole diff. The script does not check that the brief's sentences are exact, that the logic is right or that the tests test the right thing.
3. Probe odd input: `__proto__`, `constructor`, an empty value, a path with `..`, a huge body, a name that starts with `-`.
4. Have the owner check UI work by eye, with the exact things to look at.

A PASS is not a review.

## Who owns what

| Lane | Model | Owns |
| --- | --- | --- |
| Orchestrator (main checkout, Claude Code) | Claude Code | `docs/agents/**`, merges, versions |
| OpenCode (`C:\GitHub\MachineRoom-opencode`) | `opencode-go/deepseek-v4.1-flash`, max | `server/**`, `scripts/**`, `src/control/**`, `src/assistant/**`, `src/decider/**`; from 0.1.126 also the UI briefs moved from AGY (U6a, U7, U9, U10a), which the orchestrator checks by eye |
| OpenCode 2 to 5 (`C:\GitHub\MachineRoom-opencode2` to `-opencode5`) | `opencode-go/deepseek-v4.1-flash`, max | the same as OpenCode; small briefs by the routing policy |
| Claude (`C:\GitHub\MachineRoom-claude`) | Claude Sonnet | works on the brief in its own worktree and reports back |
| Hermes (retired) | `deepseek/deepseek-v4.1-flash-1017`, xhigh | its old work goes to OpenCode 2 |
| AGY (retired) | `gemini-3.8-flash-high` | `src/ui/**`, `src/styles.css`, `src/engine/**`, `src/Stage.jsx`, `src/App.jsx` when it works |

The forbidden paths per lane are in `docs/agents/lanes.json`; `buildPrompt` puts them in every prompt.

## Review lessons

- A screenshot brief that runs long goes stale under the merges around it. G4b branched at 0.1.191 and took 186 minutes; by its merge V19 had moved the cost board to a screen panel and the strip had become a straight striped line, so three of its five images show the old room. Brief screenshots last, on a quiet main, or retake only the images a later merge changes.
- In the sphere room, a clearance in 3D does not keep a screen panel clear. V18 kept every card's centre away from the cost board's bounding ball, as briefed, yet in the browser cards on nearer and farther shells still project over the board; moving the board beside the hub made it worse (13 cards over it against 3). Brief a panel that must stay readable in screen space, not as an obstacle in the scene.
- Decode any binary an agent writes into the code. V17's fish eye map was a base64 PNG whose second chunk had a garbage type and length, so the browser could not load it and the filter only shifted the picture; AGY's console checks read attributes and did not catch it. Generate such data in code, with a test.
- A probe budget must be measured at the size the room will really draw. V12's rows used the 39 cards the seeded tree has at depth 2, while V13 lets the room draw 300; the cold layout took about 1.2 seconds there and 0.4 ms in the probe.
- A CPU budget must count the child processes the change starts. P15 met "the bridge's CPU share" by polling with `git ls-files` back to back during a burst, which moved the cost into git (about one core per listing on this machine, measured on `ucrt64\bin\git.exe`, since `cmd\git.exe` is a wrapper and shows almost no CPU).
- A doc brief that says every command and number must appear in `ARCHITECTURE.md` makes the lane delete true lines that are not there. G3e took out `paperclipai run` and three true numbers to pass that check. Ask instead that every new or changed line be checked against the code or `ARCHITECTURE.md`.
- A layout brief needs a stillness bound beside its goal. P14 met "no overlap" and "a clean layout keeps its places" by repacking every card on any overlap and hiding the old places for the next warm start, so at 200,000 files the cards moved over 150 units on average in 253 of 399 layouts (main 52). Measure the mean move between layouts, the worst move and the tallest layout, old against new.
- A speedup in `layoutCards` must not add overlaps: count them over every fixture and recording, old against new, before merging. V10's shorter warm passes made the layout 4 times faster and left 45 overlapping pairs in 3027 layouts where main left 12. A cache key must hold everything the cached work reads: V10's layout key left out the faint folders, the `+ N more` line and the cost board's box.
- AGY's report can say a look was checked when it was not: V10's frame line came out in capitals at 0.85 white, because `.hud-title p` outranks one class. Read the computed style in the browser.
- An OpenCode lane's shell starts in the main checkout, not in its worktree, so each lane begins every command with `cd` to its worktree (a note in `lanes.json` says so). After every lane run, `git status` in the main checkout must be clean; on 2026-10-22 U20's first command, `cd C:\GitHub\MachineRoom-opencode 2>nul`, lost its backslashes in bash and left a file named `nul` here.
- AGY adds aliases and extra forms nobody asked for (V9's `motionHelper`, Q1e's `latestOnly.isLatest`). Cut them at the merge, with the tests that read them.
- A lookup keyed by text from a request or a file (`lanes[name]`) must use `Object.hasOwn`, or `__proto__`, `constructor` and `toString` break it. This gap came back more than once.
- A thrown error inside an async route handler leaves the request hanging unless something answers 500.
- A fake runner in a test does not prove a command starts on Windows (`opencode` is an npm shim). Start it for real once.
- Any `git diff` the bridge runs needs `--no-ext-diff --no-textconv`.
- Start git through `gitPath()`, never as a bare `git`, when its working folder is a lane worktree: Windows runs a `git.exe` committed there first (checked on this machine in 0.1.102). Name `refs/heads/main`, never `main`.
- A call to Paperclip from the bridge needs a time limit (`AbortSignal.timeout`), and a lane's code never gets the owner's keys (`laneEnv` in `scripts/candidate.mjs`).
- Agents pass their own tests and miss odd input. Hermes parser work can pin wrong behaviour in scenario tests: ask it to list every changed scenario line and why.
- AGY on Flash has skipped by-eye checks and left races (a task created, its thread opened, "not found"). Name the checks in the brief and have the owner look.
- AGY often uses an old version prefix in its commit. Renumber when you merge.
- CSS3D elements paint over the WebGL canvas unless the canvas sits on top with depth planes. Check depth by orbiting, not from the default angle.
- The CSS3D renderer sets each element's `display` from its object's `visible` on every frame, so hide a CSS3D element with `object.visible`, never `style.display` (V7b's callouts never hid).
- A chain of lane runs branches each run from main as it was when the run started, so a fix merged to main mid-chain reaches only the later runs, and an earlier run may fix the same thing its own way (U7 and `tests/plan.test.js`). Keep main's copy.
- Text from a model that we write into a file we parse again must be one line. A planner brief whose text held a blank line and `**Z9. ... (Hermes).**` became a second brief in `TASKS.md` that `parsePlan` never checked (C5d); `briefMarkdown` now writes one line.
- Run the brief tests after writing briefs: 0.1.85 shipped a red test because two briefs shared the id W3a.
- Bash heredocs on this machine eat backslashes. Write files with a tool, not a heredoc, when they hold Windows paths.

## Waiting on the owner

- A queue on ulolTris, then LowBeam. This is the next milestone.
- H1 to H4 from `HARNESSES.md`, when the owner says to start them.
- D1: `npm run decide-eval` with the owner's key, and the routing labels in `tests/probes/routing.js`.
- G2 and G6: licence and names, then the private repository and every push. Run G1a (the history audit) first.
- Whether to keep Paperclip as an optional source. Its approvals, budgets, quotas and backups have no replacement; the drawer reads tasks, live runs and costs from the lane records.
