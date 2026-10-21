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

export function relativeTo(rootName, rawPath) {
  const path = normalise(rawPath).replace(/^\.\//, '')
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
  if (files.includes(clean)) return clean
  const base = basename(clean)
  const matches = files.filter((file) => String(file).includes(base) && basename(file) === base)
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
  files.forEach((file) => ancestors(file).forEach((dir) => dirs.add(dir)))
  return {
    rootName: raw.root,
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
