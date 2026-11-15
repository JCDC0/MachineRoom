# Review 39

Reviewed `117e8b36..8c776d13`: P376, P377, P378, P379, P380 and P381b.

## R39-1: P1. Harness default cannot create a code agent

File: `src/ui/family.js:381`, `src/ui/FamilyTree.jsx:1573`.
The new draft has an empty model and the form accepts it. Create sends that empty model to the bridge. `server/agents-config.js:507` calls `modelAllowed`, which rejects every empty model at `server/harness-models.js:98`. The normal add-agent flow now fails unless the owner picks a model. The form test uses a successful mock at `tests/form-defaults.test.js:126`, so it misses this refusal.
How to see it: open Add child on a ready OpenCode harness, enter a label, leave Harness default and confirm Create. The bridge answers 400. A check against the real `createAgentLane` reproduced the refusal.
Fix: resolve a real default model for a CLI harness before saving, or support an empty CLI model through server validation and command construction. Keep Direct API and endpoint models required. Test the form payload against the real creation path.

## R39-2: P2. A second model choice is silently dropped

File: `src/ui/OrchestratorChat.jsx:1627`, `src/ui/OrchestratorChat.jsx:1022`.
The chat picker no longer receives `disabled={modelSaving}`. It can open and accept another choice while the first save waits, but `saveModel` returns while `modelSaving` is true. `src/ui/ModelPicker.jsx:321` then closes the picker as though that choice was accepted. The first model wins without explaining why the second choice was lost.
How to see it: delay `setOrchestratorModel`, pick one model, reopen the picker and pick another before the first call ends. Only the first request reaches the bridge. A check of the save function reproduced the dropped call.
Fix: disable model selection while a save waits, or keep the latest choice and save it after the first request ends. Add a delayed-save test with two choices on the same tab.

## R39-3: P2. Inbox history can exceed the native context limit

File: `scripts/mr-agent.mjs:1465`, `scripts/mr-agent.mjs:1340`.
Each batch of new replies becomes a permanent user message. `boundMessages` shortens each old user message to 2000 characters, but never removes those messages. Enough reply batches exceed `MR_AGENT_CONTEXT_CHARS` even after trimming. Later model requests keep sending that excess history, which can waste tokens or fail at the provider's context limit. The server's 20-message inbox cap does not bound messages already copied into the native conversation.
How to see it: set the context limit to 8000 and append six batches of replies close to the allowed 8000 characters each. Calling the current `boundMessages` leaves 12257 characters in a minimal conversation. This was reproduced with the actual function and its constants.
Fix: remove or summarize the oldest injected inbox messages until they fit the context budget. Keep the initial task and the newest reply. Test several distinct reply batches with a small context limit.

## Other checks

- OpenCode plan and edits configs contain the intended edit and bash denials. Normal success and failure return paths reach config cleanup. Actual OpenCode enforcement and Windows file access were not verified.
- Failover copies an explicit primary mode and refuses a mode the backup lacks.
- The backup keeps the same ticket. The bridge counts sends by that ticket, so the primary and backup share four sends and one inbox.
- The inbox read has a three-second abort and no retry within a turn. The ticket stays in the request header. Inbox reads reject page requests.
- The picker's default row appears in both its displayed rows and keyboard list. Filtering and sorting use the same flattened order.
- Direct API form validation still requires a listed model. Endpoint creation rejects an unresolved model.
- Rename replies check the submitted draft. Model and effort replies check the tab selection version.
- Six targeted test files passed all 42 tests through npm. The related-test check for this Markdown file found no affected tests. The build passed. Three dependency-free checks passed nine assertions. No screen check was possible.

Checked and fine

## Closed

All three are fixed on main: P384 fixed R39-1 (a code agent made at Harness default saves and starts with no model flag), and P385 fixed R39-2 and R39-3.
