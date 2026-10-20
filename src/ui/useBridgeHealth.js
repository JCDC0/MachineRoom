import { useEffect, useState } from 'react'

export async function fetchBridgeHealth(bridge, fetchImpl = fetch) {
  if (!bridge || typeof bridge !== 'string' || bridge.trim() === '') {
    return null
  }
  const base = bridge.replace(/\/+$/, '')
  const url = `${base}/api/health`
  try {
    const res = await fetchImpl(url)
    if (!res || !res.ok) {
      return { error: true }
    }
    return await res.json()
  } catch {
    return { error: true }
  }
}

export function useBridgeHealth(bridge, { everyMs = 60000, fetchImpl = fetch } = {}) {
  const [health, setHealth] = useState(null)

  useEffect(() => {
    if (!bridge || typeof bridge !== 'string' || bridge.trim() === '') {
      setHealth(null)
      return undefined
    }

    let cancelled = false

    async function check() {
      const data = await fetchBridgeHealth(bridge, fetchImpl)
      if (!cancelled && data !== null) {
        setHealth(data)
      }
    }

    check()
    const timer = setInterval(check, everyMs)

    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [bridge, everyMs, fetchImpl])

  if (!bridge || typeof bridge !== 'string' || bridge.trim() === '') {
    return null
  }

  return health
}

export default useBridgeHealth
