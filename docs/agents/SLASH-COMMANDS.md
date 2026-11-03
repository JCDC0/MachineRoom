# Slash commands in headless harnesses

Probed in an isolated Git repository with `README.md`, `.claude/commands/hello.md`, and `.opencode/command/hello.md` (`Say hello and stop.`).

## Claude Code (`claude -p --output-format stream-json --verbose`)

| Topic | Behavior in headless `-p` mode |
| --- | --- |
| `/help` probe | Exits `0` in `num_turns: 0` (`$0`). Does not call the model. Prints `system/init`, a `<synthetic>` `assistant` message with `local_command_outcome: {"kind":"unavailable_headless"}` and text `"/help isn't available in this environment."`, then `result` with that same string. |
| `/hello` probe | Exits `0` in `num_turns: 1`. Expands `.claude/commands/hello.md` and sends it to the model. Prints `system/init` (listing `"hello"` in `slash_commands`), the model `assistant` reply (`"Hello."`), `rate_limit_event`, and `result` (`subtype: "success"`, `result: "Hello."`). |
| `/compact` probe | Handled as `local_command: "compact"` (`num_turns: 0`). On a new session, prints `system/status` (`"compacting"` then `compact_result: "failed"`, `compact_error: "Not enough messages to compact."`), synthetic `assistant`, and `result: "Not enough messages to compact."`. On a resumed session (`--resume <id>`), compacts in place and prints `system/status` (`compact_result: "success"`), `system/compact_boundary`, a synthetic summary `user` line, `<local-command-stdout>Compacted </local-command-stdout>`, and `result: ""` (which `server/orchestrator.js` treats as `EMPTY_REPLY`). |
| Commands a headless turn runs | Local `/compact` (when history exists), project and user custom commands (`commands/*.md`), project and user skills (`skills/*/SKILL.md`), and enabled plugin skills/commands, provided `-p` starts directly with `/`. |
| Ignored or sent as plain text | Unknown `/foo` names are sent to the model as plain text. Any `/...` command is also sent as plain text if `server/orchestrator.js` prepends a compact summary (`carried`) or batches multiple queued messages (`Owner: /...`). |
| Commands that fail or refuse | `/help` and terminal-only built-ins (`doctor`, `color`, `focus`, `reload-plugins`, `clear`, `config`, `model`, `mcp`, `resume`, `login`, `logout`) refuse with `local_command_outcome.kind: "unavailable_headless"`. `/compact` fails on a session with no prior turns. |
| Where custom commands and skills live | Project: `<repo>/.claude/commands/**/*.md` and `<repo>/.claude/skills/*/SKILL.md`. User: `C:\Users\<name>\.claude\commands\**\*.md`, `C:\Users\<name>\.claude\skills\*\SKILL.md`, and enabled plugins under `C:\Users\<name>\.claude\plugins\cache\**`. |
| Listing without starting a turn | The CLI has no standalone command-list flag; `slash_commands` and `skills` are only emitted in `system/init` after a turn starts. A program must scan the project and user `.claude/commands` and `.claude/skills` directories (and `C:\Users\<name>\.claude\settings.json` `enabledPlugins`) on disk. |
| JSON lines printed | `{"type":"system","subtype":"init","slash_commands":[...],"terminal_slash_commands":[...],"skills":[...]}` first (preceded by `system/status` on `/compact`), then `assistant` (or `system/compact_boundary` and `user` on `/compact`), optional `rate_limit_event`, and `{"type":"result","subtype":"success","result":"..."}`. |

## OpenCode (`opencode run --standalone --format json`)

| Topic | Behavior in headless `run` mode |
| --- | --- |
| `/help` probe | Exits `0`. `opencode run` sends `"/help"` as a plain user prompt. The model runs tool calls (`read`, `shell`, `skill`) and replies in `text` that `/help` arrived as plain text. |
| `/hello` probe | Exits `0`. `opencode run` does not expand `.opencode/command/hello.md`; it sends `"/hello"` as plain text. The model uses `glob` and `read` to inspect `.opencode/command/hello.md` and replies `"Hello!"`. |
| `/compact` probe | Exits `0` on both new and resumed (`--session <id>`) sessions. Sent to the model as plain text; the model replies that compaction is a client action and summarizes the turn in prose instead of compacting the session. |
| Commands a headless turn runs | None. `opencode run` calls `session.prompt`, not `session.command` (`/api/session/:sessionID/command`), `experimental.session.skill`, or `session.compact` (`/api/session/:sessionID/compact`). |
| Ignored or sent as plain text | Every message starting with `/` (`/help`, `/hello`, `/compact`, or any custom command) is sent to the model as literal user text. In addition, `server/orchestrator.js` prepends `instruction` on the first turn and `restarted` after a room restart. |
| Commands that fail | None fail at the CLI layer; `opencode run` exits `0` and hands the raw string to the model. |
| Where custom commands and skills live | Project: `<repo>/.opencode/{command,commands}/**/*.md`, `<repo>/.opencode/skills/{*.md,**/SKILL.md}`, `opencode.jsonc` `commands`, plus compatibility scan of `<repo>/.claude/skills` and `<repo>/.agents/skills`. User: `C:\Users\<name>\.config\opencode\{command,commands}\**\*.md`, `C:\Users\<name>\.config\opencode\skills\{*.md,**\SKILL.md}`, `C:\Users\<name>\.config\opencode\opencode.jsonc`, `C:\Users\<name>\.claude\skills`, and `C:\Users\<name>\.agents\skills`. |
| Listing without starting a turn | Scan the project and user command/skill folders and `opencode.jsonc` directly on disk (`opencode debug paths` and `opencode debug config` print the config roots without a turn; `opencode api --standalone command.list` and `skill.list` return `data: []` on a cold standalone process before the 100 ms watcher scan completes). |
| JSON lines printed | Standard turn stream only: `{"type":"step_start",...}`, zero or more `{"type":"tool_use",...}` and `{"type":"step_finish","part":{"reason":"tool-calls",...}}` lines, `{"type":"text","part":{"text":"..."}}`, and a final `{"type":"step_finish","part":{"reason":"stop",...}}`. |

## Recommended room design

1. Add `GET /api/orchestrator/commands` in `server/orchestrator.js` to list commands before any turn starts by merging room built-ins with a filesystem scan of the active harness's project and user command and skill folders (`.claude/{commands,skills}` for Claude Code; `.opencode/{command,commands,skills}`, `opencode.jsonc`, `.claude/skills`, and `.agents/skills` for OpenCode).
2. Show the merged list in `OrchestratorChat.jsx` when the draft starts with `/`, tagging each entry as `room`, `command`, or `skill` with its one-line frontmatter description.
3. Handle room-level commands in the room itself and never forward them to a headless turn:
   - `/compact` calls `POST /api/orchestrator/compact` (`orchestrator.compact()`), avoiding Claude Code's empty `result: ""` and OpenCode's plain-text fallback.
   - `/new` and `/clear` call `POST /api/orchestrator/new` (`orchestrator.reset()`) to start a fresh session.
   - `/stop` calls `POST /api/orchestrator/stop`, `/model <id>` updates the selected model, and `/help` renders the available slash commands locally in the chat transcript.
4. Handle custom commands and skills in `server/orchestrator.js` when a user sends `/<name> [args]`:
   - Resolve `<name>` against the scanned command and skill files for the active harness.
   - Expand the markdown body on the server (substituting `$ARGUMENTS` and positional `$1..$N`, or wrapping a `SKILL.md` body with its base directory) before building the prompt.
   - Pass the expanded text through the normal turn builder so custom commands work identically in OpenCode, in Claude Code, and on turns where `server/orchestrator.js` prepends `carried`, `instruction`, `restarted`, or `Owner:` batching.

The orchestrator checked this study on 2026-11-04 against the routes: a new conversation is `POST /api/orchestrator/sessions/new`, not `/api/orchestrator/new`, and the model and effort have their own confirmed routes (`/api/orchestrator/model`, `/api/orchestrator/effort`). Brief U125 builds the list, the room commands and the server-side expansion of custom commands and skills.
