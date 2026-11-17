# Review 54: P526 to P534

Reviewed `2cff726b..17f7b318`, including the merge changes. No code changed.

## R54-1: P2, a finished conversation can interrupt another run

File: `src/ui/LaneConversation.jsx:175`, with the send at line 408.
What goes wrong: any live run makes the historical conversation's composer send to the lane's current run. Its reply is then filed under the selected old run at line 414.
How to see it: select a finished run while a newer run of that lane is working. Send and interrupt remains available and sends only the lane key, without the selected start time.
Fix: require the selected run to be the live run before sending, and have the message route check that start time.

## R54-2: P2, Harness default loses Claude's reported window

File: `src/harnesses/claude.js:112`.
What goes wrong: the report is indexed only by the saved model string. An empty Harness default choice or an alias cannot match the actual model key, so the window stays unknown and percent autocompact waits despite a reported window.
How to see it: pass a result with `modelUsage['claude-sonnet-5-5'].contextWindow = 1000000` and an empty model. The helper returns null.
Fix: match the resolved model reported by the harness, and accept a single unambiguous modelUsage entry when the saved model is empty or an alias.

## R54-3: P2, live context is discarded for room-started runs

File: `src/ui/laneConversation.js:35`.
What goes wrong: runs.running is added before liveRuns. When both contain the same running start time, the later live fields are ignored. The server snapshot has no context fields, so the new lane status line never shows its token count.
How to see it: call runOptions with one runs.running entry and a liveRuns entry for the same lane and start, carrying contextTokens and contextWindow. Neither field survives.
Fix: merge the live context fields into the existing running option instead of returning unchanged.

## R54-4: P2, a partial detail blocks context discovery

File: `server/endpoints.js:400`.
What goes wrong: any matching detail counts as complete, including contextLength null or zero. A saved price or name without a window prevents the background fetch forever, even after the provider adds its window.
How to see it: save a model detail with contextLength null, then call refreshMissing with a stub provider that now returns 163840. No fetch occurs.
Fix: treat the detail as complete only when it has a valid positive window, and apply a cooldown when the provider cannot supply one.

## R54-5: P2, an omitted model is fetched on every turn

File: `server/endpoints.js:408`.
What goes wrong: a successful models response counts as a successful refresh even when it omits the selected model. Nothing is saved for that model and no cooldown is set. startTurnNow calls this path again on each turn.
How to see it: save selected in the endpoint's model list, return only other from the provider, and await refreshMissing twice. Two network calls occur immediately.
Fix: put a missing selected model on the same bounded retry delay as a failed fetch.

## R54-6: P2, live Claude context becomes the whole run's usage

File: `server/lanes-source.js:714`.
What goes wrong: contextTokensFromLog is called on one line at a time. The result line's cumulative usage replaces the latest assistant's current context, defeating the helper's normal preference for assistant usage and inflating the displayed percent.
How to see it: feed an assistant using 67491 tokens and then a result totaling 725456. The live loop keeps 725456; the same helper over both lines correctly returns 67491.
Fix: keep the helper's assistant-first precedence as streaming state, with result usage only as a fallback.

## R54-7: P3, fallback names do not prove lane ownership

File: `server/runs.js:189`, with candidate acceptance at line 198.
What goes wrong: joining the lane and brief IDs with hyphens is ambiguous. Folder containment cannot distinguish another lane's log with the same stem.
How to see it: a log for lane test-P1 and brief P2 named test-P1-P2-20261117-100000.log is also returned for a missing-log record of lane test with briefs P1 and P2 at that time.
Fix: verify the recovered candidate against saved lane and start metadata, and refuse recovery when ownership cannot be established.

Saved endpoint model IDs and older details survive background refresh. Context frames emit only the liveRuns notice and do not enter stream history. Both lanes files omit the fixed orchestrator window. Context ring counts use formatCount. agentTasks keeps its lookup order. Reader angles avoid lane rays. MachineRoom conversations use the Claude reader. The footer has named buttons, scrolling and a measured height cap; its real window layout still needs the orchestrator's eye check.

Checked and fine
