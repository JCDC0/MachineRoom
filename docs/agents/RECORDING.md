# Recording a run

The viewer replays Paperclip frames. To record new ones:

1. Start Paperclip: `paperclipai run`. It listens on `http://127.0.0.1:3100`.
2. Find the company id: `paperclipai company list --json`.
3. Start the recorder: `node scripts/record-events.mjs <company-id> <out.jsonl> <seconds>`. It writes one JSON line per socket event as `{ t, kind, data }`; the kinds are `open`, `frame`, `error`, `close` and `timeout`.
4. Give an agent a task. Create an issue assigned to it with `paperclipai issue create`, or wake it with `paperclipai agent heartbeat:invoke <agent-id>`.
5. Stop the recorder when the run ends.
6. Build the fixtures: `npm run fixtures -- <out.jsonl> <sandbox-folder> <ids.json>`. The script joins the chunks of each run and stream before it removes the Windows profile name and email addresses, so a name or address split across two chunks is masked whole, then cuts the text back into chunks. It joins the text deltas of one step too, because Paperclip can split a name across two of them. It stops if the joined text of a run looks like it holds a key.

## Recording a lane run

`npm run run-recording -- 1` turns run 1 of the lane run list into a recording under `public/recordings/`. The list is `runs.jsonl` in the runs folder (`%TEMP%\machineroom-runs` on Windows), and 1 is the newest run. The lane needs a `cli` block for Hermes or OpenCode in `docs/agents/lanes.json`, and the run needs its log file, its worktree and a commit or branch. The script writes `<log name>-run.jsonl`, `<log name>-agents.json`, `<log name>-tree.json`, adds the run to `index.json`, and prints the paths, the frame count and the tool call count. Open `/?recording=<log name>` to replay it.

`npm run run-lane` writes the same recording after each run and prints the link.

## Rebuilding frames from stored runs

The live socket cuts any log chunk longer than 8192 characters to its last 8192 characters and sets `truncated`, so a live recording loses large tool calls. Paperclip's stored run data is complete. Rebuild the frame file from it after the runs end:

```
PAPERCLIP_COMPANY_ID=<company-id> node scripts/frames-from-runs.mjs --since <ISO time> --out <file> [--run <runId>]
```

It reads `PAPERCLIP_URL` (default `http://127.0.0.1:3100`), `PAPERCLIP_COMPANY_ID` and, when set, `PAPERCLIP_API_KEY` as a bearer token, and the REST API only. It keeps the runs that start at or after `--since`, writes one frame per line in the live socket shape, and numbers the ids from 1. `--run` narrows the output to the named runs and can be repeated. Feed the output to `npm run fixtures` like a recorder file. An optional fourth argument names the fixture set, so several recordings can live side by side:

```
npm run fixtures -- <frames.jsonl> <sandbox-folder> <ids.json> <name>
```

This writes `<name>-run.jsonl`, `<name>-agents.json` and `<name>-tree.json` under `public/fixtures/`. Without a name the files are `sandbox-run.jsonl`, `sandbox-tree.json` and `agents.json`. When a run renames or deletes a file, build the tree from a folder state where both names exist, so the parser can resolve both.

## Windows notes found while recording

- A working folder path of 259 characters or more makes every run fail with `spawn ... node.exe ENOENT`. Keep the sandbox on a short path such as `%LOCALAPPDATA%\Temp\agent-sandbox`.
- The Claude, Hermes and OpenCode adapters refuse a folder that is not a git repository. Run `git init` and make one commit in the sandbox.
- `opencode-go/deepseek-v4.1-flash` answers "requires Global regions" until the OpenCode workspace privacy setting is Global. `opencode-go/qwen3.8-flash` works without it.
- Agents run with permissions skipped. Keep their folder a throwaway.
- Paperclip redacts tokens in stored logs as `***REDACTED***`. When the token sits inside an escaped command string, the redaction can leave broken JSON behind, and one tool call is then lost to the parsers.
- Paperclip and the agents write issue comments through the API from ordinary shell lines that start with `PAPERCLIP_API_BASE=` or `api="${PAPERCLIP_API_URL%/}"`. They look like normal tool calls in the terminals.
