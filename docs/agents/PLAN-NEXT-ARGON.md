# Next eight briefs for the free hierarchy

Ranked from largest gap closed to smallest against `docs/agents/FREE-HIERARCHY.md`, `docs/agents/HIERARCHY.md`, `docs/agents/UI-FRIENDLY.md`, and the current code on `main`.

## 1. Mode picker for lanes in Agents and Dispatch (needs the owner's yes)

- **Gap**: `server/agents-config.js:403` never saves `cli.mode` on an owner-made lane and `src/ui/panels/DispatchPanel.jsx:843` has no mode picker, so the owner cannot set a lane's default permission mode or pick a mode per run in the room.
- **Files**: `server/agents-config.js`, `src/ui/FamilyTree.jsx`, `src/ui/panels/DispatchPanel.jsx`, `src/ui/panels/runs.js`, `tests/agents-config.test.js`, `tests/control-panels.test.js`.
- **Tests**: Saving a custom lane in `tests/agents-config.test.js` persists `cli.mode` in `agents.json`, and starting a project run in `tests/control-panels.test.js` sends the chosen `mode` to `POST /api/control/runs`.
- **Size**: One lane run, 25 minutes.
- **Harness**: Codex Terra.

## 2. Sub orchestrator scope and restriction controls in Agents (needs the owner's yes)

- **Gap**: `src/ui/FamilyTree.jsx:143` hardcodes `scope: ['**']` and `restricted: false` when creating a sub orchestrator and `src/ui/FamilyTree.jsx:1918` offers no scope or restriction fields when editing one, so sector file boundaries cannot be set in the UI.
- **Files**: `src/ui/FamilyTree.jsx`, `src/ui/ladderForm.js`, `tests/family-tree-ui.test.js`, `tests/ladder-form.test.js`.
- **Tests**: Creating or editing a sub orchestrator in `tests/family-tree-ui.test.js` saves custom `scope` globs and `restricted: true` through `saveLadder` and renders them when the sub editor reopens.
- **Size**: One lane run, 25 minutes.
- **Harness**: Codex Terra.

## 3. Feed unread lane inbox messages into native harness turns

- **Gap**: `scripts/mr-agent.mjs:1502` runs tool calls in a loop without reading `GET /api/orchestrator/messages` for `MACHINEROOM_LANE_TICKET`, so a running native lane never sees an orchestrator or owner reply unless the model polls with `curl` by hand.
- **Files**: `scripts/mr-agent.mjs`, `tests/mr-agent.test.js`.
- **Tests**: A multi-step run in `tests/mr-agent.test.js` with `MACHINEROOM_BRIDGE` and `MACHINEROOM_LANE_TICKET` set appends unread inbox replies from the bridge as a user message before the next model turn.
- **Size**: One lane run, 25 minutes.
- **Harness**: AGY Hydrogen.

## 4. Keep lane messaging active after a failover to a backup lane

- **Gap**: `scripts/run-lane.mjs:1772` strips the lane messaging instructions on failover and `scripts/run-lane.mjs:1878` drops `MACHINEROOM_LANE_TICKET` and `MACHINEROOM_BRIDGE` because `server/runs.js:856` binds the ticket only to the primary lane.
- **Files**: `server/runs.js`, `scripts/run-lane.mjs`, `tests/lane-messages.test.js`, `tests/run-lane.test.js`.
- **Tests**: A failover run in `tests/lane-messages.test.js` rebinds the ticket to the backup lane, keeps `MACHINEROOM_LANE_TICKET` in the backup environment, and delivers the backup lane's `POST /api/orchestrator/messages` post from the backup lane.
- **Size**: One lane run, 25 minutes.
- **Harness**: AGY Hydrogen.

## 5. Worktree choice for chat lane dispatch and split runs (needs the owner's yes)

- **Gap**: `server/index.js:817` forces `worktree: true` on every chat message sent to a lane in a git checkout and `src/ui/panels/runs.js:307` hardcodes `worktree: true` in `startSplitRun`, ignoring whether the owner wants an isolated worktree.
- **Files**: `server/index.js`, `server/orchestrators.js`, `src/ui/OrchestratorChat.jsx`, `src/ui/panels/DispatchPanel.jsx`, `src/ui/panels/runs.js`, `tests/project-task.test.js`, `tests/control-panels.test.js`.
- **Tests**: Sending a direct lane message in `tests/project-task.test.js` and starting a split run in `tests/control-panels.test.js` forward the chosen `worktree` boolean instead of forcing `true`.
- **Size**: One lane run, 25 minutes.
- **Harness**: Codex Terra.

## 6. Block out-of-scope merges when a sub orchestrator is restricted (needs the owner's yes)

- **Gap**: `server/orchestrators.js:2807` only posts a warning after a restricted sub's lane changes files outside `sub.scope`, while `server/reviews.js:526` and `server/reviews.js:637` still allow merging that branch into `main` or the project branch.
- **Files**: `server/reviews.js`, `src/ui/panels/ReviewsPanel.jsx`, `tests/reviews.test.js`.
- **Tests**: `POST /api/control/reviews/:lane/merge` in `tests/reviews.test.js` returns `409` with the out-of-scope file list when the lane's starter sub has `restricted: true` and `outsideScope` is non-empty.
- **Size**: One lane run, 20 minutes.
- **Harness**: AGY Hydrogen.

## 7. Create missing coder lanes automatically in Build a team (needs the owner's yes)

- **Gap**: `src/ui/family.js:625` refuses `Build a team` whenever `missing > 0` instead of creating the missing coder lanes with the chosen harness and model, forcing the owner to close the panel and add lanes one by one first.
- **Files**: `src/ui/family.js`, `src/ui/FamilyTeam.jsx`, `tests/family-team-ui.test.js`, `tests/family.test.js`.
- **Tests**: Confirming `Build a team` on a project with fewer unclaimed lanes than `orchestrators * coders` in `tests/family-team-ui.test.js` calls `client.createLane` for each missing coder lane before saving the ladder.
- **Size**: One lane run, 25 minutes.
- **Harness**: Codex Terra.

## 8. Offer Edits and Bypass permission modes on Codex (needs the owner's yes)

- **Gap**: `src/control/modes.js:15` offers only `['plan', 'auto']` for `codex` and `src/harnesses/codex.js:106` maps only `plan` and `workspace-write`, leaving Codex orchestrators and lanes without `edits` (`--full-auto`) or `bypass` (`--dangerously-bypass-approvals-and-sandbox`).
- **Files**: `src/control/modes.js`, `src/harnesses/codex.js`, `tests/orchestrator-modes.test.js`, `tests/harnesses.test.js`.
- **Tests**: `modesFor('codex')` in `tests/orchestrator-modes.test.js` returns `plan`, `edits`, `auto`, and `bypass`, and `codexHarness.command` in `tests/harnesses.test.js` passes `--full-auto` for `edits` and `--dangerously-bypass-approvals-and-sandbox` for `bypass`.
- **Size**: One lane run, 15 minutes.
- **Harness**: AGY Hydrogen.
