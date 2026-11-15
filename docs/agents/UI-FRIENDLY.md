# Friendly forms review

P361. Source review of 0.1.401 at 5e887589. Ranked by the cost to the owner, highest first.
P359 owns models filled in without the owner choosing them. P360 owns model names and provider paths. Neither is a finding here.
No screen or live account was used. The findings describe code paths, not observed browser sessions.

## Forms checked

- Add child has four choices in order: Label, Harness, Model, Effort. Effort is absent when unsupported. Label starts empty. A beginner must know which program runs a model and what effort means (`src/ui/FamilyTree.jsx:1928`).
- Add sub orchestrator starts with selected agents, then Label, Harness, Model, Effort. Label starts as `Sub orchestrator`. The agent selection is outside the form (`src/ui/FamilyTree.jsx:1223`, `src/ui/FamilyTree.jsx:2021`).
- Build a team has four fields: Orchestrators, Coders each, Harness, Model. Both counts start at 1. It groups existing agents, rather than creating coders (`src/ui/FamilyTeam.jsx:45`, `src/ui/FamilyTeam.jsx:344`, `src/ui/family.js:565`).
- Child, sub and team drafts currently prefer OpenCode and fill model choices. Child effort prefers max for OpenCode. Model defaults belong to P359 (`src/ui/family.js:344`, `src/ui/FamilyTree.jsx:1223`).
- The ladder editor is the sub's family tree editor: Label, Harness, Model, Effort, Agents and Autocompact. Label, setup and membership have separate save buttons (`src/ui/FamilyTree.jsx:1649`).
- Mode choices already explain themselves with `entry.line`. Effort choices show only the level word. Model search and refresh differ across the three forms below (`src/ui/OrchestratorChat.jsx:1836`, `src/ui/OrchestratorChat.jsx:1917`).

## Findings

### 1. Chat tabs and To can point at different agents

Screen and control: `OrchestratorChat`, orchestrator tabs and `To`.
Source: `src/ui/OrchestratorChat.jsx:156`, `src/ui/OrchestratorChat.jsx:777`, `src/ui/OrchestratorChat.jsx:883`, `src/ui/OrchestratorChat.jsx:1669`.
Today: opening a sub's tab changes the conversation, model and Stop target. To stays on its previous recipient, initially Orchestrator.
Cost: the owner can read one agent's chat and send work to another without intending to.
Change: set To to the opened orchestrator whenever its tab opens. Keep the explicit To choice for sending to a lane.

### 2. The sub form offers an effort choice it does not save

Screen and control: `FamilyTree`, `Add sub orchestrator`, `Sub orchestrator effort`.
Source: `src/ui/FamilyTree.jsx:2078`, `src/ui/FamilyTree.jsx:1324`, `src/ui/FamilyTree.jsx:1338`, `src/ui/ladderForm.js:118`.
Today: effort is selectable and appears in the Create confirmation. The saved sub has no effort field.
Cost: the form promises a setting that is lost. This concerns an explicit choice, separate from P359's defaults.
Change: remove Effort from this creation form and its confirmation until creation can save it. Keep effort editing on an existing sub.

### 3. Start describes full permissions even in another mode

Screen and control: `OrchestratorChat`, `Start the orchestrator`.
Source: `src/ui/OrchestratorChat.jsx:269`, `src/ui/OrchestratorChat.jsx:354`, `src/ui/OrchestratorChat.jsx:1532`; main text in `src/ui/orchestratorChat.js:29`.
Today: both main and sub start text say `with full permissions`, without consulting the current mode.
Cost: the first explanation of what the agent may do can contradict the Mode picker.
Change: replace that phrase with the current mode's label and explanation. If mode is unknown, omit the permission claim.

### 4. File-backed agents invite edits that cannot be saved

Screen and control: `FamilyTree`, lane editor, `Model`, `Effort`, `Backup lane`, `Save`.
Source: `src/ui/FamilyTree.jsx:1690`, `src/ui/FamilyTree.jsx:1755`, `src/ui/FamilyTree.jsx:1769`, `src/ui/family.js:8`.
Today: a lane from lanes.json has editable setup controls, a disabled Save and `A lane from lanes.json cannot be updated.`
Cost: the owner can spend time choosing settings before learning the form cannot apply them.
Change: show this setup as read-only text with `Edit this agent in lanes.json.` Keep the working Label and Hide or Remove actions.

### 5. A failed Direct API model read looks like a missing key

Screen and control: `FamilyTree`, Direct API model field and `Open Settings` notice.
Source: `src/ui/FamilyTree.jsx:1631`, `src/ui/FamilyTree.jsx:1935`, `src/ui/FamilyTree.jsx:1974`, `src/ui/ModelRefresh.jsx:68`.
Today: when loading ends with no choices, the form says `Add a Direct API key in Settings first.` The model error is inside the picker that this notice replaces.
Cost: an owner with a saved key can be sent through key setup again after a read failure. The editor and sub form use the same pattern.
Change: show the model read error and Retry before the missing-key notice when a read failed. Keep Open Settings for the empty setup case.

### 6. Build a team gives the wrong recovery step

Screen and control: `FamilyTeam`, team preview and missing-lanes sentence.
Source: `src/ui/family.js:509`, `src/ui/family.js:603`, `src/ui/FamilyTeam.jsx:415`.
Today: `Turn on N more lanes first.` appears when the unassigned pool is too small. That pool already includes turned-off lanes.
Cost: turning on a lane already counted cannot fix the shortage. The owner must work out that these are existing agents being grouped.
Change: say `Need N more agents outside existing teams. Add agents or reduce the team size.`

### 7. Custom endpoint refresh is offered before it can work

Screen and control: `EndpointsPanel`, `Custom endpoint`, model refresh button.
Source: `src/ui/EndpointsPanel.jsx:464`, `src/ui/EndpointsPanel.jsx:337`, `src/ui/EndpointsPanel.jsx:687`.
Today: entering a new name enables refresh, but pressing it says `Save the endpoint first.` Saving closes the form; the saved row then offers Refresh models.
Cost: the owner takes a failed step to learn the required order.
Change: hide refresh in the custom form until its name identifies a saved endpoint. Say `Save first, then use Refresh models on its row.` beside Models.

### 8. Settings puts decoration ahead of getting agents ready

Screen and control: `Settings`, section order.
Source: `src/ui/Settings.jsx:102`, `src/ui/Settings.jsx:146`, `src/ui/Settings.jsx:203`, `src/ui/Settings.jsx:232`, `src/ui/Settings.jsx:300`.
Today: Folder depth, Content files, Screen effects, Replay and Sound precede Subagents, Lanes, Harnesses and Direct API.
Cost: someone trying to connect a runner or a model must pass visual effects and music first.
Change: move Harnesses, Direct API, Keys and Lanes to the top in that order. Keep the remaining sections in their current relative order.

### 9. Model search changes with the screen

Screen and control: `FamilyTeam` Model and `OrchestratorChat` Models.
Source: `src/ui/FamilyTeam.jsx:403`, `src/ui/ModelRefresh.jsx:107`, `src/ui/OrchestratorChat.jsx:1794`; shared picker at `src/ui/ModelPicker.jsx:204`.
Today: Build a team uses a plain select without search. Chat has its own search list without the shared picker's pins, sort or arrow-key selection. Add child and Add sub use ModelPicker.
Cost: a large model list is harder to navigate in one form, and a pinned choice does not help in chat.
Change: use the existing ModelPicker in Build a team and chat, keeping their current refresh and save handlers. Leave naming to P360.

### 10. The ladder checklist hides which team will lose an agent

Screen and control: `FamilyTree`, sub editor, `Agents` and `Save agents`.
Source: `src/ui/FamilyTree.jsx:1865`, `src/ui/FamilyTree.jsx:1889`, `src/ui/FamilyTree.jsx:1369`.
Today: each checkbox shows a label and internal id. Existing parents appear only through a later warning that names affected subs and counts.
Cost: the owner cannot see which selections move agents from another team while making the choice.
Change: replace the internal id beside each agent with its current parent's label. Keep the transfer warning and confirmation.

### 11. Renaming an agent asks twice for the same choice

Screen and control: `FamilyTree`, `Label` and `Save label`.
Source: `src/ui/FamilyTree.jsx:1076`, `src/ui/FamilyTree.jsx:1670`.
Today: Save label opens `Set the label of OLD to "NEW"?`, then asks for Save label again.
Cost: every small rename takes an extra click with no new consequence explained.
Change: save a valid changed label directly from Save label. Keep validation, bridge confirmation data and inline errors.

### 12. Chat model and effort choices repeat a Set step

Screen and control: `OrchestratorChat`, `Models`, `Effort`, `Set the model`, `Set the effort`.
Source: `src/ui/OrchestratorChat.jsx:1070`, `src/ui/OrchestratorChat.jsx:1885`, `src/ui/OrchestratorChat.jsx:1917`, `src/ui/OrchestratorChat.jsx:1941`.
Today: picking a model or effort closes the list and opens a card repeating that choice with Set and Cancel. Picking Current also does this.
Cost: frequent tuning needs a redundant click after each deliberate selection.
Change: apply a different model or effort on selection, with the existing save errors. Picking the current value should just close the list.

### 13. Ready harnesses show repair controls all the time

Screen and control: `HarnessesSettings`, harness row, `Program`, `Save`, `Clear`.
Source: `src/ui/HarnessesSettings.jsx:245`, `src/ui/HarnessesSettings.jsx:269`.
Today: every non-native harness shows version, resolved program path, an override input and two buttons, even when Ready.
Cost: normal setup looks like executable-path repair and adds many controls before Direct API.
Change: fold version, paths and override controls under `Program details` for Ready harnesses. Keep them open for Not ready and keep the program-change confirmation.

### 14. Unsupported effort still gets a picker

Screen and control: `OrchestratorChat`, `Effort`; `FamilyTree`, orchestrator editor Effort.
Source: `src/ui/OrchestratorChat.jsx:1710`, `src/ui/OrchestratorChat.jsx:1919`, `src/ui/FamilyTree.jsx:1815`.
Today: chat opens `No effort levels for this harness.` The orchestrator editor can show a select containing only default.
Cost: a beginner is asked to inspect a control that offers no decision.
Change: omit these effort controls when the harness has no effort levels. Do not change any saved effort or default policy.

### 15. A failed lanes read also announces an empty list

Screen and control: `LanesSettings`, list state sentence.
Source: `src/ui/LanesSettings.jsx:33`, `src/ui/LanesSettings.jsx:140`, `src/ui/LanesSettings.jsx:187`.
Today: a failed read sets lanes to an empty array, so `No lanes are listed.` appears alongside the failure sentence.
Cost: the owner cannot tell whether agents are absent or their list could not be read.
Change: suppress the empty sentence while a read error is present. Show the existing error alone.

## Do not change

- Keep the four-field add-agent order and selected-agent sub flow. Do not restore id, key-slot, scope-glob or Restricted fields to these basic forms. `subFromForm` already derives an id (`src/ui/ladderForm.js:118`).
- Keep search by name and id, Current, pins and keyboard selection in ModelPicker. Keep the saved model visible when a refreshed list omits it (`src/ui/modelRefresh.js:28`).
- Keep refresh free of confirmation, its busy state and accessible name, and useful read errors (`src/ui/ModelRefresh.jsx:31`).
- Keep the team preview, named membership changes and fresh-ladder checks before writes. Keep confirms for team Apply or Copy, removals, deletion, Stop, compaction and first start.
- Keep mode explanations, the separate Bypass confirmation with Cancel first, and `Applies from the next turn.` (`src/ui/OrchestratorChat.jsx:1207`, `src/ui/OrchestratorChat.jsx:1853`).
- Keep password key inputs, key-save and replacement confirms, shared-key safeguards, URL validation and the folded custom endpoint form (`src/ui/EndpointsPanel.jsx:61`, `src/ui/EndpointsPanel.jsx:117`).
- Keep modal focus handling, Escape closing the current card, and errors that say a write succeeded before a later read or label update failed. Visual layout checks remain with the orchestrator.
