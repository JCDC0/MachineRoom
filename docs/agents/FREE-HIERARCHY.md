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
   - `Settings` under `Harnesses` (`HarnessesSettings.jsx`, `server/harness-settings.js`) checks each harness with `--version` cached for 10 minutes, saves program paths in `harnesses.json`, and keeps harnesses turned off in `off` out of new lanes, subs, and harness changes: `P352`, `P355`, `P355b`, `P356`.
   - The owner can create or propose an agent on any ready harness, while an orchestrator can propose a lane (`POST /api/family/proposals`) or add a new sub (`POST /api/orchestrator/ladder`) only on its own harness (`sameHarnessProblem`, `P404`). Saving the ladder checks `modelAllowed` for any new sub or any sub whose harness or model changed, requiring a listed model when one is named and always for `machineroom`, while allowing an empty model for a CLI harness and skipping unchanged subs.
   - Still limited on `main`: A Codex or native sub's turn uses its effort since `P345`. `server/model-list.js` does not list `z-ai/glm-5.3-flash` statically, so add a `Direct API` key first. Built-in non-custom `agy` lanes are skipped by `server/active-lanes.js`.
2. They message each other:
   - Any orchestrator can message any other (`POST /api/orchestrator/messages`, capped at 6 per 10 minutes per sender), shown in the `Team` tab: `P333`.
   - A bridge-started lane run receives a one-run ticket (`MACHINEROOM_LANE_TICKET`) to message its coordinator, any orchestrator or another running lane up to 4 times and poll its replies with `GET /api/orchestrator/messages` (`P341`, `P342`).
   - A failover backup run messages under its own lane's name, keeps the replies already sent to the primary's run in its inbox, takes a reply sent to either lane name while it runs, and counts the primary's sends toward its 4 (`P439`).
   - Lane end reports wake only the `startedBy` orchestrator: `O2` (0.1.305), `O8` (0.1.356).
3. The owner watches file access:
   - The owner sets a sub's `Scope` (one glob per line, `**` when empty) and `Restricted` box in `Agents` (`FamilyTree.jsx`), and only the owner can change the scope or restriction of a sub the owner set. Commit diffs and `git status` are checked against a restricted sub's `scope` (`outsideFiles` in `server/orchestrators.js`) at turn end: `O2`, `O7`, `X3`.
   - A merge of a restricted sub's lane (`POST /api/control/reviews/LANE/merge`) is refused with 409 when git cannot read its changed files or when any changed file (read with `--no-renames`) is outside the sub's scope. The orchestrator above the sub is told once per branch head only when the lane changed files outside the scope; a refusal because the changed files could not be read sends no message. Only the owner (with `Merge anyway` in `Reviews`) or that parent orchestrator can merge it with `allowOutside: true`, for either refusal (`P402`, `P410`, `P426`).
   - An agent's `Inspector` lists the distinct paths it read, wrote or edited outside the project and its lane worktrees newest-first under `Outside the project`, with home prefixes masked (`P339`, `P346`).
   - An OpenCode lane run that is not Bypass gets an `OPENCODE_CONFIG` whose `permission` sets `external_directory` to `deny`, merged with the mode's `bash` and `edit` rules and the MCP servers, so its file tools stay in the project (`P440`).
4. Worktrees are a choice:
   - `Control` -> `Dispatch` and a lane message in `OrchestratorChat` offer `Separate worktree` (on by default), for a single task, a queue or a split run (`One lane per task`, `startSplitRun` in `src/ui/panels/runs.js`), while no run uses a worktree outside a git checkout (`U78`, `P293`, `P406`, `P408`), and process tree stops release locks (`U75`, `P313`, `P322`, `P330`).
5. Modes guard the edges:
   - Main and sub orchestrators enforce modes in `src/control/modes.js`; Codex orchestrators and lanes offer `Plan` (`--sandbox read-only`), `Edits` and `Auto` (`--sandbox workspace-write`), and `Bypass` (`--dangerously-bypass-approvals-and-sandbox`) (`P332`, `P401`).
   - Lane runs take a permission mode via `--mode`, `cli.mode` or `POST /api/control/runs`, validated per harness (including OpenCode `plan` and `edits` via `OPENCODE_CONFIG`) while refusing `ask` (`P338`, `P343`, `P344`, `P376`, `P407`). Add child and the custom lane editor in `Agents` save a lane's mode from `laneModesFor` (no `Ask`) or `Orchestrator's choice` (`choice`), and `Dispatch` picks a mode for one run. On `POST /api/control/runs`, the owner can pick any valid lane mode, while an orchestrator can pick a mode different from the lane's fixed mode only when the lane is saved as `choice`; on failover, a backup lane with a fixed saved mode keeps its own mode (`P403`, `P412`). A Bypass run never passes Bypass to a backup lane that is not saved as Bypass (`P430b`).

## What Does Not Work Yet
- Nothing interrupts a lane run: a run is one call, so a lane gets a reply only when it reads its inbox (`P341`), and the main orchestrator's instructions name the reply form since review 36.
- A touch outside the project is shown, not stopped (`P346`). The modes are the guard: Codex's sandbox, Claude's print-mode permissions and OpenCode's `external_directory: deny` keep the file tools inside the project, and the native harness refuses a path outside its folder. AGY has no folder guard, and a shell command in any harness can still write outside; the Inspector's `Outside the project` list shows them (`P440`).

## Added on 2026-11-15
- A lane run the room started messages its coordinator, any orchestrator or another running lane while it works, at most 4 times, and reads its replies with its ticket: `P335`, `P336`, `P337`, `P341`, `P342`.
- A lane run takes a permission mode: `P338`, `P343`, `P344`.
- An agent's Inspector lists the paths it touched outside the project, under `Outside the project`: `P339`, `P346`.
- `Settings` under `Harnesses` checks harness versions (`Ready`, `Not ready`, or `Off`), saves program paths, and keeps turned-off harnesses out of new lanes, subs, and harness changes; model lookup finds OpenCode and Codex programs, the add-agent form accepts `default` effort, and sub efforts save and show in the chat `Effort:` menu: `P352` to `P356`.

## Added on 2026-11-16
- Codex orchestrators and lanes offer `Edits` (`--sandbox workspace-write`) and `Bypass` (`--dangerously-bypass-approvals-and-sandbox`) beside `Plan` and `Auto`: `P401`.
- A merge of a restricted sub's lane that changes files outside the sub's scope answers 409 and posts one message to the orchestrator above the sub for that branch head. A refusal because the changed files cannot be read answers 409 too and sends no message. The owner's page or that orchestrator can allow either one with `Merge anyway`, which `Reviews` offers behind a confirm: `P402`, `P410`, `P426`.
- Add child, the custom lane editor and `Dispatch` pick a lane's mode without `Ask`, and a lane saved as `Orchestrator's choice` (`choice`) lets its orchestrator choose the mode per run while failover keeps a backup lane's fixed mode: `P403`, `P407`, `P412`.
- An orchestrator may propose or add a new agent only on its own harness, with any model that harness lists, and the ladder route checks a new or changed sub's model; the owner may make any agent on any harness: `P404`.
- The sub orchestrator form and editor in `Agents` set `Scope` and `Restricted`, and a chat lane message and a split run carry a `Separate worktree` choice: `P405`, `P406`, `P408`.
- An OpenCode lane that is not Bypass denies writes outside the project with `permission.external_directory` in its `OPENCODE_CONFIG`, merged with the mode's rules and MCP servers, and each mode line says where writes go: `P440`.

## Runbook: Build and Run the Owner's Test Tree
Target tree: Main on `claude` (`claude-opus-5-5`, `high`); Sub 1 on `codex` (`gpt-6.1-terra`, `high`) with 2 AGY lanes (`gemini-4-hydrogen-xhigh`); Sub 2 on `machineroom` (GLM 5.3 Flash) with 3 OpenCode lanes. Simple form: no subs, all lanes under Main.

### Step 1: Check Harnesses in Settings, Open Your Project and Save a Direct API Key
1. Start in `Settings`, under `Harnesses` (after starting the bridge in your project with `machineroom YOUR-PROJECT` or `npm run serve -- up --root YOUR-PROJECT` and clicking `Connect` on `Connect.jsx`, or switching folders via the `Projects` sidebar tab -> `Open folder` -> confirm `Open project`): check that each harness you want shows `Ready` (`Check again` refreshes every harness), turn off `Offer in forms` and confirm for any harness you do not use, and enter a `Program` path and click `Save` (then confirm) when a wanted harness is not found.
2. Under `Direct API`, pick `Provider` (such as OpenRouter), paste `Key`, click `Save key`, confirm to load `z-ai/glm-5.3-flash` models, then click `Close`.

### Step 2: Build the Tree in Agents (`FamilyTree.jsx`, `ladderForm.js`)
Open the `Agents` sidebar tab and open `Agents` (`FamilyTree`):
1. Click `Edit Orchestrator`. Select `Claude Code`, `Model` `Claude Opus 5.5` (`claude-opus-5-5`), and `Effort` `high`. Click `Save` and confirm.
2. Add the 2 AGY lanes and 3 OpenCode lanes: click `+` (`Add child to ...`), fill `Label`, click harness pill `AGY` with `Model` `Gemini 4 Hydrogen (XHigh)` (`gemini-4-hydrogen-xhigh`), or pill `OpenCode` with `Model` `opencode-go/deepseek-v4.1-flash`, set `Mode` and `Effort`, click `Create`, and confirm `Create`. Keep `Turn on <label>` enabled for each lane.
3. Check `Select <label>` for the 2 AGY lanes and click `Add sub orchestrator`. Enter `Label`, pick `Sub orchestrator harness` `Codex` (`codex`), `Sub orchestrator model` `GPT-6.1 Terra` (`gpt-6.1-terra`), `Sub orchestrator effort` `high`, and `Scope` or `Restricted` if needed. Click `Create` and confirm.
4. Check `Select <label>` for the 3 OpenCode lanes and click `Add sub orchestrator`. Enter `Label`, pick `Sub orchestrator harness` `Direct API` (`machineroom`), pick the loaded `z-ai/glm-5.3-flash` entry in `Sub orchestrator model`, set `Scope` or `Restricted` if needed, click `Create`, and confirm.
5. Reassign lanes later via `Edit <sub label>` -> `Agents under <label>` -> `Save agents`, or change scope via `Scope for <label>` -> `Save scope`. To test the simple form, click `Delete <sub label>` (or `Remove`) and confirm so all lanes report to Main.

### Step 3: Run Supervised, Plan First, Then Auto
1. Click `Orchestrator` in the top bar (or press `/`) to open `OrchestratorChat`. Tabs show `Orchestrator`, both subs, and `Team`. Check `Show agent messages`.
2. Before sending a prompt, open `Orchestrator` and the sub tabs. On each tab, click `Mode:` and pick `Plan` in the `Modes` popup (`Codex` offers `Plan`, `Edits`, `Auto` and `Bypass`; `Bypass` prompts `Use Bypass`).
3. Send your task from `To: Orchestrator` using `Send` (confirm `Start` on first start). Review the plan across tabs before any code changes happen.
4. Switch `Mode:` to `Auto` on the orchestrator tabs once the plan is sound, then reply to `Orchestrator` to let subs start lanes. Use `Allow` or `Deny` if an `Ask` approval appears, and toggle `Separate worktree` under `Control` -> `Dispatch` or in the chat when `To:` names a lane.

### Step 4: Watch in the Room and Stop Everything
- Watch: in 3D, sub shapes float over sector arcs with activity, active, finished, and failure lights; `Transport` shows orchestrator chips and lane pills; `Team` tab and `Show agent messages` show cross-orchestrator chat and `startedBy` wake reports; `Control` (`Dispatch`, `Tasks`, `Meters`, `Team`, `Reviews`) and `Log` show queues, cost meters, and errors.
- Stop orchestrators: open every running tab (`Orchestrator` and each sub tab) in `OrchestratorChat`, click `Stop`, and confirm `Stop`.
- Stop running lanes: click the active lane to open `Inspector`, click `Stop`, and click `Confirm` (or click `Open conversation with <label>` -> `Stop`), or run `npm run run-lane -- --stop LANE`.

## Checked in the room on 2026-11-15

The orchestrator walked steps 1 to 3 on Lowbeam in the owner's room at 1280 by 800, up to the first message, which is the owner's to send. The room now holds: the main orchestrator on Claude Code, `claude-opus-5-5`, effort high; the sub `Terra` on Codex, `gpt-6.1-terra`, effort high, over `Hydrogen A` and `Hydrogen B` (AGY, `gemini-4-hydrogen-xhigh`); and `OpenCode A`, `OpenCode B` and `OpenCode C` (`opencode-go/deepseek-v4.1-flash`, effort max) under the main. Both orchestrators are in Plan. No turn and no run was started. The native sub over the three OpenCode lanes is not made: `Direct API` is not offered as a sub harness until a key is saved in `Settings`, and only the owner saves a key.

What the walk found, fixed on `main` (P352 to P356):

- Model and harness lookups (`server/harness-models.js`, `server/agents-config.js`) now check saved `harnesses.json` programs, lane `cli.bin`, descriptor `defaultProgram`, `PATH` and the Codex app, and `Settings` under `Harnesses` checks `--version` readiness and lets the owner save a program path (`P352`, `P355`, `P356`).
- The add-agent form and `POST /api/lanes/create` now accept `default` (empty) effort and save `effort: null` (`P354`).
- Saving the ladder (`POST /api/orchestrator/ladder`) now keeps and validates per-sub `effort`, passing it from the sub's first turn (`P353`).
- The chat tab's `Effort:` menu (`effortMenuLevels`) now reads the bridge's `harnesses` levels so a Codex orchestrator offers `low`, `medium`, `high` and `xhigh` (`P353`).
