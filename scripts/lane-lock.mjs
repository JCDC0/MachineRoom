import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

function readHolder(path) {
  try {
    return readFileSync(path, 'utf8')
  } catch {
    return ''
  }
}

function processAlive(pid) {
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

function take(path) {
  try {
    writeFileSync(path, String(process.pid), { flag: 'wx' })
    return true
  } catch (error) {
    if (error?.code === 'EEXIST') return false
    throw error
  }
}

function clearTakeover(takeover, laneKey, lock) {
  const holder = Number.parseInt(readHolder(takeover), 10)
  if (processAlive(holder)) throw running(laneKey, holder, lock)
  rmSync(takeover, { force: true })
  throw stoppedHalfWay(laneKey)
}

export function takeLaneLock(folder, laneKey, { beforeRetry = () => {} } = {}) {
  const path = join(folder, `${laneKey}.lock`)
  const takeover = `${path}.takeover`
  if (existsSync(takeover)) clearTakeover(takeover, laneKey, path)
  if (take(path)) return path
  const holderText = readHolder(path)
  const holder = Number.parseInt(holderText, 10)
  if (processAlive(holder)) throw running(laneKey, holder, path)
  beforeRetry()
  const mine = take(takeover)
  if (!mine) clearTakeover(takeover, laneKey, path)
  try {
    const current = readHolder(path)
    if (current !== holderText) throw running(laneKey, Number.parseInt(current, 10) || holder, path)
    if (processAlive(holder)) throw running(laneKey, holder, path)
    rmSync(path, { force: true })
    if (!take(path)) throw running(laneKey, Number.parseInt(readHolder(path), 10), path)
    return path
  } finally {
    if (mine) rmSync(takeover, { force: true })
  }
}

export function releaseLaneLock(path) {
  if (Number.parseInt(readHolder(path), 10) === process.pid) rmSync(path, { force: true })
}
