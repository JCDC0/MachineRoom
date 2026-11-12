import { useEffect, useMemo, useRef, useState } from 'react'
import ModelPicker from './ModelPicker.jsx'
import ModelRefresh from './ModelRefresh.jsx'
import { useDialogFocus } from './dialogFocus.js'

const NAME_PATTERN = /^[A-Za-z0-9 _-]{1,40}$/
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]'])
const MAX_ENDPOINTS = 20
const MAX_MODELS = 1000

export const ENDPOINT_NAME_PROBLEM = 'The endpoint name must be 1 to 40 letters, digits, spaces, dashes or underscores.'
export const ENDPOINT_PROVIDER_PROBLEM = 'Choose a provider from the list.'
export const ENDPOINT_BASE_URL_PROBLEM = 'The base URL must be a full https address, or http on this computer.'
export const ENDPOINT_KEY_PROBLEM = 'A remote endpoint needs a key slot.'
export const ENDPOINT_KEY_NAME_PROBLEM = 'The key slot name must be 1 to 40 letters, digits, spaces, dashes or underscores.'
export const ENDPOINT_MODELS_PROBLEM = 'Models must be a list of 0 to 1000 ids.'
export const ENDPOINT_MAX_PROBLEM = 'At most 20 endpoints are allowed.'
export const QUICK_PROVIDER_PROBLEM = 'Choose a provider from the list.'
export const QUICK_KEY_PROBLEM = 'Write the key.'

export function baseUrlForProvider(providers, name) {
  const found = (Array.isArray(providers) ? providers : []).find((entry) => entry?.name === name)
  return typeof found?.baseUrl === 'string' ? found.baseUrl : ''
}

export function quickProviders(providers) {
  const list = []
  const seen = new Set()
  for (const entry of Array.isArray(providers) ? providers : []) {
    if (!entry || typeof entry !== 'object') continue
    const name = typeof entry.name === 'string' ? entry.name.trim() : ''
    const baseUrl = typeof entry.baseUrl === 'string' ? entry.baseUrl.trim() : ''
    if (!name || !baseUrl || seen.has(name)) continue
    seen.add(name)
    list.push({ ...entry, name, baseUrl })
  }
  return [
    ...list.filter((entry) => entry.name === 'OpenRouter'),
    ...list.filter((entry) => entry.name !== 'OpenRouter'),
  ]
}

export function quickKeyProblem(provider, key) {
  const name = typeof provider === 'string' ? provider.trim() : ''
  if (!name) return QUICK_PROVIDER_PROBLEM
  if (typeof key !== 'string' || key.length === 0) return QUICK_KEY_PROBLEM
  if (key.length > 500) return 'Keep the key to 500 characters.'
  return null
}

export function quickConfirmText(provider) {
  const name = typeof provider === 'string' && provider.trim() ? provider.trim() : 'provider'
  return `Save the ${name} key and load its models?`
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

export function keySlotNames(answer) {
  const list = Array.isArray(answer) ? answer : Array.isArray(answer?.keys) ? answer.keys : []
  const names = []
  for (const entry of list) {
    const name = typeof entry === 'string' ? entry : entry?.name
    if (typeof name !== 'string') continue
    const clean = name.trim()
    if (clean !== '' && !names.includes(clean)) names.push(clean)
  }
  return names
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

function modelCount(models) {
  if (Array.isArray(models)) return models.length
  if (Number.isInteger(models) && models >= 0) return models
  return 0
}

function endpointCount(models) {
  const count = modelCount(models)
  return `${count} ${count === 1 ? 'model' : 'models'}`
}

export function quickSavedText(answer, provider) {
  const error = typeof answer?.error === 'string' ? answer.error.trim() : ''
  if (error) return error
  const name = typeof provider === 'string' && provider.trim() ? provider.trim() : 'provider'
  return `Saved ${name}, ${endpointCount(answer?.endpoint?.models)}.`
}

export default function EndpointsPanel({ client, initialEndpoints = null, initialProviders = null, initialOpen = false, initialKeys = [] }) {
  const [endpoints, setEndpoints] = useState(() => (Array.isArray(initialEndpoints) ? initialEndpoints : []))
  const [providers, setProviders] = useState(() => (Array.isArray(initialProviders) ? initialProviders : []))
  const [keyNames, setKeyNames] = useState(() => (Array.isArray(initialKeys) ? initialKeys : []))
  const [loading, setLoading] = useState(() => !Array.isArray(initialEndpoints))
  const [error, setError] = useState('')
  const [modelsError, setModelsError] = useState('')
  const [note, setNote] = useState('')
  const [quickProvider, setQuickProvider] = useState(
    () => quickProviders(initialProviders)[0]?.name ?? ''
  )
  const [quickKey, setQuickKey] = useState('')
  const [quickNotice, setQuickNotice] = useState({ text: '', error: false })
  const [quickConfirm, setQuickConfirm] = useState(null)
  const [quickBusy, setQuickBusy] = useState(false)
  const [formOpen, setFormOpen] = useState(Boolean(initialOpen))
  const [name, setName] = useState('')
  const [provider, setProvider] = useState(() => (Array.isArray(initialProviders) ? initialProviders[0]?.name ?? '' : ''))
  const [baseUrl, setBaseUrl] = useState(() => baseUrlForProvider(initialProviders, initialProviders?.[0]?.name))
  const [keyName, setKeyName] = useState('')
  const [modelText, setModelText] = useState('')
  const [confirm, setConfirm] = useState(null)
  const [busy, setBusy] = useState(false)
  const [modelsBusy, setModelsBusy] = useState(false)
  const [pickedModel, setPickedModel] = useState({})
  const quickKeyRef = useRef(null)
  const quickConfirmRef = useRef(null)
  const confirmRef = useRef(null)

  useDialogFocus(Boolean(quickConfirm), { containerRef: quickConfirmRef })
  useDialogFocus(Boolean(confirm), { containerRef: confirmRef })

  useEffect(() => {
    if (!confirm && !quickConfirm) return undefined
    function onKey(event) {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopPropagation()
      if (quickConfirm && !quickBusy) {
        setQuickConfirm(null)
        return
      }
      if (confirm && !busy) setConfirm(null)
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [confirm, quickConfirm, busy, quickBusy])

  const quickList = useMemo(() => quickProviders(providers), [providers])

  async function loadData({ reloadFailed = '' } = {}) {
    if (!client || typeof client.endpoints !== 'function') {
      setLoading(false)
      return
    }
    setLoading(true)
    setError('')
    try {
      const [endpointList, keys] = await Promise.allSettled([
        Promise.resolve().then(() => client.endpoints()),
        typeof client.keys === 'function' ? Promise.resolve().then(() => client.keys()) : Promise.resolve(null),
      ])
      if (endpointList.status === 'fulfilled') {
        setEndpoints(Array.isArray(endpointList.value) ? endpointList.value : [])
      } else {
        setError(endpointList.reason?.message || reloadFailed || 'Could not load the endpoints.')
      }
      if (keys.status === 'fulfilled' && keys.value !== null) setKeyNames(keySlotNames(keys.value))
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
      try {
        const [providerList, endpointList, keys] = await Promise.allSettled([
          typeof client.providers === 'function' ? Promise.resolve().then(() => client.providers()) : Promise.resolve([]),
          typeof client.endpoints === 'function' ? Promise.resolve().then(() => client.endpoints()) : Promise.resolve([]),
          typeof client.keys === 'function' ? Promise.resolve().then(() => client.keys()) : Promise.resolve([]),
        ])
        if (!alive) return
        if (providerList.status === 'fulfilled') setProviders(Array.isArray(providerList.value) ? providerList.value : [])
        if (endpointList.status === 'fulfilled') setEndpoints(Array.isArray(endpointList.value) ? endpointList.value : [])
        else setError(endpointList.reason?.message || 'Could not load the endpoints.')
        if (keys.status === 'fulfilled') {
          setKeyNames(keySlotNames(keys.value))
        }
      } finally {
        if (alive) setLoading(false)
      }
    }
    load().catch((error) => {
      if (!alive) return
      setError(error?.message || 'Could not load the endpoints.')
    })
    return () => {
      alive = false
    }
  }, [client])

  useEffect(() => {
    if (quickList.length === 0) {
      if (quickProvider !== '') setQuickProvider('')
      return
    }
    if (!quickList.some((entry) => entry.name === quickProvider)) setQuickProvider(quickList[0].name)
  }, [quickList, quickProvider])

  function openForm() {
    const first = providers[0]
    setFormOpen(true)
    setName('')
    setProvider(first?.name ?? '')
    setBaseUrl(first?.baseUrl ?? '')
    setKeyName('')
    setModelText('')
    setError('')
    setModelsError('')
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
    } catch (err) {
      setError(err?.message || 'Could not save the endpoint.')
      setBusy(false)
      return
    }
    setConfirm(null)
    setFormOpen(false)
    setNote(`Saved ${next.name}.`)
    setBusy(false)
    await loadData({ reloadFailed: 'The endpoint was saved, but the list could not be read.' })
  }

  function askQuick() {
    const problem = quickKeyProblem(quickProvider, quickKey)
    if (problem) {
      setQuickNotice({ text: problem, error: true })
      return
    }
    setQuickNotice({ text: '', error: false })
    setQuickConfirm({ provider: quickProvider, key: quickKey })
  }

  async function saveQuick(next) {
    if (!client || typeof client.quickEndpoint !== 'function') {
      setQuickNotice({ text: 'The bridge is not reachable.', error: true })
      setQuickConfirm(null)
      return
    }
    setQuickBusy(true)
    setQuickNotice({ text: '', error: false })
    let answer
    try {
      answer = await client.quickEndpoint({
        provider: next.provider,
        key: next.key,
        confirmed: true,
      })
    } catch (err) {
      setQuickNotice({ text: err?.message || 'Could not save the key.', error: true })
      setQuickBusy(false)
      setQuickConfirm(null)
      return
    }
    setQuickKey('')
    setQuickNotice({ text: quickSavedText(answer, next.provider), error: Boolean(answer?.error) })
    setQuickBusy(false)
    setQuickConfirm(null)
    await loadData({ reloadFailed: 'The key was saved, but the list could not be read.' })
  }

  function replaceKey(endpoint) {
    const selected = endpoint.provider || endpoint.name
    if (!quickList.some((entry) => entry.name === selected)) {
      setQuickNotice({ text: 'This endpoint has no provider preset.', error: true })
      return
    }
    setQuickProvider(selected)
    setQuickKey('')
    setQuickConfirm(null)
    setQuickNotice({ text: '', error: false })
    if (quickKeyRef.current?.focus) quickKeyRef.current.focus()
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
    } catch (err) {
      setError(err?.message || 'Could not delete the endpoint.')
      setBusy(false)
      return
    }
    setConfirm(null)
    setNote(`Deleted ${endpoint.name}.`)
    setBusy(false)
    await loadData({ reloadFailed: 'The endpoint was deleted, but the list could not be read.' })
  }

  async function refreshModels(endpoint) {
    if (!client || typeof client.endpointModels !== 'function' || typeof client.saveEndpoint !== 'function') {
      setError('The bridge is not reachable.')
      return
    }
    setBusy(true)
    setError('')
    setModelsError('')
    setNote('')
    try {
      const models = await client.endpointModels(endpoint.name)
      await client.saveEndpoint({ ...endpoint, models, confirmed: true })
      setNote(`Saved ${endpoint.name}, ${endpointCount(models)}.`)
      setBusy(false)
      await loadData({ reloadFailed: 'The models were saved, but the list could not be read.' })
    } catch (err) {
      setError(err?.message || 'Could not refresh the models.')
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
    setModelsBusy(true)
    setError('')
    setModelsError('')
    try {
      const models = await client.endpointModels(nameForFetch)
      setModelText(modelsText(models))
      setNote(`Fetched ${endpointCount(models)} for ${nameForFetch}.`)
    } catch (err) {
      setModelsError(err?.message || 'Could not fetch the models.')
    } finally {
      setBusy(false)
      setModelsBusy(false)
    }
  }

  return (
    <div id="settings-direct-api" className="hud-settings-section endpoints-panel">
      <h3 className="hud-settings-section-title">Direct API</h3>

      <div className="endpoints-quick">
        <div className="endpoints-field">
          <label className="endpoints-label mono" htmlFor="endpoints-quick-provider">Provider</label>
          <select
            id="endpoints-quick-provider"
            value={quickProvider}
            disabled={quickBusy || quickList.length === 0}
            onChange={(event) => {
              setQuickProvider(event.target.value)
              setQuickNotice({ text: '', error: false })
              setQuickConfirm(null)
            }}
          >
            {quickList.map((entry) => (
              <option key={entry.name} value={entry.name}>{entry.name}</option>
            ))}
          </select>
        </div>
        <div className="endpoints-field">
          <label className="endpoints-label mono" htmlFor="endpoints-quick-key">Key</label>
          <input
            ref={quickKeyRef}
            id="endpoints-quick-key"
            type="password"
            autoComplete="off"
            maxLength={500}
            value={quickKey}
            disabled={quickBusy}
            onChange={(event) => {
              setQuickKey(event.target.value)
              setQuickNotice({ text: '', error: false })
              setQuickConfirm(null)
            }}
          />
        </div>
        <div className="endpoints-actions">
          <button
            type="button"
            className="hud-settings-switch"
            disabled={quickBusy || quickList.length === 0}
            onClick={askQuick}
          >
            Save key
          </button>
        </div>
        {quickList.length === 0 ? (
          <p className="endpoints-note mono">The provider list is not available.</p>
        ) : null}
      </div>

      {quickNotice.text ? (
        <p className={`endpoints-note mono${quickNotice.error ? ' endpoints-error' : ''}`} role={quickNotice.error ? 'alert' : undefined}>
          {quickNotice.text}
        </p>
      ) : null}

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
          <div className="endpoints-meta mono">{endpointCount(endpoint.models)}</div>
          <ModelPicker
            label="Model list"
            ariaLabel={`Models for ${endpoint.name}`}
            value={pickedModel[endpoint.name] ?? ''}
            choices={endpoint.models}
            details={Array.isArray(endpoint.modelDetails) ? endpoint.modelDetails : []}
            client={client}
            onChange={(model) => setPickedModel((current) => ({ ...current, [endpoint.name]: model }))}
            placeholder={endpointCount(endpoint.models)}
            emptyText="No models saved."
          />
          <div className="endpoints-actions">
            <button
              type="button"
              className="hud-settings-switch"
              disabled={busy}
              onClick={() => refreshModels(endpoint)}
            >
              Refresh models
            </button>
            <button
              type="button"
              className="hud-settings-switch"
              disabled={busy}
              onClick={() => replaceKey(endpoint)}
            >
              Replace key
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

      <button
        type="button"
        className="hud-settings-switch endpoints-custom-toggle"
        aria-expanded={formOpen}
        onClick={() => (formOpen ? setFormOpen(false) : openForm())}
      >
        Custom endpoint
      </button>

      {formOpen ? (
        <div className="endpoints-form">
          <div className="endpoints-field">
            <label className="endpoints-label mono" htmlFor="endpoints-provider">Provider</label>
            <select
              id="endpoints-provider"
              value={provider}
              disabled={busy || confirm !== null}
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
              disabled={busy || confirm !== null}
              onChange={(event) => setName(event.target.value)}
            />
          </div>
          <div className="endpoints-field">
            <label className="endpoints-label mono" htmlFor="endpoints-base-url">Base URL</label>
            <input
              id="endpoints-base-url"
              type="text"
              value={baseUrl}
              disabled={busy || confirm !== null}
              onChange={(event) => setBaseUrl(event.target.value)}
            />
          </div>
          <div className="endpoints-field">
            <label className="endpoints-label mono" htmlFor="endpoints-key">Key slot</label>
            <select
              id="endpoints-key"
              value={keyName}
              disabled={busy || confirm !== null}
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
              disabled={busy || confirm !== null}
              onChange={(event) => setModelText(event.target.value)}
            />
            <div className="endpoints-actions">
              <ModelRefresh
                onRefresh={() => fetchModels(name.trim(), endpoints.some((entry) => entry.name === name.trim()))}
                loading={modelsBusy}
                disabled={busy || confirm !== null || name.trim() === ''}
              />
              <button type="button" className="hud-settings-switch" disabled={busy || confirm !== null} onClick={askSave}>
                Save
              </button>
              <button type="button" className="hud-settings-switch" disabled={busy || confirm !== null} onClick={() => setFormOpen(false)}>
                Cancel
              </button>
            </div>
            {modelsError ? (
              <p className="endpoints-error mono" role="alert">
                {modelsError}
              </p>
            ) : null}
          </div>
        </div>
      ) : null}

      {quickConfirm ? (
        <div ref={quickConfirmRef} className="brief-confirm-card endpoints-confirm">
          <p className="brief-confirm-warning">{quickConfirmText(quickConfirm.provider)}</p>
          <div className="brief-confirm-actions">
            <button
              type="button"
              className="hud-settings-switch brief-confirm-btn"
              disabled={quickBusy}
              onClick={() => saveQuick(quickConfirm)}
            >
              Save key
            </button>
            <button
              type="button"
              className="hud-settings-switch"
              disabled={quickBusy}
              onClick={() => setQuickConfirm(null)}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : null}

      {confirm?.kind === 'save' ? (
        <div ref={confirmRef} className="brief-confirm-card endpoints-confirm">
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
        <div ref={confirmRef} className="brief-confirm-card endpoints-confirm">
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
    </div>
  )
}
