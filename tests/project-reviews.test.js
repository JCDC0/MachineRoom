import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createBridge } from '../server/index.js'
import { codeCheckout, resetCodeCheckout } from '../server/reviews.js'
import ReviewsPanel from '../src/ui/panels/ReviewsPanel.jsx'
import { defaultMergeMessage, reviewRow } from '../src/ui/panels/reviews.js'
import { makeTempDir as makeTempRoot } from './helpers/tempRoot.js'

const REPO_ROOT = resolve(fileURLToPath(import.meta.url), '..', '..')
const REAL_TMP = tmpdir()
const NO_GIT_CONFIG = join(REAL_TMP, 'machineroom-project-reviews-no-git-config')
const cleanups = []
let templateRoot = ''
let templateRoom = ''
let templateProject = ''

afterEach(async () => {
  while (cleanups.length > 0) {
    const fn = cleanups.pop()
    await fn()
  }
})

beforeEach(() => {
  const dir = makeTempDir()
  const previous = process.env.TEMP
  process.env.TEMP = dir
  cleanups.push(() => {
    if (previous === undefined) delete process.env.TEMP
    else process.env.TEMP = previous
  })
})

beforeAll(() => {
  templateRoot = makeTempRoot('mr-project-reviews-template-')
  templateRoom = join(templateRoot, 'room')
  templateProject = join(templateRoot, 'project')

  initRepo(templateRoom, 'main')
  mkdirSync(join(templateRoom, 'docs', 'agents'), { recursive: true })
  writeFileSync(join(templateRoom, 'docs', 'agents', 'lanes.json'), '{}')
  writeFileSync(join(templateRoom, 'README.md'), 'room\n')
  git(templateRoom, ['add', '.'])
  git(templateRoom, ['commit', '-m', 'room'])

  initRepo(templateProject, 'trunk')
  writeFileSync(join(templateProject, 'notes.txt'), 'hello\n')
  git(templateProject, ['add', 'notes.txt'])
  git(templateProject, ['commit', '-m', 'first'])
  git(templateProject, ['switch', '-c', 'feat/x'])
  writeFileSync(join(templateProject, 'extra.js'), 'export const x = 1\n')
  git(templateProject, ['add', 'extra.js'])
  git(templateProject, ['commit', '-m', 'lane work'])
  git(templateProject, ['switch', 'trunk'])
})

afterAll(() => {
  rmSync(templateRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
})

function makeTempDir() {
  const dir = makeTempRoot('mr-project-reviews-')
  cleanups.push(() => rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }))
  return dir
}

function git(cwd, args) {
  return execFileSync('git', args, {
    cwd,
    shell: false,
    windowsHide: true,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      GIT_CONFIG_SYSTEM: NO_GIT_CONFIG,
      GIT_CONFIG_GLOBAL: NO_GIT_CONFIG,
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_TERMINAL_PROMPT: '0',
      GIT_AUTHOR_NAME: 'MachineRoom Test',
      GIT_AUTHOR_EMAIL: 'test@example.invalid',
      GIT_COMMITTER_NAME: 'MachineRoom Test',
      GIT_COMMITTER_EMAIL: 'test@example.invalid',
    },
  })
}

function initRepo(folder, branch) {
  mkdirSync(folder, { recursive: true })
  git(folder, ['init', '-b', branch])
  git(folder, ['config', 'user.name', 'MachineRoom Test'])
  git(folder, ['config', 'user.email', 'test@example.invalid'])
  git(folder, ['config', 'commit.gpgsign', 'false'])
  git(folder, ['config', 'core.autocrlf', 'false'])
}

function makeProject({ detach = false } = {}) {
  const base = makeTempDir()
  const room = join(base, 'room')
  const project = join(base, 'project')
  const worktree = join(project, '.worktrees', 'opencode')
  const lanes = {
    opencode: { name: 'OpenCode' },
    hermes: { name: 'Hermes', worktree: room },
    quiet: { name: 'No worktree here' },
  }

  cpSync(templateRoom, room, { recursive: true })
  cpSync(templateProject, project, { recursive: true })
  writeFileSync(join(room, 'docs', 'agents', 'lanes.json'), JSON.stringify(lanes))
  writeFileSync(join(project, '.git', 'info', 'exclude'), '/.worktrees/\n')
  git(project, ['worktree', 'add', ...(detach ? ['--detach'] : []), worktree, 'feat/x'])

  return { base, room, project, worktree, briefsDir: join(room, 'docs', 'agents') }
}

async function startBridge({ projectRoot, briefsDir, hideGitAtStart = false }) {
  const previousPath = process.env.PATH
  if (hideGitAtStart) process.env.PATH = ''
  let bridge
  try {
    bridge = createBridge({
      projectRoot,
      briefsDir,
      runsFolder: join(projectRoot, '..', 'runs'),
      port: 0,
      paperclipUrl: 'http://127.0.0.1:1',
      companyId: 'company-1',
      reconnectMinMs: 60000,
      reconnectMaxMs: 60000,
      readTree: () => Promise.resolve({ root: 'project', files: [], created: [] }),
    })
  } finally {
    if (previousPath === undefined) delete process.env.PATH
    else process.env.PATH = previousPath
  }
  cleanups.push(() => bridge.stop())
  const { url } = await bridge.start()
  return { url }
}

function mergeRequest(url, lane, body) {
  return fetch(`${url}/api/control/reviews/${encodeURIComponent(lane)}/merge`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: new URL(url).origin },
    body: JSON.stringify(body),
  })
}

describe('review routes on another project', () => {
  it('lists the lane whose project worktree exists and names the project branch', async () => {
    const { project, worktree, briefsDir } = makeProject()
    const { url } = await startBridge({ projectRoot: project, briefsDir })
    const res = await fetch(`${url}/api/control/reviews`)
    expect(res.status).toBe(200)
    const { lanes } = await res.json()
    expect(lanes.map((entry) => entry.lane)).toEqual(['opencode'])

    const entry = lanes[0]
    expect(entry).toMatchObject({
      lane: 'opencode',
      worktree,
      branch: 'feat/x',
      base: 'trunk',
      ahead: 1,
      dirty: false,
      files: 1,
      added: 1,
      deleted: 0,
      lastRun: null,
    })
    expect(entry.head).toBe(git(worktree, ['rev-parse', 'HEAD']).trim())
    expect(entry.commits).toHaveLength(1)
    expect(entry.commits[0]).toMatch(/ lane work$/)
    expect(git(worktree, ['status', '--porcelain'])).toBe('')
  }, 40000)

  it('reads the last run from the bridge runs folder', async () => {
    const { project, briefsDir } = makeProject()
    const runs = join(project, '..', 'runs')
    mkdirSync(runs, { recursive: true })
    writeFileSync(join(runs, 'runs.jsonl'), `${JSON.stringify({ lane: 'opencode', briefs: [], startedAt: '2026-11-04T00:00:00.000Z', exitCode: 0 })}
`)
    const { url } = await startBridge({ projectRoot: project, briefsDir })
    const { lanes } = await (await fetch(`${url}/api/control/reviews`)).json()
    expect(lanes[0].lastRun).toMatchObject({ lane: 'opencode', startedAt: '2026-11-04T00:00:00.000Z' })
  }, 40000)

  it('answers the diff of the lane against the project branch', async () => {
    const { project, briefsDir } = makeProject()
    const { url } = await startBridge({ projectRoot: project, briefsDir })
    const res = await fetch(`${url}/api/control/reviews/opencode/diff`)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.lane).toBe('opencode')
    expect(body.branch).toBe('feat/x')
    expect(body.truncated).toBe(false)
    expect(body.files).toEqual([{ path: 'extra.js', added: 1, deleted: 0 }])
    expect(body.patch).toContain('diff --git a/extra.js b/extra.js')
    expect(body.patch).toContain('export const x = 1')
  }, 40000)

  it('fast-forwards the project branch to the lane head', async () => {
    const { project, worktree, briefsDir } = makeProject()
    const head = git(worktree, ['rev-parse', 'HEAD']).trim()
    const oldBase = git(project, ['rev-parse', 'HEAD']).trim()
    const { url } = await startBridge({ projectRoot: project, briefsDir })

    const res = await mergeRequest(url, 'opencode', { confirmed: true, head, message: 'Merge the lane' })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, lane: 'opencode', branch: 'feat/x', head, commit: head })
    expect(git(project, ['rev-parse', 'HEAD']).trim()).toBe(head)
    expect(git(project, ['rev-parse', 'HEAD^']).trim()).toBe(oldBase)
    expect(git(project, ['status', '--porcelain'])).toBe('')
    expect(existsSync(join(project, 'extra.js'))).toBe(true)

    const again = await mergeRequest(url, 'opencode', { confirmed: true, head, message: 'Merge the lane' })
    expect(again.status).toBe(409)
    expect(await again.json()).toEqual({ error: 'Nothing to merge.' })
    expect(git(project, ['rev-parse', 'HEAD']).trim()).toBe(head)
  }, 40000)

  it('refuses a merge when the project branch moved on and says to rebase', async () => {
    const { project, worktree, briefsDir } = makeProject()
    writeFileSync(join(project, 'notes.txt'), 'changed on the project\n')
    git(project, ['add', 'notes.txt'])
    git(project, ['commit', '-m', 'project moved on'])
    const projectHead = git(project, ['rev-parse', 'HEAD']).trim()
    const laneHead = git(worktree, ['rev-parse', 'HEAD']).trim()
    const { url } = await startBridge({ projectRoot: project, briefsDir })

    const res = await mergeRequest(url, 'opencode', { confirmed: true, head: laneHead, message: 'Merge the lane' })
    const answer = await res.json()
    expect(res.status, JSON.stringify(answer)).toBe(409)
    expect(answer).toEqual({
      error: 'The lane is not a fast forward of trunk. Rebase it onto trunk and read it again.',
    })
    expect(git(project, ['rev-parse', 'HEAD']).trim()).toBe(projectHead)
    expect(git(project, ['status', '--porcelain'])).toBe('')
    expect(git(worktree, ['rev-parse', 'HEAD']).trim()).toBe(laneHead)
  }, 40000)

  it('reads the room lanes when the project has no lane file of its own', async () => {
    const { room, project, briefsDir } = makeProject()
    rmSync(join(room, 'docs', 'agents', 'lanes.json'))
    const { url } = await startBridge({ projectRoot: project, briefsDir })
    const res = await fetch(`${url}/api/control/reviews`)
    expect(res.status).toBe(200)
    const { lanes } = await res.json()
    expect(lanes.map((entry) => entry.lane)).toContain('opencode')
    expect(lanes.find((entry) => entry.lane === 'opencode')?.base).toBe('trunk')
  }, 40000)

  it('fast-forwards a detached lane worktree, as a run-lane task makes it', async () => {
    const { project, worktree, briefsDir } = makeProject({ detach: true })
    const head = git(worktree, ['rev-parse', 'HEAD']).trim()
    const { url } = await startBridge({ projectRoot: project, briefsDir })

    const list = await fetch(`${url}/api/control/reviews`).then((r) => r.json())
    expect(list.lanes[0]).toMatchObject({ lane: 'opencode', branch: '', base: 'trunk', ahead: 1 })

    const res = await mergeRequest(url, 'opencode', { confirmed: true, head, message: 'Merge the lane' })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, lane: 'opencode', branch: '', head, commit: head })
    expect(git(project, ['rev-parse', 'HEAD']).trim()).toBe(head)
  }, 40000)

  it('keeps the project lanes when the checkout lookup cannot start git', async () => {
    const { project, worktree, briefsDir } = makeProject({ detach: true })
    const head = git(worktree, ['rev-parse', 'HEAD']).trim()
    const { url } = await startBridge({ projectRoot: project, briefsDir, hideGitAtStart: true })

    const list = await fetch(`${url}/api/control/reviews`).then((r) => r.json())
    expect(list.lanes.map((entry) => entry.lane)).toEqual(['opencode'])
    expect(list.lanes[0]).toMatchObject({ lane: 'opencode', branch: '', base: 'trunk', ahead: 1 })
    expect(list.lanes[0].head).toBe(head)
  }, 40000)

  it('reads the room lanes when the project has no lane file and git cannot start', async () => {
    const { room, project, briefsDir } = makeProject()
    rmSync(join(room, 'docs', 'agents', 'lanes.json'))
    const { url } = await startBridge({ projectRoot: project, briefsDir, hideGitAtStart: true })
    const res = await fetch(`${url}/api/control/reviews`)
    expect(res.status).toBe(200)
    const { lanes } = await res.json()
    expect(lanes.map((entry) => entry.lane)).toContain('opencode')
    expect(lanes.find((entry) => entry.lane === 'opencode')?.base).toBe('trunk')
  }, 40000)

  it('caches the code checkout only when the git read answers a path', () => {
    resetCodeCheckout()
    const previousPath = process.env.PATH
    try {
      process.env.PATH = ''
      const fallback = codeCheckout()
      expect(fallback).toBe(REPO_ROOT)
    } finally {
      if (previousPath === undefined) delete process.env.PATH
      else process.env.PATH = previousPath
    }
    const realCheckout = codeCheckout()
    expect(realCheckout).toBeTruthy()
    expect(realCheckout).not.toBe('')
    try {
      process.env.PATH = ''
      expect(codeCheckout()).toBe(realCheckout)
    } finally {
      if (previousPath === undefined) delete process.env.PATH
      else process.env.PATH = previousPath
    }
  })

  it('still reads every configured lane against main on MachineRoom itself', async () => {
    const briefsDir = join(REPO_ROOT, 'docs', 'agents')
    const lanesFile = JSON.parse(readFileSync(join(briefsDir, 'lanes.json'), 'utf8'))
    const configured = Object.values(lanesFile).filter(
      (lane) => lane && typeof lane === 'object' && typeof lane.worktree === 'string' && lane.worktree
    )
    const { url } = await startBridge({ projectRoot: REPO_ROOT, briefsDir })
    const res = await fetch(`${url}/api/control/reviews`)
    expect(res.status).toBe(200)
    const { lanes } = await res.json()
    expect(lanes).toHaveLength(configured.length)
    for (const entry of lanes) {
      expect(entry.base === undefined || entry.base === 'main', entry.lane).toBe(true)
    }
  }, 60000)
})

describe('review panel helpers', () => {
  it('carries the base branch and names it in the panel', () => {
    const row = reviewRow({
      lane: 'opencode',
      branch: 'feat/x',
      base: 'trunk',
      head: '1a2b3c4d5e6f708192a3b4c5d6e7f8091a2b3c4d',
      ahead: 1,
      dirty: false,
    })
    expect(row.base).toBe('trunk')

    const html = renderToString(
      createElement(ReviewsPanel, {
        client: null,
        initialReviews: [
          {
            lane: 'opencode',
            branch: 'feat/x',
            base: 'trunk',
            head: '1a2b3c4d5e6f708192a3b4c5d6e7f8091a2b3c4d',
            ahead: 1,
            dirty: false,
            files: 1,
            added: 1,
            deleted: 0,
          },
        ],
        initialDiff: null,
      })
    )
    expect(html).toContain('Each lane is compared against trunk.')
  })

  it('keeps a merge message for a lane that has no branch', () => {
    expect(defaultMergeMessage({ lane: 'opencode', branch: '' })).toBe('Merge opencode')
    expect(defaultMergeMessage({ lane: 'opencode', branch: 'feat/x' })).toBe("Merge opencode's feat/x")
    expect(defaultMergeMessage({})).toBe('')
  })
})
