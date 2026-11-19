import { execFileSync } from 'node:child_process'
import { appendFileSync, mkdirSync, realpathSync, renameSync, rmSync, statSync, symlinkSync, truncateSync, unlinkSync, utimesSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { activeLanesFileFor, writeActiveLanes } from '../server/active-lanes.js'
import { createBridge } from '../server/index.js'
import { gitEnv, gitPath } from '../server/programPath.js'
import { clearRunsCache, createRunsApi, runRecordCacheStats } from '../server/runs.js'
import { worktreeFor } from '../src/briefs/run.js'
import { makeTempDir } from './helpers/tempRoot.js'

const REPO_ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)))

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

  it('resets when file identity changes on a larger replacement whose head and boundary samples match', async () => {
    const base = tempDir()
    const runsDir = join(base, 'runs')
    const proj1 = join(base, 'proj1')
    mkdirSync(runsDir, { recursive: true })
    mkdirSync(proj1, { recursive: true })

    const file = join(runsDir, 'runs.jsonl')
    const headRecord = buildRecord({ lane: 'codex', project: proj1, index: 0, task: `Shared head ${'H'.repeat(540)}` })
    const headLine = `${JSON.stringify(headRecord)}\n`
    const middleA = buildRecord({ lane: 'claude', project: proj1, index: 1, task: 'Middle alpha' })
    const middleLineA = `${JSON.stringify(middleA)}\n`
    const middleB = buildRecord({ lane: 'claude', project: proj1, index: 1, task: 'Middle bravo' })
    const middleLineB = `${JSON.stringify(middleB)}\n`
    const boundaryRecord = buildRecord({ lane: 'agy', project: proj1, index: 2, task: `Boundary ${'T'.repeat(540)}` })
    const boundaryLine = `${JSON.stringify(boundaryRecord)}\n`
    const extraRecord = buildRecord({ lane: 'opencode', project: proj1, index: 3, task: 'Appended extra record' })
    const extraLine = `${JSON.stringify(extraRecord)}\n`

    expect(Buffer.byteLength(headLine)).toBeGreaterThan(512)
    expect(Buffer.byteLength(boundaryLine)).toBeGreaterThan(512)
    expect(Buffer.byteLength(middleLineB)).toBe(Buffer.byteLength(middleLineA))

    writeFileSync(file, headLine + middleLineA + boundaryLine)

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
    expect(firstIssues.body.map((issue) => issue.title)).toEqual([
      boundaryRecord.task.slice(0, 80),
      'Middle alpha',
      headRecord.task.slice(0, 80),
    ])
    expect(runRecordCacheStats(file).fullReads).toBe(1)
    expect(runRecordCacheStats(file).incrementalReads).toBe(0)

    const tmpFile = join(runsDir, 'runs.jsonl.tmp')
    writeFileSync(tmpFile, headLine + middleLineB + boundaryLine + extraLine)
    const future = new Date(Math.max(Date.now(), statSync(file).mtimeMs) + 2000)
    utimesSync(tmpFile, future, future)
    renameSync(tmpFile, file)

    const afterReplaceIssues = await getJson(url, '/api/control/issues')
    expect(afterReplaceIssues.body.map((issue) => issue.title)).toEqual([
      'Appended extra record',
      boundaryRecord.task.slice(0, 80),
      'Middle bravo',
      headRecord.task.slice(0, 80),
    ])
    const afterReplaceRuns = await getJson(url, '/api/control/runs')
    expect(afterReplaceRuns.body.recent.map((entry) => entry.task)).toEqual([
      'Appended extra record',
      boundaryRecord.task,
      'Middle bravo',
      headRecord.task,
    ])
    expect(runRecordCacheStats(file).fullReads).toBe(2)
    expect(runRecordCacheStats(file).incrementalReads).toBe(0)
  })

  it('counts a full read when runs.jsonl is truncated to zero', async () => {
    const base = tempDir()
    const runsDir = join(base, 'runs')
    const proj1 = join(base, 'proj1')
    mkdirSync(runsDir, { recursive: true })
    mkdirSync(proj1, { recursive: true })

    const file = join(runsDir, 'runs.jsonl')
    writeFileSync(
      file,
      [
        buildRecord({ lane: 'codex', project: proj1, index: 1, task: 'Initial record one' }),
        buildRecord({ lane: 'claude', project: proj1, index: 2, task: 'Initial record two' }),
      ]
        .map((entry) => JSON.stringify(entry))
        .join('\n') + '\n'
    )

    const bridge = createBridge({
      projectRoot: proj1,
      runsFolder: runsDir,
      lanesSource: null,
      port: 0,
      env: {},
    })
    cleanups.push(() => bridge.stop())
    const { url } = await bridge.start()

    expect((await getJson(url, '/api/control/issues')).body).toHaveLength(2)
    expect(runRecordCacheStats(file).fullReads).toBe(1)

    truncateSync(file, 0)

    const afterZeroIssues = await getJson(url, '/api/control/issues')
    expect(afterZeroIssues.body).toEqual([])
    expect(runRecordCacheStats(file)).toMatchObject({ offset: 0, records: 0, fullReads: 2 })

    const afterZeroRuns = await getJson(url, '/api/control/runs')
    expect(afterZeroRuns.body.recent).toEqual([])
    expect(runRecordCacheStats(file).fullReads).toBe(2)
  })

  it('detects a copy-over restore that preserves the first 512 bytes by checking the tail sample at the old offset', async () => {
    const base = tempDir()
    const runsDir = join(base, 'runs')
    const proj1 = join(base, 'proj1')
    mkdirSync(runsDir, { recursive: true })
    mkdirSync(proj1, { recursive: true })

    const file = join(runsDir, 'runs.jsonl')
    const headRecord = buildRecord({ lane: 'codex', project: proj1, index: 0, task: `Shared head ${'H'.repeat(540)}` })
    const headLine = `${JSON.stringify(headRecord)}\n`
    expect(Buffer.byteLength(headLine)).toBeGreaterThan(512)

    const initialTail = [
      buildRecord({ lane: 'claude', project: proj1, index: 1, task: 'Original middle record one' }),
      buildRecord({ lane: 'agy', project: proj1, index: 2, task: 'Original middle record two' }),
      buildRecord({ lane: 'opencode', project: proj1, index: 3, task: 'Original middle record three' }),
    ]
    const initialBody = headLine + initialTail.map((entry) => `${JSON.stringify(entry)}\n`).join('')
    writeFileSync(file, initialBody)

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
    expect(firstIssues.body.map((issue) => issue.title)).toEqual([
      'Original middle record three',
      'Original middle record two',
      'Original middle record one',
      headRecord.task.slice(0, 80),
    ])
    expect(runRecordCacheStats(file).fullReads).toBe(1)

    const restoredTail = [
      buildRecord({ lane: 'claude', project: proj1, index: 11, task: 'Restored backup record alpha' }),
      buildRecord({ lane: 'agy', project: proj1, index: 12, task: 'Restored backup record beta' }),
      buildRecord({ lane: 'opencode', project: proj1, index: 13, task: 'Restored backup record gamma' }),
      buildRecord({ lane: 'native', project: proj1, index: 14, task: 'Restored backup record delta' }),
    ]
    const restoredBody = headLine + restoredTail.map((entry) => `${JSON.stringify(entry)}\n`).join('')
    expect(Buffer.byteLength(restoredBody)).toBeGreaterThan(Buffer.byteLength(initialBody))
    writeFileSync(file, restoredBody)

    const afterRestoreIssues = await getJson(url, '/api/control/issues')
    expect(afterRestoreIssues.body.map((issue) => issue.title)).toEqual([
      'Restored backup record delta',
      'Restored backup record gamma',
      'Restored backup record beta',
      'Restored backup record alpha',
      headRecord.task.slice(0, 80),
    ])
    const afterRestoreRuns = await getJson(url, '/api/control/runs')
    expect(afterRestoreRuns.body.recent.map((entry) => entry.task)).toEqual([
      'Restored backup record delta',
      'Restored backup record gamma',
      'Restored backup record beta',
      'Restored backup record alpha',
      headRecord.task,
    ])
    expect(runRecordCacheStats(file).fullReads).toBe(2)
    expect(runRecordCacheStats(file).incrementalReads).toBe(0)

    const smallAppend = buildRecord({ lane: 'codex', project: proj1, index: 15, task: 'Small tail append' })
    const smallLine = `${JSON.stringify(smallAppend)}\n`
    expect(Buffer.byteLength(smallLine)).toBeLessThan(512)
    appendFileSync(file, smallLine)
    const afterSmallAppend = await getJson(url, '/api/control/runs')
    expect(afterSmallAppend.body.recent[0].task).toBe('Small tail append')
    expect(runRecordCacheStats(file).incrementalReads).toBe(1)

    const secondRestore = [
      headRecord,
      restoredTail[0],
      restoredTail[1],
      restoredTail[2],
      buildRecord({ lane: 'native', project: proj1, index: 24, task: 'Second restored tail omega' }),
      buildRecord({ lane: 'codex', project: proj1, index: 25, task: 'Second restored tail sigma' }),
    ]
    const secondBody = secondRestore.map((entry) => `${JSON.stringify(entry)}\n`).join('')
    expect(Buffer.byteLength(secondBody)).toBeGreaterThan(Buffer.byteLength(restoredBody) + Buffer.byteLength(smallLine))
    writeFileSync(file, secondBody)

    const afterSecondRestore = await getJson(url, '/api/control/runs')
    expect(afterSecondRestore.body.recent.map((entry) => entry.task)).toEqual([
      'Second restored tail sigma',
      'Second restored tail omega',
      'Restored backup record gamma',
      'Restored backup record beta',
      'Restored backup record alpha',
      headRecord.task,
    ])
    expect(runRecordCacheStats(file).fullReads).toBe(3)
  })

  it('rechecks isThisRepo after the 5 second floor when .git changes or the project moves', async () => {
    const base = tempDir()
    const runsDir = join(base, 'runs')
    const proj = join(base, 'proj')
    const wt = join(base, 'wt')
    const moved = join(base, 'proj-moved')
    mkdirSync(runsDir, { recursive: true })
    mkdirSync(proj, { recursive: true })
    mkdirSync(wt, { recursive: true })

    const mainCommon = resolve(
      REPO_ROOT,
      execFileSync(gitPath(), ['rev-parse', '--git-common-dir'], { cwd: REPO_ROOT, env: gitEnv(), encoding: 'utf8' }).trim()
    )
    writeFileSync(join(wt, 'HEAD'), 'ref: refs/heads/main\n')
    writeFileSync(join(wt, 'commondir'), `${mainCommon.replace(/\\/g, '/')}\n`)
    writeFileSync(join(proj, '.git'), `gitdir: ${wt.replace(/\\/g, '/')}\n`)

    const file = join(runsDir, 'runs.jsonl')
    writeFileSync(
      file,
      [
        JSON.stringify(buildRecord({ lane: 'codex', project: '', index: 1, task: 'Repo brief run' })),
        JSON.stringify(buildRecord({ lane: 'claude', project: proj, index: 2, task: 'Project folder run' })),
      ].join('\n') + '\n'
    )

    let currentNow = 1000
    let answer = null
    const api = createRunsApi({
      projectRoot: proj,
      runsFolder: runsDir,
      now: () => currentNow,
      sendJson: (_req, _res, status, body) => {
        answer = { status, body }
      },
    })
    cleanups.push(() => api.stopAll())

    await api.handle({ method: 'GET', headers: {} }, {}, new URL('http://localhost/api/control/issues'))
    expect(answer.body.map((issue) => issue.title)).toEqual(['Repo brief run'])

    unlinkSync(join(proj, '.git'))
    execFileSync(gitPath(), ['init'], { cwd: proj, env: gitEnv(), stdio: 'ignore' })

    currentNow += 1000
    await api.handle({ method: 'GET', headers: {} }, {}, new URL('http://localhost/api/control/issues'))
    expect(answer.body.map((issue) => issue.title)).toEqual(['Repo brief run'])

    currentNow += 4000
    await api.handle({ method: 'GET', headers: {} }, {}, new URL('http://localhost/api/control/issues'))
    expect(answer.body.map((issue) => issue.title)).toEqual(['Project folder run'])
    await api.handle({ method: 'GET', headers: {} }, {}, new URL('http://localhost/api/control/runs'))
    expect(answer.body.recent.map((entry) => entry.task)).toEqual(['Project folder run'])

    const runsDir2 = join(base, 'runs2')
    const proj2 = join(base, 'proj2')
    mkdirSync(runsDir2, { recursive: true })
    mkdirSync(proj2, { recursive: true })
    writeFileSync(join(proj2, '.git'), `gitdir: ${wt.replace(/\\/g, '/')}\n`)
    writeFileSync(
      join(runsDir2, 'runs.jsonl'),
      `${JSON.stringify(buildRecord({ lane: 'codex', project: '', index: 3, task: 'Moved repo brief run' }))}\n`
    )
    let moveNow = 1000
    let moveAnswer = null
    const moveApi = createRunsApi({
      projectRoot: proj2,
      runsFolder: runsDir2,
      now: () => moveNow,
      sendJson: (_req, _res, status, body) => {
        moveAnswer = { status, body }
      },
    })
    cleanups.push(() => moveApi.stopAll())

    await moveApi.handle({ method: 'GET', headers: {} }, {}, new URL('http://localhost/api/control/issues'))
    expect(moveAnswer.body.map((issue) => issue.title)).toEqual(['Moved repo brief run'])

    renameSync(proj2, moved)
    moveNow += 5000
    await moveApi.handle({ method: 'GET', headers: {} }, {}, new URL('http://localhost/api/control/issues'))
    expect(moveAnswer.body).toEqual([])
  })

  it('caches each existing project path resolution for 30 seconds', async () => {
    const base = tempDir()
    const runsDir = join(base, 'runs')
    const proj1 = join(base, 'proj1')
    const proj2 = join(base, 'proj2')
    const proj3 = join(base, 'proj3')
    mkdirSync(runsDir, { recursive: true })
    mkdirSync(proj1, { recursive: true })
    mkdirSync(proj2, { recursive: true })
    mkdirSync(proj3, { recursive: true })
    for (const lane of LANE_KEYS) {
      mkdirSync(join(proj1, '.worktrees', lane), { recursive: true })
    }

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

    let currentNow = 1000
    let answer = null
    const api = createRunsApi({
      projectRoot: proj1,
      runsFolder: runsDir,
      resolvePath: countingResolve,
      now: () => currentNow,
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

    currentNow += 30000
    appendFileSync(file, `${JSON.stringify(buildRecord({ lane: 'codex', project: proj2, index: 902 }))}\n`)
    await api.handle({ method: 'GET', headers: {} }, {}, new URL('http://localhost/api/control/runs?lane=codex'))
    expect(resolvedPaths.length).toBeGreaterThan(countAfterFirst)
  })

  it('never caches a missing-folder fallback and expires path resolutions after 30 seconds', async () => {
    const base = tempDir()
    const runsDir = join(base, 'runs')
    const proj1 = join(base, 'proj1')
    const proj2 = join(base, 'proj2')
    const missingFolder = join(base, 'missing-folder')
    const dynamicLink = join(base, 'dynamic-link')
    const timedLink = join(base, 'timed-link')
    mkdirSync(runsDir, { recursive: true })
    mkdirSync(proj1, { recursive: true })
    mkdirSync(proj2, { recursive: true })
    symlinkSync(proj2, timedLink, process.platform === 'win32' ? 'junction' : 'dir')

    const file = join(runsDir, 'runs.jsonl')
    writeFileSync(
      file,
      [
        JSON.stringify(buildRecord({ lane: 'codex', project: missingFolder, index: 1, task: 'Missing folder one' })),
        JSON.stringify(buildRecord({ lane: 'codex', project: dynamicLink, index: 2, task: 'Dynamic link run' })),
        JSON.stringify(buildRecord({ lane: 'codex', project: timedLink, index: 3, task: 'Timed link run' })),
      ].join('\n') + '\n'
    )

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

    let currentNow = 1000
    let answer = null
    const api = createRunsApi({
      projectRoot: proj1,
      runsFolder: runsDir,
      resolvePath: countingResolve,
      now: () => currentNow,
      sendJson: (_req, _res, status, body) => {
        answer = { status, body }
      },
    })
    cleanups.push(() => api.stopAll())

    await api.handle({ method: 'GET', headers: {} }, {}, new URL('http://localhost/api/control/issues'))
    expect(answer.body).toEqual([])
    const afterFirst = resolvedPaths.length

    currentNow += 100
    appendFileSync(file, `${JSON.stringify(buildRecord({ lane: 'codex', project: missingFolder, index: 4, task: 'Missing folder two' }))}\n`)
    await api.handle({ method: 'GET', headers: {} }, {}, new URL('http://localhost/api/control/issues'))
    expect(resolvedPaths.length).toBeGreaterThan(afterFirst)
    expect(answer.body).toEqual([])

    symlinkSync(proj1, dynamicLink, process.platform === 'win32' ? 'junction' : 'dir')
    currentNow += 100
    await api.handle({ method: 'GET', headers: {} }, {}, new URL('http://localhost/api/control/issues'))
    expect(answer.body.map((issue) => issue.title)).toEqual(['Dynamic link run'])

    rmSync(timedLink, { recursive: true, force: true })
    symlinkSync(proj1, timedLink, process.platform === 'win32' ? 'junction' : 'dir')
    currentNow += 5000
    await api.handle({ method: 'GET', headers: {} }, {}, new URL('http://localhost/api/control/issues'))
    expect(answer.body.map((issue) => issue.title)).toEqual(['Dynamic link run'])

    currentNow += 25000
    await api.handle({ method: 'GET', headers: {} }, {}, new URL('http://localhost/api/control/issues'))
    expect(answer.body.map((issue) => issue.title)).toEqual(['Timed link run', 'Dynamic link run'])
  })

  it('caps resolveCached and the three match caches by clearing at 1024 keys', async () => {
    const base = tempDir()
    const runsDir = join(base, 'runs')
    const proj1 = join(base, 'proj1')
    const otherProj = join(base, 'other-proj')
    const otherProj2 = join(base, 'other-proj-2')
    mkdirSync(runsDir, { recursive: true })
    mkdirSync(proj1, { recursive: true })
    mkdirSync(otherProj, { recursive: true })
    mkdirSync(otherProj2, { recursive: true })

    const p0 = join(base, 'p0')
    const pSpecial = join(base, 'p-special')
    const wtLane0 = worktreeFor(proj1, 'lane0')
    const resolveMap = new Map([
      [proj1, proj1],
      [p0, otherProj2],
      [otherProj, otherProj],
      [pSpecial, otherProj2],
      [wtLane0, otherProj],
    ])
    const resolveCounts = new Map()
    const fakeResolve = (value) => {
      const key = resolve(String(value ?? ''))
      resolveCounts.set(key, (resolveCounts.get(key) ?? 0) + 1)
      return resolveMap.get(key) ?? key
    }
    const fakeStat = (target) => {
      if (target === proj1 || target === join(proj1, '.git')) return statSync(target)
      return { ino: 1, mtimeMs: 1, ctimeMs: 1, size: 0 }
    }

    const file = join(runsDir, 'runs.jsonl')
    const seed = [
      JSON.stringify(buildRecord({ lane: 'lane0', project: p0, index: 0, task: 'Initial p0 miss' })),
      JSON.stringify(buildRecord({ lane: 'lane0', project: otherProj, index: 1, task: 'Initial worktree hit' })),
    ]
    writeFileSync(file, `${seed.join('\n')}\n`)

    let answer = null
    const api = createRunsApi({
      projectRoot: proj1,
      runsFolder: runsDir,
      resolvePath: fakeResolve,
      stat: fakeStat,
      now: () => 1000,
      sendJson: (_req, _res, status, body) => {
        answer = { status, body }
      },
    })
    cleanups.push(() => api.stopAll())

    await api.handle({ method: 'GET', headers: {} }, {}, new URL('http://localhost/api/control/issues'))
    expect(answer.body.map((issue) => issue.title)).toEqual(['Initial worktree hit'])
    expect(resolveCounts.get(p0)).toBe(1)
    expect(resolveCounts.get(wtLane0)).toBe(1)

    const overflow = []
    for (let i = 1; i <= 1025; i += 1) {
      overflow.push(JSON.stringify(buildRecord({ lane: `lane${i}`, project: join(base, `p${i}`), index: i + 10 })))
    }
    appendFileSync(file, `${overflow.join('\n')}\n`)
    await api.handle({ method: 'GET', headers: {} }, {}, new URL('http://localhost/api/control/issues'))

    resolveMap.set(p0, proj1)
    resolveMap.set(wtLane0, otherProj2)

    appendFileSync(
      file,
      [
        JSON.stringify(buildRecord({ lane: 'lane0', project: p0, index: 2000, task: 'Cleared root match' })),
        JSON.stringify(buildRecord({ lane: 'lane0', project: otherProj, index: 2001, task: 'Cleared worktree match' })),
        JSON.stringify(buildRecord({ lane: 'lane0', project: pSpecial, index: 2002, task: 'Cleared worktree resolved' })),
      ].join('\n') + '\n'
    )

    await api.handle({ method: 'GET', headers: {} }, {}, new URL('http://localhost/api/control/issues'))
    const titles = answer.body.map((issue) => issue.title)
    expect(titles).toContain('Cleared root match')
    expect(titles).not.toContain('Cleared worktree match')
    expect(titles).toContain('Cleared worktree resolved')
    expect(resolveCounts.get(p0)).toBe(2)
    expect(resolveCounts.get(wtLane0)).toBe(2)
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
