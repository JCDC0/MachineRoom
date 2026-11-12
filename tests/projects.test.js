import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createBridge } from '../server/index.js'
import { projectHash } from '../server/orchestrator.js'
import {
  CONFIRM_FORGET_PROBLEM,
  CONFIRM_OPEN_PROBLEM,
  currentProject,
  MAX_RECENT,
  MAX_SESSIONS,
  NOT_ABSOLUTE_PROBLEM,
  NOT_FOLDER_PROBLEM,
  NOT_FOUND_PROBLEM,
  NOT_IN_LIST_PROBLEM,
  NOT_SUPPORTED_PROBLEM,
  ORIGIN_FORGET_PROBLEM,
  ORIGIN_PROBLEM,
  PRUNE_INTERVAL_MS,
  TURN_RUNNING_PROBLEM,
  LANES_RUNNING_PROBLEM,
  createProjectsApi,
  readProjectsFile,
  recentProjects,
  recordProject,
  resetPruneCache,
  shouldSkipProject,
  siblingFolders,
} from '../server/projects.js'
import { createClient } from '../src/control/client.js'
import { waitFor } from './helpers/bridge.js'
import { makeTempDir, processTempRoot, removeTempDir } from './helpers/tempRoot.js'

const cleanups = []

afterEach(async () => {
  resetPruneCache()
  while (cleanups.length > 0) {
    const fn = cleanups.pop()
    try {
      await fn()
    } catch {}
  }
})

async function getJson(url, init = {}) {
  const response = await fetch(url, { signal: AbortSignal.timeout(10000), ...init })
  const text = await response.text()
  return { status: response.statusCode ?? response.status, body: text ? JSON.parse(text) : null }
}

async function postJson(url, body, init = {}) {
  return getJson(url, {
    method: 'POST',
    ...init,
    headers: {
      'content-type': 'application/json',
      ...(init.headers ?? {}),
    },
    body: JSON.stringify(body),
  })
}

function createEnvironment() {
  const base = makeTempDir('mr-projects-test-')
  cleanups.push(() => removeTempDir(base))

  const systemTemp = join(base, 'system-temp')
  mkdirSync(systemTemp, { recursive: true })

  const oldTemp = process.env.MACHINEROOM_TEMP
  process.env.MACHINEROOM_TEMP = systemTemp
  cleanups.push(() => {
    if (oldTemp === undefined) delete process.env.MACHINEROOM_TEMP
    else process.env.MACHINEROOM_TEMP = oldTemp
  })

  const root = join(base, 'current-repo')
  mkdirSync(join(root, '.git'), { recursive: true })

  const siblingGit = join(base, 'sibling-git')
  mkdirSync(join(siblingGit, '.git'), { recursive: true })

  const siblingPlain = join(base, 'sibling-plain')
  mkdirSync(siblingPlain, { recursive: true })

  const hiddenDir = join(base, '.hidden')
  mkdirSync(hiddenDir, { recursive: true })

  const worktreesDir = join(base, '.worktrees')
  mkdirSync(worktreesDir, { recursive: true })

  const nodeModulesDir = join(base, 'node_modules')
  mkdirSync(nodeModulesDir, { recursive: true })

  const outsideRepo = join(base, 'outside-repo')
  mkdirSync(join(outsideRepo, '.git'), { recursive: true })

  const runs = join(base, 'runs')
  mkdirSync(runs, { recursive: true })

  return {
    base,
    systemTemp,
    root,
    siblingGit,
    siblingPlain,
    outsideRepo,
    runs,
  }
}

describe('projects api', () => {
  it('adds current root to projects.json when bridge starts and answers GET /api/projects', async () => {
    const env = createEnvironment()
    const bridge = createBridge({
      projectRoot: env.root,
      runsFolder: env.runs,
      port: 0,
      env: {},
    })
    const info = await bridge.start()
    cleanups.push(() => bridge.stop())

    const file = join(env.runs, 'projects.json')
    expect(existsSync(file)).toBe(true)
    const stored = readProjectsFile(file)
    expect(stored.recent).toHaveLength(1)
    expect(stored.recent[0].path).toBe(resolve(env.root))

    const outsideHash = projectHash(env.outsideRepo)
    const chatFile = join(env.runs, `orchestrator-${outsideHash}.json`)
    writeFileSync(
      chatFile,
      JSON.stringify({
        project: env.outsideRepo,
        sessions: [
          { id: 's1', title: 'Session 1', endedAt: '2026-10-25T10:00:00.000Z' },
          { id: 's2', title: 'Session 2', endedAt: '2026-10-25T09:00:00.000Z' },
          { id: 's3', title: 'Session 3', endedAt: '2026-10-25T08:00:00.000Z' },
          { id: 's4', title: 'Session 4', endedAt: '2026-10-25T07:00:00.000Z' },
          { id: 's5', title: 'Session 5', endedAt: '2026-10-25T06:00:00.000Z' },
          { id: 's6', title: 'Session 6', endedAt: '2026-10-25T05:00:00.000Z' },
          { id: 's7', title: 'Session 7', endedAt: '2026-10-25T04:00:00.000Z' },
        ],
      })
    )

    recordProject(file, join(env.base, 'does-not-exist'))
    recordProject(file, env.outsideRepo)

    const res = await getJson(`${info.url}/api/projects`)
    expect(res.status).toBe(200)
    expect(res.body.current).toEqual({
      path: resolve(env.root),
      name: basename(env.root),
      git: true,
    })

    expect(res.body.recent).toHaveLength(1)
    expect(res.body.recent[0]).toMatchObject({
      path: resolve(env.outsideRepo),
      name: basename(env.outsideRepo),
    })
    expect(res.body.recent[0].sessions).toHaveLength(MAX_SESSIONS)
    expect(res.body.recent[0].sessions[0]).toEqual({
      id: 's1',
      title: 'Session 1',
      endedAt: '2026-10-25T10:00:00.000Z',
    })

    const folderNames = res.body.folders.map((f) => f.name)
    expect(folderNames).not.toContain('current-repo')
    expect(folderNames).toContain('sibling-git')
    expect(folderNames).toContain('sibling-plain')
    expect(folderNames).toContain('outside-repo')
    expect(folderNames).not.toContain('.hidden')
    expect(folderNames).not.toContain('.worktrees')
    expect(folderNames).not.toContain('node_modules')

    const gitFolder = res.body.folders.find((f) => f.name === 'sibling-git')
    expect(gitFolder.git).toBe(true)

    const plainFolder = res.body.folders.find((f) => f.name === 'sibling-plain')
    expect(plainFolder.git).toBe(false)
  })

  it('leaves out the current folder from sibling folders', () => {
    const env = createEnvironment()
    const siblings = siblingFolders(env.root)
    const names = siblings.map((s) => s.name)
    expect(names).not.toContain('current-repo')
    expect(names).toContain('sibling-git')
    expect(names).toContain('sibling-plain')
  })

  it('says git: true for a subfolder inside a repository', async () => {
    const env = createEnvironment()
    const subfolder = join(env.root, 'src', 'nested')
    mkdirSync(subfolder, { recursive: true })
    const info = currentProject(subfolder)
    expect(info.git).toBe(true)
    expect(info.name).toBe('nested')

    const bridge = createBridge({
      projectRoot: subfolder,
      runsFolder: env.runs,
      port: 0,
      env: {},
    })
    const bridgeInfo = await bridge.start()
    cleanups.push(() => bridge.stop())
    const res = await getJson(`${bridgeInfo.url}/api/projects`)
    expect(res.status).toBe(200)
    expect(res.body.current.git).toBe(true)
  })

  it('limits recent projects to at most 20 and orders newest first', () => {
    const env = createEnvironment()
    const file = join(env.runs, 'projects.json')

    for (let i = 1; i <= 25; i += 1) {
      recordProject(file, join(env.base, `proj-${i}`), 1000 + i)
    }

    const stored = readProjectsFile(file)
    expect(stored.recent).toHaveLength(MAX_RECENT)
    expect(stored.recent[0].path).toBe(resolve(join(env.base, 'proj-25')))
    expect(stored.recent[19].path).toBe(resolve(join(env.base, 'proj-6')))

    recordProject(file, join(env.base, 'proj-6'), 5000)
    const updated = readProjectsFile(file)
    expect(updated.recent[0].path).toBe(resolve(join(env.base, 'proj-6')))
    expect(updated.recent).toHaveLength(MAX_RECENT)
  })

  it('skips a temp folder, a worktree and a runs folder when recording', () => {
    const env = createEnvironment()
    const file = join(env.runs, 'projects.json')

    const tempScratch = join(env.systemTemp, 'scratch-repo')
    mkdirSync(tempScratch, { recursive: true })
    recordProject(file, tempScratch)

    delete process.env.MACHINEROOM_TEMP
    try {
      const osTemp = join(tmpdir(), 'mr-test-scratch-skip')
      recordProject(file, osTemp)
    } finally {
      process.env.MACHINEROOM_TEMP = env.systemTemp
    }

    const worktreeFolder = join(env.base, '.worktrees', 'lane-alpha')
    mkdirSync(worktreeFolder, { recursive: true })
    recordProject(file, worktreeFolder)

    recordProject(file, 'C:\\GitHub\\MachineRoom\\.worktrees\\hermes')

    const runsDir = join(env.base, 'test-runs-dir')
    mkdirSync(runsDir, { recursive: true })
    writeFileSync(join(runsDir, 'runs.jsonl'), '{"type":"heartbeat"}\n')
    recordProject(file, runsDir)

    const stored = readProjectsFile(file)
    expect(stored.recent).toHaveLength(0)

    recordProject(file, env.outsideRepo)
    const storedAfter = readProjectsFile(file)
    expect(storedAfter.recent).toHaveLength(1)
    expect(storedAfter.recent[0].path).toBe(resolve(env.outsideRepo))
  })

  it('leaves out folders shouldSkipProject skips when reading recent projects', () => {
    const env = createEnvironment()
    const file = join(env.runs, 'projects.json')
    const worktreeFolder = join(env.base, '.worktrees', 'agy2')
    mkdirSync(worktreeFolder, { recursive: true })
    const validFolder = join(env.base, 'valid-proj')
    mkdirSync(validFolder, { recursive: true })

    writeFileSync(
      file,
      JSON.stringify({
        recent: [
          { path: worktreeFolder, openedAt: '2026-10-25T10:00:00.000Z' },
          { path: validFolder, openedAt: '2026-10-25T09:00:00.000Z' },
        ],
      })
    )

    const list = recentProjects(file, env.runs, env.root)
    expect(list.map((item) => item.path)).toEqual([resolve(validFolder)])
  })

  it('does not record a temp folder or worktree when bridge starts on it', async () => {
    const env = createEnvironment()
    const tempProject = join(env.systemTemp, 'temp-proj')
    mkdirSync(join(tempProject, '.git'), { recursive: true })

    const bridge = createBridge({
      projectRoot: tempProject,
      runsFolder: env.runs,
      port: 0,
      env: {},
    })
    const info = await bridge.start()
    cleanups.push(() => bridge.stop())

    const file = join(env.runs, 'projects.json')
    const stored = readProjectsFile(file)
    expect(stored.recent).toHaveLength(0)
  })

  it('drops missing folders from projects.json when recentProjects is read at most once a minute', () => {
    const env = createEnvironment()
    const file = join(env.runs, 'projects.json')

    const realA = join(env.base, 'real-a')
    mkdirSync(realA, { recursive: true })
    const realB = join(env.base, 'real-b')
    mkdirSync(realB, { recursive: true })
    const missing = join(env.base, 'gone-project')

    recordProject(file, realA)
    recordProject(file, missing)
    recordProject(file, realB)

    let stored = readProjectsFile(file)
    expect(stored.recent.map((r) => r.path)).toEqual([
      resolve(realB),
      resolve(missing),
      resolve(realA),
    ])

    const list1 = recentProjects(file, env.runs, null, () => 1000)
    expect(list1.map((r) => r.path)).toEqual([resolve(realB), resolve(realA)])

    stored = readProjectsFile(file)
    expect(stored.recent.map((r) => r.path)).toEqual([resolve(realB), resolve(realA)])

    writeFileSync(
      file,
      JSON.stringify({
        recent: [
          { path: resolve(realB), openedAt: '2026-10-25T10:00:00.000Z' },
          { path: resolve(missing), openedAt: '2026-10-25T09:00:00.000Z' },
        ],
      })
    )

    const list2 = recentProjects(file, env.runs, null, () => 30000)
    expect(list2.map((r) => r.path)).toEqual([resolve(realB)])

    stored = readProjectsFile(file)
    expect(stored.recent.map((r) => r.path)).toContain(resolve(missing))

    const list3 = recentProjects(file, env.runs, null, () => PRUNE_INTERVAL_MS + 2000)
    expect(list3.map((r) => r.path)).toEqual([resolve(realB)])

    stored = readProjectsFile(file)
    expect(stored.recent.map((r) => r.path)).not.toContain(resolve(missing))
  })

  it('refuses POST /api/projects/forget without a page Origin with 403', async () => {
    const env = createEnvironment()
    const bridge = createBridge({
      projectRoot: env.root,
      runsFolder: env.runs,
      port: 0,
      env: {},
    })
    const info = await bridge.start()
    cleanups.push(() => bridge.stop())

    const res = await postJson(`${info.url}/api/projects/forget`, {
      path: env.siblingGit,
      confirmed: true,
    })
    expect(res.status).toBe(403)
    expect(res.body.error).toBe(ORIGIN_FORGET_PROBLEM)
  })

  it('refuses unconfirmed POST /api/projects/forget with 400', async () => {
    const env = createEnvironment()
    const bridge = createBridge({
      projectRoot: env.root,
      runsFolder: env.runs,
      port: 0,
      env: {},
    })
    const info = await bridge.start()
    cleanups.push(() => bridge.stop())

    const res = await postJson(
      `${info.url}/api/projects/forget`,
      { path: env.siblingGit },
      { headers: { Origin: info.url } }
    )
    expect(res.status).toBe(400)
    expect(res.body.error).toBe(CONFIRM_FORGET_PROBLEM)
  })

  it('refuses POST /api/projects/forget for a path not in the list with 400', async () => {
    const env = createEnvironment()
    const bridge = createBridge({
      projectRoot: env.root,
      runsFolder: env.runs,
      port: 0,
      env: {},
    })
    const info = await bridge.start()
    cleanups.push(() => bridge.stop())

    const res = await postJson(
      `${info.url}/api/projects/forget`,
      { path: env.siblingGit, confirmed: true },
      { headers: { Origin: info.url } }
    )
    expect(res.status).toBe(400)
    expect(res.body.error).toBe(NOT_IN_LIST_PROBLEM)
  })

  it('removes one entry via POST /api/projects/forget and answers new list', async () => {
    const env = createEnvironment()
    const file = join(env.runs, 'projects.json')
    recordProject(file, env.siblingGit)
    recordProject(file, env.outsideRepo)

    const bridge = createBridge({
      projectRoot: env.root,
      runsFolder: env.runs,
      port: 0,
      env: {},
    })
    const info = await bridge.start()
    cleanups.push(() => bridge.stop())

    const res = await postJson(
      `${info.url}/api/projects/forget`,
      { path: env.siblingGit, confirmed: true },
      { headers: { Origin: info.url } }
    )
    expect(res.status).toBe(200)
    expect(res.body.current).toEqual({
      path: resolve(env.root),
      name: basename(env.root),
      git: true,
    })
    expect(res.body.recent).toHaveLength(1)
    expect(res.body.recent[0].path).toBe(resolve(env.outsideRepo))

    const stored = readProjectsFile(file)
    expect(stored.recent).toHaveLength(2)
    expect(stored.recent.map((r) => r.path)).toContain(resolve(env.outsideRepo))
    expect(stored.recent.map((r) => r.path)).not.toContain(resolve(env.siblingGit))

    const client = createClient({
      baseUrl: info.url,
      fetchImpl: (input, init) =>
        fetch(input, { ...init, headers: { ...init?.headers, origin: info.url } }),
    })
    const clientRes = await client.forgetProject({ path: env.outsideRepo, confirmed: true })
    expect(clientRes.recent).toHaveLength(0)

    const storedAfterClient = readProjectsFile(file)
    expect(storedAfterClient.recent).toHaveLength(1)
    expect(storedAfterClient.recent[0].path).toBe(resolve(env.root))
  })

  it('refuses POST /api/projects/open without a page Origin with 403', async () => {
    const env = createEnvironment()
    const bridge = createBridge({
      projectRoot: env.root,
      runsFolder: env.runs,
      port: 0,
      env: {},
    })
    const info = await bridge.start()
    cleanups.push(() => bridge.stop())

    const res = await postJson(`${info.url}/api/projects/open`, {
      path: env.siblingGit,
      confirmed: true,
    })
    expect(res.status).toBe(403)
    expect(res.body.error).toBe(ORIGIN_PROBLEM)
  })

  it('refuses unconfirmed POST /api/projects/open with 400', async () => {
    const env = createEnvironment()
    const bridge = createBridge({
      projectRoot: env.root,
      runsFolder: env.runs,
      port: 0,
      env: {},
    })
    const info = await bridge.start()
    cleanups.push(() => bridge.stop())

    const res = await postJson(
      `${info.url}/api/projects/open`,
      { path: env.siblingGit },
      { headers: { Origin: info.url } }
    )
    expect(res.status).toBe(400)
    expect(res.body.error).toBe(CONFIRM_OPEN_PROBLEM)
  })

  it('refuses a non-absolute path with 400 and one sentence', async () => {
    const env = createEnvironment()
    const bridge = createBridge({
      projectRoot: env.root,
      runsFolder: env.runs,
      port: 0,
      env: {},
    })
    const info = await bridge.start()
    cleanups.push(() => bridge.stop())

    const res = await postJson(
      `${info.url}/api/projects/open`,
      { path: 'relative/folder', confirmed: true },
      { headers: { Origin: info.url } }
    )
    expect(res.status).toBe(400)
    expect(res.body.error).toBe(NOT_ABSOLUTE_PROBLEM)
  })

  it('refuses a path that does not exist with 400 and one sentence', async () => {
    const env = createEnvironment()
    const bridge = createBridge({
      projectRoot: env.root,
      runsFolder: env.runs,
      port: 0,
      env: {},
    })
    const info = await bridge.start()
    cleanups.push(() => bridge.stop())

    const res = await postJson(
      `${info.url}/api/projects/open`,
      { path: join(env.base, 'non-existent'), confirmed: true },
      { headers: { Origin: info.url } }
    )
    expect(res.status).toBe(400)
    expect(res.body.error).toBe(NOT_FOUND_PROBLEM)
  })

  it('refuses a path that is not a folder with 400 and one sentence', async () => {
    const env = createEnvironment()
    const filePath = join(env.base, 'a-file.txt')
    writeFileSync(filePath, 'hello')

    const bridge = createBridge({
      projectRoot: env.root,
      runsFolder: env.runs,
      port: 0,
      env: {},
    })
    const info = await bridge.start()
    cleanups.push(() => bridge.stop())

    const res = await postJson(
      `${info.url}/api/projects/open`,
      { path: filePath, confirmed: true },
      { headers: { Origin: info.url } }
    )
    expect(res.status).toBe(400)
    expect(res.body.error).toBe(NOT_FOLDER_PROBLEM)
  })

  it('refuses when an orchestrator turn is running with 409', async () => {
    const env = createEnvironment()
    const fakeOrchestrators = () => ({
      list: () => [{ id: 'orchestrator', state: 'working' }],
    })
    const answers = []
    const api = createProjectsApi({
      projectRoot: env.root,
      runsFolder: env.runs,
      orchestrators: fakeOrchestrators,
      onOpenProject: () => {},
      sendJson: (_req, _res, status, body) => {
        answers.push({ status, body })
      },
      readJsonBody: async () => ({ path: env.siblingGit, confirmed: true }),
    })
    const handled = await api.handle(
      { method: 'POST', headers: { origin: 'http://127.0.0.1:5173' } },
      {},
      new URL('http://127.0.0.1/api/projects/open')
    )
    expect(handled).toBe(true)
    expect(answers[0].status).toBe(409)
    expect(answers[0].body.error).toBe(TURN_RUNNING_PROBLEM)
  })

  it('refuses when a lane run is open with 409', async () => {
    const env = createEnvironment()
    const answers = []
    const api = createProjectsApi({
      projectRoot: env.root,
      runsFolder: env.runs,
      runs: { isRunning: () => true },
      onOpenProject: () => {},
      sendJson: (_req, _res, status, body) => {
        answers.push({ status, body })
      },
      readJsonBody: async () => ({ path: env.siblingGit, confirmed: true }),
    })
    const handled = await api.handle(
      { method: 'POST', headers: { origin: 'http://127.0.0.1:5173' } },
      {},
      new URL('http://127.0.0.1/api/projects/open')
    )
    expect(handled).toBe(true)
    expect(answers[0].status).toBe(409)
    expect(answers[0].body.error).toBe(LANES_RUNNING_PROBLEM)
  })

  it('refuses while the lane source has a run open, then opens once that run ends', async () => {
    const env = createEnvironment()
    const openedPaths = []
    const lanes = {
      opencode: {
        name: 'OpenCode',
        harness: 'OpenCode',
        cli: { harness: 'opencode', model: 'test-model' },
        worktree: join(env.base, 'opencode-worktree'),
      },
    }
    const bridge = createBridge({
      projectRoot: env.root,
      runsFolder: env.runs,
      port: 0,
      env: {},
      lanesSource: { folder: env.runs, lanes, repoRoot: env.root, pollMs: 20, quietMs: 60000 },
      onOpenProject: (targetPath) => {
        openedPaths.push(targetPath)
      },
    })
    const info = await bridge.start()
    cleanups.push(() => bridge.stop())

    const name = 'opencode-L2-20261112-120000'
    const log = join(env.runs, `${name}.log`)
    writeFileSync(log, '')
    const live = await waitFor(
      async () => {
        const { body } = await getJson(`${info.url}/api/control/live-runs`)
        return body?.runs?.some((run) => run.runId === `run-${name}`) ? body.runs : null
      },
      { what: 'the lane source to open the run' }
    )
    expect(live).toHaveLength(1)

    const refused = await postJson(
      `${info.url}/api/projects/open`,
      { path: env.siblingGit, confirmed: true },
      { headers: { Origin: info.url } }
    )
    expect(refused.status).toBe(409)
    expect(refused.body.error).toBe(LANES_RUNNING_PROBLEM)
    await new Promise((resolveWait) => setTimeout(resolveWait, 50))
    expect(openedPaths).toEqual([])

    writeFileSync(
      join(env.runs, 'runs.jsonl'),
      `${JSON.stringify({ lane: 'opencode', briefs: ['L2'], log, startedAt: '2026-11-12T12:00:00.000Z', exitCode: 0 })}\n`
    )
    await waitFor(
      async () => {
        const { body } = await getJson(`${info.url}/api/control/live-runs`)
        return body?.runs?.length === 0 ? true : null
      },
      { what: 'the lane source to finish the run' }
    )

    const opened = await postJson(
      `${info.url}/api/projects/open`,
      { path: env.siblingGit, confirmed: true },
      { headers: { Origin: info.url } }
    )
    expect(opened.status).toBe(200)
    await waitFor(() => (openedPaths.length > 0 ? true : null), { what: 'onOpenProject' })
    expect(openedPaths).toEqual([resolve(env.siblingGit)])
  })

  it('opens a project with the lane source off', async () => {
    const env = createEnvironment()
    const openedPaths = []
    const bridge = createBridge({
      projectRoot: env.root,
      runsFolder: env.runs,
      port: 0,
      env: {},
      onOpenProject: (targetPath) => {
        openedPaths.push(targetPath)
      },
    })
    const info = await bridge.start()
    cleanups.push(() => bridge.stop())

    const res = await postJson(
      `${info.url}/api/projects/open`,
      { path: env.siblingGit, confirmed: true },
      { headers: { Origin: info.url } }
    )
    expect(res.status).toBe(200)
    await waitFor(() => (openedPaths.length > 0 ? true : null), { what: 'onOpenProject' })
    expect(openedPaths).toEqual([resolve(env.siblingGit)])
  })

  it('answers 501 when bridge started without onOpenProject', async () => {
    const env = createEnvironment()
    const bridge = createBridge({
      projectRoot: env.root,
      runsFolder: env.runs,
      port: 0,
      env: {},
    })
    const info = await bridge.start()
    cleanups.push(() => bridge.stop())

    const res = await postJson(
      `${info.url}/api/projects/open`,
      { path: env.siblingGit, confirmed: true },
      { headers: { Origin: info.url } }
    )
    expect(res.status).toBe(501)
    expect(res.body.error).toBe(NOT_SUPPORTED_PROBLEM)
  })

  it('restarts through onOpenProject, adds path to recent, and answers 200', async () => {
    const env = createEnvironment()
    const openedPaths = []
    const onOpenProject = (targetPath) => {
      openedPaths.push(targetPath)
    }

    const bridge = createBridge({
      projectRoot: env.root,
      runsFolder: env.runs,
      port: 0,
      env: {},
      onOpenProject,
    })
    const info = await bridge.start()
    cleanups.push(() => bridge.stop())

    const res = await postJson(
      `${info.url}/api/projects/open`,
      { path: env.siblingGit, confirmed: true },
      { headers: { Origin: info.url } }
    )
    expect(res.status).toBe(200)
    expect(res.body).toEqual({
      ok: true,
      restarting: true,
      path: resolve(env.siblingGit),
    })

    await new Promise((resolveWait) => setTimeout(resolveWait, 50))
    expect(openedPaths).toEqual([resolve(env.siblingGit)])

    const file = join(env.runs, 'projects.json')
    const stored = readProjectsFile(file)
    expect(stored.recent[0].path).toBe(resolve(env.siblingGit))
  })

  it('records projects.json under the test temp root and not under %TEMP%\\machineroom-runs when runsFolder is unset', async () => {
    const env = createEnvironment()
    const bridge = createBridge({
      projectRoot: env.root,
      port: 0,
      env: {},
    })
    const info = await bridge.start()
    cleanups.push(() => bridge.stop())

    const rootDir = processTempRoot()
    const runsDir = process.env.MACHINEROOM_RUNS
    expect(runsDir).toBeTruthy()
    expect(resolve(runsDir).startsWith(resolve(rootDir))).toBe(true)

    const testProjectsFile = join(runsDir, 'projects.json')
    expect(existsSync(testProjectsFile)).toBe(true)
    const stored = readProjectsFile(testProjectsFile)
    expect(stored.recent[0].path).toBe(resolve(env.root))

    const realRuns = join(process.env.TEMP || tmpdir(), 'machineroom-runs')
    const realProjectsFile = join(realRuns, 'projects.json')
    if (existsSync(realProjectsFile)) {
      const realStored = readProjectsFile(realProjectsFile)
      expect(realStored.recent.some((entry) => entry.path === resolve(env.root))).toBe(false)
    }
  })
})
