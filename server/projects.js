import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { lanesFolder } from './lanes-source.js'
import { projectHash } from './orchestrator.js'

export const MAX_RECENT = 20
export const MAX_FOLDERS = 200
export const MAX_SESSIONS = 6
export const PRUNE_INTERVAL_MS = 60000

export const ORIGIN_PROBLEM = 'A request to open a project needs a page Origin.'
export const ORIGIN_FORGET_PROBLEM = 'A request to forget a project needs a page Origin.'
export const CONFIRM_OPEN_PROBLEM = 'Confirm opening the project first.'
export const CONFIRM_FORGET_PROBLEM = 'Confirm forgetting the project first.'
export const NOT_ABSOLUTE_PROBLEM = 'Provide an absolute folder path.'
export const NOT_FOUND_PROBLEM = 'That folder does not exist.'
export const NOT_FOLDER_PROBLEM = 'That path is not a folder.'
export const NOT_IN_LIST_PROBLEM = 'That project is not in the recent projects list.'
export const TURN_RUNNING_PROBLEM = 'An orchestrator turn is running. Stop it or wait, then open the project.'
export const LANES_RUNNING_PROBLEM = 'A lane run is open. Stop it or wait, then open the project.'
export const NOT_SUPPORTED_PROBLEM = 'Open another project with machineroom FOLDER.'

const lastPruneByFile = new Map()

export function resetPruneCache() {
  lastPruneByFile.clear()
}

function samePath(a, b) {
  if (!a || !b) return false
  const left = resolve(a)
  const right = resolve(b)
  return process.platform === 'win32' ? left.toLowerCase() === right.toLowerCase() : left === right
}

function isInside(child, parent) {
  if (!child || !parent) return false
  const c = resolve(child)
  const p = resolve(parent)
  const normC = process.platform === 'win32' ? c.toLowerCase() : c
  const normP = process.platform === 'win32' ? p.toLowerCase() : p
  if (normC === normP) return true
  const rel = relative(normP, normC)
  return !rel.startsWith('..') && !isAbsolute(rel)
}

export function isTempFolder(projectPath, env = process.env) {
  if (!projectPath) return false
  const target = resolve(projectPath)
  const candidates = []
  if (env.MACHINEROOM_TEMP) {
    candidates.push(resolve(env.MACHINEROOM_TEMP))
  } else {
    try {
      const td = tmpdir()
      if (td) candidates.push(resolve(td))
    } catch {}
    if (env.TEMP) candidates.push(resolve(env.TEMP))
  }
  for (const root of candidates) {
    if (isInside(target, root)) return true
  }
  return false
}

export function hasWorktreesFolder(projectPath) {
  if (!projectPath) return false
  const parts = resolve(projectPath).split(/[\\/]/)
  return parts.includes('.worktrees')
}

export function isConfiguredLaneWorktree(projectPath) {
  if (!projectPath) return false
  try {
    const lanesFile = join(lanesFolder(), 'lanes.json')
    if (!existsSync(lanesFile)) return false
    const raw = JSON.parse(readFileSync(lanesFile, 'utf8'))
    if (!raw || typeof raw !== 'object') return false
    for (const lane of Object.values(raw)) {
      if (lane && typeof lane.worktree === 'string' && lane.worktree.trim()) {
        if (samePath(lane.worktree, projectPath) || isInside(projectPath, lane.worktree)) return true
      }
    }
  } catch {}
  return false
}

export function isRunsFolder(projectPath) {
  if (!projectPath) return false
  try {
    return existsSync(join(projectPath, 'runs.jsonl'))
  } catch {
    return false
  }
}

export function shouldSkipProject(projectPath, env = process.env) {
  if (!projectPath || typeof projectPath !== 'string' || !projectPath.trim()) return true
  const resolved = resolve(projectPath)
  if (isTempFolder(resolved, env)) return true
  if (hasWorktreesFolder(resolved)) return true
  if (isConfiguredLaneWorktree(resolved)) return true
  if (isRunsFolder(resolved)) return true
  return false
}

export function readProjectsFile(file) {
  try {
    if (!existsSync(file)) return { recent: [] }
    const text = readFileSync(file, 'utf8')
    const data = JSON.parse(text)
    if (!data || typeof data !== 'object') return { recent: [] }
    const recent = Array.isArray(data.recent) ? data.recent : []
    const valid = recent.filter(
      (item) => item && typeof item.path === 'string' && item.path.trim() && typeof item.openedAt === 'string'
    )
    return { recent: valid }
  } catch {
    return { recent: [] }
  }
}

function saveProjectsFile(projectsFile, recent) {
  try {
    mkdirSync(dirname(projectsFile), { recursive: true })
    const temporary = `${projectsFile}.tmp`
    const content = `${JSON.stringify({ recent }, null, 2)}\n`
    writeFileSync(temporary, content, 'utf8')
    try {
      renameSync(temporary, projectsFile)
    } catch {
      writeFileSync(projectsFile, content, 'utf8')
    } finally {
      try {
        unlinkSync(temporary)
      } catch {}
    }
  } catch {}
}

export function recordProject(projectsFile, projectPath, now = Date.now) {
  if (!projectPath) return
  const resolved = resolve(projectPath)
  if (shouldSkipProject(resolved)) return
  try {
    mkdirSync(dirname(projectsFile), { recursive: true })
    const { recent } = readProjectsFile(projectsFile)
    const filtered = recent.filter((item) => !samePath(item.path, resolved))
    const stamp = typeof now === 'function' ? now() : now
    const openedAt = new Date(stamp).toISOString()
    const updated = [{ path: resolved, openedAt }, ...filtered].slice(0, MAX_RECENT)
    saveProjectsFile(projectsFile, updated)
  } catch {}
}

export function readProjectSessions(runsFolder, projectPath) {
  if (!runsFolder || !projectPath) return []
  try {
    const hash = projectHash(projectPath)
    const file = join(runsFolder, `orchestrator-${hash}.json`)
    if (!existsSync(file)) return []
    const data = JSON.parse(readFileSync(file, 'utf8'))
    const list = Array.isArray(data?.sessions) ? data.sessions : []
    return list.slice(0, MAX_SESSIONS).map((item) => ({
      id: item.id,
      title: item.title,
      endedAt: item.endedAt ?? null,
    }))
  } catch {
    return []
  }
}

function isInsideGitRepo(folder) {
  let current = folder
  while (true) {
    try {
      if (existsSync(join(current, '.git'))) return true
    } catch {}
    const parent = dirname(current)
    if (parent === current) break
    current = parent
  }
  return false
}

export function currentProject(projectRoot) {
  if (!projectRoot) return { path: '', name: '', git: false }
  const resolved = resolve(projectRoot)
  return {
    path: resolved,
    name: basename(resolved),
    git: isInsideGitRepo(resolved),
  }
}

export function siblingFolders(projectRoot) {
  if (!projectRoot) return []
  const resolved = resolve(projectRoot)
  const parent = dirname(resolved)
  if (parent === resolved) return []
  let entries
  try {
    entries = readdirSync(parent, { withFileTypes: true })
  } catch {
    return []
  }
  const folders = []
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    if (entry.name.startsWith('.')) continue
    if (entry.name === '.worktrees' || entry.name === 'node_modules') continue
    const fullPath = join(parent, entry.name)
    if (samePath(fullPath, resolved)) continue
    let git = false
    try {
      git = existsSync(join(fullPath, '.git'))
    } catch {}
    folders.push({
      path: fullPath,
      name: entry.name,
      git,
    })
  }
  folders.sort((a, b) => a.name.localeCompare(b.name))
  return folders.slice(0, MAX_FOLDERS)
}

export function recentProjects(projectsFile, runsFolder, currentRoot, now = Date.now) {
  const { recent } = readProjectsFile(projectsFile)
  const currentTime = typeof now === 'function' ? now() : (now ?? Date.now())
  const fileKey = projectsFile ? resolve(projectsFile).toLowerCase() : ''
  const lastPrune = lastPruneByFile.get(fileKey) ?? 0

  const shouldPrune = Boolean(fileKey && (lastPrune === 0 || currentTime - lastPrune >= PRUNE_INTERVAL_MS))

  const existing = []
  let missingFound = false

  for (const item of recent) {
    let isDir = false
    try {
      isDir = statSync(item.path).isDirectory()
    } catch {
      isDir = false
    }
    if (isDir) {
      existing.push(item)
    } else {
      missingFound = true
    }
  }

  if (shouldPrune) {
    lastPruneByFile.set(fileKey, currentTime)
    if (missingFound) {
      saveProjectsFile(projectsFile, existing)
    }
  }

  const result = []
  for (const item of existing) {
    if (currentRoot && samePath(item.path, currentRoot)) continue
    if (shouldSkipProject(item.path)) continue
    result.push({
      path: item.path,
      name: basename(item.path),
      openedAt: item.openedAt,
      sessions: readProjectSessions(runsFolder, item.path),
    })
  }
  return result
}

export function createProjectsApi({
  projectRoot,
  runsFolder,
  onOpenProject,
  orchestrators,
  runs,
  lanesSource,
  sendJson,
  readJsonBody,
  now = Date.now,
} = {}) {
  const projectsFile = join(runsFolder, 'projects.json')

  function recordCurrent() {
    if (projectRoot) {
      recordProject(projectsFile, projectRoot, now)
    }
  }

  async function handle(req, res, url) {
    if (url.pathname === '/api/projects') {
      if ((req.method ?? 'GET') !== 'GET') {
        sendJson(req, res, 405, { error: 'Method not allowed.' })
        return true
      }
      const current = currentProject(projectRoot)
      const recent = recentProjects(projectsFile, runsFolder, projectRoot, now)
      const folders = siblingFolders(projectRoot)
      sendJson(req, res, 200, { current, recent, folders })
      return true
    }

    if (url.pathname === '/api/projects/open') {
      if ((req.method ?? 'GET') !== 'POST') {
        sendJson(req, res, 405, { error: 'Method not allowed.' })
        return true
      }

      const page = Boolean(req.headers.origin)
      if (!page) {
        sendJson(req, res, 403, { error: ORIGIN_PROBLEM })
        return true
      }

      const body = await readJsonBody(req, res)
      if (body === null) return true

      if (body.confirmed !== true) {
        sendJson(req, res, 400, { error: CONFIRM_OPEN_PROBLEM })
        return true
      }

      if (typeof body.path !== 'string' || !body.path.trim() || !isAbsolute(body.path)) {
        sendJson(req, res, 400, { error: NOT_ABSOLUTE_PROBLEM })
        return true
      }

      if (!existsSync(body.path)) {
        sendJson(req, res, 400, { error: NOT_FOUND_PROBLEM })
        return true
      }

      let isDir = false
      try {
        isDir = statSync(body.path).isDirectory()
      } catch {
        isDir = false
      }
      if (!isDir) {
        sendJson(req, res, 400, { error: NOT_FOLDER_PROBLEM })
        return true
      }

      const orchs = typeof orchestrators === 'function' ? orchestrators() : orchestrators
      const turnRunning = Boolean(orchs?.list?.().some((item) => item.state === 'working'))
      if (turnRunning) {
        sendJson(req, res, 409, { error: TURN_RUNNING_PROBLEM })
        return true
      }

      const runsApi = typeof runs === 'function' ? runs() : runs
      const laneSource = typeof lanesSource === 'function' ? lanesSource() : lanesSource
      const laneRunning = Boolean(runsApi?.isRunning?.()) || Boolean(laneSource?.openRuns?.().length)
      if (laneRunning) {
        sendJson(req, res, 409, { error: LANES_RUNNING_PROBLEM })
        return true
      }

      if (typeof onOpenProject !== 'function') {
        sendJson(req, res, 501, { error: NOT_SUPPORTED_PROBLEM })
        return true
      }

      const target = resolve(body.path)
      recordProject(projectsFile, target, now)
      sendJson(req, res, 200, { ok: true, restarting: true, path: target })
      const reopen = () =>
        setImmediate(() => {
          try {
            Promise.resolve(onOpenProject(target)).catch(() => {})
          } catch {}
        })
      if (res.writableFinished) reopen()
      else res.once('finish', reopen)
      return true
    }

    if (url.pathname === '/api/projects/forget') {
      if ((req.method ?? 'GET') !== 'POST') {
        sendJson(req, res, 405, { error: 'Method not allowed.' })
        return true
      }

      const page = Boolean(req.headers.origin)
      if (!page) {
        sendJson(req, res, 403, { error: ORIGIN_FORGET_PROBLEM })
        return true
      }

      const body = await readJsonBody(req, res)
      if (body === null) return true

      if (body.confirmed !== true) {
        sendJson(req, res, 400, { error: CONFIRM_FORGET_PROBLEM })
        return true
      }

      if (typeof body.path !== 'string' || !body.path.trim()) {
        sendJson(req, res, 400, { error: NOT_IN_LIST_PROBLEM })
        return true
      }

      const target = resolve(body.path)
      const { recent } = readProjectsFile(projectsFile)
      const existsInList = recent.some((item) => samePath(item.path, target))
      if (!existsInList) {
        sendJson(req, res, 400, { error: NOT_IN_LIST_PROBLEM })
        return true
      }

      const updated = recent.filter((item) => !samePath(item.path, target))
      saveProjectsFile(projectsFile, updated)

      const current = currentProject(projectRoot)
      const nextRecent = recentProjects(projectsFile, runsFolder, projectRoot, now)
      const folders = siblingFolders(projectRoot)
      sendJson(req, res, 200, { current, recent: nextRecent, folders })
      return true
    }

    return false
  }

  return { handle, recordCurrent }
}
