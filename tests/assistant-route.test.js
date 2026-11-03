import { EventEmitter } from 'node:events'
import { spawn } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createAssistantApi, resolveOpencodeBinary, runOpencode, OUTPUT_LIMIT } from '../server/assistant.js'
import { makeTempDir, removeTempDir } from './helpers/tempRoot.js'

const slashes = (path) => path.split('/').join('\\')

function alive(pid) {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return error?.code === 'EPERM'
  }
}

async function waitUntil(fn, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (fn()) return true
    await new Promise((r) => setTimeout(r, 20))
  }
  return fn()
}

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
      readJsonBody: async () => ({ prompt, confirmed: true }),
      runner: async () => 'ok',
      model: 'fake/model',
    })
    await api.handle({ method: 'POST', headers: { origin: 'http://127.0.0.1:5173' } }, {}, new URL('http://127.0.0.1/api/assistant'))
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

describe('runOpencode process control', () => {
  it('passes --standalone and detached options to spawn', async () => {
    let passedArgs = null
    let passedOpts = null
    const child = new EventEmitter()
    child.stdout = new EventEmitter()
    child.stderr = new EventEmitter()
    const promise = runOpencode({
      model: 'opencode/test-model',
      prompt: 'hello world',
      binary: 'opencode',
      platform: 'linux',
      spawnImpl: (bin, args, opts) => {
        passedArgs = args
        passedOpts = opts
        setImmediate(() => {
          child.stdout.emit('data', JSON.stringify({ text: 'answer' }))
          child.emit('close', 0, null)
        })
        return child
      },
    })
    const result = await promise
    expect(result).toBe('answer')
    expect(passedArgs).toEqual(['run', '--standalone', '-m', 'opencode/test-model', '--format', 'json', 'hello world'])
    expect(passedOpts.detached).toBe(true)
    expect(passedOpts.windowsHide).toBe(true)
  })

  it('keeps detached off on Windows', async () => {
    let passedOpts = null
    const child = new EventEmitter()
    child.stdout = new EventEmitter()
    child.stderr = new EventEmitter()
    const promise = runOpencode({
      model: 'opencode/test-model',
      prompt: 'hello world',
      binary: 'opencode',
      platform: 'win32',
      spawnImpl: (bin, args, opts) => {
        passedOpts = opts
        setImmediate(() => {
          child.stdout.emit('data', JSON.stringify({ text: 'answer' }))
          child.emit('close', 0, null)
        })
        return child
      },
    })
    await promise
    expect(passedOpts.detached).toBe(false)
  })

  it('stops the process tree on timeout', async () => {
    let killedChild = null
    const child = new EventEmitter()
    child.pid = 9999
    child.stdout = new EventEmitter()
    child.stderr = new EventEmitter()
    const promise = runOpencode({
      model: 'opencode/test-model',
      prompt: 'hello world',
      binary: 'opencode',
      timeoutMs: 10,
      spawnImpl: () => {
        setTimeout(() => child.emit('close', null, 'SIGKILL'), 30)
        return child
      },
      killTreeImpl: (target) => {
        killedChild = target
      },
    })
    await expect(promise).rejects.toThrow('the assistant run failed')
    expect(killedChild).toBe(child)
  })

  it('stops the process tree when output exceeds the limit', async () => {
    let killedChild = null
    const child = new EventEmitter()
    child.pid = 9998
    child.stdout = new EventEmitter()
    child.stderr = new EventEmitter()
    const promise = runOpencode({
      model: 'opencode/test-model',
      prompt: 'hello world',
      binary: 'opencode',
      spawnImpl: () => {
        setImmediate(() => {
          child.stdout.emit('data', 'x'.repeat(OUTPUT_LIMIT + 10))
          child.emit('close', 1, null)
        })
        return child
      },
      killTreeImpl: (target) => {
        killedChild = target
      },
    })
    await expect(promise).rejects.toThrow('the assistant run failed')
    expect(killedChild).toBe(child)
  })

  it('a grandchild does not outlive the limit', async () => {
    const tempDir = makeTempDir('assistant-grandchild-')
    const pidFile = join(tempDir, 'grandchild.pid')
    const script = [
      "const { spawn } = require('node:child_process')",
      "const { writeFileSync } = require('node:fs')",
      "const child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60000)'], { stdio: 'ignore' })",
      `writeFileSync(${JSON.stringify(pidFile)}, String(child.pid))`,
      'setTimeout(() => {}, 60000)',
    ].join('\n')

    let grandchildPid = 0
    try {
      const promise = runOpencode({
        model: 'test',
        prompt: 'test',
        timeoutMs: 3000,
        binary: 'fake-opencode',
        spawnImpl: (bin, args, opts) => spawn(process.execPath, ['-e', script], opts),
      })
      await waitUntil(() => existsSync(pidFile))
      grandchildPid = Number(readFileSync(pidFile, 'utf8'))
      expect(grandchildPid).toBeGreaterThan(0)
      expect(alive(grandchildPid)).toBe(true)

      await expect(promise).rejects.toThrow('the assistant run failed')
      await waitUntil(() => !alive(grandchildPid))
      expect(alive(grandchildPid)).toBe(false)
    } finally {
      if (grandchildPid > 0 && alive(grandchildPid)) {
        try { process.kill(grandchildPid, 'SIGKILL') } catch {}
      }
      removeTempDir(tempDir)
    }
  }, 10000)
})
