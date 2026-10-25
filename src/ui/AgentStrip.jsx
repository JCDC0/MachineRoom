import { useEffect, useState } from 'react'
import { agentContext } from './agentContext.js'
import {
  AUTOCOMPACT_MAX,
  AUTOCOMPACT_MIN,
  agentChoices,
  autocompactPercent,
  clampAutocompactPercent,
  contextLine,
  laneLine,
  modelChoices,
  orchestratorId,
  statusTone,
  stripLogLines,
} from './agentStrip.js'

function messageOf(error, fallback) {
  return error instanceof Error && error.message.trim() ? error.message : fallback
}

export default function AgentStrip({
  agent = null,
  working = null,
  lanes = null,
  costs = null,
  liveRuns = null,
  tasks = null,
  log = null,
  orchestrator = null,
  client = null,
  dockOpen = false,
  onFocus = () => {},
  onOpenDock = () => {},
  onToggleDock = () => {},
  onOpenSettings = () => {},
  onAutocompact = () => ({ ok: true }),
  onOrchestratorChange = () => {},
}) {
  const context = agentContext({ agent, working, lanes, costs, liveRuns, tasks, log, orchestrator })
  const [pickerOpen, setPickerOpen] = useState(false)
  const [modelsOpen, setModelsOpen] = useState(false)
  const [models, setModels] = useState(null)
  const [modelsLoading, setModelsLoading] = useState(false)
  const [modelsError, setModelsError] = useState('')
  const [modelConfirm, setModelConfirm] = useState(null)
  const [modelSaving, setModelSaving] = useState(false)
  const [modelError, setModelError] = useState('')
  const [modelSaved, setModelSaved] = useState('')
  const [compactOpen, setCompactOpen] = useState(false)
  const [compactConfirm, setCompactConfirm] = useState(false)
  const [keep, setKeep] = useState('')
  const [compactSaving, setCompactSaving] = useState(false)
  const [compactError, setCompactError] = useState('')
  const [percent, setPercent] = useState(() => autocompactPercent(orchestrator))
  const [percentBusy, setPercentBusy] = useState(false)
  const [settingsError, setSettingsError] = useState('')

  const key = context.key
  useEffect(() => {
    setPickerOpen(false)
    setModelsOpen(false)
    setModels(null)
    setModelsError('')
    setModelConfirm(null)
    setModelError('')
    setModelSaved('')
    setCompactOpen(false)
    setCompactConfirm(false)
    setKeep('')
    setCompactError('')
    setSettingsError('')
  }, [key])

  useEffect(() => {
    const value = Number(orchestrator?.autocompactPercent)
    if (Number.isFinite(value)) setPercent(clampAutocompactPercent(value))
  }, [orchestrator?.autocompactPercent])

  useEffect(() => {
    setModelSaved('')
  }, [orchestrator?.model])

  const agents = agentChoices(lanes)
  const choices = modelChoices(models, context.isOrchestrator ? orchestrator?.harness || context.harness : context.harness)
  const hasModels = typeof client?.models === 'function'
  const canSetModel = context.isOrchestrator && typeof client?.setOrchestratorModel === 'function'
  const canCompact = context.isOrchestrator && typeof client?.compactOrchestrator === 'function'
  const canAutocompact = context.isOrchestrator && typeof client?.setAutocompact === 'function'
  const model =
    modelSaved ||
    (context.isOrchestrator && typeof orchestrator?.model === 'string' ? orchestrator.model.trim() : '') ||
    context.model
  const lines = stripLogLines(context.log)
  const autocompactOn = context.autocompact === true

  async function openModels() {
    if (modelsOpen) {
      setModelsOpen(false)
      return
    }
    setPickerOpen(false)
    setModelConfirm(null)
    setModelError('')
    setModelsOpen(true)
    if (models !== null || !hasModels) return
    setModelsLoading(true)
    setModelsError('')
    try {
      setModels(await client.models())
    } catch (error) {
      setModelsError(messageOf(error, 'Models are not available.'))
    } finally {
      setModelsLoading(false)
    }
  }

  async function saveModel() {
    if (!modelConfirm || modelSaving) return
    if (typeof client?.setOrchestratorModel !== 'function') {
      setModelError('The bridge cannot set a model.')
      return
    }
    setModelSaving(true)
    setModelError('')
    try {
      await client.setOrchestratorModel({
        id: orchestratorId(context.key),
        model: modelConfirm.id,
        confirmed: true,
      })
      setModelSaved(modelConfirm.label)
      setModelConfirm(null)
      onOrchestratorChange()
    } catch (error) {
      setModelError(messageOf(error, 'The bridge refused the model.'))
    } finally {
      setModelSaving(false)
    }
  }

  async function commitAutocompact(on, value = percent) {
    if (typeof client?.setAutocompact !== 'function') {
      setSettingsError('The bridge cannot change autocompact.')
      return
    }
    const next = clampAutocompactPercent(value)
    setPercent(next)
    setPercentBusy(true)
    setSettingsError('')
    try {
      const result = await onAutocompact(orchestratorId(context.key), on, next)
      if (result && result.ok === false) {
        setSettingsError(result.message || 'The bridge refused the change.')
      }
    } catch (error) {
      setSettingsError(messageOf(error, 'The bridge refused the change.'))
    } finally {
      setPercentBusy(false)
    }
  }

  async function runCompact() {
    if (compactSaving) return
    if (typeof client?.compactOrchestrator !== 'function') {
      setCompactError('The bridge cannot compact.')
      return
    }
    setCompactSaving(true)
    setCompactError('')
    try {
      await client.compactOrchestrator({
        id: orchestratorId(context.key),
        keep: keep.trim().slice(0, 2000),
        confirmed: true,
      })
      setCompactConfirm(false)
      setCompactOpen(false)
      setKeep('')
      onOrchestratorChange()
    } catch (error) {
      setCompactError(messageOf(error, 'The bridge refused the compact.'))
    } finally {
      setCompactSaving(false)
    }
  }

  function chooseAgent(choice) {
    setPickerOpen(false)
    onFocus(choice.key)
  }

  const stripClass = `hud-strip ${dockOpen ? 'is-open' : 'is-closed'}`

  if (context.empty) {
    return (
      <section className={stripClass} aria-label="Agent strip">
        <div className="strip-half is-left">
          <span className="strip-context mono">{context.message}</span>
        </div>
        <div className="strip-half is-right">
          <button
            type="button"
            className="strip-expand mono"
            aria-expanded={dockOpen}
            onClick={onToggleDock}
          >
            {dockOpen ? 'Close' : 'Expand'}
          </button>
        </div>
      </section>
    )
  }

  return (
    <section className={stripClass} aria-label="Agent strip">
      <div className="strip-half is-left">
        <div className="strip-identity">
          <button
            type="button"
            className="strip-name"
            aria-expanded={pickerOpen}
            aria-label={`Agents, showing ${context.name}`}
            onClick={() => {
              setPickerOpen((open) => !open)
              setModelsOpen(false)
              setModelConfirm(null)
              setModelError('')
            }}
          >
            <span className={`strip-dot is-${statusTone(context.status)}`} aria-hidden="true" />
            <span className="strip-name-text">{context.name}</span>
          </button>
          <div className="strip-model-wrap">
            <p className="strip-model">
              <span className="strip-model-label">Model:</span>
              <span className="strip-model-name mono">{model}</span>
              <button
                type="button"
                className="strip-v mono"
                aria-expanded={modelsOpen}
                aria-label={`Models for ${context.name}`}
                onClick={openModels}
              >
                V
              </button>
            </p>
            {modelsOpen && (
              <div className="strip-pop is-models" aria-label="Models">
                {!hasModels && <p className="strip-note">Models are not available.</p>}
                {hasModels && modelsLoading && <p className="strip-note">Loading models.</p>}
                {hasModels && !modelsLoading && modelsError && (
                  <p className="strip-note is-error">{modelsError}</p>
                )}
                {hasModels && !modelsLoading && !modelsError && choices.length === 0 && (
                  <p className="strip-note">No models for this harness.</p>
                )}
                {choices.map((choice) =>
                  canSetModel ? (
                    <button
                      type="button"
                      className="strip-model-choice"
                      key={choice.id}
                      onClick={() => {
                        setModelsOpen(false)
                        setModelError('')
                        setModelConfirm(choice)
                      }}
                    >
                      {choice.label}
                    </button>
                  ) : (
                    <span className="strip-model-choice is-read-only" key={choice.id}>
                      {choice.label}
                    </span>
                  )
                )}
                {!canSetModel && <p className="strip-note">Read only here.</p>}
              </div>
            )}
            {modelConfirm && (
              <div className="strip-pop is-confirm">
                <section className="mr-orch-confirm" aria-label="Set the model">
                  <p className="mr-orch-confirm-text">{`Set ${modelConfirm.label} for ${context.name}?`}</p>
                  {modelError && <p className="strip-note is-error">{modelError}</p>}
                  <div className="mr-orch-confirm-actions">
                    <button
                      type="button"
                      className="mr-orch-confirm-btn is-start"
                      onClick={saveModel}
                      disabled={modelSaving}
                    >
                      Set
                    </button>
                    <button
                      type="button"
                      className="mr-orch-confirm-btn is-cancel"
                      onClick={() => {
                        setModelConfirm(null)
                        setModelError('')
                      }}
                      disabled={modelSaving}
                    >
                      Cancel
                    </button>
                  </div>
                </section>
              </div>
            )}
          </div>
          {pickerOpen && (
            <div className="strip-pop is-agents" aria-label="Agents">
              {agents.map((choice) => (
                <button
                  type="button"
                  className="strip-agent-choice"
                  key={choice.key}
                  aria-pressed={choice.key === context.key}
                  onClick={() => chooseAgent(choice)}
                >
                  <span className={`strip-dot is-${statusTone(choice.status)}`} aria-hidden="true" />
                  <span className="strip-agent-name">{choice.name}</span>
                  <span className="strip-agent-key mono">{choice.key}</span>
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="strip-info">
          {context.isOrchestrator ? (
            <>
              <span className="strip-context mono">{contextLine(context)}</span>
              <button
                type="button"
                className="strip-btn mono"
                aria-expanded={compactOpen}
                onClick={() => {
                  setCompactOpen((open) => !open)
                  setCompactConfirm(false)
                  setCompactError('')
                }}
              >
                Compact
              </button>
              <button type="button" className="strip-btn mono" onClick={onOpenSettings}>
                Settings
              </button>
            </>
          ) : (
            <span className="strip-context mono">{laneLine(context)}</span>
          )}
          {compactOpen && (
            <div className="strip-pop is-compact">
              <section className="strip-card" aria-label="Compact the orchestrator">
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
                  onClick={() => setCompactConfirm(true)}
                  disabled={!canCompact}
                >
                  Compact now
                </button>
                {!canCompact && (
                  <p className="strip-note">Compacting is not available from this bridge.</p>
                )}
                <div className="strip-switch-row">
                  <label className="strip-switch">
                    <input
                      type="checkbox"
                      role="switch"
                      aria-label="Autocompact"
                      checked={autocompactOn}
                      disabled={!canAutocompact || percentBusy}
                      onChange={(event) => commitAutocompact(event.target.checked, percent)}
                    />
                    <span>Autocompact</span>
                  </label>
                  <input
                    type="range"
                    min={AUTOCOMPACT_MIN}
                    max={AUTOCOMPACT_MAX}
                    step="1"
                    value={percent}
                    aria-label="Autocompact percent"
                    disabled={!canAutocompact || percentBusy}
                    onChange={(event) => setPercent(Number(event.target.value))}
                    onPointerUp={() => commitAutocompact(autocompactOn, percent)}
                    onKeyUp={() => commitAutocompact(autocompactOn, percent)}
                  />
                  <span className="strip-percent mono">{percent}%</span>
                </div>
                {settingsError && <p className="strip-note is-error">{settingsError}</p>}
                {compactConfirm && (
                  <div className="mr-orch-confirm" aria-label="Compact the orchestrator">
                    <p className="mr-orch-confirm-text">{`Compact ${context.name} now?`}</p>
                    {keep.trim() && (
                      <p className="mr-orch-confirm-detail mono">{`Keep: ${keep.trim()}`}</p>
                    )}
                    {compactError && <p className="strip-note is-error">{compactError}</p>}
                    <div className="mr-orch-confirm-actions">
                      <button
                        type="button"
                        className="mr-orch-confirm-btn is-start"
                        onClick={runCompact}
                        disabled={compactSaving}
                      >
                        Compact now
                      </button>
                      <button
                        type="button"
                        className="mr-orch-confirm-btn is-cancel"
                        onClick={() => {
                          setCompactConfirm(false)
                          setCompactError('')
                        }}
                        disabled={compactSaving}
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
              </section>
            </div>
          )}
        </div>
      </div>
      <div className="strip-half is-right">
        <button
          type="button"
          className="strip-log"
          onClick={onOpenDock}
          aria-label={`Open the dock for ${context.name}`}
        >
          {lines.length === 0 ? (
            <span className="strip-log-line is-dim">No log lines.</span>
          ) : (
            lines.map((line, index) => (
              <span className={`strip-log-line is-${line.tone}`} key={`${index}-${line.text}`}>
                {line.text}
              </span>
            ))
          )}
        </button>
        <button
          type="button"
          className="strip-expand mono"
          aria-expanded={dockOpen}
          aria-label={dockOpen ? 'Close the dock' : 'Open the dock'}
          onClick={onToggleDock}
        >
          {dockOpen ? 'Close' : 'Expand'}
        </button>
      </div>
    </section>
  )
}
