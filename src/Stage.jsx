import { memo, useEffect, useMemo, useRef, useState } from 'react'
import { createAssistantRunner, createDispatcher } from './assistant/dispatch.js'
import { createClient } from './control/client.js'
import { createMockClient } from './control/mock.js'
import { createRoom } from './engine/room.js'
import { costModeFor } from './engine/board.js'
import { openBridge } from './live/bridge.js'
import { createLivePlayer } from './live/livePlayer.js'
import { openSimulated } from './live/simulated.js'
import { toAgents, diffRoster, loadAgents } from './live/source.js'
import { appendLiveLog, buildTimeline, createLogger, entriesUpTo } from './model/log.js'
import { createPipeline } from './model/pipeline.js'
import { createPlayer } from './model/player.js'
import { costBoard } from './model/costs.js'
import { DEFAULT_FIXTURE } from './model/replay.js'
import { MAX_DEPTH, setDepthLimit } from './model/state.js'
import { agentTasks } from './model/liveTasks.js'
import { store } from './storage.js'
import Hud, { hudKeyBlocked } from './ui/Hud.jsx'
import Inspector from './ui/Inspector.jsx'
import { INSPECT_EVENT, inspectTarget } from './ui/inspector.js'
import { CostsModeContext } from './ui/panels/MetersPanel.jsx'
import { name } from './ui/brand.js'
import { emptyRoomLine } from './ui/emptyRoom.js'
import { lensClock, lensProject, lensStatus } from './ui/lens.js'
import { ladderFromAnswer } from './ui/liveLadder.js'
import { version } from '../package.json'
import { useBridgeHealth } from './ui/useBridgeHealth.js'
import { OrchestratorActivity, orchestratorDoing } from './ui/orchestratorChat.js'
import { latestOnly, subscribeToNotices } from './ui/panels/notices.js'
import { loadEffectSettings, loadSettings, loadSoundSettings, saveEffectSettings, saveSettings } from './ui/settings.js'
import { startMusicQueue } from './ui/musicQueue.js'
import { aberrationChannels, mapPlacement, radialMapDataUrl } from './ui/aberration.js'
import { startGrain } from './ui/grain.js'
import { activitySounds, sound } from './ui/sound.js'
import { setFineDust } from './engine/void.js'
import { still } from './engine/sprites.js'
import { createIdleWatch, idleAllowed, stageClassName } from './ui/idleView.js'
import { LiveBadgeContext, LanePillsContext, OrchestratorsContext, TransportCostsContext } from './ui/Transport.jsx'
import { orchestratorAnswerList } from './ui/transportOrchestrators.js'
import { displayName } from './ui/agentList.js'
import { addFailureActivities, emptyFailureTray, failureAge, failureRows, FAILURE_TRAY_LIMIT } from './ui/failureTray.js'
import Waiting from './ui/Waiting.jsx'
import LensRail from './ui/LensRail.jsx'
import { LENS_SHARE_DEFAULT, clampLensShare, heightRailShare, lensHeightValue, lensShareAfterWheel, lensShareFromRail, multiplierText } from './ui/lensResize.js'

const SPEEDS = [1, 2, 4, 8]
const NONE = []
const COVER_PANEL = '.control-drawer, .hud-settings, .hud-dropdown, .mr-side-overlay, .hud-help-backdrop, .hud-band-list, .hud-menu.is-open, .mr-assistant, .mr-guide-backdrop, .mr-launcher, .mr-setup-backdrop'
const OPEN_PANEL = `${COVER_PANEL}, .hud-drawer:not([hidden])`
const IDLE_PANEL = `${OPEN_PANEL}, .mr-inspector, .brief-confirm-card, .mr-side-confirm-card, .endpoints-confirm`
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
const SEAM_MIN_WIDTH = 900
const SEAM_TOP = '.hud-band-project, .hud-band-switch, .hud-modes button, .hud-action, .hud-health-chip'
const SEAM_BOTTOM = '.transport-badge, .transport-center, .transport-orchestrator, .transport-chip, .transport-chip-overflow, .transport-lane, .transport-lane-overflow, .transport-spend, .transport-context, .transport-tail > .mono, .transport.is-live > .mono, .transport:not(.is-live) > button, .transport:not(.is-live) > .mono, .speeds button'
const SEAM_QUIET = ['hud-dropdown', 'hud-band-list', 'hud-health-popover']
export const LENS_MOVE = 0.0005

export function handleRoomKey(event, view = {}) {
  if (!event || event.defaultPrevented) return
  if (hudKeyBlocked(event.target)) return
  if (typeof document !== 'undefined' && document.querySelector(COVER_PANEL)) return
  if (event.target?.closest?.('button') && (event.code === 'Space' || event.key === 'Enter')) return
  const player = view.player
  if (!player) return
  const room = view.room?.current ?? null
  const follow = view.follow?.current
  if (event.key === 'Escape') {
    if (document.querySelector(OPEN_PANEL)) return
    if (view.inspector?.current) {
      view.closeInspector?.()
      return
    }
    view.parkRoom?.()
  } else if (event.code === 'Space') {
    event.preventDefault()
    player.toggle()
  } else if (event.key === 'f' || event.key === 'F') {
    view.setFollow?.(follow === 'wide' ? 'close' : follow ? false : 'wide')
  } else if (event.key === 't' || event.key === 'T') {
    view.setOpenChips?.(room?.toggleTerminal(room.focused()) ?? NONE)
  } else if (event.key === '0') {
    view.parkRoom?.()
  } else if (/^[1-9]$/.test(event.key)) {
    const agent = view.agents?.[Number(event.key) - 1]
    if (agent) {
      view.setFollow?.(false)
      room?.focus(agent.key)
      view.setFocused?.(agent.key)
    }
  } else if (event.key === 'ArrowRight') {
    player.seek(player.position + 5000)
  } else if (event.key === 'ArrowLeft') {
    player.seek(player.position - 5000)
  } else if (event.key === ']') {
    const index = SPEEDS.indexOf(player.speed)
    view.changeSpeed?.(SPEEDS[Math.min(SPEEDS.length - 1, index + 1)])
  } else if (event.key === '[') {
    const index = SPEEDS.indexOf(player.speed)
    view.changeSpeed?.(SPEEDS[Math.max(0, index - 1)])
  }
}

export function labelsFromFamily(answer) {
  const nodes = Array.isArray(answer?.nodes) ? answer.nodes : []
  if (nodes.length === 0) return null
  const labels = new Map()
  for (const node of nodes) {
    if (!node || typeof node.id !== 'string' || !node.id) continue
    if (typeof node.label !== 'string' || !node.label) continue
    const key = node.kind === 'sub' ? `sub-${node.id}` : node.id
    labels.set(key, node.label)
  }
  return labels
}

export const LENS_EDGE_HEIGHT = 24
export const LENS_BOW = 28
export const LENS_DEFAULT_WIDTH = 1440
export const LENS_PIXELS_PER_DEGREE = 6
export const LENS_TICK_DEGREES = 5
export const LENS_LABEL_DEGREES = 45
export const LENS_CARDINALS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW']

function spanOf(width) {
  const value = Number(width)
  return Number.isFinite(value) && value > 0 ? value : 0
}

export function lensBowAt(x, width, bow = LENS_BOW) {
  const span = spanOf(width)
  const point = Number(x)
  if (span <= 0 || !Number.isFinite(point)) return 0
  return bow * (1 - (2 * point / span - 1) ** 2)
}

export function seamPose(x, width, edge, bow = LENS_BOW) {
  const span = spanOf(width)
  const point = Number(x)
  const sign = edge === 'bottom' ? -1 : 1
  const y = lensBowAt(point, span, bow)
  const slope = span > 0 && Number.isFinite(point)
    ? (-8 * bow * (point - span / 2)) / (span * span)
    : 0
  const angle = (Math.atan(slope) * 180) / Math.PI
  return {
    y: y === 0 ? 0 : sign * y,
    angle: angle === 0 ? 0 : sign * angle,
  }
}

export function lensClipPath(width, height, bow = LENS_BOW) {
  const span = spanOf(width)
  const tall = spanOf(height)
  if (span <= 0 || tall <= 0) return ''
  return `M 0 0 Q ${span / 2} ${2 * bow} ${span} 0 L ${span} ${tall} Q ${span / 2} ${tall - 2 * bow} 0 ${tall} Z`
}

function seamQuiet(node) {
  for (let current = node; current; current = current.parentNode) {
    const value = typeof current.className === 'string' ? current.className : ''
    if (value && value.split(/\s+/).some((name) => SEAM_QUIET.includes(name))) return true
  }
  return false
}

export function createSeamSync({
  window: win = typeof window === 'undefined' ? null : window,
  document: doc = typeof document === 'undefined' ? null : document,
  Resize = null,
  Mutation = null,
} = {}) {
  if (!win || !doc) return { measure() {}, stop() {} }
  const ResizeClass = Resize ?? win.ResizeObserver
  const MutationClass = Mutation ?? win.MutationObserver
  const boxes = { lens: null, menu: null, transport: null }
  const watched = { hud: null, menu: null, transport: null }
  const controls = new Set()
  const poses = new WeakMap()
  const posed = new Set()
  let frame = 0

  function schedule() {
    if (frame) return
    frame = win.requestAnimationFrame(() => {
      frame = 0
      measure()
    })
  }

  function onMutations(records) {
    for (const record of records ?? []) {
      if (record.type && record.type !== 'childList') continue
      if (seamQuiet(record.target)) continue
      schedule()
      return
    }
  }

  const resize = typeof ResizeClass === 'function' ? new ResizeClass(schedule) : null
  const mutations = typeof MutationClass === 'function' ? new MutationClass(onMutations) : null

  function observeBox(key, node) {
    if (!node || boxes[key] === node) return
    if (boxes[key]) resize?.unobserve(boxes[key])
    boxes[key] = node
    resize?.observe(node)
  }

  function observeMutations(key, node) {
    if (!node || watched[key] === node) return
    watched[key] = node
    mutations?.observe(node, key === 'hud' ? { childList: true } : { childList: true, subtree: true })
  }

  function observeControls(next) {
    for (const node of controls) {
      if (next.has(node)) continue
      resize?.unobserve(node)
      controls.delete(node)
    }
    for (const node of next.keys()) {
      if (controls.has(node)) continue
      controls.add(node)
      resize?.observe(node)
    }
  }

  function write(node, pose) {
    const last = poses.get(node)
    if (last && last.y === pose.y && last.angle === pose.angle) return
    poses.set(node, pose)
    posed.add(node)
    node.style.setProperty('--seam-y', `${pose.y}px`)
    node.style.setProperty('--seam-r', `${pose.angle}deg`)
  }

  function clear(nodes = posed) {
    for (const node of nodes) {
      node.style.removeProperty('--seam-y')
      node.style.removeProperty('--seam-r')
      poses.delete(node)
      posed.delete(node)
    }
  }

  function measure() {
    const lens = doc.querySelector('.lens')
    const menu = doc.querySelector('.hud-menu')
    const transport = doc.querySelector('.transport')
    const hud = doc.querySelector('.hud')
    observeBox('lens', lens)
    observeBox('menu', menu)
    observeBox('transport', transport)
    observeMutations('hud', hud)
    observeMutations('menu', menu)
    observeMutations('transport', transport)
    if (!lens || !menu || !transport || !(Number(win.innerWidth) >= SEAM_MIN_WIDTH)) {
      observeControls(new Map())
      clear()
      return
    }
    const lensRect = lens.getBoundingClientRect()
    const width = Number(lensRect.width) || 0
    const next = new Map()
    for (const node of menu.querySelectorAll(SEAM_TOP)) next.set(node, 'top')
    for (const node of transport.querySelectorAll(SEAM_BOTTOM)) next.set(node, 'bottom')
    observeControls(next)
    for (const node of posed) {
      if (!next.has(node)) clear([node])
    }
    for (const [node, edge] of next) {
      const rect = node.getBoundingClientRect()
      const x = Math.max(0, Math.min(width, (rect.left + rect.right) / 2 - lensRect.left))
      write(node, seamPose(x, width, edge))
    }
  }

  return {
    measure,
    stop() {
      if (frame) win.cancelAnimationFrame(frame)
      frame = 0
      resize?.disconnect()
      mutations?.disconnect()
      controls.clear()
      clear()
    },
  }
}

export function lensPoseStep(now, yaw, pitch, move = LENS_MOVE) {
  const pose = now && typeof now === 'object' ? now : { yaw: 0, pitch: 0 }
  const heading = Number.isFinite(yaw) ? yaw : pose.yaw
  const tilt = Number.isFinite(pitch) ? pitch : pose.pitch
  const nextYaw = Math.abs(heading - pose.yaw) > move ? heading : pose.yaw
  const nextPitch = Math.abs(tilt - pose.pitch) > move ? tilt : pose.pitch
  if (nextYaw === pose.yaw && nextPitch === pose.pitch) return pose
  return { yaw: nextYaw, pitch: nextPitch }
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
  return LENS_CARDINALS[degrees / 45] ?? ''
}

export function lensEdgeTicks(width = LENS_DEFAULT_WIDTH, yaw = 0) {
  const span = spanOf(width)
  if (span <= 0) return []
  const heading = compassHeading(yaw)
  const half = span / 2 / LENS_PIXELS_PER_DEGREE
  const first = Math.ceil((heading - half) / LENS_TICK_DEGREES) * LENS_TICK_DEGREES
  const last = heading + half
  const ticks = []
  for (let bearing = first; bearing <= last + 1e-9; bearing += LENS_TICK_DEGREES) {
    const normalized = bearingDegrees(bearing)
    const x = Math.round((span / 2 + (bearing - heading) * LENS_PIXELS_PER_DEGREE) * 1000) / 1000
    ticks.push({ x, tall: normalized % LENS_LABEL_DEGREES === 0, bearing: normalized })
  }
  return ticks
}

export function lensEdgeLabels(width = LENS_DEFAULT_WIDTH, yaw = 0) {
  const span = spanOf(width)
  return lensEdgeTicks(width, yaw)
    .filter((tick) => tick.tall && tick.x >= 24 && tick.x <= span - 24)
    .map((tick) => ({
      x: tick.x,
      bearing: tick.bearing,
      text: compassBearingLabel(tick.bearing),
    }))
}

export function isBridgeDown(live, snapshot, health) {
  return Boolean(live) && (['reconnecting', 'disconnected'].includes(snapshot?.status) || health?.ok === false)
}

function sameAgent(left, right) {
  return (
    left.key === right.key &&
    left.name === right.name &&
    left.id === right.id &&
    left.harness === right.harness &&
    left.model === right.model &&
    left.status === right.status &&
    left.label === right.label &&
    left.runs === right.runs &&
    left.parent === right.parent &&
    left.depth === right.depth
  )
}

function shownField(snapshot, field) {
  const value = Number(snapshot?.[field])
  if (!Number.isFinite(value)) return snapshot?.[field]
  return snapshot?.live ? Math.floor(value / 1000) : value
}

export function sameSnapshot(left, right) {
  if (left === right) return true
  if (!left || !right) return false
  if (
    shownField(left, 'position') !== shownField(right, 'position') ||
    shownField(left, 'duration') !== shownField(right, 'duration') ||
    left.playing !== right.playing ||
    left.speed !== right.speed ||
    left.live !== right.live ||
    left.status !== right.status
  ) {
    return false
  }
  const before = Array.isArray(left.agents) ? left.agents : []
  const after = Array.isArray(right.agents) ? right.agents : []
  if (before.length !== after.length) return false
  for (let index = 0; index < before.length; index += 1) {
    const one = before[index]
    const two = after[index]
    if (one === two) continue
    if (!one || !two) return false
    if (!sameAgent(one, two)) return false
  }
  return true
}

export function snapshotSink(player, setSnapshot, initial) {
  let last = initial
  return function publish() {
    const next = player.snapshot()
    if (last !== undefined && sameSnapshot(last, next)) return
    last = next
    setSnapshot(next)
  }
}

function LensEdge({ side, yaw = 0, disconnected = false }) {
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
  const lineY = top ? 0.5 : LENS_EDGE_HEIGHT + LENS_BOW - 0.5
  const band = LENS_EDGE_HEIGHT + LENS_BOW
  const curveY = (x) => (top ? lensBowAt(x, width) : band - lensBowAt(x, width))
  const rule = top
    ? `M 0 ${lineY} Q ${width / 2} ${lineY + LENS_BOW * 2} ${width} ${lineY}`
    : `M 0 ${lineY} Q ${width / 2} ${lineY - LENS_BOW * 2} ${width} ${lineY}`
  return (
    <div className={`lens-edge is-${side}${disconnected ? ' is-disconnected' : ''}`} ref={ref} aria-hidden="true">
      <span className="lens-edge-corner is-left" />
      <span className="lens-edge-corner is-right" />
      <span className="lens-edge-cross">+</span>
      <svg
        className="lens-edge-rule"
        width="100%"
        height={band}
        aria-hidden="true"
      >
        <path className="lens-edge-line" d={rule} />
        {top && lensEdgeTicks(width, yaw).map((tick) => {
          const length = tick.tall ? 11 : 5
          const curve = curveY(tick.x)
          return (
            <line
              key={`tick-${tick.x}`}
              className={`lens-edge-tick${tick.tall ? ' is-tall' : ''}`}
              x1={tick.x + 0.5}
              x2={tick.x + 0.5}
              y1={top ? curve + 1 : curve - 1}
              y2={top ? curve + length : curve - length}
            />
          )
        })}
        {top && lensEdgeLabels(width, yaw).map((label) => (
          <text
            key={`label-${label.x}`}
            className="lens-edge-label"
            x={label.x + 4}
            y={top ? curveY(label.x) + 22 : curveY(label.x) - 15}
          >
            {label.text}
          </text>
        ))}
      </svg>
    </div>
  )
}

export const LensCompass = memo(function LensCompass({ updateRef, disconnected = false }) {
  const [pose, setPose] = useState({ yaw: 0, pitch: 0 })
  const poseRef = useRef(pose)

  useEffect(() => {
    if (!updateRef) return undefined
    updateRef.current = (yaw) => {
      const next = lensPoseStep(poseRef.current, yaw, poseRef.current.pitch)
      if (next === poseRef.current) return
      poseRef.current = next
      setPose(next)
    }
    return () => {
      updateRef.current = null
    }
  }, [updateRef])

  return (
    <>
      <LensEdge side="top" yaw={pose.yaw} disconnected={disconnected} />
      <LensEdge side="bottom" yaw={pose.yaw} disconnected={disconnected} />
    </>
  )
})

function textBoxFocused() {
  const active = typeof document === 'undefined' ? null : document.activeElement
  if (!active) return false
  const tag = String(active.tagName ?? '').toUpperCase()
  return tag === 'INPUT' || tag === 'TEXTAREA' || active.isContentEditable === true
}

export default function Stage({ data, mode = 'replay', liveAvailable = false, onMode, fps = false, recorder = null }) {
  const surfaceRef = useRef(null)
  const glRef = useRef(null)
  const cssRef = useRef(null)
  const roomRef = useRef(null)
  const liveRosterRef = useRef(null)
  const [liveRoster, setLiveRoster] = useState(null)
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
  const [inspector, setInspector] = useState(null)
  const inspectorRef = useRef(null)
  inspectorRef.current = inspector
  const [following, setFollowing] = useState(false)
  const [idle, setIdle] = useState(false)
  const idleRef = useRef(false)
  const idleWatchRef = useRef(null)
  const bridgeDownRef = useRef(false)
  const [scrolled, setScrolled] = useState(false)
  const [liveLog, setLiveLog] = useState(NONE)
  const followRef = useRef(false)
  const [controlTarget, setControlTarget] = useState(null)
  const [effects, setEffects] = useState(() => loadEffectSettings(store()))
  const [chromaMap, setChromaMap] = useState('')
  const [lensSize, setLensSize] = useState({ width: 0, height: 0 })
  const layersRef = useRef(null)
  const [lensShare, setLensShare] = useState(() => loadSettings(store()).lensShare ?? null)
  const compassRef = useRef(null)
  const [zoom, setZoom] = useState({ share: 0, multiplier: 1 })

  function changeLensShare(next, save = true) {
    const share = clampLensShare(next)
    setLensShare(share)
    if (save) saveSettings(store(), { lensShare: share })
  }

  useEffect(() => {
    sound.setSettings(loadSoundSettings(store()))
    sound.armOnGesture()
    startMusicQueue()
  }, [])

  useEffect(() => {
    resetSoundFiles()
  }, [data.tree])

  useEffect(() => {
    const node = layersRef.current
    if (!node) return undefined
    const read = () => {
      const rect = typeof node.getBoundingClientRect === 'function' ? node.getBoundingClientRect() : null
      const width = Math.max(0, Math.round(Number(rect?.width) || 0))
      const height = Math.max(0, Math.round(Number(rect?.height) || 0))
      setLensSize((now) => (now.width === width && now.height === height ? now : { width, height }))
    }
    read()
    if (typeof ResizeObserver !== 'function') return undefined
    const observer = new ResizeObserver(read)
    observer.observe(node)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    if (typeof document === 'undefined' || typeof window === 'undefined') return undefined
    const sync = createSeamSync({ window, document })
    sync.measure()
    return () => sync.stop()
  }, [])

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
  const [orchestrators, setOrchestrators] = useState(NONE)
  const [labels, setLabels] = useState(null)
  const [familyNodes, setFamilyNodes] = useState(NONE)
  const [familyProposals, setFamilyProposals] = useState(NONE)
  const [toast, setToast] = useState('')
  const [openChips, setOpenChips] = useState(NONE)
  const [dockCosts, setDockCosts] = useState(null)
  const [dockLanes, setDockLanes] = useState(NONE)
  const [dockRuns, setDockRuns] = useState(NONE)
  const [dockTasks, setDockTasks] = useState(NONE)
  const [failures, setFailures] = useState(emptyFailureTray)
  const [dockRecords, setDockRecords] = useState(null)
  const targetCount = useRef(0)
  const latestBoardRef = useRef(null)
  const latestTasksRef = useRef(null)
  const latestLadderRef = useRef(null)
  const latestLabelsRef = useRef(null)
  const latestGitRef = useRef(null)
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
    if (next && next.recordMinutes !== undefined) recorder?.setMinutes(next.recordMinutes)
    const normalized = saveEffectSettings(store(), next)
    setEffects(normalized)
    setFineDust(normalized.dust)
    roomRef.current?.setOptions({ alwaysDepth: normalized.alwaysDepth, maxFiles: normalized.maxFiles })
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
  const inspectorTree = useMemo(() => {
    if (inspector?.kind !== 'folder') return null
    return {
      rootName: data.tree.rootName,
      files: [...player.state.files.keys()],
      dirs: [...player.state.dirs.keys()],
    }
  }, [inspector?.kind, player, data.tree.rootName, fileCount, dirCount])
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

  function showInspector(detail) {
    const next = inspectTarget(detail)
    if (!next) return null
    setInspector(next)
    if (next.kind === 'agent') setFocused(next.id)
    else setFocused(null)
    return next
  }

  function inspectHere(detail) {
    const next = showInspector(detail)
    if (!next) return
    setFollow(false)
    roomRef.current?.inspect(next)
  }

  function closeInspector() {
    roomRef.current?.clearSelection({ pins: false, pops: false })
    setInspector(null)
  }

  function navigateInspector(path) {
    setFollow(false)
    setFocused(null)
    const shown = roomRef.current?.focusPath(path) ?? false
    if (shown) setInspector({ kind: 'folder', id: path })
    return shown
  }

  function selectInspector(detail) {
    const next = showInspector(detail)
    if (!next) return
    setFollow(false)
    roomRef.current?.inspect(next)
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
        const pitch = roomRef.current?.pitch?.()
        compassRef.current?.(yaw, pitch)
        player.tick(ms)
        roomRef.current?.setBands(sound.bands())
        const dance = sound.dance()
        if (dance.beat > 0) roomRef.current?.setBeat(dance.beat)
        roomRef.current?.setSway(dance.sway)
      },
      onPick: (key) => {
        if (key === null || key === undefined) {
          followRef.current = false
          setFollowing(false)
          setFocused(null)
          setInspector(null)
          return
        }
        setFollow(false)
        room.inspect({ kind: 'agent', id: key })
        setFocused(key)
        setInspector({ kind: 'agent', id: key })
      },
      onInspect: (detail) => {
        showInspector(detail)
      },
      onDismiss: () => {
        setInspector(null)
      },
    })
    roomRef.current = room
    room.setOptions({ alwaysDepth: effects.alwaysDepth, maxFiles: effects.maxFiles })
    room.setBloom(effects.bloom)
    room.setIdle(idleRef.current)
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
    if (latestLabelsRef.current) {
      room.setLabels(latestLabelsRef.current)
    }
    if (latestGitRef.current) {
      room.setGitState(latestGitRef.current)
    }
    setOpenChips(NONE)
    if (!live) {
      const saved = loadSettings(store()).speed
      if (SPEEDS.includes(saved)) player.setSpeed(saved)
    }
    player.play()
    const publish = snapshotSink(player, setSnapshot, snapshot)
    const timer = setInterval(publish, 120)
    const unsubscribe = player.subscribe(publish)
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
      setOrchestrators(NONE)
      roomRef.current?.setLadder(demoLadder)
      return undefined
    }
    if (!live) {
      apply(null)
      setOrchestrators(NONE)
      roomRef.current?.setLadder(null)
      return undefined
    }
    if (!client || typeof client.orchestrators !== 'function') {
      apply(null)
      setOrchestrators(NONE)
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
        setOrchestrators(orchestratorAnswerList(answer))
        roomRef.current?.setLadder(next)
      } catch {
        if (!active || !isLatest()) return
        apply(null)
        setOrchestrators(NONE)
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
    function apply(next) {
      latestLabelsRef.current = next
      setLabels(next)
    }
    if (!live || !client || typeof client.family !== 'function') {
      apply(null)
      setFamilyNodes(NONE)
      setFamilyProposals(NONE)
      roomRef.current?.setLabels(null)
      return undefined
    }
    let active = true
    const latest = latestOnly()

    async function updateLabels() {
      const isLatest = latest()
      try {
        const answer = await client.family()
        if (!active || !isLatest()) return
        const next = labelsFromFamily(answer)
        apply(next)
        setFamilyNodes(Array.isArray(answer?.nodes) ? answer.nodes : NONE)
        setFamilyProposals(Array.isArray(answer?.proposals) ? answer.proposals : NONE)
        roomRef.current?.setLabels(next)
      } catch {
        if (!active || !isLatest()) return
        apply(null)
        setFamilyNodes(NONE)
        setFamilyProposals(NONE)
        roomRef.current?.setLabels(null)
      }
    }

    updateLabels()
    const timer = setInterval(updateLabels, 60000)
    const unsubscribe = subscribeToNotices(client, ['family'], updateLabels)

    return () => {
      active = false
      clearInterval(timer)
      unsubscribe()
    }
  }, [client, live])

  useEffect(() => {
    function apply(next) {
      latestGitRef.current = next
      roomRef.current?.setGitState(next)
    }
    if (!live || live.simulated || !client || typeof client.gitState !== 'function') {
      apply(null)
      return undefined
    }
    let active = true
    const latest = latestOnly()

    async function updateGit() {
      const isLatest = latest()
      try {
        const answer = await client.gitState()
        if (!active || !isLatest()) return
        apply(answer)
      } catch {
        if (!active || !isLatest()) return
        apply(null)
      }
    }

    updateGit()
    const timer = setInterval(updateGit, 60000)
    const unsubscribe = subscribeToNotices(client, ['git'], updateGit)

    return () => {
      active = false
      clearInterval(timer)
      unsubscribe()
    }
  }, [client, live])

  useEffect(() => {
    if (!live || live.simulated) return undefined
    let active = true
    const latest = latestOnly()

    function apply(next) {
      if (typeof next === 'boolean') roomRef.current?.setOnline(next)
    }

    async function updateNetwork() {
      if (typeof client?.network !== 'function') return
      const isLatest = latest()
      try {
        const answer = await client.network()
        if (!active || !isLatest()) return
        apply(answer?.online)
      } catch {}
    }

    function onOnline() {
      apply(true)
    }

    function onOffline() {
      apply(false)
    }

    updateNetwork()
    const timer = setInterval(updateNetwork, 30000)
    const unsubscribe = subscribeToNotices(client, ['network'], updateNetwork)
    window.addEventListener('online', onOnline)
    window.addEventListener('offline', onOffline)

    return () => {
      active = false
      clearInterval(timer)
      unsubscribe()
      window.removeEventListener('online', onOnline)
      window.removeEventListener('offline', onOffline)
    }
  }, [client, live])

  useEffect(() => {
    function onShowGitTree() {
      inspectHere({ kind: 'git', id: 'git' })
    }
    window.addEventListener('machineroom:show-git-tree', onShowGitTree)
    return () => window.removeEventListener('machineroom:show-git-tree', onShowGitTree)
  }, [])

  useEffect(() => {
    function onInspect(event) {
      inspectHere(event.detail)
    }
    window.addEventListener(INSPECT_EVENT, onInspect)
    return () => window.removeEventListener(INSPECT_EVENT, onInspect)
  }, [])

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
        setLiveRoster(next)
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
    let active = true

    async function updateDepth() {
      if (!client || typeof client.agentDepth !== 'function') {
        setDepthLimit(player.state, MAX_DEPTH)
        return
      }
      try {
        const answer = await client.agentDepth()
        if (!active) return
        setDepthLimit(player.state, answer)
      } catch {
        if (!active) return
        setDepthLimit(player.state, MAX_DEPTH)
      }
    }

    updateDepth()
    const unsubscribe = subscribeToNotices(client, ['agents'], updateDepth)

    return () => {
      active = false
      unsubscribe()
    }
  }, [client, player])

  useEffect(() => {
    setFineDust(effects.dust)
    roomRef.current?.setOptions({ alwaysDepth: effects.alwaysDepth, maxFiles: effects.maxFiles })
    roomRef.current?.setBloom(effects.bloom)
  }, [effects.alwaysDepth, effects.maxFiles, effects.dust, effects.bloom])

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
      setDockLanes(NONE)
      setDockRuns(NONE)
      setDockTasks(NONE)
      setDockRecords(null)
      return undefined
    }
    let active = true
    const latest = latestOnly()

    async function updateTasks() {
      const isLatest = latest()
      try {
        const [agentsRaw, issuesRaw, liveRunsRaw, recordsRaw] = await Promise.all([
          client.agents(),
          client.issues(),
          client.liveRuns(),
          typeof client.runs === 'function' ? client.runs().catch(() => null) : null,
        ])
        if (!active || !isLatest()) return
        const roster = toAgents(Array.isArray(agentsRaw) ? agentsRaw : [])
        const tasks = agentTasks(liveRunsRaw, issuesRaw, roster)
        latestTasksRef.current = tasks
        roomRef.current?.setTasks(tasks)
        setDockLanes(Array.isArray(agentsRaw) ? agentsRaw : NONE)
        setDockRuns(Array.isArray(liveRunsRaw) ? liveRunsRaw : NONE)
        setDockTasks(Array.isArray(issuesRaw) ? issuesRaw : NONE)
        setDockRecords(recordsRaw && typeof recordsRaw === 'object' ? recordsRaw : null)
      } catch {
        if (!active || !isLatest()) return
        latestTasksRef.current = null
        roomRef.current?.setTasks(null)
        setDockLanes(NONE)
        setDockRuns(NONE)
        setDockTasks(NONE)
        setDockRecords(null)
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
        recorder?.push(frame)
        const activities = pipeline.push(frame)
        player.push(activities)
        if (activities.length > 0) {
          setFailures((current) => addFailureActivities(current, activities))
        }
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
    if (!live.simulated && !live.bridge) return undefined
    const link = live.simulated
      ? openSimulated({ frames: live.frames, speed: live.speed, ...handlers })
      : openBridge({ url: live.bridge, ...handlers })
    return () => link.close()
  }, [agents, data, live, player])

  useEffect(() => {
    function onKey(event) {
      handleRoomKey(event, {
        player,
        room: roomRef,
        follow: followRef,
        inspector: inspectorRef,
        agents,
        closeInspector,
        parkRoom,
        setFollow,
        setOpenChips,
        setFocused,
        changeSpeed,
      })
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
    roomRef.current?.inspect({ kind: 'agent', id: key })
    setFocused(key)
    setInspector({ kind: 'agent', id: key })
  }

  function toggleTerminal(key) {
    setOpenChips(roomRef.current?.toggleTerminal(key) ?? NONE)
  }

  function showTerminals(open) {
    roomRef.current?.openTerminals(open)
    setOpenChips(roomRef.current?.openTerminalKeys() ?? NONE)
  }

  function parkRoom() {
    setFollow(false)
    roomRef.current?.park()
    setFocused(null)
    setInspector(null)
  }

  function onEmptyDoubleClick(event) {
    if (event.target?.closest?.('.mr-card, .mr-term, .mr-term-console, .mr-board, .mr-inspector')) return
    if (roomRef.current?.agentAt?.(event)) return
    if (roomRef.current?.gitAt?.(event)) {
      inspectHere({ kind: 'git', id: 'git' })
      return
    }
    parkRoom()
  }

  function overview() {
    parkRoom()
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
  const bridgeDown = isBridgeDown(live, snapshot, health)
  bridgeDownRef.current = bridgeDown
  const showWaiting = Boolean(live) && (idleSoFar || linkTrouble)
  const orchestratorActivity = orchestratorDoing(snapshot.agents)

  useEffect(() => {
    function apply(on) {
      idleRef.current = on
      setIdle(on)
      roomRef.current?.setIdle?.(on)
    }
    const watch = createIdleWatch({
      isAllowed: () =>
        !bridgeDownRef.current &&
        idleAllowed({
          width: window.innerWidth,
          scrollY: window.scrollY ?? window.pageYOffset ?? 0,
          panelOpen: Boolean(inspectorRef.current) || Boolean(document.querySelector(IDLE_PANEL)),
          focusedInput: textBoxFocused(),
          following: Boolean(followRef.current),
          holding: roomRef.current?.free ? !roomRef.current.free() : true,
          still: still(),
        }),
      onIdle: apply,
    })
    idleWatchRef.current = watch
    return () => {
      watch.stop()
      idleWatchRef.current = null
      idleRef.current = false
      setIdle(false)
      roomRef.current?.setIdle?.(false)
    }
  }, [])

  useEffect(() => {
    if (bridgeDown) idleWatchRef.current?.halt()
    else idleWatchRef.current?.arm()
  }, [bridgeDown])

  useEffect(() => {
    let current = (window.scrollY ?? window.pageYOffset ?? 0) > 0
    setScrolled(current)
    function onScroll() {
      const next = (window.scrollY ?? window.pageYOffset ?? 0) > 0
      if (next === current) return
      current = next
      setScrolled(next)
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  const chromaOn = Boolean(effects.aberration?.on && effects.aberration?.strength > 0)
  const chromaChannels = aberrationChannels(effects.aberration?.strength)
  const chromaFilter = chromaOn && chromaMap ? 'url(#mr-screen-filter)' : undefined
  const chromaPlacement = chromaOn
    ? mapPlacement({ width: lensSize.width, height: lensSize.height })
    : null
  const clipLens = lensSize.width > 0 && lensSize.height > 0
  const layersStyle = {}
  if (chromaFilter) layersStyle.filter = chromaFilter
  if (clipLens) layersStyle.clipPath = 'url(#mr-lens-clip)'

  const lens = lensStatus(snapshot.agents, log)
  const project = lensProject(data.tree.rootName)
  const clock = lensClock(Boolean(live), snapshot.position)
  const emptyLine = emptyRoomLine({
    live: Boolean(live),
    simulated: Boolean(live?.simulated),
    status: snapshot.status,
    files: fileCount,
    agents: snapshot.agents,
  })
  const bridgeLive = Boolean(live) && !live.simulated
  const workingInspector = snapshot.agents.find((agent) => agent.status === 'working') ?? null
  const inspectorLanes = snapshot.agents.map((agent) => {
    const calls = roomRef.current?.callsFor?.(agent.key)
    return calls && calls.count > 0 ? { ...agent, openCalls: calls.count, tool: calls.tool } : agent
  })
  const inspectorTouches = inspector?.kind === 'file' ? roomRef.current?.touches?.(inspector.id) ?? NONE : NONE
  const webAgents = roomRef.current?.webAgents?.() ?? NONE
  const failureList = failureRows(failures, FAILURE_TRAY_LIMIT)
  const lanePills = useMemo(
    () => ({ agents: dockLanes, liveRuns: dockRuns, issues: dockTasks, records: dockRecords, labels }),
    [dockLanes, dockRuns, dockTasks, dockRecords, labels]
  )
  const failureName = (key) => {
    const agent = snapshot.agents.find((entry) => entry.key === key)
    if (!agent) return key
    return labels ? displayName(agent.key, labels) : agent.name
  }

  return (
    <LiveBadgeContext.Provider value={live?.simulated ? 'demo' : 'live'}>
      <div className={stageClassName({ disconnected: bridgeDown, idle, scrolled })} style={{ '--lens-bow': `${LENS_BOW}px`, ...(lensShare === null ? null : { '--lens-h-user': lensHeightValue(lensShare) }) }}>
        {clipLens && (
          <svg
            className="lens-clip-defs"
            aria-hidden="true"
            style={{ position: 'absolute', width: 0, height: 0, pointerEvents: 'none', overflow: 'hidden' }}
          >
            <defs>
              <clipPath id="mr-lens-clip" clipPathUnits="userSpaceOnUse">
                <path d={lensClipPath(lensSize.width, lensSize.height)} />
              </clipPath>
            </defs>
          </svg>
        )}
        <div className={`lens${bridgeDown ? ' is-disconnected' : ''}`}>
          <LensCompass updateRef={compassRef} disconnected={bridgeDown} />
          <div className="lens-frame" ref={surfaceRef} onDoubleClick={onEmptyDoubleClick}>
            <div
              className="surface-layers"
              ref={layersRef}
              style={layersStyle}
            >
              <div className="layer" ref={cssRef} aria-hidden="true" />
              <div className="layer is-over" ref={glRef} aria-hidden="true" />
            </div>
            <div className="screen-effects-overlay" aria-hidden="true" style={clipLens ? { clipPath: 'url(#mr-lens-clip)' } : undefined}>
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
            {mode === 'live' && live && failureList.rows.length > 0 && (
              <div className="lens-failures" role="region" aria-label="Failures">
                <div className="lens-failures-head">
                  <span className="lens-failures-title mono">Failures</span>
                  {failureList.more > 0 && (
                    <span className="lens-failures-more mono">{`+${failureList.more}`}</span>
                  )}
                  <button
                    type="button"
                    className="lens-failures-clear mono"
                    onClick={() => setFailures(emptyFailureTray())}
                  >
                    Clear
                  </button>
                </div>
                {failureList.rows.map((row) => (
                  <button
                    key={row.id}
                    type="button"
                    className="lens-failure"
                    aria-label={`Inspect ${failureName(row.agent)}`}
                    onClick={() => focus(row.agent)}
                  >
                    <span className="lens-failure-agent">{failureName(row.agent)}</span>
                    <span className="lens-failure-text">{row.text}</span>
                    <span className="lens-failure-age mono">{failureAge(row.at, Date.now())}</span>
                  </button>
                ))}
              </div>
            )}
            {inspector && (
              <Inspector
                target={inspector}
                live={Boolean(live)}
                bridge={bridgeLive}
                client={client}
                lanes={inspectorLanes}
                working={workingInspector}
                costs={dockCosts}
                liveRuns={dockRuns}
                tasks={dockTasks}
                log={log}
                orchestrator={orchestrators}
                family={familyNodes}
                tree={inspectorTree}
                touches={inspectorTouches}
                webAgents={webAgents}
                onClose={closeInspector}
                onSelect={selectInspector}
                onOpenPath={navigateInspector}
              />
            )}
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
          {showWaiting && (
            <div className="lens-waiting">
              {emptyLine !== '' && <p className="lens-empty-room mono">{emptyLine}</p>}
              <Waiting agents={liveRoster ?? snapshot.agents} status={snapshot.status} />
            </div>
          )}
        </div>
        {chromaFilter && (
          <svg
            className="screen-filter-defs"
            aria-hidden="true"
            style={{ position: 'absolute', width: 0, height: 0, pointerEvents: 'none', overflow: 'hidden' }}
          >
            <defs>
              <filter id="mr-screen-filter" x="-6%" y="-6%" width="112%" height="112%" colorInterpolationFilters="sRGB">
                <feImage
                  href={chromaMap}
                  x={chromaPlacement.x}
                  y={chromaPlacement.y}
                  width={chromaPlacement.width}
                  height={chromaPlacement.height}
                  preserveAspectRatio="none"
                  result="radial"
                />
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
            <OrchestratorsContext.Provider value={orchestrators}>
              <LanePillsContext.Provider value={lanePills}>
                <TransportCostsContext.Provider value={dockCosts}>
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
                    familyProposals={familyProposals}
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
                    labels={labels}
                    effects={effects}
                    onSettingsChange={handleSettingsChange}
                  />
                </TransportCostsContext.Provider>
              </LanePillsContext.Provider>
            </OrchestratorsContext.Provider>
          </CostsModeContext.Provider>
        </OrchestratorActivity.Provider>
      </div>
    </LiveBadgeContext.Provider>
  )
}
