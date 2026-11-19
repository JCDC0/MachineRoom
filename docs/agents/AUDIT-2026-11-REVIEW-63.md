# Review 63

P626 reviewed five merges from `fb612313..HEAD` at `4528b507`: P620 (`136ccebe`), P621 (`88f2f5d5`), P622 (`1565c38d`), P623 (`4d6720dc`) and P624 (`4528b507`). They fix the eleven findings from `docs/agents/AUDIT-2026-11-REVIEW-62.md` and two follow-ups on chat dot colours.

## Findings

1. **Medium. FamilyTree hover cards still stay stale across local midnight (P621).** `src/ui/FamilyTree.jsx:64`, `src/ui/FamilyTree.jsx:885`, `src/ui/FamilyTree.jsx:2544` and `src/ui/controls.jsx:215`.
   - Leave the Agents list open at 23:55 after a run finishes. At 00:01, hover or focus that lane row. `lastRunByLane` now stores the raw `startedAt` timestamp, so a later render would format it fresh, but `FamilyTree` has no midnight timer and `HoverCard` manages its own `visible` state without re-rendering its parent. The card still shows `Last run 23:55:00 · finished` with no date.
   - Add a midnight refresh tick in `FamilyTree` and pass an open callback (or a detail builder called while open) through `HoverCard` so opening the card after midnight recomputes `lastRunText`. Reproduced in the test DOM with fake Date timers.

2. **Medium. LaneConversation's status line and active-run hint stay stale across local midnight (P621).** `src/ui/LaneConversation.jsx:131`, `src/ui/LaneConversation.jsx:252` and `src/ui/LaneConversation.jsx:854`.
   - Open an idle lane whose last run started at 23:55. At 00:01, open the Run picker (or let the midnight timer fire). `RunChip` re-renders and updates the Run chip and its options to `11-18 23:55:00`, while `LaneConversation` does not re-render. The composer status line directly below (`Run 23:55:00`) and the hint for another live run (`... is working on run 23:55:00`) stay on the pre-midnight format and disagree with the Run chip. `RunChip`'s `useEffect` at line 133 also omits a dependency array, so it cancels and reschedules its midnight timeout on every render, including every keystroke in the composer.
   - Lift the midnight refresh state into `LaneConversation` (depending on the day tick so the timer reschedules once per midnight) and pass a refresh callback to `RunChip`'s `onFocus` and `onMouseDown`. Reproduced in the test DOM with fake Date timers.

3. **Medium. A fast-finishing lane start stays on the old run and leaves auto-selection armed (P621).** `src/ui/LaneConversation.jsx:382` and `src/ui/LaneConversation.jsx:530`.
   - Open an idle lane that has a prior finished run and submit a new task. If the new run exits or fails before the `runs` notice read resolves, it arrives in `recent` with `running: false`. Line 382 only checks `run.running && !pending.has(run.startedAt)`, so the old run stays selected and the owner misses the new run. Worse, `startedRunRef.current` stays non-null until the lane changes or the owner picks a run, so any unrelated background run that starts later on that lane hijacks the view.
   - Select an unseen running run first, otherwise an unseen newer run in `options`, and clear `startedRunRef.current` when matched (or if no new run appears after the start finishes). Reproduced in the test DOM.

4. **Low. Spawned subagents get a fresh palette colour instead of their parent's room colour (P623).** `src/ui/orchestratorChat.js:256`, `src/ui/Hud.jsx:255` and `src/engine/agents.js:1261`.
   - P623 removed the `!agent.parent` filter in `chatAgentColors` so hierarchy lanes from `/api/lanes` (which carry `parent: 'orchestrator'` and no `depth`) keep their roster colours. `Hud.jsx:255` feeds `snapshot.agents` into `chatAgentColors`, which also includes spawned subagents (`depth > 0`, `parent: 'claude'`). The 3D room (`src/engine/agents.js:1261-1265`) runs `agentColors` on root agents only and copies `parent.color` onto spawned subagents, whereas `chatAgentColors` gives `claude~1` its own palette slot (magenta or pink instead of `claude`'s orange, as now pinned at `tests/hud-orchestrator-focus.test.js:382`).
   - Exclude spawned subagents (`agent?.depth > 0 && agent?.parent`) from the `agentColors` pass in `chatAgentColors` and inherit their parent's colour, while keeping hierarchy lanes (`!(agent?.depth > 0)`) in the main pass. Reproduced with `chatAgentColors` and `agentColors`.

5. **Low. Agent message `:first-of-type` turns later markdown blocks inline (P620).** `src/styles.css:5952` and `src/ui/OrchestratorChat.jsx:1384`.
   - To keep `.mr-agent-dot` inline with the first paragraph of an agent message, `src/styles.css:5952` sets `display: inline` on `.mr-orch-line.is-agent > .mr-orch-blocks > .mr-orch-block:first-of-type`. Because `:first-of-type` matches the first child of each HTML tag type, an agent message with a leading `<p>` followed by a `<ul>`, `<ol>`, `<pre>`, `<h1..6>` or `<div class="is-table">` (from `src/ui/markdown.jsx:82-135`) also makes that first list, code block, heading or table `display: inline`, breaking vertical spacing (`margin-top: 6px`) and horizontal scroll on code blocks and tables.
   - Replace `.mr-orch-block:first-of-type` with `.mr-agent-dot + .mr-orch-block` so only the single block immediately after the dot is inline. Verified against the CSS and `src/ui/markdown.jsx`; visual effect needs a check by eye.

6. **Low. Reopening floating chat from the Orchestrator button on a To lane leaves the composer unfocused (P620).** `src/ui/Hud.jsx:877`, `src/ui/OrchestratorChat.jsx:535` and `src/ui/LaneConversation.jsx:287`.
   - At 800 pixels wide (or in wide Replay with a connected bridge), open floating chat with the top-bar Orchestrator button (`chatFocus` stays `0`), pick a lane such as `opencode` in To, close floating chat, and click the Orchestrator button again. `Hud.jsx:878` toggles `setChatOpen(true)` without incrementing `chatFocus`. `OrchestratorChat.jsx:535` fires its 20 ms focus timer on `inputRef.current` (which is `null` while `<LaneConversation>` is rendered at line 1270), and `LaneConversation.jsx:287` skips focusing because `focusRequest (0) === focusAtRef.current (0)`. Focus remains on the header button. Band clicks and `/` do focus it because `showChat` increments `chatFocus`.
   - Increment `chatFocus` when the Orchestrator button opens the floating chat (or focus on mount in `LaneConversation` when `!inline`). Reproduced in the test DOM at 800 pixels wide.

7. **Low. A completed succeeding tool call still glows active while a live run thinks (P621).** `src/model/conversation.js:191` and `src/ui/LaneConversation.jsx:756`.
   - In a live Claude run, `Bash ls` starts and returns `tool_result` with no error (`ok: true`), and the model pauses before its next text block. `conversationFromLog` only writes `call.ok = false` on failure and leaves `call.ok` undefined on success. `LaneConversation.jsx:756` treats the last tool row of a running transcript as active, so `toolToneClass` still colours the already-finished `Bash ls` chip yellow (`is-working`).
   - Record `call.ok = activity.ok !== false` on `tool.end` in `src/model/conversation.js:193` and skip the `active` yellow fallback in `toolToneClass` when `entry.ok === true`. Reproduced in the test DOM with a live Claude log.

8. **Low. Inline Jump to newest clips its keyboard focus outline vertically (P621).** `src/styles.css:8416` and `src/styles.css:11572`.
   - `.mr-orch.is-inline .mr-orch-jump-row` now sets `overflow-y: hidden; scrollbar-gutter: stable;` with `padding-inline: 24px` and zero vertical padding. `button.ui-chip:focus-visible` draws `outline: 1px solid var(--white); outline-offset: 2px;`, so the top and bottom edges of the focus outline extend 3 px past the padding box and are clipped by `overflow-y: hidden`.
   - Add `padding-block: 4px` to `.mr-orch.is-inline .mr-orch-jump-row` while keeping `overflow-y: hidden; scrollbar-gutter: stable;`. Verified against the CSS; visual layout remains with the orchestrator.

## Review 62 closure check

- **R62-1 (sub recipient from Agents lane):** Closed in both wide (1200 px) and narrow (800 px) layouts by P620.
- **R62-2 (new run selected after start):** Closed for live runs that are still running when the notice resolves (P621); fails for fast-finishing starts (Finding 3).
- **R62-3 (live lane list in both To menus):** Closed across inline, floating and row-opened paths, including empty answers and off lanes, by P620.
- **R62-4 (failed tool chip):** Closed by P621; failed tool calls turn red (`is-failed`) in Claude, Codex, OpenCode and AGY logs. Completed succeeding calls still glow active until the next block (Finding 7).
- **R62-5 (band title and click target):** Closed by P620 for Main, subs, Team, Agents-opened lanes and To-opened lanes.
- **R62-6 (chat dots and white sender names):** Closed for roster lanes, off-roster lanes, orchestrators and lane sender text across P620, P623 and P624; spawned subagents and multi-block agent messages remain open (Findings 4 and 5).
- **R62-7 (repeat band click focuses floating chat):** Closed by P620 for band clicks and `/` in both layouts; reopening floating chat via the header Orchestrator button on a To lane still misses focus (Finding 6).
- **R62-8 (run dates across midnight):** Closed for `RunChip` options only (P621); `FamilyTree` hover cards and `LaneConversation`'s status line and active-run hint still stay stale (Findings 1 and 2).
- **R62-9 (heading suppresses changelog line):** Closed by P622.
- **R62-10 (duplicate changelog line already on main):** Closed by P622.
- **R62-11 (inline Jump to newest gutter):** Gutter alignment closed by P621 via `overflow-y: hidden; scrollbar-gutter: stable;`; focus outline clips vertically (Finding 8).

## Merge grades

| Brief | Merge | Grade | Reason |
| --- | --- | --- | --- |
| P620 | `136ccebe` | B+ | Closes R62-1, R62-3, R62-5 and R62-7 in both layouts. `:first-of-type` affects later agent markdown blocks, and reopening floating chat from the Orchestrator button on a To lane misses focus. (Its `chatAgentColors` filter broke hierarchy lane dots, fixed by P623 and P624.) |
| P621 | `88f2f5d5` | C+ | Closes failed-tool styling (R62-4) and the inline Jump gutter (R62-11). Leaves `FamilyTree` hover cards and `LaneConversation`'s status line stale across midnight, misses fast-finishing lane starts, keeps completed tools yellow while live, and clips the Jump focus ring. |
| P622 | `1565c38d` | A | Closes R62-9 and R62-10 cleanly with real Git tests. Only Unreleased bullets match brief IDs, exact Unreleased bullets are never duplicated, and older release sections are ignored. |
| P623 | `4d6720dc` | B | Restores room colours for hierarchy lanes by colouring the whole roster. Removing the child check altogether breaks spawned subagents (`depth > 0`), which should inherit their parent's colour. |
| P624 | `4528b507` | A | Cleanly falls back to a stable `AGENT_COLORS` hash for off-roster lanes while preserving roster colours and yellow for the orchestrator and subs. |

Fix the two midnight refresh gaps and the fast-finishing lane start first (Findings 1, 2 and 3). All six functional findings were verified with focused test DOM probes and existing test files (`tests/hud-orchestrator-focus.test.js`, `tests/orchestrator-chat.test.js`, `tests/conversation.test.js`, `tests/lane-conversation-order.test.jsx`, `tests/merge-lane.test.js`, `tests/agent-colors.test.js`, 177 tests passing). Visual checks in a real browser (Findings 5 and 8, and overall gutter alignment) remain with the orchestrator.
