# Review 60: the review 59 fix batch (P588 to P592)

Task P593. Read from the code only. No test or build was run, and no file changed except this one. Each merge was read against its first parent.

## Grades

| Brief | Merge | Grade | Note |
| --- | --- | --- | --- |
| P588 | `9724657e` | B | R59-1, R59-4 and R59-5 are fixed. The per-lane dedupe can hide a failure, and the moved route does not mask. |
| P589 | `a9fa22c8` | B | R59-2, R59-3, R59-8 and R59-9 are fixed. The keyed remount drops sent messages, and Retry has no guard. |
| P590 | `da11cac2` | B | R59-6 and R59-7 are fixed. The popover has no anchor, and a width of 0 groups every marker. |
| P591 | `ef161968` | A | R59-10 is fixed by removing one line, and the test covers the round trip. |
| P592 | `43fb0564` | A | R59-11 is fixed. `firstCommit` is masked on both server paths and kept by `chatLines`. |

## Findings

### R60-1. The per-lane dedupe can hide an unresolved failure (Low)

`src/briefs/attention.js` ends `attentionItems` with a `seen` set that keeps one item per lane, after `newestByLaneAndMode` made a Plan entry and an edit entry per lane. If a lane's newest edit failed and its newest Plan failed, only the first after sorting is returned. Needs you reports one failure where two are open, and the second shows only after the first is fixed.

Fix by deduping on lane and mode together, or by merging the two texts into one item.

### R60-2. `/api/control/issues` does not mask task text (Low)

The new route at the top of `handle` in `server/runs.js` passes unmasked records to `laneTaskState`. `issueFor` in `server/lane-tasks.js` falls back to `text(task).slice(0, 80)` for the title. The runs route masks keys and home paths with `maskRecordCommits`; this route does not. The old route did not mask either, so this is not a regression, but both routes now sit in one file. A key or home path in a run task would show in a Tasks title.

Fix by mapping the returned issues through `maskRecordCommits`.

### R60-3. The route moved behind a different gate and source (Low)

`/api/control/issues` was served by `control.handle` from `laneNow()` and `runsFile()`. It is now served by `runs.handle` from `currentOpenRuns()` and `recordsPath()`. `runs.handle` runs first (`server/index.js:1785`), so the route answers even when the lanes source is off. I did not run a bridge with no runs folder to see what `readAllRunRecords` gives there. The `status` filter and the mock client are unchanged.

Fix by adding one bridge test with no runs folder and no lanes source that expects `[]`.

### R60-4. Keying the conversation by lane drops sent messages and scroll (Low)

`src/ui/Hud.jsx` (both `LaneConversation` mounts) now has `key={laneChat.lane}`. `sentMessages` lives in `LaneConversation` state (`src/ui/LaneConversation.jsx:146`). Open lane A, send a message while its reply is pending, switch to lane B and back: A's pending message and its scroll position are gone. The draft was already cleared on a lane change, so there is no new draft loss.

Fix by lifting `sentMessages` into the HUD, or by saying in ROOM.md that a lane switch resets the view.

### R60-5. Retry can run while another read is pending (Low)

The Retry button in `LaneSettingsFields` (`src/ui/HarnessesSettings.jsx`) calls `load()`, which has no in-flight guard (line 466). A harness notice can start a read while the error is shown, and Retry then starts a second one. The later reply wins. Both write the same saved values and the dirty guards protect drafts, so the cost is a flash of stale reply settings.

Fix by keeping a read counter in `load` and ignoring older replies.

### R60-6. A failed first lane read looks like no runs (Low)

`src/ui/LaneConversation.jsx:236` sets `runs` to `[]` on a failed first read. That clears a pending Open, as R59-3 asked, but the selection effect then clears `selected` and the Run menu says `No runs` with no error and no retry. The next `runs` notice re-reads and recovers.

Fix by keeping a `readFailed` flag for the message and clearing `wantedRef` there.

### R60-7. The marker popover has no anchor (Low)

`.scrubber-overflow:popover-open` in `src/styles.css` sets no position, so a `popover="auto"` panel sits at the browser default, centred in the viewport, away from its marker. Escape and light dismiss are native and return focus to the invoker, so the chooser can be closed and focus is kept. A first screen with no markers keeps the 56px transport, since the rail is not rendered. One row of markers takes 24px under the slider and relies on the spare room in the base `--transport-h`.

Fix by anchoring the popover with `anchor-name` and `position-anchor`, or by setting its `inset` from the marker's x.

### R60-8. Marker layout at width 0 groups every marker (Low)

`markerLayout` in `src/ui/Transport.jsx` gets `width` 0 until `useLayoutEffect` measures it. If the rail is measured while hidden, every marker sits at x 0, takes row 2 and joins one group, so the transport briefly asks for three rows and shows one chooser. It recovers when `ResizeObserver` reports a real width.

Fix by returning one row for every marker while `width` is 0.

## R59 findings: status

| Finding | Fixed | Where |
| --- | --- | --- |
| R59-1 Plan success hides a failed edit | Yes | `newestByLaneAndMode`, and the plan check in `backupRanLater` (see R60-1) |
| R59-2 Open selects the wrong run on a lane switch | Yes | `key={laneChat.lane}` on both mounts (see R60-4) |
| R59-3 old Open overrides a manual pick | Yes | the Run `onChange` clears `wantedRef`; a failed first read sets `runs` to `[]` (see R60-6) |
| R59-4 another project's success closes a Task | Yes | `recoveryRecords` come from the project-scoped `roomRecords` |
| R59-5 a failed backup marks the run done | Yes | Tasks uses `succeededLater` only; the backup check needs the same briefs and a matching mode |
| R59-6 markers catch slider presses | Yes | the rail is its own grid row below the slider |
| R59-7 close markers cover each other | Yes | rows and a popover chooser (see R60-7, R60-8) |
| R59-8 no Retry on a failed first settings read | Yes | Retry (see R60-5) |
| R59-9 resize replays the Direct API link | Yes | the flag clears when Settings consumes it |
| R59-10 a filter forgets Show all | Yes | `setShowAll(false)` removed |
| R59-11 subject loses text after a semicolon | Yes | `firstCommit` is carried and masked in `addMessage` and the restore path |

## Checks that held

- `/api/control/issues` keeps the `status` filter, and the mock client filters the same way.
- `firstCommit` is masked with `maskText` where it is set and where a saved chat is restored, and `chatLines` passes only a string through.
- The runs route filters by lane before it builds attention, then masks the attention items.

## What I could not verify

I ran no tests and no build. I did not run the bridge with no runs folder, and I did not look at the popover or the transport in a browser.
