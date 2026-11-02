const indexes = new WeakMap()

function baseName(text) {
  let end = text.length
  while (end > 0 && (text[end - 1] === '/' || text[end - 1] === '\\')) end -= 1
  if (end === 0) return ''
  let start = end
  while (start > 0 && text[start - 1] !== '/' && text[start - 1] !== '\\') start -= 1
  return text.slice(start, end)
}

function createEntry() {
  const known = new Set()
  const bases = new Map()
  const ranks = new Map()
  const paths = []
  const entry = {
    size: 0,
    longest: 0,
    paths,
    has(path) {
      return known.has(path)
    },
    rankOf(path) {
      return ranks.get(String(path)) ?? -1
    },
    pathsWithBase(base) {
      return bases.get(base) ?? []
    },
  }
  return { entry, known, bases, ranks }
}

function learn(held, path, at) {
  const text = String(path)
  if (held.known.has(text)) return
  held.known.add(text)
  if (text.length > held.entry.longest) held.entry.longest = text.length
  const base = baseName(text)
  const matches = held.bases.get(base)
  if (matches) matches.push(path)
  else held.bases.set(base, [path])
  held.ranks.set(text, at)
  held.entry.paths.push(path)
}

export function indexFor(list) {
  const items = Array.isArray(list) ? list : []
  const size = items.length
  let held = indexes.get(items)
  if (!held || size < held.entry.size) held = createEntry()
  for (let at = held.entry.size; at < size; at += 1) learn(held, items[at], at)
  held.entry.size = size
  indexes.set(items, held)
  return held.entry
}
