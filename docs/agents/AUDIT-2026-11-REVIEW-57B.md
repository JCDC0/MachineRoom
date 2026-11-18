# Review 57b

**Grade C.** P556, P557, P559 and P563 add failure actions, fold clean review rows, name harnesses in Team and split Settings into tabs. The basic paths work by inspection. A successful plan can hide unfinished work, Open can select the wrong run, and changing Settings tabs can lose owner input.

Reviewed `31766470..d095a693`. All line numbers refer to `d095a693`.

## Findings

### R57B-1. A read-only plan clears a failed edit

Medium. `src/briefs/attention.js:73` treats a matching later exit code of zero as a repair, even when the new run is read-only. `scripts/run-lane.mjs:2471` records the mode, and `src/harnesses/codex.js:111` makes Plan read-only.

An OpenCode edit for `Fix the parser` fails. The owner runs the same task in Codex Plan to find out what to do. Codex returns a plan and exits zero. Needs you drops the OpenCode failure before anyone fixes the parser. The success test at `tests/attention.test.js:274` omits mode.

Fix by allowing a Plan success to clear only a failed plan, and cover that distinction in the attention test.

### R57B-2. Open can show a different run

Medium. `src/ui/panels/DispatchPanel.jsx:1089` sends the right timestamp. `src/ui/Hud.jsx:1048` and `src/ui/Hud.jsx:1241` reuse the same conversation when one is open. `src/ui/LaneConversation.jsx:135` reads the timestamp only on mount. The fallback at line 255 can also replace a requested failure with a live run before history arrives.

Open a lane conversation, pick an older run, then click Open on that lane's current failure. The older run stays selected. From a closed conversation, click Open while a retry is live and history is loading. The live retry can take over the selection. Both contradict `docs/agents/architecture/ROOM.md:23`. The test at `tests/attention.test.js:405` still passes if the HUD ignores the event because it checks only the emitted payload.

Fix by applying each Open request to the selection and keeping its timestamp until the requested run has been resolved.

### R57B-3. Changing Settings tabs erases drafts and results

Medium. `src/ui/Settings.jsx:167` mounts the form only while its tab is active. The harness program draft and connection test result live inside that form at `src/ui/HarnessesSettings.jsx:38` and `src/ui/HarnessesSettings.jsx:45`. The endpoint and lane drafts have the same lifetime.

Type a new worktree setup command in Lanes, switch to Harnesses to check a runner, then return to Lanes. The command is gone. A confirmed connection test can also finish and use quota after the owner leaves Harnesses, with no result shown on return. Before the tabs, working in another section kept the first section mounted.

Fix by keeping drafts and in-flight results in Settings for the lifetime of the open panel.

### R57B-4. A slow lane settings read can erase a saved value

Medium. `src/ui/HarnessesSettings.jsx:449` starts with editable defaults on every Lanes visit. At line 527, one Save sends both the setup command and copy list. `server/harness-settings.js:85` accepts an empty list and replaces the saved list. The opening window existed before the split, and switching tabs now opens it again on each visit.

With a copy list already saved, open Lanes while the bridge read is slow. Enter a setup command and save before the list arrives. The blank list is sent and persisted, so subsequent worktrees stop receiving those files.

Fix by disabling lane settings writes until the initial read succeeds.

### R57B-5. The Direct API shortcut overrides the saved tab on reopen

Medium. `src/ui/Settings.jsx:53` keeps the last handled shortcut in a ref inside Settings. `src/ui/Hud.jsx:313` increments the request in the parent and retains it after Settings unmounts at lines 945 and 996. The next mount handles that old request again at `src/ui/Settings.jsx:76`.

Use the shortcut to open Direct API. Choose Sound, close Settings, then reopen it from the menu. Direct API takes over even though Sound is saved. The normal reopen test at `tests/settings-order.test.js:128` never issues a shortcut request.

Fix by consuming the Direct API request in the HUD once so later menu opens can restore the saved tab.

### R57B-6. A refresh can hide a review action and its result

Low. `src/ui/panels/ReviewsPanel.jsx:663` folds rows using Git state alone. A row becomes hidden at line 709 when it turns clean, even if it still owns an open confirmation or an error. The separate banner at line 697 handles successful merges only.

Open a merge confirmation and enter a message. Main merges that lane before the owner submits, and a run notice refreshes Reviews. The card and its draft disappear into the fold. If the owner's request is already in flight and gets a stale-base refusal, that refusal also sits inside the closed fold.

Fix by keeping a lane's row visible while its review action is open or has a result that needs the owner's attention.

### R57B-7. The runs docs promise more than the route returns

Low. `docs/agents/architecture/LIVE.md:48` describes the newest failure per lane and recovery on any lane. `src/briefs/attention.js:97` first selects the newest record per lane, regardless of outcome. `server/runs.js:2042` also applies `?lane=` before checking for recovery.

After Codex fails P1 and succeeds at unrelated P2, its P1 warning is gone. After AGY succeeds at P1 instead, the unfiltered response clears the Codex warning, while `?lane=codex` still reports it.

Fix by documenting that attention checks each lane's latest record and that the lane filter limits the records used to find recovery.

## Checked and sound

- Needs you excludes owner-stopped runs, keeps the existing failover rule, and recognizes a matching later successful edit on another lane. The runs route still masks run strings before returning them. The new buttons carry the lane and timestamp. Dismiss is scoped to that pair within the viewer and the test exercises a remount.
- The brief parser emits file order and the picker reverses entries within each owner group without changing ownership or mutating the parsed list. Done briefs stay out of the picker.
- Reviews keeps ahead, dirty and read-error rows visible on the normal path. Clean lanes can be expanded again for Diff and Rewind. The counts have separate singular and plural assertions, and a successful local merge keeps its banner after the row folds.
- The control endpoint carries the harness identifier, including the parser fallback, and Team looks up the registry label beside the model. The added identifier is a runner name. No new credential field is returned.
- Settings has eleven tabs, wraps arrow selection, restores a normal saved tab, and puts the four lane fields above the lane list. The extracted saves still use the confirmed bridge call. The music queue lives outside its Settings panel and keeps playing when that tab closes.

The findings are from static review. No tests, build or visual check ran. Fix the medium findings before shipping the batch.
