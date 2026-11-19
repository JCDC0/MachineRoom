# Review 62

P619 reviewed eight merges at `f8854bba`, starting at `5c877d30^..HEAD`. The merges change the lower panels, lane starts, Claude log filtering, the AGY model list and the changelog step in the merge tool. The review assumes one owner using the room while lane runs and bridge notices arrive in the background.

## Findings

1. **High. Choosing a sub from a lane sends the next message to Main (P606).** `src/ui/Hud.jsx:745`, `src/ui/OrchestratorChat.jsx:108` and `src/ui/OrchestratorChat.jsx:814`.
   - Open an idle lane from Agents. Choose Frontend in its To menu. The Frontend tab opens, but the remounted composer resets To to Orchestrator. Submitting a message from the Frontend view sends it with no sub ID, so Main receives it.
   - Pass the chosen recipient into the chat when switching out of the lane. Check the outgoing ID after choosing a sub from a row-opened lane in both layouts. Reproduced in the wide HUD.

2. **Medium. A successful lane start leaves the old run selected (P606).** `src/ui/LaneConversation.jsx:334` and `src/ui/LaneConversation.jsx:494`.
   - Open an idle lane that finished a prior run and send a new task. When the bridge reports the new live run, the old transcript stays selected because it is still a valid option. The input vanishes and the view asks the owner to pick the live run to message it.
   - After an accepted start, select the new run when its ID is available. Keep any explicit run choice the owner made while the start was pending. Reproduced with a run notice after a successful send.

3. **Medium. To keeps offering a lane that was turned off (P606).** `src/ui/OrchestratorChat.jsx:248` and `src/ui/OrchestratorChat.jsx:343`.
   - Leave the inline Main chat open and turn Claude off in Agents. The bridge sends an `agents` notice, but Main's To list still offers Claude. The lane composer can then offer a start the bridge refuses. The HUD's row-opened composer reads the notice and updates its list.
   - Give both paths the same live lane list. Apply empty results too, and clear a To selection when the lane becomes unavailable. The stale option was reproduced in the test DOM. The refusal follows from `server/runs.js:961`.

4. **Medium. A failed tool can look like it is still working (P606).** `src/model/conversation.js:188` and `src/ui/LaneConversation.jsx:722`.
   - A live Claude run calls Bash, and the tool replies with `is_error: true`. Before the next agent message, the Bash chip is yellow. The transcript reader emits the start and discards the tool end, so the chip has no failure status and falls back to colouring the last call as active.
   - Match tool ends to starts by their parser IDs and pass the resulting state to the chip. Test with parsed log entries. Reproduced with a Claude tool result.

5. **Medium. The band names the old conversation when Team or a lane is open (P609).** `src/ui/Hud.jsx:266` and `src/ui/OrchestratorChat.jsx:1205`.
   - Select Frontend, then Team. The Team transcript opens and the band still says Frontend. Opening an Agents lane row also leaves the band on Frontend. Its accessible name then promises the Frontend chat while the click leads to the open panel.
   - Track the actual visible view in the HUD and derive the band text and click target from it. Include Team and the selected lane. Reproduced for both views.

6. **Low. A chat dot can show a different colour from the room (P609).** `src/ui/orchestratorChat.js:258`, `src/ui/LaneConversation.jsx:224` and `src/engine/sprites.js:18`.
   - In a room with Claude as the first code lane, its room colour is orange. The lane data from `/api/lanes` has no colour field and the chat fallback hashes the key to violet. The agent-event dot sits above the message at `src/ui/OrchestratorChat.jsx:1397`, and ordinary lane sender names still inherit 45% white at `src/styles.css:6151`.
   - Use the room's colour mapping for both chat views. Put the dot inline with the sender and set lane sender names to white. The colour mismatch was verified against the two implementations.

7. **Medium. A repeat band click fails to focus the floating chat (P610).** `src/ui/Hud.jsx:284` and `src/ui/OrchestratorChat.jsx:538`.
   - At 1200 pixels in Replay with the bridge connected, click the band to open the floating chat. Move focus back to the band and activate it again. The input stays unfocused because the open flag is already true and the focus effect runs only when the flag changes.
   - Pass the focus request through to the floating chat as well. Focus the visible composer after mount and on each new request. Reproduced in the test DOM. The first wide Live click passed its existing test.

8. **Low. Run dates can stay stale across local midnight (P612).** `src/ui/laneConversation.js:85`, `src/ui/LaneConversation.jsx:137` and `src/ui/FamilyTree.jsx:874`.
   - Leave a run that started at 23:55 on screen. At 00:01, opening the native Run picker still shows `23:55:00` until a render. A fresh hover on the Agents row can still show the old text after a render because the row caches a formatted date until the run data changes.
   - Refresh time labels when the local date changes or when a picker or hover card opens. Cache the raw timestamp in the row. The stale picker was reproduced with the local clock advanced past midnight.

9. **Medium. A heading can suppress the only changelog entry (P613).** `scripts/merge-lane.mjs:157` and `scripts/merge-lane.mjs:527`.
   - The lane adds `### Follow-ups to P619` under Unreleased with no bullet. Finish reads the ID inside that heading and skips the supplied `--line`. The merge commits with no entry for P619.
   - Require an actual changelog bullet when checking for the brief ID. Reproduced in a scratch Git merge.

10. **Medium. A line already on main can be duplicated (P613).** `scripts/merge-lane.mjs:523` and `scripts/merge-lane.mjs:531`.
    - Both main and the lane independently add the exact same Unreleased bullet. Git already keeps it once in the merge. The merged diff against HEAD has no added changelog line, so finish appends the identical `--line` a second time.
    - Before inserting, check for the exact bullet anywhere in the merged Unreleased section. Keep the brief-ID check on merged additions for entries with different wording. Reproduced in a scratch Git merge.

11. **Low. Jump to newest can sit past the message column (P618).** `src/styles.css:8375` and `src/styles.css:8393`.
    - Scroll up in an inline conversation long enough to show a classic vertical scrollbar. The scrollbar takes space from the log, but the sibling Jump to newest row retains the full width and the same 24px inset. The chip ends one scrollbar width to the right of the message column.
    - Give both elements the same usable width, including the gutter when one takes layout space. This follows from the CSS. Browser layout still needs a check by eye.

## Merge grades

| Brief | Merge | Grade | Reason |
| --- | --- | --- | --- |
| P606 | `b2f2c640` | C | The row composer can start a lane, but the sub handoff can misroute a message. The lane list, run selection and tool status can go stale. |
| P607 | `5c877d30` | A | The action slot stays reserved, the hover card closes and fresh focus reopens it. Row actions reveal themselves when focused. |
| P609 | `927e458f` | B- | The duplicate switch is gone. The band can name the wrong view and the dots can disagree with the room. |
| P610 | `d886adb7` | B+ | The Claude heartbeat is filtered and the normal inline click works. Repeat activation still misses the floating input. |
| P611 | `893a05e4` | A | All four model IDs resolve to their labels and use the matching Hydrogen tiers. The orchestrator entry is excluded from the static lane model list. |
| P612 | `589a3b3f` | B+ | The formatter uses the local date and time. Long-open panels can retain yesterday's label. |
| P613 | `bf663960` | C | The simple new-bullet case works. The merge can omit or duplicate an entry in the two tested cases. |
| P618 | `451f9620` | A- | One selected run time in history mode, a wider model line and a shared Jump chip. The chip's right edge can drift when a scrollbar takes space. |

Fix the recipient handoff and the two changelog cases first. The review used focused tests, test DOM probes and scratch Git repositories. Screen checks and live AGY model availability remain with the orchestrator.
