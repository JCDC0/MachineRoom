import { readStorage, store, writeStorage } from '../storage.js'

export const LAUNCHER_FLAG = 'machineroom.launcher'
export const LAUNCHER_SEEN = '1'
export const LAUNCHER_EVENT = 'machineroom:projects'
export const POLL_INTERVAL_MS = 500
export const POLL_TIMEOUT_MS = 30000
export const LAUNCHER_TIMEOUT_TEXT = 'The room did not come back. Run machineroom in that folder.'

export function launcherSeen(storage = store()) {
  try {
    return readStorage(LAUNCHER_FLAG, storage) === LAUNCHER_SEEN
  } catch {
    return false
  }
}

export function markLauncherSeen(storage = store()) {
  try {
    return writeStorage(LAUNCHER_FLAG, LAUNCHER_SEEN, storage)
  } catch {
    return false
  }
}

export function rootIsGit(projects) {
  const current = projects?.current
  if (!current || typeof current.path !== 'string' || current.path === '') return false
  if (current.git === false) return false
  if (current.git === true) return true
  return Array.isArray(projects.folders) && projects.folders.length > 0
}

export function shouldOpenLauncher({ live = false, seen = false, projects = null } = {}) {
  if (!live || seen || !projects) return false
  return !rootIsGit(projects)
}

function normalizePath(value) {
  if (typeof value !== 'string') return ''
  let text = value.trim().replace(/\\/g, '/')
  if (text === '') return ''
  while (text.length > 1 && text.endsWith('/') && !/^[a-zA-Z]:\/$/.test(text)) {
    text = text.slice(0, -1)
  }
  return text
}

function windowsPath(text) {
  return /^[a-zA-Z]:\//.test(text) || text.startsWith('//')
}

function rowKey(path) {
  const text = normalizePath(path)
  return windowsPath(text) ? text.toLowerCase() : text
}

export function samePath(a, b) {
  const left = normalizePath(a)
  const right = normalizePath(b)
  if (left === '' || right === '') return false
  if (windowsPath(left) || windowsPath(right)) return left.toLowerCase() === right.toLowerCase()
  return left === right
}

export function pathName(value) {
  const text = normalizePath(value)
  if (text === '') return ''
  if (/^[a-zA-Z]:\/?$/.test(text)) return text
  const parts = text.split('/')
  return parts[parts.length - 1] || text
}

export function absolutePathProblem(value) {
  const text = typeof value === 'string' ? value.trim() : ''
  if (text === '') return 'Type the path of a folder.'
  if (text.includes('\0')) return 'Type an absolute folder path.'
  if (/^[a-zA-Z]:[\\/]/.test(text)) return null
  if (/^\\\\[^\\]+\\[^\\]+/.test(text)) return null
  if (text.startsWith('//')) return null
  if (text.startsWith('/')) return null
  return 'Type an absolute folder path.'
}

export function keepWorkingLabel(name) {
  return `Keep working in ${name}`
}

export function openingLabel(name) {
  return `Opening ${name}...`
}

export function launcherRows(projects) {
  const current = projects?.current
  const currentPath = typeof current?.path === 'string' ? current.path : ''
  const recent = Array.isArray(projects?.recent) ? projects.recent : []
  const folders = Array.isArray(projects?.folders) ? projects.folders : []

  const gitByPath = new Map()
  for (const folder of folders) {
    if (!folder || typeof folder.path !== 'string') continue
    if (folder.git === true) gitByPath.set(rowKey(folder.path), true)
  }

  const rows = []
  const seen = new Set()
  function add(entry, source) {
    if (!entry || typeof entry.path !== 'string' || entry.path === '') return
    if (currentPath !== '' && samePath(entry.path, currentPath)) return
    const key = rowKey(entry.path)
    if (key === '' || seen.has(key)) return
    seen.add(key)
    rows.push({
      path: entry.path,
      name: typeof entry.name === 'string' && entry.name !== '' ? entry.name : pathName(entry.path),
      git: entry.git === true || gitByPath.get(key) === true,
      source,
    })
  }

  for (const entry of recent) add(entry, 'recent')
  for (const entry of folders) add(entry, 'folder')

  return rows.sort((left, right) => Number(right.git) - Number(left.git))
}

export function pollProject({
  probe,
  path,
  intervalMs = POLL_INTERVAL_MS,
  timeoutMs = POLL_TIMEOUT_MS,
  shouldStop = null,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
  now = Date.now,
} = {}) {
  return new Promise((resolve) => {
    const started = now()
    let finished = false
    let tick = null
    let deadline = null

    function stopWanted() {
      return typeof shouldStop === 'function' && shouldStop() === true
    }

    function finish(result) {
      if (finished) return
      finished = true
      if (tick !== null) clearTimer(tick)
      if (deadline !== null) clearTimer(deadline)
      resolve(result)
    }

    function schedule() {
      if (finished) return
      if (stopWanted()) {
        finish({ ok: false, reason: 'cancelled' })
        return
      }
      const left = timeoutMs - (now() - started)
      if (left <= 0) {
        finish({ ok: false, reason: 'timeout' })
        return
      }
      tick = setTimer(check, Math.min(intervalMs, left))
    }

    async function check() {
      tick = null
      if (finished) return
      if (stopWanted()) {
        finish({ ok: false, reason: 'cancelled' })
        return
      }
      let answer = null
      try {
        answer = await probe()
      } catch {
        answer = null
      }
      if (finished) return
      if (stopWanted()) {
        finish({ ok: false, reason: 'cancelled' })
        return
      }
      if (answer && answer.current && samePath(answer.current.path, path)) {
        finish({ ok: true, projects: answer })
        return
      }
      schedule()
    }

    deadline = setTimer(() => finish({ ok: false, reason: 'timeout' }), timeoutMs)
    schedule()
  })
}
