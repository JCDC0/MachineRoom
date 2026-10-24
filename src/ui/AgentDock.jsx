import { agentContext } from './agentContext.js'

export default function AgentDock({
  agent = null,
  lanes = null,
  costs = null,
  liveRuns = null,
  tasks = null,
  log = null,
  orchestrator = null,
  onFocus = () => {},
  onToggleTerminal = () => {},
  onOpenChat = () => {},
  onAutocompact = () => {},
}) {
  const context = agentContext({ agent, lanes, costs, liveRuns, tasks, log, orchestrator })
  const rows = [['Status', context.status]]
  if (context.sector !== null) rows.push(['Sector', context.sector])
  if (context.lanes !== null) rows.push(['Lanes', context.lanes])
  if (context.scope !== null) rows.push(['Scope', context.scope])
  if (context.restricted !== null) rows.push(['Restricted', context.restricted])
  if (context.setBy !== null) rows.push(['Set by', context.setBy])
  rows.push(
    ['Key', context.key],
    ['Harness', context.harness],
    ['Model', context.model],
    ['Task', context.task],
    ['Command', context.command],
    ['Cost', context.cost],
    ['Tokens', context.tokens]
  )
  if (context.isOrchestrator && context.context) {
    rows.push(['Context', `${context.context.label} of ${context.context.window} tokens`])
  }

  return (
    <section className="agent-dock" aria-label="Agent context">
      <div className="agent-dock-head">
        <h2 className="agent-dock-name">{context.name}</h2>
      </div>
      <dl className="agent-dock-rows">
        {rows.map(([label, value]) => (
          <div className="agent-dock-row" key={label}>
            <dt>{label}</dt>
            <dd
              className="mono"
              style={String(value).includes('\n') ? { whiteSpace: 'pre-line' } : undefined}
            >
              {value}
            </dd>
          </div>
        ))}
        {context.isOrchestrator && context.autocompact !== null && (
          <div className="agent-dock-row">
            <dt>Autocompact</dt>
            <dd className="mono">
              <label>
                <input
                  type="checkbox"
                  role="switch"
                  aria-label="Autocompact"
                  checked={context.autocompact}
                  onChange={(event) => onAutocompact(context.key, event.target.checked)}
                />
                {context.autocompact ? ' on' : ' off'}
              </label>
            </dd>
          </div>
        )}
      </dl>
      <ol className="agent-dock-log" aria-label="Recent log lines">
        {context.log.length === 0 ? (
          <li className="agent-dock-line is-dim mono">No log lines.</li>
        ) : (
          context.log.map((line, index) => (
            <li className={`agent-dock-line is-${line.tone} mono`} key={`${index}-${line.text}`}>
              {line.text}
            </li>
          ))
        )}
      </ol>
      <div className="agent-dock-actions">
        <button type="button" onClick={() => onFocus(context.key)} disabled={!context.key}>
          Focus
        </button>
        <button type="button" onClick={() => onToggleTerminal(context.key)} disabled={!context.key}>
          Log
        </button>
        {context.isOrchestrator && (
          <button type="button" onClick={() => onOpenChat()}>
            Open chat
          </button>
        )}
      </div>
    </section>
  )
}
