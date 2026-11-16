import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createBridge } from '../server/index.js'
import { HARNESS_OFF_PROBLEM } from '../server/harness-settings.js'
import { getJson } from './helpers/bridge.js'
import { makeTempDir, removeTempDir } from './helpers/tempRoot.js'

const dirs = []
const servers = []

const LANES = {
  orchestrator: {
    name: 'Orchestrator',
    harness: 'Claude Code',
    cli: { harness: 'claude', bin: process.execPath, model: 'claude-opus-5-5' },
  },
  opencode1: {
    name: 'OpenCode 1',
    harness: 'OpenCode',
    cli: { harness: 'opencode', bin: process.execPath, model: 'opencode-go/deepseek-v4.1-flash' },
  },
}

function tempDir(prefix) {
  const dir = makeTempDir(prefix)
  dirs.push(dir)
  return dir
}

function makeProject() {
  const root = tempDir('mr-proposal-harness-')
  const project = join(root, 'repo')
  const runs = join(root, 'runs')
  mkdirSync(project, { recursive: true })
  mkdirSync(runs, { recursive: true })
  return { root, project, runs }
}

async function startBridge({ project, runs }) {
  const lanesFile = join(project, 'lanes.json')
  writeFileSync(lanesFile, JSON.stringify(LANES, null, 2))
  const bridge = createBridge({
    projectRoot: project,
    port: 0,
    env: { PATH: '' },
    runsFolder: runs,
    lanesFile,
    lanesSource: { folder: runs, lanes: LANES, repoRoot: project, pollMs: 20, quietMs: 60000, primeMs: 600000 },
  })
  servers.push(bridge)
  const { url } = await bridge.start()
  return url
}

function postAsPage(url, path, body) {
  return getJson(`${url}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', Origin: url },
    body: JSON.stringify(body),
  })
}

function saveHarnessSettings(runs, settings) {
  writeFileSync(join(runs, 'harnesses.json'), JSON.stringify(settings, null, 2))
}

afterEach(async () => {
  while (servers.length > 0) await servers.pop().stop()
  while (dirs.length > 0) removeTempDir(dirs.pop())
})

describe('Proposals read the saved harness settings', () => {
  it('refuses a proposal for a harness turned off in Settings', async () => {
    const { project, runs } = makeProject()
    saveHarnessSettings(runs, { programs: {}, off: ['opencode'] })
    const url = await startBridge({ project, runs })

    const res = await postAsPage(url, '/api/family/proposals', {
      label: 'Off Worker',
      harness: 'opencode',
      model: 'opencode-go/deepseek-v4.1-flash',
    })

    expect(res.status).toBe(400)
    expect(res.body.error).toBe(HARNESS_OFF_PROBLEM)
  })

  it('accepts a proposal for a saved program when the harness is not on PATH', async () => {
    const { project, runs } = makeProject()
    saveHarnessSettings(runs, { programs: { codex: process.execPath }, off: [] })
    const url = await startBridge({ project, runs })

    const res = await postAsPage(url, '/api/family/proposals', {
      label: 'Saved Codex',
      harness: 'codex',
      model: 'gpt-6.1-terra',
    })

    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ harness: 'codex', model: 'gpt-6.1-terra' })
  })
})
