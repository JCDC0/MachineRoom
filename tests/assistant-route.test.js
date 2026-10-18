import { describe, expect, it } from 'vitest'
import { createAssistantApi, resolveOpencodeBinary } from '../server/assistant.js'

const slashes = (path) => path.split('/').join('\\')

describe('resolveOpencodeBinary', () => {
  it('uses OPENCODE_BIN when it is set', () => {
    expect(resolveOpencodeBinary({ env: { OPENCODE_BIN: 'C:\\tools\\opencode.exe', PATH: '' }, platform: 'win32' })).toBe('C:\\tools\\opencode.exe')
  })

  it('uses the plain name away from Windows', () => {
    expect(resolveOpencodeBinary({ env: { PATH: '/usr/bin' }, platform: 'linux' })).toBe('opencode')
  })

  it('finds the real executable behind the npm shim on Windows, because Node cannot start a cmd file', () => {
    const shimFolder = 'C:\\Users\\me\\AppData\\Roaming\\npm'
    const wanted = `${shimFolder}\\node_modules\\@opencode\\cli\\bin\\opencode.exe`
    const found = resolveOpencodeBinary({
      env: { PATH: `C:\\Windows;${shimFolder};C:\\Other` },
      platform: 'win32',
      exists: (path) => slashes(path) === wanted,
    })
    expect(slashes(found)).toBe(wanted)
  })

  it('falls back to the plain name when no shim folder is on the path', () => {
    expect(resolveOpencodeBinary({ env: { PATH: 'C:\\Windows' }, platform: 'win32', exists: () => false })).toBe('opencode')
    expect(resolveOpencodeBinary({ env: {}, platform: 'win32', exists: () => false })).toBe('opencode')
  })
})

describe('assistant route prompt checks', () => {
  async function post(prompt) {
    const replies = []
    const api = createAssistantApi({
      sendJson: (req, res, status, body) => replies.push({ status, body }),
      readJsonBody: async () => ({ prompt }),
      runner: async () => 'ok',
      model: 'fake/model',
    })
    await api.handle({ method: 'POST' }, {}, new URL('http://127.0.0.1/api/assistant'))
    return replies[0]
  }

  it('refuses a prompt that starts with a dash, so it cannot be read as an option', async () => {
    expect(await post('--dir C:\\')).toEqual({ status: 400, body: { error: 'The prompt cannot start with a dash.' } })
    expect((await post('  -m other/model')).status).toBe(400)
  })

  it('accepts an ordinary prompt', async () => {
    expect(await post('You route one request')).toEqual({ status: 200, body: { text: 'ok' } })
  })
})
