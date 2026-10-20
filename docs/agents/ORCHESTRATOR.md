# Orchestrator guide

From 0.1.90 the orchestrator is Hermes, in its own interactive session in the main checkout `C:\GitHub\MachineRoom`. Claude held the role up to 0.1.90. The orchestrator reviews and merges every branch, writes the briefs, starts the Hermes and OpenCode lanes, builds AGY's prompt files and reports to the owner. It is the only agent that works in the main checkout.

Start a session with: `hermes` in `C:\GitHub\MachineRoom`, model `deepseek/deepseek-v4.1-flash-1017` at `xhigh`, toolsets `file,terminal`. First message: "You are the MachineRoom orchestrator. Read docs/agents/ORCHESTRATOR.md, then docs/agents/ARCHITECTURE.md and docs/agents/PLAN.md, then tell me what is running, what waits for review and what you will do next."

Before merging a branch that adds a route that writes (a merge, a backup, any write to Paperclip), ask the owner to have AGY on Gemini 4 Argon (free) read the diff and report problems without changing files, and weigh its answer with your own review. If DeepSeek credit runs low, `minimax/minimax-m3.1-flash:free` ran a Hermes task cleanly at no cost; use it for routine merges only.

## Standing rules from the owner

- Never push, and never merge into anything but `main` in this checkout. The owner pushes (G6).
- Never open or touch `C:\GitHub\coursework`. The owner's portfolio lives there; its look is written down in brief V2.
- Never change a Paperclip setting, start Paperclip or start a Paperclip agent run without the owner's yes in the same session. machine-room never starts Paperclip.
- Never read, print or store a key. `OPENROUTER_API_KEY` stays in the owner's shell.
- The owner deletes `C:\deepseek-harness` themselves.
- `Concepts/` holds the owner's reference stills. It stays out of git (`.gitignore`) and out of every pack.
- Fix only small review findings yourself (a few lines). Anything larger goes back to a lane as a brief.

## The loop

1. **Start a lane.** `npm run run-lane -- hermes ID` or `npm run run-lane -- opencode ID`, in the background, one task per lane at a time. The runner refuses a brief that is missing, repeated, marked merged, owned by another lane or whose branch already exists. Each run writes its log and a record under `%TEMP%\machineroom-runs\` and a recording you can open at `/?recording=NAME`. `npm run run-lane -- --list` shows the last runs and `--stats --since YYYY-MM-DD` the cost.
2. **AGY.** AGY's CLI cannot pick a model, so the owner starts it by hand. Build its prompt with `node scripts/agy-prompt.mjs ID`, which writes `agy-ID-prompt.txt` at the root of AGY's worktree (kept out of git by `.git/info/exclude` there); add `--clean` to delete the older prompt files first. Then tell the owner: "Tell AGY to read agy-ID-prompt.txt in its worktree root and do the task." The prompt names the model from `lanes.json`.
3. **Review.** Read the report at the end of the run output. Then `git log main..BRANCH` and `git diff main...BRANCH`. Check that only the brief's files changed, the brief's sentences are exact, and the review lessons below hold. Probe new routes and parsers with hostile input. AGY's UI work and anything visual: you cannot see the screen, so ask the owner to look before you merge (`npm run dev`, the page, and the exact things to check).
4. **Test.** `node scripts/test.mjs` (the same as `npm test`) and `node node_modules/vite/bin/vite.js build`. About half the full runs on this machine die inside Node with 0xC0000409; the test script runs them again up to three times. That is not a test failure. Run any new command for real once on this machine.
5. **Merge.** `git merge --no-ff --no-commit BRANCH`. The changelog merges by union, so check the top of `docs/agents/CHANGELOG.md` for a stray blank line. Make small fixes and add a `Review fix on ID:` line for each. Bump the version in `package.json`, lines 3 and 9 of `package-lock.json` and the `Version` line of `ARCHITECTURE.md`. Mark the brief `(LANE, merged as X)` in `TASKS.md` and move the lane's `Next:` in `PLAN.md` and the roadmap. Run `node node_modules/vitest/vitest.mjs run tests/briefs.test.js` after any edit to `TASKS.md`. Commit as `X: Merge LANE's TITLE (ID)`. Once the outcome log (C6a) is merged, record every review: `npm run outcome -- BRANCH merged --grade A- --fixes N`, or `rejected` with a `--note`.
6. **Next brief.** Search `TASKS.md` for the id first. One paragraph: the owner lane in the title, what and why, exact sentences for refusals and UI text, the tests by name, the files it may touch. A UI brief names the by-eye checks and the window sizes. A brief that spends money or writes to Paperclip says it needs the owner's yes.
7. **Report.** What merged, the grade, minutes and cost, what runs now, and what waits on the owner.

## Who owns what

| Lane | Model | Owns |
| --- | --- | --- |
| Hermes (worker runs in `C:\GitHub\MachineRoom-hermes`) | `deepseek/deepseek-v4.1-flash-1017`, xhigh | `src/model/**`, `src/briefs/**`, `src/live/**`, tests, small scripts |
| OpenCode (`C:\GitHub\MachineRoom-opencode`) | `opencode-go/deepseek-v4.1-flash`, max | `server/**`, `scripts/**`, `src/control/**`, `src/assistant/**`, `src/decider/**` |
| AGY (`C:\GitHub\MachineRoom-agy`) | Gemini 3.8 Flash High, Gemini 4 Argon Medium for design work (free) | `src/ui/**`, `src/styles.css`, `src/engine/**`, `src/Stage.jsx`, `src/App.jsx` |
| Orchestrator (this checkout) | as Hermes | `docs/agents/**`, merges, versions |

The forbidden paths per lane are in `docs/agents/lanes.json`; `buildPrompt` puts them in every prompt.

## Review lessons

- A lookup keyed by text from a request or a file (`lanes[name]`) must use `Object.hasOwn`, or `__proto__`, `constructor` and `toString` break it. This gap came back more than once.
- A thrown error inside an async route handler leaves the request hanging unless something answers 500.
- A fake runner in a test does not prove a command starts on Windows (`opencode` is an npm shim). Start it for real once.
- Any `git diff` the bridge runs needs `--no-ext-diff --no-textconv`.
- Agents pass their own tests and miss odd input. Hermes parser work can pin wrong behaviour in scenario tests: ask it to list every changed scenario line and why.
- AGY on Flash has skipped by-eye checks and left races (a task created, its thread opened, "not found"). Name the checks in the brief and have the owner look.
- AGY often uses an old version prefix in its commit. Renumber when you merge.
- CSS3D elements paint over the WebGL canvas unless the canvas sits on top with depth planes. Check depth by orbiting, not from the default angle.
- Run the brief tests after writing briefs: 0.1.85 shipped a red test because two briefs shared the id W3a.
- Bash heredocs on this machine eat backslashes. Write files with a tool, not a heredoc, when they hold Windows paths.

## Waiting on the owner

- **M1**: the exit test with a real Paperclip (a task from the drawer, the agent works in the room, its reply in the thread). Costs a few cents.
- **C0 stage 2**: Paperclip's `enableIsolatedWorkspaces`, so Paperclip agents work in their own worktrees.
- **D1**: `npm run decide-eval` with the owner's key, and the routing labels in `tests/probes/routing.js`.
- **S1**: recording subagent runs (spends money).
- **G2 and G6**: licence and names, then the private repository and every push. Run G1a (the history audit) first.
- A Node upgrade would likely end the 0xC0000409 crash.
