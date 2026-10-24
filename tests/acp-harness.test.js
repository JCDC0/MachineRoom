import { spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { acpHarness, createAcpParser } from '../src/harnesses/acp.js'
import { harnessByKey } from '../src/harnesses/index.js'
import { createRunLineReader } from '../src/briefs/recording.js'
import { summarizeRun } from '../src/briefs/run.js'
import { killTree } from '../server/processTree.js'
import { acpRunCommand } from '../scripts/acp-run.mjs'
import { laneSpawn } from '../scripts/run-lane.mjs'
import { makeTempDir, removeTempDir } from './helpers/tempRoot.js'

const FIXTURE = fileURLToPath(new URL('./fixtures/acp-opencode-updates.jsonl', import.meta.url))
const FAKE = fileURLToPath(new URL('./fixtures/fake-acp-agent.mjs', import.meta.url))
const ctx = { rootName: 'agent-sandbox', files: ['src/math.js', 'docs/acp-note.md', 'test/strings.test.js'], dirs: ['src', 'docs', 'test'], agentKey: 'opencode' }
const roots = []

afterEach(() => {
  while (roots.length > 0) removeTempDir(roots.pop())
})

function line(value, sessionId = 'ses_kinds') {
  return `${JSON.stringify({ sessionId, update: value })}\n`
}

function activitiesOf(text, context = ctx) {
  const parser = createAcpParser(context)
  return [...parser.push(text, 1000), ...parser.flush(2000)]
}

function runClient({ folder, prompt, model = '', effort = '', seconds = 20, env = {} }) {
  return new Promise((done, fail) => {
    const command = { file: process.execPath, args: [FAKE], cwd: folder }
    const spec = acpRunCommand({ command, seconds, model, effort })
    const child = spawn(spec.file, spec.args, {
      cwd: folder,
      env: { ...process.env, ...env },
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    })
    let stdout = ''
    let stderr = ''
    const timer = setTimeout(() => {
      killTree(child)
      fail(new Error(`acp-run did not exit. stderr: ${stderr}`))
    }, (seconds + 8) * 1000)
    child.stdout.on('data', (chunk) => { stdout += chunk })
    child.stderr.on('data', (chunk) => { stderr += chunk })
    child.once('error', (error) => {
      clearTimeout(timer)
      fail(error)
    })
    child.once('close', (code) => {
      clearTimeout(timer)
      done({ code, stdout, stderr })
    })
    child.stdin.on('error', () => {})
    child.stdin.end(prompt)
  })
}

describe('acp harness', () => {
  it('registers a browser-safe descriptor with the ACP transport', () => {
    expect(harnessByKey.acp).toBe(acpHarness)
    expect(acpHarness.key).toBe('acp')
    expect(acpHarness.name).toBe('ACP')
    expect(acpHarness.adapterType).toBe('acp_local')
    expect(acpHarness.transport).toBe('acp')
    for (const field of ['createParser', 'command', 'readLine', 'report', 'reply', 'usage']) {
      expect(typeof acpHarness[field], field).toBe('function')
    }
  })

  it('builds the agent command from cli.bin and cli.args', () => {
    const command = acpHarness.command({
      cli: { bin: '%TOOLS%\\opencode.exe', args: ['acp', '--verbose'] },
      env: { TOOLS: 'C:\\tools' },
      folder: 'C:\\work',
    })
    expect(command).toEqual({
      file: 'C:\\tools\\opencode.exe',
      args: ['acp', '--verbose'],
      cwd: 'C:\\work',
      transport: 'acp',
    })
    expect(() => acpHarness.command({ cli: { bin: '%TOOLS%\\opencode.exe', args: ['acp'] }, env: {}, folder: 'C:\\work' }))
      .toThrow('The environment variable TOOLS is not set.')
    expect(acpHarness.command({ cli: { bin: 'dsh', args: ['--profile', 'acp'] }, env: {}, folder: 'C:\\work' }).args)
      .toEqual(['--profile', 'acp'])
    expect(acpHarness.command({ cli: { bin: 'dsh' }, env: {}, folder: 'C:\\work' }).args).toEqual([])
  })

  it('starts the ACP client loop for an ACP lane and leaves the other harnesses alone', () => {
    const spec = laneSpawn({
      command: { file: 'C:\\tools\\agent.exe', args: ['acp'], cwd: 'C:\\work', transport: 'acp' },
      minutes: 5,
      model: 'fake/model',
      effort: 'max',
    })
    expect(spec.input).toBe(true)
    expect(spec.file).toBe(process.execPath)
    expect(spec.args).toContain('C:\\tools\\agent.exe')
    expect(spec.args).toContain('acp')
    expect(spec.args).toEqual(expect.arrayContaining(['--minutes', '5', '--model', 'fake/model', '--effort', 'max']))
    expect(laneSpawn({ command: { file: 'opencode', args: ['run'], cwd: 'C:\\work' }, minutes: 5 }))
      .toEqual({ file: 'opencode', args: ['run'], input: false })
  })

  it('maps recorded opencode acp updates to touches, a child and an end', () => {
    const log = readFileSync(FIXTURE, 'utf8')
    const activities = activitiesOf(log)
    const starts = activities.filter((activity) => activity.type === 'tool.start')
    expect(starts.map((activity) => activity.tool)).toEqual(['read', 'edit', 'other', 'read'])
    expect(starts.map((activity) => activity.label)).toEqual([
      'read src/math.js',
      'edit docs/acp-note.md',
      'subagent: Read strings test',
      'read test/strings.test.js',
    ])
    expect(starts[0].touches).toEqual([{ path: 'src/math.js', mode: 'read', kind: 'file' }])
    expect(starts[1].touches).toEqual([{ path: 'docs/acp-note.md', mode: 'write', kind: 'file' }])
    expect(starts[2].touches).toEqual([])
    expect(starts[3]).toMatchObject({ agent: 'opencode~1', touches: [{ path: 'test/strings.test.js', mode: 'read', kind: 'file' }] })
    expect(activities.filter((activity) => activity.type === 'agent.spawn')).toEqual([
      { time: 1000, type: 'agent.spawn', agent: 'opencode', child: 'opencode~1', name: 'Read strings test', label: 'subagent: Read strings test' },
    ])
    expect(activities.filter((activity) => activity.type === 'agent.end')).toEqual([
      { time: 1000, type: 'agent.end', agent: 'opencode~1', ok: true },
    ])
    expect(activities.filter((activity) => activity.type === 'tool.end').every((activity) => activity.ok)).toBe(true)
    expect(activities.filter((activity) => activity.type === 'tool.end')).toHaveLength(4)
  })

  it('maps every ACP tool kind and its locations', () => {
    const calls = [
      { toolCallId: 'k1', name: 'read', kind: 'read', locations: [{ path: 'C:/work/repo/src/a.js' }] },
      { toolCallId: 'k2', name: 'edit', kind: 'edit', locations: [{ path: 'C:/work/repo/src/a.js' }] },
      { toolCallId: 'k3', name: 'delete', kind: 'delete', locations: [{ path: 'C:/work/repo/src/a.js' }] },
      { toolCallId: 'k4', name: 'move', kind: 'move', locations: [{ path: 'C:/work/repo/src/a.js' }, { path: 'C:/work/repo/src/b.js' }] },
      { toolCallId: 'k5', name: 'search', kind: 'search', locations: [{ path: 'C:/work/repo/src' }] },
      { toolCallId: 'k6', name: 'execute', kind: 'execute', locations: [], rawInput: { command: 'npm test' } },
      { toolCallId: 'k7', name: 'fetch', kind: 'fetch', locations: [] },
      { toolCallId: 'k8', name: 'think', kind: 'think', locations: [] },
      { toolCallId: 'k9', name: 'switch_mode', kind: 'switch_mode', locations: [] },
      { toolCallId: 'k10', name: 'other', kind: 'other', locations: [] },
    ]
    const text = calls.map((call) => line({ sessionUpdate: 'tool_call', status: 'pending', rawInput: {}, ...call }, 'ses_kinds')).join('')
    const starts = activitiesOf(text, { rootName: 'repo', files: [], dirs: [], agentKey: 'acp' }).filter((activity) => activity.type === 'tool.start')
    expect(starts.map((activity) => activity.tool)).toEqual(['read', 'edit', 'write', 'write', 'search', 'shell', 'other', 'other', 'other', 'other'])
    expect(starts[0].touches).toEqual([{ path: 'src/a.js', mode: 'read', kind: 'file' }])
    expect(starts[1].touches).toEqual([{ path: 'src/a.js', mode: 'write', kind: 'file' }])
    expect(starts[2].touches).toEqual([{ path: 'src/a.js', mode: 'write', kind: 'file' }])
    expect(starts[3].touches).toEqual([
      { path: 'src/a.js', mode: 'write', kind: 'file' },
      { path: 'src/b.js', mode: 'write', kind: 'file' },
    ])
    expect(starts[3].label).toBe('write src/a.js +1')
    expect(starts[4].touches).toEqual([{ path: 'src', mode: 'list', kind: 'dir' }])
    expect(starts[4].label).toBe('search src')
    expect(starts[5].label).toBe('$ npm test')
  })

  it('takes the parent reply and usage, and leaves the child text out', () => {
    const log = readFileSync(FIXTURE, 'utf8')
    expect(acpHarness.report(log)).toEqual(['All four steps are done. The note is written.'])
    expect(acpHarness.reply(log)).toBe('All four steps are done. The note is written.')
    expect(acpHarness.usage(log)).toEqual({ costUsd: 0.001723, inputTokens: 34627, outputTokens: 362 })
    expect(acpHarness.report('')).toEqual([])
    expect(acpHarness.usage('')).toEqual({ costUsd: null, inputTokens: null, outputTokens: null })
  })

  it('summarizes a recorded ACP log like any other harness', () => {
    const log = readFileSync(FIXTURE, 'utf8')
    const summary = summarizeRun({ harness: 'acp', log, worktree: 'C:/work/agent-sandbox' })
    expect(summary.toolCalls).toBe(4)
    expect(summary.failed).toBe(0)
    expect(summary.written).toEqual(['docs/acp-note.md'])
    expect(summary.read).toEqual(['src/math.js', 'test/strings.test.js'])
    expect(summary.head).toEqual(['All four steps are done. The note is written.'])
    expect(summary.costUsd).toBe(0.001723)
    expect(summary.inputTokens).toBe(34627)
    expect(summary.outputTokens).toBe(362)
  })

  it('marks only the lines that produce an activity as read', () => {
    const read = createRunLineReader('acp')
    const sessionLine = JSON.stringify({ type: 'acp_session', sessionId: 'ses_read' })
    const pending = JSON.stringify({ sessionId: 'ses_read', update: { sessionUpdate: 'tool_call', toolCallId: 'call_1', name: 'read', kind: 'read', status: 'pending', locations: [], rawInput: {} } })
    const touch = JSON.stringify({ sessionId: 'ses_read', update: { sessionUpdate: 'tool_call_update', toolCallId: 'call_1', status: 'in_progress', kind: 'read', locations: [{ path: 'C:/work/repo/src/a.js' }], rawInput: { path: 'src/a.js' } } })
    expect(read(sessionLine, 1000)).toEqual({ chunk: `${sessionLine}\n`, at: 1000, read: false })
    expect(read(pending, 1000)).toMatchObject({ at: 1000, read: true })
    expect(read(touch, 1000)).toMatchObject({ at: 1000, read: true })
  })

  it('runs the fake agent through the client loop and the parser', async () => {
    const folder = makeTempDir('machine-room-acp-')
    roots.push(folder)
    const result = await runClient({ folder, prompt: 'Do the task.', model: 'fake/other', effort: 'max' })
    expect(result.code).toBe(0)
    expect(result.stderr).not.toContain('Error')
    const lines = result.stdout.split(/\r?\n/).filter(Boolean).map((text) => JSON.parse(text))
    expect(lines[0]).toEqual({ type: 'acp_session', sessionId: 'ses_fake_parent' })
    expect(lines.at(-1)).toMatchObject({ type: 'acp_result', sessionId: 'ses_fake_parent', stopReason: 'end_turn', error: null })
    expect(lines.at(-1).usage).toEqual({ inputTokens: 12, outputTokens: 5, totalTokens: 24, thoughtTokens: 3, cachedReadTokens: 4 })
    const summary = summarizeRun({ harness: 'acp', log: result.stdout, worktree: folder })
    expect(summary.toolCalls).toBe(4)
    expect(summary.failed).toBe(0)
    expect(summary.written).toEqual(['docs/note.md'])
    expect(summary.read).toEqual(['src/a.js', 'test/a.test.js'])
    expect(summary.head).toEqual(['All done.'])
    expect(summary.costUsd).toBe(0.000123)
    expect(summary.inputTokens).toBe(16)
    expect(summary.outputTokens).toBe(8)
  })

  it('refuses a model the agent does not offer', async () => {
    const folder = makeTempDir('machine-room-acp-')
    roots.push(folder)
    const result = await runClient({ folder, prompt: 'Do the task.', model: 'missing/model', seconds: 10 })
    expect(result.code).toBe(1)
    const last = JSON.parse(result.stdout.trim().split(/\r?\n/).at(-1))
    expect(last).toMatchObject({ type: 'acp_result', stopReason: null })
    expect(last.error).toContain('The model missing/model is not one of the models the agent offers.')
  })

  it('stops an agent that does not finish before the time limit', async () => {
    const folder = makeTempDir('machine-room-acp-')
    roots.push(folder)
    const result = await runClient({ folder, prompt: 'Do the task.', seconds: 1, env: { FAKE_ACP_HANG: '1' } })
    expect(result.code).toBe(1)
    const last = JSON.parse(result.stdout.trim().split(/\r?\n/).at(-1))
    expect(last).toMatchObject({ type: 'acp_result', stopReason: null })
    expect(last.error).toBe('The prompt did not finish within 1 seconds.')
  })
})
