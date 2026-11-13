import { indexFor } from './fileIndex.js'

const DRIVE = /^[a-zA-Z]:\//
const HIDDEN = /[\u0000-\u0008\u000A-\u001F\u200E\u200F\u202A-\u202E\u2066-\u2069]/g

export function normalise(path) {
  return String(path).replace(/\\/g, '/').replace(/\/+/g, '/')
}

export function basename(path) {
  return normalise(path).split('/').filter(Boolean).pop() ?? ''
}

export function dirname(path) {
  const parts = normalise(path).split('/')
  parts.pop()
  return parts.join('/')
}

function withoutDots(path) {
  const kept = []
  for (const part of path.split('/')) {
    if (part === '' || part === '.') continue
    if (part !== '..') kept.push(part)
    else if (kept.length === 0) return null
    else kept.pop()
  }
  return kept.join('/')
}

function foldAbsolute(path) {
  const drive = /^[A-Za-z]:/.test(path)
  const rooted = drive || path.startsWith('/')
  if (!rooted) return withoutDots(path)
  const body = path.replace(/^[A-Za-z]:/, '').replace(/^\/+/, '')
  const folded = withoutDots(body)
  if (folded === null) return null
  if (drive) return folded ? `${path.slice(0, 2)}/${folded}` : `${path.slice(0, 2)}/`
  return folded ? `/${folded}` : '/'
}

function fullRoot(rootPath) {
  const path = foldAbsolute(normalise(rootPath))
  if (path === null) return ''
  const trimmed = path.replace(/\/+$/, '')
  if (trimmed === '') return path
  return /^[A-Za-z]:$/.test(trimmed) ? `${trimmed}/` : trimmed
}

function underRoot(root, path) {
  const windows = /^[A-Za-z]:\//.test(root)
  const wanted = windows ? root.toLowerCase() : root
  const found = windows ? path.toLowerCase() : path
  if (found === wanted) return ''
  const prefix = wanted.endsWith('/') ? wanted : `${wanted}/`
  if (!found.startsWith(prefix)) return null
  return path.slice(prefix.length)
}

export function relativeTo(rootName, rawPath, rootPath = '') {
  const path = normalise(rawPath).replace(/^\.\//, '')
  const full = typeof rootPath === 'string' ? fullRoot(rootPath) : ''
  if (full) {
    if (path.startsWith('~')) return null
    if (DRIVE.test(path) || path.startsWith('/')) {
      const folded = foldAbsolute(path)
      if (folded === null) return null
      return underRoot(full, folded)
    }
    return withoutDots(path)
  }
  const lower = path.toLowerCase()
  const root = String(rootName ?? '').toLowerCase()
  if (root) {
    const marker = `/${root}/`
    const at = lower.lastIndexOf(marker)
    if (at !== -1) return withoutDots(path.slice(at + marker.length))
    if (lower.endsWith(`/${root}`)) return ''
  }
  if (DRIVE.test(path) || path.startsWith('/') || path.startsWith('~')) return null
  return withoutDots(path)
}

export function ancestors(path) {
  const parent = dirname(path)
  const parts = parent ? parent.split('/') : []
  const chain = ['']
  parts.forEach((_, index) => chain.push(parts.slice(0, index + 1).join('/')))
  return chain
}

export function resolveKnown(name, files, near) {
  const clean = normalise(name)
  const index = indexFor(files)
  if (index.has(clean)) return clean
  const base = basename(clean)
  const matches = index.pathsWithBase(base)
  if (matches.length === 1) return matches[0]
  if (matches.length === 0 || typeof near !== 'string') return clean
  const wanted = folders(near)
  const same = matches.filter((file) => folders(dirname(file)).join('/') === wanted.join('/'))
  if (same.length === 1) return same[0]
  let best = []
  let bestCount = -1
  for (const file of matches) {
    const count = sharedFolders(folders(dirname(file)), wanted)
    if (count > bestCount) {
      best = [file]
      bestCount = count
    } else if (count === bestCount) {
      best.push(file)
    }
  }
  return best.length === 1 ? best[0] : clean
}

function folders(path) {
  const clean = normalise(path).replace(/^\/+/, '').replace(/\/+$/, '')
  return clean ? clean.split('/') : []
}

function sharedFolders(a, b) {
  let count = 0
  while (count < a.length && count < b.length && a[count] === b[count]) count += 1
  return count
}

export function makeTree(raw) {
  const files = [...raw.files].sort()
  const dirs = new Set([''])
  let previous = []
  for (const file of files) {
    const parts = file.split('/')
    parts.pop()
    let shared = 0
    while (shared < previous.length && shared < parts.length && previous[shared] === parts[shared]) shared += 1
    let prefix = shared > 0 ? previous.slice(0, shared).join('/') : ''
    for (let index = shared; index < parts.length; index += 1) {
      prefix = prefix ? `${prefix}/${parts[index]}` : parts[index]
      dirs.add(prefix)
    }
    previous = parts
  }
  return {
    rootName: raw.root,
    rootPath: typeof raw.rootPath === 'string' && raw.rootPath !== '' ? raw.rootPath : null,
    files,
    created: raw.created ?? [],
    dirs: [...dirs].sort(),
  }
}

export function visibleText(text) {
  return String(text).replace(HIDDEN, (found) => {
    const code = found.codePointAt(0).toString(16).toUpperCase().padStart(4, '0')
    return `[U+${code}]`
  })
}
