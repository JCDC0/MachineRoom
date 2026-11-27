# Review 77 of `ba016db9..cba0af8c`

Lines refer to `cba0af8c`.

## Findings

1. **High, a user can meet it. Main can vanish with saved chat.** `server/index.js:1911-1921`, `server/active-lanes.js:125-131`. Pin an outside session and reload with saved main chat. The bridge drops idle Main before the engine can use `mainHasConversation`. It also drops Main again after its turn. Keep visibility in the engine.

2. **High, a user can meet it. Discovery can lose a run start.** `server/index.js:1755-1759`, `src/Stage.jsx:1089-1098,1282-1286`, `src/model/pipeline.js:80-98,202-208`. Start an unconfigured lane with the room open. Its frames beat the roster fetch. The pipeline drops them and marks their IDs seen, losing the start and possibly the whole run. Send the descriptor with the frames or buffer them.

3. **High, a user can meet it. An unrelated run can inherit a shell starter.** `server/agy-sessions.js:520-523`, `server/hermes-sessions.js:365-368`, `server/index.js:742-757`, `server/lanes-source.js:546-550`. A shell tries a bad brief or starts Codex for another project. A manual Codex run here within 60 seconds takes its entry. Explicit starters also leave stale entries. Match by launch ID and project.

4. **Medium, a user can meet it. A genuine Antigravity start can be missed.** `server/agy-sessions.js:478-502,520-523`, `server/lanes-source.js:546-550`. A new session launches before two project path calls. The reader holds the command until it qualifies, past the one chance to match. Reconcile late verified commands by run ID.

5. **Medium, edge case only. Old logs can consume current shell entries.** `server/lanes-source.js:533-550,675-700,973-979`. Restart with an ended lane's log under a minute old and its lock gone. It starts at poll time and can take a current shell match before the record closes it. Check records first and use recorded start and end times.

6. **Medium, a user can meet it. The family tree can credit the wrong conversation.** `server/family.js:435-459`, `src/model/laneStarter.js:20-25`. Pin Hermes and explicitly start a lane with a Hermes conversation from elsewhere. The tree accepts it by harness while the room can reject it by ID. Share an exact project-session match.

7. **Medium, a user can meet it. A finished lane holds the top past ten minutes.** `src/engine/agents.js:1590-1593,1917-1921`. Finish an Antigravity-started lane, then use Hermes and leave the room quiet. The old starter can still beat Hermes after ten minutes. Use the live clock in both seat rules.

8. **Medium, a user can meet it. A pin can drop on a failed refresh.** `src/Stage.jsx:940-975`, `tests/stage-family-top.test.js:7-9`. Pin Main while an outside session works. One failed family refresh drops the pin. Keep the last answer on errors. The helper test passes if Stage drops the options at the room call. Mount Stage in the test.

9. **Medium, edge case only. The last native step can accept a reply it cannot answer.** `scripts/mr-agent.mjs:1598,1705-1713,1765`. Send during the last allowed call. The final read gets the reply and the loop exits. Carry it into the next run or report it pending. The test allows the extra step.

10. **Medium, a user can meet it. Hermes can swap workers.** `src/model/parsers/hermes.js:60-72,122-140`. Start two delegates. If worker two emits first, it takes worker one's slot and end. Join on actual delegation and child IDs. The single-worker test misses this.

11. **Medium, edge case only. A resumed Antigravity child loses its second end.** `server/agy-sessions.js:265-268,595-617`, `src/model/parsers/agy.js:115-118`. A child goes idle and resumes within the same top run. Its next tool reopens it in state, but the parser ignores its second idle. Reopen the parser lifecycle on resumed work.

12. **Medium, a user can meet it. Reset can leave audible effects.** `src/engine/room.js:557-576,817-826,1353-1356`, `src/ui/sound.js:817-839`. Seek during a folder sweep and it keeps playing. Seeking into a paused thinking interval can restart the whir. Cancel room one-shots and gate reset and pause. Gate live message beeps in hidden tabs too (`src/Stage.jsx:612-614`).

13. **Medium, a user can meet it. Moving cards leave labels and star waypoints behind.** `src/engine/room.js:881-895,1060-1076`, `src/engine/stars.js:272-286`, `src/engine/labels.js:47-72`. The label rises at the old position while its card orbits. A flight through a moving ancestor updates only its destination. Resolve current anchors during both effects.

14. **Medium, a user can meet it. Cards overlap at spacing 600.** `src/engine/ring.js:154-175,225-244`, `tests/ring.test.js:257-274`. With eight siblings at 20 rows, two 446 by 907 cards overlap during orbit. The test uses six rows. The first overflow card and the first top card's only child also share a base spot. Reserve overflow slots and budget for tall cards and drift.

15. **Medium, a user can meet it. A quick write can miss its creation trace.** `src/engine/room.js:1006-1011,1169-1175`, `src/engine/cards.js:1242-1254`. A star can beat a deep folder wave and find its new row closed. A run end before arrival also drops the trace. Keep successful creations until their rows are ready. Normal replay draws traces via `src/model/player.js:22-29`. Gate replay effects by mode.

16. **Low, a user can meet it. Titles can drop the lane number or show a stale model.** `src/engine/agents.js:492-507,1692-1696`. Name `codex2` Neon 7 and lane 2 is omitted. A configured Claude model masks its transcript model. Compare the lane suffix, prefer the reported model and refresh titles with the roster.

17. **Low, edge case only. A terminal MCP failure shape can leave a call open.** `src/model/parsers/codex.js:92-110,131-135`. A synthetic `item.failed` leaves the call open and flush reports success. A start/end pair without an ID gets two keys. Handle supported terminal events and use the run outcome at flush.

18. **Medium, a user can meet it. A seek can leave a new folder hidden.** `src/engine/room.js:557-576`, `src/engine/cards.js:1020-1048,1362-1366`. Seek past a folder's creation while its star is still inbound. Reset drops the star and clears the hold, but reuses the card at zero opacity with no fade. Reveal existing held cards before clearing them.

## Grades

| Merge | Grade | Result |
| --- | --- | --- |
| P730 `0b83e0f1` | A- | Provider, cache and pin. |
| P731 `031e6742` | A- | Per-key orbit and loop. |
| P732 `813516e3` | B | Resume watermark, bounded lookback and path checks. |
| P733 `d687d9da` | B+ | Plain Send, prompted replies and real IDs. See 9. |
| P738 `d0239b25` | C | Project and reserved keys are checked. See 2 and 5. |
| P737 `6b0343f9` | A- | Rest pose and reduced motion. |
| P739 `356bb4da` | B | Reader registry and explicit starters. See 6. |
| P739b `88014073` | D+ | False and missed matches. See 3 and 4. |
| P734 `bc5d2c2c` | C+ | Run-scoped child keys work. See 10 and 11. |
| P740 `78b10709` | C | Pin saves and clears. See 1, 7 and 8. |
| P741 `f8562511` | B- | Spatial bus and watchdog work in tests. See 12. |
| P735 `cc10a98e` | A- | The deep wave test exercises the hold. |
| P742 `ff3511b8` | B- | Settings and swept bounds. See 13. |
| P746a `0e212292` | B | Standard completion works. See 17. |
| P745 `f25f907f` | C+ | See 15 and 18. |
| P744 `e031c950` | C | Range and save path work. See 14. |

Hand changes graded A- for inert lens and beat axes, B+ for inbox, A for test speedup, B for sound tuning, A for the Sol list and B- for labels. Stage passes pin, sound and spacing. Small ring restored. P740 supersedes P736. `d92b655e` sets a default-card floor, below the brief's maximum. Later sound tuning replaces P741's rising melody and square waves.

Thirteen focused Vitest commands passed, 212 tests passed and 156 were filtered out. Node probes reproduced findings 2, 10, 14 and 17. Audio clipping, live CLI failure shapes and visual checks remain unverified.
