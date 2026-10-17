import { useEffect, useState } from 'react'
import { loadReplay } from './model/replay.js'
import Stage from './Stage.jsx'
import Notice from './ui/Notice.jsx'

export default function App() {
  const [source, setSource] = useState({ status: 'loading' })

  useEffect(() => {
    let live = true
    loadReplay()
      .then((data) => {
        if (live) setSource({ status: data.activities.length > 0 ? 'ready' : 'empty', data })
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
