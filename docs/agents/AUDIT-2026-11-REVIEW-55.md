# Review 55: P535 to P543

Read the requested range, the earlier P535 to P539 changes, their callers and tests.
The supplied range starts after P535, P536, P538 and P539 were merged.
Assumed one owner and one long-running bridge, with parallel lane runs.

## R55-1: P2, live backup messages are refused

`server/orchestrators.js:869` compares the selected start time with the original ticket's start time.
Failover keeps that ticket but starts the backup later (`scripts/run-lane.mjs:1978`, `server/orchestrators.js:973`).
Open the backup's live conversation after failover and send a message. It answers 409 even though its inbox is live.
An inline check confirmed 409 with the backup start time and 202 without the new field.
Fix: keep and check the backup run's start time when claiming its ticket. Continue to reject older runs.

## R55-2: P2, recovery refuses an unambiguous log

`server/runs.js:199` refuses every filename that starts with a longer lane key, even when that key consumes the whole job prefix.
With lanes `test` and `test-P1`, recover `test-P1-20261118-100000.log` for lane `test`, brief `P1`, with no recorded log or matching lock.
The helper returns an empty path. Without lane `test-P1`, it finds the same file.
Lane `test-P1` would need another brief or `project` segment to produce a run filename, so this name has only one owner.
An inline check confirmed both outcomes.
Fix: reject a longer lane match only when a valid job segment remains before the timestamp. Keep the existing ambiguous two-brief case refused.

## R55-3: P3, expired model retries stay in memory

`server/endpoints.js:412` adds each missing model to `incomplete`, but nothing removes expired, resolved or deleted model entries.
Select a model omitted by the endpoint, wait ten minutes, remove it and select another omitted model. Repeat with new model IDs.
The bridge keeps every old key until restart. An inline check confirmed the expired removed model remained as the map grew from one entry to two.
Fix: prune expired entries before checking the map and remove a model's entry once its window is known.

## Checked and fine

- The lattice uses four blocks and replaces disposed geometry only after its bounds move. Git tree and root card changes reach its floor.
- Height is passed to the right inner rail. The two rail boxes have an eight-pixel gap. Ruler marks ignore pointer events. Keyboard handling remains.
- Count formatting is shared across the inspected token displays. Boundary cases at 999, 1,000, 999,950 and 1,000,000 pass.
- Run-end rows retain a visible failure status. Details reveals the full text and the existing Copy, Retry and Branch actions where applicable.
- Live run options keep live context fields. Claude uses its reported model and preserves assistant usage over cumulative result totals.
- Missing model details wait ten minutes per model. The merged LIVE.md sentences match these paths, subject to the findings above.
- The existing recovery test rejects the ambiguous two-brief name and accepts explicit record or matching lock ownership.
- Focused tests: 463 passed, two known sandbox process tests failed, 465 total. Build passed. No tests were added or removed.
- Visual checks remain with the orchestrator. No full suite or live harness run was attempted.

Checked and fine
