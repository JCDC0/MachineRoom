import { useEffect, useMemo, useRef, useState } from 'react'
import { createAssistantRunner, createDispatcher } from './assistant/dispatch.js'
import { createClient } from './control/client.js'
import { createMockClient } from './control/mock.js'
import { createRoom } from './engine/room.js'
import { costModeFor } from './engine/board.js'
import { openBridge } from './live/bridge.js'
import { createLivePlayer } from './live/livePlayer.js'
import { openSimulated } from './live/simulated.js'
import { openStream, socketUrl, toAgents, diffRoster, loadAgents } from './live/source.js'
import { appendLiveLog, buildTimeline, createLogger, entriesUpTo } from './model/log.js'
import { createPipeline } from './model/pipeline.js'
import { createPlayer } from './model/player.js'
import { costBoard } from './model/costs.js'
import { DEFAULT_FIXTURE } from './model/replay.js'
import { agentTasks } from './model/liveTasks.js'
import { store } from './storage.js'
import Hud, { hudKeyBlocked } from './ui/Hud.jsx'
import { CostsModeContext } from './ui/panels/MetersPanel.jsx'
import { name } from './ui/brand.js'
import { lensClock, lensProject, lensStatus } from './ui/lens.js'
import { ladderFromAnswer } from './ui/liveLadder.js'
import { version } from '../package.json'
import { useBridgeHealth } from './ui/useBridgeHealth.js'
import { OrchestratorActivity, orchestratorDoing } from './ui/orchestratorChat.js'
import { latestOnly, subscribeToNotices } from './ui/panels/notices.js'
import { loadEffectSettings, loadSettings, loadSoundSettings, saveEffectSettings, saveSettings } from './ui/settings.js'
import { aberrationChannels, radialMapDataUrl } from './ui/aberration.js'
import { startGrain } from './ui/grain.js'
import { activitySounds, sound } from './ui/sound.js'
import { setFineDust } from './engine/void.js'
import { LiveBadgeContext } from './ui/Transport.jsx'
import Waiting from './ui/Waiting.jsx'
import LensRail from './ui/LensRail.jsx'
import { LENS_SHARE_DEFAULT, clampLensShare, heightRailShare, lensHeightValue, lensShareAfterWheel, lensShareFromRail, multiplierText } from './ui/lensResize.js'

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

export const LENS_EDGE_HEIGHT = 24
export const LENS_DEFAULT_WIDTH = 1440
export const LENS_PIXELS_PER_DEGREE = 6
export const LENS_TICK_DEGREES = 5
export const LENS_LABEL_DEGREES = 15
export const LENS_CARDINALS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW']

function spanOf(width) {
  const value = Number(width)
  return Number.isFinite(value) && value > 0 ? value : 0
}

function bearingDegrees(bearing) {
  const value = Number(bearing)
  if (!Number.isFinite(value)) return 0
  return ((Math.round(value) % 360) + 360) % 360
}

export function compassHeading(yaw = 0) {
  const value = Number(yaw)
  if (!Number.isFinite(value)) return 0
  return ((((-value * 180) / Math.PI) % 360) + 360) % 360
}

export function compassBearingLabel(bearing) {
  const degrees = bearingDegrees(bearing)
  const text = String(degrees).padStart(3, '0')
  const cardinal = degrees % 45 === 0 ? LENS_CARDINALS[degrees / 45] : ''
  return cardinal ? `${cardinal} ${text}` : text
}

export function compassBottomHeading(yaw = 0) {
  return (compassHeading(yaw) + 180) % 360
}

export function compassBottomLabel(bearing, pitch = 0) {
  const degrees = bearingDegrees(bearing)
  const text = String(degrees).padStart(3, '0')
  const cardinal = degrees % 45 === 0 ? LENS_CARDINALS[degrees / 45] : ''
  return cardinal ? `${text} ${cardinal}` : `${text}°`
}

export function lensEdgeTicks(width = LENS_DEFAULT_WIDTH, yaw = 0, side = 'top') {
  const span = spanOf(width)
  if (span <= 0) return []
  const bottom = side === 'bottom'
  const heading = bottom ? compassBottomHeading(yaw) : compassHeading(yaw)
  const half = span / 2 / LENS_PIXELS_PER_DEGREE
  const ticks = []
  if (bottom) {
    const first = Math.floor((heading + half) / LENS_TICK_DEGREES) * LENS_TICK_DEGREES
    const last = heading - half
    for (let bearing = first; bearing >= last - 1e-9; bearing -= LENS_TICK_DEGREES) {
      const normalized = bearingDegrees(bearing)
      const x = Math.round((span / 2 - (bearing - heading) * LENS_PIXELS_PER_DEGREE) * 1000) / 1000
      ticks.push({ x, tall: normalized % LENS_LABEL_DEGREES === 0, bearing: normalized })
    }
    return ticks
  }
  const first = Math.ceil((heading - half) / LENS_TICK_DEGREES) * LENS_TICK_DEGREES
  const last = heading + half
  for (let bearing = first; bearing <= last + 1e-9; bearing += LENS_TICK_DEGREES) {
    const normalized = bearingDegrees(bearing)
    const x = Math.round((span / 2 + (bearing - heading) * LENS_PIXELS_PER_DEGREE) * 1000) / 1000
    ticks.push({ x, tall: normalized % LENS_LABEL_DEGREES === 0, bearing: normalized })
  }
  return ticks
}

export function lensEdgeLabels(width = LENS_DEFAULT_WIDTH, yaw = 0, side = 'top', pitch = 0) {
  const span = spanOf(width)
  const bottom = side === 'bottom'
  return lensEdgeTicks(width, yaw, side)
    .filter((tick) => tick.tall && tick.x >= 24 && tick.x <= span - 24)
    .map((tick) => ({
      x: tick.x,
      bearing: tick.bearing,
      cardinal: tick.bearing % 45 === 0,
      text: bottom ? compassBottomLabel(tick.bearing, pitch) : compassBearingLabel(tick.bearing),
    }))
}

function LensEdge({ side, yaw = 0, pitch = 0 }) {
  const ref = useRef(null)
  const [width, setWidth] = useState(0)
  const top = side === 'top'
  useEffect(() => {
    const node = ref.current
    if (!node) return undefined
    const read = () => {
      const rect = typeof node.getBoundingClientRect === 'function' ? node.getBoundingClientRect() : null
      setWidth(Math.max(0, Math.round(Number(rect?.width) || 0)))
    }
    read()
    if (typeof ResizeObserver !== 'function') return undefined
    const observer = new ResizeObserver(read)
    observer.observe(node)
    return () => observer.disconnect()
  }, [])
  const lineY = top ? 0.5 : LENS_EDGE_HEIGHT - 0.5
  return (
    <div className={`lens-edge is-${side}`} ref={ref} aria-hidden="true">
      <span className="lens-edge-corner is-left" />
      <span className="lens-edge-corner is-right" />
      <span className="lens-edge-cross">+</span>
      <svg
        className="lens-edge-rule"
        width="100%"
        height={LENS_EDGE_HEIGHT}
        aria-hidden="true"
      >
        <line className="lens-edge-line" x1="0" x2="100%" y1={lineY} y2={lineY} />
        {lensEdgeTicks(width, yaw, side).map((tick) => {
          const length = tick.tall ? 11 : 5
          return (
            <line
              key={`tick-${tick.x}`}
              className={`lens-edge-tick${tick.tall ? ' is-tall' : ''}`}
              x1={tick.x + 0.5}
              x2={tick.x + 0.5}
              y1={top ? 1 : LENS_EDGE_HEIGHT - 1}
              y2={top ? length : LENS_EDGE_HEIGHT - length}
            />
          )
        })}
        {lensEdgeLabels(width, yaw, side, pitch).map((label) => (
          <text
            key={`label-${label.x}`}
            className={`lens-edge-label${label.cardinal ? ' is-cardinal' : ''}`}
            x={label.x + 4}
            y={top ? 22 : 9}
          >
            {label.text}
          </text>
        ))}
      </svg>
    </div>
  )
}

export default function Stage({ data, mode = 'replay', liveAvailable = false, onMode, fps = false }) {
  const surfaceRef = useRef(null)
  const glRef = useRef(null)
  const cssRef = useRef(null)
  const roomRef = useRef(null)
  const liveRosterRef = useRef(null)
  const live = data.live ?? null
  const costMode = costModeFor(mode, Boolean(live?.simulated))
  const demoLadder = useMemo(() => {
    if (typeof window === 'undefined') return null
    if (live && !live.simulated) return null
    const params = new URLSearchParams(window.location.search)
    const ladder = params.get('ladder')
    const demo = Boolean(live?.simulated) || ladder === 'demo' || (ladder === null && data.fixture === DEFAULT_FIXTURE)
    if (!demo) return null
    return { subs: DEMO_SUBS }
  }, [data.fixture, live])
  const agents = useMemo(() => {
    if (!demoLadder) return data.agents
    const present = new Set(data.agents.map((agent) => agent.key))
    const subs = demoLadder.subs
      .filter((sub) => !present.has(`sub-${sub.id}`))
      .map((sub) => ({
        id: `sub-${sub.id}`,
        key: `sub-${sub.id}`,
        name: sub.name,
        subOrchestrator: true,
      }))
    return [...data.agents, ...subs]
  }, [data.agents, demoLadder])
  if (liveRosterRef.current === null) liveRosterRef.current = agents
  const player = useMemo(() => {
    const handlers = {
      tree: data.tree,
      agents,
      onActivity: (activity, state) => {
        roomRef.current?.onActivity(activity, state)
        const sounds = activitySounds(activity, knownSoundRef.current)
        for (const item of sounds) {
          if (item.kind === 'deleted') knownSoundRef.current.delete(item.path)
          sound.beep(item.kind, roomRef.current?.soundAt(item.path))
        }
      },
    }
    if (live) return createLivePlayer(handlers)
    return createPlayer({ ...handlers, activities: data.activities, onReset: (state) => {
      roomRef.current?.reset(state)
      resetSoundFiles()
    } })
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
  const [chromaMap, setChromaMap] = useState('')
  const [lensShare, setLensShare] = useState(() => loadSettings(store()).lensShare ?? null)
  const [lensYaw, setLensYaw] = useState(0)
  const [lensPitch, setLensPitch] = useState(0)
  const [zoom, setZoom] = useState({ share: 0, multiplier: 1 })

  function changeLensShare(next, save = true) {
    const share = clampLensShare(next)
    setLensShare(share)
    if (save) saveSettings(store(), { lensShare: share })
  }

  useEffect(() => {
    sound.setSettings(loadSoundSettings(store()))
    sound.armOnGesture()
  }, [])

  useEffect(() => {
    resetSoundFiles()
  }, [data.tree])

  useEffect(() => {
    const timer = setInterval(() => {
      const room = roomRef.current
      if (!room?.zoomShare) return
      const share = Math.round(room.zoomShare() * 200) / 200
      const multiplier = Math.round(room.zoomMultiplier() * 10) / 10
      setZoom((now) => (now.share === share && now.multiplier === multiplier ? now : { share, multiplier }))
    }, 120)
    return () => clearInterval(timer)
  }, [])
  const [ladder, setLadder] = useState(null)
  const [toast, setToast] = useState('')
  const [openChips, setOpenChips] = useState(NONE)
  const [dockCosts, setDockCosts] = useState(null)
  const [dockRuns, setDockRuns] = useState(NONE)
  const [dockTasks, setDockTasks] = useState(NONE)
  const targetCount = useRef(0)
  const latestBoardRef = useRef(null)
  const latestTasksRef = useRef(null)
  const latestLadderRef = useRef(null)
  const knownSoundRef = useRef(null)
  if (knownSoundRef.current === null) {
    const missing = new Set(data.tree?.created ?? [])
    knownSoundRef.current = new Set((data.tree?.files ?? []).filter((path) => !missing.has(path)))
  }
  const framesRef = useRef([])
  const lastFrameRef = useRef(0)
  const grainRef = useRef(null)
  const [fpsStats, setFpsStats] = useState(() => (fps ? { median: 0, p95: 0 } : null))

  function handleSettingsChange(next) {
    const normalized = saveEffectSettings(store(), next)
    setEffects(normalized)
    setFineDust(normalized.dust)
    roomRef.current?.setOptions({ alwaysDepth: normalized.alwaysDepth })
  }

  function resetSoundFiles(tree = data.tree) {
    const missing = new Set(tree?.created ?? [])
    knownSoundRef.current = new Set((tree?.files ?? []).filter((path) => !missing.has(path)))
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
    liveRosterRef.current = agents
  }, [agents])

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
        const yaw = roomRef.current?.yaw?.()
        if (Number.isFinite(yaw)) setLensYaw((now) => (Math.abs(yaw - now) > 0.0005 ? yaw : now))
        const pitch = roomRef.current?.pitch?.()
        if (Number.isFinite(pitch)) setLensPitch((now) => (Math.abs(pitch - now) > 0.0005 ? pitch : now))
        player.tick(ms)
        const beat = sound.beat()
        if (beat > 0) roomRef.current?.setBeat(beat)
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
    function apply(next) {
      latestLadderRef.current = next
      setLadder(next)
    }
    if (demoLadder) {
      apply(demoLadder)
      roomRef.current?.setLadder(demoLadder)
      return undefined
    }
    if (!live) {
      apply(null)
      roomRef.current?.setLadder(null)
      return undefined
    }
    if (!client || typeof client.orchestrators !== 'function') {
      apply(null)
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
        const next = ladderFromAnswer(answer)
        apply(next)
        roomRef.current?.setLadder(next)
      } catch {
        if (!active || !isLatest()) return
        apply(null)
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
    if (!live || live.simulated || !live.bridge) return undefined
    let active = true
    const latest = latestOnly()

    async function updateRoster() {
      const isLatest = latest()
      try {
        const next = await loadAgents(live.bridge)
        if (!active || !isLatest()) return
        if (!diffRoster(liveRosterRef.current, next).changed) return
        liveRosterRef.current = next
        roomRef.current?.setRoster(next)
      } catch {}
    }

    updateRoster()
    const timer = setInterval(updateRoster, 60000)
    const unsubscribe = subscribeToNotices(client, ['agents'], updateRoster)

    return () => {
      active = false
      clearInterval(timer)
      unsubscribe()
    }
  }, [client, live])

  useEffect(() => {
    setFineDust(effects.dust)
    roomRef.current?.setOptions({ alwaysDepth: effects.alwaysDepth })
  }, [effects.alwaysDepth, effects.dust])

  const grainOn = Boolean(effects.grain?.on && effects.grain.strength > 0)

  useEffect(() => {
    const node = grainRef.current
    if (!node || !grainOn) return undefined
    return startGrain(node)
  }, [grainOn])

  useEffect(() => {
    setChromaMap(radialMapDataUrl())
  }, [])

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
        const board = { ...costBoard(costsRaw, roster), costMode }
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
  }, [client, costMode])

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
        for (const path of tree.files) knownSoundRef.current?.add(path)
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

  const chromaOn = Boolean(effects.aberration?.on && effects.aberration?.strength > 0)
  const chromaChannels = aberrationChannels(effects.aberration?.strength)
  const chromaFilter = chromaOn && chromaMap ? 'url(#mr-screen-filter)' : undefined

  const lens = lensStatus(snapshot.agents, log)
  const project = lensProject(data.tree.rootName)
  const clock = lensClock(Boolean(live), snapshot.position)

  return (
    <LiveBadgeContext.Provider value={live?.simulated ? 'demo' : 'live'}>
      <div className="stage" style={lensShare === null ? undefined : { '--lens-h-user': lensHeightValue(lensShare) }}>
        <div className="lens">
          <LensEdge side="top" yaw={lensYaw} />
          <LensEdge side="bottom" yaw={lensYaw} pitch={lensPitch} />
          <div className="lens-frame" ref={surfaceRef}>
            <div
              className="surface-layers"
              style={chromaFilter ? { filter: chromaFilter } : undefined}
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
                ref={grainRef}
                style={{ opacity: grainOn ? effects.grain.strength : 0 }}
              />
            </div>
            <div className="lens-labels">
              <p className="lens-corner is-left">
                <span className="lens-project">{data.tree.rootName}</span>
                <span className="lens-version mono">
                  {name} {version}
                </span>
              </p>
              <p className="lens-corner is-center">
                <span className="lens-project">{project}</span>
              </p>
              <div className="lens-corner is-right">
                <span className="lens-clock mono">{clock}</span>
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
          <LensRail
            side="left"
            label="Height"
            share={heightRailShare(lensShare ?? undefined)}
            multiplier={multiplierText((lensShare ?? LENS_SHARE_DEFAULT) / LENS_SHARE_DEFAULT)}
            ariaLabel="Lens height"
            valueText={`${Math.round((lensShare ?? LENS_SHARE_DEFAULT) * 100)} percent of the window`}
            onShare={(share, done) => changeLensShare(lensShareFromRail(share), done)}
            onWheel={(deltaY) => changeLensShare(lensShareAfterWheel(lensShare ?? undefined, deltaY))}
          />
          <LensRail
            side="right"
            label="Zoom"
            share={zoom.share}
            multiplier={multiplierText(zoom.multiplier)}
            ariaLabel="Zoom"
            valueText={`${multiplierText(zoom.multiplier)} of the overview`}
            onShare={(share) => roomRef.current?.setZoomShare?.(share)}
            onWheel={(deltaY) => roomRef.current?.zoomBy?.(deltaY)}
          />
          {showWaiting && <Waiting agents={snapshot.agents} status={snapshot.status} />}
        </div>
        {chromaFilter && (
          <svg
            className="screen-filter-defs"
            aria-hidden="true"
            style={{ position: 'absolute', width: 0, height: 0, pointerEvents: 'none', overflow: 'hidden' }}
          >
            <defs>
              <filter id="mr-screen-filter" x="-6%" y="-6%" width="112%" height="112%" colorInterpolationFilters="sRGB">
                <feImage href={chromaMap} preserveAspectRatio="none" result="radial" />
                <feColorMatrix
                  in="SourceGraphic"
                  type="matrix"
                  result="red"
                  values="1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0"
                />
                <feDisplacementMap
                  in="red"
                  in2="radial"
                  scale={chromaChannels.red}
                  xChannelSelector="R"
                  yChannelSelector="G"
                  result="redShift"
                />
                <feColorMatrix
                  in="SourceGraphic"
                  type="matrix"
                  result="green"
                  values="0 0 0 0 0  0 1 0 0 0  0 0 0 0 0  0 0 0 1 0"
                />
                <feDisplacementMap
                  in="green"
                  in2="radial"
                  scale={chromaChannels.green}
                  xChannelSelector="R"
                  yChannelSelector="G"
                  result="greenShift"
                />
                <feColorMatrix
                  in="SourceGraphic"
                  type="matrix"
                  result="blue"
                  values="0 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 1 0"
                />
                <feDisplacementMap
                  in="blue"
                  in2="radial"
                  scale={chromaChannels.blue}
                  xChannelSelector="R"
                  yChannelSelector="G"
                  result="blueShift"
                />
                <feBlend in="redShift" in2="greenShift" mode="screen" result="rg" />
                <feBlend in="rg" in2="blueShift" mode="screen" result="chroma" />
              </filter>
            </defs>
          </svg>
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
        <OrchestratorActivity.Provider value={orchestratorActivity}>
          <CostsModeContext.Provider value={costMode}>
            <Hud
              snapshot={snapshot}
              project={project}
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
              ladder={ladder}
              effects={effects}
              onSettingsChange={handleSettingsChange}
            />
          </CostsModeContext.Provider>
        </OrchestratorActivity.Provider>
      </div>
    </LiveBadgeContext.Provider>
  )
}
