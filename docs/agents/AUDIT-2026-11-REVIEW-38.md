# Review 38: The friendlier forms batch

Reviewed `cedd5100..399120ae`, including P370 to P373. One owner uses the room.
The changes reorder Settings, fold program controls and share the model picker.
They also apply labels, chat models and chat effort without a second card.
Four P2 findings. No P1 finding. No code changed during this review.

## R38-1: P2. A completed rename overwrites another agent's draft

Source: `src/ui/FamilyTree.jsx:1105`, with editor switching at `src/ui/FamilyTree.jsx:1027`.
Problem: After the write finishes, its label is copied into whichever draft is now open. Removing the confirm card lets the owner switch editors while the write waits.
How to see it: Delay Alpha's label save to Writer. Open Beta and type Reviewer. Finish Alpha's write. Beta's input becomes Writer. Saving Beta then sends a label the owner chose for Alpha.
Fix: Apply the completed label to the draft only if the same agent and submitted label are still being edited. Add a delayed-write test that switches editors.

## R38-2: P2. Chat saves can replace another tab's model or effort

Source: `src/ui/OrchestratorChat.jsx:1027` and `src/ui/OrchestratorChat.jsx:1060`; the picker consumes the shared saved value at `src/ui/OrchestratorChat.jsx:1615`.
Problem: Save results update shared state after the selected tab has changed. The model id is now also fed into the new tab's choices. Its real model is no longer shown as Current. Effort and save errors can cross tabs too.
How to see it: Delay Main's change from Opus to Sonnet. Switch to a Codex sub using GPT. Finish Main's write. The sub's picker shows Sonnet, although the write went to Main. Picking that displayed Current value sends no correction.
Fix: Keep save results and errors with their target agent, or ignore them after selection changes. Test delayed model and effort replies across tabs.

## R38-3: P2. Closing the shared picker loses keyboard focus

Source: `src/ui/ModelPicker.jsx:299` and `src/ui/ModelPicker.jsx:350`, newly used at `src/ui/OrchestratorChat.jsx:1611` and `src/ui/FamilyTeam.jsx:406`.
Problem: Opening focuses Search. Closing removes that input without returning focus to the Model button. Keyboard users lose their place after Escape or a selection.
How to see it: Open chat's Model picker with the keyboard and press Escape in Search. The picker closes, but focus is left on the removed search input in the test DOM. The same close path handles Enter and model clicks.
Fix: Return focus to the trigger when closing the picker. Add focus assertions for Escape and selection in both new callers.

## R38-4: P2. Direct API loses its Not ready reason

Source: `src/ui/HarnessesSettings.jsx:239` and `src/ui/HarnessesSettings.jsx:314`.
Problem: The reason moved inside programDetails. The Direct API branch renders only its saved-item summary, so its Not ready reason disappears entirely.
How to see it: Return an enabled machineroom harness with ready false and reason `No key or endpoint is saved.` Open Settings. Not ready appears, but its reason does not. The bridge supplies that reason at `server/harness-settings.js:87`.
Fix: Render the status reason outside the program-only branch. Cover a Not ready Direct API row as well as a missing CLI program.

## Evidence and limits

- Four cases above reproduced with assertions using the existing UI test DOM and mock clients. No live account or screen was used.
- Eight focused UI test files passed: 145 tests. The broader related run had 845 passes and four sandbox failures: three Windows user-record reads and one home-folder fixture write.
- No finding was added merely because a test repeats existing validation. The new behavior tests inspect selected ids, writes, confirms or rendered controls.
- Visual layout and real browser focus behavior remain for the orchestrator. The test DOM retains a detached active element; a browser may fall back to the document body.

Settings order and the remaining sections' relative order are correct. Ready CLI controls fold; Not ready CLI reasons stay open. Opening, arrow navigation and refreshing the shared picker do not apply a model. Refresh keeps the saved model. Team selection reaches the saved plan. Membership labels, transfer warnings, fresh-ladder reads, team confirms, program confirms, Bypass, Stop, compaction and first-start confirms remain in place. Model and effort write errors still render.

Checked and fine
