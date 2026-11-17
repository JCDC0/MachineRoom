import { readFile, realpath, stat } from 'node:fs/promises'
import { extname, isAbsolute, relative, resolve, sep } from 'node:path'

const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.jsonl': 'application/x-ndjson; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
}

export function isInsideRoot(root, target) {
  const from = process.platform === 'win32' ? root.toLowerCase() : root
  const to = process.platform === 'win32' ? target.toLowerCase() : target
  const path = relative(from, to)
  return path !== '..' && !path.startsWith(`..${sep}`) && !isAbsolute(path)
}

function sendNotFound(res) {
  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
  res.end('Not found')
}

function resolveTarget(staticRoot, rawUrl) {
  const rawPath = String(rawUrl ?? '').split(/[?#]/)[0]
  let pathname
  try {
    pathname = decodeURIComponent(rawPath)
  } catch {
    return null
  }
  if (!pathname.startsWith('/')) return null
  if (pathname.startsWith('//')) return null
  if (pathname.includes('\0') || pathname.includes('\\')) return null
  const parts = pathname.split('/')
  if (parts.some((part) => part === '..' || part.includes(':'))) return null
  const full = resolve(staticRoot, `.${pathname}`)
  if (full !== staticRoot && !full.startsWith(`${staticRoot}${sep}`)) return null
  return { pathname, full }
}

function hasDot(pathname) {
  const parts = pathname.split('/').filter(Boolean)
  return (parts[parts.length - 1] ?? '').includes('.')
}

async function sendFile(req, res, file) {
  let body
  try {
    body = await readFile(file)
  } catch {
    sendNotFound(res)
    return
  }
  res.writeHead(200, {
    'Content-Type': CONTENT_TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream',
    'Content-Length': body.length,
  })
  if (req.method === 'HEAD') {
    res.end()
    return
  }
  res.end(body)
}

export function createStaticHandler({ staticDir } = {}) {
  const staticRoot = staticDir ? resolve(staticDir) : null
  return async function serveStatic(req, res, url) {
    if (!staticRoot) return false
    if (req.method !== 'GET' && req.method !== 'HEAD') return false
    if (url.pathname.startsWith('/api/')) return false
    const target = resolveTarget(staticRoot, req.url)
    if (!target) {
      sendNotFound(res)
      return true
    }
    if (target.pathname.startsWith('/api/')) return false
    let realRoot
    try {
      realRoot = await realpath(staticRoot)
    } catch {
      sendNotFound(res)
      return true
    }
    if (target.pathname !== '/') {
      try {
        const file = await realpath(target.full)
        if (!isInsideRoot(realRoot, file)) {
          sendNotFound(res)
          return true
        }
        const info = await stat(file)
        if (info.isFile()) {
          await sendFile(req, res, file)
          return true
        }
      } catch {}
    }
    if (hasDot(target.pathname)) {
      sendNotFound(res)
      return true
    }
    try {
      const index = await realpath(resolve(realRoot, 'index.html'))
      if (isInsideRoot(realRoot, index)) await sendFile(req, res, index)
      else sendNotFound(res)
    } catch {
      sendNotFound(res)
    }
    return true
  }
}
