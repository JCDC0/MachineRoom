# Review 57: the Sonnet batch P556, P557, P559 and P563

Read `git diff 31766470..d095a693` (code, tests and docs, skipping TASKS.md, lanes.json and the audit files). Ran `tests/attention.test.js`, `tests/reviews-order.test.jsx`, `tests/settings-order.test.js` and `tests/panels-agent-form.test.js`: 24 passed. Grade: B. The Needs you logic and the Team answer are sound; the findings are a dismiss key that can hide a newer failure, a Reviews fold that can swallow a lane mid-action, and silent draft loss on a Settings tab switch.

## Findings

### R57-1 (medium): Dismiss with no start time hides every later failure of that lane
`src/ui/panels/DispatchPanel.jsx:198` and `:1092`. The dismissed key is `JSON.stringify([item.lane, item.startedAt])`. `attentionItems` passes `startedAt: record.startedAt ?? null`, so a record with no start time gives `["codex",null]`. Failure scenario: codex has a failed record with no `startedAt` and the owner clicks Dismiss. Every later failed record of codex that also lacks a start time matches the same key and stays hidden. Fix: key on lane, start time and text (or the run id), and do not store a key when `startedAt` is null.

### R57-2 (low): the dismissed list grows without a bound and never clears
`src/ui/panels/DispatchPanel.jsx:1092`. Each Dismiss appends to `machineroom.dismissedAttention` and nothing prunes it. It is read once into state, so a second open panel or tab does not see the new dismissals. Fix: keep only keys that are still in `runsState.attention`, or cap the list at 50.

### R57-3 (medium): a lane that is selected or mid-merge drops into the fold
`src/ui/panels/ReviewsPanel.jsx:663` and `:709`. `needsReview` is `error || ahead > 0 || dirty`. After a merge `ahead` becomes 0, so the lane leaves the visible list. Its open diff (`selectedLane`), its confirm card (`confirmTarget`), its prepare, refusal and outside-touch notes (`prepareSentByLane`, `refusedByLane`, `outsideByLane`) and its `behindDestination` Ask to prepare button all live in that row and vanish with it. Only the merge banner is rescued, and only while the fold is closed. Failure scenario: the owner merges a lane, `ahead` drops to 0, the confirm card and diff disappear and the prepare-sent note is lost. Fix: add `|| selectedLane === lane || confirmTarget?.lane === lane || prepareTarget?.lane === lane || review.behindDestination` to the needs-review test.

### R57-4 (low): a merge banner for a folded lane is shown with no lane name or row
`src/ui/panels/ReviewsPanel.jsx:697`. The banner reads `mergeSuccessByLane[lane].text` in a bare div above the list. If two lanes merged, two banners appear with no row to act on, and opening the fold shows the banner again inside the row. Fix: make sure `text` names the lane, or show the banners in one block.

### R57-5 (medium): a Settings draft is lost when its tab unmounts
`src/ui/Settings.jsx:164-173`, `src/ui/HarnessesSettings.jsx:447`. Each section is mounted only while its tab is open, so every unsaved field (`LaneSettingsFields` setup command and copies, program path drafts, Direct API and Keys forms) resets on a tab switch with no notice. A Record time draft is kept in Settings state, but the blur that commits it does not fire when the input unmounts, so the value is kept as text and never saved. Failure scenario: type a worktree command, click Keys to look something up, come back: the field is empty. Fix: keep the sections mounted and hide the inactive ones with `hidden`, or commit the record time in `openTab`.

### R57-6 (low): no test covers a tab switch, a dismiss or an open fold
`tests/settings-order.test.js`, `tests/attention.test.js`. No test switches tabs with a draft, clicks Dismiss, or checks that a selected lane stays visible after its `ahead` falls to 0, so R57-1, R57-3 and R57-5 would pass the suite. Fix: add one test for each.

### R57-7 (low): the unknown-work failure text hides the reason
`src/briefs/attention.js:65`. A start failure and a repeated-failure stop now both read `LANE failed on WORK`; the old `could not start` and `the same call failed five times` lines are gone, though `ROOM.md` still says the owner sees a repeated-failure case. Fix: keep a short reason suffix (` (could not start)` or ` (same call failed 5 times)`).

## Checked and sound

- A run with several briefs clears only when every brief succeeded later (`every`), a task run only on the same task text, and a hand run with neither never clears. A `-on-LANE` failover failure clears through `backupRanLater` or the brief match.
- Open sends `{ lane, startedAt }`; `Hud.jsx:325` accepts that shape and an empty start time becomes `''`.
- The Team answer adds only `harness` (a key string, with `parser` as fallback); no key, token or path.
- No key field is read or prefilled by the batch. The Direct API link sets the tab first, then scrolls in a second effect after the panel renders, so it never lands on a hidden tab.
- `ROOM.md` and `LIVE.md` match the code except the R57-7 wording.
