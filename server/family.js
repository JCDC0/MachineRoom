import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
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
import { MODELS } from './models.js'
import { ORCHESTRATOR_KEY } from './orchestrator.js'
import { NO_TOKEN_PROBLEM } from './orchestrators.js'

export const ORIGIN_LABEL_PROBLEM = 'A request to set an agent label needs a page Origin.'
export const ORIGIN_KEY_PROBLEM = 'A request to set a key needs a page Origin.'
export const ORIGIN_DELETE_KEY_PROBLEM = 'A request to delete a key needs a page Origin.'
export const ORIGIN_APPROVE_PROBLEM = 'A request to approve a proposal needs a page Origin.'
export const ORIGIN_DECLINE_PROBLEM = 'A request to decline a proposal needs a page Origin.'

export const CONFIRM_LABEL_PROBLEM = 'Confirm setting the label first.'
export const CONFIRM_KEY_PROBLEM = 'Confirm setting the key first.'
export const CONFIRM_DELETE_KEY_PROBLEM = 'Confirm deleting the key first.'
export const CONFIRM_APPROVE_PROBLEM = 'Confirm approving the proposal first.'
export const CONFIRM_DECLINE_PROBLEM = 'Confirm declining the proposal first.'

export const LABEL_LENGTH_PROBLEM = 'The label must be 1 to 40 characters.'
export const KEY_NAME_PROBLEM = 'The key name must be 1 to 40 letters, digits, space, dash or underscore.'
export const KEY_VALUE_PROBLEM = 'The key value must be 1 to 500 characters.'
export const KEY_NOT_FOUND_PROBLEM = 'The key was not found.'
export const PROPOSAL_NOT_FOUND_PROBLEM = 'The proposal was not found.'

const KEY_NAME_PATTERN = /^[A-Za-z0-9 _-]{1,40}$/
const MAX_PROPOSALS = 20

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

export function keysFileFor(runsFolder) {
  return join(runsFolder, 'keys.json')
}

export function parseKeyMap(parsed) {
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

export function proposalsFileFor(runsFolder) {
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
} = {}) {
  const labelsFile = labelsFileFor(projectRoot, runsFolder)
  const labels = readLabels(labelsFile)

  const orchInstance = orchestrators?.find?.(ORCHESTRATOR_KEY) ?? orchestrators?.main ?? null
  const orchAnswer = orchInstance?.answer?.() ?? null
  const orchLanes = typeof lanesConfig === 'function' ? lanesConfig() : (lanesConfig ?? {})

  const mainHarness = orchAnswer?.harness ?? orchLanes?.[ORCHESTRATOR_KEY]?.cli?.harness ?? 'claude'
  const mainModel = orchAnswer?.model ?? orchLanes?.[ORCHESTRATOR_KEY]?.cli?.model ?? 'opus'
  const mainEffort = orchAnswer?.effort ?? null
  const mainWorking = orchAnswer?.state === 'working' || (typeof isWorking === 'function' && isWorking(ORCHESTRATOR_KEY))

  const mainNode = {
    id: ORCHESTRATOR_KEY,
    kind: 'orchestrator',
    label: typeof labels[ORCHESTRATOR_KEY] === 'string' ? labels[ORCHESTRATOR_KEY] : 'Orchestrator',
    harness: mainHarness,
    model: mainModel,
    effort: mainEffort,
    parent: null,
    children: [],
    active: true,
    working: Boolean(mainWorking),
    custom: false,
  }

  const ladder = orchestrators?.getLadder?.() ?? { subs: [] }
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

  for (const sub of ladder?.subs ?? []) {
    const subInst = orchestrators?.find?.(sub.id) ?? null
    const subAnswer = subInst?.answer?.() ?? null
    const subWorking = subAnswer?.state === 'working' || (typeof isWorking === 'function' && isWorking(sub.id))
    const subName = typeof sub.name === 'string' && sub.name.trim() ? sub.name : 'Sub orchestrator'
    const subNode = {
      id: sub.id,
      kind: 'sub',
      label: typeof labels[sub.id] === 'string' ? labels[sub.id] : subName,
      harness: subAnswer?.harness ?? sub.harness ?? 'opencode',
      model: subAnswer?.model ?? sub.model ?? 'opencode-go/deepseek-v4.1-flash',
      effort: subAnswer?.effort ?? null,
      parent: ORCHESTRATOR_KEY,
      children: [],
      active: true,
      working: Boolean(subWorking),
      custom: Boolean(labels[sub.id]),
    }
    subNodes.push(subNode)
    mainNode.children.push(sub.id)
    for (const laneKey of sub.lanes ?? []) {
      if (!isHiddenLane(laneKey)) {
        subByLane.set(laneKey, subNode)
      }
    }
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
    laneNodes.push({
      id: lane.key,
      kind: 'lane',
      label: savedLabel || laneName || 'Code agent',
      harness: lane.harness,
      model: lane.model,
      effort: lane.effort ?? null,
      parent: parentId,
      children: [],
      active,
      working,
      custom: lane.custom === true,
    })
  }

  return [mainNode, ...subNodes, ...laneNodes]
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
      const nodes = buildFamilyNodes({
        projectRoot,
        runsFolder: runsDir,
        lanesConfig: getBaseLanes,
        activeLanes,
        orchestrators: orchs,
        isWorking,
      })
      const keys = Object.keys(readKeys(runsDir)).sort().map((name) => ({ name }))
      const proposals = readProposals(runsDir)
      sendJson(req, res, 200, { nodes, keys, proposals })
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
      const available = HARNESS_KEYS.includes(harness) && isHarnessAvailable(harness, { lanes: baseLanes, env, endpoints: readEndpoints(runsDir) })
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
