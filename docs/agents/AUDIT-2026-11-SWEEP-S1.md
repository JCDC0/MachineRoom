# Sweep S1: the bridge

P506. Read at 0.1.401, checkout `f98cf45b`, on 2026-11-17. Only this audit changes.
The requests below use an allowed localhost Host. Reproductions used synthetic data, direct route calls and real Windows junctions. No real credentials were read.

## S1-1. P1: static and music requests follow links outside their roots

Where: `server/static.js:51`, `server/static.js:84`, `server/music.js:276`, `server/music.js:310`.
The checks constrain the spelled path, then `stat`, `readFile` and the music stream follow junctions or symlinks. Neither handler checks the real target. Music also serves names outside its audio extension list. A link in either served folder therefore exposes files outside that folder, without the page-Origin requirement or masking of `/api/file`.
See it: put a junction named `alias` under the static folder pointing to a separate folder containing a harmless `private.txt`. `GET /alias/private.txt` returns its contents with 200. Repeat with an `album` junction under the music folder and `GET /music/album/private.txt`, with no Origin. Both returned the outside marker in the reproduction. This requires a link already present in a served folder.
Fix: resolve the root and target with native realpath and reject targets outside the real root before reading. Restrict music reads to supported audio names as well.

## S1-2. P2: a late model fetch overwrites newer endpoint settings

Where: `server/endpoints.js:551`, `server/endpoints.js:565`.
Quick connect saves its captured endpoint list, waits for the provider, then saves that old list again with model details. A save or delete completed during that wait is undone. A deleted endpoint can return, or a newly saved endpoint can disappear despite its successful response.
See it: hold the fake provider response for `POST /api/endpoints/quick` after it starts fetching models. Save a second endpoint through confirmed `POST /api/endpoints`. Release a successful model response. Reading endpoints then loses the second endpoint. This order reproduced the loss.
Fix: after the fetch, read the current list again and update only the same endpoint if its connection settings still match. Leave a deleted or changed entry alone.

## S1-3. P2: MCP public replies bypass credential masking

Where: `server/mcp.js:117`, `server/mcp.js:118`, `server/mcp.js:747`.
The public server object removes env values but returns args and URL unchanged. Tool results and error problems also go straight to JSON. Credentials in command arguments, URL query parameters or a tool answer reach the page unchanged. This differs from the masked file and conversation readers.
See it: pass a recognizable synthetic credential assignment in a server argument to `publicMcpServer`; it survives. Have a fake HTTP MCP tool return the same assignment, then call confirmed `POST /api/mcp/call`. Its result survives too, although `maskKeys` masks that exact input. Both paths were reproduced without a real server or credential.
Fix: mask credential-bearing text in public metadata, results and problems. Keep private connection settings separate so editing a masked display cannot replace the saved value.

## S1-4. P2: run history masks commits but returns raw notes and paths

Where: `server/runs.js:1831`, `server/runs.js:1995`, `server/runs.js:1996`.
`maskRecordCommits` changes only commits and otherwise returns the record intact. The recent and last lists expose raw notes, tasks and log paths. A refusal note can contain a credential printed by a harness, and the normal runs location can carry the owner's home path. Masked live output does not protect these later reads.
See it: seed a temporary `runs.jsonl` with a visible brief run whose note holds a recognizable synthetic credential assignment and whose log uses `C:\Users\<name>`. `GET /api/control/runs` returns both unchanged. The direct route reproduction confirmed this with no Origin.
Fix: sanitize a public copy of each record's free text and displayed profile paths before building recent, last and attention replies. Keep disk paths intact internally.

## S1-5. P2: review diffs return credentials unchanged

Where: `server/reviews.js:828`, `server/reviews.js:835`.
The full git diff is truncated and sent as patch text without either key or profile-path masking. Reviewing a branch that accidentally committed a credential therefore exposes it in the response and patch viewer, including removed credential lines. The nearby claims reader already masks its text.
See it: make a fake git runner answer the diff command with an added line containing a recognizable synthetic credential assignment. `GET /api/control/reviews/audit/diff` returns the unchanged patch with 200. The direct route reproduction verified that `maskKeys` would have removed the assignment.
Fix: mask the display patch before truncating and returning it. Keep git's original bytes for merge operations.

## S1-6. P2: a temporary-folder error leaves connection tests locked

Where: `server/harness-probe.js:80`, `server/harness-probe.js:81`, `server/harness-probe.js:104`.
The harness enters the running set before temporary-folder creation, outside the try/finally that releases it. A full disk or denied temp folder makes the first request fail and every later connection test of that harness answer 409 until the bridge restarts, even after the folder problem is fixed.
See it: inject one `ENOSPC` failure into `mkdtempSync`, call `probeHarness`, restore the function and retry. The first call rejects; the retry returns the running-probe refusal. This was reproduced without starting a harness.
Fix: put temporary-folder creation inside the protected try/finally, and remove the folder only if creation succeeded.

Checks with no fault found: the bridge checks Host and any supplied Origin before routing (`server/index.js:1749`). Its shared request JSON reader enforces a byte limit (`server/index.js:453`). The inspected git and merge write guards release in finally blocks (`server/git.js:540`, `server/reviews.js:1270`). The file reader checks native real paths, refused names and size (`server/files.js:118`). Storage rechecks archive eligibility and destination containment before removing a source (`server/storage.js:843`). The inspected git calls use hidden windows and time limits. Real harnesses, browser behavior and network providers were not exercised.

Checked and fine
