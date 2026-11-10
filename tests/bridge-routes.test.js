import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { connect } from 'node:net'
import { basename, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { extractReplyText } from '../server/assistant.js'
import { SINCE_PROBLEM } from '../src/briefs/run.js'
import { createClient } from '../src/control/client.js'
import { choice } from '../src/decider/wire.js'
import { startFakeDecisions } from './fakeDecisions.js'
import { getJson, postJson, startLaneBridge, waitFor } from './helpers/bridge.js'
import { makeTempDir } from './helpers/tempRoot.js'

const KEY = 'sk-or-v1-' + '0123456789abcdef'.repeat(4)
const REPO_ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)))
const RUN_ROOM = join(REPO_ROOT, 'docs', 'agents')
const cleanups = []

afterEach(async () => {
  while (cleanups.length > 0) {
    const cleanup = cleanups.pop()
    try {
      await cleanup()
    } catch {}
  }
})

function tempDir(prefix = 'mr-bridge-routes-') {
  const dir = makeTempDir(prefix)
  cleanups.push(() => rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }))
  return dir
}

async function laneBridge(options = {}) {
  const started = await startLaneBridge(options)
  cleanups.push(() => started.stop())
  return started
}

describe('the assistant route', () => {
  async function startAssistantBridge(options = {}) {
    const started = await laneBridge({ projectRoot: tempDir(), bridge: options })
    return { url: started.url }
  }

  function assistantPost(url, body, headers = {}) {
    return fetch(`${url}/api/assistant`, {
      method: 'POST',
      headers: { Origin: new URL(url).origin, 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify({ confirmed: true, ...body }),
    })
  }

  it('calls the runner with the default model and 8s timeout and returns the text', async () => {
    const calls = []
    const { url } = await startAssistantBridge({
      env: {},
      assistantRunner: async (input) => {
        calls.push(input)
        return '{"type":"overview","say":"Going to overview."}'
      },
    })

    const res = await assistantPost(url, { prompt: 'show the whole room' })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ text: '{"type":"overview","say":"Going to overview."}' })
    expect(calls).toEqual([
      {
        model: 'opencode/deepseek-v4.1-flash-free',
        prompt: 'show the whole room',
        timeoutMs: 8000,
      },
    ])
  })

  it('refuses a request with no Origin and with no owner confirm', async () => {
    const { url } = await startAssistantBridge({
      env: {},
      assistantRunner: async () => 'ok',
    })

    const noOrigin = await fetch(`${url}/api/assistant`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: 'hello', confirmed: true }),
    })
    expect(noOrigin.status).toBe(403)
    expect(await noOrigin.json()).toEqual({ error: 'Only the owner can run the assistant.' })

    const noConfirm = await fetch(`${url}/api/assistant`, {
      method: 'POST',
      headers: { Origin: new URL(url).origin, 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: 'hello' }),
    })
    expect(noConfirm.status).toBe(400)
    expect(await noConfirm.json()).toEqual({ error: 'The owner must confirm the assistant run first.' })
  })

  it('accepts application/json with a charset parameter', async () => {
    const { url } = await startAssistantBridge({
      env: {},
      assistantRunner: async () => 'ok',
    })

    const res = await assistantPost(url, { prompt: 'hello' }, { 'Content-Type': 'application/json; charset=utf-8' })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ text: 'ok' })
  })

  it('answers 415 when application/json appears only after the semicolon', async () => {
    const { url } = await startAssistantBridge({
      env: {},
      assistantRunner: async () => 'should not run',
    })

    const res = await assistantPost(url, { prompt: 'hello' }, { 'Content-Type': 'text/plain; x=application/json' })
    expect(res.status).toBe(415)
    expect(await res.json()).toEqual({ error: 'Send JSON.' })
  })

  it('answers 413 to a 100 KB body and closes the connection before the rest is sent', async () => {
    const { url } = await startAssistantBridge({
      env: {},
      assistantRunner: async () => 'should not run',
    })
    const target = new URL(url)
    const body = 'x'.repeat(100 * 1024)
    const first = body.slice(0, 70 * 1024)
    const rest = body.slice(70 * 1024)
    const socket = connect(Number(target.port), target.hostname)
    cleanups.push(() => socket.destroy())
    socket.setEncoding('utf8')
    let text = ''
    socket.on('data', (chunk) => {
      text += chunk
    })
    const closed = new Promise((resolveClose) => socket.on('close', resolveClose))
    await new Promise((resolveOpen, rejectOpen) => {
      socket.on('connect', resolveOpen)
      socket.on('error', rejectOpen)
    })
    socket.write(`POST /api/assistant HTTP/1.1\r\nHost: ${target.host}\r\nOrigin: ${target.origin}\r\nContent-Type: application/json\r\nConnection: keep-alive\r\nContent-Length: ${body.length}\r\n\r\n`)
    socket.write(first)
    await closed

    expect(rest).toHaveLength(30 * 1024)
    expect(text).toContain('HTTP/1.1 413')
    expect(text).toMatch(/connection: close/i)
    expect(text).toContain('That request is too large.')
    expect(socket.destroyed).toBe(true)
  })

  it('reads the model from ASSISTANT_MODEL or the settings file and answers 404 when no model is set', async () => {
    const dir = tempDir()
    const settingsPath = join(dir, 'settings.json')
    writeFileSync(settingsPath, JSON.stringify({ assistantModel: 'opencode/glm-5.3-flash-free' }))

    const seenModels = []
    const { url: fromFileUrl } = await startAssistantBridge({
      env: {},
      settingsFile: settingsPath,
      assistantRunner: async ({ model }) => {
        seenModels.push(model)
        return 'ok'
      },
    })

    const fileRes = await assistantPost(fromFileUrl, { prompt: 'hello' })
    expect(fileRes.status).toBe(200)
    expect(seenModels).toEqual(['opencode/glm-5.3-flash-free'])

    const { url: disabledUrl } = await startAssistantBridge({
      env: { ASSISTANT_MODEL: 'none' },
      assistantRunner: async () => 'should not run',
    })
    const offRes = await assistantPost(disabledUrl, { prompt: 'hello' })
    expect(offRes.status).toBe(404)
    const offBody = await offRes.json()
    expect(offBody.error).toMatch(/no assistant model/i)
  })

  it('enforces local origins, POST method, 2000 character prompt limit and runner failures', async () => {
    const { url } = await startAssistantBridge({
      env: {},
      assistantRunner: async () => {
        throw new Error('timed out')
      },
    })

    const evil = await fetch(`${url}/api/assistant`, {
      method: 'POST',
      headers: { Origin: 'https://evil.example', 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: 'hi' }),
    })
    expect(evil.status).toBe(403)

    const getRes = await fetch(`${url}/api/assistant`)
    expect(getRes.status).toBe(405)

    const emptyRes = await assistantPost(url, { prompt: '   ' })
    expect(emptyRes.status).toBe(400)

    const longRes = await assistantPost(url, { prompt: 'a'.repeat(2001) })
    expect(longRes.status).toBe(400)
    expect((await longRes.json()).error).toMatch(/2000/)

    const failRes = await assistantPost(url, { prompt: 'valid prompt' })
    expect(failRes.status).toBe(502)
    expect(await failRes.json()).toEqual({ error: 'The helper model is not reachable.' })
  })

  it('extracts text from opencode JSON lines and plain JSON replies', () => {
    const jsonl = [
      '{"type":"step_start","part":{"type":"step-start"}}',
      '{"type":"text","part":{"type":"text","text":"{\\"type\\":\\"overview\\","}}',
      '{"type":"text","part":{"type":"text","text":"\\"say\\":\\"Done.\\"}"}}',
    ].join('\n')
    expect(extractReplyText(jsonl)).toBe('{"type":"overview","say":"Done."}')
    expect(extractReplyText('{"text":"hello"}')).toBe('hello')
  })
})

describe('briefs routes', () => {
  function writeBriefFixture(rootDir, briefsSubdir = join(rootDir, 'docs', 'agents')) {
    mkdirSync(briefsSubdir, { recursive: true })
    writeFileSync(join(rootDir, 'package.json'), JSON.stringify({ name: 'sample', version: '0.1.36' }))
    writeFileSync(
      join(briefsSubdir, 'TASKS.md'),
      [
        '## Next',
        '',
        '**C3e. HUD polish (AGY).** Move the assistant window.',
        '',
        '**T1b. Briefs menu in the dispatch panel (AGY).** Add a Brief menu.',
      ].join('\n')
    )
    writeFileSync(
      join(briefsSubdir, 'HOUSE-RULES.md'),
      ['## About', 'Sample viewer.', '## Rules', '- Never push.', '## Report', 'Report in your reply.'].join('\n')
    )
    writeFileSync(
      join(briefsSubdir, 'lanes.json'),
      JSON.stringify({
        agy: {
          name: 'agy',
          harness: 'agy',
          model: 'Gemini 3.8 Flash (High)',
          models: { C3e: 'Gemini 4 Argon', T1b: 'Gemini 4 Argon' },
          worktree: 'C:\\GitHub\\MachineRoom-agy',
          role: 'You own the HUD.',
          forbidden: ['server/**'],
          notes: [],
        },
      })
    )
  }

  it('serves briefs and builds a prompt for multiple ids from the project briefs folder', async () => {
    const dir = tempDir()
    writeBriefFixture(dir)
    const { url } = await laneBridge({ projectRoot: dir })

    const listRes = await fetch(`${url}/api/control/briefs`)
    expect(listRes.status).toBe(200)
    const { briefs } = await listRes.json()
    expect(briefs.map((brief) => brief.id)).toEqual(['C3e', 'T1b'])

    const promptRes = await fetch(`${url}/api/control/brief-prompt?ids=C3e,T1b&lane=agy`)
    expect(promptRes.status).toBe(200)
    const built = await promptRes.json()
    expect(built.lane).toBe('agy')
    expect(built.model).toBe('Gemini 4 Argon')
    expect(built.branch).toBe('feat/c3e-hud-polish')
    expect(built.prompt).toContain('Task C3e: HUD polish.')
    expect(built.prompt).toContain('Task T1b: Briefs menu in the dispatch panel.')
    expect(built.prompt).toContain('with the prefix 0.1.37 and one plain sentence')
  })

  it('answers an empty list or 404 with no path when files are missing, and 400 for an unknown lane or id', async () => {
    const emptyDir = tempDir()
    const { url: emptyUrl } = await laneBridge({ projectRoot: emptyDir })

    const missingList = await fetch(`${emptyUrl}/api/control/briefs`)
    expect(missingList.status).toBe(200)
    expect(await missingList.json()).toEqual({ briefs: [] })

    const missingPrompt = await fetch(`${emptyUrl}/api/control/brief-prompt?ids=C3e&lane=agy`)
    expect(missingPrompt.status).toBe(404)
    const missingBody = await missingPrompt.json()
    expect(missingBody.error).toMatch(/missing/i)
    expect(missingBody.error).not.toContain(emptyDir)
    expect(missingBody.error).not.toMatch(/[/\\]|TASKS\.md|HOUSE-RULES|lanes\.json|package\.json/)

    const customRoot = tempDir()
    const customBriefs = tempDir()
    writeBriefFixture(customRoot, customBriefs)
    const { url: customUrl } = await laneBridge({ projectRoot: customRoot, bridge: { briefsDir: customBriefs } })

    const badId = await fetch(`${customUrl}/api/control/brief-prompt?ids=NOPE&lane=agy`)
    expect(badId.status).toBe(400)

    const badLane = await fetch(`${customUrl}/api/control/brief-prompt?ids=C3e&lane=nobody`)
    expect(badLane.status).toBe(400)

    const badMethod = await fetch(`${customUrl}/api/control/briefs`, { method: 'POST' })
    expect(badMethod.status).toBe(405)

    const badOrigin = await fetch(`${customUrl}/api/control/briefs`, { headers: { Origin: 'https://evil.example' } })
    expect(badOrigin.status).toBe(403)
  })
})

const TINY_RUNNER = [
  "import { appendFileSync, mkdirSync } from 'node:fs'",
  "import { tmpdir } from 'node:os'",
  "import { join } from 'node:path'",
  'const args = process.argv.slice(2)',
  "console.log('args ' + args.join(' '))",
  "for (let i = 1; i <= 7; i += 1) console.log('line ' + i)",
  'await new Promise((done) => setTimeout(done, 300))',
  "const folder = join(process.env.TEMP || tmpdir(), 'machineroom-runs')",
  "mkdirSync(folder, { recursive: true })",
  'const briefs = []',
  'for (let i = 1; i < args.length; i += 1) {',
  "  if (args[i] === '--started-by') { i += 1; continue }",
  '  briefs.push(args[i])',
  '}',
  "const record = { lane: args[0], briefs, model: null, reasoning: null, startedAt: new Date().toISOString(), minutes: 0, exitCode: 0, killed: false, costUsd: null, log: null, branch: '', commits: [] }",
  "appendFileSync(join(folder, 'runs.jsonl'), JSON.stringify(record) + '\\n')",
].join('\n')

const TINY_SLEEPER = [
  "console.log('pid ' + process.pid)",
  "console.log('sleeping')",
  'setTimeout(() => {}, 60000)',
].join('\n')

function statsRecord({ lane, model = 'deepseek/v4.1-flash-1017', startedAt, minutes, costUsd = null, exitCode = 0 }) {
  return JSON.stringify({ lane, model, startedAt, minutes, exitCode, killed: false, costUsd })
}

const EMPTY_STATS = {
  rows: [],
  total: {
    lane: 'all',
    model: 'all',
    runs: 0,
    finished: 0,
    killed: 0,
    failed: 0,
    minutesTotal: 0,
    minutesMedian: 0,
    costTotal: 0,
    costRuns: 0,
  },
}

describe('run routes', () => {
  function writeRunsProject(dir) {
    const agents = join(dir, 'docs', 'agents')
    mkdirSync(agents, { recursive: true })
    writeFileSync(
      join(agents, 'TASKS.md'),
      ['**B6. Late join replay (OpenCode).** Let the event stream send history.', '', '**C3e. HUD polish (AGY).** Move the assistant window.'].join('\n')
    )
    writeFileSync(
      join(agents, 'lanes.json'),
      JSON.stringify({
        hermes: { name: 'Hermes', harness: 'Hermes', retired: true, cli: { harness: 'hermes', bin: 'hermes.exe', model: 'deepseek/deepseek-v4.1-flash-1017' } },
        opencode: { name: 'OpenCode', harness: 'OpenCode', cli: { harness: 'opencode', bin: 'opencode.exe', model: 'opencode-go/mimo-v2.6-pro' } },
        opencode2: { name: 'OpenCode 2', harness: 'OpenCode', cli: { harness: 'opencode', bin: 'opencode.exe', model: 'opencode-go/mimo-v2.6-pro' } },
        agy: { name: 'agy', harness: 'agy' },
      })
    )
  }

  function useRunsTemp() {
    const dir = tempDir()
    const previous = process.env.TEMP
    const previousRuns = process.env.MACHINEROOM_RUNS
    process.env.TEMP = dir
    process.env.MACHINEROOM_RUNS = join(dir, 'machineroom-runs')
    cleanups.push(() => {
      process.env.TEMP = previous
      if (previousRuns === undefined) delete process.env.MACHINEROOM_RUNS
      else process.env.MACHINEROOM_RUNS = previousRuns
    })
    return dir
  }

  function writeRuns(folder, lines) {
    const runs = join(folder, 'machineroom-runs')
    mkdirSync(runs, { recursive: true })
    writeFileSync(join(runs, 'runs.jsonl'), `${lines.join('\n')}\n`)
  }

  function tokenPost(url, body, token = '') {
    return getJson(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(token ? { 'X-MachineRoom-Orchestrator': token } : {}),
      },
      body: JSON.stringify(body),
    })
  }

  async function startRunsBridge({ script = TINY_RUNNER, project = true } = {}) {
    const dir = tempDir()
    if (project) writeRunsProject(dir)
    const runnerPath = join(tempDir(), 'tiny-runner.mjs')
    writeFileSync(runnerPath, script)
    const started = await laneBridge({
      projectRoot: RUN_ROOM,
      runsDir: tempDir(),
      bridge: {
        briefsDir: join(dir, 'docs', 'agents'),
        runnerCommand: { file: process.execPath, args: [runnerPath] },
        env: {},
      },
    })
    const token = started.bridge.orchestrators()?.token('orchestrator') ?? ''
    return { url: started.url, dir, bridge: started.bridge, token }
  }

  it('answers lane totals over every record, not just the last 20', async () => {
    const tempDirRuns = useRunsTemp()
    const { url } = await startRunsBridge()
    const lines = []
    for (let i = 1; i <= 24; i += 1) {
      lines.push(
        statsRecord({
          lane: i <= 20 ? 'hermes' : 'opencode',
          startedAt: `2026-10-${String(i).padStart(2, '0')}T12:00:00.000Z`,
          minutes: 2,
          costUsd: 0.5,
        })
      )
    }
    writeRuns(tempDirRuns, lines)

    const res = await fetch(`${url}/api/control/runs/stats`)
    expect(res.status).toBe(200)
    const stats = await res.json()
    expect(stats.rows).toEqual([
      {
        lane: 'hermes',
        model: 'deepseek/v4.1-flash-1017',
        runs: 20,
        finished: 20,
        killed: 0,
        failed: 0,
        minutesTotal: 40,
        minutesMedian: 2,
        costTotal: 10,
        costRuns: 20,
      },
      {
        lane: 'opencode',
        model: 'deepseek/v4.1-flash-1017',
        runs: 4,
        finished: 4,
        killed: 0,
        failed: 0,
        minutesTotal: 8,
        minutesMedian: 2,
        costTotal: 2,
        costRuns: 4,
      },
    ])
    expect(stats.total).toEqual({
      lane: 'all',
      model: 'all',
      runs: 24,
      finished: 24,
      killed: 0,
      failed: 0,
      minutesTotal: 48,
      minutesMedian: 2,
      costTotal: 12,
      costRuns: 24,
    })
  })

  it('keeps the runs since a day and refuses a bad day with the runner sentence', async () => {
    const tempDirRuns = useRunsTemp()
    const { url } = await startRunsBridge()
    writeRuns(tempDirRuns, [
      statsRecord({ lane: 'hermes', startedAt: '2026-10-18T23:59:59.999Z', minutes: 1, costUsd: 1 }),
      statsRecord({ lane: 'hermes', startedAt: '2026-10-19T00:00:00.000Z', minutes: 2, costUsd: 2 }),
      statsRecord({ lane: 'opencode', model: 'other/model', startedAt: '2026-10-20T08:00:00.000Z', minutes: 3, costUsd: 3 }),
    ])

    const res = await fetch(`${url}/api/control/runs/stats?since=2026-10-19`)
    expect(res.status).toBe(200)
    const stats = await res.json()
    expect(stats.rows.map((row) => [row.lane, row.model, row.runs, row.costTotal])).toEqual([
      ['hermes', 'deepseek/v4.1-flash-1017', 1, 2],
      ['opencode', 'other/model', 1, 3],
    ])
    expect(stats.total).toMatchObject({ runs: 2, minutesTotal: 5, costTotal: 5 })

    const none = await fetch(`${url}/api/control/runs/stats?since=2026-10-21`).then((response) => response.json())
    expect(none).toEqual(EMPTY_STATS)

    const bad = await fetch(`${url}/api/control/runs/stats?since=2026-02-30`)
    expect(bad.status).toBe(400)
    expect(await bad.json()).toEqual({ error: SINCE_PROBLEM })

    const wrongMethod = await fetch(`${url}/api/control/runs/stats`, { method: 'POST' })
    expect(wrongMethod.status).toBe(405)
  })

  it('answers the empty result for a missing or empty file and skips junk lines', async () => {
    const tempDirRuns = useRunsTemp()
    const { url } = await startRunsBridge()

    const missing = await fetch(`${url}/api/control/runs/stats`)
    expect(missing.status).toBe(200)
    expect(await missing.json()).toEqual(EMPTY_STATS)

    const folder = join(tempDirRuns, 'machineroom-runs')
    mkdirSync(folder, { recursive: true })
    writeFileSync(join(folder, 'runs.jsonl'), '')
    const empty = await fetch(`${url}/api/control/runs/stats`)
    expect(empty.status).toBe(200)
    expect(await empty.json()).toEqual(EMPTY_STATS)

    writeRuns(tempDirRuns, [
      statsRecord({ lane: 'hermes', startedAt: '2026-10-19T09:00:00.000Z', minutes: 4, costUsd: 1 }),
      'not json at all',
      '{ "lane": ',
      statsRecord({ lane: 'hermes', startedAt: '2026-10-19T10:00:00.000Z', minutes: 6, costUsd: 2 }),
      'null',
      '[]',
      JSON.stringify({ lane: '', startedAt: '2026-10-19T11:00:00.000Z', minutes: 9, costUsd: 9 }),
    ])
    const stats = await fetch(`${url}/api/control/runs/stats`).then((response) => response.json())
    expect(stats.rows).toEqual([
      {
        lane: 'hermes',
        model: 'deepseek/v4.1-flash-1017',
        runs: 2,
        finished: 2,
        killed: 0,
        failed: 0,
        minutesTotal: 10,
        minutesMedian: 5,
        costTotal: 3,
        costRuns: 2,
      },
    ])
    expect(stats.total.runs).toBe(2)
  })

  it('reads the stats through the control client', async () => {
    const tempDirRuns = useRunsTemp()
    const { url } = await startRunsBridge()
    writeRuns(tempDirRuns, [
      statsRecord({ lane: 'hermes', startedAt: '2026-10-18T12:00:00.000Z', minutes: 1, costUsd: 0.25 }),
      statsRecord({ lane: 'opencode', model: 'other/model', startedAt: '2026-10-19T12:00:00.000Z', minutes: 3, costUsd: 0.75 }),
    ])
    const client = createClient({ baseUrl: url })

    const all = await client.runStats()
    expect(all.total).toMatchObject({ runs: 2, minutesTotal: 4, costTotal: 1 })

    const since = await client.runStats({ since: '2026-10-19' })
    expect(since.rows).toEqual([
      {
        lane: 'opencode',
        model: 'other/model',
        runs: 1,
        finished: 1,
        killed: 0,
        failed: 0,
        minutesTotal: 3,
        minutesMedian: 3,
        costTotal: 0.75,
        costRuns: 1,
      },
    ])

    await expect(client.runStats({ since: 'yesterday' })).rejects.toThrow(SINCE_PROBLEM)
  })

  it('answers an empty recent list when the records file is missing', async () => {
    useRunsTemp()
    const { url, dir } = await startRunsBridge()
    const res = await fetch(`${url}/api/control/runs`)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ project: basename(RUN_ROOM), running: [], recent: [], last: [] })
  })

  it('reads the last 20 records newest first and skips lines that do not parse', async () => {
    const tempDirRuns = useRunsTemp()
    const { url } = await startRunsBridge()
    const folder = join(tempDirRuns, 'machineroom-runs')
    mkdirSync(folder, { recursive: true })
    const lines = []
    for (let i = 1; i <= 25; i += 1) {
      lines.push(JSON.stringify({ lane: `lane-${i}`, briefs: ['C3e'], startedAt: new Date(i * 1000).toISOString() }))
      if (i === 5) lines.push('not json at all')
      if (i === 9) lines.push('{ "lane": ')
    }
    writeFileSync(join(folder, 'runs.jsonl'), `${lines.join('\n')}\n`)

    const res = await fetch(`${url}/api/control/runs`)
    const { running, recent } = await res.json()
    expect(running).toEqual([])
    expect(recent).toHaveLength(20)
    expect(recent.map((record) => record.lane)).toEqual([
      'lane-25',
      'lane-24',
      'lane-23',
      'lane-22',
      'lane-21',
      'lane-20',
      'lane-19',
      'lane-18',
      'lane-17',
      'lane-16',
      'lane-15',
      'lane-14',
      'lane-13',
      'lane-12',
      'lane-11',
      'lane-10',
      'lane-9',
      'lane-8',
      'lane-7',
      'lane-6',
    ])
  })

  it('sends the newest record per lane beside the recent list', async () => {
    const tempDirRuns = useRunsTemp()
    const { url } = await startRunsBridge()
    const lines = [statsRecord({ lane: 'opencode', startedAt: '2026-10-01T12:00:00.000Z', minutes: 1, exitCode: 1 })]
    for (let i = 2; i <= 25; i += 1) {
      lines.push(statsRecord({ lane: `lane-${i}`, startedAt: `2026-10-${String(i).padStart(2, '0')}T12:00:00.000Z`, minutes: 1 }))
    }
    writeRuns(tempDirRuns, lines)

    const { recent, last } = await fetch(`${url}/api/control/runs`).then((response) => response.json())
    expect(recent).toHaveLength(20)
    expect(recent.some((record) => record.lane === 'opencode')).toBe(false)
    expect(last).toHaveLength(25)
    expect(last.find((record) => record.lane === 'opencode')).toMatchObject({ lane: 'opencode', exitCode: 1 })
  })

  it('starts the runner with an argument list, keeps the last five lines and records the run when it ends', async () => {
    useRunsTemp()
    const { url, token } = await startRunsBridge()

    const noToken = await postJson(`${url}/api/control/runs`, { lane: 'opencode', briefs: ['C3e', 'B6'], confirmed: true })
    expect(noToken.status).toBe(403)
    expect(noToken.body).toEqual({ error: 'A request with no Origin needs a valid orchestrator token.' })

    const res = await tokenPost(`${url}/api/control/runs`, { lane: 'opencode', briefs: ['C3e', 'B6'], confirmed: true }, token)
    expect(res.status).toBe(202)
    const entry = res.body
    expect(entry.lane).toBe('opencode')
    expect(entry.briefs).toEqual(['C3e', 'B6'])
    expect(typeof entry.startedAt).toBe('string')
    expect(entry.lastLines).toEqual([])

    await waitFor(
      async () => {
        const { running } = (await getJson(`${url}/api/control/runs`)).body
        return running.length === 1 && running[0].lastLines.includes('line 7')
      },
      { what: 'the runner lines' }
    )
    const runningNow = (await getJson(`${url}/api/control/runs`)).body
    expect(runningNow.running[0].lastLines).toEqual(['line 3', 'line 4', 'line 5', 'line 6', 'line 7'])

    await waitFor(
      async () => {
        const state = (await getJson(`${url}/api/control/runs`)).body
        return state.running.length === 0 && state.recent.length === 1
      },
      { what: 'the run record' }
    )
    const done = (await getJson(`${url}/api/control/runs`)).body
    expect(done.recent[0]).toMatchObject({ lane: 'opencode', briefs: ['C3e', 'B6'], exitCode: 0, killed: false })
  })

  it('refuses a bad lane, a bad brief and a second run on a busy lane with plain sentences', async () => {
    useRunsTemp()
    const { url, token } = await startRunsBridge({ script: TINY_SLEEPER })

    const noLane = await tokenPost(`${url}/api/control/runs`, { briefs: ['C3e'], confirmed: true }, token)
    expect(noLane.status).toBe(404)
    expect(noLane.body).toEqual({ error: 'The policy file is missing.' })
    const badLane = await tokenPost(`${url}/api/control/runs`, { lane: 'nobody', briefs: ['C3e'], confirmed: true }, token)
    expect(badLane.body).toEqual({ error: 'Choose a lane from the list.' })
    const noCli = await tokenPost(`${url}/api/control/runs`, { lane: 'agy', briefs: ['C3e'], confirmed: true }, token)
    expect(noCli.status).toBe(400)
    expect(noCli.body).toEqual({ error: 'That lane has no command line.' })

    const empty = await tokenPost(`${url}/api/control/runs`, { lane: 'opencode', briefs: [], confirmed: true }, token)
    expect(empty.body).toEqual({ error: 'Choose one to five briefs.' })
    const tooMany = await tokenPost(`${url}/api/control/runs`, {
      lane: 'opencode',
      briefs: ['B6', 'C3e', 'B6', 'C3e', 'B6', 'C3e'],
      confirmed: true,
    }, token)
    expect(tooMany.body).toEqual({ error: 'Choose one to five briefs.' })
    const notAList = await tokenPost(`${url}/api/control/runs`, { lane: 'opencode', briefs: 'C3e', confirmed: true }, token)
    expect(notAList.body).toEqual({ error: 'Choose one to five briefs.' })

    for (const briefs of [['c3e'], ['C3e&calc'], ['Z9'], ['C3e', 42]]) {
      const badId = await tokenPost(`${url}/api/control/runs`, { lane: 'opencode', briefs, confirmed: true }, token)
      expect(badId.status).toBe(400)
      expect(badId.body).toEqual({ error: 'Choose a brief from the list.' })
    }

    const wrongMethod = await fetch(`${url}/api/control/runs`, { method: 'DELETE' })
    expect(wrongMethod.status).toBe(405)

    const started = await tokenPost(`${url}/api/control/runs`, { lane: 'opencode', briefs: ['C3e'], confirmed: true }, token)
    expect(started.status).toBe(202)
    const busy = await tokenPost(`${url}/api/control/runs`, { lane: 'opencode', briefs: ['B6'], confirmed: true }, token)
    expect(busy.status).toBe(409)
    expect(busy.body).toEqual({ error: 'That lane is already running.' })
    const otherLane = await tokenPost(`${url}/api/control/runs`, { lane: 'opencode2', briefs: ['B6'], confirmed: true }, token)
    expect(otherLane.status).toBe(202)
  })

  it('refuses a retired lane before it starts', async () => {
    useRunsTemp()
    const { url, token } = await startRunsBridge()
    const res = await tokenPost(`${url}/api/control/runs`, { lane: 'hermes', briefs: ['C3e'], confirmed: true }, token)
    expect(res.status).toBe(400)
    expect(res.body).toEqual({ error: 'The hermes lane is retired.' })
    const { running } = (await getJson(`${url}/api/control/runs`)).body
    expect(running).toEqual([])
  })

  it('refuses a run that was not confirmed', async () => {
    useRunsTemp()
    const { url, token } = await startRunsBridge()

    for (const confirmed of [undefined, false, 'true', 1]) {
      const body = { lane: 'opencode', briefs: ['C3e'] }
      if (confirmed !== undefined) body.confirmed = confirmed
      const res = await tokenPost(`${url}/api/control/runs`, body, token)
      expect(res.status, String(confirmed)).toBe(400)
      expect(res.body, String(confirmed)).toEqual({ error: 'Confirm the run first.' })
    }

    const { running, recent } = (await getJson(`${url}/api/control/runs`)).body
    expect(running).toEqual([])
    expect(recent).toEqual([])
  })

  it('answers 404 without a path when the brief files are missing', async () => {
    useRunsTemp()
    const { url, dir, token } = await startRunsBridge({ project: false })
    const res = await tokenPost(`${url}/api/control/runs`, { lane: 'hermes', briefs: ['C3e'], confirmed: true }, token)
    expect(res.status).toBe(404)
    expect(res.body.error).toMatch(/missing/i)
    expect(res.body.error).not.toContain(dir)
    expect(res.body.error).not.toMatch(/[/\\]|TASKS\.md|lanes\.json/)
  })

  it('keeps the run going after the request and kills it when the bridge stops', async () => {
    useRunsTemp()
    const { url, bridge, token } = await startRunsBridge({ script: TINY_SLEEPER })
    const res = await tokenPost(`${url}/api/control/runs`, { lane: 'opencode', briefs: ['C3e'], confirmed: true }, token)
    expect(res.status).toBe(202)

    let pid = 0
    await waitFor(
      async () => {
        const { running } = (await getJson(`${url}/api/control/runs`)).body
        const line = running[0]?.lastLines.find((item) => item.startsWith('pid '))
        if (!line) return false
        pid = Number(line.slice('pid '.length))
        return Number.isInteger(pid) && pid > 0
      },
      { what: 'the runner pid' }
    )
    expect(() => process.kill(pid, 0)).not.toThrow()

    await bridge.stop()
    await waitFor(
      () => {
        try {
          process.kill(pid, 0)
          return false
        } catch {
          return true
        }
      },
      { what: 'the runner to stop' }
    )
  })
})

const DECISION_KEY = 'test-decision-key-123456'
const QUESTIONS = { tier: choice('Which tier?', { small: 'A small one.', large: 'A large one.' }) }
const ANSWERS = {
  tier: { type: 'choice', choice: 'small', confidence: 0.9, probabilities: { small: 0.9, large: 0.1 } },
}
const RAW_USAGE = { input_tokens: 120, output_tokens: 8, cost: 0.00002 }
const USAGE = { inputTokens: 120, outputTokens: 8, cost: 0.00002 }

describe('the decide route', () => {
  function goodAnswer(body) {
    return { body: { model: body.model, answers: ANSWERS, usage: RAW_USAGE } }
  }

  function postDecide(url, body, headers = {}) {
    return getJson(`${url}/api/decide`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: new URL(url).origin, ...headers },
      body: JSON.stringify({ confirmed: true, ...body }),
    })
  }

  async function startDecideBridge({ env = { OPENROUTER_API_KEY: DECISION_KEY }, decideUrl, decideTimeoutMs } = {}) {
    const started = await laneBridge({ projectRoot: tempDir(), bridge: { env, decideUrl, decideTimeoutMs } })
    return { url: started.url }
  }

  async function startFakeDecisionBridge(options = {}) {
    const fake = await startFakeDecisions(options.answer ?? goodAnswer)
    cleanups.push(() => fake.close())
    const { url } = await startDecideBridge({ ...options, decideUrl: fake.url })
    return { fake, url }
  }

  function startStalledDecisions() {
    const sockets = new Set()
    const requests = []
    const server = createServer((req) => {
      requests.push(req.url)
      req.resume()
    })
    server.on('connection', (socket) => {
      sockets.add(socket)
      socket.on('close', () => sockets.delete(socket))
    })
    return new Promise((resolveReady) => {
      server.listen(0, '127.0.0.1', () => {
        resolveReady({
          url: `http://127.0.0.1:${server.address().port}/decide`,
          requests,
          close: () =>
            new Promise((resolveClose) => {
              for (const socket of sockets) socket.destroy()
              server.close(() => resolveClose())
            }),
        })
      })
    })
  }

  it('refuses a decision with no Origin and with no owner confirm', async () => {
    const { fake, url } = await startFakeDecisionBridge()

    const noOrigin = await getJson(`${url}/api/decide`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ state: 'Task x', questions: QUESTIONS, confirmed: true }),
    })
    expect(noOrigin.status).toBe(403)
    expect(noOrigin.body).toEqual({ error: 'Only the owner can spend on a decision.' })

    const noConfirm = await getJson(`${url}/api/decide`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: new URL(url).origin },
      body: JSON.stringify({ state: 'Task x', questions: QUESTIONS }),
    })
    expect(noConfirm.status).toBe(400)
    expect(noConfirm.body).toEqual({ error: 'The owner must confirm the decision first.' })
    expect(fake.seen).toHaveLength(0)
  })

  it('answers a good call with its model, answers, usage, milliseconds and attempts', async () => {
    const { fake, url } = await startFakeDecisionBridge()
    const res = await postDecide(url, { state: 'Task x', questions: QUESTIONS })
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({
      ok: true,
      model: 'typesafe/jev-1.14',
      answers: ANSWERS,
      usage: USAGE,
      attempts: 1,
    })
    expect(typeof res.body.ms).toBe('number')
    expect(fake.seen).toHaveLength(1)
    expect(fake.seen[0].authorization).toBe(`Bearer ${DECISION_KEY}`)
    expect(fake.seen[0].body).toEqual({ model: 'typesafe/jev-1.14', state: 'Task x', questions: QUESTIONS })
  })

  it('takes the model from the body, then DECISION_MODEL, then the default', async () => {
    const fake = await startFakeDecisions(goodAnswer)
    cleanups.push(() => fake.close())
    const fromEnv = await startDecideBridge({
      env: { OPENROUTER_API_KEY: DECISION_KEY, DECISION_MODEL: 'env/model' },
      decideUrl: fake.url,
    })
    const plain = await startDecideBridge({ decideUrl: fake.url })

    const body = await postDecide(fromEnv.url, {
      state: 'Task x',
      questions: QUESTIONS,
      model: 'body/model',
    }).then((res) => res.body)
    expect(body.model).toBe('body/model')

    const fromEnvironment = await postDecide(fromEnv.url, {
      state: 'Task x',
      questions: QUESTIONS,
    }).then((res) => res.body)
    expect(fromEnvironment.model).toBe('env/model')

    const fallback = await postDecide(plain.url, {
      state: 'Task x',
      questions: QUESTIONS,
    }).then((res) => res.body)
    expect(fallback.model).toBe('typesafe/jev-1.14')

    expect(fake.seen.map((request) => request.body.model)).toEqual(['body/model', 'env/model', 'typesafe/jev-1.14'])
  })

  it('answers 404 when no key is set and calls nothing', async () => {
    const { fake, url } = await startFakeDecisionBridge({ env: {} })
    const res = await postDecide(url, { state: 'Task x', questions: QUESTIONS })
    expect(res.status).toBe(404)
    expect(res.body).toEqual({ error: 'No key is set for the decision model.' })
    expect(fake.seen).toHaveLength(0)
  })

  it('answers 413 for a body over 32 KB', async () => {
    const { fake, url } = await startFakeDecisionBridge()
    const res = await postDecide(url, { state: 'x'.repeat(33 * 1024), questions: QUESTIONS })
    expect(res.status).toBe(413)
    expect(res.body).toEqual({ error: 'That request is too large.' })
    expect(fake.seen).toHaveLength(0)
  })

  it('answers 400 without a state or a question', async () => {
    const { fake, url } = await startFakeDecisionBridge()

    const noState = await postDecide(url, { questions: QUESTIONS })
    expect(noState.status).toBe(400)
    expect(noState.body).toEqual({ error: 'Send a state as text or an object.' })

    const badState = await postDecide(url, { state: 42, questions: QUESTIONS })
    expect(badState.status).toBe(400)
    expect(badState.body).toEqual({ error: 'Send a state as text or an object.' })

    const noQuestions = await postDecide(url, { state: 'Task x', questions: {} })
    expect(noQuestions.status).toBe(400)
    expect(noQuestions.body).toEqual({ error: 'Send at least one question.' })

    const listQuestions = await postDecide(url, { state: 'Task x', questions: [] })
    expect(listQuestions.status).toBe(400)
    expect(listQuestions.body).toEqual({ error: 'Send at least one question.' })
    expect(fake.seen).toHaveLength(0)
  })

  it('answers 400 for a model or a question name that could not be a name, before the model is called', async () => {
    const { fake, url } = await startFakeDecisionBridge()
    for (const model of ['jev\ndecide fake ok 1ms', ' ', '-m', 'x'.repeat(121)]) {
      const res = await postDecide(url, { state: 'Task x', questions: QUESTIONS, model })
      expect(res.status).toBe(400)
      expect(res.body).toEqual({ error: 'The model must be a name.' })
    }
    const sentence = { error: 'Each question needs a short name and a type of noul, choice or score.' }
    for (const questions of [
      { 'tier\ndecide fake ok 1ms': QUESTIONS.tier },
      { tier: { ...QUESTIONS.tier, type: 'constructor' } },
      { tier: null },
    ]) {
      const res = await postDecide(url, { state: 'Task x', questions })
      expect(res.status).toBe(400)
      expect(res.body).toEqual(sentence)
    }
    expect(fake.seen).toHaveLength(0)
  })

  it('answers 429 when the model is rate limited after its retry', async () => {
    const { fake, url } = await startFakeDecisionBridge({
      answer: () => ({ status: 429, body: { error: { message: 'slow down' } } }),
    })
    const res = await postDecide(url, { state: 'Task x', questions: QUESTIONS })
    expect(res.status).toBe(429)
    expect(res.body).toEqual({ error: 'Too many requests. Try again in a moment.' })
    expect(fake.seen).toHaveLength(2)
  })

  it('answers 502 after the retry on a server error', async () => {
    const { fake, url } = await startFakeDecisionBridge({
      answer: () => ({ status: 500, body: { error: { message: 'boom' } } }),
    })
    const res = await postDecide(url, { state: 'Task x', questions: QUESTIONS })
    expect(res.status).toBe(502)
    expect(res.body).toEqual({ error: 'The service failed: boom' })
    expect(fake.seen).toHaveLength(2)
  })

  it('answers 502 when the model does not answer in time', async () => {
    const stalled = await startStalledDecisions()
    cleanups.push(() => stalled.close())
    const { url } = await startDecideBridge({ decideUrl: stalled.url, decideTimeoutMs: 50 })
    const res = await postDecide(url, { state: 'Task x', questions: QUESTIONS })
    expect(res.status).toBe(502)
    expect(res.body).toEqual({ error: 'The decision model did not answer in time.' })
    expect(stalled.requests).toHaveLength(2)
  })

  it('never puts the key, the state or the answers in an answer or a log line', async () => {
    const logs = []
    const spy = vi.spyOn(console, 'log').mockImplementation((line) => {
      logs.push(String(line))
    })
    cleanups.push(() => spy.mockRestore())
    const { url } = await startFakeDecisionBridge({
      answer: (body, count) =>
        count === 1 ? goodAnswer(body) : { status: 500, body: { error: { message: `failed for Bearer ${DECISION_KEY} and ${DECISION_KEY}` } } },
    })
    const state = 'SECRET STATE TEXT'

    const first = await postDecide(url, { state, questions: QUESTIONS })
    const firstText = JSON.stringify(first.body)
    const second = await postDecide(url, { state, questions: QUESTIONS })
    const secondText = JSON.stringify(second.body)

    expect(firstText).not.toContain(DECISION_KEY)
    expect(secondText).not.toContain(DECISION_KEY)
    expect(secondText).toContain('[key]')
    expect(logs).toHaveLength(2)
    for (const line of logs) {
      expect(line).not.toContain(DECISION_KEY)
      expect(line).not.toContain(state)
      expect(line).not.toContain('small')
    }
    expect(logs[0]).toContain('typesafe/jev-1.14')
    expect(logs[0]).toContain('tier')
    expect(logs[0]).toContain('ok')
    expect(logs[1]).toContain('server')
  })

  it('calls the decide route through the control client', async () => {
    const { url } = await startFakeDecisionBridge()
    const client = createClient({
      baseUrl: url,
      fetchImpl: (target, init = {}) => fetch(target, { ...init, headers: { ...(init.headers ?? {}), origin: url } }),
    })
    const answer = await client.decide({ state: 'Task x', questions: QUESTIONS })
    expect(answer).toMatchObject({
      ok: true,
      model: 'typesafe/jev-1.14',
      answers: ANSWERS,
      usage: USAGE,
      attempts: 1,
    })
  })
})
