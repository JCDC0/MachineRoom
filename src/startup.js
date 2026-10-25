export const LIVE_PARAMS = ['bridge', 'simulate']

const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]'])

export function linkAddressAllowed(value, origin = '') {
  if (typeof value !== 'string' || value === '' || /[\s\\]/.test(value)) return false
  if (value.startsWith('/')) return !value.startsWith('//')
  let parsed
  try {
    parsed = new URL(value)
  } catch {
    return false
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false
  if (parsed.username || parsed.password) return false
  return LOOPBACK.has(parsed.hostname) || (origin !== '' && parsed.origin === origin)
}

export function foreignLinkNotice(address) {
  return `The link names ${address}, which is not on this computer. Check the address, then connect.`
}

export function connectionFrom(params, saved) {
  if (params.has('simulate')) return { ...saved, source: 'demo' }
  const bridge = params.get('bridge')
  if (bridge) return { ...saved, source: 'bridge', bridge }
  return saved
}

export function linkAddresses(params) {
  const out = []
  if (params.has('simulate')) return out
  if (params.get('bridge')) out.push(params.get('bridge'))
  return out
}

export const RECORDING_NAME = /^[A-Za-z0-9][\w-]*(\.[\w-]+)*$/

export function recordingName(params) {
  const name = params.get('recording')
  return name && RECORDING_NAME.test(name) ? name : null
}

export function scaleSize(params) {
  const raw = params?.get('scale') ?? ''
  if (!/^\d{4,6}$/.test(raw)) return null
  const value = Number(raw)
  return value >= 1000 && value <= 500000 ? value : null
}

export function fpsEnabled(params) {
  return Boolean(params?.has('fps'))
}

export function tourEnabled(params) {
  return Boolean(params?.has('tour'))
}

export function chooseRoute(params, saved, hasSaved, origin = '') {
  const connection = connectionFrom(params, saved)
  const foreign = linkAddresses(params).find((address) => !linkAddressAllowed(address, origin))
  if (params.has('replay') || params.has('tour') || params.has('recording') || scaleSize(params) !== null) return { mode: 'replay', connection: foreign === undefined ? connection : saved }
  if (foreign !== undefined) return { mode: 'connect', connection, notice: foreignLinkNotice(foreign) }
  if (LIVE_PARAMS.some((key) => params.has(key))) return { mode: 'live', connection }
  if (params.has('connect') || !hasSaved) return { mode: 'connect', connection }
  return { mode: 'live', connection }
}
