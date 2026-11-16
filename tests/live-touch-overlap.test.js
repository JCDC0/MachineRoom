import { appendFileSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { userInfo } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { activeLanesFileFor, writeActiveLanes } from '../server/active-lanes.js'
import { createRunsApi } from '../server/runs.js'
import { laneLockText, summarizeRun } from '../src/briefs/run.js'
import { getJson, startLaneBridge, waitFor } from './helpers/bridge.js'
import { makeTempDir } from './helpers/tempRoot.js'

const cleanups = []

afterEach(async () => {
  while (cleanups.length > 0) {
    const fn = cleanups.pop()
    try {
      await fn()
    } catch {}
  }
})

function tempDir(prefix = 'mr-live-touch-') {
  const dir = makeTempDir(prefix)
  cleanups.push(() => rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }))
  return dir
}

const TEST_LANES = {
  opencode: {
    name: 'OpenCode',
    harness: 'OpenCode',
    cli: { harness: 'opencode', bin: 'opencode', model: 'opencode-go/deepseek-v4.1-flash' },
  },
  opencode2: {
    name: 'OpenCode 2',
    harness: 'OpenCode',
    cli: { harness: 'opencode', bin: 'opencode', model: 'opencode-go/deepseek-v4.1-flash' },
  },
}

function opencodeWriteLine(path, id = 'w1') {
  return `${JSON.stringify({
    type: 'tool_use',
    part: { id, tool: 'write', state: { status: 'completed', input: { filePath: path } } },
  })}\n`
}

function opencodeReadLine(path, id = 'r1') {
  return `${JSON.stringify({
    type: 'tool_use',
    part: { id, tool: 'read', state: { status: 'completed', input: { filePath: path } } },
  })}\n`
}

function writeHoldRunner(dir) {
  const path = join(dir, 'hold-runner.mjs')
  writeFileSync(
    path,
    [
      "import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'",
      "import { join } from 'node:path'",
      'const args = process.argv.slice(2)',
      'if (args[0] === "--stop") process.exit(0)',
      'const lane = args[0]',
      'const argValue = (flag) => { const at = args.indexOf(flag); return at === -1 ? "" : args[at + 1] ?? "" }',
      'const startedAt = argValue("--started-at")',
      'const project = argValue("--project")',
      'const runs = process.env.MACHINEROOM_RUNS',
      'mkdirSync(runs, { recursive: true })',
      'const spec = JSON.parse(readFileSync(join(runs, `${lane}.spec.json`), "utf8"))',
      'const runName = spec.logName',
      'if (spec.writeMeta !== false) writeFileSync(join(runs, `${runName}.meta.json`), JSON.stringify({ lane, project }))',
      'if (spec.writeLog !== false) writeFileSync(join(runs, `${runName}.log`), spec.logContent ?? "")',
      'if (spec.dirAsLog === true) mkdirSync(join(runs, `${runName}.log`), { recursive: true })',
      'if (spec.writeLock !== false) {',
      '  const entry = { pid: process.pid, folder: project, startedAt, log: `${runName}.log` }',
      '  writeFileSync(join(runs, `${lane}.lock`), JSON.stringify(entry) + "\\n")',
      '}',
      'const release = spec.release',
      'while (!existsSync(release)) await new Promise((done) => setTimeout(done, 25))',
    ].join('\n')
  )
  return path
}

async function setupRunRig({ logName = 'opencode-project-test', logContent = '', writeLog = true, dirAsLog = false, writeLock = true } = {}) {
  const base = tempDir('mr-live-touch-rig-')
  const project = join(base, 'project')
  const runs = join(base, 'runs')
  const briefsDir = join(base, 'briefs')
  const release = join(base, 'release')
  mkdirSync(project, { recursive: true })
  mkdirSync(runs, { recursive: true })
  mkdirSync(briefsDir, { recursive: true })
  const lanesFile = join(briefsDir, 'lanes.json')
  writeFileSync(lanesFile, JSON.stringify(TEST_LANES))
  writeActiveLanes(activeLanesFileFor(project, runs), Object.keys(TEST_LANES))
  writeFileSync(
    join(runs, 'opencode.spec.json'),
    JSON.stringify({ logName, logContent, writeLog, dirAsLog, writeLock, release })
  )
  const runnerPath = writeHoldRunner(base)
  const started = await startLaneBridge({
    projectRoot: project,
    runsDir: runs,
    lanes: TEST_LANES,
    bridge: {
      briefsDir,
      lanesFile,
      runsFolder: runs,
      runnerCommand: { file: process.execPath, args: [runnerPath] },
    },
  })
  cleanups.push(async () => {
    writeFileSync(release, 'done')
    await started.stop()
  })
  return { ...started, base, project, runs, release, lanesFile }
}

async function startOtherTask(url, lane = 'opencode') {
  const res = await getJson(`${url}/api/control/runs`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: url },
    body: JSON.stringify({ lane, task: 'Other task without files.', confirmed: true }),
  })
  expect(res.status).toBe(202)
  return res.body
}

describe('live touched files in GET /api/control/runs', () => {
  it('returns project-relative paths written in the running lane live log', async () => {
    const logContent = opencodeWriteLine('src/a.js')
    const rig = await setupRunRig({ logContent })
    await startOtherTask(rig.url, 'opencode')

    const state = await waitFor(async () => {
      const { body } = await getJson(`${rig.url}/api/control/runs`)
      const entry = body?.running?.[0]
      return entry && Array.isArray(entry.touched) && entry.touched.length > 0 ? body : null
    }, { what: 'live touched path in GET /api/control/runs' })

    expect(state.running[0].touched).toEqual(['src/a.js'])
  })

  it('returns an empty touched list when the live log only read files', async () => {
    const rig = await setupRunRig({ logContent: opencodeReadLine('src/a.js') })
    await startOtherTask(rig.url, 'opencode')

    const state = await waitFor(async () => {
      const { body } = await getJson(`${rig.url}/api/control/runs`)
      return Array.isArray(body?.running?.[0]?.touched) ? body : null
    }, { what: 'empty touched array for read-only log' })

    expect(state.running[0].touched).toEqual([])
  })

  it('returns touched: null when the log is missing, unreadable or over 8 MB', async () => {
    const rig = await setupRunRig({ writeLog: false })
    await startOtherTask(rig.url, 'opencode')

    const missingState = await waitFor(async () => {
      const { body } = await getJson(`${rig.url}/api/control/runs`)
      return body?.running?.length === 1 && 'touched' in body.running[0] ? body : null
    }, { what: 'touched: null for missing log' })

    expect(missingState.running[0].touched).toBeNull()

    const largeBase = tempDir('mr-live-touch-large-')
    const largeRuns = join(largeBase, 'runs')
    const largeProject = join(largeBase, 'project')
    const largeBriefs = join(largeBase, 'briefs')
    const largeRelease = join(largeBase, 'release')
    mkdirSync(largeRuns, { recursive: true })
    mkdirSync(largeProject, { recursive: true })
    mkdirSync(largeBriefs, { recursive: true })
    const largeLanesFile = join(largeBriefs, 'lanes.json')
    writeFileSync(largeLanesFile, JSON.stringify(TEST_LANES))
    writeActiveLanes(activeLanesFileFor(largeProject, largeRuns), ['opencode'])
    const largeRunner = writeHoldRunner(largeBase)
    const summarizeSpy = vi.fn(summarizeRun)
    let answer = null
    const api = createRunsApi({
      projectRoot: largeProject,
      briefsDir: largeBriefs,
      lanesFile: largeLanesFile,
      runsFolder: largeRuns,
      runnerCommand: { file: process.execPath, args: [largeRunner] },
      activeLanes: { isChosen: () => true, isLaneActive: () => true, isLaneHidden: () => false },
      summarize: summarizeSpy,
      sendJson: (_req, _res, status, body) => {
        answer = { status, body }
      },
      readJsonBody: async () => ({ lane: 'opencode', task: 'Work.', allowDirty: true, confirmed: true }),
    })
    cleanups.push(() => {
      writeFileSync(largeRelease, 'done')
      api.stopAll()
    })

    const logName = 'opencode-large'
    writeFileSync(
      join(largeRuns, 'opencode.spec.json'),
      JSON.stringify({ logName, dirAsLog: true, writeLog: false, release: largeRelease })
    )
    await api.handle({ method: 'POST', headers: { origin: 'http://localhost:5173' } }, {}, new URL('http://127.0.0.1/api/control/runs'))
    await waitFor(async () => {
      await api.handle({ method: 'GET', headers: {} }, {}, new URL('http://127.0.0.1/api/control/runs'))
      return answer?.body?.running?.length === 1
    }, { what: 'dirAsLog running entry' })
    expect(answer.body.running[0].touched).toBeNull()
    expect(summarizeSpy).not.toHaveBeenCalled()

    const bigLog = join(largeRuns, 'opencode-over8mb.log')
    writeFileSync(bigLog, `${opencodeWriteLine('src/a.js')}${'x'.repeat(8 * 1024 * 1024 + 1)}`)
    const lockText = laneLockText({ pid: process.pid, folder: largeProject, startedAt: answer.body.running[0].startedAt, log: 'opencode-over8mb.log' })
    writeFileSync(join(largeRuns, 'opencode.lock'), lockText)

    await api.handle({ method: 'GET', headers: {} }, {}, new URL('http://127.0.0.1/api/control/runs'))
    expect(answer.body.running[0].touched).toBeNull()
    expect(summarizeSpy).not.toHaveBeenCalled()
  })

  it('reuses one parse per log while size and modified time are unchanged', async () => {
    const base = tempDir('mr-live-touch-cache-')
    const project = join(base, 'project')
    const runs = join(base, 'runs')
    const briefsDir = join(base, 'briefs')
    const release = join(base, 'release')
    mkdirSync(project, { recursive: true })
    mkdirSync(runs, { recursive: true })
    mkdirSync(briefsDir, { recursive: true })
    const lanesFile = join(briefsDir, 'lanes.json')
    writeFileSync(lanesFile, JSON.stringify(TEST_LANES))
    writeActiveLanes(activeLanesFileFor(project, runs), ['opencode'])
    const runner = writeHoldRunner(base)
    const logName = 'opencode-cached'
    writeFileSync(
      join(runs, 'opencode.spec.json'),
      JSON.stringify({ logName, logContent: opencodeWriteLine('src/a.js'), release })
    )

    const summarizeSpy = vi.fn(summarizeRun)
    let answer = null
    const api = createRunsApi({
      projectRoot: project,
      briefsDir,
      lanesFile,
      runsFolder: runs,
      runnerCommand: { file: process.execPath, args: [runner] },
      activeLanes: { isChosen: () => true, isLaneActive: () => true, isLaneHidden: () => false },
      summarize: summarizeSpy,
      sendJson: (_req, _res, status, body) => {
        answer = { status, body }
      },
      readJsonBody: async () => ({ lane: 'opencode', task: 'Work.', allowDirty: true, confirmed: true }),
    })
    cleanups.push(() => {
      writeFileSync(release, 'done')
      api.stopAll()
    })

    await api.handle({ method: 'POST', headers: { origin: 'http://localhost:5173' } }, {}, new URL('http://127.0.0.1/api/control/runs'))
    const logPath = join(runs, `${logName}.log`)
    await waitFor(async () => {
      await api.handle({ method: 'GET', headers: {} }, {}, new URL('http://127.0.0.1/api/control/runs'))
      return Array.isArray(answer?.body?.running?.[0]?.touched)
    }, { what: 'cached touched path' })

    expect(answer.body.running[0].touched).toEqual(['src/a.js'])
    expect(summarizeSpy).toHaveBeenCalledTimes(1)

    await api.handle({ method: 'GET', headers: {} }, {}, new URL('http://127.0.0.1/api/control/runs'))
    await api.handle({ method: 'GET', headers: {} }, {}, new URL('http://127.0.0.1/api/control/runs'))
    expect(summarizeSpy).toHaveBeenCalledTimes(1)
    expect(answer.body.running[0].touched).toEqual(['src/a.js'])

    appendFileSync(logPath, opencodeWriteLine('src/b.js', 'w2'))
    await api.handle({ method: 'GET', headers: {} }, {}, new URL('http://127.0.0.1/api/control/runs'))
    expect(summarizeSpy).toHaveBeenCalledTimes(2)
    expect(answer.body.running[0].touched).toEqual(['src/a.js', 'src/b.js'])

    await api.handle({ method: 'GET', headers: {} }, {}, new URL('http://127.0.0.1/api/control/runs'))
    expect(summarizeSpy).toHaveBeenCalledTimes(2)
  })

  it('caps touched at 50 paths and masks keys and home paths', async () => {
    const base = tempDir('mr-live-touch-mask-')
    const project = join(base, 'project')
    const runs = join(base, 'runs')
    const briefsDir = join(base, 'briefs')
    const release = join(base, 'release')
    mkdirSync(project, { recursive: true })
    mkdirSync(runs, { recursive: true })
    mkdirSync(briefsDir, { recursive: true })
    const lanesFile = join(briefsDir, 'lanes.json')
    writeFileSync(lanesFile, JSON.stringify(TEST_LANES))
    writeActiveLanes(activeLanesFileFor(project, runs), ['opencode'])
    const runner = writeHoldRunner(base)
    const manyLines = Array.from({ length: 55 }, (_, i) =>
      opencodeWriteLine(`src/f${String(i + 1).padStart(2, '0')}.js`, `w-${i}`)
    ).join('')
    writeFileSync(join(runs, 'opencode.spec.json'), JSON.stringify({ logName: 'opencode-cap', logContent: manyLines, release }))

    const secretKey = 'sk-proj-' + 'abcdef0123456789'.repeat(2)
    const runtimeHome = join('C:\\', 'Users', userInfo().username, 'secret.js')
    const summarizeSpy = vi
      .fn()
      .mockImplementationOnce((input) => summarizeRun(input))
      .mockImplementationOnce(() => ({
        harness: 'opencode',
        toolCalls: 2,
        failed: 0,
        written: [`src/${secretKey}.js`, runtimeHome],
        read: [],
        head: [],
        costUsd: null,
        inputTokens: null,
        outputTokens: null,
        peakTokens: null,
      }))

    let answer = null
    const api = createRunsApi({
      projectRoot: project,
      briefsDir,
      lanesFile,
      runsFolder: runs,
      runnerCommand: { file: process.execPath, args: [runner] },
      activeLanes: { isChosen: () => true, isLaneActive: () => true, isLaneHidden: () => false },
      summarize: summarizeSpy,
      sendJson: (_req, _res, status, body) => {
        answer = { status, body }
      },
      readJsonBody: async () => ({ lane: 'opencode', task: 'Work.', allowDirty: true, confirmed: true }),
    })
    cleanups.push(() => {
      writeFileSync(release, 'done')
      api.stopAll()
    })

    await api.handle({ method: 'POST', headers: { origin: 'http://localhost:5173' } }, {}, new URL('http://127.0.0.1/api/control/runs'))
    await waitFor(async () => {
      await api.handle({ method: 'GET', headers: {} }, {}, new URL('http://127.0.0.1/api/control/runs'))
      return Array.isArray(answer?.body?.running?.[0]?.touched)
    }, { what: '50-path cap answer' })

    expect(answer.body.running[0].touched).toHaveLength(50)

    appendFileSync(join(runs, 'opencode-cap.log'), opencodeWriteLine('src/extra.js', 'w-extra'))
    await api.handle({ method: 'GET', headers: {} }, {}, new URL('http://127.0.0.1/api/control/runs'))
    const masked = answer.body.running[0].touched
    expect(masked.join('\n')).not.toContain(secretKey)
    expect(masked.join('\n')).not.toContain(userInfo().username)
    expect(masked[0]).toContain('[key]')
  })
})
