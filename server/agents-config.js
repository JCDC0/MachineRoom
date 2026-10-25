import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { MODELS } from './models.js'
import { programPath } from './programPath.js'
import { readLanes, runsFolder } from './lanes-source.js'

export const MAX_AGENTS = 30
export const HARNESS_KEYS = ['claude', 'opencode', 'agy', 'acp', 'machineroom', 'codex', 'copilot']

export const HARNESS_NAMES = {
  claude: 'Claude Code',
  opencode: 'OpenCode',
  agy: 'AGY',
  acp: 'ACP',
  machineroom: 'MachineRoom',
  codex: 'Codex',
  copilot: 'GitHub Copilot',
}

export const HARNESS_EFFORTS = {
  claude: ['low', 'medium', 'high', 'xhigh', 'max'],
  opencode: ['low', 'medium', 'high', 'max'],
  agy: [],
  acp: [],
  machineroom: [],
  codex: ['low', 'medium', 'high', 'xhigh'],
  copilot: ['low', 'medium', 'high', 'xhigh', 'max'],
}

export const ORIGIN_CREATE_PROBLEM = 'A request to create a lane needs a page Origin.'
export const ORIGIN_UPDATE_PROBLEM = 'A request to update a lane needs a page Origin.'
export const ORIGIN_DELETE_PROBLEM = 'A request to delete a lane needs a page Origin.'
export const CONFIRM_CREATE_PROBLEM = 'Confirm creating the lane first.'
export const CONFIRM_UPDATE_PROBLEM = 'Confirm updating the lane first.'
export const CONFIRM_DELETE_PROBLEM = 'Confirm deleting the lane first.'
export const NAME_LENGTH_PROBLEM = 'The lane name must be 1 to 40 characters.'
export const MAX_AGENTS_PROBLEM = 'At most 30 custom agents are allowed.'
export const LANES_JSON_DELETE_PROBLEM = 'A lane from lanes.json cannot be deleted; make it inactive instead.'
export const LANES_JSON_UPDATE_PROBLEM = 'A lane from lanes.json cannot be updated.'

export function harnessUnavailableProblem(harness) {
  return `The harness ${harness} is not available on this computer.`
}

export function modelUnavailableProblem(model, harness) {
  return `The model ${model} is not available for ${harness}.`
}

export function effortUnavailableProblem(effort, harness) {
  return `The effort ${effort} is not available for ${harness}.`
}

export function laneRunningProblem(lane) {
  return `The lane ${lane} is running.`
}

export function laneNotFoundProblem(lane) {
  return `The lane ${lane} was not found.`
}

const VARIABLE = /%([A-Za-z_][A-Za-z0-9_]*)%/g

function expand(bin, env) {
  let missing = ''
  const text = String(bin).replace(VARIABLE, (whole, name) => {
    const value = env?.[name]
    if (typeof value !== 'string' || value === '') {
      missing = name
      return whole
    }
    return value
  })
  return { text, missing }
}

function isProgram(path) {
  try {
    return statSync(path).isFile()
  } catch {
    return false
  }
}

export function isHarnessAvailable(harnessKey, { lanes = {}, env = process.env, platform = process.platform } = {}) {
  if (harnessKey === 'machineroom') {
    const key = env?.MACHINEROOM_API_KEY
    const fallback = env?.OPENROUTER_API_KEY
    return (typeof key === 'string' && key.trim() !== '') || (typeof fallback === 'string' && fallback.trim() !== '')
  }

  let laneBin = null
  for (const lane of Object.values(lanes ?? {})) {
    if (lane?.cli?.harness === harnessKey && typeof lane?.cli?.bin === 'string') {
      laneBin = lane.cli.bin
      break
    }
  }

  if (laneBin) {
    const { text, missing } = expand(laneBin, env)
    if (missing) return false
    if (isAbsolute(text) || text.includes('/') || text.includes('\\')) {
      return isProgram(text)
    }
    const endings = platform === 'win32' && !/\.(exe|com)$/i.test(text) ? [text, `${text}.exe`, `${text}.com`] : [text]
    for (const name of endings) {
      if (programPath(name, { env, platform })) return true
    }
    return false
  }

  const endings = platform === 'win32' && !/\.(exe|com)$/i.test(harnessKey) ? [harnessKey, `${harnessKey}.exe`, `${harnessKey}.com`] : [harnessKey]
  for (const name of endings) {
    if (programPath(name, { env, platform })) return true
  }
  return false
}

export function listHarnesses({ lanes = {}, env = process.env, platform = process.platform } = {}) {
  return HARNESS_KEYS.map((key) => ({
    key,
    name: HARNESS_NAMES[key] ?? key,
    available: isHarnessAvailable(key, { lanes, env, platform }),
    models: MODELS.filter((m) => m.harness === key).map(({ id, label }) => ({ id, label })),
    efforts: [...(HARNESS_EFFORTS[key] ?? [])],
  }))
}

export function agentsConfigFile(runsDir) {
  return join(runsDir, 'agents.json')
}

export function readAgentsConfig(runsDir) {
  const file = agentsConfigFile(runsDir)
  try {
    if (!existsSync(file)) return { agents: [] }
    const text = readFileSync(file, 'utf8')
    const parsed = JSON.parse(text)
    if (parsed && Array.isArray(parsed.agents)) {
      return {
        agents: parsed.agents.filter(
          (a) => a && typeof a === 'object' && typeof a.key === 'string' && a.key.trim()
        ),
      }
    }
    return { agents: [] }
  } catch {
    return { agents: [] }
  }
}

export function saveAgentsConfig(runsDir, config) {
  const file = agentsConfigFile(runsDir)
  mkdirSync(dirname(file), { recursive: true })
  const content = `${JSON.stringify(config, null, 2)}\n`
  const temporary = `${file}.tmp`
  writeFileSync(temporary, content, 'utf8')
  try {
    renameSync(temporary, file)
  } catch {
    writeFileSync(file, content, 'utf8')
  }
}

export function nextFreeKey(harness, lanesJson = {}, existingAgents = []) {
  const prefix = `${harness}-`
  const regex = new RegExp(`^${harness}-?(\\d+)$`)
  const takenNumbers = new Set()
  const allKeys = new Set([
    ...Object.keys(lanesJson ?? {}),
    ...(existingAgents ?? []).map((a) => a?.key).filter(Boolean),
  ])

  for (const key of allKeys) {
    if (key === harness) {
      takenNumbers.add(1)
      continue
    }
    const match = regex.exec(key)
    if (match) {
      takenNumbers.add(Number(match[1]))
    }
  }

  let num = 1
  while (takenNumbers.has(num) || allKeys.has(`${prefix}${num}`)) {
    num += 1
  }
  return `${prefix}${num}`
}

export function buildMadeLane(agent, lanesJson = {}) {
  let template = null
  for (const [laneKey, lane] of Object.entries(lanesJson ?? {})) {
    if (laneKey === 'orchestrator') continue
    if (lane?.cli?.harness === agent.harness) {
      template = lane
      break
    }
  }
  if (!template && lanesJson?.orchestrator?.cli?.harness === agent.harness) {
    template = lanesJson.orchestrator
  }

  const cli = template?.cli
    ? { ...template.cli, model: agent.model }
    : { harness: agent.harness, bin: agent.harness, model: agent.model }

  return {
    key: agent.key,
    name: agent.name,
    harness: template?.harness ?? agent.harness,
    custom: true,
    model: agent.model,
    effort: agent.effort ?? null,
    reasoning: agent.effort ?? null,
    cli,
    notes: template?.notes ? [...template.notes] : [],
    createdAt: agent.createdAt,
  }
}

export function readAllLanes(options = {}) {
  let folder
  let runsDir
  let lanesJson
  let agentsList

  if (typeof options === 'string') {
    folder = options
    runsDir = runsFolder()
  } else if (options && typeof options === 'object') {
    folder = options.folder
    runsDir = options.runsFolder ?? runsFolder()
    lanesJson = options.lanesJson
    agentsList = options.agents
  } else {
    runsDir = runsFolder()
  }

  const base = lanesJson ?? readLanes(folder)
  const agents = agentsList ?? readAgentsConfig(runsDir).agents

  const all = { ...base }
  for (const agent of agents) {
    if (agent && typeof agent.key === 'string' && agent.key) {
      all[agent.key] = buildMadeLane(agent, base)
    }
  }
  return all
}

export function createAgentsConfigApi(options = {}) {
  const runsDir = options.runsFolder ?? runsFolder()
  const sendJson = options.sendJson
  const readJsonBody = options.readJsonBody
  const notify = options.notify
  const isWorking = options.isWorking
  const activeLanes = options.activeLanes
  const getBaseLanes = typeof options.lanes === 'function' ? options.lanes : () => options.lanes ?? readLanes()
  const env = options.env ?? process.env

  async function handle(req, res, url) {
    const path = url.pathname
    const method = req.method ?? 'GET'
    const page = Boolean(req.headers.origin)

    if (path === '/api/harnesses') {
      if (method !== 'GET') {
        sendJson(req, res, 405, { error: 'Method not allowed.' })
        return true
      }
      const lanes = getBaseLanes()
      const data = listHarnesses({ lanes, env })
      sendJson(req, res, 200, data)
      return true
    }

    if (path === '/api/lanes/create') {
      if (method !== 'POST') {
        sendJson(req, res, 405, { error: 'Method not allowed.' })
        return true
      }
      if (!page) {
        sendJson(req, res, 403, { error: ORIGIN_CREATE_PROBLEM })
        return true
      }
      const body = await readJsonBody(req, res)
      if (body === null) return true

      if (body.confirmed !== true) {
        sendJson(req, res, 400, { error: CONFIRM_CREATE_PROBLEM })
        return true
      }

      const name = typeof body.name === 'string' ? body.name.trim() : ''
      if (!name || name.length > 40) {
        sendJson(req, res, 400, { error: NAME_LENGTH_PROBLEM })
        return true
      }

      const harness = typeof body.harness === 'string' ? body.harness.trim() : ''
      const baseLanes = getBaseLanes()
      const available = HARNESS_KEYS.includes(harness) && isHarnessAvailable(harness, { lanes: baseLanes, env })
      if (!available) {
        sendJson(req, res, 400, { error: harnessUnavailableProblem(harness) })
        return true
      }

      const allowedModels = MODELS.filter((m) => m.harness === harness).map((m) => m.id)
      const model = typeof body.model === 'string' ? body.model.trim() : ''
      if (!allowedModels.includes(model)) {
        sendJson(req, res, 400, { error: modelUnavailableProblem(body.model, harness) })
        return true
      }

      const allowedEfforts = HARNESS_EFFORTS[harness] ?? []
      let effort = null
      if (body.effort !== undefined && body.effort !== null && body.effort !== '') {
        const effortText = String(body.effort).trim()
        if (!allowedEfforts.includes(effortText)) {
          sendJson(req, res, 400, { error: effortUnavailableProblem(body.effort, harness) })
          return true
        }
        effort = effortText
      }

      const { agents } = readAgentsConfig(runsDir)
      if (agents.length >= MAX_AGENTS) {
        sendJson(req, res, 400, { error: MAX_AGENTS_PROBLEM })
        return true
      }

      const key = nextFreeKey(harness, baseLanes, agents)
      const newAgent = {
        key,
        name,
        harness,
        model,
        effort,
        createdAt: new Date().toISOString(),
      }

      agents.push(newAgent)
      saveAgentsConfig(runsDir, { agents })

      const active = typeof activeLanes === 'function' ? activeLanes() : activeLanes
      if (active && typeof active.isChosen === 'function' && active.isChosen()) {
        if (typeof active.addActiveLane === 'function') {
          active.addActiveLane(key)
        }
      }

      if (typeof notify === 'function') {
        notify({ topic: 'agents' })
      }

      sendJson(req, res, 200, newAgent)
      return true
    }

    const updateMatch = /^\/api\/lanes\/([a-zA-Z0-9_-]+)\/update$/.exec(path)
    if (updateMatch) {
      if (method !== 'POST') {
        sendJson(req, res, 405, { error: 'Method not allowed.' })
        return true
      }
      if (!page) {
        sendJson(req, res, 403, { error: ORIGIN_UPDATE_PROBLEM })
        return true
      }
      const key = updateMatch[1]
      const baseLanes = getBaseLanes()
      if (Object.hasOwn(baseLanes, key)) {
        sendJson(req, res, 400, { error: LANES_JSON_UPDATE_PROBLEM })
        return true
      }

      const { agents } = readAgentsConfig(runsDir)
      const agent = agents.find((a) => a.key === key)
      if (!agent) {
        sendJson(req, res, 404, { error: laneNotFoundProblem(key) })
        return true
      }

      const body = await readJsonBody(req, res)
      if (body === null) return true

      if (body.confirmed !== true) {
        sendJson(req, res, 400, { error: CONFIRM_UPDATE_PROBLEM })
        return true
      }

      if (body.name !== undefined) {
        const name = typeof body.name === 'string' ? body.name.trim() : ''
        if (!name || name.length > 40) {
          sendJson(req, res, 400, { error: NAME_LENGTH_PROBLEM })
          return true
        }
        agent.name = name
      }

      if (body.model !== undefined) {
        const allowedModels = MODELS.filter((m) => m.harness === agent.harness).map((m) => m.id)
        const model = typeof body.model === 'string' ? body.model.trim() : ''
        if (!allowedModels.includes(model)) {
          sendJson(req, res, 400, { error: modelUnavailableProblem(body.model, agent.harness) })
          return true
        }
        agent.model = model
      }

      if (body.effort !== undefined) {
        const allowedEfforts = HARNESS_EFFORTS[agent.harness] ?? []
        if (body.effort !== null && body.effort !== '') {
          const effortText = String(body.effort).trim()
          if (!allowedEfforts.includes(effortText)) {
            sendJson(req, res, 400, { error: effortUnavailableProblem(body.effort, agent.harness) })
            return true
          }
          agent.effort = effortText
        } else {
          agent.effort = null
        }
      }

      saveAgentsConfig(runsDir, { agents })

      if (typeof notify === 'function') {
        notify({ topic: 'agents' })
      }

      sendJson(req, res, 200, agent)
      return true
    }

    const deleteMatch = /^\/api\/lanes\/([a-zA-Z0-9_-]+)\/delete$/.exec(path)
    if (deleteMatch) {
      if (method !== 'POST') {
        sendJson(req, res, 405, { error: 'Method not allowed.' })
        return true
      }
      if (!page) {
        sendJson(req, res, 403, { error: ORIGIN_DELETE_PROBLEM })
        return true
      }
      const key = deleteMatch[1]
      const baseLanes = getBaseLanes()
      if (Object.hasOwn(baseLanes, key)) {
        sendJson(req, res, 400, { error: LANES_JSON_DELETE_PROBLEM })
        return true
      }

      const { agents } = readAgentsConfig(runsDir)
      const agentIndex = agents.findIndex((a) => a.key === key)
      if (agentIndex === -1) {
        sendJson(req, res, 404, { error: laneNotFoundProblem(key) })
        return true
      }

      if (typeof isWorking === 'function' && isWorking(key)) {
        sendJson(req, res, 409, { error: laneRunningProblem(key) })
        return true
      }

      const body = await readJsonBody(req, res)
      if (body === null) return true

      if (body.confirmed !== true) {
        sendJson(req, res, 400, { error: CONFIRM_DELETE_PROBLEM })
        return true
      }

      agents.splice(agentIndex, 1)
      saveAgentsConfig(runsDir, { agents })

      const active = typeof activeLanes === 'function' ? activeLanes() : activeLanes
      if (active && typeof active.isChosen === 'function' && active.isChosen()) {
        if (typeof active.removeActiveLane === 'function') {
          active.removeActiveLane(key)
        }
      }

      if (typeof notify === 'function') {
        notify({ topic: 'agents' })
      }

      sendJson(req, res, 200, { ok: true, deleted: key })
      return true
    }

    return false
  }

  return {
    handle,
  }
}
