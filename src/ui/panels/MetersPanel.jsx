import { useEffect, useState } from 'react'
import { visibleText } from '../../model/paths.js'
import { clampPercent, formatCents, listOf, meterTone, percentOf, textOf, timeUntil } from './format.js'
import { subscribeToNotices } from './notices.js'
import { backupAgePercent, backupNotice, formatBytes } from './backup.js'

export function budgetConfirmText(name, cents) {
  return `Set ${visibleText(name)}'s monthly budget to ${formatCents(cents)} in Paperclip?`
}

export default function MetersPanel({
  client,
  initialBackupStatus = null,
  initialCosts = null,
  initialAgents = [],
  initialEditingAgentId = null,
  initialEditDollarValue = '',
  initialConfirmOpen = false,
}) {
  const [costs, setCosts] = useState(initialCosts)
  const [agents, setAgents] = useState(initialAgents)
  const [loading, setLoading] = useState(() => initialCosts == null)
  const [loadError, setLoadError] = useState(null)

  const [editingAgentId, setEditingAgentId] = useState(initialEditingAgentId)
  const [editDollarValue, setEditDollarValue] = useState(initialEditDollarValue)
  const [savingBudget, setSavingBudget] = useState(false)
  const [budgetError, setBudgetError] = useState(null)
  const [budgetConfirmOpen, setBudgetConfirmOpen] = useState(Boolean(initialConfirmOpen))

  const [backupStatus, setBackupStatus] = useState(initialBackupStatus)
  const [backupLoading, setBackupLoading] = useState(
    () => initialBackupStatus == null && typeof client?.backupStatus === 'function'
  )
  const [backupError, setBackupError] = useState(null)
  const [showConfirm, setShowConfirm] = useState(false)
  const [backingUp, setBackingUp] = useState(false)
  const [backupActionError, setBackupActionError] = useState(null)
  const [backupSuccess, setBackupSuccess] = useState(null)

  async function loadData({ isInitial = false } = {}) {
    if (isInitial) {
      setLoading(true)
      setLoadError(null)
    }
    try {
      const [costData, agentList] = await Promise.all([
        client.costs(),
        client.agents(),
      ])
      setCosts(costData && typeof costData === 'object' ? costData : null)
      setAgents(listOf(agentList))
    } catch (err) {
      if (isInitial) {
        setLoadError(err.message || 'Could not load meters.')
      }
    } finally {
      if (isInitial) {
        setLoading(false)
      }
    }
  }

  async function loadBackup() {
    if (typeof client?.backupStatus !== 'function') return
    setBackupLoading(true)
    setBackupError(null)
    try {
      const status = await client.backupStatus()
      setBackupStatus(status)
    } catch {
      setBackupError('Could not read the backup status.')
    } finally {
      setBackupLoading(false)
    }
  }

  async function handleBackupNow() {
    if (typeof client?.backupNow !== 'function') return
    setBackingUp(true)
    setBackupActionError(null)
    try {
      const result = await client.backupNow()
      setBackupSuccess(`Backed up as ${result?.name ?? 'backup'}, ${formatBytes(result?.sizeBytes)}.`)
      setShowConfirm(false)
      await loadBackup()
    } catch (err) {
      setBackupActionError(err?.message || 'The backup request failed.')
    } finally {
      setBackingUp(false)
    }
  }

  useEffect(() => {
    loadData({ isInitial: true })
    loadBackup()
  }, [client])

  useEffect(() => {
    return subscribeToNotices(client, ['agents', 'costs'], () => {
      loadData()
    })
  }, [client])

  function startEditing(agent) {
    setEditingAgentId(agent.id)
    setEditDollarValue(Number.isFinite(agent.budgetMonthlyCents) ? (agent.budgetMonthlyCents / 100).toFixed(2) : '')
    setBudgetError(null)
  }

  function cancelEditing() {
    setEditingAgentId(null)
    setEditDollarValue('')
    setBudgetError(null)
    setBudgetConfirmOpen(false)
  }

  function requestBudgetSave() {
    const parsed = parseFloat(editDollarValue)
    if (Number.isNaN(parsed) || parsed < 0) {
      setBudgetError('Enter a valid dollar amount zero or greater.')
      return
    }
    setBudgetError(null)
    setBudgetConfirmOpen(true)
  }

  async function saveBudget(agentId, cents) {
    if (!Number.isFinite(cents) || cents < 0) {
      setBudgetError('Enter a valid dollar amount zero or greater.')
      setBudgetConfirmOpen(false)
      return
    }
    setSavingBudget(true)
    setBudgetError(null)
    try {
      const updated = await client.setAgentBudget(agentId, cents)
      setAgents((prev) =>
        prev.map((a) => (a.id === agentId ? { ...a, budgetMonthlyCents: updated.budgetMonthlyCents } : a))
      )
      setEditingAgentId(null)
      setBudgetConfirmOpen(false)
    } catch (err) {
      setBudgetError(err.message || 'Could not update budget.')
    } finally {
      setSavingBudget(false)
    }
  }

  const notice = backupNotice(backupStatus)
  const backupPct = backupAgePercent(backupStatus)
  const summary = costs?.summary ?? null
  const quota = listOf(costs?.quota)
  const byAgent = listOf(costs?.byAgent)
  const companyBudget = Number.isFinite(summary?.budgetCents) ? summary.budgetCents : 0
  const companySpend = Number.isFinite(summary?.spendCents) ? summary.spendCents : 0
  const companyPercent = clampPercent(summary?.utilizationPercent) ?? percentOf(companySpend, companyBudget)

  return (
    <div className="meters-panel">
      <div className="panel-toolbar">
        <span className="panel-count mono">Spend & Quota</span>
        <button
          type="button"
          onClick={() => {
            loadData({ isInitial: false })
            loadBackup()
          }}
        >
          Refresh
        </button>
      </div>

      {loading ? (
        <div className="panel-state mono">Loading meters...</div>
      ) : loadError ? (
        <div className="panel-state">
          <div className="panel-error-message">{loadError}</div>
          <button type="button" onClick={() => loadData({ isInitial: true })}>
            Retry
          </button>
        </div>
      ) : !costs ? (
        <div className="panel-state is-dim mono">No cost data available.</div>
      ) : (
        <>

      <section className="meters-section" aria-label="Company budget">
        <h4 className="meters-section-title">Company Budget</h4>
        <div className="meters-summary-card">
          {companyBudget === 0 ? (
            <div className="meter-label-dim mono">No budget set</div>
          ) : (
            <>
              <div className="meter-stats-row">
                <span className="mono">
                  {formatCents(companySpend)} of {formatCents(companyBudget)}
                </span>
              </div>
              <div className="meter-bar">
                <div className="meter-track" aria-hidden="true">
                  <div
                    className={`meter-fill ${meterTone(companyPercent) === 'full' ? 'is-full' : ''}`}
                    style={{ width: `${companyPercent}%` }}
                  />
                </div>
                <span className="meter-percent mono">{`${companyPercent}%`}</span>
              </div>
            </>
          )}
        </div>
      </section>

      <section className="meters-section" aria-label="Agent budgets">
        <h4 className="meters-section-title">Agent Budgets</h4>
        <div className="meters-agents-list">
          {listOf(agents).map((agent) => {
            const isEditing = editingAgentId === agent.id
            const agentCost = byAgent.find((c) => c?.agentId === agent.id)?.costCents
            const spend = agentCost ?? agent.spentMonthlyCents ?? 0
            const budget = Number.isFinite(agent.budgetMonthlyCents) ? agent.budgetMonthlyCents : 0
            const pct = percentOf(spend, budget)
            const parsedBudget = parseFloat(editDollarValue)
            const pendingCents = Number.isNaN(parsedBudget) ? null : Math.round(parsedBudget * 100)

            return (
              <div key={agent.id} className="meter-agent-row">
                <div className="meter-agent-head">
                  <span className="meter-agent-name">{textOf(agent.name)}</span>
                  <span className="meter-agent-role mono">{textOf(agent.role)}</span>
                </div>

                {budget === 0 ? (
                  <div className="meter-stats-row">
                    <span className="meter-label-dim mono">No limit</span>
                    <span className="mono">{formatCents(spend)} spent</span>
                  </div>
                ) : (
                  <>
                    <div className="meter-stats-row">
                      <span className="mono">
                        {formatCents(spend)} of {formatCents(budget)}
                      </span>
                    </div>
                    <div className="meter-bar">
                      <div className="meter-track" aria-hidden="true">
                        <div
                          className={`meter-fill ${meterTone(pct) === 'full' ? 'is-full' : ''}`}
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                      <span className="meter-percent mono">{`${pct}%`}</span>
                    </div>
                  </>
                )}

                {isEditing ? (
                  <div className="meter-inline-edit">
                    {budgetError && !budgetConfirmOpen && (
                      <div className="panel-banner is-error" role="alert">
                        {budgetError}
                      </div>
                    )}
                    <div className="meter-edit-input-row">
                      <span className="meter-dollar-prefix">$</span>
                      <input
                        type="number"
                        step="any"
                        min="0"
                        value={editDollarValue}
                        onChange={(e) => setEditDollarValue(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault()
                            requestBudgetSave()
                          } else if (e.key === 'Escape') {
                            e.preventDefault()
                            e.stopPropagation()
                            cancelEditing()
                          }
                        }}
                        placeholder="0.00"
                        autoFocus
                        disabled={savingBudget || budgetConfirmOpen}
                        aria-label={`Budget in dollars for ${agent.name}`}
                      />
                      <button
                        type="button"
                        onClick={requestBudgetSave}
                        disabled={savingBudget || budgetConfirmOpen}
                      >
                        Save
                      </button>
                      <button
                        type="button"
                        onClick={cancelEditing}
                        disabled={savingBudget}
                      >
                        Cancel
                      </button>
                    </div>
                    {budgetConfirmOpen && (
                      <div className="brief-confirm-card meter-confirm-card" role="region" aria-label="Confirm budget">
                        <div className="brief-confirm-warning">
                          {budgetConfirmText(agent.name, pendingCents)}
                        </div>
                        <div className="brief-confirm-actions">
                          <button
                            type="button"
                            className="brief-confirm-btn"
                            disabled={savingBudget || pendingCents == null || pendingCents < 0}
                            onClick={() => saveBudget(agent.id, pendingCents)}
                          >
                            Set budget
                          </button>
                          <button
                            type="button"
                            className="brief-cancel-btn"
                            disabled={savingBudget}
                            onClick={() => {
                              setBudgetConfirmOpen(false)
                              setBudgetError(null)
                            }}
                          >
                            Cancel
                          </button>
                        </div>
                        {budgetError && (
                          <div className="brief-confirm-error mono" role="alert">
                            {budgetError}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="meter-edit-action">
                    <button
                      type="button"
                      className="meter-edit-btn"
                      onClick={() => startEditing(agent)}
                    >
                      Set budget
                    </button>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </section>

      <section className="meters-section" aria-label="Provider quotas">
        <h4 className="meters-section-title">Quota</h4>
        <div className="meters-quota-list">
          {quota.map((item) => {
            if (!item.ok) {
              return (
                <div key={textOf(item.provider)} className="quota-provider-card is-error">
                  <div className="quota-provider-name">{textOf(item.provider)}</div>
                  <div className="quota-error-label">Could not read quota</div>
                  <div className="quota-error-text mono">{textOf(item.error)}</div>
                </div>
              )
            }

            return (
              <div key={textOf(item.provider)} className="quota-provider-card">
                <div className="quota-provider-name">{textOf(item.provider)}</div>
                <div className="quota-windows-list">
                  {listOf(item.windows).map((w, index) => {
                    const usedPercent = clampPercent(w?.usedPercent)
                    const hasPct = usedPercent !== null

                    return (
                      <div key={`${textOf(w.label)}-${index}`} className="quota-window-row">
                        <div className="quota-window-head">
                          <span className="quota-window-label">{textOf(w.label)}</span>
                          {hasPct && w.resetsAt && (
                            <span className="quota-window-reset mono">
                              resets in {timeUntil(w.resetsAt)}
                            </span>
                          )}
                        </div>

                        {hasPct ? (
                          <div className="meter-bar">
                            <div className="meter-track" aria-hidden="true">
                              <div
                                className={`meter-fill ${meterTone(usedPercent) === 'full' ? 'is-full' : ''}`}
                                style={{ width: `${usedPercent}%` }}
                              />
                            </div>
                            <span className="quota-percent-label meter-percent mono">{`${usedPercent}%`}</span>
                          </div>
                        ) : (
                          <div className="quota-detail-text mono">{textOf(w.detail)}</div>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>
            )
          })}
        </div>
      </section>
        </>
      )}

      <section className="meters-section backup-section" aria-label="Backups">
        <h4 className="meters-section-title">Backups</h4>
        <div className="backup-card">
          {backupError ? (
            <div className="backup-error mono" role="alert">
              {backupError}
            </div>
          ) : notice ? (
            <>
              <div
                className={`backup-title mono ${
                  notice.tone === 'red' ? 'is-red' : notice.tone === 'yellow' ? 'is-yellow' : ''
                }`}
              >
                {notice.title}
              </div>
              {backupPct != null && (
                <div className="meter-bar backup-age-bar">
                  <div className="meter-track" aria-hidden="true">
                    <div
                      className={`meter-fill ${notice.tone === 'red' || meterTone(backupPct) === 'full' ? 'is-full' : ''}`}
                      style={{ width: `${backupPct}%` }}
                    />
                  </div>
                  <span className="meter-percent mono">{`${backupPct}%`}</span>
                </div>
              )}
              {notice.lines.length > 0 && (
                <div className="backup-lines">
                  {notice.lines.map((line, idx) => (
                    <div key={idx} className="backup-line mono">
                      {line}
                    </div>
                  ))}
                </div>
              )}
            </>
          ) : backupLoading ? (
            <div className="meter-label-dim mono">Loading backup status...</div>
          ) : null}

            {backupSuccess && (
              <div className="backup-success mono" role="status">
                {backupSuccess}
              </div>
            )}

            {!showConfirm && (
              <div className="backup-actions">
                <button
                  type="button"
                  className="backup-now-btn"
                  onClick={() => {
                    setShowConfirm(true)
                    setBackupActionError(null)
                    setBackupSuccess(null)
                  }}
                  disabled={backingUp}
                >
                  Back up now
                </button>
              </div>
            )}

            {showConfirm && (
              <div className="backup-confirm-card" role="region" aria-label="Confirm backup">
                <div className="backup-confirm-warning">
                  Back up Paperclip's database now? Paperclip writes a file to its backup folder; agents keep working.
                </div>
                <div className="backup-confirm-actions">
                  <button
                    type="button"
                    className="backup-confirm-btn"
                    disabled={backingUp}
                    onClick={handleBackupNow}
                  >
                    {backingUp ? 'Backing up' : 'Back up'}
                  </button>
                  <button
                    type="button"
                    className="backup-cancel-btn"
                    disabled={backingUp}
                    onClick={() => {
                      setShowConfirm(false)
                      setBackupActionError(null)
                    }}
                  >
                    Cancel
                  </button>
                </div>
                {backupActionError && (
                  <div className="backup-confirm-error mono" role="alert">
                    {backupActionError}
                  </div>
                )}
              </div>
            )}
          </div>
      </section>
    </div>
  )
}

