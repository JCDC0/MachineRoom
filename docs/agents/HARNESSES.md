# Pluggable harnesses (planned)

Status: planned on 2026-10-24 at the owner's request. H1 is done (merged as 0.1.292): `src/harnesses/` holds the registry and one descriptor per harness. H2 is done (0.1.304): the parser maps and the UI lane lists read the registry. H3 is done (0.1.302): `server/harnesses/` holds one Node descriptor per harness with a session reader, and the sessions source ticks the readers it lists. H4 is done (0.1.305): the `acp` harness runs any Agent Client Protocol agent, maps each `tool_call` kind and location to touches, and needs only a `lanes.json` entry. The room runs on OpenCode and Claude Code for now; Hermes and AGY are retired in `docs/agents/lanes.json` but stay supported. The aim is that a new coding harness can be added later with one file and one lanes entry, and that a harness the owner turns off stays plugged in, just unused.

## Where a harness is named today

After H1 and H2, adding a harness means touching these:

| Place | What it holds |
| --- | --- |
| `src/model/parsers/unreadable.js` | the list of parsers the unread-line counter knows |
| `src/engine/shapes.js` | the wireframe shape per agent key |
| `server/harnesses/<key>.js` (S7) | `createSessionsReader`, a reader of the harness's own session files (Claude Code and OpenCode today) |

The parser map in `src/live/source.js` reads `harnessByAdapter`. The UI lane lists read the registry and the agent list: `VALID_LANES` and `validLanes` in `src/ui/panels/briefs.js` read `docs/agents/lanes.json` and an agent list, and the project run lanes in `src/ui/panels/runs.js` read the agents `/api/agents` sends. The bridge puts each agent's parser in `/api/agents`, so `server/index.js` has no adapter map.

## The plan

One descriptor per harness, in two halves, because the browser bundle must not pull in `node:fs` or `node:sqlite`:

- `src/harnesses/<key>.js`, pure and browser-safe: `key` (the `cli.harness` value in `lanes.json`), `name`, `adapterType`, `createParser`, `command({ cli, prompt, folder, env, title, sessionId })` returning `{ file, args, cwd }`, `readLine` (a factory: it returns the line reader, because the parser keeps state across lines; used by recordings and the live lane source), `report(log)` and `usage(log)`, and an optional `shape`. AGY's adapter `process` is generic, so its descriptor sets `parserByAdapter: false` and the parser picker uses it only when an agent names `parser: agy`.
- `server/harnesses/<key>.js`, Node only and optional: `createSessionsReader` (the S7 reader interface).
- `src/harnesses/index.js` and `server/harnesses/index.js` list them, with `harnessByKey` and `harnessByAdapter`, and the agent and brief owner orders. The steps below move every place in the table onto the registry.

On and off stay where they are: a lane's `"retired": true` in `lanes.json` turns it off, and a harness with no live lane is simply unused. The UI lists come from `/api/agents` and the registry, not from fixed arrays.

A generic path for later harnesses: an `acp` harness that runs any Agent Client Protocol agent (`opencode acp`, `dsh --profile acp`, Zed's `claude-agent-acp`) and maps each `tool_call` `kind` and `locations` to touches (see `SOURCES.md`, results of 2026-10-24). With it, a new ACP agent needs only a `lanes.json` entry naming its command.

## Steps, when the owner starts them

1. H1 (done, 0.1.287). The registry and descriptors for the four harnesses we have, with no change in behaviour: the `--replay` digests and the full suite stay the same.
2. H2 (done, 0.1.304). The UI lists and adapter maps read the registry and `/api/agents`.
3. H3 (done, 0.1.302). The S7 session readers register through `server/harnesses`, so a harness brings its own.
4. H4 (done, 0.1.305). The `acp` harness, tested on `opencode acp` with the probe in `scripts/acp-probe.mjs` and end to end with a fake ACP agent.

The `acp` descriptor runs the agent through `scripts/acp-run.mjs`, which sends `initialize`, `session/new`, the model and effort the agent offers, and `session/prompt`, answers each permission request with its first allow option, and writes each `session/update` to the run log as one JSON object per line. A child session in `_meta` becomes its own agent. An OpenCode agent over ACP needs only a lane's `cli` block: `{"harness": "acp", "bin": "%APPDATA%\\npm\\node_modules\\@opencode\\cli\\bin\\opencode.exe", "args": ["acp"], "model": "opencode-go/deepseek-v4.1-flash"}`. No lane is added yet.

Done for the whole plan: adding a harness is one descriptor (two with a session reader), one `lanes.json` entry and its tests, with no edit to the pipeline, the runner, the recorder, the bridge or the panels.
