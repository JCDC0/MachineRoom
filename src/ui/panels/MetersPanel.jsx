import { formatCount } from '../agentStrip.js'
import { createContext, useContext, useEffect, useState } from 'react'
import { visibleText } from '../../model/paths.js'
import { costLabels } from '../../engine/board.js'
import { clampPercent, formatCents, listOf, meterTone, percentOf, textOf } from './format.js'
import { subscribeToNotices } from './notices.js'

export const CostsModeContext = createContext('live')

export const METERS_UNAVAILABLE = 'Cost needs a newer bridge.'

function tokenCount(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null
}

function tokenText(row) {
  const input = tokenCount(row.inputTokens)
  const output = tokenCount(row.outputTokens)
  if (input === null && output === null) return 'tokens not reported'
  return `${formatCount(input)} in / ${formatCount(output)} out`
}

function countOf(value) {
  return Number.isInteger(value) && value >= 0 ? value : 0
}

function runCountText(count) {
  return count === 1 ? '1 run not reported' : `${count} runs not reported`
}

function clockText(value) {
  const time = typeof value === 'string' ? Date.parse(value) : NaN
  if (!Number.isFinite(time)) return null
  const date = new Date(time)
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

function cacheText(row) {
  const known = countOf(row.cacheKnownRuns)
  const read = tokenCount(row.cacheReadTokens)
  const write = tokenCount(row.cacheWriteTokens)
  if (known <= 0 || (read === null && write === null)) return null
  const totalRuns = Math.max(countOf(row.runs), known)
  const reportingInput = row.cacheInputTokens === undefined ? tokenCount(row.inputTokens) : tokenCount(row.cacheInputTokens)
  if (read !== null && reportingInput !== null && reportingInput > 0) {
    const share = percentOf(read, reportingInput)
    return `Cache: ${share}% of input read from cache (${known} of ${totalRuns} runs reported)`
  }
  if (read !== null && write !== null) {
    return `Cache: ${formatCount(read)} read / ${formatCount(write)} write (${known} of ${totalRuns} runs reported)`
  }
  if (read !== null) {
    return `Cache: ${formatCount(read)} read (${known} of ${totalRuns} runs reported)`
  }
  return `Cache: ${formatCount(write)} write (${known} of ${totalRuns} runs reported)`
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
  const quotaRows = listOf(costs?.quota)
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
                  {costs.summary?.partial ? ' (partial)' : ''}
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
                const missingCostRuns = countOf(row.missingCostRuns)
                const failedCost = countOf(row.failedCost)
                const cache = cacheText(row)
                return (
                  <div key={`${agentId}-${index}`} className="meter-agent-row">
                    <div className="meter-agent-head">
                      <span className="meter-agent-name">{name}</span>
                      <span className="mono">
                        {row.costCents == null ? '?' : formatCents(row.costCents)}
                        {missingCostRuns > 0 ? ` (${runCountText(missingCostRuns)})` : ''}
                      </span>
                    </div>
                    <div className="meter-label-dim mono">{tokenText(row)}</div>
                    {cache && <div className="meter-label-dim mono">{cache}</div>}
                    {failedCost > 0 && (
                      <div className="meter-label-dim mono">{`Failed or stopped: ${formatCents(failedCost)}`}</div>
                    )}
                  </div>
                )
              })}
            </div>
            <div className="meter-label-dim mono">
              Spend comes from the lane run records. Budgets are not set here.
            </div>
          </section>

          {quotaRows.length > 0 && (
            <section className="meters-section" aria-label="Quota">
              <h4 className="meters-section-title">Quota</h4>
              {quotaRows.map((provider, index) => {
                const seen = clockText(provider.at)
                const windows = listOf(provider.windows)
                const providerName = textOf(provider.provider).toUpperCase() || 'Quota'
                return (
                  <div key={`${providerName}-${index}`} className="meter-agent-row">
                    <div className="meter-agent-head">
                      <span className="meter-agent-name">{providerName}</span>
                      {seen && <span className="meter-label-dim mono">{`seen ${seen}`}</span>}
                    </div>
                    {windows.map((window, windowIndex) => {
                      const resets = clockText(window.resetsAt)
                      const percent = clampPercent(window.usedPercent)
                      const windowText = [textOf(window.label), percent === null ? '' : `${percent}%`]
                        .filter(Boolean)
                        .join(' ')
                      return (
                        <div
                          key={`${textOf(window.label)}-${windowIndex}`}
                          className="meter-label-dim mono"
                        >
                          {resets ? `${windowText}, resets ${resets}` : windowText}
                        </div>
                      )
                    })}
                  </div>
                )
              })}
            </section>
          )}
        </>
      )}
    </div>
  )
}
