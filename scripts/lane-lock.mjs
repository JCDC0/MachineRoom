import { existsSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { isLockHolderStale, listProcesses } from '../server/processTree.js'
import { laneLockPids, laneLockText } from '../src/briefs/run.js'

function readHolder(path) {
  try {
    return readFileSync(path, 'utf8')
  } catch {
    return ''
  }
}

export function readLaneLock(path) {
  return laneLockPids(readHolder(path))
}

export function processAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return error?.code === 'EPERM'
  }
}

function running(laneKey, holder, path) {
  return new Error(`The ${laneKey} lane is already running (process ${holder}). Wait for that run to end, or delete ${path} if no run is going.`)
}

function stoppedHalfWay(laneKey) {
  return new Error(`Another start of the ${laneKey} lane stopped half way. Start it again.`)
}

function take(path, folder) {
  try {
    writeFileSync(path, laneLockText({ pid: process.pid, folder }), { flag: 'wx' })
    return true
  } catch (error) {
    if (error?.code === 'EEXIST') return false
    throw error
  }
}

function isHolderAlive(holder, path, { platform = process.platform, list = listProcesses, stat = statSync } = {}) {
  if (!processAlive(holder)) return false
  if (platform !== 'win32') return true
  let mtime = null
  try {
    mtime = stat(path).mtimeMs
  } catch {
    mtime = null
  }
  return !isLockHolderStale(holder, mtime, { platform, list })
}

function clearTakeover(takeover, laneKey, lock, holderAlive = processAlive) {
  const holder = readLaneLock(takeover).pid
  if (holderAlive(holder, takeover)) throw running(laneKey, holder, lock)
  rmSync(takeover, { force: true })
  throw stoppedHalfWay(laneKey)
}

export function takeLaneLock(folder, laneKey, { beforeRetry = () => {}, worktree = '', platform = process.platform, list = listProcesses, stat = statSync } = {}) {
  const holderAlive = (pid, file) => isHolderAlive(pid, file, { platform, list, stat })
  const path = join(folder, `${laneKey}.lock`)
  const takeover = `${path}.takeover`
  if (existsSync(takeover)) clearTakeover(takeover, laneKey, path, holderAlive)
  if (take(path, worktree)) return path
  const holderText = readHolder(path)
  const holder = laneLockPids(holderText).pid
  if (holderAlive(holder, path)) throw running(laneKey, holder, path)
  beforeRetry()
  const mine = take(takeover, worktree)
  if (!mine) clearTakeover(takeover, laneKey, path, holderAlive)
  try {
    const current = readHolder(path)
    if (current !== holderText) throw running(laneKey, laneLockPids(current).pid || holder, path)
    if (holderAlive(laneLockPids(current).pid, path)) throw running(laneKey, laneLockPids(current).pid, path)
    rmSync(path, { force: true })
    if (!take(path, worktree)) throw running(laneKey, laneLockPids(readHolder(path)).pid, path)
    return path
  } finally {
    if (mine) rmSync(takeover, { force: true })
  }
}

export function writeLaneChild(path, childPid) {
  if (!Number.isInteger(childPid) || childPid <= 0) return false
  const holder = readLaneLock(path)
  if (holder.pid !== process.pid) return false
  writeFileSync(path, laneLockText({ pid: holder.pid, child: childPid, folder: holder.folder }))
  return true
}

export function releaseLaneLock(path) {
  if (readLaneLock(path).pid === process.pid) rmSync(path, { force: true })
}
