import { dirname } from '../model/paths.js'

const depth = (path) => (path === '' ? 0 : path.split('/').length)

export function folderRoute(from, to) {
  if (from === to) return [to]
  const up = []
  const down = []
  let a = from
  let b = to
  while (depth(a) > depth(b)) {
    up.push(a)
    a = dirname(a)
  }
  while (depth(b) > depth(a)) {
    down.push(b)
    b = dirname(b)
  }
  while (a !== b) {
    up.push(a)
    down.push(b)
    a = dirname(a)
    b = dirname(b)
  }
  return [...up, a, ...down.reverse()]
}
