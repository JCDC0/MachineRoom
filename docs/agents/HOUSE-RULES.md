# House rules for every agent

The bridge builds the prompt for each task from this file, `lanes.json` and the brief in `TASKS.md`. Change the rules here and every later prompt changes with them.

## About

MachineRoom is a React and three.js viewer that shows coding agents working on a project as a 3D room. It follows the room's own lane runs, task queues and the owner's Claude Code and OpenCode sessions through a small Node bridge. Paperclip was removed on 2026-10-24. Several agents work on it in parallel, each in its own git worktree and branch. The orchestrator is Claude, in Claude Code, and it reviews and merges every branch.

## Rules

- Work only in your own worktree and branch. Never edit files in `C:\GitHub\MachineRoom`, the main checkout. Never switch branches there. Never push. Never merge into main.
- Touch only the files the task needs. If another file seems to need a change, stop and say so in your report.
- Plain words, short sentences. No em dashes. No single-line explanatory comments. No emoji in code or copy.
- Run only the tests for what you changed: `npx vitest related --run <changed files>` and any test file you changed, then `npm run build` before you commit. Both must pass. Do not run the full `npm test`: several lanes share one computer, and the orchestrator runs the full suite once before each push. If a test is red, stop and fix it before you go on.
- Add one line per change under `Unreleased` in `docs/agents/CHANGELOG.md`, unless the task lists the files you may touch and the changelog is not one of them.
- Never read, print, store or commit an API key or token.
- Never write the owner's Windows user name or a real home path into a file, a test, a fixture, a doc or a commit message, even inside an example command or a probe's output. Write `C:\Users\<name>` instead, and build a test path from `os.userInfo().username` at run time. `npm run history-audit` refuses a push that carries one.
- Stop every process you start and delete any scratch or log file you wrote.
- Use what your own harness gives you: its skills, tools, subagents and search, whenever they help the brief. The rules here still hold for what you change.

## Report

Give the report in your reply, not in a file: the files you changed, the exact commands you ran with pass or fail, the number of tests before and after, anything in the brief that did not match the code, and what you could not verify. Do not claim a pass you did not run.
