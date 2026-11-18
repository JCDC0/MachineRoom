# P600 lower panel design review

Reviewed all nine bench images against the owner's brief and its description of the Antigravity project list. The six `after-` JPEGs are 1536 × 702 on disk. The reviewed UI files match `a0ef0905`. Positions below refer to the saved images. Keyboard behavior is assessed from the code. [Design brief](DESIGN-PANELS.md)

## Chat bubbles

**D2-1 · Medium · The message rhythm is still loose.** In `before-1-chat.png`, both `Continue` bubbles have a large blank bottom and right edge. In `after-2-chat-bubbles.jpg`, the two `Continue` bubbles at the right fit their text, have no border, and share a clean right edge. Replies are plain and start at the same left edge. The first bubble still leaves a conspicuous strip of black before the first reply. Both log styles set `gap: 16px`. The invisible action row adds at least 14px and the message flex gap adds 4px, for at least 34px from one visible content box to the next. The reply near the bottom shows a heading, a bullet and inline code from the shared Markdown renderer. [Owner and reply markup](../../src/ui/OrchestratorChat.jsx#L1433), [bubble and log rules](../../src/styles.css#L5876), [message actions](../../src/styles.css#L6062), [inline log](../../src/styles.css#L8389)

Fix. Keep Copy, Retry and Branch reachable on hover and focus, and place them outside the message flow so the visible content boxes sit 16px apart.

## Composer

**D2-2 · Medium · Secondary text loses too much contrast.** The bottom of `before-1-chat.png` mixes a square yellow recipient field, bare Model text, capsules and a second line for Agent messages. `after-1-chat-composer.jpg` puts To, Model, Mode and the kebab on one baseline, below the input and opposite the round Send arrow. The low border and white chip values let the draft lead. `Waiting for you` sits under the box once, as specified. But the empty field's placeholder is especially hard to find. Above it, the run subjects in the central log also recede into black. At the specified CSS colors, the 38% white placeholder is about 3.4:1 on black and the 45% inline room text about 4.4:1. The shared 55% muted text used for status and chip labels is about 6.3:1 and gives a better hierarchy. Effort is conditional in code and absent for the pictured selection. [Composer](../../src/ui/Composer.jsx#L18), [orchestrator toolbar](../../src/ui/OrchestratorChat.jsx#L1636), [placeholder](../../src/styles.css#L6477), [inline room text](../../src/styles.css#L8402), [muted token](../../src/styles.css#L9)

Fix. Use the existing muted text color for the placeholder and inline run subjects, leaving the faint token for decoration.

**D2-3 · Low · The composer and transcript use different left edges.** In `after-2-chat-bubbles.jpg`, the reply text starts near x433, the placeholder near x426, and the To chip near x422. The same split is more visible in `after-3-lane-view-from-row.jpg`, where the brief and tool chips start near x433, the Run chip near x422, and the breadcrumb near x409. The repeated offset makes each block look positioned by itself. The desktop log uses 24px side padding, the composer box uses 12px, and the input adds 4px. [Composer padding](../../src/styles.css#L6363), [lane header width](../../src/styles.css#L8349), [inline log and composer widths](../../src/styles.css#L8389)

Fix. Give the transcript, draft text and first toolbar control one content inset, and align the lane breadcrumb with that edge.

## Lane conversation

**D2-4 · Medium · The breadcrumb drops the lane name.** In the top left of `after-3-lane-view-from-row.jpg`, `/MACHINEROOM / LANE` sits above the transcript even though the adjacent row and card name OpenCode. `before-2-lane-view.png` included the lane name, amid the full path and run time. The new 40px line and Back chip are calmer, and the breadcrumb has ellipsis and a title. The row dispatches only the lane key. The HUD tries the snapshot for the name, and `LaneConversation` drops a name equal to the key before it can fall back to `Lane`. The capture establishes the fallback, while the code shows how a missing snapshot match can produce it. [Row event](../../src/ui/FamilyTree.jsx#L153), [snapshot lookup](../../src/ui/Hud.jsx#L204), [breadcrumb label](../../src/ui/LaneConversation.jsx#L226), [header](../../src/ui/LaneConversation.jsx#L562), [truncation](../../src/styles.css#L5606)

Fix. Pass the already visible row label into the conversation and use the lane key for the last fallback.

**D2-5 · High · The row opens a history viewer inside a composer shell.** The bottom of `after-3-lane-view-from-row.jpg` shows one Run chip and a long empty box. The OpenCode row says `off` and the selected historical run says `Failed`. The image shows a non-running lane, with no evidence that this exact row is enabled and idle. Both HUD lane views omit `recipientOptions`, `onRecipientSend` and `worktreeChoice`. `LaneConversation` therefore allows input only when the selected run is live, and `Composer` still renders the bordered form when there is no input. Choosing a lane from the orchestrator's To field supplies those props and already supports starting an idle lane. The native To and Run fields, MESSAGE label and boxed SEND in `before-2-lane-view.png` are gone. The Run chip shows time and a dot, with time and status in each option in code. The footer is the only place the run state is spelled out in the new capture. [HUD row view](../../src/ui/Hud.jsx#L1057), [To-field lane view](../../src/ui/OrchestratorChat.jsx#L1283), [compose gate](../../src/ui/LaneConversation.jsx#L243), [Run picker](../../src/ui/LaneConversation.jsx#L110), [lane toolbar](../../src/ui/LaneConversation.jsx#L749), [shared form](../../src/ui/Composer.jsx#L18)

Fix. Send eligible row-opened lanes through the same composer as the To field and show a compact run-history toolbar for lanes that cannot accept a message.

**D2-6 · Low · Transcript controls still have two visual styles.** In `after-3-lane-view-from-row.jpg` and `after-4-agents-hover-card.jpg`, the rounded brief stays at the top and tool counts are compact pills under the prose. The bright, underlined `SHOW ALL` inside the brief still looks like a leftover from `before-2-lane-view.png`. In `after-3`, the orange tool labels are the strongest accent in the transcript even though the tool groups are folded. They inherit the lane color, which falls outside the five-color rule in this case. Lane replies and results use the same Markdown component as chat. These lane captures show prose and tool groups, so they give no direct view of a rendered lane report heading. [Prompt and transcript](../../src/ui/LaneConversation.jsx#L674), [tool pills and Markdown](../../src/ui/LaneConversation.jsx#L695), [prompt control styles](../../src/styles.css#L5631)

Fix. Use a quiet shared disclosure chip for the prompt and reserve colored tool labels for states that need attention.

## Agents list

**D2-7 · Medium · Row actions move the text they sit beside.** `before-3-agents.png` has role pills, square yellow selection boxes and a constant strip of icons. `after-1-chat-composer.jpg` shows the intended quiet resting list at the left. Names lead, dots mark state, and the model line follows the name under a thin tree guide. `Show 17 more lanes` reads as a row. In `after-4-agents-hover-card.jpg`, the hovered OpenCode line loses part of its model and its `off` shifts inward, out of line with the rows below. `after-5-agents-row-menu.jpg` repeats that jump on OpenCode 4. The trailing slot changes width and margin on hover, focus and menu open. The text and action choices already have the right emphasis at rest. [Tree indent](../../src/ui/FamilyTree.jsx#L64), [fold row](../../src/ui/FamilyTree.jsx#L2480), [row markup](../../src/ui/FamilyTree.jsx#L2544), [action slot](../../src/styles.css#L9462), [row and detail styles](../../src/styles.css#L11747)

Fix. Give the action slot a stable width so the status edge and model truncation stay fixed while the icons appear.

**D2-8 · Low · The count shifts across list states.** The count begins at about x149 in `after-1-chat-composer.jpg` and x134 in `after-6-agents-select-mode.jpg`, where the plus and kebab are visible. It also begins at x134 in `after-3`, `after-4` and `after-5`, with the Agents sidebar scrolled and the header actions hidden. The 15px change follows the visible scrollbar. The CSS already reserves the header action space and changes only opacity and pointer events on hover. The captures do not establish a separate shift caused by hover alone. AGENTS, TEAMS and BUILD A TEAM have compatible muted type and chevrons. In `after-1`, BUILD A TEAM sits one inset step in and between rules, which makes it look like a sub-row rather than a peer header. [Agents header](../../src/ui/FamilyTree.jsx#L2617), [Teams header](../../src/ui/FamilyTree.jsx#L522), [sidebar scrolling](../../src/styles.css#L7200), [header rules](../../src/styles.css#L9449)

Fix. Reserve the Agents scrollbar gutter and check the count in a same-state hover pair. Align the three section titles on one inset.

## Hover card, row menu and select mode

**D2-9 · Medium · The hover card stays over the conversation after opening it.** In `after-4-agents-hover-card.jpg`, the card opens beside OpenCode and shows name, harness and model, effort and mode, status and last run. It is compact and readable. In `after-3-lane-view-from-row.jpg`, the same card is still beside the pressed row's chat button and covers the left of the transcript. The card opens on hover or focus. The click handler opens the conversation without dismissing it, and the focused button can keep the card visible after the pointer leaves. The menu already hides the hover card while open, as seen in `after-5`. [Card details](../../src/ui/FamilyTree.jsx#L2536), [chat button](../../src/ui/FamilyTree.jsx#L2582), [hover and focus behavior](../../src/ui/controls.jsx#L214), [menu suppression](../../src/styles.css#L9492)

Fix. Dismiss the card on chat activation and let it reopen on a fresh hover or keyboard focus.

**D2-10 · Low · The row menu needs a precise label for its first action.** In `after-5-agents-row-menu.jpg`, the small black menu fits next to the OpenCode 4 kebab, with generous item spacing and red limited to `Delete…`. `Turn on` suits an off lane. The pictured `Add sub orchestrator…` opens a form with that lane selected. The design brief lists `Add a lane under this…`, which the code uses on orchestrator rows where that action applies. `Add sub orchestrator…` reads like a global add action when seen on its own. The shared menu places itself within the viewport and handles arrow keys, outside click and Escape in code. [Row menu labels](../../src/ui/FamilyTree.jsx#L2514), [lane action](../../src/ui/FamilyTree.jsx#L1672), [placement](../../src/ui/controls.jsx#L52), [menu focus](../../src/ui/controls.jsx#L102), [menu styles](../../src/styles.css#L11690)

Fix. Make the lane action explicit with `Make sub from this lane…` and keep `Add a lane under this…` on orchestrator rows.

**D2-11 · Low · The selection bar is compact at the cost of clarity.** `after-6-agents-select-mode.jpg` shows one bar with `0 selected`, Make sub, Clear and Done. The slide switches are quieter than the square checkboxes in `before-3-agents.png`. The role pills are gone, and the main orchestrator has no selection switch. The visible `Make sub` label is shorter than the brief's `Make sub orchestrator`, though the accessible name is the full phrase. The outline around the bar and the outlines around three chips make zero selection slightly busier than the rest of the list. The new capture shows all switches off. Code provides the yellow checked state, row toggles, and Done and Escape handling. [Selection bar](../../src/ui/FamilyTree.jsx#L2460), [row toggles and switches](../../src/ui/FamilyTree.jsx#L2544), [selection bar style](../../src/styles.css#L10726), [checked switch](../../src/styles.css#L11681)

Fix. Let the bar use the row surface and keep the visual emphasis on Make sub and Done. Check the occupied bar at the narrowest sidebar width before lengthening its label.

## Verdicts

| Area | Verdict | Reason |
| --- | --- | --- |
| Chat bubbles | Fix first | The compact bubbles are ready. Remove the hidden row from the visible message rhythm. |
| Composer | Fix first | The control family works. Make the draft affordance readable and align its start with the transcript. |
| Lane conversation | Fix first | Restore the lane name and give the row route a useful composer or a clear history toolbar. |
| Agents list | Fix first | The resting rows fit the reference. Keep the right edge stable during interaction. |
| Hover card | Fix first | The card has the right weight and details. Dismiss it when the conversation opens. |
| Row menu | Ship | The hierarchy, placement and danger treatment work. Clarify the lane-specific label. |
| Select mode | Ship | The single row and slide switches are a clear improvement. The bar can be quieter. |
