# Activities

The activity schema, how each agent reports tool calls, and the DOM contract.

## Activity schema

Every activity has `time` (ms since epoch), `agent` (key), `runId` and `order`.

| type | extra fields |
| --- | --- |
| `run.queued` | optional `startedBy` and `session` |
| `run.start` | optional `startedBy` and `session` |
| `run.end` | `ok`, `error` |
| `tool.start` | `id`, `tool` (read, write, edit, shell, search, web, mcp, task, other), `label`, `touches`, and optional `outside` (`true`) and `outsidePath` (home-masked string) when `read`, `write` or `edit` targets an absolute path outside the project |
| `tool.end` | `id`, `ok` |
| `error` | `text` |
| `agent.message` | `to` (the receiving agent key) and `kind` (`order`, `report`, `dispatch` or `wake`); `agent` is the sender |
| `agent.spawn` | `child` (the parent key, `~` and a number from 1 within the parent's run), `name` (at most 40 characters), `label`; `agent` is the parent |
| `agent.end` | `ok`; `agent` is the child |

The OpenCode parser emits `agent.spawn` and then `agent.end` at a finished `subagent` line. The Hermes parser does the same for a plain `delegate` line. For JSON `delegate_task` calls it starts a child at the call and ends it at the result. Worker lines take available child slots in emission order, which can swap workers when delegates overlap. The Claude parser reads Claude Code's own stream-json (S6g): `Read`, `Write`, `Edit`, `MultiEdit` and `NotebookEdit` touch `file_path` or `notebook_path`, `Glob` and `Grep` touch a folder, `LS` lists one, and `Bash` reads its command. A `Task` or `Agent` tool call starts the child as `PARENT~N`, every later line whose `parent_tool_use_id` is that call's id carries the child's key so the child has its own tool calls and strip. A failed Task or Agent `tool_result` ends the child; a successful foreground Task result ends it, and a successful foreground Agent result ends it only after child output was seen, while a background launch result leaves it working. The AGY parser shows a child while it works, from what a real AGY run sends (S5, run `ffd660e6` on 2026-10-24): an `invoke_subagent` tool step (`Role` is the child's name) starts it as `PARENT~N`, labelled with the `initial_prompt` its `DONE` step carries in `subagent_info`, and it ends when a `manage_subagents` list shows it idle, or with the parent's `run.end`. A new child tool call reopens its lifecycle, so a later idle ends it again. The live session reader also sends the child's transcript steps, which give it its own tool calls and strip. This AGY's file tools are `read_file`, `write_file` and `edit_file` (with `Path`), beside the older names. `scenario-g` is that real run, masked; S4's rule (a second `conversation_id` in one run is a child) stays, tested by the hand-written `scenario-f`, though the real AGY never sent one. `state.js` adds a child to the roster with `parent` and `depth`, up to the saved limit: a live room reads `client.agentDepth?.()` at start and on each `agents` notice and passes it to the state (`setDepthLimit`), 3 without the method and 4 at most, and the parent's `run.end` ends its children still working. The engine adds a view for a child when it appears (S2d): the next spare shape at 0.35 of its parent's size (`CHILD_SCALE`), orbiting the parent on a circle of 1.6 times the parent's radius tilted a little off the hub plane, one turn in about 40 seconds with each sibling at its own phase (`childOrbit`, pure, tested), a short line to it that follows the child, and a chip titled `PARENT > NAME`; a child that has ended stays at full opacity for 6 seconds of wall time and then fades over 1.5 seconds (`childFade`, pure, tested; under reduced motion it goes at once after the 6 seconds and holds its place on the circle while it lives). The HUD lists a child under its parent, indented 16px a level, with a `subagent` tag (`.hud-agent-row.is-subagent`, `.agent-subagent`); the number keys pick top agents only.

A touch is `{path, mode, kind}`. `kind` is `file` or `dir`. `mode` is `read`, `write` or `list`. `path` is relative to the project root, and `''` is the root. When the live tree carries the project's full root path, an absolute path is inside only under that path, compared with the platform's rules, and is made relative to it. Any other absolute path is outside. A recording that carries only the root's name keeps the older name rule. When a `read`, `write` or `edit` calls `fileTouch` on an absolute path outside the project and outside `ctx.worktree` and `ctx.worktrees` (supplied by `pipeline.js`), `fileTouch` returns `outsidePath` masked through `maskProfilePaths` from `paths.js` and `toolStart` sets `outside: true` and `outsidePath` with `touches` empty (drawing no card and no tunnel); inside-project, relative and lane-worktree paths gain no new fields, and `state.js` tracks `outsideCount` and the last 20 distinct `{ path, kind }` entries newest first on each agent (rebuilt on seek, P339, P346).

## How each agent reports tool calls

| Agent | Adapter | Signal in `payload.chunk` |
| --- | --- | --- |
| Claude Code | `claude_local` | The older `acpx.tool_call` JSON lines, where the call name carries the path ("Read C:\...", "Edit src\math.js") or the command text for Terminal; or Claude Code's own stream-json `assistant` and `user` lines, where a `tool_use` item starts a call and a `tool_result` item ends it |
| Hermes | `hermes_local` | Plain lines such as `┊ 📖 read  strings.js  1.2s` and JSON `hermes: 'call'` / `'result'` lines from `state.db`; `mcp_` tool names that name a server and tool report as tool `mcp` with the label `mcp SERVER TOOL` (P746) |
| OpenCode | `opencode_local` | JSON lines `tool_use` with `part.tool` and `part.state.input` |
| agy | `process` | JSON lines `step_update`; `ACTIVE` starts a tool, `DONE` ends it |
| Codex | `codex_local` | JSON lines `item.started`, `item.completed` and `item.failed`; open calls end at flush with the `turn.completed` or `turn.failed` outcome when seen, otherwise success; `command_execution` runs a shell command, `file_change` touches a file, `web_search` reaches the web and `mcp_tool_call` is an MCP call, tool `mcp` with the label `mcp SERVER TOOL` (P746a) |
| GitHub Copilot | `copilot_local` | JSON tool events (`tool.execution_start`, `tool_call`, `tool_use` and their completion events) with the tool name and arguments, and a plain-text fallback for shell, read, write, edit and web lines |
| ACP | `acp_local` | JSON lines whose `session/update` carries a `tool_call` or `tool_call_update`, with the call's kind and input |
| MachineRoom | `machineroom_local` | Claude Code's stream-json lines, read by the same parser, from `scripts/mr-agent.mjs` |

A shell command touches files only when its text names a known file or folder. See `commands.js` and its tests.

A web search or fetch becomes tool `web` with no touches, and its label holds the query or URL: Claude Code's `WebSearch` and `WebFetch`, OpenCode's `websearch` and `webfetch`, agy's `search_web` and `read_url_content`, Hermes's `search` and `fetch` lines (`fetch` is its `web_extract`, which prints only the domain), Codex's `web_search`, GitHub Copilot's web tool and plain-text web lines, and MachineRoom's `web_search` and `web_fetch` (while ACP `fetch` maps to `other`).

## DOM contract for terminals and cards

`engine/terminals.js`, `engine/agents.js` (the callout) and `engine/cards.js` build, and the stylesheet styles, these structures:

```
.mr-term.is-{idle|queued|working|error|done}[.is-open][.is-muted]
  .mr-term-title
  .mr-term-body
    .mr-line.is-{normal|dim|error|done}

.mr-callout.is-{working|error|done}[.is-address]
  .mr-callout-title
  .mr-callout-task
  .mr-callout-cmd
  .mr-callout-console[hidden]
    .mr-term-console-link[hidden]
    .mr-callout-console-body
      .mr-callout-console-line.is-{normal|dim|error|done}

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
