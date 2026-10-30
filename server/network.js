import { connect } from 'node:net'

export const NETWORK_HOST = '1.1.1.1'
export const NETWORK_PORT = 443
export const NETWORK_TIMEOUT_MS = 3000
export const NETWORK_INTERVAL_MS = 30000
export const NETWORK_ACTIVE_MS = 120000

export function defaultConnector({ host = NETWORK_HOST, port = NETWORK_PORT, timeoutMs = NETWORK_TIMEOUT_MS } = {}) {
  return new Promise((resolveConnect) => {
    let settled = false
    let socket
    const finish = (online) => {
      if (settled) return
      settled = true
      try {
        socket?.destroy()
      } catch {}
      resolveConnect(online)
    }
    try {
      socket = connect({ host, port })
    } catch {
      finish(false)
      return
    }
    socket.setTimeout(timeoutMs, () => finish(false))
    socket.once('connect', () => finish(true))
    socket.once('error', () => finish(false))
  })
}

export function createNetworkMonitor({
  connector = defaultConnector,
  now = Date.now,
  intervalMs = NETWORK_INTERVAL_MS,
  activeMs = NETWORK_ACTIVE_MS,
  timeoutMs = NETWORK_TIMEOUT_MS,
  onNotice = null,
  setIntervalImpl = setInterval,
  clearIntervalImpl = clearInterval,
} = {}) {
  let online = null
  let checkedAt = null
  let checkedAtMs = 0
  let askedAtMs = 0
  let inflight = null
  let timer = null
  let stopped = false

  function status() {
    return { online: online === true, checkedAt }
  }

  function stopTimer() {
    if (timer === null) return
    try {
      clearIntervalImpl(timer)
    } catch {}
    timer = null
  }

  function startTimer() {
    if (timer !== null || stopped) return
    timer = setIntervalImpl(() => tick(), intervalMs)
    timer?.unref?.()
  }

  function tick() {
    if (stopped) return
    if (now() - askedAtMs > activeMs) {
      stopTimer()
      return
    }
    if (inflight || now() - checkedAtMs < intervalMs) return
    check().catch(() => {})
  }

  async function check() {
    if (inflight) return inflight
    const startedAt = now()
    checkedAtMs = startedAt
    inflight = (async () => {
      let connected = false
      try {
        connected = await connector({ host: NETWORK_HOST, port: NETWORK_PORT, timeoutMs })
      } catch {
        connected = false
      }
      const before = online
      online = connected === true
      checkedAt = new Date(startedAt).toISOString()
      if (!stopped && before !== null && before !== online) {
        onNotice?.({ topic: 'network' })
      }
      return status()
    })()
    try {
      return await inflight
    } finally {
      inflight = null
    }
  }

  async function ask() {
    if (stopped) return status()
    askedAtMs = now()
    startTimer()
    if (checkedAt === null || now() - checkedAtMs >= intervalMs) {
      return check()
    }
    return status()
  }

  function stop() {
    stopped = true
    stopTimer()
  }

  return { ask, check, tick, status, stop }
}

export function createNetworkApi({
  sendJson,
  connector,
  now,
  intervalMs,
  activeMs,
  timeoutMs,
  onNotice,
  setIntervalImpl,
  clearIntervalImpl,
} = {}) {
  const monitor = createNetworkMonitor({
    connector,
    now,
    intervalMs,
    activeMs,
    timeoutMs,
    onNotice,
    setIntervalImpl,
    clearIntervalImpl,
  })

  async function handle(req, res, url) {
    if (url.pathname !== '/api/network') return false
    if ((req.method ?? 'GET') !== 'GET') {
      sendJson(req, res, 405, { error: 'Method not allowed.' })
      return true
    }
    const answer = await monitor.ask()
    sendJson(req, res, 200, answer)
    return true
  }

  return { handle, stop: monitor.stop, monitor }
}
