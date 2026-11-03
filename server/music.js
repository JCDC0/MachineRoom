import { createReadStream } from 'node:fs'
import { readdir, stat } from 'node:fs/promises'
import { dirname, extname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const INSTALL_FOLDER = resolve(dirname(fileURLToPath(import.meta.url)), '..')

export const MUSIC_EXTENSIONS = new Set(['.mp3', '.ogg', '.wav', '.m4a', '.flac', '.opus'])
export const MUSIC_LIMIT = 500

export const MUSIC_TYPES = Object.freeze({
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.wav': 'audio/wav',
  '.m4a': 'audio/mp4',
  '.flac': 'audio/flac',
  '.opus': 'audio/ogg',
})

export function musicFolderFor({ folder, env = process.env, installFolder = INSTALL_FOLDER } = {}) {
  if (typeof folder === 'string' && folder.trim()) return resolve(folder.trim())
  const override = typeof env?.MACHINEROOM_MUSIC === 'string' ? env.MACHINEROOM_MUSIC.trim() : ''
  if (override) return resolve(override)
  return join(resolve(installFolder), 'music')
}

export function musicTrackNames(names) {
  if (!Array.isArray(names)) return []
  return names
    .filter((name) => typeof name === 'string' && name.length > 0)
    .filter((name) => MUSIC_EXTENSIONS.has(extname(name).toLowerCase()))
    .sort()
    .slice(0, MUSIC_LIMIT)
}

export async function listMusic(folder) {
  try {
    const entries = await readdir(folder, { withFileTypes: true })
    return musicTrackNames(entries.filter((entry) => entry.isFile()).map((entry) => entry.name))
  } catch {
    return []
  }
}

export function isSafeMusicName(name) {
  if (typeof name !== 'string' || name.length === 0 || name.length > 255) return false
  if (name.includes('\0')) return false
  if (name.includes('/') || name.includes('\\')) return false
  if (name.includes('..')) return false
  return true
}

export function musicType(name) {
  return MUSIC_TYPES[extname(String(name ?? '')).toLowerCase()] ?? 'application/octet-stream'
}

export function parseRange(header, size) {
  if (typeof header !== 'string' || !header.startsWith('bytes=')) return null
  if (!Number.isFinite(size) || size < 0) return null
  const value = header.slice(6).trim()
  if (!value || value.includes(',')) return { unsatisfiable: true }
  const match = /^(\d*)-(\d*)$/.exec(value)
  if (!match) return { unsatisfiable: true }
  const [, startText, endText] = match
  if (startText === '' && endText === '') return { unsatisfiable: true }
  if (startText === '') {
    const suffix = Number(endText)
    if (!Number.isInteger(suffix) || suffix <= 0) return { unsatisfiable: true }
    if (size === 0) return { unsatisfiable: true }
    return { start: Math.max(0, size - suffix), end: size - 1 }
  }
  const start = Number(startText)
  if (!Number.isInteger(start) || start < 0 || start >= size) return { unsatisfiable: true }
  let end = endText === '' ? size - 1 : Number(endText)
  if (!Number.isInteger(end) || end < start) return { unsatisfiable: true }
  end = Math.min(end, size - 1)
  return { start, end }
}

function sendNotFound(res, cors = {}) {
  res.writeHead(404, { ...cors, 'Content-Type': 'text/plain; charset=utf-8' })
  res.end('Not found')
}

function sendBadName(res, cors = {}) {
  res.writeHead(400, { ...cors, 'Content-Type': 'text/plain; charset=utf-8' })
  res.end('Bad music name')
}

export function createMusicApi({ folder, env, sendJson, corsHeaders = () => ({}), createStream = createReadStream } = {}) {
  const musicFolder = musicFolderFor({ folder, env })

  async function handleApi(req, res, url) {
    if (url.pathname !== '/api/music' || req.method !== 'GET') return false
    const tracks = await listMusic(musicFolder)
    sendJson(req, res, 200, { folder: musicFolder, tracks })
    return true
  }

  async function handleFile(req, res, url) {
    const prefix = '/music/'
    if (!url.pathname.startsWith(prefix)) return false
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { ...corsHeaders(req), Allow: 'GET, HEAD' })
      res.end()
      return true
    }
    const cors = corsHeaders(req)
    const raw = url.pathname.slice(prefix.length)
    if (raw === '') {
      sendNotFound(res, cors)
      return true
    }
    let name
    try {
      name = decodeURIComponent(raw)
    } catch {
      sendBadName(res, cors)
      return true
    }
    if (!isSafeMusicName(name)) {
      sendBadName(res, cors)
      return true
    }
    const file = resolve(musicFolder, name)
    if (dirname(file) !== resolve(musicFolder)) {
      sendBadName(res, cors)
      return true
    }
    let info
    try {
      info = await stat(file)
    } catch {
      sendNotFound(res, cors)
      return true
    }
    if (!info.isFile()) {
      sendNotFound(res, cors)
      return true
    }
    const size = info.size
    const range = req.headers.range ? parseRange(req.headers.range, size) : null
    const headers = {
      ...cors,
      'Content-Type': musicType(name),
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'no-cache',
    }
    if (range?.unsatisfiable) {
      res.writeHead(416, { ...headers, 'Content-Range': `bytes */${size}`, 'Content-Length': 0 })
      res.end()
      return true
    }
    const start = range ? range.start : 0
    const end = range ? range.end : size - 1
    const length = size === 0 ? 0 : end - start + 1
    res.writeHead(range ? 206 : 200, {
      ...headers,
      'Content-Length': length,
      ...(range ? { 'Content-Range': `bytes ${start}-${end}/${size}` } : {}),
    })
    if (req.method === 'HEAD' || length === 0) {
      res.end()
      return true
    }
    const stream = createStream(file, { start, end })
    stream.on('error', () => {
      if (!res.headersSent) res.writeHead(500)
      res.destroy()
    })
    res.on('close', () => stream.destroy())
    stream.pipe(res)
    return true
  }

  async function handle(req, res, url) {
    if (await handleApi(req, res, url)) return true
    return handleFile(req, res, url)
  }

  return { folder: musicFolder, handle, list: () => listMusic(musicFolder) }
}
