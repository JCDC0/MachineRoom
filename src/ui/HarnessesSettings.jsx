import { useCallback, useEffect, useRef, useState } from 'react'
import { useDialogFocus } from './dialogFocus.js'
import {
  countSavedItems,
  directApiSummary,
  harnessConfirmSpec,
  harnessDisplayName,
  harnessListFrom,
  harnessProgramFolded,
  harnessStatus,
  isNativeHarness,
  programDraftsFrom,
} from './harnessesSettings.js'
import { laneCountWarningFrom } from './panels/runs.js'

const READY_MEANS = 'Ready means the program was found. It does not prove sign-in, a model or the sandbox.'

function updateRowsWithResult(currentRows, result) {
  if (Array.isArray(result) || Array.isArray(result?.harnesses)) {
    return harnessListFrom(result)
  }
  if (result?.harness?.key) {
    const [updated] = harnessListFrom([result.harness])
    if (!updated) return currentRows
    const index = currentRows.findIndex((item) => item.key === updated.key)
    if (index === -1) return [...currentRows, updated]
    return currentRows.map((item, i) => (i === index ? updated : item))
  }
  return null
}

/**
 * Renders the Harnesses section in Settings to inspect and configure runners.
 */
export default function HarnessesSettings({ client }) {
  const live = Boolean(client && typeof client.harnesses === 'function')
  const [rows, setRows] = useState([])
  const [drafts, setDrafts] = useState({})
  const [counts, setCounts] = useState(null)
  const [busyKey, setBusyKey] = useState('')
  const [checking, setChecking] = useState(false)
  const [confirm, setConfirm] = useState(null)
  const [sectionError, setSectionError] = useState('')
  const [rowErrors, setRowErrors] = useState({})
  const [probes, setProbes] = useState({})
  const mountedRef = useRef(true)
  const confirmRef = useRef(null)
  const dirtyRef = useRef(new Set())

  const mergeDrafts = useCallback((nextRows) => {
    setDrafts((current) => {
      const next = programDraftsFrom(nextRows)
      for (const key of Object.keys(next)) {
        if (dirtyRef.current.has(`program:${key}`) && key in current) next[key] = current[key]
      }
      return next
    })
  }, [])

  useDialogFocus(Boolean(confirm), {
    containerRef: confirmRef,
    openerSelector: 'mr-harness-confirm',
    trap: true,
  })

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  useEffect(() => {
    if (!confirm) return undefined
    function onKeyDown(event) {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopPropagation()
      setConfirm(null)
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [confirm])

  const loadCounts = useCallback(async () => {
    if (!client) return null
    const hasKeys = typeof client.keys === 'function'
    const hasEndpoints = typeof client.endpoints === 'function'
    if (!hasKeys && !hasEndpoints) return null
    const [keysResult, endpointsResult] = await Promise.allSettled([
      hasKeys ? client.keys() : Promise.resolve([]),
      hasEndpoints ? client.endpoints() : Promise.resolve([]),
    ])
    if (!mountedRef.current) return null
    const next = {
      keys: keysResult.status === 'fulfilled' ? countSavedItems(keysResult.value, 'keys') : 0,
      endpoints: endpointsResult.status === 'fulfilled' ? countSavedItems(endpointsResult.value, 'endpoints') : 0,
    }
    setCounts(next)
    return next
  }, [client])

  const loadAll = useCallback(async () => {
    if (!live) {
      dirtyRef.current.clear()
      setRows([])
      setDrafts({})
      setCounts(null)
      setSectionError('')
      setRowErrors({})
      return
    }
    try {
      const answer = await client.harnesses()
      if (!mountedRef.current) return
      const nextRows = harnessListFrom(answer)
      setRows(nextRows)
      mergeDrafts(nextRows)
      setSectionError('')
      await loadCounts()
    } catch (error) {
      if (!mountedRef.current) return
      setSectionError(error?.message || 'Could not load harnesses.')
    }
  }, [client, live, loadCounts, mergeDrafts])

  useEffect(() => {
    loadAll()
  }, [loadAll])

  useEffect(() => {
    if (!live || typeof client.subscribe !== 'function') return undefined
    return client.subscribe((event) => {
      const topic = event?.topic
      if (topic === 'harnesses' || topic === 'endpoints' || topic === 'keys' || topic === 'family') {
        loadAll()
      }
    })
  }, [client, live, loadAll])

  async function applySetting(key, payload) {
    if (!client || typeof client.harnessSettings !== 'function') return
    setBusyKey(key)
    setSectionError('')
    setRowErrors((current) => {
      if (!current[key]) return current
      const copy = { ...current }
      delete copy[key]
      return copy
    })
    try {
      const result = await client.harnessSettings({ key, ...payload, confirmed: true })
      if (!mountedRef.current) return
      if ('program' in payload) dirtyRef.current.delete(`program:${key}`)
      const nextRows = updateRowsWithResult(rows, result)
      if (nextRows) {
        setRows(nextRows)
        mergeDrafts(nextRows)
        await loadCounts()
      } else {
        await loadAll()
      }
    } catch (error) {
      if (!mountedRef.current) return
      setRowErrors((current) => ({
        ...current,
        [key]: error?.message || 'Could not update harness.',
      }))
    } finally {
      if (mountedRef.current) setBusyKey('')
    }
  }

  async function handleCheckAgain() {
    if (!live || typeof client.checkHarnesses !== 'function') return
    setChecking(true)
    setSectionError('')
    setRowErrors({})
    try {
      const answer = await client.checkHarnesses({ confirmed: true })
      if (!mountedRef.current) return
      const nextRows = updateRowsWithResult(rows, answer)
      if (nextRows) {
        setRows(nextRows)
        mergeDrafts(nextRows)
        await loadCounts()
      } else {
        await loadAll()
      }
    } catch (error) {
      if (!mountedRef.current) return
      setSectionError(error?.message || 'Could not check harnesses.')
    } finally {
      if (mountedRef.current) setChecking(false)
    }
  }

  function handleToggleEnabled(row) {
    if (row.enabled) {
      setConfirm(harnessConfirmSpec({ kind: 'disable', key: row.key, name: harnessDisplayName(row) }))
      return
    }
    applySetting(row.key, { enabled: true })
  }

  async function runProbe(key) {
    setProbes((current) => ({ ...current, [key]: { running: true } }))
    let text
    try {
      const answer = await client.probeHarness(key)
      const seconds = answer?.seconds
      text = answer?.status === 'reached' ? `Reached in ${seconds}s` : answer?.status === 'failed' ? `Failed: ${answer.line}` : `Unknown: no clear reply in ${seconds}s`
    } catch (error) {
      text = `Failed: ${error?.message || 'The test did not run.'}`
    }
    if (mountedRef.current) setProbes((current) => ({ ...current, [key]: { text } }))
  }

  async function handleConfirm() {
    if (!confirm) return
    const action = confirm
    setConfirm(null)
    if (action.kind === 'probe') {
      await runProbe(action.key)
      return
    }
    if (action.kind === 'disable') {
      await applySetting(action.key, { enabled: false })
      return
    }
    if (action.kind === 'program') {
      await applySetting(action.key, { program: action.program })
    }
  }

  return (
    <section className="hud-settings-section mr-lanes endpoints-panel" aria-label="Harnesses">
      <div className="endpoints-row-head">
        <h3 className="hud-settings-section-title">Harnesses</h3>
        {live && (
          <button
            type="button"
            className="hud-settings-switch"
            disabled={checking || Boolean(busyKey)}
            onClick={handleCheckAgain}
          >
            {checking ? 'Checking...' : 'Check again'}
          </button>
        )}
      </div>
      {!live ? (
        <p className="endpoints-note mono">Harnesses are listed when the room runs live.</p>
      ) : (
        <>
          {sectionError ? (
            <p className="endpoints-error mono" role="alert">
              {sectionError}
            </p>
          ) : null}
          {rows.some((row) => harnessStatus(row).state === 'ready') ? (
            <p className="endpoints-note mono" data-harness-ready-help="true">
              {READY_MEANS}
            </p>
          ) : null}
          {rows.map((row) => {
            const status = harnessStatus(row)
            const name = harnessDisplayName(row)
            const native = isNativeHarness(row)
            const busy = checking || busyKey === row.key
            const rowError = rowErrors[row.key] || ''
            const draft = drafts[row.key] ?? ''
            const programInputId = `harness-program-${row.key}`
            const folded = harnessProgramFolded(row)
            const programDetails = (
              <>
                {row.version ? <div className="endpoints-meta mono">{row.version}</div> : null}
                {row.program ? <div className="endpoints-meta mono">{row.program}</div> : null}
                <div className="endpoints-field">
                  <label className="endpoints-label mono" htmlFor={programInputId}>
                    Program
                  </label>
                  <input
                    id={programInputId}
                    type="text"
                    value={draft}
                    disabled={busy}
                    placeholder="Program name or path"
                    onChange={(event) => {
                      const nextValue = event.target.value
                      dirtyRef.current.add(`program:${row.key}`)
                      setDrafts((current) => ({ ...current, [row.key]: nextValue }))
                    }}
                  />
                </div>
                <div className="endpoints-actions">
                  <button
                    type="button"
                    className="hud-settings-switch"
                    disabled={busy || draft.trim() === ''}
                    aria-controls="mr-harness-confirm"
                    onClick={() =>
                      setConfirm(
                        harnessConfirmSpec({
                          kind: 'program',
                          key: row.key,
                          name,
                          program: draft,
                        })
                      )
                    }
                  >
                    Save
                  </button>
                  <button
                    type="button"
                    className="hud-settings-switch"
                    disabled={busy}
                    onClick={() => applySetting(row.key, { program: '' })}
                  >
                    Clear
                  </button>
                </div>
              </>
            )
            return (
              <div key={row.key} className="endpoints-row" data-harness={row.key}>
                <div className="endpoints-row-head">
                  <span className="endpoints-name">{name}</span>
                  <span
                    className="endpoints-meta mono"
                    data-harness-state={status.state}
                    style={{ color: status.color }}
                  >
                    {status.label}
                  </span>
                </div>
                <div className="endpoints-actions">
                  <button
                    type="button"
                    role="switch"
                    aria-checked={row.enabled}
                    aria-controls="mr-harness-confirm"
                    aria-label={`Offer ${name} in forms`}
                    className={row.enabled ? 'hud-settings-switch is-on' : 'hud-settings-switch'}
                    disabled={busy}
                    onClick={() => handleToggleEnabled(row)}
                  >
                    Offer in forms
                  </button>
                  {status.state === 'ready' && row.enabled && typeof client.probeHarness === 'function' ? (
                    <button
                      type="button"
                      className="hud-settings-switch"
                      disabled={busy || probes[row.key]?.running}
                      aria-controls="mr-harness-confirm"
                      onClick={() =>
                        setConfirm({
                          kind: 'probe',
                          key: row.key,
                          label: `Test connection to ${name}`,
                          text: `This sends one short prompt to ${row.key}, which may use a little quota.`,
                          confirmText: 'Test',
                        })
                      }
                    >
                      {probes[row.key]?.running ? 'Testing...' : 'Test connection'}
                    </button>
                  ) : null}
                </div>
                {probes[row.key]?.text ? (
                  <div className="endpoints-meta mono" data-harness-probe={row.key}>
                    {probes[row.key].text}
                  </div>
                ) : null}
                {native ? (
                  <p className="endpoints-note mono">{directApiSummary(counts)}</p>
                ) : folded ? (
                  <details>
                    <summary className="endpoints-label mono">Program details</summary>
                    {programDetails}
                  </details>
                ) : (
                  programDetails
                )}
                {status.state === 'not-ready' && status.reason ? (
                  <div className="endpoints-meta mono" data-harness-reason="true" style={{ color: '#ff2a2a' }}>
                    {status.reason}
                  </div>
                ) : null}
                {rowError ? (
                  <p className="endpoints-error mono" role="alert">
                    {rowError}
                  </p>
                ) : null}
              </div>
            )
          })}
        </>
      )}
      {confirm ? (
        <div
          ref={confirmRef}
          id="mr-harness-confirm"
          className="mr-side-confirm"
          role="dialog"
          aria-modal="true"
          aria-label={confirm.label}
        >
          <section className="mr-side-confirm-card">
            <p className="mr-side-confirm-text">{confirm.text}</p>
            <div className="mr-side-confirm-actions">
              <button
                type="button"
                className={
                  confirm.danger
                    ? 'hud-settings-switch mr-side-confirm-btn is-danger'
                    : 'hud-settings-switch mr-side-confirm-btn is-primary'
                }
                disabled={Boolean(busyKey)}
                onClick={handleConfirm}
              >
                {confirm.confirmText}
              </button>
              <button
                type="button"
                className="hud-settings-switch mr-side-confirm-btn"
                disabled={Boolean(busyKey)}
                onClick={() => setConfirm(null)}
              >
                Cancel
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </section>
  )
}

function harnessRowsOf(answer) {
  return Array.isArray(answer) ? answer : Array.isArray(answer?.harnesses) ? answer.harnesses : []
}

/**
 * The four lane settings the bridge keeps with the harness settings, shown in the Lanes section.
 */
export function LaneSettingsFields({ client }) {
  const live = Boolean(client && typeof client.harnesses === 'function')
  const [laneReplies, setLaneReplies] = useState('next-turn')
  const [laneCountWarning, setLaneCountWarning] = useState('0')
  const [worktreeSetup, setWorktreeSetup] = useState('')
  const [worktreeCopies, setWorktreeCopies] = useState('')
  const [busy, setBusy] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState('')
  const mountedRef = useRef(true)
  const readSequenceRef = useRef(0)
  const dirtyRef = useRef(new Set())

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  const load = useCallback(async () => {
    if (!live) return
    const sequence = ++readSequenceRef.current
    const isCurrent = () => mountedRef.current && readSequenceRef.current === sequence
    try {
      const answer = await client.harnesses()
      if (!isCurrent()) return
      const first = harnessRowsOf(answer)[0]
      setLaneReplies(first?.laneReplies === 'interrupt' ? 'interrupt' : 'next-turn')
      if (!dirtyRef.current.has('laneCount')) setLaneCountWarning(String(laneCountWarningFrom(answer)))
      if (!dirtyRef.current.has('setup')) setWorktreeSetup(typeof first?.worktreeSetup === 'string' ? first.worktreeSetup : '')
      if (!dirtyRef.current.has('copies')) setWorktreeCopies(Array.isArray(first?.worktreeCopies) ? first.worktreeCopies.join('\n') : '')
      setLoaded(true)
      setError('')
    } catch (failure) {
      if (isCurrent()) setError(failure?.message || 'Could not load the lane settings.')
    }
  }, [client, live])

  useEffect(() => {
    load()
    return () => { readSequenceRef.current += 1 }
  }, [load])

  useEffect(() => {
    if (!live || typeof client.subscribe !== 'function') return undefined
    return client.subscribe((event) => {
      if (event?.topic === 'harnesses') load()
    })
  }, [client, live, load])

  async function save(payload, failure, done) {
    if (!client || typeof client.harnessSettings !== 'function') return
    setBusy(true)
    setError('')
    try {
      await client.harnessSettings({ ...payload, confirmed: true })
      if (!mountedRef.current) return
      done()
    } catch (problem) {
      if (mountedRef.current) setError(problem?.message || failure)
    } finally {
      if (mountedRef.current) setBusy(false)
    }
  }

  function saveReplies(value) {
    return save({ laneReplies: value }, 'Could not save the reply choice.', () => setLaneReplies(value))
  }

  function saveLaneCount() {
    const text = String(laneCountWarning ?? '').trim()
    const count = text === '' ? Number.NaN : Number(text)
    if (!Number.isInteger(count) || count < 0) {
      setError('Write the lane count warning as a whole number, 0 or more.')
      return undefined
    }
    return save({ laneCountWarning: count }, 'Could not save the lane count warning.', () => {
      dirtyRef.current.delete('laneCount')
      setLaneCountWarning(String(count))
    })
  }

  function saveWorktree() {
    const command = worktreeSetup.trim()
    const copies = worktreeCopies.split(/\r?\n/).map((path) => path.trim()).filter(Boolean)
    return save({ worktreeSetup: command, worktreeCopies: copies }, 'Could not save the worktree setup command.', () => {
      dirtyRef.current.delete('setup')
      dirtyRef.current.delete('copies')
      setWorktreeSetup(command)
    })
  }

  if (!live) return null

  return (
    <section className="hud-settings-section endpoints-panel" aria-label="Lane settings">
      {!loaded && !error ? <p className="endpoints-note mono">Loading the saved settings. Save is off until they load.</p> : null}
      {error ? (
        <div className="endpoints-actions">
          <span className="endpoints-error mono" role="alert">{error}</span>
          {!loaded && (
            <button
              type="button"
              className="hud-settings-switch"
              onClick={() => {
                setError('')
                load()
              }}
            >
              Retry
            </button>
          )}
        </div>
      ) : null}
      <div className="endpoints-field">
        <label className="endpoints-label mono" htmlFor="harness-lane-replies">
          Messages to a working agent
        </label>
        <select
          id="harness-lane-replies"
          value={laneReplies}
          disabled={busy || !loaded}
          onChange={(event) => saveReplies(event.target.value)}
        >
          <option value="next-turn">After its current action</option>
          <option value="interrupt">Interrupt it at once</option>
        </select>
        <p className="endpoints-note mono">
          Native lanes take a message after their current model reply and its tool calls. Other harnesses read it when they next check their inbox.
        </p>
      </div>
      <div className="endpoints-field">
        <label className="endpoints-label mono" htmlFor="harness-lane-count-warning">
          Warn above this many running lanes
        </label>
        <input
          id="harness-lane-count-warning"
          type="number"
          min="0"
          step="1"
          value={laneCountWarning}
          disabled={busy}
          onChange={(event) => {
            dirtyRef.current.add('laneCount')
            setLaneCountWarning(event.target.value)
          }}
        />
        <div className="endpoints-actions">
          <button
            type="button"
            className="hud-settings-switch"
            disabled={busy || !loaded}
            title={loaded ? undefined : 'Waiting for the saved settings.'}
            onClick={() => saveLaneCount()}
          >
            Save
          </button>
        </div>
        <p className="endpoints-note mono">0 turns the warning off.</p>
      </div>
      <div className="endpoints-field">
        <label className="endpoints-label mono" htmlFor="harness-worktree-setup">
          Worktree setup command
        </label>
        <input
          id="harness-worktree-setup"
          type="text"
          value={worktreeSetup}
          disabled={busy}
          onChange={(event) => {
            dirtyRef.current.add('setup')
            setWorktreeSetup(event.target.value)
          }}
        />
        <p className="endpoints-note mono">Runs once in each new lane worktree, for example npm ci.</p>
        <label className="endpoints-label mono" htmlFor="harness-worktree-copies">Copy into new worktrees</label>
        <textarea
          id="harness-worktree-copies"
          value={worktreeCopies}
          disabled={busy}
          onChange={(event) => {
            dirtyRef.current.add('copies')
            setWorktreeCopies(event.target.value)
          }}
        />
        <p className="endpoints-note mono">One project-relative file path per line. Each copy adds an ignore line shared with the main checkout.</p>
        <div className="endpoints-actions">
          <button
            type="button"
            className="hud-settings-switch"
            disabled={busy || !loaded}
            title={loaded ? undefined : 'Waiting for the saved settings.'}
            onClick={() => saveWorktree()}
          >
            Save
          </button>
        </div>
      </div>
    </section>
  )
}
