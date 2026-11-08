import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import {
  activeLanesFileFor,
  eligibleLanes,
  projectLanesFileFor,
  readActiveLanesChoice,
  readHiddenLanes,
  writeActiveLanes,
  writeHiddenLanes,
} from './active-lanes.js'
import { labelsFileFor, readLabels, saveLabels } from './family.js'
import { readProjectsFile } from './projects.js'
import { readAllLanes, runsFolder as defaultRunsFolder } from './lanes-source.js'
import { chatFileFor, ORCHESTRATOR_KEY } from './orchestrator.js'

export const MAX_TEAMS = 20
export const TEAM_NAME_PROBLEM = 'The team name must be 1 to 40 characters.'
export const CONFIRM_TEAM_PROBLEM = 'Confirm the team action first.'
export const ORIGIN_TEAMS_PROBLEM = 'A request to change teams needs a page Origin.'
export const TURN_RUNNING_PROBLEM = 'An orchestrator turn is running. Stop it or wait first.'
export const LANE_RUN_OPEN_PROBLEM = 'A lane run is open. Stop it or wait first.'
export const UNKNOWN_PROJECT_PROBLEM = 'The project path must be in recent projects or be the current project.'

export function teamNotFoundProblem(name) {
  return `The team ${name} was not found.`
}

export function teamsFileFor(runsFolder) {
  return join(runsFolder, 'teams.json')
}

export function readTeams(file) {
  try {
    if (!existsSync(file)) return []
    const text = readFileSync(file, 'utf8')
    const parsed = JSON.parse(text)
    if (Array.isArray(parsed)) return parsed
    if (parsed && Array.isArray(parsed.teams)) return parsed.teams
    return []
  } catch {
    return []
  }
}

export function saveTeams(file, teams, { rename = renameSync } = {}) {
  mkdirSync(dirname(file), { recursive: true })
  const list = Array.isArray(teams) ? teams.slice(-MAX_TEAMS) : []
  const content = `${JSON.stringify({ teams: list }, null, 2)}\n`
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

function samePath(a, b) {
  if (!a || !b) return false
  const left = resolve(String(a))
  const right = resolve(String(b))
  return process.platform === 'win32' ? left.toLowerCase() === right.toLowerCase() : left === right
}

function isKnownProject(projectPath, runsFolder, currentRoot) {
  if (!projectPath || typeof projectPath !== 'string') return false
  const target = resolve(projectPath)
  if (currentRoot && samePath(target, currentRoot)) return true
  const projectsFile = join(runsFolder, 'projects.json')
  const { recent } = readProjectsFile(projectsFile)
  return recent.some((entry) => entry && samePath(entry.path, target))
}

export function createTeamsApi(options = {}) {
  const projectRoot = options.projectRoot ? resolve(options.projectRoot) : process.cwd()
  const runsDir = options.runsFolder ? resolve(options.runsFolder) : defaultRunsFolder()
  const sendJson = options.sendJson
  const readJsonBody = options.readJsonBody
  const notify = options.notify
  const activeLanes = options.activeLanes
  const orchestrators = options.orchestrators
  const lanesSource = options.lanesSource
  const runs = options.runs

  function getOrchs() {
    return typeof orchestrators === 'function' ? orchestrators() : orchestrators
  }

  function getLanesSource() {
    return typeof lanesSource === 'function' ? lanesSource() : lanesSource
  }

  function getRuns() {
    return typeof runs === 'function' ? runs() : runs
  }

  function getActiveLanes() {
    return typeof activeLanes === 'function' ? activeLanes() : activeLanes
  }

  function getBaseLanes() {
    let base = null
    if (typeof options.lanes === 'function') base = options.lanes()
    else if (options.lanes && typeof options.lanes === 'object') base = options.lanes
    return base ?? {}
  }

  function getAllLanes() {
    return readAllLanes({ folder: projectRoot, runsFolder: runsDir, lanesJson: getBaseLanes() })
  }

  function isBusy() {
    const orchs = getOrchs()
    const turnRunning = Boolean(orchs?.list?.().some((item) => item.state === 'working'))
    if (turnRunning) return { busy: true, error: TURN_RUNNING_PROBLEM }
    const runsApi = getRuns()
    const laneSrc = getLanesSource()
    const laneRunning = Boolean(runsApi?.isRunning?.()) || Boolean(laneSrc?.openRuns?.().length)
    if (laneRunning) return { busy: true, error: LANE_RUN_OPEN_PROBLEM }
    return { busy: false }
  }

  async function handle(req, res, url) {
    const path = url.pathname
    const method = req.method ?? 'GET'
    const page = Boolean(req.headers.origin)

    if (path === '/api/teams') {
      if (method === 'GET') {
        const file = teamsFileFor(runsDir)
        sendJson(req, res, 200, { teams: readTeams(file) })
        return true
      }
      if (method !== 'POST') {
        sendJson(req, res, 405, { error: 'Method not allowed.' })
        return true
      }
      if (!page) {
        sendJson(req, res, 403, { error: ORIGIN_TEAMS_PROBLEM })
        return true
      }
      const body = await readJsonBody(req, res)
      if (body === null) return true
      if (body.confirmed !== true) {
        sendJson(req, res, 400, { error: CONFIRM_TEAM_PROBLEM })
        return true
      }
      const name = typeof body.name === 'string' ? body.name.trim() : ''
      if (!name || name.length > 40) {
        sendJson(req, res, 400, { error: TEAM_NAME_PROBLEM })
        return true
      }

      const activeHelper = getActiveLanes()
      let lanesList = null
      if (activeHelper) {
        if (typeof activeHelper.activeEligibleLaneKeys === 'function') {
          lanesList = activeHelper.activeEligibleLaneKeys()
        } else if (typeof activeHelper.isChosen === 'function' && activeHelper.isChosen()) {
          lanesList = readActiveLanesChoice(activeLanesFileFor(projectRoot, runsDir)) || []
        }
      }
      if (lanesList === null) {
        lanesList = readActiveLanesChoice(activeLanesFileFor(projectRoot, runsDir)) || []
      }

      const labels = readLabels(labelsFileFor(projectRoot, runsDir))
      const orchs = getOrchs()
      const ladder = orchs && typeof orchs.getLadder === 'function' ? orchs.getLadder() : { subs: [] }

      const file = teamsFileFor(runsDir)
      const existing = readTeams(file)
      const team = {
        name,
        lanes: lanesList,
        labels,
        ladder: ladder ?? { subs: [] },
        savedAt: new Date().toISOString(),
      }

      const idx = existing.findIndex((t) => t.name === name)
      if (idx !== -1) {
        existing[idx] = team
      } else {
        existing.push(team)
      }

      saveTeams(file, existing)

      if (typeof notify === 'function') {
        notify({ topic: 'agents' })
        notify({ topic: 'family' })
      }

      sendJson(req, res, 200, { ok: true, team })
      return true
    }

    const applyMatch = /^\/api\/teams\/([^/]+)\/apply$/.exec(path)
    if (applyMatch) {
      if (method !== 'POST') {
        sendJson(req, res, 405, { error: 'Method not allowed.' })
        return true
      }
      if (!page) {
        sendJson(req, res, 403, { error: ORIGIN_TEAMS_PROBLEM })
        return true
      }
      const name = decodeURIComponent(applyMatch[1])
      const body = await readJsonBody(req, res)
      if (body === null) return true
      if (body.confirmed !== true) {
        sendJson(req, res, 400, { error: CONFIRM_TEAM_PROBLEM })
        return true
      }

      const file = teamsFileFor(runsDir)
      const teams = readTeams(file)
      const team = teams.find((t) => t.name === name)
      if (!team) {
        sendJson(req, res, 404, { error: teamNotFoundProblem(name) })
        return true
      }

      const check = isBusy()
      if (check.busy) {
        sendJson(req, res, 409, { error: check.error })
        return true
      }

      const all = getAllLanes()
      const eligible = eligibleLanes(all)
      const eligibleKeys = new Set(eligible.map((l) => l.key))

      const teamLanes = Array.isArray(team.lanes) ? team.lanes : []
      const appliedLanes = teamLanes.filter((key) => eligibleKeys.has(key))
      const droppedLanes = teamLanes.filter((key) => !eligibleKeys.has(key))

      writeActiveLanes(activeLanesFileFor(projectRoot, runsDir), appliedLanes)

      const hiddenLanes = eligible.map((l) => l.key).filter((key) => !appliedLanes.includes(key))
      writeHiddenLanes(projectLanesFileFor(projectRoot, runsDir), hiddenLanes)

      saveLabels(labelsFileFor(projectRoot, runsDir), team.labels || {})

      const orchs = getOrchs()
      let appliedLadder = { subs: [] }
      if (team.ladder && Array.isArray(team.ladder.subs)) {
        appliedLadder = {
          subs: team.ladder.subs.map((sub) => ({
            ...sub,
            lanes: (sub.lanes || []).filter((key) => appliedLanes.includes(key)),
          })),
        }
      }
      if (orchs && typeof orchs.ladderChange === 'function') {
        orchs.ladderChange({ ladder: appliedLadder, confirmed: true, by: 'owner' }, true)
      }

      if (typeof notify === 'function') {
        notify({ topic: 'agents' })
        notify({ topic: 'family' })
      }

      sendJson(req, res, 200, {
        ok: true,
        applied: {
          lanes: appliedLanes,
          hidden: hiddenLanes,
          labels: team.labels || {},
          ladder: appliedLadder,
        },
        dropped: {
          lanes: droppedLanes,
        },
      })
      return true
    }

    const deleteMatch = /^\/api\/teams\/([^/]+)\/delete$/.exec(path)
    if (deleteMatch) {
      if (method !== 'POST') {
        sendJson(req, res, 405, { error: 'Method not allowed.' })
        return true
      }
      if (!page) {
        sendJson(req, res, 403, { error: ORIGIN_TEAMS_PROBLEM })
        return true
      }
      const name = decodeURIComponent(deleteMatch[1])
      const body = await readJsonBody(req, res)
      if (body === null) return true
      if (body.confirmed !== true) {
        sendJson(req, res, 400, { error: CONFIRM_TEAM_PROBLEM })
        return true
      }

      const file = teamsFileFor(runsDir)
      const teams = readTeams(file)
      const idx = teams.findIndex((t) => t.name === name)
      if (idx === -1) {
        sendJson(req, res, 404, { error: teamNotFoundProblem(name) })
        return true
      }

      teams.splice(idx, 1)
      saveTeams(file, teams)

      if (typeof notify === 'function') {
        notify({ topic: 'agents' })
        notify({ topic: 'family' })
      }

      sendJson(req, res, 200, { ok: true, deleted: name })
      return true
    }

    if (path === '/api/teams/copy') {
      if (method !== 'POST') {
        sendJson(req, res, 405, { error: 'Method not allowed.' })
        return true
      }
      if (!page) {
        sendJson(req, res, 403, { error: ORIGIN_TEAMS_PROBLEM })
        return true
      }
      const body = await readJsonBody(req, res)
      if (body === null) return true
      if (body.confirmed !== true) {
        sendJson(req, res, 400, { error: CONFIRM_TEAM_PROBLEM })
        return true
      }

      const targetPath = typeof body.path === 'string' ? body.path.trim() : ''
      if (!isKnownProject(targetPath, runsDir, projectRoot)) {
        sendJson(req, res, 400, { error: UNKNOWN_PROJECT_PROBLEM })
        return true
      }

      const check = isBusy()
      if (check.busy) {
        sendJson(req, res, 409, { error: check.error })
        return true
      }

      const sourceActive = readActiveLanesChoice(activeLanesFileFor(targetPath, runsDir))
      const sourceHidden = readHiddenLanes(projectLanesFileFor(targetPath, runsDir))
      const sourceLabels = readLabels(labelsFileFor(targetPath, runsDir))

      let sourceLadder = { subs: [] }
      const orchs = getOrchs()
      if (samePath(targetPath, projectRoot)) {
        sourceLadder = orchs && typeof orchs.getLadder === 'function' ? orchs.getLadder() : { subs: [] }
      } else {
        const chatFile = chatFileFor(targetPath, runsDir, ORCHESTRATOR_KEY)
        try {
          if (existsSync(chatFile)) {
            const parsed = JSON.parse(readFileSync(chatFile, 'utf8'))
            if (parsed && parsed.ladder) {
              sourceLadder = parsed.ladder
            }
          }
        } catch {}
      }

      const all = getAllLanes()
      const eligible = eligibleLanes(all)
      const eligibleKeys = new Set(eligible.map((l) => l.key))

      const activeList = Array.isArray(sourceActive) ? sourceActive : []
      const appliedLanes = activeList.filter((key) => eligibleKeys.has(key))
      const droppedLanes = activeList.filter((key) => !eligibleKeys.has(key))

      writeActiveLanes(activeLanesFileFor(projectRoot, runsDir), appliedLanes)

      const hiddenList = Array.isArray(sourceHidden) ? sourceHidden : []
      const appliedHidden = hiddenList.filter((key) => eligibleKeys.has(key) && !appliedLanes.includes(key))
      writeHiddenLanes(projectLanesFileFor(projectRoot, runsDir), appliedHidden)

      saveLabels(labelsFileFor(projectRoot, runsDir), sourceLabels || {})

      let appliedLadder = { subs: [] }
      if (sourceLadder && Array.isArray(sourceLadder.subs)) {
        appliedLadder = {
          subs: sourceLadder.subs.map((sub) => ({
            ...sub,
            lanes: (sub.lanes || []).filter((key) => appliedLanes.includes(key)),
          })),
        }
      }
      if (orchs && typeof orchs.ladderChange === 'function') {
        orchs.ladderChange({ ladder: appliedLadder, confirmed: true, by: 'owner' }, true)
      }

      if (typeof notify === 'function') {
        notify({ topic: 'agents' })
        notify({ topic: 'family' })
      }

      sendJson(req, res, 200, {
        ok: true,
        applied: {
          lanes: appliedLanes,
          hidden: appliedHidden,
          labels: sourceLabels || {},
          ladder: appliedLadder,
        },
        dropped: {
          lanes: droppedLanes,
        },
      })
      return true
    }

    return false
  }

  return {
    handle,
  }
}
