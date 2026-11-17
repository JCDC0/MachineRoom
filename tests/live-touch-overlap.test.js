import { appendFileSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { userInfo } from 'node:os'
import { join } from 'node:path'
import { act, createElement } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { activeLanesFileFor, writeActiveLanes } from '../server/active-lanes.js'
import { createRunsApi } from '../server/runs.js'
import { laneLockText, summarizeRun } from '../src/briefs/run.js'
import DispatchPanel from '../src/ui/panels/DispatchPanel.jsx'
import { clearSplitRun, overlapCardLines, runningLaneFiles } from '../src/ui/panels/runs.js'
import { getJson, startLaneBridge, waitFor } from './helpers/bridge.js'
import { makeTempDir } from './helpers/tempRoot.js'
import { buttonWithText, settle, withDom } from './helpers/uiDom.js'

const cleanups = []

afterEach(async () => {
  vi.useRealTimers()
  clearSplitRun()
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
    expect(answer.body.running[0].touchedPartial).toBe(true)

    appendFileSync(join(runs, 'opencode-cap.log'), opencodeWriteLine('src/extra.js', 'w-extra'))
    await api.handle({ method: 'GET', headers: {} }, {}, new URL('http://127.0.0.1/api/control/runs'))
    const masked = answer.body.running[0].touched
    expect(masked.join('\n')).not.toContain(secretKey)
    expect(masked.join('\n')).not.toContain(userInfo().username)
    expect(masked[0]).toContain('[key]')
  })
})

async function typeInto(node, text) {
  await act(async () => {
    node.focus()
    node.dispatchEvent({ type: 'focusin', bubbles: true, cancelable: true })
    node.value = text
    node.dispatchEvent({ type: 'keyup', bubbles: true, cancelable: true })
  })
}

async function selectLane(node, value) {
  await act(async () => {
    node.value = value
    node.dispatchEvent({ type: 'change', bubbles: true, cancelable: true })
  })
}

const UI_AGENTS = [
  { id: 'agent-opencode', key: 'opencode', name: 'OpenCode', adapterType: 'opencode_local', role: null },
  { id: 'agent-opencode2', key: 'opencode2', name: 'OpenCode 2', adapterType: 'opencode_local', role: null },
]

describe('Dispatch live touched overlap warning', () => {
  it('shows Now editing in from a running lane log and still starts when confirmed', async () => {
    const rig = await setupRunRig({ logContent: opencodeWriteLine('src/a.js') })
    await startOtherTask(rig.url, 'opencode')

    await waitFor(async () => {
      const { body } = await getJson(`${rig.url}/api/control/runs`)
      return Array.isArray(body?.running?.[0]?.touched) && body.running[0].touched.length > 0
    }, { what: 'live touched path in bridge' })

    const pending = new Set()
    const track = (promise) => {
      pending.add(promise)
      return promise.finally(() => pending.delete(promise))
    }
    const startSpy = vi.fn((lane, body) =>
      track(
        getJson(`${rig.url}/api/control/runs`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', origin: rig.url },
          body: JSON.stringify({ lane, ...body, confirmed: true }),
        }).then((started) => {
          expect(started.status).toBe(202)
          return started.body
        })
      )
    )
    writeFileSync(
      join(rig.runs, 'opencode2.spec.json'),
      JSON.stringify({ logName: 'opencode2-project-test', logContent: '', release: rig.release })
    )
    const client = {
      health: async () => ({ lanes: true }),
      agents: async () => UI_AGENTS,
      runs: () => track(getJson(`${rig.url}/api/control/runs`).then((res) => res.body)),
      startRun: startSpy,
    }

    await withDom(async ({ container, root }) => {
      await act(async () => {
        root.render(createElement(DispatchPanel, { client, initialAgents: UI_AGENTS }))
      })
      await waitFor(async () => {
        await settle(15)
        return pending.size === 0 && container.textContent.includes('opencode')
      }, { what: 'initial Dispatch runs load' })

      await selectLane(container.querySelector('#project-run-lane'), 'opencode2')
      await typeInto(container.querySelector('#project-run-task'), 'Edit a.\n\nFiles: `src/a.js`.')
      await act(async () => {
        buttonWithText(container, 'Run').click()
      })
      await waitFor(async () => {
        await settle(15)
        return pending.size === 0
      }, { what: 'runs refresh on confirm' })

      expect(container.textContent).toContain('Now editing in opencode: src/a.js')
      expect(container.textContent).not.toContain('Also declared by opencode:')

      const confirmButton = buttonWithText(container, 'Confirm')
      expect(confirmButton.disabled).toBeFalsy()
      expect(confirmButton.hasAttribute('disabled')).toBe(false)
      await act(async () => {
        confirmButton.click()
      })
      await waitFor(async () => {
        await settle(15)
        return startSpy.mock.calls.length === 1 && pending.size === 0 && !buttonWithText(container, 'Starting')
      }, { what: 'confirm startRun to settle' })

      expect(startSpy).toHaveBeenCalledTimes(1)
      expect(startSpy.mock.calls[0][0]).toBe('opencode2')
    })
  })

  it('says a lane may be editing by shell when the log has shell calls the parser could not place', () => {
    const log = `${JSON.stringify({ type: 'tool_use', part: { id: 's1', tool: 'bash', state: { status: 'completed', input: { command: 'node build.mjs' } } } })}
`
    const summary = summarizeRun({ harness: 'opencode', log, worktree: 'project' })
    expect(summary.written).toEqual([])
    expect(summary.shellUnplaced).toBe(1)
    const lines = overlapCardLines({
      files: ['src/a.js'],
      active: runningLaneFiles([{ lane: 'opencode', briefs: [], task: 'Work.', touched: [], touchedPartial: true }], []),
    })
    expect(lines).toContain('opencode may also be editing by shell.')
  })

  it('omits Now editing in when the running lane only read the file or its log is unreadable', () => {
    const readOnlyLines = overlapCardLines({
      files: ['src/a.js'],
      active: runningLaneFiles([{ lane: 'opencode', briefs: [], task: 'Read.', touched: [] }], []),
      runningCount: 1,
      startingCount: 1,
      laneCountWarning: 0,
    })
    expect(readOnlyLines.join('\n')).not.toContain('Now editing in')

    const unreadableLines = overlapCardLines({
      files: ['src/a.js'],
      active: runningLaneFiles([{ lane: 'opencode', briefs: [], task: 'Work.', touched: null }], []),
      runningCount: 1,
      startingCount: 1,
      laneCountWarning: 0,
    })
    expect(unreadableLines.join('\n')).not.toContain('Now editing in')

    const noFilesLines = overlapCardLines({
      files: [],
      active: runningLaneFiles([{ lane: 'opencode', briefs: [], task: 'Work.', touched: ['src/a.js'] }], []),
      runningCount: 1,
      startingCount: 1,
      laneCountWarning: 0,
    })
    expect(noFilesLines).toContain('Overlap unknown: this task names no files.')
    expect(noFilesLines.join('\n')).not.toContain('Now editing in')
  })

  it('refreshes runs when opening confirm so newly touched files show up', async () => {
    let calls = 0
    const client = {
      health: async () => ({ lanes: true }),
      agents: async () => UI_AGENTS,
      runs: async () => {
        calls += 1
        return {
          running: [
            {
              lane: 'opencode2',
              briefs: [],
              startedAt: '2026-11-17T03:00:00.000Z',
              lastLines: [],
              touched: calls === 1 ? [] : ['src/a.js'],
              task: 'Other task.',
            },
          ],
          recent: [],
          project: 'demo-refresh-confirm',
        }
      },
      startRun: async () => ({ lane: 'opencode' }),
    }

    await withDom(async ({ container, root }) => {
      await act(async () => {
        root.render(createElement(DispatchPanel, { client, initialAgents: UI_AGENTS }))
      })
      await settle(20)

      await selectLane(container.querySelector('#project-run-lane'), 'opencode')
      await typeInto(container.querySelector('#project-run-task'), 'Edit a.\n\nFiles: `src/a.js`.')
      await act(async () => {
        buttonWithText(container, 'Run').click()
      })
      await settle(20)

      expect(container.textContent).toContain('Now editing in opencode2: src/a.js')
    })
  })
})
