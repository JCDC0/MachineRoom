# Co-orchestrator review 8: U166, U167, S47 and S48

Date: 2026-11-09
Scope: `U166` (`2eb9c4e4`), `U167` (`e1082c3e`), `S47` (`93f8e52d`, fix `fdc86e1a`) and `S48` (`e530fe98`, fix `819fe0dd`).

## Findings

| # | Severity | File:line | The case and what goes wrong | Smallest fix |
| --- | --- | --- | --- | --- |
| 1 | High | `scripts/mr-agent.mjs:23-24, 159-162, 660-676, 772, 811` | `toolsForMode` narrows only the `tools` array sent to the model. `runTool` still dispatches `write_file`, `edit_file`, `run_shell` and `mcp_call_tool` by name, and the system prompt at line 23 still tells the model to write and run commands. A fake OpenAI-compatible endpoint, or a model that follows a prompt in a file, that answers a `write_file` call while `MACHINEROOM_PERMISSION_MODE=plan` writes the file, and a `run_shell` call while the mode is `edits` runs the command. Plan and Edits are therefore only enforced by the model's choice of tool, not by the agent. | In `runTool`, build the allowed names from `toolsForMode(PERMISSION_MODE)` and return an error for any other name before dispatch. Add a test with a plan response that names `write_file` and an edits response that names `run_shell`, and assert that the file is not created and the command does not run. |
| 2 | High | `scripts/mr-agent.mjs:137-149` | `AUTO_FORBIDDEN` tests the raw command and misses ordinary forms. `rm -f -r build` splits the recursive flag; `GIT branch -D old` misses because the branch pattern has no `i`; `git -C . push` puts a global option before the subcommand; `git reset HEAD --hard` puts the option after the revision; `cmd /c rd /s /q build` uses the `rd` alias and a wrapper; `bash -c "shutdown -h now"` puts the command after a shell argument, where the start anchor does not see it. Each one runs in Auto mode because no pattern matches. | Normalize the command into shell segments, strip `cmd /c`, `bash -c` and similar wrappers, check `rm` flags as a set, allow Git global options before the subcommand, and cover `rd` and `erase`. Add a test for each case above. |
| 3 | Medium | `src/ui/Transport.jsx:134-135` | The new waiting word reads `main.approvals` only. With the main idle and a sub orchestrator holding an approval, the transport still says `idle` and the sub chip keeps its `working` tone. The only sign is the sub tab's card, so a sub approval can expire after 4 minutes with no waiting signal in the transport. | Compute `waiting` over `main` and `orchestratorAnswerList(orchestrators)`, and give a chip with `approvals` a waiting tone. Add a test with the main idle and a sub holding an approval, and assert the transport reads `waiting for you`. |

## Merge by merge

- `U166` (`2eb9c4e4`): Sound. `POST /api/teams/NAME/apply` and `POST /api/teams/copy` pass `keepHidden: false` (`server/teams.js:268,415`), and `ladderChange` skips the hidden-lane re-add (`server/orchestrators.js:603`). The apply test covers a team whose sub id matches an existing sub with a hidden lane. The music readout uses `elapsed` for the label and keeps `shownPosition` for the slider (`src/ui/MusicPlayer.jsx:185-186,228`), and the no-length test reads `1:05` while the slider stays at 0.
- `U167` (`e1082c3e`): Not sound. The mode picker and approval cards read the open tab's orchestrator and post its id (`src/ui/OrchestratorChat.jsx:245-260, 1023, 1072`), so a sub tab uses the sub's id, and both are left out on the Team tab, which has no single orchestrator. The transport waiting word is main only (finding 3).
- `S47` (`93f8e52d`, fix `fdc86e1a`): Not sound. The lists, route, save, new and old chat modes, harness change and Claude, OpenCode and AGY flags match the brief. The OpenCode plan fix adds `{ edit: 'deny', bash: 'deny' }` (`server/orchestrator.js:1290`). The native agent's Plan and Edits are only a tool-list filter (finding 1), and Auto's guard misses common command forms (finding 2).
- `S48` (`e530fe98`, fix `819fe0dd`): Sound. The token and Origin checks, held request, masking and 2000 character cut, 20 wait limit, Stop, turn end, bridge close, list fields, client and mock methods, the approve MCP server, the Claude manual mode and config merge and removal, and the native agent's four approval tools all match the brief. The brief says 10 minutes; `819fe0dd` makes it 4 minutes and the code and guide say 4, but the test title at `tests/approvals.test.js:211` still says ten minutes.

## Proposed briefs

U168. Enforce the permission mode at the tool call in the native agent and close the Auto guard's holes.
1. In `scripts/mr-agent.mjs`, before `runTool` dispatches a call, reject any name not in `toolsForMode(PERMISSION_MODE)`, so Plan and Edits cannot run `write_file`, `edit_file`, `run_shell` or `mcp_call_tool` from a model response that names them. Add a test with a fake endpoint that names `write_file` in Plan and `run_shell` in Edits, and asserts the file is not written and the command does not run.
2. In `scripts/mr-agent.mjs:137-149`, replace the raw `AUTO_FORBIDDEN` test with a normalized command check that catches split `rm` flags, Git global options before the subcommand, the missing `i` on the branch pattern, `rd` and `erase`, and a destructive command inside `cmd /c`, `bash -c` or a similar wrapper. Add a test for `rm -f -r build`, `GIT branch -D old`, `git -C . push`, `git reset HEAD --hard`, `cmd /c rd /s /q build` and `bash -c "shutdown -h now"`.
Files: `scripts/mr-agent.mjs`, `tests/mr-agent.test.js`.

U169. Show a sub orchestrator's waiting approval in the transport.
1. In `src/ui/Transport.jsx:134`, set `waiting` when the main or any entry in the `orchestrators` context has a non-empty `approvals` array, and give a sub chip with approvals a waiting tone in `src/ui/transportOrchestrators.js`. Add a test with the main idle and a sub holding an approval that the transport state reads `waiting for you`.
Files: `src/ui/Transport.jsx`, `src/ui/transportOrchestrators.js`, `tests/transport-orchestrators.test.js`.
