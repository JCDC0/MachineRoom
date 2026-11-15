import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir, userInfo } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { createAgentsConfigApi } from '../server/agents-config.js'
import { saveHarnessSettings } from '../server/harness-settings.js'

const dirs = []
function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'mr-harness-mask-'))
  dirs.push(dir)
  return dir
}
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }) })

function api(folder, env = { PATH: '' }) {
  const instance = createAgentsConfigApi({ runsFolder: folder, lanes: {}, env, readJsonBody: async (req) => req.body, sendJson: (req, res, status, body) => { res.status = status; res.body = body } })
  return async (path) => {
    const res = {}
    await instance.handle({ method: 'GET', headers: { origin: 'http://localhost' }, body: null }, res, new URL(path, 'http://localhost'))
    return res
  }
}

it('masks the home folder and keys in the version line', async () => {
  const dir = mkdtempSync(join(homedir(), 'mr-harness-mask-'))
  dirs.push(dir)
  const program = join(dir, 'fake.mjs')
  const key = `sk-${'a'.repeat(32)}`
  writeFileSync(program, `console.log(${JSON.stringify(`fake 1.0 ${program} ${key}`)})`)
  saveHarnessSettings(dir, { programs: { claude: program }, off: [] })
  const row = (await api(dir)('/api/harnesses')).body.find((entry) => entry.key === 'claude')
  expect(row.ready).toBe(true)
  expect(row.version.startsWith('fake 1.0')).toBe(true)
  expect(row.version.length).toBeLessThanOrEqual(80)
  expect(row.version).toContain('[key]')
  expect(row.version).not.toMatch(/sk-[A-Za-z0-9_-]{20,}/)
  expect(row.version).not.toContain(program)
  expect(row.version).not.toContain(userInfo().username)
})
