# Design: the lower panels

2026-11-18. The owner's brief for the chat, the lane conversation and the Agents list. Briefs P597 to P600 build it. The code is still the first authority for behaviour; this file is the authority for how these three areas look.

## What the owner saw

- User bubbles have random space: a short line sits in a wide bubble, and `Continue` sits top left in a tall one.
- The composer mixes styles: a boxed native `To` select with a yellow border, `Model` as plain text with a chevron, `Mode` and `Compact` as capsules, `Agent messages` alone on a second line, and the status line under it all.
- A lane's conversation looks broken: a white native `To` select above the transcript, a `Run` label hanging outside the panel's left edge, a full width native run select, a loose `FINISHED` at the right, a `MESSAGE` label, a boxed `SEND` text button, and the status shown three times (`11:20:16 finished`, `FINISHED`, `● finished`). Lane reports show raw markdown (`## Files changed`, backticks).
- The Agents list is loud: big square yellow checkboxes, a `LANE` pill on every row, and an on/off switch, a trash can, a plus and a chat icon always visible on every row. `Add sub orchestrator`, a `+` next to a trash can and a chat icon beside them read as a puzzle.

The reference is a sleek project list (Antigravity style): quiet rows, the name first, one muted detail on the right, actions that appear only on hover or focus, a kebab menu for the rare ones, a `+` and a kebab on a group header, and a small card on hover with the details.

## Rules for all three areas

- Black background, white text, the five room colours only (`#e5ff00` active, `#ff2a2a` failure, `#2aff80` finished, `#2a9dff` web). Jost and Space Mono, weights 400 and 500, never bold. Spacing on an 8px base.
- One control height: 28px. One list row height: 32px for one line, 44px for two lines.
- New tokens on `:root`: `--surface-1: rgb(255 255 255 / 0.04)` (row hover), `--surface-2: rgb(255 255 255 / 0.08)` (selected row, chip hover, user bubble), `--border-soft: rgb(255 255 255 / 0.16)`, `--text-faint: rgb(255 255 255 / 0.38)`, `--radius-s: 6px`, `--radius-m: 12px`, `--control-h: 28px`.
- No native select is ever shown in its browser default look. A select is styled as a chip (`appearance: none`, the chip border, a muted chevron).
- A status is said once per view.
- Every control keeps a visible focus ring (`1px solid var(--white)`, offset 2px) and a 24px hit area at least.

## Shared controls (P597)

One small module, `src/ui/controls.jsx`, and one block in `src/styles.css`, used by every later brief:

- **Chip** (`.ui-chip`): inline flex, 28px high, padding `0 10px`, gap 6px, `1px solid var(--border-soft)`, fully round, transparent. A muted label (Jost 13) and a white value (Space Mono 12), then a 10px muted chevron when it opens a list. Hover: `--surface-2`. Open (`aria-expanded="true"`): white border. A `select` variant looks the same.
- **Icon button** (`.ui-icon-btn`): 28 by 28, `--radius-s`, no border, a 16px muted icon. Hover: `--surface-2` and a white icon. Always has an `aria-label` and a `title`.
- **Switch** (`.ui-switch`): a slide switch, a 28 by 16 track and a 12px knob. Off: `--border-soft` track and a muted knob. On: yellow track and a black knob. It is a `button` with `role="switch"` and `aria-checked`, and an optional label to its right.
- **Menu** (`.ui-menu`): opened by a kebab icon button (three dots). Black, `1px solid var(--border-soft)`, `--radius-m`, padding 4px, items 32px high with an optional icon and a label; hover `--surface-2`; a danger item in red. Escape closes it and returns focus to the kebab, arrow keys move between items, a click outside closes it. It opens next to its button and stays inside the viewport.
- **Row** (`.ui-row`): padding `0 8px`, `--radius-s`, hover `--surface-1`, selected `--surface-2`. A leading slot, a main column (name, then an optional muted second line), and a trailing slot. Trailing actions are hidden (`opacity: 0`) until the row is hovered or holds focus (`:focus-within`), and they stay in the tab order.
- **Hover card** (`.ui-hovercard`): after 500ms of hover or on focus, a card beside the row: black, `1px solid var(--border-soft)`, `--radius-m`, padding 12px, a title line and up to five muted detail lines. It closes when the pointer leaves the row and the card.

## The chat (P598)

- User bubble: `width: fit-content`, `max-width: 72%`, padding `8px 12px`, `--radius-m`, `--surface-2`, no border, right aligned, no minimum width or height, line height 1.45. A one-word `Continue` is a small bubble.
- Agent and orchestrator text: left aligned, full width, no bubble. 16px between messages.
- Markdown in agent, orchestrator and lane messages is rendered by one shared renderer: headings, lists, bold, inline code, code blocks and links. It builds React elements and never injects HTML.

## The composer (P598)

One composer component serves the orchestrator chat and a lane's conversation.

- A box: `--radius-m`, `1px solid var(--border-soft)`, padding 12px. The text area first, with its placeholder and no label.
- One toolbar row under it. Left: `To` (a select chip), `Model`, `Effort` when the harness has it, `Mode` when it can be set, then a kebab with `Compact…` and `Show agent messages` (a check item). In a lane's conversation the left side is `To`, the `Run` chip (below) and the `Worktree` switch (today's `Separate worktree`). Right: `Stop` (a red text chip, only while working) and Send (a 32px round icon button, the arrow there today).
- One status line under the box, Space Mono 11, muted: a dot in the status colour, then the status, then the context, such as `● Waiting for you · Context 116.8k / 1M` or `● Finished · Run 11:20:16`.

## A lane's conversation (P598)

- One header row, 40px: the breadcrumb on the left (Space Mono 11, muted, cut with an ellipsis and a title), `Back` on the right as a text chip.
- The `Run` chip lives in the composer toolbar: `Run 11:20:16` with a small dot in the run's status colour. Its list shows each run's time and status.
- Gone: the `To` select above the transcript, the `Run` label outside the panel, the full width run select, the loose `FINISHED`, the `MESSAGE` label and the boxed `SEND`.
- The brief card at the top and the tool call chips stay, in the chip style.

## The Agents list (P599)

- Section header: `AGENTS` in Space Mono 11 muted, the count on the right (`1 of 18 working`). On hover or focus the header shows a `+` icon button (`Add a lane`) and a kebab (`Add sub orchestrator…`, `Select lanes`, `Build a team…`). `TEAMS` and `BUILD A TEAM` use the same header.
- An agent row is a two line `.ui-row`: an 8px status dot (yellow working, white idle, `--text-faint` off) and the name in Jost 14; on the right one muted word (`working`, `waiting`, `idle` or `off`). The second line, Space Mono 11 muted: `harness · model`, cut with an ellipsis and a title.
- The `LANE` and `ORCHESTRATOR` pills go.
- Trailing actions, shown on hover or focus: a chat icon button (`Open conversation`) and a kebab with `Add a lane under this…`, `Turn off` or `Turn on`, and `Delete…` in red. Delete keeps today's confirm card. The always visible switch, trash and plus go.
- A lane that is off: its name at 55 percent, the word `off` on the right.
- Selecting: `Select lanes` in the header kebab turns on select mode. Each lane row then shows a slide switch on its left (slide to select), a click on the row toggles it, and a bar above the list says `4 selected` with the chips `Make sub orchestrator`, `Clear` and `Done`. Escape or `Done` ends select mode. No square checkboxes.
- The tree: 16px indent per level, a 1px `--border-soft` guide line. The fold row reads `Show 17 more lanes` with a chevron, in the row style.
- Hover card on a row: name, harness and model, effort and mode, status, and the last run's time and outcome.

## Checking it

- Each brief runs its changed tests and `npm run build`. If it can, it serves its worktree and captures 1280 by 800 screenshots with headless Chrome (`chromePath()` in `scripts/screenshots.mjs`), looks at them and fixes what it sees.
- The orchestrator checks each merge by eye at 1280 by 800 in the bench, and P600 has GPT-6.2 Sol judge those screenshots against this file and the owner's reference.
