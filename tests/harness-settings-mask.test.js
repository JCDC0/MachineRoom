import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, userInfo } from 'node:os'
import { join } from 'node:path'
import { act, createElement } from 'react'
import { afterEach, expect, it } from 'vitest'
import { createAgentsConfigApi } from '../server/agents-config.js'
import { saveHarnessSettings } from '../server/harness-settings.js'
import HarnessesSettings from '../src/ui/HarnessesSettings.jsx'
import { buttonWithText, type, withDom } from './helpers/uiDom.js'

const dirs = []
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }) })

function api(folder, env = { PATH: '' }) {
  const instance = createAgentsConfigApi({ runsFolder: folder, lanes: {}, env, readJsonBody: async (req) => req.body, sendJson: (req, res, status, body) => { res.status = status; res.body = body } })
  return async (path) => {
    const res = {}
    await instance.handle({ method: 'GET', headers: { origin: 'http://localhost' }, body: null }, res, new URL(path, 'http://localhost'))
    return res
  }
}

function programClient(program) {
  const rows = [{
    key: 'claude',
    name: 'Claude Code',
    available: true,
    ready: true,
    enabled: true,
    program,
    version: '2.1.0',
    reason: '',
    models: [],
    efforts: [],
  }]
  return {
    harnesses: async () => rows,
    checkHarnesses: async () => rows,
    harnessSettings: async () => ({ harness: { ...rows[0] }, harnesses: rows.map((item) => ({ ...item })) }),
    keys: async () => [],
    endpoints: async () => [],
    subscribe: () => () => {},
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

it('starts the Program field empty with the saved path beside it, and Save waits for a typed path', async () => {
  const masked = join('%USERPROFILE%', 'Tools', 'claude.exe')
  await withDom(async ({ container, root }) => {
    await act(async () => {
      root.render(createElement(HarnessesSettings, { client: programClient(masked) }))
    })
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    const row = container.querySelector('[data-harness="claude"]')
    const input = row.querySelector('input')
    expect(input.value).toBe('')
    expect(row.textContent).toContain(masked)
    expect(buttonWithText(row, 'Save').getAttribute('disabled')).not.toBeNull()
    await type(root, input, 'C:\\Tools\\claude\\claude.exe')
    expect(buttonWithText(row, 'Save').getAttribute('disabled')).toBeNull()
  })
})
