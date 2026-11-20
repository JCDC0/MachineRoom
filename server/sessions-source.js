import { SESSION_HARNESSES } from './harnesses/index.js'
import { runsFolder as defaultRunsFolder } from './lanes-source.js'

const DEFAULT_POLL_MS = 1000

export function createSessionsSource(options = {}) {
  const projectRoot = options.projectRoot
  const runsFolder = options.runsFolder ?? defaultRunsFolder()
  const now = options.now ?? Date.now
  const onFrame = options.onFrame ?? (() => {})
  const pollMs = Number(options.pollMs ?? DEFAULT_POLL_MS)
  const makers =
    Array.isArray(options.readers) && options.readers.length > 0
      ? options.readers
      : SESSION_HARNESSES.map((harness) => harness.createSessionsReader)
  const shared = { projectRoot, runsFolder, now, emit: onFrame }
  if (options.home !== undefined) shared.home = options.home
  if (options.quietMs !== undefined) shared.quietMs = options.quietMs
  const readers = makers
    .map((make) => (typeof make === 'function' ? make({ ...shared }) : make))
    .filter(Boolean)
  const agents = readers.flatMap((reader) => (Array.isArray(reader.agents) ? reader.agents : reader.agent ? [reader.agent] : []))
  let timer = null
  let ticking = false
  let stopped = false

  function tick() {
    if (stopped || ticking) return
    ticking = true
    try {
      for (const reader of readers) {
        try {
          reader.tick()
        } catch {}
      }
    } finally {
      ticking = false
    }
  }

  function start() {
    if (stopped || timer) return
    tick()
    timer = setInterval(tick, pollMs)
  }

  function stop() {
    stopped = true
    if (timer) {
      clearInterval(timer)
      timer = null
    }
    for (const reader of readers) {
      try {
        reader.stop?.()
      } catch {}
    }
  }

  function problems() {
    const list = []
    for (const reader of readers) {
      if (typeof reader.problem !== 'function') continue
      let message = ''
      try {
        message = String(reader.problem() ?? '')
      } catch {
        message = 'The reader failed.'
      }
      if (message) list.push({ name: reader.agent?.name ?? 'A session', message })
    }
    return list
  }

  function readerHasKey(reader, key) {
    if (!reader || typeof key !== 'string' || !key) return false
    if (reader.agent?.key === key) return true
    return Array.isArray(reader.agents) && reader.agents.some((agent) => agent?.key === key)
  }

  function sessionActive(session) {
    if (!session || session.run == null) return false
    if (typeof session.run === 'object' && session.run.open === false) return false
    return true
  }

  function readerWorking(reader) {
    if (typeof reader.open === 'function') {
      const open = reader.open()
      if (open instanceof Map && open.size > 0) return true
    }
    if (typeof reader.sessions !== 'function') return false
    const map = reader.sessions()
    if (!map || typeof map.values !== 'function') return false
    for (const session of map.values()) {
      if (sessionActive(session)) return true
    }
    return false
  }

  function sessionWorking(key) {
    if (typeof key !== 'string' || !key) return false
    for (const reader of readers) {
      if (!readerHasKey(reader, key)) continue
      try {
        if (readerWorking(reader)) return true
      } catch {}
    }
    return false
  }

  return { agents, readers, start, stop, tick, problems, sessionWorking }
}
