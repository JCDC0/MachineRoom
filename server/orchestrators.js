import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { isAbsolute, join, relative, resolve } from 'node:path'
import { canChange, outsideScope, readLadder, subPrompt } from '../src/model/hierarchy.js'
import {
  CONFIRM_MESSAGE_PROBLEM,
  createOrchestrator,
  DEFAULT_CONTEXT_WINDOW,
  MESSAGE_PROBLEM,
  ORCHESTRATOR_KEY,
  ORCHESTRATOR_MESSAGE_LIMIT,
} from './orchestrator.js'
import { gitPath } from './programPath.js'

export const CONFIRM_LADDER_PROBLEM = 'Confirm the ladder first.'
export const NO_ORCHESTRATOR_PROBLEM = 'There is no orchestrator with that id.'
export const LADDER_BY_PROBLEM = 'A ladder change comes from the owner or the orchestrator.'
export const PAGE_LADDER_PROBLEM = 'A page cannot change the ladder as the orchestrator.'
export const PAGE_MESSAGE_PROBLEM = 'A page cannot send a message as the orchestrator.'
export const ORCHESTRATOR_TARGET_PROBLEM = 'The orchestrator sends a message to a sub orchestrator.'
export const MESSAGE_FROM_PROBLEM = 'A message comes from the owner or the orchestrator.'

function runsFolderDefault() {
  return join(process.env.TEMP || tmpdir(), 'machineroom-runs')
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

export function branchChanges(record, lanes = {}, options = {}) {
  let folder = typeof record?.project === 'string' && record.project.trim() ? record.project.trim() : ''
  if (!folder && typeof record?.lane === 'string' && lanes?.[record.lane]?.worktree) folder = lanes[record.lane].worktree
  if (!folder) return []
  const project = typeof options?.project === 'string' && options.project.trim() ? options.project.trim() : folder
  const base = projectBranch(project)
  if (!base) return null
  try {
    const prefix = projectPrefix(project)
    const relativePath = (path) => {
      if (!path) return ''
      return prefix && path.startsWith(prefix) ? path.slice(prefix.length) : path
    }
    const committed = gitText(folder, ['diff', '--name-only', '--relative', `${base}...HEAD`])
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

function harnessFor(sub) {
  return String(sub?.harness ?? '').trim() === 'opencode' ? 'opencode' : 'claude'
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
} = {}) {
  const root = projectRoot ? resolve(projectRoot) : ''
  const folder = resolve(runsFolder)
  const laneKeys = Object.keys(lanes ?? {}).filter((key) => key !== ORCHESTRATOR_KEY)
  const mainName = typeof lanes?.[ORCHESTRATOR_KEY]?.name === 'string' ? lanes[ORCHESTRATOR_KEY].name : 'Orchestrator'
  const instances = new Map()
  const configs = new Map()
  let stopped = false

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
  })
  instances.set(ORCHESTRATOR_KEY, main)

  function readSaved() {
    const raw = main.getLadder()
    if (!raw) return { ladder: { subs: [] }, problems: [] }
    return readLadder(raw, { lanes: laneKeys })
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
    return {
      id: sub.id,
      name: sub.name,
      harness,
      model: sub.model || String(defaults?.model ?? (harness === 'opencode' ? 'opencode/deepseek-v4.1-flash-free' : 'opus')),
      bin: String(defaults?.bin ?? (harness === 'opencode' ? 'opencode' : 'claude')),
      contextWindow: Number.isFinite(defaults?.contextWindow) && defaults.contextWindow > 0 ? Math.round(defaults.contextWindow) : 0,
      lanes: [...sub.lanes],
      scope: [...sub.scope],
      restricted: sub.restricted,
      setBy: sub.setBy,
    }
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
      contextWindow: config.contextWindow > 0 ? config.contextWindow : DEFAULT_CONTEXT_WINDOW,
      onNotice,
      onMasked,
      extraInstructions: subPrompt(sub, ORCHESTRATOR_KEY),
      onReply: (text) => {
        if (stopped) return
        if (!instances.has(config.id)) return
        const parent = instances.get(ORCHESTRATOR_KEY)
        if (parent) parent.deliver(`sub:${config.id}`, text)
      },
      outsideFiles: (record) => {
        if (sub.restricted !== true) return []
        const changes = changedFiles(record, lanes, { project: root })
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
      if (!next || !config || !sameConfig(config, subConfig(next))) {
        instances.delete(id)
        configs.delete(id)
        instance.close()
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
        lanes: laneKeys.filter((lane) => !claimed.has(lane)),
        scope: [],
        restricted: false,
        setBy: 'owner',
      },
    ]
    for (const sub of ladder.subs) {
      const instance = instances.get(sub.id)
      const state = instance ? instance.answer() : null
      entries.push({
        id: sub.id,
        name: sub.name,
        harness: harnessFor(sub),
        model: state?.model ?? subConfig(sub).model,
        state: state?.state ?? 'idle',
        contextTokens: state?.contextTokens ?? null,
        contextWindow: state?.contextWindow ?? subConfig(sub).contextWindow ?? DEFAULT_CONTEXT_WINDOW,
        autocompact: state?.autocompact ?? true,
        lanes: [...sub.lanes],
        scope: [...sub.scope],
        restricted: sub.restricted,
        setBy: sub.setBy,
      })
    }
    return entries
  }

  function subs() {
    return readSaved().ladder.subs.map((sub) => ({ id: sub.id, name: sub.name, harness: harnessFor(sub) }))
  }

  function sector(id) {
    const key = typeof id === 'string' ? id.trim() : ''
    if (!key) return null
    const { ladder } = readSaved()
    if (key === ORCHESTRATOR_KEY) {
      const claimed = new Set(ladder.subs.flatMap((sub) => sub.lanes))
      return { id: ORCHESTRATOR_KEY, name: mainName, lanes: laneKeys.filter((lane) => !claimed.has(lane)) }
    }
    const sub = ladder.subs.find((entry) => entry.id === key)
    if (!sub) return null
    return { id: sub.id, name: sub.name, lanes: [...sub.lanes] }
  }

  function find(id) {
    const key = typeof id === 'string' && id.trim() ? id.trim() : ORCHESTRATOR_KEY
    return instances.get(key) ?? null
  }

  function message(body, page) {
    const id = typeof body.id === 'string' && body.id.trim() ? body.id.trim() : ORCHESTRATOR_KEY
    const instance = instances.get(id)
    if (!instance) return { status: 404, body: { error: NO_ORCHESTRATOR_PROBLEM } }
    const from = body.from === undefined || body.from === null || body.from === '' ? 'owner' : body.from
    if (from === 'orchestrator') {
      if (page) return { status: 403, body: { error: PAGE_MESSAGE_PROBLEM } }
      if (id === ORCHESTRATOR_KEY) return { status: 400, body: { error: ORCHESTRATOR_TARGET_PROBLEM } }
      if (body.confirmed !== true) return { status: 400, body: { error: CONFIRM_MESSAGE_PROBLEM } }
      const text = typeof body.text === 'string' ? body.text.trim() : ''
      if (text.length < 1 || text.length > ORCHESTRATOR_MESSAGE_LIMIT) {
        return { status: 400, body: { error: MESSAGE_PROBLEM } }
      }
      const sent = instance.deliver('orchestrator', text)
      return { status: 202, body: { id: sent?.id ?? null } }
    }
    if (from !== 'owner') return { status: 400, body: { error: MESSAGE_FROM_PROBLEM } }
    return instance.send(body)
  }

  function ladderChange(body, page) {
    if (body.confirmed !== true) return { status: 400, body: { error: CONFIRM_LADDER_PROBLEM } }
    const by = body.by === undefined || body.by === null || body.by === '' ? 'owner' : body.by
    if (by !== 'owner' && by !== 'orchestrator') return { status: 400, body: { error: LADDER_BY_PROBLEM } }
    if (by === 'orchestrator' && page) return { status: 403, body: { error: PAGE_LADDER_PROBLEM } }
    const next = readLadder(body.ladder, { lanes: laneKeys })
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
    if (path === '/api/orchestrator/messages') {
      if (method !== 'POST') return methodNotAllowed(req, res)
      const body = await readJsonBody(req, res)
      if (body === null) return true
      const out = message(body, page)
      sendJson(req, res, out.status, out.body)
      return true
    }
    if (path === '/api/orchestrator/stop') {
      if (method !== 'POST') return methodNotAllowed(req, res)
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
    if (path === '/api/orchestrator/autocompact') {
      if (method !== 'POST') return methodNotAllowed(req, res)
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
    if (path === '/api/orchestrator/ladder') {
      if (method !== 'POST') return methodNotAllowed(req, res)
      const body = await readJsonBody(req, res)
      if (body === null) return true
      const out = ladderChange(body, page)
      sendJson(req, res, out.status, out.body)
      return true
    }
    return false
  }

  function onFrame(frame) {
    for (const instance of instances.values()) instance.onFrame(frame)
  }

  function close() {
    stopped = true
    for (const instance of instances.values()) instance.close()
    instances.clear()
    configs.clear()
  }

  sync()

  return { main, handle, list, subs, sector, find, onFrame, close }
}
