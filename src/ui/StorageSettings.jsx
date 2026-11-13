import { useEffect, useRef, useState } from 'react'
import { useDialogFocus } from './dialogFocus.js'

const DEFAULT_DAYS = 30
const MIN_DAYS = 1
const MAX_DAYS = 365
const PREVIEW_LIMIT = 50
const UNITS = ['B', 'KB', 'MB', 'GB', 'TB']

export function formatBytes(value) {
  const bytes = Number(value)
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  let unitIndex = 0
  let scaled = bytes
  while (scaled >= 1024 && unitIndex < UNITS.length - 1) {
    scaled /= 1024
    unitIndex += 1
  }
  const text = unitIndex === 0 ? String(Math.round(scaled)) : scaled.toFixed(1).replace(/\.0$/, '')
  return `${text} ${UNITS[unitIndex]}`
}

function messageOf(error) {
  return error instanceof Error && error.message ? error.message : 'The storage request failed.'
}

function parseDays(text) {
  const clean = String(text ?? '').trim()
  if (!/^\d+$/.test(clean)) return null
  const num = Number.parseInt(clean, 10)
  if (!Number.isInteger(num) || num < MIN_DAYS || num > MAX_DAYS) return null
  return num
}

export default function StorageSettings({ client = null }) {
  const shown = typeof client?.storage === 'function'
  const canPreview = typeof client?.previewStorageArchive === 'function'
  const canArchive = typeof client?.archiveStorage === 'function'

  const [summary, setSummary] = useState(null)
  const [loading, setLoading] = useState(shown)
  const [daysInput, setDaysInput] = useState(String(DEFAULT_DAYS))
  const [preview, setPreview] = useState(null)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const confirmRef = useRef(null)
  const mountedRef = useRef(true)

  useDialogFocus(confirmOpen, { containerRef: confirmRef })

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  useEffect(() => {
    if (!shown) return undefined
    let alive = true
    setLoading(true)
    setError('')
    Promise.resolve()
      .then(() => client.storage())
      .then((answer) => {
        if (!alive) return
        setSummary(answer ?? null)
        setLoading(false)
      })
      .catch((failure) => {
        if (!alive) return
        setError(messageOf(failure))
        setLoading(false)
      })
    return () => {
      alive = false
    }
  }, [client, shown])

  useEffect(() => {
    if (!confirmOpen) return undefined
    function onKey(event) {
      if (event.key !== 'Escape' || busy) return
      event.preventDefault()
      event.stopPropagation()
      setConfirmOpen(false)
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [confirmOpen, busy])

  if (!shown) return null

  async function refreshSummary() {
    if (!shown) return
    try {
      const answer = await client.storage()
      if (mountedRef.current) setSummary(answer ?? null)
    } catch {}
  }

  async function runPreview() {
    if (!canPreview || busy) return
    const parsedDays = parseDays(daysInput)
    if (parsedDays === null) {
      setError('Choose 1 to 365 days.')
      setNotice('')
      setPreview(null)
      setConfirmOpen(false)
      return
    }
    setBusy(true)
    setError('')
    setNotice('')
    setConfirmOpen(false)
    try {
      const result = await client.previewStorageArchive({ days: parsedDays })
      if (!mountedRef.current) return
      setPreview(result ?? null)
    } catch (failure) {
      if (!mountedRef.current) return
      setError(messageOf(failure))
      setPreview(null)
    } finally {
      if (mountedRef.current) setBusy(false)
    }
  }

  async function runArchive() {
    if (!canArchive || !preview || busy) return
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const result = await client.archiveStorage({ days: preview.days, confirmed: true })
      if (!mountedRef.current) return
      const count = Number(result?.count ?? 0)
      const bytes = Number(result?.totalBytes ?? 0)
      setConfirmOpen(false)
      setPreview(null)
      setNotice(
        count === 0
          ? 'No files were moved.'
          : `Moved ${count} ${count === 1 ? 'file' : 'files'} (${formatBytes(bytes)}) to archive.`
      )
      await refreshSummary()
    } catch (failure) {
      if (!mountedRef.current) return
      setConfirmOpen(false)
      setError(messageOf(failure))
    } finally {
      if (mountedRef.current) setBusy(false)
    }
  }

  const kinds = summary?.kinds ?? {}
  const kindRows = [
    { key: 'logs', label: 'Run logs', one: 'file', many: 'files', entry: kinds.logs },
    { key: 'recordings', label: 'Recordings', one: 'file', many: 'files', entry: kinds.recordings },
    { key: 'conversations', label: 'Saved conversations', one: 'file', many: 'files', entry: kinds.conversations },
    { key: 'worktrees', label: 'Lane worktrees', one: 'worktree', many: 'worktrees', entry: kinds.worktrees },
  ]
  const cleanWorktrees = Array.isArray(summary?.worktrees?.clean) ? summary.worktrees.clean : []
  const worktreesCommand = summary?.worktrees?.command ?? ''
  const previewFiles = Array.isArray(preview?.files) ? preview.files : []
  const shownPreviewFiles = previewFiles.slice(0, PREVIEW_LIMIT)
  const hiddenPreviewCount = Math.max(0, previewFiles.length - shownPreviewFiles.length)

  return (
    <section className="hud-settings-section mr-search" aria-labelledby="mr-storage-title">
      <h3 id="mr-storage-title" className="hud-settings-section-title">
        Storage
      </h3>
      {loading && <p className="mr-search-state">Loading storage usage</p>}
      {summary ? (
        <>
          <ul className="mr-lanes-list" aria-label="Storage usage by kind">
            {kindRows.map((row) => {
              const count = Number(row.entry?.count ?? 0)
              const bytes = Number(row.entry?.bytes ?? 0)
              return (
                <li className="mr-lanes-row" key={row.key}>
                  <span className="mr-lanes-name">{row.label}</span>
                  <span className="mr-lanes-tag mono">{`${count} ${count === 1 ? row.one : row.many}`}</span>
                  <span className="hud-settings-value mono">{formatBytes(bytes)}</span>
                </li>
              )
            })}
          </ul>
          <div className="hud-settings-row">
            <span className="hud-settings-label">Total</span>
            <span className="hud-settings-value mono">{formatBytes(summary.totalBytes)}</span>
          </div>
          {cleanWorktrees.length > 0 ? (
            <>
              <p className="mr-search-hint">Clean merged worktrees (not moved automatically):</p>
              <ul className="mr-lanes-list" aria-label="Clean merged worktrees">
                {cleanWorktrees.map((item) => (
                  <li className="mr-lanes-row" key={item.lane || item.path}>
                    <span className="mr-lanes-name mono">{item.lane}</span>
                    {item.branch ? <span className="mr-lanes-tag mono">{item.branch}</span> : null}
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <p className="mr-search-hint">No clean merged worktrees ready to remove.</p>
          )}
          {worktreesCommand ? (
            <p className="mr-search-hint">
              Clean manually: <code className="mono">{worktreesCommand}</code>
            </p>
          ) : null}
        </>
      ) : null}

      {canPreview ? (
        <div className="mr-search-row">
          <label htmlFor="mr-storage-days" className="hud-settings-label">
            Days to keep
          </label>
          <input
            id="mr-storage-days"
            type="number"
            min={MIN_DAYS}
            max={MAX_DAYS}
            className="mr-search-input mono"
            value={daysInput}
            disabled={busy}
            onChange={(event) => {
              setDaysInput(event.target.value)
              setPreview(null)
              setConfirmOpen(false)
              setError('')
            }}
          />
          <button type="button" className="mr-search-save" disabled={busy} onClick={runPreview}>
            Preview
          </button>
        </div>
      ) : null}

      {preview ? (
        <div className="mr-search" aria-live="polite">
          <p className="mr-search-state">
            {preview.count === 0
              ? `No finished files older than ${preview.days} ${preview.days === 1 ? 'day' : 'days'} to archive.`
              : `${preview.count} ${preview.count === 1 ? 'file' : 'files'} (${formatBytes(preview.totalBytes)}) ready to move into archive/.`}
          </p>
          {shownPreviewFiles.length > 0 ? (
            <ul className="mr-lanes-list" aria-label="Archive preview files">
              {shownPreviewFiles.map((item) => (
                <li className="mr-lanes-row" key={`${item.archiveDir}/${item.name}`}>
                  <span className="mr-lanes-name mono">{item.name}</span>
                  <span className="mr-lanes-tag mono">{item.archiveDir}</span>
                  <span className="hud-settings-value mono">{formatBytes(item.bytes)}</span>
                </li>
              ))}
              {hiddenPreviewCount > 0 ? (
                <li className="mr-lanes-row">
                  <span className="mr-lanes-name mono">{`+${hiddenPreviewCount} more files`}</span>
                </li>
              ) : null}
            </ul>
          ) : null}
          {canArchive && preview.count > 0 ? (
            <div className="mr-search-actions">
              <button
                type="button"
                className="mr-search-save"
                aria-controls="mr-storage-confirm"
                aria-expanded={confirmOpen}
                disabled={busy}
                onClick={() => {
                  setError('')
                  setConfirmOpen(true)
                }}
              >
                Archive
              </button>
            </div>
          ) : null}
        </div>
      ) : null}

      {notice ? <p className="mr-search-state is-good">{notice}</p> : null}
      {error ? <p className="mr-search-state is-error">{error}</p> : null}

      {confirmOpen && preview ? (
        <section
          id="mr-storage-confirm"
          ref={confirmRef}
          className="mr-search-confirm"
          role="dialog"
          aria-modal="true"
          aria-label="Confirm storage archive"
        >
          <p className="mr-search-confirm-text">
            {`Move ${preview.count} ${preview.count === 1 ? 'file' : 'files'} (${formatBytes(preview.totalBytes)}) older than ${preview.days} ${preview.days === 1 ? 'day' : 'days'} to archive?`}
          </p>
          <p className="mr-search-confirm-detail">
            Files keep their names under the archive month folder. Nothing is deleted.
          </p>
          <div className="mr-search-confirm-actions">
            <button
              type="button"
              className="mr-search-confirm-btn is-cancel"
              disabled={busy}
              onClick={() => setConfirmOpen(false)}
            >
              Cancel
            </button>
            <button
              type="button"
              className="mr-search-confirm-btn is-start"
              disabled={busy}
              onClick={runArchive}
            >
              Confirm archive
            </button>
          </div>
        </section>
      ) : null}
    </section>
  )
}
