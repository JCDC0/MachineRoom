# Next Round of Fixes (Argon 2)

Ranked from highest risk to the owner's work to lowest.

## 1. Failover overwrites a backup lane's default fixed mode
- Gap: `server/runs.js:1485` treats a lane with no `cli.mode` as fixed at `legacyMode(harness)`, and `server/agents-config.js:544` and `757` omit `mode` when saving the default mode. In `scripts/run-lane.mjs:1745`, `fixedTarget` is `targetMode !== '' && targetMode !== 'choice'`, which is false when `cli.mode` is unset, so failover from a `bypass` primary onto a default `codex` backup carries `bypass` and enables `--dangerously-bypass-approvals-and-sandbox`.
- Files: `scripts/run-lane.mjs`, `tests/failover-mode.test.js`, `docs/agents/CHANGELOG.md`.
- Failing test: In `tests/failover-mode.test.js`, a `choice` primary running `bypass` that fails over to a `codex` backup with `backupMode: undefined` runs the backup in `auto` (`--sandbox workspace-write`), not `bypass`.
- Size and harness: 15 minutes, OpenCode.

## 2. Direct lane dispatch in chat messages skips confirmation and sector checks
- Gap: When `to` names a bare lane key instead of `lane:KEY`, `message` in `server/orchestrators.js:784-813` calls `startLaneTask` (`server/index.js:812-824`) before checking `page`, `body.confirmed === true` (`docs/agents/architecture/LIMITS.md:15`), or the caller's sector. A sub orchestrator token can start a lane outside its sector with `startedBy: 'orchestrator'` and append a fake `owner` message to Main's chat (`server/orchestrators.js:811`).
- Files: `server/orchestrators.js`, `tests/orchestrators.test.js`, `docs/agents/CHANGELOG.md`.
- Failing test: In `tests/orchestrators.test.js`, `POST /api/orchestrator/messages` with `{ to: 'other-lane', text: 'run' }` from a sub token or from the page with `confirmed: false` returns 403 or 400 and starts no run.
- Size and harness: 20 minutes, Codex Terra.

## 3. Review merges allow a sub orchestrator token to merge lanes outside its sector
- Gap: `ownerRequest` in `server/reviews.js:308-312` accepts any valid orchestrator token (`Boolean(callerId(req))`), and `scopeRefusal` at `server/reviews.js:350` checks only whether the target lane's own sub is restricted and has outside files. A sub orchestrator can use its token on `POST /api/control/reviews/LANE/merge` (`server/reviews.js:782`) to merge Main's lanes or another sub's in-scope lanes into `main`, contradicting `docs/agents/FREE-HIERARCHY.md:13`.
- Files: `server/reviews.js`, `tests/reviews-scope.test.js`, `docs/agents/CHANGELOG.md`.
- Failing test: In `tests/reviews-scope.test.js`, calling `POST /api/control/reviews/opencode/merge` with `other-token` when `opencode` belongs to `scout` (with in-scope changes) or to Main returns 403 and leaves `main` unchanged.
- Size and harness: 20 minutes, OpenCode.

## 4. Sub orchestrator tokens can stop Main, sibling subs, and outside lanes
- Gap: `POST /api/orchestrator/stop` in `server/orchestrators.js:1049-1068` checks `idForToken(token)` without checking `body.id === actor`, and `POST /api/control/runs/stop` in `server/runs.js:1175-1180` calls `readActor(req, {})` without calling `finishActor(actor, body.lane)`. A sub orchestrator token can kill and pause Main's turn, stop a sibling sub, or stop a running lane outside its sector.
- Files: `server/orchestrators.js`, `server/runs.js`, `tests/orchestrators.test.js`, `docs/agents/CHANGELOG.md`.
- Failing test: In `tests/orchestrators.test.js`, a sub token calling `POST /api/orchestrator/stop` with `{ id: 'orchestrator', confirmed: true }` or `POST /api/control/runs/stop` on an outside lane gets 403.
- Size and harness: 20 minutes, Codex Terra.

## 5. Turn-end scope check `branchChanges` omits `--no-renames`
- Gap: `R42-2` added `--no-renames` to `server/reviews.js:360`, but `branchChanges` in `server/orchestrators.js:156` still runs `git diff --no-ext-diff --no-textconv --name-only --relative` without `--no-renames`. When a lane under a restricted sub commits a pure move of an unchanged file from outside its scope into its scope, `outsideFiles` at `server/orchestrators.js:467` misses the deleted outside path and sends no turn-end scope warning (`docs/agents/FREE-HIERARCHY.md:23`).
- Files: `server/orchestrators.js`, `tests/orchestrators.test.js`, `docs/agents/CHANGELOG.md`.
- Failing test: In `tests/orchestrators.test.js`, committing `git mv docs/a.md src/a.md` on a lane branch under a sub restricted to `src/**` makes `branchChanges` return both paths so `outsideFiles` reports `docs/a.md`.
- Size and harness: 15 minutes, OpenCode.

## 6. Sub harness, model, and effort routes leave ladder state and `configs` stale
- Gap: `POST /api/orchestrator/harness` (`server/orchestrators.js:1134-1142`) updates `targetSub.harness` and `targetSub.model` without updating `targetSub.effort` or `configs.get(body.id)`, while `/api/orchestrator/model` (`server/orchestrators.js:1116`) and `/api/orchestrator/effort` (`server/orchestrators.js:1249`) update neither `main.setLadder` nor `configs`. On the next `POST /api/orchestrator/ladder`, `savedEfforts` (`server/orchestrators.js:951`) restores the old effort and `sync()` (`server/orchestrators.js:501-513`) sees `!sameConfig(config, nextConfig)` and closes the working sub.
- Files: `server/orchestrators.js`, `tests/sub-effort.test.js`, `docs/agents/CHANGELOG.md`.
- Failing test: In `tests/sub-effort.test.js`, changing a sub's effort via `/api/orchestrator/effort` and its harness via `/api/orchestrator/harness`, starting a sub turn, and saving a scope change via `/api/orchestrator/ladder` keeps the new effort and does not kill the turn.
- Size and harness: 25 minutes, Codex Terra.

## 7. An orchestrator can switch an existing sub to another harness on ladder save
- Gap: `ladderChange` in `server/orchestrators.js:924` checks `sameHarnessProblem` only when `!previous`, unlike the `off` check on line 927 (`!previous || harnessFor(previous) !== harness`). An orchestrator can add a sub on its own harness and then change that sub's `harness` to another harness on a second `POST /api/orchestrator/ladder` call, bypassing `P404` (`docs/agents/FREE-HIERARCHY.md:16`, `47`).
- Files: `server/orchestrators.js`, `tests/same-harness-agents.test.js`, `docs/agents/CHANGELOG.md`.
- Failing test: In `tests/same-harness-agents.test.js`, an `agy` orchestrator that adds an `agy` sub and then saves the ladder with that sub's `harness` changed to `codex` gets 400 `sameHarnessProblem('agy')`.
- Size and harness: 15 minutes, OpenCode.

## 8. Lane proposals ignore `harnesses.json` `off` and saved `programs`
- Gap: `POST /api/family/proposals` in `server/family.js:525` calls `isHarnessAvailable` without `runsFolder: runsDir` and never checks `readHarnessSettings(runsDir).off`, contradicting `docs/agents/FREE-HIERARCHY.md:15` and `41`. A proposal for a turned-off harness returns 200 and then fails with 400 when approved (`server/agents-config.js:490`), while a proposal for a harness whose program path is saved in `harnesses.json` is refused with 400.
- Files: `server/family.js`, `tests/owner-tree.test.js`, `docs/agents/CHANGELOG.md`.
- Failing test: In `tests/owner-tree.test.js`, turning off `opencode` and saving a custom `codex` program in `harnesses.json` makes `POST /api/family/proposals` refuse `opencode` with 400 `HARNESS_OFF_PROBLEM` and accept `codex` with 200.
- Size and harness: 15 minutes, OpenCode.

## Needs the owner's yes
- Deliver an inbox reply to a running lane without waiting for it to poll `GET /api/orchestrator/messages` (`docs/agents/FREE-HIERARCHY.md:33`).
- Give a failover backup lane its own inbox identity instead of messaging under the primary lane's name (`docs/agents/FREE-HIERARCHY.md:34`).
- Block file writes outside the project for CLI harnesses instead of only listing them under `Outside the project` in `Inspector` (`docs/agents/FREE-HIERARCHY.md:35`).
- Offer a `Mode` picker when creating or editing a sub orchestrator in `Agents` (`src/ui/FamilyTree.jsx:2093`).
