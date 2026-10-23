export function parentPath(path) {
  if (!path) return ''
  const at = path.lastIndexOf('/')
  return at === -1 ? '' : path.slice(0, at)
}
