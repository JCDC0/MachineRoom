import { useEffect, useState } from 'react'
import { createClient } from '../control/client.js'
import { store } from '../storage.js'
import { loadSettings } from './settings.js'

export const SEARCH_PROVIDERS = [
  { key: 'searxng', label: 'SearXNG' },
  { key: 'tavily', label: 'Tavily' },
  { key: 'brave', label: 'Brave' },
  { key: 'duckduckgo', label: 'DuckDuckGo' },
]

export const SEARCH_EMPTY = Object.freeze({ provider: '', url: '', keyName: '' })

export function searchChoiceFrom(value) {
  const raw = value && typeof value === 'object' && !Array.isArray(value) ? value : {}
  const provider = SEARCH_PROVIDERS.some((item) => item.key === raw.provider) ? raw.provider : ''
  return {
    provider,
    url: typeof raw.url === 'string' ? raw.url.trim() : '',
    keyName: typeof raw.keyName === 'string' ? raw.keyName.trim() : '',
  }
}

export function providerLabel(provider) {
  return SEARCH_PROVIDERS.find((item) => item.key === provider)?.label ?? 'Off'
}

export function keySlotName(provider) {
  return provider === 'tavily' || provider === 'brave' ? providerLabel(provider) : ''
}

export function keySaveProblem(value) {
  if (typeof value !== 'string' || value.length === 0) return 'Write the key.'
  if (value.length > 500) return 'Keep the key to 500 characters.'
  return ''
}

export function keyNamesFrom(answer) {
  const list = Array.isArray(answer) ? answer : Array.isArray(answer?.keys) ? answer.keys : []
  const names = []
  for (const item of list) {
    const name = typeof item === 'string' ? item : item?.name
    if (typeof name !== 'string') continue
    const clean = name.trim()
    if (clean !== '' && !names.includes(clean)) names.push(clean)
  }
  return names
}

export function searchChoiceProblem(choice) {
  const provider = String(choice?.provider ?? '')
  if (provider !== '' && !SEARCH_PROVIDERS.some((item) => item.key === provider)) return 'Pick a search provider.'
  if (provider !== 'searxng') return ''
  const url = String(choice?.url ?? '').trim()
  if (url === '') return 'Add the SearXNG address.'
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return 'The SearXNG address must start with http:// or https://.'
    }
    if (parsed.hostname === '') return 'The SearXNG address must start with http:// or https://.'
  } catch {
    return 'The SearXNG address must start with http:// or https://.'
  }
  return ''
}

export function searchChoiceSummary(choice) {
  const provider = providerLabel(choice?.provider)
  if (provider === 'Off') return 'Off'
  if (provider === 'SearXNG') return `SearXNG, ${String(choice?.url ?? '').trim() || 'no address'}`
  return `${provider}, key slot ${String(choice?.keyName ?? '').trim() || 'none'}`
}

function bridgeBase() {
  let saved = { bridge: '' }
  try {
    saved = loadSettings(store())
  } catch {}
  if (typeof window === 'undefined') return ''
  const dev = window.location.port === '5173'
  if (!dev) return ''
  let linked = ''
  try {
    linked = new URLSearchParams(window.location.search).get('bridge') ?? ''
  } catch {}
  return String(linked || saved.bridge || '').replace(/\/+$/, '')
}

function makeClient() {
  return createClient({ baseUrl: bridgeBase() })
}

export default function SearchSettings({ client: givenClient = null }) {
  const [client] = useState(() => givenClient ?? makeClient())
  const [form, setForm] = useState({ ...SEARCH_EMPTY })
  const [savedChoice, setSavedChoice] = useState({ ...SEARCH_EMPTY })
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState('')
  const [notice, setNotice] = useState({ text: '', error: false })
  const [confirm, setConfirm] = useState(false)
  const [keyValue, setKeyValue] = useState('')
  const [keyConfirm, setKeyConfirm] = useState(false)

  useEffect(() => {
    if (!confirm && !keyConfirm) return undefined
    function onKey(event) {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopPropagation()
      if (busy) return
      setConfirm(false)
      setKeyConfirm(false)
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [confirm, keyConfirm, busy])

  useEffect(() => {
    if (!client || typeof client.searchProvider !== 'function') {
      setLoading(false)
      setFailed('Web search settings need a newer bridge.')
      return undefined
    }
    let active = true
    setLoading(true)
    Promise.resolve()
      .then(() => client.searchProvider())
      .then((answer) => {
        if (!active) return
        const next = searchChoiceFrom(answer)
        setForm(next)
        setSavedChoice(next)
        setLoading(false)
      })
      .catch((error) => {
        if (!active) return
        setLoading(false)
        setFailed(String(error?.message ?? 'Could not read the web search provider.'))
      })
    return () => {
      active = false
    }
  }, [client])

  const problem = searchChoiceProblem(form)
  const needsUrl = form.provider === 'searxng'
  const needsKey = form.provider === 'tavily' || form.provider === 'brave'
  const keySlot = keySlotName(form.provider)

  function choose(patch) {
    setForm((current) => {
      const next = { ...current, ...patch }
      if (Object.hasOwn(patch, 'provider') && patch.provider !== current.provider) next.keyName = ''
      return next
    })
    setKeyValue('')
    setKeyConfirm(false)
    setNotice({ text: '', error: false })
    setConfirm(false)
  }

  function askKey() {
    const keyProblem = keySaveProblem(keyValue)
    if (keyProblem) {
      setNotice({ text: keyProblem, error: true })
      return
    }
    setKeyConfirm(true)
  }

  async function saveKey() {
    if (!client || typeof client.setKey !== 'function') {
      setNotice({ text: 'Web search settings need a newer bridge.', error: true })
      setKeyConfirm(false)
      return
    }
    const name = keySlot
    if (!name) {
      setNotice({ text: 'Pick Tavily or Brave first.', error: true })
      setKeyConfirm(false)
      return
    }
    setBusy(true)
    setNotice({ text: '', error: false })
    try {
      await client.setKey({ name, value: keyValue, confirmed: true })
      setForm((current) => ({ ...current, keyName: name }))
      setKeyValue('')
      setNotice({ text: `Saved ${name} key.`, error: false })
    } catch (error) {
      setNotice({ text: String(error?.message ?? error), error: true })
    }
    setBusy(false)
    setKeyConfirm(false)
  }

  async function save() {
    if (!client || typeof client.setSearchProvider !== 'function') {
      setNotice({ text: 'Web search settings need a newer bridge.', error: true })
      setConfirm(false)
      return
    }
    setBusy(true)
    setNotice({ text: '', error: false })
    try {
      const answer = await client.setSearchProvider({ ...form, confirmed: true })
      const next = searchChoiceFrom(answer)
      setForm(next)
      setSavedChoice(next)
      setNotice({ text: 'Web search saved.', error: false })
    } catch (error) {
      setNotice({ text: String(error?.message ?? error), error: true })
    }
    setBusy(false)
    setConfirm(false)
  }

  return (
    <section className="hud-settings-section mr-search" aria-labelledby="mr-search-title">
      <h3 id="mr-search-title" className="hud-settings-section-title">Web search</h3>
      <div className="mr-search-row">
        <label className="hud-settings-label" htmlFor="mr-search-provider">Provider</label>
        <select
          id="mr-search-provider"
          className="mr-search-select mono"
          value={form.provider}
          disabled={loading || busy}
          onChange={(event) => choose({ provider: event.target.value })}
        >
          <option value="">Off</option>
          {SEARCH_PROVIDERS.map((item) => (
            <option key={item.key} value={item.key}>{item.label}</option>
          ))}
        </select>
      </div>

      {needsUrl && (
        <div className="mr-search-row is-stack">
          <label className="hud-settings-label" htmlFor="mr-search-url">SearXNG address</label>
          <input
            id="mr-search-url"
            className="mr-search-input mono"
            type="url"
            value={form.url}
            placeholder="https://search.example"
            disabled={loading || busy}
            onChange={(event) => choose({ url: event.target.value })}
          />
        </div>
      )}

      {needsKey && (
        <div className="mr-search-row is-stack">
          <label className="hud-settings-label" htmlFor="mr-search-key">{providerLabel(form.provider)} API key</label>
          <input
            id="mr-search-key"
            className="mr-search-input mono"
            type="password"
            autoComplete="off"
            maxLength={500}
            value={keyValue}
            disabled={loading || busy}
            onChange={(event) => {
              setKeyValue(event.target.value)
              setNotice({ text: '', error: false })
            }}
          />
          <p className="mr-search-hint">
            {form.keyName === keySlot
              ? `Saved in the key slot ${keySlot}.`
              : `No key saved in the key slot ${keySlot} yet.`}
          </p>
          <div className="mr-search-actions">
            <button
              type="button"
              className="mr-search-save"
              disabled={loading || busy}
              onClick={askKey}
            >
              Save key
            </button>
          </div>
        </div>
      )}

      <p className="mr-search-state mono">
        {loading ? 'Loading' : `Saved: ${searchChoiceSummary(savedChoice)}`}
      </p>
      {problem !== '' && <p className="mr-search-state is-error">{problem}</p>}
      {failed !== '' && <p className="mr-search-state is-error">{failed}</p>}
      {notice.text !== '' && (
        <p className={`mr-search-state ${notice.error ? 'is-error' : 'is-good'}`}>{notice.text}</p>
      )}

      <div className="mr-search-actions">
        <button
          type="button"
          className="mr-search-save"
          disabled={loading || busy || problem !== '' || failed !== ''}
          onClick={() => setConfirm(true)}
        >
          Save
        </button>
      </div>

      {confirm && (
        <section className="mr-search-confirm" aria-label="Save web search">
          <p className="mr-search-confirm-text">Save web search?</p>
          <p className="mr-search-confirm-detail mono">{searchChoiceSummary(form)}</p>
          <div className="mr-search-confirm-actions">
            <button type="button" className="mr-search-confirm-btn is-start" onClick={save} disabled={busy}>
              Save
            </button>
            <button
              type="button"
              className="mr-search-confirm-btn is-cancel"
              onClick={() => setConfirm(false)}
              disabled={busy}
            >
              Cancel
            </button>
          </div>
        </section>
      )}

      {keyConfirm && (
        <section className="mr-search-confirm" aria-label="Save key">
          <p className="mr-search-confirm-text">{`Save the ${keySlot} key?`}</p>
          <p className="mr-search-confirm-detail mono">{`Key slot ${keySlot}`}</p>
          <div className="mr-search-confirm-actions">
            <button type="button" className="mr-search-confirm-btn is-start" onClick={saveKey} disabled={busy}>
              Save key
            </button>
            <button
              type="button"
              className="mr-search-confirm-btn is-cancel"
              onClick={() => setKeyConfirm(false)}
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
