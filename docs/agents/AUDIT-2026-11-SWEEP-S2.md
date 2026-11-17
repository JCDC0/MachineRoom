# Sweep S2: the page

P507. Read at 0.1.401, `e092a8ef`, on 2026-11-17. Four findings.
Source review plus inline Node assertions using Vite's module loader and the existing UI test DOM. No source changed.

## S2-1. High: denied browser storage blanks the room

- File: `src/ui/Assistant.jsx:37`. Caller: `src/ui/Hud.jsx:1203`.
- The default prop reads `window.localStorage` outside a try. A browser that denies storage throws `SecurityError` before the guarded settings reader runs. Assistant mounts even when closed, whenever orchestrator health is not yet available or the orchestrator is off. This affects replay and the initial live render.
- See it: block site storage and open a replay. An inline render probe with a throwing localStorage getter reproduced the render exception.
- There is no error boundary above HUD: `src/main.jsx:8` mounts App directly, `src/App.jsx:188` returns Stage, and `src/Stage.jsx:1732` mounts Hud. `src/ui/panels/ControlDrawer.jsx:179` only protects its selected Control panel.
- Fix: use the existing guarded `store()` for Assistant's default. Add a boundary above HUD to contain render and effect errors in its sidebar, chat, settings, Assistant and inspector children. A boundary above Stage would also cover Stage's own render and effects. Event callbacks and rejected async requests still need their own handling.

## S2-2. Medium: an old lane read can erase the final report

- File: `src/ui/LaneConversation.jsx:308`, especially lines 310 and 319 to 321. Trigger: lines 341 to 344.
- Reads are spaced two seconds apart but can overlap within the client's 30 second request limit. The response guard checks only the selected lane and start time. An older answer for that same run can overwrite a newer answer, removing the final report and restoring Stop after the run ended.
- See it: open a working lane conversation and delay one conversation response while new log ticks start another read. Let the newer response return the finished report, then release the older working response. The inline probe reproduced the report disappearing and Stop returning.
- Fix: give each conversation read a sequence number and accept only the newest response, including its error. Invalidate it when the client or selection changes or the component unmounts.

## S2-3. Medium: Reviews can replace fresh evidence with an older list

- File: `src/ui/panels/ReviewsPanel.jsx:365`, especially lines 376 to 378. Callers: lines 405 to 406, 590 and 665.
- Refresh, run notices and the read after a merge can overlap. `mountedRef` prevents writes after unmount but does not order the answers. A slow earlier read can restore old ahead counts, heads and check evidence after a newer list was shown. The owner can see obsolete checks as current. The server's merge checks still guard the actual write.
- See it: click Refresh twice with the first request delayed. Return the second list first, then the first list. The inline probe confirmed the newer lane list was replaced by the older one.
- Fix: use the existing `latestOnly()` pattern for `loadReviews`, and invalidate reads on client change and unmount.

## S2-4. Medium: background notices discard unsaved Harnesses settings

- File: `src/ui/HarnessesSettings.jsx:132`, lines 134 to 136 and 149 to 155.
- Every family, endpoint, key or harness notice calls `loadAll`. Its answer replaces program drafts, the lane warning, the worktree setup command and the copy list, even while the owner is editing them. Unrelated agent activity silently loses the draft. Saving another Harnesses setting can also reset program drafts at line 175.
- See it: edit Worktree setup command and Copy into new worktrees without saving. Change an agent label in another tab so a family notice arrives. Both fields revert to saved values. The inline probe reproduced both lost edits with a family notice.
- Fix: keep dirty fields when adopting background answers. Reset only the fields whose save succeeded, or when the owner explicitly discards them.

## Startup request check

The six startup requests were reproduced in a 1280 pixel HUD mount, but they are not six reads of the same resource:

- Sidebar reads `/api/orchestrator/sessions?id=orchestrator` at `src/ui/Sidebar.jsx:126`.
- HUD reads `/api/orchestrator/sessions` at `src/ui/Hud.jsx:354`. These two session reads are equivalent.
- HUD reads `/api/orchestrators` at `src/ui/Hud.jsx:383`. In the full page Stage owns that shared list at `src/Stage.jsx:917`.
- Chat reads `/api/orchestrator` once at `src/ui/OrchestratorChat.jsx:498`.
- Chat reads `/api/orchestrator/commands` at `src/ui/OrchestratorChat.jsx:463`, then repeats it when the first chat answer supplies the harness, a dependency at line 481.

`src/control/client.js:42` does not share requests. The duplicated session and command reads are avoidable startup work, not six model turns. `server/orchestrators.js:1324`, 1329 and 1339 handle these as GET reads. No fault was established from this small burst, and no sixfold identical chat read was reproduced.

## Limits

No real browser or screen check ran. Overflow at 1280x800, visible keyboard focus and screen reader behavior are left to the orchestrator. The UI test DOM does not implement browser layout or CSS selector parsing. The findings above do not depend on its selector parser.

## Checked and fine

- The dynamic dialog selector at `src/ui/dialogFocus.js:25` escapes the id when CSS.escape exists and catches selector errors. Current opener arguments are plain ids. Guide and stage selectors read here come from fixed constants, not project names or paths.
- The reviewed HUD, Guide, Inspector, lens rail and stage intervals, DOM listeners and observers have cleanup. `src/control/client.js:129` closes its EventSource when the last subscriber leaves. `src/live/bridge.js:143` closes the live stream and clears its reconnect timer.
- Chat's main read already rejects older responses at `src/ui/OrchestratorChat.jsx:494`. Repository reads do so at `src/ui/RepositoryPanel.jsx:38`. The reviewed file preview and App source loader ignore answers after their effects end.
- Settings, model sort, session sort and the show-agent-messages preference use guarded storage reads and validate saved values. Assistant's storage getter is the exception above.
- The reviewed Reviews Diff control, model pins, lens sliders, transport actions and family row actions have native keyboard controls and visible text or accessible names. No additional definite keyboard blocker was established from source.
