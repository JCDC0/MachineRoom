import { mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { Writable } from 'node:stream'
import { afterEach, describe, expect, it } from 'vitest'
import { acpRunCommand, parseAcpArgs, runAcp } from '../scripts/acp-run.mjs'
import { laneSpawn } from '../scripts/run-lane.mjs'
import { defaultMode, laneModesFor, legacyMode } from '../src/control/modes.js'
import { makeTempDir } from './helpers/tempRoot.js'

const roots = []

afterEach(() => {
  while (roots.length) rmSync(roots.pop(), { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
})

function project() {
  const root = makeTempDir('mr-acp-permissions-')
  roots.push(root)
  const cwd = join(root, 'project')
  const outside = join(root, 'project-other')
  mkdirSync(cwd)
  mkdirSync(outside)
  writeFileSync(join(cwd, 'existing.txt'), 'inside')
  return { cwd, outside }
}

const AGENT = `
const { createInterface } = require('node:readline')
const lines = createInterface({ input: process.stdin })
const answers = []
let requests, promptId
const send = (value) => process.stdout.write(JSON.stringify(value) + '\\n')
function next() {
  if (answers.length === requests.length) {
    send({ method: 'session/update', params: { sessionId: 'fake', update: { answers } } })
    send({ id: promptId, result: { stopReason: 'end_turn' } })
    setImmediate(() => process.exit(0))
  } else {
    send({ id: 1000 + answers.length, method: 'session/request_permission', params: requests[answers.length] })
  }
}
lines.on('line', (line) => {
  const message = JSON.parse(line)
  if (message.method === 'initialize') send({ id: message.id, result: { protocolVersion: 1 } })
  else if (message.method === 'session/new') send({ id: message.id, result: { sessionId: 'fake' } })
  else if (message.method === 'session/prompt') {
    requests = JSON.parse(message.params.prompt[0].text)
    promptId = message.id
    next()
  } else if (message.id >= 1000) {
    answers.push(message.result.outcome)
    next()
  }
})
`

const OPTIONS = [
  { optionId: 'always', kind: 'allow_always' },
  { optionId: 'once', kind: 'allow_once' },
  { optionId: 'never', kind: 'reject_always' },
  { optionId: 'deny', kind: 'reject_once' },
]
const selected = (optionId) => ({ outcome: 'selected', optionId })
const request = (kind, paths, options = OPTIONS) => ({
  toolCall: { kind, ...(paths === undefined ? {} : { locations: paths.map((path) => ({ path })) }) },
  options,
})

async function permissions(cwd, mode, requests) {
  let stdout = ''
  let stderr = ''
  const result = await runAcp({
    file: process.execPath,
    args: ['--eval', AGENT],
    cwd,
    mode,
    seconds: 10,
    prompt: JSON.stringify(requests),
    mcpServers: [],
  }, {
    log: { write: (text) => { stdout += text } },
    error: new Writable({ write(text, encoding, done) { stderr += text; done() } }),
  })
  expect(result.code).toBe(0)
  const frames = stdout.trim().split('\n').map((line) => JSON.parse(line))
  return { answers: frames.find((frame) => frame.update?.answers).update.answers, stderr }
}

describe('ACP permissions', () => {
  it('offers Plan, Auto and Bypass while keeping the legacy Bypass default', () => {
    expect(laneModesFor('acp').map((mode) => mode.id)).toEqual(['plan', 'auto', 'bypass'])
    expect(legacyMode('acp')).toBe('bypass')
    expect(defaultMode('acp')).toBe('auto')
  })

  it('parses and forwards modes and refuses invalid modes', () => {
    for (const mode of ['plan', 'auto', 'bypass']) {
      const command = { file: process.execPath, args: [], cwd: process.cwd(), transport: 'acp' }
      const spec = acpRunCommand({ command, mode })
      expect(spec.args).toEqual(expect.arrayContaining(['--mode', mode]))
      expect(parseAcpArgs(spec.args.slice(1)).mode).toBe(mode)
      expect(laneSpawn({ command, mode }).args).toEqual(expect.arrayContaining(['--mode', mode]))
    }
    expect(parseAcpArgs(['--file', 'agent']).mode).toBe('bypass')
    expect(() => parseAcpArgs(['--file', 'agent', '--mode', 'edits'])).toThrow('--mode')
  })

  it('Plan allows only read, search and think, and logs each refusal', async () => {
    const { cwd } = project()
    const kinds = ['read', 'search', 'think', 'edit', 'delete', 'move', 'execute', 'fetch', 'other', 'unknown', undefined]
    const { answers, stderr } = await permissions(cwd, 'plan', kinds.map((kind) => request(kind, ['existing.txt'])))
    expect(answers).toEqual(kinds.map((_, index) => selected(index < 3 ? 'once' : 'deny')))
    expect(stderr.split('\n').filter((line) => line.startsWith('refused '))).toHaveLength(8)
    expect(stderr).toContain('refused edit:')
    expect(stderr).toContain('refused unknown:')
    expect(stderr).not.toContain('approved automatically')
  })

  it('Auto allows reads and edits inside the folder, including new files', async () => {
    const { cwd } = project()
    const calls = [
      ...['read', 'search', 'think'].map((kind) => request(kind)),
      request('edit', [join(cwd, 'existing.txt')]),
      request('edit', ['new/folder/file.txt']),
      request('delete', ['existing.txt']),
      request('move', ['existing.txt', 'new.txt']),
    ]
    const { answers, stderr } = await permissions(cwd, 'auto', calls)
    expect(answers).toEqual(calls.map(() => selected('once')))
    expect(stderr).not.toContain('refused ')
    expect(stderr).not.toContain('approved automatically')
  })

  it('Auto refuses outside paths, traversal, mixed locations and commands', async () => {
    const { cwd, outside } = project()
    const calls = [
      request('edit', [join(outside, 'file.txt')]),
      request('edit', ['../project-other/file.txt']),
      request('move', ['existing.txt', join(outside, 'file.txt')]),
      ...['execute', 'fetch', 'other', 'unknown', undefined].map((kind) => request(kind, ['existing.txt'])),
      request('edit'),
      request('delete', []),
      request('move', ['']),
      { toolCall: { kind: 'edit', locations: [null] }, options: OPTIONS },
    ]
    const { answers, stderr } = await permissions(cwd, 'auto', calls)
    expect(answers).toEqual(calls.map(() => selected('deny')))
    expect(stderr.split('\n').filter((line) => line.startsWith('refused '))).toHaveLength(calls.length)
  })

  it('Auto resolves directory links and refuses escapes, including new files behind links', async () => {
    const { cwd, outside } = project()
    mkdirSync(join(cwd, 'inside'))
    symlinkSync(outside, join(cwd, 'escape'), 'junction')
    symlinkSync(join(cwd, 'inside'), join(cwd, 'alias'), 'junction')
    const { answers } = await permissions(cwd, 'auto', [
      request('edit', ['escape/new/file.txt']),
      request('edit', ['alias/new/file.txt']),
    ])
    expect(answers).toEqual([selected('deny'), selected('once')])
  })

  it('falls back to another reject option or cancelled and checks child session requests', async () => {
    const { cwd } = project()
    const { answers } = await permissions(cwd, 'plan', [
      { ...request('edit', ['file'], OPTIONS.slice(0, 3)), sessionId: 'child' },
      request(undefined, undefined, OPTIONS.slice(0, 2)),
    ])
    expect(answers).toEqual([selected('never'), { outcome: 'cancelled' }])
  })

  it.each(['bypass', undefined])('%s allows every request as before', async (mode) => {
    const { cwd, outside } = project()
    const calls = ['read', 'edit', 'delete', 'move', 'execute', 'fetch', 'other', undefined]
      .map((kind) => request(kind, [join(outside, 'file')]))
    const { answers, stderr } = await permissions(cwd, mode, calls)
    expect(answers).toEqual(calls.map(() => selected('always')))
    expect(stderr).not.toContain('refused ')
    expect(stderr).toContain('approved automatically')
  })
})
