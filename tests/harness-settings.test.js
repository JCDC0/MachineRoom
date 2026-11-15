import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir, userInfo } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { createAgentLane, createAgentsConfigApi, isHarnessAvailable } from '../server/agents-config.js'
import { saveEndpoints } from '../server/endpoints.js'
import { resolveHarnessProgram } from '../server/harness-models.js'
import { readHarnessSettings, saveHarnessSettings } from '../server/harness-settings.js'

const dirs = []
function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'mr-harness-'))
  dirs.push(dir)
  return dir
}
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }) })
function fake(dir, text) {
  const file = join(dir, 'fake.mjs')
  writeFileSync(file, text)
  return file
}
function api(folder, env = { PATH: '' }) {
  const instance = createAgentsConfigApi({ runsFolder: folder, lanes: {}, env, readJsonBody: async (req) => req.body, sendJson: (req, res, status, body) => { res.status = status; res.body = body } })
  return async (path, body, origin = 'http://localhost') => {
    const res = {}
    await instance.handle({ method: body ? 'POST' : 'GET', headers: origin ? { origin } : {}, body }, res, new URL(path, 'http://localhost'))
    return res
  }
}

it('checks versions once until the page asks again', async () => {
  const dir = setup()
  const count = join(dir, 'count')
  const program = fake(dir, `import { appendFileSync } from 'node:fs'; appendFileSync(${JSON.stringify(count)}, 'x'); console.log('fake 1.0')`)
  saveHarnessSettings(dir, { programs: { claude: program }, off: [] })
  const request = api(dir)
  let row = (await request('/api/harnesses')).body.find((entry) => entry.key === 'claude')
  expect(row).toMatchObject({ ready: true, version: 'fake 1.0', enabled: true })
  await request('/api/harnesses')
  expect(readFileSync(count, 'utf8')).toBe('x')
  await request('/api/harnesses/check', { confirmed: true })
  expect(readFileSync(count, 'utf8')).toBe('xx')
  expect((await request('/api/harnesses/check', { confirmed: true }, '')).status).toBe(403)
})

it('refuses failed and slow programs', async () => {
  const dir = setup()
  const program = fake(dir, 'process.exit(1)')
  saveHarnessSettings(dir, { programs: { claude: program }, off: [] })
  const request = api(dir)
  expect((await request('/api/harnesses')).body.find((r) => r.key === 'claude')).toMatchObject({ ready: false, reason: 'The program did not answer a version check.' })
  fake(dir, 'setTimeout(() => {}, 30000)')
  const row = (await request('/api/harnesses/check', { confirmed: true })).body.find((r) => r.key === 'claude')
  expect(row).toMatchObject({ ready: false, reason: 'The program did not answer a version check.' })
}, 15000)

it('saves valid programs and refuses invalid paths and disabled lanes', async () => {
  const dir = setup()
  const program = fake(dir, 'console.log("version")')
  const request = api(dir)
  for (const path of ['relative', dir, join(dir, 'missing')]) expect((await request('/api/harnesses/settings', { confirmed: true, key: 'claude', program: path })).status).toBe(400)
  expect((await request('/api/harnesses/settings', { confirmed: true, key: 'claude', program })).status).toBe(200)
  expect(resolveHarnessProgram('claude', { runsFolder: dir, env: { PATH: '' } })).toBe(program)
  expect(isHarnessAvailable('claude', { runsFolder: dir, env: { PATH: '' } })).toBe(true)
  expect((await request('/api/harnesses/settings', { confirmed: true, key: 'claude', enabled: false })).body.enabled).toBe(false)
  expect(createAgentLane({ confirmed: true, name: 'Lane', harness: 'claude' }, { runsFolder: dir, env: { PATH: '' } }).error).toBe('That harness is turned off in Settings.')
  writeFileSync(join(dir, 'harnesses.json'), '{')
  expect(readHarnessSettings(dir)).toEqual({ programs: {}, off: [] })
})

it('reports Direct API readiness from a key or endpoint', async () => {
  const dir = setup()
  expect((await api(dir)('/api/harnesses')).body.find((r) => r.key === 'machineroom')).toMatchObject({ ready: false, reason: 'No key or endpoint is saved.' })
  expect((await api(dir, { PATH: '', MACHINEROOM_API_KEY: 'test' })('/api/harnesses')).body.find((r) => r.key === 'machineroom').ready).toBe(true)
})

it('reports Direct API ready from a saved endpoint alone', async () => {
  const dir = setup()
  saveEndpoints(dir, [{ name: 'Local', provider: 'Custom', baseUrl: 'http://127.0.0.1:11434/v1', keyName: '', models: [] }])
  const row = (await api(dir, { PATH: '' })('/api/harnesses')).body.find((r) => r.key === 'machineroom')
  expect(row).toMatchObject({ ready: true, enabled: true, program: '', version: '', reason: '' })
})

it('checks again only after ten minutes or a page request', async () => {
  const dir = setup()
  const count = join(dir, 'count')
  const program = fake(dir, `import { appendFileSync } from 'node:fs'; appendFileSync(${JSON.stringify(count)}, 'x'); console.log('fake 1.0')`)
  saveHarnessSettings(dir, { programs: { claude: program }, off: [] })
  const request = api(dir, { PATH: '' })
  vi.useFakeTimers({ toFake: ['Date'] })
  try {
    vi.setSystemTime(new Date('2026-11-15T10:00:00Z'))
    expect((await request('/api/harnesses')).body.find((r) => r.key === 'claude').ready).toBe(true)
    expect(readFileSync(count, 'utf8')).toBe('x')
    vi.setSystemTime(new Date('2026-11-15T10:09:59Z'))
    await request('/api/harnesses')
    expect(readFileSync(count, 'utf8')).toBe('x')
    vi.setSystemTime(new Date('2026-11-15T10:10:00Z'))
    await request('/api/harnesses')
    expect(readFileSync(count, 'utf8')).toBe('xx')
    vi.setSystemTime(new Date('2026-11-15T10:10:30Z'))
    await request('/api/harnesses/check', { confirmed: true })
    expect(readFileSync(count, 'utf8')).toBe('xxx')
  } finally {
    vi.useRealTimers()
  }
}, 15000)

it('masks the home folder in the program path', async () => {
  const dir = mkdtempSync(join(homedir(), 'mr-harness-home-'))
  dirs.push(dir)
  const program = fake(dir, 'console.log("fake 1.0")')
  saveHarnessSettings(dir, { programs: { claude: program }, off: [] })
  const row = (await api(dir, { PATH: '' })('/api/harnesses')).body.find((r) => r.key === 'claude')
  const label = process.platform === 'win32' ? '%USERPROFILE%' : '~'
  expect(row.program.startsWith(label)).toBe(true)
  expect(row.program).not.toContain(userInfo().username)
})

it('refuses the two writes without an Origin and still answers the list', async () => {
  const dir = setup()
  const request = api(dir, { PATH: '' })
  expect((await request('/api/harnesses', null, '')).status).toBe(200)
  expect((await request('/api/harnesses/check', { confirmed: true }, '')).status).toBe(403)
  expect((await request('/api/harnesses/settings', { confirmed: true, key: 'claude', enabled: false }, '')).status).toBe(403)
})
