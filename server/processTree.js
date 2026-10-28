import { spawnSync } from 'node:child_process'

export const KILL_TIMEOUT_MS = 10000
export const LIST_TIMEOUT_MS = 20000

export const WINDOWS_LIST_COMMAND = 'Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,CommandLine | ConvertTo-Json -Compress'

export function treeSpawnOptions(platform = process.platform) {
  return platform === 'win32' ? {} : { detached: true }
}

export function processListCommand(platform = process.platform) {
  if (platform === 'win32') {
    return { file: 'powershell', args: ['-NoProfile', '-Command', WINDOWS_LIST_COMMAND] }
  }
  return { file: 'ps', args: ['-eo', 'pid,ppid,args'] }
}

function processRow(pid, ppid, command) {
  if (!Number.isInteger(pid) || pid < 0) return null
  if (!Number.isInteger(ppid) || ppid < 0) return null
  return { pid, ppid, command: typeof command === 'string' ? command : '' }
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
    const row = processRow(pid, ppid, item?.CommandLine ?? item?.command ?? '')
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

function parentChain(byPid, pid) {
  const chain = new Set()
  let current = pid
  while (Number.isInteger(current) && current > 0 && !chain.has(current)) {
    chain.add(current)
    current = byPid.get(current)?.ppid
  }
  return chain
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
    const related = child > 0 && parentChain(byPid, item.ppid).has(child)
    const named = folder !== '' && processKey(item.command, platform).includes(folder)
    if (related || named) found.push(item)
  }
  return found.sort((left, right) => left.pid - right.pid)
}

export function killTree(child, { platform = process.platform, run = spawnSync, kill = process.kill } = {}) {
  const pid = child?.pid
  if (!Number.isInteger(pid) || pid <= 0) return false
  if (platform === 'win32') {
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
