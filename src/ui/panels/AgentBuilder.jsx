import { useEffect, useState } from 'react'
import {
  ADAPTER_TYPES,
  AGENT_ROLES,
  EFFORTS,
  LIMITS,
  TEXT_LIMITS,
  fieldProblem,
} from '../../control/agents.js'
import {
  draftFromForm,
  groupModelsByTier,
  initialAgentForm,
  newAgentForm,
  patchFromChange,
} from './agentForm.js'
import { statusLabel } from './format.js'
import { subscribeToNotices } from './notices.js'

const FIELD_KEYS = [
  'name',
  'adapterType',
  'role',
  'model',
  'reasoningEffort',
  'maxTurnsPerRun',
  'timeoutSec',
  'budgetMonthlyCents',
  'subagentsAllowed',
  'subagentDepth',
  'instructions',
  'reportsToAgentId',
]

function buildDepthOptions() {
  const [low, high] = LIMITS.subagentDepth
  const options = []
  for (let depth = low; depth <= high; depth += 1) {
    options.push(depth)
  }
  return options
}

const DEPTH_OPTIONS = buildDepthOptions()

export default function AgentBuilder({ client, onSelectControlTarget }) {
  const [agents, setAgents] = useState([])
  const [models, setModels] = useState([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(null)

  const [editingAgentId, setEditingAgentId] = useState(null)
  const [form, setForm] = useState(() => newAgentForm())
  const [fieldErrors, setFieldErrors] = useState({})
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState(null)
  const [resultBanner, setResultBanner] = useState(null)

  async function loadData({ isInitial = false } = {}) {
    if (isInitial) {
      setLoading(true)
      setLoadError(null)
    }
    try {
      const [agentList, modelList] = await Promise.all([
        client.agents(),
        client.models(),
      ])
      setAgents(Array.isArray(agentList) ? agentList : [])
      setModels(Array.isArray(modelList) ? modelList : [])
    } catch (err) {
      if (isInitial) {
        setLoadError(err.message || 'Could not load agents.')
      }
    } finally {
      if (isInitial) {
        setLoading(false)
      }
    }
  }

  async function refreshAgents() {
    try {
      const agentList = await client.agents()
      if (Array.isArray(agentList)) {
        setAgents(agentList)
      }
    } catch {
      return
    }
  }

  useEffect(() => {
    loadData({ isInitial: true })
  }, [client])

  useEffect(() => {
    return subscribeToNotices(client, 'agents', () => {
      refreshAgents()
    })
  }, [client])

  const editingAgent = editingAgentId
    ? agents.find((item) => item.id === editingAgentId) ?? null
    : null

  function selectNewAgent() {
    setEditingAgentId(null)
    setForm(newAgentForm())
    setFieldErrors({})
    setSubmitError(null)
    setResultBanner(null)
  }

  function selectExistingAgent(agent) {
    setEditingAgentId(agent.id)
    setForm(initialAgentForm(agent))
    setFieldErrors({})
    setSubmitError(null)
    setResultBanner(null)
  }

  function updateField(fieldName, value, problemKey = fieldName) {
    setForm((prev) => ({ ...prev, [fieldName]: value }))
    setSubmitError(null)
    if (fieldErrors[problemKey]) {
      setFieldErrors((prev) => ({ ...prev, [problemKey]: null }))
    }
  }

  function checkSingleField(problemKey, currentForm = form) {
    const draft = draftFromForm(currentForm)
    if (problemKey === 'subagentDepth' && !draft.subagentsAllowed) {
      setFieldErrors((prev) => ({ ...prev, subagentDepth: null }))
      return null
    }
    const problem = fieldProblem(problemKey, draft[problemKey])
    setFieldErrors((prev) => ({ ...prev, [problemKey]: problem }))
    return problem
  }

  function validateAllFields(currentForm = form, isEditing = Boolean(editingAgent)) {
    const draft = draftFromForm(currentForm)
    const nextErrors = {}
    for (const key of FIELD_KEYS) {
      if (isEditing && key === 'adapterType') continue
      if (key === 'subagentDepth' && !draft.subagentsAllowed) continue
      const problem = fieldProblem(key, draft[key])
      if (problem) {
        nextErrors[key] = problem
      }
    }
    setFieldErrors(nextErrors)
    return { draft, nextErrors, hasErrors: Object.keys(nextErrors).length > 0 }
  }

  async function handleSubmit(event) {
    event.preventDefault()
    setSubmitError(null)
    setResultBanner(null)

    const isEditing = Boolean(editingAgent)
    const { draft, hasErrors } = validateAllFields(form, isEditing)
    if (hasErrors) {
      const formElement = event.currentTarget
      requestAnimationFrame(() => formElement.querySelector('[aria-invalid="true"]')?.focus())
      return
    }

    if (isEditing) {
      const patch = patchFromChange(editingAgent, form)
      if (Object.keys(patch).length === 0) {
        return
      }
      setSubmitting(true)
      try {
        const updated = await client.updateAgent(editingAgent.id, patch)
        setAgents((prev) =>
          prev.map((item) => (item.id === updated.id ? updated : item))
        )
        setForm(initialAgentForm(updated))
        setFieldErrors({})
        setResultBanner({
          kind: 'updated',
          text: `${updated.name} updated.`,
        })
      } catch (err) {
        const message = err.message || 'Could not update agent.'
        let matchedField = false
        for (const key of FIELD_KEYS) {
          if (key === 'adapterType') continue
          if (key === 'subagentDepth' && !draft.subagentsAllowed) continue
          const problem = fieldProblem(key, draft[key])
          if (problem && problem === message) {
            setFieldErrors((prev) => ({ ...prev, [key]: problem }))
            matchedField = true
          }
        }
        if (!matchedField) {
          setSubmitError(message)
        }
      } finally {
        setSubmitting(false)
      }
      return
    }

    setSubmitting(true)
    try {
      const result = await client.hireAgent(draft)
      const hiredAgent = result?.agent
      const approval = result?.approval ?? null
      await refreshAgents()
      setForm(newAgentForm())
      setFieldErrors({})
      if (approval) {
        setResultBanner({
          kind: 'approval',
          text: 'Waiting for your approval',
          agentName: hiredAgent?.name ?? draft.name,
        })
      } else {
        setResultBanner({
          kind: 'ready',
          text: `${hiredAgent?.name ?? draft.name} is ready.`,
        })
      }
    } catch (err) {
      const message = err.message || 'Could not hire agent.'
      let matchedField = false
      for (const key of FIELD_KEYS) {
        if (key === 'subagentDepth' && !draft.subagentsAllowed) continue
        const problem = fieldProblem(key, draft[key])
        if (problem && problem === message) {
          setFieldErrors((prev) => ({ ...prev, [key]: problem }))
          matchedField = true
        }
      }
      if (!matchedField) {
        setSubmitError(message)
      }
    } finally {
      setSubmitting(false)
    }
  }

  if (loading) {
    return <div className="panel-state mono">Loading agents...</div>
  }

  if (loadError) {
    return (
      <div className="panel-state">
        <div className="panel-error-message">{loadError}</div>
        <button type="button" onClick={() => loadData({ isInitial: true })}>
          Retry
        </button>
      </div>
    )
  }

  const isEditing = Boolean(editingAgent)
  const currentPatch = isEditing ? patchFromChange(editingAgent, form) : null
  const hasChanges = isEditing ? Object.keys(currentPatch).length > 0 : true
  const modelGroups = groupModelsByTier(models)
  const reportOptions = agents.filter((item) => !isEditing || item.id !== editingAgent.id)
  const modelMatchesOption = models.some((item) => item.id === form.model)

  return (
    <div className="agent-builder-panel">
      <div className="panel-toolbar">
        <span className="panel-count mono">
          {isEditing ? `Edit ${editingAgent.name}` : 'New agent'}
        </span>
        <div className="agent-builder-toolbar-actions">
          {isEditing && (
            <button type="button" onClick={selectNewAgent}>
              New agent
            </button>
          )}
          <button type="button" onClick={() => loadData({ isInitial: false })}>
            Refresh
          </button>
        </div>
      </div>

      {resultBanner && (
        <div className="panel-banner is-success" role="status">
          <span>{resultBanner.text}</span>
          {resultBanner.kind === 'approval' && (
            <>
              {' '}
              <button
                type="button"
                className="panel-inline-link mono"
                onClick={() => onSelectControlTarget?.({ tab: 'approvals' })}
              >
                Open Approvals
              </button>
            </>
          )}
        </div>
      )}

      <form className="agent-builder-form" onSubmit={handleSubmit} noValidate>
        <div className="panel-field">
          <label htmlFor="agent-name">Name</label>
          <input
            id="agent-name"
            type="text"
            maxLength={TEXT_LIMITS.name}
            value={form.name}
            onChange={(e) => updateField('name', e.target.value)}
            onBlur={(e) =>
              checkSingleField('name', { ...form, name: e.target.value })
            }
            placeholder="Agent name"
            aria-invalid={Boolean(fieldErrors.name)}
            required
          />
          {fieldErrors.name && (
            <div className="field-error mono" role="alert">
              {fieldErrors.name}
            </div>
          )}
        </div>

        <div className="panel-field">
          <label htmlFor="agent-harness">Harness</label>
          {isEditing ? (
            <input
              id="agent-harness"
              type="text"
              className="mono"
              value={form.adapterType}
              readOnly
              aria-readonly="true"
            />
          ) : (
            <select
              id="agent-harness"
              value={form.adapterType}
              onChange={(e) => updateField('adapterType', e.target.value)}
              onBlur={(e) =>
                checkSingleField('adapterType', {
                  ...form,
                  adapterType: e.target.value,
                })
              }
              aria-invalid={Boolean(fieldErrors.adapterType)}
            >
              {ADAPTER_TYPES.map((adapter) => (
                <option key={adapter} value={adapter}>
                  {adapter}
                </option>
              ))}
            </select>
          )}
          {fieldErrors.adapterType && (
            <div className="field-error mono" role="alert">
              {fieldErrors.adapterType}
            </div>
          )}
        </div>

        <div className="panel-field">
          <label htmlFor="agent-role">Role</label>
          <select
            id="agent-role"
            value={form.role}
            onChange={(e) => updateField('role', e.target.value)}
            onBlur={(e) =>
              checkSingleField('role', { ...form, role: e.target.value })
            }
            aria-invalid={Boolean(fieldErrors.role)}
          >
            {AGENT_ROLES.map((role) => (
              <option key={role} value={role}>
                {role}
              </option>
            ))}
          </select>
          {fieldErrors.role && (
            <div className="field-error mono" role="alert">
              {fieldErrors.role}
            </div>
          )}
        </div>

        <div className="panel-field">
          <label htmlFor="agent-model-select">Model</label>
          <select
            id="agent-model-select"
            aria-label="Known models by tier"
            value={modelMatchesOption ? form.model : ''}
            onChange={(e) => {
              const picked = e.target.value
              updateField('model', picked)
              checkSingleField('model', { ...form, model: picked })
            }}
          >
            <option value="">
              {form.model && !modelMatchesOption
                ? 'Custom model id below'
                : 'Default or type below'}
            </option>
            {modelGroups.map((group) => (
              <optgroup key={group.tier} label={group.label}>
                {group.models.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.label} ({item.id})
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
          <input
            id="agent-model"
            type="text"
            value={form.model}
            onChange={(e) => updateField('model', e.target.value)}
            onBlur={(e) =>
              checkSingleField('model', { ...form, model: e.target.value })
            }
            placeholder="Model id (or leave empty for default)"
            aria-label="Model id"
            aria-invalid={Boolean(fieldErrors.model)}
          />
          {fieldErrors.model && (
            <div className="field-error mono" role="alert">
              {fieldErrors.model}
            </div>
          )}
        </div>

        <div className="panel-field">
          <label htmlFor="agent-effort">Reasoning effort</label>
          <select
            id="agent-effort"
            value={form.reasoningEffort}
            onChange={(e) => updateField('reasoningEffort', e.target.value)}
            onBlur={(e) =>
              checkSingleField('reasoningEffort', {
                ...form,
                reasoningEffort: e.target.value,
              })
            }
            aria-invalid={Boolean(fieldErrors.reasoningEffort)}
          >
            <option value="">Default</option>
            {EFFORTS.map((effort) => (
              <option key={effort} value={effort}>
                {effort}
              </option>
            ))}
          </select>
          {fieldErrors.reasoningEffort && (
            <div className="field-error mono" role="alert">
              {fieldErrors.reasoningEffort}
            </div>
          )}
        </div>

        <div className="panel-field">
          <label htmlFor="agent-turns">Turn limit</label>
          <input
            id="agent-turns"
            type="number"
            min={LIMITS.maxTurnsPerRun[0]}
            max={LIMITS.maxTurnsPerRun[1]}
            value={form.maxTurnsPerRun}
            onChange={(e) => updateField('maxTurnsPerRun', e.target.value)}
            onBlur={(e) =>
              checkSingleField('maxTurnsPerRun', {
                ...form,
                maxTurnsPerRun: e.target.value,
              })
            }
            placeholder={`${LIMITS.maxTurnsPerRun[0]} to ${LIMITS.maxTurnsPerRun[1]}`}
            aria-invalid={Boolean(fieldErrors.maxTurnsPerRun)}
          />
          {fieldErrors.maxTurnsPerRun && (
            <div className="field-error mono" role="alert">
              {fieldErrors.maxTurnsPerRun}
            </div>
          )}
        </div>

        <div className="panel-field">
          <label htmlFor="agent-timeout">Time limit (seconds)</label>
          <input
            id="agent-timeout"
            type="number"
            min={LIMITS.timeoutSec[0]}
            max={LIMITS.timeoutSec[1]}
            value={form.timeoutSec}
            onChange={(e) => updateField('timeoutSec', e.target.value)}
            onBlur={(e) =>
              checkSingleField('timeoutSec', {
                ...form,
                timeoutSec: e.target.value,
              })
            }
            placeholder={`${LIMITS.timeoutSec[0]} to ${LIMITS.timeoutSec[1]}`}
            aria-invalid={Boolean(fieldErrors.timeoutSec)}
          />
          {fieldErrors.timeoutSec && (
            <div className="field-error mono" role="alert">
              {fieldErrors.timeoutSec}
            </div>
          )}
        </div>

        <div className="panel-field">
          <label htmlFor="agent-budget">Monthly budget ($)</label>
          <input
            id="agent-budget"
            type="text"
            inputMode="decimal"
            value={form.budgetDollars}
            onChange={(e) =>
              updateField('budgetDollars', e.target.value, 'budgetMonthlyCents')
            }
            onBlur={(e) =>
              checkSingleField('budgetMonthlyCents', {
                ...form,
                budgetDollars: e.target.value,
              })
            }
            placeholder="0.00"
            aria-invalid={Boolean(fieldErrors.budgetMonthlyCents)}
          />
          {fieldErrors.budgetMonthlyCents && (
            <div className="field-error mono" role="alert">
              {fieldErrors.budgetMonthlyCents}
            </div>
          )}
        </div>

        <div className="panel-checkbox-field">
          <label>
            <input
              id="agent-subagents"
              type="checkbox"
              checked={form.subagentsAllowed}
              onChange={(e) => {
                const allowed = e.target.checked
                updateField('subagentsAllowed', allowed)
                checkSingleField('subagentsAllowed', {
                  ...form,
                  subagentsAllowed: allowed,
                })
              }}
            />
            <span>Subagents allowed</span>
          </label>
          {fieldErrors.subagentsAllowed && (
            <div className="field-error mono" role="alert">
              {fieldErrors.subagentsAllowed}
            </div>
          )}
        </div>

        {form.subagentsAllowed && (
          <div className="panel-field">
            <label htmlFor="agent-subagent-depth">Subagent depth</label>
            <select
              id="agent-subagent-depth"
              value={form.subagentDepth}
              onChange={(e) => updateField('subagentDepth', e.target.value)}
              onBlur={(e) =>
                checkSingleField('subagentDepth', {
                  ...form,
                  subagentDepth: e.target.value,
                })
              }
              aria-invalid={Boolean(fieldErrors.subagentDepth)}
            >
              {DEPTH_OPTIONS.map((depth) => (
                <option key={depth} value={String(depth)}>
                  {depth}
                </option>
              ))}
            </select>
            {fieldErrors.subagentDepth && (
              <div className="field-error mono" role="alert">
                {fieldErrors.subagentDepth}
              </div>
            )}
          </div>
        )}

        <div className="panel-field">
          <label htmlFor="agent-reports-to">Reports to</label>
          <select
            id="agent-reports-to"
            value={form.reportsToAgentId}
            onChange={(e) => updateField('reportsToAgentId', e.target.value)}
            onBlur={(e) =>
              checkSingleField('reportsToAgentId', {
                ...form,
                reportsToAgentId: e.target.value,
              })
            }
            aria-invalid={Boolean(fieldErrors.reportsToAgentId)}
          >
            <option value="">None</option>
            {reportOptions.map((agent) => (
              <option key={agent.id} value={agent.id}>
                {agent.name} ({agent.role})
              </option>
            ))}
          </select>
          {fieldErrors.reportsToAgentId && (
            <div className="field-error mono" role="alert">
              {fieldErrors.reportsToAgentId}
            </div>
          )}
        </div>

        <div className="panel-field">
          <label htmlFor="agent-instructions">Instructions</label>
          <textarea
            id="agent-instructions"
            rows={3}
            value={form.instructions}
            onChange={(e) => updateField('instructions', e.target.value)}
            onBlur={(e) =>
              checkSingleField('instructions', {
                ...form,
                instructions: e.target.value,
              })
            }
            placeholder="Role instructions for this agent"
            aria-invalid={Boolean(fieldErrors.instructions)}
          />
          {fieldErrors.instructions && (
            <div className="field-error mono" role="alert">
              {fieldErrors.instructions}
            </div>
          )}
        </div>

        {submitError && (
          <div className="panel-banner is-error" role="alert">
            {submitError}
          </div>
        )}

        <div className="panel-actions">
          {isEditing ? (
            <>
              <button
                type="button"
                onClick={selectNewAgent}
                disabled={submitting}
              >
                Cancel
              </button>
              <button type="submit" disabled={submitting || !hasChanges}>
                {submitting ? 'Saving...' : 'Save'}
              </button>
            </>
          ) : (
            <button type="submit" disabled={submitting}>
              {submitting ? 'Hiring...' : 'Hire agent'}
            </button>
          )}
        </div>
      </form>

      <section className="agent-builder-list-section" aria-label="Existing agents">
        <h4 className="meters-section-title">Existing agents ({agents.length})</h4>
        {agents.length === 0 ? (
          <div className="panel-state is-dim mono">No agents found.</div>
        ) : (
          <div className="agent-builder-list">
            {agents.map((agent) => {
              const isSelected = editingAgentId === agent.id
              return (
                <button
                  key={agent.id}
                  type="button"
                  className={`task-row agent-builder-row ${isSelected ? 'is-selected' : ''}`}
                  aria-pressed={isSelected}
                  onClick={() => selectExistingAgent(agent)}
                >
                  <div className="task-row-top">
                    <span className="agent-row-name">{agent.name}</span>
                    <span className="task-status mono">
                      {statusLabel(agent.status)}
                    </span>
                    <span className="task-priority mono">{agent.role}</span>
                  </div>
                  <div className="task-assignee mono">
                    {agent.adapterType}
                    {agent.model ? ` // ${agent.model}` : ''}
                  </div>
                </button>
              )
            })}
          </div>
        )}
      </section>
    </div>
  )
}
