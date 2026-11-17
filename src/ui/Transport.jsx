import { createContext, useContext, useEffect, useRef, useState } from 'react'
import {
  contextLabel,
  contextShare,
  contextTitle,
  contextTone,
} from './contextRing.js'
import { OPEN_CHAT_EVENT, hasWaitingApproval, orchestratorChips } from './transportOrchestrators.js'
import { inspectLane, lanePillTitle, lanePills } from './transportLanes.js'
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
    document.addEventListener('pointerdown', closeOutside)
    document.addEventListener('keydown', closeEscape)
    return () => {
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
            includeIdle: true,
          })
        : { pills: [], more: 0 }
    const working = chips.filter((chip) => chip.tone === 'working').length + lanes.pills.filter((lane) => lane.state === 'working').length
    const waiting = chips.filter((chip) => chip.waiting).length + (hasWaitingApproval(main) ? 1 : 0)
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
            {chips.length + lanes.pills.length} agents{working > 0 ? ` · ${working} working` : null}
            {waiting > 0 ? <span className="transport-agents-waiting"> · {waiting} waiting</span> : null}
          </button>
          {listOpen ? (
            <div className="transport-agents-list" role="group" aria-label="Agents">
              {chips.map((chip) => (
                <button key={chip.id} type="button" className="transport-agent mono" onClick={() => { setListOpen(false); openOrchestratorChat(chip.id) }}>
                  <span>{chip.name}</span><span>{chip.waiting ? 'waiting for you' : chip.tone}</span>
                </button>
              ))}
              {lanes.pills.map((pill) => (
                <button key={pill.key} type="button" className="transport-agent mono" aria-label={`${lanePillTitle(pill)}. Inspect this lane`} onClick={() => { setListOpen(false); inspectLane(pill.key) }}>
                  <span>{pill.label}</span><span>{pill.state}</span>{pill.task ? <span>{pill.task}</span> : null}
                  {pill.minutes !== null && pill.state !== 'failed' ? <span>{pill.minutes} min</span> : null}
                  {pill.step ? <span>{pill.step}</span> : null}
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
          <div className="scrubber-markers" role="group" aria-label="Run markers">
            {markers.map((marker, index) => {
              const pct = Math.min(100, Math.max(0, (marker.at / duration) * 100))
              return (
                <button
                  key={`${marker.at}-${marker.tone}-${index}`}
                  type="button"
                  className={`scrubber-tick is-${marker.tone}`}
                  style={{ left: `${pct}%` }}
                  onClick={() => onSeek(marker.at)}
                  aria-label={`Seek to ${marker.tone} at ${clock(marker.at)}`}
                />
              )
            })}
          </div>
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
