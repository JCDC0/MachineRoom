import { ancestors, dirname } from './paths.js'

const LINE_LIMIT = 80
export const CALL_LIMIT = 500
export const MAX_DEPTH = 3
export const MAX_DEPTH_ALLOWED = 4
export const CHILD_LIFE_MS = 7500

export function depthLimitOf(value) {
  const raw = value !== null && typeof value === 'object' ? value.depth ?? value.limit : value
  if (raw === undefined || raw === null || raw === '') return MAX_DEPTH
  const number = Number(raw)
  if (!Number.isFinite(number)) return MAX_DEPTH
  return Math.min(MAX_DEPTH_ALLOWED, Math.max(0, Math.floor(number)))
}

export function setDepthLimit(state, value) {
  if (!state || typeof state !== 'object') return MAX_DEPTH
  state.depthLimit = depthLimitOf(value)
  return state.depthLimit
}

function makeAgent(key, name, parent = null, depth = 0, runId = null, source = null) {
  return {
    key,
    name,
    id: typeof source?.id === 'string' ? source.id : null,
    harness: typeof source?.harness === 'string' ? source.harness : null,
    model: typeof source?.model === 'string' ? source.model : null,
    status: 'idle',
    runId,
    label: '',
    target: '',
    endedAt: 0,
    error: null,
    lines: [],
    version: 0,
    runs: 0,
    calls: new Map(),
    runWrites: new Set(),
    focus: [],
    parent,
    depth,
  }
}

export function createState(tree, agents) {
  const files = new Map()
  let missingFiles = 0
  for (const path of tree.files) {
    const exists = !tree.created.includes(path)
    if (!exists) missingFiles += 1
    files.set(path, { path, exists, reads: 0, writes: 0, failed: false, yellow: false })
  }
  const dirs = new Map()
  for (const path of tree.dirs) dirs.set(path, { path, opened: false })
  const roster = new Map()
  for (const agent of agents) roster.set(agent.key, makeAgent(agent.key, agent.name, null, 0, null, agent))
  return {
    files,
    dirs,
    agents: roster,
    now: 0,
    recent: [],
    recentAt: new Map(),
    latest: 0,
    missingFiles,
    fileVersion: 0,
    get existingFiles() {
      return this.files.size - this.missingFiles
    },
  }
}

function say(agent, text, tone = 'normal') {
  agent.lines.push({ text, tone })
  if (agent.lines.length > LINE_LIMIT) agent.lines.shift()
  agent.version += 1
}

export const RECENT_LIMIT = 8
export const RECENT_KEEP_MS = 90000

function remember(state, paths, time) {
  for (const path of paths) {
    const index = state.recent.indexOf(path)
    if (index !== -1) state.recent.splice(index, 1)
    state.recent.push(path)
    state.recentAt.set(path, time)
  }
  if (state.recent.length > RECENT_LIMIT) state.recent.splice(0, state.recent.length - RECENT_LIMIT)
  const kept = new Set(state.recent)
  for (const path of state.recentAt.keys()) {
    if (!kept.has(path)) state.recentAt.delete(path)
  }
}

export function freshRecent(state, keepMs = RECENT_KEEP_MS) {
  const recentAt = state.recentAt ?? new Map()
  return state.recent.filter((path) => state.latest - (recentAt.get(path) ?? state.latest) <= keepMs)
}

function ensureFile(state, path) {
  let file = state.files.get(path)
  if (!file) {
    file = { path, exists: false, reads: 0, writes: 0, failed: false, yellow: false }
    state.files.set(path, file)
    state.missingFiles += 1
    ancestors(path).forEach((dir) => {
      if (!state.dirs.has(dir)) state.dirs.set(dir, { path: dir, opened: false })
    })
  }
  return file
}

function applyTouch(state, agent, touch) {
  if (touch.kind === 'dir') {
    const dir = state.dirs.get(touch.path)
    if (!dir) return
    ancestors(`${touch.path}/x`).forEach((path) => {
      const entry = state.dirs.get(path)
      if (entry) entry.opened = true
    })
    agent.target = touch.path
    return
  }
  const file = ensureFile(state, touch.path)
  ancestors(touch.path).forEach((path) => {
    const entry = state.dirs.get(path)
    if (entry) entry.opened = true
  })
  agent.target = dirname(touch.path)
  if (touch.mode === 'read') {
    file.reads += 1
  } else {
    file.writes += 1
    if (!file.exists) {
      file.exists = true
      state.missingFiles -= 1
      state.fileVersion = (state.fileVersion ?? 0) + 1
    }
    file.failed = false
    agent.runWrites.add(touch.path)
  }
}

function isDescendant(state, agent, parentKey) {
  let key = agent.parent
  while (key) {
    if (key === parentKey) return true
    key = state.agents.get(key)?.parent ?? null
  }
  return false
}

function finish(agent, activity) {
  agent.status = activity.ok ? 'done' : 'error'
  agent.endedAt = activity.time
  agent.calls.clear()
  agent.focus = []
  if (!activity.ok) agent.error = activity.error ?? 'failed'
}

function pruneChildren(state) {
  const parents = new Set()
  for (const agent of state.agents.values()) if (agent.parent) parents.add(agent.parent)
  for (const [key, agent] of state.agents) {
    if (!agent.parent || parents.has(key)) continue
    if (agent.status !== 'done' && agent.status !== 'error') continue
    if (!Number.isFinite(agent.endedAt)) continue
    if (state.latest - agent.endedAt < CHILD_LIFE_MS) continue
    state.agents.delete(key)
  }
}

export function apply(state, activity) {
  if (Number.isFinite(activity.time) && activity.time > (state.latest ?? 0)) state.latest = activity.time
  pruneChildren(state)
  const agent = state.agents.get(activity.agent)
  if (!agent) return
  switch (activity.type) {
    case 'agent.spawn': {
      if (!activity.child) break
      const depth = (agent.depth ?? 0) + 1
      const limit = Number.isFinite(state.depthLimit) ? state.depthLimit : MAX_DEPTH
      if (depth > limit) break
      const existing = state.agents.get(activity.child)
      if (existing && (existing.status === 'working' || existing.parent !== agent.key || existing.depth !== depth)) break
      const child = makeAgent(activity.child, activity.name || activity.child, agent.key, depth, activity.runId ?? null)
      child.status = 'working'
      child.label = activity.label ?? ''
      state.agents.set(child.key, child)
      break
    }
    case 'agent.end':
      finish(agent, activity)
      break
    case 'run.queued':
      agent.status = 'queued'
      say(agent, 'queued', 'dim')
      break
    case 'run.start':
      agent.status = 'working'
      agent.runId = activity.runId
      agent.runs += 1
      agent.error = null
      agent.runWrites.clear()
      agent.calls.clear()
      say(agent, `run ${String(activity.runId).slice(0, 4)} started`, 'dim')
      break
    case 'tool.start':
      agent.status = 'working'
      agent.label = activity.label
      agent.calls.delete(activity.id)
      agent.calls.set(activity.id, activity.touches)
      if (agent.calls.size > CALL_LIMIT) agent.calls.delete(agent.calls.keys().next().value)
      say(agent, activity.label)
      activity.touches.forEach((touch) => applyTouch(state, agent, touch))
      if (activity.touches.length > 0) {
        agent.focus = activity.touches.map((touch) => touch.path)
        remember(state, agent.focus, activity.time)
      }
      break
    case 'tool.end':
      if (!activity.ok) {
        const label = activity.label ?? agent.label
        if (activity.label) agent.label = activity.label
        if (activity.error) agent.error = activity.error
        say(agent, label ? `failed ${label}` : 'failed', 'error')
        for (const touch of agent.calls.get(activity.id) ?? []) {
          const file = touch.kind === 'file' ? state.files.get(touch.path) : null
          if (file) file.failed = true
        }
      }
      break
    case 'error':
      agent.status = 'error'
      agent.error = activity.text
      say(agent, activity.text, 'error')
      break
    case 'run.end':
      if (agent.runId !== null && activity.runId !== agent.runId) {
        for (const child of state.agents.values()) {
          if (child.status === 'working' && child.runId === activity.runId && isDescendant(state, child, agent.key)) finish(child, activity)
        }
        break
      }
      agent.endedAt = activity.time
      agent.calls.clear()
      agent.focus = []
      if (activity.ok) {
        agent.status = 'done'
        agent.label = 'done'
        for (const path of agent.runWrites) {
          const file = state.files.get(path)
          if (file) file.yellow = true
        }
        say(agent, 'DONE', 'done')
      } else {
        agent.status = 'error'
        agent.error = activity.error
        say(agent, `FAILED ${activity.error ?? ''}`.trim(), 'error')
      }
      agent.runWrites.clear()
      for (const child of state.agents.values()) {
        if (child.status === 'working' && isDescendant(state, child, agent.key)) finish(child, activity)
      }
      break
    default:
      break
  }
}
