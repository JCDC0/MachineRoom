import { basename, visibleText } from '../model/paths.js'
import { effortLabel, orchestratorEffort } from './agentStrip.js'

export const INSPECT_EVENT = 'machineroom:inspect'
export const INSPECT_KINDS = ['agent', 'folder', 'file', 'internet', 'git']
export const CONTEXT_NOT_REPORTED = 'context not reported'
export const TOO_LARGE = 'Too large, showing the first 256 KB.'
export const BINARY_FILE = 'Binary file.'
export const CONNECTED = 'Connected'
export const NO_CONNECTION = 'No connection'
export const CONNECTION_UNKNOWN = 'Connection not reported'

const RUNNING = new Set(['working', 'running'])
const FAILED = new Set(['error', 'failed', 'cancelled', 'timed_out', 'terminated'])
const DONE = new Set(['done', 'finished', 'succeeded', 'complete', 'completed'])

function text(value) {
  return typeof value === 'string' ? visibleText(value).trim() : ''
}

function parentOf(path) {
  const clean = String(path ?? '')
  const at = clean.lastIndexOf('/')
  return at === -1 ? '' : clean.slice(0, at)
}

export function inspectTarget(detail) {
  if (!detail || typeof detail !== 'object' || Array.isArray(detail)) return null
  const kind = text(detail.kind).toLowerCase()
  if (!INSPECT_KINDS.includes(kind)) return null
  if (kind === 'internet') return { kind, id: 'internet' }
  if (kind === 'git') return { kind, id: 'git' }
  if (typeof detail.id !== 'string') return null
  const id = visibleText(detail.id).trim()
  if (kind !== 'folder' && id === '') return null
  return { kind, id }
}

export function agentStateWord(agent = {}) {
  const status = text(agent?.status).toLowerCase()
  const openCalls = Number(agent?.openCalls ?? agent?.openToolCalls ?? 0)
  const tool = text(agent?.tool ?? agent?.toolName)
  const command = text(agent?.command ?? agent?.label)
  if (RUNNING.has(status)) {
    if (Number.isFinite(openCalls) && openCalls > 0) {
      return { word: 'working', tool, command }
    }
    return { word: 'thinking', tool: '', command: '' }
  }
  if (FAILED.has(status)) return { word: 'failed', tool: '', command }
  if (DONE.has(status)) return { word: 'done', tool: '', command }
  return { word: 'idle', tool: '', command }
}

export const EXPLORER_LIMIT = 200

export function explorerRows(path = '', tree = {}) {
  const folder = String(path ?? '')
  const dirs = Array.isArray(tree?.dirs) ? tree.dirs : []
  const files = Array.isArray(tree?.files) ? tree.files : []
  const rows = []
  const seen = new Set()
  for (const raw of dirs) {
    const child = String(raw ?? '')
    if (child === '' || child === folder || seen.has(child)) continue
    if (parentOf(child) !== folder) continue
    seen.add(child)
    rows.push({ kind: 'dir', path: child, name: basename(child) })
  }
  for (const raw of files) {
    const child = String(raw ?? '')
    if (child === '' || child === folder) continue
    if (parentOf(child) !== folder) continue
    rows.push({ kind: 'file', path: child, name: basename(child) })
  }
  rows.sort((left, right) => {
    if (left.kind !== right.kind) return left.kind === 'dir' ? -1 : 1
    return left.name.localeCompare(right.name)
  })
  return rows
}

export function explorerView(path = '', tree = {}) {
  const rows = explorerRows(path, tree)
  const total = rows.length
  return {
    rows: total > EXPLORER_LIMIT ? rows.slice(0, EXPLORER_LIMIT) : rows,
    total,
    more: total > EXPLORER_LIMIT,
  }
}

export function explorerMoreText(total) {
  return `Showing the first ${EXPLORER_LIMIT} of ${total}.`
}

export function breadcrumbRows(path = '', rootName = '') {
  const parts = String(path ?? '')
    .split('/')
    .filter(Boolean)
  const rows = [{ path: '', name: text(rootName) || 'Project' }]
  let at = ''
  for (const part of parts) {
    at = at === '' ? part : `${at}/${part}`
    rows.push({ path: at, name: part })
  }
  return rows
}

export function cutPath(path, limit = 44) {
  const clean = text(path)
  const keep = Math.max(1, Math.floor(Number(limit) || 44) - 3)
  if (clean.length <= keep + 3) return clean
  return `...${clean.slice(-keep)}`
}

export function gitGraphRows(commits = []) {
  const list = Array.isArray(commits) ? commits : []
  const lanes = []
  const rows = []
  for (const commit of list) {
    const sha = typeof commit?.sha === 'string' ? commit.sha : ''
    if (sha === '') continue
    const parents = Array.isArray(commit.parents)
      ? commit.parents.filter((parent) => typeof parent === 'string' && parent !== '')
      : []
    let lane = lanes.indexOf(sha)
    if (lane === -1) {
      lane = lanes.indexOf(null)
      if (lane === -1) {
        lane = lanes.length
        lanes.push(null)
      }
    }
    const edges = lanes[lane] === sha ? [{ kind: 'top', from: lane, to: lane }] : []
    for (let index = 0; index < lanes.length; index += 1) {
      if (index === lane) continue
      if (lanes[index] === sha) {
        edges.push({ kind: 'top', from: index, to: lane })
        lanes[index] = null
      } else if (lanes[index] !== null) {
        edges.push({ kind: 'through', from: index, to: index })
      }
    }
    const first = parents[0] ?? null
    if (first !== null) {
      const target = lanes.indexOf(first)
      if (target !== -1 && target !== lane) {
        lanes[lane] = null
        edges.push({ kind: 'bottom', from: lane, to: target })
      } else {
        lanes[lane] = first
        edges.push({ kind: 'bottom', from: lane, to: lane })
      }
    } else {
      lanes[lane] = null
    }
    for (let index = 1; index < parents.length; index += 1) {
      const parent = parents[index]
      let target = lanes.indexOf(parent)
      if (target === -1) {
        target = lanes.indexOf(null)
        if (target === -1) {
          target = lanes.length
          lanes.push(null)
        }
      }
      lanes[target] = parent
      edges.push({ kind: 'bottom', from: lane, to: target })
    }
    while (lanes.length > 0 && lanes[lanes.length - 1] === null) lanes.pop()
    let width = Math.max(lane + 1, lanes.length)
    for (const edge of edges) width = Math.max(width, edge.from + 1, edge.to + 1)
    rows.push({
      sha,
      short: sha.slice(0, 7),
      subject: typeof commit.subject === 'string' ? commit.subject : '',
      refs: Array.isArray(commit.refs) ? commit.refs.filter((ref) => typeof ref === 'string' && ref !== '') : [],
      lane,
      width,
      edges,
    })
  }
  return rows
}

export function effortForAgent({ key = '', harness = '', family = [], orchestrators = null } = {}) {
  const wanted = text(key)
  if (wanted === '') return 'default'
  const own = orchestratorEffort(orchestrators, wanted)
  if (own) return effortLabel(own, harness)
  const nodes = Array.isArray(family) ? family : []
  const node = nodes.find((row) => {
    if (!row || typeof row !== 'object') return false
    const id = text(row.id)
    if (id === '') return false
    return row.kind === 'sub' ? `sub-${id}` === wanted : id === wanted
  })
  if (!node) return 'default'
  return effortLabel(node.effort, node.harness || harness)
}

export function touchRows(touches = []) {
  const list = Array.isArray(touches) ? touches : []
  const rows = []
  for (const touch of list) {
    if (!touch || typeof touch !== 'object') continue
    const key = text(touch.key ?? touch.agent)
    const time = Number(touch.time)
    if (key === '' || !Number.isFinite(time)) continue
    const mode = text(touch.mode).toLowerCase() === 'read' ? 'read' : 'write'
    rows.push({ key, mode, time })
  }
  return rows
}

export function formatBytes(value) {
  if (value === null || value === undefined || value === '') return 'not reported'
  const size = Number(value)
  if (!Number.isFinite(size) || size < 0) return 'not reported'
  if (size < 1024) return `${Math.round(size)} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
  return `${(size / (1024 * 1024)).toFixed(1)} MB`
}

export function formatTime(value, fallback = 'not reported') {
  if (value === null || value === undefined || value === '') return fallback
  const date = new Date(value)
  const time = date.getTime()
  if (!Number.isFinite(time)) return fallback
  return date.toLocaleString('en-GB')
}

export function internetStatus(online) {
  if (online === true) return CONNECTED
  if (online === false) return NO_CONNECTION
  return CONNECTION_UNKNOWN
}

export function previewLines(info) {
  if (!info || typeof info !== 'object') return { notice: '', text: '' }
  if (info.binary === true) return { notice: BINARY_FILE, text: '' }
  const text = typeof info.text === 'string' ? info.text : ''
  return { notice: info.truncated === true ? TOO_LARGE : '', text }
}
