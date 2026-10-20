import { readFileSync, rmSync, writeFileSync } from 'node:fs'
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

export function takeLaneLock(folder, laneKey, { beforeRetry = () => {} } = {}) {
  const path = join(folder, `${laneKey}.lock`)
  try {
    writeFileSync(path, String(process.pid), { flag: 'wx' })
    return path
  } catch (error) {
    if (error?.code !== 'EEXIST') throw error
  }
  const holder = Number.parseInt(readHolder(path), 10)
  if (processAlive(holder)) throw running(laneKey, holder, path)
  rmSync(path, { force: true })
  beforeRetry()
  try {
    writeFileSync(path, String(process.pid), { flag: 'wx' })
    return path
  } catch (error) {
    if (error?.code !== 'EEXIST') throw error
    throw running(laneKey, Number.parseInt(readHolder(path), 10), path)
  }
}

export function releaseLaneLock(path) {
  if (Number.parseInt(readHolder(path), 10) === process.pid) rmSync(path, { force: true })
}
