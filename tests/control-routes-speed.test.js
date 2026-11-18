import { appendFileSync, mkdirSync, realpathSync, renameSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { activeLanesFileFor, writeActiveLanes } from '../server/active-lanes.js'
import { createBridge } from '../server/index.js'
import { clearRunsCache, createRunsApi, runRecordCacheStats } from '../server/runs.js'
import { makeTempDir } from './helpers/tempRoot.js'

const cleanups = []

afterEach(async () => {
  clearRunsCache()
  while (cleanups.length > 0) {
    const fn = cleanups.pop()
    await fn()
  }
})

function tempDir(prefix = 'mr-control-speed-') {
  const dir = makeTempDir(prefix)
  cleanups.push(() => rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }))
  return dir
}

const LANE_KEYS = [
  'codex', 'codex2', 'codex3',
  'claude', 'claude2', 'claude3',
  'opencode', 'opencode2', 'opencode3', 'opencode4',
  'agy', 'agy2', 'agy3',
  'native', 'native2',
]

function makeLanesConfig() {
  return Object.fromEntries(
    LANE_KEYS.map((key) => [
      key,
      {
        name: key,
        cli: {
          harness: key.startsWith('codex')
            ? 'codex'
            : key.startsWith('claude')
              ? 'claude'
              : key.startsWith('opencode')
                ? 'opencode'
                : key.startsWith('agy')
                  ? 'agy'
                  : 'machineroom',
          bin: `${key}.exe`,
          model: 'test-model',
        },
      },
    ])
  )
}

function buildRecord({ lane, project, index, baseMs = Date.UTC(2026, 10, 1, 0, 0, 0), exitCode = 0, task }) {
  const startedAt = new Date(baseMs + index * 30000).toISOString()
  const stamp = `${startedAt.slice(0, 10).replace(/-/g, '')}-${String(index).padStart(6, '0')}`
  return {
    lane,
    briefs: [],
    model: 'test-model',
    reasoning: 'high',
    mode: 'auto',
    startedAt,
    finishedAt: new Date(baseMs + index * 30000 + 60000).toISOString(),
    minutes: 1,
    exitCode,
    killed: false,
    costUsd: 0.05,
    log: `${lane}-project-${stamp}.log`,
    branch: '',
    commits: [`abc1234 0.1.400: Step ${index}`],
    project,
    task: task ?? `Run task ${index} on project`,
  }
}

async function getJson(url, path) {
  const res = await fetch(`${url}${path}`)
  return { status: res.status, body: await res.json() }
}

describe('control routes caching and speed on large run logs', () => {
  it('reads only appended bytes on runs.jsonl and shows an appended record on the next call', async () => {
    const base = tempDir()
    const runsDir = join(base, 'runs')
    const proj1 = join(base, 'proj1')
    const proj2 = join(base, 'proj2')
    mkdirSync(runsDir, { recursive: true })
    mkdirSync(proj1, { recursive: true })
    mkdirSync(proj2, { recursive: true })

    const lines = []
    for (let i = 0; i < 40; i += 1) {
      const lane = LANE_KEYS[i % LANE_KEYS.length]
      const project = i % 2 === 0 ? proj1 : proj2
      lines.push(JSON.stringify(buildRecord({ lane, project, index: i })))
    }
    const initialText = `${lines.join('\n')}\n`
    const file = join(runsDir, 'runs.jsonl')
    writeFileSync(file, initialText)

    const bridge = createBridge({
      projectRoot: proj1,
      runsFolder: runsDir,
      lanesSource: null,
      port: 0,
      env: {},
    })
    cleanups.push(() => bridge.stop())
    const { url } = await bridge.start()

    const firstIssues = await getJson(url, '/api/control/issues')
    expect(firstIssues.status).toBe(200)
    expect(firstIssues.body).toHaveLength(20)

    const firstRuns = await getJson(url, '/api/control/runs')
    expect(firstRuns.status).toBe(200)
    expect(firstRuns.body.recent).toHaveLength(20)

    const firstCodex = await getJson(url, '/api/control/runs?lane=codex')
    expect(firstCodex.status).toBe(200)

    const afterCold = runRecordCacheStats(file)
    expect(afterCold.fullReads).toBe(1)
    expect(afterCold.incrementalReads).toBe(0)
    expect(afterCold.bytesRead).toBe(Buffer.byteLength(initialText))

    await getJson(url, '/api/control/issues')
    await getJson(url, '/api/control/runs')
    await getJson(url, '/api/control/runs?lane=codex')
    expect(runRecordCacheStats(file)).toEqual(afterCold)

    const appended = buildRecord({ lane: 'codex', project: proj1, index: 999, task: 'Appended codex task' })
    const appendedLine = `${JSON.stringify(appended)}\n`
    appendFileSync(file, appendedLine)

    const nextIssues = await getJson(url, '/api/control/issues')
    expect(nextIssues.body[0]).toMatchObject({ id: 'codex-project-20261101-000999', title: 'Appended codex task' })

    const nextRuns = await getJson(url, '/api/control/runs')
    expect(nextRuns.body.recent[0]).toMatchObject({ task: 'Appended codex task', lane: 'codex' })

    const nextCodex = await getJson(url, '/api/control/runs?lane=codex')
    expect(nextCodex.body.recent[0]).toMatchObject({ task: 'Appended codex task', lane: 'codex' })

    const afterAppend = runRecordCacheStats(file)
    expect(afterAppend.fullReads).toBe(1)
    expect(afterAppend.incrementalReads).toBe(1)
    expect(afterAppend.bytesRead).toBe(afterCold.bytesRead + Buffer.byteLength(appendedLine))

    const foreign = buildRecord({ lane: 'codex', project: proj2, index: 1000, task: 'Foreign project task' })
    const foreignLine = `${JSON.stringify(foreign)}\n`
    appendFileSync(file, foreignLine)

    const afterForeignIssues = await getJson(url, '/api/control/issues')
    expect(afterForeignIssues.body.some((issue) => issue.title === 'Foreign project task')).toBe(false)
    const afterForeignRuns = await getJson(url, '/api/control/runs')
    expect(afterForeignRuns.body.recent.some((entry) => entry.task === 'Foreign project task')).toBe(false)
    expect(runRecordCacheStats(file).incrementalReads).toBe(2)
  })

  it('reads runs.jsonl again in full when truncated or replaced', async () => {
    const base = tempDir()
    const runsDir = join(base, 'runs')
    const proj1 = join(base, 'proj1')
    mkdirSync(runsDir, { recursive: true })
    mkdirSync(proj1, { recursive: true })

    const file = join(runsDir, 'runs.jsonl')
    const initial = [
      buildRecord({ lane: 'codex', project: proj1, index: 1, task: 'Initial record one' }),
      buildRecord({ lane: 'claude', project: proj1, index: 2, task: 'Initial record two' }),
      buildRecord({ lane: 'agy', project: proj1, index: 3, task: 'Initial record three' }),
    ]
    writeFileSync(file, initial.map((entry) => JSON.stringify(entry)).join('\n') + '\n')

    const bridge = createBridge({
      projectRoot: proj1,
      runsFolder: runsDir,
      lanesSource: null,
      port: 0,
      env: {},
    })
    cleanups.push(() => bridge.stop())
    const { url } = await bridge.start()

    expect((await getJson(url, '/api/control/issues')).body).toHaveLength(3)
    expect(runRecordCacheStats(file).fullReads).toBe(1)

    const truncated = buildRecord({ lane: 'codex', project: proj1, index: 10, task: 'Truncated sole record' })
    writeFileSync(file, `${JSON.stringify(truncated)}\n`)

    const afterTruncateIssues = await getJson(url, '/api/control/issues')
    expect(afterTruncateIssues.body.map((issue) => issue.title)).toEqual(['Truncated sole record'])
    const afterTruncateRuns = await getJson(url, '/api/control/runs')
    expect(afterTruncateRuns.body.recent.map((entry) => entry.task)).toEqual(['Truncated sole record'])
    expect(runRecordCacheStats(file).fullReads).toBe(2)

    const largerOverwrite = [
      buildRecord({ lane: 'codex', project: proj1, index: 20, task: 'Overwritten larger record alpha' }),
      buildRecord({ lane: 'claude', project: proj1, index: 21, task: 'Overwritten larger record beta' }),
      buildRecord({ lane: 'opencode', project: proj1, index: 22, task: 'Overwritten larger record gamma' }),
    ]
    writeFileSync(file, largerOverwrite.map((entry) => JSON.stringify(entry)).join('\n') + '\n')

    const afterOverwriteIssues = await getJson(url, '/api/control/issues')
    expect(afterOverwriteIssues.body.map((issue) => issue.title)).toEqual([
      'Overwritten larger record gamma',
      'Overwritten larger record beta',
      'Overwritten larger record alpha',
    ])
    const afterOverwriteRuns = await getJson(url, '/api/control/runs')
    expect(afterOverwriteRuns.body.recent.map((entry) => entry.task)).toEqual([
      'Overwritten larger record gamma',
      'Overwritten larger record beta',
      'Overwritten larger record alpha',
    ])
    expect(runRecordCacheStats(file).fullReads).toBe(3)

    const swapped = [
      buildRecord({ lane: 'codex', project: proj1, index: 30, task: 'Renamed replacement one' }),
      buildRecord({ lane: 'agy', project: proj1, index: 31, task: 'Renamed replacement two' }),
    ]
    const tmpFile = join(runsDir, 'runs.jsonl.tmp')
    writeFileSync(tmpFile, swapped.map((entry) => JSON.stringify(entry)).join('\n') + '\n')
    renameSync(tmpFile, file)

    const afterRenameIssues = await getJson(url, '/api/control/issues')
    expect(afterRenameIssues.body.map((issue) => issue.title)).toEqual([
      'Renamed replacement two',
      'Renamed replacement one',
    ])
    expect(runRecordCacheStats(file).fullReads).toBe(4)

    const sameSizeContent = swapped
      .map((entry, idx) => JSON.stringify({ ...entry, task: `SameSize replacement ${idx === 0 ? 'AA' : 'BB'}` }))
      .join('\n') + '\n'
    writeFileSync(file, sameSizeContent)
    const future = new Date(Date.now() + 5000)
    utimesSync(file, future, future)

    const afterSameSize = await getJson(url, '/api/control/runs')
    expect(afterSameSize.body.recent.map((entry) => entry.task)).toEqual([
      'SameSize replacement BB',
      'SameSize replacement AA',
    ])
    expect(runRecordCacheStats(file).fullReads).toBe(5)
  })

  it('caches each project path resolution for the life of the bridge', async () => {
    const base = tempDir()
    const runsDir = join(base, 'runs')
    const proj1 = join(base, 'proj1')
    const proj2 = join(base, 'proj2')
    const proj3 = join(base, 'proj3')
    mkdirSync(runsDir, { recursive: true })
    mkdirSync(proj1, { recursive: true })
    mkdirSync(proj2, { recursive: true })
    mkdirSync(proj3, { recursive: true })

    const records = []
    for (let i = 0; i < 300; i += 1) {
      const lane = LANE_KEYS[i % LANE_KEYS.length]
      const project = [proj1, proj2, proj3][(i + Math.floor(i / LANE_KEYS.length)) % 3]
      records.push(JSON.stringify(buildRecord({ lane, project, index: i })))
    }
    const file = join(runsDir, 'runs.jsonl')
    writeFileSync(file, records.join('\n') + '\n')

    const resolvedPaths = []
    const countingResolve = (value) => {
      const folder = resolve(String(value ?? ''))
      resolvedPaths.push(folder)
      try {
        return realpathSync.native(folder)
      } catch {
        return folder
      }
    }

    let answer = null
    const api = createRunsApi({
      projectRoot: proj1,
      runsFolder: runsDir,
      resolvePath: countingResolve,
      sendJson: (_req, _res, status, body) => {
        answer = { status, body }
      },
    })
    cleanups.push(() => api.stopAll())

    await api.handle({ method: 'GET', headers: {} }, {}, new URL('http://localhost/api/control/issues'))
    expect(answer.status).toBe(200)
    const countAfterFirst = resolvedPaths.length
    expect(countAfterFirst).toBe(1 + 3 + LANE_KEYS.length)

    for (let i = 0; i < 10; i += 1) {
      await api.handle({ method: 'GET', headers: {} }, {}, new URL('http://localhost/api/control/issues'))
      await api.handle({ method: 'GET', headers: {} }, {}, new URL('http://localhost/api/control/runs'))
      await api.handle({ method: 'GET', headers: {} }, {}, new URL('http://localhost/api/control/runs?lane=codex'))
    }
    expect(resolvedPaths.length).toBe(countAfterFirst)

    appendFileSync(file, `${JSON.stringify(buildRecord({ lane: 'codex', project: proj1, index: 900 }))}\n`)
    appendFileSync(file, `${JSON.stringify(buildRecord({ lane: 'codex', project: proj2, index: 901 }))}\n`)

    await api.handle({ method: 'GET', headers: {} }, {}, new URL('http://localhost/api/control/runs?lane=codex'))
    expect(answer.body.recent[0]).toMatchObject({ lane: 'codex', task: 'Run task 900 on project' })
    expect(resolvedPaths.length).toBe(countAfterFirst)
  })

  it('serves 20,000 records across 15 lanes and 3 projects and picks up appended runs', async () => {
    const base = tempDir()
    const runsDir = join(base, 'runs')
    const proj1 = join(base, 'proj1')
    const proj2 = join(base, 'proj2')
    const proj3 = join(base, 'proj3')
    mkdirSync(runsDir, { recursive: true })
    mkdirSync(proj1, { recursive: true })
    mkdirSync(proj2, { recursive: true })
    mkdirSync(proj3, { recursive: true })

    const lanes = makeLanesConfig()
    const lanesFile = join(base, 'lanes.json')
    writeFileSync(lanesFile, JSON.stringify({ orchestrator: { name: 'Orchestrator', cli: { harness: 'claude', bin: 'claude', model: 'opus' } }, ...lanes }))
    writeActiveLanes(activeLanesFileFor(proj1, runsDir), LANE_KEYS)

    const projects = [proj1, proj2, proj3]
    const lines = []
    for (let i = 0; i < 20000; i += 1) {
      const lane = LANE_KEYS[i % LANE_KEYS.length]
      const proj = projects[(i + Math.floor(i / LANE_KEYS.length)) % projects.length]
      const project = i % 10 === 0 ? join(proj, '.worktrees', lane) : proj
      lines.push(JSON.stringify(buildRecord({ lane, project, index: i, exitCode: i % 25 === 0 ? 1 : 0 })))
    }
    const file = join(runsDir, 'runs.jsonl')
    writeFileSync(file, lines.join('\n') + '\n')

    const bridge = createBridge({
      projectRoot: proj1,
      runsFolder: runsDir,
      lanesFile,
      port: 0,
      env: {},
      lanesSource: { folder: runsDir, lanes, repoRoot: proj1, pollMs: 60000, quietMs: 60000 },
    })
    cleanups.push(() => bridge.stop())
    const { url } = await bridge.start()

    for (let i = 0; i < 5; i += 1) {
      const issues = await getJson(url, '/api/control/issues')
      expect(issues.status).toBe(200)
      expect(issues.body).toHaveLength(30)

      const runs = await getJson(url, '/api/control/runs')
      expect(runs.status).toBe(200)
      expect(runs.body.recent).toHaveLength(20)
      expect(runs.body.last).toHaveLength(15)

      const codex = await getJson(url, '/api/control/runs?lane=codex')
      expect(codex.status).toBe(200)
      expect(codex.body.recent).toHaveLength(20)
      expect(codex.body.recent.every((entry) => entry.lane === 'codex')).toBe(true)
      expect(codex.body.last).toHaveLength(1)
    }

    const statsBeforeAppend = runRecordCacheStats(file)
    expect(statsBeforeAppend.fullReads).toBe(1)
    expect(statsBeforeAppend.incrementalReads).toBe(0)

    appendFileSync(file, `${JSON.stringify(buildRecord({ lane: 'codex', project: proj1, index: 20000, task: 'Fresh 20001st task' }))}\n`)

    const nextCodex = await getJson(url, '/api/control/runs?lane=codex')
    expect(nextCodex.body.recent[0]).toMatchObject({ lane: 'codex', task: 'Fresh 20001st task' })
    const nextIssues = await getJson(url, '/api/control/issues')
    expect(nextIssues.body[0]).toMatchObject({ title: 'Fresh 20001st task' })
    expect(runRecordCacheStats(file).incrementalReads).toBe(1)
  })
})
