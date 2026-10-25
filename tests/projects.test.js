import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createBridge } from '../server/index.js'
import { projectHash } from '../server/orchestrator.js'
import {
  CONFIRM_OPEN_PROBLEM,
  NOT_ABSOLUTE_PROBLEM,
  NOT_FOLDER_PROBLEM,
  NOT_FOUND_PROBLEM,
  NOT_SUPPORTED_PROBLEM,
  ORIGIN_PROBLEM,
  TURN_RUNNING_PROBLEM,
  createProjectsApi,
  readProjectsFile,
  recordProject,
} from '../server/projects.js'
import { makeTempDir, removeTempDir } from './helpers/tempRoot.js'

const cleanups = []

afterEach(async () => {
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
    expect(res.body.recent[0].sessions).toHaveLength(6)
    expect(res.body.recent[0].sessions[0]).toEqual({
      id: 's1',
      title: 'Session 1',
      endedAt: '2026-10-25T10:00:00.000Z',
    })

    const folderNames = res.body.folders.map((f) => f.name)
    expect(folderNames).toContain('current-repo')
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

  it('limits recent projects to at most 20 and orders newest first', () => {
    const env = createEnvironment()
    const file = join(env.runs, 'projects.json')

    for (let i = 1; i <= 25; i += 1) {
      recordProject(file, join(env.base, `proj-${i}`), 1000 + i)
    }

    const stored = readProjectsFile(file)
    expect(stored.recent).toHaveLength(20)
    expect(stored.recent[0].path).toBe(resolve(join(env.base, 'proj-25')))
    expect(stored.recent[19].path).toBe(resolve(join(env.base, 'proj-6')))

    recordProject(file, join(env.base, 'proj-6'), 5000)
    const updated = readProjectsFile(file)
    expect(updated.recent[0].path).toBe(resolve(join(env.base, 'proj-6')))
    expect(updated.recent).toHaveLength(20)
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
})
