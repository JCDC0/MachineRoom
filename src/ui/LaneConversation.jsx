import { useEffect, useMemo, useRef, useState } from 'react'
import { agentColor } from './orchestratorChat.js'
import { useLogFollow } from './logScroll.js'
import {
  foldPrompt,
  foldToolCalls,
  readDue,
  runClock,
  runOptions,
  runOutcome,
  toolText,
} from './laneConversation.js'

function timeText(startedAt) {
  const clock = runClock(startedAt)
  return clock ? `run ${clock}` : 'run unknown'
}

function taskText(run) {
  const briefs = Array.isArray(run?.briefs) ? run.briefs.filter(Boolean) : []
  if (briefs.length > 0) return `Briefs: ${briefs.join(' ')}`
  const task = typeof run?.task === 'string' && run.task.trim() !== '' ? run.task.trim() : ''
  return `Task: ${task || 'this project'}`
}

export default function LaneConversation({
  client = null,
  lane = '',
  laneName = '',
  project = '',
  lanes = [],
  liveRuns = [],
  runs: givenRuns = null,
  initialStartedAt = '',
  inline = false,
  tick = 0,
  onBack = () => {},
}) {
  const [runs, setRuns] = useState(givenRuns)
  const [selected, setSelected] = useState(initialStartedAt)
  const [conversationState, setConversation] = useState({ loading: true, data: null, error: '' })
  const [confirmStop, setConfirmStop] = useState(false)
  const [stopping, setStopping] = useState(false)
  const [stopError, setStopError] = useState('')
  const [showPrompt, setShowPrompt] = useState(false)
  const [openTools, setOpenTools] = useState({})
  const mountedRef = useRef(true)
  const lastReadRef = useRef(null)
  const readRef = useRef(null)
  const selectionRef = useRef(null)
  selectionRef.current = { lane, startedAt: selected }
  const conversation = conversationState.lane === lane && conversationState.startedAt === selected
    ? conversationState
    : { loading: true, data: null, error: '' }
  const options = useMemo(() => runOptions(runs, lane, { liveRuns, lanes }), [runs, lane, liveRuns, lanes])
  const currentRun = options.find((run) => run.startedAt === selected) ?? null
  const running = conversation.data !== null && (conversation.data?.running === true || currentRun?.running === true)
  const outcome = runOutcome(currentRun, conversation.data)
  const colour = agentColor(lane, lanes)
  const entries = Array.isArray(conversation.data?.entries) ? conversation.data.entries : []
  const promptEntry = entries.find((entry) => entry.role === 'prompt') ?? null
  const prompt = foldPrompt(promptEntry?.text ?? '')
  const rows = foldToolCalls(entries.filter((entry) => entry.role !== 'prompt'))
  const follow = useLogFollow(running, entries.length)
  const label = laneName || lane || 'Lane'
  const projectLabel = String(project || 'PROJECT').toUpperCase()

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  useEffect(() => {
    setRuns(givenRuns)
  }, [givenRuns])

  useEffect(() => {
    if (givenRuns || !client || typeof client.runs !== 'function') return undefined
    let active = true
    async function readRuns() {
      try {
        const answer = await client.runs()
        if (active) setRuns(answer && typeof answer === 'object' ? answer : null)
      } catch {
        if (active) setRuns(null)
      }
    }
    readRuns()
    const unsubscribe =
      typeof client.subscribe === 'function'
        ? client.subscribe((notice) => {
            if (notice?.topic === 'runs') readRuns()
          })
        : null
    return () => {
      active = false
      if (typeof unsubscribe === 'function') unsubscribe()
    }
  }, [client, givenRuns])

  useEffect(() => {
    if (options.length === 0) return
    if (!selected || !options.some((run) => run.startedAt === selected)) {
      setSelected(options[0].startedAt)
    }
  }, [options, selected])

  useEffect(() => {
    setConfirmStop(false)
    setStopError('')
    setStopping(false)
    setShowPrompt(false)
    setOpenTools({})
  }, [selected])

  async function readConversation(startedAt, { force = false } = {}) {
    if (!startedAt || !client || typeof client.runConversation !== 'function') return
    const isSelected = () => mountedRef.current && selectionRef.current.lane === lane && selectionRef.current.startedAt === startedAt
    if (!isSelected()) return
    const at = Date.now()
    if (!force && !readDue(lastReadRef.current, at)) return
    lastReadRef.current = at
    setConversation((current) => current.lane === lane && current.startedAt === startedAt
      ? { ...current, loading: current.data === null }
      : { lane, startedAt, loading: true, data: null, error: '' })
    try {
      const data = await client.runConversation({ lane, startedAt })
      if (!isSelected()) return
      setConversation({ lane, startedAt, loading: false, data: data && typeof data === 'object' ? data : null, error: '' })
    } catch (failure) {
      if (!isSelected()) return
      setConversation({
        lane,
        startedAt,
        loading: false,
        data: null,
        error: failure?.message || 'Could not read the conversation.',
      })
    }
  }
  readRef.current = readConversation

  useEffect(() => {
    lastReadRef.current = null
    setConversation({ lane, startedAt: selected, loading: true, data: null, error: '' })
    readRef.current?.(selected, { force: true })
  }, [client, lane, selected])

  useEffect(() => {
    if (!selected || conversation.data?.running !== true) return
    readRef.current?.(selected)
  }, [tick, selected, conversation.data?.running])

  async function stopRun() {
    if (!client || typeof client.stopRun !== 'function' || !selected) return
    setStopping(true)
    setStopError('')
    try {
      await client.stopRun({ lane, startedAt: selected, confirmed: true })
      if (!mountedRef.current) return
      setConfirmStop(false)
      lastReadRef.current = null
      await readConversation(selected, { force: true })
    } catch (failure) {
      if (!mountedRef.current) return
      setStopError(failure?.message || 'Could not stop the run.')
    } finally {
      if (mountedRef.current) setStopping(false)
    }
  }

  return (
    <aside className={`mr-orch mr-lane-conv${inline ? ' is-inline' : ''}`} aria-label={`${label} conversation`}>
      <header className="mr-orch-head mr-lane-conv-head">
        <p className="mr-lane-conv-crumb mono">{`${projectLabel} / ${String(label).toUpperCase()} / ${timeText(selected)}`}</p>
        {running ? (
          <button type="button" className="mr-lane-conv-stop mono" onClick={() => setConfirmStop(true)}>
            Stop
          </button>
        ) : null}
        <button type="button" className="mr-orch-close" onClick={onBack}>
          Back
        </button>
      </header>
      <div className="mr-lane-conv-tools">
        <label className="mr-lane-conv-picker">
          <span className="mono">Run</span>
          <select
            className="mr-lane-conv-select mono"
            aria-label="Run"
            value={selected}
            onChange={(event) => setSelected(event.target.value)}
            disabled={options.length === 0}
          >
            {options.length === 0 ? <option value="">No runs</option> : null}
            {options.map((run) => (
              <option value={run.startedAt} key={run.startedAt}>
                {`${runClock(run.startedAt)} ${runOutcome(run)}`}
              </option>
            ))}
          </select>
        </label>
        {!running && outcome ? <span className="mr-lane-conv-outcome mono">{outcome}</span> : null}
      </div>

      {confirmStop ? (
        <div className="brief-confirm-card" role="region" aria-label={`Confirm stop ${lane}`}>
          <div className="brief-confirm-meta mono">
            <span className="brief-confirm-lane">Lane: {lane}</span>
            <span className="brief-confirm-model">{taskText(currentRun)}</span>
            <span className="brief-confirm-id">Started: {selected}</span>
          </div>
          <div className="brief-confirm-warning">This stops the running lane and tells its orchestrator.</div>
          <div className="brief-confirm-actions">
            <button type="button" className="brief-confirm-btn" disabled={stopping} onClick={stopRun}>
              {stopping ? 'Stopping' : 'Confirm'}
            </button>
            <button
              type="button"
              className="brief-cancel-btn"
              disabled={stopping}
              onClick={() => {
                setConfirmStop(false)
                setStopError('')
              }}
            >
              Cancel
            </button>
          </div>
          {stopError ? (
            <div className="brief-confirm-error mono" role="alert">
              {stopError}
            </div>
          ) : null}
        </div>
      ) : null}

      {conversation.error ? <p className="mr-orch-error mono">{conversation.error}</p> : null}
      {conversation.loading ? <p className="mr-orch-empty">Reading the conversation.</p> : null}

      <div className="mr-orch-log mr-lane-conv-log" ref={follow.ref} onScroll={follow.onScroll}>
        {!conversation.loading && !conversation.error && entries.length === 0 ? (
          <p className="mr-orch-empty">Nothing has been said yet.</p>
        ) : null}
        {promptEntry ? (
          <section className="mr-lane-conv-prompt" aria-label="Prompt">
            <p className={`mr-lane-conv-prompt-text${prompt.folded && !showPrompt ? ' is-folded' : ''}`}>
              {showPrompt ? promptEntry.text : prompt.text}
            </p>
            {prompt.folded ? (
              <button
                type="button"
                className="mr-lane-conv-more mono"
                onClick={() => setShowPrompt((value) => !value)}
              >
                {showPrompt ? 'Show less' : 'Show all'}
              </button>
            ) : null}
          </section>
        ) : null}
        {rows.map((row, index) => {
          if (row.kind === 'tools') {
            if (row.count === 1) {
              return (
                <p className="mr-lane-conv-tool mono" style={{ color: colour }} key={`tool-${index}`}>
                  {toolText(row.entries[0])}
                </p>
              )
            }
            const open = openTools[index] === true
            return (
              <div className="mr-lane-conv-tool-group" key={`tools-${index}`}>
                <button
                  type="button"
                  className="mr-lane-conv-tool-fold mono"
                  style={{ color: colour }}
                  aria-expanded={open}
                  onClick={() => setOpenTools((current) => ({ ...current, [index]: !open }))}
                >
                  {`${row.count} tool calls`}
                </button>
                {open
                  ? row.entries.map((entry, at) => (
                      <p className="mr-lane-conv-tool mono" style={{ color: colour }} key={`tool-${index}-${at}`}>
                        {toolText(entry)}
                      </p>
                    ))
                  : null}
              </div>
            )
          }
          const entry = row.entry
          if (entry.role === 'agent') {
            return (
              <div className="mr-orch-line is-orchestrator" key={`entry-${index}`}>
                <p className="mr-orch-text">{entry.text}</p>
              </div>
            )
          }
          if (entry.role === 'result') {
            return (
              <p className="mr-lane-conv-result mono" key={`entry-${index}`}>
                {entry.text}
              </p>
            )
          }
          return (
            <p className="mr-lane-conv-line mono" key={`entry-${index}`}>
              {entry.text}
            </p>
          )
        })}
      </div>
    </aside>
  )
}
