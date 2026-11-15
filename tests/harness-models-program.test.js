import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { saveAgentsConfig } from '../server/agents-config.js'
import { getHarnessModels, resolveHarnessProgram } from '../server/harness-models.js'
import { makeTempDir, removeTempDir } from './helpers/tempRoot.js'

const cleanups = []

afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()()
})

function tempDir(prefix = 'mr-hm-program-') {
  const dir = makeTempDir(prefix)
  cleanups.push(() => removeTempDir(dir))
  return dir
}

function writeProgram(path) {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, '')
  return path
}

describe('harness program lookup', () => {
  it.skipIf(process.platform !== 'win32')('finds the default OpenCode program in %APPDATA% with no lane', () => {
    const appData = join(tempDir('appdata-'), 'Roaming')
    const program = writeProgram(join(appData, 'npm', 'node_modules', '@opencode', 'cli', 'bin', 'opencode.exe'))

    const found = resolveHarnessProgram('opencode', {
      lanes: {},
      env: { APPDATA: appData, PATH: '', Path: '' },
      platform: 'win32',
    })

    expect(found).toBe(program)
  })

  it.skipIf(process.platform !== 'win32')('finds the Codex app program with no codex on the PATH', () => {
    const localAppData = join(tempDir('codex-app-'), 'Local')
    const program = writeProgram(join(localAppData, 'OpenAI', 'Codex', 'bin', '0123456789abcdef', 'codex.exe'))
    const env = { LOCALAPPDATA: localAppData, PATH: '', Path: '' }

    expect(resolveHarnessProgram('codex', { lanes: {}, env, platform: 'win32' })).toBe(program)
    expect(
      resolveHarnessProgram('codex', {
        lanes: { codex: { cli: { harness: 'codex', bin: 'codex' } } },
        env,
        platform: 'win32',
      })
    ).toBe(program)
  })

  it.skipIf(process.platform !== 'win32')('finds the program of a lane made in the family tree', () => {
    const folder = tempDir('family-')
    const runs = join(folder, 'runs')
    const localAppData = join(folder, 'Local')
    const program = writeProgram(join(localAppData, 'agy', 'bin', 'agy.exe'))
    saveAgentsConfig(runs, {
      agents: [{ key: 'agy-1', name: 'Made AGY', harness: 'agy', model: 'gemini-3.8-flash-high' }],
    })

    const found = resolveHarnessProgram('agy', {
      lanes: {},
      runsFolder: runs,
      env: { LOCALAPPDATA: localAppData, PATH: '', Path: '' },
      platform: 'win32',
    })

    expect(found).toBe(program)
  })

  it('keeps the not found error with no lane and no program', async () => {
    const runs = tempDir('missing-')
    const appData = join(runs, 'Roaming')
    mkdirSync(appData, { recursive: true })
    const env = { APPDATA: appData, LOCALAPPDATA: join(runs, 'Local'), PATH: '', Path: '' }

    const opencode = await getHarnessModels('opencode', { runsFolder: runs, lanes: {}, env, platform: 'win32' })
    expect(opencode.source).toBe('list')
    expect(opencode.error).toBe('The program for opencode was not found.')

    const codex = await getHarnessModels('codex', { runsFolder: runs, lanes: {}, env, platform: 'win32' })
    expect(codex.source).toBe('list')
    expect(codex.error).toBe('The program for codex was not found.')
  })
})
