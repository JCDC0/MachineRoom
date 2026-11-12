import { execFileSync } from 'node:child_process'
import { isAbsolute, join, relative, resolve } from 'node:path'
import { maskKeys } from '../src/briefs/audit.js'
import { legacyMode, modesFor } from '../src/control/modes.js'
import { HARNESSES } from '../src/harnesses/index.js'
import { canChange, outsideScope, readLadder, subPrompt } from '../src/model/hierarchy.js'
import { isHarnessAvailable } from './agents-config.js'
import { readEndpoints } from './endpoints.js'
import { MODELS } from './models.js'
import {
  CONFIRM_MESSAGE_PROBLEM,
  createOrchestrator,
  APPROVAL_TIMEOUT_MS,
  DEFAULT_AUTOCOMPACT_MODE,
  DEFAULT_COMPACT_RULES,
  DEFAULT_AUTOCOMPACT_PERCENT,
  DEFAULT_AUTOCOMPACT_VALUE,
  DEFAULT_CONTEXT_WINDOW,
  MESSAGE_PROBLEM,
  NO_NEW_REPORT,
  NO_REPORT,
  ORCHESTRATOR_KEY,
  ORCHESTRATOR_MESSAGE_LIMIT,
} from './orchestrator.js'
import { gitPath } from './programPath.js'
import { readAllLanes } from './agents-config.js'
import { activeEligibleLaneKeys, eligibleLanes, projectLanesFileFor, readHiddenLanes } from './active-lanes.js'
import { createRecordsCache, runsFolder as sharedRunsFolder } from './lanes-source.js'

function pathKey(path) {
  try {
    const resolved = resolve(String(path ?? ''))
    return process.platform === 'win32' ? resolved.toLowerCase() : resolved
  } catch {
    return ''
  }
}

export const CONFIRM_LADDER_PROBLEM = 'Confirm the ladder first.'
export const NO_ORCHESTRATOR_PROBLEM = 'There is no orchestrator with that id.'
export const LADDER_BY_PROBLEM = 'A ladder change comes from the owner or the orchestrator.'
export const OWNER_LADDER_PROBLEM = 'A request with no Origin cannot change the ladder as the owner.'
export const PAGE_LADDER_PROBLEM = 'A page cannot change the ladder as the orchestrator.'
export const OWNER_MESSAGE_PROBLEM = 'A request with no Origin cannot send a message as the owner.'
export const PAGE_MESSAGE_PROBLEM = 'A page cannot send a message as the orchestrator.'
export const ORCHESTRATOR_TARGET_PROBLEM = 'The orchestrator sends a message to a sub orchestrator.'
export const MESSAGE_FROM_PROBLEM = 'A message comes from the owner or the orchestrator.'
export const NO_TOKEN_PROBLEM = 'A request with no Origin needs a valid orchestrator token.'
export const MAIN_LADDER_PROBLEM = 'A ladder change needs the main orchestrator\'s token.'
export const MAIN_MESSAGE_PROBLEM = 'A message to a sub needs the main orchestrator\'s token.'
export const OWNER_COMPACT_PROBLEM = 'A request with no Origin cannot compact an orchestrator.'
export const OWNER_AUTOCOMPACT_PROBLEM = 'A request with no Origin cannot set autocompact.'
export const OWNER_MODEL_PROBLEM = 'A request with no Origin cannot set the model.'
export const OWNER_EFFORT_PROBLEM = 'A request with no Origin cannot set effort.'
export const OWNER_SESSION_PROBLEM = 'A request with no Origin cannot change sessions.'
export const OWNER_HARNESS_PROBLEM = 'A request with no Origin cannot set the harness.'
export const OWNER_MODE_PROBLEM = 'A request with no Origin cannot set the mode.'
export const PAGE_APPROVAL_PROBLEM = 'A page cannot ask for an approval.'
export const OWNER_ANSWER_PROBLEM = 'A request with no Origin cannot answer an approval.'
export const APPROVAL_TOOL_PROBLEM = 'Name the tool the approval is for.'
export const CONFIRM_APPROVAL_PROBLEM = 'Confirm the approval answer first.'
export const APPROVAL_ALLOW_PROBLEM = 'Say whether to allow the request.'
export const NO_APPROVAL_PROBLEM = 'There is no approval with that id.'
export const APPROVAL_LIMIT_PROBLEM = '20 approvals are already waiting for the owner.'
export const APPROVAL_INPUT_LIMIT = 2000

export function runsFolderDefault(env = process.env) {
  return sharedRunsFolder(env)
}

export const SCOPE_UNREAD_PROBLEM = 'The scope could not be read.'

function gitText(folder, args) {
  return String(
    execFileSync(gitPath(), ['-C', folder, ...args], {
      encoding: 'utf8',
      timeout: 10000,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'ignore'],
    })
  )
}

function projectBranch(folder) {
  if (!folder) return ''
  try {
    const name = gitText(folder, ['symbolic-ref', '--short', 'HEAD']).trim()
    return name && name !== 'HEAD' ? name : ''
  } catch {
    return ''
  }
}

function projectPrefix(project) {
  try {
    const top = gitText(project, ['rev-parse', '--show-toplevel']).trim()
    if (!top) return ''
    const start = relative(resolve(top), resolve(project)).replace(/\\/g, '/')
    if (!start || start === '..' || start.startsWith('../') || isAbsolute(start)) return ''
    return `${start}/`
  } catch {
    return ''
  }
}

function newestBase(record, options) {
  const lane = typeof record?.lane === 'string' ? record.lane.trim() : ''
  let newest = record && typeof record === 'object' && !Array.isArray(record) ? record : null
  if (lane !== '') {
    for (const item of Array.isArray(options?.records) ? options.records : []) {
      if (!item || typeof item !== 'object' || Array.isArray(item)) continue
      if (typeof item.lane !== 'string' || item.lane.trim() !== lane) continue
      newest = item
    }
  }
  return typeof newest?.base === 'string' ? newest.base.trim() : ''
}

export function branchChanges(record, lanes = {}, options = {}) {
  let folder = typeof record?.project === 'string' && record.project.trim() ? record.project.trim() : ''
  const laneEntry = lanes && typeof lanes === 'object' && typeof record?.lane === 'string' && Object.hasOwn(lanes, record.lane)
    ? lanes[record.lane]
    : null
  if (!folder && laneEntry?.worktree) folder = laneEntry.worktree
  if (!folder) return []
  const project = typeof options?.project === 'string' && options.project.trim() ? options.project.trim() : folder
  const commit = newestBase(record, options)
  const branch = commit ? '' : projectBranch(project)
  if (!commit && !branch) return null
  try {
    const prefix = projectPrefix(project)
    const relativePath = (path) => {
      if (!path) return ''
      return prefix && path.startsWith(prefix) ? path.slice(prefix.length) : path
    }
    const range = commit ? `${commit}..HEAD` : `${branch}...HEAD`
    const committed = gitText(folder, ['diff', '--no-ext-diff', '--no-textconv', '--name-only', '--relative', range])
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
    const fields = gitText(folder, ['status', '--porcelain', '--untracked-files=all', '-z']).split('\0')
    const uncommitted = []
    for (let index = 0; index < fields.length; index += 1) {
      const field = fields[index]
      if (!field) continue
      const code = field.slice(0, 2)
      uncommitted.push(field.slice(3))
      if (code.includes('R') || code.includes('C')) {
        uncommitted.push(fields[index + 1] ?? '')
        index += 1
      }
    }
    const paths = [...committed, ...uncommitted].map(relativePath).filter(Boolean)
    return [...new Set(paths)]
  } catch {
    return null
  }
}

export function availableHarnesses(lanes = {}, env = process.env, platform = process.platform, endpoints = []) {
  const keys = [...new Set([...HARNESSES.map((h) => h.key), ...MODELS.map((m) => m.harness)])]
  const list = []
  for (const key of keys) {
    if (isHarnessAvailable(key, { lanes, env, platform, endpoints })) {
      const descriptor = HARNESSES.find((h) => h.key === key)
      const name = descriptor?.name ?? key
      const models = key === 'machineroom' && endpoints.length > 0
        ? endpoints.flatMap((endpoint) => (endpoint.models ?? []).map((id) => {
            const detail = endpoint.modelDetails?.find((d) => d.id === id)
            const contextWindow = typeof detail?.contextLength === 'number' && detail.contextLength > 0 ? detail.contextLength : undefined
            return {
              id: `${endpoint.name}/${id}`,
              label: `${endpoint.name}/${id}`,
              ...(contextWindow ? { contextWindow } : {}),
            }
          }))
        : MODELS.filter((m) => m.harness === key).map(({ id, label, contextWindow }) => ({
          id,
          label,
          ...(contextWindow ? { contextWindow } : {}),
        }))
      list.push({
        key,
        name,
        harness: key,
        models,
      })
    }
  }
  return list
}

function harnessFor(sub) {
  const h = String(sub?.harness ?? '').trim()
  return h || 'claude'
}

export function createOrchestrators({
  projectRoot = '',
  runsFolder = runsFolderDefault(),
  lanes = {},
  spawn,
  now,
  onNotice,
  promptFile,
  bridgeUrl,
  sendJson,
  readJsonBody,
  changedFiles = branchChanges,
  onMasked,
  onMessage = () => {},
  activeLanes,
  home = '',
  recordsCache,
  approvalTimeoutMs = APPROVAL_TIMEOUT_MS,
} = {}) {
  const root = projectRoot ? resolve(projectRoot) : ''
  const folder = resolve(runsFolder)
  const sharedCache = recordsCache ?? createRecordsCache(join(folder, 'runs.jsonl'), folder)
  const mainName = typeof lanes?.[ORCHESTRATOR_KEY]?.name === 'string' ? lanes[ORCHESTRATOR_KEY].name : 'Orchestrator'
  const instances = new Map()
  const configs = new Map()
  let stopped = false

  function agentKey(id) {
    const key = typeof id === 'string' ? id.trim() : ''
    if (!key) return ''
    return key === ORCHESTRATOR_KEY ? ORCHESTRATOR_KEY : `sub-${key}`
  }

  function announce(from, to, kind) {
    if (stopped) return
    const sender = typeof from === 'string' ? from.trim() : ''
    const receiver = typeof to === 'string' ? to.trim() : ''
    if (!sender || !receiver || !kind) return
    try {
      onMessage({ from: sender, to: receiver, kind })
    } catch {}
  }

  function eligibleLaneKeys() {
    const all = readAllLanes({ folder: root, runsFolder: folder, lanesJson: typeof lanes === 'function' ? lanes() : (lanes ?? {}) })
    return eligibleLanes(all).map((lane) => lane.key)
  }

  function currentLaneKeys() {
    const all = readAllLanes({ folder: root, runsFolder: folder, lanesJson: typeof lanes === 'function' ? lanes() : (lanes ?? {}) })
    return activeEligibleLaneKeys({
      lanesConfig: all,
      projectRoot: root,
      runsFolder: folder,
      activeLanes,
    })
  }

  const main = createOrchestrator({
    id: ORCHESTRATOR_KEY,
    name: mainName,
    projectRoot: root,
    runsFolder: folder,
    lanes,
    spawn,
    now,
    promptFile,
    bridgeUrl,
    onNotice,
    onMasked,
    onMessage: (message) => announce(message?.from, message?.to, message?.kind),
    hasSub: (id) => instances.has(id),
    home,
    recordsCache: sharedCache,
    approvalTimeoutMs,
  })
  instances.set(ORCHESTRATOR_KEY, main)

  function readSaved() {
    const raw = main.getLadder()
    if (!raw) return { ladder: { subs: [] }, problems: [] }
    return readLadder(raw, { lanes: eligibleLaneKeys() })
  }

  function laneDefaults(harness) {
    const preferred = lanes?.[ORCHESTRATOR_KEY]
    if (preferred?.cli && preferred.cli.harness === harness) return preferred.cli
    for (const entry of Object.values(lanes ?? {})) {
      if (!entry || typeof entry !== 'object' || entry.retired === true) continue
      if (entry.cli && entry.cli.harness === harness) return entry.cli
    }
    return null
  }

  function subConfig(sub) {
    const harness = harnessFor(sub)
    const defaults = laneDefaults(harness)
    const fallbackModel = MODELS.find((m) => m.harness === harness)?.id ?? (harness === 'opencode' ? 'opencode/deepseek-v4.1-flash-free' : 'opus')
    const siblings = readSaved().ladder.subs
      .map((entry) => entry.id)
      .filter((id) => id !== sub.id)
      .sort()
    const model = sub.model || String(defaults?.model ?? fallbackModel)
    const laneWindow = Number.isFinite(defaults?.contextWindow) && defaults.contextWindow > 0 ? Math.round(defaults.contextWindow) : 0
    return {
      id: sub.id,
      name: sub.name,
      harness,
      model,
      bin: String(defaults?.bin ?? harness),
      ...(laneWindow > 0 ? { contextWindow: laneWindow } : {}),
      lanes: [...sub.lanes],
      scope: [...sub.scope],
      restricted: sub.restricted,
      setBy: sub.setBy,
      siblings,
    }
  }

  function sameConfig(left, right) {
    const shape = (config) => [
      config.id,
      config.name,
      config.harness,
      config.model,
      config.bin,
      config.contextWindow,
      [...config.lanes].sort(),
      [...config.scope],
      config.restricted,
      config.setBy,
    ]
    return JSON.stringify(shape(left)) === JSON.stringify(shape(right))
  }

  function createSub(sub) {
    const config = subConfig(sub)
    configs.set(config.id, config)
    const instance = createOrchestrator({
      id: config.id,
      name: config.name,
      harness: config.harness,
      model: config.model,
      bin: config.bin,
      parent: ORCHESTRATOR_KEY,
      projectRoot: root,
      runsFolder: folder,
      lanes,
      spawn,
      now,
      promptFile,
      bridgeUrl,
      contextWindow: config.contextWindow,
      onNotice,
      onMasked,
      recordsCache: sharedCache,
      approvalTimeoutMs,
      onMessage: (message) => announce(message?.from, agentKey(message?.to), message?.kind),
      extraInstructions: () => {
        const ladder = readSaved().ladder
        const current = ladder.subs.find((entry) => entry.id === config.id) || sub
        const cleanSub = {
          ...current,
          lanes: Array.isArray(current.lanes) ? current.lanes.filter((lane) => !isLaneHidden(lane)) : [],
        }
        const cleanLadder = {
          ...ladder,
          subs: Array.isArray(ladder.subs)
            ? ladder.subs.map((entry) => ({
                ...entry,
                lanes: Array.isArray(entry.lanes) ? entry.lanes.filter((lane) => !isLaneHidden(lane)) : [],
              }))
            : [],
        }
        return subPrompt(cleanSub, ORCHESTRATOR_KEY, cleanLadder)
      },
      home,
      siblings: config.siblings,
      onReply: (text) => {
        if (stopped) return
        if (!instances.has(config.id)) return
        const trimmed = typeof text === 'string' ? text.trim() : ''
        if (trimmed === NO_REPORT || trimmed === NO_NEW_REPORT) return
        const parent = instances.get(ORCHESTRATOR_KEY)
        if (!parent) return
        const delivered = parent.deliver(`sub:${config.id}`, text)
        if (delivered) announce(agentKey(config.id), ORCHESTRATOR_KEY, 'report')
      },
      outsideFiles: (record) => {
        if (sub.restricted !== true) return []
        const changes = changedFiles(record, lanes, { project: root, records: [...sharedCache.read().values()] })
        if (!Array.isArray(changes)) {
          if (!stopped && instances.has(config.id)) {
            const parent = instances.get(ORCHESTRATOR_KEY)
            if (parent) parent.deliver('room', SCOPE_UNREAD_PROBLEM)
          }
          return []
        }
        return outsideScope(changes, sub, { windows: process.platform === 'win32' })
      },
      onOutsideScope: (text) => {
        if (stopped) return
        if (!instances.has(config.id)) return
        const parent = instances.get(ORCHESTRATOR_KEY)
        if (parent) parent.deliver('room', text)
      },
    })
    instances.set(config.id, instance)
  }

  function sync() {
    const { ladder } = readSaved()
    const wanted = new Map(ladder.subs.map((sub) => [sub.id, sub]))
    for (const [id, instance] of [...instances]) {
      if (id === ORCHESTRATOR_KEY) continue
      const next = wanted.get(id)
      const config = configs.get(id)
      if (!next) {
        instances.delete(id)
        configs.delete(id)
        instance.close({ removed: true })
      } else if (!config || !sameConfig(config, subConfig(next))) {
        instances.delete(id)
        configs.delete(id)
        instance.close({ removed: false })
      } else {
        const nextConfig = subConfig(next)
        config.siblings = nextConfig.siblings
        instance.setSiblings?.(nextConfig.siblings)
      }
    }
    for (const [id, sub] of wanted) {
      if (!instances.has(id)) createSub(sub)
    }
  }

  function list() {
    const { ladder } = readSaved()
    const claimed = new Set(ladder.subs.flatMap((sub) => sub.lanes))
    const answer = main.answer()
    const activeHarnesses = availableHarnesses(lanes, process.env, process.platform, readEndpoints(folder))
    const entries = [
      {
        id: ORCHESTRATOR_KEY,
        name: mainName,
        harness: answer.harness,
        model: answer.model,
        state: answer.state,
        contextTokens: answer.contextTokens,
        contextWindow: answer.contextWindow,
        autocompact: answer.autocompact,
        autocompactMode: answer.autocompactMode,
        autocompactValue: answer.autocompactValue,
        compactRules: answer.compactRules,
        defaultCompactRules: DEFAULT_COMPACT_RULES,
        autocompactPercent: answer.autocompactPercent,
        effort: answer.effort ?? null,
        mode: answer.mode,
        modes: answer.modes,
        approvals: answer.approvals,
        lanes: currentLaneKeys().filter((lane) => !claimed.has(lane)),
        scope: [],
        restricted: false,
        setBy: 'owner',
        harnesses: activeHarnesses,
      },
    ]
    for (const sub of ladder.subs) {
      const instance = instances.get(sub.id)
      const state = instance ? instance.answer() : null
      const harness = state?.harness ?? harnessFor(sub)
      entries.push({
        id: sub.id,
        name: sub.name,
        harness,
        model: state?.model ?? subConfig(sub).model,
        state: state?.state ?? 'idle',
        contextTokens: state?.contextTokens ?? null,
        contextWindow: state?.contextWindow ?? subConfig(sub).contextWindow ?? DEFAULT_CONTEXT_WINDOW,
        autocompact: state?.autocompact ?? true,
        autocompactMode: state?.autocompactMode ?? DEFAULT_AUTOCOMPACT_MODE,
        autocompactValue: state?.autocompactValue ?? DEFAULT_AUTOCOMPACT_VALUE,
        compactRules: state?.compactRules ?? '',
        defaultCompactRules: DEFAULT_COMPACT_RULES,
        autocompactPercent: state?.autocompactPercent ?? DEFAULT_AUTOCOMPACT_PERCENT,
        effort: state?.effort ?? null,
        mode: state?.mode ?? legacyMode(harness),
        modes: modesFor(harness),
        approvals: state?.approvals ?? [],
        lanes: sub.lanes.filter((lane) => !isLaneHidden(lane)),
        scope: [...sub.scope],
        restricted: sub.restricted,
        setBy: sub.setBy,
        harnesses: activeHarnesses,
      })
    }
    return entries
  }

  function isLaneHidden(key) {
    if (activeLanes) {
      const helper = typeof activeLanes === 'function' ? activeLanes() : activeLanes
      if (helper && typeof helper.isLaneHidden === 'function') {
        return helper.isLaneHidden(key)
      }
    }
    const file = projectLanesFileFor(root, folder)
    return readHiddenLanes(file).includes(key)
  }

  function subs() {
    return readSaved().ladder.subs.map((sub) => {
      const instance = instances.get(sub.id)
      const answer = instance ? instance.answer() : null
      const own = typeof sub.model === 'string' ? sub.model.trim() : ''
      return {
        id: sub.id,
        name: sub.name,
        harness: answer?.harness ?? harnessFor(sub),
        model: answer?.model ?? (own || null),
      }
    })
  }

  function sector(id) {
    const key = typeof id === 'string' ? id.trim() : ''
    if (!key) return null
    const { ladder } = readSaved()
    if (key === ORCHESTRATOR_KEY) {
      const claimed = new Set(ladder.subs.flatMap((sub) => sub.lanes.filter((lane) => !isLaneHidden(lane))))
      return { id: ORCHESTRATOR_KEY, name: mainName, lanes: currentLaneKeys().filter((lane) => !claimed.has(lane)) }
    }
    const sub = ladder.subs.find((entry) => entry.id === key)
    if (!sub) return null
    return { id: sub.id, name: sub.name, lanes: sub.lanes.filter((lane) => !isLaneHidden(lane)) }
  }

  function sectorForLane(lane) {
    const key = typeof lane === 'string' ? lane.trim() : ''
    if (!key || isLaneHidden(key)) return null
    const { ladder } = readSaved()
    const sub = ladder.subs.find((entry) => Array.isArray(entry.lanes) && entry.lanes.includes(key))
    if (!sub) return null
    return { id: sub.id, name: sub.name, lanes: sub.lanes.filter((l) => !isLaneHidden(l)) }
  }

  function find(id) {
    const key = typeof id === 'string' && id.trim() ? id.trim() : ORCHESTRATOR_KEY
    return instances.get(key) ?? null
  }

  function token(id) {
    const key = typeof id === 'string' && id.trim() ? id.trim() : ORCHESTRATOR_KEY
    const instance = instances.get(key)
    return instance?.token ?? null
  }

  function idForToken(value) {
    if (typeof value !== 'string' || !value) return null
    for (const [id, instance] of instances) {
      if (instance.token && instance.token === value) return id
    }
    return null
  }

  function message(body, page, tokenValue = '') {
    if (!page) {
      const actor = idForToken(tokenValue)
      if (!actor) return { status: 403, body: { error: NO_TOKEN_PROBLEM } }
      if (actor !== ORCHESTRATOR_KEY) return { status: 403, body: { error: MAIN_MESSAGE_PROBLEM } }
    }
    const id = typeof body.id === 'string' && body.id.trim() ? body.id.trim() : ORCHESTRATOR_KEY
    const instance = instances.get(id)
    if (!instance) return { status: 404, body: { error: NO_ORCHESTRATOR_PROBLEM } }
    const from =
      body.from === undefined || body.from === null || body.from === ''
        ? page
          ? 'owner'
          : 'orchestrator'
        : body.from
    if (from === 'owner' && !page) return { status: 403, body: { error: OWNER_MESSAGE_PROBLEM } }
    if (from === 'orchestrator') {
      if (page) return { status: 403, body: { error: PAGE_MESSAGE_PROBLEM } }
      if (id === ORCHESTRATOR_KEY) return { status: 400, body: { error: ORCHESTRATOR_TARGET_PROBLEM } }
      if (body.confirmed !== true) return { status: 400, body: { error: CONFIRM_MESSAGE_PROBLEM } }
      const text = typeof body.text === 'string' ? body.text.trim() : ''
      if (text.length < 1 || text.length > ORCHESTRATOR_MESSAGE_LIMIT) {
        return { status: 400, body: { error: MESSAGE_PROBLEM } }
      }
      const sent = instance.deliver('orchestrator', text)
      if (sent) announce(ORCHESTRATOR_KEY, agentKey(id), 'order')
      return { status: 202, body: { id: sent?.id ?? null } }
    }
    if (from !== 'owner') return { status: 400, body: { error: MESSAGE_FROM_PROBLEM } }
    return instance.send(body)
  }

  function ladderChange(body, page, tokenValue = '') {
    if (!page) {
      const actor = idForToken(tokenValue)
      if (!actor) return { status: 403, body: { error: NO_TOKEN_PROBLEM } }
      if (actor !== ORCHESTRATOR_KEY) return { status: 403, body: { error: MAIN_LADDER_PROBLEM } }
    }
    if (body.confirmed !== true) return { status: 400, body: { error: CONFIRM_LADDER_PROBLEM } }
    const by =
      body.by === undefined || body.by === null || body.by === ''
        ? page
          ? 'owner'
          : 'orchestrator'
        : body.by
    if (by !== 'owner' && by !== 'orchestrator') return { status: 400, body: { error: LADDER_BY_PROBLEM } }
    if (by === 'owner' && !page) return { status: 403, body: { error: OWNER_LADDER_PROBLEM } }
    if (by === 'orchestrator' && page) return { status: 403, body: { error: PAGE_LADDER_PROBLEM } }
    let ladderInput = body.ladder
    if (body.keepHidden !== false && ladderInput && typeof ladderInput === 'object' && Array.isArray(ladderInput.subs)) {
      const savedLadder = readSaved().ladder
      const savedSubs = new Map((savedLadder?.subs ?? []).map((sub) => [sub.id, sub]))
      const claimedByNew = new Map()
      for (const sub of ladderInput.subs) {
        if (!sub || typeof sub !== 'object') continue
        if (Array.isArray(sub.lanes)) {
          for (const lane of sub.lanes) {
            if (typeof lane === 'string' && lane) {
              claimedByNew.set(lane, sub.id)
            }
          }
        }
      }
      const subs = ladderInput.subs.map((sub) => {
        if (!sub || typeof sub !== 'object' || typeof sub.id !== 'string') return sub
        const saved = savedSubs.get(sub.id)
        if (!saved || !Array.isArray(saved.lanes)) return sub
        const lanes = Array.isArray(sub.lanes) ? [...sub.lanes] : []
        for (const lane of saved.lanes) {
          if (typeof lane !== 'string' || !lane) continue
          if (isLaneHidden(lane)) {
            const claimingSub = claimedByNew.get(lane)
            if ((claimingSub === undefined || claimingSub === sub.id) && !lanes.includes(lane)) {
              lanes.push(lane)
            }
          }
        }
        return { ...sub, lanes }
      })
      ladderInput = { ...ladderInput, subs }
    }
    const next = readLadder(ladderInput, { lanes: eligibleLaneKeys() })
    if (next.problems.length > 0) {
      return { status: 400, body: { error: next.problems.join(' '), problems: next.problems } }
    }
    if (by === 'orchestrator') {
      const current = readSaved().ladder
      const problems = []
      for (const sub of next.ladder.subs) {
        if (!canChange(current, sub, by)) {
          problems.push(`Sub "${sub.id}" was set by the owner, so only the owner can change its scope or its restriction.`)
        }
      }
      for (const old of current.subs) {
        if (old.setBy === 'owner' && !next.ladder.subs.some((sub) => sub.id === old.id)) {
          problems.push(`Sub "${old.id}" was set by the owner, so only the owner can remove it.`)
        }
      }
      if (problems.length > 0) return { status: 403, body: { error: problems.join(' '), problems } }
    }
    main.setLadder(next.ladder)
    sync()
    onNotice?.({ topic: 'agents' })
    onNotice?.({ topic: 'family' })
    return { status: 200, body: { ladder: next.ladder } }
  }

  function methodNotAllowed(req, res) {
    sendJson(req, res, 405, { error: 'Method not allowed.' })
    return true
  }

  async function handle(req, res, url) {
    const path = url.pathname
    const method = req.method ?? 'GET'
    const page = Boolean(req.headers.origin)
    const tokenHeader = req.headers['x-machineroom-orchestrator']
    const token = typeof tokenHeader === 'string' ? tokenHeader.trim() : Array.isArray(tokenHeader) ? tokenHeader[0].trim() : ''
    if (path === '/api/orchestrators') {
      if (method !== 'GET') return methodNotAllowed(req, res)
      sendJson(req, res, 200, list())
      return true
    }
    if (path === '/api/orchestrator') {
      if (method !== 'GET') return methodNotAllowed(req, res)
      const instance = find(url.searchParams.get('id'))
      if (!instance) {
        sendJson(req, res, 404, { error: NO_ORCHESTRATOR_PROBLEM })
        return true
      }
      sendJson(req, res, 200, instance.answer())
      return true
    }
    if (path === '/api/orchestrator/commands') {
      if (method !== 'GET') return methodNotAllowed(req, res)
      const instance = find(url.searchParams.get('id'))
      if (!instance) {
        sendJson(req, res, 404, { error: NO_ORCHESTRATOR_PROBLEM })
        return true
      }
      sendJson(req, res, 200, { commands: instance.commands() })
      return true
    }
    if (path === '/api/orchestrator/messages') {
      if (method !== 'POST') return methodNotAllowed(req, res)
      const body = await readJsonBody(req, res)
      if (body === null) return true
      const out = message(body, page, token)
      sendJson(req, res, out.status, out.body)
      return true
    }
    if (path === '/api/orchestrator/stop') {
      if (method !== 'POST') return methodNotAllowed(req, res)
      if (!page) {
        const actor = idForToken(token)
        if (!actor) {
          sendJson(req, res, 403, { error: NO_TOKEN_PROBLEM })
          return true
        }
      }
      const body = await readJsonBody(req, res)
      if (body === null) return true
      const instance = find(body.id)
      if (!instance) {
        sendJson(req, res, 404, { error: NO_ORCHESTRATOR_PROBLEM })
        return true
      }
      const out = instance.stop(body)
      sendJson(req, res, out.status, out.body)
      return true
    }
    if (path === '/api/orchestrator/compact') {
      if (method !== 'POST') return methodNotAllowed(req, res)
      if (!page) {
        sendJson(req, res, 403, { error: OWNER_COMPACT_PROBLEM })
        return true
      }
      const body = await readJsonBody(req, res)
      if (body === null) return true
      const instance = find(body.id)
      if (!instance) {
        sendJson(req, res, 404, { error: NO_ORCHESTRATOR_PROBLEM })
        return true
      }
      const out = instance.compact(body)
      sendJson(req, res, out.status, out.body)
      return true
    }
    if (path === '/api/orchestrator/autocompact') {
      if (method !== 'POST') return methodNotAllowed(req, res)
      if (!page) {
        sendJson(req, res, 403, { error: OWNER_AUTOCOMPACT_PROBLEM })
        return true
      }
      const body = await readJsonBody(req, res)
      if (body === null) return true
      const instance = find(body.id)
      if (!instance) {
        sendJson(req, res, 404, { error: NO_ORCHESTRATOR_PROBLEM })
        return true
      }
      const out = instance.setAutocompact(body)
      sendJson(req, res, out.status, out.body)
      return true
    }
    if (path === '/api/orchestrator/model') {
      if (method !== 'POST') return methodNotAllowed(req, res)
      if (!page) {
        sendJson(req, res, 403, { error: OWNER_MODEL_PROBLEM })
        return true
      }
      const body = await readJsonBody(req, res)
      if (body === null) return true
      const instance = find(body.id)
      if (!instance) {
        sendJson(req, res, 404, { error: NO_ORCHESTRATOR_PROBLEM })
        return true
      }
      const out = instance.setModel(body)
      sendJson(req, res, out.status, out.body)
      return true
    }
    if (path === '/api/orchestrator/harness') {
      if (method !== 'POST') return methodNotAllowed(req, res)
      if (!page) {
        sendJson(req, res, 403, { error: OWNER_HARNESS_PROBLEM })
        return true
      }
      const body = await readJsonBody(req, res)
      if (body === null) return true
      const instance = find(body.id)
      if (!instance) {
        sendJson(req, res, 404, { error: NO_ORCHESTRATOR_PROBLEM })
        return true
      }
      const out = instance.setHarness(body)
      if (out.status === 200 && body.id && body.id !== ORCHESTRATOR_KEY) {
        const { ladder } = readSaved()
        const targetSub = ladder.subs.find((s) => s.id === body.id)
        if (targetSub) {
          targetSub.harness = typeof body.harness === 'string' ? body.harness.trim() : targetSub.harness
          targetSub.model = typeof body.model === 'string' ? body.model.trim() : targetSub.model
          main.setLadder(ladder)
        }
      }
      sendJson(req, res, out.status, out.body)
      return true
    }
    if (path === '/api/orchestrator/mode') {
      if (method !== 'POST') return methodNotAllowed(req, res)
      if (!page) {
        sendJson(req, res, 403, { error: OWNER_MODE_PROBLEM })
        return true
      }
      const body = await readJsonBody(req, res)
      if (body === null) return true
      const instance = find(body.id)
      if (!instance) {
        sendJson(req, res, 404, { error: NO_ORCHESTRATOR_PROBLEM })
        return true
      }
      const out = instance.setMode(body)
      sendJson(req, res, out.status, out.body)
      return true
    }
    if (path === '/api/orchestrator/approvals') {
      if (method !== 'POST') return methodNotAllowed(req, res)
      if (page) {
        sendJson(req, res, 403, { error: PAGE_APPROVAL_PROBLEM })
        return true
      }
      const actor = idForToken(token)
      if (!actor) {
        sendJson(req, res, 403, { error: NO_TOKEN_PROBLEM })
        return true
      }
      const body = await readJsonBody(req, res)
      if (body === null) return true
      if (body.id !== undefined && body.id !== null && body.id !== '' && body.id !== actor) {
        sendJson(req, res, 403, { error: NO_TOKEN_PROBLEM })
        return true
      }
      const instance = instances.get(actor)
      if (!instance) {
        sendJson(req, res, 404, { error: NO_ORCHESTRATOR_PROBLEM })
        return true
      }
      const tool = typeof body.tool === 'string' ? body.tool.trim() : ''
      if (!tool) {
        sendJson(req, res, 400, { error: APPROVAL_TOOL_PROBLEM })
        return true
      }
      const raw = typeof body.input === 'string' ? body.input : JSON.stringify(body.input ?? {})
      const masked = maskKeys(raw)
      if (masked.count > 0 && typeof onMasked === 'function') {
        try {
          onMasked(masked.count)
        } catch {}
      }
      const waiting = instance.requestApproval({ tool, input: masked.text.slice(0, APPROVAL_INPUT_LIMIT) })
      if (waiting === null) {
        sendJson(req, res, 429, { error: APPROVAL_LIMIT_PROBLEM })
        return true
      }
      sendJson(req, res, 200, await waiting)
      return true
    }
    const approvalMatch = /^\/api\/orchestrator\/approvals\/([^/?#]+)$/.exec(path)
    if (approvalMatch) {
      if (method !== 'POST') return methodNotAllowed(req, res)
      if (!page) {
        sendJson(req, res, 403, { error: OWNER_ANSWER_PROBLEM })
        return true
      }
      const body = await readJsonBody(req, res)
      if (body === null) return true
      if (body.confirmed !== true) {
        sendJson(req, res, 400, { error: CONFIRM_APPROVAL_PROBLEM })
        return true
      }
      if (typeof body.allow !== 'boolean') {
        sendJson(req, res, 400, { error: APPROVAL_ALLOW_PROBLEM })
        return true
      }
      const instance = find(body.id)
      if (!instance) {
        sendJson(req, res, 404, { error: NO_ORCHESTRATOR_PROBLEM })
        return true
      }
      const approvalId = decodeURIComponent(approvalMatch[1])
      const out = instance.answerApproval({ approvalId, allow: body.allow })
      if (!out) {
        sendJson(req, res, 404, { error: NO_APPROVAL_PROBLEM })
        return true
      }
      sendJson(req, res, 200, out)
      return true
    }
    if (path === '/api/orchestrator/effort') {
      if (method !== 'POST') return methodNotAllowed(req, res)
      if (!page) {
        sendJson(req, res, 403, { error: OWNER_EFFORT_PROBLEM })
        return true
      }
      const body = await readJsonBody(req, res)
      if (body === null) return true
      const instance = find(body.id)
      if (!instance) {
        sendJson(req, res, 404, { error: NO_ORCHESTRATOR_PROBLEM })
        return true
      }
      const out = instance.setEffort(body)
      sendJson(req, res, out.status, out.body)
      return true
    }
    if (path === '/api/orchestrator/sessions') {
      if (method !== 'GET') return methodNotAllowed(req, res)
      const instance = find(url.searchParams.get('id'))
      if (!instance) {
        sendJson(req, res, 404, { error: NO_ORCHESTRATOR_PROBLEM })
        return true
      }
      sendJson(req, res, 200, {
        current: instance.currentSessionInfo(),
        sessions: instance.listSessions(),
      })
      return true
    }
    if (path === '/api/orchestrator/sessions/new') {
      if (method !== 'POST') return methodNotAllowed(req, res)
      if (!page) {
        sendJson(req, res, 403, { error: OWNER_SESSION_PROBLEM })
        return true
      }
      const body = await readJsonBody(req, res)
      if (body === null) return true
      const instance = find(body.id || url.searchParams.get('id'))
      if (!instance) {
        sendJson(req, res, 404, { error: NO_ORCHESTRATOR_PROBLEM })
        return true
      }
      const out = instance.newSession(body)
      sendJson(req, res, out.status, out.body)
      return true
    }
    if (path === '/api/orchestrator/sessions/branch') {
      if (method !== 'POST') return methodNotAllowed(req, res)
      if (!page) {
        sendJson(req, res, 403, { error: OWNER_SESSION_PROBLEM })
        return true
      }
      const body = await readJsonBody(req, res)
      if (body === null) return true
      const instance = find(body.id || url.searchParams.get('id'))
      if (!instance) {
        sendJson(req, res, 404, { error: NO_ORCHESTRATOR_PROBLEM })
        return true
      }
      const out = instance.branchSession(body)
      sendJson(req, res, out.status, out.body)
      return true
    }
    const openMatch = /^\/api\/orchestrator\/sessions\/([^/?#]+)\/open$/.exec(path)
    if (openMatch) {
      if (method !== 'POST') return methodNotAllowed(req, res)
      if (!page) {
        sendJson(req, res, 403, { error: OWNER_SESSION_PROBLEM })
        return true
      }
      const sid = decodeURIComponent(openMatch[1])
      const body = await readJsonBody(req, res)
      if (body === null) return true
      const instance = find(body.id || url.searchParams.get('id'))
      if (!instance) {
        sendJson(req, res, 404, { error: NO_ORCHESTRATOR_PROBLEM })
        return true
      }
      const out = instance.openSession(sid, body)
      sendJson(req, res, out.status, out.body)
      return true
    }
    const deleteMatch = /^\/api\/orchestrator\/sessions\/([^/?#]+)\/delete$/.exec(path)
    if (deleteMatch) {
      if (method !== 'POST') return methodNotAllowed(req, res)
      if (!page) {
        sendJson(req, res, 403, { error: OWNER_SESSION_PROBLEM })
        return true
      }
      const sid = decodeURIComponent(deleteMatch[1])
      const body = await readJsonBody(req, res)
      if (body === null) return true
      const instance = find(body.id || url.searchParams.get('id'))
      if (!instance) {
        sendJson(req, res, 404, { error: NO_ORCHESTRATOR_PROBLEM })
        return true
      }
      const out = instance.deleteSession(sid, body)
      sendJson(req, res, out.status, out.body)
      return true
    }
    const sessionMatch = /^\/api\/orchestrator\/sessions\/([^/?#]+)$/.exec(path)
    if (sessionMatch) {
      const sid = decodeURIComponent(sessionMatch[1])
      if (method === 'GET') {
        const instance = find(url.searchParams.get('id'))
        if (!instance) {
          sendJson(req, res, 404, { error: NO_ORCHESTRATOR_PROBLEM })
          return true
        }
        const out = instance.getSession(sid)
        sendJson(req, res, out.status, out.body)
        return true
      }
      if (method === 'POST') {
        if (!page) {
          sendJson(req, res, 403, { error: OWNER_SESSION_PROBLEM })
          return true
        }
        const body = await readJsonBody(req, res)
        if (body === null) return true
        const instance = find(body.id || url.searchParams.get('id'))
        if (!instance) {
          sendJson(req, res, 404, { error: NO_ORCHESTRATOR_PROBLEM })
          return true
        }
        const out = instance.updateSession(sid, body)
        sendJson(req, res, out.status, out.body)
        return true
      }
      return methodNotAllowed(req, res)
    }
    if (path === '/api/orchestrator/ladder') {
      if (method !== 'POST') return methodNotAllowed(req, res)
      const body = await readJsonBody(req, res)
      if (body === null) return true
      const out = ladderChange(body, page, token)
      sendJson(req, res, out.status, out.body)
      return true
    }
    return false
  }

  function onFrame(frame) {
    let preloadedRecord = undefined
    if (frame?.type === 'heartbeat.run.status') {
      const status = frame.payload?.status
      if (status === 'succeeded' || status === 'failed') {
        const runId = typeof frame.payload?.runId === 'string' ? frame.payload.runId : ''
        const runName = runId.startsWith('run-') ? runId.slice(4) : ''
        if (runName) {
          const wanted = pathKey(join(folder, `${runName}.log`))
          preloadedRecord = sharedCache.read().get(wanted) ?? null
        }
      }
    }
    for (const instance of instances.values()) instance.onFrame(frame, preloadedRecord)
  }

  function close() {
    stopped = true
    for (const instance of instances.values()) instance.close()
    instances.clear()
    configs.clear()
  }

  sync()

  return {
    main,
    handle,
    list,
    subs,
    sector,
    sectorForLane,
    find,
    token,
    idForToken,
    onFrame,
    close,
    ladderChange,
    getLadder: () => readSaved().ladder,
  }
}
