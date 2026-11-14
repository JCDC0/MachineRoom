# A Codex orchestrator and the bridge

Written by the codex lane (GPT-6.1 Terra high) for brief P326 on 2026-11-15, from its final reply; the orchestrator saved it here because the lane reports in its reply.

**The Codex sub can receive its bridge address and token, and its replies can reach its parent.** A localhost request reached the network stack from this sandbox, but I could not verify the effective network policy of a separately spawned `codex exec` turn. The sub cannot directly merge a lane branch while its Git metadata remains read-only.


### Turn trace

- `server/index.js:793` supplies `http://127.0.0.1:PORT`. `server/orchestrator.js:653` substitutes `{{BRIDGE}}` and `{{TOKEN}}` in the instruction. The default instruction contains both placeholders in `ORCHESTRATOR-AGENT.md:29`. If a custom prompt has no bridge placeholder, the address is **not** otherwise appended.
- `server/orchestrator.js:962` chooses the configured binary or lane binary. For `codex`, `server/agents-config.js:130` uses a PATH executable first, then the newest eligible Codex app executable.
- The generic branch passes `mcpConfig`, `token`, `bridgeUrl`, and `mode` to the descriptor at `server/orchestrator.js:1940`. `src/harnesses/codex.js:102` consumes **none of those four as separate arguments**. The address and token still reach Codex inside the assembled prompt. Its command uses `exec --json --sandbox workspace-write`, the model, and the lane CLI effort.
- Each orchestrator gets a token at `server/orchestrator.js:951`. `server/orchestrators.js:576` maps a matching token to its instance ID. The run route uses that identity and checks the lane belongs to the sub’s sector at `server/runs.js:563`.

### Sandbox and job steps

The installed app executable’s help confirms that `--sandbox workspace-write` governs model-generated shell commands and that `-c` overrides a config value. OpenAI’s [configuration reference](https://developers.openai.com/codex/config-reference/) names `sandbox_workspace_write.network_access` as the setting for outbound network access. I did not inspect or change the owner’s config values.

From **this** workspace-write sandbox, `Invoke-WebRequest http://127.0.0.1:1` returned a socket error saying the target actively refused the connection. That shows the connection attempt reached localhost rather than being blocked before reaching the socket. It does not prove that a new Codex CLI turn inherits the same policy or can contact a live bridge.

| Step | Finding |
|---|---|
| Start an AGY lane | Supported by the route and sub token, **provided** the spawned turn can reach the bridge and the lane belongs to its sector. |
| Read the end | Supported. The room queues a run-end message for the sub that started it and starts another turn: `server/orchestrator.js:2729`, `server/orchestrator.js:2815`. Run details can also be read over HTTP if reachable. |
| Merge into the sector branch | A direct Git merge cannot work with Git metadata read-only. Reviews has a bridge-side merge route, but its merge operates in the project checkout and does not provide the requested isolated sector-branch merge: `server/reviews.js:497`. |
| Answer the parent | Supported without an HTTP call from Codex. The final Codex message is extracted, then the bridge delivers it as `sub:ID`: `src/harnesses/codex.js:4`, `server/orchestrators.js:397`. |

### Smallest changes to make the sub’s job complete

1. **Verify the actual spawned turn first.** If its localhost request is blocked, configure its workspace-write network access in the Codex command at `src/harnesses/codex.js:106`, subject to the machine’s managed policy. Do not disable the sandbox. The test here does not establish that this change is necessary or sufficient.
2. Ensure the bridge address is included even when a custom prompt omits `{{BRIDGE}}`, at `server/orchestrator.js:653`.
3. Add a bridge-owned, sector-scoped merge operation near `server/reviews.js:497`, with ownership, destination and head checks. Update the instruction at `src/model/hierarchy.js:303` to use it. This needs corresponding route tests. It would require files outside this brief’s permitted path, so I made no change.

Direct Git writes from the sandbox remain impossible under its read-only Git restriction. The bridge operation would perform the authorized write outside that restriction.

### Verification and discrepancies

- **Tests:** 0 run before and 0 after. No files changed, so I did not run related tests or the build.
- **Passed:** read-only repository inspection; app executable `exec --help` and `--help`; localhost connection attempt produced **connection refused**; final `git status --short` and `git diff --stat` showed no changes.
- **Failed:** `rg` was unavailable, so I used PowerShell `Select-String`. `codex` was not on PATH, but the app executable was found and its help ran. An exploratory `codex sandbox windows --help` failed because that is not the installed command’s syntax and the process reported it could not find the home directory. One search named a nonexistent `server/bridge.js`; a subsequent search found the address in `server/index.js`.
- The brief’s statement that P311 starts the app program is conditional: a `codex` executable on PATH takes precedence. Its listed report file conflicts with the explicit reply-only reporting instruction; I followed the latter. The requested branch switch and commit also conflict with the explicit Git read-only rule, so neither was attempted.

**Not checked:** a live bridge, a fresh Codex orchestrator turn, or an actual sector merge. The network conclusion is limited to the current sandbox; a spawned turn may have different policy.
