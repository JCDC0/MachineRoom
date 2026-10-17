export const PROXY_BASE = '/paperclip'
export const LIVE_PARAMS = ['live', 'bridge', 'simulate']

export function connectionFrom(params, saved) {
  if (params.has('simulate')) return { ...saved, source: 'demo' }
  if (params.get('bridge')) return { ...saved, source: 'bridge', bridge: params.get('bridge') }
  if (params.has('live')) {
    return { ...saved, source: 'paperclip', paperclip: params.get('paperclip') ?? PROXY_BASE, company: params.get('company') ?? '' }
  }
  return saved
}

export function chooseRoute(params, saved, hasSaved) {
  const connection = connectionFrom(params, saved)
  if (params.has('replay')) return { mode: 'replay', connection }
  if (LIVE_PARAMS.some((key) => params.has(key))) return { mode: 'live', connection }
  if (params.has('connect') || !hasSaved) return { mode: 'connect', connection }
  return { mode: 'live', connection }
}
