# Review 36: lane messages, modes and effort

Reviewed the merged delta from `bde6c710` to `87620eda`, plus the pending tips P341 `4d4245eb`, P342 `7240b79f`, P343 `b166fa8d` and P344 `457834bb`. File lines below refer to `87620eda` unless a pending tip is named. This assumes one local bridge with several lanes and orchestrators.

During review, main advanced to `27206efe`, merging P341, then `11018aed`, merging P342. P341's merge adds `inbox: []` to the exact ticket assertion in `tests/project-dispatch.test.js:1624`. P342's merge removes the obsolete no-talk sentence from `subPrompt()`. Those two merge fixes are accounted for below. `11018aed` is the final main snapshot checked.

Validation: six focused Vitest invocations ran 24 tests successfully and skipped 424. No test was added or changed. Six inline Node assertion probes checked the reported edge cases and the inbox guards. Pending modules were loaded from git into memory, without changing source files or checking out branches. Full branch integration, real harness permission enforcement and a live failover were not run. Findings based on failover follow the code path rather than a live harness trial.

## R36-1: A printed lane ticket reaches public run output and logs

Priority: P1. Files: `server/runs.js:860`, `server/runs.js:741`, `server/runs.js:773`, `src/briefs/run.js:814`, `src/briefs/audit.js:10`.

What happens: the bridge copies runner output into `running[].lastLines` without removing its live ticket. A GET of `/api/control/runs` needs no lane ticket, so another local caller can recover the credential if a harness prints it. The runner's log masker also leaves `X-MachineRoom-Lane: VALUE` intact. On a refused run, the bridge can copy that output into the record's `note`. P341 then lets a caller holding the leaked ticket read that run's inbox too.

How to see it: use a fake runner which runs `console.log('X-MachineRoom-Lane: ' + process.env.MACHINEROOM_LANE_TICKET)` and stays alive briefly. GET `/api/control/runs` without an Origin or ticket. The header is in `running[0].lastLines`, and its value still passes `laneTicket()`. This was reproduced with a generated test ticket. A separate assertion confirmed `createLaneLog().push()` and `flush()` preserve the header unchanged. No credential value was printed by the probes.

Smallest fix: mask the active ticket at both the runner log and bridge output boundaries, including split chunks, complete lines and the final tail. Extend the shared header and assignment masking to recognize the lane credential too. Check both the running response and a failed-start record with a runner that prints the header or the bare value. The existing secrecy test uses a silent runner and cannot exercise this path.

## R36-2: A backup inherits the failed lane's ticket and inbox identity

Priority: P1. Files: `server/runs.js:843`, `server/runs.js:750`, `scripts/run-lane.mjs:1731`, `scripts/run-lane.mjs:1838`. P341: `server/runs.js:1562` at `4d4245eb`.

What happens: the ticket belongs to the lane passed to the bridge's original `startRun()`. Failover calls `startLane()` for the backup inside the same runner, and its environment still contains the original ticket. The bridge deletes that ticket only when the outer runner closes. The backup therefore sends as the failed lane, shares its four-message allowance and, with P341, reads its inbox. A coordinator addressing `lane:BACKUP` gets 409 because the registry still names the original lane.

How to see it: configure `primary` with `fallback: backup`, start it through POST `/api/control/runs` on a git project, and have its harness return an early quota error. Have the backup POST `/api/orchestrator/messages` using its inherited ticket. `message()` obtains `held.lane === 'primary'` and delivers from `lane:primary`. With P341, GET with that ticket selects the primary inbox. This is a source trace; a live failover was not run.

Smallest fix: treat failover as the end of the original ticket. Do not pass that credential to the backup. Give the backup a fresh ticket registered under its own lane, or leave its messaging disabled until the bridge can do that. Revocation must happen at the handoff, rather than waiting for the outer runner to exit.

## R36-3: Failover drops a mode saved in the primary lane

Priority: P1. File: `scripts/run-lane.mjs:1690`.

What happens: `startFailover()` applies only `options.mode` to the backup. A mode read from the primary's `cli.mode` is absent from those options. A primary Claude lane saved as Plan can therefore fall back to a Claude lane with no mode and run with `--dangerously-skip-permissions`. This affects briefs, project tasks and queue tasks using the shared failover path.

How to see it: set primary `cli.mode` to `plan`, set its fallback to a Claude backup with no `cli.mode`, and run `node scripts/run-lane.mjs primary P1` without `--mode`. Make the primary fail before doing work. The backup passes `laneModeProblem()` with no mode, and `commandFor()` selects the skip-permissions flag. An assertion probe reproduced the exact override expression and resulting command; it did not start a real fallback.

Smallest fix: carry the primary run's effective mode into failover, including one taken from `cli.mode`. The failed record already has that effective `mode`. Apply it to the backup and keep the existing validation before taking its lock. Add a failover assertion where the mode comes only from the lane file.

## R36-4: The bridge accepts modes which the runner refuses

Priority: P2. P343 files at `b166fa8d`: `server/runs.js:671`, `server/runs.js:1490`, `tests/run-mode-route.test.js:96`. Shared runner check: `src/briefs/run.js:47`.

What happens: the bridge's new validator checks the harness list but omits the runner's OpenCode Plan and Edits refusal. A request gets 202, then the real runner refuses to start. It also trims a mode for validation but forwards the original string for a single project task, so Claude `" plan "` is accepted by the bridge and rejected by the runner. Queue and brief starts trim it, making the task forms disagree.

How to see it: POST `/api/control/runs` with `{ "lane": "opencode", "task": "Do it.", "mode": "plan", "confirmed": true }`. Repeat with a Claude lane and `"mode": " plan "`. In-memory loading of P343 reproduced 202 for both requests; their captured arguments then failed the real `parseRunArgs()` and `laneModeProblem()` path. P343's Plan test substitutes an argument recorder for the runner, so it asserts acceptance of the unsupported OpenCode case.

Smallest fix: normalize the requested mode once and validate the effective lane through the shared runner helper. Pass that normalized value for every start form. Make the route test use Claude for accepted Plan, and require a 400 with no spawn for OpenCode Plan and Edits.

## R36-5: Restarting the bridge loses saved lane messages

Priority: P2. Files: `server/orchestrator.js:1075`, `server/orchestrator.js:1103`, `server/orchestrator.js:1420`.

What happens: P335 delivers messages from `lane:KEY`, but `knownSender()` restores only a bare lane key. It drops the new messages from the current conversation and saved sessions. The pending-message loader also excludes lane senders, so accepting the sender alone would still lose a queued question or blocker after a restart. The Team copy can survive because it uses the separately updated agent-party check.

How to see it: save a paused orchestrator with a configured `worker` lane, a message from `lane:worker`, and that message's id in `pending`. Recreate the orchestrator on the same chat file. Its answer has no lane message. This was reproduced with a temporary chat file and no harness turn.

Smallest fix: accept `lane:KEY` when KEY is a known lane in the restored-message check. Allow the same validated lane messages in pending restoration. Check a current message, an archived message and a pending message across reload.

## R36-6: A harness change can send an effort its new harness rejects

Priority: P2. Files: `server/orchestrator.js:2343`, `server/orchestrator.js:2356`, `server/orchestrator.js:1954`.

What happens: `setHarness()` keeps the old effort without checking the new harness's list. P345 now forwards that value to Codex. Switching Claude at `max` to Codex therefore sends `model_reasoning_effort=max`, although Codex's own `setEffort()` refuses it. Restarting then drops the saved invalid effort, so the setting also changes across reload.

How to see it: POST `/api/orchestrator/effort` with `max` on a Claude orchestrator, then POST `/api/orchestrator/harness` with `codex` and `gpt-6.1-terra`, then start a turn. A probe captured `model_reasoning_effort=max` in the turn command and confirmed that setting `max` directly on the resulting Codex orchestrator returns 400. The harness process was replaced with an empty Node program; no provider request was made.

Smallest fix: when changing harness, retain effort only if `effortLevelsFor(nextHarness)` accepts it; otherwise clear it before persisting. Add the Claude Max to Codex transition to the effort tests.

## R36-7: Sidebar lane names have no catalogue in the real caller

Priority: P2. Files: `src/ui/sidebar.js:374`, `src/ui/Sidebar.jsx:239`, `src/ui/Sidebar.jsx:255`, `src/ui/Sidebar.jsx:601`, `tests/sidebar.test.js:294`.

What happens: the new helper reads lane names from `options.lanes` or `answer.lanes`. The real Sidebar constructs previews with messages and no lanes, then calls `previewLines(preview)` without options. Known lanes therefore show their keys, such as `opencode`, instead of their labels. The new test puts a lane catalogue into an answer shape the real caller never supplies.

How to see it: open the sidebar preview of a conversation containing a message from `lane:opencode`. Following `openPreview()` to the render call supplies no catalogue. Calling the helper with that actual messages-only shape returns `opencode`; supplying the test's invented catalogue returns `OpenCode`. The helper behavior was asserted. The screen was not checked.

Smallest fix: supply the actual lane catalogue at the Sidebar call and test that preview path. Keep key fallback for an unknown lane.

## R36-8: The shared coordinator instructions still say lanes cannot talk

Priority: P3. File: `docs/agents/ORCHESTRATOR-AGENT.md:92`. Prompt assembly: `server/orchestrator.js:1874`. P342 reply instruction: `src/model/hierarchy.js:301` at `7240b79f` and `11018aed`.

What happens: the shared instructions loaded for main and sub turns still say `A lane does not talk. It reports when its run ends`, and give no lane inbox reply form. A sub also receives P342's new lane-message and reply instruction, so its assembled instructions conflict. The main receives the obsolete statement without the new reply instruction. The model's response to that contradiction was not tested.

How to see it: read the shared prompt's line 92 beside the instruction assembly at `server/orchestrator.js:1874` and the added sub line. An in-memory assertion also found the duplicate obsolete sentence inside P342's original `subPrompt()`; merge `11018aed` removes that duplicate, but does not change the shared prompt. Thus the shared contradiction remains after the merge.

Smallest fix: replace the shared no-talk sentence with the current message and reply contract. This gives the main orchestrator the lane reply form too. Check the assembled instructions for obsolete claims, as well as checking that the new sub line is present.

## R36-9: The capability docs still describe the earlier behavior

Priority: P3. Files: `docs/agents/FREE-HIERARCHY.md:15`, `docs/agents/FREE-HIERARCHY.md:27`, `docs/agents/FREE-HIERARCHY.md:43`. P341 file at `4d4245eb`, also in `27206efe`: `docs/agents/architecture/LIVE.md:13` and `docs/agents/architecture/LIVE.md:14`.

What happens: FREE-HIERARCHY still calls P335 to P337 briefs only and says the server drops Codex and native sub effort. Those features are merged, and the focused tests pass. Its runbook also says the server ignores Codex sub effort. P341's LIVE text retains `a lane run receives nothing mid-run`, immediately before the added paragraph describing mid-run inbox reads.

How to see it: read those sentences beside `server/orchestrators.js:593`, `server/orchestrator.js:1954`, and P341's GET handler. `node ../../node_modules/vitest/vitest.mjs run tests/orchestrator-effort.test.js` passed all seven tests, and the owner-tree file passed all three. The original lane-send tests passed too. These checks establish the implemented behavior, not every UI path for creating a sub.

Smallest fix: update the merged-feature status and the effort statements. Remove the obsolete LIVE no-receive sentence. Distinguish a lane polling its inbox from a reply interrupting its call, and distinguish the working effort endpoint from any remaining group-creation UI limits.

Sound areas checked:

Ticket creation and ordinary lifetime: 16 random bytes become 32 hex characters; asynchronous start errors and normal close call `finish()`, successful stop settles or finishes the item, and bridge stop clears the registry.

Message authentication and caps: the reviewed paths derive lane identity from a ticket; P341 probes refused missing and ended tickets, page inbox reads, orchestrator-token inbox reads, a page claiming a lane sender, and a lane's fifth send across both target types.

Inbox bounds and isolation: P341 keeps the newest 20, returns only from/text/at, separates two tickets' inboxes, refuses self messages and removes access when the ticket is removed.

Mode defaults and direct commands: assertions matched no-mode commands against `bde6c710` for Claude, OpenCode, Codex and AGY; Claude Plan and the unattended Ask refusal also passed. Native mode forwarding and the other explicit mappings were read in their descriptors.

Effort set and load on an unchanged harness: Codex and native command propagation, no-effort commands, Codex xhigh, OpenCode's xhigh refusal, valid saved effort and invalid saved effort were covered by the seven passing effort tests.

Tests and UI: the four original lane-send tests, one ticket secrecy test, six prompt/environment tests, three lane-label tests and three owner-tree tests passed. These are focused checks, not a full-suite or visual pass.

Docs checked against code: the HIERARCHY communication table, the mode mapping and refusal text added by P344 to COMMANDS, and LIVE's P345 effort sentence agree with the reviewed paths, subject to the open findings above.
