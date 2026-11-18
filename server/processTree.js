import { spawn, spawnSync } from 'node:child_process'
import { readdirSync, readFileSync } from 'node:fs'
import { createInterface } from 'node:readline'

export const KILL_TIMEOUT_MS = 10000
export const LIST_TIMEOUT_MS = 20000
const SAMPLE_MS = 100

export const WINDOWS_LIST_COMMAND = 'Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,CommandLine,CreationDate | ConvertTo-Json -Compress'

export function treeSpawnOptions(platform = process.platform) {
  return platform === 'win32' ? {} : { detached: true }
}

export function processListCommand(platform = process.platform) {
  if (platform === 'win32') {
    return { file: 'powershell', args: ['-NoProfile', '-Command', WINDOWS_LIST_COMMAND] }
  }
  return { file: 'ps', args: ['-eo', platform === 'linux' ? 'pid,ppid,args' : 'pid,ppid,lstart,args'] }
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

function psRows(text, platform) {
  const rows = []
  for (const line of String(text ?? '').split(/\r?\n/)) {
    const match = /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(line)
    if (!match) continue
    const dated = platform !== 'linux' && /^(\S+\s+\S+\s+\d+\s+\d{2}:\d{2}:\d{2}\s+\d{4})(?:\s+(.*))?$/.exec(match[3])
    const row = processRow(Number(match[1]), Number(match[2]), dated ? dated[2] : match[3], dated ? parseCreationDate(`${dated[1]} UTC`) : null)
    if (row) rows.push(row)
  }
  return rows
}

export function parseProcessList(text, { platform = process.platform } = {}) {
  const raw = String(text ?? '').trim()
  if (raw === '') return []
  if (platform === 'win32' || raw.startsWith('[') || raw.startsWith('{')) return windowsRows(raw)
  return psRows(raw, platform)
}

function linuxProcess(pid) {
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, 'utf8')
    const fields = stat.slice(stat.lastIndexOf(')') + 2).split(' ')
    return processRow(pid, Number(fields[1]), '', Number(fields[19]))
  } catch {}
  return null
}

export function listProcesses({ platform = process.platform, run = spawnSync, timeout = LIST_TIMEOUT_MS, commands = true } = {}) {
  if (!commands && platform === 'linux') {
    try {
      return readdirSync('/proc').filter((name) => /^\d+$/.test(name)).map((name) => linuxProcess(Number(name))).filter(Boolean)
    } catch {
      return []
    }
  }
  const command = commands || platform === 'win32' ? processListCommand(platform) : { file: 'ps', args: ['-eo', 'pid,ppid,lstart'] }
  const result = run(command.file, command.args, {
    encoding: 'utf8',
    windowsHide: true,
    timeout,
    maxBuffer: 32 * 1024 * 1024,
    ...(platform !== 'win32' ? { env: { ...process.env, LC_ALL: 'C', TZ: 'UTC' } } : {}),
  })
  if (result?.error || result?.status !== 0) return []
  const rows = parseProcessList(String(result.stdout ?? ''), { platform })
  if (platform === 'linux') {
    for (const row of rows) {
      const current = linuxProcess(row.pid)
      if (current?.ppid === row.ppid && Number.isFinite(current.created)) row.created = current.created
    }
  }
  return rows
}

export function sampleProcesses(onSample, platform = process.platform) {
  if (platform !== 'win32') {
    const timer = setInterval(() => onSample(listProcesses({ platform, commands: false })), SAMPLE_MS)
    return () => clearInterval(timer)
  }
  const command = `while (Get-Process -Id ${process.pid} -ErrorAction SilentlyContinue) {
    $rows = @(Get-CimInstance -Query 'SELECT ProcessId, ParentProcessId, CreationDate FROM Win32_Process' -ErrorAction Stop | Select-Object ProcessId,ParentProcessId,CreationDate)
    ConvertTo-Json -InputObject $rows -Compress
    Start-Sleep -Milliseconds ${SAMPLE_MS}
  }`
  const sampler = spawn('powershell', ['-NoProfile', '-Command', command], { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] })
  sampler.on('error', () => {})
  const lines = createInterface({ input: sampler.stdout })
  lines.on('line', (line) => onSample(windowsRows(line)))
  return () => {
    lines.close()
    sampler.kill()
  }
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

export function leftoverProcesses(processes, { childPid = 0, childCreated, recorded = new Map(), worktree = '', worktrees = [], ownPid = 0, excludePids = [], platform = process.platform } = {}) {
  const list = (Array.isArray(processes) ? processes : [])
    .filter((item) => Number.isInteger(item?.pid) && item.pid > 0 && Number.isInteger(item?.ppid))
  const byPid = new Map(list.map((item) => [item.pid, item]))
  const child = Number.isInteger(childPid) && childPid > 0 ? childPid : 0
  const excluded = ownPid > 0 ? parentChain(byPid, ownPid) : new Set()
  for (const pid of Array.isArray(excludePids) ? excludePids : []) {
    if (Number.isInteger(pid) && pid > 0) excluded.add(pid)
  }
  const folders = [worktree, ...worktrees].map((folder) => folderKey(folder, platform)).filter(Boolean)
  const roots = new Set()
  if (child && (!byPid.has(child) || childCreated === undefined || byPid.get(child).created === childCreated)) roots.add(child)
  for (const [pid, created] of recorded) {
    if (Number.isFinite(created) && byPid.get(pid)?.created === created) roots.add(pid)
  }
  const found = []
  for (const item of list) {
    if (item.pid === child) continue
    if (excluded.has(item.pid)) continue
    const chain = roots.size > 0 ? parentChain(byPid, item.pid) : []
    const related = [...chain].some((pid) => roots.has(pid))
    if (!related && recorded.has(item.pid)) continue
    const named = folders.some((folder) => namesFolder(processKey(item.command, platform), folder))
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

export const TIMEOUT_MESSAGE = 'The check passed its time limit.'
export const SETTLE_WAIT_MS = 5000
const EXIT_SNAPSHOT_MS = 1000

export function runCheck(command, {
  cwd,
  env = process.env,
  timeoutMs = 60000,
  outputLimit = 2 * 1024 * 1024,
  settleWaitMs = SETTLE_WAIT_MS,
  spawnChild = spawn,
  kill = killTree,
  list = listProcesses,
  killPid = (pid) => spawnSync('taskkill', ['/T', '/F', '/PID', String(pid)], { windowsHide: true, timeout: KILL_TIMEOUT_MS }),
} = {}) {
  return new Promise((settle) => {
    const child = spawnChild(command[0], command.slice(1), {
      cwd,
      env,
      shell: false,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      ...treeSpawnOptions(),
    })
    let output = ''
    let timedOut = false
    let settled = false
    let recorded = []
    let snapshotTimer = null
    let timer = null
    let waitTimer = null
    const collect = (chunk) => {
      output += chunk.toString('utf8')
      if (output.length > outputLimit) output = output.slice(-outputLimit)
    }
    const finish = (result) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      clearTimeout(snapshotTimer)
      clearTimeout(waitTimer)
      if (result.timedOut) output += `${output && !output.endsWith('\n') ? '\n' : ''}${TIMEOUT_MESSAGE}\n`
      settle({ ...result, output })
    }
    const stopRecorded = () => {
      const current = list()
      for (const item of recorded) {
        if (!Number.isFinite(item.created) || !current.some((row) => row.pid === item.pid && row.created === item.created)) continue
        try {
          killPid(item.pid)
        } catch {}
      }
    }
    timer = setTimeout(() => {
      timedOut = true
      waitTimer = setTimeout(() => finish({ ok: false, code: null, timedOut: true, error: null }), settleWaitMs)
      try {
        kill(child)
        stopRecorded()
      } catch {}
    }, timeoutMs)
    child.stdout?.on('data', collect)
    child.stderr?.on('data', collect)
    child.once('exit', () => {
      if (settled || process.platform !== 'win32') return
      snapshotTimer = setTimeout(() => {
        try {
          recorded = descendantProcesses(list(), { rootPid: child.pid, ownPid: process.pid })
        } catch {}
      }, EXIT_SNAPSHOT_MS)
    })
    child.once('error', (error) => finish({ ok: false, code: null, timedOut, error }))
    child.once('close', (code) => finish({ ok: !timedOut && code === 0, code, timedOut, error: null }))
  })
}
