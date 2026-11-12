import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { migrateRunsFolder, runsFolder } from '../server/lanes-source.js'
import { runsFolderDefault as harnessModelsRunsFolder } from '../server/harness-models.js'
import { runsFolderDefault as orchestratorRunsFolder } from '../server/orchestrator.js'
import { runsFolderDefault as orchestratorsRunsFolder } from '../server/orchestrators.js'
import { mcpRunsDir } from '../scripts/mcp-bridge.mjs'
import { runsFolderFrom as agentRunsFolder } from '../scripts/mr-agent.mjs'
import { runsFile as recordingRunsFile } from '../scripts/run-recording.mjs'
import { makeTempDir, removeTempDir } from './helpers/tempRoot.js'

const made = []

function tempDir(prefix) {
  const dir = makeTempDir(prefix)
  made.push(dir)
  return dir
}

function oldFolder(base) {
  const folder = join(base, 'temp', 'machineroom-runs')
  mkdirSync(folder, { recursive: true })
  writeFileSync(join(folder, 'runs.jsonl'), 'one\n')
  return folder
}

afterEach(() => {
  for (const dir of made.splice(0)) removeTempDir(dir)
})

describe('the runs folder on each system', () => {
  it('answers the Windows local app data folder', () => {
    const base = tempDir('mr-runs-win-')
    const local = join(base, 'local')
    const temp = join(base, 'temp')
    expect(runsFolder({ LOCALAPPDATA: local, TEMP: temp }, 'win32')).toBe(join(local, 'MachineRoom', 'runs'))
  })

  it('falls back to the temp folder on Windows when local app data is missing', () => {
    const base = tempDir('mr-runs-win-temp-')
    const temp = join(base, 'temp')
    expect(runsFolder({ TEMP: temp }, 'win32')).toBe(join(temp, 'machineroom-runs'))
  })

  it('answers the XDG state folder elsewhere', () => {
    const base = tempDir('mr-runs-linux-')
    const state = join(base, 'state')
    expect(runsFolder({ XDG_STATE_HOME: state, TEMP: join(base, 'temp') }, 'linux')).toBe(join(state, 'machineroom', 'runs'))
  })

  it('answers the home state folder elsewhere when XDG state is missing', () => {
    const base = tempDir('mr-runs-home-')
    const home = join(base, 'home')
    expect(runsFolder({ HOME: home, TEMP: join(base, 'temp') }, 'linux')).toBe(join(home, '.local', 'state', 'machineroom', 'runs'))
  })

  it('falls back to the temp folder elsewhere when no state folder is found', () => {
    const base = tempDir('mr-runs-linux-temp-')
    const temp = join(base, 'temp')
    expect(runsFolder({ TEMP: temp }, 'linux')).toBe(join(temp, 'machineroom-runs'))
  })

  it('lets MACHINEROOM_RUNS win on every system', () => {
    const base = tempDir('mr-runs-named-')
    const named = join(base, 'named')
    expect(runsFolder({ MACHINEROOM_RUNS: named, LOCALAPPDATA: join(base, 'local') }, 'win32')).toBe(resolve(named))
    expect(runsFolder({ MACHINEROOM_RUNS: named, XDG_STATE_HOME: join(base, 'state') }, 'linux')).toBe(resolve(named))
  })
})

describe('the callers of the runs folder', () => {
  it('give the same folder as runsFolder', () => {
    const base = tempDir('mr-runs-callers-')
    const env = {
      LOCALAPPDATA: join(base, 'local'),
      XDG_STATE_HOME: join(base, 'state'),
      HOME: join(base, 'home'),
      TEMP: join(base, 'temp'),
    }
    const expected = runsFolder(env)
    expect(harnessModelsRunsFolder(env)).toBe(expected)
    expect(orchestratorRunsFolder(env)).toBe(expected)
    expect(orchestratorsRunsFolder(env)).toBe(expected)
    expect(mcpRunsDir(env)).toBe(expected)
    expect(agentRunsFolder(env)).toBe(expected)
    expect(recordingRunsFile(env)).toBe(join(expected, 'runs.jsonl'))
  })

  it('give the same named folder when MACHINEROOM_RUNS is set', () => {
    const base = tempDir('mr-runs-callers-named-')
    const named = join(base, 'named')
    const env = {
      MACHINEROOM_RUNS: named,
      LOCALAPPDATA: join(base, 'local'),
      XDG_STATE_HOME: join(base, 'state'),
      HOME: join(base, 'home'),
      TEMP: join(base, 'temp'),
    }
    expect(runsFolder(env)).toBe(resolve(named))
    expect(harnessModelsRunsFolder(env)).toBe(resolve(named))
    expect(orchestratorRunsFolder(env)).toBe(resolve(named))
    expect(orchestratorsRunsFolder(env)).toBe(resolve(named))
    expect(mcpRunsDir(env)).toBe(resolve(named))
    expect(agentRunsFolder(env)).toBe(resolve(named))
    expect(recordingRunsFile(env)).toBe(join(resolve(named), 'runs.jsonl'))
  })
})

describe('moving the old runs folder', () => {
  it('copies it once, keeps the old one and prints no real path', () => {
    const base = tempDir('mr-runs-move-')
    const old = oldFolder(base)
    const local = join(base, 'local')
    const to = join(local, 'MachineRoom', 'runs')
    const env = { LOCALAPPDATA: local, TEMP: join(base, 'temp') }
    const lines = []

    expect(migrateRunsFolder(env, 'win32', (line) => lines.push(line))).toEqual({ from: old, to })
    expect(readFileSync(join(to, 'runs.jsonl'), 'utf8')).toBe('one\n')
    expect(readFileSync(join(old, 'runs.jsonl'), 'utf8')).toBe('one\n')

    writeFileSync(join(to, 'later.txt'), 'kept\n')
    expect(migrateRunsFolder(env, 'win32', (line) => lines.push(line))).toBe(null)
    expect(readFileSync(join(to, 'later.txt'), 'utf8')).toBe('kept\n')
    expect(readFileSync(join(old, 'runs.jsonl'), 'utf8')).toBe('one\n')
    expect(lines).toEqual(['Moved the runs folder from %TEMP%\\machineroom-runs to %LOCALAPPDATA%\\MachineRoom\\runs.'])
    expect(lines[0]).not.toContain(base)
  })

  it('never copies over a new folder', () => {
    const base = tempDir('mr-runs-new-')
    const old = oldFolder(base)
    const local = join(base, 'local')
    const to = join(local, 'MachineRoom', 'runs')
    mkdirSync(to, { recursive: true })
    writeFileSync(join(to, 'keep.txt'), 'new\n')
    const lines = []

    expect(migrateRunsFolder({ LOCALAPPDATA: local, TEMP: join(base, 'temp') }, 'win32', (line) => lines.push(line))).toBe(null)
    expect(readFileSync(join(to, 'keep.txt'), 'utf8')).toBe('new\n')
    expect(existsSync(join(to, 'runs.jsonl'))).toBe(false)
    expect(readFileSync(join(old, 'runs.jsonl'), 'utf8')).toBe('one\n')
    expect(lines).toEqual([])
  })

  it('runs when the bridge or a lane asks for the folder', () => {
    const base = tempDir('mr-runs-trigger-')
    const old = oldFolder(base)
    const local = join(base, 'local')
    const to = join(local, 'MachineRoom', 'runs')
    const printed = vi.spyOn(console, 'log').mockImplementation(() => {})
    try {
      expect(runsFolder({ LOCALAPPDATA: local, TEMP: join(base, 'temp') }, 'win32')).toBe(to)
    } finally {
      printed.mockRestore()
    }
    expect(readFileSync(join(to, 'runs.jsonl'), 'utf8')).toBe('one\n')
    expect(readFileSync(join(old, 'runs.jsonl'), 'utf8')).toBe('one\n')
  })

  it('does not move anything when MACHINEROOM_RUNS names the folder', () => {
    const base = tempDir('mr-runs-named-move-')
    oldFolder(base)
    const named = join(base, 'named')
    expect(runsFolder({ MACHINEROOM_RUNS: named, LOCALAPPDATA: join(base, 'local'), TEMP: join(base, 'temp') }, 'win32')).toBe(resolve(named))
    expect(existsSync(named)).toBe(false)
  })
})
