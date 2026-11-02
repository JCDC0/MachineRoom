# Audit of the page and the bridge contract, November 2026

Date: 2026-11-03. Version 0.1.401. Branch `feat/q31-bug-hunt-the`, cut from `refs/heads/main` at `f11a48c`. Brief Q31.

This run read `src/control/client.js`, `src/live/source.js`, `src/live/bridge.js`, `src/live/livePlayer.js`, `src/live/tree.js`, `server/index.js`, `server/control.js`, `server/lanes-source.js`, `server/sessions-source.js`, `server/files.js` and `server/static.js` in full, and the page and server code each finding names. It started a real bridge on a temporary folder with `tests/helpers/bridge.js` and called its routes. It changed no code.

Nothing here repeats a finding in `AUDIT-2026-11-SUMMARY.md` or the other `AUDIT-2026-11-*.md` files. B1 is checked again below, in the write-route table, because the brief asks for it.

## Severity

- High: a feature fails in normal use, or a secret reaches the page.
- Medium: a concrete case loses or repeats data, or the page shows stale data a person would act on.
- Low: a narrow edge, a dead method, or wasted work.

No High finding. Nothing writes outside the project, starts a run the owner did not confirm, or prints a key.

## Findings

| # | Severity | Where | The concrete case and what goes wrong | How it was proved | Smallest fix |
| --- | --- | --- | --- | --- | --- |
| 1 | Medium | `server/index.js:909-916`, `server/index.js:543-571`, `src/live/bridge.js:30-31` | A file added between the page's `GET /api/tree` and its `/events` connect is never sent at connect. The route sets `treeSent` from the `since` version and returns; `publishTree` only sends to clients already in `clients`. The page then waits for the next tree change. A single file created in that window does not appear until something else changes. | Probe on a real bridge: read `/api/tree` (`version=1`, 0 files), create `added-before-connect.txt`, wait 1.5 s for the bridge's own read, connect `/events?history=1&tree=folders&since=1`, read for 2.5 s: 0 tree events. Create `added-after-connect.txt`: the next event is `{"files":["added-after-connect.txt","added-before-connect.txt"]}`. The first file was carried only by the later change. | After `treeSent.set(res, sinceFiles)`, if `lastTree` holds files the version does not, write `treeEvent(lastTree, sinceFiles, shape)` to the response and set `treeSent` to `lastTree.files`. |
| 2 | Medium | `src/live/bridge.js:30-31`, `:36`, `:42-50`, `server/index.js:889-906` | A reconnect that the browser gives up on replays the last 500 frames the page already applied. `streamUrl` is built once with `history=1`, and `open()` creates a new `EventSource` with it. A new `EventSource` carries no `Last-Event-ID`, so the server takes the `wantsHistory` branch and writes the whole history again. Every replayed frame is applied again: duplicate log lines, duplicate tool calls, duplicate activities in the session recorder. | Line trace: `bridge.js:31` puts `history=1` in the only URL; `bridge.js:36` and `:49` create a fresh `EventSourceImpl(streamUrl)`; `index.js:888` reads `last-event-id`, which a fresh `EventSource` does not send; `index.js:902-906` replays every history entry. Probe: two separate `history=1` reads on the same bridge returned the same three frames (`same=true`), so a second connection with that URL gets the whole history again. | Keep the last frame id seen in `openBridge` and add it to the URL on reopen (`&after=ID`, read like `Last-Event-ID`), or drop `history=1` when `open()` runs again. |
| 3 | Medium | `server/control.js:117`, `server/lanes-source.js:48-54`, `src/briefs/recording.js:183-193`, `src/ui/panels/AgentBuilder.jsx:97` | `GET /api/control/agents` answers `model: null` and `reasoningEffort: null` for every lane, because `mapAgent` reads `raw.adapterConfig.model` and `raw.adapterConfig[key]`, while its input is `laneAgents()`, which carries `model` and `harness` at the top level and has no `adapterConfig`. The Agents tab prints the model only when it is there, so every row shows no model. | Probe on a real bridge with the same lane: `GET /api/agents` first agent `{"id":"agent-claude","key":"claude","model":"sonnet"}`, `GET /api/control/agents` first agent `{"id":"agent-claude","key":"claude","model":null,"reasoningEffort":null}`. `agentsFile` returns only `{id, key, name, adapterType, parser}`. | Read the top-level field too: `model: (typeof raw.adapterConfig?.model === 'string' && raw.adapterConfig.model) || (typeof raw.model === 'string' && raw.model) || null`, and the same for `reasoningEffort` from `raw.model` or a lane `effort`. |
| 4 | Medium | `server/control.js:78-106`, `server/index.js:718-733`, `server/runs.js:232-236`, `src/ui/panels/ReviewsPanel.jsx:136`, `src/ui/panels/DispatchPanel.jsx:177` | A lane run started by `run-lane` and reported by the lane source ends without a `runs` notice. `changeEvents` answers `agents`, `issues`, `costs` and `liveRuns` for run frames, and only `server/runs.js` sends `runs`, for the runs the bridge itself started. The Reviews panel reloads only on `runs`, so its list stays stale after a lane run ends; the Dispatch panel's run list is stale too. | Probe: a real lane log produced three frames on `/events?history=1`, and the `change` events on the same stream were `agents`, `issues`, `liveRuns`, never `runs`. Trace: the only `notify({ topic: 'runs' })` calls are `runs.js:234` (after a start) and `runs.js:232-236` (a run the bridge started); a lane log's `heartbeat.run.status` goes through `index.js:728-733`, which pushes only the notices `changeEvents` returns. | Add `{ topic: 'runs' }` to the `RUN_NOTICES` branch of `changeEvents`. |
| 5 | Low | `src/briefs/audit.js:254`, `:5`, `:273-281` | A key whose `sk-` follows `-`, `_`, a letter or a digit is held for up to one second and then emitted unmasked. `openKeyStart` accepts a head after `-` or `_` (`openToken`), but `keyRanges` uses `SK_TOKEN` with `(?<![A-Za-z0-9_-])`, so it finds no range and `releaseOpen` writes the line as it is. | Probe with the key built as `'sk-' + 'or-v1-' + 'q'.repeat(40)`: the prefixes `x` and `x-` leaked the whole key at chunk sizes 8, 12, 16, 24 and 40. The prefixes `OPENROUTER_API_KEY=`, a space, `"`, `{"api_key":"` and `Authorization: Bearer ` were masked at every size, so an ordinary split key is masked. | Use one head rule for both: let `SK_TOKEN` accept the same boundary as `openToken` (allow `-` or `_` before `sk-`), so a held line is masked. |
| 6 | Low | `server/index.js:701-707`, `:694-699` | The 500-frame history is not a limit when every entry is pinned. `trimHistory` removes the first non-pinned entry and returns when there is none. Every run start pins two frames (`queued`, `running`) and only an end status unpins them. A run that never gets an end frame, because the bridge stops watching it or a record never arrives, keeps its two pinned frames for the life of the process, and a late join replays all of them. | Trace: `holdsRunStart` returns true for `heartbeat.run.queued` and `running`; `emit` pushes `pinned`; `trimHistory`'s `while` loop calls `findIndex((item) => !item.pinned)` and returns on `-1`. Not run. | Cap the pinned frames as well (keep the newest N run starts), or unpin a run's start when its log goes quiet. |
| 7 | Low | `src/control/client.js:484-486`, `server/index.js:925` | Two client methods have no route. `backupStatus()` and `backupNow()` request `GET` and `POST /api/backup`, and the bridge answers `404 {"error":"not found"}`. No page calls either, so the fault is in the client contract only. | Probe: `GET /api/backup` returned `404 {"error":"not found"}` on a real bridge; `POST /api/backup` the same. | Delete the two methods and `REQUEST_LIMITS.backupNow`, or add the route. |
| 8 | Low | `server/endpoints.js:283`, `:357-358`, `:442`, `server/mcp.js:545`, `:572` | The bridge sends `endpoints` and `mcp` notices that no page listens for. A scan of `src` finds both topics only in `src/control/mock.js`; the panels that show those lists read once and on their own actions. | Trace: `grep` over `src` for a subscription with either topic finds none outside the mock; the server calls `notify({ topic: 'endpoints' })` and `notify({ topic: 'mcp' })` on save and delete. | Remove the two notify calls, or subscribe the panels to them. |

## Every write route and what guards it

The global gate runs before every route (`server/index.js:778-787`): the `Host` header must be local, and a request that carries an `Origin` must name a loopback origin on the serving port, the Vite port while there is no static folder, or an origin in `MACHINEROOM_ORIGINS`. A request with **no** `Origin` passes this gate; that is why each route's own check matters. `page` below means `Boolean(req.headers.origin)` in the route, and "same-origin" means `Origin` or `Sec-Fetch-Site: same-origin`.

| Route | What guards it | Answer with no Origin |
| --- | --- | --- |
| `POST /api/control/agents` | none; always refuses | 409 `Agents come from docs/agents/lanes.json.` |
| `PATCH /api/control/agents/ID` | none; always refuses | 409, same |
| `POST /api/control/agents/ID/budget` | none; always refuses | 409, same |
| `POST /api/control/issues` | none; always refuses | 409 `Lane runs start from Dispatch, not from a task.` |
| `POST /api/control/comments` | none; always refuses | 409, same |
| `POST /api/control/approvals/ID/decide` | none; always refuses | 404 `That approval no longer exists.` |
| `POST /api/control/runs` | `confirmed: true`, then Origin or an orchestrator token (`server/runs.js:441-470`) | 400 `Confirm the run first.` |
| `POST /api/control/plans` | `confirmed: true`; always refuses | 400 `Confirm the plan request first.` |
| `POST /api/control/plans/ID/accept` | none; always refuses | 409 `Plans come from lane runs.` |
| `POST /api/control/reviews/ID/merge` | Origin or orchestrator token (`server/reviews.js:187-190`) | 403 `The caller is not the owner, so the lane was not merged.` |
| `POST /api/orchestrator/messages` | Origin or orchestrator token | 403 `A request with no Origin needs a valid orchestrator token.` |
| `POST /api/orchestrator/stop` | `confirmed: true` only; no Origin and no token (B1) | 400 `Confirm the stop first.`; **200 `{"ok":true}` with `confirmed: true`** |
| `POST /api/orchestrator/compact` | Origin | 403 |
| `POST /api/orchestrator/autocompact` | Origin | 403 |
| `POST /api/orchestrator/model` | Origin | 403 |
| `POST /api/orchestrator/harness` | Origin | 403 |
| `POST /api/orchestrator/effort` | Origin | 403 |
| `POST /api/orchestrator/sessions/new` | Origin | 403 |
| `POST /api/orchestrator/sessions/ID` | Origin | 403 |
| `POST /api/orchestrator/sessions/ID/open` | Origin | 403 |
| `POST /api/orchestrator/sessions/ID/delete` | Origin | 403 |
| `POST /api/orchestrator/ladder` | Origin or orchestrator token | 403 |
| `POST /api/lanes/active` | Origin | 403 |
| `POST /api/lanes/create` | Origin | 403 |
| `POST /api/lanes/ID/update` | Origin | 403 |
| `POST /api/lanes/ID/delete` | Origin | 403 |
| `POST /api/endpoints` | Origin | 403 |
| `POST /api/endpoints/quick` | Origin, `confirmed: true` | 403 |
| `POST /api/endpoints/ID/delete` | Origin | 403 |
| `POST /api/projects/open` | Origin | 403 |
| `POST /api/projects/forget` | Origin | 403 |
| `POST /api/family/label` | Origin | 403 |
| `POST /api/family/proposals/ID/approve` | Origin | 403 |
| `POST /api/family/proposals/ID/decline` | Origin | 403 |
| `POST /api/keys` | Origin | 403 |
| `POST /api/keys/ID/delete` | Origin | 403 |
| `POST /api/mcp/servers` | same-origin | 403 `Only the owner can use the MCP servers.` |
| `POST /api/mcp/servers/ID/delete` | same-origin | 403, same |
| `POST /api/mcp/call` | same-origin | 403, same |
| `POST /api/git/switch` | Origin | 403 |
| `POST /api/git/branch` | Origin | 403 |
| `POST /api/search-provider` | Origin | 403 |
| `POST /api/decide` | Origin or orchestrator token | 403 `Only the owner can spend on a decision.` |
| `POST /api/assistant` | Origin, `confirmed: true` | 403 |
| `POST /api/backup` | no route | 404 |

B1 is confirmed and unchanged: `POST /api/orchestrator/stop` takes `{confirmed: true}` from a process with no Origin and no token and answers 200. Every other write route above either needs an Origin, a token, or refuses without acting. The three MCP writes and `GET /api/mcp/*` accept a same-origin fetch as well as an Origin, which a browser sends in the one-port room.

## What was checked and found sound

- `GET /api/tree` and `readFileList`: the folder shape (`root`, `shape`, `folders`, `files`, `version`) reads back with the right paths, and the gzip branch decodes and parses through Node's `fetch`.
- `GET /api/file` refuses a request with neither `Origin` nor `Sec-Fetch-Site: same-origin`, and accepts a same-origin fetch. A missing file answers 404 with the bridge's sentence, which the inspector shows.
- `GET /api/harnesses/KEY/models`, `GET /api/mcp/servers` and `GET /api/mcp/tools` accept a same-origin fetch, so the one-port room works in a browser.
- The event stream writes `id:` on every frame, replays from `Last-Event-ID` when it is present and known, and adds a client after the replay in the same turn, so a live frame cannot slip between the replay and the subscription.
- `client.costs()` and `costBoard`: `mapCosts` answers `{summary, byAgent, quota}`, and the board joins `byAgent` on `agentId` with the roster `id`, which matches.
- `client.liveRuns()`, `client.outcomes()`, `client.reviews()`, `client.briefs()`, `client.endpoints()` and `client.keys()` all accept both the array and the wrapped shape the bridge answers.
- `client.orchestrator()` reads the object `GET /api/orchestrator` answers, with `messages` and the autocompact fields.

## What I did not reach

- No browser, so no check by eye, and no dev server. Every page claim is a code read or a probe on the bridge.
- The 500-frame history growth in finding 6 was traced, not run: I did not start 260 runs to fill the history.
- The reconnect repeat in finding 2 was traced through both files; I did not run a browser `EventSource` that gives up and reopens.
- I did not test a real `git` project for `GET /api/control/reviews`; the temporary folder has no `docs/agents/lanes.json`, so the route answered 404 `The lane file is missing.` there.
- No full test suite and no build, per the brief. No code changed.

## Commands run

- `git switch -c feat/q31-bug-hunt-the refs/heads/main`: pass.
- `node q31-probe.mjs` with `MACHINEROOM_RUNS` under the test temp root: pass. Called 34 GET routes and 36 POST routes on a real bridge from `tests/helpers/bridge.js`, and read one lane log through `/events`.
- `node q31-probe2.mjs`: pass. Chunked the test key at five sizes behind seven prefixes through `createSplitMasker`, and called nine GET routes with `Sec-Fetch-Site: same-origin`.
- `node q31-probe3.mjs`: pass. Proved finding 1 with the tree read, a new file, a stream connect and a second new file.
- `node q31-probe4.mjs`: pass. Read the `change` topics beside the frames (`agents,issues,liveRuns`), read the history twice (`same=true`), and called six more write routes with no Origin (403, 403, 403, 403, 409, 403).
- The four probe scripts were deleted. The temp folders from the runs were removed, except one folder under the test temp root that Windows still held open after its process exited; `tests/helpers/cleanTemp.js` clears a dead test process's folder on the next test run.
