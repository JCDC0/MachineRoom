# Can the room ship as a page inside Paperclip? (E2a)

Decision (the owner, 2026-10-22): keep the separate app and do not build the plugin page for now. It adds nothing to the way the owner works, it would let a key reach the browser before masking and turn the confirm rule into a page-only check, and Paperclip's plugin runtime is early. Come back to it if the owner starts working inside Paperclip's own UI often, or if people ask for it after the public release.

Research only, on the installed `paperclipai` 2026.1012.0 (`@paperclipai/server`, `@paperclipai/plugin-sdk` and `@paperclipai/shared`, all 2026.1012.0). Nothing here was run against a real Paperclip. The short answer: yes for the viewer, through a small plugin whose page holds the built room in a same-origin iframe; no for lane runs, reviews and merges, which stay with the bridge on this machine. The separate app stays the main window.

## 1. What a plugin page is

A Paperclip plugin is an npm package with a manifest, a worker and, if it has UI, a UI folder. The host installs it, starts the worker as a child process and loads the UI into Paperclip's own React app.

What I read:

- `@paperclipai/plugin-sdk/README.md`: the SDK surface, the slot types, the capabilities, the hooks and the deployment caveats.
- `@paperclipai/plugin-sdk/dist/types.d.ts` (the worker `ctx` clients, among them `PluginLocalFoldersClient` and `PluginProjectsClient`), `dist/ui/hooks.d.ts`, `dist/ui/types.d.ts` and `dist/bundlers.js` (`createPluginBundlerPresets`).
- `@paperclipai/shared/dist/validators/plugin.js` (`pluginManifestV1Schema` and the slot rules) and `dist/constants.js` (`PLUGIN_EVENT_TYPES`, `PLUGIN_CAPABILITIES`).
- `@paperclipai/server/dist/routes/plugins.js`: every `/api/plugins/*` route and its auth check.
- `@paperclipai/server/dist/routes/plugin-ui-static.js` (`pluginUiStaticRoutes`, the `/_plugins/:pluginId/ui/*filePath` route).
- `@paperclipai/server/dist/services/plugin-loader.js` (`pluginLoader`, `installPlugin`, `resolveDeclaredPluginEntrypoints`, `isPluginPackageName`, `buildPluginWorkerEnv`, `getPluginUiContributionMetadata`).
- `@paperclipai/server/dist/services/plugin-worker-manager.js` (`spawnProcess`, the RPC timeouts and the crash backoff).
- `@paperclipai/server/dist/services/plugin-lifecycle.js` (the states), `plugin-event-bus.js`, `plugin-local-folders.js` (`listPluginLocalFolderEntries`), `plugin-runtime-sandbox.js` and `bundled-plugins.js`.
- `@paperclipai/server/dist/services/activity-log.js` (where plugin events come from).
- `@paperclipai/server/dist/middleware/auth.js` (`actorMiddleware`) and `middleware/board-mutation-guard.js` (`trustedBoardMutationOrigin`).
- `@paperclipai/server/dist/realtime/live-events-ws.js` (`authorizeUpgrade`).
- The built Paperclip UI, `@paperclipai/server/ui-dist/assets/index-*.js`, for how it loads a plugin module (`importPluginModule`, `rewriteBareSpecifiers`) and how it renders a launcher with the `iframe` environment.

The package refers to `doc/plugins/PLUGIN_SPEC.md` and `PLUGIN_AUTHORING_GUIDE.md`. They are not in the npm package, so I did not read them.

### The package and the manifest

- The package's `package.json` names its parts in a `paperclipPlugin` object with `manifest`, `worker` and `ui` paths (`resolveDeclaredPluginEntrypoints`). An npm name must start with `paperclip-plugin-`, or be scoped with a local part that starts with `plugin-` (`isPluginPackageName`). A local folder install has no name rule.
- The manifest (`pluginManifestV1Schema`) needs `id`, `apiVersion: 1`, `version`, `displayName`, `description`, `author`, `categories`, at least one capability and `entrypoints`. `entrypoints.worker` is required even for a plugin that only adds UI.
- Optional parts: `instanceConfigSchema`, `jobs`, `webhooks`, `tools`, `database`, `apiRoutes`, `localFolders`, `launchers` and `ui.slots`, among others.

### How a plugin adds UI

- `ui.slots` names where a component mounts. The types that matter here:
  - `page`: a full page at `/plugins/:pluginId`, or a company page when the slot has a `routePath` (a single lowercase slug). It needs `ui.page.register`.
  - `sidebar`: a link in the company sidebar. It needs `ui.sidebar.register`.
  - `dashboardWidget` and `detailTab` (on a project, issue, agent, goal or run) also exist.
- `ui.launchers` names buttons and menu items the host draws. A launcher's `render.environment` is `hostInline`, `hostOverlay`, `hostRoute`, `external` or `iframe`.
- The host lists every ready plugin's slots and launchers at `GET /api/plugins/ui-contributions`. The UI entry file is always `index.js` in the UI folder (`getPluginUiContributionMetadata`).
- Loading a slot module (`importPluginModule` in the built UI):
  - The host fetches `index.js` as text and rewrites its bare imports of `react`, `react-dom`, `react/jsx-runtime` and the SDK UI package to the host's own copies (`rewriteBareSpecifiers`).
  - It then imports the result from a blob URL.
  - So a slot module shares the host's React, which is 19.2.8 in this build. It must be one file, because a relative import cannot resolve from a blob URL. This last point is my reading of the code, not something I tested.
- Loading a launcher with the `iframe` environment: the host draws an iframe at `/_plugins/:pluginId/ui/<target>`, full width and at least 24rem high.
- Serving the UI folder (`pluginUiStaticRoutes`):
  - The host serves the folder at `/_plugins/:pluginId/ui/*` on Paperclip's own origin.
  - It serves only plugins in the `ready` state and checks company access only when the request names a `companyId`.
  - It sends a content type for `.html`, `.js`, `.css`, `.json`, `.woff2` and other common types, but none for `.jsonl`.
  - It sets no frame header, and the Paperclip app sets no Content-Security-Policy outside a few routes.

### How the UI talks to the server, and with what auth

- The UI calls its own worker through `usePluginData` and `usePluginAction`. These post to `POST /api/plugins/:pluginId/bridge/data` and `/bridge/action`, which check `assertBoardOrgAccess` and company access for a given `companyId`.
- The worker pushes events to the UI with `ctx.streams.emit`. The UI reads them with `usePluginStream`, an event stream on `GET /api/plugins/:pluginId/bridge/stream/:channel`.
- A worker call times out after 30 seconds by default, and after 15 minutes at most (`DEFAULT_RPC_TIMEOUT_MS`, `MAX_RPC_TIMEOUT_MS`).
- The README says it plainly: plugin UI runs as same-origin JavaScript in the main app and can call every Paperclip HTTP route with the board session, so capabilities are not a frontend sandbox.
- Paperclip's write guard (`trustedBoardMutationOrigin`) accepts a board write only from Paperclip's own origin. A plugin page passes that check. The room on its own port does not, which is one reason the bridge exists.
- The live event socket (`authorizeUpgrade`) accepts the board's session cookie, or anyone in `local_trusted` mode. So a same-origin page can open `/api/companies/:id/events/ws` itself.
- In `local_trusted` mode every request is the local board, with instance admin rights (`actorMiddleware`).

### What a worker can read and do

- `spawnProcess` starts the worker with Node's `fork`. The environment is cut down to `PATH`, `NODE_PATH`, `PAPERCLIP_PLUGIN_ID`, `NODE_ENV`, `TZ` and a few deployment values; model keys pass only to sandbox-provider plugins (`buildPluginWorkerEnv`).
- There is no sandbox in this build. The `vm` loader in `plugin-runtime-sandbox.js` is not imported by the loader or the worker manager. A worker is a normal Node process on the Paperclip machine: it can read files, start programs and open sockets. Capabilities gate only the host services on `ctx`.
- Events (`ctx.events.on`, with `events.subscribe`): the domain events in `PLUGIN_EVENT_TYPES`, all fed from the activity log (`activity-log.js`).
  - Run events are `agent.run.started`, `finished`, `failed` and `cancelled`.
  - There is no event for a run log chunk. The worker does not see `heartbeat.run.log` frames.
  - The SDK has no client for the heartbeat run log.
- Projects (`project.workspaces.read`): `ctx.projects.listWorkspaces` and `getWorkspaceForIssue` give a workspace with its `cwd`.
- Local folders (`local.folders`): `ctx.localFolders.list` walks a folder the operator configured.
  - It returns at most 5000 entries (default 1000), sorted by name, with no gitignore and no git (`listPluginLocalFolderEntries`).
  - Reads and writes stay inside the configured root.
- Other host services: issues, comments, agents, goals, costs, activity, plugin state, jobs on a cron schedule, webhooks and outbound HTTP, each behind its capability.
- Routes: `apiRoutes` adds JSON routes under `/api/plugins/:pluginId/api/*`. The host checks auth and company access before it calls the worker's `onApiRequest`.

### Install, enable, update, remove

- `POST /api/plugins/install` with `{ packageName, version }` runs `npm install SPEC --prefix ~/.paperclip/plugins --ignore-scripts` (`DEFAULT_LOCAL_PLUGIN_DIR`). With `{ packageName: PATH, isLocalPath: true }` it loads a local folder after it resolves the real path. An instance admin must call it, and an operator can hide plugin management.
- `POST /api/plugins/:pluginId/enable` and `/disable`, `POST /api/plugins/:pluginId/upgrade` with a version, and `DELETE /api/plugins/:pluginId` (with `?purge=true` to drop its data). Each needs an instance admin.
- The lifecycle (`plugin-lifecycle.js`) moves through `installed`, `ready`, `disabled`, `error`, `upgrade_pending` and `uninstalled`. An upgrade that asks for new capabilities waits in `upgrade_pending`.
- A worker that crashes restarts after 1 second, doubling up to 5 minutes, and the host gives up after 10 crashes in 10 minutes.
- The README notes that a runtime install needs a writable disk and `npm` at run time, and network access to the registry for an npm install.

### What a plugin may not do

- It may not claim a core route. Its routes live under `/api/plugins/:pluginId/api/*`.
- It may not emit a core event, and it may not see or touch another plugin's subscriptions (`plugin-event-bus.js`).
- It may not use a host service it did not declare.
- Its database namespace may create and write only its own tables.
- Nothing stops its worker or its UI from doing what any local program or same-origin script can do. The README calls both trusted code.
- `ctx.assets` is not supported in this build.

## 2. Could the room run there, part by part

Two ways to put the room on a plugin page:

- A slot module. The room becomes `index.js` and Paperclip mounts it inside its own app.
  - Today's room does not fit this way:
    - It would run on Paperclip's React 19.2.8, not its own 19.3.1.
    - three.js and the whole room would have to be one file.
    - `src/styles.css` sets rules on `*`, `html`, `body` and `button`, which would restyle all of Paperclip.
    - `Stage.jsx` and `Assistant.jsx` listen for keys on `window`, so `C`, `L`, `T`, `F`, `0` to `9`, `/` and `?` would fire while the owner types elsewhere in Paperclip.
  - Each of these can be fixed, but it is a port of the room.
- An iframe. A tiny slot module renders an iframe that points at the built room in the plugin's UI folder, at `/_plugins/:pluginId/ui/room/index.html`. Paperclip's own `iframe` launcher does the same.
  - The room keeps its own document, React, CSS and keys.
  - It is still on Paperclip's origin, so it has the board session.
  - The one change the build needs: `vite.config.js` sets no `base`, so the built `index.html` asks for `/assets/...` at the origin root, which is Paperclip's own UI. The plugin build needs a relative base (`./`).

I recommend the iframe. The rest of this section assumes it.

### The event stream

- Today: the bridge holds Paperclip's socket. It restores chunks Paperclip cut at 8192 characters from `/api/heartbeat-runs/:id/log`, masks keys in `chunk`, `message` and `error`, keeps 500 frames for a late join and counts unread tool lines.
- In the iframe: the page can open `/api/companies/:id/events/ws` on its own origin. This is today's proxy route (`discover` and `socketUrl` in `src/live/source.js` with a base of `''`), with no Vite proxy needed.
  - The page can also read the run log route itself, so chunk restore can move into the page. The code in `server/index.js` would need to move to `src/live` and run in the browser.
  - Key masking can run in the page (`maskKeys` is in `src/briefs/audit.js` and has no Node imports), but the raw key then reaches the browser before it is masked. That is weaker than today's rule that a key never reaches a page.
  - Paperclip's own run pages already show the same log to the same signed-in user. Whether that is enough is the owner's call.
  - Late join: the page gets only frames from the moment it connects, as on the proxy route today.
- A worker cannot do the bridge's job inside Paperclip: it gets no log chunks (see section 1).

### The file tree

- Today: the bridge lists the project with `git ls-files -z` and pushes new files as `tree` events.
- In Paperclip, three ways:
  - `ctx.localFolders.list`: capped at 5000 entries, no gitignore, so `node_modules` fills the cap. Not enough for a real project.
  - A worker that runs `git ls-files -z` itself on the workspace `cwd` from `ctx.projects.listWorkspaces`. This works because the worker is not sandboxed. It is outside the capability model, so it rests on the trusted-code rule, and the worker would also need a file watcher.
  - Keep asking the bridge on `127.0.0.1:5174`. The iframe's origin is Paperclip's, so `MACHINEROOM_ORIGINS` must list it (for example `http://127.0.0.1:3100`). This needs no new code in Paperclip.
- Without any of these, the room starts empty and grows as agents touch files, as the proxy route does today.

### The control client and its `/api/control/*` routes

- Methods that are plain Paperclip calls could go straight from the page on the same origin, in a third client next to `src/control/client.js` and `src/control/mock.js`. Paperclip's write guard accepts them because the origin is Paperclip's. They are:
  - `agents`
  - `issues` and `createIssue`
  - `comments` and `postComment`
  - `approvals` and `decideApproval`
  - `costs` and `setAgentBudget`
  - `hireAgent` and `updateAgent`
  - `liveRuns`
  - `askPlanner` and `plan`
  - `backupStatus` and `backupNow`
- Pieces of the bridge that would have to move into that client:
  - the mapping in `server/control.js`
  - the feature switches from `server/surface.js`
  - the change notices from `changeEvents`
- `models` and `suggestRoute` read our own files (the model list and `docs/agents/policy.json`). The page could carry a copy.
- These need this machine and stay with the bridge (section 3):
  - `briefs` and `briefPrompt`
  - `runs`, `runStats` and `outcomes`
  - `startRun`
  - `reviews`, `reviewDiff` and `mergeReview`
  - `acceptPlan`
  - `decide`
- A worker is not needed for any of the Paperclip calls. It would only add a hop. A worker would be needed only to hold a key away from the page (for `decide`) or to run git (the file tree above).

### The `confirmed: true` rule for writes

- Today the bridge refuses a lane run, a merge and a backup without `confirmed: true`, and a merge also needs the exact head sha. The rule exists because any page on an allowed origin can call the bridge.
- Inside Paperclip:
  - The page writes to Paperclip with the board session, as Paperclip's own UI does. Paperclip has no such flag.
  - The confirm cards and `dispatch.js` still refuse a write without `confirmed`, so the owner sees the same cards.
  - The rule becomes a rule of our page, not a server check. A worker action that demanded `confirmed` would not change that, because any same-origin script can call the Paperclip route directly.
- The bridge routes that stay outside keep the rule as it is.

### The CSS3D and WebGL scene

- In an iframe: the scene runs as it does today.
  - `room.js` sizes to its element (`surface.clientWidth`), so it fills the iframe.
  - Paperclip sends no CSP and no frame header that would block WebGL or the iframe.
  - The fonts come from our own CSS inside the iframe.
- Open points:
  - The page area is smaller than a full window, so the overview fit and the HUD need a check at the sizes Paperclip leaves. The room already hides the cost board below 900 pixels wide.
  - Keys work only while the iframe has focus.
  - `routeSidebar` would collapse Paperclip's sidebar to its 64 pixel rail while our page is open, which gives the room more width. That needs a second slot.
- As a slot module the scene would also work, after the port described above.

## 3. What has to stay outside Paperclip

- Lane runs (`startRun`, `npm run run-lane`):
  - They start the harness CLIs and git in a lane worktree, last up to an hour or more and stop through `killTree()`.
  - A worker could start them, since it is a plain Node process on the same machine.
  - But a worker call times out after 15 minutes at most, a worker restarts when Paperclip restarts or upgrades the plugin, and a crash loop stops it after 10 tries.
  - A run must not die with the plugin.
- Reviews and merges (`reviews`, `reviewDiff`, `mergeReview`, `npm run review-lane`):
  - They read and write the owner's git checkout and `refs/heads/main`.
  - They are not Paperclip data and need no Paperclip service.
- The brief and plan files (`briefs`, `briefPrompt`, `acceptPlan`): they read and write `docs/agents/TASKS.md`, `HOUSE-RULES.md` and `lanes.json` in the checkout.
- The run records and outcomes: `runs.jsonl` and `outcomes.jsonl` in the temp folder.
- The decision model (`decide`): it needs `OPENROUTER_API_KEY`, which a worker does not get unless it is a sandbox-provider plugin.
- Replays of `public/recordings`: possible from the plugin's UI folder, but the folder is fixed at install, and a new recording would mean a plugin upgrade. The separate app stays the place for replays.

So the bridge stays for this work in every option.

## 4. Recommendation

Keep the separate app as the main window, as `CONTROL-PLANE.md` already decides. Add a thin plugin page as a second door into the same room, not a replacement.

The options:

- Separate app only (today).
  - Cost: none.
  - Gain: one code path, replays, lane runs, reviews and merges in one window.
  - Loss: the owner leaves Paperclip to watch the room, and live viewing needs the bridge running.
- A plugin page only. Not possible: lane runs, reviews, merges and briefs need the bridge anyway (section 3). Moving the viewer fully into a slot module means:
  - a port of the room to the host's React
  - scoped CSS
  - keys scoped to the page
  - a single-file bundle
  - chunk restore and masking moved into the browser

  Several briefs of work for no new ability.
- Both, with an iframe page (recommended).
  - The cost is small:
    - a relative build base
    - a "same origin Paperclip" start mode, which is today's proxy route with an empty base
    - a plugin package with a manifest, a minimal worker and a page module of a few lines
    - a local-path install script
  - The gains:
    - The owner sees the room inside Paperclip on Paperclip's own address, with no second port to open.
    - Viewing works without the bridge.
    - Task writes from the room pass Paperclip's own write guard.
    - If the bridge runs and allows Paperclip's origin, the page also gets the full file tree, restored chunks and masked keys, and the Dispatch, Reviews and Plan tabs.
  - The risks:
    - The README says the plugin runtime is early, and plugin code is trusted code.
    - Each Paperclip upgrade can change the plugin API.
    - The plugin pins `apiVersion: 1` and should set `minimumHostVersion`.
- Do not build:
  - a worker that runs lane runs or merges
  - a worker that lists files with git, for now: the bridge already does this better

The worth of the page depends on how often the owner works inside Paperclip's own UI. If the answer is rarely, stay with the separate app and skip the briefs below.

## 5. First briefs

These follow the house brief style. Owners are suggestions.

E2b. Build the room for a same-origin page (Claude). Let the viewer run from any folder of a host origin and talk to the Paperclip on that origin with no proxy and no bridge.

- Add a build mode with a relative base, `npm run build -- --mode plugin` or an `npm run build:plugin` script, that writes the room with `base: './'` to `dist-plugin/`. The default build stays as it is.
- Add a start mode `?live&paperclip=same` (or `paperclip=` set to the page's own origin, which `linkAddressAllowed` already accepts) that uses the page's origin as the Paperclip base for `discover`, `socketUrl` and REST. This is today's proxy route with an empty base.
- Check that `src/startup.js` keeps refusing other origins.
- Tests in `tests/startup.test.js` and the live source tests:
  - the new start mode
  - the base of `''`
  - a refused foreign origin
- Check by eye: serve `dist-plugin/` from a subfolder of the fake Paperclip's origin, or of any static server on the fake's port, and say what you saw.
- Files: `vite.config.js`, `package.json` (one script), `src/startup.js`, `src/live/source.js`, `src/App.jsx`, `tests/startup.test.js`, the live source test file, `docs/agents/ARCHITECTURE.md`, `docs/agents/CHANGELOG.md`.

E2c. A Paperclip plugin that shows the room (Claude). Add a plugin package under `plugin/` that is not part of the npm pack of the room.

- `plugin/package.json` names it `paperclip-plugin-machine-room` with a `paperclipPlugin` object.
- `plugin/manifest.json` has:
  - `apiVersion: 1`
  - `minimumHostVersion` set to the pinned Paperclip version
  - the capabilities `ui.page.register` and `ui.sidebar.register`
  - a `page` slot with `routePath: "machine-room"`
  - a `sidebar` slot
- `plugin/worker.js` only answers health.
- `plugin/ui/index.js` is a plain ES module with no imports beyond `react`. It renders an iframe of `./room/index.html?live&paperclip=same&company=COMPANY` with the company from the page props.
- `npm run plugin-pack` copies `dist-plugin/` into `plugin/ui/room/`.
- Tests:
  - the manifest against the rules this file lists (required keys, slot types, `routePath` shape)
  - the iframe address built from a company id
  - that `npm run pack-check` still leaves `plugin/` out
- Do not install it anywhere.
- Files: `plugin/package.json`, `plugin/manifest.json`, `plugin/worker.js`, `plugin/ui/index.js`, `scripts/plugin-pack.mjs`, `package.json` (one script), `tests/plugin.test.js`, `scripts/pack-check.mjs` if it needs the folder named, `docs/agents/PLUGIN-PAGE.md`, `docs/agents/CHANGELOG.md`.

E2d. Install the plugin on a throwaway Paperclip and on the owner's (owner and Claude).

- On a throwaway Paperclip in a VM with no keys: install the folder from E2c with `POST /api/plugins/install` and `{ packageName: PATH, isLocalPath: true }`, open `/:company/machine-room` in Chromium, and record:
  - that the iframe loads
  - that the socket connects with the board session
  - that a task run shows in the room
  - a screenshot of each
- Also check, and write each finding into this file:
  - whether a key typed in Paperclip outside the iframe reaches the room
  - the smallest page size where the HUD still fits
- Then the owner installs it on their own Paperclip on Windows. Add `http://127.0.0.1:3100` to `MACHINEROOM_ORIGINS` to see whether the Dispatch, Reviews and Plan tabs work through the bridge from inside Paperclip.
- Files: `docs/agents/PLUGIN-PAGE.md`, `docs/agents/CHANGELOG.md`.

## What I ran

- I read the installed package from `npm install paperclipai@2026.1012.0 --ignore-scripts` in a scratch folder, done for W6a. I installed nothing else.
- I started no Paperclip. The brief allows a throwaway only to load an example plugin, and the npm package ships none:
  - `GET /api/plugins/examples` lists the bundled catalog from `PAPERCLIP_BUNDLED_PLUGIN_ROOT`, default `/app/packages/plugins` in the Docker image.
  - That catalog holds only sandbox providers.
  - The `packages/plugins` folder of the source repository is not in the package.
- Everything in this file comes from reading code, not from a running host.

## What only a real Paperclip or Windows can prove

- Loading and rendering:
  - that `importPluginModule` loads a slot module that renders an iframe, and that a `page` slot with a `routePath` appears at `/:company/machine-room`
  - that the iframe gets the board session and opens the live socket in the owner's deployment mode (local trusted or signed in)
  - that WebGL and CSS3D draw inside the iframe in Paperclip's layout, and at what size
- Install on Windows:
  - that a local-path install works on Windows, where `canonicalizeLocalPluginPath` resolves real paths
  - that `npm` is on the path Paperclip's server sees
- That Paperclip's own UI does not catch the room's keys, and the room does not catch Paperclip's, when focus moves between them.
- That a page served from `/_plugins/:id/ui/` can call the bridge on port 5174 once `MACHINEROOM_ORIGINS` lists Paperclip's origin, in Chromium on Windows.
