import { spawn } from 'node:child_process'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { request as httpRequest } from 'node:http'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { createBridge } from '../server/index.js'
import { makeTempDir } from './helpers/tempRoot.js'

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const BIN = join(rootDir, 'bin', 'machine-room.mjs')
const cleanups = []

afterEach(async () => {
  while (cleanups.length > 0) {
    const cleanup = cleanups.pop()
    try {
      await cleanup()
    } catch {}
  }
})

function makeDist() {
  const base = makeTempDir('machine-room-serve-')
  const dist = join(base, 'dist')
  mkdirSync(dist, { recursive: true })
  writeFileSync(join(dist, 'index.html'), '<!doctype html><title>Room</title>')
  writeFileSync(join(dist, 'app.js'), 'console.log("room")\n')
  writeFileSync(join(dist, 'style.css'), 'body { color: white; }\n')
  writeFileSync(join(dist, 'data.jsonl'), '{"a":1}\n')
  writeFileSync(join(dist, 'blob.bin'), Buffer.from([0, 1, 2, 3]))
  writeFileSync(join(base, 'outside.txt'), 'outside secret')
  cleanups.push(() => rmSync(base, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }))
  return { base, dist }
}

async function startBridge(staticDir) {
  const base = makeTempDir('machine-room-bridge-')
  cleanups.push(() => rmSync(base, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }))
  const runs = join(base, 'runs')
  mkdirSync(runs, { recursive: true })
  const bridge = createBridge({
    port: 0,
    projectRoot: base,
    env: {},
    staticDir,
    lanesSource: { folder: runs, lanes: {}, repoRoot: base, pollMs: 20 },
  })
  const info = await bridge.start()
  cleanups.push(() => bridge.stop())
  return { base, url: `http://127.0.0.1:${info.port}` }
}

async function startWithDist() {
  const { base, dist } = makeDist()
  const started = await startBridge(dist)
  return { ...started, dist }
}

function rawGet(base, path, headers = {}) {
  const { hostname, port } = new URL(base)
  return new Promise((resolveResult, reject) => {
    const request = httpRequest(
      {
        hostname,
        port,
        path,
        method: 'GET',
        headers: { Host: `${hostname}:${port}`, ...headers },
      },
      (response) => {
        const chunks = []
        response.on('data', (chunk) => chunks.push(chunk))
        response.on('end', () => {
          resolveResult({ status: response.statusCode, body: Buffer.concat(chunks).toString('utf8') })
        })
      },
    )
    request.on('error', reject)
    request.end()
  })
}

function waitForExit(child, timeoutMs = 8000) {
  return new Promise((resolveExit, rejectExit) => {
    if (child.exitCode !== null || child.signalCode !== null) {
      resolveExit({ code: child.exitCode, signal: child.signalCode })
      return
    }
    const timer = setTimeout(() => rejectExit(new Error('the child process did not exit')), timeoutMs)
    child.once('exit', (code, signal) => {
      clearTimeout(timer)
      resolveExit({ code, signal })
    })
  })
}

function childEnv(tempRoot) {
  const env = { ...process.env, PORT: '5174' }
  delete env.PAPERCLIP_URL
  delete env.PAPERCLIP_COMPANY_ID
  if (tempRoot) {
    env.TEMP = tempRoot
    env.TMP = tempRoot
  }
  return env
}

describe('static viewer files from the bridge', () => {
  it('serves index.html at the root', async () => {
    const { url } = await startWithDist()
    const response = await fetch(`${url}/`)
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('text/html; charset=utf-8')
    expect(await response.text()).toContain('<title>Room</title>')
  })

  it.each([
    ['/app.js', 'text/javascript; charset=utf-8'],
    ['/style.css', 'text/css; charset=utf-8'],
    ['/data.jsonl', 'application/x-ndjson; charset=utf-8'],
    ['/blob.bin', 'application/octet-stream'],
  ])('serves %s as %s', async (path, type) => {
    const { url } = await startWithDist()
    const response = await fetch(`${url}${path}`)
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe(type)
  })

  it('keeps the Host and Origin checks in front of the viewer', async () => {
    const { url } = await startWithDist()
    expect((await rawGet(url, '/', { Host: 'evil.example' })).status).toBe(403)
    expect((await rawGet(url, '/', { Origin: 'http://evil.example' })).status).toBe(403)
  })

  it('serves index.html for a deep link with no file extension', async () => {
    const { url } = await startWithDist()
    const response = await fetch(`${url}/room/agents/alpha`)
    expect(response.status).toBe(200)
    expect(await response.text()).toContain('<title>Room</title>')
  })

  it('answers HEAD without a body', async () => {
    const { url } = await startWithDist()
    const response = await fetch(`${url}/app.js`, { method: 'HEAD' })
    expect(response.status).toBe(200)
    expect(response.headers.get('content-length')).toBe(String(Buffer.byteLength('console.log("room")\n')))
    expect(await response.text()).toBe('')
  })

  it('keeps the JSON 404 for an unknown API path', async () => {
    const { url } = await startWithDist()
    const response = await fetch(`${url}/api/x`)
    expect(response.status).toBe(404)
    expect(response.headers.get('content-type')).toContain('application/json')
    expect(await response.json()).toEqual({ error: 'not found' })
  })

  it('refuses a POST to a static path', async () => {
    const { url } = await startWithDist()
    const response = await fetch(`${url}/app.js`, { method: 'POST' })
    expect([404, 405]).toContain(response.status)
  })

  it('never serves a file outside the dist folder', async () => {
    const { url } = await startWithDist()
    const attempts = [
      '/../package.json',
      '/%2e%2e/package.json',
      '/..%5cpackage.json',
      '/C:/Windows/win.ini',
      '/../outside.txt',
      '/%2e%2e/outside.txt',
      '/..%5coutside.txt',
      '/%00index.html',
    ]
    for (const path of attempts) {
      const result = await rawGet(url, path)
      expect(result.status, path).toBe(404)
      expect(result.body, path).not.toContain('outside secret')
    }
  })

  it('answers 404 for the root when no staticDir is set', async () => {
    const { url } = await startBridge(undefined)
    const response = await fetch(`${url}/`)
    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({ error: 'not found' })
  })
})

describe('machine-room bin', () => {
  it('asks for a build when the dist folder has no index.html', async () => {
    const { dist } = makeDist()
    rmSync(join(dist, 'index.html'))
    const child = spawn(process.execPath, [BIN, '--dist', dist], { env: childEnv(join(dist, '..')), stdio: ['ignore', 'pipe', 'pipe'] })
    cleanups.push(() => {
      if (child.exitCode === null && child.signalCode === null) child.kill()
    })
    let output = ''
    child.stdout.on('data', (chunk) => {
      output += chunk
    })
    child.stderr.on('data', (chunk) => {
      output += chunk
    })
    const { code } = await waitForExit(child)
    expect(code).toBe(1)
    expect(output).toContain('Build the viewer first with npm run build.')
  }, 15000)

  it('serves the API and the viewer on one port', async () => {
    const { base, dist } = makeDist()
    const child = spawn(process.execPath, [BIN, '--dist', dist, '--root', base, '--port', '0', '--lanes'], {
      env: childEnv(base),
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    cleanups.push(() => {
      if (child.exitCode === null && child.signalCode === null) child.kill()
    })
    const line = await new Promise((resolveLine, rejectLine) => {
      let output = ''
      let errors = ''
      const timer = setTimeout(() => {
        rejectLine(new Error(`the bin printed no start line. stderr: ${errors}`))
      }, 8000)
      child.stdout.on('data', (chunk) => {
        output += chunk
        const match = /^(machine-room: open (http:\/\/127\.0\.0\.1:\d+\/\?live&bridge=http:\/\/127\.0\.0\.1:\d+))$/m.exec(output)
        if (match) {
          clearTimeout(timer)
          resolveLine(match[1])
        }
      })
      child.stderr.on('data', (chunk) => {
        errors += chunk
      })
      child.once('exit', (code) => {
        clearTimeout(timer)
        rejectLine(new Error(`the bin exited ${code}. stderr: ${errors}`))
      })
    })
    const openUrl = line.replace(/^machine-room: open /, '')
    const url = new URL(openUrl).origin
    expect(line).toBe(`machine-room: open ${url}/?live&bridge=${url}`)

    const health = await fetch(`${url}/api/health`)
    expect(health.status).toBe(200)
    expect(await health.json()).toMatchObject({ ok: true, lanes: true, sessions: false })

    const viewer = await fetch(openUrl)
    expect(viewer.status).toBe(200)
    expect(await viewer.text()).toContain('<title>Room</title>')

    child.kill()
    await waitForExit(child)
  }, 15000)

  it('prints the help and exits cleanly', async () => {
    const child = spawn(process.execPath, [BIN, '--help'], { env: childEnv(), stdio: ['ignore', 'pipe', 'pipe'] })
    let output = ''
    child.stdout.on('data', (chunk) => {
      output += chunk
    })
    const { code } = await waitForExit(child)
    expect(code).toBe(0)
    expect(output).toContain('Usage: machine-room')
  }, 15000)
})
