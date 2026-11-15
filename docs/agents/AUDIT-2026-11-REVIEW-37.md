# Review 37: Harness settings and models

Reviewed on 2026-11-15. Range: `e9684294..952bb954` (HEAD).
This batch adds saved harness programs, readiness checks and settings. It also changes model defaults, model labels and agent forms.
Assumed use: one owner, one local bridge and several lanes on the same computer.
Seven findings: one P1, five P2 and one P3. Fix R37-1 before a push.

## R37-1 P1: Version output reaches the page and doctor without masking

File: `server/harness-settings.js:101`; output: `server/doctor.js:233`, `src/ui/HarnessesSettings.jsx:245`.
Only the program path is masked. The first stdout line becomes `version` unchanged, then appears in Settings and the doctor's terminal output. A wrapper that prints a home path or credential on that line exposes it.
See it: save a test program whose version command prints `homedir()` at run time. The returned version contains the full home path. An inline probe confirmed this without printing that path to the review log.
Fix: mask keys and profile paths in version output before cutting it to 80 characters, and use that cleaned value for both outputs.

## R37-2 P2: Chat ignores the program saved in Harnesses settings

File: `server/orchestrator.js:964`; sub setup: `server/orchestrators.js:369`.
Readiness and harness changes accept the saved program, but `binFor` reads only the explicit bin, lane bins and the bare harness name. Subs also receive a default bin that bypasses the saved setting. Chat can run another installation, or fail when only the saved program exists.
See it: save a working Claude program with no Claude lane. Start chat with an injected spawn recorder. The recorder receives `claude`, not the saved file. An inline probe confirmed this.
Fix: apply the saved program when resolving a default chat bin, for both the main orchestrator and subs, while keeping a lane's explicit custom bin.

## R37-3 P2: A ready harness installed only through Settings disappears from sub choices

File: `server/orchestrators.js:178`; caller: `server/orchestrators.js:502`.
The orchestrator harness list calls availability without the runs folder. It cannot see saved programs. The UI uses that list to limit sub and team choices, so a harness can say Ready in Settings and still be missing there.
See it: save a valid Claude program, provide no Claude lane and use an empty PATH. Availability with the runs folder is true, but `availableHarnesses` omits Claude. An inline probe confirmed both answers.
Fix: pass the runs folder through the orchestrator list's availability checks.

## R37-4 P2: Changing harness settings leaves the ready-only forms stale

File: `server/agents-config.js:594`; consumers: `src/ui/FamilyTree.jsx:663`, `src/ui/FamilyTree.jsx:685`.
Settings writes and rechecks send no notice. The family view reads harness rows at mount, and its refresh does not read them again. An enabled or newly ready harness stays hidden; a disabled harness stays offered until the page reloads. The mock emits notices that the real route omits.
See it: load Agents, turn a harness off in Settings, then reopen Add agent without reloading. Its pill still uses the old enabled value. Re-enable an initially off harness to see the reverse failure.
Fix: send a notice after a successful settings write or check, and have the family and team views reload harness rows on that notice.

## R37-5 P2: Saving only a sub's effort does not change its live effort

File: `server/orchestrators.js:380`; update path: `server/orchestrators.js:483`.
The saved ladder now carries effort, but `sameConfig` omits it. An effort-only save keeps the old instance, and the unchanged-instance path updates only siblings. The save succeeds while later turns keep the old effort.
See it: create a Codex sub at high, then save the same ladder with low. The ladder returns low and the live sub still answers high. An inline probe confirmed this. `tests/sub-effort.test.js:83` checks creation only and misses the update case.
Fix: apply a changed ladder effort to the idle sub through its effort setter and keep its saved state in sync. Refuse the change while it is working.

## R37-6 P2: Failover bypasses the off-harness launch check

File: `scripts/run-lane.mjs:1548`; bypass: `scripts/run-lane.mjs:1722`, `scripts/run-lane.mjs:1763`.
The new off check runs only when selecting the primary lane in `main`. Failover selects another lane and calls `startLane` directly, which does not check off. A backup on an off harness can start even though selecting that same lane directly is refused.
See it: turn Claude off, use an OpenCode primary with a Claude backup, and make the primary hit a quota error. The backup path takes its lock and starts Claude without revisiting the check. This was traced in code; no real failover was launched.
Fix: check the backup's harness before taking its lock or changing branches, and enforce the same rule at the shared launch entry.

## R37-7 P3: The Program field cannot save its own masked initial value

File: `src/ui/harnessesSettings.js:77`; refusal: `server/harness-settings.js:50`.
The form copies the masked display path into its editable draft. A normal path under the home folder becomes `%USERPROFILE%` on Windows or `~` elsewhere. Save sends that text back, but the server accepts only absolute file paths.
See it: load a program installed under the home folder and press Save without editing the field. The server refuses its own displayed value. An inline probe confirmed the masked draft is rejected.
Fix: leave the replacement draft empty and show the masked current path separately. Enable Save only after the owner enters a replacement.

## Verification and limits

- Only this report was added. No source, test, fixture or changelog changed. Test definitions before and after are unchanged: zero added or removed. No separate before/after full-suite count was measured.
- The first `npx vitest run` attempt was blocked by PowerShell's unsigned-script policy before any test ran.
- `node ../../node_modules/vitest/vitest.mjs run tests/harness-models-program.test.js tests/run-lane-saved-program.test.js tests/harnesses-settings.test.js tests/ready-harnesses.test.js tests/model-defaults.test.js tests/model-names.test.js tests/model-picker.test.js tests/family-friendly.test.js tests/chat-friendly.test.js tests/settings-friendly.test.js tests/sub-effort.test.js`: PASS, 75 tests in 11 files.
- `node ../../node_modules/vitest/vitest.mjs run tests/harness-settings.test.js -t 'checks versions|refuses failed|saves valid|Direct API|ten minutes|two writes'`: PASS, 7 tests; 1 home-folder test excluded to avoid writing outside the allowed roots.
- `npm.cmd run build`: PASS, with the existing large-chunk warning.
- Inline `node --input-type=module` assertions confirmed R37-1, R37-2, R37-3, R37-5 and R37-7. Temporary probe folders were removed and their child processes exited.
- An initial descendant-timeout assertion failed because the command finished normally. A follow-up completed in 73 ms. No hang finding is claimed.
- No full test suite, real owner CLI run, live browser or visual check. The orchestrator must check the screen. No tests were changed or removed.
- Instructions request a branch and commit, but also forbid git writes. The clean worktree started detached at `952bb954`; no branch or commit was made.
- Docs say existing lanes and subs keep working when a harness is off (`docs/agents/HARNESSES.md:45`). The primary CLI gate refuses even existing lanes, while failover does not. The off policy needs one consistent meaning.

## Checked and fine

- The new settings and check POST routes require Origin and `confirmed: true`. The bridge rejects an Origin outside its allowed list.
- Program saves reject unknown harnesses, relative paths, missing files and directories. Settings saves use a unique temporary file and clear readiness checks.
- Normal failed and slow version commands are reported as not ready. Version checks are shared in flight and reused for ten minutes; Check again clears them.
- Direct API readiness comes from a key or endpoint. Responses expose readiness and names rather than key values.
- Default lane launches use the saved program; explicit lane programs stay intact. Targeted launch tests passed.
- Fresh Claude chat omits an unchosen model flag. Alias expansion is tested separately from display naming, and friendly labels keep the provider-qualified option ids.
- Existing model choices are kept by the model-loading hook. The current unavailable harness stays in the orchestrator editor with a not-ready label.
- Tests cover ready-only initial choices, empty forms, readonly built-in lanes, saved-endpoint refresh, honest lane-load errors and chat recipient changes.

## Closed

All seven are fixed on main: P367 fixed R37-1 and R37-7, P368 fixed R37-2, R37-3 and R37-5, and P369 fixed R37-4 and R37-6 and wrote the one meaning of `off` into `HARNESSES.md`.
