import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { readAllLanes, readLanes } from './lanes-source.js'

export const OWNER_ACTIVE_LANES_PROBLEM = 'A request with no Origin cannot set the active lanes.'
export const CONFIRM_ACTIVE_LANES_PROBLEM = 'Confirm the active lanes first.'
export const EMPTY_ACTIVE_LANES_PROBLEM = 'Choose at least one lane.'
export const REPEATED_ACTIVE_LANE_PROBLEM = 'A lane cannot be listed more than once.'
export const METHOD_NOT_ALLOWED_PROBLEM = 'Method not allowed.'
export const NO_ACTIVE_CHOICE_PROBLEM = 'Pick the lanes for this project first.'
export const ORIGIN_HIDE_PROBLEM = 'A request to hide a lane needs a page Origin.'
export const ORIGIN_SHOW_PROBLEM = 'A request to show a lane needs a page Origin.'
export const CONFIRM_HIDE_PROBLEM = 'Confirm hiding the lane first.'
export const CONFIRM_SHOW_PROBLEM = 'Confirm showing the lane first.'
export const HIDE_ORCHESTRATOR_PROBLEM = 'The orchestrator cannot be hidden.'
export const SHOW_ORCHESTRATOR_PROBLEM = 'The orchestrator cannot be hidden.'

export function unknownLaneProblem(lane) {
  return `The lane ${lane} is not known.`
}

export function inactiveLaneProblem(lane) {
  return `The lane ${lane} is not active. Add it in Agents first.`
}

export function laneRunningProblem(lane) {
  return `The lane ${lane} is running.`
}

export function hiddenLaneProblem(lane) {
  return `${lane} is hidden in this project. Show it in Settings first.`
}

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

export function projectLanesFileFor(projectRoot, runsFolder) {
  const hash = projectHash(projectRoot)
  return join(runsFolder, `project-lanes-${hash}.json`)
}

export function readHiddenLanes(file) {
  try {
    if (!existsSync(file)) return []
    const text = readFileSync(file, 'utf8')
    const parsed = JSON.parse(text)
    if (parsed && Array.isArray(parsed.hidden)) {
      return parsed.hidden.filter((k) => typeof k === 'string' && k.trim() && k !== 'orchestrator')
    }
    if (Array.isArray(parsed)) {
      return parsed.filter((k) => typeof k === 'string' && k.trim() && k !== 'orchestrator')
    }
    return []
  } catch {
    return []
  }
}

export function writeHiddenLanes(file, hidden, { rename = renameSync } = {}) {
  const list = Array.isArray(hidden)
    ? [...new Set(hidden.filter((k) => typeof k === 'string' && k.trim() && k !== 'orchestrator'))]
    : []
  const content = `${JSON.stringify({ hidden: list }, null, 2)}\n`
  mkdirSync(dirname(file), { recursive: true })
  const temporary = `${file}.tmp`
  writeFileSync(temporary, content, 'utf8')
  try {
    rename(temporary, file)
  } catch {
    writeFileSync(file, content, 'utf8')
  } finally {
    try {
      unlinkSync(temporary)
    } catch {}
  }
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

export function writeActiveLanes(file, lanes, { rename = renameSync } = {}) {
  const list = Array.isArray(lanes) ? lanes : []
  const content = `${JSON.stringify(list.length > 0 ? list : { lanes: [] }, null, 2)}\n`
  mkdirSync(dirname(file), { recursive: true })
  const temporary = `${file}.tmp`
  writeFileSync(temporary, content, 'utf8')
  try {
    rename(temporary, file)
  } catch {
    writeFileSync(file, content, 'utf8')
  } finally {
    try {
      unlinkSync(temporary)
    } catch {}
  }
}

export function eligibleLanes(lanesConfig = {}) {
  const list = []
  for (const [key, entry] of Object.entries(lanesConfig ?? {})) {
    if (key === 'orchestrator') continue
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue
    if (entry.retired === true) continue
    if (entry.custom !== true && (entry.cli?.harness === 'agy' || entry.harness === 'agy')) continue
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

export function activeEligibleLanes({
  lanesConfig,
  projectRoot,
  runsFolder,
  activeLanes,
} = {}) {
  const eligible = eligibleLanes(lanesConfig)
  let hiddenSet = null
  if (activeLanes) {
    const helper = typeof activeLanes === 'function' ? activeLanes() : activeLanes
    if (helper && typeof helper.hiddenKeySet === 'function') {
      hiddenSet = helper.hiddenKeySet()
    }
  }
  if (!hiddenSet && projectRoot && runsFolder) {
    const hiddenFile = projectLanesFileFor(projectRoot, runsFolder)
    hiddenSet = new Set(readHiddenLanes(hiddenFile))
  }
  const visible = hiddenSet ? eligible.filter((lane) => !hiddenSet.has(lane.key)) : eligible

  if (activeLanes) {
    const helper = typeof activeLanes === 'function' ? activeLanes() : activeLanes
    if (helper && typeof helper.isChosen === 'function') {
      if (!helper.isChosen()) return []
      return visible.filter((lane) => helper.isLaneActive(lane.key))
    }
  }
  const file = activeLanesFileFor(projectRoot, runsFolder)
  const saved = readActiveLanesChoice(file)
  if (saved === null) return []
  const activeSet = new Set(saved)
  return visible.filter((lane) => activeSet.has(lane.key))
}

export function activeEligibleLaneKeys(options = {}) {
  return activeEligibleLanes(options).map((lane) => lane.key)
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
  const hiddenFile = projectLanesFileFor(projectRoot, runsFolder)
  const hiddenSet = new Set(readHiddenLanes(hiddenFile))

  const lanes = eligible.map((lane) => ({
    key: lane.key,
    name: lane.name,
    harness: lane.harness,
    model: lane.model,
    custom: lane.custom === true,
    effort: lane.effort ?? null,
    active: chosen ? activeSet.has(lane.key) : false,
    working: typeof isWorking === 'function' ? Boolean(isWorking(lane.key)) : false,
    hidden: hiddenSet.has(lane.key),
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
      base = readLanes()
    }
    return readAllLanes({ lanesJson: base, runsFolder })
  }

  function choiceFile() {
    return activeLanesFileFor(projectRoot, runsFolder)
  }

  function hiddenFile() {
    return projectLanesFileFor(projectRoot, runsFolder)
  }

  function readHidden() {
    return readHiddenLanes(hiddenFile())
  }

  function isChosen() {
    return readActiveLanesChoice(choiceFile()) !== null
  }

  function addActiveLane(key) {
    const file = choiceFile()
    const saved = readActiveLanesChoice(file)
    if (saved === null) {
      writeActiveLanes(file, [key])
      return
    }
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

  function hideLane(key) {
    const list = readHidden()
    if (!list.includes(key)) {
      list.push(key)
      writeHiddenLanes(hiddenFile(), list)
    }
    removeActiveLane(key)
  }

  function showLane(key) {
    const list = readHidden()
    const filtered = list.filter((k) => k !== key)
    if (filtered.length !== list.length) {
      writeHiddenLanes(hiddenFile(), filtered)
    }
  }

  function isLaneHidden(key) {
    return readHidden().includes(key)
  }

  function hiddenKeySet() {
    return new Set(readHidden())
  }

  function activeKeySet() {
    const saved = readActiveLanesChoice(choiceFile())
    if (saved === null) return null
    return new Set(saved)
  }

  function isLaneActive(key) {
    const set = activeKeySet()
    if (set === null) return false
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
      const hiddenKeys = hiddenKeySet()
      const seen = new Set()

      for (const key of body.lanes) {
        if (typeof key !== 'string' || !eligibleKeys.has(key)) {
          sendJson(req, res, 400, { error: unknownLaneProblem(key) })
          return true
        }
        if (hiddenKeys.has(key)) {
          sendJson(req, res, 400, { error: hiddenLaneProblem(key) })
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

    const hideMatch = /^\/api\/lanes\/([a-zA-Z0-9_-]+)\/hide$/.exec(path)
    if (hideMatch) {
      if (method !== 'POST') {
        sendJson(req, res, 405, { error: METHOD_NOT_ALLOWED_PROBLEM })
        return true
      }
      if (!page) {
        sendJson(req, res, 403, { error: ORIGIN_HIDE_PROBLEM })
        return true
      }
      const key = hideMatch[1]
      if (key === 'orchestrator') {
        sendJson(req, res, 400, { error: HIDE_ORCHESTRATOR_PROBLEM })
        return true
      }
      const eligible = eligibleLanes(getLanesConfig())
      const eligibleKeys = new Set(eligible.map((l) => l.key))
      if (!eligibleKeys.has(key)) {
        sendJson(req, res, 400, { error: unknownLaneProblem(key) })
        return true
      }
      if (typeof isWorking === 'function' && isWorking(key)) {
        sendJson(req, res, 409, { error: laneRunningProblem(key) })
        return true
      }
      const body = await readJsonBody(req, res)
      if (body === null) return true
      if (body.confirmed !== true) {
        sendJson(req, res, 400, { error: CONFIRM_HIDE_PROBLEM })
        return true
      }
      hideLane(key)
      if (typeof notify === 'function') {
        notify({ topic: 'agents' })
        notify({ topic: 'family' })
      }
      sendJson(req, res, 200, { ok: true, hidden: key })
      return true
    }

    const showMatch = /^\/api\/lanes\/([a-zA-Z0-9_-]+)\/show$/.exec(path)
    if (showMatch) {
      if (method !== 'POST') {
        sendJson(req, res, 405, { error: METHOD_NOT_ALLOWED_PROBLEM })
        return true
      }
      if (!page) {
        sendJson(req, res, 403, { error: ORIGIN_SHOW_PROBLEM })
        return true
      }
      const key = showMatch[1]
      if (key === 'orchestrator') {
        sendJson(req, res, 400, { error: SHOW_ORCHESTRATOR_PROBLEM })
        return true
      }
      const eligible = eligibleLanes(getLanesConfig())
      const eligibleKeys = new Set(eligible.map((l) => l.key))
      if (!eligibleKeys.has(key)) {
        sendJson(req, res, 400, { error: unknownLaneProblem(key) })
        return true
      }
      if (typeof isWorking === 'function' && isWorking(key)) {
        sendJson(req, res, 409, { error: laneRunningProblem(key) })
        return true
      }
      const body = await readJsonBody(req, res)
      if (body === null) return true
      if (body.confirmed !== true) {
        sendJson(req, res, 400, { error: CONFIRM_SHOW_PROBLEM })
        return true
      }
      showLane(key)
      if (typeof notify === 'function') {
        notify({ topic: 'agents' })
        notify({ topic: 'family' })
      }
      sendJson(req, res, 200, { ok: true, shown: key })
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
    isLaneHidden,
    hiddenKeySet,
    hideLane,
    showLane,
    projectLanesFile: hiddenFile,
    list: () =>
      listActiveLanes({
        lanesConfig: getLanesConfig(),
        projectRoot,
        runsFolder,
        isWorking,
      }),
    activeEligibleLaneKeys: () =>
      activeEligibleLaneKeys({
        lanesConfig: getLanesConfig(),
        projectRoot,
        runsFolder,
      }),
  }
}
