import { basename, visibleText } from '../model/paths.js'
import { effortLabel, orchestratorEffort } from './agentStrip.js'

export const INSPECT_EVENT = 'machineroom:inspect'
export const INSPECT_KINDS = ['agent', 'folder', 'file', 'internet']
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
