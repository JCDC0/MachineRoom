# OpenCode retirement map

Version 0.1.401, 2026-11-15. Written for P325. The owner removes OpenCode from the fleet after 2026-11-17. The lanes that stay are `codex` (GPT-6.1 Terra high), `agy` and `agy2` (Gemini 4 Hydrogen XHigh), the Claude Code lanes, and `native` and `native2` (MachineRoom's own harness on OpenRouter, DeepSeek V4.1 Flash only).

This file changes no code. It maps what depends on OpenCode now, and ends with the smallest ordered list that retires it from the fleet while keeping OpenCode support in the product.

## How the map was made

Command, run in this worktree:

```
git grep -n -i opencode -- . ':(exclude)docs/agents/TASKS.md' ':(exclude)docs/agents/CHANGELOG.md' ':(exclude)docs/agents/history/' ':(exclude)docs/agents/AUDIT-*'
```

4,088 hits in 245 files:

| Area | Hits | Files |
| --- | --- | --- |
| Fleet config (`docs/agents/lanes.json`, `docs/agents/policy.json`) | 121 | 2 |
| Docs (including `README.md` and `CONTRIBUTING.md`) | 160 | 31 |
| Tests and test fixtures | 3,483 | 154 |
| Product code (`server/`, `src/`, `scripts/`, `public/`, `package.json`, `bin/`, `.env.example`) | 324 | 58 |

The tests are the bulk. Most use OpenCode as a sample harness and keep passing while `docs/agents/lanes.json` still holds the lane entries. The few that read the real fleet are called out in Table C2.

## Table A: fleet config

`docs/agents/lanes.json` holds ten OpenCode lanes. `opencode` to `opencode7` are active. `opencode8` to `opencode10` are already retired. There are no `fallback` entries in `lanes.json` or `policy.json`, so the failover feature has no OpenCode backup to repoint.

| `file:line` | What it does today | Proposed replacement |
| --- | --- | --- |
| `docs/agents/lanes.json:43-64` | Lane `opencode`: OpenCode on `opencode-go/deepseek-v4.1-flash`, reasoning max, owns `server/**`, `scripts/**`, `src/control/**`, `src/assistant/**`, `src/decider/**` and the UI. Worktree `.worktrees\opencode`. | Add `"retired": true`. Move backend briefs to `agy`, `agy2`, `codex` or `native`. Move UI briefs to `codex` or `native`, because `agy` and `agy2` forbid UI design. |
| `docs/agents/lanes.json:65-86` | Lane `opencode2`, same role and model. | Retire. Backend work to `agy` and `native`. |
| `docs/agents/lanes.json:87-108` | Lane `opencode3`, same role and model. | Retire. Backend work to `agy2` and `native2`. |
| `docs/agents/lanes.json:109-130` | Lane `opencode4`, same role and model. | Retire. Backend work to `codex` and `native`. |
| `docs/agents/lanes.json:131-152` | Lane `opencode5`, same role and model. | Retire. Backend work to `native2` and `codex`. |
| `docs/agents/lanes.json:153-174` | Lane `opencode6`, active, but it sits on P103's old branch with 4 unmerged commits. | Retire. The owner decides whether to merge or drop the 4 commits before the worktree goes. |
| `docs/agents/lanes.json:175-197` | Lane `opencode7`, the Crouton Alpha Free trial lane. | Retire after this batch. The trial is over and the model does not join the fleet. |
| `docs/agents/lanes.json:198-266` | Lanes `opencode8` to `opencode10`, already `"retired": true`. | No change. They are the precedent for keeping a retired entry so old records and tests still resolve it. |
| `docs/agents/lanes.json:57-62`, `79-84`, `101-106`, `123-128`, `145-150`, `167-172`, `189-194`, `213-218`, `236-241`, `259-264` | The ten per-lane notes, including "Up to nine other OpenCode lanes" and the `cd` rule for each worktree. | Retire with the entries. A retired lane gets no prompt, so the notes stop reaching a model. |
| `docs/agents/lanes.json:277`, `301`, `325` | The `agy`, `agy2` and `agy3` role says "UI design and the look of the room belong to the OpenCode lanes." | Change to "belong to the `codex` and `native` lanes." |
| `docs/agents/policy.json:5-14` | Small tier: `opencode2`, `opencode3`, then `agy`. | Replace the two OpenCode choices with `codex` on `gpt-6.1-terra` at high, provider `codex`, and `native` on `OpenRouter/deepseek/deepseek-v4.1-flash-1017`, provider `openrouter`. Keep `agy`. |
| `docs/agents/policy.json:25-34` | Medium tier: `opencode`, `opencode4`, then `agy2`. | Replace with `codex` and `native2`. Keep `agy2`. |
| `docs/agents/policy.json:45-54` | Large tier: `opencode5`, `opencode`, then `owner`. | Replace with `codex` and `native2`. Keep `owner`. |
| `src/control/mock.js:305-326` | `MOCK_POLICY` is a copy of the real policy. `tests/policy-route.test.js:445-450` asserts the copy. | Change in the same commit as `policy.json`, or the test fails. |
| `docs/agents/policy.json:7`, `27`, `47` | Not an OpenCode hit: `agy` and `agy2` still name `gemini-3.8-flash-high`, while `lanes.json` names `gemini-4-hydrogen-xhigh`. | Fix while editing the policy. This is a stale fleet row, not an OpenCode dependency. |

`fallback` entries: none in `docs/agents/lanes.json` or `docs/agents/policy.json`. A made lane may name one in its own file; none does today. Nothing to repoint for OpenCode.

## Table B: docs

The docs fall into three groups. Product docs describe OpenCode support that stays. Forward-looking fleet docs tell the orchestrator or the owner to use OpenCode lanes and must change. Historical records stay as they are.

| `file:line` | What it does today | Proposed replacement or action |
| --- | --- | --- |
| `docs/agents/ORCHESTRATOR.md:16-17` | Fleet line names `opencode` to `opencode5` and `opencode7`; says the Go plan ends on 2026-11-17. | Name the fleet that stays: `agy`, `agy2`, `codex`, `native`, `native2`, `claude`, and say OpenCode is retired. |
| `docs/agents/ORCHESTRATOR.md:33` | Never start OpenCode by hand; only `run-lane` or the room starts it. | Keep for the owner's own OpenCode use, or drop from the fleet guide. It does not start a lane. |
| `docs/agents/ORCHESTRATOR.md:46` | Keep `opencode` to `opencode5` busy; five lanes at once is the default. | Keep the five-lane default but name `agy`, `agy2`, `codex`, `native` and `native2`. The 27 percent measurement came from OpenCode runs and needs a new number. |
| `docs/agents/ORCHESTRATOR.md:48` | An OpenCode lane reviews each merged batch. | Give the review to `native` or `native2`, which the lanes file says suit reviews and hunts. |
| `docs/agents/ORCHESTRATOR.md:59` | Session start checks for any `opencode` process and the owner's service. | Keep only as a check for the owner's own service. Remove it from the lane check after the last OpenCode run. |
| `docs/agents/ORCHESTRATOR.md:142` | Step 8 says an OpenCode lane reviews the merged batch. | `native` or `native2`. |
| `docs/agents/ORCHESTRATOR.md:152` | "A usual OpenCode run ends in about 13 minutes." | Reword to a lane run, or measure a `native` run before keeping the number. |
| `docs/agents/ORCHESTRATOR.md:168` | Give reviews, full suites and hunts to an OpenCode lane. | `native` or `native2`. |
| `docs/agents/ORCHESTRATOR.md:178` | When an AGY run stalls, give the brief to OpenCode. | Give it to `native` or `codex`. |
| `docs/agents/ORCHESTRATOR.md:179-180` | Troubleshooting for an OpenCode session that keeps writing, and the worktree switch it caused. | Move to the product guide for owners who still run OpenCode, or drop it from the fleet guide after the last run. |
| `docs/agents/ORCHESTRATOR.md:210` | Who-owns table row for `opencode` to `opencode5`, with `server/**`, `scripts/**`, `src/**` and tests. | Replace with rows for `codex`, `agy`, `agy2`, `native` and `native2` and the paths each owns. |
| `docs/agents/ORCHESTRATOR.md:213` | AGY row says a Flash run takes twice as long as an OpenCode run. | Drop the OpenCode comparison or measure against `native`. |
| `docs/agents/ORCHESTRATOR.md:214` | Row for `opencode6` and `opencode7`. | Delete the row. |
| `docs/agents/ORCHESTRATOR.md:216` | Retired row lists `opencode8` to `opencode10` and `hermes`. | Add `opencode` to `opencode7`. |
| `docs/agents/ORCHESTRATOR.md:238` | Test lesson: a fake runner does not prove a command starts; `opencode` is an npm shim. | Keep the lesson, or change the example to another harness. OpenCode support stays, so the example is still true. |
| `docs/agents/ORCHESTRATOR.md:260` | "An OpenCode lane's shell starts in the main checkout." | Reword to "A lane's shell may start in the main checkout" and keep the clean-check rule. |
| `docs/agents/OWNER.md:36` | Tell the owner to give reviews, full suites and hunts to an OpenCode lane. | `native` or `native2`. |
| `docs/agents/CONTRIBUTING.md:67` | Lists `opencode` to `opencode5`, `opencode6` and `opencode7` as live lanes. | List the lanes that stay, and say OpenCode is retired. |
| `docs/agents/CONTRIBUTING.md:74` | Example `npm run run-lane -- opencode <brief>`. | Use `claude` or `codex`. |
| `docs/agents/ORCHESTRATOR-AGENT.md:30-39` | Examples start lane `opencode3` through the bridge. | Use `agy2`, `native` or `codex`. |
| `docs/agents/ORCHESTRATOR-AGENT.md:61` | Ladder example makes a sub with harness `opencode` and `opencode2`, `opencode3`. | Use `claude` for the sub, because `src/ui/ladderForm.js:52` only accepts `claude` or `opencode` today, and use staying lanes for the coder pool. |
| `docs/agents/TRIAL-LOWBEAM.md:66` | Tells the owner to add code lanes `codex` and `opencode2` to Lowbeam. | Add `codex` and `native`. |
| `docs/agents/TRIAL-LOWBEAM.md:16` | Status row for an old OpenCode worktree. | Historical. No change. |
| `docs/agents/HARNESSES.md:3` | Says "The room runs on OpenCode and Claude Code for now." | Say the room runs whatever `lanes.json` names, including Codex and the native agent. |
| `docs/agents/HARNESSES.md:21`, `35`, `42`, `47`, `49`, `51` | Describes the sessions reader, the ACP path, the model list, MCP, and an OpenCode-over-ACP example. | Keep. This is product capability. A user can still add an OpenCode lane or run it over ACP. |
| `docs/agents/HIERARCHY.md:7` | "With ten OpenCode lanes, one orchestrator cannot keep them all busy." | Reword to the current fleet size, or mark the sentence as the 2026 reason for the ladder. |
| `docs/agents/HIERARCHY.md:27-29` | Ladder example uses `opencode`, `opencode2`, `opencode3`. | Use staying lanes, and `claude` for the sub unless the ladder form is widened. |
| `docs/agents/HIERARCHY.md:76` | Says context use is read from Claude Code and OpenCode turns. | Keep. Product support stays. |
| `docs/agents/CONTROL-PLANE.md:42` | Harness list includes OpenCode. | Keep as product design. |
| `docs/agents/CONTROL-PLANE.md:136`, `141`, `162-163` | 2026-10 plan and measurements for running OpenCode agents, including free OpenCode models. | Mark the OpenCode cost and free-model rows as historical. Do not use them to plan the new fleet. |
| `docs/agents/CONTROL-PLANE.md:210`, `231` | OpenCode routing example and model comparison. | Historical. No change. |
| `docs/agents/SLASH-COMMANDS.md:3`, `19-30`, `35`, `38`, `44` | Probe of what OpenCode and Claude Code do with slash commands in a headless turn, and the design that follows. | Keep. It is product support for users who still run OpenCode. |
| `docs/agents/RECORDING.md:18-19` | Notes that OpenCode and Hermes refuse a folder that is not a git repository, and a model region limit. | Keep. A user can still record an OpenCode run. |
| `docs/agents/CANDIDATE.md:8` | Example `npm run candidate -- opencode`. | Use `codex` or `claude`. |
| `docs/agents/PLAN.md:7`, `11`, `15`, `16`, `25` | Product scope: live lane runs, sessions, orchestrator chat, MCP for Claude Code and OpenCode. | Keep. These describe the product, not this fleet. |
| `docs/agents/PLAN.md:32-46`, `86-128`, `171` | Historical run records and past plans that name OpenCode lanes and models. | Keep as history. Do not rewrite what happened. |
| `docs/agents/ARCHITECTURE.md:3` | Product summary names Claude Code and OpenCode sessions. | Keep. |
| `docs/agents/ARCHITECTURE.md:102` | History of who held the orchestrator role, including OpenCode from 0.1.163. | Keep. |
| `docs/agents/HOUSE-RULES.md:7` | Product summary names OpenCode sessions. | Keep. |
| `docs/agents/FLAKY-2026-11.md:7`, `20-21` | Flake records name an OpenCode test and lane. | Keep as history. The test names may stay after the fleet retires. |
| `docs/agents/PLAN-CODEX-2026-11-12.md:11`, `17` | A task table whose owner column says OpenCode. | Keep as history. |
| `docs/agents/RUN-2026-11-13-COMMANDS.md:3`, `25`, `RUN-2026-11-13-FIRST-USE.md:3`, `21`, `23`, `RUN-2026-11-13-FRESH-CLONE.md:71`, `90`, `118`, `RUN-2026-11-13-HANDS-ON-2.md:20`, `RUN-2026-11-13-SUITE-2.md:16` | Frozen command and first-use records, with OpenCode lane and session examples. | Keep as history. |
| `docs/agents/TRIAL-ULOLTRIS.md:10`, `43`, `119`, `133` | Warnings about existing `.worktrees/opencode` folders in the ulolTris project. | Keep until those worktrees are removed. They are not this fleet. |
| `README.md:17`, `27`, `102`, `125` | Product docs: watch OpenCode sessions, install OpenCode, list the OpenCode session, link the OpenCode build lane. | Keep. OpenCode support stays. |
| `docs/GUIDE.md:46`, `69`, `169`, `200`, `216-217`, `229`, `234`, `287`, `289`, `302`, `304`, `347` | Product guide: sessions, MCP, lane examples, assistant route, doctor, parser table. | Keep. These are user-facing features. |
| `docs/agents/architecture/CODE.md:15`, `28-29`, `54`, `69`, `71`, `77`, `128`, `135`, `159`, `195`, `233`, `299`, `319`, `354`, `357-358`, `414` | File inventory and test list for the OpenCode harness, parser, sessions, assistant and fixtures. | Keep. The code stays. |
| `docs/agents/architecture/LIVE.md:12-15`, `17`, `29` | Live lane and session sources, permission modes, conversation read, and the code list, including `server/opencode-sessions.js`. | Keep. Product behaviour is unchanged. |
| `docs/agents/architecture/ROOM.md:15`, `40`, `45`, `53` | Room behaviour: session at the top, the OpenCode shape, orchestrator chat, MCP settings. | Keep. |
| `docs/agents/architecture/ACTIVITIES.md:21`, `31`, `36` | Parser behaviour for OpenCode tool lines, subagents and web tools. | Keep. |
| `docs/agents/architecture/COMMANDS.md:18`, `27` | `run-lane` and `candidate` examples use `opencode`. | Keep the commands. The examples can use a staying lane in a later docs pass. |
| `docs/agents/architecture/DOCUMENTS.md:104` | Lists `SLASH-COMMANDS.md` as current. | Keep. |
| `docs/agents/architecture/LIMITS.md:20` | Historical measurement taken in the opencode3 worktree. | Keep as history. |

## Table C: product code

For each row, "loses" is what a user who still runs OpenCode would lose if the code were removed. Every row is `keep` unless it only serves this fleet.

| `file:line` | What it does today | What a user loses | Verdict |
| --- | --- | --- | --- |
| `src/harnesses/opencode.js:1-130` | Browser descriptor: command, parser, reply, failure, quota, usage, MCP config, default program, commit author. | A user cannot start or read an OpenCode lane. The room loses its reply, failure, rate-limit and cost detection. | keep |
| `src/harnesses/index.js:8-12` | Registers the descriptor and puts OpenCode third in the owner order. | The harness picker no longer offers OpenCode. | keep |
| `src/model/parsers/opencode.js:1-72` | Parses OpenCode JSON lines into tool calls, files, shells, subagents, web tools and MCP calls. | Recordings and live OpenCode logs stop drawing work. | keep |
| `src/model/parsers/unreadable.js:3-63` | Recovers cut OpenCode tool lines and counts unreadable lines per parser. | Cut OpenCode lines are dropped instead of recovered. | keep |
| `src/model/conversation.js:10`, `66`, `93-96`, `123` | Reads an OpenCode log into prompt, text, tool, result and line entries. | The conversation view for an OpenCode run is empty. | keep |
| `src/model/laneStarter.js:3` | Maps OpenCode to the `opencode-session` key so a session can sit at the top of the hub. | The room cannot show which OpenCode session started a lane. | keep |
| `src/model/scaleTree.js:17` | Sample agent list for the scale probe uses an OpenCode agent. | Only the scale probe's sample data changes. | keep |
| `src/control/modes.js:14`, `22` | Lists Plan, Edits and Auto for OpenCode and its legacy default. | An OpenCode orchestrator loses its permission modes. | keep |
| `src/control/mock.js:119-2221` (68 hits) | Demo lanes, issues, runs, costs, models, ladder and chat. `MOCK_POLICY` at 305-326 mirrors the real policy. | The browser demo no longer shows OpenCode, and its policy copy drifts. | keep, but update `MOCK_POLICY` with Table A |
| `src/Stage.jsx:64` | Demo ladder uses lane `opencode`. | The replay demo names a lane a new user may not have. | keep, update the example when convenient |
| `src/ui/FamilyTree.jsx:135`, `1215-1218` | New lane and sub drafts default to the OpenCode harness. | A new lane still defaults to OpenCode. | keep, this is a product default |
| `src/ui/family.js:13`, `346-352`, `539-540`, `587` | Prefers OpenCode and `opencode-go/deepseek-v4.1-flash` when offering child harnesses and teams. | The Agents tab still puts OpenCode first. | keep, this is a product default |
| `src/ui/ladderForm.js:52` | A sub orchestrator may only be `claude` or `opencode`. | A user cannot make a Codex or native sub. This is the product limit that keeps OpenCode in the ladder form. | keep; use `claude` subs in this fleet |
| `src/ui/orchestratorChat.js:20` | OpenCode counts as a subscription harness for a start confirm. | The start confirm loses its OpenCode wording. | keep |
| `src/ui/Waiting.jsx:7-9` | Labels the OpenCode session reader and orders it after Claude Code. | The waiting card no longer names the OpenCode session. | keep |
| `src/ui/agentStrip.js:8` | OpenCode effort levels. | The lane form loses OpenCode efforts. | keep |
| `src/ui/panels/briefs.js:59` | Owner label `opencode` for old briefs. | Old briefs show the raw key instead of `OpenCode`. | keep |
| `src/assistant/intent.js:21` | Help line includes "configure opencode". | The assistant help loses one example. | keep |
| `src/briefs/run.js:773`, `1022` | Builds OpenCode MCP config and picks its reply reader. | OpenCode lanes lose MCP tools and replies. | keep |
| `src/briefs/audit.js:16` | Allows `noreply@opencode.ai` as a commit e-mail. | `npm run history-audit` flags real OpenCode commits. | keep |
| `src/briefs/queue.js:114` | Error example says "for example opencode". | Only the example text changes. | keep |
| `src/engine/shapes.js:3` | Picks the stellated solid for OpenCode. | The room draws a fallback shape for OpenCode agents. | keep |
| `server/harnesses/opencode.js:1-6` | Node half with the sessions reader. | The bridge cannot follow OpenCode sessions. | keep |
| `server/harnesses/index.js:3-5` | Registers the Node half. | The sessions source has no OpenCode reader. | keep |
| `server/opencode-sessions.js:15-539` | Reads the two session tables in `opencode.db`, read only, and turns tool calls into frames. | The room loses the owner's live OpenCode sessions. | keep |
| `server/orchestrator.js:99`, `120`, `683`, `722`, `961`, `1807-1883`, `2036-2040`, `2355-2509` (35 hits) | OpenCode orchestrator and sub support: effort levels, default model, `.opencode` command and skill folders, session id, log command, MCP config, context tokens, session resume, transcript. | An OpenCode orchestrator loses its turns, context use, autocompact, slash commands and session resume. | keep |
| `server/orchestrators.js:316` | Fallback model for an OpenCode sub. | A sub with no model cannot fall back to a sensible OpenCode model. | keep |
| `server/agents-config.js:15`, `19`, `29` | Lists OpenCode in `HARNESS_KEYS`, labels it and gives its efforts. | `/api/harnesses`, the Agents tab and model validation lose OpenCode. | keep |
| `server/harness-models.js:14`, `281`, `379-386` | Parses `opencode models` and validates its ids. | The model picker cannot refresh OpenCode models. | keep |
| `server/model-list.js:4-6`, `14` | Static OpenCode model ids. | The picker loses the free and Go OpenCode models. | keep |
| `server/assistant.js:7`, `72-82`, `87-168` | `/api/assistant` runs local OpenCode; `DEFAULT_ASSISTANT_MODEL`, `OPENCODE_BIN` lookup and the `run --standalone` command. | The assistant route and its default model stop working. | keep |
| `server/control.js:23` | Maps `opencode_local` to the `variant` effort key. | A stored OpenCode lane loses its effort value in the projection. | keep |
| `server/family.js:257-258` | Defaults a sub with no harness to `opencode` and the Go model. | The family tree shows an OpenCode sub for an empty one. | keep; product default |
| `server/lanes-source.js:143` | A sub is OpenCode or Claude. | The family tree cannot draw another sub harness. | keep; use `claude` subs in this fleet |
| `scripts/run-lane.mjs:25`, `623-624`, `1546`, `1633`, `1751-1754`, `1810` | Reads `OPENCODE_SESSION_ID`, writes OpenCode MCP config, notes the PWD rule. | An OpenCode lane cannot start with MCP or be traced to its session. | keep |
| `scripts/mcp-bridge.mjs:9-11` | Re-exports the OpenCode MCP config builder. | The MCP bridge cannot serve an OpenCode lane. | keep |
| `scripts/recording-files.mjs:31` | Allows OpenCode as a recordable harness. | An OpenCode run cannot be turned into a recording. | keep |
| `scripts/build-fixtures.mjs:429-430` | Maps the OpenCode adapter and label when building fixtures. | Fixture runs lose their OpenCode agent names. | keep |
| `scripts/acp-probe.mjs:14-421` (22 hits) | Probes `opencode acp` and its model list. | There is no maintained probe for OpenCode over ACP. | keep |
| `scripts/candidate.mjs:78` | Help example uses `opencode`. | Only the example text changes. | keep |
| `scripts/scale-live.mjs:38` (with `155`, `772-800`) | The scale probe makes its review worktree and asks Reviews for lane `opencode`. | Nothing user-facing. The probe fails when the lane is retired, because Reviews no longer lists it. | change to a staying lane |
| `package.json:57` | Keeps `src/model/parsers/opencode.js` in the packed files. | An installed package loses the OpenCode parser. | keep |
| `.env.example:9`, `11-12` | Documents the assistant model default and `OPENCODE_BIN`. | Users lose the documented assistant settings. | keep |
| `bin/machine-room.mjs:22` | `--sessions` help names Claude Code and OpenCode. | Only the help text changes. | keep |
| `public/fixtures/*` (14 files, 69 hits) | Recorded and sample agents and runs with OpenCode tools and session ids. | Replays of past runs lose their OpenCode agents and tool calls. | keep |

## Table C2: tests and fixtures

These tests read the real fleet or the real policy, so a retirement change reaches them. Everything else uses a sample lane named `opencode` and keeps passing while the entry stays in `lanes.json`.

| `file:line` | What it proves today | Action |
| --- | --- | --- |
| `tests/lanes-source.test.js:88-102` | The active agents from the real `docs/agents/lanes.json` are exactly `orchestrator`, `opencode` to `opencode7`, `agy`, `agy2`, `agy3`, `claude`, `codex`, `native`, `native2`. | Update the expected list when the lanes are retired. This is the only test that asserts the real active fleet. |
| `tests/lane-env.test.js:186`, `206` | A real `run-lane opencode --dry-run` builds a command from the real lane. | Point it at a staying lane, or assert that a retired lane is refused. |
| `tests/policy.test.js:99-143`, `210-222` | The real policy's first small, medium and large choices, and the three-choice tiers. | Update if Table A changes `policy.json`. |
| `tests/policy-propose.test.js:12-226` | Proposals built from the real policy name `opencode2` and `opencode3` in the small tier. | Update the expected sentences if the small tier changes. |
| `tests/policy-route.test.js:445-450` | `MOCK_POLICY` equals `docs/agents/policy.json`. | Update `src/control/mock.js` in the same commit. |
| `tests/briefs.test.js:290-291` | The real `opencode` lane has no UI or `Stage.jsx` forbidden path. | Passes while the entry stays. |
| `tests/plan.test.js:79-82` | Path checks use the real `opencode` lane's forbidden list. | Passes while the entry stays. |
| `tests/run-lane.test.js:32-99` | Command building for the real `opencode` lane. | Passes while the entry stays. |
| `tests/run-project.test.js:190-673` | Project runs use the real `opencode` lane shape. | Passes while the entry stays. |
| `tests/run-recording.test.js:36-591` | Recordings use the real `opencode` lane shape. | Passes while the entry stays. |
| `tests/run-failover.test.js:167-695` | Failover uses the real `opencode` lane as the target. | Passes while the entry stays. |

`tests/opencode-sessions.test.js` (18 hits) and `tests/assistant-route.test.js` (34 hits) are the two files that prove the sessions reader and the assistant route. They stay.

The other 143 files, with their hit counts. All keep. They use OpenCode as a sample harness and do not read the real fleet.

| File | Hits | File | Hits | File | Hits |
| --- | --- | --- | --- | --- | --- |
| `tests/acp-harness.test.js` | 11 | `tests/action-badges-ui.test.js` | 2 | `tests/active-lanes.test.js` | 96 |
| `tests/agent-colors.test.js` | 1 | `tests/agent-context.test.js` | 51 | `tests/agent-dock-ui.test.js` | 4 |
| `tests/agent-list.test.js` | 6 | `tests/agent-strip.test.js` | 10 | `tests/agent-view.test.js` | 2 |
| `tests/agents-config.test.js` | 92 | `tests/agents-lines.test.js` | 13 | `tests/assistant-route.test.js` | 34 |
| `tests/assistant.test.js` | 3 | `tests/autocompact.test.js` | 1 | `tests/badges.test.js` | 2 |
| `tests/bridge-reviews.test.js` | 67 | `tests/bridge-routes.test.js` | 68 | `tests/bridge-stream.test.js` | 23 |
| `tests/bridge.test.js` | 13 | `tests/candidate.test.js` | 11 | `tests/chat-open-ui.test.js` | 1 |
| `tests/claude-sessions.test.js` | 5 | `tests/client-timeout.test.js` | 1 | `tests/control-backup.test.js` | 2 |
| `tests/control-contract.test.js` | 79 | `tests/control-mock-briefs.test.js` | 1 | `tests/control-mock.test.js` | 27 |
| `tests/conversation.test.js` | 10 | `tests/cost-board.test.js` | 11 | `tests/costs.test.js` | 8 |
| `tests/dialog-focus-ui.test.js` | 1 | `tests/dispatch-auto-ui.test.js` | 19 | `tests/dispatch-offline-ui.test.js` | 4 |
| `tests/dispatch-split-ui.test.js` | 3 | `tests/dispatch-stop-ui.test.js` | 11 | `tests/dispatch.test.js` | 8 |
| `tests/e2e-room.test.js` | 7 | `tests/empty-room.test.js` | 2 | `tests/failure-tray.test.js` | 7 |
| `tests/family-ladder-ui.test.js` | 23 | `tests/family-team.test.js` | 18 | `tests/family-tree-ui.test.js` | 73 |
| `tests/family-tree.test.js` | 35 | `tests/family.test.js` | 75 | `tests/fixtures/acp-opencode-updates.jsonl` | 4 |
| `tests/fixtures/fake-acp-agent.mjs` | 1 | `tests/fixtures/fake-claude` | 1 | `tests/frame-cost.test.js` | 2 |
| `tests/git.test.js` | 3 | `tests/guide.test.js` | 2 | `tests/hand-run.test.js` | 2 |
| `tests/harness-models.test.js` | 16 | `tests/harnesses.test.js` | 43 | `tests/health-notice.test.js` | 8 |
| `tests/helpers/bridge.js` | 1 | `tests/hierarchy.test.js` | 44 | `tests/history-audit.test.js` | 1 |
| `tests/hub.test.js` | 24 | `tests/hud-keys-focus.test.js` | 1 | `tests/hud-menu.test.js` | 1 |
| `tests/hud-orchestrator-focus.test.js` | 3 | `tests/inspector-ui.test.js` | 61 | `tests/inspector.test.js` | 6 |
| `tests/ladder-form.test.js` | 21 | `tests/ladder-groups.test.js` | 17 | `tests/lane-conversation.test.js` | 32 |
| `tests/lane-costs.test.js` | 46 | `tests/lane-starter.test.js` | 6 | `tests/lane-tasks.test.js` | 47 |
| `tests/lanes-settings-ui.test.js` | 4 | `tests/lens.test.js` | 5 | `tests/live-ladder.test.js` | 9 |
| `tests/live-runs.test.js` | 20 | `tests/live-tasks.test.js` | 11 | `tests/live.test.js` | 18 |
| `tests/machine-doctor.test.js` | 11 | `tests/made-lane-defaults.test.js` | 12 | `tests/meters-panel.test.js` | 2 |
| `tests/model-refresh.test.js` | 1 | `tests/modes.test.js` | 3 | `tests/mr-agent-mcp.test.js` | 4 |
| `tests/online.test.js` | 2 | `tests/opencode-sessions.test.js` | 18 | `tests/orchestrator-chat.test.js` | 41 |
| `tests/orchestrator-e2e.test.js` | 10 | `tests/orchestrator-name.test.js` | 2 | `tests/orchestrator.test.js` | 180 |
| `tests/orchestrators.test.js` | 158 | `tests/outcomes.test.js` | 20 | `tests/pack-start.test.js` | 1 |
| `tests/panels-briefs.test.js` | 28 | `tests/panels-read-only.test.js` | 4 | `tests/panels-runs.test.js` | 68 |
| `tests/parsers.test.js` | 23 | `tests/plans.test.js` | 3 | `tests/policy-lane.test.js` | 1 |
| `tests/policy-proposals.test.js` | 12 | `tests/probes/assistant.js` | 8 | `tests/probes/context.js` | 1 |
| `tests/probes/routing.js` | 1 | `tests/process-tree.test.js` | 6 | `tests/program-path.test.js` | 2 |
| `tests/project-dispatch.test.js` | 148 | `tests/project-reviews.test.js` | 73 | `tests/project-task.test.js` | 31 |
| `tests/projects.test.js` | 14 | `tests/recording.test.js` | 4 | `tests/replay.test.js` | 6 |
| `tests/reviews-panel.test.js` | 14 | `tests/room-follow-reset.test.js` | 5 | `tests/room-lanes.test.js` | 6 |
| `tests/roster-update.test.js` | 25 | `tests/run-lane-route.test.js` | 27 | `tests/run-lane-stop.test.js` | 2 |
| `tests/run-queue.test.js` | 45 | `tests/run-usage.test.js` | 4 | `tests/run-worktree.test.js` | 63 |
| `tests/runs-cache.test.js` | 12 | `tests/runs-folder.test.js` | 15 | `tests/scale-live.test.js` | 2 |
| `tests/scenario-e.test.js` | 8 | `tests/scenarios.test.js` | 3 | `tests/sectors.test.js` | 30 |
| `tests/setup.test.js` | 12 | `tests/slash-commands.test.js` | 14 | `tests/soak.test.js` | 2 |
| `tests/stage-lens.test.js` | 2 | `tests/stage-snapshot.test.js` | 4 | `tests/stars.test.js` | 8 |
| `tests/startup.test.js` | 1 | `tests/state-runs.test.js` | 18 | `tests/state-subagents.test.js` | 72 |
| `tests/storage-settings.test.js` | 1 | `tests/storage.test.js` | 14 | `tests/subagent-place.test.js` | 4 |
| `tests/teams.test.js` | 40 | `tests/terminal-buttons.test.js` | 6 | `tests/terminals.test.js` | 2 |
| `tests/transport-lanes.test.js` | 49 | `tests/transport-spend.test.js` | 11 | `tests/unreadable.test.js` | 20 |
| `tests/waiting.test.js` | 4 | `tests/worktrees.test.js` | 7 |  |  |

## Smallest ordered list to retire OpenCode from the fleet

1. Freeze the lanes. Give no new brief to `opencode` to `opencode7`. Let their runs end. Stop the OpenCode service after the last run. Decide what happens to `opencode6`'s 4 unmerged commits before its worktree is removed.
2. In `docs/agents/lanes.json`, add `"retired": true` to `opencode`, `opencode2`, `opencode3`, `opencode4`, `opencode5`, `opencode6` and `opencode7`. Keep the entries for now. Keeping the entries leaves `realLanes.opencode` for the tests that use it as a sample and lets old records resolve. Change the `agy`, `agy2` and `agy3` role sentence at lines 277, 301 and 325 to name `codex` and `native` for UI design.
3. Update the two real-fleet tests: `tests/lanes-source.test.js:88-102` expected active list, and `tests/lane-env.test.js:186` to a staying lane or to assert a retired lane is refused. No other test asserts the active fleet.
4. Replace the six OpenCode choices in `docs/agents/policy.json` with `codex`, `native` and `native2`, keeping each tier non-empty. Fix the stale `gemini-3.8-flash-high` rows to `gemini-4-hydrogen-xhigh` at the same time. Copy the result into `src/control/mock.js:305-326`, then update `tests/policy.test.js`, `tests/policy-propose.test.js` and the copy check in `tests/policy-route.test.js`.
5. Change `scripts/scale-live.mjs:38` from `REVIEW_LANE = 'opencode'` to a staying lane such as `claude`. Reviews stops listing a retired lane, and the probe would otherwise fail at line 790.
6. Update the orchestrator rules that send work to OpenCode: `docs/agents/ORCHESTRATOR.md` at lines 16-17, 46, 48, 142, 168, 178, 210, 214 and 216; `docs/agents/OWNER.md:36`; `docs/agents/CONTRIBUTING.md:67-74`. Use `native` or `native2` for reviews, suites and hunts, and `codex` or `native` for UI work.
7. Update the examples that would start a retired lane: `docs/agents/ORCHESTRATOR-AGENT.md:30-61`, `docs/agents/TRIAL-LOWBEAM.md:66`, `docs/agents/HIERARCHY.md:7-29`, and the stale "runs on OpenCode and Claude Code" sentence in `docs/agents/HARNESSES.md:3`. Use `claude` for sub orchestrators because `src/ui/ladderForm.js:52` does not offer `codex` or `native` for a sub today.
8. Leave product support alone: the harness descriptors, parser, session reader, orchestrator support, assistant route, defaults, model lists, MCP config, audit e-mail exception, fixtures and every product doc in Table B marked keep. Leave historical records alone.
9. After the branches are merged or dropped, remove the seven OpenCode worktrees with `npm run worktrees`, then delete the retired entries in a later cleanup brief that also updates the sample tests in Table C2. Do not push.

## What is not a dependency

- `config/lanes.json` and `config/policy.json`, the owner's room defaults, hold no OpenCode lane. Only `docs/agents` does.
- `fallback` has no OpenCode entry in the fleet.
- The product's OpenCode support has no runtime dependency on this fleet. A user who installs MachineRoom and signs in to OpenCode keeps the harness, the sessions reader, the parser, the assistant route and the orchestrator support.
