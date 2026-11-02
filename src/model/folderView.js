import { ancestors, dirname, normalise } from './paths.js'

const DEFAULT_MAX_FOLDERS = 3
const DEFAULT_MAX_ITEMS = 10
const DEFAULT_MAX_ALWAYS = 300
const MAX_ALWAYS_DEPTH = 3

export const MAX_CHILD_CARDS = 10

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

function addFolder(path, has, add, kids) {
  const missing = []
  for (let at = path; !has(at); at = parentOf(at)) missing.push(at)
  missing.forEach(add)
  missing.forEach((at) => {
    const parent = parentOf(at)
    const list = kids.get(parent)
    if (list) list.push(at)
    else kids.set(parent, [at])
  })
}

function addFile(index, raw) {
  const path = clean(raw)
  if (!path || index.fileSet.has(path)) return
  index.fileSet.add(path)
  const parent = parentOf(path)
  addFolder(parent, (at) => index.folders.has(at), (at) => index.folders.add(at), index.children)
  for (let at = parent; ; at = parentOf(at)) {
    index.fileCount.set(at, (index.fileCount.get(at) ?? 0) + 1)
    if (at === '') break
  }
  const list = index.filesIn.get(parent)
  if (list) list.push(path)
  else index.filesIn.set(parent, [path])
}

function extendIndex(index, files) {
  const before = index.source
  if (files.length < before.length) return false
  const added = []
  let kept = 0
  for (const raw of files) {
    if (kept < before.length && raw === before[kept]) kept += 1
    else added.push(raw)
  }
  if (kept !== before.length) return false
  added.forEach((raw) => addFile(index, raw))
  index.source = [...files]
  return true
}

let lastIndex = null

function indexFiles(files) {
  if (lastIndex && extendIndex(lastIndex, files)) return lastIndex
  const index = {
    source: [...files],
    fileSet: new Set(),
    folders: new Set(['']),
    filesIn: new Map(),
    children: new Map(),
    fileCount: new Map([['', 0]]),
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
      const children = [...(index.children.get(parent) ?? [])].sort(
        (a, b) => (index.fileCount.get(b) ?? 0) - (index.fileCount.get(a) ?? 0) || byName(a, b),
      )
      const kept = parent === '' ? children : children.slice(0, MAX_CHILD_CARDS)
      for (const child of kept) {
        if (budget <= 0) break
        pinned.add(child)
        next.push(child)
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

  const children = {
    get: (path) => [...(fileChildren.get(path) ?? []), ...(extraChildren.get(path) ?? [])],
  }

  const sortedChildren = (path) =>
    [...children.get(path)].sort(
      (a, b) => rankOf(a, focusFolders, touchedFolders) - rankOf(b, focusFolders, touchedFolders) || byName(a, b),
    )

  const expandedChildren = (path) =>
    [...children.get(path)].sort(
      (a, b) =>
        rankOf(a, focusFolders, touchedFolders) - rankOf(b, focusFolders, touchedFolders) ||
        (index.fileCount.get(b) ?? 0) - (index.fileCount.get(a) ?? 0) ||
        byName(a, b),
    )

  const drawn = new Set([''])
  focusFolders.forEach((path) => drawn.add(path))
  const pinned = alwaysPlan(index, alwaysLevel, alwaysLimit)
  pinned.forEach((path) => drawn.add(path))
  focusFolders.forEach((path) => {
    const expanded = expandedPaths.has(path)
    const limit = expanded ? (path === '' ? Number.POSITIVE_INFINITY : MAX_CHILD_CARDS) : folderLimit
    const order = expanded ? expandedChildren(path) : sortedChildren(path)
    order.slice(0, limit).forEach((child) => drawn.add(child))
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

  return [...drawn].sort(byName).map((path) => {
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
    return view
  })
}
