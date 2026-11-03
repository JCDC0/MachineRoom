import { createContext, useContext, useEffect, useState } from 'react'
import { visibleText } from '../../model/paths.js'
import { costLabels } from '../../engine/board.js'
import { clampPercent, formatCents, listOf, meterTone, percentOf, textOf } from './format.js'
import { subscribeToNotices } from './notices.js'

export const CostsModeContext = createContext('live')

export const METERS_UNAVAILABLE = 'Meters need a newer bridge.'

function tokenCount(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null
}

function formatTokens(count) {
  if (count == null) return '?'
  if (count < 1000) return String(Math.floor(count))
  return `${(count / 1000).toFixed(1)}k`
}

function tokenText(row) {
  const input = tokenCount(row.inputTokens)
  const output = tokenCount(row.outputTokens)
  if (input === null && output === null) return 'tokens not reported'
  return `${formatTokens(input)} in / ${formatTokens(output)} out`
}

export default function MetersPanel({ client, initialCosts = null }) {
  const costMode = useContext(CostsModeContext)
  const sample = costLabels(costMode)
  const [costs, setCosts] = useState(initialCosts)
  const [loading, setLoading] = useState(() => initialCosts == null)
  const [loadError, setLoadError] = useState(null)
  const [refreshError, setRefreshError] = useState(null)
  const canRead = typeof client?.costs === 'function'
  const hasCosts = costs != null

  async function loadData({ isInitial = false } = {}) {
    if (!canRead) return
    setRefreshError(null)
    if (isInitial) {
      setLoading(true)
      setLoadError(null)
    }
    try {
      const costData = await client.costs()
      setCosts(costData && typeof costData === 'object' ? costData : null)
    } catch (err) {
      if (isInitial) setLoadError(err.message || 'Could not load meters.')
      else setRefreshError(err?.message || 'Could not refresh meters.')
    } finally {
      if (isInitial) {
        setLoading(false)
      }
    }
  }

  useEffect(() => {
    if (!canRead) return
    loadData({ isInitial: true })
  }, [client])

  useEffect(() => {
    return subscribeToNotices(client, ['costs'], () => {
      loadData()
    })
  }, [client])

  const summary = costs?.summary ?? null
  const byAgent = listOf(costs?.byAgent)
  const companySpend = Number.isFinite(summary?.spendCents) ? summary.spendCents : 0
  const companyBudget = Number.isFinite(summary?.budgetCents) ? summary.budgetCents : 0
  const companyPercent = companyBudget > 0
    ? clampPercent(summary?.utilizationPercent) ?? percentOf(companySpend, companyBudget)
    : 0

  return (
    <div className="meters-panel">
      <div className="panel-toolbar">
        <span className="panel-count mono">{sample ? sample.title : 'Spend'}</span>
        <button
          type="button"
          onClick={() => {
            loadData({ isInitial: false })
          }}
        >
          Refresh
        </button>
      </div>

      {refreshError && <p className="panel-error-message" role="alert">{refreshError}</p>}
      {sample && <div className="meter-label-dim mono">{sample.note}</div>}

      {!canRead && !hasCosts ? (
        <div className="panel-state is-dim mono">{METERS_UNAVAILABLE}</div>
      ) : loading ? (
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
          <section className="meters-section" aria-label="This month">
            <h4 className="meters-section-title">This month</h4>
            <div className="meters-summary-card">
              <div className="meter-stats-row">
                <span className="mono">Spent this month</span>
                <span className="mono">
                  {companyBudget > 0
                    ? `${formatCents(companySpend)} of ${formatCents(companyBudget)}`
                    : formatCents(companySpend)}
                </span>
              </div>
              {companyBudget > 0 && (
                <div className="meter-bar">
                  <div className="meter-track" aria-hidden="true">
                    <div
                      className={`meter-fill ${meterTone(companyPercent) === 'full' ? 'is-full' : ''}`}
                      style={{ width: `${companyPercent}%` }}
                    />
                  </div>
                  <span className="meter-percent mono">{`${companyPercent}%`}</span>
                </div>
              )}
            </div>
          </section>

          <section className="meters-section" aria-label="Lane spend">
            <h4 className="meters-section-title">Lane spend</h4>
            <div className="meters-agents-list">
              {byAgent.map((row, index) => {
                const agentId = textOf(row.agentId)
                const name = visibleText(textOf(row.agentName) || agentId) || 'Lane'
                return (
                  <div key={`${agentId}-${index}`} className="meter-agent-row">
                    <div className="meter-agent-head">
                      <span className="meter-agent-name">{name}</span>
                      <span className="mono">{formatCents(row.costCents)}</span>
                    </div>
                    <div className="meter-label-dim mono">{tokenText(row)}</div>
                  </div>
                )
              })}
            </div>
            <div className="meter-label-dim mono">
              Spend comes from the lane run records. Budgets are not set here.
            </div>
          </section>
        </>
      )}
    </div>
  )
}
