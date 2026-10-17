import { useCallback, useEffect, useState } from 'react'
import { discoverBridge, probeLive } from './live/bridge.js'
import { loadDemo } from './live/simulated.js'
import { discover, loadTree } from './live/source.js'
import { makeTree } from './model/paths.js'
import { loadReplay } from './model/replay.js'
import Stage from './Stage.jsx'
import Notice from './ui/Notice.jsx'

const PROXY_BASE = '/paperclip'

async function loadSimulated(params) {
  const demo = await loadDemo()
  const tree = makeTree({ root: params.get('root') ?? demo.rootName, files: [], created: [] })
  const speed = Number(params.get('speed')) || 1
  return { agents: demo.agents, tree, activities: [], live: { simulated: true, frames: demo.frames, speed } }
}

async function loadBridge(params, url) {
  const found = await discoverBridge({ url, root: params.get('root') })
  const tree = makeTree({ root: found.rootName, files: found.files, created: [] })
  return { agents: found.agents, tree, activities: [], live: { bridge: url } }
}

async function loadLive(params) {
  if (params.has('simulate')) return loadSimulated(params)
  const bridge = params.get('bridge')
  if (bridge) return loadBridge(params, bridge)
  const base = params.get('paperclip') ?? PROXY_BASE
  const found = await discover({ base, companyId: params.get('company'), root: params.get('root') })
  const treeUrl = params.get('tree')
  const listed = treeUrl ? await loadTree(treeUrl) : { files: [] }
  const tree = makeTree({ root: found.rootName, files: listed.files, created: [] })
  return { agents: found.agents, tree, activities: [], live: { base, companyId: found.companyId } }
}

function modeFromUrl() {
  return new URLSearchParams(window.location.search).has('live') ? 'live' : 'replay'
}

export default function App() {
  const [mode, setMode] = useState(modeFromUrl)
  const [source, setSource] = useState({ status: 'loading' })
  const [liveAvailable, setLiveAvailable] = useState(false)

  useEffect(() => {
    let current = true
    const params = new URLSearchParams(window.location.search)
    const wanted = mode === 'live' ? loadLive(params) : loadReplay()
    wanted
      .then((data) => {
        if (current) setSource({ status: data.live || data.activities.length > 0 ? 'ready' : 'empty', data })
      })
      .catch((error) => {
        if (current) setSource({ status: 'error', message: error.message })
      })
    return () => {
      current = false
    }
  }, [mode])

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    if (params.has('simulate')) {
      setLiveAvailable(true)
      return undefined
    }
    let current = true
    probeLive({ base: params.get('paperclip') ?? PROXY_BASE, bridge: params.get('bridge') }).then((found) => {
      if (current) setLiveAvailable(found)
    })
    return () => {
      current = false
    }
  }, [])

  const switchMode = useCallback(
    (next) => {
      if (next === mode) return
      const params = new URLSearchParams(window.location.search)
      if (next === 'live') params.set('live', '')
      else params.delete('live')
      const query = params.toString().replace(/\blive=(?=&|$)/, 'live')
      window.history.replaceState(null, '', `${window.location.pathname}${query ? `?${query}` : ''}`)
      setSource({ status: 'loading' })
      setMode(next)
    },
    [mode]
  )

  if (source.status === 'ready') return <Stage data={source.data} mode={mode} liveAvailable={liveAvailable} onMode={switchMode} />
  const failedLive = source.status === 'error' && mode === 'live'
  return (
    <Notice status={source.status} message={source.message} title={failedLive ? 'Live mode failed to connect' : undefined}>
      {failedLive && (
        <button type="button" onClick={() => switchMode('replay')}>
          Open the replay
        </button>
      )}
    </Notice>
  )
}
