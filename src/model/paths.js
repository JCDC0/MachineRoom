const DRIVE = /^[a-zA-Z]:\//

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

export function relativeTo(rootName, rawPath) {
  const path = normalise(rawPath).replace(/^\.\//, '')
  const lower = path.toLowerCase()
  const root = rootName.toLowerCase()
  const marker = `/${root}/`
  const at = lower.lastIndexOf(marker)
  if (at !== -1) return path.slice(at + marker.length)
  if (lower.endsWith(`/${root}`)) return ''
  if (DRIVE.test(path) || path.startsWith('/') || path.startsWith('~')) return null
  return path
}

export function ancestors(path) {
  const parent = dirname(path)
  const parts = parent ? parent.split('/') : []
  const chain = ['']
  parts.forEach((_, index) => chain.push(parts.slice(0, index + 1).join('/')))
  return chain
}

export function resolveKnown(name, files) {
  const clean = normalise(name)
  if (files.includes(clean)) return clean
  const matches = files.filter((file) => basename(file) === basename(clean))
  return matches.length === 1 ? matches[0] : clean
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
