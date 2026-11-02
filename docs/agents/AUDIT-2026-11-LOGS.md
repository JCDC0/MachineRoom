# Real run logs through the parsers, November 2026

Date: 2026-11-03
Version: 0.1.401
Branch: `feat/q30-bug-hunt-real`
Brief: Task Q30
Author: OpenCode 6

## Scope and method

The runs folder (`MACHINEROOM_RUNS`, else `%TEMP%\machineroom-runs`) held 464 logs on 2026-11-03. I copied the logs and `runs.jsonl` to a temporary folder outside the repository, so the counts below do not move while other lanes write new logs.

A throwaway script outside the repository did this for each log:

1. Read the record from `runs.jsonl` by the log name, for `exitCode`, `killed` and `minutes`.
2. Fed every line through `createRunLineReader(harness)` from `src/briefs/recording.js`, the same reader `server/lanes-source.js` uses.
3. Built the frames the lane source builds: `heartbeat.run.queued`, `heartbeat.run.status` running, one `heartbeat.run.log` per line the reader marks read, then `succeeded` or `failed` from the record.
4. Rewrote the run's own worktree to the project root before the parse, as the lane source's rewriter does, then ran `pipeline.js`, `state.js` and `log.js`.
5. Compared the activities with the raw log: tool lines and states, result errors, subagent calls and touched paths.

The tree is the tracked files of this checkout plus every lane worktree that still exists. The numbers are sums over the runs. The newest 10 logs per harness sit beside all logs, and the timed-out AGY log the brief names is in both.

Limits: Claude has only 7 logs, 2 lane runs on another project and 5 orchestrator turns. There is no Claude lane run in this repository. 21 of the 464 logs are `--project` runs on another folder; 3 of the 529 unresolved OpenCode touches come from them, and the rest are files that have since been deleted or renamed.

## Counts per harness

| Scope | Logs | Lines | Tool calls in the log | Starts | Ends | `other` | Never ended |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| AGY, all | 49 | 30,744 | 7,735 | 7,735 | 7,699 | 1,372 | 36 |
| AGY, newest 10 | 10 | 5,496 | 1,237 | 1,237 | 1,228 | 217 | 9 |
| OpenCode, all | 371 | 90,044 | 34,202 | 34,202 | 34,202 | 28 | 0 |
| OpenCode, newest 10 | 10 | 2,209 | 838 | 838 | 838 | 1 | 0 |
| Claude, all | 7 | 135 | 20 | 20 | 20 | 1 | 0 |
| Claude, newest 10 | 7 | 135 | 20 | 20 | 20 | 1 | 0 |

| Scope | Unresolved touches | Worktree prefix | Read as write | Shell calls | Named files missed | Spawns | Unended children | Error calls | Error calls not failed | Status mismatch |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| AGY, all | 16 | 0 | 0 | 2,662 | 0 | 0 | 0 | 32 | 32 | 0 |
| AGY, newest 10 | 1 | 0 | 0 | 394 | 0 | 0 | 0 | 8 | 8 | 0 |
| OpenCode, all | 529 | 0 | 0 | 16,581 | 1 | 0 | 0 | 141 | 0 | 0 |
| OpenCode, newest 10 | 4 | 0 | 0 | 417 | 0 | 0 | 0 | 4 | 0 | 0 |
| Claude, all | 0 | 0 | 0 | 12 | 0 | 1 | 1 | 0 | 0 | 0 |
| Claude, newest 10 | 0 | 0 | 0 | 12 | 0 | 1 | 1 | 0 | 0 | 0 |

How to read the table:

- Starts and ends are `tool.start` and `tool.end` activities. The starts equal the tool calls in the log in all 464 logs.
- `other` is a started call whose kind is `other`. AGY has 1,254 task calls, 99 schedule calls and 19 MCP calls. OpenCode has 20 code-execution calls and 8 skill calls. Claude has 1 `Task` call.
- Never ended is a start with no end in the same run. AGY holds all 36, in 23 of 49 logs. 32 are `ERROR` steps. The other 4 are `ACTIVE` steps with no later line: 3 are in a run marked killed, and 1 is in a log with no record. One of the 4 is in the timed-out log the brief names.
- Unresolved touches are touched paths that do not exist in the tree after the worktree rewrite. They are old tests, probe scripts and 2 `.git/` scratch files, not paths with a wrong shape. 98 OpenCode logs and 8 AGY logs have one.
- Worktree prefix is measured after the live rewriter. In the raw text, 24,358 path mentions in 191 logs carry `.worktrees/<lane>/`, 24,302 on the run's own worktree and 56 on another lane's. The rewriter maps the run's own worktree to the root, and no parsed touch keeps the prefix.
- Read as write is a write touch from a read, search, web or MCP call. None in 55,901 touches.
- Named files missed is a path token in a shell command that exists in the project and is not in the call's touches. 1 in 19,255 shell calls, inside a PowerShell here-string.
- Error calls are raw `ERROR` steps for AGY, `status: error` for OpenCode and `is_error` results for Claude. AGY is the only harness that does not mark them failed.
- Status mismatch compares the root agent's final status with `exitCode === 0 && !killed`. There are 0 mismatches in the 448 logs that have a record. The other 16 logs have no record and end failed, as the bridge's `no record` rule does. AGY ends 41 done and 8 error, OpenCode 341 done and 30 error, Claude 6 done and 1 error.
- OpenCode's 1,086 failed ends are mostly shell calls marked failed from output text, not 1,086 error statuses. Finding 2 covers the read-only cases.
- The parse below reads every line whole. The live lane source drops a line over 1 MB (`server/lanes-source.js:19,487-490`), so 1 of the 34,202 OpenCode starts is not seen live. Finding 3 covers it; the recording path reads the whole line.

## Findings

### 1. An AGY error step never ends and is never marked failed

Severity: Medium.
Where: `src/model/parsers/agy.js:154-164`.

Shape of a line:

```
{"event":"step_update","step_update":{"step_type":"tool","tool_name":"…","state":"ERROR","tool_info":{"error":"…","parameters":{…}}}}
```

What goes wrong: the parser ends a call only when `step.state === 'DONE'`, and `doneOk` looks only at `tool_info.output` for a `run_command`. A step that ends `ERROR` returns at line 163 with no `tool.end`. There are 32 such steps in 22 of 49 AGY logs, and 0 of them end. With 4 calls left `ACTIVE` when their log stopped, 36 of 7,735 starts have no end. `state.js` never runs its failed branch, so the file is not left red, `log.js` prints no failed line, and the agent stays `working` until the run end.

Smallest fix: end on `DONE` or `ERROR`, set `ok` false when the state is `ERROR` or `tool_info.error` is present, and include that error in `entry.doneOk`.

### 2. A read-only command is marked failed when its output quotes a failure word

Severity: Medium.
Where: `src/model/parsers/common.js:4`, used at `src/model/parsers/agy.js:156` and `src/model/parsers/opencode.js:132`.

Shape: a shell call whose command only reads (`git diff <path>`, `Get-Content`, `Select-String`, `sed -n`), with a diff or source line that contains `FAIL`, `FAILED` or `Exception` after column 0.

What goes wrong: only the tick branch of `FAILURE` is anchored to a line start. The other branches match anywhere in the output, so a file that merely mentions a failure makes the command look failed. 22 read-only calls in 19 of 464 logs are marked this way. In one AGY log a `git diff docs/agents/ARCHITECTURE.md` call is marked failed and the file is left red with 14 reads and 0 writes, because `state.js` reddens every file the failed call named. The event log says `failed` for a command that succeeded.

Smallest fix: anchor every branch to a line start, as `(^|\n)\s*(✖|×)\s` already is, or test only the last few lines of the output.

### 3. A tool line over 1 MB is dropped by the live lane source

Severity: Low, but it loses a whole call.
Where: `server/lanes-source.js:19` and `:487-490`.

Shape: one `tool_use` line of 1,670,937 characters, a `read` whose `output` is a large file. The other 115 tool lines in that log are normal.

What goes wrong: `readNew` drops the partial buffer and sets `skipLine` when it passes `MAX_PARTIAL` (1 MB), so the line never reaches the parser. The read is not counted, the file does not light up, and the event log misses the call. The log then continues from the next newline, so the run looks complete. 1 line in 464 logs. `framesFromRun` has no such limit, so a recording of the same log shows the call.

Smallest fix: raise `MAX_PARTIAL` to 8 MB, which covers a line this size with a bound. A real chunked feed would also need `jsonLineReader` to join pieces, because it pushes one whole line at a time.

### 4. An OpenCode search never touches a folder

Severity: Low, but on 5.7 percent of OpenCode calls.
Where: `src/model/parsers/opencode.js:123-124`.

Shape of a line:

```
{"type":"tool_use","part":{"tool":"grep","state":{"status":"completed","input":{"pattern":"…","path":"…"}}}}
```

What goes wrong: the `search` branch sets a label and no touch, and the label prefers `pattern`, so the folder is never shown. There are 1,963 such calls with 0 touches. `agent.target` and `state.recent` do not move, the folder does not open, and the tunnel has nothing to point at. Claude's `Glob` and `Grep` emit a folder touch at `src/model/parsers/claude.js:137-142`.

Smallest fix: add a `dir` touch with mode `list` from `input.path`, as Claude's `folderTouch` does, and put the folder in the label.

### 5. An AGY MCP call is `other` and loses its server and tool name

Severity: Low.
Where: `src/model/parsers/agy.js:3-14` and `:56`.

Shape of a line:

```
{"event":"step_update","step_update":{"step_type":"tool","tool_name":"call_mcp_tool","tool_info":{"parameters":{"ServerName":"…","ToolName":"…","Arguments":{…}}}}}
```

What goes wrong: the tool is not in `TOOLS`, and the MCP label and path helpers live only in `claude.js` and `opencode.js`. All 19 calls are `other` and every label is the tool name alone, so the room cannot tell one MCP call from another. None of the 19 carries a file path, so no touch is lost in these logs, but an MCP tool that takes a path would lose it. The nested field is `Arguments` with a capital A, which `mcpPathOf` does not read.

Smallest fix: add the tool to `TOOLS` as `mcp`, move `mcpLabelOf` and `mcpPathOf` to `common.js`, and read `Arguments` as a nested object too.

### 6. AGY's task and schedule tools are `other`, 17.7 percent of its calls

Severity: Low.
Where: `src/model/parsers/agy.js:3-14` and `:59`.

Shape of a line:

```
{"event":"step_update","step_update":{"step_type":"tool","tool_name":"manage_task","state":"DONE","tool_info":{"parameters":{"Action":"…","TaskId":"…"}}}}
```

What goes wrong: 1,254 task calls and 99 schedule calls are `other`, so the event log and the console show a generic call. The label is the tool name alone, and the action, task id or wait time is lost. Together with the MCP calls, 1,372 of 7,735 AGY calls (17.7 percent) are `other`, and 42 of 49 logs have at least one.

Smallest fix: give both a kind (`plan` and `wait`) and a label from `Action`, `TaskId` or `DurationSeconds`. If a new kind is too much, at least keep the tool name and the action.

### 7. A harness that dies at startup leaves no cause in the room

Severity: Low.
Where: `src/harnesses/common.js:60-61` and `server/lanes-source.js:469-470`.

Shape: a log with no JSON at all, 6 plain text lines, the first an error line and the next five its stack frames.

What goes wrong: `read` is `activities.length > 0`, so a line no parser reads is never sent. The run is in the record with `exit 1` and no other detail, and the room shows `failed exit 1` with no message. One OpenCode log in 371 has this shape. Any plain text panic or harness error has the same fate.

Smallest fix: when a run ends failed, send the last unread lines as one `heartbeat.run.event` with level error, or keep them in the record.

### 8. A read of a folder becomes a missing file

Severity: Low.
Where: `src/model/parsers/opencode.js:111-118` and `src/model/state.js:86-97`.

Shape of a line:

```
{"type":"tool_use","part":{"tool":"read","state":{"status":"completed","input":{"path":"…\\src"}}}}
```

What goes wrong: a file tool always makes a file touch, even when the path is a folder. `ensureFile` adds it with `exists: false`, `missingFiles` goes up, and the room keeps a file entry named like a folder. 1 read in the OpenCode logs names a folder, and it completed, so the room still records a file that does not exist.

Smallest fix: when the resolved path is in `ctx.dirs`, emit a `dir` touch with mode `list` instead of a file touch.

### 9. A Claude subagent call is `other`

Severity: Low.
Where: `src/model/parsers/claude.js:163-167`.

Shape of a line:

```
{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Task","input":{"description":"…"}}]}}
```

What goes wrong: the `STREAM_TASKS` branch sets the label but leaves `kind` as `other`. The spawn call shows as `other`, and the cyan console opens above the agent for a task call. There is 1 such call in the logs, in the only Claude lane log that spawns a subagent.

Smallest fix: set a `task` kind on that branch.

## Seen again, not relisted

- C1, worktree paths. The raw logs hold 24,358 `.worktrees/<lane>/` path mentions in 191 logs. The live rewriter strips the run's own worktree, and 0 parsed touches keep the prefix. The recording path does not rewrite: `framesFromRun` keeps the raw chunk (`src/briefs/recording.js:103-111`) and `treeFile` sets the root to `MachineRoom`, so the 6 newest recordings keep 16 to 235 prefixed touches each (235 of 285, 137 of 201, 61 of 119, 39 of 88, 29 of 66, 16 of 51). The replay then makes a phantom missing file for each one. This is the C1 fault on another path and the C1 fix in `relativeTo` covers it, so it is not numbered again.
- C2, Claude subagent. 1 spawn and 1 child not ended. The log shows the parent's `tool_result` before the child's last line, so this child had made a tool call and still did not end. C2's smallest fix still covers it; the trigger is wider than "makes no tool call".
- C14, quoted pipes. 0 reads counted as writes in 55,901 touches, apart from the known split of a quoted `|`, which can leave a `>>>>>>>` conflict marker outside a quote and read as a redirect. No new case beyond C14.

## What was not reached

- No Claude lane run in this repository. The 2 Claude lane logs are `--project` runs on another folder, so the Claude parser's file touches, shell tools and subagents are barely exercised. The 5 orchestrator turns hold 20 tool calls between them.
- No AGY log has more than one `conversation_id`, and no log has an `invoke_subagent` step, so the AGY subagent path was not run.
- No OpenCode log has an MCP call, a `running` tool state or a masked broken tool line, so those paths were not run.
- I did not exercise a reopened run, an `orchestrator.message` frame, or two records for the same log. The line over 1 MB in finding 3 was the only line over that limit in the snapshot.
- I did not run `player.js`, a seek, the UI or the engine. The check stops at `log.js`.
- I did not run the test suite. No code changed, only this file.
- The runs folder is live. A later run sees more than 464 logs.
- Hermes has 37 logs and was left out, because the brief names Claude, OpenCode and AGY.
