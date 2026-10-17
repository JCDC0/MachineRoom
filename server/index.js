import { execFileSync } from 'node:child_process'
import { readdirSync } from 'node:fs'
import { createServer } from 'node:http'
import { basename, dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const ALLOWED_ORIGIN = 'http://localhost:5173'
const HISTORY_LIMIT = 500
const SKIP_DIRS = new Set(['.git', 'node_modules', 'dist'])
const PARSER_BY_ADAPTER = {
  claude_local: 'claude',
  hermes_local: 'hermes',
  opencode_local: 'opencode',
}

export function slugify(value) {
  return (
    String(value ?? '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'agent'
  )
}

export function mapAgent(raw) {
  const id = raw?.id ?? ''
  const name = raw?.name ?? raw?.key ?? id
  const adapterType = raw?.adapterType ?? raw?.adapter_type ?? ''
  const adapterParser = PARSER_BY_ADAPTER[adapterType]
  if (adapterParser) {
    return { id, key: adapterParser, name, adapterType, parser: adapterParser }
  }
  if (adapterType === 'process' && slugify(name) === 'agy') {
    return { id, key: 'agy', name, adapterType, parser: 'agy' }
  }
  return { id, key: slugify(name), name, adapterType, parser: null }
}

function walkFiles(rootDir, currentDir = rootDir, out = []) {
  const entries = readdirSync(currentDir, { withFileTypes: true })
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue
      walkFiles(rootDir, join(currentDir, entry.name), out)
    } else if (entry.isFile()) {
      const full = join(currentDir, entry.name)
      const rel = full.slice(rootDir.length + 1).replace(/\\/g, '/')
      out.push(rel)
    }
  }
  return out
}

export function readTree(projectRoot) {
  if (!projectRoot) return { root: '', files: [], created: [] }
  const resolved = resolve(projectRoot)
  const root = basename(resolved)
  try {
    const output = execFileSync('git', ['-C', resolved, 'ls-files', '--cached', '--others', '--exclude-standard'], {
      encoding: 'utf8',
      env: { ...process.env, GIT_CEILING_DIRECTORIES: dirname(resolved) },
      stdio: ['ignore', 'pipe', 'ignore'],
    })
    const files = output
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => line.replace(/\\/g, '/'))
      .sort()
    return { root, files, created: [] }
  } catch {
    const files = walkFiles(resolved).sort()
    return { root, files, created: [] }
  }
}

function toWsUrl(paperclipUrl, companyId) {
  const base = String(paperclipUrl).replace(/\/+$/, '').replace(/^http/i, 'ws')
  return `${base}/api/companies/${encodeURIComponent(companyId)}/events/ws`
}

function corsHeaders(req) {
  const origin = req.headers.origin
  if (origin && origin !== ALLOWED_ORIGIN) return {}
  return {
    'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
    Vary: 'Origin',
  }
}

function sendJson(req, res, status, body) {
  const payload = JSON.stringify(body)
  res.writeHead(status, {
    ...corsHeaders(req),
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
  })
  res.end(payload)
}

export function createBridge(options = {}) {
  const paperclipUrl = (options.paperclipUrl ?? process.env.PAPERCLIP_URL ?? 'http://127.0.0.1:3100').replace(/\/+$/, '')
  const companyId = options.companyId ?? process.env.PAPERCLIP_COMPANY_ID ?? ''
  const projectRoot = options.projectRoot ?? process.env.PROJECT_ROOT ?? process.cwd()
  const port = Number(options.port ?? process.env.PORT ?? 5174)
  const reconnectMinMs = Number(options.reconnectMinMs ?? 1000)
  const reconnectMaxMs = Number(options.reconnectMaxMs ?? 15000)
  const heartbeatMs = Number(options.heartbeatMs ?? 15000)

  const clients = new Set()
  const history = []
  let nextId = 0
  let socket = null
  let paperclipOpen = false
  let stopped = false
  let reconnectTimer = null
  let reconnectDelay = reconnectMinMs

  function writeSseFrame(res, entry) {
    res.write(`id: ${entry.id}\nevent: frame\ndata: ${entry.data}\n\n`)
  }

  function recordFrame(rawData) {
    const text = typeof rawData === 'string' ? rawData : Buffer.from(rawData).toString('utf8')
    let parsed
    try {
      parsed = JSON.parse(text)
    } catch {
      return
    }
    if (!parsed || typeof parsed !== 'object') return
    if (companyId && parsed.companyId && parsed.companyId !== companyId) return
    if (typeof parsed.id === 'number' && parsed.id > nextId) {
      nextId = parsed.id
    } else {
      nextId += 1
    }
    const id = String(parsed.id ?? nextId)
    const data = JSON.stringify(parsed)
    const entry = { id, data }
    history.push(entry)
    if (history.length > HISTORY_LIMIT) history.shift()
    for (const client of clients) {
      writeSseFrame(client, entry)
    }
  }

  function scheduleReconnect() {
    if (stopped || reconnectTimer) return
    const wait = reconnectDelay
    reconnectDelay = Math.min(reconnectDelay * 2, reconnectMaxMs)
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null
      connectUpstream()
    }, wait)
  }

  function connectUpstream() {
    if (stopped) return
    let ws
    try {
      ws = new WebSocket(toWsUrl(paperclipUrl, companyId))
    } catch {
      paperclipOpen = false
      scheduleReconnect()
      return
    }
    socket = ws
    ws.addEventListener('open', () => {
      if (socket !== ws) return
      paperclipOpen = true
      reconnectDelay = reconnectMinMs
    })
    ws.addEventListener('message', (event) => {
      if (socket !== ws) return
      recordFrame(event.data)
    })
    ws.addEventListener('error', () => {
      if (socket !== ws) return
      paperclipOpen = false
    })
    ws.addEventListener('close', () => {
      if (socket !== ws) return
      paperclipOpen = false
      socket = null
      scheduleReconnect()
    })
  }

  const heartbeatTimer = setInterval(() => {
    for (const client of clients) {
      client.write(': keepalive\n\n')
    }
  }, heartbeatMs)
  heartbeatTimer.unref?.()

  const server = createServer(async (req, res) => {
    if (req.headers.origin && req.headers.origin !== ALLOWED_ORIGIN) {
      res.writeHead(403)
      res.end()
      return
    }
    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        ...corsHeaders(req),
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Last-Event-ID, Content-Type',
      })
      res.end()
      return
    }

    const url = new URL(req.url ?? '/', 'http://127.0.0.1')
    if (req.method === 'GET' && url.pathname === '/api/health') {
      sendJson(req, res, 200, { ok: true, paperclip: paperclipOpen })
      return
    }

    if (req.method === 'GET' && url.pathname === '/api/agents') {
      try {
        const upstream = await fetch(`${paperclipUrl}/api/companies/${encodeURIComponent(companyId)}/agents`)
        if (!upstream.ok) {
          sendJson(req, res, 502, { error: `upstream answered ${upstream.status}` })
          return
        }
        const raw = await upstream.json()
        const list = Array.isArray(raw) ? raw : Array.isArray(raw?.agents) ? raw.agents : Array.isArray(raw?.data) ? raw.data : []
        sendJson(req, res, 200, list.map(mapAgent))
      } catch {
        sendJson(req, res, 502, { error: 'upstream unreachable' })
      }
      return
    }

    if (req.method === 'GET' && url.pathname === '/api/tree') {
      sendJson(req, res, 200, readTree(projectRoot))
      return
    }

    if (req.method === 'GET' && url.pathname === '/events') {
      res.writeHead(200, {
        ...corsHeaders(req),
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      })
      res.flushHeaders()

      const lastEventId = req.headers['last-event-id'] !== undefined ? String(req.headers['last-event-id']).trim() : ''
      if (lastEventId) {
        const index = history.findIndex((item) => item.id === lastEventId)
        let replay = []
        if (index !== -1) {
          replay = history.slice(index + 1)
        } else if (/^\d+$/.test(lastEventId)) {
          const threshold = Number(lastEventId)
          replay = history.filter((item) => /^\d+$/.test(item.id) && Number(item.id) > threshold)
        }
        for (const entry of replay) {
          writeSseFrame(res, entry)
        }
      }

      clients.add(res)
      req.on('close', () => {
        clients.delete(res)
      })
      return
    }

    sendJson(req, res, 404, { error: 'not found' })
  })

  function start() {
    connectUpstream()
    return new Promise((resolveStart, rejectStart) => {
      server.once('error', rejectStart)
      server.listen(port, '127.0.0.1', () => {
        server.off('error', rejectStart)
        const address = server.address()
        resolveStart({
          port: typeof address === 'object' && address ? address.port : port,
          url: `http://127.0.0.1:${typeof address === 'object' && address ? address.port : port}`,
        })
      })
    })
  }

  function stop() {
    stopped = true
    clearInterval(heartbeatTimer)
    if (reconnectTimer) {
      clearTimeout(reconnectTimer)
      reconnectTimer = null
    }
    if (socket) {
      const current = socket
      socket = null
      paperclipOpen = false
      try {
        current.close()
      } catch {}
    }
    for (const client of clients) {
      try {
        client.end()
      } catch {}
    }
    clients.clear()
    return new Promise((resolveStop) => {
      if (!server.listening) {
        resolveStop()
        return
      }
      server.close(() => resolveStop())
    })
  }

  return { server, start, stop }
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href
if (isMain) {
  const bridge = createBridge()
  bridge.start().then(({ url }) => {
    console.log(`bridge listening on ${url}`)
  })
  const shutdown = () => {
    bridge.stop().then(() => process.exit(0))
  }
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
}
