import { closeSync, openSync, readSync, realpathSync, statSync } from 'node:fs'
import { isAbsolute, relative, resolve } from 'node:path'
import { maskKeys } from '../src/briefs/audit.js'

export const FILE_MAX_BYTES = 256 * 1024
export const FILE_BINARY_BYTES = 8 * 1024

export const FILE_ORIGIN_PROBLEM = 'A file request needs the page Origin or a same-origin fetch.'
export const FILE_PATH_PROBLEM = 'Send a relative file path.'
export const FILE_OUTSIDE_PROBLEM = 'That path is outside the project.'
export const FILE_REFUSED_PROBLEM = 'That file is not served.'
export const FILE_NOT_FOUND_PROBLEM = 'That file was not found.'
export const FILE_NOT_A_FILE_PROBLEM = 'That path is not a file.'
export const FILE_READ_PROBLEM = 'The bridge could not read that file.'

const REFUSED_FOLDERS = new Set(['.git', '.worktrees'])

function segments(value) {
  return String(value ?? '')
    .split(/[\\/]+/)
    .filter(Boolean)
}

function lower(value) {
  return value.toLowerCase()
}

// A colon also names an NTFS stream, as in .env::$DATA, so no path may hold one.
function isAbsoluteLike(value) {
  return isAbsolute(value) || value.includes(':') || value.startsWith('/') || value.startsWith('\\')
}

function isRefusedName(name) {
  const key = lower(name)
  return key === '.env' || key.startsWith('.env.') || key.endsWith('.pem') || key.endsWith('.key')
}

function refusedPath(value) {
  for (const part of segments(value)) {
    if (REFUSED_FOLDERS.has(lower(part)) || isRefusedName(part)) return true
  }
  return false
}

function outsideRoot(root, target) {
  const rel = relative(root, target)
  if (rel === '') return false
  if (isAbsolute(rel)) return true
  return segments(rel).includes('..')
}

function readPrefix(path, limit) {
  const fd = openSync(path, 'r')
  try {
    const buffer = Buffer.allocUnsafe(limit)
    let total = 0
    while (total < limit) {
      const read = readSync(fd, buffer, total, limit - total, total)
      if (read === 0) break
      total += read
    }
    return buffer.subarray(0, total)
  } finally {
    closeSync(fd)
  }
}

function sendProblem(sendJson, req, res, status, error) {
  sendJson(req, res, status, { error })
}

export function createFilesApi({ projectRoot, sendJson } = {}) {
  const currentRoot = () => (typeof projectRoot === 'function' ? projectRoot() : projectRoot)

  function pageRequest(req) {
    if (req.headers.origin) return true
    return lower(req.headers['sec-fetch-site'] ?? '') === 'same-origin'
  }

  async function handle(req, res, url) {
    if (url.pathname !== '/api/file') return false

    if ((req.method ?? 'GET') !== 'GET') {
      sendProblem(sendJson, req, res, 405, 'Method not allowed.')
      return true
    }

    if (!pageRequest(req)) {
      sendProblem(sendJson, req, res, 403, FILE_ORIGIN_PROBLEM)
      return true
    }

    const requested = url.searchParams.get('path')
    if (typeof requested !== 'string' || requested === '' || requested.includes('\0')) {
      sendProblem(sendJson, req, res, 400, FILE_PATH_PROBLEM)
      return true
    }

    if (isAbsoluteLike(requested)) {
      sendProblem(sendJson, req, res, 400, FILE_OUTSIDE_PROBLEM)
      return true
    }

    if (segments(requested).includes('..')) {
      sendProblem(sendJson, req, res, 400, FILE_OUTSIDE_PROBLEM)
      return true
    }

    if (refusedPath(requested)) {
      sendProblem(sendJson, req, res, 400, FILE_REFUSED_PROBLEM)
      return true
    }

    let root
    let target
    try {
      // The native call expands a Windows short name, so ENV~1 cannot stand in for a refused file.
      root = realpathSync.native(resolve(currentRoot()))
      target = realpathSync.native(resolve(root, requested))
    } catch {
      sendProblem(sendJson, req, res, 404, FILE_NOT_FOUND_PROBLEM)
      return true
    }

    if (outsideRoot(root, target)) {
      sendProblem(sendJson, req, res, 400, FILE_OUTSIDE_PROBLEM)
      return true
    }

    const realRelative = relative(root, target)
    if (refusedPath(realRelative)) {
      sendProblem(sendJson, req, res, 400, FILE_REFUSED_PROBLEM)
      return true
    }

    let stat
    try {
      stat = statSync(target)
    } catch {
      sendProblem(sendJson, req, res, 400, FILE_READ_PROBLEM)
      return true
    }

    if (!stat.isFile()) {
      sendProblem(sendJson, req, res, 400, FILE_NOT_A_FILE_PROBLEM)
      return true
    }

    let data
    try {
      data = readPrefix(target, Math.min(stat.size, FILE_MAX_BYTES))
    } catch {
      sendProblem(sendJson, req, res, 400, FILE_READ_PROBLEM)
      return true
    }

    const binary = data.subarray(0, FILE_BINARY_BYTES).includes(0)
    const body = {
      path: segments(realRelative).join('/'),
      size: stat.size,
      modified: stat.mtime.toISOString(),
      binary,
      truncated: stat.size > FILE_MAX_BYTES,
      text: '',
    }
    if (!binary) {
      const masked = maskKeys(data.toString('utf8'))
      body.text = masked.text
    }

    sendJson(req, res, 200, body)
    return true
  }

  return { handle }
}
