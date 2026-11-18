# Review 59

P583 reviews the repository branch list, small controls, chat titles, Tasks status and the four Review 57b fixes. The review compares each merge with its first parent and checks the connected code on `main` at `38706ccc`.

| Brief | Merge | Grade | Result |
| --- | --- | --- | --- |
| P567 | `912b834c` | B | The branch fold works. Filtering forgets the expansion. |
| P568 | `fc618287` | A | The six targets have room for the shared hit area in the layouts inspected in code. |
| P569 | `17c59c1f` | B | The titles work with the supplied values. The run notice parser can cut the subject before it reaches the title. |
| P570 | `d83e1150` | C | Later successes can resolve Tasks rows. A failed backup or another project's success can also mark a row done. |
| P576 | `d91b5b35` | C | Three controls gain the intended hit areas. The seek markers still collide with the slider and one another. |
| P577 | `579ac7db` | D | The common paths work. The lane, history, layout and failed-read transitions still break. |

## Findings

### R59-1. A Plan success hides a failed edit on the same lane (Medium, P577)

Needs you takes the newest record per lane before it checks whether later work resolved a failure. If a Codex edit fails with no `mode` recorded, then Codex successfully plans the same brief, the failure disappears from Needs you. The shared helper correctly rejects that Plan success, and Tasks still shows the edit as blocked. A Plan success on another lane leaves the warning visible. [src/briefs/attention.js:76](../../src/briefs/attention.js#L76), [src/briefs/attention.js:101](../../src/briefs/attention.js#L101)

Fix by tracking the newest Plan and potential edit records separately before choosing one unresolved failure per lane.

### R59-2. Open can select the wrong run when switching lanes (Medium, P577)

The HUD reuses the lane conversation, and its `runs` state still holds the previous lane's answer during the first render for the next lane. With lane A open, click Open for a failure on lane B while B also has a newer live run. The selection effect sees A's nonempty history, drops the requested timestamp and selects B's live run. The reply with B's history cannot restore the request. The same issue selects B's latest run if no live run is available. [src/ui/Hud.jsx:1053](../../src/ui/Hud.jsx#L1053), [src/ui/LaneConversation.jsx:216](../../src/ui/LaneConversation.jsx#L216), [src/ui/LaneConversation.jsx:258](../../src/ui/LaneConversation.jsx#L258)

Fix by using a lane key on both HUD conversation mounts so each lane starts with its own pending history.

### R59-3. An old Open request can override a manual selection (Medium, P577)

A rejected history read leaves `runs` at `null`, which the selection effect treats as a read still in progress. Open a failed run while history is temporarily unavailable, then pick the live run from the Run menu. If a later run notice reloads the history and finds the original request, the conversation jumps away from the run you picked. [src/ui/LaneConversation.jsx:235](../../src/ui/LaneConversation.jsx#L235), [src/ui/LaneConversation.jsx:265](../../src/ui/LaneConversation.jsx#L265), [src/ui/LaneConversation.jsx:538](../../src/ui/LaneConversation.jsx#L538)

Fix by clearing the pending Open when its first history read fails or the owner chooses a run.

### R59-4. A success in another project can close a failed Task (Medium, P570)

Tasks passes the latest records from the shared run log into the recovery check. Needs you filters the log to the current project first. If `Run the checks` fails in project A and succeeds in project B, the shared task text is enough for Tasks to mark A's row done. Needs you in A still shows its failure. [server/control.js:216](../../server/control.js#L216), [src/briefs/attention.js:79](../../src/briefs/attention.js#L79), [server/runs.js:1859](../../server/runs.js#L1859), [server/runs.js:2042](../../server/runs.js#L2042)

Fix by passing the same project-scoped records to Tasks and Needs you before checking whether later work resolved a failure.

### R59-5. A failed backup marks the original run done (Medium, P570)

`backupRanLater` checks that a backup took over, without checking its outcome. If Codex fails and its backup also fails, Tasks marks the Codex row done. Needs you shows the backup failure. The helper also accepts any later record on the target lane when it cannot find a matching handoff. [server/lane-tasks.js:100](../../server/lane-tasks.js#L100), [src/briefs/attention.js:39](../../src/briefs/attention.js#L39)

Fix by using `succeededLater` for Tasks completion and keeping the takeover check for Needs you.

### R59-6. Seek markers capture presses meant for the slider (Medium, P576)

The marker buttons sit above the range input. Their new hit areas reach across the full 24-pixel scrubber row at each marker's x position, and the marker handles clicks while the range handles drags. Press the replay thumb where its x position crosses a marker and drag. The marker receives the press and the range never starts dragging. The visible markers already intercepted presses over their painted area before this change. [src/styles.css:2648](../../src/styles.css#L2648), [src/styles.css:2669](../../src/styles.css#L2669), [src/ui/Transport.jsx:241](../../src/ui/Transport.jsx#L241)

Fix by keeping the marker hit areas on a separate rail aligned with the slider.

### R59-7. Two close seek markers can cover each other (Low, P576)

Markers are 4 pixels wide, share a vertical center and have no minimum separation. On a 500-pixel slider, events 2 seconds apart in a 1,000-second replay sit 1 pixel apart. Events with the same timestamp sit exactly on top of each other, so pointer input can reach only the later-painted button. The height-only rule keeps this existing overlap from getting wider. [src/ui/Transport.jsx:252](../../src/ui/Transport.jsx#L252), [src/styles.css:2669](../../src/styles.css#L2669)

Fix by stacking colliding markers in separate rows on the marker rail while keeping their time positions aligned.

### R59-8. A failed first settings read leaves Save off without a retry (Medium, P577)

When the first `client.harnesses()` call fails, the Lanes tab shows the error and keeps both Save buttons and the reply selector disabled. The owner can still type a worktree setup draft. Switching tabs leaves the fields mounted, and closing and reopening Settings retries at the cost of that draft. A later harness notification can also trigger a read. [src/ui/HarnessesSettings.jsx:466](../../src/ui/HarnessesSettings.jsx#L466), [src/ui/HarnessesSettings.jsx:538](../../src/ui/HarnessesSettings.jsx#L538), [src/ui/Settings.jsx:171](../../src/ui/Settings.jsx#L171)

Fix by adding a Retry button beside the first-read error that calls the existing `load` and preserves the draft.

### R59-9. Resizing replays the Direct API link (Low, P577)

The HUD keeps the request number until Settings closes. Open the Direct API link, choose Lanes, then resize across 900 pixels with Settings open. The other Settings layout mounts with a fresh record of requests it has seen, reads the old number and selects Direct API again. Closing and reopening from the menu uses the saved tab as intended. [src/ui/Hud.jsx:310](../../src/ui/Hud.jsx#L310), [src/ui/Hud.jsx:950](../../src/ui/Hud.jsx#L950), [src/ui/Hud.jsx:1001](../../src/ui/Hud.jsx#L1001), [src/ui/Settings.jsx:75](../../src/ui/Settings.jsx#L75)

Fix by clearing the request in the HUD when Settings consumes it.

### R59-10. A filter round trip forgets Show all (Low, P567)

With 50 branches, choose Show all, type a narrow filter and clear it. The unfiltered list folds back to the current branch and 20 others because every filter edit clears `showAll`. The merge added a test for that reset. Timer and git notice refreshes keep the expansion while the panel stays mounted. [src/ui/RepositoryPanel.jsx:38](../../src/ui/RepositoryPanel.jsx#L38), [src/ui/RepositoryPanel.jsx:241](../../src/ui/RepositoryPanel.jsx#L241)

Fix by leaving `showAll` alone on filter edits and letting the existing filter logic bypass the fold.

### R59-11. The run subject title can still lose text (Low, P569)

The tooltip uses the parsed subject. The parser splits the commit list on every semicolon followed by a space, so a commit with the subject `Fix the picker; keep drafts` shows and hovers as `Fix the picker`. Details still holds the original notice. The parser predates this merge. [server/orchestrator.js:898](../../server/orchestrator.js#L898), [src/ui/roomNotice.js:7](../../src/ui/roomNotice.js#L7), [src/ui/OrchestratorChat.jsx:1488](../../src/ui/OrchestratorChat.jsx#L1488)

Fix by carrying the first commit subject as a structured field and reading it for both the summary and title.

## Checks that held

- P567 keeps the current branch first, shows 20 other rows at most and keeps the 200-row cap with filters and expansion. The button can say `Show all 201 branches` while showing 200 after the click. P567 expressly asks for both the total in the label and the cap, so this is a wording mismatch in the brief.
- P568 adds the five new selectors to the shared rule and retains the Reviews badge already covered by P552. The branch rows have a 24-pixel minimum height, the spend button has a 16-pixel gap to the context control, and the Reviews badge has reserved room within Control. I found no new overlap between these controls in the CSS and markup.
- P569 adds title text for the model header, run subject, effort and mode. The project label already has a title. The hover text and the visible label use the same values.
- P570 requires later success for every brief in a multi-brief failure. An earlier success or a later success on only one brief leaves the row blocked.
- P576 extends the unit toggles, refresh and waiting Close without changing their visible sizes. The unit buttons are already 30 pixels wide, and the refresh row has a 6-pixel gap. The marker has 24 pixels of height and 4 pixels of width under the brief's height-only exception. The CSS tests check declarations and do not measure hit testing.
- P577 selects a requested run with current history on the same lane, rejects a Plan-only recovery for a failure with no mode recorded in the helper, and disables Save while the first lane settings read is pending. After a Direct API link, closing Settings and reopening it from the menu opens the saved tab. The run route applies the lane filter before building attention, as documented.

Nine in-memory diagnostic scenarios reproduced the state and data issues or confirmed the stated cap. No Vitest files or build were run for this audit. Browser hit testing, native tooltips and the responsive layout by eye are left to the orchestrator.
