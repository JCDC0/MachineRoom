# Audit of the page, November 2026

Written 2026-11-03 by OpenCode 2 on the branch `feat/q21-audit-of-the`, cut from `refs/heads/main` at `cd4581b` (0.1.401), for brief Q21. File and line numbers are those of that commit. This run read code only. It changed no code, ran no test suite and started no bridge, lane or agent, as the brief asks.

Scope: `src/Stage.jsx`, `src/App.jsx`, `src/live/**`, `src/ui/**`, `src/ui/panels/**` and `src/styles.css`. Desktop only, so nothing below 900 pixels is listed. The findings below are not in `AUDIT-2026-10-V10.md` and not in the fixed or open items of `AUDIT-2026-11.md`. Where one of those audits already names a fault, it is left out even if it still stands.

## Severity

- Medium: wrong execution or state, a lost update, runs that keep starting and spend money, or a modal that lets a keyboard user act on the page behind it.
- Low: an edge case, a small accessibility or layout fault, or wasted work with no lasting harm.

No finding is High. Nothing here leaks a key, writes outside the project, or starts a run the owner did not confirm.

## Findings

| # | Severity | Where | The case and what goes wrong | Smallest fix |
| --- | --- | --- | --- | --- |
| 1 | Medium | `src/Stage.jsx:1116-1157`; `src/ui/panels/ControlDrawer.jsx:97-115`; `src/ui/panels/ReviewsPanel.jsx:282-294` | The room's key handler runs on `window` and never checks `event.defaultPrevented`. The control drawer's tabs handle ArrowLeft and ArrowRight and call `preventDefault` but not `stopPropagation`, so every arrow key that moves a tab also calls `player.seek(position ± 5000)` and jumps the replay 5 seconds. The same handler fires behind the open drawer for `f`, `t`, `0`, `[` and `]`, which is not a dialog and does not block keys. On a review row, Space calls the row's `onKeyDown` (opens the diff) and then the room's handler pauses or resumes playback. Typing in an input is blocked by `hudKeyBlocked`, so text fields are safe. | Return early at the top of `onKey` in `Stage.jsx` when `event.defaultPrevented` is true, and add `event.stopPropagation()` to `handleTabKeyDown` and the review row's key handler so each control owns its keys. |
| 2 | Medium | `src/ui/panels/runs.js:89-117`; `src/ui/panels/DispatchPanel.jsx:650-676` | The "One lane per task" split run cannot be stopped. `startSplitRun` sets a module-level `active` flag, starts one lane, waits 3 seconds, starts the next, and has no cancel check between them. The confirm card disables both Confirm and Cancel while `splitActive` is true, and no Stop control exists. Closing the drawer, changing tab or switching the room to replay unmounts the panel but leaves the loop running with its own `client`, so the remaining lanes keep starting and spending. Only a full page reload ends it, and the runs already confirmed are in flight. | Add a `cancelSplitRun()` that sets a flag checked before each `startRun` and each wait, export it from `runs.js`, and render a Stop button in the card while `splitActive`. |
| 3 | Medium | `src/ui/Hud.jsx:1111-1146` (help); `src/ui/SetupCard.jsx:107-114` (first run); `src/ui/Launcher.jsx:172-173` (folder picker); `src/ui/Sidebar.jsx:606-630` (confirm) | Four surfaces declare `role="dialog"` and `aria-modal="true"` but move no focus into themselves and trap nothing. Keyboard focus stays on the button that opened them, so Tab walks the menu and page behind the backdrop, and Enter or Space then activates a control the dialog is covering. Example: open Help with `?`, press Tab three times, and focus lands on the mode buttons behind `.hud-help-backdrop`. The control drawer already does this correctly at `ControlDrawer.jsx:68-83`, so the pattern exists in the code. | In each surface, focus the first control on mount, wrap Tab and Shift+Tab inside the dialog, and restore focus to the opener on close. Reuse the drawer's effect. |
| 4 | Low | `src/ui/Hud.jsx:553-557` (log drawer), `:559-563` (lower replay log) | The event log is scrolled to `scrollHeight` whenever a new line arrives, with no check of where the owner is. Scroll up to read an earlier event in a replay, and the next activity, often within seconds, pulls the list back to the bottom. The first effect runs whenever the log drawer or the log dropdown is open, in either mode; the second runs at 900 pixels and wider in a replay. | Only set `scrollTop` when the body was already within a line or two of the bottom before the update. |
| 5 | Low | `src/ui/Hud.jsx:60-63`, `:801-827` | The health chip shows a popover labelled `role="dialog"`. `hudKeyBlocked` treats any `[role="dialog"]` anywhere in the page as a text field, so while the popover is open Stage and Hud ignore Space, L, C, `?`, F and the number keys, and the transport keys stop responding. The popover is not modal: it sits under the chip, has no backdrop, and only closes from its own Close button or Escape. | Drop `role="dialog"` for the popover (a `role="group"` or plain div with a label is enough), or make `hudKeyBlocked` ignore a dialog that is not `aria-modal`. |
| 6 | Low | `src/ui/panels/ReviewsPanel.jsx:282-307` | The review row is a `div` with `role="button"` and `tabIndex={0}`, and the Merge `<button>` is nested inside it. Nested interactive content is invalid ARIA: some screen readers expose only the outer button and hide Merge. Pressing Enter or Space while Merge has focus bubbles to the row's `onKeyDown`, which calls `preventDefault` and toggles the diff, while the button also acts, so the diff opens or closes under the merge confirm. | Take `role`, `tabIndex` and `onKeyDown` off the row and use a real button for the row's expand action next to the Merge button, or stop keydown propagation in the Merge button. |
| 7 | Low | `src/Stage.jsx:737` | The room starts `setInterval(() => setSnapshot(player.snapshot()), 120)` and `player.snapshot()` returns a new object every call. React therefore re-renders `Stage` and the whole HUD tree (menu, dock, sidebar with whichever tab is open, inspector, floating chat) 8 times a second even while a replay is paused and the position, duration and agent list are unchanged. In live mode every one of those renders also rebuilds `list`, `nav` and the 50 visible log lines in `Hud`. | Compare the fields that the HUD reads with the previous snapshot and call `setSnapshot` only when one changed; or pause the interval while the player is paused and nothing is streaming. |
| 8 | Low | `src/ui/Hud.jsx:776-786` | The Settings button has `aria-controls="hud-settings"`, but no element with that id exists. The settings surface is a `div.hud-dropdown.is-settings` at `:952-962`, and the one in the dock at `:906-914` has no id either. The relation is dangling, so assistive technology cannot move to the panel the button claims to control. | Add `id="hud-settings"` to both settings containers, or remove `aria-controls` from the button. |

## Efficiency

Each item names what it saves and how to measure it. None was timed in this run; no dev server was started.

1. `src/Stage.jsx:737`: the 120 ms snapshot interval re-renders the HUD 8 times a second when nothing changed (finding 7). On a paused replay that is 8 commits a second doing no visible work; on a 4-core laptop the three.js frame budget absorbs it, but it keeps the main thread busy while the owner reads. Measure with React DevTools Profiler set to "record why each component rendered": count commits in 10 seconds paused. A position and status compare before `setSnapshot` should cut it to zero.
2. `Stage.jsx:791` and `Hud.jsx:446` each poll `/api/control/orchestrators` every 60 seconds while the room is open, and `OrchestratorChat.jsx:255` polls the same list every 10 seconds while it is mounted (`ORCH_REFRESH_MS`). `OrchestratorChat.jsx:294` reads the selected chat on the same 10-second timer, and all three also refetch on the same `orchestrator` notice. `Stage.jsx:1023` polls costs every 60 seconds, and `MetersPanel.jsx:59` reads them once on mount and again on every costs notice, so the room and the drawer each hold a copy and both refetch on the same notice. `Stage.jsx:1023` also polls agents. Each owner counts as one HTTP request and one JSON parse on its timer, and each notice triggers several answer handlers. Measure by counting requests per endpoint in the devtools Network panel for two minutes with the drawer closed; sharing one poll (or one context value) should remove two of every three orchestrator requests and one of every two cost requests.
3. `src/ui/Inspector.jsx:216-237`: while the inspector shows an orchestrator, its chat is re-read every 10 seconds even while the inspector is scrolled out of view or the owner is not looking at it. The orchestrator stream already sends `orchestrator` notices, which `OrchestratorChat` and `Stage` use. Measure with the Network panel while the inspector is open and idle: one request every 10 seconds that a subscription would replace with one per real change.
4. `src/ui/panels/DispatchPanel.jsx:313-317`: the target-brief effect has no dependency array, so it runs after every render of the panel and re-evaluates `briefTarget` each time. It is guarded by `pickedTargetRef`, so it cannot loop, but it is work on every keystroke in the task textarea. Measure with the Profiler on a render of the panel. Adding `[targetResult?.brief?.id, loading, loadError]` costs one line.
5. `src/ui/Hud.jsx:264`: `visibleLog = log.slice(-50)` makes a new array on every one of those 120 ms renders, and `EventLogBody` then diffs 50 rows. The same is true of `list.rows`, `activeRows` and `idleRows` at `:270-276`. Memoising the slice on `log.length` and the grouping on `lanes` would save the diff when nothing changed. Measure with the Profiler's "rendered" count for `EventLogBody`.

## What to delete

All of these class families are in `src/styles.css` and no `.js`, `.jsx`, `.mjs` or `.html` file under `src` contains the name. A scan over all 155 source files found 130 class names with no use; the groups below are the largest and clearly belong to removed UI. Delete the rules, then re-run `npm run build` and check the page by eye, because a class built by string concatenation cannot be ruled out by a text scan.

- `.plan-*`, 29 selectors, lines 4114-4300 (about 187 lines): the old plan panel. `src/briefs/plan.js` is model code and has no matching UI.
- `.dispatch-route-*`, 9 selectors, lines 4438-4505: the old routing choice in the dispatch panel. Routing now happens in `src/startup.js` and `src/policy/route.js`.
- `.strip-*` subset, about 20 selectors around lines 1162-1520: `strip-agent-choice`, `strip-agent-key`, `strip-agent-name`, `strip-context`, `strip-dot`, `strip-expand`, `strip-half`, `strip-identity`, `strip-info`, `strip-log`, `strip-log-line`, `strip-model-label`, `strip-model-name`, `strip-model-wrap`, `strip-name`, `strip-name-text`, `strip-percent`, `strip-switch`, `strip-switch-row`, `strip-v`. `AgentStrip.jsx` still uses only `strip-card`, `strip-label`, `strip-btn`, `strip-input` and `strip-note`, so keep those five.
- `.mr-orch-attach*`, `.mr-orch-field*`, `.mr-orch-lane*`, `.mr-orch-lanes`, `.mr-orch-problems`, `.mr-orch-switch`, `.mr-orch-tab-detach`, lines 6211-6416: an older chat header and lane editor. The live chat uses `mr-orch-tab`, `mr-orch-tabs` and `mr-orch-input`, which stay.
- `.mr-side-lane*`, `.mr-side-orch*`, `.mr-side-editor`, `.mr-side-gear`, `.mr-side-meta*`, `.mr-side-auto`, `.mr-side-roster-group`, `.mr-side-tag`, `.mr-side-add`, `.mr-side-foot`, lines 7209-8666: the removed lane editor in the sidebar.
- Single rules: `.thread-composer` (4733, comments are read only), `.tab-badge` (3765), `.panel-limits` (3934-3950), `.hud-status-line` (976), `.hud-status-sep` (1055), `.hud-status-value` (1059-1064), `.endpoints-url` (9620-9629).

No dead UI module is claimed. The brief's reading stopped before several files (listed below), so this pass did not prove any module unused; the classes above are the part it could prove.

## Visual bugs you can tell from the code

- The event log jump in finding 4 is visible: a list that keeps returning to the bottom while the owner is reading it.
- `.transport .mono` is `white-space: nowrap` and the live transport is a grid of `minmax(0, 1fr) auto minmax(0, 1fr)` with up to four 88-pixel chips centred (`styles.css:9007-9100`). A long sub name is clipped inside a chip by design, but the centred group has no overflow rule of its own, and at 900 to about 1,100 pixels a long orchestrator state plus four chips is the first thing to touch the clock. This is a code read, not a measurement; it is left to the orchestrator's eye at 1280 by 800.
- The transport's "since opening" clock and the context ring sit in the right column and are `nowrap`; with the drawer open at 900-1,100 pixels the same squeeze applies. Same check.

## Unproved

- Whether a single `pointerdown` with `pointerId` reuse can still leave one of the Assistant's window listeners behind. U91 moved the drag into an effect with a cleanup, and the read shows the cleanup is returned on every path. Not mounted or dragged here.
- The actual stacking order of the floating chat over the lens, the sidebar overlay and the transport. The code sets `z-index` values but no browser was used.
- Whether a 20-task split run at 3 seconds apart outlives the browser's background-tab timer throttle in a way that changes the order. `runs.js` awaits its own timeout, so order is preserved, but the delay is not measured.

## What this session could not verify

- A browser, a screen or a 1280 by 800 window. Every layout claim above is a code read.
- A live bridge, a lane run or an orchestrator. Finding 2 was read, never started; no run or write was made.
- The real behaviour of focus with a screen reader. Finding 3 was read from the DOM order and the missing focus calls.
- The test count. The brief says this run only reads, so no test suite was run. The last recorded full runs are 3,391 tests in 192 files at `dd9c236` (`AUDIT-2026-10-V10.md:3`) and 3,662 tests in 213 files at `2e67a08` (`AUDIT-2026-11.md:21`); the count at `cd4581b` was not measured and is unchanged by this branch, which touches only this file.

## What I did not reach

The brief asks for the audit by minute 30 even unfinished, so the reading stops here. These files were not read or were read only in part, and no finding is claimed for them beyond what the shared code above shows:

- Not read: `src/ui/FamilyTeam.jsx`, `src/ui/EndpointsPanel.jsx`, `src/ui/McpSettings.jsx`, `src/ui/SearchSettings.jsx`, `src/ui/MusicPlayer.jsx`, `src/ui/ModelRefresh.jsx`, `src/ui/AutocompactInput.jsx`, `src/ui/Guide.jsx`, `src/ui/Settings.jsx`, `src/ui/Connect.jsx`, `src/ui/agentContext.js`, `src/ui/orchestratorChat.js`, `src/ui/family.js`, `src/ui/agentList.js`, `src/ui/inspector.js` (helpers), `src/ui/repository.js` and the `src/ui/panels` helpers other than `notices.js` and `runs.js`.
- Read only in part: `src/ui/FamilyTree.jsx` (lines 150-509), `src/ui/Inspector.jsx` (120-319), `src/ui/OrchestratorChat.jsx` (225-730), `src/ui/RepositoryPanel.jsx` (40-129), `src/ui/Launcher.jsx` (55-184), `src/ui/Assistant.jsx` (effects list only), `src/App.jsx` and `src/Stage.jsx` (both complete), `src/live/**` (complete).
- No keyboard-only or screen-reader pass, no zoom or text-scaling pass, and no check of the panels' forms for overflow at 1280 by 800.

## Commands run

- `git switch -c feat/q21-audit-of-the refs/heads/main`: pass, at `cd4581b` (0.1.401).
- `wc -l` over `src/ui/*.jsx`, `src/ui/*.js`, `src/ui/panels/*`, `src/live/*.js`, `src/Stage.jsx`, `src/App.jsx`, `src/styles.css`: 31,683 lines in the named files.
- One read-only Node scan over `src/styles.css` and 155 source files for class names that appear in the stylesheet and in no source file: 130 names, filtered by hand to the groups above.
- `grep` over `src` for each candidate family to confirm no use: `.plan-*`, `.dispatch-route-*`, the `.strip-*` subset, the `mr-orch-*` and `mr-side-lane*` groups, and the single rules.
- `git status`, `git diff --stat` and `git diff --check` after writing this file: only this file changed, no whitespace errors.
- No test suite and no build were run, per the brief. No dev server was started, per the house rule for a run that cannot see the screen.
