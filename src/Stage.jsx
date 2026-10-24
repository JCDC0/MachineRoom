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
import Hud, { hudKeyBlocked } from './ui/Hud.jsx'
import { name } from './ui/brand.js'
import { lensStatus } from './ui/lens.js'
import { ladderFromAnswer } from './ui/liveLadder.js'
import { version } from '../package.json'
import { useBridgeHealth } from './ui/useBridgeHealth.js'
import { OrchestratorActivity, orchestratorDoing } from './ui/orchestratorChat.js'
import { latestOnly, subscribeToNotices } from './ui/panels/notices.js'
import { loadEffectSettings, loadSettings, saveEffectSettings, saveSettings } from './ui/settings.js'
import { setFineDust } from './engine/void.js'
import { barrelDataUri } from './ui/barrel.js'
import Waiting from './ui/Waiting.jsx'

const SPEEDS = [1, 2, 4, 8]
const NONE = []
const BADGE = {
  position: 'absolute',
  bottom: 96,
  zIndex: 5,
  padding: '2px 8px',
  fontFamily: 'var(--mono)',
  fontSize: 12,
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  border: '1px solid currentColor',
  background: 'rgb(0 0 0 / 0.7)',
}
const DEMO_SUBS = [
  { id: 'frontend', name: 'Frontend', lanes: ['opencode'], scope: ['src/**'], restricted: true, setBy: 'owner' },
  { id: 'backend', name: 'Backend', lanes: ['claude'], scope: ['server/**'], restricted: true, setBy: 'owner' },
]

export default function Stage({ data, mode = 'replay', liveAvailable = false, onMode, fps = false }) {
  const surfaceRef = useRef(null)
  const glRef = useRef(null)
  const cssRef = useRef(null)
  const roomRef = useRef(null)
  const live = data.live ?? null
  const demoLadder = useMemo(() => {
    if (live || typeof window === 'undefined') return null
    if (new URLSearchParams(window.location.search).get('ladder') !== 'demo') return null
    return { subs: DEMO_SUBS }
  }, [live])
  const agents = useMemo(() => {
    if (!demoLadder) return data.agents
    const subs = demoLadder.subs.map((sub) => ({
      id: `sub-${sub.id}`,
      key: `sub-${sub.id}`,
      name: sub.name,
      subOrchestrator: true,
    }))
    return [...data.agents, ...subs]
  }, [data.agents, demoLadder])
  const player = useMemo(() => {
    const handlers = {
      tree: data.tree,
      agents,
      onActivity: (activity, state) => roomRef.current?.onActivity(activity, state),
    }
    if (live) return createLivePlayer(handlers)
    return createPlayer({ ...handlers, activities: data.activities, onReset: (state) => roomRef.current?.reset(state) })
  }, [data, live, agents])
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
  const [dockCosts, setDockCosts] = useState(null)
  const [dockRuns, setDockRuns] = useState(NONE)
  const [dockTasks, setDockTasks] = useState(NONE)
  const targetCount = useRef(0)
  const latestBoardRef = useRef(null)
  const latestTasksRef = useRef(null)
  const latestLadderRef = useRef(null)
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
  const timeline = useMemo(() => (live ? null : buildTimeline(data.activities, player.stamps, agents)), [live, data, player, agents])
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
      agents,
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
    if (latestLadderRef.current) {
      room.setLadder(latestLadderRef.current)
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
  }, [agents, data, player])

  useEffect(() => {
    if (demoLadder) {
      latestLadderRef.current = demoLadder
      roomRef.current?.setLadder(demoLadder)
      return undefined
    }
    if (!live) {
      latestLadderRef.current = null
      roomRef.current?.setLadder(null)
      return undefined
    }
    if (!client || typeof client.orchestrators !== 'function') {
      latestLadderRef.current = null
      roomRef.current?.setLadder(null)
      return undefined
    }
    let active = true
    const latest = latestOnly()

    async function updateLadder() {
      const isLatest = latest()
      try {
        const answer = await client.orchestrators()
        if (!active || !isLatest()) return
        const ladder = ladderFromAnswer(answer)
        latestLadderRef.current = ladder
        roomRef.current?.setLadder(ladder)
      } catch {
        if (!active || !isLatest()) return
        latestLadderRef.current = null
        roomRef.current?.setLadder(null)
      }
    }

    updateLadder()
    const timer = setInterval(updateLadder, 60000)
    const unsubscribe = subscribeToNotices(client, ['orchestrator'], updateLadder)

    return () => {
      active = false
      clearInterval(timer)
      unsubscribe()
    }
  }, [client, demoLadder, live])

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
      setDockCosts(null)
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
        setDockCosts(board)
      } catch {
        if (!active || !isLatest()) return
        latestBoardRef.current = null
        roomRef.current?.setCosts(null)
        setDockCosts(null)
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
      setDockRuns(NONE)
      setDockTasks(NONE)
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
        setDockRuns(Array.isArray(liveRunsRaw) ? liveRunsRaw : NONE)
        setDockTasks(Array.isArray(issuesRaw) ? issuesRaw : NONE)
      } catch {
        if (!active || !isLatest()) return
        latestTasksRef.current = null
        roomRef.current?.setTasks(null)
        setDockRuns(NONE)
        setDockTasks(NONE)
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
    const pipeline = createPipeline({ agents, tree: data.tree })
    const entryFor = createLogger(agents)
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
  }, [agents, data, live, player])

  useEffect(() => {
    function onKey(event) {
      if (hudKeyBlocked(event.target)) return
      if (event.target.closest('button') && (event.code === 'Space' || event.key === 'Enter')) return
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
        const agent = agents[Number(event.key) - 1]
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
  }, [agents, player])

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
    context: () => ({ agents: agents.map(({ key, name }) => ({ key, name })), paths: pathsRef.current }),
    agentName: (key) => agents.find((agent) => agent.key === key)?.name ?? key,
    agentId: (key) => agents.find((agent) => agent.key === key)?.id,
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
  const orchestratorActivity = orchestratorDoing(snapshot.agents)

  const fishEyeOn = Boolean(effects.fishEye?.on && effects.fishEye?.strength > 0)
  const barrelMap = useMemo(() => (fishEyeOn ? barrelDataUri() : ''), [fishEyeOn])
  const chromaOn = Boolean(effects.aberration?.on && effects.aberration?.strength > 0)
  const hasFilter = fishEyeOn || chromaOn
  const chromaDx = chromaOn ? Number((effects.aberration.strength * 6).toFixed(2)) : 0
  const fishEyeScale = fishEyeOn ? Number((effects.fishEye.strength * 240).toFixed(2)) : 0

  const lens = lensStatus(snapshot.agents, log)

  return (
    <div className="stage">
      <svg
        className="lens-clip-defs"
        aria-hidden="true"
        style={{ position: 'absolute', width: 0, height: 0, pointerEvents: 'none', overflow: 'hidden' }}
      >
        <defs>
          <clipPath id="mr-lens-clip" clipPathUnits="objectBoundingBox">
            <path d="M 0,0.03 Q 0.5,-0.03 1,0.03 L 1,0.97 Q 0.5,1.03 0,0.97 Z" />
          </clipPath>
        </defs>
      </svg>
      <div className="lens">
        <div className="lens-frame" ref={surfaceRef}>
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
          <div className="lens-labels">
            <p className="lens-corner is-left">
              <span className="lens-project">{data.tree.rootName}</span>
              <span className="lens-version mono">
                {name} {version}
              </span>
            </p>
            <div className="lens-corner is-right">
              <span className="lens-lanes mono">
                Working {lens.working} / {lens.total}
              </span>
              <span className="lens-bar" aria-hidden="true">
                <span
                  className="lens-bar-fill"
                  style={{ width: `${Math.round(lens.share * 100)}%` }}
                />
              </span>
            </div>
            <p className={`lens-corner is-bottom mono is-${lens.tone}`}>{lens.activity}</p>
          </div>
        </div>
      </div>
      {hasFilter && (
        <svg
          className="screen-filter-defs"
          aria-hidden="true"
          style={{ position: 'absolute', width: 0, height: 0, pointerEvents: 'none', overflow: 'hidden' }}
        >
          <defs>
            <filter id="mr-screen-filter" x="-5%" y="-5%" width="110%" height="110%" colorInterpolationFilters="sRGB">
              {fishEyeOn && (
                <feImage
                  href={barrelMap}
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
        <div className="stage-badge" style={{ ...BADGE, color: snapshot.status === 'live' ? 'var(--yellow)' : 'var(--red)' }} role="status">
          {live.simulated ? 'Demo' : 'Live'} // {snapshot.status === 'live' ? 'connected' : snapshot.status}
        </div>
      )}
      {following && (
        <div className="stage-badge" style={{ ...BADGE, bottom: live ? 128 : 96, color: 'var(--white)' }} role="status">
          Follow // {following}
        </div>
      )}
      {toast && (
        <div className="stage-badge" style={{ ...BADGE, bottom: live ? 164 : 132, color: 'var(--white)', maxWidth: 360, textTransform: 'none' }} role="status">
          {toast}
        </div>
      )}
      {showWaiting && <Waiting agents={snapshot.agents} status={snapshot.status} />}
      <OrchestratorActivity.Provider value={orchestratorActivity}>
        <Hud
          snapshot={snapshot}
          focused={focused}
          speeds={SPEEDS}
          fpsStats={fpsStats}
          mode={mode}
          client={client}
          assistantPaths={assistantPaths}
          onAssistantAction={runAssistant}
          controlTarget={controlTarget}
          markers={timeline?.markers ?? NONE}
          log={log}
          costs={dockCosts}
          liveRuns={dockRuns}
          tasks={dockTasks}
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
      </OrchestratorActivity.Provider>
    </div>
  )
}
