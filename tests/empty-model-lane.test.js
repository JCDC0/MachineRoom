import { rmSync } from 'node:fs'
import { afterEach, expect, it } from 'vitest'
import { createAgentLane, createAgentsConfigApi, readAgentsConfig, saveAgentsConfig } from '../server/agents-config.js'
import { saveEndpoints } from '../server/endpoints.js'
import { harnessByKey } from '../src/harnesses/index.js'
import { makeTempDir } from './helpers/tempRoot.js'

const dirs = []
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }) })
function setup() {
  const runsFolder = makeTempDir('empty-model-')
  dirs.push(runsFolder)
  const lanes = { opencode: { cli: { harness: 'opencode', bin: process.execPath } } }
  const options = { runsFolder, lanes, env: {} }
  return options
}
async function update(options, key, model) {
  const api = createAgentsConfigApi({ ...options, readJsonBody: async () => ({ confirmed: true, model }), sendJson: (req, res, status, body) => { req.reply = { status, body } } })
  const req = { method: 'POST', headers: { origin: 'http://localhost' } }
  await api.handle(req, {}, new URL(`/api/lanes/${key}/update`, 'http://localhost'))
  return req.reply
}

it('creates and saves an OpenCode lane at the harness default', () => {
  const options = setup()
  const result = createAgentLane({ name: 'Code', harness: 'opencode', model: '', confirmed: true }, options)
  expect(result.ok).toBe(true)
  expect(readAgentsConfig(options.runsFolder).agents[0].model).toBe('')
})

it('requires a model for Direct API and its endpoint', () => {
  const options = setup()
  saveEndpoints(options.runsFolder, [{ name: 'Local', provider: 'Ollama', baseUrl: 'http://127.0.0.1:11434/v1', keyName: '', models: ['model'] }])
  for (const endpoint of [undefined, 'Local']) {
    const result = createAgentLane({ name: 'Direct', harness: 'machineroom', model: '', endpoint, confirmed: true }, options)
    expect(result).toMatchObject({ ok: false, status: 400, error: 'The model  is not available for machineroom.' })
  }
})

it('updates CLI defaults while still rejecting unknown and Direct API models', async () => {
  const options = setup()
  saveEndpoints(options.runsFolder, [{ name: 'Local', provider: 'Ollama', baseUrl: 'http://127.0.0.1:11434/v1', keyName: '', models: ['model'] }])
  saveAgentsConfig(options.runsFolder, { agents: [
    { key: 'opencode-1', name: 'Code', harness: 'opencode', model: 'opencode-go/deepseek-v4.1-flash' },
    { key: 'machineroom-1', name: 'Direct', harness: 'machineroom', model: 'Local/model', endpoint: 'Local' },
    { key: 'machineroom-2', name: 'Direct', harness: 'machineroom', model: 'model' },
  ] })
  expect((await update(options, 'opencode-1', '')).status).toBe(200)
  expect(readAgentsConfig(options.runsFolder).agents[0].model).toBe('')
  expect((await update(options, 'opencode-1', 'unknown-model')).status).toBe(400)
  expect((await update(options, 'machineroom-1', '')).status).toBe(400)
  expect((await update(options, 'machineroom-2', '')).status).toBe(400)
})

const commands = {
  claude: ['-p', 'prompt', '--output-format', 'stream-json', '--verbose', '--model', 'model', '--dangerously-skip-permissions'],
  opencode: ['run', '--standalone', '--format', 'json', '--model', 'model#high', '--auto', '--title', 'title', 'prompt'],
  hermes: ['-z', 'prompt', '-m', 'model', '--provider', 'provider', '--reasoning', 'high'],
  codex: ['exec', '--json', '--model', 'model', '--sandbox', 'workspace-write', '--skip-git-repo-check', '-c', 'model_reasoning_effort=high', 'prompt'],
  agy: ['--print', 'prompt', '--output-format', 'stream-json', '--model', 'model', '--dangerously-skip-permissions'],
}
for (const [key, expected] of Object.entries(commands)) {
  it(`${key} omits an empty model and preserves a named model`, () => {
    const command = (model) => harnessByKey[key].command({ cli: { bin: key, model, provider: 'provider' }, prompt: 'prompt', title: 'title', reasoning: 'high', folder: 'project' }).args
    expect(command('model')).toEqual(expected)
    const args = command('')
    expect(args).not.toContain(key === 'hermes' ? '-m' : '--model')
    expect(args).not.toContain('')
    expect(args).not.toContain('#high')
  })
}
