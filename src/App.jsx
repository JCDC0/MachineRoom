import { useCallback, useEffect, useState } from 'react'
import { discoverBridge, probeLive } from './live/bridge.js'
import { loadDemo, simulatedSpeed } from './live/simulated.js'
import { discover, loadTree } from './live/source.js'
import { makeTree } from './model/paths.js'
import { loadReplay } from './model/replay.js'
import { PROXY_BASE, chooseRoute, recordingName, treeAddress } from './startup.js'
import { store } from './storage.js'
import Stage from './Stage.jsx'
import Connect from './ui/Connect.jsx'
import Notice from './ui/Notice.jsx'
import { SETTINGS_KEY, loadSettings, saveSettings } from './ui/settings.js'


async function loadSimulated(params) {
  const demo = await loadDemo()
  const tree = makeTree({ root: params.get('root') ?? demo.rootName, files: [], created: [] })
  const speed = simulatedSpeed(params.get('speed'))
  return { agents: demo.agents, tree, activities: [], live: { simulated: true, frames: demo.frames, speed } }
}

async function loadBridge(params, url) {
  const found = await discoverBridge({ url, root: params.get('root') })
  const tree = makeTree({ root: found.rootName, files: found.files, created: [] })
  return { agents: found.agents, tree, activities: [], live: { bridge: url } }
}

async function loadLive(connection, params) {
  if (connection.source === 'demo') return loadSimulated(params)
  if (connection.source === 'bridge') return loadBridge(params, connection.bridge)
  const base = connection.paperclip || PROXY_BASE
  const found = await discover({ base, companyId: connection.company || params.get('company'), root: params.get('root') })
  const treeUrl = treeAddress(params, window.location.origin)
  const listed = treeUrl ? await loadTree(treeUrl) : { files: [] }
  const tree = makeTree({ root: found.rootName, files: listed.files, created: [] })
  return { agents: found.agents, tree, activities: [], live: { base, companyId: found.companyId } }
}

function hasSaved() {
  try {
    return store()?.getItem(SETTINGS_KEY) != null
  } catch {
    return false
  }
}

function startRoute() {
  const params = new URLSearchParams(window.location.search)
  return chooseRoute(params, loadSettings(store()), hasSaved(), window.location.origin)
}

function describeFailure(error, connection) {
  const where = connection.source === 'bridge' ? connection.bridge : connection.paperclip || PROXY_BASE
  if (error instanceof TypeError || /failed to fetch|networkerror|load failed/i.test(error.message)) {
    return `Could not reach ${where}. Check that it is running, then try again.`
  }
  return error.message
}

function syncUrl(mode) {
  const params = new URLSearchParams(window.location.search)
  if (mode === 'replay') params.set('replay', '')
  else params.delete('replay')
  params.delete('connect')
  const query = params.toString().replace(/\b(replay|live)=(?=&|$)/g, '$1')
  window.history.replaceState(null, '', `${window.location.pathname}${query ? `?${query}` : ''}`)
}

export default function App() {
  const [route, setRoute] = useState(startRoute)
  const [source, setSource] = useState({ status: 'loading' })
  const [connectError, setConnectError] = useState(() => route.notice ?? null)
  const [attempt, setAttempt] = useState(0)
  const [liveAvailable, setLiveAvailable] = useState(false)

  useEffect(() => {
    if (route.mode === 'connect') return undefined
    let current = true
    setSource({ status: 'loading' })
    const params = new URLSearchParams(window.location.search)
    const wanted = route.mode === 'live' ? loadLive(route.connection, params) : loadReplay({ recording: recordingName(params) })
    wanted
      .then((data) => {
        if (current) setSource({ status: data.live || data.activities.length > 0 ? 'ready' : 'empty', data })
      })
      .catch((error) => {
        if (!current) return
        if (route.mode === 'live') {
          setConnectError(describeFailure(error, route.connection))
          setRoute((previous) => ({ ...previous, mode: 'connect' }))
        } else {
          setSource({ status: 'error', message: error.message })
        }
      })
    return () => {
      current = false
    }
  }, [route, attempt])

  useEffect(() => {
    const { connection } = route
    if (route.notice) return undefined
    if (connection.source === 'demo') {
      setLiveAvailable(true)
      return undefined
    }
    let current = true
    Promise.all([
      probeLive({ bridge: connection.bridge }),
      probeLive({ base: connection.paperclip || PROXY_BASE }),
    ]).then(([viaBridge, viaProxy]) => {
      if (current) setLiveAvailable(viaBridge || viaProxy)
    })
    return () => {
      current = false
    }
  }, [route.connection, route.notice])

  const connect = useCallback((settings) => {
    saveSettings(store(), { source: settings.source, bridge: settings.bridge, paperclip: settings.paperclip, company: settings.company })
    setConnectError(null)
    setRoute((previous) => ({ mode: 'live', connection: { ...previous.connection, ...settings } }))
  }, [])

  const demo = useCallback(() => {
    setConnectError(null)
    setRoute((previous) => ({ mode: 'live', connection: { ...previous.connection, source: 'demo' } }))
  }, [])

  const replay = useCallback(() => {
    setConnectError(null)
    syncUrl('replay')
    setRoute((previous) => (previous.notice ? { mode: 'replay', connection: loadSettings(store()) } : { ...previous, mode: 'replay' }))
  }, [])

  const switchMode = useCallback((next) => {
    syncUrl(next)
    setConnectError(null)
    setRoute((previous) => (previous.mode === next ? previous : { ...previous, mode: next }))
  }, [])

  if (route.mode === 'connect') {
    const { source: choice, bridge, paperclip, company } = route.connection
    return (
      <Connect
        initial={{ source: choice, bridge, paperclip, company }}
        error={connectError}
        onSubmit={connect}
        onDemo={demo}
        onReplay={replay}
      />
    )
  }

  if (source.status === 'ready') return <Stage data={source.data} mode={route.mode} liveAvailable={liveAvailable} onMode={switchMode} />
  const failed = source.status === 'error'
  return <Notice status={source.status} message={source.message} onRetry={failed ? () => setAttempt((count) => count + 1) : undefined} />
}
