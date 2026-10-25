import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { basename, dirname, isAbsolute, join, resolve } from 'node:path'
import { projectHash } from './orchestrator.js'

export const MAX_RECENT = 20
export const MAX_FOLDERS = 200
export const MAX_SESSIONS = 6

export const ORIGIN_PROBLEM = 'A request to open a project needs a page Origin.'
export const CONFIRM_OPEN_PROBLEM = 'Confirm opening the project first.'
export const NOT_ABSOLUTE_PROBLEM = 'Provide an absolute folder path.'
export const NOT_FOUND_PROBLEM = 'That folder does not exist.'
export const NOT_FOLDER_PROBLEM = 'That path is not a folder.'
export const TURN_RUNNING_PROBLEM = 'An orchestrator turn is running. Stop it or wait, then open the project.'
export const NOT_SUPPORTED_PROBLEM = 'Open another project with machineroom FOLDER.'

function samePath(a, b) {
  if (!a || !b) return false
  const left = resolve(a)
  const right = resolve(b)
  return process.platform === 'win32' ? left.toLowerCase() === right.toLowerCase() : left === right
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

export function recordProject(projectsFile, projectPath, now = Date.now) {
  if (!projectPath) return
  const resolved = resolve(projectPath)
  try {
    mkdirSync(dirname(projectsFile), { recursive: true })
    const { recent } = readProjectsFile(projectsFile)
    const filtered = recent.filter((item) => !samePath(item.path, resolved))
    const stamp = typeof now === 'function' ? now() : now
    const openedAt = new Date(stamp).toISOString()
    const updated = [{ path: resolved, openedAt }, ...filtered].slice(0, MAX_RECENT)
    const temporary = `${projectsFile}.tmp`
    const content = `${JSON.stringify({ recent: updated }, null, 2)}\n`
    writeFileSync(temporary, content, 'utf8')
    try {
      renameSync(temporary, projectsFile)
    } catch {
      writeFileSync(projectsFile, content, 'utf8')
    }
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

export function currentProject(projectRoot) {
  if (!projectRoot) return { path: '', name: '', git: false }
  const resolved = resolve(projectRoot)
  let git = false
  try {
    git = existsSync(join(resolved, '.git'))
  } catch {}
  return {
    path: resolved,
    name: basename(resolved),
    git,
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

export function recentProjects(projectsFile, runsFolder, currentRoot) {
  const { recent } = readProjectsFile(projectsFile)
  const result = []
  for (const item of recent) {
    if (currentRoot && samePath(item.path, currentRoot)) continue
    let isDir = false
    try {
      isDir = statSync(item.path).isDirectory()
    } catch {
      isDir = false
    }
    if (!isDir) continue
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
      const recent = recentProjects(projectsFile, runsFolder, projectRoot)
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

      if (typeof onOpenProject !== 'function') {
        sendJson(req, res, 501, { error: NOT_SUPPORTED_PROBLEM })
        return true
      }

      const target = resolve(body.path)
      recordProject(projectsFile, target, now)
      sendJson(req, res, 200, { ok: true, restarting: true, path: target })
      setImmediate(() => {
        try {
          Promise.resolve(onOpenProject(target)).catch(() => {})
        } catch {}
      })
      return true
    }

    return false
  }

  return { handle, recordCurrent }
}
