import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createBridge } from '../server/index.js'
import { startLaneBridge } from './helpers/bridge.js'
import {
  BAD_BRANCH_NAME_PROBLEM,
  BAD_FROM_BRANCH_PROBLEM,
  BRANCH_NOT_FOUND_PROBLEM,
  BRANCH_TAKEN_PROBLEM,
  BRANCH_TIMEOUT_PROBLEM,
  CHECKOUT_DIRTY_PROBLEM,
  CONFIRM_BRANCH_PROBLEM,
  CONFIRM_SWITCH_PROBLEM,
  GIT_TIMEOUT_MS,
  GIT_WRITE_TIMEOUT_MS,
  LANE_RUN_OPEN_PROBLEM,
  ORIGIN_BRANCH_PROBLEM,
  ORIGIN_SWITCH_PROBLEM,
  STATUS_FAILED_PROBLEM,
  SWITCH_TIMEOUT_PROBLEM,
  TURN_RUNNING_PROBLEM,
  WORKTREE_HOLDS_BRANCH_PROBLEM,
  WRITE_IN_FLIGHT_PROBLEM,
  beginRepoWrite,
  defaultGitRunner,
  endRepoWrite,
  invalidateGitCache,
  parseStatus,
  readGitState,
  resetGitCache,
} from '../server/git.js'
import { createClient } from '../src/control/client.js'
import { createMockClient } from '../src/control/mock.js'
import { makeTempDir, removeTempDir } from './helpers/tempRoot.js'

const NO_GIT_CONFIG = join(tmpdir(), 'machineroom-git-no-config')
const cleanups = []

afterEach(async () => {
  resetGitCache()
  while (cleanups.length > 0) {
    const fn = cleanups.pop()
    try {
      await fn()
    } catch {}
  }
})

function testGit(cwd, args) {
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

function makeRepo() {
  const repo = makeTempDir('mr-git-repo-')
  cleanups.push(() => removeTempDir(repo))
  testGit(repo, ['init', '-b', 'main'])
  testGit(repo, ['config', 'user.name', 'MachineRoom Test'])
  testGit(repo, ['config', 'user.email', 'test@example.invalid'])
  testGit(repo, ['config', 'commit.gpgsign', 'false'])
  testGit(repo, ['config', 'core.autocrlf', 'false'])
  writeFileSync(join(repo, 'README.md'), '# MachineRoom\n')
  testGit(repo, ['add', 'README.md'])
  testGit(repo, ['commit', '-m', 'initial commit'])
  return repo
}

async function startBridge(options = {}) {
  const bridge = createBridge({
    port: 0,
    env: {},
    ...options,
  })
  const { url } = await bridge.start()
  cleanups.push(() => bridge.stop())
  const client = createClient({
    baseUrl: url,
    fetchImpl: (input, init) =>
      fetch(input, { ...init, headers: { origin: 'http://localhost:5173', ...(init?.headers ?? {}) } }),
  })
  return { bridge, url, client }
}

async function postJson(url, path, body, origin = 'http://localhost:5173') {
  const headers = { 'content-type': 'application/json' }
  if (origin) headers.origin = origin
  const response = await fetch(`${url}${path}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10000),
  })
  const text = await response.text()
  return { status: response.status, body: text ? JSON.parse(text) : null }
}

async function getJson(url, path) {
  const response = await fetch(`${url}${path}`, {
    method: 'GET',
    signal: AbortSignal.timeout(10000),
  })
  const text = await response.text()
  return { status: response.status, body: text ? JSON.parse(text) : null }
}

async function listenForChange(url, topic, onOpen = () => {}) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 10000)
  try {
    const response = await fetch(`${url}/events`, { signal: controller.signal })
    onOpen()
    const decoder = new TextDecoder()
    let buffer = ''
    for await (const chunk of response.body) {
      buffer += decoder.decode(chunk, { stream: true })
      let cut = buffer.indexOf('\n\n')
      while (cut !== -1) {
        const block = buffer.slice(0, cut)
        buffer = buffer.slice(cut + 2)
        const lines = block.split(/\r?\n/)
        if (lines.includes('event: change')) {
          const dataLine = lines.find((line) => line.startsWith('data: '))
          if (dataLine) {
            const parsed = JSON.parse(dataLine.slice(6))
            if (!topic || parsed.topic === topic) {
              return parsed
            }
          }
        }
        cut = buffer.indexOf('\n\n')
      }
    }
    return null
  } finally {
    clearTimeout(timer)
    controller.abort()
  }
}

describe('parseStatus', () => {
  it('reads a rename, an untracked file and a name with a space', () => {
    const text = 'R  src/new name.js\0src/old name.js\0?? notes/todo list.md\0 M src/a.js\0D  gone.txt\0'
    expect(parseStatus(text)).toEqual([
      { path: 'src/new name.js', status: 'R' },
      { path: 'notes/todo list.md', status: 'U' },
      { path: 'src/a.js', status: 'M' },
      { path: 'gone.txt', status: 'D' },
    ])
  })

  it('takes the second letter unless it is a space, then the first', () => {
    expect(parseStatus('AM staged-then-changed.js\0')).toEqual([{ path: 'staged-then-changed.js', status: 'M' }])
    expect(parseStatus('M  staged.js\0')).toEqual([{ path: 'staged.js', status: 'M' }])
    expect(parseStatus('')).toEqual([])
  })
})

describe('the git route on a folder with no git', () => {
  it('returns git false for a non-git folder', async () => {
    const plainFolder = makeTempDir('mr-no-git-')
    cleanups.push(() => removeTempDir(plainFolder))
    const { url, client } = await startBridge({ projectRoot: plainFolder })

    const { status, body } = await getJson(url, '/api/git')
    expect(status).toBe(200)
    expect(body).toEqual({ git: false })

    const clientState = await client.gitState()
    expect(clientState).toEqual({ git: false })
  })

  it('refuses switch and branch on a non-git folder', async () => {
    const plainFolder = makeTempDir('mr-no-git-')
    cleanups.push(() => removeTempDir(plainFolder))
    const { url } = await startBridge({ projectRoot: plainFolder })

    const switchRes = await postJson(url, '/api/git/switch', { branch: 'feat', confirmed: true })
    expect(switchRes.status).toBe(400)
    expect(switchRes.body.error).toBe(BRANCH_NOT_FOUND_PROBLEM)

    const branchRes = await postJson(url, '/api/git/branch', { name: 'feat', from: 'main', confirmed: true })
    expect(branchRes.status).toBe(400)
  })
})

describe('the git route reading state on a real repository', () => {
  it('reads branches, commits, head, dirty and current branch', async () => {
    const repo = makeRepo()
    writeFileSync(join(repo, 'file2.txt'), 'second\n')
    testGit(repo, ['add', 'file2.txt'])
    testGit(repo, ['commit', '-m', 'second commit'])

    testGit(repo, ['branch', 'feat/login'])

    const { url, client } = await startBridge({ projectRoot: repo })
    const state = await client.gitState()
    expect(state.git).toBe(true)
    expect(state.branch).toBe('main')
    expect(state.detached).toBe(false)
    expect(state.dirty).toBe(false)
    expect(typeof state.head).toBe('string')
    expect(state.head.length).toBe(40)
    expect(state.truncated).toBe(false)

    expect(state.branches).toHaveLength(2)
    const mainBranch = state.branches.find((b) => b.name === 'main')
    const featBranch = state.branches.find((b) => b.name === 'feat/login')
    expect(mainBranch).toEqual({
      name: 'main',
      head: state.head,
      current: true,
      worktree: false,
      upstream: null,
      ahead: null,
      behind: null,
    })
    expect(featBranch).toEqual({
      name: 'feat/login',
      head: state.head,
      current: false,
      worktree: false,
      upstream: null,
      ahead: null,
      behind: null,
    })

    expect(state.commits).toHaveLength(2)
    expect(state.commits[0].subject).toBe('second commit')
    expect(state.commits[0].refs).toEqual(['feat/login', 'main'])
    expect(state.commits[0].parents).toHaveLength(1)
    expect(state.commits[1].subject).toBe('initial commit')
    expect(state.commits[1].refs).toEqual([])
    expect(state.commits[1].parents).toHaveLength(0)
  })

  it('reads detached head correctly', async () => {
    const repo = makeRepo()
    testGit(repo, ['checkout', 'HEAD~0'])

    const { client } = await startBridge({ projectRoot: repo })
    const state = await client.gitState()
    expect(state.git).toBe(true)
    expect(state.branch).toBeNull()
    expect(state.detached).toBe(true)
    expect(state.branches.every((b) => b.current === false)).toBe(true)
  })

  it('includes a detached commit in commits when HEAD is detached', async () => {
    const repo = makeRepo()
    testGit(repo, ['checkout', '--detach', 'HEAD'])
    writeFileSync(join(repo, 'detached.txt'), 'detached work\n')
    testGit(repo, ['add', 'detached.txt'])
    testGit(repo, ['commit', '-m', 'detached commit'])

    const { client } = await startBridge({ projectRoot: repo })
    const state = await client.gitState()
    expect(state.git).toBe(true)
    expect(state.detached).toBe(true)
    expect(state.branch).toBeNull()
    expect(state.commits.length).toBeGreaterThanOrEqual(2)
    expect(state.commits[0].sha).toBe(state.head)
    expect(state.commits[0].subject).toBe('detached commit')
    expect(state.commits[0].refs).toEqual([])
  })

  it('allows switching and does not hold its own branch when opened on a subfolder', async () => {
    const repo = makeRepo()
    testGit(repo, ['branch', 'feat'])
    const sub = join(repo, 'packages', 'app')
    mkdirSync(sub, { recursive: true })
    const wt = makeTempDir('mr-sub-wt-')
    cleanups.push(() => removeTempDir(wt))
    testGit(repo, ['worktree', 'add', wt, 'feat'])

    const { client } = await startBridge({ projectRoot: sub })
    const state = await client.gitState()
    expect(state.git).toBe(true)
    expect(state.branch).toBe('main')
    const mainBranch = state.branches.find((b) => b.name === 'main')
    const featBranch = state.branches.find((b) => b.name === 'feat')
    expect(mainBranch.worktree).toBe(false)
    expect(featBranch.worktree).toBe(true)

    testGit(repo, ['branch', 'feat2'])
    const nextState = await client.switchBranch({ branch: 'feat2', confirmed: true })
    expect(nextState.branch).toBe('feat2')

    const backState = await client.switchBranch({ branch: 'main', confirmed: true })
    expect(backState.branch).toBe('main')
  }, 60000)

  it('marks checkout as dirty when files are modified or uncommitted', async () => {
    const repo = makeRepo()
    writeFileSync(join(repo, 'extra.txt'), 'uncommitted work\n')

    const { client } = await startBridge({ projectRoot: repo })
    const state = await client.gitState()
    expect(state.dirty).toBe(true)
    expect(state.changeCount).toBe(1)
    expect(state.changes).toEqual([{ path: 'extra.txt', status: 'U' }])
  })

  it('lists a rename, a delete and a file with a space as changes', async () => {
    const repo = makeRepo()
    writeFileSync(join(repo, 'tracked.txt'), 'tracked\n')
    testGit(repo, ['add', 'tracked.txt'])
    testGit(repo, ['commit', '-m', 'add tracked'])
    testGit(repo, ['mv', 'README.md', 'read me.md'])
    testGit(repo, ['rm', '--quiet', 'tracked.txt'])
    writeFileSync(join(repo, 'new notes.txt'), 'new\n')

    const { client } = await startBridge({ projectRoot: repo })
    const state = await client.gitState()
    expect(state.dirty).toBe(true)
    expect(state.changeCount).toBe(3)
    const byPath = Object.fromEntries(state.changes.map((change) => [change.path, change.status]))
    expect(byPath['read me.md']).toBe('R')
    expect(byPath['tracked.txt']).toBe('D')
    expect(byPath['new notes.txt']).toBe('U')
  })
})

describe('switch branch refusals', () => {
  it('refuses switch without a page Origin with 403', async () => {
    const repo = makeRepo()
    const { url } = await startBridge({ projectRoot: repo })

    const res = await postJson(url, '/api/git/switch', { branch: 'main', confirmed: true }, null)
    expect(res.status).toBe(403)
    expect(res.body.error).toBe(ORIGIN_SWITCH_PROBLEM)
  })

  it('refuses unconfirmed switch with 400', async () => {
    const repo = makeRepo()
    const { url } = await startBridge({ projectRoot: repo })

    const res = await postJson(url, '/api/git/switch', { branch: 'main' })
    expect(res.status).toBe(400)
    expect(res.body.error).toBe(CONFIRM_SWITCH_PROBLEM)
  })

  it('refuses a branch that does not exist with 400', async () => {
    const repo = makeRepo()
    const { url, client } = await startBridge({ projectRoot: repo })

    const res = await postJson(url, '/api/git/switch', { branch: 'nonexistent', confirmed: true })
    expect(res.status).toBe(400)
    expect(res.body.error).toBe(BRANCH_NOT_FOUND_PROBLEM)

    await expect(client.switchBranch({ branch: 'nonexistent', confirmed: true })).rejects.toThrow(BRANCH_NOT_FOUND_PROBLEM)
  })

  it('refuses a branch name that starts with - with 400', async () => {
    const repo = makeRepo()
    const { url } = await startBridge({ projectRoot: repo })

    const res = await postJson(url, '/api/git/switch', { branch: '-flag', confirmed: true })
    expect(res.status).toBe(400)
    expect(res.body.error).toBe(BRANCH_NOT_FOUND_PROBLEM)
  })

  it('refuses switch when the checkout has uncommitted changes with 409', async () => {
    const repo = makeRepo()
    testGit(repo, ['branch', 'feat'])
    writeFileSync(join(repo, 'uncommitted.txt'), 'dirty\n')

    const { url, client } = await startBridge({ projectRoot: repo })
    const res = await postJson(url, '/api/git/switch', { branch: 'feat', confirmed: true })
    expect(res.status).toBe(409)
    expect(res.body.error).toBe(CHECKOUT_DIRTY_PROBLEM)

    await expect(client.switchBranch({ branch: 'feat', confirmed: true })).rejects.toThrow(CHECKOUT_DIRTY_PROBLEM)
  })

  it('refuses switch when an orchestrator turn runs with 409', async () => {
    const repo = makeRepo()
    testGit(repo, ['branch', 'feat'])

    const fakeOrchestrators = {
      list: () => [{ id: 'orchestrator', state: 'working' }],
    }
    const { url } = await startBridge({ projectRoot: repo, orchestrators: () => fakeOrchestrators })
    const res = await postJson(url, '/api/git/switch', { branch: 'feat', confirmed: true })
    expect(res.status).toBe(409)
    expect(res.body.error).toBe(TURN_RUNNING_PROBLEM)
  })

  it('refuses switch when a lane run on this project is open with 409', async () => {
    const repo = makeRepo()
    testGit(repo, ['branch', 'feat'])

    const fakeLanesSource = {
      openRuns: () => [{ lane: 'opencode', project: repo, startedAt: new Date().toISOString() }],
    }
    const { url } = await startBridge({
      projectRoot: repo,
      lanesSourceApi: () => fakeLanesSource,
    })
    const res = await postJson(url, '/api/git/switch', { branch: 'feat', confirmed: true })
    expect(res.status).toBe(409)
    expect(res.body.error).toBe(LANE_RUN_OPEN_PROBLEM)
  })

  it('refuses switch when another worktree holds the branch with 409', async () => {
    const repo = makeRepo()
    testGit(repo, ['branch', 'feat'])
    const wt = makeTempDir('mr-extra-wt-')
    cleanups.push(() => removeTempDir(wt))
    testGit(repo, ['worktree', 'add', wt, 'feat'])

    const { url, client } = await startBridge({ projectRoot: repo })

    const state = await client.gitState()
    const feat = state.branches.find((b) => b.name === 'feat')
    expect(feat.worktree).toBe(true)

    const res = await postJson(url, '/api/git/switch', { branch: 'feat', confirmed: true })
    expect(res.status).toBe(409)
    expect(res.body.error).toBe(WORKTREE_HOLDS_BRANCH_PROBLEM)
  })

  it('refuses switch with 409 when git status fails', async () => {
    const repo = makeRepo()
    testGit(repo, ['branch', 'feat'])

    const failingRunner = async (cwd, args, opts) => {
      if (Array.isArray(args) && args[0] === 'status') {
        throw new Error('git status failed')
      }
      return defaultGitRunner(cwd, args, opts)
    }

    const { url } = await startBridge({ projectRoot: repo, gitRunner: failingRunner })
    const res = await postJson(url, '/api/git/switch', { branch: 'feat', confirmed: true })
    expect(res.status).toBe(409)
    expect(res.body.error).toBe(STATUS_FAILED_PROBLEM)

    const diskBranch = testGit(repo, ['branch', '--show-current']).trim()
    expect(diskBranch).toBe('main')
  })

  it('refuses a concurrent write with 409 while a write is running', async () => {
    const repo = makeRepo()
    testGit(repo, ['branch', 'feat-1'])
    testGit(repo, ['branch', 'feat-2'])

    let releaseFirst
    const firstBlocked = new Promise((res) => {
      releaseFirst = res
    })

    const slowRunner = async (cwd, args, opts) => {
      if (Array.isArray(args) && args[0] === 'switch' && args[2] === 'feat-1') {
        await firstBlocked
      }
      return defaultGitRunner(cwd, args, opts)
    }

    const { url } = await startBridge({ projectRoot: repo, gitRunner: slowRunner })
    const switchPromise = postJson(url, '/api/git/switch', { branch: 'feat-1', confirmed: true })

    await new Promise((r) => setTimeout(r, 50))

    const branchRes = await postJson(url, '/api/git/branch', { name: 'feat-3', from: 'main', confirmed: true })
    expect(branchRes.status).toBe(409)
    expect(branchRes.body.error).toBe(WRITE_IN_FLIGHT_PROBLEM)

    const switch2Res = await postJson(url, '/api/git/switch', { branch: 'feat-2', confirmed: true })
    expect(switch2Res.status).toBe(409)
    expect(switch2Res.body.error).toBe(WRITE_IN_FLIGHT_PROBLEM)

    releaseFirst()
    const switchRes = await switchPromise
    expect(switchRes.status).toBe(200)

    const branchLaterRes = await postJson(url, '/api/git/branch', { name: 'feat-3', from: 'main', confirmed: true })
    expect(branchLaterRes.status).toBe(200)
  })
})

describe('successful switch and notices', () => {
  it('switches the branch, updates state and notifies SSE clients', async () => {
    const repo = makeRepo()
    testGit(repo, ['branch', 'feature-a'])

    const { url, client } = await startBridge({ projectRoot: repo })
    const changePromise = listenForChange(url, 'git')

    const nextState = await client.switchBranch({ branch: 'feature-a', confirmed: true })
    expect(nextState.branch).toBe('feature-a')
    expect(nextState.detached).toBe(false)
    expect(nextState.branches.find((b) => b.name === 'feature-a').current).toBe(true)
    expect(nextState.branches.find((b) => b.name === 'main').current).toBe(false)

    const diskBranch = testGit(repo, ['branch', '--show-current']).trim()
    expect(diskBranch).toBe('feature-a')

    const change = await changePromise
    expect(change).toEqual({ topic: 'git' })
  })
})

describe('git write limits', () => {
  it('keeps the short limit on reads and gives the switch and the new branch the long one', async () => {
    const repo = makeRepo()
    testGit(repo, ['branch', 'feature-a'])
    const calls = []
    const recordingRunner = async (cwd, args, opts) => {
      calls.push({ args, timeout: opts?.timeout })
      return defaultGitRunner(cwd, args, opts)
    }
    const { url } = await startBridge({ projectRoot: repo, gitRunner: recordingRunner })

    calls.length = 0
    const state = await getJson(url, '/api/git')
    expect(state.status).toBe(200)
    expect(calls.length).toBeGreaterThan(0)
    expect(calls.every((call) => call.timeout === GIT_TIMEOUT_MS)).toBe(true)

    calls.length = 0
    const switched = await postJson(url, '/api/git/switch', { branch: 'feature-a', confirmed: true })
    expect(switched.status).toBe(200)
    const switchCalls = calls.filter((call) => call.args[0] === 'switch')
    expect(switchCalls).toHaveLength(1)
    expect(switchCalls[0].timeout).toBe(GIT_WRITE_TIMEOUT_MS)
    expect(calls.filter((call) => call !== switchCalls[0]).every((call) => call.timeout === GIT_TIMEOUT_MS)).toBe(true)

    calls.length = 0
    const created = await postJson(url, '/api/git/branch', { name: 'feature-b', from: 'main', confirmed: true })
    expect(created.status).toBe(200)
    const branchCall = calls.find((call) => call.args[0] === 'branch' && call.args[1] === '--')
    expect(branchCall.timeout).toBe(GIT_WRITE_TIMEOUT_MS)
  })

  it('says a switch took too long and where the checkout is', async () => {
    const repo = makeRepo()
    testGit(repo, ['branch', 'feature-a'])
    const failingRunner = async (cwd, args, opts) => {
      if (Array.isArray(args) && args[0] === 'switch') {
        const error = new Error('git timed out')
        error.killed = true
        throw error
      }
      return defaultGitRunner(cwd, args, opts)
    }
    const { url } = await startBridge({ projectRoot: repo, gitRunner: failingRunner })

    const res = await postJson(url, '/api/git/switch', { branch: 'feature-a', confirmed: true })
    expect(res.status).toBe(500)
    expect(res.body.error).toBe(`${SWITCH_TIMEOUT_PROBLEM} The checkout is on main and it is clean.`)
    expect(testGit(repo, ['branch', '--show-current']).trim()).toBe('main')
  })

  it('says a new branch took too long, where the checkout is and whether the branch was made', async () => {
    const repo = makeRepo()
    const failingRunner = async (cwd, args, opts) => {
      if (Array.isArray(args) && args[0] === 'branch' && args[1] === '--') {
        const error = new Error('git timed out')
        error.killed = true
        throw error
      }
      return defaultGitRunner(cwd, args, opts)
    }
    const { url } = await startBridge({ projectRoot: repo, gitRunner: failingRunner })

    const res = await postJson(url, '/api/git/branch', { name: 'feature-b', from: 'main', confirmed: true })
    expect(res.status).toBe(500)
    expect(res.body.error).toBe(
      `${BRANCH_TIMEOUT_PROBLEM} The checkout is on main and it is clean. The branch was not created.`
    )
  })
})

describe('create branch refusals', () => {
  it('refuses create branch without a page Origin with 403', async () => {
    const repo = makeRepo()
    const { url } = await startBridge({ projectRoot: repo })

    const res = await postJson(url, '/api/git/branch', { name: 'feat-new', from: 'main', confirmed: true }, null)
    expect(res.status).toBe(403)
    expect(res.body.error).toBe(ORIGIN_BRANCH_PROBLEM)
  })

  it('refuses unconfirmed create branch with 400', async () => {
    const repo = makeRepo()
    const { url } = await startBridge({ projectRoot: repo })

    const res = await postJson(url, '/api/git/branch', { name: 'feat-new', from: 'main' })
    expect(res.status).toBe(400)
    expect(res.body.error).toBe(CONFIRM_BRANCH_PROBLEM)
  })

  it('refuses bad branch names with 400', async () => {
    const repo = makeRepo()
    const { url } = await startBridge({ projectRoot: repo })

    const dashRes = await postJson(url, '/api/git/branch', { name: '-bad-option', from: 'main', confirmed: true })
    expect(dashRes.status).toBe(400)
    expect(dashRes.body.error).toBe(BAD_BRANCH_NAME_PROBLEM)

    const spaceRes = await postJson(url, '/api/git/branch', { name: 'bad name with spaces', from: 'main', confirmed: true })
    expect(spaceRes.status).toBe(400)
    expect(spaceRes.body.error).toBe(BAD_BRANCH_NAME_PROBLEM)

    const dotRes = await postJson(url, '/api/git/branch', { name: 'bad..name', from: 'main', confirmed: true })
    expect(dotRes.status).toBe(400)
    expect(dotRes.body.error).toBe(BAD_BRANCH_NAME_PROBLEM)
  })

  it('refuses an already taken branch name with 400', async () => {
    const repo = makeRepo()
    const { url, client } = await startBridge({ projectRoot: repo })

    const res = await postJson(url, '/api/git/branch', { name: 'main', from: 'main', confirmed: true })
    expect(res.status).toBe(400)
    expect(res.body.error).toBe(BRANCH_TAKEN_PROBLEM)

    await expect(client.createBranch({ name: 'main', from: 'main', confirmed: true })).rejects.toThrow(BRANCH_TAKEN_PROBLEM)
  })

  it('answers the existing-branch message when only the case differs', async () => {
    const repo = makeRepo()
    testGit(repo, ['branch', 'Feature'])
    const { url } = await startBridge({ projectRoot: repo })
    const res = await postJson(url, '/api/git/branch', { name: 'feature', from: 'main', confirmed: true })
    expect(res.status).toBe(400)
    expect(res.body.error).toBe(BRANCH_TAKEN_PROBLEM)
  })

  it('takes one write lock for a switch, a branch and a merge', async () => {
    const repo = makeRepo()
    const key = beginRepoWrite(repo)
    expect(key).not.toBe('')
    expect(beginRepoWrite(repo)).toBe('')
    const { url } = await startBridge({ projectRoot: repo })
    const res = await postJson(url, '/api/git/branch', { name: 'feat-lock', from: 'main', confirmed: true })
    expect(res.status).toBe(409)
    expect(res.body.error).toBe(WRITE_IN_FLIGHT_PROBLEM)
    endRepoWrite(key)
    expect(beginRepoWrite(repo)).not.toBe('')
  })

  it('refuses when from is not a known branch with 400', async () => {
    const repo = makeRepo()
    const { url, client } = await startBridge({ projectRoot: repo })

    const res = await postJson(url, '/api/git/branch', { name: 'feat-new', from: 'nonexistent', confirmed: true })
    expect(res.status).toBe(400)
    expect(res.body.error).toBe(BAD_FROM_BRANCH_PROBLEM)

    await expect(client.createBranch({ name: 'feat-new', from: 'nonexistent', confirmed: true })).rejects.toThrow(BAD_FROM_BRANCH_PROBLEM)
  })
})

describe('successful create branch and branch/tag sharing', () => {
  it('creates a new branch without switching to it and sends notice', async () => {
    const repo = makeRepo()
    const { url, client } = await startBridge({ projectRoot: repo })
    const changePromise = listenForChange(url, 'git')

    const nextState = await client.createBranch({ name: 'feature-b', from: 'main', confirmed: true })
    expect(nextState.branch).toBe('main')
    expect(nextState.branches.some((b) => b.name === 'feature-b')).toBe(true)

    const diskBranch = testGit(repo, ['branch', '--show-current']).trim()
    expect(diskBranch).toBe('main')

    const branchesRaw = testGit(repo, ['branch', '--list']).replace(/\*/g, '')
    expect(branchesRaw).toContain('feature-b')

    const change = await changePromise
    expect(change).toEqual({ topic: 'git' })
  })

  it('sends a git notice after a lane run ends', async () => {
    const repo = makeRepo()
    const runsDir = makeTempDir('mr-runs-')
    cleanups.push(() => removeTempDir(runsDir))
    const { url, writeLog, bridge } = await startLaneBridge({ projectRoot: repo, runsDir })
    cleanups.push(() => bridge.stop())

    const logName = 'opencode-queue-20261024-140001'
    writeFileSync(join(runsDir, `${logName}.meta.json`), JSON.stringify({ project: repo }))
    const change = await listenForChange(url, 'git', () => {
      writeLog(logName, 'hello\n')
      writeFileSync(
        join(runsDir, 'runs.jsonl'),
        JSON.stringify({ log: join(runsDir, `${logName}.log`), lane: 'opencode', exitCode: 0, killed: false }) + '\n'
      )
    })
    expect(change).toEqual({ topic: 'git' })
  })

  it('handles a branch name that a tag shares correctly', async () => {
    const repo = makeRepo()
    testGit(repo, ['branch', 'shared'])
    testGit(repo, ['tag', 'shared', 'HEAD'])
    testGit(repo, ['tag', 'only-tag', 'HEAD'])

    const { url, client } = await startBridge({ projectRoot: repo })
    const state = await client.gitState()
    const sharedBranch = state.branches.find((b) => b.name === 'shared')
    expect(sharedBranch).toBeDefined()
    expect(sharedBranch.head).toBe(state.head)

    const onlyTag = state.branches.find((b) => b.name === 'only-tag')
    expect(onlyTag).toBeUndefined()

    const tagFromRes = await postJson(url, '/api/git/branch', { name: 'child-branch', from: 'only-tag', confirmed: true })
    expect(tagFromRes.status).toBe(400)
    expect(tagFromRes.body.error).toBe(BAD_FROM_BRANCH_PROBLEM)

    const validFromShared = await client.createBranch({ name: 'child-branch', from: 'shared', confirmed: true })
    expect(validFromShared.branches.some((b) => b.name === 'child-branch')).toBe(true)

    const switched = await client.switchBranch({ branch: 'shared', confirmed: true })
    expect(switched.branch).toBe('shared')
    const currentOnDisk = testGit(repo, ['branch', '--show-current']).trim()
    expect(currentOnDisk).toBe('shared')
  })
})

describe('caching and throttling', () => {
  it('reads state at most once a second per project', async () => {
    const repo = makeRepo()
    let gitCalls = 0
    const countingRunner = async (cwd, args, opts) => {
      gitCalls += 1
      return execFileSync('git', args, { cwd, encoding: 'utf8', windowsHide: true })
    }

    const { client } = await startBridge({
      projectRoot: repo,
      gitRunner: countingRunner,
      gitTtlMs: 1000,
    })

    await client.gitState()
    const firstCallCount = gitCalls
    expect(firstCallCount).toBeGreaterThan(0)

    await client.gitState()
    expect(gitCalls).toBe(firstCallCount)
  })

  it('does not write older state to cache when invalidated while in flight', async () => {
    const repo = makeRepo()
    let releaseRead
    const readBlocked = new Promise((res) => {
      releaseRead = res
    })

    const slowRunner = async (cwd, args, opts) => {
      if (Array.isArray(args) && args[0] === 'rev-parse' && args[1] === 'HEAD') {
        await readBlocked
      }
      return defaultGitRunner(cwd, args, opts)
    }

    const readPromise = readGitState(repo, { runner: slowRunner, force: true })

    await new Promise((r) => setTimeout(r, 50))
    invalidateGitCache(repo)

    releaseRead()
    const state = await readPromise
    expect(state.git).toBe(true)

    let newReadCalled = false
    const detectRunner = async (cwd, args, opts) => {
      if (Array.isArray(args) && args[0] === 'rev-parse' && args[1] === '--is-inside-work-tree') {
        newReadCalled = true
      }
      return defaultGitRunner(cwd, args, opts)
    }

    await readGitState(repo, { runner: detectRunner })
    expect(newReadCalled).toBe(true)
  })
})

describe('the mock control client git methods', () => {
  it('implements gitState, switchBranch and createBranch on mock', async () => {
    const mock = createMockClient({ latencyMs: 0 })
    const state = await mock.gitState()
    expect(state.git).toBe(true)
    expect(state.branch).toBe('main')
    expect(state.branches).toHaveLength(3)
    expect(state.commits).toHaveLength(4)

    await expect(mock.switchBranch({ branch: 'nonexistent', confirmed: true })).rejects.toThrow(BRANCH_NOT_FOUND_PROBLEM)
    await expect(mock.switchBranch({ branch: 'feat/worktree-held', confirmed: true })).rejects.toThrow(WORKTREE_HOLDS_BRANCH_PROBLEM)

    const switched = await mock.switchBranch({ branch: 'feat/preview', confirmed: true })
    expect(switched.branch).toBe('feat/preview')
    expect(switched.branches.find((b) => b.name === 'feat/preview').current).toBe(true)

    await expect(mock.createBranch({ name: '-invalid', from: 'main', confirmed: true })).rejects.toThrow(BAD_BRANCH_NAME_PROBLEM)
    await expect(mock.createBranch({ name: 'main', from: 'main', confirmed: true })).rejects.toThrow(BRANCH_TAKEN_PROBLEM)
    await expect(mock.createBranch({ name: 'brand-new', from: 'ghost', confirmed: true })).rejects.toThrow(BAD_FROM_BRANCH_PROBLEM)

    const created = await mock.createBranch({ name: 'brand-new', from: 'main', confirmed: true })
    expect(created.branches.some((b) => b.name === 'brand-new')).toBe(true)
  })
})
