# Recording a run

The viewer replays a recording of one lane run. A run started with `npm run run-lane` on a brief writes one when it ends and prints `room: /?recording=<name>`. A run on a project or a queue writes no recording; it shows live in the room with `--lanes`.

## Recording a lane run

`npm run run-recording -- 1` turns run 1 of the lane run list into a recording under `public/recordings/`. The list is `runs.jsonl` in the runs folder (`%TEMP%\machineroom-runs` on Windows), and 1 is the newest run. The lane needs a `cli` block in `docs/agents/lanes.json`, and the run needs its log file, its worktree and a commit or branch. The script writes `<log name>-run.jsonl`, `<log name>-agents.json`, `<log name>-tree.json`, adds the run to `index.json`, and prints the paths, the frame count and the tool call count. Open `/?recording=<log name>` to replay it. Run `npm run build` again so the built room serves it.

## Building fixtures

`npm run fixtures -- <frames-or-raw-events.jsonl> <sandbox-folder> <ids.json> [out-name]` turns a frame file into the fixture set the replay reads. The script joins the chunks of each run and stream before it removes the Windows profile name and e-mail addresses, so a name or address split across two chunks is masked whole, then cuts the text back into chunks. It joins the text deltas of one step too. It stops if the joined text of a run looks like it holds a key.

This writes `<name>-run.jsonl`, `<name>-agents.json` and `<name>-tree.json` under `public/fixtures/`. Without a name the files are `sandbox-run.jsonl`, `sandbox-tree.json` and `agents.json`. When a run renames or deletes a file, build the tree from a folder state where both names exist, so the parser can resolve both.

## Windows notes found while recording

- A working folder path of 259 characters or more makes every run fail with `spawn ... node.exe ENOENT`. Keep the sandbox on a short path such as `%LOCALAPPDATA%\Temp\agent-sandbox`.
- The Claude, Hermes and OpenCode adapters refuse a folder that is not a git repository. Run `git init` and make one commit in the sandbox.
- `opencode-go/deepseek-v4.1-flash` answers "requires Global regions" until the OpenCode workspace privacy setting is Global. `opencode-go/qwen3.8-flash` works without it.
- Agents run with permissions skipped. Keep their folder a throwaway.
