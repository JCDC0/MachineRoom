import { Chip } from './controls.jsx'

export function RecipientChip({ value, onChange, recipients, lanes }) {
  return (
    <Chip label="To" value={value} onChange={onChange} options={[
      { value: 'orchestrator', label: 'Orchestrator' },
      ...recipients.map(({ id, name }) => ({ value: id, label: name || id })),
      ...lanes.map(({ key, name }) => ({ value: key, label: name || key })),
    ]} />
  )
}

export default function Composer({
  input, toolbar, onSubmit, sendDisabled, sending, stop, status, tone, context, children,
}) {
  const sendLabel = sending ? 'Sending' : 'Send'
  return (
    <div className="mr-composer">
      <form className="mr-orch-form mr-composer-box" onSubmit={onSubmit}>
        {input && <textarea className="mr-orch-input mono" rows={2} spellCheck={false} {...input} />}
        {children}
        <div className="mr-composer-toolbar">
          <div className="mr-composer-controls">{toolbar}</div>
          {(stop || input) && (
            <div className="mr-composer-actions">
              {stop && <Chip label="Stop" className="mr-orch-stop" {...stop} />}
              {input && (
                <button type="submit" className="ui-icon-btn mr-composer-send" aria-label={sendLabel}
                  title={sendLabel} disabled={sendDisabled}>
                  <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
                    <path d="M2 8h11M9 4l4 4-4 4" fill="none" stroke="currentColor"
                      strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </button>
              )}
            </div>
          )}
        </div>
      </form>
      <p className={`mr-orch-status is-${tone} mono`} role="status">
        <span className="mr-orch-dot" aria-hidden="true" />
        <span>{status}{context && ` · ${context}`}</span>
      </p>
    </div>
  )
}
