# House rules for every agent

The bridge builds the prompt for each task from this file, `lanes.json` and the brief in `TASKS.md`. Change the rules here and every later prompt changes with them.

## About

MachineRoom is a React and three.js viewer that shows coding agents working on a project as a 3D room. It follows a local Paperclip instance through a small Node bridge. Several agents work on it in parallel, each in its own git worktree and branch. The orchestrator (Hermes from 0.1.90, Claude before) reviews and merges every branch.

## Rules

- Work only in your own worktree and branch. Never edit files in `C:\GitHub\MachineRoom`, the main checkout. Never switch branches there. Never push. Never merge into main.
- Touch only the files the task needs. If another file seems to need a change, stop and say so in your report.
- Plain words, short sentences. No em dashes. No single-line explanatory comments. No emoji in code or copy.
- Run `npm test` after every change and `npm run build` before you commit. Both must pass. If a test is red, stop and fix it before you go on.
- Add one line per change under `Unreleased` in `docs/agents/CHANGELOG.md`, unless the task lists the files you may touch and the changelog is not one of them.
- Never read, print, store or commit an API key or token.
- Never write the owner's Windows user name or a real home path into a file, a test, a fixture, a doc or a commit message, even inside an example command or a probe's output. Write `C:\Users\<name>` instead, and build a test path from `os.userInfo().username` at run time. `npm run history-audit` refuses a push that carries one.
- Stop every process you start and delete any scratch or log file you wrote.

## Report

Give the report in your reply, not in a file: the files you changed, the exact commands you ran with pass or fail, the number of tests before and after, anything in the brief that did not match the code, and what you could not verify. Do not claim a pass you did not run.
