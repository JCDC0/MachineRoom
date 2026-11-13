# MachineRoom

MachineRoom shows coding agents working on one project as a 3D machine room in your browser.

![The overview of the room](docs/images/overview.png)

## What you see

The room puts each agent on a ring in the middle, as its own wireframe shape. Your project folders sit around it as flat cards, and a working agent sends a grey tunnel to the card of the file it touches. Each agent has its own colour: its stars fly along the tunnels, and camera brackets in that colour mark the folder and file it is touching. White is activity, yellow is active, green is finished work and red is failure.

After a minute without input, the menu and the transport slide away, the lens fills the whole window and the room turns slowly. Any key, click or scroll brings them back.

![The room in the full window after a minute idle](docs/images/full-lens.png)

## What you can do

- Watch your own Claude Code and OpenCode sessions live on the project.
- Ask the orchestrator for work and let it plan, start and follow the runs.
- Run tasks on lanes, each in its own git worktree.
- Review a lane's branch and merge it when it passes.
- Replay a recorded run.
- See the cost per lane for this month.

## Quick start

You need Node 24 or newer, git, a browser with WebGL, and Claude Code, OpenCode or AGY signed in, or a Direct API key.

### First run

Run these in the MachineRoom folder.

```
npm install
npm run build
npm run serve -- doctor
```

On Windows PowerShell, use `npm.cmd` instead of `npm` when the script policy refuses it, and `npm.cmd link` to link. Leave the execution policy as it is.

Each command prints one line when all is well.

- `npm install` prints `added N packages`, or `up to date` when the packages are already there.
- `npm run build` prints `built in` and the time.
- `npm run serve -- doctor` prints `All checks passed.` If the folder is not a git repository, it prints `All checks passed, 1 warning.` and still exits 0.

Link the command once:

```
npm link
```

Then, from any project folder:

```
machineroom FOLDER
```

It prints `MachineRoom is running.` and the address. Without `npm link`, run this in the MachineRoom folder:

```
npm run serve -- up --root FOLDER
```

It prints the same line.

The room opens in your browser on that folder after a short check of the project, git and the lane programs. Run `npm run build` again in the MachineRoom folder after you pull a new version.

No project at hand? Open `/?replay&fixture=scenario-i&tour` on the room's address to take the demo tour.

![One touched card, close up](docs/images/closeup.png)

Follow mode close up on the card an agent is touching.

![The control drawer open on Dispatch](docs/images/drawer.png)

The control drawer open on Dispatch.

## Lanes

A new room has the orchestrator and no lane. Make a lane in the Agents tab: open the family tree, press Add child on the orchestrator, and fill in the label, harness, model and effort. Each lane runs in its own harness on the owner's account.

Settings only shows or removes lanes. Remove from project hides a lane in that project. Delete everywhere removes a lane you made across all projects.

`MACHINEROOM_LANES_DIR` points a room at another lane list, which is how MachineRoom's own development runs its lanes.

## Learn more

- [Using the room](docs/GUIDE.md): settings, the orchestrator, lanes, replay, keys and common problems.
- [Working on MachineRoom](CONTRIBUTING.md): setup for development, tests and the review loop.
- [How it is built](docs/agents/ARCHITECTURE.md): the room, the bridge and the data flow.

## Made with

MachineRoom is built by coding agents that the room itself shows, all under the owner's direction:

- [Claude Code](https://claude.com/claude-code) as the orchestrator and a lane.
- [OpenCode](https://opencode.ai) as a build lane.
- [AGY](https://antigravity.google) (Google Antigravity) as a build lane.
- [Hermes Agent](https://github.com/NousResearch/hermes-agent) as an earlier orchestrator.

## Licence

MachineRoom is released under the MIT licence. See [LICENSE](LICENSE).

## History

MachineRoom grew out of [Paperclip](https://github.com/paperclipai/paperclip), where its idea of a company of agents with tasks, budgets and approvals comes from. It is an independent project, not made by or endorsed by Paperclip. The room now runs its agents through its own lane runner (`npm run run-lane`) and follows your own sessions.
