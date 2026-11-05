# Contributing to MachineRoom

MachineRoom is a React and three.js viewer that shows coding agents working on one project as a 3D room in your browser.

The canonical guide is [docs/agents/ARCHITECTURE.md](docs/agents/ARCHITECTURE.md). The rules for every agent are in [docs/agents/HOUSE-RULES.md](docs/agents/HOUSE-RULES.md). The order of work is in [docs/agents/PLAN.md](docs/agents/PLAN.md) and the briefs are in [docs/agents/TASKS.md](docs/agents/TASKS.md). The code is the first authority, then ARCHITECTURE.md, then every other doc.

## Setup

Run these commands to set up and run the project:

```
npm install
npm run dev
npm run build
npm run preview
npm run serve
```

`npm run dev` serves the viewer on port 5173 with Vite and no build. It needs a bridge for live data. Run `npm run build` once, start `npm run serve -- up --lanes` in another terminal with `MACHINEROOM_ORIGINS=http://localhost:5173` set in its environment so the bridge allows the dev page, then open `http://localhost:5173/?live&bridge=http://127.0.0.1:5174`.

`npm run build` then `npm run serve` serves the built viewer and the bridge on one port with no Vite.

`npm run preview` serves the built viewer through Vite on port 4173 with no bridge. Run `npm run build` first.

The project folder defaults to the folder you start in. Pass `--root <folder>` or set `PROJECT_ROOT` to name another. The bridge listens on port 5174 by default. Pass `--port <n>` or set `PORT` to change it.

## Making and checking a change

Several agents work on MachineRoom in parallel, each in its own git worktree and branch. Follow these rules for every change:

- Work only in your own worktree and branch. Never edit files in the main checkout. Never switch branches there.
- One branch per task, in the agent's own worktree.
- Touch only the files the task needs. If another file seems to need a change, stop and say so in your report.
- Start each commit message with the version prefix, such as 0.1.402, followed by one plain sentence.
- Use plain words and short sentences. No em dashes. No bold text. No emoji in code or copy. No single-line explanatory comments.
- Never read, print, store or commit an API key or token.
- Never write the owner's Windows user name or a real home path into a file, a test, a fixture, a doc or a commit message. Write `C:\Users\<name>` instead, and build test paths from `os.userInfo().username` at run time.
- Stop every process you start and delete any scratch or log file you wrote.
- Run only the tests for what you changed: `npx vitest related --run <changed files>` and any test file you changed, then run `npm run build` before you commit. Both must pass.
- Do not run the full `npm test` before each commit. Several lanes share one computer, and the orchestrator runs the full test suite once before each push.
- Never push to a remote. Never merge into main. The orchestrator reviews and merges each branch.

## Checks

Run these checks to verify the codebase:

```
npm test
npm run build
npm run serve -- doctor --root <your project folder>
npm run history-audit
npm run pack-check
```

- `npm test` runs vitest in Node with no browser needed.
- `npm run build` builds the client bundle and catches broken imports.
- `npm run serve -- doctor --root <folder>` checks the project folder, git, the runs folder and the lane programs, starts nothing, and exits 1 when a check fails.
- `npm run history-audit` scans main, the tags and the tracked files for keys, e-mail addresses, Windows user paths, the profile name and private folder paths. A key is never printed. It exits 1 on any finding.
- `npm run pack-check` checks what an npm pack would hold. It fails on a file the one-port command needs but the pack leaves out, and on `.env`, tests, recordings, dev tools, `node_modules`, `.git` or logs in the pack.
- Continuous integration runs `npm test`, `npm run build`, `npm run pack-check` and `npm run history-audit` on Ubuntu and Windows.
- To compare decision models, see [docs/agents/DECIDER-EVAL.md](docs/agents/DECIDER-EVAL.md).

## Working with lanes

A lane is one agent on one harness. On this repository, each lane has its own worktree and branch, listed in `docs/agents/lanes.json`.

The live lanes are `opencode` to `opencode5`, `agy`, `agy2`, `agy3` and `claude`. `opencode6` and `opencode7` are experiment lanes trying `opencode/crouton-alpha-free` at high reasoning. `opencode8` to `opencode10` and `hermes` are retired, so `npm run run-lane` refuses them.

### Running a lane on a brief

Run a lane on an open brief from the terminal:

```
npm run run-lane -- opencode <brief>
```

- Add `--dry-run` to print the command without starting it.
- `--list` prints the last 10 run records.
- `--stats` (with `--since YYYY-MM-DD`) prints runs, minutes and cost per lane and model.
- `--model` and `--reasoning` change the model for that run only.
- `--minutes N` sets the time limit, 100 by default.

### Stopping a lane run

To stop a running lane:

```
npm run run-lane -- --stop <lane>
```

This stops that lane's run, its harness and every process still working in its worktree, prints what it stopped and removes the lock. A new run refuses a live harness child or a worktree leftover and names `--stop`.

### Recording an outcome

Record what happened to a lane run:

```
npm run outcome -- <branch> merged --grade A-
```

This records the result in `outcomes.jsonl` beside `runs.jsonl`. `npm run run-lane -- --outcomes [--since YYYY-MM-DD]` prints the outcome table.

### Trying a candidate beside the stable room

To test a lane's build beside the stable room:

```
npm run candidate -- <lane>
```

This builds that lane's worktree and serves it on port 5175 beside the stable room. It refuses a lane with no worktree, a worktree with uncommitted changes, or a port in use. See [docs/agents/CANDIDATE.md](docs/agents/CANDIDATE.md).

### Cleaning worktrees

List or clean the lane worktrees inside a project:

```
npm run worktrees -- --project <folder>
npm run worktrees -- --project <folder> --clean
```

This lists each `<project folder>/.worktrees/<lane>` with its branch, commits ahead of the project branch, uncommitted changes and merge status. `--clean` removes only clean, merged worktrees with `git worktree remove`. It never deletes a branch and leaves a lane whose lock file names a live process.

### Reviews and merges

Press `C` or click CONTROL in the room to open Reviews. Each lane shows its branch, commits ahead, files and last run. Click a row to see the diff.

The orchestrator reviews lane branches against `refs/heads/main` using `npm run review-lane -- <lane>`. It checks commits ahead, uncommitted changes, forbidden paths, brief file lists, em dashes, keys, user paths, email addresses, emoji, bold text, dependencies, lint rules, commit prefixes and tests.

The bridge merges one lane at a time. It requires a clean main checkout on main, a clean lane and the lane's exact head. It merges with a fast forward or straight-line history, makes no merge commit, and never pushes.

### Harness notes

- Bringing a retired lane back: remove `"retired": true` from its entry in `docs/agents/lanes.json`. Then check its `cli` block, executable path and model.
- Adding a Direct API lane: a Direct API lane names a saved endpoint in its `cli.endpoint` and runs on the `machineroom` harness through `scripts/mr-agent.mjs`. Add its key and endpoint in Settings under Direct API, then pick its model in the family tree.
- Adding an ACP lane: any Agent Client Protocol agent can be added as a lane with its own `cli.bin` and args in `docs/agents/lanes.json`. It runs through `scripts/acp-run.mjs`.
- See [docs/agents/HARNESSES.md](docs/agents/HARNESSES.md) for the harness registry and descriptors.

## Recordings

Every run started with `npm run run-lane` on a brief writes a recording under `public/recordings/` when it ends and prints `room: /?recording=<name>`.

A project run and a queue run write no recording. They show live in the room with `--lanes`.

The name is the run's log name. `public/recordings/index.json` lists the last 50 recordings, newest first, with lane, briefs, model, start time, minutes, exit code, frame count and tool call count.

To turn run 1 of the lane run list into a recording again:

```
npm run run-recording -- 1
```

The built room serves recordings from `dist/recordings`. Run `npm run build` again after a new recording is written.

See [docs/agents/RECORDING.md](docs/agents/RECORDING.md) for how runs become recordings, fixture generation and replay limits.

## Big repositories

The room was measured on seeded trees of 40000 and 200000 files.

- `GET /api/tree` holds about 0.6 MB in the folder shape at 40000 files, and 115 KB gzipped. At 200000 files it holds about 3.1 MB, and 570 KB gzipped.
- The answer carries a version. A page's first tree event holds only the files added since the list it read, and each later event only the files that page has not had.
- Shell commands and Hermes reads look names up from an index (`src/model/fileIndex.js`), so they cost the same at any repository size.
- The flat ring places the top-level cards in one pass, and each folder's children go on their own shotgun grid. The room runs the layout when a card appears, leaves or changes size, or a clicked folder changes, and a warm start keeps every card whose parent and slot did not change.
- The overview fits the hub, the root and the top-level cards, so the cards are small in the overview. Follow mode is the way to read the card an agent touches.
- `npm run scale-probe` times each stage of the room on a seeded tree in memory against performance budgets, including 16 ms work per frame, 1 second load time and 2 MB for a tree event. `--files` and `--folders` change its size.
- `npm run scale-live` builds a seeded git checkout and times the bridge under load.
- Open `/?replay&scale=200000&fps` to test the room on a large seeded tree. The frame line appears at the top of the dock's agent column below 900 pixels.
