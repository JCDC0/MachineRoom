import { useEffect, useId, useRef, useState } from 'react'
import {
  ORCH_MAX_CHARS,
  ORCH_REFRESH_MS,
  ORCH_START_CONFIRM,
  ORCH_STOP_CONFIRM,
  canSend,
  charCount,
  chatLines,
  clampDraft,
  errorText,
  isSendKey,
  needsStartConfirm,
  normalizeChat,
  statusText,
  statusTone,
} from './orchestratorChat.js'

function initialChatState(initialChat) {
  return normalizeChat(initialChat)
}

export default function OrchestratorChat({
  client = null,
  open = true,
  onClose,
  initialChat = null,
  initialDraft = '',
  initialConfirm = null,
}) {
  const [chat, setChat] = useState(() => initialChatState(initialChat))
  const [draft, setDraft] = useState(() => clampDraft(initialDraft))
  const [confirm, setConfirm] = useState(() =>
    initialConfirm === 'start' || initialConfirm === 'stop' ? initialConfirm : null
  )
  const [started, setStarted] = useState(() => !needsStartConfirm(initialChatState(initialChat)))
  const [sending, setSending] = useState(false)
  const [stopping, setStopping] = useState(false)
  const [loaded, setLoaded] = useState(Boolean(initialChat))
  const [unavailable, setUnavailable] = useState(false)
  const [error, setError] = useState(null)
  const [readError, setReadError] = useState(null)

  const inputId = useId()
  const logRef = useRef(null)
  const inputRef = useRef(null)
  const reloadRef = useRef(null)

  const lines = chatLines(chat)
  const status = statusText(chat.state)
  const tone = statusTone(chat.state)
  const count = charCount(draft)
  const working = chat.state === 'working'
  const problem = error ?? readError

  useEffect(() => {
    if (!open) return undefined
    if (!client || typeof client.orchestrator !== 'function') {
      setUnavailable(true)
      return undefined
    }
    setUnavailable(false)
    let stopped = false

    async function read() {
      try {
        const answer = await client.orchestrator()
        if (stopped) return
        setChat(normalizeChat(answer))
        setLoaded(true)
        setReadError(null)
      } catch (failure) {
        if (stopped) return
        setLoaded(true)
        setReadError(errorText(failure, 'Could not read the orchestrator.'))
      }
    }

    reloadRef.current = read
    read()
    const timer = setInterval(read, ORCH_REFRESH_MS)
    let unsubscribe = null
    if (typeof client.subscribe === 'function') {
      unsubscribe = client.subscribe((notice) => {
        if (notice && notice.topic === 'orchestrator') read()
      })
    }

    return () => {
      stopped = true
      clearInterval(timer)
      unsubscribe?.()
      reloadRef.current = null
    }
  }, [open, client])

  useEffect(() => {
    if (!open) return undefined
    const timer = setTimeout(() => inputRef.current?.focus(), 20)
    return () => clearTimeout(timer)
  }, [open])

  useEffect(() => {
    if (open && logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight
    }
  }, [open, lines.length])

  useEffect(() => {
    if (!open) return undefined
    function onKey(event) {
      if (event.key !== 'Escape') return
      if (confirm) {
        setConfirm(null)
        return
      }
      onClose?.()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, confirm, onClose])

  async function deliver(text) {
    if (!client || typeof client.sendToOrchestrator !== 'function') {
      setError('The orchestrator is not connected.')
      return
    }
    setSending(true)
    setError(null)
    setConfirm(null)
    try {
      await client.sendToOrchestrator(text, { confirmed: true })
      setStarted(true)
      setDraft((current) => (current.trim() === text ? '' : current))
      await reloadRef.current?.()
    } catch (failure) {
      setError(errorText(failure, 'Could not send the message.'))
    } finally {
      setSending(false)
    }
  }

  function requestSend() {
    const text = draft.trim()
    if (!canSend(text) || sending || unavailable) return
    if (!started && needsStartConfirm(chat)) {
      setConfirm('start')
      return
    }
    deliver(text)
  }

  function startConfirmed() {
    const text = draft.trim()
    setConfirm(null)
    if (canSend(text)) deliver(text)
  }

  function stopConfirmed() {
    if (!client || typeof client.stopOrchestrator !== 'function') {
      setError('The orchestrator is not connected.')
      return
    }
    setStopping(true)
    setError(null)
    client
      .stopOrchestrator({ confirmed: true })
      .then(async () => {
        setConfirm(null)
        await reloadRef.current?.()
      })
      .catch((failure) => setError(errorText(failure, 'Could not stop the orchestrator.')))
      .finally(() => setStopping(false))
  }

  function handleSubmit(event) {
    event.preventDefault()
    requestSend()
  }

  function handleKeyDown(event) {
    if (sending) return
    if (!isSendKey(event)) return
    event.preventDefault()
    requestSend()
  }

  if (!open) return null

  return (
    <aside
      id="hud-orchestrator-chat"
      className="mr-orch"
      aria-label="Orchestrator chat"
    >
      <header className="mr-orch-head">
        <span className="mr-orch-title">Orchestrator</span>
        {chat.model ? <span className="mr-orch-model mono">{chat.model}</span> : null}
        <button
          type="button"
          className="mr-orch-close"
          onClick={() => onClose?.()}
          aria-label="Close orchestrator chat"
        >
          ×
        </button>
      </header>

      <p className={`mr-orch-status is-${tone} mono`} role="status" aria-live="polite">
        <span className="mr-orch-dot" aria-hidden="true" />
        <span>{status}</span>
      </p>

      <div className="mr-orch-log" role="log" aria-live="polite" ref={logRef}>
        {lines.length === 0 ? (
          <p className="mr-orch-empty">
            {loaded ? 'Tell the orchestrator what you want built.' : 'Reading the chat.'}
          </p>
        ) : (
          lines.map((line) => (
            <div key={line.id} className={`mr-orch-line is-${line.from}`}>
              {line.from === 'room' ? <span className="mr-orch-who mono">room</span> : null}
              <span className="mr-orch-text">{line.text}</span>
            </div>
          ))
        )}
      </div>

      {problem ? (
        <p className="mr-orch-error" role="alert">
          {problem}
        </p>
      ) : null}

      {confirm === 'start' ? (
        <section className="mr-orch-confirm" aria-label="Start the orchestrator">
          <p className="mr-orch-confirm-text">{ORCH_START_CONFIRM}</p>
          <div className="mr-orch-confirm-actions">
            <button
              type="button"
              className="mr-orch-confirm-btn is-start"
              onClick={startConfirmed}
              disabled={sending || !canSend(draft)}
            >
              Start
            </button>
            <button
              type="button"
              className="mr-orch-confirm-btn is-cancel"
              onClick={() => setConfirm(null)}
              disabled={sending}
            >
              Cancel
            </button>
          </div>
        </section>
      ) : null}

      {confirm === 'stop' ? (
        <section className="mr-orch-confirm is-stop" aria-label="Stop the orchestrator">
          <p className="mr-orch-confirm-text">{ORCH_STOP_CONFIRM}</p>
          <div className="mr-orch-confirm-actions">
            <button
              type="button"
              className="mr-orch-confirm-btn is-stop"
              onClick={stopConfirmed}
              disabled={stopping}
            >
              Stop
            </button>
            <button
              type="button"
              className="mr-orch-confirm-btn is-cancel"
              onClick={() => setConfirm(null)}
              disabled={stopping}
            >
              Cancel
            </button>
          </div>
        </section>
      ) : null}

      <form className="mr-orch-form" onSubmit={handleSubmit}>
        <label className="mr-orch-label mono" htmlFor={inputId}>
          Message
        </label>
        <textarea
          id={inputId}
          ref={inputRef}
          className="mr-orch-input mono"
          value={draft}
          maxLength={ORCH_MAX_CHARS}
          rows={3}
          spellCheck="false"
          placeholder="What should be built?"
          aria-label="Message to the orchestrator"
          onChange={(event) => setDraft(clampDraft(event.target.value))}
          onKeyDown={handleKeyDown}
        />
        <div className="mr-orch-meta">
          <span className="mr-orch-hint mono">Enter sends. Shift+Enter adds a line.</span>
          {count ? <span className="mr-orch-count mono">{count}</span> : null}
        </div>
        <div className="mr-orch-actions">
          <button
            type="submit"
            className="mr-orch-send"
            disabled={!canSend(draft) || sending || unavailable}
          >
            {sending ? 'Sending' : 'Send'}
          </button>
          {working ? (
            <button
              type="button"
              className="mr-orch-stop"
              onClick={() => setConfirm('stop')}
              disabled={stopping}
            >
              Stop
            </button>
          ) : null}
        </div>
      </form>

      {unavailable ? <p className="mr-orch-note mono">The orchestrator is not connected.</p> : null}
    </aside>
  )
}
