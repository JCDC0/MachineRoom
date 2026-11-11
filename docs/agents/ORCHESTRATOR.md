# Orchestrator guide

The orchestrator is Claude, in Claude Code, in the main checkout `C:\GitHub\MachineRoom`. Claude held the role before 0.1.90 and from 0.1.124 to 0.1.162, Hermes from 0.1.90 to 0.1.123, and OpenCode from 0.1.163 until Claude took it back. The orchestrator reviews and merges every branch, writes the briefs, starts the worker lanes, checks UI branches by eye and reports to the owner. It is the only agent that works in the main checkout.

Start a session with `claude` in `C:\GitHub\MachineRoom`. First message: "You are the MachineRoom orchestrator. Read docs/agents/ORCHESTRATOR.md, then docs/agents/ARCHITECTURE.md and docs/agents/PLAN.md, then tell me what is running, what waits for review and what you will do next."

The worker lanes are separate. `npm run run-lane -- opencode ID` starts an OpenCode run in its own worktree, and the same command takes `opencode2`, `opencode3`, `agy`, `agy2`, `agy3` and `claude`. One run per lane at a time. Your own session never works in those worktrees. The `claude` lane runs Claude Code headless; the orchestrator is the interactive Claude Code session in the main checkout.

The live lanes are `opencode` to `opencode5`, `agy`, `agy2`, `agy3` and `claude`. On 2026-10-29 the owner cut OpenCode from ten lanes to three to spend less, and on 2026-11-04 brought `opencode4` and `opencode5` back, so `opencode6` to `opencode10` are retired in `docs/agents/lanes.json` with Hermes. `hermes` is retired: give it no brief and do not start it. The AGY lanes run Gemini Flash. On 2026-11-09 the owner sent every build brief and every batch review to the OpenCode lanes, and on 2026-11-10 gave `agy` and `agy2` work again on Gemini 3.8 Flash: backend, script and record briefs with exact steps, since a Flash run takes about twice as long as an OpenCode run and stalls now and then. `agy3` gets no brief, and batch reviews stay on OpenCode. To bring a retired lane back, remove `"retired": true` from its entry and check its `cli` block and model.

You cannot see the screen. A branch that changes what the room or the drawer looks like is checked by eye before it merges: run `npm run dev` in the branch's worktree, or `npm run build` and `npm run serve`, look at the named things at 1280 by 800 and wider only (the owner's order of 2026-11-01: no narrow or tablet checks), report what you saw, change nothing, and stop the server. A branch that adds a route that writes (a merge, a lane start, any write the bridge offers) gets a second read of the diff before the merge, and the owner is asked when in doubt.

## Where things stand

- 2026-11-11: `origin/main` is `4425cf40` and `main` is more than 50 commits ahead; a push waits for the batch review (P38) and the owner's yes. Merged since that push: P19 to P33 and P35 (the scale numbers, the five light hunts, the lane hunt, the first fixes for large repos, the idle bridge, lane routing in Dispatch, peak context in run records, the merge helper and the task archive). In flight: P34 (a short core for `ARCHITECTURE.md`) on `opencode`, P36 (a new file is listed by its path) on `opencode2`, P37 (a resting card costs the frame nothing) on `opencode3` and P38 (the batch review) on `opencode4`. Merge P34 before the others, since it rewrites `ARCHITECTURE.md` and every other merge adds a line to it. `opencode5`, `agy` and `agy2` are free. Open for the owner: the idle draw rate, which changes how the dust looks, and whether a task typed in Dispatch should get a tier from its text, since it names no files or tests and so always lands in the large tier.
- `main` is 0.1.401 and has been since 2026-10-29; a push waits for the owner's yes. Paperclip was removed from the app on 2026-10-24. The room's orchestrator runs in the app (K1 to K3, R3 and R4: Claude Code or OpenCode), and the page is a lens over the room with a dock below (I1, I2).
- Five OpenCode lanes (`opencode` to `opencode5`), three AGY lanes (`agy` and `agy2` on Flash with work again since 2026-11-10, `agy3` with none) and `claude` are live, each with its own worktree. `opencode6` to `opencode10` and Hermes are retired.
- Merged on 2026-10-30: the Direct API in Settings (H17, U85), the eye-check fixes (U86 to U88), the chat send and the undefined-name test (U89, T27), a stop that never kills a stranger (H19), an OpenCode run that stops with its process tree (H18), the run and wake fixes from the version 9 audit (Q15a, Q15b), the team-test fixes (O22 to O26), the MCP server and ACP agent checks (L6), and the test hunts (T26). The doc passes D15 and D16 are in the same list.
- The briefs in flight when the owner paused the lanes on 2026-10-27 were U71, U72 and U73. All three are merged (0.1.391, 0.1.392 and 0.1.395), so do not rerun them. Their partial edits may still be the five `git stash list` entries named `opencode partial work`, `opencode2 partial work`, `opencode3 partial work`, `U71 partial 2` and `U73 partial`; leave them unless a merged fix is missing. A stray `opencode.exe` service from an old run is not harmless if it holds a session: see the OpenCode service lesson below.
- Next: the findings of the November audits, then the open list in `docs/agents/PLAN.md`: the live room by eye, the open audit findings, and the owner's licence and release (P4).

## Standing rules from the owner

- Push only when the owner says yes for that push, and only `main` to `origin` (`git push origin refs/heads/main:refs/heads/main`), after `npm run history-audit` shows no finding in the new commits. Never merge into anything but `main` in this checkout.
- Never open or touch the owner's coursework folder, which holds the owner's portfolio; its look is written down in brief V2.
- Paperclip is gone from the room. Never start it or a fake of it.
- Start OpenCode only through `npm run run-lane` or the orchestrator, which pass `--standalone`. A hand-started `opencode run` without it keeps working in the OpenCode service after its terminal is gone.
- Never read, print or store a key. `OPENROUTER_API_KEY` stays in the owner's shell.
- The owner deletes `C:\deepseek-harness` themselves.
- `Concepts/` holds the owner's reference stills. It stays out of git (`.gitignore`) and out of every pack.
- Fix only small review findings yourself (a few lines). Anything larger goes back to a lane as a brief.
- After a shutdown, a new day means every harness quota is refilled (AGY, OpenCode and the rest), so plan all lanes back in. The exception is when the owner says a weekly quota is not refilled.
- Code goes to lanes as briefs (2026-10-31). The orchestrator's own edits are docs, briefs and review fixes of a few lines.
- A feature, or a change to how the room looks or behaves that the owner did not ask for, waits for the owner's yes before it is briefed. So does anything that spends money, any work for `agy3`, and a version bump or release. Reviews, merges of work the owner asked for, docs, hunts that change no code and stopping a lane do not wait.
- Keep `opencode` to `opencode5` busy: when a lane ends, review it, merge it and give it its next brief at once. `opencode6` and `opencode7` are experiment lanes for another model and get work only at the owner's word.
- On a merge run only the tests of the changed files. The full suite runs once before a push.
- An OpenCode lane reviews each merged batch before the owner is asked for a push, and the orchestrator reads each of its findings back against the code.
- Commands given to the owner are in PowerShell 5.1 syntax: no `&&`, one command per block.
- `C:\GitHub\MachineRoomTestProject` is the owner's folder for checks of the room by eye. Never push to another project's repository from here.

## The loop

1. Start a lane. `npm run run-lane -- opencode ID` or `npm run run-lane -- opencode2 ID`, in the background, one task per lane at a time; two briefs with disjoint files can go to one run (`-- opencode2 Q1d G8`). Never start Hermes: it is retired, and the runner refuses it. The AGY lanes are live backend workers. The runner refuses a brief that is missing, repeated, marked merged, owned by another lane or whose branch already exists. A run on a brief writes its log and a record under `%TEMP%\machineroom-runs\` and a recording you can open at `/?recording=NAME`; a project or queue run writes no recording but shows live with `--lanes`. `npm run run-lane -- --list` shows the last runs and `--stats --since YYYY-MM-DD` the cost. Every new task gets a new session (the owner's rule): the runner starts a one-shot harness session (`opencode run --standalone` or `claude -p`) in that lane's own worktree, the prompt carries the house rules and the brief, and the agent reads its `AGENTS.md` and `docs/agents/ARCHITECTURE.md` first. Before a brief starts, the runner reads the lane worktree's branch, moves it to a detached `refs/heads/main` when it has no commits ahead, and refuses it when its branch has commits `refs/heads/main` does not have, because that is another lane's unfinished work; the run record and summary name `main` as the starting branch. To pause a lane, run `npm run run-lane -- --stop LANE`: it stops the run, its harness and every process still working in that lane's worktree, and removes the lock, so no work goes on after the record ends. Never delete a lane lock to stop a run. Never continue an old session for a new task, and never start a lane in the main checkout.
2. A retired lane. Hermes has no brief. If the owner brings it back, remove `"retired": true` from its entry in `lanes.json`, check its `cli` block and model, and start it through `npm run run-lane` like any other lane. A project run through `--project` works too.
3. Review. A lane's end arrives as a notice from its background command: act on it at once. Read the report at the end of the run output. Then `git log --oneline refs/heads/main..BRANCH`, `git -C WORKTREE status --short` (it must be clean) and `git diff --no-ext-diff --no-textconv refs/heads/main...BRANCH`. Check that only the brief's files changed, the brief's sentences are exact, and the review lessons below hold. Open the `file:line` behind each claim of the report before you repeat it to the owner: two of the five hunts of 2026-11-10 had a finding that was half right. Probe new routes and parsers with hostile input. For UI work, check it by eye in a browser. `npm run review-lane -- LANE` (see Review checker below) does the mechanical checks and a full suite on the merged result; use it for a branch that touches the runner, a route that writes or more than ten files.
4. Test. On a merge, `git merge --no-ff --no-commit -q refs/heads/BRANCH`, then `npx vitest related --run` on the changed files, `npm run build`, and `npm run pack-check` when `scripts/`, `bin/` or `package.json` changed. Before a push, once: `node scripts/test.mjs` (the same as `npm test`), the build, `npm run pack-check` and `npm run history-audit -- --from origin/main`. A full run can die inside Node with 0xC0000409; the test script runs it again up to three times. That is not a test failure. While several worker lanes run their own suites it can crash on all three tries; then run `node scripts/test.mjs --maxWorkers=1 --no-file-parallelism`, which takes about five minutes and does not crash. A test that fails only under load and passes alone is load, not the branch: say so in the review. Run any new command for real once on this machine. After every push, read CI: `gh run list --limit 3 --repo JCDC0/MachineRoom`, and for a failure `gh run view ID --repo JCDC0/MachineRoom --log-failed`. CI runs on Linux too, where `LOCALAPPDATA` and `APPDATA` are not set: a test that starts a script must pass every Windows variable the script reads. `npm run merge-lane -- LANE` does this step and `npm run merge-lane -- LANE --finish --subject TEXT --line TEXT --grade G --fixes N --note TEXT --trailer TEXT` does the changelog line, the commit and the outcome of step 5; change `ARCHITECTURE.md` and make small fixes between the two, and the finish stages them.
5. Merge. With the merge from step 4 still uncommitted: make small fixes, add one line at the top of `## Unreleased` in `docs/agents/CHANGELOG.md` that ends with `(task ID)`, and change `ARCHITECTURE.md` in the same commit when a behaviour, a command or a measured number changed (a new doc also gets a line in its Documents list). For a hunt, append `## The orchestrator's corrections` to its audit file: which findings hold, which do not and why. Commit as `0.1.401: Merge ID, WHAT IT DOES`. Record every review: `npm run outcome -- BRANCH merged --grade A- --fixes N --note "..."`, or `rejected` with a `--note`. Then `git status --short` must be empty. The version has stayed at 0.1.401 since 2026-10-29: lanes commit as 0.1.402 on their branches, merges carry the 0.1.401 prefix, and `npm run bump` waits for the owner to ask for a release. Briefs are no longer marked merged in `TASKS.md`; the branch that still exists is what stops a second run. Run `node node_modules/vitest/vitest.mjs run tests/briefs.test.js` after any edit to `TASKS.md`.
6. Next brief. Search `TASKS.md` for the id first. One paragraph: the owner lane in the title, what and why, exact sentences for refusals and UI text, the tests by name, the files it may touch. A UI brief names the by-eye checks and the window sizes. A brief that spends money or writes to another service says it needs the owner's yes.
7. Report. What merged, the grade, minutes and cost, what runs now, and what waits on the owner.
8. Push, only at the owner's yes for that push. First an OpenCode lane reviews the merged batch (a Q brief: the merge diffs, at most 10 findings in a new `AUDIT-...-REVIEW-N.md`), you read each finding back and brief the fixes. Then the full checks of step 4, `git push origin refs/heads/main:refs/heads/main`, and read CI.

## Working method

Written on 2026-11-10 for whoever holds the role next, a smaller model included. Follow it as a checklist. When a rule here and your own habit disagree, the rule wins; when a rule here and the code disagree, fix the rule.

At the start of a session, before anything else:

1. `git status --short`, `git log --oneline -3` and `git rev-list --count origin/main..main` in the main checkout: is it clean, and how much is unpushed.
2. What is running: a `<lane>.lock` in `%TEMP%\machineroom-runs\` (the `orchestrator-*.lock` files are the room's own, leave them) and any `opencode` process. One `opencode serve --service` with no child is the owner's.
3. Each lane worktree: `git -C .worktrees/LANE status --short` is empty, and its branch is merged or waits for review.
4. Read `Where things stand` above, the newest section of `TASKS.md` and the top of the changelog. Then tell the owner what runs, what waits for review and what you will do next.

Reading. `ARCHITECTURE.md` is about 200 KB: never read it whole, search for the name you need and read around it. `TASKS.md` holds the briefs since 2026-11-09 and the older ones are in `history/TASKS-ARCHIVE.md`, over 1 MB, which you only search. `grep -n '^\*\*P24\.' docs/agents/TASKS.md` finds a brief, and the last `## ` heading of `TASKS.md` is the newest section. Before you name a new brief, search both files for its id. When `TASKS.md` grows past 150 KB, move its oldest sections to the archive, unchanged, and run `tests/briefs.test.js`.

Briefs:

- One set of files per lane in a round. End each brief with `Files:` and name in its first lines the files and folders other lanes hold. Two briefs that need the same file run one after the other.
- A usual OpenCode run ends in about 13 minutes (the median since 2026-10-28). Three to five numbered steps fit, with `Use no subagents`, `Commit each step as you finish it` and `stop starting new work at minute N`.
- Start the run with `--minutes` at the brief's stop minute plus 20: the brief's minute is where the lane stops starting new work, and the runner's limit, 100 by default, is what stops a run that hangs.
- Two small briefs that share no file can go to one run (`npm run run-lane -- LANE ID1 ID2`): one wait and one review less. From 2026-10-28 to 2026-11-10 this was never done, and a lane waited a median of 33 to 88 minutes for its next brief while a run took 13 (`AUDIT-2026-11-LANES.md`).
- Five lanes at once and no more: at five or more a run's median is 27 percent longer and nothing merges sooner.
- Give the exact sentences, names and budgets, and name each test by what it proves. Say which part of which doc to read and no more.
- A fix starts from a measured number and ends with the same tool's number before and after, both taken in that lane's own run, because the other lanes load the machine.
- A hunt changes no code and writes one audit file: at most 12 findings, each with `file:line`, a measured cost and the smallest fix, then at most three proposed briefs. Its proposals go to the owner as one ranked list with what each would change for them, and none starts before the owner's yes.
- A brief that measures time runs alone, or says its numbers are high: five lanes at once about doubled every timing on 2026-11-10. A brief that starts the headless Chromium keeps a core busy with software rendering, so keep its windows short and tell the owner it is running.
- Write a new brief to a scratch file and append that file to `TASKS.md`, since a heredoc breaks on an apostrophe. Then `npm run run-lane -- LANE ID --dry-run`, commit, and start.

Lanes:

- Start each lane as its own tracked background command, a few seconds apart. You are told when it ends: do not poll and do not sleep.
- After `npm run run-lane -- --stop LANE`, look for what the run left: a server on a port its brief named, a browser, the lock. Stop the server, then run the stop again to clear the lock.

This machine:

- `ARCHITECTURE.md` and `CHANGELOG.md` have CRLF line ends. Edit them with the editor tool or a script that keeps the line ends, and check that `git diff --stat` shows only the lines you meant.
- The built-in browser pane and a window in the background draw about one frame a second, so a frame time is real only with the owner's Brave window in front: ask for it. Reading text and the DOM works at any time.
- Never print a key, and never write a user path or a profile name into a tracked file: write `%TEMP%` and `%LOCALAPPDATA%`.

Saying it to the owner: the answer and its number first, in plain words, then what was not done or not checked, and at most one question.

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
| OpenCode (`C:\GitHub\MachineRoom\.worktrees\opencode`) | `opencode-go/deepseek-v4.1-flash`, max | `server/**`, `scripts/**`, `src/control/**`, `src/assistant/**`, `src/decider/**`, and the UI briefs moved from AGY at 0.1.126: `src/ui/**`, `src/styles.css`, `src/engine/**`; the orchestrator checks UI work by eye |
| OpenCode 2 to 5 (`C:\GitHub\MachineRoom\.worktrees\opencode2` to `opencode5`; 6 to 10 retired on 2026-10-29) | `opencode-go/deepseek-v4.1-flash`, max | the same as OpenCode; small briefs by the routing policy |
| Claude (`C:\GitHub\MachineRoom\.worktrees\claude`) | Claude Sonnet | works on the brief in its own worktree and reports back |
| Hermes (retired) | `deepseek/deepseek-v4.1-flash-1017`, xhigh | its old work goes to OpenCode 2 |
| AGY (`C:\GitHub\MachineRoom\.worktrees\agy`, `agy2` and `agy3`) | `gemini-3.8-flash-high` | `agy` and `agy2` take backend, script and record briefs again since 2026-11-10, at the owner's word, and `agy3` takes none; `src/ui/**`, `src/styles.css`, `src/engine/**`, `src/Stage.jsx` and `src/App.jsx` are forbidden to it |

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
- An OpenCode session started without `--standalone` lives in the OpenCode background service, not in the process tree. Killing the CLI leaves the session working, and the service can resume it and keep writing when it next starts. On 2026-10-30 a probe's session did this in the main checkout and kept editing files after its run had stopped. Lane runs and orchestrator turns pass `--standalone` (H18). A command started by hand, or by an older build, does not: stop its session with `opencode api POST /api/session/SESSION/interrupt`, using the session id in its log, or stop the service, then check `git status` in every folder it could reach before you trust the tree.
- AGY adds aliases and extra forms nobody asked for (V9's `motionHelper`, Q1e's `latestOnly.isLatest`). Cut them at the merge, with the tests that read them.
- A lookup keyed by text from a request or a file (`lanes[name]`) must use `Object.hasOwn`, or `__proto__`, `constructor` and `toString` break it. This gap came back more than once.
- A thrown error inside an async route handler leaves the request hanging unless something answers 500.
- A fake runner in a test does not prove a command starts on Windows (`opencode` is an npm shim). Start it for real once.
- Any `git diff` the bridge runs needs `--no-ext-diff --no-textconv`.
- Start git through `gitPath()`, never as a bare `git`, when its working folder is a lane worktree: Windows runs a `git.exe` committed there first (checked on this machine in 0.1.102). Name `refs/heads/main`, never `main`.
- A call from the bridge to another program needs a time limit (`AbortSignal.timeout`), and a lane's code never gets the owner's keys (`laneEnv` in `scripts/candidate.mjs`).
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

- The licence and the public release (P4): the licence and names (G2), then the private repository and every push (G6). Run the history audit first.
- The owner's yes for any push, after `npm run history-audit` shows no finding in the new commits.
- D1: `npm run decide-eval` with the owner's key, and the routing labels in `tests/probes/routing.js`.
