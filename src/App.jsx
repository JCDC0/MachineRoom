import { useEffect, useState } from 'react'
import { loadDemo } from './live/simulated.js'
import { discover, loadTree } from './live/source.js'
import { makeTree } from './model/paths.js'
import { loadReplay } from './model/replay.js'
import Stage from './Stage.jsx'
import Notice from './ui/Notice.jsx'

async function loadSimulated(params) {
  const demo = await loadDemo()
  const tree = makeTree({ root: params.get('root') ?? demo.rootName, files: [], created: [] })
  const speed = Number(params.get('speed')) || 1
  return { agents: demo.agents, tree, activities: [], live: { simulated: true, frames: demo.frames, speed } }
}

async function loadLive(params) {
  if (params.has('simulate')) return loadSimulated(params)
  const base = params.get('paperclip') ?? '/paperclip'
  const found = await discover({ base, companyId: params.get('company'), root: params.get('root') })
  const treeUrl = params.get('tree')
  const listed = treeUrl ? await loadTree(treeUrl) : { files: [] }
  const tree = makeTree({ root: found.rootName, files: listed.files, created: [] })
  return { agents: found.agents, tree, activities: [], live: { base, companyId: found.companyId } }
}

export default function App() {
  const [source, setSource] = useState({ status: 'loading' })

  useEffect(() => {
    let live = true
    const params = new URLSearchParams(window.location.search)
    const wanted = params.has('live') ? loadLive(params) : loadReplay()
    wanted
      .then((data) => {
        if (live) setSource({ status: data.live || data.activities.length > 0 ? 'ready' : 'empty', data })
      })
      .catch((error) => {
        if (live) setSource({ status: 'error', message: error.message })
      })
    return () => {
      live = false
    }
  }, [])

  if (source.status === 'ready') return <Stage data={source.data} />
  return <Notice status={source.status} message={source.message} />
}
