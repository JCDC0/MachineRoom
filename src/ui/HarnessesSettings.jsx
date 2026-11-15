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
  const mountedRef = useRef(true)
  const confirmRef = useRef(null)

  useDialogFocus(Boolean(confirm), {
    containerRef: confirmRef,
    openerSelector: '.hud-settings-section[aria-label="Harnesses"] button',
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
      setDrafts(programDraftsFrom(nextRows))
      setSectionError('')
      await loadCounts()
    } catch (error) {
      if (!mountedRef.current) return
      setSectionError(error?.message || 'Could not load harnesses.')
    }
  }, [client, live, loadCounts])

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
      const nextRows = updateRowsWithResult(rows, result)
      if (nextRows) {
        setRows(nextRows)
        setDrafts(programDraftsFrom(nextRows))
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
        setDrafts(programDraftsFrom(nextRows))
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

  async function handleConfirm() {
    if (!confirm) return
    const action = confirm
    setConfirm(null)
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
                {status.state === 'not-ready' && status.reason ? (
                  <div className="endpoints-meta mono" data-harness-reason="true" style={{ color: '#ff2a2a' }}>
                    {status.reason}
                  </div>
                ) : null}
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
                      setDrafts((current) => ({ ...current, [row.key]: nextValue }))
                    }}
                  />
                </div>
                <div className="endpoints-actions">
                  <button
                    type="button"
                    className="hud-settings-switch"
                    disabled={busy || draft.trim() === ''}
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
                    aria-label={`Offer ${name} in forms`}
                    className={row.enabled ? 'hud-settings-switch is-on' : 'hud-settings-switch'}
                    disabled={busy}
                    onClick={() => handleToggleEnabled(row)}
                  >
                    Offer in forms
                  </button>
                </div>
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
