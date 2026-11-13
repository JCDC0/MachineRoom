# Review 27: the stream cap fix

Reviewed at `805fe5bc` on 2026-11-13. Read the P194 merge `9036d11c` with `git show -m --first-parent`, then traced `createSseWriter`, `write`, `allowBacklog`, `drop` and every caller in `server/index.js`. Ran `node node_modules/vitest/vitest.mjs run tests/bridge-stream.test.js`: 33 tests passed. Ran `npm run build`: passed.

| Id | File:line | What goes wrong and when | Smallest fix | Blocks a push? |
| --- | --- | --- | --- | --- |
| None | | | | |

## Review 26 status

- R1 is fixed. `server/index.js:430` destroys the response in `drop`, after `onDrop` takes it out of `clients`, `treeClients` and `folderClients` (`server/index.js:425-431`, `server/index.js:800-806`). `tests/bridge-stream.test.js:640` builds a real `ServerResponse` on a `Duplex` whose write never completes, then asserts one drop, `writableEnded === false` and `socket.destroyed === true`. The old `end()` fails that test, so it can fail. The fake stuck test at `tests/bridge-stream.test.js:658` now also asserts `destroyed === true` and `ended === false`.
- R2 is fixed. The reset, the history replay and the first tree pass `{ connect: true }` (`server/index.js:1472`, `1473`, `1477`, `1482`, `1500`, `1503`, `1507`), and `write` skips the cap check when `connect` is set (`server/index.js:436`). `allowBacklog` at `server/index.js:1517` runs once after those writes and sets the allowance to the queued backlog at that moment plus 8 MB (`server/index.js:450-453`). Later frames, changes, tree events and keepalives check that allowance. `tests/bridge-stream.test.js:756` stores twelve one-MiB frames, opens `?history=1` with a client that reads, receives frames 1 to 12 in order, sees the stream still open, then receives a live frame 13. The pre-merge bridge cut that client after 8 frames, so this test can fail.
- The fix does not pause history replay on backpressure as review 26 suggested. It exempts the connect writes instead, which the P194 brief asks for. The whole history is still written in one turn of the event loop.

## What I checked

- The allowance is always set. Every `/events` response that is not dropped during connect reaches `allowBacklog` at `server/index.js:1517`. A response dropped during connect is destroyed and never joins the client sets.
- The allowance does not grow. `allowBacklog` runs once per response, the key is the response in a `WeakMap` (`server/index.js:423`, `450-453`), and a reconnect is a new response with a new allowance. No frame or reconnect raises it.
- No write after `res.destroy()` throws. `write` returns before touching a dropped response (`server/index.js:435`), `res.write` is inside a try that drops (`server/index.js:441-446`), and the change write that follows a frame in `emit` (`server/index.js:1244-1247`) is a no-op when the frame write dropped the client.
- No allowance is kept after close. `dropped` and `allowances` are a `WeakSet` and a `WeakMap` (`server/index.js:422-423`). `onDrop` and the request `close` handler remove the response from all three client sets (`server/index.js:800-805`, `1512-1516`). Nothing strong holds a closed response.
- No connect write is checked against the cap. The reset, every history frame and every first tree write pass `connect: true`. `writeSseChange` does not pass it, but it is called only from broadcasts and timers, never inside the synchronous connect block.
- The tests can fail. The real stalled response test fails against the old `end()`. The allowance test at `tests/bridge-stream.test.js:696` fails if `allowBacklog` is not called or keeps the plain limit. The late-join test fails against the pre-merge bridge, as review 26 reproduced it.
- Residual, accepted by the brief: a client that joins with more than 8 MB of history is not checked during connect. It is dropped only when a later write pushes its queue past the backlog it joined with plus 8 MB. With no later traffic a stalled late joiner keeps that backlog. The kept history is at most 500 frames (`server/index.js:69`), so it stays bounded. Not a blocker.

## Other checks

Only the `/events` route uses the writer (`server/index.js:1456-1518`). The `/api/tree` route writes JSON directly and is not part of the stream cap. No application or test code was changed. The build passed. No full suite or visual check was run.
