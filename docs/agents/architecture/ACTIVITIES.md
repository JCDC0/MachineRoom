# Activities

The activity schema, how each agent reports tool calls, and the DOM contract.

## Activity schema

Every activity has `time` (ms since epoch), `agent` (key), `runId` and `order`.

| type | extra fields |
| --- | --- |
| `run.queued` | none |
| `run.start` | none |
| `run.end` | `ok`, `error` |
| `tool.start` | `id`, `tool` (read, write, edit, shell, search, web, other), `label`, `touches` |
| `tool.end` | `id`, `ok` |
| `error` | `text` |
| `agent.message` | `to` (the receiving agent key) and `kind` (`order`, `report`, `dispatch` or `wake`); `agent` is the sender |
| `agent.spawn` | `child` (the parent key, `~` and a number from 1 within the parent's run), `name` (at most 40 characters), `label`; `agent` is the parent |
| `agent.end` | `ok`; `agent` is the child |

The OpenCode and Hermes parsers emit `agent.spawn` and then `agent.end` at the time of a `subagent` or `delegate` line, since those harnesses report a child only when it has finished, and keep the `other` tool call for the same line. The Claude parser reads Claude Code's own stream-json (S6g): `Read`, `Write`, `Edit`, `MultiEdit` and `NotebookEdit` touch `file_path` or `notebook_path`, `Glob` and `Grep` touch a folder, `LS` lists one, and `Bash` reads its command. A `Task` or `Agent` tool call starts the child as `PARENT~N`, every later line whose `parent_tool_use_id` is that call's id carries the child's key so the child has its own tool calls and strip, and that call's `tool_result` ends it, failed when `is_error` is set. The AGY parser shows a child while it works, from what a real AGY run sends (S5, run `ffd660e6` on 2026-10-24): an `invoke_subagent` tool step (`Role` is the child's name) starts it as `PARENT~N`, labelled with the `initial_prompt` its `DONE` step carries in `subagent_info`, and it ends at the first `manage_subagents` list whose output shows it in a state other than `running`, or with the parent's `run.end`. The child's own steps go to a transcript file, not to the parent's output, so the room shows the child working with its role and prompt but no strip of its own. This AGY's file tools are `read_file`, `write_file` and `edit_file` (with `Path`), beside the older names. `scenario-g` is that real run, masked; S4's rule (a second `conversation_id` in one run is a child) stays, tested by the hand-written `scenario-f`, though the real AGY never sent one. `state.js` adds a child to the roster with `parent` and `depth`, up to the saved limit: a live room reads `client.agentDepth?.()` at start and on each `agents` notice and passes it to the state (`setDepthLimit`), 3 without the method and 4 at most, and the parent's `run.end` ends its children still working. The engine adds a view for a child when it appears (S2d): the next spare shape at 0.35 of its parent's size (`CHILD_SCALE`), orbiting the parent on a circle of 1.6 times the parent's radius tilted a little off the hub plane, one turn in about 40 seconds with each sibling at its own phase (`childOrbit`, pure, tested), a short line to it that follows the child, and a chip titled `PARENT > NAME`; a child that has ended stays at full opacity for 6 seconds of wall time and then fades over 1.5 seconds (`childFade`, pure, tested; under reduced motion it goes at once after the 6 seconds and holds its place on the circle while it lives). The HUD lists a child under its parent, indented 16px a level, with a `subagent` tag (`.hud-agent-row.is-subagent`, `.agent-subagent`); the number keys pick top agents only.

A touch is `{path, mode, kind}`. `kind` is `file` or `dir`. `mode` is `read`, `write` or `list`. `path` is relative to the project root, and `''` is the root. When the live tree carries the project's full root path, an absolute path is inside only under that path, compared with the platform's rules, and is made relative to it. Any other absolute path is outside. A recording that carries only the root's name keeps the older name rule.

## How each agent reports tool calls

| Agent | Adapter | Signal in `payload.chunk` |
| --- | --- | --- |
| Claude Code | `claude_local` | The older `acpx.tool_call` JSON lines, where the call name carries the path ("Read C:\...", "Edit src\math.js") or the command text for Terminal; or Claude Code's own stream-json `assistant` and `user` lines, where a `tool_use` item starts a call and a `tool_result` item ends it |
| Hermes | `hermes_local` | Plain lines such as `┊ 📖 read  strings.js  1.2s`; shown after the call finishes; reads show only the file name |
| OpenCode | `opencode_local` | JSON lines `tool_use` with `part.tool` and `part.state.input` |
| agy | `process` | JSON lines `step_update`; `ACTIVE` starts a tool, `DONE` ends it |

A shell command touches files only when its text names a known file or folder. See `commands.js` and its tests.

A web search or fetch becomes tool `web` with no touches, and its label holds the query or URL: Claude Code's `WebSearch` and `WebFetch`, OpenCode's `websearch` and `webfetch`, agy's `search_web` and `read_url_content`, and Hermes's `search` and `fetch` lines (`fetch` is its `web_extract`, which prints only the domain).

## DOM contract for terminals and cards

`engine/terminals.js` and `engine/cards.js` build, and the stylesheet styles, these structures:

```
.mr-term.is-{idle|queued|working|error|done}[.is-open][.is-muted]
  .mr-term-title
  .mr-term-body
    .mr-line.is-{normal|dim|error|done}

.mr-term-console[.is-address][.is-muted]
  .mr-term-console-label
    .mr-term-console-link[hidden]
  .mr-term-console-body
    .mr-term-console-line.is-{normal|dim|error|done}

.mr-card.is-{closed|open|files}[.is-active|.is-path][.is-pinned][.is-selected][.is-targeted][.is-lit|.is-dim][.is-flash-white|.is-flash-red]
  .mr-card-backs
    .mr-card-back.is-back-{1|2|3}
  .mr-card-face
    .mr-card-head
      .mr-card-tab
      .mr-card-name
      .mr-card-meta
    .mr-card-items[.is-scrollable]
      .mr-item.is-{file|dir}[.is-read|.is-written|.is-finished|.is-failed][.is-active][.is-flash-white|.is-flash-red][.is-inspected]
        .mr-item-name
        .mr-item-note
      .mr-card-more
    .mr-card-band[.is-failed]
  .mr-card-bracket.is-{tl|tr|bl|br}   (built with every card, shown on .mr-card.is-targeted)

.mr-callout.is-{working|error|done}
  .mr-callout-title
  .mr-callout-task
  .mr-callout-cmd

.mr-board
  .mr-board-title
  .mr-board-summary[.is-over]
  .mr-board-rows
    .mr-board-row[.is-dim]
      .mr-board-row-head
        .mr-board-name
        .mr-board-cost
      .mr-board-row-meta
        .mr-board-tokens
      .mr-board-bar-track
        .mr-board-bar
  .mr-board-quotas
    .mr-board-quota[.is-error]
  .mr-board-empty
```

A chip without `.is-open` hides its body. A row with `.is-inspected` carries a yellow background, a yellow left edge and a yellow name. A card with `.is-targeted` and a row with `.is-active` take `--mr-target`, the colour of the agent touching them, for their corner brackets and the row's name.

Do not rename these classes without changing both sides.
