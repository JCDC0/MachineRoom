import { ancestors, dirname, normalise } from './paths.js'

const DEFAULT_MAX_FOLDERS = 3
const DEFAULT_MAX_ITEMS = 10
const DEFAULT_MAX_ALWAYS = 300
const MAX_ALWAYS_DEPTH = 3

export const MAX_CHILD_CARDS = 10
export const MAX_FOLDER_ITEMS = 2000

export const BULK_FOLDERS = new Set(['node_modules', 'dist', 'build', 'coverage', 'vendor', '.next', 'target', 'out', '__pycache__'])

export function isBulkFolder(name) {
  return typeof name === 'string' && name !== '' && BULK_FOLDERS.has(name.toLowerCase())
}

function bulkPath(path) {
  if (path === '') return false
  const at = path.lastIndexOf('/')
  return isBulkFolder(at === -1 ? path : path.slice(at + 1))
}

function clean(raw) {
  if (typeof raw === 'string' && raw !== '.' && !raw.includes('\\') && !raw.includes('//') && !raw.startsWith('./') && !raw.endsWith('/')) return raw
  const value = normalise(raw).replace(/^\.\//, '').replace(/\/+$/, '')
  return value === '.' ? '' : value
}

function parentOf(path) {
  const at = path.lastIndexOf('/')
  return at === -1 ? '' : path.slice(0, at)
}

function byName(a, b) {
  return a < b ? -1 : a > b ? 1 : 0
}

function count(value) {
  const number = Number(value)
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : 0
}

function rankOf(path, first, second) {
  if (first.has(path)) return 0
  if (second.has(path)) return 1
  return 2
}

function bumpFolder(index, path) {
  index.folderVersion.set(path, (index.folderVersion.get(path) ?? 0) + 1)
}

function addFolder(path, has, add, kids, bump = null, dirty = null) {
  const missing = []
  for (let at = path; !has(at); at = parentOf(at)) missing.push(at)
  missing.forEach(add)
  missing.forEach((at) => {
    const parent = parentOf(at)
    const list = kids.get(parent)
    if (list) list.push(at)
    else kids.set(parent, [at])
    if (bump) bump(parent)
    if (dirty) dirty.add(parent)
  })
}

function addFile(index, raw) {
  const path = clean(raw)
  if (!path || index.fileSet.has(path)) return
  index.fileSet.add(path)
  const parent = parentOf(path)
  addFolder(parent, (at) => index.folders.has(at), (at) => index.folders.add(at), index.children, (at) => bumpFolder(index, at), index.dirty)
  for (let at = parent; ; at = parentOf(at)) {
    index.fileCount.set(at, (index.fileCount.get(at) ?? 0) + 1)
    if (at === '') break
  }
  const list = index.filesIn.get(parent)
  if (list) list.push(path)
  else index.filesIn.set(parent, [path])
  index.dirty.add(parent)
  bumpFolder(index, parent)
}

function sortLists(index) {
  for (const path of index.dirty) {
    const files = index.filesIn.get(path)
    if (files && files.length > 1) files.sort(byName)
    const kids = index.children.get(path)
    if (kids && kids.length > 1) kids.sort(byName)
  }
  index.dirty.clear()
}

function extendIndex(index, files) {
  if (files === index.source) {
    if (files.length < index.length) return false
    for (let at = index.length; at < files.length; at += 1) addFile(index, files[at])
    index.length = files.length
    sortLists(index)
    return true
  }
  const before = index.source
  if (files.length < index.length) return false
  const added = []
  let kept = 0
  for (const raw of files) {
    if (kept < index.length && raw === before[kept]) kept += 1
    else added.push(raw)
  }
  if (kept !== index.length) return false
  added.forEach((raw) => addFile(index, raw))
  index.source = files
  index.length = files.length
  sortLists(index)
  return true
}

let lastIndex = null

function indexFiles(files) {
  if (lastIndex && extendIndex(lastIndex, files)) return lastIndex
  const index = {
    source: files,
    length: files.length,
    fileSet: new Set(),
    folders: new Set(['']),
    filesIn: new Map(),
    children: new Map(),
    fileCount: new Map([['', 0]]),
    folderVersion: new Map(),
    views: new Map(),
    dirty: new Set(),
  }
  files.forEach((raw) => addFile(index, raw))
  sortLists(index)
  lastIndex = index
  return index
}

function depthOf(raw) {
  const number = Number(raw)
  if (!Number.isFinite(number) || number < 0) return 0
  return Math.min(MAX_ALWAYS_DEPTH, Math.floor(number))
}

function alwaysPlan(index, depth, maxAlways) {
  const pinned = new Set()
  if (depth < 1 || maxAlways < 1) return pinned
  let budget = maxAlways - 1
  pinned.add('')
  let frontier = ['']
  for (let level = 1; level <= depth && frontier.length > 0; level += 1) {
    frontier.sort(byName)
    const next = []
    for (const parent of frontier) {
      if (bulkPath(parent)) continue
      const children = [...(index.children.get(parent) ?? [])].sort(
        (a, b) => (index.fileCount.get(b) ?? 0) - (index.fileCount.get(a) ?? 0) || byName(a, b),
      )
      const kept = parent === '' ? children : children.slice(0, MAX_CHILD_CARDS)
      for (const child of kept) {
        if (budget <= 0) break
        pinned.add(child)
        if (!bulkPath(child)) next.push(child)
        budget -= 1
      }
    }
    frontier = next
  }
  return pinned
}

export function planFolderView({
  files = [],
  focus = [],
  touched = [],
  changed = [],
  expanded = [],
  maxFolders = DEFAULT_MAX_FOLDERS,
  maxItems = DEFAULT_MAX_ITEMS,
  alwaysDepth = 0,
  maxAlways = DEFAULT_MAX_ALWAYS,
  limitItems = true,
} = {}) {
  const folderLimit = count(maxFolders)
  const itemLimit = count(maxItems)
  const alwaysLevel = depthOf(alwaysDepth)
  const alwaysLimit = count(maxAlways)

  const index = indexFiles(files)
  const { fileSet, folders, filesIn, children: fileChildren } = index
  const extraFolders = new Set()
  const extraChildren = new Map()
  const isFolder = (path) => folders.has(path) || extraFolders.has(path)
  const addExtra = (path) => addFolder(path, isFolder, (at) => extraFolders.add(at), extraChildren)

  const focusPaths = [...new Set(focus.map(clean))]
  const touchedPaths = [...new Set(touched.map(clean))]
  const changedPaths = [...new Set(changed.map(clean))]
  const expandedPaths = new Set(
    (expanded instanceof Set ? [...expanded] : Array.isArray(expanded) ? expanded : []).map(clean),
  )

  const addPath = (path) => {
    addExtra(parentOf(path))
    if (!fileSet.has(path)) addExtra(path)
  }

  focusPaths.forEach(addPath)
  touchedPaths.forEach(addPath)
  expandedPaths.forEach(addPath)
  extraChildren.forEach((list) => {
    if (list.length > 1) list.sort(byName)
  })

  const focusSet = new Set(focusPaths)
  const touchedSet = new Set(touchedPaths)

  const focusFolders = new Set()
  focusPaths.forEach((path) => {
    ancestors(path).forEach((part) => focusFolders.add(part))
    if (isFolder(path) && !fileSet.has(path)) focusFolders.add(path)
  })
  expandedPaths.forEach((path) => {
    ancestors(path).forEach((part) => focusFolders.add(part))
    focusFolders.add(path)
  })

  const touchedFolders = new Set()
  touchedPaths.forEach((path) => {
    ancestors(path).forEach((part) => touchedFolders.add(part))
    if (isFolder(path)) touchedFolders.add(path)
  })

  const changedCount = new Map()
  changedPaths.forEach((path) => {
    if (path === '') return
    for (let at = isFolder(path) ? path : parentOf(path); ; at = parentOf(at)) {
      changedCount.set(at, (changedCount.get(at) ?? 0) + 1)
      if (at === '') break
    }
  })

  const EMPTY = []
  const kidsFor = (path) => {
    const base = fileChildren.get(path)
    const extra = extraChildren.get(path)
    if (!extra || extra.length === 0) return base ?? EMPTY
    if (!base || base.length === 0) return extra
    const out = []
    let i = 0
    let j = 0
    while (i < base.length && j < extra.length) {
      if (base[i] <= extra[j]) out.push(base[i++])
      else out.push(extra[j++])
    }
    while (i < base.length) out.push(base[i++])
    while (j < extra.length) out.push(extra[j++])
    return out
  }

  const childOrder = (a, b) =>
    rankOf(a, focusFolders, touchedFolders) - rankOf(b, focusFolders, touchedFolders) ||
    (changedCount.get(b) ?? 0) - (changedCount.get(a) ?? 0) ||
    (index.fileCount.get(b) ?? 0) - (index.fileCount.get(a) ?? 0) ||
    byName(a, b)

  const sortedChildren = (path) => [...kidsFor(path)].sort(childOrder)

  const drawn = new Set([''])
  focusFolders.forEach((path) => drawn.add(path))
  const pinned = alwaysPlan(index, alwaysLevel, alwaysLimit)
  pinned.forEach((path) => drawn.add(path))
  focusFolders.forEach((path) => {
    const expanded = expandedPaths.has(path)
    const limit = expanded ? (path === '' ? Number.POSITIVE_INFINITY : MAX_CHILD_CARDS) : folderLimit
    sortedChildren(path).slice(0, limit).forEach((child) => drawn.add(child))
  })

  const itemCap = limitItems ? Math.min(itemLimit, MAX_FOLDER_ITEMS) : MAX_FOLDER_ITEMS
  const folderCap = limitItems ? folderLimit : Number.POSITIVE_INFINITY

  const itemsFor = (path) => {
    const total =
      (fileChildren.get(path)?.length ?? 0) +
      (extraChildren.get(path)?.length ?? 0) -
      (drawnKids.get(path)?.length ?? 0) +
      (filesIn.get(path)?.length ?? 0)
    const items = []
    let folderCount = 0
    const marks = rankMarks.get(path)
    if (marks) {
      const ranked = [...marks.entries()].sort((a, b) => a[1].rank - b[1].rank || byName(a[0], b[0]))
      for (const [item, mark] of ranked) {
        if (mark.kind === 'dir' && drawn.has(item)) continue
        items.push({ path: item, kind: mark.kind })
        if (mark.kind === 'dir') folderCount += 1
      }
    }
    let remaining = Math.max(0, itemCap - items.length)
    if (remaining > 0) {
      const kids = kidsFor(path)
      const files = filesIn.get(path) ?? EMPTY
      let i = 0
      let j = 0
      while (remaining > 0 && (i < kids.length || j < files.length)) {
        let item = ''
        let isDir = false
        if (j >= files.length || (i < kids.length && kids[i] <= files[j])) {
          item = kids[i]
          i += 1
          isDir = true
        } else {
          item = files[j]
          j += 1
        }
        if (isDir && drawn.has(item)) continue
        if (marks && marks.has(item)) continue
        if (isDir && folderCount >= folderCap) continue
        items.push({ path: item, kind: isDir ? 'dir' : 'file' })
        if (isDir) folderCount += 1
        remaining -= 1
      }
    }
    return { items, hiddenItems: Math.max(0, total - items.length) }
  }

  const optionKey = `${alwaysLevel}|${alwaysLimit}|${folderLimit}|${itemLimit}|${limitItems ? 1 : 0}`

  const drawnKids = new Map()
  for (const path of drawn) {
    if (path === '') continue
    const parent = parentOf(path)
    const list = drawnKids.get(parent)
    if (list) list.push(path)
    else drawnKids.set(parent, [path])
  }
  drawnKids.forEach((list) => list.sort(byName))

  const rankMarks = new Map()
  const markRank = (path, rank) => {
    if (path === '') return
    const parent = parentOf(path)
    let map = rankMarks.get(parent)
    if (!map) rankMarks.set(parent, (map = new Map()))
    const kept = map.get(path)
    if (kept && kept.rank <= rank) return
    map.set(path, { rank, kind: fileSet.has(path) ? 'file' : 'dir' })
  }
  focusSet.forEach((path) => markRank(path, 0))
  focusFolders.forEach((path) => markRank(path, 0))
  touchedSet.forEach((path) => markRank(path, 1))
  touchedFolders.forEach((path) => markRank(path, 1))

  const folderKey = (path) => {
    const parts = [optionKey, String(index.folderVersion.get(path) ?? 0), pinned.has(path) ? '1' : '0']
    for (const child of drawnKids.get(path) ?? []) {
      parts.push('d', child, String(rankOf(child, focusFolders, touchedFolders)))
    }
    const marks = rankMarks.get(path)
    if (marks) {
      for (const item of [...marks.keys()].sort(byName)) {
        const mark = marks.get(item)
        parts.push(mark.kind === 'dir' ? 'r' : 'f', item, String(mark.rank))
      }
    }
    return parts.join('|')
  }

  const plan = [...drawn].sort(byName).map((path) => {
    const key = folderKey(path)
    const cached = index.views.get(path)
    if (cached && cached.key === key) return cached.view
    const made = itemsFor(path)
    const hiddenKids = (fileChildren.get(path)?.length ?? 0) + (extraChildren.get(path)?.length ?? 0) - (drawnKids.get(path)?.length ?? 0)
    const isPinned = pinned.has(path)
    const view = {
      path,
      state: 'files',
      folders: [],
      back: path === '' ? 0 : Math.min(3, hiddenKids),
      hiddenFolders: hiddenKids,
      items: made.items,
      hiddenItems: made.hiddenItems,
    }
    if (isPinned) view.pinned = true
    index.views.set(path, { key, view })
    return view
  })
  if (index.views.size > drawn.size * 2 + 32) {
    for (const path of index.views.keys()) if (!drawn.has(path)) index.views.delete(path)
  }
  return plan
}
