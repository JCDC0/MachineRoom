import { execFileSync } from 'node:child_process'
import { cpSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createBridge } from '../server/index.js'
import { defaultGitRunner, GIT_TIMEOUT_MS, GIT_WRITE_TIMEOUT_MS } from '../server/git.js'
import { gitPath } from '../server/programPath.js'
import { createReviewsApi, mapConcurrent, NOT_OWNER_PROBLEM } from '../server/reviews.js'
import { requestJson } from './helpers/httpJson.js'
import { makeTempDir as makeTempRoot, processTempRoot, removeTempDir } from './helpers/tempRoot.js'

const NO_GIT_CONFIG = join(processTempRoot(), 'no-git-config')
const GIT_ENV = {
  GIT_CONFIG_SYSTEM: NO_GIT_CONFIG,
  GIT_CONFIG_GLOBAL: NO_GIT_CONFIG,
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_CONFIG_COUNT: '2',
  GIT_CONFIG_KEY_0: 'commit.gpgsign',
  GIT_CONFIG_VALUE_0: 'false',
  GIT_CONFIG_KEY_1: 'core.autocrlf',
  GIT_CONFIG_VALUE_1: 'false',
  GIT_OPTIONAL_LOCKS: '0',
  GIT_TERMINAL_PROMPT: '0',
  GIT_AUTHOR_NAME: 'MachineRoom Test',
  GIT_AUTHOR_EMAIL: 'test@example.invalid',
  GIT_COMMITTER_NAME: 'MachineRoom Test',
  GIT_COMMITTER_EMAIL: 'test@example.invalid',
}
const cleanups = []
let previousTemp
let templateCleanup = null
const savedGitEnv = new Map()

for (const [key, value] of Object.entries(GIT_ENV)) {
  savedGitEnv.set(key, process.env[key])
  process.env[key] = value
}

beforeEach(() => {
  const dir = makeTempDir('mr-reviews-runs-')
  previousTemp = process.env.TEMP
  const previousRuns = process.env.MACHINEROOM_RUNS
  process.env.TEMP = dir
  process.env.MACHINEROOM_RUNS = join(dir, 'machineroom-runs')
  cleanups.push(() => {
    if (previousTemp === undefined) delete process.env.TEMP
    else process.env.TEMP = previousTemp
    if (previousRuns === undefined) delete process.env.MACHINEROOM_RUNS
    else process.env.MACHINEROOM_RUNS = previousRuns
  })
})

afterEach(async () => {
  while (cleanups.length > 0) {
    const fn = cleanups.pop()
    await fn()
  }
})

afterAll(() => {
  for (const [key, value] of savedGitEnv) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
  templateCleanup?.()
  templateCleanup = null
})

function makeTempDir() {
  const dir = makeTempRoot('mr-reviews-')
  cleanups.push(() => removeTempDir(dir))
  return dir
}

function git(cwd, args) {
  return execFileSync(gitPath(), args, {
    cwd,
    shell: false,
    windowsHide: true,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, ...GIT_ENV },
  })
}

function laneTemplate() {
  const base = makeTempRoot('mr-reviews-template-')
  templateCleanup = () => removeTempDir(base)
  const repo = join(base, 'repo')
  mkdirSync(repo)
  git(repo, ['init', '-b', 'main'])
  git(repo, ['config', 'user.name', 'MachineRoom Test'])
  git(repo, ['config', 'user.email', 'test@example.invalid'])
  git(repo, ['config', 'commit.gpgsign', 'false'])
  git(repo, ['config', 'core.autocrlf', 'false'])
  writeFileSync(join(repo, 'notes.txt'), 'hello\n')
  git(repo, ['add', 'notes.txt'])
  git(repo, ['commit', '-m', 'first'])
  git(repo, ['switch', '-c', 'feat/x'])
  writeFileSync(join(repo, 'notes.txt'), 'hello again\n')
  writeFileSync(join(repo, 'extra.js'), 'export const x = 1\n')
  git(repo, ['add', 'notes.txt', 'extra.js'])
  git(repo, ['commit', '-m', 'second'])
  git(repo, ['switch', 'main'])
  return repo
}

const TEMPLATE_REPO = laneTemplate()

function makeLaneRepo() {
  const base = makeTempDir()
  const repo = join(base, 'repo')
  cpSync(TEMPLATE_REPO, repo, { recursive: true })
  const worktree = join(base, 'lane-worktree')
  git(repo, ['worktree', 'add', worktree, 'feat/x'])
  return { base, repo, worktree }
}

async function startReviewsBridge(lanes, { patchLimit, withFiles = true, projectRoot } = {}) {
  const dir = makeTempDir()
  if (withFiles) {
    const agentsDir = join(dir, 'docs', 'agents')
    mkdirSync(agentsDir, { recursive: true })
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'machine-room', version: '0.1.49' }))
    writeFileSync(join(agentsDir, 'lanes.json'), JSON.stringify(lanes))
  }
  const bridge = createBridge({
    projectRoot: projectRoot ?? dir,
    briefsDir: join(dir, 'docs', 'agents'),
    port: 0,
    patchLimit,
    readTree: () => Promise.resolve({ root: 'project', files: [], created: [] }),
  })
  cleanups.push(() => bridge.stop())
  const { url } = await bridge.start()
  return { url, dir }
}

function mergeRequest(url, lane, body, headers = { origin: new URL(url).origin }) {
  return requestJson(`${url}/api/control/reviews/${encodeURIComponent(lane)}/merge`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
    timeoutMs: 30000,
  })
}

function repoState(repo, worktree) {
  return {
    refs: git(repo, ['for-each-ref', '--format=%(refname) %(objectname)']),
    mainStatus: git(repo, ['status', '--porcelain']),
    laneStatus: git(worktree, ['status', '--porcelain']),
  }
}

function gitExit(cwd, args) {
  try {
    git(cwd, args)
    return 0
  } catch (error) {
    return error.status ?? 1
  }
}

async function expectMergeRefusal(url, lane, body, { status, error, repo, worktree }) {
  await expectMergeRefusals(url, [{ lane, body }], { status, error, repo, worktree })
}

async function expectMergeStatuses(url, asks, { status, error }) {
  for (const ask of asks) {
    const res = await mergeRequest(url, ask.lane, ask.body)
    expect(res.status, ask.lane).toBe(status)
    expect(await res.json(), ask.lane).toEqual({ error })
  }
}

async function expectMergeRefusals(url, asks, { status, error, repo, worktree }) {
  const before = repoState(repo, worktree)
  await expectMergeStatuses(url, asks, { status, error })
  expect(repoState(repo, worktree)).toEqual(before)
}

describe('review routes', () => {
  it('lists each lane with its branch, commits, diff totals and its newest run record', async () => {
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
    const res = await requestJson(`${url}/api/control/reviews`)
    expect(res.status).toBe(200)
    const { lanes } = await res.json()
    expect(lanes.map((entry) => entry.lane)).toEqual(['opencode', 'hermes'])

    const entry = lanes[0]
    expect(entry).toMatchObject({
      lane: 'opencode',
      worktree,
      branch: 'feat/x',
      head: git(worktree, ['rev-parse', 'HEAD']).trim(),
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
    const { lanes } = await requestJson(`${url}/api/control/reviews`).then((r) => r.json())
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
    const { lanes } = await requestJson(`${url}/api/control/reviews`).then((r) => r.json())
    expect(lanes).toHaveLength(3)
    expect(lanes[0]).toMatchObject({ lane: 'opencode', branch: 'feat/x' })
    expect(lanes[0].error).toBeUndefined()
    expect(lanes[1]).toEqual({ lane: 'hermes', worktree: missing, error: 'That worktree is missing.' })
    expect(lanes[2]).toEqual({ lane: 'agy', worktree: plain, error: 'That folder is not a git repository.' })
  })

  it('reads runs.jsonl once per reviews request across all lanes', async () => {
    let readCount = 0
    const dir = makeTempDir()
    const agentsDir = join(dir, 'docs', 'agents')
    mkdirSync(agentsDir, { recursive: true })
    writeFileSync(
      join(agentsDir, 'lanes.json'),
      JSON.stringify({
        lane1: { name: 'Lane 1' },
        lane2: { name: 'Lane 2' },
        lane3: { name: 'Lane 3' },
      })
    )
    const answers = []
    const api = createReviewsApi({
      projectRoot: dir,
      briefsDir: agentsDir,
      sendJson: (req, res, status, body) => answers.push({ status, body }),
      readJsonBody: async () => ({}),
      orchestrators: () => null,
      readRuns: () => {
        readCount += 1
        return []
      },
    })
    const handled = await api.handle({ method: 'GET', headers: {} }, {}, new URL('http://127.0.0.1/api/control/reviews'))
    expect(handled).toBe(true)
    expect(answers[0].status).toBe(200)
    expect(readCount).toBe(1)
  })

  it('finds a lane run that is older than twenty records of other lanes', async () => {
    const { repo, worktree } = makeLaneRepo()
    const agentsDir = join(makeTempDir(), 'docs', 'agents')
    mkdirSync(agentsDir, { recursive: true })
    writeFileSync(join(agentsDir, 'lanes.json'), JSON.stringify({ opencode: { name: 'OpenCode', worktree } }))
    const records = [
      { lane: 'opencode', startedAt: '2026-10-01T10:00:00.000Z', briefs: ['S27'] },
      ...Array.from({ length: 24 }, (_, index) => ({
        lane: 'hermes',
        startedAt: `2026-10-02T10:${String(index).padStart(2, '0')}:00.000Z`,
      })),
    ]
    const answers = []
    const api = createReviewsApi({
      projectRoot: repo,
      briefsDir: agentsDir,
      sendJson: (req, res, status, body) => answers.push({ status, body }),
      readJsonBody: async () => ({}),
      orchestrators: () => null,
      readRuns: () => records,
    })
    expect(await api.handle({ method: 'GET', headers: {} }, {}, new URL('http://127.0.0.1/api/control/reviews'))).toBe(true)
    expect(answers[0].status).toBe(200)
    expect(answers[0].body.lanes[0].lastRun).toMatchObject({ lane: 'opencode', briefs: ['S27'] })
  })

  it('answers the diff of a lane with its files and its patch', async () => {
    const { worktree } = makeLaneRepo()
    const { url } = await startReviewsBridge({ opencode: { name: 'OpenCode', worktree } })
    const res = await requestJson(`${url}/api/control/reviews/opencode/diff`)
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

  it('names the head it read and keeps a later commit out of the patch', async () => {
    const { worktree } = makeLaneRepo()
    const firstHead = git(worktree, ['rev-parse', 'HEAD']).trim()
    const { url } = await startReviewsBridge({ opencode: { name: 'OpenCode', worktree } })

    const first = await requestJson(`${url}/api/control/reviews/opencode/diff`).then((r) => r.json())
    expect(first.head).toBe(firstHead)
    expect(first.patch).not.toContain('later.js')

    writeFileSync(join(worktree, 'later.js'), 'export const later = true\n')
    git(worktree, ['add', 'later.js'])
    git(worktree, ['commit', '-m', 'later'])

    const second = await requestJson(`${url}/api/control/reviews/opencode/diff`).then((r) => r.json())
    expect(second.head).toBe(git(worktree, ['rev-parse', 'HEAD']).trim())
    expect(second.head).not.toBe(firstHead)
    expect(second.patch).toContain('later.js')
  })

  it('keeps the patch at the head it names when a commit lands while it reads', async () => {
    const { worktree } = makeLaneRepo()
    const before = git(worktree, ['rev-parse', 'HEAD']).trim()
    const { url } = await startReviewsBridge({ opencode: { name: 'OpenCode', worktree } })

    const pending = requestJson(`${url}/api/control/reviews/opencode/diff`)
    writeFileSync(join(worktree, 'late.js'), 'export const late = true\n')
    git(worktree, ['add', 'late.js'])
    git(worktree, ['commit', '-m', 'late'])
    const after = git(worktree, ['rev-parse', 'HEAD']).trim()
    expect(after).not.toBe(before)

    const body = await pending.then((r) => r.json())
    expect([before, after]).toContain(body.head)
    const expected = git(worktree, ['diff', '--no-ext-diff', '--no-textconv', `refs/heads/main...${body.head}`])
    expect(body.patch).toBe(expected)
    if (body.head === before) expect(body.patch).not.toContain('late.js')
  }, 20000)

  it('cuts the patch at the patch limit and says so', async () => {
    const { worktree } = makeLaneRepo()
    const { url } = await startReviewsBridge({ opencode: { name: 'OpenCode', worktree } }, { patchLimit: 120 })
    const body = await requestJson(`${url}/api/control/reviews/opencode/diff`).then((r) => r.json())
    expect(body.truncated).toBe(true)
    expect(body.patch).toHaveLength(120)
    expect(body.files).toHaveLength(2)
  })

  it('answers 404 with a plain sentence for a lane name that is not a lane, and never runs git on it', async () => {
    const { worktree } = makeLaneRepo()
    const { url } = await startReviewsBridge({ opencode: { name: 'OpenCode', worktree } })
    for (const lane of ['__proto__', 'constructor', '..%2F..', '%ZZ']) {
      const res = await requestJson(`${url}/api/control/reviews/${lane}/diff`)
      expect(res.status, lane).toBe(404)
      expect(await res.json(), lane).toEqual({ error: 'Choose a lane from the list.' })
    }
    expect((await requestJson(`${url}/api/health`)).status).toBe(200)
    const after = await requestJson(`${url}/api/control/reviews/opencode/diff`).then((r) => r.json())
    expect(after.branch).toBe('feat/x')
  })

  it('answers 404 for a lane whose worktree is missing, and 405 for anything but GET', async () => {
    const { base } = makeLaneRepo()
    const missing = join(base, 'gone')
    const { url } = await startReviewsBridge({ hermes: { name: 'Hermes', worktree: missing } })
    const diff = await requestJson(`${url}/api/control/reviews/hermes/diff`)
    expect(diff.status).toBe(404)
    expect(await diff.json()).toEqual({ error: 'That worktree is missing.' })
    for (const path of ['/api/control/reviews', '/api/control/reviews/hermes/diff']) {
      const res = await requestJson(`${url}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })
      expect(res.status, path).toBe(405)
    }
    const mergeGet = await requestJson(`${url}/api/control/reviews/hermes/merge`)
    expect(mergeGet.status).toBe(405)
  })

  it('answers 404 without a path when the lane file is missing', async () => {
    const { url, dir } = await startReviewsBridge({}, { withFiles: false })
    for (const path of ['/api/control/reviews', '/api/control/reviews/hermes/diff']) {
      const res = await requestJson(`${url}${path}`)
      expect(res.status, path).toBe(404)
      const body = await res.json()
      expect(body.error).toBe('The lane file is missing.')
      expect(body.error).not.toContain(dir)
    }
  })
})

describe('merge route', { timeout: 30000 }, () => {
  it('refuses a merge with no Origin and no orchestrator token', async () => {
    const { repo, worktree } = makeLaneRepo()
    const head = git(worktree, ['rev-parse', 'HEAD']).trim()
    const oldMain = git(repo, ['rev-parse', 'HEAD']).trim()
    const { url } = await startReviewsBridge({ opencode: { name: 'OpenCode', worktree } }, { projectRoot: repo })

    const res = await mergeRequest(url, 'opencode', { confirmed: true, head, message: 'Merge the lane' }, {})
    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({ error: NOT_OWNER_PROBLEM })
    expect(git(repo, ['rev-parse', 'HEAD']).trim()).toBe(oldMain)
    expect(git(repo, ['status', '--porcelain'])).toBe('')
  })

  it('takes a valid orchestrator token with no Origin and refuses a wrong one', async () => {
    const answers = []
    const dir = makeTempDir()
    const api = createReviewsApi({
      projectRoot: dir,
      briefsDir: join(dir, 'docs', 'agents'),
      sendJson: (req, res, status, body) => {
        answers.push({ status, body })
      },
      readJsonBody: async () => ({ confirmed: true, head: '0'.repeat(40), message: 'Merge the lane' }),
      orchestrators: () => ({ idForToken: (value) => (value === 'main-token' ? 'orchestrator' : null) }),
    })
    const path = new URL('http://127.0.0.1/api/control/reviews/opencode/merge')

    expect(await api.handle({ method: 'POST', headers: { 'x-machineroom-orchestrator': 'main-token' } }, {}, path)).toBe(true)
    expect(answers[0]).toEqual({ status: 404, body: { error: 'The lane file is missing.' } })

    answers.length = 0
    await api.handle({ method: 'POST', headers: { 'x-machineroom-orchestrator': 'wrong-token' } }, {}, path)
    expect(answers[0]).toEqual({ status: 403, body: { error: NOT_OWNER_PROBLEM } })
  })

  it('merges the checked head into main and answers the new commit', async () => {
    const { repo, worktree } = makeLaneRepo()
    const head = git(worktree, ['rev-parse', 'HEAD']).trim()
    const oldMain = git(repo, ['rev-parse', 'HEAD']).trim()
    const { url } = await startReviewsBridge({ opencode: { name: 'OpenCode', worktree } }, { projectRoot: repo })

    const res = await mergeRequest(url, 'opencode', { confirmed: true, head, message: 'Merge the lane' })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual({ ok: true, lane: 'opencode', branch: 'feat/x', head, commit: expect.stringMatching(/^[0-9a-f]{40}$/) })
    const [merged, firstParent, secondParent] = git(repo, ['rev-parse', 'HEAD', 'HEAD^1', 'HEAD^2']).trim().split(/\r?\n/)
    expect(merged).toBe(body.commit)
    expect(git(repo, ['log', '-1', '--format=%s']).trim()).toBe('Merge the lane')
    expect(firstParent).toBe(oldMain)
    expect(secondParent).toBe(head)
    expect(git(repo, ['status', '--porcelain'])).toBe('')

    const again = await mergeRequest(url, 'opencode', { confirmed: true, head, message: 'Merge the lane' })
    expect(again.status).toBe(409)
    expect(await again.json()).toEqual({ error: 'Nothing to merge.' })
    expect(git(repo, ['rev-parse', 'HEAD']).trim()).toBe(body.commit)
    expect(git(repo, ['status', '--porcelain'])).toBe('')
    expect(git(worktree, ['status', '--porcelain'])).toBe('')
  })

  it('tells open pages that git changed after a merge', async () => {
    const { repo, worktree } = makeLaneRepo()
    const head = git(worktree, ['rev-parse', 'HEAD']).trim()
    const { url } = await startReviewsBridge({ opencode: { name: 'OpenCode', worktree } }, { projectRoot: repo })
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 10000)
    try {
      const events = await fetch(`${url}/events`, { signal: controller.signal })
      const res = await mergeRequest(url, 'opencode', { confirmed: true, head, message: 'Merge the lane' })
      expect(res.status).toBe(200)
      let text = ''
      for await (const chunk of events.body) {
        text += Buffer.from(chunk).toString('utf8')
        if (text.includes('"topic":"git"')) break
      }
      expect(text).toContain('"topic":"git"')
    } finally {
      clearTimeout(timer)
      controller.abort()
    }
  })

  it('answers 404 for a lane that is not an own key with a worktree, and for a missing worktree', async () => {
    const { base, repo, worktree } = makeLaneRepo()
    const missing = join(base, 'gone')
    const { url } = await startReviewsBridge(
      {
        opencode: { name: 'OpenCode', worktree },
        hermes: { name: 'Hermes', worktree: missing },
        quiet: { name: 'No worktree here' },
      },
      { projectRoot: repo }
    )
    const body = { confirmed: true, head: '0'.repeat(40), message: 'Merge the lane' }
    const lanes = ['__proto__', 'constructor', '..%2F..', '%ZZ', 'nobody', 'quiet']
    await expectMergeStatuses(url, lanes.map((lane) => ({ lane, body })), {
      status: 404,
      error: 'Choose a lane from the list.',
    })
    await expectMergeRefusal(url, 'hermes', body, { status: 404, error: 'That worktree is missing.', repo, worktree })
  })

  it('refuses a merge that was not confirmed', async () => {
    const { repo, worktree } = makeLaneRepo()
    const head = git(worktree, ['rev-parse', 'HEAD']).trim()
    const { url } = await startReviewsBridge({ opencode: { name: 'OpenCode', worktree } }, { projectRoot: repo })
    const asks = [undefined, false, 'true', 1].map((confirmed) => {
      const body = { head, message: 'Merge the lane' }
      if (confirmed !== undefined) body.confirmed = confirmed
      return { lane: 'opencode', body }
    })
    await expectMergeRefusals(url, asks, { status: 400, error: 'Confirm the merge first.', repo, worktree })
  })

  it('refuses a head that is not a sha or a message that is not one short line', async () => {
    const { repo, worktree } = makeLaneRepo()
    const head = git(worktree, ['rev-parse', 'HEAD']).trim()
    const { url } = await startReviewsBridge({ opencode: { name: 'OpenCode', worktree } }, { projectRoot: repo })
    const bodies = [
      { confirmed: true, head: 'abc', message: 'Merge the lane' },
      { confirmed: true, head: head.slice(0, 39), message: 'Merge the lane' },
      { confirmed: true, head: 'g'.repeat(40), message: 'Merge the lane' },
      { confirmed: true, head: null, message: 'Merge the lane' },
      { confirmed: true, head, message: '' },
      { confirmed: true, head, message: 'x'.repeat(201) },
      { confirmed: true, head, message: 'one\ntwo' },
      { confirmed: true, head, message: 42 },
    ]
    const asks = bodies.map((body) => ({ lane: 'opencode', body }))
    await expectMergeRefusals(url, asks, {
      status: 400,
      error: 'Send the head you read and a message of one line.',
      repo,
      worktree,
    })
  })

  it('refuses a merge while the main checkout is not on main', async () => {
    const { repo, worktree } = makeLaneRepo()
    git(repo, ['switch', '-c', 'side'])
    const head = git(worktree, ['rev-parse', 'HEAD']).trim()
    const { url } = await startReviewsBridge({ opencode: { name: 'OpenCode', worktree } }, { projectRoot: repo })
    await expectMergeRefusal(url, 'opencode', { confirmed: true, head, message: 'Merge the lane' }, {
      status: 409,
      error: 'The main checkout is not on main.',
      repo,
      worktree,
    })
  })

  it('refuses a merge while the main checkout has uncommitted changes', async () => {
    const { repo, worktree } = makeLaneRepo()
    writeFileSync(join(repo, 'notes.txt'), 'changed on main\n')
    const head = git(worktree, ['rev-parse', 'HEAD']).trim()
    const { url } = await startReviewsBridge({ opencode: { name: 'OpenCode', worktree } }, { projectRoot: repo })
    await expectMergeRefusal(url, 'opencode', { confirmed: true, head, message: 'Merge the lane' }, {
      status: 409,
      error: 'The main checkout has uncommitted changes.',
      repo,
      worktree,
    })
  })

  it('refuses a head that is not the lane head any more', async () => {
    const { repo, worktree } = makeLaneRepo()
    const { url } = await startReviewsBridge({ opencode: { name: 'OpenCode', worktree } }, { projectRoot: repo })
    await expectMergeRefusal(url, 'opencode', { confirmed: true, head: '0'.repeat(40), message: 'Merge the lane' }, {
      status: 409,
      error: 'The lane moved since you read it. Read it again.',
      repo,
      worktree,
    })
  })

  it('refuses a merge while the lane has uncommitted changes', async () => {
    const { repo, worktree } = makeLaneRepo()
    const head = git(worktree, ['rev-parse', 'HEAD']).trim()
    writeFileSync(join(worktree, 'extra.js'), 'export const x = 2\n')
    const { url } = await startReviewsBridge({ opencode: { name: 'OpenCode', worktree } }, { projectRoot: repo })
    await expectMergeRefusal(url, 'opencode', { confirmed: true, head, message: 'Merge the lane' }, {
      status: 409,
      error: 'The lane has uncommitted changes.',
      repo,
      worktree,
    })
  })

  it('stops on a conflict, aborts the merge and leaves main as it was', async () => {
    const { repo, worktree } = makeLaneRepo()
    writeFileSync(join(repo, 'notes.txt'), 'changed on main\n')
    git(repo, ['add', 'notes.txt'])
    git(repo, ['commit', '-m', 'main change'])
    const head = git(worktree, ['rev-parse', 'HEAD']).trim()
    const oldMain = git(repo, ['rev-parse', 'HEAD']).trim()
    const { url } = await startReviewsBridge({ opencode: { name: 'OpenCode', worktree } }, { projectRoot: repo })
    const before = repoState(repo, worktree)

    const res = await mergeRequest(url, 'opencode', { confirmed: true, head, message: 'Merge the lane' })
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: 'The merge stopped on a conflict. Nothing changed.', files: ['notes.txt'] })
    expect(git(repo, ['rev-parse', 'HEAD']).trim()).toBe(oldMain)
    expect(git(repo, ['status', '--porcelain'])).toBe('')
    expect(gitExit(repo, ['rev-parse', '-q', '--verify', 'MERGE_HEAD'])).not.toBe(0)
    expect(repoState(repo, worktree)).toEqual(before)
  })

  it('merges two changelog lines through the union driver', async () => {
    const base = makeTempDir()
    const repo = join(base, 'repo')
    const worktree = join(base, 'lane-worktree')
    mkdirSync(join(repo, 'docs', 'agents'), { recursive: true })
    git(repo, ['init', '-b', 'main'])
    git(repo, ['config', 'user.name', 'MachineRoom Test'])
    git(repo, ['config', 'user.email', 'test@example.invalid'])
    git(repo, ['config', 'commit.gpgsign', 'false'])
    git(repo, ['config', 'core.autocrlf', 'false'])
    writeFileSync(join(repo, '.gitattributes'), 'docs/agents/CHANGELOG.md merge=union\n')
    writeFileSync(join(repo, 'docs', 'agents', 'CHANGELOG.md'), '# Changelog\n\n## Unreleased\n\n- base line\n')
    writeFileSync(join(repo, 'notes.txt'), 'hello\n')
    git(repo, ['add', '.'])
    git(repo, ['commit', '-m', 'base'])
    git(repo, ['worktree', 'add', '-b', 'feat/x', worktree])
    writeFileSync(join(worktree, 'docs', 'agents', 'CHANGELOG.md'), '# Changelog\n\n## Unreleased\n\n- base line\n- lane line\n')
    git(worktree, ['add', 'docs/agents/CHANGELOG.md'])
    git(worktree, ['commit', '-m', 'lane line'])
    writeFileSync(join(repo, 'docs', 'agents', 'CHANGELOG.md'), '# Changelog\n\n## Unreleased\n\n- base line\n- main line\n')
    git(repo, ['add', 'docs/agents/CHANGELOG.md'])
    git(repo, ['commit', '-m', 'main line'])
    const head = git(worktree, ['rev-parse', 'HEAD']).trim()
    const { url } = await startReviewsBridge({ opencode: { name: 'OpenCode', worktree } }, { projectRoot: repo })

    const res = await mergeRequest(url, 'opencode', { confirmed: true, head, message: 'Merge the changelog' })
    expect(res.status).toBe(200)
    const merged = git(repo, ['show', 'HEAD:docs/agents/CHANGELOG.md'])
    expect(merged).toContain('- base line')
    expect(merged).toContain('- lane line')
    expect(merged).toContain('- main line')
    expect(git(repo, ['status', '--porcelain'])).toBe('')
  })

  it('reads the lane against the main branch even when a tag named main points inside the lane', async () => {
    const { repo, worktree } = makeLaneRepo()
    writeFileSync(join(worktree, 'hidden.js'), 'export const y = 2\n')
    git(worktree, ['add', 'hidden.js'])
    git(worktree, ['commit', '-m', 'third'])
    git(worktree, ['tag', 'main', 'HEAD~1'])
    const { url } = await startReviewsBridge({ opencode: { name: 'OpenCode', worktree } }, { projectRoot: repo })

    const { lanes } = await requestJson(`${url}/api/control/reviews`).then((r) => r.json())
    expect(lanes[0]).toMatchObject({ lane: 'opencode', ahead: 2, files: 3 })
    const diff = await requestJson(`${url}/api/control/reviews/opencode/diff`).then((r) => r.json())
    expect(diff.files.map((file) => file.path)).toEqual(['extra.js', 'hidden.js', 'notes.txt'])
  })

  it('merges a lane whose head a tag named main points at', async () => {
    const { repo, worktree } = makeLaneRepo()
    const head = git(worktree, ['rev-parse', 'HEAD']).trim()
    git(worktree, ['tag', 'main', head])
    const { url } = await startReviewsBridge({ opencode: { name: 'OpenCode', worktree } }, { projectRoot: repo })
    const res = await mergeRequest(url, 'opencode', { confirmed: true, head, message: 'Merge the lane' })
    expect(res.status).toBe(200)
    expect(git(repo, ['rev-parse', 'refs/heads/main^2']).trim()).toBe(head)
  })

  it('answers the lock sentence to a second merge sent at the same time', async () => {
    const { repo, worktree } = makeLaneRepo()
    const head = git(worktree, ['rev-parse', 'HEAD']).trim()
    for (let i = 0; i < 120; i += 1) {
      writeFileSync(join(worktree, `file-${i}.txt`), `line ${i}\n`)
    }
    git(worktree, ['add', '.'])
    git(worktree, ['commit', '-m', 'many files'])
    const manyHead = git(worktree, ['rev-parse', 'HEAD']).trim()
    const { url } = await startReviewsBridge({ opencode: { name: 'OpenCode', worktree } }, { projectRoot: repo })
    const body = { confirmed: true, head: manyHead, message: 'Merge the lane' }
    const [first, second] = await Promise.all([mergeRequest(url, 'opencode', body), mergeRequest(url, 'opencode', body)])
    const statuses = [first.status, second.status].sort()
    expect(statuses).toEqual([200, 409])
    const refused = first.status === 409 ? first : second
    expect(await refused.json()).toEqual({ error: 'A merge is already running.' })
    expect(head).not.toBe(manyHead)
  })

  it('bounds review concurrency and preserves item order in mapConcurrent', async () => {
    const items = [0, 1, 2, 3, 4, 5, 6, 7]
    let current = 0
    let maxConcurrent = 0
    const results = await mapConcurrent(items, 3, async (item) => {
      current += 1
      if (current > maxConcurrent) maxConcurrent = current
      await new Promise((r) => setTimeout(r, (items.length - item) * 5))
      current -= 1
      return `result-${item}`
    })
    expect(maxConcurrent).toBeLessThanOrEqual(3)
    expect(results).toEqual(items.map((i) => `result-${i}`))
  })

  it('bounds concurrency across lanes and keeps their order', async () => {
    const { repo } = makeLaneRepo()
    const lanes = {}
    const keys = ['lane-a', 'lane-b', 'lane-c', 'lane-d', 'lane-e']
    for (const key of keys) {
      const { worktree } = makeLaneRepo()
      lanes[key] = { name: key, worktree }
    }
    const { url } = await startReviewsBridge(lanes, { projectRoot: repo, concurrency: 2 })
    const res = await requestJson(`${url}/api/control/reviews`)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.lanes.map((l) => l.lane)).toEqual(keys)
  })
})

const MERGE_URL = new URL('http://127.0.0.1/api/control/reviews/opencode/merge')

function reviewsApiOn(repo, worktree, gitRunner, { head, message = 'Merge the lane' } = {}) {
  const dir = makeTempDir()
  const agentsDir = join(dir, 'docs', 'agents')
  mkdirSync(agentsDir, { recursive: true })
  writeFileSync(join(agentsDir, 'lanes.json'), JSON.stringify({ opencode: { name: 'OpenCode', worktree } }))
  const answers = []
  const api = createReviewsApi({
    projectRoot: repo,
    briefsDir: agentsDir,
    sendJson: (req, res, status, body) => answers.push({ status, body }),
    readJsonBody: async () => ({ confirmed: true, head, message }),
    orchestrators: () => null,
    gitRunner,
    readRuns: () => [],
  })
  return { api, answers }
}

describe('merge write limits', { timeout: 30000 }, () => {
  it('keeps the short limit on review reads and gives the merge the long one', async () => {
    const { repo, worktree } = makeLaneRepo()
    const head = git(worktree, ['rev-parse', 'HEAD']).trim()
    const calls = []
    const recordingRunner = async (cwd, args, opts) => {
      calls.push({ args, timeout: opts?.timeout })
      return defaultGitRunner(cwd, args, opts)
    }
    const { api, answers } = reviewsApiOn(repo, worktree, recordingRunner, { head })

    await api.handle({ method: 'GET', headers: {} }, {}, new URL('http://127.0.0.1/api/control/reviews/opencode/diff'))
    expect(answers[0].status).toBe(200)
    expect(calls.length).toBeGreaterThan(0)
    expect(calls.every((call) => call.timeout === GIT_TIMEOUT_MS)).toBe(true)

    calls.length = 0
    await api.handle({ method: 'POST', headers: { origin: 'http://localhost:5173' } }, {}, MERGE_URL)
    expect(answers[1].status).toBe(200)
    const write = calls.find((call) => call.args[0] === 'merge')
    expect(write.timeout).toBe(GIT_WRITE_TIMEOUT_MS)
    expect(calls.filter((call) => call !== write).every((call) => call.timeout === GIT_TIMEOUT_MS)).toBe(true)
  })

  it('puts the checkout back after a merge write times out and says so', async () => {
    const { repo, worktree } = makeLaneRepo()
    writeFileSync(join(repo, 'notes.txt'), 'changed on main\n')
    git(repo, ['add', 'notes.txt'])
    git(repo, ['commit', '-m', 'main change'])
    const head = git(worktree, ['rev-parse', 'HEAD']).trim()
    const oldMain = git(repo, ['rev-parse', 'HEAD']).trim()
    const calls = []
    const timeoutRunner = async (cwd, args, opts) => {
      calls.push({ args, timeout: opts?.timeout })
      if (args[0] === 'merge' && args[1] === '--no-ff') {
        try {
          await defaultGitRunner(cwd, args, opts)
        } catch {}
        const error = new Error('git timed out')
        error.killed = true
        throw error
      }
      return defaultGitRunner(cwd, args, opts)
    }
    const { api, answers } = reviewsApiOn(repo, worktree, timeoutRunner, { head })

    await api.handle({ method: 'POST', headers: { origin: 'http://localhost:5173' } }, {}, MERGE_URL)
    expect(answers[0].status).toBe(409)
    expect(answers[0].body).toEqual({
      error: 'The merge took too long and stopped on a conflict. The checkout was put back.',
      files: ['notes.txt'],
    })
    const abort = calls.find((call) => call.args[0] === 'merge' && call.args[1] === '--abort')
    expect(abort.timeout).toBe(GIT_WRITE_TIMEOUT_MS)
    expect(git(repo, ['rev-parse', 'HEAD']).trim()).toBe(oldMain)
    expect(git(repo, ['status', '--porcelain'])).toBe('')
    expect(gitExit(repo, ['rev-parse', '-q', '--verify', 'MERGE_HEAD'])).not.toBe(0)
  })

  it('gives the fast forward the long limit too', async () => {
    const base = makeTempDir()
    const room = join(base, 'room')
    const project = join(base, 'project')
    const worktree = join(project, '.worktrees', 'opencode')
    mkdirSync(join(room, 'docs', 'agents'), { recursive: true })
    git(room, ['init', '-b', 'main'])
    writeFileSync(join(room, 'docs', 'agents', 'lanes.json'), JSON.stringify({ opencode: { name: 'OpenCode' } }))
    mkdirSync(project, { recursive: true })
    git(project, ['init', '-b', 'trunk'])
    writeFileSync(join(project, 'notes.txt'), 'hello\n')
    git(project, ['add', 'notes.txt'])
    git(project, ['commit', '-m', 'first'])
    git(project, ['worktree', 'add', '-b', 'feat/x', worktree])
    writeFileSync(join(worktree, 'extra.js'), 'export const x = 1\n')
    git(worktree, ['add', 'extra.js'])
    git(worktree, ['commit', '-m', 'lane work'])
    const head = git(worktree, ['rev-parse', 'HEAD']).trim()

    const calls = []
    const recordingRunner = async (cwd, args, opts) => {
      calls.push({ args, timeout: opts?.timeout })
      return defaultGitRunner(cwd, args, opts)
    }
    const answers = []
    const api = createReviewsApi({
      projectRoot: project,
      briefsDir: join(room, 'docs', 'agents'),
      sendJson: (req, res, status, body) => answers.push({ status, body }),
      readJsonBody: async () => ({ confirmed: true, head, message: 'Merge the lane' }),
      orchestrators: () => null,
      gitRunner: recordingRunner,
      readRuns: () => [],
    })

    await api.handle({ method: 'POST', headers: { origin: 'http://localhost:5173' } }, {}, MERGE_URL)
    expect(answers[0].status).toBe(200)
    const write = calls.find((call) => call.args[0] === 'merge' && call.args[1] === '--ff-only')
    expect(write.timeout).toBe(GIT_WRITE_TIMEOUT_MS)
    expect(git(project, ['rev-parse', 'HEAD']).trim()).toBe(head)
  })
})
