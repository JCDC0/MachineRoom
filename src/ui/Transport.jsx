import { createContext, useContext, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import {
  contextLabel,
  contextShare,
  contextTitle,
  contextTone,
} from './contextRing.js'
import { OPEN_CHAT_EVENT, hasWaitingApproval, orchestratorChips } from './transportOrchestrators.js'
import { ROOM_LINGER_MS, agentListPosition, ageText, inspectLane, lanePillTitle, lanePills } from './transportLanes.js'
import { showCostBoard, spendText } from './transportSpend.js'

export const LiveBadgeContext = createContext('live')
export const OrchestratorsContext = createContext(null)
export const LanePillsContext = createContext(null)
export const TransportCostsContext = createContext(null)

export function liveBadgeText(status, kind = 'live') {
  const state = status === 'live' ? 'connected' : status || 'connecting'
  return `${kind === 'demo' ? 'Demo' : 'Live'} // ${state}`
}

function clock(ms) {
  const total = Math.max(0, Math.floor(ms / 1000))
  const minutes = String(Math.floor(total / 60)).padStart(2, '0')
  const seconds = String(total % 60).padStart(2, '0')
  return `${minutes}:${seconds}`
}

function scrubberBounds(position, duration) {
  const max = Number.isFinite(duration) ? Math.round(duration) : 0
  const value = Number.isFinite(position) ? Math.min(Math.round(position), max) : 0
  return { max, value }
}

function markerLayout(markers, duration, width) {
  const gap = 6
  const ticks = markers.map((marker, index) => ({
    ...marker,
    index,
    row: 0,
    share: Math.min(1, Math.max(0, marker.at / duration)),
  })).sort((a, b) => a.share - b.share)
  if (width === 0) return { ticks, groups: [], rows: 1 }
  const rowEnds = []
  const groups = []
  for (const tick of ticks) {
    const x = tick.share * width
    const freeRow = rowEnds.findIndex((end) => x - end >= gap)
    const row = freeRow < 0 ? Math.min(rowEnds.length, 2) : freeRow
    tick.row = row
    if (row === 2) {
      if (rowEnds[row] === undefined || x - rowEnds[row] >= gap) groups.push([])
      tick.group = groups.length - 1
      groups[tick.group].push(tick)
    }
    rowEnds[row] = x
  }
  return { ticks, groups, rows: rowEnds.length }
}

function positionMarkerChooser(button, chooser) {
  const { left, width, top, bottom } = button.getBoundingClientRect()
  const spaceBelow = window.innerHeight - bottom
  const above = top >= 64 || top >= spaceBelow
  chooser.setAttribute('data-side', above ? 'above' : 'below')
  chooser.style.setProperty('--marker-x', `${left + width / 2}px`)
  chooser.style.setProperty('--marker-edge', `${above ? window.innerHeight - top : bottom}px`)
}

function ScrubberMarkers({ markers, duration, onSeek }) {
  const rail = useRef(null)
  const chooserButton = useRef(null)
  const id = useId()
  const [width, setWidth] = useState(0)
  useLayoutEffect(() => {
    const node = rail.current
    setWidth(node.getBoundingClientRect().width)
    if (typeof ResizeObserver !== 'function') return undefined
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width))
    observer.observe(node)
    return () => observer.disconnect()
  }, [])
  useEffect(() => {
    const reposition = () => {
      const button = chooserButton.current
      const chooser = button?.popoverTargetElement
      if (chooser?.matches(':popover-open')) positionMarkerChooser(button, chooser)
    }
    window.addEventListener('resize', reposition)
    window.addEventListener('scroll', reposition, true)
    return () => {
      window.removeEventListener('resize', reposition)
      window.removeEventListener('scroll', reposition, true)
    }
  }, [])
  const { ticks, groups, rows } = useMemo(() => markerLayout(markers, duration, width), [markers, duration, width])

  const placeChooser = (event) => {
    const button = event.currentTarget
    const chooser = button.popoverTargetElement
    if (!chooser) return
    chooserButton.current = button
    positionMarkerChooser(button, chooser)
  }

  return (
    <div ref={rail} className="scrubber-markers" data-rows={rows} style={{ '--marker-rows': rows }} role="group" aria-label="Run markers">
      {ticks.map(({ at, tone, index, share, row, group }) => {
        const shared = groups[group]?.length > 1
        return (
          <button
            key={`${at}-${tone}-${index}`}
            type="button"
            className={`scrubber-tick is-${tone}`}
            style={{ left: `${share * 100}%`, '--marker-row': row }}
            popoverTarget={shared ? `${id}-${group}` : undefined}
            onClick={shared ? placeChooser : () => onSeek(at)}
            aria-label={shared ? `Choose a run marker near ${clock(at)}` : `Seek to ${tone} at ${clock(at)}`}
          />
        )
      })}
      {groups.map((group, index) => group.length > 1 && (
        <div key={index} id={`${id}-${index}`} className="scrubber-overflow" popover="auto" role="group" aria-label="Choose a run marker">
          {group.map(({ at, tone, index: markerIndex }) => (
            <button key={markerIndex} type="button" popoverTarget={`${id}-${index}`} popoverTargetAction="hide" onClick={() => onSeek(at)}>
              {tone} at {clock(at)}.{String(Math.floor(at % 1000)).padStart(3, '0')}
            </button>
          ))}
        </div>
      ))}
    </div>
  )
}

function reducedMotion() {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  )
}

export function openConversation() {
  if (typeof document === 'undefined') return
  const main = document.querySelector('.hud-lower-main')
  if (main && typeof main.scrollIntoView === 'function') {
    main.scrollIntoView({ behavior: reducedMotion() ? 'auto' : 'smooth', block: 'start' })
  }
  const input = document.querySelector('.mr-orch-input')
  if (input && typeof input.focus === 'function') input.focus({ preventScroll: true })
}

function openOrchestratorChat(id) {
  const canDispatch =
    typeof window !== 'undefined' &&
    typeof window.dispatchEvent === 'function' &&
    typeof window.CustomEvent === 'function'
  if (canDispatch) {
    window.dispatchEvent(new window.CustomEvent(OPEN_CHAT_EVENT, { detail: { id } }))
  }
  openConversation()
}

export function ContextRing({ orchestrator = null, onClick = () => {} }) {
  const tokens = orchestrator?.contextTokens
  const window = orchestrator?.contextWindow
  const share = contextShare(tokens, window)
  const tone = contextTone(share, orchestrator?.autocompactPercent)
  const label = contextLabel(tokens, window)
  const title = contextTitle(tokens, window)
  const arc = share === null ? 0 : Math.round(share * 1000) / 10
  return (
    <button
      type="button"
      className={`transport-context is-${tone}`}
      onClick={onClick}
      title={title || undefined}
      aria-label={`${title || 'Context not reported'}. Open the conversation`}
    >
      <svg
        className="transport-context-ring"
        viewBox="0 0 24 24"
        width="22"
        height="22"
        aria-hidden="true"
      >
        <circle className="transport-context-track" cx="12" cy="12" r="10.5" />
        {share !== null && (
          <circle
            className="transport-context-arc"
            cx="12"
            cy="12"
            r="10.5"
            pathLength="100"
            strokeDasharray={`${arc} 100`}
            transform="rotate(-90 12 12)"
          />
        )}
      </svg>
      <span className="transport-context-label mono">{label}</span>
    </button>
  )
}

export default function Transport({ snapshot, speeds, markers = [], orchestrator = null, onToggle, onSeek, onSpeed, onOverview }) {
  const { position, duration, playing, speed } = snapshot
  const finished = position >= duration
  const main = orchestrator && typeof orchestrator === 'object' ? orchestrator : null
  const [listOpen, setListOpen] = useState(false)
  const listRef = useRef(null)
  useEffect(() => {
    if (!listOpen) return undefined
    const closeOutside = (event) => { if (!listRef.current?.contains(event.target)) setListOpen(false) }
    const closeEscape = (event) => { if (event.key === 'Escape') setListOpen(false) }
    const measure = () => {
      const button = listRef.current?.querySelector('.transport-agents-toggle')?.getBoundingClientRect()
      if (!button) return
      const menuBottom = document.querySelector('.hud-menu')?.getBoundingClientRect().bottom ?? 0
      const position = agentListPosition(button, window.innerHeight, menuBottom)
      listRef.current?.style.setProperty('--agents-list-height', `${position.height}px`)
      listRef.current?.style.setProperty('--agents-list-bottom', `${position.bottom}px`)
      listRef.current?.style.setProperty('--agents-list-left', `${position.left}px`)
    }
    measure()
    window.addEventListener('resize', measure)
    window.addEventListener('scroll', measure, true)
    document.addEventListener('pointerdown', closeOutside)
    document.addEventListener('keydown', closeEscape)
    return () => {
      window.removeEventListener('resize', measure)
      window.removeEventListener('scroll', measure, true)
      document.removeEventListener('pointerdown', closeOutside)
      document.removeEventListener('keydown', closeEscape)
    }
  }, [listOpen])
  const orchestrators = useContext(OrchestratorsContext)
  const laneFeed = useContext(LanePillsContext)
  const costs = useContext(TransportCostsContext)
  const badge = snapshot.status === 'live' ? null : (
    <span className="transport-badge is-down" role="status">{snapshot.status || 'connecting'}</span>
  )

  if (snapshot.live) {
    if (!main) {
      return (
        <div className="transport is-live">
          <div className="transport-live-head">
            {badge}
            <button
              type="button"
              className="transport-center mono"
              onClick={onOverview}
              aria-label="Center camera"
              title="Center camera"
            >
              Center
            </button>
          </div>
          <span className="mono">{clock(position)} since opening</span>
        </div>
      )
    }
    const { chips } = orchestratorChips(orchestrators, Number.MAX_SAFE_INTEGER)
    const lanes =
      laneFeed && typeof laneFeed === 'object'
        ? lanePills({
            agents: laneFeed.agents,
            liveRuns: laneFeed.liveRuns,
            issues: laneFeed.issues,
            records: laneFeed.records,
            labels: laneFeed.labels,
            now: laneFeed.now ?? Date.now(),
            limit: Number.MAX_SAFE_INTEGER,
            includeIdle: false,
            lingerMs: ROOM_LINGER_MS,
          })
        : { pills: [], more: 0 }
    const sessions = (Array.isArray(snapshot.agents) ? snapshot.agents : []).filter(
      (agent) => String(agent?.key ?? '').endsWith('-session') && agent.status === 'working'
    )
    const mainWorking = main?.state === 'working'
    const mainWaiting = hasWaitingApproval(main)
    const working =
      sessions.length +
      (mainWorking ? 1 : 0) +
      chips.filter((chip) => chip.tone === 'working').length +
      lanes.pills.filter((lane) => lane.tone === 'working').length
    const waiting = chips.filter((chip) => chip.waiting).length + (mainWaiting ? 1 : 0)
    const spend = spendText(costs)
    return (
      <div className="transport is-live has-orchestrator">
        <div className="transport-live-head">
          {badge}
          <button
            type="button"
            className="transport-center mono"
            onClick={onOverview}
            aria-label="Center camera"
            title="Center camera"
          >
            Center
          </button>
        </div>
        <div className="transport-agents" ref={listRef}>
          <button type="button" className="transport-agents-toggle transport-orchestrator mono" aria-expanded={listOpen} onClick={() => setListOpen(!listOpen)}>
            {working > 0 ? `Agents · ${working} working` : 'Agents · none working'}
            {waiting > 0 ? <span className="transport-agents-waiting"> · {waiting} waiting</span> : null}
          </button>
          {listOpen ? (
            <div className="transport-agents-list" role="group" aria-label="Agents">
              {sessions.map((agent) => (
                <div key={agent.key} className="transport-agent mono">
                  <span>{agent.name || agent.key}</span><span className="transport-agent-state is-working">working</span><span>{String(agent.label ?? '').slice(0, 40)}</span><span></span>
                </div>
              ))}
              {mainWorking || mainWaiting ? (
                <button key="orchestrator" type="button" className="transport-agent mono" onClick={() => { setListOpen(false); openOrchestratorChat('orchestrator') }}>
                  <span>Orchestrator</span><span className={`transport-agent-state is-${mainWaiting ? 'waiting' : 'working'}`}>{mainWaiting ? 'waiting for you' : 'working'}</span><span></span><span></span>
                </button>
              ) : null}
              {chips.map((chip) => (
                <button key={chip.id} type="button" className="transport-agent mono" onClick={() => { setListOpen(false); openOrchestratorChat(chip.id) }}>
                  <span>{chip.name}</span><span className={`transport-agent-state is-${chip.waiting ? 'waiting' : chip.tone}`}>{chip.waiting ? 'waiting for you' : chip.tone}</span><span></span><span></span>
                </button>
              ))}
              {lanes.pills.map((pill) => (
                <button key={pill.key} type="button" className="transport-agent mono" aria-label={`${lanePillTitle(pill)}. Inspect this lane`} onClick={() => { setListOpen(false); inspectLane(pill.key) }}>
                  <span>{pill.label}</span><span className={`transport-agent-state is-${pill.state}`}>{pill.state}</span><span>{[pill.task, pill.step].filter(Boolean).join(' ')}</span>
                  <span>{pill.state === 'failed' || pill.state === 'finished' || pill.state === 'succeeded' ? ageText(pill.minutes) : pill.minutes !== null ? `${pill.minutes} min` : ''}</span>
                </button>
              ))}
            </div>
          ) : null}
        </div>
        <div className="transport-tail">
          {spend ? (
            <button
              type="button"
              className="transport-spend mono"
              onClick={() => showCostBoard()}
              title="Show the cost board"
              aria-label={`${spend}. Show the cost board`}
            >
              {spend}
            </button>
          ) : null}
          <ContextRing orchestrator={main} onClick={openConversation} />
          <span className="mono">{clock(position)} since opening</span>
        </div>
      </div>
    )
  }

  const scrubber = scrubberBounds(position, duration)

  return (
    <div className="transport">
      <button type="button" onClick={onToggle} aria-label={playing ? 'Pause replay' : 'Play replay'}>
        {playing ? 'Pause' : finished ? 'Replay' : 'Play'}
      </button>
      <div className="scrubber">
        <input
          type="range"
          min="0"
          max={scrubber.max}
          value={scrubber.value}
          onChange={(event) => onSeek(Number(event.target.value))}
          aria-label="Replay position"
        />
        {duration > 0 && markers.length > 0 && (
          <ScrubberMarkers markers={markers} duration={duration} onSeek={onSeek} />
        )}
      </div>
      <span className="mono">
        {clock(position)} / {clock(duration)}
      </span>
      <div className="speeds" role="group" aria-label="Replay speed">
        {speeds.map((value) => (
          <button key={value} type="button" aria-pressed={value === speed} onClick={() => onSpeed(value)}>
            {value}x
          </button>
        ))}
      </div>
    </div>
  )
}
