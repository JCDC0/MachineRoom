import { useEffect, useRef, useState } from 'react'
import { useDialogFocus } from './dialogFocus.js'
import { keyNamesFrom } from './SearchSettings.jsx'

export const DELETE_KEY_DETAIL =
  'Its saved value is lost, and an endpoint or search provider that uses it stops working.'

export function deleteKeyText(name) {
  const label = typeof name === 'string' && name.trim() !== '' ? name.trim() : 'this key'
  return `Delete ${label}? ${DELETE_KEY_DETAIL}`
}

export default function KeysSettings({ client = null }) {
  const canList = Boolean(client) && typeof client.keys === 'function'
  const canDelete = Boolean(client) && typeof client.deleteKey === 'function'
  const [names, setNames] = useState([])
  const [loading, setLoading] = useState(canList)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const cardRef = useRef(null)

  useEffect(() => {
    if (!canList) return undefined
    let alive = true
    setLoading(true)
    setError('')
    Promise.resolve()
      .then(() => client.keys())
      .then((answer) => {
        if (!alive) return
        setNames(keyNamesFrom(answer))
        setLoading(false)
      })
      .catch((failure) => {
        if (!alive) return
        setLoading(false)
        setError(String(failure?.message ?? failure))
      })
    return () => {
      alive = false
    }
  }, [client, canList])

  async function readKeys() {
    try {
      const answer = await client.keys()
      setNames(keyNamesFrom(answer))
      setError('')
    } catch (failure) {
      setError(String(failure?.message ?? failure))
    }
  }

  async function remove() {
    if (busy) return
    const name = confirm
    if (!canDelete) {
      setConfirm('')
      setError('Keys need a newer bridge.')
      return
    }
    setBusy(true)
    setError('')
    setNotice('')
    try {
      await client.deleteKey({ name, confirmed: true })
      setNames((current) => current.filter((item) => item !== name))
      setConfirm('')
      setNotice(`Deleted ${name}.`)
      await readKeys()
    } catch (failure) {
      setError(String(failure?.message ?? failure))
      setConfirm('')
    }
    setBusy(false)
  }

  useDialogFocus(confirm !== '', { containerRef: cardRef, openerSelector: 'mr-keys-confirm' })

  if (!canList) return null

  return (
    <section className="hud-settings-section mr-keys" aria-labelledby="mr-keys-title">
      <h3 id="mr-keys-title" className="hud-settings-section-title">Keys</h3>
      {loading && <p className="mr-keys-state mono">Loading</p>}
      {!loading && names.length === 0 && error === '' && (
        <p className="mr-keys-state mono">No saved keys.</p>
      )}
      {names.length > 0 && (
        <ul className="mr-keys-list">
          {names.map((name) => (
            <li key={name} className="mr-keys-row">
              <span className="mr-keys-name mono">{name}</span>
              {canDelete && (
                <button
                  type="button"
                  className="mr-keys-delete"
                  aria-label={`Delete ${name}`}
                  aria-controls="mr-keys-confirm"
                  aria-expanded={confirm === name}
                  onClick={() => {
                    setNotice('')
                    setError('')
                    setConfirm(name)
                  }}
                >
                  Delete
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {notice !== '' && <p className="mr-keys-state mono">{notice}</p>}
      {error !== '' && <p className="mr-keys-state mono is-error">{error}</p>}
      {confirm !== '' && (
        <section
          id="mr-keys-confirm"
          ref={cardRef}
          className="mr-keys-confirm"
          aria-label="Delete key"
          onKeyDown={(event) => {
            if (event.key !== 'Escape') return
            event.preventDefault()
            event.stopPropagation()
            setConfirm('')
          }}
        >
          <p className="mr-keys-confirm-text">{deleteKeyText(confirm)}</p>
          <div className="mr-keys-confirm-actions">
            <button
              type="button"
              className="mr-keys-confirm-btn is-start"
              onClick={remove}
              disabled={busy}
            >
              Delete
            </button>
            <button
              type="button"
              className="mr-keys-confirm-btn is-cancel"
              onClick={() => setConfirm('')}
              disabled={busy}
            >
              Cancel
            </button>
          </div>
        </section>
      )}
    </section>
  )
}
