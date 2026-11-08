import { createContext, useContext } from 'react'
import {
  contextLabel,
  contextShare,
  contextTitle,
  contextTone,
  orchestratorStateWord,
} from './contextRing.js'
import { OPEN_CHAT_EVENT, orchestratorChips } from './transportOrchestrators.js'
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
  const badgeKind = useContext(LiveBadgeContext)
  const orchestrators = useContext(OrchestratorsContext)
  const laneFeed = useContext(LanePillsContext)
  const costs = useContext(TransportCostsContext)
  const badge = (
    <span className={`transport-badge is-${snapshot.status === 'live' ? 'live' : 'down'}`} role="status">
      {liveBadgeText(snapshot.status, badgeKind)}
    </span>
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
    const waiting = Array.isArray(main.approvals) && main.approvals.length > 0
    const state = waiting ? 'waiting for you' : orchestratorStateWord(main.state)
    const { chips, more } = orchestratorChips(orchestrators)
    const lanes =
      laneFeed && typeof laneFeed === 'object'
        ? lanePills({
            agents: laneFeed.agents,
            liveRuns: laneFeed.liveRuns,
            issues: laneFeed.issues,
            records: laneFeed.records,
            labels: laneFeed.labels,
            now: laneFeed.now ?? Date.now(),
          })
        : { pills: [], more: 0 }
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
        <div className="transport-orchestrators">
          <button
            type="button"
            className="transport-orchestrator"
            aria-label={`Orchestrator ${state}. Open the conversation`}
            onClick={openConversation}
          >
            <span className="transport-orchestrator-title mono">Orchestrator</span>
            <span className="transport-orchestrator-state mono">{state}</span>
          </button>
          {chips.map((chip) => (
            <button
              key={chip.id}
              type="button"
              className={`transport-chip is-${chip.tone} mono`}
              aria-label={`${chip.name}. Open the conversation`}
              title={`${chip.name} ${chip.tone}`}
              onClick={() => openOrchestratorChat(chip.id)}
            >
              <span className="transport-chip-dot" aria-hidden="true" />
              <span className="transport-chip-name">{chip.name}</span>
            </button>
          ))}
          {more > 0 ? (
            <span className="transport-chip-overflow mono" title={`${more} more`}>
              +{more}
            </span>
          ) : null}
          {lanes.pills.length > 0 ? (
            <div className="transport-lanes" role="group" aria-label="Lanes">
              {lanes.pills.map((pill) => (
                <button
                  key={pill.key}
                  type="button"
                  className={`transport-lane is-${pill.tone} mono`}
                  title={lanePillTitle(pill)}
                  aria-label={`${lanePillTitle(pill)}. Inspect this lane`}
                  onClick={() => inspectLane(pill.key)}
                >
                  <span className="transport-lane-label">{pill.label}</span>
                  {pill.task ? <span className="transport-lane-task">{pill.task}</span> : null}
                  <span className="transport-lane-dot" aria-hidden="true" />
                  {pill.minutes !== null ? <span className="transport-lane-time">{pill.minutes}m</span> : null}
                  {pill.step ? <span className="transport-lane-step">{pill.step}</span> : null}
                </button>
              ))}
              {lanes.more > 0 ? (
                <span className="transport-lane-overflow mono" title={`${lanes.more} more`}>
                  +{lanes.more}
                </span>
              ) : null}
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

  return (
    <div className="transport">
      <button type="button" onClick={onToggle} aria-label={playing ? 'Pause replay' : 'Play replay'}>
        {playing ? 'Pause' : finished ? 'Replay' : 'Play'}
      </button>
      <div className="scrubber">
        <input
          type="range"
          min="0"
          max={Math.round(duration)}
          value={Math.round(position)}
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
