# Review 49: P483 to P492

Range `7d9d9ac3..a87833b5`, read by Claude (Sonnet 5.5) in the P493 lane. Read-only: nothing was run, no test was executed, and the diff was read in full for `server/reviews.js`, `server/harness-probe.js`, `server/harness-settings.js`, the worktree copy code in `scripts/run-lane.mjs`, the cache and repeated-failure code, the task state code and the Plan handoff. The rest was sampled.

Rewind check first: no path was found that drops a commit the run did not record, except R49-2. The recovery ref is written before the reset, and a failed ref write stops the reset. The writer check has a gap, R49-1.

## Findings

### R49-1 (medium) Rewind does not hold the lane while it resets
`server/reviews.js:1068-1075`. `rewindState` reads the lane lock once, then `update-ref` and `reset --keep` run later. `beginRepoWrite(resolvedRoot)` only stops other reviews routes. `run-lane` does not take it. A run that starts in that window, or a harness the owner started by hand in the worktree, is reset under its feet.
See it: start a rewind confirm, start `run-lane` on the lane between the check and the reset. The lane is reset while its run has begun.
Fix: take the lane lock (`takeLaneLock`) around the check and the reset, and release it in `finally`.

### R49-2 (medium) "Commits the run made" is the whole branch ahead of main
`scripts/run-lane.mjs:2434` records `refs/heads/main..HEAD` as `commits`, and `server/reviews.js:1048` accepts a range if every commit is in that list. A commit the owner or another agent added while the run was going is in the list, so rewind drops it. The refusal text promises more than the check proves.
See it: commit by hand in the lane worktree during a run, let the run end, rewind. Both commits go (kept at the recovery ref only).
Fix: record `checkpoint.head..HEAD` for lane runs, as project runs already do at line 2430, and compare against that.

### R49-3 (medium) Worktree copies ignore the file in the main checkout too
`scripts/run-lane.mjs:686-691` appends to `<common-dir>/info/exclude`, which every worktree and the main checkout share. Copying `.env` for one lane makes `/.env` ignored in the main checkout for good, and it is appended again for each new lane (no duplicate check). The exclude line is also written before `copyFileSync`, so a failed copy still leaves it.
See it: list `.env` in worktree copies, start a queue run on a new lane, run `git check-ignore .env` in the main checkout.
Fix: skip the append when the pattern is already present, write it after the copy succeeds, and say in the setting's text that the ignore is shared. Or use the worktree's own `info/exclude` under `<git-dir>` (`rev-parse --git-path info/exclude`).

### R49-4 (medium) Codex cache share is understated
`src/harnesses/codex.js:91` sets `inputTokens` to `input_tokens + cached_input_tokens`. Codex reports `input_tokens` as the total, with the cached part inside it. The share `cacheRead / cacheInput` in `src/ui/panels/MetersPanel.jsx:49-51` uses that sum. With the test's 1500 and 500 (`tests/cache-usage.test.js:76`) it shows 25 percent, and the real share is 33 percent. The cost board input count is also high by the cached amount.
Fix: for Codex use `input_tokens` as the input and `cached_input_tokens` as the read. Fix the test that pins 2000.

### R49-5 (medium) Direct API probe sends an empty model
`server/harness-probe.js:75` passes `model: ''`. `src/harnesses/machineroom.js:103` turns that into `--model ''`. A configured Direct API lane will most likely report `failed` for a working setup, a false negative on the Test connection button. No test covers `machineroom`.
Fix: take the model from the first enabled lane of that harness (or the endpoint's first model), and answer `unknown` with a plain line when none is set. Add a test.

### R49-6 (low) OpenCode probe skips Plan and sends no title
`server/harness-probe.js:75` passes `mode: 'plan'`, but `src/harnesses/opencode.js:112-116` ignores `mode`; Plan comes from the lane's `OPENCODE_CONFIG`, which the probe does not pass. It runs with `--auto` and `--title undefined`. It runs in an empty temp folder, so the harm is small, but "probe runs in Plan" is not true for OpenCode.
Fix: pass a `title` and the Plan config, or document that OpenCode is probed with `--auto` in an empty folder.

### R49-7 (medium) Live touched list says empty when it does not know
`server/runs.js:940-956` builds `touched` from `summary.written`. The parser is built with `files: []`, so shell writes (`sed -i`, a formatter, a redirect) are not in it. A lane that edits by shell reports `touched: []`, and `src/ui/panels/runs.js` keeps `[]` as known. The overlap card then shows nothing for that lane. Only null means unknown.
Fix: return null when the log shows shell calls that the parser could not place, or add a flag `partial: true` and show "may also be editing by shell".

### R49-8 (low) Review scope can read the lane's own brief file
`server/reviews.js:778-786` falls back to `worktree/docs/agents/TASKS.md`. A lane can edit its own brief to name the files it changed, and `outsideBrief` then reads empty. Only the fallback is exposed, and `lanesDir` wins when it exists.
Fix: read the brief from the base ref (`git show main:docs/agents/TASKS.md`), not the worktree.

### R49-9 (low) Port offset can collide or shift
`scripts/run-lane.mjs:2215` uses the lane's index in `lanes` times 10. A lane not in `lanes` gets 0, the same as the first lane. Adding or removing a lane shifts the ports of the others. Two runs can ask for one port.
Fix: hash the lane key to a stable slot, or reject an unknown lane.

### R49-10 (low) Rewind answers 500 after it has reset
`server/reviews.js:1074-1085`. If `deliver` or `notify` throws after `reset --keep`, the catch answers "The rewind failed." while the lane is already rewound. The recovery ref name `recoveryRefFor` (line 1017) also maps `a/b` and `a-b` to one name, and `update-ref` overwrites without an old-value check.
Fix: wrap the notify in its own try, and pass the old value (zeros) to `update-ref` so an existing ref is never replaced.

## Checked and fine
- Rewind: needs `confirmed` and the head the owner read, an Origin header, no active lock holder, a clean worktree, the same branch, a clean start (`dirty === false`), an ancestor start, and every commit recorded. The reset is `--keep`, never `--hard`. The recovery ref is written first.
- Plan handoff: "Edit from this plan" only opens a card. The run starts on the owner's click, with an editable draft (`LaneConversation.jsx:457-470`).
- Probe: needs the owner's page origin and `confirmed`, runs in a fresh temp folder, has a 60 second limit with `killTree`, one run per harness, and removes the folder in `finally`. Output is masked.
- `windowsHide`: the AST test `tests/windows-hide.test.js` walks the code; my text scan found no spawn without it except `pack-check.mjs` and `scale-live.mjs` (checked, both set it in their options) and `screenshots.mjs:261` (set further down its options, not read to the end). The test helper never overrides an explicit option.
- Worktree copies: absolute, `..` and `.git` paths are refused, links are resolved and must stay inside the project and the worktree, and an existing file is never overwritten (`COPYFILE_EXCL`). Only listed files are copied.
- Cache: unknown stays null, 0 is kept, and the share counts only runs that reported both numbers.
- Repeated failure: needs five in a row of the same key, a success or an unkeyed call resets it, and the record holds only the tool name and count.
- Task state: masked, bounded to 20 rows, labelled as from the room, and `readTaskStateBlock` gives up after 5 seconds, so a slow read cannot block a compaction.

## Not verified
No test or build was run. The `screenshots.mjs` spawn options and the docs sentences in `LIVE.md` and `ROOM.md` were not compared with the code.
