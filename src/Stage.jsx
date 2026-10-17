import { useEffect, useMemo, useRef, useState } from 'react'
import { createRoom } from './engine/room.js'
import { createIncrementalPipeline } from './live/incremental.js'
import { createLivePlayer } from './live/livePlayer.js'
import { openStream, socketUrl } from './live/source.js'
import { createPlayer } from './model/player.js'
import Hud from './ui/Hud.jsx'

const SPEEDS = [1, 2, 4, 8]
const BADGE = {
  position: 'fixed',
  top: 112,
  right: 24,
  zIndex: 5,
  padding: '2px 8px',
  fontFamily: 'var(--mono)',
  fontSize: 12,
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  border: '1px solid currentColor',
  background: 'rgb(0 0 0 / 0.7)',
}

export default function Stage({ data }) {
  const surfaceRef = useRef(null)
  const glRef = useRef(null)
  const cssRef = useRef(null)
  const roomRef = useRef(null)
  const live = data.live ?? null
  const player = useMemo(() => {
    const handlers = {
      tree: data.tree,
      agents: data.agents,
      onActivity: (activity, state) => roomRef.current?.onActivity(activity, state),
    }
    if (live) return createLivePlayer(handlers)
    return createPlayer({ ...handlers, activities: data.activities, onReset: (state) => roomRef.current?.reset(state) })
  }, [data, live])
  const [snapshot, setSnapshot] = useState(() => player.snapshot())
  const [focused, setFocused] = useState(null)

  useEffect(() => {
    const room = createRoom({
      surface: surfaceRef.current,
      gl: glRef.current,
      css: cssRef.current,
      rootName: data.tree.rootName,
      agents: data.agents,
      getState: () => player.state,
      beforeFrame: (ms) => player.tick(ms),
      onPick: (key) => {
        room.focus(key)
        setFocused(key)
      },
    })
    roomRef.current = room
    player.play()
    const timer = setInterval(() => setSnapshot(player.snapshot()), 120)
    const unsubscribe = player.subscribe(() => setSnapshot(player.snapshot()))
    return () => {
      clearInterval(timer)
      unsubscribe()
      room.dispose()
      roomRef.current = null
    }
  }, [data, player])

  useEffect(() => {
    if (!live) return undefined
    const pipeline = createIncrementalPipeline({ agents: data.agents, tree: data.tree })
    let known = player.state.files.size
    const link = openStream({
      url: socketUrl(live.base, live.companyId),
      onStatus: (status) => player.setStatus(status),
      onFrame: (frame) => {
        player.push(pipeline.push(frame))
        if (player.state.files.size !== known) {
          known = player.state.files.size
          pipeline.learn([...player.state.files.keys()])
        }
      },
    })
    return () => link.close()
  }, [data, live, player])

  useEffect(() => {
    function onKey(event) {
      if (event.target.closest('input, textarea')) return
      const room = roomRef.current
      if (event.code === 'Space') {
        event.preventDefault()
        player.toggle()
      } else if (event.key === '0') {
        room?.overview()
        setFocused(null)
      } else if (/^[1-9]$/.test(event.key)) {
        const agent = data.agents[Number(event.key) - 1]
        if (agent) {
          room?.focus(agent.key)
          setFocused(agent.key)
        }
      } else if (event.key === 'ArrowRight') {
        player.seek(player.position + 5000)
      } else if (event.key === 'ArrowLeft') {
        player.seek(player.position - 5000)
      } else if (event.key === ']') {
        const index = SPEEDS.indexOf(player.speed)
        player.setSpeed(SPEEDS[Math.min(SPEEDS.length - 1, index + 1)])
      } else if (event.key === '[') {
        const index = SPEEDS.indexOf(player.speed)
        player.setSpeed(SPEEDS[Math.max(0, index - 1)])
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [data, player])

  function focus(key) {
    roomRef.current?.focus(key)
    setFocused(key)
  }

  function overview() {
    roomRef.current?.overview()
    setFocused(null)
  }

  return (
    <div className="surface" ref={surfaceRef}>
      <div className="layer" ref={glRef} aria-hidden="true" />
      <div className="layer" ref={cssRef} aria-hidden="true" />
      {live && (
        <div style={{ ...BADGE, color: snapshot.status === 'live' ? 'var(--yellow)' : 'var(--red)' }} role="status">
          Live // {snapshot.status === 'live' ? 'connected' : snapshot.status}
        </div>
      )}
      <Hud
        snapshot={snapshot}
        focused={focused}
        speeds={SPEEDS}
        rootName={data.tree.rootName}
        mode={live ? 'live' : 'replay'}
        onToggle={() => player.toggle()}
        onSeek={(value) => player.seek(value)}
        onSpeed={(value) => player.setSpeed(value)}
        onFocus={focus}
        onOverview={overview}
      />
    </div>
  )
}
