# Review 48: P473 to P476

Reviewed `77b0deb9..70771b05`. Scope: MCP progress, Plan by default, owner lane messages and ACP permissions. Assumed one owner page with several local lanes.

## Findings

### R48-1. Medium: malformed progress extends an MCP call

- File: `server/mcp.js:260`.
- The check accepts any matching token. It does not require a JSON-RPC notification or a numeric `progress`. A broken notice resets the idle timer on both transports and can hold a silent call until the ten-minute ceiling.
- See it: send `{ method: 'notifications/progress', id: 99, params: { progressToken: TOKEN } }` every ten seconds for the active call. There is no valid progress value, but the call stays alive. An in-memory stdio probe confirmed this with shorter timers.
- Fix: validate the notification envelope and its progress fields before resetting the timer. Add malformed-notice cases for both transports.

### R48-2. Medium: valid HTTP progress can be lost

- File: `server/mcp.js:486` and `server/mcp.js:492`.
- The stream reader only finds LF blank lines. CRLF events never reset the timer. Also, when the first chunk has no complete event, `cut` is -1 but `seen` becomes 1. A chunk containing only `d` drops the start of the first `data:` field.
- See it: use a 300 ms idle limit, send one valid progress event at 200 ms, and answer at 450 ms. LF succeeds. CRLF fails. Splitting the first LF event after its first byte also fails. All three cases were probed in memory.
- Fix: consume only complete SSE events, accept CRLF separators, and keep an incomplete event intact. Test both separators and split boundaries.

### R48-3. High: Auto collapses traversal before checking a link

- File: `scripts/acp-run.mjs:126`.
- On POSIX, `resolve` removes `..` before `realpath` sees a symbolic link. For `/project/escape` pointing to `/outside/sub`, the location `escape/../victim.txt` is checked as `/project/victim.txt`, although the filesystem reaches `/outside/victim.txt`.
- See it: create that link and ask for an Auto edit at that relative location. The permission is allowed. An in-memory trace with POSIX path functions confirmed that the link component never reaches `realpath`; a real Linux filesystem run remains unverified.
- Fix: reject `..` path components before normalization, or resolve links before processing parent components. Add a link-plus-parent traversal test.

### R48-4. High: split tasks ignore Plan by default

- File: `src/ui/panels/DispatchPanel.jsx:887`; caller behavior confirmed at `src/ui/panels/runs.js:369`.
- The split-task start forwards no mode. With `Start new runs in Plan` checked, selecting one lane per task still starts each lane in its saved mode. A lane saved in Bypass can edit and run commands. This also bypasses the unsupported-Plan warning shown for a single lane.
- See it: enable the setting, enter two tasks, choose one lane per task, and confirm with Plan-capable lanes saved in Bypass. Their start bodies omit `mode`. A direct split helper probe confirmed the omission.
- Fix: carry the project default into each split pair and send Plan for each capable lane. Show the existing warning for each lane without Plan. Add a split dispatch test.

### R48-5. Low: saved ACP choice lanes change default without a migration note

- File: `src/control/modes.js:17` and `src/control/modes.js:55`; resolution caller: `scripts/run-lane.mjs:1749`.
- Adding Auto changes `defaultMode('acp')` from null to Auto. Previously a saved `cli.mode: 'choice'` was removed before spawning and the ACP runner used Bypass. The same saved lane now uses Auto and refuses commands. The new changelog only explains lanes without a mode, at `docs/agents/CHANGELOG.md:11`.
- See it: start the same saved ACP choice lane before and after this diff without a run override. A comparison with the base revision confirmed null before and Auto after. The new test at `tests/acp-permissions.test.js:93` expects Auto but does not document the change for owners.
- Fix: document the choice-lane default change and how to retain Bypass explicitly, or preserve the old default.

## Checked and fine

- Project settings patch each known field without clearing the other. Non-boolean Plan values are refused. Single-lane Dispatch uses Plan for capable lanes and warns when Plan is unavailable.
- The stdio ceiling has its own timer. A different progress token does not extend it. HTTP timer rearming also retains its fixed ceiling. The existing stdio fake-clock ceiling test passed; no real ten-minute wait was run.
- Owner lane messages are marked owner. Non-page senders cannot set the per-message interrupt override. Sub tokens retain the sector gate, and the bridge rejects an unapproved Origin before routing. Lane tickets retain the existing lane-to-lane message path without owner identity.
- Status copy says `Read by the runner`, with no claim that the model acted. Native lanes skip external interruption.
- ACP rejects missing kinds, missing edit locations, outside edit locations and new files behind an outside link. Run overrides reach `lane.cli.mode` and the runner. Backup selection retains its existing fixed-mode rules; no new loss of mode forwarding was found.
- Validation before the audit file: 177 tests, 175 passed and 2 failed across 10 files. Inspector ACP startup timed out and its cleanup hit EPERM. Lane interrupt continuation timed out and its cleanup hook timed out. These failures were not proved to be regressions or the named baseline failures.
- `npm.cmd run build` passed. No source or test changed, so the test count stays unchanged; no second test run followed this Markdown addition. No full suite, provider call, screen check or real Linux traversal run was performed. Process-list access and temporary-folder removal were blocked by the sandbox.

Checked and fine
