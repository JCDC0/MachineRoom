# Survey of Coding Agent Harnesses and What Users Want (Argon)

Survey date: 2026-11-16. Built from public developer surveys, GitHub issue trackers, Hacker News threads and official documentation. Vendor claims are marked as vendor claims.

## 1. What Users Want and Complain About

### Theme 1: Cost, Token Burn and Quota Clarity
- **What users ask for:** Predictable spend, visible 5-hour and weekly rate-limit windows, prompt-cache hit tracking, and protection against retries or uncached turns draining paid quotas in 60 to 90 minutes.
- **How strongly:** Constant and vocal across paid Pro and Max subscribers and API users; it is the top operational complaint in CLI agent trackers and spawned popular community monitors like `ccusage`.
- **Sources:**
  - `anthropics/claude-code` Issue #41583, "Bug: Rate limit errors on Pro Plan at 26% usage" (2026-03, https://github.com/anthropics/claude-code/issues/41583).
  - `anthropics/claude-code` Issue #105621, "Usage limits drain drastically faster since mid-October 2026 with an unchanged workflow" (2026-10, https://github.com/anthropics/claude-code/issues/105621).
  - Ryoppippi, `ccusage` CLI token and 5-hour billing block monitor (2025-2026, https://github.com/ryoppippi/ccusage).

### Theme 2: Trust, Permission Fatigue and Sandboxing
- **What users ask for:** Kernel-level filesystem and network sandboxes (macOS Seatbelt, Linux Landlock and bubblewrap, Windows restricted tokens) so agents can run tests and edits without constant yes/no prompts or risky full-bypass flags, plus clear reversibility and workspace boundaries that do not break inside git worktrees.
- **How strongly:** Broad across all developer tiers. In the 2025 Stack Overflow survey (2025-07-29), 84% of respondents use or plan to use AI tools, but 46% distrust AI output accuracy. Senior engineers strongly reject repetitive permission prompts that push users into unsafe bypass modes.
- **Sources:**
  - Stack Overflow Developer Survey 2025, AI section (2025-07-29, https://survey.stackoverflow.co/2025/).
  - `openai/codex` Issue #13394, "Codex prompts per-file permission when worktree differs from opened folder" (2026, https://github.com/openai/codex/issues/13394).
  - `anomalyco/opencode` Issue #43888, "Non-interactive opencode run hangs forever when a subagent tool hits a permission=external_directory ask" (2026-08, https://github.com/anomalyco/opencode/issues/43888).

### Theme 3: Review of Agent Work, Diffs and Verification
- **What users ask for:** Smaller, verifiable diffs, automated test and lint gates before human review, and semantic conflict checks across files. Developers complain that "almost right" multi-file patches shift the bottleneck from writing code to reviewing noisy diffs and fixing subtle regressions.
- **How strongly:** Very strong among senior engineers, tech leads and maintainers. DORA (2025-09-23) found AI adoption raises software delivery throughput but lowers delivery stability when automated verification gates are missing.
- **Sources:**
  - DORA Report 2025, "State of AI-assisted Software Development" (2025-09-23, https://dora.dev/research/2025/dora-report/).
  - METR randomized controlled trial, finding experienced open-source developers took 19% longer with early-2025 AI tools while believing they were 20% faster (2025-07-10, https://metr.org/blog/2025-07-10-early-2025-ai-experienced-os-dev-study/).
  - JetBrains State of Developer Ecosystem 2025 (2025-10-15, https://devecosystem-2025.jetbrains.com/).

### Theme 4: Parallel Agents and Git Worktrees
- **What users ask for:** One-click git worktrees per task that automatically copy or link untracked `.env` files, shared dependencies (`node_modules`) and build caches, assign non-colliding local ports, and detect cross-branch architectural clashes before merge time.
- **How strongly:** High among power users running 3 to 8 agents at once ("coder to conductor" workflow on Hacker News). Users complain that raw git worktrees isolate source files but collide on localhost ports, databases, test runners and missing untracked config files.
- **Sources:**
  - Cursor 2.0 Changelog, introducing Parallel Agents on isolated git worktrees (2025-10, vendor claim, https://cursor.com/changelog).
  - `smtg-ai/claude-squad` worktree and tmux orchestrator discussions (2025-2026, https://github.com/smtg-ai/claude-squad).
  - `BloopAI/vibe-kanban` multi-agent git worktree board documentation (2025-2026, https://github.com/BloopAI/vibe-kanban).

### Theme 5: Context, Auto-Compaction and Memory
- **What users ask for:** Configurable compaction thresholds, structural repo maps (AST symbols instead of noisy text dumps), and persistent task state on disk so compaction does not erase column names, constraints or failed debugging attempts ("compaction amnesia").
- **How strongly:** Very frequent among daily CLI and IDE agent users working on medium and large repositories.
- **Sources:**
  - `anthropics/claude-code` Issue #41037, "Add configurable context window limit / auto-compaction threshold" (2026-03, https://github.com/anthropics/claude-code/issues/41037).
  - `anthropics/claude-code` Issue #64619, "Automatic Context Compaction Fails After Large Codebase Analysis, Causing Excessive Token Usage" (2026-06, https://github.com/anthropics/claude-code/issues/64619).
  - Aider documentation, "Repository map" using tree-sitter symbol graphs (2025-2026, vendor claim, https://aider.chat/docs/repomap.html).

### Theme 6: Speed, Startup Latency and Tool Timeouts
- **What users ask for:** Fast session startup, shared or warm MCP servers that do not time out when several lanes start together, and progress-aware tool timeouts that do not kill long test or subagent calls mid-flight.
- **How strongly:** Frequent among multi-agent and Windows users, especially when stdio MCP servers or desktop wrappers spawn cold processes per agent.
- **Sources:**
  - `anthropics/claude-code` Issue #107472, "MCP servers time out when several sessions start at once" (2026-11, https://github.com/anthropics/claude-code/issues/107472).
  - `anthropics/claude-code` Issue #58687, "Cowork MCP client times out long-running tool calls despite server progress notifications" (2026-05, https://github.com/anthropics/claude-code/issues/58687).
  - `anomalyco/opencode` Issue #31293, "Severe latency when invoking agents via @mention in Desktop App (Windows)" (2026-06, https://github.com/anomalyco/opencode/issues/31293).

### Theme 7: Setup for a Beginner
- **What users ask for:** Clear readiness checks, working sign-in or API key setup on the first try, sensible default models and permission modes, and no silent auth fallbacks or stuck onboarding screens.
- **How strongly:** High among new adopters and cross-platform users on Windows and Linux.
- **Sources:**
  - `anthropics/claude-code` Issue #28176, "API key authentication accepts credentials at login but fails on first message" (2026-02, https://github.com/anthropics/claude-code/issues/28176).
  - `anthropics/claude-code` Issue #83633, "Login authenticates but has_finished_claudeai_onboarding=false walls existing paid Max account" (2026-08, https://github.com/anthropics/claude-code/issues/83633).
  - `openai/codex` Issue #56532, Windows desktop update blocked behind incomplete agent sandbox setup prompt (2026, https://github.com/openai/codex/issues/56532).

### Theme 8: Control for an Expert
- **What users ask for:** Deterministic lifecycle hooks (`PreToolUse`, `PostToolUse`, `Stop`, `SubagentStop`) that fire reliably in both interactive and headless (`-p`) modes, per-phase model routing (a reasoning model for planning and a fast model for edits), and custom slash commands and recipes.
- **How strongly:** Strong among staff engineers and automation builders who wire agents into CI or custom orchestrators.
- **Sources:**
  - `anthropics/claude-code` Issue #30143, "PreToolUse/PostToolUse hooks don't fire in non-interactive -p mode" (2026-03, https://github.com/anthropics/claude-code/issues/30143).
  - `anthropics/claude-code` Issue #40580, "PreToolUse hook exit code ignored for subagent tool calls" (2026-03, https://github.com/anthropics/claude-code/issues/40580).
  - Aider documentation, "Architect / Editor mode" splitting planning and editing models (2025-2026, vendor claim, https://aider.chat/docs/llms.html).

### Theme 9: Observability and Live Steering
- **What users ask for:** Per-agent and per-subagent live visibility (model, effort, context share, cost, current tool call, and distinct agent IDs in logs) plus the ability to steer or interrupt a running agent mid-task without losing its work or leaving zombie subagents.
- **How strongly:** Very high among multi-agent users; removing subagent status metrics in CLI tools triggers immediate user pushback.
- **Sources:**
  - `anthropics/claude-code` Issue #109446, "2.1.323 removed subagentStatusLine with no replacement: per-agent context, cost, model and effort are now invisible" (2026-11, https://github.com/anthropics/claude-code/issues/109446).
  - `anthropics/claude-code` Issue #90662, "PreToolUse/PostToolUse inside a running subagent are sometimes reported under a different agent_id" (2026-08, https://github.com/anthropics/claude-code/issues/90662).
  - `anomalyco/opencode` Issue #32388, "ACP subagents are invisible and can hang forever on permission prompts" (2026-06, https://github.com/anomalyco/opencode/issues/32388).

### Theme 10: Failure, Loops and Checkpoint Recovery
- **What users ask for:** Automatic git or shadow-repo checkpoints before each turn so `/undo` or `/rewind` restores both files and conversation state together, loop detection when a tool or stop hook fails repeatedly, and clean session resume that preserves sandbox modes and does not orphan child processes on auth expiry.
- **How strongly:** High across all users; out-of-sync file vs chat undo and stuck retry loops are top reliability complaints.
- **Sources:**
  - `anthropics/claude-code` Issue #29521, "VSCode Extension: Undo restores code but does not revert conversation state" (2026-02, https://github.com/anthropics/claude-code/issues/29521).
  - `anthropics/claude-code` Issue #103414, "Stop hook blocks turn 9 consecutive times and overrides turn ending" (2026-10, https://github.com/anthropics/claude-code/issues/103414).
  - `RooVetGit/Roo-Code` Issue #12087, provider error revert strips latest prompt from context window (2026, https://github.com/RooVetGit/Roo-Code/issues/12087).

## 2. How Harnesses Are Built

- **Claude Code (Anthropic, commercial CLI and IDE harness):** Runs a stateless-per-turn streaming tool loop (`--print --output-format stream-json` for headless runs) with built-in file read, edit, write, glob, grep, bash, web and `Task` subagent tools. Permissions use tiered modes (`plan`, `manual`/`ask`, `acceptEdits`, `auto`, `bypassPermissions`) backed by macOS Seatbelt and Linux Landlock/bubblewrap command sandboxes. Sessions persist as local JSONL files with `--resume`, `/compact` and `/rewind` checkpoints. It spawns subagents via the `Task` tool and coordinates parallel worktrees in desktop/CLI, while humans watch via terminal UI, custom `statusLine` scripts or stream-json logs and extend it with `CLAUDE.md`, slash commands, lifecycle hooks (`PreToolUse`, `PostToolUse`, `Stop`), plugins and MCP servers (vendor claim, 2025-2026, https://docs.anthropic.com/en/docs/claude-code and https://github.com/anthropics/claude-code).
- **OpenAI Codex CLI and App (`openai/codex`, open-source Rust/TS CLI and commercial app):** Runs an event-driven agent loop (`codex exec --json` for non-interactive runs) with shell, file patch (`apply_patch`), search and web tools. It enforces kernel sandboxing (`read-only`, `workspace-write`, `danger-full-access`) via Seatbelt on macOS, Landlock/bubblewrap on Linux and restricted tokens/containers on Windows, paired with approval policies. Sessions save as rollout JSONL files in `~/.codex/sessions` with thread resume and rate-limit telemetry. It supports subagents and multi-worktree threads in the desktop app and cloud tasks, watched through TUI, app diffs or JSON event streams and extended via `AGENTS.md`, skills and MCP servers (2025-2026, https://github.com/openai/codex).
- **OpenCode (`anomalyco/opencode`, formerly `sst/opencode`, open-source Go/TS TUI, desktop and server):** Uses a client-server loop where TUI, desktop or `opencode run --format json` clients talk to a local runtime backed by SQLite (`opencode.db`). It provides file read, edit, write, grep, glob, bash, web and `TaskTool` subagent delegation, guarded by `opencode.json` rules (`allow`, `ask`, `deny` per tool and `external_directory` boundaries) and built-in `plan` vs `build` agents. Sessions persist in SQLite with full fork and resume. Primary agents spawn `@explore` or `@general` subagents, humans steer via TUI tabs or JSON streams, and extension works through `AGENTS.md`, custom JSONC agents, slash commands, MCP and native `opencode acp` support (2025-2026, https://github.com/anomalyco/opencode).
- **Aider (`Aider-AI/aider`, open-source Python CLI):** Runs a turn-based edit-lint-test loop in the terminal using diff/search-replace edit formats and an AST-based tree-sitter Repository Map instead of exploratory file-read tool spam. Rather than an OS sandbox, it relies on git-native safety: every agent edit is an atomic git commit that the user can revert with `/undo`, and shell commands require confirmation unless auto-approved. Sessions resume via chat history files and `--restore-chat-history`. Instead of recursive subagents, it splits roles across an Architect model and an Editor model, watched through live diffs and test output and extended via `.aider.conf.yml` and convention files (vendor claim, 2025-2026, https://aider.chat/docs/repomap.html and https://github.com/Aider-AI/aider).
- **Cursor (Anysphere, commercial IDE):** Runs a multi-model Composer loop inside a VS Code fork with semantic codebase indexing, file edit, terminal, linter-feedback and browser tools. Local runs use workspace-scoped command allowlists and `.cursorignore`, while Cloud Agents run in isolated remote VMs (`.cursor/environment.json`). Sessions persist per Composer thread with per-step file/chat checkpoints. Since Cursor 2.0 (2025-10), it runs up to 8 Parallel Agents locally on separate git worktrees (`/best-of-n` or distinct tasks) and asynchronous Cloud Agents, watched through a multi-agent sidebar and unified diff review, and extended via `.cursor/rules`, skills, hooks and MCP (vendor claim, 2025-2026, https://cursor.com/changelog).
- **Cline and Roo Code (`cline/cline`, `RooVetGit/Roo-Code`, open-source VS Code extensions):** Execute a strict Plan/Act loop in the VS Code sidebar with file edit, ripgrep search, integrated terminal, headless browser and MCP tools. Permissions use granular auto-approve toggles per tool type (read, write, browser, execute, external paths) with command allow/deny lists. Sessions are stored per task folder with a shadow git repository that records a checkpoint after every step for one-click diff and restore. Roo Code adds specialized modes (Architect, Code, Debug) and "Boomerang" orchestrator sub-tasks that run in fresh context windows and return a summary to the parent, extended via `.clinerules`, `.roomodes` and MCP (2025-2026, https://github.com/cline/cline and https://github.com/RooVetGit/Roo-Code).
- **Zed Agent Panel and Agent Client Protocol (ACP, open-source Rust editor and protocol):** Standardizes the agent-editor loop over stdio JSON-RPC (`initialize`, `session/new`, `session/load`, `session/prompt`, `session/update`), acting as the Language Server Protocol for coding agents. Tools, file locations and diffs stream as structured `tool_call` updates while the client editor enforces permission prompts for writes and shell commands. Sessions serialize and reload across restarts via `session/load`, child sessions report in `_meta`, humans review inline multibuffer diffs in real time, and any ACP-compliant agent (OpenCode, Claude Code, Gemini, OpenHands, Aider bridges) plugs in via configuration plus MCP servers (vendor claim, 2025-2026, https://agentclientprotocol.com/).
- **OpenHands (`All-Hands-AI/OpenHands`, open-source Python SDK and platform):** Runs an event-sourced loop (`Action` -> `Runtime` -> `Observation` over an append-only `EventLog`) with bash, file editor, Jupyter IPython and browser tools. Its hallmark is a pluggable sandbox runtime (Docker containers, Kubernetes, Modal or local process) with security analyzers that score each action before execution. Sessions are replayed or resumed deterministically from the append-only event log, primary agents delegate to specialized micro-agents or parallel cloud conversations, humans watch via the web Agent Canvas or CLI/ACP, and extension uses repository micro-agents and MCP (vendor claim, 2025-2026, https://docs.all-hands.dev/ and https://github.com/All-Hands-AI/OpenHands).
- **Goose (`block/goose`, open-source Rust/TS CLI and desktop agent):** Operates a local daemon (`goosed`) loop driving tool calls from user prompts or YAML "recipes" with developer shell, file and screen tools. It executes locally with `ask`/`auto` permission tiers and `.gooseignore` rules, storing sessions as local transcripts resumable via `goose session`. Since 2025 it spawns parallel or sequential subagents scoped to a root path, humans watch through the CLI or Electron desktop app, and its entire architecture is MCP-first where every capability is an MCP extension over stdio or HTTP (2025-2026, https://github.com/block/goose).
- **Worktree and Org Orchestrators (`claude-squad`, `vibe-kanban`, `paperclip`):** Wrap existing CLI harnesses rather than writing a new model loop. `claude-squad` (Go TUI) pairs `tmux` panes with one `git worktree` per task so humans can watch, pause and diff parallel CLI agents (`smtg-ai/claude-squad`, 2025-2026). `vibe-kanban` (Apache 2.0 web board) maps Kanban cards to isolated worktrees with pre/post setup scripts and integrated diff review (`BloopAI/vibe-kanban`, 2025-2026). `paperclip` (MIT Node/React server) models an organization of agents with org charts, per-agent budgets, approvals and issue queues (`paperclipai/paperclip`, 2025-2026).

## 3. What MachineRoom Should Take (Ranked 1 to 15)

1. **Configurable worktree setup files and port env per lane (`Theme 4: Parallel agents and worktrees`).**
   - *Other tools:* Vibe Kanban and Cursor `.cursor/environment.json` copy untracked `.env` files and inject unique port variables per worktree.
   - *MachineRoom today:* `prepareWorktree` in `scripts/run-lane.mjs` creates the git worktree and links `node_modules` (`linkNodeModules`), but copies no untracked `.env` files and sets no per-lane port offset.
   - *Change:* Let project settings list untracked local files to copy into a new worktree and pass a deterministic `MACHINEROOM_LANE_PORT` env variable per lane slot.
   - *Size:* Small. *Changes what the owner sees:* Yes (one optional field in Project Settings).
2. **Pre-dispatch symbol/file overlap warning across active lanes (`Theme 4: Parallel agents and worktrees`).**
   - *Other tools:* Foremerge and worktree orchestrators flag when two active branches target the same files or symbols before work starts.
   - *MachineRoom today:* `src/briefs/briefs.js` parses a brief's `Files:` list and `src/ui/panels/runs.js` (`planLaneTasks`) pairs tasks with idle lanes, without checking if a running lane already touches those paths.
   - *Change:* Warn on the Dispatch confirm card and `/api/control/runs` when a new brief or task names paths already touched by an open lane run.
   - *Size:* Small. *Changes what the owner sees:* Yes (warning line on Dispatch confirm card).
3. **Prompt-cache hit rate and token burn velocity on the Cost Board (`Theme 1: Cost and quota`).**
   - *Other tools:* `ccusage` tracks cache read vs cache write ratios and token velocity per 5-hour block to catch prompt-caching regressions early.
   - *MachineRoom today:* `server/lane-costs.js` and `src/model/costs.js` sum `inputTokens`, `outputTokens`, `costUsd` and Codex `quota` windows, ignoring cache read/write breakdown and burn rate.
   - *Change:* Record `cacheReadTokens` and `cacheWriteTokens` from Claude, OpenCode and Codex logs in `runs.jsonl` and show cache hit share in `MetersPanel.jsx`.
   - *Size:* Medium. *Changes what the owner sees:* Yes (cache hit column in Meters).
4. **Loop detector for repeated identical failing tool calls in `mr-agent` and live lanes (`Theme 10: Failure and recovery`).**
   - *Other tools:* OpenHands security/loop analyzers and Cline halt or warn when an agent repeats the exact failing command or edit 3 times in a row.
   - *MachineRoom today:* `scripts/mr-agent.mjs` caps total steps at `MR_AGENT_MAX_STEPS` (200) and `src/ui/failureTray.js` lists recent failures, with no consecutive-loop stop.
   - *Change:* In `scripts/mr-agent.mjs`, inject a loop warning after 3 identical failing tool calls and abort after 5; in `server/lanes-source.js`, surface a loop badge when a CLI lane repeats the same failing command 4 times.
   - *Size:* Small. *Changes what the owner sees:* Yes (loop notice in Failure Tray / Inspector).
5. **Pre-turn git checkpoint sha on orchestrator and lane runs for one-click rewind (`Theme 10: Failure and recovery`).**
   - *Other tools:* Cline, Roo Code and Claude Code (`/rewind`) record a checkpoint before each prompt and revert code and conversation together.
   - *MachineRoom today:* `server/orchestrator.js` supports session fork and `scripts/run-lane.mjs` records base HEAD, but reverting a turn does not reset the worktree and chat together.
   - *Change:* Record the worktree HEAD sha on each turn/run start and offer a confirmed `Rewind to before this run` when the checkout has no unrelated changes.
   - *Size:* Medium. *Changes what the owner sees:* Yes (Rewind button in conversation/review).
6. **Lightweight symbol repo map for `mr-agent` and brief prompts (`Theme 5: Context and memory`).**
   - *Other tools:* Aider injects a compact map of file exports and function signatures so agents find targets without blind `search`/`read_file` turns.
   - *MachineRoom today:* `scripts/mr-agent.mjs` injects `AGENTS.md` or `CLAUDE.md` up to 20,000 characters (`src/harnesses/machineroom.js`) and offers `glob_files` and `search`.
   - *Change:* Build a cached 4,000-character export/signature index for files named in a brief (or top-level modules) and include it in `mr-agent` system context.
   - *Size:* Medium. *Changes what the owner sees:* No.
7. **Structured state summary file across autocompact in `server/orchestrator.js` (`Theme 5: Context and memory`).**
   - *Other tools:* Claude Code power users and Roo Code Boomerang tasks write a structured state block (goal, constraints, tried-and-failed, open files) before compacting.
   - *MachineRoom today:* `server/orchestrator.js` and `src/ui/AutocompactInput.jsx` trigger autocompact with custom compact rules text, without persisting a structured task-state block outside the summarized transcript.
   - *Change:* Keep a small per-orchestrator JSON state block (active branches, pending reviews, scope refusals) in the chat file and re-inject it verbatim after autocompact.
   - *Size:* Small. *Changes what the owner sees:* No.
8. **Shared warm MCP tool-list cache and progress-aware call timeout (`Theme 6: Speed and tool timeouts`).**
   - *Other tools:* Goose and MCP clients cache `tools/list` across sessions and extend timeouts when a server emits progress notifications.
   - *MachineRoom today:* `server/mcp.js` and `scripts/mcp-bridge.mjs` spawn a fresh stdio server per list/call with fixed `MCP_LIST_TIMEOUT_MS` (8s) and `MCP_CALL_TIMEOUT_MS` (15s).
   - *Change:* Cache `listAllMcpTools` per server config for 60 seconds in `server/mcp.js` so parallel lane starts do not stampede stdio servers, and reset the 15s timer on JSON-RPC progress notifications.
   - *Size:* Small. *Changes what the owner sees:* No.
9. **Pre-review automated check badge in `ReviewsPanel.jsx` (`Theme 3: Review of agent work`).**
   - *Other tools:* Cursor Cloud Agents and Vibe Kanban show whether the branch's test/build check passed before the human opens the diff.
   - *MachineRoom today:* `server/reviews.js` and `src/ui/panels/ReviewsPanel.jsx` show the branch, commit count, changed files and diff, while `scripts/run-lane.mjs` writes `testPassed` and `buildPassed` on the run record in `runs.jsonl`.
   - *Change:* Join the newest run record's `testPassed` and `buildPassed` flags onto each row of `GET /api/control/reviews` and show a pass/fail chip in `ReviewsPanel.jsx`.
   - *Size:* Small. *Changes what the owner sees:* Yes (check status chip on each Review row).
10. **Cascade parent permission mode and `external_directory: deny` to ACP and OpenCode subagents (`Theme 2: Trust and permissions`).**
    - *Other tools:* OpenCode issues (#41730, #43888) and Claude Code hooks highlight that child subagents must inherit non-interactive permission rules or they hang on unseen prompts.
    - *MachineRoom today:* `scripts/run-lane.mjs` and `server/orchestrator.js` write `OPENCODE_CONFIG` for the main process, and `scripts/acp-run.mjs` auto-allows the first option on permission requests without checking the lane's mode.
    - *Change:* Make `scripts/acp-run.mjs` refuse write/bash permission requests when the lane's mode is `plan` or `edits` (for bash), and include subagent permission inheritance in the generated `OPENCODE_CONFIG`.
    - *Size:* Small. *Changes what the owner sees:* No.
11. **Live subagent cost, model and context share in `Inspector.jsx` (`Theme 9: Observability and live steering`).**
    - *Other tools:* Users of Claude Code (#109446) and OpenCode demand per-subagent model, effort, token and cost visibility rather than rolling everything into the parent.
    - *MachineRoom today:* `server/claude-sessions.js` and `src/engine/agents.js` draw child subagent shapes, while `src/ui/agentContext.js` shows context and model mainly for top-level orchestrators and lanes.
    - *Change:* Parse model and token usage from child subagent logs in `server/claude-sessions.js` and `scripts/acp-run.mjs` and display them when a child shape is clicked in `Inspector.jsx`.
    - *Size:* Medium. *Changes what the owner sees:* Yes (model and token rows for clicked subagents).
12. **Architect-then-Editor two-step run option in Dispatch (`Theme 8: Control for an expert`).**
    - *Other tools:* Aider Architect mode and Roo Code Boomerang run a high-reasoning model in Plan mode first, then hand the plan to a cheaper coding model for edits.
    - *MachineRoom today:* The owner can manually switch an orchestrator from `Plan` to `Auto` (`docs/agents/FREE-HIERARCHY.md` Step 3), and `src/policy/route.js` routes a whole run to one lane and model.
    - *Change:* Add an optional `Plan on a reasoning lane first` toggle in Dispatch that runs a short `plan` run, saves the plan text, and starts the edit run with that plan appended.
    - *Size:* Medium. *Changes what the owner sees:* Yes (optional toggle in Dispatch).
13. **Harness auth and sandbox smoke test in `HarnessesSettings.jsx` (`Theme 7: Setup for a beginner`).**
    - *Other tools:* Codex and Claude Code users often pass `--version` checks while failing on the first turn due to expired OAuth tokens or broken Windows sandbox helpers (#28176, #56532).
    - *MachineRoom today:* `server/harness-settings.js` runs `<program> --version` with a 5-second timeout (`docs/agents/HARNESSES.md`) to mark a CLI harness `Ready`.
    - *Change:* Add an optional `Test connection` button in `HarnessesSettings.jsx` that runs a 1-token read-only probe (`--print` or model list auth check) and reports auth or sandbox errors in plain words.
    - *Size:* Small. *Changes what the owner sees:* Yes (Test button per harness in Settings).
14. **Claude Code 5-hour billing block estimator from local session logs (`Theme 1: Cost and quota`).**
    - *Other tools:* `ccusage blocks` computes active 5-hour session window usage and reset time directly from `~/.claude/projects/` JSONL timestamps.
    - *MachineRoom today:* `server/lane-costs.js` (`quotaRows`) reads active quota windows only for `codex` from Codex rollout files (P271).
    - *Change:* Compute the active 5-hour token block and reset time from `server/claude-sessions.js` and Claude lane run records and feed them into `quotaRows` in `server/lane-costs.js`.
    - *Size:* Medium. *Changes what the owner sees:* Yes (Claude 5-hour block row on the Cost Board).
15. **Deterministic post-tool lint/test hook option in `scripts/mr-agent.mjs` (`Theme 8: Control for an expert`).**
    - *Other tools:* Claude Code `PostToolUse` hooks and Aider auto-lint run a fast syntax or lint check immediately after `write_file`/`edit_file` so the agent fixes errors in the same turn.
    - *MachineRoom today:* `scripts/run-lane.mjs` runs `--test` after the whole task ends, while `scripts/mr-agent.mjs` runs checks only when the model chooses to call `run_shell`.
    - *Change:* Allow an optional `MR_AGENT_POST_EDIT_CHECK` command in `scripts/mr-agent.mjs` that runs after `write_file`/`edit_file` and appends any compiler/lint error to the tool result.
    - *Size:* Small. *Changes what the owner sees:* No.
