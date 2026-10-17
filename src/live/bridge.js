import { toAgents } from './source.js'

async function getJson(fetchImpl, url, init) {
  const response = await fetchImpl(url, init)
  if (!response.ok) throw new Error(`${url} answered ${response.status}`)
  return response.json()
}

export async function discoverBridge({ url, root, fetchImpl = fetch }) {
  const [agents, tree] = await Promise.all([getJson(fetchImpl, `${url}/api/agents`), getJson(fetchImpl, `${url}/api/tree`)])
  return { agents: toAgents(agents), rootName: root ?? tree.root, files: tree.files }
}

export function openBridge({ url, onFrame, onTree, onStatus, EventSourceImpl = EventSource }) {
  onStatus('connecting')
  const source = new EventSourceImpl(`${url}/events`)
  source.onopen = () => onStatus('live')
  source.onerror = () => onStatus(source.readyState === 2 ? 'disconnected' : 'reconnecting')
  source.addEventListener('frame', (event) => {
    try {
      onFrame(JSON.parse(event.data))
    } catch {
      return
    }
  })
  source.addEventListener('tree', (event) => {
    try {
      onTree(JSON.parse(event.data))
    } catch {
      return
    }
  })
  return { close: () => source.close() }
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
