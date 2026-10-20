import { useEffect, useMemo, useRef, useState } from 'react'
import { createDispatcher } from './assistant/dispatch.js'
import { createClient } from './control/client.js'
import { createMockClient } from './control/mock.js'
import { createRoom } from './engine/room.js'
import { openBridge } from './live/bridge.js'
import { createLivePlayer } from './live/livePlayer.js'
import { openSimulated } from './live/simulated.js'
import { openStream, socketUrl } from './live/source.js'
import { buildTimeline, createLogger, entriesUpTo } from './model/log.js'
import { createPipeline } from './model/pipeline.js'
import { createPlayer } from './model/player.js'
import { store } from './storage.js'
import Hud from './ui/Hud.jsx'
import { loadSettings, saveSettings } from './ui/settings.js'
import Waiting from './ui/Waiting.jsx'

const SPEEDS = [1, 2, 4, 8]
const NONE = []
const LIVE_LOG_LIMIT = 200
const BADGE = {
  position: 'fixed',
  bottom: 96,
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

export default function Stage({ data, mode = 'replay', liveAvailable = false, onMode }) {
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
  const client = useMemo(() => {
    if (!live || live.simulated) return createMockClient()
    return live.bridge ? createClient({ baseUrl: live.bridge }) : null
  }, [live])
  const [snapshot, setSnapshot] = useState(() => player.snapshot())
  const [focused, setFocused] = useState(null)
  const [following, setFollowing] = useState(false)
  const [liveLog, setLiveLog] = useState(NONE)
  const followRef = useRef(false)
  const [controlTarget, setControlTarget] = useState(null)
  const [toast, setToast] = useState('')
  const targetCount = useRef(0)
  const fileCount = player.state.files.size
  const dirCount = player.state.dirs.size
  const assistantPaths = useMemo(
    () => [...new Set(['', ...player.state.dirs.keys(), ...player.state.files.keys()])],
    [player, fileCount, dirCount]
  )
  const pathsRef = useRef(assistantPaths)
  pathsRef.current = assistantPaths
  const timeline = useMemo(() => (live ? null : buildTimeline(data.activities, player.stamps, data.agents)), [live, data, player])
  const log = useMemo(
    () => (timeline ? entriesUpTo(timeline.entries, snapshot.position) : liveLog),
    [timeline, snapshot.position, liveLog]
  )

  function setFollow(on) {
    followRef.current = on
    roomRef.current?.setFollow(on)
    setFollowing(on)
  }

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
        setFollow(false)
        room.focus(key)
        setFocused(key)
      },
    })
    roomRef.current = room
    if (!live) {
      const saved = loadSettings(store()).speed
      if (SPEEDS.includes(saved)) player.setSpeed(saved)
    }
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
    const pipeline = createPipeline({ agents: data.agents, tree: data.tree })
    const entryFor = createLogger(data.agents)
    let known = player.state.files.size
    const learned = () => {
      if (player.state.files.size === known) return
      known = player.state.files.size
      pipeline.learn([...player.state.files.keys()])
    }
    const handlers = {
      onStatus: (status) => player.setStatus(status),
      onFrame: (frame) => {
        const activities = pipeline.push(frame)
        player.push(activities)
        learned()
        const added = activities
          .map((activity) => {
            const entry = entryFor(activity)
            return entry && { ...entry, time: new Date(activity.time).toLocaleTimeString('en-GB') }
          })
          .filter(Boolean)
        if (added.length > 0) setLiveLog((previous) => [...previous, ...added].slice(-LIVE_LOG_LIMIT))
      },
      onTree: (tree) => {
        player.addFiles(tree.files)
        pipeline.learn(tree.files)
        known = player.state.files.size
      },
    }
    let link
    if (live.simulated) link = openSimulated({ frames: live.frames, speed: live.speed, ...handlers })
    else if (live.bridge) link = openBridge({ url: live.bridge, ...handlers })
    else link = openStream({ url: socketUrl(live.base, live.companyId), ...handlers })
    return () => link.close()
  }, [data, live, player])

  useEffect(() => {
    function onKey(event) {
      if (event.target.closest('input, textarea')) return
      const room = roomRef.current
      if (event.code === 'Space') {
        event.preventDefault()
        player.toggle()
      } else if (event.key === 'f' || event.key === 'F') {
        setFollow(followRef.current === 'wide' ? 'close' : followRef.current ? false : 'wide')
      } else if (event.key === 't' || event.key === 'T') {
        room?.toggleTerminal(room.focused())
      } else if (event.key === '0') {
        setFollow(false)
        room?.overview()
        setFocused(null)
      } else if (/^[1-9]$/.test(event.key)) {
        const agent = data.agents[Number(event.key) - 1]
        if (agent) {
          setFollow(false)
          room?.focus(agent.key)
          setFocused(agent.key)
        }
      } else if (event.key === 'ArrowRight') {
        player.seek(player.position + 5000)
      } else if (event.key === 'ArrowLeft') {
        player.seek(player.position - 5000)
      } else if (event.key === ']') {
        const index = SPEEDS.indexOf(player.speed)
        changeSpeed(SPEEDS[Math.min(SPEEDS.length - 1, index + 1)])
      } else if (event.key === '[') {
        const index = SPEEDS.indexOf(player.speed)
        changeSpeed(SPEEDS[Math.max(0, index - 1)])
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [data, player])

  function changeSpeed(value) {
    player.setSpeed(value)
    saveSettings(store(), { speed: value })
  }

  function focus(key) {
    setFollow(false)
    roomRef.current?.focus(key)
    setFocused(key)
  }

  function overview() {
    setFollow(false)
    roomRef.current?.overview()
    setFocused(null)
  }

  function replay(op, value) {
    if (live) return { ok: false, message: 'Replay controls do not apply to a live feed.' }
    if (op === 'play') player.play()
    else if (op === 'pause') player.pause()
    else if (op === 'speed') changeSpeed(value)
    else {
      const index = SPEEDS.indexOf(player.speed)
      changeSpeed(SPEEDS[op === 'faster' ? Math.min(SPEEDS.length - 1, index + 1) : Math.max(0, index - 1)])
    }
    return { ok: true, message: '' }
  }

  const dispatcher = createDispatcher({
    client,
    context: () => ({ agents: data.agents.map(({ key, name }) => ({ key, name })), paths: pathsRef.current }),
    agentName: (key) => data.agents.find((agent) => agent.key === key)?.name ?? key,
    agentId: (key) => data.agents.find((agent) => agent.key === key)?.id,
    focusAgent: (key, view) => {
      setFollow(false)
      roomRef.current?.focus(key, view)
      setFocused(key)
    },
    focusTerminal: (key) => {
      setFollow(false)
      setFocused(key)
      return roomRef.current?.focusTerminal(key) ?? false
    },
    focusPath: (path) => {
      setFollow(false)
      setFocused(null)
      return roomRef.current?.focusPath(path) ?? false
    },
    overview,
    setFollow,
    replay,
    openPanel: (tab, issueIdentifier) => {
      targetCount.current += 1
      setControlTarget({ tab, issueIdentifier, nonce: targetCount.current })
    },
    pressKey: (key) => document.body.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true })),
  })

  async function runAssistant(action) {
    const result = await dispatcher.run(action, { confirmed: true })
    if (result.message) setToast(result.message)
    return result
  }

  useEffect(() => {
    if (!toast) return undefined
    const timer = setTimeout(() => setToast(''), 4500)
    return () => clearTimeout(timer)
  }, [toast])

  const idleSoFar = snapshot.agents.every((agent) => agent.runs === 0)
  const linkTrouble = ['connecting', 'reconnecting', 'disconnected'].includes(snapshot.status)
  const showWaiting = Boolean(live) && (idleSoFar || linkTrouble)

  return (
    <div className="surface" ref={surfaceRef}>
      <div className="layer" ref={cssRef} aria-hidden="true" />
      <div className="layer is-over" ref={glRef} aria-hidden="true" />
      {live && (
        <div style={{ ...BADGE, color: snapshot.status === 'live' ? 'var(--yellow)' : 'var(--red)' }} role="status">
          {live.simulated ? 'Demo' : 'Live'} // {snapshot.status === 'live' ? 'connected' : snapshot.status}
        </div>
      )}
      {following && (
        <div style={{ ...BADGE, bottom: live ? 128 : 96, color: 'var(--white)' }} role="status">
          Follow // {following}
        </div>
      )}
      {toast && (
        <div style={{ ...BADGE, bottom: live ? 164 : 132, color: 'var(--white)', maxWidth: 360, textTransform: 'none' }} role="status">
          {toast}
        </div>
      )}
      {showWaiting && <Waiting agents={snapshot.agents} status={snapshot.status} />}
      <Hud
        snapshot={snapshot}
        focused={focused}
        speeds={SPEEDS}
        rootName={data.tree.rootName}
        mode={mode}
        client={client}
        assistantPaths={assistantPaths}
        onAssistantAction={runAssistant}
        controlTarget={controlTarget}
        markers={timeline?.markers ?? NONE}
        log={log}
        liveAvailable={liveAvailable}
        onMode={onMode}
        onToggle={() => player.toggle()}
        onSeek={(value) => player.seek(value)}
        onSpeed={changeSpeed}
        onFocus={focus}
        onOverview={overview}
      />
    </div>
  )
}
