# Recording a run

The viewer replays Paperclip frames. To record new ones:

1. Start Paperclip: `paperclipai run`. It listens on `http://127.0.0.1:3100`.
2. Find the company id: `paperclipai company list --json`.
3. Start the recorder: `node scripts/record-events.mjs <company-id> <out.jsonl> <seconds>`. It writes one JSON line per frame as `{ t, kind, data }`.
4. Give an agent a task. Create an issue assigned to it with `paperclipai issue create`, or wake it with `paperclipai agent heartbeat:invoke <agent-id>`.
5. Stop the recorder when the run ends.
6. Build the fixtures: `npm run fixtures -- <out.jsonl> <sandbox-folder> <ids.json>`. The script removes the Windows profile name from paths and stops if a frame looks like it holds a key.

Windows notes found while recording:

- A working folder path of 259 characters or more makes every run fail with `spawn ... node.exe ENOENT`. Keep the sandbox on a short path such as `%LOCALAPPDATA%\Temp\agent-sandbox`.
- The Claude, Hermes and OpenCode adapters refuse a folder that is not a git repository. Run `git init` and make one commit in the sandbox.
- `opencode-go/deepseek-v4.1-flash` answers "requires Global regions" until the OpenCode workspace privacy setting is Global. `opencode-go/qwen3.8-flash` works without it.
- Agents run with permissions skipped. Keep their folder a throwaway.
