import { useEffect, useState } from 'react'
import { subscribeToNotices } from './notices.js'

export default function DispatchPanel({ client, onCreated }) {
  const [agents, setAgents] = useState([])
  const [models, setModels] = useState([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(null)

  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [assigneeAgentId, setAssigneeAgentId] = useState('')
  const [model, setModel] = useState('')
  const [priority, setPriority] = useState('')
  const [maxTurnsPerRun, setMaxTurnsPerRun] = useState('')
  const [timeoutSec, setTimeoutSec] = useState('')
  const [subagentsAllowed, setSubagentsAllowed] = useState(false)

  const [fieldErrors, setFieldErrors] = useState({})
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState(null)
  const [createdIdentifier, setCreatedIdentifier] = useState(null)

  async function loadData() {
    setLoading(true)
    setLoadError(null)
    try {
      const [agentList, modelList] = await Promise.all([
        client.agents(),
        client.models(),
      ])
      setAgents(agentList)
      setModels(modelList)
    } catch (err) {
      setLoadError(err.message || 'Could not load options.')
    } finally {
      setLoading(false)
    }
  }

  async function refreshAgents() {
    try {
      const agentList = await client.agents()
      setAgents(agentList)
    } catch {
      return
    }
  }

  useEffect(() => {
    loadData()
  }, [client])

  useEffect(() => {
    return subscribeToNotices(client, 'agents', () => {
      refreshAgents()
    })
  }, [client])

  async function handleSubmit(event) {
    event.preventDefault()
    setSubmitError(null)
    setCreatedIdentifier(null)

    const errors = {}
    if (!title.trim()) {
      errors.title = 'A title is required.'
    }
    if (!assigneeAgentId) {
      errors.agent = 'Choose an agent for this task.'
    }

    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors)
      setSubmitError('Please complete all required fields.')
      return
    }
    setFieldErrors({})

    setSubmitting(true)
    try {
      const draft = {
        title: title.trim(),
        assigneeAgentId,
      }
      if (description.trim()) draft.description = description.trim()
      if (priority) draft.priority = priority
      if (model) draft.model = model
      if (maxTurnsPerRun !== '') {
        const turns = parseInt(maxTurnsPerRun, 10)
        if (!Number.isNaN(turns) && turns > 0) draft.maxTurnsPerRun = turns
      }
      if (timeoutSec !== '') {
        const timeout = parseInt(timeoutSec, 10)
        if (!Number.isNaN(timeout) && timeout > 0) draft.timeoutSec = timeout
      }
      if (subagentsAllowed) {
        draft.subagentsAllowed = true
      }

      const created = await client.createIssue(draft)
      setCreatedIdentifier(created.identifier)
      setTitle('')
      setDescription('')
      setAssigneeAgentId('')
      setModel('')
      setPriority('')
      setMaxTurnsPerRun('')
      setTimeoutSec('')
      setSubagentsAllowed(false)
      setFieldErrors({})
      onCreated?.(created)
    } catch (err) {
      const message = err.message || 'Could not start task.'
      setSubmitError(message)
      if (/title/i.test(message)) {
        setFieldErrors((prev) => ({ ...prev, title: message }))
      } else if (/agent/i.test(message)) {
        setFieldErrors((prev) => ({ ...prev, agent: message }))
      }
    } finally {
      setSubmitting(false)
    }
  }

  if (loading) {
    return <div className="panel-state mono">Loading dispatch options...</div>
  }

  if (loadError) {
    return (
      <div className="panel-state">
        <div className="panel-error-message">{loadError}</div>
        <button type="button" onClick={loadData}>Retry</button>
      </div>
    )
  }

  if (agents.length === 0) {
    return <div className="panel-state">No agents available to assign.</div>
  }

  const smallModels = models.filter((item) => item.tier === 'small')
  const mediumModels = models.filter((item) => item.tier === 'medium')
  const largeModels = models.filter((item) => item.tier === 'large')

  return (
    <form className="dispatch-form" onSubmit={handleSubmit} noValidate>
      {createdIdentifier && (
        <div className="panel-banner is-success" role="status">
          Created task {createdIdentifier}.
        </div>
      )}

      {submitError && (
        <div className="panel-banner is-error" role="alert">
          {submitError}
        </div>
      )}

      <div className="panel-field">
        <div className="panel-field-head">
          <label htmlFor="dispatch-title">Title</label>
          {fieldErrors.title && (
            <span className="field-error mono">{fieldErrors.title}</span>
          )}
        </div>
        <input
          id="dispatch-title"
          type="text"
          value={title}
          onChange={(event) => {
            setTitle(event.target.value)
            if (fieldErrors.title) {
              setFieldErrors((prev) => ({ ...prev, title: null }))
            }
          }}
          placeholder="Brief task summary"
          aria-invalid={Boolean(fieldErrors.title)}
          required
        />
      </div>

      <div className="panel-field">
        <label htmlFor="dispatch-description">Description</label>
        <textarea
          id="dispatch-description"
          rows={3}
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          placeholder="Detailed task instructions"
        />
      </div>

      <div className="panel-field">
        <div className="panel-field-head">
          <label htmlFor="dispatch-agent">Agent</label>
          {fieldErrors.agent && (
            <span className="field-error mono">{fieldErrors.agent}</span>
          )}
        </div>
        <select
          id="dispatch-agent"
          value={assigneeAgentId}
          onChange={(event) => {
            setAssigneeAgentId(event.target.value)
            if (fieldErrors.agent) {
              setFieldErrors((prev) => ({ ...prev, agent: null }))
            }
          }}
          aria-invalid={Boolean(fieldErrors.agent)}
          required
        >
          <option value="">Select an agent</option>
          {agents.map((agent) => (
            <option key={agent.id} value={agent.id}>
              {agent.name} ({agent.role})
            </option>
          ))}
        </select>
      </div>

      <div className="panel-field">
        <label htmlFor="dispatch-model">Model</label>
        <select
          id="dispatch-model"
          value={model}
          onChange={(event) => setModel(event.target.value)}
        >
          <option value="">Default model</option>
          {smallModels.length > 0 && (
            <optgroup label="Small">
              {smallModels.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label}
                  {item.free && !item.label.toLowerCase().includes('free') ? ' (free)' : ''}
                </option>
              ))}
            </optgroup>
          )}
          {mediumModels.length > 0 && (
            <optgroup label="Medium">
              {mediumModels.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label}
                  {item.free && !item.label.toLowerCase().includes('free') ? ' (free)' : ''}
                </option>
              ))}
            </optgroup>
          )}
          {largeModels.length > 0 && (
            <optgroup label="Large">
              {largeModels.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label}
                  {item.free && !item.label.toLowerCase().includes('free') ? ' (free)' : ''}
                </option>
              ))}
            </optgroup>
          )}
        </select>
      </div>

      <div className="panel-field">
        <label htmlFor="dispatch-priority">Priority</label>
        <select
          id="dispatch-priority"
          value={priority}
          onChange={(event) => setPriority(event.target.value)}
        >
          <option value="">Default (medium)</option>
          <option value="low">Low</option>
          <option value="medium">Medium</option>
          <option value="high">High</option>
          <option value="critical">Critical</option>
        </select>
      </div>

      <details className="panel-limits">
        <summary>Limits</summary>
        <div className="panel-limits-fields">
          <div className="panel-field">
            <label htmlFor="dispatch-turns">Max turns</label>
            <input
              id="dispatch-turns"
              type="number"
              min="1"
              value={maxTurnsPerRun}
              onChange={(event) => setMaxTurnsPerRun(event.target.value)}
              placeholder="Default"
            />
          </div>
          <div className="panel-field">
            <label htmlFor="dispatch-timeout">Timeout (seconds)</label>
            <input
              id="dispatch-timeout"
              type="number"
              min="1"
              value={timeoutSec}
              onChange={(event) => setTimeoutSec(event.target.value)}
              placeholder="Default"
            />
          </div>
          <div className="panel-checkbox-field">
            <label>
              <input
                type="checkbox"
                checked={subagentsAllowed}
                onChange={(event) => setSubagentsAllowed(event.target.checked)}
              />
              <span>Subagents allowed</span>
            </label>
          </div>
        </div>
      </details>

      <div className="panel-actions">
        <button type="submit" disabled={submitting}>
          {submitting ? 'Starting task...' : 'Start task'}
        </button>
      </div>
    </form>
  )
}
