import Transport from './Transport.jsx'

const STATUS_TEXT = {
  idle: 'idle',
  queued: 'queued',
  working: 'working',
  error: 'failed',
  done: 'finished',
}

export default function Hud({ snapshot, focused, speeds, rootName, onToggle, onSeek, onSpeed, onFocus, onOverview }) {
  return (
    <div className="hud">
      <header className="hud-title">
        <h1>Machine Room</h1>
        <p className="mono">REPLAY // {rootName}</p>
      </header>

      <nav className="hud-agents" aria-label="Agents">
        {snapshot.agents.map((agent, index) => (
          <button
            key={agent.key}
            type="button"
            className={`agent is-${agent.status}`}
            aria-pressed={focused === agent.key}
            onClick={() => onFocus(agent.key)}
          >
            <span className="dot" aria-hidden="true" />
            <span className="agent-name">{agent.name}</span>
            <span className="agent-status mono">{STATUS_TEXT[agent.status] ?? agent.status}</span>
            <span className="agent-key mono">{index + 1}</span>
          </button>
        ))}
        <button type="button" className="overview" onClick={onOverview}>
          Overview <span className="agent-key mono">0</span>
        </button>
      </nav>

      <ul className="hud-legend mono" aria-label="Colour legend">
        <li className="is-white">activity</li>
        <li className="is-red">failure</li>
        <li className="is-yellow">finished</li>
      </ul>

      <Transport snapshot={snapshot} speeds={speeds} onToggle={onToggle} onSeek={onSeek} onSpeed={onSpeed} />
    </div>
  )
}
