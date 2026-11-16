# Review 45

Reviewed `ba2a37a9..562a7441`, P423 to P426. Two findings remain.
The reviewed server, source and test files match the current checkout.

## R45-1 P1: Other server git calls still use the parent's repository

File: `server/git.js:101`. Also `server/index.js:152` and `server/index.js:193`, `server/runs.js:108` and `server/runs.js:132`, `server/orchestrators.js:94`, and `server/orchestrator.js:1596`.
What goes wrong: P423 strips repository overrides only in mainCheckoutOf. These other calls retain GIT_DIR, GIT_WORK_TREE, GIT_INDEX_FILE and GIT_COMMON_DIR. A bridge started inside a merge or hook can read the parent's branches, index and scope changes instead of its selected project's. The git API also uses this runner for branch writes at `server/git.js:519`, so a confirmed switch can target the wrong repository.
How to see it: Resolve this worktree's absolute git directory with `git rev-parse --absolute-git-dir`. Set GIT_DIR to that path and call server/git.js defaultGitRunner on a plain temporary folder with `rev-parse --absolute-git-dir`. It returns the inherited directory; without the variable it rejects. A read-only probe confirmed this. No branch write was attempted.
Fix: Strip all four names at every server git spawn through one shared environment helper, while keeping each caller's other environment settings.

## R45-2 P2: Copies of the environment filter already disagree

File: `server/reviews.js:105`; copies: `server/lanes-source.js:166` and `tests/helpers/gitEnv.js:1`.
What goes wrong: The new source filter and test helper remove four names, but the existing review filter removes only three. GIT_COMMON_DIR still redirects the review runner's shared refs and objects. A valid lane can become unreadable, and a foreign common directory can supply the wrong repository data to review checks.
How to see it: In this linked worktree, set GIT_COMMON_DIR to the path from `git rev-parse --absolute-git-dir`, then call the review runner with `rev-parse HEAD`. It rejects because that per-worktree directory is not the common repository. Clearing the variable makes the same call succeed. A read-only probe confirmed both results; mainCheckoutOf also succeeds with that variable present.
Fix: Replace the separate filter loops with the shared four-name helper from R45-1 and test each override against the review runner.

## Checks

- Six focused files passed 175/175: git, bridge, lane source, inspector harness, agent context and review scope. No tests were added or removed.
- The two notice waits still require `{ topic: 'git' }`, and the tree test still requires the exact file lists. Every changed wait has the test's abort signal and a finite 60-second test limit. A missing notice or hung request cannot pass.
- P425 keeps a named lane and sub on their own harness and model. Main still takes its live harness and model. Inspector and AgentDock both use the checked helper; context numbers and autocompact retain the earlier rule.
- FREE-HIERARCHY.md lines 24 and 45 match scopeRefusal: unread files refuse without a message, confirmed outside-scope files warn once per head, and the owner or parent can allow either refusal.
- Native assertions reproduced both git defects and checked mainCheckoutOf isolation and the test helper's case-insensitive removal of all four names.
- The build passed through `npm.cmd run build`, with the existing large-chunk warning. The first test invocation used a missing local Vitest entry; `npx.cmd --no-install vitest run` found the parent installation and passed. PowerShell blocked npm.ps1; npm.cmd worked.
- Only this audit was written. No full suite, load run, mutation run or visual check was done. Visual checks remain with the orchestrator. Git stayed read-only and the audit is uncommitted.

Checked and fine
