# P614 lower panel design review

Reviewed all three owner screenshots and all six 1536 by 702 captures supplied for `3e5a7e6d`. The before shots show the oversized chat bubbles, the lane view with native fields and repeated status, and the Agents list with square checks and always visible actions. The after shots cover the revised surfaces. The code backs up behavior that a still image cannot show. [Design brief](DESIGN-PANELS.md), [Design review 2](AUDIT-2026-11-DESIGN-2.md)

## Review 2 findings

**D2-1 · Fixed.** The action row is now positioned below each message and out of its layout. Both logs keep a 16px gap. `after-2-chat-bubbles.jpg` shows a scrolled reply with headings, lists and inline code. It shows no full owner bubble or owner-to-reply pair, so the gap fix is confirmed in CSS. The `Continue` bubbles in `before-1-chat.png` give the old baseline. [Log and bubble styles](../../src/styles.css#L5848), [Message actions](../../src/styles.css#L6035)

**D2-2 · Fixed.** In `after-1-chat-composer.jpg`, “Ask the orchestrator anything” is easy to find, and the run subjects above it are readable. Both now use the shared muted text color. The composer still has one control row and one waiting line. [Placeholder](../../src/styles.css#L6474), [Run text](../../src/styles.css#L8407)

**D2-3 · Fixed.** The run list, draft and To chip in `after-1` start at about x433. In `after-3-lane-view-from-row.jpg`, the breadcrumb group starts at the same edge as the brief, transcript and Run chip. Its color dot is the first item on that edge. [Lane header inset](../../src/styles.css#L8346), [Log and composer insets](../../src/styles.css#L8394)

**D2-4 · Fixed.** `after-3` names `CLAUDE CODE` beside `/MACHINEROOM`, matching the lane label in the Agents list. The HUD looks up the name and falls back to the lane key. [HUD name lookup](../../src/ui/Hud.jsx#L242), [Lane label](../../src/ui/LaneConversation.jsx#L251)

**D2-5 · Fixed.** `after-3` shows the off Claude Code lane with a compact Run chip and a Finished line. The empty bordered box is gone. For an eligible enabled lane in Live, the row route supplies the recipient picker, Send and the Worktree switch through the shared composer. The capture verifies history mode. The enabled idle route is confirmed in code. [Eligibility](../../src/ui/Hud.jsx#L251), [Row route](../../src/ui/Hud.jsx#L757), [Lane composer](../../src/ui/LaneConversation.jsx#L778), [History form](../../src/ui/Composer.jsx#L38)

**D2-6 · Fixed.** In `after-3`, Show all uses a muted disclosure chip and the folded tool counts use the same style. The finished run has quiet tool labels. The transcript shows a rendered heading, a bullet and inline code. [Brief and tool chips](../../src/ui/LaneConversation.jsx#L704), [Tool tones](../../src/styles.css#L5670)

**D2-7 · Fixed.** The Claude Code 2 model and right edge of `off` hold their positions in `after-3` at rest, `after-4-agents-hover-card.jpg` on hover and `after-5-agents-row-menu.jpg` with the menu open. The icons fill the reserved slot. [Row action slot](../../src/styles.css#L9461)

**D2-8 · Fixed.** The working count starts at about x125 in `after-1` with the list folded, in `after-4` with a scrollbar, and in `after-6-agents-select-mode.jpg` with the header actions visible. AGENTS, TEAMS and BUILD A TEAM share the left inset in `after-1`. The shots show stability across these states. They lack a same-state hover pair for the header. [Scrollbar gutter and header styles](../../src/styles.css#L9446)

**D2-9 · Fixed.** `after-4` shows the Claude Code 2 hover card with its model, effort, mode, status and last run. `after-3` shows a clear transcript after a row opens the lane view. Chat activation cancels the pending card and closes a visible one. A fresh hover or focus can open it. [Chat button](../../src/ui/FamilyTree.jsx#L2585), [Card dismissal](../../src/ui/controls.jsx#L214)

**D2-10 · Fixed.** The first item in `after-5` reads `Make sub from this lane…`. Turn on fits the off lane, and Delete keeps the red treatment. The orchestrator action still reads `Add a lane under this…` in code. [Row menu items](../../src/ui/FamilyTree.jsx#L2517)

**D2-11 · Fixed.** The `2 selected` bar in `after-6` fits on one row. Make sub and Done lead, Clear is quieter, and the two yellow slide switches stand out. The bar has a soft row surface. The visible `Make sub` label stays short and the accessible name is `Make sub orchestrator`. This capture covers an occupied bar at 1536px. The narrowest sidebar is unverified. [Selection bar](../../src/ui/FamilyTree.jsx#L2465), [Bar styles](../../src/styles.css#L10729)

## New findings

**D3-1 · Low · Jump to newest still uses the old button style.** In `after-2`, the square yellow button sits against the far right edge of the panel, beyond the log scrollbar and composer edge. The button in the capture is about 20px high. Its style uses a 2px radius and 2px vertical padding. The brief calls for a 28px control and a hit area of at least 24px. [Button markup](../../src/ui/OrchestratorChat.jsx#L1477), [Button style](../../src/styles.css#L6010)

Fix. Use the shared chip and align it with the right edge of the conversation column.

**D3-2 · Low · History shows the run time twice.** In `after-3`, the Run chip shows `15:09:41` and the line directly below reads `Finished · Run 15:09:41`. Both also carry a green dot. The footer gets the time in history mode. [Run chip](../../src/ui/LaneConversation.jsx#L131), [Footer context](../../src/ui/LaneConversation.jsx#L236)

Fix. In history mode, keep the time on the Run chip. Keep the outcome and any reported context in the status line.

**D3-3 · Low · The hidden row actions take space from the model.** In the resting list in `after-1`, the orchestrator and OpenCode 3 model lines end in ellipses with a blank strip to their right. The fixed action slot now uses the width of two buttons and their gap on every row. That keeps the text steady and makes the model harder to scan at rest. [Row action slot](../../src/styles.css#L9474), [Detail and action markup](../../src/ui/FamilyTree.jsx#L2582)

Fix. Give the model line more room while keeping its width and the status position steady when actions appear.

## Verdicts

| Surface | Verdict | Reason |
| --- | --- | --- |
| Chat bubbles | Ship | The spacing fix is in the styles. A capture with adjacent bubbles and replies would confirm the rendered gap. |
| Composer | Ship | The draft is readable and shares the transcript's left edge. |
| Lane conversation | Ship | The breadcrumb names the lane and the compact history toolbar keeps the transcript in view. |
| Agents list | Ship | The count and status stay steady. Model detail has less room. |
| Hover card | Ship | The card gives the expected details and clears when the lane view opens. |
| Row menu | Ship | The first action names what it does to this lane. |
| Select mode | Ship | The occupied bar fits and the selected switches read clearly at the captured width. |

The captures show one desktop width. Keyboard focus, live Send, a fresh hover after chat activation and the narrowest sidebar still need an interactive check by the orchestrator.
