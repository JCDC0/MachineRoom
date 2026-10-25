import { useCallback, useEffect, useRef, useState } from 'react'
import {
  groupModelChoices,
  loadHarnessModels,
  mergeModelChoices,
  modelChoiceText,
} from './modelRefresh.js'

export function ModelRefreshIcon() {
  return (
    <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true">
      <path
        d="M13 6.4A5.2 5.2 0 1 0 13 9.6"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
      <path
        d="M13.2 3.4v3.2H10"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

export default function ModelRefresh({ onRefresh = () => {}, loading = false, disabled = false }) {
  return (
    <button
      type="button"
      className={`mr-model-refresh${loading ? ' is-spinning' : ''}`}
      title="Refresh models"
      aria-label="Refresh models"
      aria-busy={loading || undefined}
      disabled={disabled || loading}
      onClick={() => onRefresh()}
    >
      <ModelRefreshIcon />
    </button>
  )
}

export function useHarnessModels({
  client = null,
  harness = '',
  open = true,
  fallback = [],
  value = '',
}) {
  const key = typeof harness === 'string' ? harness.trim() : ''
  const available = key !== '' && typeof client?.harnessModels === 'function'
  const [live, setLive] = useState(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const requestRef = useRef(0)

  const read = useCallback(
    async (refresh) => {
      if (!available) return null
      const ticket = requestRef.current + 1
      requestRef.current = ticket
      setLoading(true)
      setError('')
      const answer = await loadHarnessModels(client, key, { refresh })
      if (requestRef.current !== ticket) return answer
      setLoading(false)
      if (answer.models) setLive(answer.models)
      setError(answer.error)
      return answer
    },
    [available, client, key]
  )

  useEffect(() => {
    setLive(null)
    setError('')
  }, [client, key])

  useEffect(() => {
    if (!open || !available) {
      requestRef.current += 1
      setLoading(false)
      return undefined
    }
    read(false)
    return () => {
      requestRef.current += 1
    }
  }, [available, open, read])

  const refresh = useCallback(() => read(true), [read])

  return {
    choices: mergeModelChoices(live ?? fallback, value),
    error,
    loading,
    canRefresh: available,
    refresh,
    live,
  }
}

export function ModelSelect({
  id = undefined,
  label = 'Model',
  ariaLabel = 'Model',
  value = '',
  choices = [],
  onChange = () => {},
  onRefresh = () => {},
  loading = false,
  error = '',
  disabled = false,
  canRefresh = true,
  placeholder = 'Choose a model',
  emptyText = 'No models listed for this harness.',
  className = 'mr-side-select mono',
}) {
  const groups = groupModelChoices(choices, value)
  const empty = !groups.current && groups.rest.length === 0
  return (
    <div className="mr-side-field mr-model-field">
      {label ? <span className="mr-side-field-label mono">{label}</span> : null}
      <div className="mr-model-row">
        {empty ? (
          <span className="mr-model-empty">{emptyText}</span>
        ) : (
          <select
            id={id}
            className={className}
            aria-label={ariaLabel}
            value={value}
            onChange={(event) => onChange(event.target.value)}
          >
            {!value ? (
              <option value="" disabled>
                {placeholder}
              </option>
            ) : null}
            {groups.current ? (
              <optgroup label="Current">
                <option value={groups.current.id}>{modelChoiceText(groups.current)}</option>
              </optgroup>
            ) : null}
            {groups.rest.length > 0 ? (
              <optgroup label="Models">
                {groups.rest.map((choice) => (
                  <option value={choice.id} key={choice.id}>
                    {modelChoiceText(choice)}
                  </option>
                ))}
              </optgroup>
            ) : null}
          </select>
        )}
        <ModelRefresh onRefresh={onRefresh} loading={loading} disabled={disabled || !canRefresh} />
      </div>
      {error ? (
        <p className="mr-model-error mono" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  )
}
