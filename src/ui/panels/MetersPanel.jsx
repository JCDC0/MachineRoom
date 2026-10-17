import { useEffect, useState } from 'react'
import { formatCents, meterTone, percentOf, timeUntil } from './format.js'

export default function MetersPanel({ client }) {
  const [costs, setCosts] = useState(null)
  const [agents, setAgents] = useState([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(null)

  const [editingAgentId, setEditingAgentId] = useState(null)
  const [editDollarValue, setEditDollarValue] = useState('')
  const [savingBudget, setSavingBudget] = useState(false)
  const [budgetError, setBudgetError] = useState(null)

  async function loadData() {
    setLoading(true)
    setLoadError(null)
    try {
      const [costData, agentList] = await Promise.all([
        client.costs(),
        client.agents(),
      ])
      setCosts(costData)
      setAgents(agentList)
    } catch (err) {
      setLoadError(err.message || 'Could not load meters.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadData()
  }, [client])

  function startEditing(agent) {
    setEditingAgentId(agent.id)
    setEditDollarValue((agent.budgetMonthlyCents / 100).toFixed(2))
    setBudgetError(null)
  }

  function cancelEditing() {
    setEditingAgentId(null)
    setEditDollarValue('')
    setBudgetError(null)
  }

  async function saveBudget(agentId) {
    const parsed = parseFloat(editDollarValue)
    if (Number.isNaN(parsed) || parsed < 0) {
      setBudgetError('Enter a valid dollar amount zero or greater.')
      return
    }
    const cents = Math.round(parsed * 100)
    setSavingBudget(true)
    setBudgetError(null)
    try {
      const updated = await client.setAgentBudget(agentId, cents)
      setAgents((prev) =>
        prev.map((a) => (a.id === agentId ? { ...a, budgetMonthlyCents: updated.budgetMonthlyCents } : a))
      )
      setEditingAgentId(null)
    } catch (err) {
      setBudgetError(err.message || 'Could not update budget.')
    } finally {
      setSavingBudget(false)
    }
  }

  if (loading) {
    return <div className="panel-state mono">Loading meters...</div>
  }

  if (loadError) {
    return (
      <div className="panel-state">
        <div className="panel-error-message">{loadError}</div>
        <button type="button" onClick={loadData}>Retry</button>
      </div>
    )
  }

  if (!costs) {
    return <div className="panel-state is-dim mono">No cost data available.</div>
  }

  const { summary, quota = [] } = costs
  const companyBudget = summary?.budgetCents ?? 0
  const companySpend = summary?.spendCents ?? 0
  const companyPercent = summary?.utilizationPercent ?? percentOf(companySpend, companyBudget)

  return (
    <div className="meters-panel">
      <div className="panel-toolbar">
        <span className="panel-count mono">Spend & Quota</span>
        <button type="button" onClick={loadData}>Refresh</button>
      </div>

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
                <span className="mono">{companyPercent}%</span>
              </div>
              <div className="meter-track" aria-hidden="true">
                <div
                  className={`meter-fill ${meterTone(companyPercent) === 'full' ? 'is-full' : ''}`}
                  style={{ width: `${companyPercent}%` }}
                />
              </div>
            </>
          )}
        </div>
      </section>

      <section className="meters-section" aria-label="Agent budgets">
        <h4 className="meters-section-title">Agent Budgets</h4>
        <div className="meters-agents-list">
          {agents.map((agent) => {
            const isEditing = editingAgentId === agent.id
            const spend = agent.spentMonthlyCents ?? 0
            const budget = agent.budgetMonthlyCents ?? 0
            const pct = percentOf(spend, budget)

            return (
              <div key={agent.id} className="meter-agent-row">
                <div className="meter-agent-head">
                  <span className="meter-agent-name">{agent.name}</span>
                  <span className="meter-agent-role mono">{agent.role}</span>
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
                      <span className="mono">{pct}%</span>
                    </div>
                    <div className="meter-track" aria-hidden="true">
                      <div
                        className={`meter-fill ${meterTone(pct) === 'full' ? 'is-full' : ''}`}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </>
                )}

                {isEditing ? (
                  <div className="meter-inline-edit">
                    {budgetError && (
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
                            saveBudget(agent.id)
                          } else if (e.key === 'Escape') {
                            e.preventDefault()
                            cancelEditing()
                          }
                        }}
                        placeholder="0.00"
                        autoFocus
                        disabled={savingBudget}
                        aria-label={`Budget in dollars for ${agent.name}`}
                      />
                      <button
                        type="button"
                        onClick={() => saveBudget(agent.id)}
                        disabled={savingBudget}
                      >
                        {savingBudget ? 'Saving...' : 'Save'}
                      </button>
                      <button
                        type="button"
                        onClick={cancelEditing}
                        disabled={savingBudget}
                      >
                        Cancel
                      </button>
                    </div>
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
                <div key={item.provider} className="quota-provider-card is-error">
                  <div className="quota-provider-name">{item.provider}</div>
                  <div className="quota-error-label">Could not read quota</div>
                  <div className="quota-error-text mono">{item.error}</div>
                </div>
              )
            }

            return (
              <div key={item.provider} className="quota-provider-card">
                <div className="quota-provider-name">{item.provider}</div>
                <div className="quota-windows-list">
                  {item.windows.map((w, index) => {
                    const hasPct = w.usedPercent != null

                    return (
                      <div key={w.label ?? index} className="quota-window-row">
                        <div className="quota-window-head">
                          <span className="quota-window-label">{w.label}</span>
                          {hasPct && (
                            <span className="quota-window-reset mono">
                              resets in {timeUntil(w.resetsAt)}
                            </span>
                          )}
                        </div>

                        {hasPct ? (
                          <>
                            <div className="meter-track" aria-hidden="true">
                              <div
                                className={`meter-fill ${meterTone(w.usedPercent) === 'full' ? 'is-full' : ''}`}
                                style={{ width: `${w.usedPercent}%` }}
                              />
                            </div>
                            <div className="quota-percent-label mono">{w.usedPercent}%</div>
                          </>
                        ) : (
                          <div className="quota-detail-text mono">{w.detail}</div>
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
    </div>
  )
}
