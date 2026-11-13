#!/usr/bin/env node
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { printedRunsFolder } from '../server/printed-path.js'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const DEFAULT_PORT = 5180
const DEFAULT_OUT = join(ROOT, 'docs', 'images')
const VIEWPORT = { width: 1600, height: 1000 }
const FILE_LIMIT = 400 * 1024

function valueOf(name, fallback) {
  const args = process.argv.slice(2)
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    if (arg === name) {
      const next = args[index + 1]
      if (next && !next.startsWith('--')) return next
    }
    if (arg.startsWith(`${name}=`)) return arg.slice(name.length + 1)
  }
  return fallback
}

function errorCode(error) {
  if (typeof error?.code === 'string' && error.code) return error.code
  const message = String(error?.message ?? error).trim()
  return message || 'no error code'
}

export function chromePath({ env = process.env, readFolder = readdirSync } = {}) {
  if (env.MACHINEROOM_CHROME) return env.MACHINEROOM_CHROME
  const local = env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local')
  const base = join(local, 'ms-playwright')
  const shown = printedRunsFolder(base, env)
  let names = []
  try {
    names = readFolder(base).filter((name) => /^chromium-\d+$/.test(name))
  } catch (error) {
    throw new Error(`Could not read ${shown}: ${errorCode(error)}. Set MACHINEROOM_CHROME to the browser program.`)
  }
  names.sort((a, b) => Number(a.slice('chromium-'.length)) - Number(b.slice('chromium-'.length)))
  const folder = names[names.length - 1] ?? 'chromium-1228'
  const candidates = [
    join(base, folder, 'chrome-win64', 'chrome.exe'),
    join(base, folder, 'chrome-linux', 'chrome'),
    join(base, folder, 'chrome-mac', 'Chromium.app', 'Contents', 'MacOS', 'Chromium'),
  ]
  const found = candidates.find((candidate) => existsSync(candidate))
  if (!found) throw new Error(`No Playwright Chromium found under ${shown}. Set MACHINEROOM_CHROME to its program.`)
  return found
}

function sleep(ms) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms))
}

class Cdp {
  constructor(url) {
    this.url = url
    this.nextId = 1
    this.pending = new Map()
    this.ws = new WebSocket(url)
  }

  open() {
    return new Promise((resolvePromise, reject) => {
      this.ws.addEventListener('open', () => resolvePromise(this), { once: true })
      this.ws.addEventListener('error', () => reject(new Error(`Could not open the browser connection at ${this.url}.`)), { once: true })
      this.ws.addEventListener('message', (event) => {
        let message
        try {
          message = JSON.parse(String(event.data))
        } catch {
          return
        }
        if (message.id == null) return
        const pending = this.pending.get(message.id)
        if (!pending) return
        this.pending.delete(message.id)
        if (message.error) pending.reject(new Error(`${pending.method}: ${message.error.message}`))
        else pending.resolve(message.result)
      })
      this.ws.addEventListener('close', () => {
        for (const pending of this.pending.values()) pending.reject(new Error('The browser connection closed.'))
        this.pending.clear()
      })
    })
  }

  send(method, params = {}) {
    const id = this.nextId
    this.nextId += 1
    return new Promise((resolvePromise, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`${method} timed out.`))
      }, 30000)
      this.pending.set(id, {
        method,
        resolve(value) {
          clearTimeout(timer)
          resolvePromise(value)
        },
        reject(error) {
          clearTimeout(timer)
          reject(error)
        },
      })
      this.ws.send(JSON.stringify({ id, method, params }))
    })
  }

  async evaluate(expression, awaitPromise = true) {
    const answer = await this.send('Runtime.evaluate', { expression, awaitPromise, returnByValue: true })
    if (answer.exceptionDetails) {
      const detail = answer.exceptionDetails.exception?.description ?? answer.exceptionDetails.text ?? 'The page threw an error.'
      throw new Error(detail)
    }
    return answer.result?.value
  }

  close() {
    try {
      this.ws.close()
    } catch {}
  }
}

async function connectToPage(devPort) {
  const endpoint = `http://127.0.0.1:${devPort}`
  let list = await (await fetch(`${endpoint}/json/list`)).json()
  let page = list.find((target) => target.type === 'page')
  if (!page) {
    await fetch(`${endpoint}/json/new?about:blank`, { method: 'PUT' })
    list = await (await fetch(`${endpoint}/json/list`)).json()
    page = list.find((target) => target.type === 'page')
  }
  if (!page?.webSocketDebuggerUrl) throw new Error('Chrome did not offer a page to drive.')
  return new Cdp(page.webSocketDebuggerUrl).open()
}

async function waitFor(page, expression, label, timeout = 20000) {
  const start = Date.now()
  while (Date.now() - start < timeout) {
    if (await page.evaluate(`Boolean(${expression})`)) return
    await sleep(100)
  }
  throw new Error(`Timed out waiting for ${label}.`)
}

async function waitStable(page, expression, label, stableMs = 800, timeout = 20000) {
  const start = Date.now()
  let last = null
  let since = 0
  while (Date.now() - start < timeout) {
    const value = await page.evaluate(expression)
    if (value === last) {
      if (Date.now() - since >= stableMs) return value
    } else {
      last = value
      since = Date.now()
    }
    await sleep(200)
  }
  return last
}

async function savePng(page, outFolder, name, base64) {
  let data = Buffer.from(base64, 'base64')
  let scale = 1
  while (data.length > FILE_LIMIT && scale > 0.55) {
    scale = Math.round((scale - 0.05) * 100) / 100
    const smaller = await page.evaluate(`(async () => {
      const image = new Image()
      image.src = 'data:image/png;base64,${base64}'
      await image.decode()
      const canvas = document.createElement('canvas')
      canvas.width = Math.max(1, Math.round(image.naturalWidth * ${scale}))
      canvas.height = Math.max(1, Math.round(image.naturalHeight * ${scale}))
      const context = canvas.getContext('2d')
      context.imageSmoothingEnabled = true
      context.imageSmoothingQuality = 'high'
      context.drawImage(image, 0, 0, canvas.width, canvas.height)
      return canvas.toDataURL('image/png').split(',')[1]
    })()`)
    data = Buffer.from(smaller, 'base64')
  }
  if (data.length > FILE_LIMIT) {
    throw new Error(`${name} is ${data.length} bytes, over the 400 KB limit.`)
  }
  writeFileSync(join(outFolder, name), data)
  return { size: data.length, width: data.readUInt32BE(16), height: data.readUInt32BE(20) }
}

function key(page, keyValue, code) {
  return page.evaluate(`(() => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: ${JSON.stringify(keyValue)}, code: ${JSON.stringify(code)}, bubbles: true }))
    return true
  })()`)
}

async function load(page, url, kind) {
  await page.send('Page.navigate', { url })
  await waitFor(page, `document.readyState === 'complete'`, 'the page load', 30000)
  if (kind === 'connect') {
    await waitFor(page, `document.querySelector('.connect-grid') !== null`, 'the connect screen')
    await waitFor(page, `document.fonts.status === 'loaded'`, 'the fonts', 15000)
    await sleep(800)
    return
  }
  await waitFor(page, `document.querySelector('.lens') !== null`, 'the lens')
  await waitFor(page, `document.querySelector('.surface-layers canvas') !== null`, 'the WebGL canvas')
  await waitFor(page, `document.fonts.status === 'loaded'`, 'the fonts', 15000)
  await waitFor(page, `document.querySelectorAll('.mr-card').length > 0`, 'the folder cards', 30000)
  await waitStable(page, `document.querySelectorAll('.mr-card').length`, 'the folder cards', 700, 20000)
  await sleep(1200)
}

async function capture(page, outFolder, name) {
  const guide = await page.evaluate(`Boolean(document.querySelector('.mr-guide-backdrop'))`)
  if (guide) throw new Error('The guide card covered the room.')
  const shot = await page.send('Page.captureScreenshot', { format: 'png', fromSurface: true, captureBeyondViewport: false })
  const saved = await savePng(page, outFolder, name, shot.data)
  const shape = await page.evaluate(`(() => {
    const canvas = document.querySelector('.surface-layers canvas')
    return {
      cards: document.querySelectorAll('.mr-card').length,
      canvas: canvas ? [canvas.width, canvas.height] : null,
    }
  })()`)
  return { name, ...shape, ...saved }
}

async function main() {
  const port = Number(valueOf('--port', DEFAULT_PORT))
  const outFolder = resolve(valueOf('--out', DEFAULT_OUT))
  if (!Number.isInteger(port) || port <= 0) throw new Error('Pass a whole port with --port.')
  mkdirSync(outFolder, { recursive: true })

  const base = `http://127.0.0.1:${port}`
  let health = null
  try {
    health = await (await fetch(`${base}/api/health`)).json()
  } catch {}
  if (!health?.ok) throw new Error(`The room is not answering on port ${port}. Start it with npm run serve -- up --root . --port ${port} --no-open.`)

  const profile = join(process.env.TEMP || process.env.TMP || homedir(), `machineroom-screenshots-${process.pid}`)
  rmSync(profile, { recursive: true, force: true })
  mkdirSync(profile, { recursive: true })
  const chrome = chromePath()
  const child = spawn(chrome, [
    '--headless=new',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
    '--remote-debugging-port=0',
    '--remote-allow-origins=*',
    `--user-data-dir=${profile}`,
    '--window-size=1600,1000',
    '--force-device-scale-factor=1',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    '--mute-audio',
    '--disable-background-timer-throttling',
    '--disable-backgrounding-occluded-windows',
    '--disable-renderer-backgrounding',
    'about:blank',
  ], { stdio: 'ignore' })

  let browser = null
  let page = null
  try {
    const devtools = join(profile, 'DevToolsActivePort')
    const started = Date.now()
    while (!existsSync(devtools)) {
      if (Date.now() - started > 20000) throw new Error('Chrome did not open its debugging port.')
      if (child.exitCode !== null) throw new Error(`Chrome stopped with code ${child.exitCode}.`)
      await sleep(100)
    }
    const lines = readFileSync(devtools, 'utf8').trim().split(/\r?\n/)
    const devPort = Number(lines[0])
    browser = await new Cdp(`ws://127.0.0.1:${devPort}${lines[1]}`).open()
    page = await connectToPage(devPort)
    await page.send('Page.enable')
    await page.send('Runtime.enable')
    await page.send('Emulation.setDeviceMetricsOverride', {
      width: VIEWPORT.width,
      height: VIEWPORT.height,
      deviceScaleFactor: 1,
      mobile: false,
      screenWidth: VIEWPORT.width,
      screenHeight: VIEWPORT.height,
    })
    await page.send('Page.addScriptToEvaluateOnNewDocument', {
      source: `try { localStorage.setItem('machineroom.guide', '1') } catch {}`,
    })

    const replay = `${base}/?replay&fixture=scenario-i`
    const rows = []

    await load(page, replay, 'room')
    await page.evaluate(`(() => {
      const button = document.querySelector('.transport button[aria-label="Pause replay"]')
      if (button) button.click()
      return true
    })()`)
    await waitFor(page, `document.querySelector('.transport button[aria-label="Play replay"]') !== null`, 'the paused transport')
    await page.evaluate(`(() => {
      const input = document.querySelector('.transport input[aria-label="Replay position"]')
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
      setter.call(input, '40000')
      input.dispatchEvent(new Event('input', { bubbles: true }))
      return true
    })()`)
    await waitFor(page, `Math.abs(Number(document.querySelector('.transport input[aria-label="Replay position"]').value) - 40000) < 1000`, 'the replay to reach 40 seconds')
    await sleep(2500)
    rows.push(await capture(page, outFolder, 'overview.png'))

    await key(page, 'f', 'KeyF')
    await key(page, 'f', 'KeyF')
    await sleep(3200)
    rows.push(await capture(page, outFolder, 'closeup.png'))

    await key(page, 'f', 'KeyF')
    await key(page, '0', 'Digit0')
    await sleep(1800)
    await key(page, 'c', 'KeyC')
    await waitFor(page, `document.querySelector('.control-drawer') !== null`, 'the control drawer')
    await waitStable(page, `document.querySelector('.control-panel-content')?.innerText.length ?? 0`, 'the dispatch content', 700, 15000)
    await sleep(1200)
    rows.push(await capture(page, outFolder, 'drawer.png'))

    await load(page, `${base}/?connect`, 'connect')
    rows.push(await capture(page, outFolder, 'connect.png'))

    await load(page, `${base}/?replay&scale=40000`, 'room')
    await waitStable(page, `document.querySelectorAll('.mr-card').length`, 'the scale room', 1500, 40000)
    await sleep(3000)
    rows.push(await capture(page, outFolder, 'scale.png'))

    for (const row of rows) {
      console.log(`${row.name}  ${row.width}x${row.height}  ${Math.round(row.size / 1024)} KB  cards ${row.cards}  canvas ${row.canvas ? `${row.canvas[0]}x${row.canvas[1]}` : 'none'}`)
    }
  } finally {
    try {
      await browser?.send('Browser.close')
    } catch {}
    browser?.close()
    page?.close()
    const stopped = Date.now()
    while (child.exitCode === null && Date.now() - stopped < 4000) await sleep(100)
    if (child.exitCode === null) child.kill()
    for (let attempt = 0; attempt < 10; attempt += 1) {
      try {
        rmSync(profile, { recursive: true, force: true })
        break
      } catch {
        await sleep(300)
      }
    }
  }
}

const entry = process.argv[1] ? resolve(process.argv[1]) : ''
if (entry === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.message)
    process.exitCode = 1
  })
}
