import { describe, expect, it } from 'vitest'
import { createAssistantApi, resolveOpencodeBinary } from '../server/assistant.js'

const slashes = (path) => path.split('/').join('\\')

describe('resolveOpencodeBinary', () => {
  it('uses OPENCODE_BIN before the shim and the PATH', () => {
    const touched = []
    const found = resolveOpencodeBinary({
      env: { OPENCODE_BIN: 'C:\\tools\\opencode.exe', PATH: 'C:\\Users\\me\\AppData\\Roaming\\npm' },
      platform: 'win32',
      exists: () => {
        touched.push('shim')
        return true
      },
      check: () => {
        touched.push('path')
        return true
      },
    })
    expect(found).toBe('C:\\tools\\opencode.exe')
    expect(touched).toEqual([])
  })

  it('finds an absolute path from the PATH through a check', () => {
    expect(resolveOpencodeBinary({
      env: { PATH: '/usr/local/bin:/opt/tools/bin' },
      platform: 'linux',
      check: (candidate) => candidate === '/opt/tools/bin/opencode',
    })).toBe('/opt/tools/bin/opencode')
    expect(resolveOpencodeBinary({
      env: { PATH: 'C:\\Windows;C:\\Tools' },
      platform: 'win32',
      exists: () => false,
      check: (candidate) => candidate === 'C:\\Tools\\opencode.exe',
    })).toBe('C:\\Tools\\opencode.exe')
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

  it('returns null when nothing is found on Windows or Linux', () => {
    expect(resolveOpencodeBinary({ env: { PATH: 'C:\\Windows' }, platform: 'win32', exists: () => false, check: () => false })).toBe(null)
    expect(resolveOpencodeBinary({ env: {}, platform: 'win32', exists: () => false, check: () => false })).toBe(null)
    expect(resolveOpencodeBinary({ env: { PATH: '/usr/bin' }, platform: 'linux', check: () => false })).toBe(null)
    expect(resolveOpencodeBinary({ env: {}, platform: 'linux', check: () => false })).toBe(null)
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
