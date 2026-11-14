# Live Ladder Readiness on Lowbeam (P327)

Readiness audit for running the sub-orchestrator ladder (`docs/agents/HIERARCHY.md`, O1 to O8) on `C:\GitHub\Lowbeam`, where lanes must work in `.worktrees\LANE` on task branches, `main` must stay checked out and clean, and the owner merges only through Reviews via fast-forward into `main`.

Bottom line: **No-Go** for the sector-branch ladder workflow on Lowbeam without code fixes first. Use the flat setup as the default, or limit any trial to a single-task `ask`-mode check without sector merges.

Note on code layout: `server/runs.js` holds only the sector lane gate (`readActor`, `finishActor`, `laneRestriction`). The post-run file scope check lives in `src/model/hierarchy.js`, `server/orchestrators.js`, and `server/orchestrator.js`.

---

## 1. Where a sub orchestrator turn runs and whether it can change Lowbeam's main checkout

A sub orchestrator turn runs directly in Lowbeam's main checkout (`C:\GitHub\Lowbeam`), not in a sub worktree. Yes, it can change Lowbeam's main checkout.

- `server/orchestrators.js:219, 357-364`: `createSub` sets `projectRoot: root` from the room's project root, the same folder used by Main.
- `server/orchestrator.js:952, 1940-1952, 1978-1989`: `startTurn` spawns every orchestrator harness child with `cwd: root` (`folder: root` for non-Claude harnesses).
- `server/orchestrator.js:1869-1880` and `docs/agents/ORCHESTRATOR-AGENT.md:6, 105-108`: Every sub receives `ORCHESTRATOR-AGENT.md` with `{{PROJECT}}` set to `root`. That prompt tells it to work in `{{PROJECT}}` and `"Then in the project, fast forward to the lane branch. Make no merge commit."`
- `server/orchestrator.js:1817, 1903-1907, 2858` and `src/control/modes.js:11-36`: New orchestrator chats default to `defaultMode(harness)`, which is `'auto'` for `claude`, `opencode`, `agy`, and `machineroom` (legacy fallback `'bypass'` -> `--dangerously-skip-permissions` for Claude). Only `'plan'` forbids edits and commands (`src/control/modes.js:4`), and `'ask'` prompts before each write or command (`src/control/modes.js:5`, `server/orchestrator.js:1906`).
- `src/harnesses/codex.js:106, 112`: Codex runs with `--sandbox workspace-write` in `cwd: folder` (`root`), so `C:\GitHub\Lowbeam` is writable.
- `src/ui/OrchestratorChat.jsx:356`: The sub start confirmation in chat states `${current?.name || selected} runs on this project with full permissions.`

Because `cwd` is `C:\GitHub\Lowbeam`, a sub can edit tracked files, leave untracked files, run `git switch`, detach `HEAD`, or fast-forward `main` itself. If `main` becomes dirty or moves off a branch, `projectDirty` (`server/runs.js:690-706, 1475-1492`) blocks new runs and `Reviews` fails `projectBase()` checks (`server/reviews.js:393-402, 798, 812`).

---

## 2. Where `machineroom/sector-ID` is made and by whom

Nowhere in code. Neither the bridge nor `scripts/run-lane.mjs` creates, checks out, or tracks `machineroom/sector-ID`.

- `src/model/hierarchy.js:303-304`: `subPrompt` injects two prompt lines into the sub's instructions:
  - ``Your sector branch is `machineroom/sector-${id}`.``
  - `'Plan for your lanes, start them, review their work and merge it into your sector branch.'`
- No file in `server/`, `scripts/`, or `src/` creates or reads `machineroom/sector-*`.
- If `machineroom/sector-ID` exists at all, the sub orchestrator LLM has to create and update it itself by running `git` commands from `cwd: root` (`C:\GitHub\Lowbeam`) during its turn.
- Meanwhile, lane runs with `worktree: true` always branch off `root`'s current `HEAD`, not off a sector branch (`scripts/run-lane.mjs:584, 593-608, 805, 1309, 1344-1372`), creating `machineroom/queue-<lane>-<stamp>` in `.worktrees/<lane>`.

---

## 3. Whether Reviews can show or merge a sector branch

No. Reviews can neither list, diff, nor merge `machineroom/sector-ID`.

- `server/reviews.js:713-721`: `GET /api/control/reviews` builds rows only by iterating `Object.keys(read.lanes)` (configured lanes in `lanes.json`) whose worktree folder exists on disk.
- `server/reviews.js:370-377`: For another project (`onProject === true`, true for Lowbeam at `server/reviews.js:270-290`), `laneFolder` resolves strictly to `<Lowbeam>/.worktrees/<lane>`.
- `server/reviews.js:816-830`: Diff and merge endpoints look up `:lane` in `read.lanes` and return `404` `'Choose a lane from the list.'` for any unknown id such as a sub id or sector branch name.
- `server/reviews.js:393-402, 416-418, 606-675`: `projectBase()` reads `symbolic-ref --short HEAD` in `resolvedRoot` (`C:\GitHub\Lowbeam`), and `fastForwardLane` runs `git merge --ff-only <laneHead>` in `resolvedRoot`. If a sub switched `root` onto `machineroom/sector-ID` or detached `HEAD`, Reviews would target the sector branch or return `409` `'The project is not on a branch.'` (`server/reviews.js:798, 812`).
- `server/reviews.js:294-302, 684-692`: Conversely, `ownerRequest(req)` accepts either `req.headers.origin` or any valid `X-MachineRoom-Orchestrator` token (`idForToken(token)`). That means a sub's own token passes `ownerRequest` on `POST /api/control/reviews/:lane/merge` and could fast-forward `main` without owner action.
- `src/ui/panels/reviews.js:34-40, 67-87` and `src/ui/panels/ReviewsPanel.jsx:525-533`: `"Ask to prepare"` sends the rebase message to `Main` (`client.sendOrchestrator`), not to the lane's owning sub.

---

## 4. What happens to a lane branch a sub merged into its sector branch

Merging a lane branch (`machineroom/queue-<lane>-<stamp>`) into `machineroom/sector-ID` breaks either the lane's next run or Reviews visibility, depending on whether `.worktrees/<lane>` keeps that head:

1. **If `.worktrees/<lane>` stays on the merged lane branch**:
   - The commits exist in `machineroom/sector-ID` and in `.worktrees/<lane>`, but not in Lowbeam's `main`.
   - When the sub tries to start another `--worktree` task on that lane, `prepareWorktree` (`scripts/run-lane.mjs:579-613`) reads `sha = git rev-parse HEAD` in `C:\GitHub\Lowbeam` (`main`) and checks `git rev-list --count ${sha}..HEAD` inside `.worktrees/<lane>`.
   - Because `main` does not have those commits yet (`count > 0`), `prepareWorktree` throws `The ${lane} worktree is on ${branch} with ${count} commits not in the project yet. Merge or remove it first.` (`scripts/run-lane.mjs:605-607`), or the detached-commit equivalent at `602-604`. The lane cannot run again until `main` has those commits or the worktree is reset.
2. **If the sub detaches or resets `.worktrees/<lane>` back to `main` so the lane can run again**:
   - `prepareWorktree` succeeds (`count === 0`) and starts the next run from `main`, so the second task cannot see task 1's changes (which exist only on `machineroom/sector-ID`).
   - `laneReview` (`server/reviews.js:452-478`) measures `ahead` (`git log --oneline ${base.ref}..HEAD`) and diffs `${base.ref}...HEAD` inside `.worktrees/<lane>` against `main`. Once `.worktrees/<lane>` resets to `main` (or moves onto a new `main`-based branch), task 1's commits disappear from Reviews (`ahead` no longer counts them, and `canMerge` in `src/ui/panels/reviews.js:22-26` hides `Merge` when `ahead <= 0`).
   - Because Reviews cannot list `machineroom/sector-ID`, the owner has no UI way to review or merge task 1's work into `main`.
3. **If the sub switches `C:\GitHub\Lowbeam` (`root`) to `machineroom/sector-ID` so new runs branch from the sector**:
   - That directly breaks Lowbeam's rule that `main` stays checked out and clean, and redirects `Reviews` (`projectBase()`, `server/reviews.js:393-402`) to diff and fast-forward into `machineroom/sector-ID` instead of `main`.

---

## 5. Whether two subs can start lanes that change the same file

Yes. Nothing prevents two subs from running lanes concurrently in separate worktrees that edit the exact same files.

- **At config time (`src/model/hierarchy.js:143-175, 196, 209-211`)**: `readLadder` ensures each `lane` key belongs to at most one sub and validates glob syntax per sub, but does not reject overlapping `scope` globs across two subs. Setting `restricted: false` disables scope checks for a sub altogether (`210`).
- **At run start (`server/runs.js:559-626, 1434`)**: `finishActor` checks only lane ownership (`if (sector && !sector.lanes.includes(lane))` -> `403`, line `607`). It inspects zero file paths, task briefs, or scope globs. Two subs with disjoint lanes can start tasks at the same time in their own `.worktrees/<lane>` folders (`scripts/run-lane.mjs:579-613`) and modify the same file.
- **After the run ends (`server/orchestrators.js:106-158, 407-424`, `server/orchestrator.js:2773-2781`)**: `outsideFiles` checks changed files in `.worktrees/<lane>` only after `heartbeat.run.status` arrives. If paths fall outside that sub's `scope`, it prepends `'Outside the scope, do not merge:\n- ...'` to the wake message and calls `onOutsideScope` to notify Main (`server/orchestrators.js:421-424`). It is advisory only: it does not revert changes, lock files across subs, or block a merge in `Reviews`.
- **Base-commit bug (`server/orchestrators.js:106-117`)**: `newestBase` walks `runs.jsonl` and takes the last record matching `record.lane` instead of preferring `record.base` from the completed run itself, which can miscompute changed files if another record for that lane appeared later.

---

## 6. What the owner sees in the room for each step

1. **Ladder saved (`POST /api/orchestrator/ladder`)**:
   - `server/orchestrators.js:723-726` saves the ladder on Main, syncs sub instances, and emits `'agents'` and `'family'` notices.
   - `src/Stage.jsx:912-926` refreshes `client.orchestrators()` (on mount, `'orchestrator'` notice, or 60s poll) and calls `room.setLadder(next)`.
   - `src/engine/hub.js:355-393, 406-409, 503-509` splits the central ring into named, uppercased sector arcs and reveals the lower `subRing` when lanes belong to subs.
   - `server/lanes-source.js:138-150, 421-444` and `server/index.js:1811-1829` keep `orchestrator` and `sub-*` in the roster even before active lanes are picked (`server/family.js:228-320, 341-357` feeds Family Tree `mainNode -> subNodes -> laneNodes` via `/api/family`, refreshed on `'family'` at `src/Stage.jsx:961-964`).
   - `src/engine/agents.js:818-832, 1140-1165, 1301-1308, 1554-1563, 1585-1590` places each `sub-<id>` at 0.7 scale above its sector arc (`subHome`) with a thin white link to Main, lifts Main's name callout, moves sector lanes onto the lower `subRing` (`laneHome`), and links those lanes to their `sub-<id>`.
   - `src/ui/transportOrchestrators.js:31-44` and `src/ui/Transport.jsx:137, 175-192` add up to 4 sub chips (`+N` overflow) with status dots beside Main. `src/ui/OrchestratorChat.jsx:340-356, 1355-1375` adds tabs for `Main`, each sub, and `Team`.
   - Note: `server/lanes-source.js:143` maps `sub.harness` with `=== 'opencode' ? 'opencode' : 'claude'`, so a `codex`, `agy`, or `machineroom` sub renders in the roster as `claude`.

2. **Sub orchestrator turn runs (`cwd: C:\GitHub\Lowbeam`)**:
   - `src/engine/hub.js:574-584`, `src/engine/agents.js`, and `src/engine/terminals.js:285-289` brighten the sub's sector arc, pulse the sub avatar, and render its callout and terminal window.
   - `server/lanes-source.js:338-341, 527-538` detects `sub-<id>-chat-...` logs (`ownProject === true`, paths kept in `root`).
   - Transport chip (`src/ui/Transport.jsx:179`) and chat tab dot (`src/ui/OrchestratorChat.jsx:1368`) turn working. If the sub runs in `ask` mode, `waiting` shows on its Transport chip (`src/ui/transportOrchestrators.js:22-24, 40`), though `Inspector` suppresses the `'waiting for you'` state override for `sub-*` (`src/ui/Inspector.jsx:109, 138, 146-151`).

3. **Sub starts its lanes (`POST /api/control/runs/start`)**:
   - `server/runs.js:559-626` forces `startedBy: sub-<id>` and allows only `sector.lanes`.
   - `server/lanes-source.js:527-538` rewrites `.worktrees\<lane>` log paths into `roomRoot`, `src/ui/Transport.jsx:138-148, 193-210` shows running lane pills, and the lower `subRing` lane avatars animate with tool/terminal activity.
   - If the sub omitted `worktree: true` on a single task, the run runs in `C:\GitHub\Lowbeam` instead of `.worktrees\<lane>` (`server/runs.js:1393`, `scripts/run-lane.mjs:1529-1568`). If a sub turn left `C:\GitHub\Lowbeam` dirty, starting any lane fails (`server/runs.js:690-706, 1475-1492`).

4. **Lane finishes and post-run scope check fires**:
   - `server/orchestrator.js:2716-2823` wakes `record?.startedBy` (bug at `2729-2736`: if `record` is null, wake falls back to Main).
   - If `outsideFiles` finds out-of-scope edits (`server/orchestrators.js:407-424`, `server/orchestrator.js:2773-2781`), the sub wakes with `'Outside the scope, do not merge:'` and Main's `'room'` feed receives the same notice (`OrchestratorChat` Main/Team views). The 3D room, hub arcs, and `ReviewsPanel` show no out-of-scope badge.

5. **Sub runs sector merge / reports to Main**:
   - `OrchestratorChat` (sub tab, Main tab, `Team` tab) and the sub's floating terminal show any git commands the sub runs in `root`, plus its `sub:<id>` reply to Main (`server/index.js:1710-1715`). If Main is `paused`, `deliver` does not unpause Main on a `sub:<id>` message (`server/orchestrator.js:2187`).

6. **Owner opens Reviews (`ReviewsPanel`)**:
   - `src/ui/panels/ReviewsPanel.jsx:252-259, 525-545` shows rows only for lanes in `lanes.json` whose `.worktrees\<lane>` folder exists and is ahead of `root`'s checked-out branch (`server/reviews.js:452-478, 713-721`). `machineroom/sector-ID` never appears. If `.worktrees\<lane>` was reset after a sector merge, that lane shows no commits ahead and no `Merge` button (`src/ui/panels/reviews.js:22-26`).

---

## Gaps Ordered by Severity

| Severity | Gap | Code (`file:line`) | Impact on Lowbeam rules / work | Smallest fix | Needs owner's yes as feature? |
| --- | --- | --- | --- | --- | --- |
| **Critical** | Sub turns run in `C:\GitHub\Lowbeam` (`cwd: root`) with write permissions and merge-in-project prompt text | `server/orchestrators.js:219, 357-364`; `server/orchestrator.js:1869-1989`; `src/control/modes.js:11-36`; `src/harnesses/codex.js:106, 112`; `docs/agents/ORCHESTRATOR-AGENT.md:6, 105-108` | Subs can switch off `main`, dirty `root`, detach `HEAD`, or fast-forward `main`, breaking `main`-clean rules, `projectDirty` checks, `prepareWorktree`, and `Reviews` | Give each sub its own `.worktrees/<sub-id>` sector worktree as `cwd` and drop `ORCHESTRATOR-AGENT.md:108` for subs (or lock subs to `plan`/`ask` without git merges) | **Yes** (chooses sector worktree vs read-only coordinator model) |
| **Critical** | `machineroom/sector-ID` has no code support, is invisible to Reviews, and breaks `.worktrees\<lane>` reuse after merge | `src/model/hierarchy.js:303-304`; `scripts/run-lane.mjs:579-613, 1344-1372`; `server/reviews.js:370-377, 452-478, 606-675, 713-721, 816-830`; `src/ui/panels/reviews.js:22-26` | Merging a lane into a sector branch leaves `.worktrees\<lane>` blocked by `prepareWorktree` (`605-607`); resetting `.worktrees\<lane>` hides commits from Reviews and subsequent lane tasks | Either implement sector branches end to end (base ref in `run-lane.mjs` + sector rows/ff-merge in `server/reviews.js`), or drop sector branches from `subPrompt` (`303-304`) so lanes go directly to Reviews | **Yes** (changes how Reviews and O1-O8 integration work) |
| **High** | Single-task runs do not require `worktree: true` | `server/runs.js:670-719, 1393, 1455-1456`; `scripts/run-lane.mjs:1525-1568` | If a sub omits `worktree: true` on a single `task`, the lane runs straight in `C:\GitHub\Lowbeam` and modifies `main` | Force `worktree: true` in `server/runs.js:1393` for sub actors (or whenever `!sameCheckout`) | **No** if enforced only for sub actors (matches `HIERARCHY.md`); **Yes** if changed globally for Main/UI |
| **High** | Sub tokens satisfy `ownerRequest` on Reviews merge | `server/reviews.js:294-302, 684-692` | Any sub can call `POST /api/control/reviews/:lane/merge` and fast-forward `main` without the owner | In `ownerRequest`, allow only `req.headers.origin` (or reject sub tokens on `/merge`) | **No** (bug fix matching `ownerRequest` intent and Lowbeam's rule) |
| **High** | Two subs can start lanes editing the same file; scope check is post-run text advice and `newestBase` picks wrong record | `src/model/hierarchy.js:143-175, 209-214`; `server/runs.js:603-620`; `server/orchestrators.js:106-158, 407-424`; `server/orchestrator.js:2773-2781` | Concurrent cross-sector edits to one file collide at merge; out-of-scope changes are never blocked; `newestBase` can diff from a newer run's base | Fix `newestBase` to use `record.base` (`No`); add overlap validation in `readLadder` and block/flag out-of-scope merges in Reviews (`Yes`) | **No** for `newestBase` bug; **Yes** for overlap ban or merge block |
| **Medium** | Live-room and routing mismatches (`subOrchestratorAgent`, `onFrame` fallback, `paused` Main, `Ask to prepare`, direct lane task) | `server/lanes-source.js:143`; `server/orchestrator.js:2187, 2729-2736`; `server/index.js:815`; `src/ui/panels/reviews.js:34-40, 67-87`; `src/ui/panels/ReviewsPanel.jsx:525-533` | Non-claude/opencode subs mis-labeled in roster; missing run record wakes Main instead of sub; `"Ask to prepare"` bypasses sub; Main-started lane task (`startedBy: 'orchestrator'`) skips sub; `sub:<id>` reply stalls on paused Main | Use real `sub.harness` in `lanes-source.js:143` (`No`); avoid `'orchestrator'` fallback if run metadata gives owner (`No`); decide whether `paused` Main should wake and whether `"Ask to prepare"` targets the sub (`Yes`) | **No** for `lanes-source.js:143` and missing-record bugs; **Yes** for `paused` Main wake and `"Ask to prepare"` target |

---

## Go / No-Go and Owner Steps

### Verdict: No-Go for the documented ladder on Lowbeam

Do **not** run a live `machineroom/sector-ID` trial on `C:\GitHub\Lowbeam` yet. Sub turns execute inside `C:\GitHub\Lowbeam` with write access and prompt orders to fast-forward "in the project", while `machineroom/sector-ID` is invisible to Reviews and breaks `.worktrees\<lane>` reuse once merged. Keep Lowbeam on the **flat setup** (all lanes reporting to Main) until at least the five Critical and High fixes above are landed.

### Steps if the owner still runs a tightly supervised trial (1 sub, 2 lanes, no sector merges)

Only use this to verify ladder UI, sector wake routing, and scope notices on one non-critical test task per lane:

1. **Check Lowbeam git state**: Confirm `C:\GitHub\Lowbeam` has `main` checked out and `git status` is clean, and remove or merge any existing commits in the two trial `.worktrees\<lane>` folders.
2. **Create a 1-sub ladder**: Save a one-sub ladder on `claude` (so `ask` mode is supported and `server/lanes-source.js:143` matches its harness), assigning the two trial lanes and a narrow relative `scope` with `restricted: true` (`server/orchestrators.js:704-727`, `src/control/client.js:424`).
3. **Lock the sub to `ask` mode immediately**: Before sending work, switch the sub orchestrator's mode to `ask` (`src/control/modes.js:5, 12`, `server/orchestrator.js:1906`) in its chat tab so every file write or shell command pauses for your approval.
4. **Prompt with explicit overrides**: Instruct Main and the sub:
   - Never create, checkout, or merge `machineroom/sector-*` (overrides `src/model/hierarchy.js:303-304`).
   - Never modify files, run `git checkout`, or run `git merge` in `C:\GitHub\Lowbeam` (overrides `docs/agents/ORCHESTRATOR-AGENT.md:108`).
   - Start each lane via `POST /api/control/runs/start` with `"worktree": true`, giving the two lanes non-overlapping files and at most **one** task per lane.
   - Never call `/api/control/reviews/<lane>/merge`; reply `sub:<id>` once the lane branches are ready.
5. **Gate every approval**: In the sub's chat tab, approve only read-only checks and `POST /api/control/runs/start` requests that carry `"worktree": true` and target one of its two lanes. Deny any file write, `git` state change in `C:\GitHub\Lowbeam`, or Reviews merge call.
6. **Observe the room**: Verify the sector arc, 0.7-scale sub avatar, lower `subRing` lane placement, Transport sub chip (`waiting` badge in `ask` mode), `Team` chat feed, and post-run `outsideFiles` alerts (test one intentional out-of-scope edit if verifying scope alerts).
7. **Merge via Reviews**: Open **Reviews**, inspect each lane's diff against `main`, and click **Merge** yourself one lane at a time (`git merge --ff-only` into `main`). If the second lane cannot fast-forward after the first merges, rebase `.worktrees\<lane>` onto `main` before merging.
8. **Fallback**: If `C:\GitHub\Lowbeam` becomes dirty, moves off `main`, or either lane needs multiple sequential tasks before merging to `main`, pause the sub and revert the ladder to flat (`subs: []`).
