import { useEffect, useRef, useState } from 'react'
import { useDialogFocus } from './dialogFocus.js'
import { deleteLaneText, removeLaneText } from './family.js'
import { cleanText, laneSummary, projectName } from './sidebar.js'

function messageOf(error) {
  return error instanceof Error && error.message ? error.message : 'The bridge refused the change.'
}

export default function LanesSettings({ client = null, project = '' }) {
  const canList = typeof client?.lanes === 'function'
  const canShow = typeof client?.showLane === 'function'
  const canDelete = typeof client?.deleteLane === 'function'
  const shown = canList && (canShow || canDelete)
  const [lanes, setLanes] = useState(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [confirm, setConfirm] = useState(null)
  const [busy, setBusy] = useState(false)
  const confirmRef = useRef(null)

  useDialogFocus(Boolean(confirm), { containerRef: confirmRef })

  useEffect(() => {
    if (!shown) return undefined
    let alive = true
    setError('')
    Promise.resolve()
      .then(() => client.lanes())
      .then((answer) => {
        if (alive) setLanes(laneSummary(answer).lanes)
      })
      .catch((failure) => {
        if (!alive) return
        setLanes([])
        setError(messageOf(failure))
      })
    return () => {
      alive = false
    }
  }, [client, shown])

  useEffect(() => {
    if (!shown || typeof client?.subscribe !== 'function') return undefined
    return client.subscribe((noticeRow) => {
      if (!noticeRow) return
      if (noticeRow.topic !== 'agents' && noticeRow.topic !== 'family') return
      Promise.resolve()
        .then(() => client.lanes())
        .then((answer) => setLanes(laneSummary(answer).lanes))
        .catch(() => {})
    })
  }, [client, shown])

  useEffect(() => {
    if (!confirm) return undefined
    function onKey(event) {
      if (event.key !== 'Escape' || busy) return
      event.preventDefault()
      event.stopPropagation()
      setConfirm(null)
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [confirm, busy])

  if (!shown) return null

  async function readLanes() {
    try {
      const answer = await client.lanes()
      setLanes(laneSummary(answer).lanes)
    } catch (failure) {
      setError(messageOf(failure))
    }
  }

  function ask(config) {
    setError('')
    setNotice('')
    setConfirm(config)
  }

  async function runConfirm() {
    if (!confirm || busy) return
    const current = confirm
    setBusy(true)
    setError('')
    try {
      await current.run()
      setConfirm(null)
    } catch (failure) {
      setError(messageOf(failure))
      setConfirm(null)
    } finally {
      setBusy(false)
    }
  }

  async function show(lane) {
    if (!canShow || busy) return
    setBusy(true)
    setError('')
    setNotice('')
    try {
      await client.showLane({ key: lane.key, confirmed: true })
      setNotice(`Shown ${lane.name || lane.key}.`)
      await readLanes()
    } catch (failure) {
      setError(messageOf(failure))
    } finally {
      setBusy(false)
    }
  }

  function askDelete(lane) {
    if (!canDelete || busy) return
    const made = lane.custom === true
    ask({
      text: made
        ? deleteLaneText(lane.name || lane.key)
        : removeLaneText(lane.name || lane.key, projectName({ path: project })),
      label: made ? 'Delete everywhere' : 'Remove from project',
      tone: 'danger',
      busyText: made ? 'Deleting the lane...' : 'Removing the lane...',
      run: async () => {
        await client.deleteLane({ key: lane.key, confirmed: true })
        await readLanes()
      },
    })
  }

  const rows = lanes ?? []

  return (
    <section className="hud-settings-section mr-lanes" aria-labelledby="mr-lanes-title">
      <h3 id="mr-lanes-title" className="hud-settings-section-title">
        Lanes
      </h3>
      {lanes === null ? <p className="mr-lanes-state mono">Loading lanes</p> : null}
      {lanes !== null && rows.length === 0 ? (
        <p className="mr-lanes-state mono">No lanes are listed.</p>
      ) : null}
      {rows.length > 0 ? (
        <ul className="mr-lanes-list">
          {rows.map((lane) => {
            const label = cleanText(lane.name, 80) || lane.key
            const hidden = lane.hidden === true
            return (
              <li className="mr-lanes-row" key={lane.key}>
                <span className="mr-lanes-name mono">{label}</span>
                {hidden ? <span className="mr-lanes-tag mono">hidden here</span> : null}
                <span className="mr-lanes-actions">
                  {hidden && canShow ? (
                    <button
                      type="button"
                      className="mr-lanes-show"
                      disabled={busy}
                      aria-label={`Show ${label}`}
                      onClick={() => show(lane)}
                    >
                      Show
                    </button>
                  ) : null}
                  {canDelete && (lane.custom === true || !hidden) ? (
                    <button
                      type="button"
                      className="mr-lanes-delete"
                      disabled={busy}
                      aria-label={
                        lane.custom === true
                          ? `Delete ${label} everywhere`
                          : `Remove ${label} from this project`
                      }
                      onClick={() => askDelete(lane)}
                    >
                      {lane.custom === true ? 'Delete everywhere' : 'Remove from project'}
                    </button>
                  ) : null}
                </span>
              </li>
            )
          })}
        </ul>
      ) : null}
      {notice ? <p className="mr-lanes-state mono">{notice}</p> : null}
      {error ? <p className="mr-lanes-state mono is-error">{error}</p> : null}
      {confirm ? (
        <div ref={confirmRef} className="mr-side-confirm" role="dialog" aria-modal="true" aria-label={confirm.label}>
          <section className="mr-side-confirm-card">
            <p className="mr-side-confirm-text">{busy && confirm.busyText ? confirm.busyText : confirm.text}</p>
            <div className="mr-side-confirm-actions">
              <button
                type="button"
                className={`mr-side-confirm-btn${confirm.tone === 'danger' ? ' is-danger' : ' is-primary'}`}
                disabled={busy}
                onClick={runConfirm}
              >
                {confirm.label}
              </button>
              <button
                type="button"
                className="mr-side-confirm-btn"
                disabled={busy}
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
