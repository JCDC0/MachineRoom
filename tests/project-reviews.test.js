import { execFileSync } from 'node:child_process'
import { appendFileSync, cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { act, createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { beginRepoWrite, endRepoWrite, WRITE_IN_FLIGHT_PROBLEM } from '../server/git.js'
import { createBridge } from '../server/index.js'
import { codeCheckout, createReviewsApi, defaultGitRunner, resetCodeCheckout } from '../server/reviews.js'
import { createClient } from '../src/control/client.js'
import ReviewsPanel from '../src/ui/panels/ReviewsPanel.jsx'
import { defaultMergeMessage, reviewRow } from '../src/ui/panels/reviews.js'
import { makeTempDir as makeTempRoot } from './helpers/tempRoot.js'
import { buttonWithText, click, settle, withDom } from './helpers/uiDom.js'

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
      baseHead: git(project, ['rev-parse', 'refs/heads/trunk']).trim(),
      strategy: 'fast-forward',
      ahead: 1,
      dirty: false,
      files: 1,
      added: 1,
      deleted: 0,
      checks: 'unchecked',
      lastRun: null,
    })
    expect(entry.head).toBe(git(worktree, ['rev-parse', 'HEAD']).trim())
    expect(entry.commits).toHaveLength(1)
    expect(entry.commits[0]).toMatch(/ lane work$/)
    expect(git(worktree, ['status', '--porcelain'])).toBe('')
  }, 40000)

  it('reads the last run from the bridge runs folder', async () => {
    const { project, worktree, briefsDir } = makeProject()
    const runs = join(project, '..', 'runs')
    mkdirSync(runs, { recursive: true })
    writeFileSync(join(runs, 'runs.jsonl'), `${JSON.stringify({ lane: 'opencode', project: worktree, briefs: [], startedAt: '2026-11-04T00:00:00.000Z', exitCode: 0 })}
`)
    const { url } = await startBridge({ projectRoot: project, briefsDir })
    const { lanes } = await (await fetch(`${url}/api/control/reviews`)).json()
    expect(lanes[0].lastRun).toMatchObject({ lane: 'opencode', startedAt: '2026-11-04T00:00:00.000Z' })
  }, 40000)

  it('matches lastRun by project when two projects share one lane and counts brief runs for MachineRoom only', async () => {
    const { base, room, project, worktree, briefsDir } = makeProject()
    const projectB = join(base, 'project-b')
    const worktreeB = join(projectB, '.worktrees', 'opencode')
    const roomWorktree = join(base, 'room-wt')
    cpSync(templateProject, projectB, { recursive: true })
    writeFileSync(join(projectB, '.git', 'info', 'exclude'), '/.worktrees/\n')
    git(projectB, ['worktree', 'add', worktreeB, 'feat/x'])
    writeFileSync(
      join(briefsDir, 'lanes.json'),
      JSON.stringify({ opencode: { name: 'OpenCode', worktree: roomWorktree } })
    )
    git(room, ['add', 'docs/agents/lanes.json'])
    git(room, ['commit', '-m', 'set lane worktree'])
    git(room, ['worktree', 'add', '-b', 'feat/room-work', roomWorktree, 'main'])

    const runs = join(base, 'runs')
    mkdirSync(runs, { recursive: true })
    const runA = { lane: 'opencode', project: worktree, briefs: [], startedAt: '2026-11-04T00:00:00.000Z', exitCode: 0 }
    const briefRun = { lane: 'opencode', briefs: ['P177'], startedAt: '2026-11-05T00:00:00.000Z', exitCode: 0 }
    const runB = { lane: 'opencode', project: worktreeB, briefs: [], startedAt: '2026-11-06T00:00:00.000Z', exitCode: 0 }
    writeFileSync(
      join(runs, 'runs.jsonl'),
      `${[runA, briefRun, runB].map((entry) => JSON.stringify(entry)).join('\n')}\n`
    )

    const a = await startBridge({ projectRoot: project, briefsDir })
    const b = await startBridge({ projectRoot: projectB, briefsDir })
    const r = await startBridge({ projectRoot: room, briefsDir })

    const reviewsA = await (await fetch(`${a.url}/api/control/reviews`)).json()
    const reviewsB = await (await fetch(`${b.url}/api/control/reviews`)).json()
    const reviewsRoom = await (await fetch(`${r.url}/api/control/reviews`)).json()

    expect(reviewsA.lanes[0].lastRun).toMatchObject({ startedAt: runA.startedAt })
    expect(reviewsB.lanes[0].lastRun).toMatchObject({ startedAt: runB.startedAt })
    expect(reviewsRoom.lanes[0].lastRun).toMatchObject({ briefs: ['P177'], startedAt: briefRun.startedAt })

    writeFileSync(join(roomWorktree, 'room-file.txt'), 'room change\n')
    git(roomWorktree, ['add', 'room-file.txt'])
    git(roomWorktree, ['commit', '-m', 'room lane work'])
    const roomLaneHead = git(roomWorktree, ['rev-parse', 'HEAD']).trim()
    const roomMainHead = git(room, ['rev-parse', 'refs/heads/main']).trim()
    appendFileSync(
      join(runs, 'runs.jsonl'),
      `${JSON.stringify({ lane: 'opencode', head: roomLaneHead, tests: 'failed', startedAt: '2026-11-07T00:00:00.000Z', exitCode: 1 })}\n`
    )
    const roomRefused = await mergeRequest(r.url, 'opencode', {
      confirmed: true,
      head: roomLaneHead,
      base: 'main',
      baseHead: roomMainHead,
      message: 'Merge opencode',
    })
    expect(roomRefused.status).toBe(409)
    expect((await roomRefused.json()).error).toBe('Checks failed on this head, so the lane was not merged.')
    expect(git(room, ['rev-parse', 'refs/heads/main']).trim()).toBe(roomMainHead)
  }, 40000)

  it('reports passed, failed and unchecked for the exact head and refuses a failed head merge', async () => {
    const { base, project, worktree, briefsDir } = makeProject()
    const runs = join(base, 'runs')
    mkdirSync(runs, { recursive: true })
    const trunkStart = git(project, ['rev-parse', 'refs/heads/trunk']).trim()
    const head1 = git(worktree, ['rev-parse', 'HEAD']).trim()
    const { url } = await startBridge({ projectRoot: project, briefsDir })

    const addRun = (entry) => {
      appendFileSync(join(runs, 'runs.jsonl'), `${JSON.stringify(entry)}\n`)
    }

    addRun({ lane: 'opencode', project: worktree, head: head1, tests: 'none', exitCode: 0, startedAt: '2026-11-05T00:00:00.000Z' })
    expect((await (await fetch(`${url}/api/control/reviews`)).json()).lanes[0].checks).toBe('unchecked')

    addRun({ lane: 'opencode', project: worktree, head: head1, exitCode: 0, startedAt: '2026-11-05T00:01:00.000Z' })
    expect((await (await fetch(`${url}/api/control/reviews`)).json()).lanes[0].checks).toBe('unchecked')

    addRun({ lane: 'opencode', project: worktree, head: '0'.repeat(40), tests: 'passed', exitCode: 0, startedAt: '2026-11-05T00:02:00.000Z' })
    expect((await (await fetch(`${url}/api/control/reviews`)).json()).lanes[0].checks).toBe('unchecked')

    addRun({ lane: 'opencode', project: worktree, head: head1, tests: 'failed', exitCode: 1, startedAt: '2026-11-05T00:03:00.000Z' })
    expect((await (await fetch(`${url}/api/control/reviews`)).json()).lanes[0].checks).toBe('failed')

    const refused = await mergeRequest(url, 'opencode', { confirmed: true, head: head1, base: 'trunk', baseHead: trunkStart })
    expect(refused.status).toBe(409)
    expect((await refused.json()).error).toBe('Checks failed on this head, so the lane was not merged.')
    expect(git(project, ['rev-parse', 'refs/heads/trunk']).trim()).toBe(trunkStart)

    writeFileSync(join(worktree, 'second.js'), 'export const second = 2\n')
    git(worktree, ['add', 'second.js'])
    git(worktree, ['commit', '-m', 'second commit'])
    const head2 = git(worktree, ['rev-parse', 'HEAD']).trim()
    addRun({ lane: 'opencode', project: worktree, head: head2, tests: 'none', exitCode: 0, startedAt: '2026-11-05T00:04:00.000Z' })
    expect((await (await fetch(`${url}/api/control/reviews`)).json()).lanes[0].checks).toBe('unchecked')
    const uncheckedOk = await mergeRequest(url, 'opencode', { confirmed: true, head: head2, base: 'trunk', baseHead: trunkStart })
    expect(uncheckedOk.status).toBe(200)
    expect(git(project, ['rev-parse', 'refs/heads/trunk']).trim()).toBe(head2)

    writeFileSync(join(worktree, 'more.js'), 'export const more = 3\n')
    git(worktree, ['add', 'more.js'])
    git(worktree, ['commit', '-m', 'third commit'])
    const head3 = git(worktree, ['rev-parse', 'HEAD']).trim()
    expect((await (await fetch(`${url}/api/control/reviews`)).json()).lanes[0].checks).toBe('unchecked')

    addRun({ lane: 'opencode', project: worktree, head: head3, tests: 'passed', exitCode: 0, startedAt: '2026-11-05T00:05:00.000Z' })
    expect((await (await fetch(`${url}/api/control/reviews`)).json()).lanes[0].checks).toBe('passed')
    const passedOk = await mergeRequest(url, 'opencode', { confirmed: true, head: head3, base: 'trunk', baseHead: head2 })
    expect(passedOk.status).toBe(200)
    expect(git(project, ['rev-parse', 'refs/heads/trunk']).trim()).toBe(head3)
  }, 40000)

  it('keeps a failed or passed check when an untested retry follows and refuses both merge paths', async () => {
    const { base, room, project, worktree, briefsDir } = makeProject()
    const roomWorktree = join(base, 'room-wt')
    writeFileSync(
      join(briefsDir, 'lanes.json'),
      JSON.stringify({ opencode: { name: 'OpenCode', worktree: roomWorktree } })
    )
    git(room, ['add', 'docs/agents/lanes.json'])
    git(room, ['commit', '-m', 'set lane worktree'])
    git(room, ['worktree', 'add', '-b', 'feat/room-work', roomWorktree, 'main'])
    writeFileSync(join(roomWorktree, 'room-file.txt'), 'room change\n')
    git(roomWorktree, ['add', 'room-file.txt'])
    git(roomWorktree, ['commit', '-m', 'room lane work'])

    const runs = join(base, 'runs')
    mkdirSync(runs, { recursive: true })
    const trunkStart = git(project, ['rev-parse', 'refs/heads/trunk']).trim()
    const projectHead = git(worktree, ['rev-parse', 'HEAD']).trim()
    const roomHead = git(roomWorktree, ['rev-parse', 'HEAD']).trim()
    const roomMainStart = git(room, ['rev-parse', 'refs/heads/main']).trim()

    writeFileSync(
      join(runs, 'runs.jsonl'),
      `${[
        { lane: 'opencode', project: worktree, head: projectHead, tests: 'failed', exitCode: 1, startedAt: '2026-11-05T00:00:00.000Z' },
        { lane: 'opencode', project: worktree, head: projectHead, retried: true, exitCode: 1, startedAt: '2026-11-05T00:01:00.000Z' },
        { lane: 'opencode', project: worktree, head: projectHead, tests: 'none', exitCode: 0, startedAt: '2026-11-05T00:02:00.000Z' },
        { lane: 'opencode', head: roomHead, tests: 'failed', exitCode: 1, startedAt: '2026-11-06T00:00:00.000Z' },
        { lane: 'opencode', head: roomHead, retried: true, exitCode: 1, startedAt: '2026-11-06T00:01:00.000Z' },
      ].map((entry) => JSON.stringify(entry)).join('\n')}\n`
    )

    const ffBridge = await startBridge({ projectRoot: project, briefsDir })
    const ffReviews = await (await fetch(`${ffBridge.url}/api/control/reviews`)).json()
    expect(ffReviews.lanes[0].strategy).toBe('fast-forward')
    expect(ffReviews.lanes[0].checks).toBe('failed')
    expect(ffReviews.lanes[0].lastRun).toMatchObject({ startedAt: '2026-11-05T00:02:00.000Z' })

    const ffRefused = await mergeRequest(ffBridge.url, 'opencode', {
      confirmed: true,
      head: projectHead,
      base: 'trunk',
      baseHead: trunkStart,
    })
    expect(ffRefused.status).toBe(409)
    expect((await ffRefused.json()).error).toBe('Checks failed on this head, so the lane was not merged.')
    expect(git(project, ['rev-parse', 'refs/heads/trunk']).trim()).toBe(trunkStart)

    const mcBridge = await startBridge({ projectRoot: room, briefsDir })
    const mcReviews = await (await fetch(`${mcBridge.url}/api/control/reviews`)).json()
    expect(mcReviews.lanes[0].strategy).toBe('merge-commit')
    expect(mcReviews.lanes[0].checks).toBe('failed')
    expect(mcReviews.lanes[0].lastRun).toMatchObject({ startedAt: '2026-11-06T00:01:00.000Z' })

    const mcRefused = await mergeRequest(mcBridge.url, 'opencode', {
      confirmed: true,
      head: roomHead,
      base: 'main',
      baseHead: roomMainStart,
      message: 'Merge opencode',
    })
    expect(mcRefused.status).toBe(409)
    expect((await mcRefused.json()).error).toBe('Checks failed on this head, so the lane was not merged.')
    expect(git(room, ['rev-parse', 'refs/heads/main']).trim()).toBe(roomMainStart)

    writeFileSync(join(worktree, 'passed.js'), 'export const passed = true\n')
    git(worktree, ['add', 'passed.js'])
    git(worktree, ['commit', '-m', 'passed commit'])
    const passedHead = git(worktree, ['rev-parse', 'HEAD']).trim()
    appendFileSync(
      join(runs, 'runs.jsonl'),
      `${[
        { lane: 'opencode', project: worktree, head: passedHead, tests: 'passed', exitCode: 0, startedAt: '2026-11-05T00:03:00.000Z' },
        { lane: 'opencode', project: worktree, head: passedHead, retried: true, exitCode: 1, startedAt: '2026-11-05T00:04:00.000Z' },
      ].map((entry) => JSON.stringify(entry)).join('\n')}\n`
    )
    const afterPass = await (await fetch(`${ffBridge.url}/api/control/reviews`)).json()
    expect(afterPass.lanes[0].checks).toBe('passed')
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

    const res = await mergeRequest(url, 'opencode', { confirmed: true, head, base: 'trunk', baseHead: oldBase })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, lane: 'opencode', branch: 'feat/x', head, commit: head })
    expect(git(project, ['rev-parse', 'HEAD']).trim()).toBe(head)
    expect(git(project, ['rev-parse', 'HEAD^']).trim()).toBe(oldBase)
    expect(git(project, ['status', '--porcelain'])).toBe('')
    expect(existsSync(join(project, 'extra.js'))).toBe(true)

    const again = await mergeRequest(url, 'opencode', { confirmed: true, head, base: 'trunk', baseHead: head })
    expect(again.status).toBe(409)
    expect(await again.json()).toEqual({ error: 'Nothing to merge.' })
    expect(git(project, ['rev-parse', 'HEAD']).trim()).toBe(head)
  }, 40000)

  it('moves a clean detached play worktree to the merged head', async () => {
    const { project, worktree, briefsDir } = makeProject()
    const play = join(project, '.worktrees', 'play')
    const oldHead = git(project, ['rev-parse', 'refs/heads/trunk']).trim()
    git(project, ['worktree', 'add', '--detach', play, 'trunk'])
    expect(git(play, ['rev-parse', 'HEAD']).trim()).toBe(oldHead)
    expect(git(play, ['branch', '--show-current'])).toBe('')
    const head = git(worktree, ['rev-parse', 'HEAD']).trim()
    const { url } = await startBridge({ projectRoot: project, briefsDir })

    const res = await mergeRequest(url, 'opencode', { confirmed: true, head, base: 'trunk', baseHead: oldHead })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual({ ok: true, lane: 'opencode', branch: 'feat/x', head, commit: head, play: 'moved' })
    expect(git(play, ['rev-parse', 'HEAD']).trim()).toBe(head)
    expect(git(play, ['branch', '--show-current'])).toBe('')
    expect(git(play, ['status', '--porcelain'])).toBe('')
  }, 40000)

  it('leaves a dirty play worktree where it is and answers dirty', async () => {
    const { project, worktree, briefsDir } = makeProject()
    const play = join(project, '.worktrees', 'play')
    const oldHead = git(project, ['rev-parse', 'refs/heads/trunk']).trim()
    git(project, ['worktree', 'add', '--detach', play, 'trunk'])
    writeFileSync(join(play, 'local.txt'), 'local change\n')
    const head = git(worktree, ['rev-parse', 'HEAD']).trim()
    const { url } = await startBridge({ projectRoot: project, briefsDir })

    const res = await mergeRequest(url, 'opencode', { confirmed: true, head, base: 'trunk', baseHead: oldHead })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual({
      ok: true,
      lane: 'opencode',
      branch: 'feat/x',
      head,
      commit: head,
      play: 'dirty',
      playHead: oldHead,
    })
    expect(git(play, ['rev-parse', 'HEAD']).trim()).toBe(oldHead)
    expect(git(play, ['status', '--porcelain'])).toContain('local.txt')
  }, 40000)

  it('names a dirty play worktree by its own head, not the old main', async () => {
    const { project, worktree, briefsDir } = makeProject()
    const play = join(project, '.worktrees', 'play')
    const oldHead = git(project, ['rev-parse', 'refs/heads/trunk']).trim()
    git(project, ['worktree', 'add', '--detach', play, 'trunk'])
    writeFileSync(join(play, 'play.txt'), 'play work\n')
    git(play, ['add', 'play.txt'])
    git(play, ['commit', '-m', 'play work'])
    const playHead = git(play, ['rev-parse', 'HEAD']).trim()
    expect(playHead).not.toBe(oldHead)
    writeFileSync(join(play, 'local.txt'), 'local change\n')
    const head = git(worktree, ['rev-parse', 'HEAD']).trim()
    const { url } = await startBridge({ projectRoot: project, briefsDir })

    const res = await mergeRequest(url, 'opencode', { confirmed: true, head, base: 'trunk', baseHead: oldHead })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual({
      ok: true,
      lane: 'opencode',
      branch: 'feat/x',
      head,
      commit: head,
      play: 'dirty',
      playHead,
    })
    expect(body.playHead).not.toBe(oldHead)
    expect(git(project, ['rev-parse', 'HEAD']).trim()).toBe(head)
    expect(git(play, ['rev-parse', 'HEAD']).trim()).toBe(playHead)
    expect(git(play, ['status', '--porcelain'])).toContain('local.txt')
  }, 40000)

  it('leaves a play worktree on a branch and answers not detached', async () => {
    const { project, worktree, briefsDir } = makeProject()
    const play = join(project, '.worktrees', 'play')
    const oldHead = git(project, ['rev-parse', 'refs/heads/trunk']).trim()
    git(project, ['worktree', 'add', '-b', 'play-branch', play, 'trunk'])
    expect(git(play, ['branch', '--show-current']).trim()).toBe('play-branch')
    const head = git(worktree, ['rev-parse', 'HEAD']).trim()
    const { url } = await startBridge({ projectRoot: project, briefsDir })

    const res = await mergeRequest(url, 'opencode', { confirmed: true, head, base: 'trunk', baseHead: oldHead })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual({
      ok: true,
      lane: 'opencode',
      branch: 'feat/x',
      head,
      commit: head,
      play: 'not detached',
      playHead: oldHead,
    })
    expect(git(play, ['branch', '--show-current']).trim()).toBe('play-branch')
    expect(git(play, ['rev-parse', 'HEAD']).trim()).toBe(oldHead)
  }, 40000)

  it('answers no play field without a play worktree and moves one that appears later', async () => {
    const { project, worktree, briefsDir } = makeProject()
    const play = join(project, '.worktrees', 'play')
    const firstHead = git(worktree, ['rev-parse', 'HEAD']).trim()
    const oldHead = git(project, ['rev-parse', 'refs/heads/trunk']).trim()
    const { url } = await startBridge({ projectRoot: project, briefsDir })

    const first = await mergeRequest(url, 'opencode', { confirmed: true, head: firstHead, base: 'trunk', baseHead: oldHead })
    expect(first.status).toBe(200)
    const firstBody = await first.json()
    expect(firstBody).toEqual({ ok: true, lane: 'opencode', branch: 'feat/x', head: firstHead, commit: firstHead })
    expect(Object.hasOwn(firstBody, 'play')).toBe(false)

    writeFileSync(join(worktree, 'second.js'), 'export const second = 2\n')
    git(worktree, ['add', 'second.js'])
    git(worktree, ['commit', '-m', 'second lane work'])
    const secondHead = git(worktree, ['rev-parse', 'HEAD']).trim()
    git(project, ['worktree', 'add', '--detach', play, 'trunk'])

    const second = await mergeRequest(url, 'opencode', {
      confirmed: true,
      head: secondHead,
      base: 'trunk',
      baseHead: firstHead,
    })
    expect(second.status).toBe(200)
    const secondBody = await second.json()
    expect(secondBody).toEqual({
      ok: true,
      lane: 'opencode',
      branch: 'feat/x',
      head: secondHead,
      commit: secondHead,
      play: 'moved',
    })
    expect(git(play, ['rev-parse', 'HEAD']).trim()).toBe(secondHead)
  }, 40000)

  it('keeps an ignored config.json in play when the merged commit tracks it and answers failed', async () => {
    const { project, worktree, briefsDir } = makeProject()
    const play = join(project, '.worktrees', 'play')
    const oldHead = git(project, ['rev-parse', 'refs/heads/trunk']).trim()
    appendFileSync(join(project, '.git', 'info', 'exclude'), 'config.json\n')
    writeFileSync(join(worktree, 'config.json'), '{"from":"lane"}\n')
    git(worktree, ['add', '-f', 'config.json'])
    git(worktree, ['commit', '-m', 'track config'])
    const head = git(worktree, ['rev-parse', 'HEAD']).trim()
    git(project, ['worktree', 'add', '--detach', play, 'trunk'])
    writeFileSync(join(play, 'config.json'), '{"local":true}\n')
    expect(git(play, ['status', '--porcelain'])).toBe('')
    const { url } = await startBridge({ projectRoot: project, briefsDir })

    const res = await mergeRequest(url, 'opencode', { confirmed: true, head, base: 'trunk', baseHead: oldHead })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual({ ok: true, lane: 'opencode', branch: 'feat/x', head, commit: head, play: 'failed' })
    expect(readFileSync(join(play, 'config.json'), 'utf8')).toBe('{"local":true}\n')
    expect(git(play, ['rev-parse', 'HEAD']).trim()).toBe(oldHead)
    expect(git(play, ['branch', '--show-current'])).toBe('')
  }, 40000)

  it('refuses a merge when the project branch moved on and says to rebase', async () => {
    const { project, worktree, briefsDir } = makeProject()
    writeFileSync(join(project, 'notes.txt'), 'changed on the project\n')
    git(project, ['add', 'notes.txt'])
    git(project, ['commit', '-m', 'project moved on'])
    const projectHead = git(project, ['rev-parse', 'HEAD']).trim()
    const laneHead = git(worktree, ['rev-parse', 'HEAD']).trim()
    const { url } = await startBridge({ projectRoot: project, briefsDir })

    const list = await fetch(`${url}/api/control/reviews`).then((r) => r.json())
    expect(list.lanes[0]).toMatchObject({ lane: 'opencode', ahead: 1, behind: 1 })

    const res = await mergeRequest(url, 'opencode', {
      confirmed: true,
      head: laneHead,
      base: 'trunk',
      baseHead: projectHead,
    })
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
    const runs = join(project, '..', 'runs')
    mkdirSync(runs, { recursive: true })
    writeFileSync(join(runs, 'agents.json'), JSON.stringify({ agents: [{ key: 'opencode', name: 'OpenCode', harness: 'opencode', model: 'opencode-go/deepseek-v4.1-flash' }] }))
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
    const trunkHead = git(project, ['rev-parse', 'refs/heads/trunk']).trim()
    const { url } = await startBridge({ projectRoot: project, briefsDir })

    const list = await fetch(`${url}/api/control/reviews`).then((r) => r.json())
    expect(list.lanes[0]).toMatchObject({
      lane: 'opencode',
      branch: '',
      base: 'trunk',
      baseHead: trunkHead,
      strategy: 'fast-forward',
      ahead: 1,
    })

    const res = await mergeRequest(url, 'opencode', { confirmed: true, head, base: 'trunk', baseHead: trunkHead })
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
    const runs = join(project, '..', 'runs')
    mkdirSync(runs, { recursive: true })
    writeFileSync(join(runs, 'agents.json'), JSON.stringify({ agents: [{ key: 'opencode', name: 'OpenCode', harness: 'opencode', model: 'opencode-go/deepseek-v4.1-flash' }] }))
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

  it('refuses missing or invalid destination fields and checks branch state under the write lock before git writes', async () => {
    const { project, worktree, briefsDir } = makeProject()
    git(project, ['branch', 'release'])
    const laneHead = git(worktree, ['rev-parse', 'HEAD']).trim()
    const trunkHead = git(project, ['rev-parse', 'refs/heads/trunk']).trim()
    const { url } = await startBridge({ projectRoot: project, briefsDir })

    for (const body of [
      { confirmed: true, head: laneHead },
      { confirmed: true, head: laneHead, base: '', baseHead: trunkHead },
      { confirmed: true, head: laneHead, base: 'trunk', baseHead: 'not-a-sha' },
    ]) {
      const bad = await mergeRequest(url, 'opencode', body)
      expect(bad.status).toBe(400)
      expect(await bad.json()).toEqual({ error: 'Send the destination branch and head you read.' })
    }

    const calls = []
    const recordingRunner = async (cwd, args, opts) => {
      calls.push(args)
      return defaultGitRunner(cwd, args, opts)
    }
    const answers = []
    let currentBody = { confirmed: true, head: laneHead, base: 'trunk', baseHead: trunkHead }
    const api = createReviewsApi({
      projectRoot: project,
      briefsDir,
      runsFolder: join(project, '..', 'runs'),
      sendJson: (req, res, status, body) => answers.push({ status, body }),
      readJsonBody: async () => currentBody,
      orchestrators: () => null,
      gitRunner: recordingRunner,
      readRuns: () => [],
    })
    const postMerge = () =>
      api.handle(
        { method: 'POST', headers: { origin: 'http://localhost:5173' } },
        {},
        new URL('http://127.0.0.1/api/control/reviews/opencode/merge')
      )

    git(project, ['switch', 'release'])
    const releaseHead = git(project, ['rev-parse', 'HEAD']).trim()
    await postMerge()
    expect(answers.at(-1)).toEqual({
      status: 409,
      body: { error: 'The project is on release now, not trunk, so refresh reviews first.' },
    })
    expect(calls.some((args) => args.includes('merge'))).toBe(false)
    expect(git(project, ['rev-parse', 'refs/heads/release']).trim()).toBe(releaseHead)

    git(project, ['switch', '--detach', 'HEAD'])
    await postMerge()
    expect(answers.at(-1)).toEqual({
      status: 409,
      body: { error: 'The project is not on a branch.' },
    })
    expect(calls.some((args) => args.includes('merge'))).toBe(false)

    git(project, ['switch', 'trunk'])
    writeFileSync(join(project, 'trunk-only.txt'), 'moved\n')
    git(project, ['add', 'trunk-only.txt'])
    git(project, ['commit', '-m', 'advance trunk'])
    const movedTrunkHead = git(project, ['rev-parse', 'HEAD']).trim()
    await postMerge()
    expect(answers.at(-1)).toEqual({
      status: 409,
      body: { error: 'The trunk branch moved since you read it, so refresh reviews first.' },
    })
    expect(calls.some((args) => args.includes('merge'))).toBe(false)
    expect(git(project, ['rev-parse', 'refs/heads/trunk']).trim()).toBe(movedTrunkHead)

    const lockKey = beginRepoWrite(project)
    expect(lockKey).not.toBeNull()
    try {
      currentBody = { confirmed: true, head: laneHead, base: 'trunk', baseHead: movedTrunkHead }
      await postMerge()
      expect(answers.at(-1)).toEqual({ status: 409, body: { error: WRITE_IN_FLIGHT_PROBLEM } })
      expect(calls.some((args) => args.includes('merge'))).toBe(false)
    } finally {
      endRepoWrite(lockKey)
    }
  }, 40000)

  it('refuses a trunk confirm card after a switch to release or trunk advance, hides message on fast-forward and merges a fresh card', async () => {
    const { project, worktree, briefsDir } = makeProject()
    const firstLaneHead = git(worktree, ['rev-parse', 'HEAD']).trim()
    writeFileSync(join(worktree, 'second.js'), 'export const two = 2\n')
    git(worktree, ['add', 'second.js'])
    git(worktree, ['commit', '-m', 'second lane work'])
    const laneHead = git(worktree, ['rev-parse', 'HEAD']).trim()
    git(project, ['branch', 'release'])
    const trunkStart = git(project, ['rev-parse', 'refs/heads/trunk']).trim()
    const releaseStart = git(project, ['rev-parse', 'refs/heads/release']).trim()

    const { url } = await startBridge({ projectRoot: project, briefsDir })
    const rawClient = createClient({
      baseUrl: url,
      fetchImpl: (input, init = {}) =>
        fetch(input, {
          ...init,
          headers: { ...init?.headers, Origin: 'http://localhost:5173' },
        }),
    })
    let reviewsCount = 0
    const client = {
      ...rawClient,
      reviews: async () => {
        const list = await rawClient.reviews()
        reviewsCount += 1
        return list
      },
    }

    async function waitFor(check) {
      for (let i = 0; i < 400; i += 1) {
        if (check()) return
        await settle(25)
      }
      throw new Error('timed out waiting for UI update')
    }

    await withDom(async ({ container, root }) => {
      await act(async () => {
        root.render(createElement(ReviewsPanel, { client }))
      })
      await waitFor(() => container.querySelector('.review-merge-btn') !== null)

      await click(root, container.querySelector('.review-merge-btn'))
      const card = container.querySelector('.review-confirm-card')
      expect(card).not.toBeNull()
      expect(card.textContent).toContain('into trunk?')
      expect(card.textContent).toContain("Fast-forward merge. The lane's commits are kept as they are.")
      expect(card.querySelector('input')).toBeNull()

      git(project, ['switch', 'release'])
      await click(root, buttonWithText(card, 'Merge'))
      await waitFor(() => card.querySelector('[role="alert"]') !== null)
      expect(card.querySelector('[role="alert"]').textContent).toBe(
        'The project is on release now, not trunk, so refresh reviews first.'
      )
      expect(git(project, ['rev-parse', 'refs/heads/release']).trim()).toBe(releaseStart)
      expect(git(project, ['rev-parse', 'refs/heads/trunk']).trim()).toBe(trunkStart)

      git(project, ['switch', 'trunk'])
      git(project, ['merge', '--ff-only', firstLaneHead])
      await click(root, buttonWithText(card, 'Merge'))
      await waitFor(() =>
        card.querySelector('[role="alert"]')?.textContent.includes('The trunk branch moved since you read it')
      )
      expect(card.querySelector('[role="alert"]').textContent).toBe(
        'The trunk branch moved since you read it, so refresh reviews first.'
      )
      expect(git(project, ['rev-parse', 'refs/heads/trunk']).trim()).toBe(firstLaneHead)

      const countBeforeRefresh = reviewsCount
      await click(root, buttonWithText(container, 'Refresh'))
      await waitFor(() => reviewsCount > countBeforeRefresh)

      await click(root, container.querySelector('.review-merge-btn'))
      const freshCard = container.querySelector('.review-confirm-card')
      expect(freshCard).not.toBeNull()
      expect(freshCard.querySelector('[role="alert"]')).toBeNull()
      expect(freshCard.querySelector('input')).toBeNull()

      const countBeforeMerge = reviewsCount
      await click(root, buttonWithText(freshCard, 'Merge'))
      await waitFor(
        () => container.querySelector('.review-confirm-card') === null && reviewsCount > countBeforeMerge
      )
      await settle(0)
      expect(container.querySelector('.review-merged-banner')?.textContent).toBe(
        `Merged as ${laneHead.slice(0, 7)}.`
      )
      expect(git(project, ['rev-parse', 'refs/heads/trunk']).trim()).toBe(laneHead)
    })
  }, 40000)

  it('shows check state in the confirm card, refuses a failed head, and merges unchecked with warning or passed', async () => {
    const { base, project, worktree, briefsDir } = makeProject()
    const runs = join(base, 'runs')
    mkdirSync(runs, { recursive: true })
    const trunkStart = git(project, ['rev-parse', 'refs/heads/trunk']).trim()
    const head1 = git(worktree, ['rev-parse', 'HEAD']).trim()
    const addRun = (entry) => {
      appendFileSync(join(runs, 'runs.jsonl'), `${JSON.stringify(entry)}\n`)
    }
    addRun({ lane: 'opencode', project: worktree, head: head1, tests: 'failed', exitCode: 1, startedAt: '2026-11-05T00:00:00.000Z' })

    const { url } = await startBridge({ projectRoot: project, briefsDir })
    const rawClient = createClient({
      baseUrl: url,
      fetchImpl: (input, init = {}) =>
        fetch(input, {
          ...init,
          headers: { ...init?.headers, Origin: 'http://localhost:5173' },
        }),
    })
    let reviewsCount = 0
    const client = {
      ...rawClient,
      reviews: async () => {
        const list = await rawClient.reviews()
        reviewsCount += 1
        return list
      },
    }

    async function waitFor(check) {
      for (let i = 0; i < 400; i += 1) {
        if (check()) return
        await settle(25)
      }
      throw new Error('timed out waiting for UI update')
    }

    await withDom(async ({ container, root }) => {
      await act(async () => {
        root.render(createElement(ReviewsPanel, { client }))
      })
      await waitFor(() => container.querySelector('.review-merge-btn') !== null)
      expect(container.querySelector('.review-checks')?.textContent).toBe('checks failed')

      await click(root, container.querySelector('.review-merge-btn'))
      let card = container.querySelector('.review-confirm-card')
      expect(card.querySelector('.review-confirm-checks')?.textContent).toBe('Checks failed for this head.')
      await click(root, buttonWithText(card, 'Merge'))
      await waitFor(() => card.querySelector('[role="alert"]') !== null)
      expect(card.querySelector('[role="alert"]').textContent).toBe(
        'Checks failed on this head, so the lane was not merged.'
      )
      expect(git(project, ['rev-parse', 'refs/heads/trunk']).trim()).toBe(trunkStart)

      writeFileSync(join(worktree, 'second.js'), 'export const two = 2\n')
      git(worktree, ['add', 'second.js'])
      git(worktree, ['commit', '-m', 'second commit'])
      const head2 = git(worktree, ['rev-parse', 'HEAD']).trim()
      addRun({ lane: 'opencode', project: worktree, head: head2, tests: 'none', exitCode: 0, startedAt: '2026-11-05T00:01:00.000Z' })

      let beforeRefresh = reviewsCount
      await click(root, buttonWithText(container, 'Refresh'))
      await waitFor(() => reviewsCount > beforeRefresh)
      expect(container.querySelector('.review-checks')?.textContent).toBe('unchecked')

      await click(root, container.querySelector('.review-merge-btn'))
      card = container.querySelector('.review-confirm-card')
      expect(card.querySelector('.review-confirm-checks')?.textContent).toBe(
        'Warning: checks are unchecked for this head.'
      )
      let beforeMerge = reviewsCount
      await click(root, buttonWithText(card, 'Merge'))
      await waitFor(
        () => container.querySelector('.review-confirm-card') === null && reviewsCount > beforeMerge
      )
      expect(git(project, ['rev-parse', 'refs/heads/trunk']).trim()).toBe(head2)

      writeFileSync(join(worktree, 'third.js'), 'export const three = 3\n')
      git(worktree, ['add', 'third.js'])
      git(worktree, ['commit', '-m', 'third commit'])
      const head3 = git(worktree, ['rev-parse', 'HEAD']).trim()
      addRun({ lane: 'opencode', project: worktree, head: head3, tests: 'passed', exitCode: 0, startedAt: '2026-11-05T00:02:00.000Z' })

      beforeRefresh = reviewsCount
      await click(root, buttonWithText(container, 'Refresh'))
      await waitFor(() => reviewsCount > beforeRefresh)
      expect(container.querySelector('.review-checks')?.textContent).toBe('checks passed')

      await click(root, container.querySelector('.review-merge-btn'))
      card = container.querySelector('.review-confirm-card')
      expect(card.querySelector('.review-confirm-checks')?.textContent).toBe('Checks passed for this head.')
      beforeMerge = reviewsCount
      await click(root, buttonWithText(card, 'Merge'))
      await waitFor(
        () => container.querySelector('.review-confirm-card') === null && reviewsCount > beforeMerge
      )
      expect(git(project, ['rev-parse', 'refs/heads/trunk']).trim()).toBe(head3)
    })
  }, 40000)
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
