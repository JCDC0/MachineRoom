import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { projectLanesFileFor, readHiddenLanes, writeHiddenLanes } from './active-lanes.js'
import { readEndpoints } from './endpoints.js'
import { MODELS, modelsFor } from './models.js'
import { programPath } from './programPath.js'
import { readLanes, runsFolder } from './lanes-source.js'
import { harnessByKey } from '../src/harnesses/index.js'
import { harnessUnavailableProblem, modelUnavailableProblem } from './model-list.js'
import { machineroomModels, modelAllowed, readHarnessModelsCache } from './harness-models.js'

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

export { harnessUnavailableProblem, modelAllowed, modelUnavailableProblem }

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
const CODEX_VERSION_FOLDER = /^[0-9a-f]{16}$/i

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

export function codexAppProgram({ env = process.env, platform = process.platform, listDir = readdirSync, statFile = statSync } = {}) {
  if (platform !== 'win32' || typeof env?.LOCALAPPDATA !== 'string' || env.LOCALAPPDATA === '') return null
  const binDir = join(env.LOCALAPPDATA, 'OpenAI', 'Codex', 'bin')
  let folders
  try {
    folders = listDir(binDir)
  } catch {
    return null
  }
  if (!Array.isArray(folders)) return null
  let newest = null
  for (const folder of folders) {
    if (typeof folder !== 'string') continue
    if (!CODEX_VERSION_FOLDER.test(folder)) continue
    const program = join(binDir, folder, 'codex.exe')
    try {
      const file = statFile(program)
      const modified = Number(file.mtimeMs)
      if (!file.isFile() || !Number.isFinite(modified)) continue
      if (!newest || modified > newest.modified) newest = { program, modified }
    } catch {}
  }
  return newest?.program ?? null
}

export function isHarnessAvailable(harnessKey, { lanes = {}, env = process.env, platform = process.platform, endpoints = [] } = {}) {
  if (harnessKey === 'machineroom') {
    if (Array.isArray(endpoints) && endpoints.length > 0) return true
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
  const descriptor = Object.hasOwn(harnessByKey, harnessKey) ? harnessByKey[harnessKey] : null
  if (!laneBin && typeof descriptor?.defaultProgram === 'string' && descriptor.defaultProgram !== '') {
    laneBin = descriptor.defaultProgram
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
    if (harnessKey === 'codex' && text === 'codex' && codexAppProgram({ env, platform })) return true
    return false
  }

  const endings = platform === 'win32' && !/\.(exe|com)$/i.test(harnessKey) ? [harnessKey, `${harnessKey}.exe`, `${harnessKey}.com`] : [harnessKey]
  for (const name of endings) {
    if (programPath(name, { env, platform })) return true
  }
  return false
}

export function listHarnesses({ lanes = {}, env = process.env, platform = process.platform, runsFolder = null } = {}) {
  const endpoints = runsFolder ? readEndpoints(runsFolder) : []
  const staticModels = runsFolder ? modelsFor(runsFolder) : MODELS
  const cache = runsFolder ? readHarnessModelsCache(runsFolder) : {}
  return HARNESS_KEYS.map((key) => {
    if (key === 'machineroom') {
      return {
        key,
        name: HARNESS_NAMES[key] ?? key,
        available: isHarnessAvailable(key, { lanes, env, platform, endpoints }),
        models: runsFolder ? machineroomModels(runsFolder, env).models : [],
        efforts: [...(HARNESS_EFFORTS[key] ?? [])],
      }
    }
    const seen = new Set()
    const models = []
    for (const m of staticModels) {
      if (m.harness === key && !seen.has(m.id)) {
        seen.add(m.id)
        models.push({ id: m.id, label: m.label })
      }
    }
    const cachedEntry = Object.hasOwn(cache, key) ? cache[key] : null
    if (cachedEntry && Array.isArray(cachedEntry.models)) {
      for (const m of cachedEntry.models) {
        if (m?.id && !seen.has(m.id)) {
          seen.add(m.id)
          models.push({ id: m.id, label: m.label || m.id })
        }
      }
    }
    return {
      key,
      name: HARNESS_NAMES[key] ?? key,
      available: isHarnessAvailable(key, { lanes, env, platform, endpoints }),
      models,
      efforts: [...(HARNESS_EFFORTS[key] ?? [])],
    }
  })
}

export function agentsConfigFile(runsDir) {
  return join(runsDir, 'agents.json')
}

function readRemovedList(value) {
  if (!Array.isArray(value)) return []
  const list = []
  for (const entry of value) {
    if (typeof entry !== 'string') continue
    const key = entry.trim()
    if (!key || key === 'orchestrator' || list.includes(key)) continue
    list.push(key)
  }
  return list
}

export function readAgentsConfig(runsDir) {
  const file = agentsConfigFile(runsDir)
  try {
    if (!existsSync(file)) return { agents: [], removed: [] }
    const text = readFileSync(file, 'utf8')
    const parsed = JSON.parse(text)
    if (parsed && Array.isArray(parsed.agents)) {
      return {
        agents: parsed.agents.filter(
          (a) => a && typeof a === 'object' && typeof a.key === 'string' && a.key.trim()
        ),
        removed: readRemovedList(parsed.removed),
      }
    }
    return { agents: [], removed: [] }
  } catch {
    return { agents: [], removed: [] }
  }
}

export function saveAgentsConfig(runsDir, config, { rename = renameSync } = {}) {
  const file = agentsConfigFile(runsDir)
  mkdirSync(dirname(file), { recursive: true })
  const content = `${JSON.stringify(config, null, 2)}\n`
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

function endpointModelId(endpoint, model) {
  const wanted = typeof model === 'string' ? model.trim() : ''
  if (!endpoint || wanted === '') return ''
  const prefix = `${endpoint.name}/`
  if (wanted.startsWith(prefix)) return endpoint.models.includes(wanted.slice(prefix.length)) ? wanted : ''
  return endpoint.models.includes(wanted) ? `${prefix}${wanted}` : ''
}

function laneEndpointProblem(harness, name) {
  if (harness !== 'machineroom') return 'Only a MachineRoom lane can name an endpoint.'
  return `The endpoint ${name} was not found.`
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
  const descriptor = Object.hasOwn(harnessByKey, agent.harness) ? harnessByKey[agent.harness] : null

  const cli = template?.cli
    ? { ...template.cli, model: agent.model }
    : {
        harness: agent.harness,
        bin: descriptor?.defaultProgram ?? agent.harness,
        model: agent.model,
      }
  if (agent.endpoint) cli.endpoint = agent.endpoint
  else delete cli.endpoint

  return {
    key: agent.key,
    name: agent.name,
    harness: template?.harness ?? descriptor?.laneName ?? agent.harness,
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
  let runsDir
  let lanesJson
  let agentsList

  if (typeof options === 'string') {
    runsDir = runsFolder()
  } else if (options && typeof options === 'object') {
    runsDir = options.runsFolder ?? runsFolder()
    lanesJson = options.lanesJson
    agentsList = options.agents
  } else {
    runsDir = runsFolder()
  }

  const base = lanesJson ?? readLanes()
  const config = readAgentsConfig(runsDir)
  const agents = agentsList ?? config.agents

  const all = {}
  for (const [key, lane] of Object.entries(base ?? {})) {
    all[key] = lane
  }
  for (const agent of agents) {
    if (agent && typeof agent.key === 'string' && agent.key) {
      all[agent.key] = buildMadeLane(agent, base)
    }
  }
  return all
}

export function moveRemovedLanesToProject({ projectRoot, runsFolder: folder = runsFolder(), print = console.log } = {}) {
  const config = readAgentsConfig(folder)
  const moved = config.removed
  if (moved.length === 0) return { moved: [], hidden: [] }
  const file = projectLanesFileFor(projectRoot ?? process.cwd(), folder)
  const hidden = readHiddenLanes(file)
  for (const key of moved) {
    if (!hidden.includes(key)) hidden.push(key)
  }
  writeHiddenLanes(file, hidden)
  saveAgentsConfig(folder, { agents: config.agents, removed: [] })
  if (typeof print === 'function') {
    print(`Moved ${moved.join(', ')} from the removed list to this project's hidden lanes.`)
  }
  return { moved, hidden }
}

export function createAgentLane(body, {
  runsFolder: runsDir,
  lanes = {},
  env = process.env,
  activeLanes = null,
  notify = null,
} = {}) {
  if (body?.confirmed !== true) {
    return { ok: false, status: 400, error: CONFIRM_CREATE_PROBLEM }
  }

  const name = typeof body?.name === 'string' ? body.name.trim() : ''
  if (!name || name.length > 40) {
    return { ok: false, status: 400, error: NAME_LENGTH_PROBLEM }
  }

  const harness = typeof body?.harness === 'string' ? body.harness.trim() : ''
  const baseLanes = typeof lanes === 'function' ? lanes() : (lanes ?? {})
  const runs = runsDir ?? runsFolder()
  const endpoints = readEndpoints(runs)
  let endpoint = null
  if (body?.endpoint !== undefined && body?.endpoint !== null && String(body.endpoint).trim() !== '') {
    const endpointName = String(body.endpoint).trim()
    endpoint = harness === 'machineroom' ? endpoints.find((entry) => entry.name === endpointName) ?? null : null
    if (!endpoint) {
      return { ok: false, status: 400, error: laneEndpointProblem(harness, endpointName) }
    }
  }
  const available = HARNESS_KEYS.includes(harness) && isHarnessAvailable(harness, { lanes: baseLanes, env, endpoints })
  if (!available) {
    return { ok: false, status: 400, error: harnessUnavailableProblem(harness) }
  }

  let model = typeof body?.model === 'string' ? body.model.trim() : ''
  if (endpoint) {
    model = endpointModelId(endpoint, model)
    if (model === '') {
      return { ok: false, status: 400, error: modelUnavailableProblem(body?.model, harness) }
    }
  } else if (!modelAllowed(harness, model, runs)) {
    return { ok: false, status: 400, error: modelUnavailableProblem(body?.model, harness) }
  }

  const allowedEfforts = HARNESS_EFFORTS[harness] ?? []
  let effort = null
  if (body?.effort !== undefined && body?.effort !== null && body?.effort !== '') {
    const effortText = String(body.effort).trim()
    if (!allowedEfforts.includes(effortText)) {
      return { ok: false, status: 400, error: effortUnavailableProblem(body.effort, harness) }
    }
    effort = effortText
  }

  const { agents, removed } = readAgentsConfig(runs)
  if (agents.length >= MAX_AGENTS) {
    return { ok: false, status: 400, error: MAX_AGENTS_PROBLEM }
  }

  const key = nextFreeKey(harness, baseLanes, agents)
  const newAgent = {
    key,
    name,
    harness,
    model,
    effort,
    ...(endpoint ? { endpoint: endpoint.name } : {}),
    createdAt: new Date().toISOString(),
  }

  agents.push(newAgent)
  saveAgentsConfig(runs, { agents, removed })

  const active = typeof activeLanes === 'function' ? activeLanes() : activeLanes
  if (active && typeof active.addActiveLane === 'function') {
    active.addActiveLane(key)
  }

  if (typeof notify === 'function') {
    notify({ topic: 'agents' })
  }

  return { ok: true, status: 200, agent: newAgent }
}

export function createAgentsConfigApi(options = {}) {
  const runsDir = options.runsFolder ?? runsFolder()
  const projectRoot = options.projectRoot ?? process.cwd()
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
      const data = listHarnesses({ lanes, env, runsFolder: runsDir })
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

      const result = createAgentLane(body, {
        runsFolder: runsDir,
        lanes: getBaseLanes,
        env,
        activeLanes,
        notify,
      })
      if (!result.ok) {
        sendJson(req, res, result.status, { error: result.error })
        return true
      }

      sendJson(req, res, 200, result.agent)
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

      const { agents, removed } = readAgentsConfig(runsDir)
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

      const endpointChanged = body.endpoint !== undefined
      const endpoints = readEndpoints(runsDir)
      let endpoint = null
      if (endpointChanged) {
        const endpointName = body.endpoint === null ? '' : String(body.endpoint).trim()
        if (endpointName !== '') {
          if (agent.harness !== 'machineroom') {
            sendJson(req, res, 400, { error: laneEndpointProblem(agent.harness, endpointName) })
            return true
          }
          endpoint = endpoints.find((entry) => entry.name === endpointName) ?? null
          if (!endpoint) {
            sendJson(req, res, 400, { error: laneEndpointProblem(agent.harness, endpointName) })
            return true
          }
        }
      } else if (agent.endpoint) {
        endpoint = endpoints.find((entry) => entry.name === agent.endpoint) ?? null
      }

      if (body.model !== undefined || endpointChanged) {
        let model = typeof body.model === 'string' ? body.model.trim() : agent.model
        if (endpoint) {
          model = endpointModelId(endpoint, model)
          if (model === '') {
            sendJson(req, res, 400, { error: modelUnavailableProblem(body.model ?? agent.model, agent.harness) })
            return true
          }
        } else if (!modelAllowed(agent.harness, model, runsDir)) {
          sendJson(req, res, 400, { error: modelUnavailableProblem(body.model ?? agent.model, agent.harness) })
          return true
        }
        agent.model = model
      }

      if (endpointChanged) {
        if (endpoint) agent.endpoint = endpoint.name
        else delete agent.endpoint
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

      saveAgentsConfig(runsDir, { agents, removed })

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
      if (key === 'orchestrator') {
        sendJson(req, res, 400, { error: LANES_JSON_DELETE_PROBLEM })
        return true
      }

      const baseLanes = getBaseLanes()
      const config = readAgentsConfig(runsDir)
      const hiddenFile = projectLanesFileFor(projectRoot, runsDir)
      const hidden = readHiddenLanes(hiddenFile)
      const fromBase = Object.hasOwn(baseLanes, key) && !hidden.includes(key)
      const agentIndex = config.agents.findIndex((a) => a.key === key)
      if (!fromBase && agentIndex === -1) {
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

      const agents = config.agents
      if (fromBase) {
        writeHiddenLanes(hiddenFile, [...hidden, key])
      } else {
        agents.splice(agentIndex, 1)
        if (hidden.includes(key)) {
          writeHiddenLanes(hiddenFile, hidden.filter((entry) => entry !== key))
        }
      }
      saveAgentsConfig(runsDir, { agents, removed: config.removed })

      const active = typeof activeLanes === 'function' ? activeLanes() : activeLanes
      if (active && typeof active.isChosen === 'function' && active.isChosen()) {
        if (typeof active.removeActiveLane === 'function') {
          active.removeActiveLane(key)
        }
      }

      if (typeof notify === 'function') {
        notify({ topic: 'agents' })
        notify({ topic: 'family' })
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
