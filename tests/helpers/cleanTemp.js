import { readdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { TEMP_ROOT } from './tempRoot.js'

export function staleFolders(names, isAlive) {
  const stale = []
  for (const name of names) {
    if (typeof name !== 'string' || !/^[1-9][0-9]*$/.test(name)) continue
    const pid = Number(name)
    if (!Number.isSafeInteger(pid)) continue
    let alive = true
    try {
      alive = isAlive(pid)
    } catch {
      alive = true
    }
    if (!alive) stale.push(name)
  }
  return stale
}

export function isAlive(pid) {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return error.code === 'EPERM'
  }
}

export function cleanTempRoot(root = TEMP_ROOT, alive = isAlive) {
  let names
  try {
    names = readdirSync(root)
  } catch {
    return []
  }
  const stale = staleFolders(names, alive)
  for (const name of stale) rmSync(join(root, name), { recursive: true, force: true })
  return stale
}

export default function cleanTemp() {
  cleanTempRoot()
}
