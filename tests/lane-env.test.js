import { spawnSync } from 'node:child_process'
import { appendFileSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { childEnvironment, commandFor, createLaneLog } from '../src/briefs/run.js'
import { makeTempDir } from './helpers/tempRoot.js'

const ROUTER_NAME = ['OPENROUTER', 'API', 'KEY'].join('_')
const ANTHROPIC_NAME = ['ANTHROPIC', 'API', 'KEY'].join('_')

const RUN_LANE_SCRIPT = fileURLToPath(new URL('../scripts/run-lane.mjs', import.meta.url))
const lanes = JSON.parse(readFileSync(new URL('../docs/agents/lanes.json', import.meta.url), 'utf8'))
const cleanups = []

afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()()
})

function tempDir(prefix = 'lane-env-') {
  const dir = makeTempDir(prefix)
  cleanups.push(() => rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }))
  return dir
}

function fakeKey(head) {
  return `${head}${'q'.repeat(40)}`
}

const PARENT = {
  PATH: 'C:\\bin',
  Path: 'C:\\bin',
  SystemRoot: 'C:\\Windows',
  TEMP: 'C:\\Temp',
  USERPROFILE: 'C:\\Users\\user',
  MACHINEROOM_RUNS: 'C:\\runs',
  MACHINEROOM_LANES_FILE: 'C:\\work\\lanes.json',
  [ROUTER_NAME]: fakeKey('sk-or-v1-'),
  [ANTHROPIC_NAME]: fakeKey('sk-ant-'),
  GITHUB_TOKEN: `ghp_${'z'.repeat(36)}`,
  UNRELATED_NAME: 'kept',
}

describe('childEnvironment', () => {
  it('keeps only the allow-list and drops every secret name from the parent', () => {
    const child = childEnvironment(PARENT, 'C:\\work', { harness: 'opencode' })
    expect(child).toEqual({
      PATH: 'C:\\bin',
      Path: 'C:\\bin',
      SystemRoot: 'C:\\Windows',
      TEMP: 'C:\\Temp',
      USERPROFILE: 'C:\\Users\\user',
      PWD: 'C:\\work',
    })
  })

  it('keeps PATH and USERPROFILE for a lane', () => {
    const child = childEnvironment({ PATH: '/usr/bin', USERPROFILE: 'C:\\Users\\user' }, '/work')
    expect(child.PATH).toBe('/usr/bin')
    expect(child.USERPROFILE).toBe('C:\\Users\\user')
    expect(child.PWD).toBe('/work')
  })

  it('matches the Windows names without case', () => {
    const child = childEnvironment({ SystemRoot: 'C:\\Windows', ComSpec: 'C:\\Windows\\cmd.exe', pathext: '.EXE' }, '')
    expect(child).toEqual({ SystemRoot: 'C:\\Windows', ComSpec: 'C:\\Windows\\cmd.exe', pathext: '.EXE' })
  })

  it('gives the MachineRoom harness its own key names only', () => {
    const child = childEnvironment(PARENT, 'C:\\work', { harness: 'machineroom' })
    expect(child.OPENROUTER_API_KEY).toBe(PARENT.OPENROUTER_API_KEY)
    expect(child).not.toHaveProperty('ANTHROPIC_API_KEY')
    expect(child).not.toHaveProperty('GITHUB_TOKEN')
    expect(child).not.toHaveProperty('UNRELATED_NAME')
  })

  it('gives Hermes its OpenRouter key and no other key', () => {
    const child = childEnvironment({ ...PARENT, MACHINEROOM_API_KEY: 'fake' }, 'C:\\work', { harness: 'hermes' })
    expect(child.OPENROUTER_API_KEY).toBe(PARENT.OPENROUTER_API_KEY)
    expect(child).not.toHaveProperty('MACHINEROOM_API_KEY')
    expect(child).not.toHaveProperty('ANTHROPIC_API_KEY')
    expect(child).not.toHaveProperty('GITHUB_TOKEN')
  })

  it('gives OpenCode and Claude Code no key', () => {
    for (const harness of ['opencode', 'claude']) {
      const child = childEnvironment(PARENT, 'C:\\work', { harness })
      expect(child).not.toHaveProperty('OPENROUTER_API_KEY')
      expect(child).not.toHaveProperty('ANTHROPIC_API_KEY')
      expect(child).not.toHaveProperty('GITHUB_TOKEN')
    }
  })

  it('gives only MachineRoom the MR_AGENT_MAX_COST_USD variable', () => {
    const parentWithCost = { ...PARENT, MR_AGENT_MAX_COST_USD: '0.03' }
    const mr = childEnvironment(parentWithCost, 'C:\\work', { harness: 'machineroom' })
    expect(mr.MR_AGENT_MAX_COST_USD).toBe('0.03')
    for (const harness of ['hermes', 'opencode', 'claude']) {
      const child = childEnvironment(parentWithCost, 'C:\\work', { harness })
      expect(child).not.toHaveProperty('MR_AGENT_MAX_COST_USD')
    }
  })

  it('keeps MR_AGENT_MAX_COST_USD for MachineRoom when using a saved endpoint', () => {
    const parentWithCost = { ...PARENT, MR_AGENT_MAX_COST_USD: '0.03' }
    const mr = childEnvironment(parentWithCost, 'C:\\work', {
      harness: 'machineroom',
      model: 'local/test/model',
      endpoints: [{ name: 'local' }],
    })
    expect(mr.MR_AGENT_MAX_COST_USD).toBe('0.03')
    expect(mr).not.toHaveProperty('OPENROUTER_API_KEY')
    expect(mr).not.toHaveProperty('MACHINEROOM_API_KEY')
  })

  it('gives only MachineRoom the MR_AGENT_MINUTES variable', () => {
    const parentWithMinutes = { ...PARENT, MR_AGENT_MINUTES: '25' }
    const mr = childEnvironment(parentWithMinutes, 'C:\\work', { harness: 'machineroom' })
    expect(mr.MR_AGENT_MINUTES).toBe('25')
    for (const harness of ['hermes', 'opencode', 'claude']) {
      const child = childEnvironment(parentWithMinutes, 'C:\\work', { harness })
      expect(child).not.toHaveProperty('MR_AGENT_MINUTES')
    }
  })

  it('keeps MR_AGENT_MINUTES for MachineRoom when using a saved endpoint', () => {
    const parentWithMinutes = { ...PARENT, MR_AGENT_MINUTES: '25' }
    const mr = childEnvironment(parentWithMinutes, 'C:\\work', {
      harness: 'machineroom',
      model: 'local/test/model',
      endpoints: [{ name: 'local' }],
    })
    expect(mr.MR_AGENT_MINUTES).toBe('25')
    expect(mr).not.toHaveProperty('OPENROUTER_API_KEY')
    expect(mr).not.toHaveProperty('MACHINEROOM_API_KEY')
  })

  it('adds MACHINEROOM_RUNS and MACHINEROOM_LANES_FILE only when the runner names them', () => {
    const none = childEnvironment(PARENT, 'C:\\work')
    expect(none).not.toHaveProperty('MACHINEROOM_RUNS')
    expect(none).not.toHaveProperty('MACHINEROOM_LANES_FILE')
    const named = childEnvironment(PARENT, 'C:\\work', { names: ['MACHINEROOM_RUNS'] })
    expect(named.MACHINEROOM_RUNS).toBe('C:\\runs')
    expect(named).not.toHaveProperty('MACHINEROOM_LANES_FILE')
  })
})

describe('createLaneLog', () => {
  it('masks a key split across two chunks', () => {
    const chunks = []
    const log = createLaneLog({ write: (text) => chunks.push(text) })
    const line = `${ROUTER_NAME}=${fakeKey('sk-or-v1-')}\n`
    log.push('stdout', line.slice(0, 18))
    log.push('stdout', line.slice(18))
    log.flush()
    expect(chunks.join('')).toBe(`${ROUTER_NAME}=[key]\n`)
  })

  it('masks a key that a child prints from its environment into the log file', () => {
    const folder = tempDir()
    const logPath = join(folder, 'lane.log')
    const key = fakeKey('sk-or-v1-')
    const script = "process.stdout.write('OPENROUTER_API_KEY=' + process.env.OPENROUTER_API_KEY + '\\n')"
    const result = spawnSync(process.execPath, ['-e', script], {
      env: childEnvironment({ ...process.env, OPENROUTER_API_KEY: key }, folder, { harness: 'machineroom' }),
      encoding: 'utf8',
      timeout: 20000,
      windowsHide: true,
    })
    expect(result.status, result.stderr).toBe(0)
    const log = createLaneLog({ write: (text) => appendFileSync(logPath, text) })
    log.push('stdout', result.stdout)
    log.flush()
    const text = readFileSync(logPath, 'utf8')
    expect(text).toBe(`${ROUTER_NAME}=[key]\n`)
    expect(text).not.toContain(key)
  })
})

describe('a lane runner with the allow-list', () => {
  it('starts run-lane with --dry-run on this machine', () => {
    const base = tempDir()
    const project = join(base, 'project')
    mkdirSync(project, { recursive: true })
    const result = spawnSync(process.execPath, [RUN_LANE_SCRIPT, 'opencode', '--project', project, '--task', 'List the files.', '--dry-run'], {
      env: {
        ...process.env,
        APPDATA: 'C:\\Users\\me\\AppData\\Roaming',
        LOCALAPPDATA: 'C:\\Users\\me\\AppData\\Local',
        MACHINEROOM_RUNS: join(base, 'runs'),
        MACHINEROOM_LANES_DIR: fileURLToPath(new URL('../docs/agents', import.meta.url)),
      },
      encoding: 'utf8',
      timeout: 30000,
      windowsHide: true,
    })
    expect(result.status, result.stderr).toBe(0)
    expect(result.stdout).toContain('file:')
    expect(result.stdout).toContain(`cwd: ${project}`)
  })

  it('starts the OpenCode command with the filtered environment', (context) => {
    let command
    try {
      command = commandFor({ lane: lanes.opencode, prompt: 'List the files.', env: process.env, title: 'lane-env-test' })
    } catch {
      context.skip()
      return
    }
    const result = spawnSync(command.file, ['--version'], {
      cwd: command.cwd,
      env: childEnvironment(process.env, command.cwd, { harness: 'opencode' }),
      encoding: 'utf8',
      timeout: 30000,
      windowsHide: true,
    })
    if (result.error?.code === 'ENOENT') {
      context.skip()
      return
    }
    expect(result.status, result.stderr).toBe(0)
    expect(result.stdout).toMatch(/\d+\.\d+/)
  })
})
