import { toAgents } from './source.js'
import { FOLDER_SHAPE_ACCEPT, readFileList } from './tree.js'

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
  return { agents: toAgents(agents), rootName: root ?? tree.root, files: tree.files }
}

export const REOPEN_START = 1000
export const REOPEN_LIMIT = 15000

export function openBridge({ url, onFrame, onTree, onStatus, EventSourceImpl = EventSource, setTimer = setTimeout, clearTimer = clearTimeout }) {
  let source = null
  let timer = null
  let delay = REOPEN_START
  let closed = false

  function open() {
    timer = null
    onStatus('connecting')
    const current = new EventSourceImpl(`${url}/events?history=1`)
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
      try {
        onFrame(JSON.parse(event.data))
      } catch {
        return
      }
    })
    current.addEventListener('tree', (event) => {
      let tree
      try {
        tree = readFileList(JSON.parse(event.data))
      } catch {
        return
      }
      if (!tree.error) onTree(tree)
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

export async function probeLive({ base, bridge, fetchImpl = fetch, timeoutMs = 1500 }) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const url = bridge ? `${bridge}/api/health` : `${base}/api/companies`
    await getJson(fetchImpl, url, { signal: controller.signal })
    return true
  } catch {
    return false
  } finally {
    clearTimeout(timer)
  }
}
