# Where the room gets its events

Written 2026-10-24 by Claude, after the real AGY subagent run (run `ffd660e6`). Updated at 0.1.260: S6a, S6b and S7 are built, and Paperclip is optional. The rest is still a plan. It answers two questions from the owner: what Paperclip costs us, and whether a direct source would remove those costs quickly.

## The goal

The room is a control panel for the owner's subscriptions, efficiency first and looks second: watch every harness and its subagents work, find the bug, and run them the way Claude runs the lanes today (five OpenCode lanes and the Claude Code lane), with the room growing on top of itself. Browser use, file exploration and document viewing belong in it.

## What Paperclip costs us

Each row is something we built or hit only because the events come through Paperclip.

| Cost | What we built or saw | Gone with a direct source? |
| --- | --- | --- |
| The live socket cuts a log chunk to its last 8192 characters | the bridge rereads the full chunk from `/api/heartbeat-runs/:id/log`, in order, with retries; the proxy route still loses such calls | Yes: we own the pipe and read whole lines |
| The routes change between versions | `server/surface.js` (29 routes, 443 lines), `npm run doctor`, the six feature switches and the 503 answers, the version read before and after the spec | Yes for the room's events; still needed for whatever we keep calling in Paperclip |
| The `process` adapter runs a fixed command | AGY's prompt lives in its Paperclip setup, so a task's text never reaches it; the subagent test had to change that setup and restore it | Yes: the runner passes the brief as the prompt, as `run-lane` does for OpenCode |
| Only stdout reaches the stream | nothing; AGY's subagent steps go to a transcript file and never reach the room | Partly: the runner runs on this machine and can read the child's transcript, with the owner's yes, since it sits under the home folder |
| Paperclip's REST refuses a cross-origin page | the Vite proxy and the bridge | No: the bridge stays as the page's one door |
| A key can be split across two chunks | `createSplitMasker`, the 1 second hold, the seq gap reset | No: any stream needs masking, but our own runner cuts at line ends, so splits get rare |
| Backups work only in `local_trusted` mode, with no token | the Backups section and its warnings | Stays while Paperclip holds the tasks |
| Paperclip's own work shows up as load | the owner saw `workspace_git_scan` every 100 ms on 2026-10-24, from Paperclip, not from us | Yes for runs that do not go through Paperclip |

The heavy ones for monitoring are the first four. They are why a run can look quiet in the room while the harness is busy: a cut chunk, a renamed tool, or a child that only writes to its own file.

One cost a source change does not touch: each harness reports what it reports. OpenCode and Hermes name a child only when it ends; this AGY renamed its file tools to `read_file`, `write_file` and `edit_file` and puts a child behind an `invoke_subagent` tool. The parsers have to follow each harness, whatever carries the bytes (brief S5).

## What a direct source looks like

Most of it exists already.

- `npm run run-lane` starts a lane, writes its JSON log to `%TEMP%\machineroom-runs\<lane>-<brief>-<stamp>.log`, records the run in `runs.jsonl`, the outcome in `outcomes.jsonl`, and costs per lane and model (`--stats`).
- `framesFromRun` in `src/briefs/recording.js` already turns a finished OpenCode, Hermes or Claude Code lane log into Paperclip-shaped frames (`heartbeat.run.queued`, `status`, `log`), which is how `/?recording=` replays a lane run.
- The pipeline, the parsers, the state and the engine read those frames as they are.

So a live lane source is the bridge watching the runs folder and feeding the same frames as each log grows, instead of after the run. The page does not change.

## The order of work

1. S6a, the live lane source. A bridge module that watches the runs folder, tails each new lane log from its first byte, and sends frames built the way `framesFromRun` builds them, with the lane as the agent (`opencode` to `opencode5` and `claude` from `lanes.json`). Paperclip stays a second source on the same stream. Tests on a fake log that grows. One OpenCode brief. Built as 0.1.233.
2. S6b, AGY as a run-lane lane. A `cli` block for `agy` in `lanes.json` (`agy --print <prompt> --output-format stream-json --dangerously-skip-permissions`, in the lane's worktree), so `run-lane` passes the brief as the prompt and AGY stops being a lane run by hand. Needs the owner's yes, since AGY then runs unattended like the OpenCode lanes. Small. Built as 0.1.236; AGY is retired now.
3. S6c, AGY's children from their transcripts. When `invoke_subagent` names a child's `conversation_id`, the runner reads that child's transcript file as it grows and sends its steps under the child's key, so the child gets its own strip. Needs the owner's yes to read under the home folder. One brief after S5.
4. S6d, Claude Code as a source. Claude Code hooks around each tool call and around subagents, written as JSON lines to a file the bridge tails, give the most exact live subagent events of any harness we use. Only for Claude Code runs. One brief, and a check of which hook events this Claude Code version offers.
5. ACP for the harnesses that speak it. See the next section.

## The owner's own sessions (S7, built)

`--sessions` follows the owner's own sessions on the room's project, read only. Claude Code sessions come from `.claude/projects/<slug>/<sessionId>.jsonl` under the home folder, plus a subagent's file under `<sessionId>/subagents`. OpenCode sessions come from `opencode.db` in OpenCode's data folder, opened read-only; the reader queries only `session_v2` and `session_message`, never the tables that hold accounts and keys. A session that `run-lane` started is skipped, so the room does not show a run twice. Only tool calls and their results reach the room, never the prompts or the replies. S7a and S7b are merged as 0.1.255 and 0.1.256.

## ACP, checked 2026-10-24

The Agent Client Protocol is JSON-RPC over the agent's stdin and stdout. The client starts the agent, opens a session, sends the prompt, and gets `session/update` notifications. A `tool_call` carries a `kind` (read, edit, delete, move, search, execute, think, fetch, switch_mode, other), a `status` (pending, in_progress, completed, failed) and `locations`, a list of absolute paths with an optional line. That is the touch the room needs, in one shape for every harness, instead of a parser per harness that breaks when a tool is renamed (as AGY's did). A draft RFD, behind an `unstable_subagents` flag, exposes each subagent as its own session linked to its parent, with its own tool calls on the same connection: the live child the owner asked for, once agents ship it.

The cost: `run-lane` becomes an ACP client instead of reading stdout. It has to answer the agent's permission requests (by the lane's policy) and may serve file reads if it says it can. More work than piping a log, but it also gives control: cancel, and a session the runner owns.

| Harness | ACP | Checked how | Worth it |
| --- | --- | --- | --- |
| OpenCode | built in, `opencode acp` | its `--help` on this machine; on the ACP agent list | High: the five lanes run on it |
| Claude Code | through Zed's adapter `claude-agent-acp`; no ACP command of its own | `claude --help` shows only `stream-json`; the ACP list names "Claude Agent" via that adapter | Medium: hooks or `stream-json` already give exact events |
| Hermes | built in, `hermes acp` | its `--help`; on the list | Low: the owner may retire it |
| Pi | through the `pi-acp` adapter | on the list; not installed here | Low until Pi is installed |
| AGY | none | no `acp` in `agy --help`; not on the list | None: keep the stream-json parser (S5) |
| DeepSeek Harness (`dsh`) | built in: `dsh --profile acp` starts `@deepseek-ai/dsh-acp`, a standard ACP v1 server for programs (sessions, model and effort, cancel, semantic updates); DSH also runs its own subagents out of process over ACP (`dsh-subagent-acp`) | the package README in `deepseek-ai/deepseek-harness` (`packages/acp/acp`); not installed here (`npx @deepseek-ai/dsh`, Node 22.19 or later); a developer preview that warns of breaking changes | High: ACP is its native control surface, and its subagents are ACP sessions already |

**Results, 2026-10-24.** `scripts/acp-probe.mjs` ran OpenCode 2.0.32 over `opencode acp` on `opencode-go/deepseek-v4.1-flash`. ACP has no model flag: `session/new` returns `configOptions` for the model, the effort (default, low to max) and the mode (build, plan), and the client sets the model with `session/set_config_option` and `configId: "model"`. The one prompt read `src/math.js` and `src/strings.js`, wrote `docs/acp-note.md`, and started one subagent that read `test/strings.test.js`; the prompt took 9.7 seconds. A `tool_call` starts with `name`, `title`, `kind` and `status: "pending"`, with empty `locations` and `rawInput`; the next `tool_call_update` adds `locations` (absolute paths, no `line` here) and `rawInput` (the parent's path is relative, the child's is absolute), and the completion adds `content` and `rawOutput`. The kinds were `read`, `edit` for the write, and `think` for the subagent. The subagent is a tool call named `subagent`, not its own ACP session: its updates arrive in the parent session with `_meta["opencode/child-session"]` (id, parentID, depth, title), and its tool call id starts with its session id. No `subagent_update`, no `session_message` and no permission request came, so the permission shape is still unseen. The room's stdout parser gets one line at the end of each call, a relative input path and the shell output text that `looksFailed` reads; ACP gives a real start, the child's calls while it works, and reports failure as `status: "failed"` rather than a text marker (not seen here), but its paths are absolute and its updates are partial, so a reader must keep a call per `toolCallId`.

Next step: an ACP source in `run-lane` for OpenCode, beside the stdout source of S6a.

Sources: [DeepSeek Harness ACP package](https://github.com/deepseek-ai/deepseek-harness/blob/main/packages/acp/acp/README.md), [ACP agents](https://agentclientprotocol.com/get-started/agents.md), [tool calls](https://agentclientprotocol.com/protocol/v1/tool-calls.md), [subagent sessions RFD](https://agentclientprotocol.com/rfds/subagents.md), [v2 draft](https://agentclientprotocol.com/announcements/acp-v2-draft).

S6a and S6b remove the first and third costs for lane runs at once, and leave Paperclip untouched for whoever still uses it.

## What stays with Paperclip, or moves

Paperclip still gives tasks, threads, approvals, budgets and backups. For the lanes, `run-lane`, `runs.jsonl`, `outcomes.jsonl`, `--stats` and the routing policy (`src/policy/`) do the same jobs on our side. The drawer now reads tasks, live runs and costs from the lane records when Paperclip does not answer (L1, L2); approvals are empty in that mode, and backups stay with Paperclip. Nothing in this note removes the optional Paperclip source.

## The bigger room

What the owner named beyond events, each driven by the same tool events:

- Browser use: AGY lists 23 `browser_` tools in its init line. A browser call can be its own touch kind, shown as a card for the page with its address.
- File exploration: the folder cards are this already; a click on a row could open the file read only through the bridge, inside the project folder only.
- Document and PDF viewing: the same read only route, shown in a panel beside the room.

Each is a brief of its own after S6a, and none needs Paperclip.
