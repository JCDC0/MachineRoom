import { ancestors, dirname, normalise } from './paths.js'

const DEFAULT_MAX_FOLDERS = 3
const DEFAULT_MAX_ITEMS = 10
const DEFAULT_MAX_ALWAYS = 300
const MAX_ALWAYS_DEPTH = 3

export const MAX_CHILD_CARDS = 10

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

function addFolder(path, has, add, kids, bump = null) {
  const missing = []
  for (let at = path; !has(at); at = parentOf(at)) missing.push(at)
  missing.forEach(add)
  missing.forEach((at) => {
    const parent = parentOf(at)
    const list = kids.get(parent)
    if (list) list.push(at)
    else kids.set(parent, [at])
    if (bump) bump(parent)
  })
}

function addFile(index, raw) {
  const path = clean(raw)
  if (!path || index.fileSet.has(path)) return
  index.fileSet.add(path)
  const parent = parentOf(path)
  addFolder(parent, (at) => index.folders.has(at), (at) => index.folders.add(at), index.children, (at) => bumpFolder(index, at))
  for (let at = parent; ; at = parentOf(at)) {
    index.fileCount.set(at, (index.fileCount.get(at) ?? 0) + 1)
    if (at === '') break
  }
  const list = index.filesIn.get(parent)
  if (list) list.push(path)
  else index.filesIn.set(parent, [path])
  bumpFolder(index, parent)
}

function extendIndex(index, files) {
  if (files === index.source) {
    if (files.length < index.length) return false
    for (let at = index.length; at < files.length; at += 1) addFile(index, files[at])
    index.length = files.length
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
  }
  files.forEach((raw) => addFile(index, raw))
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

  const children = {
    get: (path) => [...(fileChildren.get(path) ?? []), ...(extraChildren.get(path) ?? [])],
  }

  const childOrder = (a, b) =>
    rankOf(a, focusFolders, touchedFolders) - rankOf(b, focusFolders, touchedFolders) ||
    (changedCount.get(b) ?? 0) - (changedCount.get(a) ?? 0) ||
    (index.fileCount.get(b) ?? 0) - (index.fileCount.get(a) ?? 0) ||
    byName(a, b)

  const sortedChildren = (path) => [...children.get(path)].sort(childOrder)

  const drawn = new Set([''])
  focusFolders.forEach((path) => drawn.add(path))
  const pinned = alwaysPlan(index, alwaysLevel, alwaysLimit)
  pinned.forEach((path) => drawn.add(path))
  focusFolders.forEach((path) => {
    const expanded = expandedPaths.has(path)
    const limit = expanded ? (path === '' ? Number.POSITIVE_INFINITY : MAX_CHILD_CARDS) : folderLimit
    sortedChildren(path).slice(0, limit).forEach((child) => drawn.add(child))
  })

  const itemsFor = (path) => {
    const entries = []
    for (const child of children.get(path)) {
      if (drawn.has(child)) continue
      entries.push({ path: child, kind: 'dir' })
    }
    for (const file of filesIn.get(path) ?? []) entries.push({ path: file, kind: 'file' })
    const rank = (item) => {
      if (focusSet.has(item.path)) return 0
      if (item.kind === 'dir' && focusFolders.has(item.path)) return 0
      if (touchedSet.has(item.path)) return 1
      if (item.kind === 'dir' && touchedFolders.has(item.path)) return 1
      return 2
    }
    return entries.sort((a, b) => rank(a) - rank(b) || byName(a.path, b.path))
  }

  const shapeKey = [
    alwaysLevel,
    alwaysLimit,
    folderLimit,
    itemLimit,
    limitItems ? 1 : 0,
    [...drawn].sort(byName).join('\n'),
    [...pinned].sort(byName).join('\n'),
    focusPaths.join('\n'),
    touchedPaths.join('\n'),
    changedPaths.join('\n'),
    [...expandedPaths].sort(byName).join('\n'),
  ].join('|')

  const plan = [...drawn].sort(byName).map((path) => {
    const version = index.folderVersion.get(path) ?? 0
    const key = `${version}|${shapeKey}`
    const cached = index.views.get(path)
    if (cached && cached.key === key) return cached.view
    const all = itemsFor(path)
    let items = []
    if (!limitItems) items = all.slice()
    else {
      let folderCount = 0
      all.forEach((item) => {
        if (items.length >= itemLimit) return
        if (item.kind === 'dir') {
          if (folderCount >= folderLimit) return
          folderCount += 1
        }
        items.push(item)
      })
    }
    const hiddenKids = children.get(path).filter((child) => !drawn.has(child))
    const isPinned = pinned.has(path)
    const view = {
      path,
      state: 'files',
      folders: [],
      back: path === '' ? 0 : Math.min(3, hiddenKids.length),
      hiddenFolders: hiddenKids.length,
      items,
      hiddenItems: limitItems ? all.length - items.length : 0,
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
