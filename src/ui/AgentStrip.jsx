import { useState } from 'react'
import AutocompactInput from './AutocompactInput.jsx'

function messageOf(error, fallback) {
  return error instanceof Error && error.message.trim() ? error.message : fallback
}

export default function CompactCard({
  name = 'The orchestrator',
  id = 'orchestrator',
  orchestrator = null,
  client = null,
  onChange = () => {},
  onClose = () => {},
}) {
  const [keep, setKeep] = useState('')
  const [confirm, setConfirm] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const canCompact = typeof client?.compactOrchestrator === 'function'

  async function runCompact() {
    if (saving) return
    if (typeof client?.compactOrchestrator !== 'function') {
      setError('The bridge cannot compact.')
      return
    }
    setSaving(true)
    setError('')
    try {
      await client.compactOrchestrator({
        id,
        keep: keep.trim().slice(0, 2000),
        confirmed: true,
      })
      setConfirm(false)
      setKeep('')
      onChange()
      onClose()
    } catch (failure) {
      setError(messageOf(failure, 'The bridge refused the compact.'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="strip-card hud-strip-compact-card" aria-label="Compact the orchestrator">
      <div className="hud-strip-compact-head">
        <p className="strip-label">Compact the conversation</p>
        <button type="button" className="strip-btn mono" onClick={onClose}>
          Close
        </button>
      </div>
      <label className="strip-label" htmlFor="hud-strip-keep">
        What to keep
      </label>
      <textarea
        id="hud-strip-keep"
        className="strip-input mono"
        value={keep}
        maxLength={2000}
        rows={2}
        onChange={(event) => setKeep(event.target.value)}
      />
      <button
        type="button"
        className="strip-btn mono"
        onClick={() => setConfirm(true)}
        disabled={!canCompact}
      >
        Compact now
      </button>
      {!canCompact && (
        <p className="strip-note">Compacting is not available from this bridge.</p>
      )}
      <AutocompactInput
        orchestrator={orchestrator ?? { id }}
        client={client}
        onSaved={onChange}
      />
      {confirm && (
        <section className="mr-orch-confirm" aria-label="Compact the orchestrator">
          <p className="mr-orch-confirm-text">{`Compact ${name} now?`}</p>
          {keep.trim() && (
            <p className="mr-orch-confirm-detail mono">{`Keep: ${keep.trim()}`}</p>
          )}
          {error && <p className="strip-note is-error">{error}</p>}
          <div className="mr-orch-confirm-actions">
            <button
              type="button"
              className="mr-orch-confirm-btn is-start"
              onClick={runCompact}
              disabled={saving}
            >
              Compact now
            </button>
            <button
              type="button"
              className="mr-orch-confirm-btn is-cancel"
              onClick={() => {
                setConfirm(false)
                setError('')
              }}
              disabled={saving}
            >
              Cancel
            </button>
          </div>
        </section>
      )}
    </section>
  )
}
