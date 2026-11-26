import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { SESSION_HARNESSES } from '../src/harnesses/index.js'
import { sessionKeyFor } from '../src/model/laneStarter.js'
import {
  HARNESS_EFFORTS,
  HARNESS_KEYS,
  createAgentLane,
  effortUnavailableProblem,
  harnessUnavailableProblem,
  isHarnessAvailable,
  modelAllowed,
  modelUnavailableProblem,
  readAgentsConfig,
  readAllLanes,
  saveAgentsConfig,
} from './agents-config.js'
import { activeLanesFileFor, eligibleLanes, projectHash, projectLanesFileFor, readActiveLanesChoice, readHiddenLanes } from './active-lanes.js'
import { readEndpoints } from './endpoints.js'
import { HARNESS_OFF_PROBLEM, readHarnessSettings } from './harness-settings.js'
import { ORCHESTRATOR_KEY } from './orchestrator.js'
import { NO_TOKEN_PROBLEM, sameHarnessProblem } from './orchestrators.js'
import { readAgentDepth } from './agent-depth.js'
import { readSeats, ringSummary, seatsFileFor, setRings } from './seats.js'

export const ORIGIN_LABEL_PROBLEM = 'A request to set an agent label needs a page Origin.'
export const ORIGIN_TOP_PROBLEM = 'A request to set the top agent needs a page Origin.'
export const ORIGIN_SEATS_PROBLEM = 'A request to set the seats needs a page Origin.'
export const SEATS_SHAPE_PROBLEM = 'Seats must be whole numbers from 0, or empty for no limit.'
export const CONFIRM_TOP_PROBLEM = 'Confirm putting the agent at the top first.'
export const CONFIRM_SEATS_PROBLEM = 'Confirm the seats first.'
export const ORIGIN_KEY_PROBLEM = 'A request to set a key needs a page Origin.'
export const ORIGIN_DELETE_KEY_PROBLEM = 'A request to delete a key needs a page Origin.'
export const ORIGIN_APPROVE_PROBLEM = 'A request to approve a proposal needs a page Origin.'
export const ORIGIN_DECLINE_PROBLEM = 'A request to decline a proposal needs a page Origin.'

export const CONFIRM_LABEL_PROBLEM = 'Confirm setting the label first.'
export const CONFIRM_KEY_PROBLEM = 'Confirm setting the key first.'
const CONFIRM_DELETE_KEY_PROBLEM = 'Confirm deleting the key first.'
const CONFIRM_APPROVE_PROBLEM = 'Confirm approving the proposal first.'
const CONFIRM_DECLINE_PROBLEM = 'Confirm declining the proposal first.'

export const LABEL_LENGTH_PROBLEM = 'The label must be 1 to 40 characters.'
export const KEY_NAME_PROBLEM = 'The key name must be 1 to 40 letters, digits, space, dash or underscore.'
export const KEY_VALUE_PROBLEM = 'The key value must be 1 to 500 characters.'
const PROPOSAL_NOT_FOUND_PROBLEM = 'The proposal was not found.'

const KEY_NAME_PATTERN = /^[A-Za-z0-9 _-]{1,40}$/
const MAX_PROPOSALS = 20
const seatContextByBridge = new WeakMap()

export function familySeatsFor(sendJson, options, ladder) {
  const bridge = seatContextByBridge.get(sendJson)
  if (bridge) options = { ...bridge, orchestrators: bridge.getOrchestrators() }
  const { projectRoot, runsFolder } = options
  return {
    seats: readSeats(seatsFileFor(projectRoot, runsFolder)),
    tree: buildFamilyNodes({ ...options, ladder }).filter((node) => node.manual !== true),
    depth: readAgentDepth(runsFolder).limit,
    orchestrators: options.orchestrators,
  }
}

export function seatActor(req, sendJson) {
  if (req.headers.origin) return { owner: true }
  const header = req.headers['x-machineroom-orchestrator']
  const token = Array.isArray(header) ? header[0] : header
  const orchestrators = seatContextByBridge.get(sendJson)?.getOrchestrators()
  const id = orchestrators?.idForToken?.(typeof token === 'string' ? token.trim() : '')
  return id ? { id } : null
}

export function labelsFileFor(projectRoot, runsFolder) {
  const hash = projectHash(projectRoot)
  return join(runsFolder, `labels-${hash}.json`)
}

export function readLabels(file) {
  try {
    if (!existsSync(file)) return {}
    const text = readFileSync(file, 'utf8')
    const parsed = JSON.parse(text)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed.labels && typeof parsed.labels === 'object' ? parsed.labels : parsed
    }
    return {}
  } catch {
    return {}
  }
}

export function saveLabels(file, labels, { rename = renameSync } = {}) {
  mkdirSync(dirname(file), { recursive: true })
  const content = `${JSON.stringify(labels, null, 2)}\n`
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

const SESSION_TOPS = Object.fromEntries(SESSION_HARNESSES.map((harness) => [harness.sessionKey, {
  label: harness.sessionName ?? `${harness.name} session`,
  harness: harness.key,
}]))
const TOP_KEY_PROBLEM = 'Choose orchestrator or a registered session as the top agent.'

export function topFileFor(projectRoot, runsFolder) {
  return join(runsFolder, `top-${projectHash(projectRoot)}.json`)
}

function readTopChoice(file) {
  try {
    const top = JSON.parse(readFileSync(file, 'utf8'))?.top
    if (top === ORCHESTRATOR_KEY || (typeof top === 'string' && Object.hasOwn(SESSION_TOPS, top))) {
      return { top, pinned: true }
    }
  } catch {}
  return { top: ORCHESTRATOR_KEY, pinned: false }
}

export function readTop(file) {
  return readTopChoice(file).top
}

function keysFileFor(runsFolder) {
  return join(runsFolder, 'keys.json')
}

function parseKeyMap(parsed) {
  const map = {}
  if (!parsed) return map
  if (Array.isArray(parsed)) {
    for (const entry of parsed) {
      if (entry && typeof entry.name === 'string' && typeof entry.value === 'string') {
        map[entry.name] = entry.value
      }
    }
    return map
  }
  if (typeof parsed === 'object') {
    if (Array.isArray(parsed.keys)) {
      for (const entry of parsed.keys) {
        if (entry && typeof entry.name === 'string' && typeof entry.value === 'string') {
          map[entry.name] = entry.value
        }
      }
      return map
    }
    const source = parsed.keys && typeof parsed.keys === 'object' && !Array.isArray(parsed.keys) ? parsed.keys : parsed
    for (const [key, value] of Object.entries(source)) {
      if (typeof value === 'string') {
        map[key] = value
      }
    }
  }
  return map
}

export function readKeys(runsFolder) {
  const file = keysFileFor(runsFolder)
  try {
    if (!existsSync(file)) return {}
    const text = readFileSync(file, 'utf8')
    return parseKeyMap(JSON.parse(text))
  } catch {
    return {}
  }
}

export function saveKeys(runsFolder, keys, { rename = renameSync } = {}) {
  const file = keysFileFor(runsFolder)
  mkdirSync(dirname(file), { recursive: true })
  const content = `${JSON.stringify(keys, null, 2)}\n`
  const temporary = `${file}.tmp`
  writeFileSync(temporary, content, { mode: 0o600, encoding: 'utf8' })
  try {
    rename(temporary, file)
  } catch {
    writeFileSync(file, content, { mode: 0o600, encoding: 'utf8' })
  } finally {
    try {
      unlinkSync(temporary)
    } catch {}
  }
}

export function readKey(runsFolder, name) {
  if (!name || typeof name !== 'string') return null
  const keys = readKeys(runsFolder)
  return typeof keys[name] === 'string' ? keys[name] : null
}

export function keyFromFile(runsFolder, name) {
  if (!name || typeof name !== 'string') return ''
  const value = readKey(runsFolder, name)
  return typeof value === 'string' ? value : ''
}

export function writeKey(runsFolder, name, value) {
  const keys = readKeys(runsFolder)
  keys[name] = value
  saveKeys(runsFolder, keys)
}

function proposalsFileFor(runsFolder) {
  return join(runsFolder, 'proposals.json')
}

export function readProposals(runsFolder) {
  const file = proposalsFileFor(runsFolder)
  try {
    if (!existsSync(file)) return []
    const text = readFileSync(file, 'utf8')
    const parsed = JSON.parse(text)
    if (Array.isArray(parsed)) return parsed
    if (parsed && Array.isArray(parsed.proposals)) return parsed.proposals
    return []
  } catch {
    return []
  }
}

export function saveProposals(runsFolder, proposals, { rename = renameSync } = {}) {
  const file = proposalsFileFor(runsFolder)
  mkdirSync(dirname(file), { recursive: true })
  const content = `${JSON.stringify(proposals, null, 2)}\n`
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

export function buildFamilyNodes({
  projectRoot,
  runsFolder,
  lanesConfig,
  activeLanes,
  orchestrators,
  isWorking,
  laneStarter,
  ladder = orchestrators?.getLadder?.() ?? { subs: [] },
  top = readTop(topFileFor(projectRoot, runsFolder)),
} = {}) {
  const labelsFile = labelsFileFor(projectRoot, runsFolder)
  const labels = readLabels(labelsFile)

  const orchInstance = orchestrators?.find?.(ORCHESTRATOR_KEY) ?? orchestrators?.main ?? null
  const orchAnswer = orchInstance?.answer?.() ?? null
  const orchLanes = typeof lanesConfig === 'function' ? lanesConfig() : (lanesConfig ?? {})

  const mainHarness = orchAnswer?.harness ?? orchLanes?.[ORCHESTRATOR_KEY]?.cli?.harness ?? 'claude'
  const mainModel = orchAnswer?.model ?? orchLanes?.[ORCHESTRATOR_KEY]?.cli?.model ?? ''
  const mainEffort = orchAnswer?.effort ?? null
  const mainMode = typeof orchAnswer?.mode === 'string' && orchAnswer.mode.trim() ? orchAnswer.mode.trim() : null
  const mainWorking = orchAnswer?.state === 'working' || (typeof isWorking === 'function' && isWorking(ORCHESTRATOR_KEY))

  const mainNode = {
    id: ORCHESTRATOR_KEY,
    kind: 'orchestrator',
    label: typeof labels[ORCHESTRATOR_KEY] === 'string' ? labels[ORCHESTRATOR_KEY] : 'Orchestrator',
    harness: mainHarness,
    model: mainModel,
    effort: mainEffort,
    mode: mainMode,
    parent: null,
    children: [],
    active: true,
    working: Boolean(mainWorking),
    custom: false,
  }

  const subNodes = []
  const subByLane = new Map()

  let isHiddenLane = null
  if (activeLanes) {
    const activeHelper = typeof activeLanes === 'function' ? activeLanes() : activeLanes
    if (activeHelper && typeof activeHelper.isLaneHidden === 'function') {
      isHiddenLane = (key) => activeHelper.isLaneHidden(key)
    }
  }
  if (!isHiddenLane && projectRoot && runsFolder) {
    const hiddenFile = projectLanesFileFor(projectRoot, runsFolder)
    const hiddenSet = new Set(readHiddenLanes(hiddenFile))
    isHiddenLane = (key) => hiddenSet.has(key)
  }
  if (!isHiddenLane) {
    isHiddenLane = () => false
  }

  const subIds = new Set((ladder?.subs ?? []).map((sub) => sub.id))
  const parentOf = new Map((ladder?.subs ?? []).map((sub) => [sub.id, sub.parent]))
  for (const sub of ladder?.subs ?? []) {
    const subInst = orchestrators?.find?.(sub.id) ?? null
    const subAnswer = subInst?.answer?.() ?? null
    const subWorking = subAnswer?.state === 'working' || (typeof isWorking === 'function' && isWorking(sub.id))
    const subName = typeof sub.name === 'string' && sub.name.trim() ? sub.name : 'Sub orchestrator'
    const subMode =
      typeof subAnswer?.mode === 'string' && subAnswer.mode.trim()
        ? subAnswer.mode.trim()
        : typeof sub.mode === 'string' && sub.mode.trim()
          ? sub.mode.trim()
          : null
    const subNode = {
      id: sub.id,
      kind: 'sub',
      label: typeof labels[sub.id] === 'string' ? labels[sub.id] : subName,
      harness: subAnswer?.harness ?? sub.harness ?? 'opencode',
      model: subAnswer?.model ?? sub.model ?? 'opencode-go/deepseek-v4.1-flash',
      effort: subAnswer?.effort ?? null,
      mode: subMode,
      parent: ORCHESTRATOR_KEY,
      children: [],
      active: true,
      working: Boolean(subWorking),
      custom: Boolean(labels[sub.id]),
      scope: sub.scope,
      restricted: sub.restricted,
      ...(sub.createdBy ? { createdBy: sub.createdBy } : {}),
    }
    subNodes.push(subNode)
    for (const laneKey of sub.lanes ?? []) {
      if (!isHiddenLane(laneKey)) {
        subByLane.set(laneKey, subNode)
      }
    }
  }

  const nodeOf = new Map(subNodes.map((node) => [node.id, node]))
  for (const node of subNodes) {
    const wanted = parentOf.get(node.id)
    const host = wanted !== node.id && subIds.has(wanted) ? nodeOf.get(wanted) : null
    const loops = host && parentChain(host, nodeOf, parentOf).includes(node.id)
    if (host && !loops) node.parent = host.id
    ;(host && !loops ? host : mainNode).children.push(node.id)
  }

  const allLanes = readAllLanes({ folder: projectRoot, runsFolder, lanesJson: orchLanes })
  const eligible = eligibleLanes(allLanes)

  let activeChecker
  if (activeLanes) {
    const activeHelper = typeof activeLanes === 'function' ? activeLanes() : activeLanes
    if (activeHelper && typeof activeHelper.isChosen === 'function') {
      activeChecker = (key) => (activeHelper.isChosen() ? activeHelper.isLaneActive(key) : false)
    }
  }
  if (!activeChecker) {
    const activeFile = activeLanesFileFor(projectRoot, runsFolder)
    const saved = readActiveLanesChoice(activeFile)
    activeChecker = (key) => (saved !== null ? saved.includes(key) : false)
  }

  const laneNodes = []
  const laneIds = new Set()
  for (const lane of eligible) {
    if (isHiddenLane(lane.key)) continue
    const active = Boolean(activeChecker(lane.key))
    const parentSub = subByLane.get(lane.key)
    const parentId = parentSub ? parentSub.id : ORCHESTRATOR_KEY
    if (parentSub) {
      parentSub.children.push(lane.key)
    } else {
      mainNode.children.push(lane.key)
    }
    const working = typeof isWorking === 'function' ? Boolean(isWorking(lane.key)) : false
    const savedLabel = typeof labels[lane.key] === 'string' ? labels[lane.key].trim() : ''
    const laneName = typeof lane.name === 'string' ? lane.name.trim() : ''
    laneIds.add(lane.key)
    laneNodes.push({
      id: lane.key,
      kind: 'lane',
      label: savedLabel || laneName || 'Code agent',
      harness: lane.harness,
      model: lane.model,
      effort: lane.effort ?? null,
      mode: typeof lane.mode === 'string' && lane.mode.trim() ? lane.mode.trim() : null,
      parent: parentId,
      children: [],
      active,
      working,
      custom: lane.custom === true,
      ...(allLanes[lane.key].createdBy ? { createdBy: allLanes[lane.key].createdBy } : {}),
    })
  }

  for (const [key, entry] of Object.entries(allLanes ?? {})) {
    if (key === ORCHESTRATOR_KEY) continue
    if (entry?.cli?.harness !== 'agy') continue
    if (entry.custom === true || entry.retired === true) continue
    if (isHiddenLane(key) || laneIds.has(key)) continue
    const parentSub = subByLane.get(key)
    const parentId = parentSub ? parentSub.id : ORCHESTRATOR_KEY
    if (parentSub) {
      parentSub.children.push(key)
    } else {
      mainNode.children.push(key)
    }
    const working = typeof isWorking === 'function' ? Boolean(isWorking(key)) : false
    const savedLabel = typeof labels[key] === 'string' ? labels[key].trim() : ''
    const entryName = typeof entry.name === 'string' ? entry.name.trim() : ''
    laneIds.add(key)
    laneNodes.push({
      id: key,
      kind: 'lane',
      label: savedLabel || entryName || key,
      harness: 'agy',
      model: entry.cli.model ?? '',
      effort: null,
      mode: typeof entry.cli.mode === 'string' && entry.cli.mode.trim() ? entry.cli.mode.trim() : null,
      parent: parentId,
      children: [],
      active: true,
      working,
      custom: false,
      manual: true,
      ...(entry.createdBy ? { createdBy: entry.createdBy } : {}),
    })
  }

  if (top === ORCHESTRATOR_KEY) return [mainNode, ...subNodes, ...laneNodes]
  const session = SESSION_TOPS[top]
  const sessionId = `session:${top}`
  mainNode.parent = sessionId
  const sessionNode = {
    id: sessionId,
    kind: 'session',
    label: session.label,
    harness: session.harness,
    model: '',
    effort: null,
    mode: null,
    parent: null,
    children: [ORCHESTRATOR_KEY],
    active: true,
    working: typeof isWorking === 'function' ? Boolean(isWorking(top)) : false,
    custom: false,
  }
  for (const node of laneNodes) {
    if (node.parent === sessionId || sessionKeyFor(laneStarter?.(node.id)) !== top) continue
    const parent = nodeOf.get(node.parent) ?? mainNode
    parent.children = parent.children.filter((id) => id !== node.id)
    node.parent = sessionId
    sessionNode.children.push(node.id)
  }
  return [sessionNode, mainNode, ...subNodes, ...laneNodes]
}

function parentChain(node, nodeOf, parentOf) {
  const chain = []
  let id = node.id
  while (id && !chain.includes(id)) {
    chain.push(id)
    id = nodeOf.has(parentOf.get(id)) ? parentOf.get(id) : ''
  }
  return chain
}

export function createFamilyApi(options = {}) {
  const runsDir = options.runsFolder ? resolve(options.runsFolder) : resolve('runs')
  const projectRoot = options.projectRoot ? resolve(options.projectRoot) : ''
  const sendJson = options.sendJson
  const readJsonBody = options.readJsonBody
  const notify = options.notify
  const isWorking = options.isWorking
  const activeLanes = options.activeLanes
  const getOrchestrators = typeof options.orchestrators === 'function' ? options.orchestrators : () => options.orchestrators ?? null
  const getBaseLanes = typeof options.lanes === 'function' ? options.lanes : () => options.lanes ?? {}
  const env = options.env ?? process.env
  if (typeof sendJson === 'function') {
    seatContextByBridge.set(sendJson, {
      projectRoot,
      runsFolder: runsDir,
      lanesConfig: getBaseLanes,
      activeLanes,
      getOrchestrators,
    })
  }

  async function handle(req, res, url) {
    const path = url.pathname
    const method = req.method ?? 'GET'
    const page = Boolean(req.headers.origin)
    const orchs = getOrchestrators()

    if (path === '/api/family') {
      if (method !== 'GET') {
        sendJson(req, res, 405, { error: 'Method not allowed.' })
        return true
      }
      const choice = readTopChoice(topFileFor(projectRoot, runsDir))
      const main = orchs?.find?.(ORCHESTRATOR_KEY) ?? orchs?.main ?? null
      const mainHasConversation = (main?.currentSessionInfo?.()?.count ?? 0) > 0
        || (main?.listSessions?.() ?? []).some((session) => session.count > 0)
      const nodes = buildFamilyNodes({
        projectRoot,
        runsFolder: runsDir,
        lanesConfig: getBaseLanes,
        activeLanes,
        orchestrators: orchs,
        isWorking,
        laneStarter: options.laneStarter,
        top: choice.top,
      })
      const keys = Object.keys(readKeys(runsDir)).sort().map((name) => ({ name }))
      const proposals = readProposals(runsDir)
      const seats = ringSummary(familySeatsFor(sendJson, {
        projectRoot,
        runsFolder: runsDir,
        lanesConfig: getBaseLanes,
        activeLanes,
        isWorking,
      }))
      sendJson(req, res, 200, { nodes, keys, proposals, ...choice, mainHasConversation, seats })
      return true
    }

    if (path === '/api/family/seats') {
      if (method !== 'POST') {
        sendJson(req, res, 405, { error: 'Method not allowed.' })
        return true
      }
      if (!page) {
        sendJson(req, res, 403, { error: ORIGIN_SEATS_PROBLEM })
        return true
      }
      const body = await readJsonBody(req, res)
      if (body === null) return true
      if (body.confirmed !== true) {
        sendJson(req, res, 400, { error: CONFIRM_SEATS_PROBLEM })
        return true
      }
      const rings = body.rings
      const depth = readAgentDepth(runsDir).limit
      const shapeOk =
        Array.isArray(rings) &&
        rings.length <= depth &&
        rings.every((row) => row === null || (Number.isInteger(row) && row >= 0))
      if (!shapeOk) {
        sendJson(req, res, 400, { error: SEATS_SHAPE_PROBLEM })
        return true
      }
      setRings(seatsFileFor(projectRoot, runsDir), rings)
      if (typeof notify === 'function') {
        notify({ topic: 'family' })
        notify({ topic: 'agents' })
      }
      const seats = ringSummary(familySeatsFor(sendJson, {
        projectRoot,
        runsFolder: runsDir,
        lanesConfig: getBaseLanes,
        activeLanes,
        isWorking,
      }))
      sendJson(req, res, 200, { ok: true, seats })
      return true
    }

    if (path === '/api/family/top') {
      if (method !== 'POST') {
        sendJson(req, res, 405, { error: 'Method not allowed.' })
        return true
      }
      if (!page) {
        sendJson(req, res, 403, { error: ORIGIN_TOP_PROBLEM })
        return true
      }
      const body = await readJsonBody(req, res)
      if (body === null) return true
      const top = body.top
      if (typeof top !== 'string' || (top !== '' && top !== ORCHESTRATOR_KEY && !Object.hasOwn(SESSION_TOPS, top))) {
        sendJson(req, res, 400, { error: TOP_KEY_PROBLEM })
        return true
      }
      if (body.confirmed !== true) {
        sendJson(req, res, 400, { error: CONFIRM_TOP_PROBLEM })
        return true
      }
      const file = topFileFor(projectRoot, runsDir)
      if (top === '') {
        try {
          unlinkSync(file)
        } catch (error) {
          if (error.code !== 'ENOENT') {
            sendJson(req, res, 500, { error: 'The bridge could not clear the top agent.' })
            return true
          }
        }
      } else {
        saveLabels(file, { top })
      }
      if (typeof notify === 'function') {
        notify({ topic: 'family' })
        notify({ topic: 'agents' })
      }
      sendJson(req, res, 200, { ok: true, top })
      return true
    }

    if (path === '/api/family/label') {
      if (method !== 'POST') {
        sendJson(req, res, 405, { error: 'Method not allowed.' })
        return true
      }
      if (!page) {
        sendJson(req, res, 403, { error: ORIGIN_LABEL_PROBLEM })
        return true
      }
      const body = await readJsonBody(req, res)
      if (body === null) return true

      if (body.confirmed !== true) {
        sendJson(req, res, 400, { error: CONFIRM_LABEL_PROBLEM })
        return true
      }

      const id = typeof body.id === 'string' ? body.id.trim() : ''
      if (!id) {
        sendJson(req, res, 400, { error: 'An agent id is required.' })
        return true
      }

      const label = typeof body.label === 'string' ? body.label.trim() : ''
      if (!label || label.length > 40) {
        sendJson(req, res, 400, { error: LABEL_LENGTH_PROBLEM })
        return true
      }

      const file = labelsFileFor(projectRoot, runsDir)
      const labels = readLabels(file)
      labels[id] = label
      saveLabels(file, labels)

      if (typeof notify === 'function') {
        notify({ topic: 'family' })
      }

      sendJson(req, res, 200, { ok: true, id, label })
      return true
    }

    if (path === '/api/keys') {
      if (method === 'GET') {
        const keys = Object.keys(readKeys(runsDir)).sort().map((name) => ({ name }))
        sendJson(req, res, 200, keys)
        return true
      }

      if (method === 'POST') {
        if (!page) {
          sendJson(req, res, 403, { error: ORIGIN_KEY_PROBLEM })
          return true
        }
        const body = await readJsonBody(req, res)
        if (body === null) return true

        if (body.confirmed !== true) {
          sendJson(req, res, 400, { error: CONFIRM_KEY_PROBLEM })
          return true
        }

        const name = typeof body.name === 'string' ? body.name : ''
        if (!KEY_NAME_PATTERN.test(name)) {
          sendJson(req, res, 400, { error: KEY_NAME_PROBLEM })
          return true
        }

        const value = typeof body.value === 'string' ? body.value : ''
        if (value.length < 1 || value.length > 500) {
          sendJson(req, res, 400, { error: KEY_VALUE_PROBLEM })
          return true
        }

        writeKey(runsDir, name, value)

        if (typeof notify === 'function') {
          notify({ topic: 'family' })
        }

        sendJson(req, res, 200, { ok: true, name })
        return true
      }

      sendJson(req, res, 405, { error: 'Method not allowed.' })
      return true
    }

    const keyDeleteMatch = /^\/api\/keys\/([^/]+)\/delete$/.exec(path)
    if (keyDeleteMatch) {
      if (method !== 'POST') {
        sendJson(req, res, 405, { error: 'Method not allowed.' })
        return true
      }
      if (!page) {
        sendJson(req, res, 403, { error: ORIGIN_DELETE_KEY_PROBLEM })
        return true
      }
      const name = decodeURIComponent(keyDeleteMatch[1])
      const body = await readJsonBody(req, res)
      if (body === null) return true

      if (body.confirmed !== true) {
        sendJson(req, res, 400, { error: CONFIRM_DELETE_KEY_PROBLEM })
        return true
      }

      const keys = readKeys(runsDir)
      if (!Object.hasOwn(keys, name)) {
        sendJson(req, res, 404, { error: `The key ${name} was not found.` })
        return true
      }

      delete keys[name]
      saveKeys(runsDir, keys)

      if (typeof notify === 'function') {
        notify({ topic: 'family' })
      }

      sendJson(req, res, 200, { ok: true, deleted: name })
      return true
    }

    if (path === '/api/family/proposals') {
      if (method !== 'POST') {
        sendJson(req, res, 405, { error: 'Method not allowed.' })
        return true
      }

      let from = null
      if (!page) {
        const tokenHeader = req.headers['x-machineroom-orchestrator']
        const token = typeof tokenHeader === 'string' ? tokenHeader.trim() : Array.isArray(tokenHeader) ? tokenHeader[0].trim() : ''
        const actor = orchs && typeof orchs.idForToken === 'function' ? orchs.idForToken(token) : null
        if (!actor) {
          sendJson(req, res, 403, { error: NO_TOKEN_PROBLEM })
          return true
        }
        from = actor
      } else {
        from = 'owner'
      }

      const body = await readJsonBody(req, res)
      if (body === null) return true

      const label = typeof body.label === 'string' ? body.label.trim() : ''
      if (!label || label.length > 40) {
        sendJson(req, res, 400, { error: LABEL_LENGTH_PROBLEM })
        return true
      }

      const harness = typeof body.harness === 'string' ? body.harness.trim() : ''
      const baseLanes = getBaseLanes()

      if (from !== 'owner') {
        const actor = orchs && typeof orchs.find === 'function' ? orchs.find(from) : null
        const ownHarness = actor && typeof actor.answer === 'function' ? actor.answer().harness : ''
        if (ownHarness && harness !== ownHarness) {
          sendJson(req, res, 400, { error: sameHarnessProblem(ownHarness) })
          return true
        }
      }

      if (readHarnessSettings(runsDir).off.includes(harness)) {
        sendJson(req, res, 400, { error: HARNESS_OFF_PROBLEM })
        return true
      }

      const available = HARNESS_KEYS.includes(harness) && isHarnessAvailable(harness, { lanes: baseLanes, env, endpoints: readEndpoints(runsDir), runsFolder: runsDir })
      if (!available) {
        sendJson(req, res, 400, { error: harnessUnavailableProblem(harness) })
        return true
      }

      const model = typeof body.model === 'string' ? body.model.trim() : ''
      if (!modelAllowed(harness, model, runsDir, env)) {
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

      const parent = typeof body.parent === 'string' && body.parent.trim() ? body.parent.trim() : ORCHESTRATOR_KEY
      const reason = typeof body.reason === 'string' ? body.reason.trim() : ''

      const proposals = readProposals(runsDir)
      while (proposals.length >= MAX_PROPOSALS) {
        proposals.shift()
      }

      const proposal = {
        id: randomUUID(),
        from,
        parent,
        label,
        harness,
        model,
        effort,
        reason,
        createdAt: new Date().toISOString(),
      }

      proposals.push(proposal)
      saveProposals(runsDir, proposals)

      if (typeof notify === 'function') {
        notify({ topic: 'family' })
      }

      sendJson(req, res, 200, proposal)
      return true
    }

    const proposalApproveMatch = /^\/api\/family\/proposals\/([^/]+)\/approve$/.exec(path)
    if (proposalApproveMatch) {
      if (method !== 'POST') {
        sendJson(req, res, 405, { error: 'Method not allowed.' })
        return true
      }
      if (!page) {
        sendJson(req, res, 403, { error: ORIGIN_APPROVE_PROBLEM })
        return true
      }
      const id = decodeURIComponent(proposalApproveMatch[1])
      const body = await readJsonBody(req, res)
      if (body === null) return true

      if (body.confirmed !== true) {
        sendJson(req, res, 400, { error: CONFIRM_APPROVE_PROBLEM })
        return true
      }

      const proposals = readProposals(runsDir)
      const proposalIndex = proposals.findIndex((p) => p.id === id)
      if (proposalIndex === -1) {
        sendJson(req, res, 404, { error: PROPOSAL_NOT_FOUND_PROBLEM })
        return true
      }
      const proposal = proposals[proposalIndex]

      const laneResult = createAgentLane(
        {
          name: proposal.label,
          harness: proposal.harness,
          model: proposal.model,
          effort: proposal.effort,
          confirmed: true,
        },
        {
          runsFolder: runsDir,
          lanes: getBaseLanes,
          env,
          activeLanes,
          notify,
        }
      )

      if (!laneResult.ok) {
        sendJson(req, res, laneResult.status, { error: laneResult.error })
        return true
      }

      const createdLane = laneResult.agent

      if (proposal.parent && proposal.parent !== ORCHESTRATOR_KEY && orchs) {
        const ladder = typeof orchs.getLadder === 'function' ? orchs.getLadder() : null
        const targetSub = ladder?.subs?.find((s) => s.id === proposal.parent)
        if (targetSub && typeof orchs.ladderChange === 'function') {
          if (!targetSub.lanes.includes(createdLane.key)) {
            targetSub.lanes.push(createdLane.key)
          }
          const ladderResult = orchs.ladderChange(
            {
              confirmed: true,
              by: 'owner',
              ladder,
            },
            true
          )
          if (ladderResult.status !== 200) {
            const config = readAgentsConfig(runsDir)
            const created = config.agents.findIndex((agent) => agent.key === createdLane.key)
            if (created !== -1) {
              config.agents.splice(created, 1)
              saveAgentsConfig(runsDir, config)
            }
            const active = typeof activeLanes === 'function' ? activeLanes() : activeLanes
            if (active && typeof active.isChosen === 'function' && active.isChosen() && typeof active.removeActiveLane === 'function') {
              active.removeActiveLane(createdLane.key)
            }
            if (typeof notify === 'function') {
              notify({ topic: 'agents' })
            }
            sendJson(req, res, ladderResult.status, {
              error: ladderResult.body?.error ?? 'The ladder change failed.',
            })
            return true
          }
        }
      }

      proposals.splice(proposalIndex, 1)
      saveProposals(runsDir, proposals)

      if (proposal.from && orchs && typeof orchs.find === 'function') {
        const targetOrch = orchs.find(proposal.from)
        if (targetOrch && typeof targetOrch.deliver === 'function') {
          targetOrch.deliver('room', `The owner approved ${proposal.label}.`)
        }
      }

      if (typeof notify === 'function') {
        notify({ topic: 'family' })
      }

      sendJson(req, res, 200, { ok: true, approved: proposal.id, lane: createdLane })
      return true
    }

    const proposalDeclineMatch = /^\/api\/family\/proposals\/([^/]+)\/decline$/.exec(path)
    if (proposalDeclineMatch) {
      if (method !== 'POST') {
        sendJson(req, res, 405, { error: 'Method not allowed.' })
        return true
      }
      if (!page) {
        sendJson(req, res, 403, { error: ORIGIN_DECLINE_PROBLEM })
        return true
      }
      const id = decodeURIComponent(proposalDeclineMatch[1])
      const body = await readJsonBody(req, res)
      if (body === null) return true

      if (body.confirmed !== true) {
        sendJson(req, res, 400, { error: CONFIRM_DECLINE_PROBLEM })
        return true
      }

      const proposals = readProposals(runsDir)
      const proposalIndex = proposals.findIndex((p) => p.id === id)
      if (proposalIndex === -1) {
        sendJson(req, res, 404, { error: PROPOSAL_NOT_FOUND_PROBLEM })
        return true
      }
      const proposal = proposals[proposalIndex]

      proposals.splice(proposalIndex, 1)
      saveProposals(runsDir, proposals)

      if (proposal.from && orchs && typeof orchs.find === 'function') {
        const targetOrch = orchs.find(proposal.from)
        if (targetOrch && typeof targetOrch.deliver === 'function') {
          targetOrch.deliver('room', `The owner declined ${proposal.label}.`)
        }
      }

      if (typeof notify === 'function') {
        notify({ topic: 'family' })
      }

      sendJson(req, res, 200, { ok: true, declined: proposal.id })
      return true
    }

    return false
  }

  return {
    handle,
  }
}
