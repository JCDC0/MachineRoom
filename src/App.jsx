import { useCallback, useEffect, useRef, useState } from 'react'
import { discoverBridge, probeLive } from './live/bridge.js'
import { loadDemo, simulatedSpeed } from './live/simulated.js'
import { makeTree } from './model/paths.js'
import { loadReplay, recordedReplay, recordedReplayRequested } from './model/replay.js'
import { createScaleReplay } from './model/scaleTree.js'
import { createSessionRecorder } from './model/sessionRecorder.js'
import { chooseRoute, fpsEnabled, recordingName, scaleSize } from './startup.js'
import { store } from './storage.js'
import Stage from './Stage.jsx'
import Connect from './ui/Connect.jsx'
import Notice from './ui/Notice.jsx'
import { loadSettings, saveSettings, savedSource } from './ui/settings.js'


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
  if (!connection.bridge) throw new Error('No bridge address is saved.')
  return loadBridge(params, connection.bridge)
}

function loadRecorded(recorder, source) {
  recorder.setMinutes(loadSettings(store()).recordMinutes)
  return recordedReplay(recorder, source)
}

function hasSaved() {
  try {
    return savedSource(store()) !== null
  } catch {
    return false
  }
}

function startRoute() {
  const params = new URLSearchParams(window.location.search)
  return chooseRoute(params, loadSettings(store()), hasSaved(), window.location.origin)
}

function describeFailure(error, connection) {
  const where = connection.bridge || 'the bridge'
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
  const [pageBridge, setPageBridge] = useState(null)
  const [recorder] = useState(() => createSessionRecorder({ minutes: loadSettings(store()).recordMinutes }))
  const liveSourceRef = useRef(null)

  useEffect(() => {
    if (route.mode !== 'connect') return undefined
    let current = true
    const origin = window.location.origin
    probeLive({ bridge: origin }).then((ok) => {
      if (current && ok) setPageBridge(origin)
    })
    return () => {
      current = false
    }
  }, [route.mode])

  useEffect(() => {
    if (route.mode === 'connect') return undefined
    let current = true
    setSource({ status: 'loading' })
    const params = new URLSearchParams(window.location.search)
    const scale = route.mode === 'replay' ? scaleSize(params) : null
    const recorded = route.mode === 'replay' && recordedReplayRequested(params)
    const wanted = route.mode === 'live'
      ? loadLive(route.connection, params)
      : scale !== null
        ? Promise.resolve(createScaleReplay(scale))
        : recorded
          ? Promise.resolve(loadRecorded(recorder, liveSourceRef.current))
          : loadReplay({ recording: recordingName(params), fixture: params.get('fixture') })
    wanted
      .then((data) => {
        if (!current) return
        if (!data) {
          setSource({ status: 'empty' })
          return
        }
        if (route.mode === 'live') liveSourceRef.current = { agents: data.agents, tree: data.tree }
        setSource({ status: data.live || data.activities.length > 0 ? 'ready' : 'empty', data })
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
    if (!connection.bridge) {
      setLiveAvailable(false)
      return undefined
    }
    let current = true
    probeLive({ bridge: connection.bridge }).then((viaBridge) => {
      if (current) setLiveAvailable(viaBridge)
    })
    return () => {
      current = false
    }
  }, [route.connection, route.notice])

  const connect = useCallback((settings) => {
    saveSettings(store(), { source: 'bridge', bridge: settings.bridge })
    setConnectError(null)
    setRoute((previous) => ({ mode: 'live', connection: { ...previous.connection, source: 'bridge', bridge: settings.bridge } }))
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
    const { source: choice, bridge } = route.connection
    return (
      <Connect
        initial={{ source: choice, bridge: pageBridge ?? bridge }}
        error={connectError}
        onSubmit={connect}
        onDemo={demo}
        onReplay={replay}
      />
    )
  }

  if (source.status === 'ready') {
    const fps = fpsEnabled(new URLSearchParams(window.location.search))
    return <Stage data={source.data} mode={route.mode} liveAvailable={liveAvailable} onMode={switchMode} fps={fps} recorder={recorder} />
  }
  const failed = source.status === 'error'
  return <Notice status={source.status} message={source.message} onRetry={failed ? () => setAttempt((count) => count + 1) : undefined} />
}
