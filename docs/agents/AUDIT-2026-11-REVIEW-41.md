# Review 41

Reviewed `7bd90c3d..620da061`: P386, P388, P389 and P390.

## R41-1: P2. Restart loses the orchestrator's Harness default

File: `server/orchestrator.js:1328`.

P390 saves an empty model, but restore ignores it. Restart keeps the saved
harness and takes the initial model from the orchestrator lane instead.
That model can belong to another harness and make its next turn fail.

How to see it: configure the main lane as Claude with model `opus`. POST
`/api/orchestrator/harness` with OpenCode, model `''` and confirmation.
It answers 200 with an empty model. Close and recreate the registry on the
same runs folder. Its OpenCode orchestrator now has `claude-opus-5-5`.
An assertion through the real route reproduced this.

Fix: restore an explicitly saved empty model. Keep the lane fallback only
when the saved model is absent. Add a restart check to the P390 test.

## R41-2: P2. A new sub replaces Harness default with a lane model

File: `server/orchestrators.js:367`.

The sub form now keeps its model empty, but subConfig replaces that value
with a matching lane's model. The confirmation says Harness default, while
the new sub runs a named model and overrides the harness's own default.
`server/orchestrator.js:962` also replaces an explicit empty constructor
model with the main lane's model when no matching lane supplies one.

How to see it: configure an OpenCode lane with
`opencode-go/qwen3.8-flash`. POST `/api/orchestrator/ladder` with a new
OpenCode sub, model `''`, that lane and owner confirmation. The route
answers 200 and the saved ladder keeps `''`, but the new sub's answer
names `opencode-go/qwen3.8-flash`. A real-route assertion reproduced this.

Fix: carry an explicit empty model through subConfig and the constructor.
Use lane defaults only when no model was supplied. Test the saved sub's
actual model after submitting the form.

## R41-3: P2. An inbox tail looks like a complete new order

File: `scripts/mr-agent.mjs:1366`.

The final tail slice can start mid-word. It drops the sender and gives no
notice that the start was removed. Losing a qualifier can reverse an order.
The newest reply's end stays, but the agent cannot tell it is incomplete.

How to see it: use an 8000 character bound, a 1000 character system message
and the initial task. Add one inbox reply with 5500 filler characters,
` Never `, then `delete the backup. ` padded to the tail's capacity.
After bounding, the heading is followed by `delete the backup.` without
`Never` or a cut notice. One more final character starts it at `elete`.
Both assertions reproduced this, with the task kept and the bound met.

Fix: mark a cut reply as an incomplete ending and begin at a word boundary.
Keep the sender separately. Add a test that checks the start of a cut tail.

Checked the form saves through the real lane, ladder and harness handlers.
Empty CLI models pass those handlers. Direct API and endpoint lane creation
still refuse an empty model, as does the orchestrator's Direct API switch.
Unknown named models still fail its harness switch. Empty models have a
positive context window and the model label has a Harness default fallback.
CLI command builders omit empty model flags. The leftover helper excludes
the runner and its parent chain; an injected snapshot confirmed that case.
Inbox loops are finite and leave the initial task. The changed tests include
checks that fail with the fixes removed, plus intentional unchanged guards.
Seven focused test files passed, 69 tests. No live harness or visual check.

Checked and fine
