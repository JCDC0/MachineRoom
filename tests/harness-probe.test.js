import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { userInfo } from 'node:os'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createAgentsConfigApi } from '../server/agents-config.js'
import { PROBE_RUNNING_PROBLEM, probeHarness } from '../server/harness-probe.js'
import { makeTempDir } from './helpers/tempRoot.js'

let runs
const PRINT_OK = `console.log(JSON.stringify({ type: 'result', result: 'OK' }))`

function fakeProgram(name, source) {
  const file = join(runs, name)
  writeFileSync(file, source)
  writeFileSync(join(runs, 'harnesses.json'), JSON.stringify({ programs: { claude: file } }))
}

beforeEach(() => {
  runs = makeTempDir('probe')
  mkdirSync(runs, { recursive: true })
})
afterEach(() => rmSync(runs, { recursive: true, force: true }))

describe('probeHarness', () => {
  it('reaches a harness whose reply says OK', async () => {
    fakeProgram('ok.mjs', PRINT_OK)
    const { status, body } = await probeHarness('claude', { runsFolder: runs })
    expect(status).toBe(200)
    expect(body).toMatchObject({ key: 'claude', status: 'reached', line: '' })
  })

  it('fails with the first error line, masked', async () => {
    const home = ['C:', 'Users', userInfo().username, 'x'].join('\\')
    fakeProgram('bad.mjs', `console.error(${JSON.stringify(`Please sign in again. ${home} ${'sk-' + 'ant-'}api03-abcdefghijklmnopqrstuvwxyz0123456789`)})
process.exit(1)`)
    const { body } = await probeHarness('claude', { runsFolder: runs })
    expect(body.status).toBe('failed')
    expect(body.line).toContain('Please sign in again.')
    expect(body.line).not.toContain(userInfo().username)
    expect(body.line).not.toContain('abcdefghijklmnopqrstuvwxyz')
  })

  it('is unknown and kills the process when it outlasts the limit', async () => {
    const pidFile = join(runs, 'pid.txt')
    fakeProgram('slow.mjs', `import { writeFileSync } from 'node:fs'\nwriteFileSync(${JSON.stringify(pidFile)}, String(process.pid))\nsetTimeout(() => {}, 30000)`)
    const { body } = await probeHarness('claude', { runsFolder: runs, limitMs: 1500 })
    expect(body.status).toBe('unknown')
    const pid = Number(readFileSync(pidFile, 'utf8'))
    expect(() => process.kill(pid, 0)).toThrow()
  })

  it('refuses a second probe while one runs', async () => {
    fakeProgram('slow2.mjs', 'setTimeout(() => {}, 30000)')
    const first = probeHarness('claude', { runsFolder: runs, limitMs: 1500 })
    const second = await probeHarness('claude', { runsFolder: runs })
    expect(second).toEqual({ status: 409, error: PROBE_RUNNING_PROBLEM })
    await first
  })

  it('answers 409 for a harness that is off', async () => {
    writeFileSync(join(runs, 'harnesses.json'), JSON.stringify({ off: ['claude'] }))
    expect((await probeHarness('claude', { runsFolder: runs })).status).toBe(409)
  })
})

describe('probe route', () => {
  function call(headers, body) {
    return new Promise((done) => {
      const api = createAgentsConfigApi({
        runsFolder: runs,
        lanes: {},
        readJsonBody: async () => body,
        sendJson: (req, res, status, data) => done({ status, data }),
      })
      api.handle({ method: 'POST', headers }, {}, new URL('http://x/api/harnesses/claude/probe'))
    })
  }

  it('refuses a request with no page origin', async () => {
    expect((await call({}, { confirmed: true })).status).toBe(403)
  })

  it('refuses an unconfirmed request', async () => {
    expect((await call({ origin: 'http://localhost' }, {})).status).toBe(400)
  })

  it('answers a confirmed page request', async () => {
    fakeProgram('ok2.mjs', PRINT_OK)
    const { status, data } = await call({ origin: 'http://localhost' }, { confirmed: true })
    expect(status).toBe(200)
    expect(data.status).toBe('reached')
  })
})
