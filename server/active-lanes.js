import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readAllLanes } from './lanes-source.js'

export const OWNER_ACTIVE_LANES_PROBLEM = 'A request with no Origin cannot set the active lanes.'
export const CONFIRM_ACTIVE_LANES_PROBLEM = 'Confirm the active lanes first.'
export const EMPTY_ACTIVE_LANES_PROBLEM = 'Choose at least one lane.'
export const REPEATED_ACTIVE_LANE_PROBLEM = 'A lane cannot be listed more than once.'
export const METHOD_NOT_ALLOWED_PROBLEM = 'Method not allowed.'

export function unknownLaneProblem(lane) {
  return `The lane ${lane} is not known.`
}

export function inactiveLaneProblem(lane) {
  return `The lane ${lane} is not active. Add it in Agents first.`
}

const REPO_ROOT = resolve(fileURLToPath(import.meta.url), '..', '..')

function pathKey(value) {
  try {
    const resolved = resolve(String(value ?? ''))
    return process.platform === 'win32' ? resolved.toLowerCase() : resolved
  } catch {
    return ''
  }
}

export function projectHash(projectRoot) {
  const key = projectRoot ? pathKey(projectRoot) : ''
  return createHash('sha256').update(key).digest('hex').slice(0, 8)
}

export function activeLanesFileFor(projectRoot, runsFolder) {
  const hash = projectHash(projectRoot)
  return join(runsFolder, `active-lanes-${hash}.json`)
}

export function readActiveLanesChoice(file) {
  try {
    if (!existsSync(file)) return null
    const text = readFileSync(file, 'utf8')
    const parsed = JSON.parse(text)
    if (Array.isArray(parsed)) return parsed.length > 0 ? parsed : null
    if (parsed && Array.isArray(parsed.lanes)) return parsed.lanes
    return []
  } catch {
    return null
  }
}

export function writeActiveLanes(file, lanes) {
  const list = Array.isArray(lanes) ? lanes : []
  const content = list.length > 0 ? list : { lanes: [] }
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, `${JSON.stringify(content, null, 2)}\n`)
}

export function eligibleLanes(lanesConfig = {}) {
  const list = []
  for (const [key, entry] of Object.entries(lanesConfig ?? {})) {
    if (key === 'orchestrator') continue
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue
    if (entry.retired === true) continue
    if (!entry.cli || typeof entry.cli !== 'object') continue
    list.push({
      key,
      name: entry.name ?? key,
      harness: entry.cli.harness,
      model: entry.cli.model,
      custom: entry.custom === true,
      effort: entry.effort ?? null,
    })
  }
  return list
}

export function listActiveLanes({
  lanesConfig,
  projectRoot,
  runsFolder,
  isWorking,
} = {}) {
  const eligible = eligibleLanes(lanesConfig)
  const file = activeLanesFileFor(projectRoot, runsFolder)
  const saved = readActiveLanesChoice(file)
  const chosen = saved !== null
  const activeSet = chosen ? new Set(saved) : null

  const lanes = eligible.map((lane) => ({
    key: lane.key,
    name: lane.name,
    harness: lane.harness,
    model: lane.model,
    custom: lane.custom === true,
    effort: lane.effort ?? null,
    active: chosen ? activeSet.has(lane.key) : true,
    working: typeof isWorking === 'function' ? Boolean(isWorking(lane.key)) : false,
  }))

  return {
    lanes,
    max: eligible.length,
    chosen,
  }
}

export function createActiveLanesApi(options = {}) {
  const projectRoot = options.projectRoot ?? process.cwd()
  const runsFolder = options.runsFolder ?? ''
  const sendJson = options.sendJson
  const readJsonBody = options.readJsonBody
  const notify = options.notify
  const isWorking = options.isWorking

  function getLanesConfig() {
    let base = null
    if (typeof options.lanes === 'function') base = options.lanes()
    else if (options.lanes && typeof options.lanes === 'object') base = options.lanes
    else if (options.lanesFile) {
      try {
        base = JSON.parse(readFileSync(options.lanesFile, 'utf8'))
      } catch {
        base = {}
      }
    } else {
      try {
        base = JSON.parse(readFileSync(join(REPO_ROOT, 'docs', 'agents', 'lanes.json'), 'utf8'))
      } catch {
        base = {}
      }
    }
    return readAllLanes({ lanesJson: base, runsFolder })
  }

  function choiceFile() {
    return activeLanesFileFor(projectRoot, runsFolder)
  }

  function isChosen() {
    return readActiveLanesChoice(choiceFile()) !== null
  }

  function addActiveLane(key) {
    const file = choiceFile()
    const saved = readActiveLanesChoice(file)
    if (saved === null) return
    if (!saved.includes(key)) {
      saved.push(key)
      writeActiveLanes(file, saved)
    }
  }

  function removeActiveLane(key) {
    const file = choiceFile()
    const saved = readActiveLanesChoice(file)
    if (saved === null) return
    const filtered = saved.filter((k) => k !== key)
    if (filtered.length !== saved.length) {
      writeActiveLanes(file, filtered)
    }
  }

  function activeKeySet() {
    const saved = readActiveLanesChoice(choiceFile())
    if (saved === null) return null
    return new Set(saved)
  }

  function isLaneActive(key) {
    const set = activeKeySet()
    if (set === null) return true
    return set.has(key)
  }

  async function handle(req, res, url) {
    const path = url.pathname
    const method = req.method ?? 'GET'
    const page = Boolean(req.headers.origin)

    if (path === '/api/lanes') {
      if (method !== 'GET') {
        sendJson(req, res, 405, { error: METHOD_NOT_ALLOWED_PROBLEM })
        return true
      }
      const data = listActiveLanes({
        lanesConfig: getLanesConfig(),
        projectRoot,
        runsFolder,
        isWorking,
      })
      sendJson(req, res, 200, data)
      return true
    }

    if (path === '/api/lanes/active') {
      if (method !== 'POST') {
        sendJson(req, res, 405, { error: METHOD_NOT_ALLOWED_PROBLEM })
        return true
      }
      if (!page) {
        sendJson(req, res, 403, { error: OWNER_ACTIVE_LANES_PROBLEM })
        return true
      }
      const body = await readJsonBody(req, res)
      if (body === null) return true

      if (body.confirmed !== true) {
        sendJson(req, res, 400, { error: CONFIRM_ACTIVE_LANES_PROBLEM })
        return true
      }

      if (!Array.isArray(body.lanes)) {
        sendJson(req, res, 400, { error: EMPTY_ACTIVE_LANES_PROBLEM })
        return true
      }

      const eligible = eligibleLanes(getLanesConfig())
      const eligibleKeys = new Set(eligible.map((l) => l.key))
      const seen = new Set()

      for (const key of body.lanes) {
        if (typeof key !== 'string' || !eligibleKeys.has(key)) {
          sendJson(req, res, 400, { error: unknownLaneProblem(key) })
          return true
        }
        if (seen.has(key)) {
          sendJson(req, res, 400, { error: REPEATED_ACTIVE_LANE_PROBLEM })
          return true
        }
        seen.add(key)
      }

      const file = choiceFile()
      try {
        writeActiveLanes(file, body.lanes)
      } catch {
        sendJson(req, res, 500, { error: 'The bridge could not save the active lanes.' })
        return true
      }

      if (typeof notify === 'function') {
        notify({ topic: 'agents' })
      }

      sendJson(req, res, 200, { ok: true, lanes: body.lanes })
      return true
    }

    return false
  }

  return {
    handle,
    isChosen,
    isLaneActive,
    activeKeySet,
    addActiveLane,
    removeActiveLane,
    list: () =>
      listActiveLanes({
        lanesConfig: getLanesConfig(),
        projectRoot,
        runsFolder,
        isWorking,
      }),
  }
}
