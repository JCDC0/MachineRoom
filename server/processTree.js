import { spawnSync } from 'node:child_process'

export const KILL_TIMEOUT_MS = 10000
export const LIST_TIMEOUT_MS = 20000

export const WINDOWS_LIST_COMMAND = 'Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,CommandLine,CreationDate | ConvertTo-Json -Compress'

export function treeSpawnOptions(platform = process.platform) {
  return platform === 'win32' ? {} : { detached: true }
}

export function processListCommand(platform = process.platform) {
  if (platform === 'win32') {
    return { file: 'powershell', args: ['-NoProfile', '-Command', WINDOWS_LIST_COMMAND] }
  }
  return { file: 'ps', args: ['-eo', 'pid,ppid,args'] }
}

function parseCreationDate(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') {
    const match = /\/Date\((\d+)(?:[+-]\d+)?\)\//.exec(value)
    if (match) {
      const ms = Number(match[1])
      if (Number.isFinite(ms)) return ms
    }
    const parsed = Date.parse(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return null
}

function processRow(pid, ppid, command, created = null) {
  if (!Number.isInteger(pid) || pid < 0) return null
  if (!Number.isInteger(ppid) || ppid < 0) return null
  const row = { pid, ppid, command: typeof command === 'string' ? command : '' }
  if (typeof created === 'number' && Number.isFinite(created)) row.created = created
  return row
}

function windowsRows(text) {
  let parsed
  try {
    parsed = JSON.parse(text)
  } catch {
    return []
  }
  const items = Array.isArray(parsed) ? parsed : parsed && typeof parsed === 'object' ? [parsed] : []
  const rows = []
  for (const item of items) {
    const pid = Number(item?.ProcessId ?? item?.pid)
    const ppid = Number(item?.ParentProcessId ?? item?.ppid)
    const created = parseCreationDate(item?.CreationDate ?? item?.created)
    const row = processRow(pid, ppid, item?.CommandLine ?? item?.command ?? '', created)
    if (row) rows.push(row)
  }
  return rows
}

function psRows(text) {
  const rows = []
  for (const line of String(text ?? '').split(/\r?\n/)) {
    const match = /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(line)
    if (!match) continue
    const row = processRow(Number(match[1]), Number(match[2]), match[3])
    if (row) rows.push(row)
  }
  return rows
}

export function parseProcessList(text, { platform = process.platform } = {}) {
  const raw = String(text ?? '').trim()
  if (raw === '') return []
  if (platform === 'win32' || raw.startsWith('[') || raw.startsWith('{')) return windowsRows(raw)
  return psRows(raw)
}

export function listProcesses({ platform = process.platform, run = spawnSync, timeout = LIST_TIMEOUT_MS } = {}) {
  const command = processListCommand(platform)
  const result = run(command.file, command.args, {
    encoding: 'utf8',
    windowsHide: true,
    timeout,
    maxBuffer: 32 * 1024 * 1024,
  })
  if (result?.error || result?.status !== 0) return []
  return parseProcessList(String(result.stdout ?? ''), { platform })
}

function processKey(command, platform) {
  const text = String(command ?? '').replace(/\\/g, '/').replace(/\/+/g, '/')
  return platform === 'win32' ? text.toLowerCase() : text
}

function folderKey(folder, platform) {
  const text = String(folder ?? '').trim().replace(/\\/g, '/').replace(/\/+$/, '')
  if (!text) return ''
  return platform === 'win32' ? text.toLowerCase() : text
}

function namesFolder(command, folder) {
  if (folder === '') return false
  let at = command.indexOf(folder)
  while (at !== -1) {
    const next = command[at + folder.length]
    if (next === undefined || next === '/' || next === '"' || next === "'" || /\s/.test(next)) return true
    at = command.indexOf(folder, at + 1)
  }
  return false
}

function parentChain(byPid, pid) {
  const chain = new Set()
  let current = pid
  while (Number.isInteger(current) && current > 0 && !chain.has(current)) {
    chain.add(current)
    const currentProc = byPid.get(current)
    const nextPid = currentProc?.ppid
    if (!Number.isInteger(nextPid) || nextPid <= 0 || chain.has(nextPid)) break
    const nextProc = byPid.get(nextPid)
    if (currentProc && nextProc && typeof currentProc.created === 'number' && typeof nextProc.created === 'number') {
      if (nextProc.created > currentProc.created) break
    }
    current = nextPid
  }
  return chain
}

export function descendantProcesses(processes, { rootPid = 0, ownPid = 0, excludePids = [] } = {}) {
  const list = (Array.isArray(processes) ? processes : [])
    .filter((item) => Number.isInteger(item?.pid) && item.pid > 0 && Number.isInteger(item?.ppid))
  const byPid = new Map(list.map((item) => [item.pid, item]))
  const root = Number.isInteger(rootPid) && rootPid > 0 ? rootPid : 0
  if (root === 0) return []
  const excluded = ownPid > 0 ? parentChain(byPid, ownPid) : new Set()
  for (const pid of Array.isArray(excludePids) ? excludePids : []) {
    if (Number.isInteger(pid) && pid > 0) excluded.add(pid)
  }
  const found = []
  for (const item of list) {
    if (item.pid === root) continue
    if (excluded.has(item.pid)) continue
    if (parentChain(byPid, item.pid).has(root)) found.push(item)
  }
  return found.sort((left, right) => left.pid - right.pid)
}

export function leftoverProcesses(processes, { childPid = 0, worktree = '', ownPid = 0, excludePids = [], platform = process.platform } = {}) {
  const list = (Array.isArray(processes) ? processes : [])
    .filter((item) => Number.isInteger(item?.pid) && item.pid > 0 && Number.isInteger(item?.ppid))
  const byPid = new Map(list.map((item) => [item.pid, item]))
  const child = Number.isInteger(childPid) && childPid > 0 ? childPid : 0
  const excluded = ownPid > 0 ? parentChain(byPid, ownPid) : new Set()
  for (const pid of Array.isArray(excludePids) ? excludePids : []) {
    if (Number.isInteger(pid) && pid > 0) excluded.add(pid)
  }
  const folder = folderKey(worktree, platform)
  const found = []
  for (const item of list) {
    if (item.pid === child) continue
    if (excluded.has(item.pid)) continue
    const related = child > 0 && parentChain(byPid, item.pid).has(child)
    const named = namesFolder(processKey(item.command, platform), folder)
    if (related || named) found.push(item)
  }
  return found.sort((left, right) => left.pid - right.pid)
}

export function killTree(child, { platform = process.platform, run = spawnSync, kill = process.kill } = {}) {
  const pid = child?.pid
  if (!Number.isInteger(pid) || pid <= 0) return false
  if (platform === 'win32') {
    // Windows reuses a process id quickly, so taskkill on an exited child can stop a stranger.
    if ((child.exitCode ?? child.signalCode ?? null) !== null) return false
    const result = run('taskkill', ['/T', '/F', '/PID', String(pid)], { windowsHide: true, timeout: KILL_TIMEOUT_MS })
    return !result?.error && result?.status === 0
  }
  try {
    kill(-pid, 'SIGKILL')
    return true
  } catch {}
  try {
    return kill(pid, 'SIGKILL') !== false
  } catch {}
  try {
    return child.kill('SIGKILL') !== false
  } catch {
    return false
  }
}

export function isCreatedAfterLock(created, lockMtime, platform = process.platform) {
  return platform === 'win32' && typeof created === 'number' && (lockMtime === null || created > lockMtime + 2000)
}

export function isLockHolderStale(pid, lockMtime, { platform = process.platform, processes = null, list = listProcesses } = {}) {
  if (platform !== 'win32' || !Number.isInteger(pid) || pid <= 0) return false
  const listItems = processes instanceof Map ? processes : Array.isArray(processes) ? processes : list({ platform })
  if (listItems instanceof Map) {
    const found = listItems.get(pid)
    return isCreatedAfterLock(found?.created, lockMtime, platform)
  }
  if (!Array.isArray(listItems) || listItems.length === 0) return false
  const found = listItems.find((item) => item?.pid === pid)
  return isCreatedAfterLock(found?.created, lockMtime, platform)
}
