import { useEffect, useMemo, useRef, useState } from 'react'
import { createAssistantRunner, createDispatcher } from './assistant/dispatch.js'
import { createClient } from './control/client.js'
import { createMockClient } from './control/mock.js'
import { createRoom } from './engine/room.js'
import { openBridge } from './live/bridge.js'
import { createLivePlayer } from './live/livePlayer.js'
import { openSimulated } from './live/simulated.js'
import { openStream, socketUrl, toAgents } from './live/source.js'
import { appendLiveLog, buildTimeline, createLogger, entriesUpTo } from './model/log.js'
import { createPipeline } from './model/pipeline.js'
import { createPlayer } from './model/player.js'
import { costBoard } from './model/costs.js'
import { agentTasks } from './model/liveTasks.js'
import { store } from './storage.js'
import Hud from './ui/Hud.jsx'
import { useBridgeHealth } from './ui/useBridgeHealth.js'
import { latestOnly, subscribeToNotices } from './ui/panels/notices.js'
import { loadEffectSettings, loadSettings, saveEffectSettings, saveSettings } from './ui/settings.js'
import { setFineDust } from './engine/void.js'
import Waiting from './ui/Waiting.jsx'

const BARREL_MAP_DATA_URI =
  'data:image/png;base64,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'

const SPEEDS = [1, 2, 4, 8]
const NONE = []
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

export default function Stage({ data, mode = 'replay', liveAvailable = false, onMode, fps = false }) {
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
  const health = useBridgeHealth(live && !live.simulated ? live.bridge ?? null : null)
  const [snapshot, setSnapshot] = useState(() => player.snapshot())
  const [focused, setFocused] = useState(null)
  const [following, setFollowing] = useState(false)
  const [liveLog, setLiveLog] = useState(NONE)
  const followRef = useRef(false)
  const [controlTarget, setControlTarget] = useState(null)
  const [effects, setEffects] = useState(() => loadEffectSettings(store()))
  const [toast, setToast] = useState('')
  const [openChips, setOpenChips] = useState(NONE)
  const targetCount = useRef(0)
  const latestBoardRef = useRef(null)
  const latestTasksRef = useRef(null)
  const framesRef = useRef([])
  const lastFrameRef = useRef(0)
  const [fpsStats, setFpsStats] = useState(() => (fps ? { median: 0, p95: 0 } : null))

  function handleSettingsChange(next) {
    const normalized = saveEffectSettings(store(), next)
    setEffects(normalized)
    setFineDust(normalized.dust)
    roomRef.current?.setOptions({ alwaysDepth: normalized.alwaysDepth })
  }
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
      beforeFrame: (ms) => {
        if (fps) {
          const now = performance.now()
          if (lastFrameRef.current > 0) {
            const list = framesRef.current
            list.push(now - lastFrameRef.current)
            if (list.length > 120) list.shift()
          }
          lastFrameRef.current = now
        }
        player.tick(ms)
      },
      onPick: (key) => {
        setFollow(false)
        room.focus(key)
        setFocused(key)
      },
    })
    roomRef.current = room
    room.setOptions({ alwaysDepth: effects.alwaysDepth })
    setFineDust(effects.dust)
    if (latestBoardRef.current) {
      room.setCosts(latestBoardRef.current)
    }
    if (latestTasksRef.current) {
      room.setTasks(latestTasksRef.current)
    }
    setOpenChips(NONE)
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
    setFineDust(effects.dust)
    roomRef.current?.setOptions({ alwaysDepth: effects.alwaysDepth })
  }, [effects.alwaysDepth, effects.dust])

  useEffect(() => {
    if (!fps) return undefined
    const timer = setInterval(() => {
      const list = framesRef.current
      if (list.length === 0) return
      const sorted = [...list].sort((a, b) => a - b)
      const median = sorted[Math.floor(sorted.length / 2)]
      const p95 = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))]
      setFpsStats({ median, p95 })
    }, 500)
    return () => clearInterval(timer)
  }, [fps])

  useEffect(() => {
    if (!client) {
      latestBoardRef.current = null
      roomRef.current?.setCosts(null)
      return undefined
    }
    let active = true
    const latest = latestOnly()

    async function updateCosts() {
      const isLatest = latest()
      try {
        const [agentsRaw, costsRaw] = await Promise.all([client.agents(), client.costs()])
        if (!active || !isLatest()) return
        const roster = toAgents(Array.isArray(agentsRaw) ? agentsRaw : [])
        const board = costBoard(costsRaw, roster)
        latestBoardRef.current = board
        roomRef.current?.setCosts(board)
      } catch {
        if (!active || !isLatest()) return
        latestBoardRef.current = null
        roomRef.current?.setCosts(null)
      }
    }

    updateCosts()
    const timer = setInterval(updateCosts, 60000)
    const unsubscribe = subscribeToNotices(client, ['agents', 'costs'], updateCosts)

    return () => {
      active = false
      clearInterval(timer)
      unsubscribe()
    }
  }, [client])

  useEffect(() => {
    if (!client) {
      latestTasksRef.current = null
      roomRef.current?.setTasks(null)
      return undefined
    }
    let active = true
    const latest = latestOnly()

    async function updateTasks() {
      const isLatest = latest()
      try {
        const [agentsRaw, issuesRaw, liveRunsRaw] = await Promise.all([
          client.agents(),
          client.issues(),
          client.liveRuns(),
        ])
        if (!active || !isLatest()) return
        const roster = toAgents(Array.isArray(agentsRaw) ? agentsRaw : [])
        const tasks = agentTasks(liveRunsRaw, issuesRaw, roster)
        latestTasksRef.current = tasks
        roomRef.current?.setTasks(tasks)
      } catch {
        if (!active || !isLatest()) return
        latestTasksRef.current = null
        roomRef.current?.setTasks(null)
      }
    }

    updateTasks()
    const unsubscribe = subscribeToNotices(client, ['agents', 'issues', 'liveRuns'], updateTasks)

    return () => {
      active = false
      unsubscribe()
    }
  }, [client])

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
        if (added.length > 0) setLiveLog((previous) => appendLiveLog(previous, added))
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
      if (event.target.closest('input, textarea, button, [role="dialog"]')) return
      const room = roomRef.current
      if (event.code === 'Space') {
        event.preventDefault()
        player.toggle()
      } else if (event.key === 'f' || event.key === 'F') {
        setFollow(followRef.current === 'wide' ? 'close' : followRef.current ? false : 'wide')
      } else if (event.key === 't' || event.key === 'T') {
        setOpenChips(room?.toggleTerminal(room.focused()) ?? NONE)
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

  function toggleTerminal(key) {
    setOpenChips(roomRef.current?.toggleTerminal(key) ?? NONE)
  }

  function showTerminals(open) {
    roomRef.current?.openTerminals(open)
    setOpenChips(roomRef.current?.openTerminalKeys() ?? NONE)
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
      const shown = roomRef.current?.focusTerminal(key) ?? false
      setOpenChips(roomRef.current?.openTerminalKeys() ?? NONE)
      return shown
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

  const runAction = createAssistantRunner(dispatcher)

  async function runAssistant(action, options) {
    const result = await runAction(action, options)
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

  const fishEyeOn = Boolean(effects.fishEye?.on && effects.fishEye?.strength > 0)
  const chromaOn = Boolean(effects.aberration?.on && effects.aberration?.strength > 0)
  const hasFilter = fishEyeOn || chromaOn
  const chromaDx = chromaOn ? Number((effects.aberration.strength * 6).toFixed(2)) : 0
  const fishEyeScale = fishEyeOn ? Number((effects.fishEye.strength * 40).toFixed(2)) : 0

  return (
    <div className="surface" ref={surfaceRef}>
      <div
        className="surface-layers"
        style={hasFilter ? { filter: 'url(#mr-screen-filter)' } : undefined}
      >
        <div className="layer" ref={cssRef} aria-hidden="true" />
        <div className="layer is-over" ref={glRef} aria-hidden="true" />
      </div>
      <div className="screen-effects-overlay" aria-hidden="true">
        <div
          className="screen-vignette"
          style={{ opacity: effects.vignette?.on ? effects.vignette.strength : 0 }}
        />
        <div
          className="screen-grain"
          style={{ opacity: effects.grain?.on ? effects.grain.strength * 0.25 : 0 }}
        />
      </div>
      {hasFilter && (
        <svg
          className="screen-filter-defs"
          aria-hidden="true"
          style={{ position: 'absolute', width: 0, height: 0, pointerEvents: 'none', overflow: 'hidden' }}
        >
          <defs>
            <filter id="mr-screen-filter" x="-5%" y="-5%" width="110%" height="110%">
              {fishEyeOn && (
                <feImage
                  href={BARREL_MAP_DATA_URI}
                  x="0%"
                  y="0%"
                  width="100%"
                  height="100%"
                  preserveAspectRatio="none"
                  result="barrel"
                />
              )}
              {chromaOn && (
                <>
                  <feColorMatrix
                    in="SourceGraphic"
                    type="matrix"
                    result="red"
                    values="1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0"
                  />
                  <feOffset in="red" dx={chromaDx} dy="0" result="redShift" />
                  <feColorMatrix
                    in="SourceGraphic"
                    type="matrix"
                    result="green"
                    values="0 0 0 0 0  0 1 0 0 0  0 0 0 0 0  0 0 0 1 0"
                  />
                  <feColorMatrix
                    in="SourceGraphic"
                    type="matrix"
                    result="blue"
                    values="0 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 1 0"
                  />
                  <feOffset in="blue" dx={-chromaDx} dy="0" result="blueShift" />
                  <feBlend in="redShift" in2="green" mode="screen" result="rg" />
                  <feBlend in="rg" in2="blueShift" mode="screen" result="chroma" />
                </>
              )}
              {fishEyeOn && (
                <feDisplacementMap
                  in={chromaOn ? 'chroma' : 'SourceGraphic'}
                  in2="barrel"
                  scale={fishEyeScale}
                  xChannelSelector="R"
                  yChannelSelector="G"
                  result="filtered"
                />
              )}
            </filter>
          </defs>
        </svg>
      )}
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
        fpsStats={fpsStats}
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
        openTerminals={openChips}
        onToggleTerminal={toggleTerminal}
        onShowTerminals={showTerminals}
        health={health}
        effects={effects}
        onSettingsChange={handleSettingsChange}
      />
    </div>
  )
}
