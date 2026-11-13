# Hands-on check of the room, 2026-11-13 (second pass)

Codex could not run P227's check: its sandbox blocks the browser. The orchestrator ran it by hand instead, at 0.1.401 (main at 835a07cc). The tool was the desktop app's browser pane.

Setup: `node bin/machine-room.mjs up --port 5194 --no-open`, with `MACHINEROOM_RUNS` pointed at an empty folder under `%TEMP%` and no `--lanes`. The room was first opened on MachineRoom itself. Then a small git project under `%TEMP%` (package.json with a test script, four files in three folders, one commit) was opened through Projects, Open folder. Checks ran at 1280 by 800 and 1920 by 1080. No lane, orchestrator turn or paid call was started. The console showed no errors or warnings at any step.

Each item is marked `seen` or `inferred`. They are ordered most harmful first.

## Findings

1. **Dispatch says nothing when it cannot start a run** (seen). In a room started without `--lanes`, or with no code lanes, Dispatch shows only `No open briefs.` and `No runs yet.`. Nothing says why the project form is missing (`lanesMode && projectLanes.length > 0` in `DispatchPanel.jsx`). A new owner has no way to learn what to do.
2. **A small project's overview puts cards on top of each other** (seen, 1280 by 800, after Center). On the three-folder project, SRC/ and LIB/ overlapped behind the orchestrator at nearly the same screen spot (tops at 295 and 277 pixels). TEST/ stood in front of the camera at 427 by 151 pixels, about three times the size of the other cards, with its bottom 16 pixels above the lens edge. The room did not read as a ring.
3. **The transport's state word runs into the spend** (seen, 1280 wide). The `waiting for you` span ends at 739.5 pixels and `.transport-spend` starts at 737.4, so the line reads `waiting for you$0.00 TODAY`. At 1920 wide there is room, but the two sit with no gap.
4. **The git graph's branch labels pile up at its tip** (seen). With five lane branches one commit off main, the labels at the newest commits draw over each other and none can be read (`src/engine/gitTree.js`, `labels`).
5. **A replay of the live room says to connect** (seen). After the Replay switch, the conversation says `This is a recorded run. Connect to your project to talk to the orchestrator.` with a CONNECT button, though the bridge is connected and Live is one click away (`src/ui/lowerHalf.js`).
6. **The doctor prints profile paths in full** (seen, earlier pass). The runs folder and a lane program's path, such as the Claude program, print with the user's profile folder, while the rest of the bridge masks it with `printedRunsFolder` (`server/doctor.js` line 171 and the runs folder line).
7. **Meters' and Reviews' Refresh buttons are larger** (seen). They are 105 by 41 pixels at 16 pixel type, against Team's 67 by 26 at 11 pixels: their `.panel-toolbar` button has no rule, while `.agent-builder-toolbar-actions button` has one.
8. **`Days to keep` wraps onto three lines** (seen) in Settings, Storage, beside its number box.
9. **Storage usage takes about 5 seconds** (seen) on MachineRoom with 17 lane worktrees, about 2.5 GB. Whether a loading line shows in that time was not checked (inferred).
10. **The waiting card counts session readers as agents** (seen). On the small project, which has no Claude or OpenCode sessions, it says `3 agents ready: Claude Code session, Orchestrator, OpenCode session` and `WORKING 0 / 3`.
11. **Two words for the same orchestrator state** (seen). The transport says `waiting for you` while the inspector on the same orchestrator says `IDLE`.
12. **ROOM.md said the page does not scroll** (seen, fixed at f7bffcfe). U158 made the first screen the lens and the page scroll to the lower half. Lines 7 and 53 still described the older one-frame layout and a 56 percent lens.

## Working as described

- The connect screen, the live room and the menu row.
- Control's Dispatch, Tasks, Meters (a true $0.00), Team and Reviews.
- Settings with Storage: counts, plus a Preview that says nothing is old.
- The lower half's sidebar, conversation and inspector follow a live Claude Code session.
- The sidebar tabs. A conversation's `...` menu: Pin, Rename, Fork, Export, Mark as unread, Archive and Delete. Each disabled item names its reason, for example `This conversation has no messages to export.`.
- The inspector:
  - On a folder: the path and the file list.
  - On a file: size, last change and preview.
  - On the orchestrator: through key 1.
  - On the git tree: the branch, the changes and a graph that showed a merge made seconds before, in about 0.6 seconds.
- Projects: the branch filter (`P23` gave `Showing 3 of 249 branches.`, case-insensitive, and named a branch held by another worktree) and Open folder, which listed the sibling folders and opened the small project.
- Help: the shortcut list and its title.
- Replay: plays the recorded window, 4:17 here.
- The failures tray and the web tunnel.
