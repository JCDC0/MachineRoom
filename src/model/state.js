import { ancestors, dirname } from './paths.js'

const LINE_LIMIT = 80

export function createState(tree, agents) {
  const files = new Map()
  for (const path of tree.files) {
    files.set(path, { path, exists: !tree.created.includes(path), reads: 0, writes: 0, failed: false, yellow: false })
  }
  const dirs = new Map()
  for (const path of tree.dirs) dirs.set(path, { path, opened: false })
  const roster = new Map()
  for (const agent of agents) {
    roster.set(agent.key, {
      key: agent.key,
      name: agent.name,
      status: 'idle',
      runId: null,
      label: '',
      target: '',
      endedAt: 0,
      error: null,
      lines: [],
      version: 0,
      runs: 0,
      calls: new Map(),
      runWrites: new Set(),
    })
  }
  return { files, dirs, agents: roster, now: 0 }
}

function say(agent, text, tone = 'normal') {
  agent.lines.push({ text, tone })
  if (agent.lines.length > LINE_LIMIT) agent.lines.shift()
  agent.version += 1
}

function ensureFile(state, path) {
  let file = state.files.get(path)
  if (!file) {
    file = { path, exists: false, reads: 0, writes: 0, failed: false, yellow: false }
    state.files.set(path, file)
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
    file.exists = true
    file.failed = false
    agent.runWrites.add(touch.path)
  }
}

export function apply(state, activity) {
  const agent = state.agents.get(activity.agent)
  if (!agent) return
  switch (activity.type) {
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
      agent.calls.set(activity.id, activity.touches)
      say(agent, activity.label)
      activity.touches.forEach((touch) => applyTouch(state, agent, touch))
      break
    case 'tool.end':
      if (!activity.ok) {
        say(agent, 'failed', 'error')
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
      agent.endedAt = activity.time
      agent.calls.clear()
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
      break
    default:
      break
  }
}
