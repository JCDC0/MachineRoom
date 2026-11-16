import { execFileSync } from 'node:child_process'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { createOrchestrators } from '../server/orchestrators.js'
import { chatFileFor } from '../server/orchestrator.js'
import { activeLanesFileFor, writeActiveLanes } from '../server/active-lanes.js'
import { createRunsApi } from '../server/runs.js'
import { createReviewsApi } from '../server/reviews.js'
import { gitPath } from '../server/programPath.js'
import { makeTempDir } from './helpers/tempRoot.js'

const cleanup = []
afterEach(() => { while (cleanup.length) cleanup.pop()() })
function setup() {
  const root = makeTempDir('mr-gates-')
  const runs = join(root, 'runs')
  mkdirSync(runs)
  writeActiveLanes(activeLanesFileFor(root, runs), ['inside', 'outside'])
  const ladder = { subs: [{ id: 'scout', name: 'Scout', harness: 'opencode', model: '', lanes: ['inside'], scope: [], restricted: false, setBy: 'owner' }] }
  writeFileSync(chatFileFor(root, runs, 'orchestrator'), JSON.stringify({ project: root, messages: [], pending: [], ladder }))
  let body, answer
  const started = []
  const registry = createOrchestrators({ projectRoot: root, runsFolder: runs, lanes: { inside: { name: 'Inside', cli: { harness: 'opencode', bin: 'opencode' } }, outside: { name: 'Outside', cli: { harness: 'opencode', bin: 'opencode' } } }, harnessAvailable: () => true,
    startLaneTask: async (lane) => { started.push(lane); return { status: 202 } },
    readJsonBody: async () => body, sendJson: (req, res, status, value) => { answer = { status, body: value } } })
  cleanup.push(() => rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }))
  cleanup.push(() => registry.close())
  const headers = (id) => ({ 'x-machineroom-orchestrator': registry.token(id) })
  async function post(api, path, id, value) {
    body = value
    answer = null
    await api.handle({ method: 'POST', headers: headers(id) }, {}, new URL(`http://localhost${path}`))
    return answer
  }
  return { root, runs, registry, started, post }
}

it('gates bare lane messages and records the token sender', async () => {
  const { registry, started } = setup()
  const sub = registry.token('scout')
  expect((await registry.message({ to: 'outside', text: 'work' }, false, sub)).status).toBe(403)
  expect(started).toEqual([])
  expect((await registry.message({ to: 'inside', text: 'work' }, false, sub)).status).toBe(202)
  expect(started).toEqual(['inside'])
  expect(registry.main.answer().messages.at(-1).from).toBe('sub:scout')
  expect((await registry.message({ to: 'outside', text: 'main work' }, false, registry.token('orchestrator'))).status).toBe(202)
  expect(registry.main.answer().messages.at(-1).from).toBe('orchestrator')
})

it('lets a sub stop only itself and lets Main stop any orchestrator', async () => {
  const { registry, post } = setup()
  let mainStops = 0, subStops = 0
  registry.find('orchestrator').stop = () => { mainStops++; return { status: 200, body: {} } }
  registry.find('scout').stop = () => { subStops++; return { status: 200, body: {} } }
  const path = '/api/orchestrator/stop'
  expect((await post(registry, path, 'scout', { id: 'orchestrator' })).status).toBe(403)
  expect(mainStops).toBe(0)
  expect((await post(registry, path, 'scout', {})).status).toBe(200)
  expect((await post(registry, path, 'scout', { id: 'scout' })).status).toBe(200)
  expect((await post(registry, path, 'orchestrator', { id: 'orchestrator' })).status).toBe(200)
  expect([mainStops, subStops]).toEqual([1, 2])
})

it('checks the sector before stopping a lane', async () => {
  const { root, runs, registry, post } = setup()
  let body, answer
  const api = createRunsApi({ projectRoot: root, runsFolder: runs, orchestrators: () => registry, readJsonBody: async () => body, sendJson: (req, res, status, value) => { answer = { status, body: value } } })
  cleanup.push(() => api.stopAll())
  async function stop(id, lane) {
    body = { lane, startedAt: '2026-01-01T00:00:00Z', confirmed: true }
    await api.handle({ method: 'POST', headers: { 'x-machineroom-orchestrator': registry.token(id) } }, {}, new URL('http://localhost/api/control/runs/stop'))
    return answer.status
  }
  expect(await stop('scout', 'outside')).toBe(403)
  expect(await stop('scout', 'inside')).toBe(409)
  expect(await stop('orchestrator', 'outside')).toBe(409)
})

it('refuses an outside merge without moving main and lets Main merge', async () => {
  const { root, runs, registry } = setup()
  const git = (...args) => execFileSync(gitPath(), args, { cwd: root, encoding: 'utf8', windowsHide: true }).trim()
  git('init', '-b', 'main')
  git('config', 'user.name', 'Test')
  git('config', 'user.email', 'test@example.invalid')
  git('config', 'commit.gpgsign', 'false')
  writeFileSync(join(root, 'file'), 'first')
  git('add', 'file'); git('commit', '-m', 'first')
  const baseHead = git('rev-parse', 'HEAD')
  const worktree = join(root, 'worktree')
  git('worktree', 'add', '-b', 'feat/test', worktree)
  writeFileSync(join(worktree, 'file'), 'second')
  execFileSync(gitPath(), ['-C', worktree, 'commit', '-am', 'second'], { windowsHide: true })
  const head = git('rev-parse', 'feat/test')
  const briefs = join(root, 'briefs'); mkdirSync(briefs)
  writeFileSync(join(briefs, 'lanes.json'), JSON.stringify({ outside: { name: 'Outside', worktree } }))
  let answer
  const api = createReviewsApi({ projectRoot: root, briefsDir: briefs, runsFolder: runs, orchestrators: () => registry, readRuns: () => [], readJsonBody: async () => ({ confirmed: true, head, base: 'main', baseHead, message: 'Merge lane' }), sendJson: (req, res, status, body) => { answer = { status, body } } })
  async function merge(id) {
    await api.handle({ method: 'POST', headers: { 'x-machineroom-orchestrator': registry.token(id) } }, {}, new URL('http://localhost/api/control/reviews/outside/merge'))
    return answer.status
  }
  expect(await merge('scout')).toBe(403)
  expect(git('rev-parse', 'HEAD')).toBe(baseHead)
  expect(await merge('orchestrator')).toBe(200)
  expect(git('rev-parse', 'HEAD')).not.toBe(baseHead)
})
