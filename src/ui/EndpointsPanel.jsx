import { useEffect, useState } from 'react'

const NAME_PATTERN = /^[A-Za-z0-9 _-]{1,40}$/
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]'])
const MAX_ENDPOINTS = 20
const MAX_MODELS = 50

export const ENDPOINT_NAME_PROBLEM = 'The endpoint name must be 1 to 40 letters, digits, spaces, dashes or underscores.'
export const ENDPOINT_PROVIDER_PROBLEM = 'Choose a provider from the list.'
export const ENDPOINT_BASE_URL_PROBLEM = 'The base URL must be a full https address, or http on this computer.'
export const ENDPOINT_KEY_PROBLEM = 'A remote endpoint needs a key slot.'
export const ENDPOINT_KEY_NAME_PROBLEM = 'The key slot name must be 1 to 40 letters, digits, spaces, dashes or underscores.'
export const ENDPOINT_MODELS_PROBLEM = 'Models must be a list of 0 to 50 ids.'
export const ENDPOINT_MAX_PROBLEM = 'At most 20 endpoints are allowed.'

export function baseUrlForProvider(providers, name) {
  const found = (Array.isArray(providers) ? providers : []).find((entry) => entry?.name === name)
  return typeof found?.baseUrl === 'string' ? found.baseUrl : ''
}

export function modelsFromText(text) {
  const seen = new Set()
  const models = []
  for (const line of String(text ?? '').split(/\r?\n/)) {
    const id = line.trim()
    if (id === '' || seen.has(id)) continue
    seen.add(id)
    models.push(id)
  }
  return models
}

export function modelsText(models) {
  return (Array.isArray(models) ? models : []).join('\n')
}

function localHost(hostname) {
  return LOCAL_HOSTS.has(String(hostname ?? '').toLowerCase())
}

export function endpointDraftProblem(draft, providers = []) {
  const name = typeof draft?.name === 'string' ? draft.name.trim() : ''
  if (!NAME_PATTERN.test(name)) return ENDPOINT_NAME_PROBLEM
  const provider = typeof draft?.provider === 'string' ? draft.provider.trim() : ''
  if (!(Array.isArray(providers) ? providers : []).some((entry) => entry?.name === provider)) return ENDPOINT_PROVIDER_PROBLEM
  const text = typeof draft?.baseUrl === 'string' ? draft.baseUrl.trim() : ''
  let url
  try {
    url = new URL(text)
  } catch {
    return ENDPOINT_BASE_URL_PROBLEM
  }
  if (url.username !== '' || url.password !== '' || url.search !== '' || url.hash !== '') return ENDPOINT_BASE_URL_PROBLEM
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return ENDPOINT_BASE_URL_PROBLEM
  if (url.protocol === 'http:' && !localHost(url.hostname)) return ENDPOINT_BASE_URL_PROBLEM
  const keyName = typeof draft?.keyName === 'string' ? draft.keyName.trim() : ''
  if (keyName !== '' && !NAME_PATTERN.test(keyName)) return ENDPOINT_KEY_NAME_PROBLEM
  if (keyName === '' && !localHost(url.hostname)) return ENDPOINT_KEY_PROBLEM
  if (!Array.isArray(draft?.models)) return ENDPOINT_MODELS_PROBLEM
  if (draft.models.length > MAX_MODELS) return ENDPOINT_MODELS_PROBLEM
  for (const model of draft.models) {
    if (typeof model !== 'string' || model.trim() === '') return ENDPOINT_MODELS_PROBLEM
  }
  return null
}

function endpointCount(models) {
  const count = Array.isArray(models) ? models.length : 0
  return `${count} ${count === 1 ? 'model' : 'models'}`
}

export default function EndpointsPanel({ client, initialEndpoints = null, initialProviders = null, initialOpen = false, initialKeys = [] }) {
  const [endpoints, setEndpoints] = useState(() => (Array.isArray(initialEndpoints) ? initialEndpoints : []))
  const [providers, setProviders] = useState(() => (Array.isArray(initialProviders) ? initialProviders : []))
  const [keyNames, setKeyNames] = useState(() => (Array.isArray(initialKeys) ? initialKeys : []))
  const [loading, setLoading] = useState(() => !Array.isArray(initialEndpoints))
  const [error, setError] = useState('')
  const [note, setNote] = useState('')
  const [formOpen, setFormOpen] = useState(Boolean(initialOpen))
  const [name, setName] = useState('')
  const [provider, setProvider] = useState(() => (Array.isArray(initialProviders) ? initialProviders[0]?.name ?? '' : ''))
  const [baseUrl, setBaseUrl] = useState(() => baseUrlForProvider(initialProviders, initialProviders?.[0]?.name))
  const [keyName, setKeyName] = useState('')
  const [modelText, setModelText] = useState('')
  const [confirm, setConfirm] = useState(null)
  const [busy, setBusy] = useState(false)

  async function loadData() {
    if (!client || typeof client.endpoints !== 'function') {
      setLoading(false)
      return
    }
    setLoading(true)
    setError('')
    try {
      const list = await client.endpoints()
      setEndpoints(Array.isArray(list) ? list : [])
    } catch (err) {
      setError(err?.message || 'Could not load the endpoints.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    let alive = true
    async function load() {
      if (!client) {
        setLoading(false)
        return
      }
      const [providerList, endpointList, keys] = await Promise.allSettled([
        typeof client.providers === 'function' ? client.providers() : [],
        typeof client.endpoints === 'function' ? client.endpoints() : [],
        typeof client.keys === 'function' ? client.keys() : [],
      ])
      if (!alive) return
      if (providerList.status === 'fulfilled') setProviders(Array.isArray(providerList.value) ? providerList.value : [])
      if (endpointList.status === 'fulfilled') setEndpoints(Array.isArray(endpointList.value) ? endpointList.value : [])
      else setError(endpointList.reason?.message || 'Could not load the endpoints.')
      if (keys.status === 'fulfilled') {
        const list = Array.isArray(keys.value) ? keys.value : []
        setKeyNames(list.map((entry) => (typeof entry === 'string' ? entry : entry?.name)).filter((entry) => typeof entry === 'string' && entry !== ''))
      }
      setLoading(false)
    }
    load()
    return () => {
      alive = false
    }
  }, [client])

  function openForm() {
    const first = providers[0]
    setFormOpen(true)
    setName('')
    setProvider(first?.name ?? '')
    setBaseUrl(first?.baseUrl ?? '')
    setKeyName('')
    setModelText('')
    setError('')
    setNote('')
    setConfirm(null)
  }

  function chooseProvider(next) {
    setProvider(next)
    setBaseUrl(baseUrlForProvider(providers, next))
  }

  function draft() {
    return {
      name: name.trim(),
      provider,
      baseUrl: baseUrl.trim(),
      keyName: keyName.trim(),
      models: modelsFromText(modelText),
    }
  }

  function askSave() {
    const next = draft()
    const problem = endpointDraftProblem(next, providers)
    if (problem) {
      setError(problem)
      return
    }
    if (!endpoints.some((entry) => entry.name === next.name) && endpoints.length >= MAX_ENDPOINTS) {
      setError(ENDPOINT_MAX_PROBLEM)
      return
    }
    setError('')
    setConfirm({ kind: 'save', endpoint: next })
  }

  async function save(next) {
    if (!client || typeof client.saveEndpoint !== 'function') {
      setError('The bridge is not reachable.')
      return
    }
    setBusy(true)
    setError('')
    try {
      await client.saveEndpoint({ ...next, confirmed: true })
      await loadData()
      setConfirm(null)
      setFormOpen(false)
      setNote(`Saved ${next.name}.`)
    } catch (err) {
      setError(err?.message || 'Could not save the endpoint.')
    } finally {
      setBusy(false)
    }
  }

  async function askDelete(endpoint) {
    setError('')
    setNote('')
    setConfirm({ kind: 'delete', endpoint })
  }

  async function remove(endpoint) {
    if (!client || typeof client.deleteEndpoint !== 'function') {
      setError('The bridge is not reachable.')
      return
    }
    setBusy(true)
    setError('')
    try {
      await client.deleteEndpoint({ name: endpoint.name, confirmed: true })
      await loadData()
      setConfirm(null)
      setNote(`Deleted ${endpoint.name}.`)
    } catch (err) {
      setError(err?.message || 'Could not delete the endpoint.')
    } finally {
      setBusy(false)
    }
  }

  async function fetchModels(nameForFetch, saved = true) {
    if (!saved) {
      setError('Save the endpoint first.')
      return
    }
    if (!client || typeof client.endpointModels !== 'function') {
      setError('The bridge is not reachable.')
      return
    }
    setBusy(true)
    setError('')
    try {
      const models = await client.endpointModels(nameForFetch)
      setModelText(modelsText(models))
      setNote(`Fetched ${endpointCount(models)} for ${nameForFetch}.`)
    } catch (err) {
      setError(err?.message || 'Could not fetch the models.')
    } finally {
      setBusy(false)
    }
  }

  async function askRowModels(endpoint) {
    if (!client || typeof client.endpointModels !== 'function') {
      setError('The bridge is not reachable.')
      return
    }
    setBusy(true)
    setError('')
    try {
      const models = await client.endpointModels(endpoint.name)
      setConfirm({ kind: 'models', endpoint: { ...endpoint, models }, models })
    } catch (err) {
      setError(err?.message || 'Could not fetch the models.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="hud-settings-section endpoints-panel">
      <div className="hud-settings-row">
        <h3 className="hud-settings-section-title">Providers</h3>
        <button type="button" className="hud-settings-switch" onClick={openForm}>
          Add endpoint
        </button>
      </div>

      {loading ? <p className="endpoints-note mono">Loading endpoints.</p> : null}
      {error ? <p className="endpoints-error mono">{error}</p> : null}
      {note ? <p className="endpoints-note mono">{note}</p> : null}

      {!loading && endpoints.length === 0 ? (
        <p className="endpoints-note mono">No endpoints yet.</p>
      ) : null}

      {endpoints.map((endpoint) => (
        <div key={endpoint.name} className="endpoints-row">
          <div className="endpoints-row-head">
            <span className="endpoints-name">{endpoint.name}</span>
            <span className="endpoints-meta mono">{endpoint.provider}</span>
          </div>
          <div className="endpoints-url mono">{endpoint.baseUrl}</div>
          <div className="endpoints-meta mono">
            {endpointCount(endpoint.models)}
            {endpoint.keyName ? ` // key slot ${endpoint.keyName}` : ' // no key'}
          </div>
          <div className="endpoints-actions">
            <button
              type="button"
              className="hud-settings-switch"
              disabled={busy}
              onClick={() => askRowModels(endpoint)}
            >
              Fetch models
            </button>
            <button
              type="button"
              className="hud-settings-switch"
              disabled={busy}
              onClick={() => askDelete(endpoint)}
            >
              Delete
            </button>
          </div>
        </div>
      ))}

      {formOpen ? (
        <div className="endpoints-form">
          <div className="endpoints-field">
            <label className="endpoints-label mono" htmlFor="endpoints-provider">Provider</label>
            <select
              id="endpoints-provider"
              value={provider}
              onChange={(event) => chooseProvider(event.target.value)}
            >
              {providers.map((entry) => (
                <option key={entry.name} value={entry.name}>{entry.name}</option>
              ))}
            </select>
          </div>
          <div className="endpoints-field">
            <label className="endpoints-label mono" htmlFor="endpoints-name">Name</label>
            <input
              id="endpoints-name"
              type="text"
              maxLength={40}
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </div>
          <div className="endpoints-field">
            <label className="endpoints-label mono" htmlFor="endpoints-base-url">Base URL</label>
            <input
              id="endpoints-base-url"
              type="text"
              value={baseUrl}
              onChange={(event) => setBaseUrl(event.target.value)}
            />
          </div>
          <div className="endpoints-field">
            <label className="endpoints-label mono" htmlFor="endpoints-key">Key slot</label>
            <select
              id="endpoints-key"
              value={keyName}
              onChange={(event) => setKeyName(event.target.value)}
            >
              <option value="">No key (local server)</option>
              {keyNames.map((slot) => (
                <option key={slot} value={slot}>{slot}</option>
              ))}
            </select>
          </div>
          <div className="endpoints-field">
            <label className="endpoints-label mono" htmlFor="endpoints-models">Models</label>
            <textarea
              id="endpoints-models"
              rows={4}
              value={modelText}
              onChange={(event) => setModelText(event.target.value)}
            />
            <div className="endpoints-actions">
              <button
                type="button"
                className="hud-settings-switch"
                disabled={busy || name.trim() === ''}
                onClick={() => fetchModels(name.trim(), endpoints.some((entry) => entry.name === name.trim()))}
              >
                Fetch models
              </button>
              <button type="button" className="hud-settings-switch" disabled={busy} onClick={askSave}>
                Save
              </button>
              <button type="button" className="hud-settings-switch" disabled={busy} onClick={() => setFormOpen(false)}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {confirm?.kind === 'save' ? (
        <div className="brief-confirm-card endpoints-confirm">
          <div className="brief-confirm-meta mono">
            <span>{confirm.endpoint.name}</span>
            <span>{confirm.endpoint.provider}</span>
            <span>{endpointCount(confirm.endpoint.models)}</span>
          </div>
          <p className="brief-confirm-warning">
            Save {confirm.endpoint.name} with the base URL {confirm.endpoint.baseUrl}?
          </p>
          <div className="brief-confirm-actions">
            <button
              type="button"
              className="hud-settings-switch brief-confirm-btn"
              disabled={busy}
              onClick={() => save(confirm.endpoint)}
            >
              Save endpoint
            </button>
            <button type="button" className="hud-settings-switch" disabled={busy} onClick={() => setConfirm(null)}>
              Cancel
            </button>
          </div>
        </div>
      ) : null}

      {confirm?.kind === 'delete' ? (
        <div className="brief-confirm-card endpoints-confirm">
          <p className="brief-confirm-warning">Delete {confirm.endpoint.name}?</p>
          <div className="brief-confirm-actions">
            <button
              type="button"
              className="hud-settings-switch brief-confirm-btn"
              disabled={busy}
              onClick={() => remove(confirm.endpoint)}
            >
              Delete endpoint
            </button>
            <button type="button" className="hud-settings-switch" disabled={busy} onClick={() => setConfirm(null)}>
              Cancel
            </button>
          </div>
        </div>
      ) : null}

      {confirm?.kind === 'models' ? (
        <div className="brief-confirm-card endpoints-confirm">
          <p className="brief-confirm-warning">
            Save {endpointCount(confirm.models)} for {confirm.endpoint.name}?
          </p>
          <div className="brief-confirm-actions">
            <button
              type="button"
              className="hud-settings-switch brief-confirm-btn"
              disabled={busy}
              onClick={() => save(confirm.endpoint)}
            >
              Save models
            </button>
            <button type="button" className="hud-settings-switch" disabled={busy} onClick={() => setConfirm(null)}>
              Cancel
            </button>
          </div>
        </div>
      ) : null}
    </div>
  )
}
