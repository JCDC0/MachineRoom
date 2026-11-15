import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { act, createElement } from 'react'
import { afterEach, expect, it } from 'vitest'
import { createAgentLane, createAgentsConfigApi, readAllLanes } from '../server/agents-config.js'
import { createRunsApi } from '../server/runs.js'
import { laneModesFor } from '../src/control/modes.js'
import FamilyTree from '../src/ui/FamilyTree.jsx'
import { projectRunBody } from '../src/ui/panels/runs.js'
import { waitFor } from './helpers/bridge.js'
import { makeTempDir } from './helpers/tempRoot.js'
import { click, withDom } from './helpers/uiDom.js'

const dirs = []
const apis = []
function folder() { const dir = makeTempDir('mr-mode-picker-'); dirs.push(dir); return dir }
afterEach(() => {
  for (const api of apis.splice(0)) api.stopAll()
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
})

function create(mode) {
  const runsFolder = folder()
  const lanes = { base: { cli: { harness: 'opencode', bin: process.execPath, mode: 'plan' } } }
  const result = createAgentLane({ confirmed: true, name: 'Coder', harness: 'opencode', mode }, { runsFolder, lanes })
  return { result, lanes: readAllLanes({ lanesJson: lanes, runsFolder }) }
}

it.each(['edits', 'choice'])('saves %s in the lane cli', (mode) => {
  const { result, lanes } = create(mode)
  expect(result.status).toBe(200)
  expect(lanes[result.agent.key].cli.mode).toBe(mode)
})
it('refuses an unknown mode', () => expect(create('unknown').result.status).toBe(400))
it('puts the selected Dispatch mode in the run request', () => {
  expect(projectRunBody({ task: 'Work', mode: 'edits' })).toMatchObject({ task: 'Work', mode: 'edits' })
})

function route(mode) {
  const root = folder()
  const runs = join(root, 'runs')
  mkdirSync(runs)
  const lanesFile = join(root, 'lanes.json')
  writeFileSync(lanesFile, JSON.stringify({ coder: { name: 'Coder', cli: { harness: 'opencode', bin: 'opencode', mode } } }))
  const out = join(root, 'args.json')
  const script = join(root, 'runner.mjs')
  writeFileSync(script, `import { writeFileSync } from 'node:fs'; writeFileSync(${JSON.stringify(out)}, JSON.stringify(process.argv.slice(2)))`)
  let body, answer
  const api = createRunsApi({ projectRoot: root, lanesFile, runsFolder: runs, runnerCommand: { file: process.execPath, args: [script] }, activeLanes: { isChosen: () => true, isLaneActive: () => true }, orchestrators: () => ({ idForToken: () => 'orchestrator', sectorForLane: () => null }), readJsonBody: async () => body, sendJson: (req, res, status, result) => { answer = { status, body: result } } })
  apis.push(api)
  return { api, out, async post(request, page) { body = request; await api.handle({ method: 'POST', headers: page ? { origin: 'http://localhost:5173' } : { 'x-machineroom-orchestrator': 'test' } }, {}, new URL('http://localhost/api/control/runs')); return answer } }
}

it.each([['choice', false, 202], ['edits', false, 400], ['edits', true, 202]])('applies run mode for saved %s and owner %s', async (saved, page, status) => {
  const { api, out, post } = route(saved)
  const result = await post({ lane: 'coder', task: 'Work', mode: 'plan', confirmed: true }, page)
  expect(result.status).toBe(status)
  if (status === 400) expect(result.body.error).toContain('edits')
  else {
    const args = await waitFor(() => { try { return JSON.parse(readFileSync(out, 'utf8')) } catch { return null } }, { what: 'runner args' })
    expect(args.slice(args.indexOf('--mode'), args.indexOf('--mode') + 2)).toEqual(['--mode', 'plan'])
    await waitFor(() => !api.isRunning('coder'), { what: 'run end' })
  }
})

it('leaves ask out of the lane modes', () => {
  expect(laneModesFor('claude').map((mode) => mode.id)).toEqual(['plan', 'edits', 'auto', 'bypass'])
  expect(laneModesFor('opencode').map((mode) => mode.id)).toEqual(['plan', 'edits', 'auto'])
})

const PICKER_FAMILY = {
  nodes: [
    {
      id: 'orchestrator',
      kind: 'orchestrator',
      label: 'Orchestrator',
      harness: 'claude',
      model: 'opus',
      effort: 'high',
      parent: null,
      children: [],
      active: true,
      working: false,
    },
  ],
  keys: [],
  proposals: [],
}
const PICKER_HARNESSES = {
  harnesses: [
    { key: 'claude', name: 'Claude Code', available: true, models: [{ id: 'sonnet', label: 'Sonnet' }], efforts: ['low', 'high'] },
    { key: 'opencode', name: 'OpenCode', available: true, models: [{ id: 'opencode-go/deepseek-v4.1-flash', label: 'DeepSeek V4.1 Flash' }], efforts: ['low', 'max'] },
  ],
}
function pickerClient() {
  return {
    family: async () => PICKER_FAMILY,
    lanes: async () => ({ lanes: [], max: 4, chosen: true }),
    harnesses: async () => PICKER_HARNESSES,
    harnessModels: async (options = {}) => ({ harness: typeof options === 'string' ? options : options.harness ?? '', models: [] }),
    models: async () => ({ models: [] }),
    orchestrators: async () => [{ id: 'orchestrator', name: 'Orchestrator' }],
  }
}

it('lists no Ask in the Add child mode select for Claude Code', async () => {
  await withDom(async ({ container, root }) => {
    await act(async () => {
      root.render(createElement(FamilyTree, { client: pickerClient() }))
    })
    await act(async () => {})
    await click(root, container.querySelector('.mr-family-add'))
    const form = container.querySelector('.mr-family-child')
    expect(form).not.toBeNull()
    const claude = form.querySelectorAll('.mr-side-harness').find((button) => button.textContent.trim() === 'Claude Code')
    await click(root, claude)
    const select = form.querySelector('select[aria-label="New agent mode"]')
    expect(select).not.toBeNull()
    expect(select.options.map((option) => option.textContent)).toEqual(['Plan', 'Edits', 'Auto', 'Bypass', "Orchestrator's choice"])
  })
})

function agentsPost(lanes, runsFolder, body) {
  let answer = null
  const api = createAgentsConfigApi({
    runsFolder,
    lanes,
    env: {},
    readJsonBody: async () => body,
    sendJson: (req, res, status, result) => {
      answer = { status, body: result }
    },
  })
  return async (path) => {
    await api.handle({ method: 'POST', headers: { origin: 'http://localhost:5173' } }, {}, new URL(path, 'http://localhost'))
    return answer
  }
}

it('refuses ask when a lane is created or saved', async () => {
  const runsFolder = folder()
  const lanes = { base: { cli: { harness: 'claude', bin: process.execPath } } }
  const created = await agentsPost(lanes, runsFolder, { name: 'Coder', harness: 'claude', model: 'claude-haiku-5-5', mode: 'ask', confirmed: true })('/api/lanes/create')
  expect(created.status).toBe(400)
  expect(created.body.error).toBe('The mode ask is not available for claude.')

  const made = createAgentLane({ name: 'Writer', harness: 'claude', model: 'claude-haiku-5-5', mode: 'plan', confirmed: true }, { runsFolder, lanes })
  expect(made.status).toBe(200)
  const updated = await agentsPost(lanes, runsFolder, { mode: 'ask', confirmed: true })(`/api/lanes/${made.agent.key}/update`)
  expect(updated.status).toBe(400)
  expect(updated.body.error).toBe('The mode ask is not available for claude.')
  expect(readAllLanes({ lanesJson: lanes, runsFolder })[made.agent.key].cli.mode).toBe('plan')
})
