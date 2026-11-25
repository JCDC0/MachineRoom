# Review 76 of `c9771c4c..41f12f10`

This range fixes the tunnel, changes forced idle and lane replies, adds folder waves and reads Antigravity and Hermes sessions. Lines refer to `41f12f10`.

## Findings

1. **High, a user can meet it. Native replies can be lost or delayed.** `scripts/mr-agent.mjs:1485,1603,1693`. During a final 800 ms model call, the bridge accepts a message and the lane exits before its first poll. A held reply also skips the next inbox read, delaying messages sent during tools by another model call. Merge held and fresh replies by ID at step boundaries and before exit. The owner, orchestrator and other lanes share this path.

2. **Medium, a user can meet it. Ordinary Send ignores Settings.** `src/ui/LaneConversation.jsx:588,890,911`, `server/orchestrators.js:957`. With Interrupt selected, Send stamps `false`. Orchestrator and lane senders use the saved setting. Omit the field for ordinary Send and keep the explicit menu override.

3. **Medium, a user can meet it. A restarted CLI lane gets a reply twice.** `server/orchestrators.js:978,1009`, `server/runs.js:1532,2008,2049`, `scripts/run-lane.mjs:2297`. The restart embeds the reply in its prompt and keeps it in the inbox. When the lane checks GET as its brief says, it reads it again. Filter prompt-delivered entries from GET and retain their status.

4. **Medium, a user can meet it. Forced idle leaves lens controls in the Tab order.** `src/styles.css:11163`, `src/Stage.jsx:1643`, `src/engine/agents.js:885`. With a failure showing, enter Idle, then Tab to Clear and press Enter. It clears the tray. A console address can also launch a tab. Make the lens inert. R75-1 and R75-3 close in code. Test the actual Stage keys, resize and drop paths beyond the snapshot tests (`tests/stage-snapshot.test.js:51,72`).

5. **Medium, edge case only. A brief touch can expire before the wave arrives.** `src/engine/cards.js:35,1203,1395,1471`. With contents off, a completed read eight row-bearing ancestors deep waits about 1.4 s at small frame steps. The 1.1 s hold expires while the target is shut. Start the hold when its gate releases. The one-frame room tests force reduced motion and pass with the wave undone (`tests/e2e-room.test.js:222,1408`).

6. **High, a user can meet it. Lane runs can appear in both feeds.** `scripts/run-lane.mjs:2297,2314`, `src/harnesses/agy.js:75`, `src/harnesses/hermes.js:18`. Run either harness as a lane in the watched project. Neither uses the generated sidecar UUID, so the app's actual session ID can pass the skip filter. Save the actual ID. Skip tests supply matching IDs by hand (`tests/agy-sessions.test.js:491`, `tests/hermes-sessions.test.js:189`).

7. **Medium, a user can meet it. One read can assign Antigravity to the wrong room.** `server/agy-sessions.js:367,451`. Repo A's worker reads one reference in repo B. Both rooms show the whole tree under P726b's one-path rule. Prefer workspace evidence and keep ambiguous matches provisional. On restart, a working top whose only project evidence is in an idle worker's old transcript is missed (`243,689`). Check a bounded set of recent workers.

8. **High, a user can meet it. Antigravity workers finish early and nest flat.** `src/model/parsers/agy.js:109,150,177,206`. A worker completes a read and the top calls `read_board`. The parser ends the still-working child. A grandchild also spawns under the top. Use DB lifecycle events and the actual parent's key for outside spawns. `tests/agy-sessions.test.js:799` checks the wire link and passes with a flat room hierarchy.

9. **High, a user can meet it. Concurrent sessions share child keys.** `src/model/pipeline.js:143`, `src/model/parsers/agy.js:104`, `src/model/parsers/hermes.js:63,112`, `src/model/state.js:250,330`. Two runs of the same harness each spawn `<session>~1`. The second can animate the first child, and one run end can finish the other's descendants. Scope child IDs and cleanup to the run. Test two streams through pipeline and state.

10. **Medium, a user can meet it. Antigravity polls idle workers every second.** `server/agy-sessions.js:161,223,656,693`. A resumed top with 100 idle workers makes every transcript eligible for a stat each tick. Both readers also stat each lane sidecar. Gate inactive reads on change or spread checks over time. The 300-idle test has no open top (`tests/agy-sessions.test.js:270`).

11. **Medium, edge case only. Reader paths lack filesystem confinement.** `server/agy-sessions.js:207,393,594`, `server/hermes-sessions.js:121`. A malformed ID or a linked store entry can redirect an open outside the named app paths. Validate IDs as basenames and enforce containment through links and junctions. Both databases request read-only mode.

12. **High, a user can meet it. Hermes drops the first resumed turn.** `server/hermes-sessions.js:208,273,278,327`. Resume an old session and finish a tool before the first qualifying tick. Its current `max(id)` skips those new rows. Use a startup ID watermark. The test appends new work after registration (`tests/hermes-sessions.test.js:146`).

13. **High, a user can meet it. Hermes draws duplicate workers.** `src/model/parsers/hermes.js:59,109`, `server/hermes-sessions.js:364,391`. A `delegate_task` starts a placeholder, then the worker's call spawns another. Without an outstanding stored call, 30 s of quiet can also end a run while a child thinks. Spawn from child identity and include child lifecycle in timeout decisions.

14. **Medium, a user can meet it. The top seat can expire late or early.** `src/engine/agents.js:1813`, `src/model/state.js:210,252`, `src/live/livePlayer.js:124`. End the last worker. In a quiet room the seat stays past ten minutes. A new event after 7.5 s can prune the worker and return it early. Competing workers can tie because spawn leaves `startedAt` at zero. Use the live clock, retain delegation time and stamp spawns. The expiry test sets `latest` by hand (`tests/agents-lines.test.js:420`).

15. **Medium, a user can meet it. Choosing the main orchestrator cannot pin its seat.** `src/ui/FamilyTree.jsx:1423,2720`, `src/engine/agents.js:1503`. Choose a session, then choose Put at the top on the main orchestrator while outside workers are active. The room treats the saved choice as automatic and seats an outside session again. Store an explicit main choice separately from the automatic default.

## Grades

| Merge or hand change | Grade | Result |
| --- | --- | --- |
| P720 `ef35d2fd` | A- | The prior audit matches the fixes it prompted. |
| Stage `80bac196` | B | Narrow resize and bridge drop clear the lock. Mounted input coverage is incomplete. |
| P721 `09850614` | A | R75-4 and R75-6 close in code. The overlap regression now exercises the saved pointer. |
| P722 `3fc8ca05` | B- | Panels, scroll and main shortcuts are guarded. Lens keyboard controls escape. |
| P723 `4d9ab51d` | B | The normal wave works. A deep pulse can miss the target. |
| P724 `417788c8` | C | Send-time policy works in the inbox. Delivery gaps remain. |
| P726 `2877029a` | D+ | The reader emits calls. Identity and lifecycle fail in the room. |
| P726b `4b560dcd` | C | Child paths and running status help. Busy trees still fan out reads. |
| P728 `dd0af533` | C | Priority works in fixtures. Live expiry and ordering drift. |
| Parser wiring `541773ba` | B | The live row selects the parser and child-first steps keep root attribution. |
| P727 `de1643c2` | C- | Fresh sessions can show calls. Resume and delegation need fixes. |

P725 and the other planning commits have no runtime grade. A later Hermes commit, `bddab08d`, fixes Windows path handling for the platform override outside this review range.

Seven single-file suites passed, 226 tests total. An in-memory Node check reproduced the early AGY child end, Hermes duplicate spawn and frozen live seat clock. Browser checks belong to the orchestrator.
