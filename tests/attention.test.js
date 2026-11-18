import { execFileSync } from 'node:child_process'
import { createServer } from 'node:http'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { act, createElement } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { startLane } from '../scripts/run-lane.mjs'
import { gitPath } from '../server/programPath.js'
import { attentionItems, backupRanLater, succeededLater } from '../src/briefs/attention.js'
import { runRecord } from '../src/briefs/run.js'
import DispatchPanel from '../src/ui/panels/DispatchPanel.jsx'
import { makeTempDir } from './helpers/tempRoot.js'
import { buttonWithText, settle, withDom } from './helpers/uiDom.js'

const cleanups = []

afterEach(async () => {
  while (cleanups.length > 0) {
    await cleanups.pop()()
  }
})

function tempDir(prefix = 'mr-attention-') {
  const dir = makeTempDir(prefix)
  cleanups.push(() => rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }))
  return dir
}

function makeRepo(folder, extraFiles = {}) {
  const repo = join(folder, 'repo')
  mkdirSync(repo, { recursive: true })
  const git = gitPath()
  const run = (args) => execFileSync(git, args, { cwd: repo, encoding: 'utf8', windowsHide: true })
  run(['init'])
  run(['config', 'user.name', 'Test User'])
  run(['config', 'user.email', 'test@example.invalid'])
  writeFileSync(join(repo, 'README.md'), 'hello\n')
  for (const [name, content] of Object.entries(extraFiles)) {
    writeFileSync(join(repo, name), content)
  }
  run(['add', '-A'])
  run(['commit', '-m', 'init'])
  return repo
}

function startFakeApi(handler) {
  const server = createServer((req, res) => {
    let body = ''
    req.on('data', (chunk) => { body += chunk })
    req.on('end', async () => {
      const parsed = body === '' ? null : JSON.parse(body)
      const answer = await handler(parsed)
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify(answer))
    })
  })
  cleanups.push(() => new Promise((done) => {
    server.close(() => done())
    server.closeAllConnections?.()
  }))
  return new Promise((done) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      done({ url: `http://127.0.0.1:${address.port}/v1` })
    })
  })
}

async function runProjectLane({ lane, name, envExtra = {}, extraFiles = {} }) {
  const folder = tempDir()
  const repo = makeRepo(folder, extraFiles)
  const runs = join(folder, 'runs')
  mkdirSync(runs, { recursive: true })
  const logPath = join(runs, `${name}.log`)
  const usageFile = join(runs, `${name}.usage.json`)
  const saved = {
    MACHINEROOM_RUNS: process.env.MACHINEROOM_RUNS,
    MACHINEROOM_API_URL: process.env.MACHINEROOM_API_URL,
    MACHINEROOM_API_KEY: process.env.MACHINEROOM_API_KEY,
  }
  process.env.MACHINEROOM_RUNS = runs
  for (const [key, value] of Object.entries(envExtra)) process.env[key] = value
  try {
    const result = await startLane({
      options: { lane: name, minutes: 1 },
      lane,
      lanes: { [name]: lane },
      wanted: [],
      prompt: 'Do the task.',
      logPath,
      usageFile,
      name,
      project: repo,
      task: 'Do the task.',
    })
    const lines = readFileSync(join(runs, 'runs.jsonl'), 'utf8').trim().split(/\r?\n/)
    return { result, record: JSON.parse(lines.at(-1)) }
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  }
}

describe('loop stop record', () => {
  it('records stopReason repeated failure when machineroom stops on repeated failure', async () => {
    const api = await startFakeApi(() => ({
      id: 'chatcmpl-loop',
      object: 'chat.completion',
      choices: [{
        index: 0,
        message: {
          role: 'assistant',
          content: null,
          tool_calls: [{ id: 'call_same', type: 'function', function: { name: 'read_file', arguments: JSON.stringify({ path: 'missing.txt' }) } }],
        },
        finish_reason: 'tool_calls',
      }],
      usage: { prompt_tokens: 1, completion_tokens: 1 },
    }))
    const { result, record } = await runProjectLane({
      name: 'direct',
      lane: { name: 'Direct', cli: { harness: 'machineroom', model: 'test/model' } },
      envExtra: { MACHINEROOM_API_URL: api.url, MACHINEROOM_API_KEY: 'test-key' },
    })

    expect(result.code).toBe(4)
    expect(record.exitCode).toBe(4)
    expect(record.stopReason).toBe('repeated failure')
  })

  it('does not set stopReason for another harness exiting 4 or machineroom exiting 1', async () => {
    const other = await runProjectLane({
      name: 'opencode',
      lane: { name: 'OpenCode', cli: { harness: 'opencode', bin: process.execPath, model: 'test/model' } },
      extraFiles: { run: 'process.exit(4)\n' },
    })
    expect(other.record.exitCode).toBe(4)
    expect(Object.hasOwn(other.record, 'stopReason')).toBe(false)

    const api = await startFakeApi(() => ({ error: { message: 'Provider failed.' } }))
    const fail1 = await runProjectLane({
      name: 'direct',
      lane: { name: 'Direct', cli: { harness: 'machineroom', model: 'test/model' } },
      envExtra: { MACHINEROOM_API_URL: api.url, MACHINEROOM_API_KEY: 'test-key' },
    })
    expect(fail1.record.exitCode).toBe(1)
    expect(Object.hasOwn(fail1.record, 'stopReason')).toBe(false)
    expect(Object.hasOwn(runRecord({ lane: 'direct', exitCode: 4 }), 'stopReason')).toBe(false)
  })
})

describe('attentionItems', () => {
  it('turns plain failures, start failures and repeated-failure loop stops into items newest first', () => {
    const items = attentionItems([
      { lane: 'opencode', startedAt: '2026-11-16T10:00:00.000Z', briefs: ['P465'], exitCode: 1, killed: false },
      { lane: 'codex', startedAt: '2026-11-16T10:05:00.000Z', briefs: ['P466', 'P467'], exitCode: 2, killed: false },
      { lane: 'claude', startedAt: '2026-11-16T10:10:00.000Z', briefs: [], task: 'Fix the parser.\nMore details.', exitCode: 1, killed: false },
      { lane: 'agy', startedAt: '2026-11-16T10:15:00.000Z', briefs: ['P468'], exitCode: null, killed: false, startFailed: true },
      { lane: 'direct', startedAt: '2026-11-16T10:20:00.000Z', briefs: ['P469'], exitCode: 4, killed: false, stopReason: 'repeated failure' },
      { lane: 'hermes', startedAt: '2026-11-16T09:55:00.000Z', briefs: [], exitCode: 1, killed: false },
    ])

    expect(items).toEqual([
      { lane: 'direct', startedAt: '2026-11-16T10:20:00.000Z', text: 'direct stopped on P469: the same call failed 5 times' },
      { lane: 'agy', startedAt: '2026-11-16T10:15:00.000Z', text: 'agy could not start P468' },
      { lane: 'claude', startedAt: '2026-11-16T10:10:00.000Z', text: 'claude failed on Fix the parser' },
      { lane: 'codex', startedAt: '2026-11-16T10:05:00.000Z', text: 'codex failed on P466 P467' },
      { lane: 'opencode', startedAt: '2026-11-16T10:00:00.000Z', text: 'opencode failed on P465' },
      { lane: 'hermes', startedAt: '2026-11-16T09:55:00.000Z', text: 'hermes failed on unknown work' },
    ])
  })

  it('leaves out stopped runs, zero-exit runs with no commits and silent or incomplete records', () => {
    expect(attentionItems(null)).toEqual([])
    expect(attentionItems([])).toEqual([])
    expect(attentionItems([
      { lane: 'opencode', startedAt: '2026-11-16T10:00:00.000Z', briefs: ['P1'], exitCode: 1, killed: true },
      { lane: 'claude', startedAt: '2026-11-16T10:01:00.000Z', briefs: ['P2'], exitCode: null, killed: true, startFailed: true },
      { lane: 'codex', startedAt: '2026-11-16T10:02:00.000Z', briefs: ['P3'], exitCode: 0, killed: false, commits: [] },
      { lane: 'agy', startedAt: '2026-11-16T10:03:00.000Z', briefs: ['P4'], exitCode: 0, killed: false, commits: ['abc1234 0.1.402: Done'] },
      { lane: 'direct', startedAt: '2026-11-16T10:04:00.000Z', briefs: ['P5'] },
      { lane: 'hermes', startedAt: '2026-11-16T10:05:00.000Z', briefs: ['P6'], exitCode: null, killed: false },
    ])).toEqual([])
  })

  it('leaves out a failure whose failover backup ran later, and keeps refused or untaken failovers', () => {
    const takenOver = attentionItems([
      {
        lane: 'opencode',
        startedAt: '2026-11-16T10:00:00.000Z',
        briefs: ['P1'],
        exitCode: 1,
        killed: false,
        failover: { kind: 'quota', to: 'agy' },
      },
      {
        lane: 'agy',
        startedAt: '2026-11-16T10:01:00.000Z',
        briefs: ['P1'],
        exitCode: 0,
        killed: false,
        failoverFrom: { lane: 'opencode', startedAt: '2026-11-16T10:00:00.000Z' },
      },
    ])
    expect(takenOver).toEqual([])

    const sameTimestampTakeover = attentionItems([
      {
        lane: 'opencode',
        startedAt: '2026-11-16T10:00:00.000Z',
        briefs: ['P1'],
        exitCode: 1,
        killed: false,
        failover: { kind: 'rate-limit', to: 'agy' },
      },
      {
        lane: 'agy',
        startedAt: '2026-11-16T10:00:00.000Z',
        briefs: ['P1'],
        exitCode: 1,
        killed: false,
        failoverFrom: { lane: 'opencode', startedAt: '2026-11-16T10:00:00.000Z' },
      },
    ])
    expect(sameTimestampTakeover).toEqual([
      { lane: 'agy', startedAt: '2026-11-16T10:00:00.000Z', text: 'agy failed on P1' },
    ])

    const refused = attentionItems([
      {
        lane: 'opencode',
        startedAt: '2026-11-16T10:00:00.000Z',
        briefs: ['P1'],
        exitCode: 1,
        killed: false,
        failover: { kind: 'quota', to: 'agy', refused: true },
      },
      {
        lane: 'agy',
        startedAt: '2026-11-16T10:01:00.000Z',
        briefs: ['P2'],
        exitCode: 0,
        killed: false,
      },
    ])
    expect(refused).toEqual([
      { lane: 'opencode', startedAt: '2026-11-16T10:00:00.000Z', text: 'opencode failed on P1' },
    ])

    const earlierBackupOnly = attentionItems([
      {
        lane: 'agy',
        startedAt: '2026-11-16T09:00:00.000Z',
        briefs: ['P0'],
        exitCode: 0,
        killed: false,
      },
      {
        lane: 'opencode',
        startedAt: '2026-11-16T10:00:00.000Z',
        briefs: ['P1'],
        exitCode: 1,
        killed: false,
        failover: { kind: 'quota', to: 'agy' },
      },
    ])
    expect(earlierBackupOnly).toEqual([
      { lane: 'opencode', startedAt: '2026-11-16T10:00:00.000Z', text: 'opencode failed on P1' },
    ])
  })

  it('clears work only after a later successful run on any lane', () => {
    const failure = { lane: 'codex', startedAt: '2026-11-16T10:00:00Z', briefs: ['P1'], exitCode: 1 }
    const success = { lane: 'agy', startedAt: '2026-11-16T10:01:00Z', briefs: ['P1'], exitCode: 0 }
    expect(attentionItems([failure, success])).toEqual([])
    expect(attentionItems([failure, { ...success, briefs: ['P2'] }])).toHaveLength(1)
    expect(attentionItems([{ ...failure, briefs: [], task: 'Fix it' }, { ...success, briefs: [], task: 'Fix it' }])).toEqual([])
  })

  it('clears a lane item when a newer run ends well or is stopped', () => {
    expect(attentionItems([
      { lane: 'opencode', startedAt: '2026-11-16T10:00:00.000Z', briefs: ['P1'], exitCode: 1, killed: false },
      { lane: 'opencode', startedAt: '2026-11-16T10:05:00.000Z', briefs: ['P1'], exitCode: 0, killed: false, commits: [] },
    ])).toEqual([])

    expect(attentionItems([
      { lane: 'opencode', startedAt: '2026-11-16T10:05:00.000Z', briefs: ['P1'], exitCode: 1, killed: true },
      { lane: 'opencode', startedAt: '2026-11-16T10:00:00.000Z', briefs: ['P1'], exitCode: 1, killed: false },
    ])).toEqual([])

    expect(attentionItems([
      { lane: 'opencode', startedAt: '2026-11-16T10:00:00.000Z', briefs: ['P1'], exitCode: 1, killed: false },
      { lane: 'opencode', startedAt: '2026-11-16T10:05:00.000Z', briefs: ['P2'], exitCode: 1, killed: false },
    ])).toEqual([
      { lane: 'opencode', startedAt: '2026-11-16T10:05:00.000Z', text: 'opencode failed on P2' },
    ])
  })
})

it('exposes the two helpers that say a later run fixed the work', () => {
  const failure = { lane: 'codex', startedAt: '2026-11-16T10:00:00.000Z', briefs: ['P1'], exitCode: 1 }
  const success = { lane: 'agy', startedAt: '2026-11-16T10:01:00.000Z', briefs: ['P1'], exitCode: 0 }
  expect(succeededLater(failure, [failure, success])).toBe(true)
  expect(succeededLater(failure, [failure])).toBe(false)
  const failover = { ...failure, failover: { kind: 'quota', to: 'agy' } }
  expect(backupRanLater(failover, 'codex', [failover, success])).toBe(true)
  expect(backupRanLater(failure, 'codex', [failure, success])).toBe(false)
})

describe('DispatchPanel Needs you', () => {
  it('shows the Needs you heading only when attention has items and clears when a newer run clears them', async () => {
    let payload = {
      project: 'demo',
      running: [],
      recent: [{ lane: 'opencode', briefs: ['P1'], startedAt: '2026-11-16T10:00:00.000Z', exitCode: 0, killed: false }],
      attention: [],
    }
    const client = {
      health: async () => ({ lanes: true }),
      runs: async () => payload,
    }
    await withDom(async ({ container, root }) => {
      await act(async () => {
        root.render(createElement(DispatchPanel, { client, initialAgents: [{ id: 'agent-codex', key: 'codex', name: 'Codex', adapterType: 'codex_local', harness: 'codex', role: null }] }))
      })
      await settle()
      expect(container.textContent).not.toContain('Needs you')

      payload = {
        project: 'demo',
        running: [],
        recent: [{ lane: 'opencode', briefs: ['P1'], startedAt: '2026-11-16T10:00:00.000Z', exitCode: 1, killed: false }],
        attention: [
          { lane: 'lane1', startedAt: '2026-11-16T10:06:00.000Z', text: 'lane1 failed on P1.' },
          { lane: 'lane2', startedAt: '2026-11-16T10:05:00.000Z', text: 'lane2 could not start.' },
          { lane: 'lane3', startedAt: '2026-11-16T10:04:00.000Z', text: 'lane3 stopped: the same call failed five times.' },
          { lane: 'lane4', startedAt: '2026-11-16T10:03:00.000Z', text: 'lane4 failed on P4.' },
          { lane: 'lane5', startedAt: '2026-11-16T10:02:00.000Z', text: 'lane5 failed on P5.' },
          { lane: 'lane6', startedAt: '2026-11-16T10:01:00.000Z', text: 'lane6 failed on P6.' },
        ],
      }
      await act(async () => {
        buttonWithText(container, 'Refresh').click()
      })
      await settle()

      expect(container.textContent).toContain('Needs you')
      const text = container.textContent
      expect(text).toContain('lane1 failed on P1.')
      expect(text).toContain('lane5 failed on P5.')
      expect(text).not.toContain('lane6 failed on P6.')
      expect(text.match(/Needs you/g)).toHaveLength(1)
      expect(text).toContain('Run on this project')
      expect(text.indexOf('Needs you')).toBeLessThan(text.indexOf('Run on this project'))
      expect(text.indexOf('Needs you')).toBeLessThan(text.indexOf('opencode | P1'))
      const rows = container.querySelectorAll('.runs-entry.is-failed')
      expect(rows.some((row) => row.textContent.includes('lane1 failed on P1.'))).toBe(true)

      payload = {
        project: 'demo',
        running: [],
        recent: [{ lane: 'opencode', briefs: ['P1'], startedAt: '2026-11-16T10:07:00.000Z', exitCode: 0, killed: false }],
        attention: [],
      }
      await act(async () => {
        buttonWithText(container, 'Refresh').click()
      })
      await settle()
      expect(container.textContent).not.toContain('Needs you')
    })
  })

  it('shows Needs you even when running and recent are empty', async () => {
    const client = {
      health: async () => ({ lanes: true }),
      runs: async () => ({
        project: 'demo',
        running: [],
        recent: [],
        attention: [{ lane: 'opencode', startedAt: '2026-11-16T10:00:00.000Z', text: 'opencode failed on P1' }],
      }),
    }
    await withDom(async ({ container, root }) => {
      await act(async () => {
        root.render(createElement(DispatchPanel, { client, initialAgents: [] }))
      })
      await settle()
      expect(container.textContent).toContain('Needs you')
      expect(container.textContent).toContain('opencode failed on P1')
    })
  })
})

it('shows a repeated failure on a successful newest run and clears it on a later run', () => {
  const run = { lane: 'codex', startedAt: '2026-11-16T10:00:00.000Z', exitCode: 0, repeatedFailure: { tool: 'Read', count: 5 } }
  expect(attentionItems([run])).toEqual([{ lane: 'codex', startedAt: run.startedAt, text: 'codex stopped on unknown work: the same call failed 5 times' }])
  expect(attentionItems([run, { lane: 'codex', startedAt: '2026-11-16T10:01:00.000Z', exitCode: 0 }])).toEqual([])
})

it('shows age and opens and remembers a dismissed failure', async () => {
  const saved = new Map()
  const oldStorage = globalThis.localStorage
  globalThis.localStorage = { getItem: (key) => saved.get(key) ?? null, setItem: (key, value) => saved.set(key, value) }
  const startedAt = new Date(Date.now() - 5 * 60000).toISOString()
  const client = { health: async () => ({ lanes: true }), runs: async () => ({ running: [], recent: [], attention: [{ lane: 'codex', startedAt, text: 'codex failed on P1' }] }) }
  try {
    await withDom(async ({ container, root, window }) => {
      let detail
      window.addEventListener('machineroom:open-chat', (event) => { detail = event.detail })
      await act(async () => { root.render(createElement(DispatchPanel, { client, initialAgents: [] })) })
      await settle()
      expect(container.textContent).toContain('codex failed on P1 · 5 min')
      await act(async () => { buttonWithText(container, 'Open').click() })
      expect(detail).toEqual({ lane: 'codex', startedAt })
      await act(async () => { buttonWithText(container, 'Dismiss').click() })
      expect(container.textContent).not.toContain('Needs you')
      await act(async () => { root.render(null) })
      await act(async () => { root.render(createElement(DispatchPanel, { client, initialAgents: [] })) })
      await settle()
      expect(container.textContent).not.toContain('Needs you')
    })
  } finally { globalThis.localStorage = oldStorage }
})

it('dismisses a failure with a start time by lane, time and text, and offers no button without one', async () => {
  const saved = new Map()
  const oldStorage = globalThis.localStorage
  globalThis.localStorage = { getItem: (key) => saved.get(key) ?? null, setItem: (key, value) => saved.set(key, value) }
  const startedAt = '2026-11-16T10:00:00.000Z'
  let attention = [{ lane: 'codex', startedAt, text: 'codex failed on P1' }, { lane: 'agy', startedAt: null, text: 'agy failed on P2' }]
  const client = { health: async () => ({ lanes: true }), runs: async () => ({ running: [], recent: [], attention }) }
  try {
    await withDom(async ({ container, root }) => {
      await act(async () => { root.render(createElement(DispatchPanel, { client, initialAgents: [] })) })
      await settle()
      expect(container.querySelectorAll('.brief-cancel-btn').filter((b) => b.textContent === 'Dismiss')).toHaveLength(1)
      await act(async () => { buttonWithText(container, 'Dismiss').click() })
      expect(container.textContent).not.toContain('codex failed on P1')
      expect(container.textContent).toContain('agy failed on P2')
      expect(JSON.parse(saved.get('machineroom.dismissedAttention'))).toEqual([JSON.stringify(['codex', startedAt, 'codex failed on P1'])])
      attention = [{ lane: 'codex', startedAt, text: 'codex could not start P1' }]
      await act(async () => { buttonWithText(container, 'Refresh').click() })
      await settle()
      expect(container.textContent).toContain('codex could not start P1')
    })
  } finally { globalThis.localStorage = oldStorage }
})

it('lists newest briefs first in each owner group', async () => {
  const briefs = [{ id: 'P1', title: 'First', owner: 'codex' }, { id: 'P2', title: 'Second', owner: 'codex' }]
  const client = { briefs: async () => briefs }
  await withDom(async ({ container, root }) => {
    await act(async () => { root.render(createElement(DispatchPanel, { client, initialAgents: [], initialBriefs: briefs })) })
    await settle()
    const options = container.querySelectorAll('option')
    expect(Array.from(options).map((option) => option.getAttribute('value'))).toEqual(['', 'P2', 'P1'])
  })
})
