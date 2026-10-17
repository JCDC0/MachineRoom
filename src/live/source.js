import { basename } from '../model/paths.js'
import { AGENT_ORDER } from '../model/pipeline.js'

const BACKOFF_START = 1000
const BACKOFF_LIMIT = 15000

const PARSERS = {
  claude_local: 'claude',
  hermes_local: 'hermes',
  opencode_local: 'opencode',
}

function slug(text) {
  return String(text).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'agent'
}

export function parserFor(raw) {
  if (PARSERS[raw.adapterType]) return PARSERS[raw.adapterType]
  if (raw.adapterType === 'process' && /agy/i.test(raw.name)) return 'agy'
  return null
}

export function toAgents(rawAgents) {
  const taken = new Set()
  const agents = rawAgents.map((raw) => {
    const parser = parserFor(raw)
    let key = slug(raw.name)
    for (let n = 2; taken.has(key); n += 1) key = `${slug(raw.name)}-${n}`
    taken.add(key)
    return { id: raw.id, key, name: raw.name, adapterType: raw.adapterType, parser }
  })
  const rank = (agent) => {
    const index = AGENT_ORDER.indexOf(agent.parser)
    return index === -1 ? AGENT_ORDER.length : index
  }
  return agents.sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name))
}

export function rootNameOf(rawAgents, override) {
  if (override) return override
  const folders = rawAgents.map((raw) => raw.adapterConfig?.cwd).filter(Boolean)
  return folders.length > 0 ? basename(folders[0]) : 'project'
}

async function getJson(fetchImpl, url) {
  const response = await fetchImpl(url)
  if (!response.ok) throw new Error(`${url} answered ${response.status}`)
  return response.json()
}

export async function discover({ base, companyId, root, fetchImpl = fetch }) {
  let id = companyId
  if (!id) {
    const companies = await getJson(fetchImpl, `${base}/api/companies`)
    if (companies.length === 0) throw new Error('Paperclip has no company yet')
    id = companies[0].id
  }
  const raw = await getJson(fetchImpl, `${base}/api/companies/${id}/agents`)
  return { companyId: id, agents: toAgents(raw), rootName: rootNameOf(raw, root) }
}

export async function loadTree(url, fetchImpl = fetch) {
  const data = await getJson(fetchImpl, `${url}/api/tree`)
  return { root: data.root, files: data.files }
}

export function socketUrl(base, companyId) {
  const origin = base.startsWith('http') ? base : `${location.origin}${base}`
  return `${origin.replace(/^http/, 'ws')}/api/companies/${companyId}/events/ws`
}

export function openStream({ url, onFrame, onStatus, WebSocketImpl = WebSocket, setTimer = setTimeout, clearTimer = clearTimeout }) {
  let socket = null
  let delay = BACKOFF_START
  let timer = null
  let closed = false

  function connect() {
    onStatus('connecting')
    socket = new WebSocketImpl(url)
    socket.onopen = () => {
      delay = BACKOFF_START
      onStatus('live')
    }
    socket.onmessage = (event) => {
      try {
        onFrame(JSON.parse(event.data))
      } catch {
        return
      }
    }
    socket.onclose = () => {
      if (closed) return
      onStatus('reconnecting')
      timer = setTimer(connect, delay)
      delay = Math.min(delay * 2, BACKOFF_LIMIT)
    }
    socket.onerror = () => socket.close()
  }

  connect()

  return {
    close() {
      closed = true
      clearTimer(timer)
      socket?.close()
    },
  }
}
