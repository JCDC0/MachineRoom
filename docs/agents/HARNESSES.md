# Pluggable harnesses (planned)

Status: planned on 2026-10-24 at the owner's request, not started. The room runs on OpenCode and Claude Code for now; Hermes and AGY are retired in `docs/agents/lanes.json` but stay supported. The aim is that a new coding harness can be added later with one file and one lanes entry, and that a harness the owner turns off stays plugged in, just unused.

## Where a harness is named today

Adding a harness means touching each of these:

| Place | What it holds |
| --- | --- |
| `src/model/parsers/index.js`, `src/model/parsers/unreadable.js` | the parser for each `parser` key, and the list of parsers the unread-line counter knows |
| `src/model/pipeline.js` | `AGENT_ORDER` |
| `src/briefs/run.js` | `commandFor` (the command line per harness), `summarizeRun`, the report and usage readers per log shape |
| `src/briefs/recording.js` | `ADAPTERS` (harness to adapter type), `createRunLineReader`, the log entries per harness |
| `src/briefs/briefs.js` | `OWNER_NAMES` |
| `server/index.js`, `src/live/source.js`, `src/ui/panels/dispatchModels.js` | adapter type to parser maps |
| `src/ui/panels/briefs.js`, `src/ui/panels/runs.js`, `src/ui/panels/route.js` | `VALID_LANES`, `PROJECT_RUN_ADAPTERS`, a Hermes special case |
| `src/engine/shapes.js` | the wireframe shape per agent key |
| `server/claude-sessions.js`, `server/opencode-sessions.js` (S7) | a reader of the harness's own session files |

## The plan

One descriptor per harness, in two halves, because the browser bundle must not pull in `node:fs` or `node:sqlite`:

- `src/harnesses/<key>.js`, pure and browser-safe: `key` (the `cli.harness` value in `lanes.json`), `name`, `adapterType`, `createParser`, `command({ cli, prompt, folder, env, title, sessionId })` returning `{ file, args, cwd }`, `readLine` (for recordings and the live lane source), `report(log)` and `usage(log)`, and an optional `shape`.
- `server/harnesses/<key>.js`, Node only and optional: `createSessionsReader` (the S7 reader interface).
- `src/harnesses/index.js` and `server/harnesses/index.js` list them, with `harnessByKey` and `harnessByAdapter`. Every place in the table reads the registry instead of naming harnesses.

On and off stay where they are: a lane's `"retired": true` in `lanes.json` turns it off, and a harness with no live lane is simply unused. The UI lists come from `/api/agents` and the registry, not from fixed arrays.

A generic path for later harnesses: an `acp` harness that runs any Agent Client Protocol agent (`opencode acp`, `dsh --profile acp`, Zed's `claude-agent-acp`) and maps each `tool_call` `kind` and `locations` to touches (see `SOURCES.md`, results of 2026-10-24). With it, a new ACP agent needs only a `lanes.json` entry naming its command.

## Steps, when the owner starts them

1. H1. The registry and descriptors for the four harnesses we have, with no change in behaviour: the `--replay` digests and the full suite stay the same.
2. H2. The UI lists and adapter maps read the registry and `/api/agents`.
3. H3. The S7 session readers register through `server/harnesses`, so a harness brings its own.
4. H4. The `acp` harness, tested on `opencode acp` with the probe in `scripts/acp-probe.mjs`.

Done for the whole plan: adding a harness is one descriptor (two with a session reader), one `lanes.json` entry and its tests, with no edit to the pipeline, the runner, the recorder, the bridge or the panels.
