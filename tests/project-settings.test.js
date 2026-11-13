import { readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createBridge } from '../server/index.js'
import {
  CHECK_COMMAND_PROBLEM,
  checkCommandProblem,
  hasNpmTestScript,
  projectSettingsFileFor,
  readProjectSettings,
  writeProjectSettings,
} from '../server/project-settings.js'
import { createMockClient } from '../src/control/mock.js'
import { makeTempDir } from './helpers/tempRoot.js'

const cleanups = []

afterEach(async () => {
  while (cleanups.length > 0) {
    const fn = cleanups.pop()
    await fn()
  }
})

function tempDir(prefix) {
  const dir = makeTempDir(prefix)
  cleanups.push(() => rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }))
  return dir
}

async function startBridge() {
  const project = tempDir('mr-project-settings-')
  const runs = tempDir('mr-project-settings-runs-')
  writeFileSync(join(project, 'package.json'), JSON.stringify({ scripts: { test: 'node test.mjs' } }))
  const bridge = createBridge({ projectRoot: project, port: 0, runsFolder: runs, env: {} })
  cleanups.push(() => bridge.stop())
  const { url } = await bridge.start()
  return { url, project, runs }
}

function postSettings(url, body) {
  return fetch(`${url}/api/control/project-settings`, {
    method: 'POST',
    headers: { origin: 'http://localhost:5173', 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('project settings file', () => {
  it('saves, reads back and clears the check command', () => {
    const runs = tempDir('mr-project-settings-runs-')
    const file = projectSettingsFileFor('C:\\work\\demo', runs)
    expect(file).toMatch(/project-settings-[0-9a-f]{8}\.json$/)
    expect(readProjectSettings(file)).toEqual({ checkCommand: '' })

    writeProjectSettings(file, 'node scripts/check.mjs')
    expect(readProjectSettings(file)).toEqual({ checkCommand: 'node scripts/check.mjs' })
    expect(readFileSync(file, 'utf8')).toContain('node scripts/check.mjs')

    writeProjectSettings(file, '')
    expect(readProjectSettings(file)).toEqual({ checkCommand: '' })
  })

  it('refuses a too-long or two-line command with one sentence', () => {
    expect(checkCommandProblem('x'.repeat(501))).toBe(CHECK_COMMAND_PROBLEM)
    expect(checkCommandProblem('one\ntwo')).toBe(CHECK_COMMAND_PROBLEM)
    expect(checkCommandProblem('')).toBeNull()
    expect(checkCommandProblem('npm run check')).toBeNull()
    const sentence = CHECK_COMMAND_PROBLEM
    expect(sentence.endsWith('.')).toBe(true)
    expect(sentence.slice(0, -1)).not.toContain('.')
  })

  it('finds an npm test script when package.json has one', () => {
    const project = tempDir('mr-project-settings-')
    expect(hasNpmTestScript(project)).toBe(false)
    writeFileSync(join(project, 'package.json'), JSON.stringify({ scripts: { test: 'node test.mjs' } }))
    expect(hasNpmTestScript(project)).toBe(true)
    writeFileSync(join(project, 'package.json'), JSON.stringify({ scripts: {} }))
    expect(hasNpmTestScript(project)).toBe(false)
  })
})

describe('the project settings route', () => {
  it('saves, reads back and clears the setting for the room project', async () => {
    const { url } = await startBridge()
    const empty = await (await fetch(`${url}/api/control/project-settings`)).json()
    expect(empty).toEqual({ checkCommand: '', hasTestScript: true })

    const saved = await postSettings(url, { checkCommand: ' node scripts/check.mjs ', confirmed: true })
    expect(saved.status).toBe(200)
    expect(await saved.json()).toEqual({ checkCommand: 'node scripts/check.mjs', hasTestScript: true })

    const read = await (await fetch(`${url}/api/control/project-settings`)).json()
    expect(read).toEqual({ checkCommand: 'node scripts/check.mjs', hasTestScript: true })

    const cleared = await postSettings(url, { checkCommand: '', confirmed: true })
    expect(cleared.status).toBe(200)
    expect(await cleared.json()).toEqual({ checkCommand: '', hasTestScript: true })
  })

  it('refuses a page write with no Origin and a command of more than one line', async () => {
    const { url } = await startBridge()
    const noOrigin = await fetch(`${url}/api/control/project-settings`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ checkCommand: 'npm test', confirmed: true }),
    })
    expect(noOrigin.status).toBe(403)

    for (const checkCommand of ['x'.repeat(501), 'one\ntwo']) {
      const res = await postSettings(url, { checkCommand, confirmed: true })
      expect(res.status).toBe(400)
      expect(await res.json()).toEqual({ error: CHECK_COMMAND_PROBLEM })
    }
  })
})

describe('the mock project settings', () => {
  it('saves, reads back and clears the check command', async () => {
    const client = createMockClient({ latencyMs: 0 })
    expect(await client.projectSettings()).toEqual({ checkCommand: '', hasTestScript: true })
    expect(await client.saveProjectSettings({ checkCommand: 'node scripts/check.mjs' })).toEqual({
      checkCommand: 'node scripts/check.mjs',
      hasTestScript: true,
    })
    expect(await client.projectSettings()).toEqual({ checkCommand: 'node scripts/check.mjs', hasTestScript: true })
    expect(await client.saveProjectSettings({ checkCommand: '' })).toEqual({ checkCommand: '', hasTestScript: true })
    expect(await client.projectSettings()).toEqual({ checkCommand: '', hasTestScript: true })
  })

  it('refuses a too-long or two-line command with one sentence', async () => {
    const client = createMockClient({ latencyMs: 0 })
    await expect(client.saveProjectSettings({ checkCommand: 'x'.repeat(501) })).rejects.toThrow(CHECK_COMMAND_PROBLEM)
    await expect(client.saveProjectSettings({ checkCommand: 'one\ntwo' })).rejects.toThrow(CHECK_COMMAND_PROBLEM)
  })
})
