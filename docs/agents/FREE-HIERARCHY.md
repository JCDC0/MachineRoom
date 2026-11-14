# Free Hierarchy

## Goal
The owner wants a free hierarchy of coding agents in one project:
1. Any harness coordinates any other, as main or sub orchestrator over any lanes.
2. Agents message each other freely inside their roles.
3. The owner watches file access and sector scope.
4. Worktrees are a choice, not forced on every run.
5. Modes guard the edges between orchestrators and lanes.

## What Works Today, By Part
1. Any harness coordinates any other:
   - Ladder data, live updates, 3D sector arcs, sub shapes, chat tabs, autocompact, and per-orchestrator tokens (`X-MachineRoom-Orchestrator` with 403 refusal outside sector lanes): `O1` (0.1.282, `src/model/hierarchy.js`), `O2` (0.1.305), `O3` (0.1.295), `O4` (0.1.291), `O5` (0.1.311), `O6` (0.1.298), `O7` (0.1.316), `O8` (0.1.356), `server/runs.js`.
   - Native Direct API harness (`machineroom` / `scripts/mr-agent.mjs`), `Direct API` panel in `Settings`, GPT-6.1 Terra (`gpt-6.1-terra`) for Codex, any available harness in sub forms (`Direct API` label in `src/ui/ladderForm.js`) with 400 refusal if unavailable, plus ladder tests: `H5`, `H10`, `H17`, `U85`, `P329`, `P331`, `P334`, `P340` (`tests/owner-tree.test.js`).
   - Still limited on `main`: `FamilyTree.jsx` has no per-sub `scope` or `restricted` fields (`subFromForm` in `ladderForm.js` reads them, UI hardcodes `['**']` and `false`). `server/orchestrator.js` drops `effort` on `codex` and `machineroom` subs. `server/model-list.js` does not list `z-ai/glm-5.3-flash` statically, so add a `Direct API` key first. Built-in non-custom `agy` lanes are skipped by `server/active-lanes.js`.
2. They message each other:
   - Any orchestrator can message any other (`POST /api/orchestrator/messages`, capped at 6 per 10 minutes per sender), shown in the `Team` tab: `P333`.
   - Lane end reports wake only the `startedBy` orchestrator: `O2` (0.1.305), `O8` (0.1.356).
3. The owner watches file access:
   - Commit diffs and `git status` are checked against a sub's `scope` (`outsideFiles` in `server/orchestrators.js`) at turn end: `O2`, `O7`, `X3`.
4. Worktrees are a choice:
   - `Control` -> `Dispatch` offers `Own worktree` per task, while queued lane runs in `scripts/run-lane.mjs` create worktrees (`U78`, `P293`), and process tree stops release locks (`U75`, `P313`, `P322`, `P330`).
5. Modes guard the edges:
   - Main and sub orchestrators enforce modes in `src/control/modes.js`; Codex orchestrators support `Plan` and `Auto` (`P332`).

## What Does Not Work Yet
- A lane receives nothing mid-run and cannot reply until its run finishes (`P335` to `P337` are briefs only).
- Lane modes are P338 (`src/control/modes.js` defines lane mode lists, `server/runs.js` passes no mode yet).
- A touch outside the project is P339 (no cross-project file guard or watch exists yet).

## Runbook: Build and Run the Owner's Test Tree
Target tree: Main on `claude` (`claude-opus-5-5`, `high`); Sub 1 on `codex` (`gpt-6.1-terra`, `high`) with 2 AGY lanes (`gemini-4-hydrogen-xhigh`); Sub 2 on `machineroom` (GLM 5.3 Flash) with 3 OpenCode lanes. Simple form: no subs, all lanes under Main.

### Step 1: Open Your Project and Save a Direct API Key
1. Start the bridge in your project folder: run `machineroom YOUR-PROJECT` or `npm run serve -- up --root YOUR-PROJECT`, then open the printed URL.
2. On `Connect.jsx`, verify `Bridge URL` under `Connect through the bridge` and click `Connect`. If already open, use the `Projects` sidebar tab -> `Open folder` -> confirm `Open project`.
3. Click `Settings` in the top bar. Under `Direct API`, pick `Provider` (such as OpenRouter), paste `Key`, click `Save key`, confirm to load `z-ai/glm-5.3-flash` models, then click `Close`.

### Step 2: Build the Tree in Agents (`FamilyTree.jsx`, `ladderForm.js`)
Open the `Agents` sidebar tab and open `Agents` (`FamilyTree`):
1. Click `Edit Orchestrator`. Select `Claude Code`, `Model` `Claude Opus 5.5` (`claude-opus-5-5`), and `Effort` `high`. Click `Save` and confirm.
2. Add the 2 AGY lanes and 3 OpenCode lanes: click `+` (`Add child to ...`), fill `Label`, click harness pill `AGY` with `Model` `Gemini 4 Hydrogen (XHigh)` (`gemini-4-hydrogen-xhigh`), or pill `OpenCode` with `Model` `opencode-go/deepseek-v4.1-flash`, set `Effort`, click `Create`, and confirm `Create`. Keep `Turn on <label>` enabled for each lane.
3. Check `Select <label>` for the 2 AGY lanes and click `Add sub orchestrator`. Enter `Name`, pick `Sub orchestrator harness` `Codex` (`codex`), `Sub orchestrator model` `GPT-6.1 Terra` (`gpt-6.1-terra`), and `Sub orchestrator effort` `high` (note UI stores this, server ignores Codex sub effort today). Click `Create` and confirm.
4. Check `Select <label>` for the 3 OpenCode lanes and click `Add sub orchestrator`. Enter `Name`, pick `Sub orchestrator harness` `Direct API` (`machineroom`), pick the loaded `z-ai/glm-5.3-flash` entry in `Sub orchestrator model`, click `Create`, and confirm.
5. Reassign later via `Edit <sub label>` -> `Agents under <label>` -> `Save agents`. To test the simple form, click `Delete <sub label>` (or `Remove`) and confirm so all lanes report to Main.

### Step 3: Run Supervised, Plan First, Then Auto
1. Click `Orchestrator` in the top bar (or press `/`) to open `OrchestratorChat`. Tabs show `Orchestrator`, both subs, and `Team`. Check `Show agent messages`.
2. Before sending a prompt, open `Orchestrator` and the sub tabs. On each tab, click `Mode:` and pick `Plan` in the `Modes` popup (`Codex` offers `Plan` and `Auto`; `Bypass` prompts `Use Bypass`).
3. Send your task from `To: Orchestrator` using `Send` (confirm `Start` on first start). Review the plan across tabs before any code changes happen.
4. Switch `Mode:` to `Auto` on the orchestrator tabs once the plan is sound, then reply to `Orchestrator` to let subs start lanes. Use `Allow` or `Deny` if an `Ask` approval appears, and toggle `Own worktree` under `Control` -> `Dispatch` for manual single dispatches.

### Step 4: Watch in the Room and Stop Everything
- Watch: in 3D, sub shapes float over sector arcs with activity, active, finished, and failure lights; `Transport` shows orchestrator chips and lane pills; `Team` tab and `Show agent messages` show cross-orchestrator chat and `startedBy` wake reports; `Control` (`Dispatch`, `Tasks`, `Meters`, `Team`, `Reviews`) and `Log` show queues, cost meters, and errors.
- Stop orchestrators: open every running tab (`Orchestrator` and each sub tab) in `OrchestratorChat`, click `Stop`, and confirm `Stop`.
- Stop running lanes: click the active lane to open `Inspector`, click `Stop`, and click `Confirm` (or click `Open conversation with <label>` -> `Stop`), or run `npm run run-lane -- --stop LANE`.
