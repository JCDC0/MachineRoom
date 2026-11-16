# Review 44

Reviewed `66c4da38..ba2a37a9`, P415 to P422. Two P2 findings remain.

## R44-1 P2: Main's harness replaces a lane's own harness

File: `src/ui/agentContext.js:240`; callers: `src/ui/Inspector.jsx:132` and `src/ui/AgentDock.jsx:51`.
What goes wrong: The new harness and model override runs for anything that `isOrchestratorAgent` recognises. That helper also matches names containing `orchestrat`. A Codex lane named `Codex orchestrator helper` therefore shows Main's Claude harness and Opus model. A sub named `UI orchestrator` has the same problem in AgentDock. The sub Inspector itself passes null for Main and is safe.
How to see it: Call `agentContext` with that Codex lane and an orchestrator row `{ id: 'orchestrator', harness: 'claude', model: 'opus' }`. The result has `harness: 'claude'` and `model: 'opus'`. An in-memory probe reproduced both the lane and sub cases, with only the unused terminal functions stubbed.
Fix: Apply the new harness and model override only when the selected agent's identity is Main. Add a lane-name and sub-name regression test.

## R44-2 P2: The runbook promises a notification that is never sent

File: `docs/agents/FREE-HIERARCHY.md:45`; repeated at line 24; code: `server/reviews.js:367`.
What goes wrong: The new text says an unread changed-file list posts one message to the parent for that head. The catch returns 409 before `warnOutsideScope` runs. A parent relying on that message never learns that the merge needs its attention.
How to see it: Make the scope diff throw. The catch returns `outside: true` and an empty file list with zero calls to the warning helper. An in-memory probe confirmed this. The existing failed-read API test checks the refusal and override but never checks delivery.
Fix: Say that only a confirmed outside-scope change sends the parent message. Describe the failed read separately as a refusal with an owner or parent override.

## Checks

- Seven focused test files passed 45/45: Codex modes, harness models, help parsing, inline styles, inspector harness, scope reviews and sub restore.
- The inbox group in `review-39-fixes.test.js` passed 9/9, with three unrelated tests skipped. `agent-context.test.js` passed 32/32. Total: 86 passed.
- Compared the old and new inbox functions on 7,200 cases. All outputs matched and stayed within 8,000 characters. Cases included colon and spaced senders, 80 and 81 character names, word cuts, whitespace, quotes, backslashes and Unicode.
- AGY and OpenCode still run `models` directly. Only Codex and Copilot consult the changed help parser. The supplied synthetic help and model-output fixtures passed. No real Copilot help fixture was found; installed CLI help was not run.
- Scope-read failures now reach Merge anyway. Other merge refusals still need the scope marker or the existing scope sentence to enter that flow. The API still checks who may override.
- The restore test now writes its foreign session after removal and checks both saved conversation identifiers and both session types. The new substantive regression assertions cover the changed behavior. No restore mutation run was performed.
- Scope and worktree classes and the Codex Edits sentence passed their focused checks. The build passed with the large-chunk warning.
- Only this audit was written. No source or test changed. No full suite or visual check was run. Visual checks remain with the orchestrator.

Checked and fine
