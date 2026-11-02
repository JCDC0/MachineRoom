# Try a candidate beside the stable room

`npm run candidate -- LANE` builds one lane's viewer and starts that worktree's own room on port 5175. The stable room keeps its own port, so both can run side by side.

## Try the candidate

1. Start the stable room as usual, for example `npm run serve`. Leave it running.
2. From the main checkout run `npm run candidate -- opencode`.
3. Open the address it prints: `http://127.0.0.1:5175/?live&bridge=http://127.0.0.1:5175`.
4. Compare it with the stable room, then press Ctrl+C in the candidate terminal to stop it.

The script reads the lane's `worktree` from `docs/agents/lanes.json`, refuses a lane with no worktree and a worktree with uncommitted changes, checks the port before anything else, then runs the worktree's `npm run build` and starts its `bin/machine-room.mjs` with that worktree's `dist`.

It never starts Paperclip, never writes to the main checkout and never switches a branch.

The build and the candidate room run the lane's code before anyone merged it, so they get your environment without the variables whose names end in `_KEY`, `_TOKEN`, `_SECRET` or `_PASSWORD` or hold `API_KEY`. The candidate's decide route therefore answers that no key is set.

## Options

- `--port <n>` use another port when 5175 is taken. The script says `Port 5175 is in use. Pass --port.` when it is.
- `--root <folder>` is passed to the candidate room, the same way `npm run serve` takes it.
- `--help` prints the usage and starts nothing.

## Merge and restart

When the candidate looks right, merge the lane. Use the Reviews panel in the room, or merge by hand in the main checkout. Never push.

After the merge, stop the stable room, run `npm run build` in the main checkout, then start it again with `npm run serve`. The stable room now serves the merged build.
