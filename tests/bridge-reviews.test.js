import { execFileSync } from 'node:child_process'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createBridge } from '../server/index.js'
import { makeTempDir as makeTempRoot } from './helpers/tempRoot.js'

const REAL_TMP = tmpdir()
const NO_GIT_CONFIG = join(REAL_TMP, 'machineroom-reviews-no-git-config')
const cleanups = []

afterEach(async () => {
  while (cleanups.length > 0) {
    const fn = cleanups.pop()
    await fn()
  }
})

function makeTempDir() {
  const dir = makeTempRoot('mr-reviews-')
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }))
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

function makeLaneRepo() {
  const base = makeTempDir()
  const repo = join(base, 'repo')
  const worktree = join(base, 'lane-worktree')
  mkdirSync(repo, { recursive: true })
  git(repo, ['init', '-b', 'main'])
  writeFileSync(join(repo, 'notes.txt'), 'hello\n')
  git(repo, ['add', 'notes.txt'])
  git(repo, ['commit', '-m', 'first'])
  git(repo, ['worktree', 'add', '-b', 'feat/x', worktree])
  writeFileSync(join(worktree, 'notes.txt'), 'hello again\n')
  writeFileSync(join(worktree, 'extra.js'), 'export const x = 1\n')
  git(worktree, ['add', 'notes.txt', 'extra.js'])
  git(worktree, ['commit', '-m', 'second'])
  return { base, repo, worktree }
}

function useRunsTemp() {
  const dir = makeTempDir()
  const previous = process.env.TEMP
  process.env.TEMP = dir
  cleanups.push(() => {
    process.env.TEMP = previous
  })
  return dir
}

async function startReviewsBridge(lanes, { patchLimit, withFiles = true } = {}) {
  const dir = makeTempDir()
  if (withFiles) {
    const agentsDir = join(dir, 'docs', 'agents')
    mkdirSync(agentsDir, { recursive: true })
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'machine-room', version: '0.1.49' }))
    writeFileSync(join(agentsDir, 'lanes.json'), JSON.stringify(lanes))
  }
  const bridge = createBridge({
    projectRoot: dir,
    port: 0,
    paperclipUrl: 'http://127.0.0.1:1',
    companyId: 'company-1',
    reconnectMinMs: 60000,
    reconnectMaxMs: 60000,
    patchLimit,
  })
  cleanups.push(() => bridge.stop())
  const { url } = await bridge.start()
  return { url, dir }
}

describe('review routes', () => {
  it('lists each lane with its branch, commits, diff totals and its newest run record', async () => {
    useRunsTemp()
    const { worktree, base } = makeLaneRepo()
    const runsDir = join(process.env.TEMP, 'machineroom-runs')
    mkdirSync(runsDir, { recursive: true })
    const older = { lane: 'opencode', briefs: ['T5'], model: null, reasoning: null, startedAt: '2026-10-18T10:00:00.000Z', minutes: 1, exitCode: 0, killed: false, costUsd: null, log: null, branch: 'feat/x', commits: [] }
    const newer = { ...older, startedAt: '2026-10-18T11:00:00.000Z', minutes: 2 }
    const other = { ...older, lane: 'hermes', startedAt: '2026-10-18T12:00:00.000Z' }
    writeFileSync(join(runsDir, 'runs.jsonl'), [JSON.stringify(older), JSON.stringify(newer), JSON.stringify(other)].join('\n'))

    const { url } = await startReviewsBridge({
      opencode: { name: 'OpenCode', worktree },
      hermes: { name: 'Hermes', worktree: join(base, 'gone') },
      quiet: { name: 'No worktree here' },
    })
    const res = await fetch(`${url}/api/control/reviews`)
    expect(res.status).toBe(200)
    const { lanes } = await res.json()
    expect(lanes.map((entry) => entry.lane)).toEqual(['opencode', 'hermes'])

    const entry = lanes[0]
    expect(entry).toMatchObject({
      lane: 'opencode',
      worktree,
      branch: 'feat/x',
      ahead: 1,
      dirty: false,
      files: 2,
      added: 2,
      deleted: 1,
      lastRun: newer,
    })
    expect(entry.commits).toHaveLength(1)
    expect(entry.commits[0]).toMatch(/ second$/)

    expect(git(worktree, ['status', '--porcelain'])).toBe('')
  })

  it('marks a worktree with uncommitted changes as dirty', async () => {
    const { worktree } = makeLaneRepo()
    writeFileSync(join(worktree, 'extra.js'), 'export const x = 2\n')
    writeFileSync(join(worktree, 'scratch.md'), 'notes\n')
    const { url } = await startReviewsBridge({ opencode: { name: 'OpenCode', worktree } })
    const { lanes } = await fetch(`${url}/api/control/reviews`).then((r) => r.json())
    expect(lanes[0]).toMatchObject({ lane: 'opencode', dirty: true, ahead: 1, files: 2, added: 2, deleted: 1 })
  })

  it('gives a plain error for a missing worktree and for a folder that is not a repository, and still answers the others', async () => {
    const { worktree, base } = makeLaneRepo()
    const plain = join(base, 'plain-folder')
    mkdirSync(plain, { recursive: true })
    const missing = join(base, 'gone')
    const { url } = await startReviewsBridge({
      opencode: { name: 'OpenCode', worktree },
      hermes: { name: 'Hermes', worktree: missing },
      agy: { name: 'agy', worktree: plain },
    })
    const { lanes } = await fetch(`${url}/api/control/reviews`).then((r) => r.json())
    expect(lanes).toHaveLength(3)
    expect(lanes[0]).toMatchObject({ lane: 'opencode', branch: 'feat/x' })
    expect(lanes[0].error).toBeUndefined()
    expect(lanes[1]).toEqual({ lane: 'hermes', worktree: missing, error: 'That worktree is missing.' })
    expect(lanes[2]).toEqual({ lane: 'agy', worktree: plain, error: 'That folder is not a git repository.' })
  })

  it('answers the diff of a lane with its files and its patch', async () => {
    const { worktree } = makeLaneRepo()
    const { url } = await startReviewsBridge({ opencode: { name: 'OpenCode', worktree } })
    const res = await fetch(`${url}/api/control/reviews/opencode/diff`)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.lane).toBe('opencode')
    expect(body.branch).toBe('feat/x')
    expect(body.truncated).toBe(false)
    expect(body.files).toEqual([
      { path: 'extra.js', added: 1, deleted: 0 },
      { path: 'notes.txt', added: 1, deleted: 1 },
    ])
    expect(body.patch).toContain('diff --git a/notes.txt b/notes.txt')
    expect(body.patch).toContain('hello again')
  })

  it('cuts the patch at the patch limit and says so', async () => {
    const { worktree } = makeLaneRepo()
    const { url } = await startReviewsBridge({ opencode: { name: 'OpenCode', worktree } }, { patchLimit: 120 })
    const body = await fetch(`${url}/api/control/reviews/opencode/diff`).then((r) => r.json())
    expect(body.truncated).toBe(true)
    expect(body.patch).toHaveLength(120)
    expect(body.files).toHaveLength(2)
  })

  it('answers 404 with a plain sentence for a lane name that is not a lane, and never runs git on it', async () => {
    const { worktree } = makeLaneRepo()
    const { url } = await startReviewsBridge({ opencode: { name: 'OpenCode', worktree } })
    for (const lane of ['__proto__', 'constructor', '..%2F..', '%ZZ']) {
      const res = await fetch(`${url}/api/control/reviews/${lane}/diff`)
      expect(res.status, lane).toBe(404)
      expect(await res.json(), lane).toEqual({ error: 'Choose a lane from the list.' })
    }
    expect((await fetch(`${url}/api/health`)).status).toBe(200)
    const after = await fetch(`${url}/api/control/reviews/opencode/diff`).then((r) => r.json())
    expect(after.branch).toBe('feat/x')
  })

  it('answers 404 for a lane whose worktree is missing, and 405 for anything but GET', async () => {
    const { base } = makeLaneRepo()
    const missing = join(base, 'gone')
    const { url } = await startReviewsBridge({ hermes: { name: 'Hermes', worktree: missing } })
    const diff = await fetch(`${url}/api/control/reviews/hermes/diff`)
    expect(diff.status).toBe(404)
    expect(await diff.json()).toEqual({ error: 'That worktree is missing.' })
    for (const path of ['/api/control/reviews', '/api/control/reviews/hermes/diff']) {
      const res = await fetch(`${url}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })
      expect(res.status, path).toBe(405)
    }
  })

  it('answers 404 without a path when the lane file is missing', async () => {
    const { url, dir } = await startReviewsBridge({}, { withFiles: false })
    for (const path of ['/api/control/reviews', '/api/control/reviews/hermes/diff']) {
      const res = await fetch(`${url}${path}`)
      expect(res.status, path).toBe(404)
      const body = await res.json()
      expect(body.error).toBe('The lane file is missing.')
      expect(body.error).not.toContain(dir)
    }
  })
})
