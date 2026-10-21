import { ancestors } from './paths.js'

const DEFAULT_MAX_TILES = 400

function parentOf(path) {
  const at = path.lastIndexOf('/')
  return at === -1 ? '' : path.slice(0, at)
}

function chainOf(path) {
  return [...ancestors(path), path]
}

export function planCollapse({ folders = [], fileCounts = new Map(), hot = [], maxTiles = DEFAULT_MAX_TILES } = {}) {
  const tree = new Set([''])
  folders.forEach((folder) => {
    if (typeof folder !== 'string' || folder.includes('\\') || folder.includes('//')) {
      chainOf(folder).forEach((part) => tree.add(part))
      return
    }
    for (let at = folder; !tree.has(at); at = parentOf(at)) tree.add(at)
  })

  const shallowestFirst = [...tree]
    .map((path) => ({ path, depth: path === '' ? 0 : path.split('/').length }))
    .sort((a, b) => a.depth - b.depth || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
    .map((entry) => entry.path)

  const children = new Map()
  tree.forEach((path) => children.set(path, []))
  tree.forEach((path) => {
    if (path !== '') children.get(parentOf(path)).push(path)
  })

  const open = new Set([''])
  hot.forEach((path) => {
    if (tree.has(path)) chainOf(path).forEach((part) => open.add(part))
  })

  const subtreeFolders = new Map()
  const subtreeFiles = new Map()
  const deepestFirst = [...shallowestFirst].reverse()
  deepestFirst.forEach((path) => {
    let folderCount = 1
    let fileCount = fileCounts.get(path) ?? 0
    children.get(path).forEach((child) => {
      folderCount += subtreeFolders.get(child)
      fileCount += subtreeFiles.get(child)
    })
    subtreeFolders.set(path, folderCount)
    subtreeFiles.set(path, fileCount)
  })

  let tiles = 0
  tree.forEach((path) => {
    if (open.has(path) || open.has(parentOf(path))) tiles += 1
  })

  const overBudget = tiles > maxTiles

  if (!overBudget) {
    shallowestFirst.forEach((path) => {
      if (open.has(path) || !open.has(parentOf(path))) return
      const childCount = children.get(path).length
      if (tiles + childCount > maxTiles) return
      open.add(path)
      tiles += childCount
    })
  }

  const visible = [...open].sort()
  const collapsed = []
  tree.forEach((path) => {
    if (open.has(path) || !open.has(parentOf(path))) return
    collapsed.push({ path, folders: subtreeFolders.get(path), files: subtreeFiles.get(path) })
  })
  collapsed.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))

  return { visible, collapsed, overBudget }
}
