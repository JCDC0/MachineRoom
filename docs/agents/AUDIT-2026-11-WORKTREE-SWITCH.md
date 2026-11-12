# Audit of the worktree branch switch on 2026-11-12

Date: 2026-11-12. Version read: 0.1.401. Branch: `feat/p87-why-a-lane`. Brief: P87. Commit prefix: `0.1.402`.

On 2026-11-12 at 21:04 the `opencode` lane committed P75 on `feat/p75-the-runner-commits`. At 21:05 the runner crashed with `ENOENT ... runs.jsonl` because a disk cleanup had emptied the temp folder. At 21:06:26 the reflog of `.worktrees/opencode` showed:
`checkout: moving from feat/p75-the-runner-commits to feat/p70-the-fixes-from`

This audit investigated what switched `.worktrees/opencode` to that older branch.

## Can code in the repository switch to an older run record's branch?

No. Nothing in the codebase switches a worktree to a branch named in an older run record when the newest record is missing.

Every place in the repository that runs `git switch` or `git checkout` was inspected:
- `scripts/run-lane.mjs:247`: `runnerCommit` runs `git switch -c <branchFor(brief)>` on the brief's own new branch.
- `scripts/run-lane.mjs:333`: `prepareWorktree` runs `git switch --detach <sha>` when setting up a worktree for a project run.
- `scripts/run-lane.mjs:439`: `projectRunRepo` runs `git switch -c <name>` for project queue branches.
- `scripts/run-lane.mjs:616`: `laneWorktreeStart` runs `git checkout --detach refs/heads/main` before a run starts, if `move: true`.
- `scripts/run-lane.mjs:906-907`: `runQueue` error handler runs `git switch <startBranch>` to restore a project's original branch if a queue fails.
- `scripts/scale-live.mjs:759`: `git checkout -- <files>` restores tracked files in a benchmark checkout.
- `scripts/scale-live.mjs:774`: `git switch -c p19-review` creates a temporary review branch in the benchmark checkout.
- `server/git.js:504`: `POST /api/git/switch` runs `git switch -- <branch>` on the project checkout viewed by the room, only upon user action in the browser.

When `run-lane.mjs` crashed at line 1386 (`appendFileSync(runsFile(), ...)`), the exception propagated straight to `main().catch(...)` and the process exited. No cleanup handler ran, and no code fell back to older records in `runs.jsonl`. MachineRoom contains no code that reads run records to switch branches.

## What actually switched the branch

The switch was performed by an autonomous OpenCode agent inside a resumed background session, triggered when Claude Code inspected OpenCode sessions without `--standalone`.

The exact sequence was traced through `~/.claude/projects/C--GitHub-MachineRoom/c0cd2ca2-1c31-47eb-9217-4ead9188b5fe.jsonl`, `~/.local/share/opencode/log/opencode.log`, and `~/.local/share/opencode/opencode.db`:

1. At 21:04:35, OpenCode completed brief P75. At `scripts/run-lane.mjs:247`, `runnerCommit` created `feat/p75-the-runner-commits` and committed the changes (`c2ae2507` and `8ac55e8e`).
2. At 21:05:01, `scripts/run-lane.mjs:1386` crashed on `appendFileSync` because `%TEMP%\machineroom-testbench` had been deleted. The P75 run record was never written to `runs.jsonl`.
3. At 21:05:57, the orchestrator (Claude Code) investigated why P75 failed and ran:
   `$oc = "$env:APPDATA\npm\node_modules\@opencode\cli\bin\opencode.exe"; & $oc session list`
   (Claude transcript line 38107).
4. Calling `@opencode/cli` without `--standalone` started the daemon process `opencode serve --service` at 21:06:02.911 (`opencode.log:72275`, run `d6e306bb`, role `server`).
5. On startup, `opencode serve --service` booted location services, discovered `C:\GitHub\MachineRoom\.worktrees\opencode`, and resumed suspended sessions found in `opencode.db`.
6. At 21:06:03.079, it resumed session `ses_e30ee76deffeOlYFmBRhdBE9xx` (an interrupted P70 session from earlier that day) and injected a synthetic message:
   `"The server restarted while you were working. Continue from where you left off without repeating completed work."` (`session_message` seq 79, timestamp `1794488763079`).
7. The DeepSeek model in that session woke up (seq 81). At seq 90 it ran `git status` and saw the worktree sitting on `feat/p75-the-runner-commits`. At seq 99 it saw the branch `feat/p70-the-fixes-from` already had commits.
8. At seq 108, the model reasoned:
   `"A previous run of this task already made commits on the branch feat/p70-the-fixes-from, before the server restarted. But the worktree is currently on feat/p75-the-runner-commits at 8ac55e8e... Safest: do not disturb other work. The P75 branch is committed and clean. I can switch to my existing feat/p70 branch and continue. That's what the brief instructs."`
9. At 21:06:26.503, the resumed agent spawned PowerShell:
   `git status --short; git switch feat/p70-the-fixes-from; git status --short; git log --oneline -5`
   (`opencode.log:72415`).
10. That command switched the worktree and produced the reflog entry in `.worktrees/opencode`.

## When it can happen again

It can happen whenever:
1. `opencode` CLI is executed without `--standalone`, or `opencode serve --service` is started.
2. An older session in `~/.local/share/opencode/opencode.db` remained unclosed or suspended while associated with a shared worktree path (such as `.worktrees/opencode`).
3. OpenCode's auto-resume feature sends the synthetic restart prompt to the session, and the agent decides to restore its original branch.

## The smallest fix

1. Always pass `--standalone` when invoking `opencode` commands (`opencode session list --standalone`, `opencode export ... --standalone`). This prevents `opencode serve --service` from starting and resuming old sessions.
2. In `scripts/run-lane.mjs:1386`, ensure the directory exists before appending:
   `mkdirSync(dirname(runsFile()), { recursive: true })`
   This prevents `run-lane` from crashing when the runs folder is emptied during a run.
3. Stop any background `opencode serve --service` processes before starting lane runs:
   `Stop-Process -Name opencode -ErrorAction SilentlyContinue`
