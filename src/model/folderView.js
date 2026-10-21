import { ancestors, dirname, normalise } from './paths.js'

const DEFAULT_MAX_FOLDERS = 3
const DEFAULT_MAX_ITEMS = 10
const DEFAULT_BACK_LAYERS = 3

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
  const index = { source: [...files], fileSet: new Set(), folders: new Set(['']), filesIn: new Map(), children: new Map() }
  files.forEach((raw) => addFile(index, raw))
  lastIndex = index
  return index
}

export function planFolderView({
  files = [],
  focus = [],
  touched = [],
  maxFolders = DEFAULT_MAX_FOLDERS,
  maxItems = DEFAULT_MAX_ITEMS,
  backLayers = DEFAULT_BACK_LAYERS,
} = {}) {
  const folderLimit = count(maxFolders)
  const itemLimit = count(maxItems)
  const layerLimit = count(backLayers)

  const { fileSet, folders, filesIn, children: fileChildren } = indexFiles(files)
  const extraFolders = new Set()
  const extraChildren = new Map()
  const isFolder = (path) => folders.has(path) || extraFolders.has(path)
  const addExtra = (path) => addFolder(path, isFolder, (at) => extraFolders.add(at), extraChildren)

  const focusPaths = [...new Set(focus.map(clean))]
  const touchedPaths = [...new Set(touched.map(clean))]

  const addPath = (path) => {
    addExtra(parentOf(path))
    if (!fileSet.has(path)) addExtra(path)
  }

  focusPaths.forEach(addPath)
  touchedPaths.forEach(addPath)

  const focusSet = new Set(focusPaths)
  const touchedSet = new Set(touchedPaths)

  const focusFolders = new Set()
  focusPaths.forEach((path) => {
    ancestors(path).forEach((part) => focusFolders.add(part))
    if (isFolder(path) && !fileSet.has(path)) focusFolders.add(path)
  })

  const touchedFolders = new Set()
  touchedPaths.forEach((path) => {
    ancestors(path).forEach((part) => touchedFolders.add(part))
    if (isFolder(path)) touchedFolders.add(path)
  })

  const fileFolders = new Set()
  focusPaths.forEach((path) => {
    if (fileSet.has(path)) fileFolders.add(dirname(path))
  })

  const children = {
    get: (path) => [...(fileChildren.get(path) ?? []), ...(extraChildren.get(path) ?? [])],
  }

  const sortedChildren = (path) =>
    [...children.get(path)].sort(
      (a, b) => rankOf(a, focusFolders, touchedFolders) - rankOf(b, focusFolders, touchedFolders) || byName(a, b),
    )

  const itemsFor = (path) => {
    const entries = children.get(path).map((child) => ({ path: child, kind: 'dir' }))
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

  const drawn = new Set([''])
  focusFolders.forEach((path) => drawn.add(path))

  const shownFolders = new Map()
  focusFolders.forEach((path) => {
    const shown = sortedChildren(path).slice(0, folderLimit)
    shownFolders.set(path, shown)
    shown.forEach((child) => drawn.add(child))
  })

  return [...drawn].sort(byName).map((path) => {
    if (fileFolders.has(path)) {
      const all = itemsFor(path)
      const items = []
      let folderCount = 0
      all.forEach((item) => {
        if (items.length >= itemLimit) return
        if (item.kind === 'dir') {
          if (folderCount >= folderLimit) return
          folderCount += 1
        }
        items.push(item)
      })
      return {
        path,
        state: 'files',
        folders: [],
        back: 0,
        hiddenFolders: 0,
        items,
        hiddenItems: all.length - items.length,
      }
    }

    if (focusFolders.has(path)) {
      const shown = shownFolders.get(path) ?? []
      const hiddenFolders = children.get(path).length - shown.length
      return {
        path,
        state: 'open',
        folders: shown,
        back: Math.min(hiddenFolders, layerLimit),
        hiddenFolders,
        items: [],
        hiddenItems: 0,
      }
    }

    return { path, state: 'closed', folders: [], back: 0, hiddenFolders: 0, items: [], hiddenItems: 0 }
  })
}
