# Docs audit 5

2026-11-18. P582. Read against `main` at `38706ccc`, version 0.1.401.

Scope: `ARCHITECTURE.md` and the seven files under `architecture/`, with most time on what merged on 2026-11-18: P556 to P577 and P579 to P580 (P566 lost runs, P562 and P580 the orphan sweep and `--stop`, P578 the sampler, P561 Claude resume, P574 native timeouts, P556, P570 and P577 Needs you and Tasks, P557, P563 and P565 Reviews, P559, P565 and P577 Settings, P567 the branch list, P568 and P576 hit areas). This is a source audit. No screen check was made. P581 (recordings folder) was a brief only at `main`, so it was not audited. Only this file changes.

Method as `AUDIT-2026-11-DOCS-4.md`. Most of the day's merges updated the docs with their code, so the findings are small.

## D5-1: The hit area list names seven controls and the code covers fourteen

- Doc: `docs/agents/architecture/ROOM.md:13`.
- Code: `src/styles.css:10805` to `src/styles.css:10830` (the shared 24 pixel `::after` rule), `src/styles.css:2682` (`.scrubber-tick::after`).
- The doc lists the failure tray Clear, the Reviews count, conversation menus, agent switches, family actions and lane selection boxes. P568 and P576 added the spend button in the transport, the sidebar Open folder button, the Repository tree and switch buttons, the autocompact unit, the model refresh button, the Waiting card close button and the scrubber ticks.
- Replacement: "Clear in the failure tray, the Reviews count, conversation menus, agent switches, family actions, lane selection boxes, the transport spend button, the sidebar Open folder, tree and switch buttons, the autocompact unit, the model refresh button, the Waiting close button and the scrubber ticks have at least 24 pixel hit areas."

## D5-2: The branch list limit is not documented

- Doc: `docs/agents/architecture/CODE.md:54` (the `RepositoryPanel.jsx` and `repository.js` entry) and `docs/agents/architecture/ROOM.md:42`, which say nothing about it.
- Code: `src/ui/repository.js:1`, `src/ui/repository.js` (`BRANCH_FOLD_LIMIT` 20, `visibleBranches`, `showAllBranchesLabel`), `src/ui/RepositoryPanel.jsx` (`showAll`).
- With no filter text the Repository list shows the first 20 branches, plus the current branch when it is not among them, and a button `Show all N branches`. Typing in the filter shows every match up to `BRANCH_LIST_LIMIT` (200) and resets the fold.
- Replacement for CODE.md:54, after "the branch rows and their switch reasons": "the branch list, which shows 20 rows and the current branch until the owner presses `Show all N branches`, while a filter searches every row up to 200,".

## D5-3: A failed run reads `done` when its backup merely ran, and Plan mode is left out

- Doc: `docs/agents/architecture/LIVE.md:24`.
- Code: `server/lane-tasks.js` (`statusFor`), `src/briefs/attention.js:40` (`backupRanLater`) and `src/briefs/attention.js:79` (`succeededLater`).
- The doc says a failed or stopped run reads `blocked` unless a later run of the same work "or its failover backup, ended well". The code counts the backup as soon as a record from the backup lane names the failure in `failoverFrom`, or started later than the failure, whatever its outcome. A later success in Plan mode clears only a failed run that was also in Plan mode, which `LIVE.md:50` says for Needs you but this sentence does not. A run with `killed` set is always a failure here.
- Replacement: "a failed or stopped run reads `blocked` unless a later run of the same briefs or task ended well (a Plan mode success clears only a Plan mode failure), or its failover backup started, and then it reads `done`;".

## D5-4: The Claude resume paragraph in LIVE.md skips the brief check

- Doc: `docs/agents/architecture/LIVE.md:31`.
- Code: `scripts/run-lane.mjs:1555` (`claudeResumeId`), `scripts/run-lane.mjs:2231`, `scripts/run-lane.mjs:2305`. `COMMANDS.md:5` is right.
- LIVE.md says the runner resumes when the prior session file exists. The code also needs the saved `briefHash` in the metadata to match the hash of each brief's title and text (the task text for a project run), and a session ID in UUID form. P580 updated COMMANDS.md and left this paragraph.
- Replacement: "If the file exists and the saved brief hash matches the brief's title and text, the runner passes `--resume` with the same ID and saves `resumed: true` in the new metadata. ... If the session file is missing, the hash is missing or the brief text changed, the runner starts a new session with the full prompt."

## D5-5: The process tree code map lacks the sampler

- Doc: `docs/agents/architecture/CODE.md:105`.
- Code: `server/processTree.js:118` (`sampleProcesses`), `server/processTree.js:280` (`isCreatedAfterLock`), `server/processTree.js:209` (`descendantProcesses`).
- The entry names `killTree`, `processListCommand`, `parseProcessList`, `listProcesses` and `leftoverProcesses`. It leaves out the sampler P578 added. On Windows the sampler is one long lived PowerShell that answers one CIM query per tick, never two at once, and sends no command lines. Elsewhere it runs `ps` each tick. `MACHINEROOM_SAMPLE_MS` sets the tick.
- Replacement: add "`sampleProcesses` (the runner's periodic sample, one persistent PowerShell on Windows that answers one query at a time without command lines, and `ps` elsewhere), `descendantProcesses` and `isCreatedAfterLock`" to the entry.

## D5-6: The final sweep's skip of a reused process id is not documented

- Doc: `docs/agents/architecture/COMMANDS.md:23` (the `--stop` and sweep sentences) and `docs/agents/architecture/LIMITS.md:23`.
- Code: `scripts/run-lane.mjs:212` to `scripts/run-lane.mjs:233` (`stopLeftovers`).
- During the final sweep after a stop the runner reads a fresh process list and compares the creation time of each found process. A process that is gone is reported `had already ended`, one that cannot be checked counts as failed, and one whose creation time changed is skipped with `stale: PID was not this run`. This is the "never stops a process it did not start" rule of P580. The `.processes` file the runner keeps beside a lane lock, which holds the recorded pids and creation times, is named in no doc. A stop with no lock also keeps `recorded process data` instead of the lock when a process cannot be stopped.
- Replacement (add to LIMITS.md:23): "The final sweep reads a fresh process list and skips a process whose creation time no longer matches the one recorded, printing `stale: PID was not this run`. The recorded pids and creation times live in `<lane>.lock.processes` beside the lane lock."

## D5-7: The native agent timeout limit is missing from LIMITS.md

- Doc: `docs/agents/architecture/LIMITS.md:48`.
- Code: `scripts/mr-agent.mjs:37`, `scripts/mr-agent.mjs:1171`, `scripts/mr-agent.mjs:1195`.
- LIMITS.md says each request ends after 300 seconds and is retried up to 4 times. It does not say the whole post has a 15 minute limit across requests, body reads and retry delays, and it stops with `The API request failed: it reached its 15 minute limit.` `COMMANDS.md:26` has it.
- Replacement: add "A post also stops after 15 minutes in all, counting every attempt, body read and retry delay."

## D5-8: A Reviews lane count has a singular form

- Doc: `docs/agents/architecture/ROOM.md:17`.
- Code: `src/ui/panels/ReviewsPanel.jsx:718`.
- The doc says other lanes fold under `N lanes have nothing to review`. For one lane the button reads `1 lane has nothing to review` (P563). The doc is also silent that the button opens and closes the folded rows.
- Replacement: "Other lanes fold under a button that reads `N lanes have nothing to review`, or `1 lane has nothing to review`, and opens or closes those rows;".

## D5-9: The lane settings wait for their load

- Doc: `docs/agents/architecture/ROOM.md:65` (the Settings paragraph) and `docs/agents/architecture/CODE.md:56`.
- Code: `src/ui/HarnessesSettings.jsx:450` to `src/ui/HarnessesSettings.jsx:610` (`LaneSettingsFields`, `loaded`), `src/ui/Settings.jsx:160` to `src/ui/Settings.jsx:176`.
- ROOM.md says Lanes holds the four lane settings above the lane list. It does not say their Save buttons stay off, with `Loading the saved settings. Save is off until they load.`, until the saved settings arrive (P577). CODE.md:56 describes `HarnessesSettings.jsx` as the Harnesses section only, but the file also holds `LaneSettingsFields`, which the Lanes tab renders. Settings keeps every section mounted and hides the closed ones, so a draft survives a tab switch (P565).
- Replacement (ROOM.md:65, after "above the lane list"): "; their Save buttons stay off until the saved settings load, and every section stays mounted, so a typed draft survives a tab switch". Replacement (CODE.md:56): "... and `LaneSettingsFields`, the four lane settings the Lanes tab shows".

## D5-10: DOCUMENTS.md lacks 29 files

- Doc: `docs/agents/architecture/DOCUMENTS.md` (lines 28 to 144).
- Code: `docs/agents/`.
- These files exist and have no entry: `AUDIT-2026-11-DOCS-4.md`, `AUDIT-2026-11-REVIEW-38.md` to `AUDIT-2026-11-REVIEW-51.md`, `AUDIT-2026-11-REVIEW-53.md` to `AUDIT-2026-11-REVIEW-58.md` (including `-57B`), `AUDIT-2026-11-SWEEP-S1.md`, `-S2.md`, `-S3.md`, `AUDIT-2026-11-TESTS-3.md`, `AUDIT-2026-11-UI-3.md`, `PLAN-NEXT-ARGON.md` and `PLAN-NEXT-ARGON-2.md`. `AUDIT-2026-11-DOCS-5.md` is new with this file.
- Replacement: one line per file in the form of the existing ones, such as "`AUDIT-2026-11-REVIEW-58.md`: history. The P579 review of the runner batch, with seven findings fixed by P580." The owner or the orchestrator reads each file for its line.

## D5-11: The open work paragraph stops at review 36

- Doc: `docs/agents/ARCHITECTURE.md:102`.
- Code: `docs/agents/AUDIT-2026-11-REVIEW-37.md` to `AUDIT-2026-11-REVIEW-58.md`, `AUDIT-2026-11-DOCS-3.md`, `AUDIT-2026-11-DOCS-4.md`, `AUDIT-2026-11-TESTS-2.md`, `AUDIT-2026-11-TESTS-3.md`.
- The paragraph lists reviews 29 to 36, docs audit 2 and test audit 1, as closed. Nothing is false. It says nothing of reviews 37 to 58 or the later docs and test audits, so a reader takes it for the whole set.
- Replacement: end the list with "Later reviews, 37 to 58, and the later docs and test audits are listed in `architecture/DOCUMENTS.md`." This depends on D5-10.

## Checked and true

`ARCHITECTURE.md`: the version line (0.1.401 matches `package.json`); the `npm run` list against the `scripts` block of `package.json`; the data flow and the conventions; the commit prefix rule.

`architecture/COMMANDS.md`: the `--continue-from` paragraph (line 5: `--resume`, `resumed: true`, the interrupt sentence, queue resumes its interrupted task); the lost run paragraph (line 6: `stopReason: 'lost'`, no end time, the list `(lost)` mark, stats count it as killed, the sidecar fields, the detached brief branch rule), `scripts/run-lane.mjs:1488` to `scripts/run-lane.mjs:1581`; `--list` and `--stats` recover lost runs, and the notice `The recovered runs were not all saved.`; the sampler interval of 2 seconds and `MACHINEROOM_SAMPLE_MS` (250 to 60000, 0 off, other values keep the default); the `--stop` text including `--started-at`, `Matched no names.` and the 500 millisecond recheck; the native timeout paragraph (300 seconds, 4 retries, body reads, 15 minute post limit, 10000 to 1800000, a stop from the caller).

`architecture/LIVE.md`: line 11 and line 14 on lost runs and the run picker; line 24 on the `--lanes` source, the 30 record limit (`LANE_TASK_RECORDS`) and the 30 second close wait (`DEFAULT_CLOSE_TIMEOUT_MS`), except D5-3; line 50 on `attention` (newest per lane, owner stops, taken failovers, later success, Plan mode rule).

`architecture/LIMITS.md`: line 16 on `killTree`, the stale lock rule and the 30 second wait; line 23 on the Windows sampler query failure and the worktree name match; line 25 (the escape of a short child, P578) matches the sampler design; line 47 and 48 on the timeouts, except D5-7.

`architecture/ROOM.md`: Needs you (line 23: five rows, Open, Dismiss key and the limit of 50, the start failure and repeated failure sentences, newer briefs first); Reviews fold conditions (line 17: selected, confirm card, prepare in flight, notes, behind destination, shared banner block); Settings tabs (line 65: eleven tabs in the stated order, `machineroom.settingsTab`, Harnesses first, Lanes holds the four settings, Screen effects, arrow keys, Home and End) against `src/ui/Settings.jsx:24`.

`architecture/CODE.md`: every file added since 2026-11-18 began has a line (none were added or removed on that day); the `lane-tasks.js`, `LaneConversation.jsx`, `LanesSettings.jsx` and `harness-settings.js` lines.

`architecture/ACTIVITIES.md`: not touched by the day's merges and not re-read line by line.

## Not verified

- P581 (recordings folder) is a brief only at `main`. Check `COMMANDS.md:37`, `LIVE.md:39` and `CODE.md:24` when it merges.
- The six docs were read for the 2026-11-18 topics only. Older sentences were not re-checked, and no screen or test was run.
