import { createSplitMasker } from '../briefs/audit.js'
import { AGENT_ORDER } from '../model/pipeline.js'
import { FOLDER_SHAPE_ACCEPT, readFileList, readTreeVersion, rememberTreeVersion } from './tree.js'

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
  if (Object.hasOwn(PARSERS, raw.adapterType)) return PARSERS[raw.adapterType]
  if (raw.adapterType === 'process' && /agy/i.test(raw.name)) return 'agy'
  return null
}

export function toAgents(rawAgents) {
  const taken = new Set()
  const agents = rawAgents.map((raw) => {
    const parser = parserFor(raw)
    const role = typeof raw?.role === 'string' && raw.role !== '' ? raw.role : null
    let key = Object.hasOwn(PARSERS, raw.adapterType) ? PARSERS[raw.adapterType] : slug(raw.name)
    if (taken.has(key)) {
      key = slug(raw.name)
      for (let n = 2; taken.has(key); n += 1) key = `${slug(raw.name)}-${n}`
    }
    taken.add(key)
    return { id: raw.id, key, name: raw.name, adapterType: raw.adapterType, role, parser }
  })
  const rank = (agent) => {
    const index = AGENT_ORDER.indexOf(agent.parser)
    return index === -1 ? AGENT_ORDER.length : index
  }
  return agents.sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name))
}

async function getJson(fetchImpl, url, init) {
  const response = await fetchImpl(url, init)
  if (!response.ok) throw new Error(`${url} answered ${response.status}`)
  return response.json()
}

export async function loadTree(url, fetchImpl = fetch) {
  const raw = await getJson(fetchImpl, `${url}/api/tree`, { headers: { Accept: FOLDER_SHAPE_ACCEPT } })
  const list = readFileList(raw)
  if (list.error) throw new Error(list.error)
  const version = readTreeVersion(raw)
  rememberTreeVersion(url, version)
  return version === null ? list : { ...list, version }
}

export function socketUrl(base, companyId) {
  const origin = base.startsWith('http') ? base : `${location.origin}${base}`
  return `${origin.replace(/^http/, 'ws')}/api/companies/${encodeURIComponent(companyId)}/events/ws`
}

export function openStream({ url, onFrame, onStatus, WebSocketImpl = WebSocket, setTimer = setTimeout, clearTimer = clearTimeout, now = Date.now }) {
  let socket = null
  let delay = BACKOFF_START
  let timer = null
  let maskTimer = null
  let closed = false
  const masker = createSplitMasker()

  function release(out) {
    for (const frame of out.frames) onFrame(frame)
    if (maskTimer !== null) {
      clearTimer(maskTimer)
      maskTimer = null
    }
    if (closed) return
    const at = masker.nextDue()
    if (at === null) return
    maskTimer = setTimer(() => {
      maskTimer = null
      if (!closed) release(masker.due(now()))
    }, Math.max(0, at - now()))
  }

  function connect() {
    onStatus('connecting')
    socket = new WebSocketImpl(url)
    socket.onopen = () => {
      delay = BACKOFF_START
      onStatus('live')
    }
    socket.onmessage = (event) => {
      try {
        release(masker.push(JSON.parse(event.data), now()))
      } catch {
        return
      }
    }
    socket.onclose = () => {
      if (closed) return
      try {
        release(masker.reset())
      } catch {}
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
      clearTimer(maskTimer)
      maskTimer = null
      socket?.close()
    },
  }
}
