import { toAgents } from './source.js'
import { FOLDER_SHAPE, FOLDER_SHAPE_ACCEPT, readFileList, readTreeVersion, rememberTreeVersion, treeVersionFor } from './tree.js'

const treeStarts = new Map()

function readTreeStart(data) {
  return typeof data?.start === 'string' && data.start !== '' ? data.start : null
}

function rememberTreeStart(url, start) {
  if (start === null) treeStarts.delete(url)
  else treeStarts.set(url, start)
}

function treeStartFor(url) {
  return treeStarts.get(url) ?? null
}

async function getJson(fetchImpl, url, init) {
  const response = await fetchImpl(url, init)
  if (!response.ok) throw new Error(`${url} answered ${response.status}`)
  return response.json()
}

export async function discoverBridge({ url, root, fetchImpl = fetch }) {
  const [agents, raw] = await Promise.all([
    getJson(fetchImpl, `${url}/api/agents`),
    getJson(fetchImpl, `${url}/api/tree`, { headers: { Accept: FOLDER_SHAPE_ACCEPT } }),
  ])
  const tree = readFileList(raw)
  if (tree.error) throw new Error(tree.error)
  const version = readTreeVersion(raw)
  rememberTreeVersion(url, version)
  rememberTreeStart(url, readTreeStart(raw))
  return { agents: toAgents(agents), rootName: root ?? tree.root, files: tree.files, version }
}

export const REOPEN_START = 1000
export const REOPEN_LIMIT = 15000

export function openBridge({ url, since, onFrame, onTree, onStatus, EventSourceImpl = EventSource, setTimer = setTimeout, clearTimer = clearTimeout }) {
  let source = null
  let timer = null
  let delay = REOPEN_START
  let closed = false
  let lastId = null
  let cursor = Number.isInteger(since) && since >= 0 ? since : null

  function streamUrl() {
    const start = lastId === null ? 'history=1' : `after=${encodeURIComponent(lastId)}`
    const version = cursor ?? treeVersionFor(url)
    const bridgeStart = treeStartFor(url)
    const since = version === undefined ? '' : bridgeStart === null ? `&since=${version}` : `&since=${bridgeStart}:${version}`
    return `${url}/events?${start}&tree=${FOLDER_SHAPE}${since}`
  }

  function open() {
    timer = null
    onStatus('connecting')
    const current = new EventSourceImpl(streamUrl())
    source = current
    current.onopen = () => {
      delay = REOPEN_START
      onStatus('live')
    }
    current.onerror = () => {
      if (current.readyState !== 2) {
        onStatus('reconnecting')
        return
      }
      onStatus('disconnected')
      if (closed || timer !== null || source !== current) return
      timer = setTimer(open, delay)
      delay = Math.min(delay * 2, REOPEN_LIMIT)
    }
    current.addEventListener('frame', (event) => {
      let frame
      try {
        frame = JSON.parse(event.data)
      } catch {
        return
      }
      const id = typeof event.lastEventId === 'string' && event.lastEventId !== '' ? event.lastEventId : frame?.id
      if (typeof id === 'string' || typeof id === 'number') lastId = String(id)
      onFrame(frame)
    })
    current.addEventListener('tree', (event) => {
      let data
      try {
        data = JSON.parse(event.data)
      } catch {
        return
      }
      const tree = readFileList(data)
      if (tree.error) return
      const start = readTreeStart(data)
      if (start !== null) rememberTreeStart(url, start)
      if (Number.isInteger(tree.version)) {
        cursor = cursor === null || tree.full ? tree.version : Math.max(cursor, tree.version)
        rememberTreeVersion(url, cursor)
      }
      onTree(tree)
    })
  }

  open()

  return {
    close() {
      closed = true
      if (timer !== null) clearTimer(timer)
      timer = null
      source?.close()
    },
  }
}

export async function probeLive({ bridge, fetchImpl = fetch, timeoutMs = 1500 }) {
  if (!bridge) return false
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    await getJson(fetchImpl, `${bridge}/api/health`, { signal: controller.signal })
    return true
  } catch {
    return false
  } finally {
    clearTimeout(timer)
  }
}
