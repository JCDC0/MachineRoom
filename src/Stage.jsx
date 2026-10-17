import { useEffect, useMemo, useRef, useState } from 'react'
import { createRoom } from './engine/room.js'
import { createPlayer } from './model/player.js'
import Hud from './ui/Hud.jsx'

const SPEEDS = [1, 2, 4, 8]

export default function Stage({ data }) {
  const surfaceRef = useRef(null)
  const glRef = useRef(null)
  const cssRef = useRef(null)
  const roomRef = useRef(null)
  const player = useMemo(
    () =>
      createPlayer({
        activities: data.activities,
        tree: data.tree,
        agents: data.agents,
        onActivity: (activity, state) => roomRef.current?.onActivity(activity, state),
        onReset: (state) => roomRef.current?.reset(state),
      }),
    [data]
  )
  const [snapshot, setSnapshot] = useState(() => player.snapshot())
  const [focused, setFocused] = useState(null)

  useEffect(() => {
    const room = createRoom({
      surface: surfaceRef.current,
      gl: glRef.current,
      css: cssRef.current,
      tree: data.tree,
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
      <Hud
        snapshot={snapshot}
        focused={focused}
        speeds={SPEEDS}
        rootName={data.tree.rootName}
        onToggle={() => player.toggle()}
        onSeek={(value) => player.seek(value)}
        onSpeed={(value) => player.setSpeed(value)}
        onFocus={focus}
        onOverview={overview}
      />
    </div>
  )
}
