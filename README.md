# MachineRoom

MachineRoom shows coding agents working on one project as a 3D machine room in your browser.

![The overview of the room](docs/images/overview.png)

## What you see

The room puts each agent on a ring in the middle, as its own wireframe shape. Your project folders sit around it as flat cards, and a working agent sends a light trail to the row of the file it touches. White is activity, yellow is active, green is finished work and red is failure.

## What you can do

- Watch your own Claude Code and OpenCode sessions live on the project.
- Ask the orchestrator for work and let it plan, start and follow the runs.
- Run tasks on lanes, each in its own git worktree.
- Review a lane's branch and merge it when it passes.
- Replay a recorded run.
- See the cost per lane for this month.

## Quick start

You need Node 24 or newer, git, a browser with WebGL, and Claude Code, OpenCode or AGY signed in, or a Direct API key.

```
cd <MachineRoom folder>
npm install
npm run build
npm link
```

Then, from any project folder:

```
machineroom
```

The room opens in your browser on that folder after a short check of the project, git and the lane programs. Run `npm run build` again in the MachineRoom folder after you pull a new version.

No project at hand? Open `/?replay&fixture=scenario-i&tour` on the room's address to take the demo tour.

![One touched card, close up](docs/images/closeup.png)

Follow mode close up on the card an agent is touching.

![The control drawer open on Dispatch](docs/images/drawer.png)

The control drawer open on Dispatch.

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
