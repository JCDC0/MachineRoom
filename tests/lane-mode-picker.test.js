import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { createAgentLane, readAllLanes } from '../server/agents-config.js'
import { createRunsApi } from '../server/runs.js'
import { projectRunBody } from '../src/ui/panels/runs.js'
import { waitFor } from './helpers/bridge.js'
import { makeTempDir } from './helpers/tempRoot.js'

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
