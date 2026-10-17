import { useEffect, useId, useRef, useState } from 'react'
import { containsSecret, interpret } from '../assistant/intent.js'
import {
  addToHistory,
  BLOCKED_MASK,
  clampPosition,
  DEFAULT_TERMINAL_SIZE,
  formatCommandLine,
  getBlockedSay,
  getDefaultPosition,
  stepHistory,
} from './assistantHistory.js'
import { loadAssistantPosition, saveAssistantPosition } from './settings.js'

let nextEntryId = 1

export default function Assistant({
  context = { agents: [], paths: [] },
  onAction = () => {},
  ask = null,
  open: controlledOpen,
  onClose,
  initialOpen = false,
  storage = (typeof window !== 'undefined' ? window.localStorage : null),
}) {
  const [internalOpen, setInternalOpen] = useState(initialOpen)
  const isOpen = controlledOpen !== undefined ? controlledOpen : internalOpen

  const [input, setInput] = useState('')
  const [history, setHistory] = useState([])
  const [historyIndex, setHistoryIndex] = useState(-1)
  const [draft, setDraft] = useState('')
  const [entries, setEntries] = useState([
    {
      id: 'init-help',
      kind: 'info',
      say: 'Try: "what is agy doing", "costs", "new task", "terminal for hermes".',
    },
  ])

  const [pos, setPos] = useState(() => {
    const saved = loadAssistantPosition(storage)
    const win = typeof window !== 'undefined'
      ? { windowWidth: window.innerWidth, windowHeight: window.innerHeight }
      : { windowWidth: 1280, windowHeight: 800 }
    if (saved && Number.isFinite(saved.x) && Number.isFinite(saved.y)) {
      return clampPosition(saved, DEFAULT_TERMINAL_SIZE, win)
    }
    return getDefaultPosition(DEFAULT_TERMINAL_SIZE, win)
  })

  const inputId = useId()
  const terminalRef = useRef(null)
  const inputRef = useRef(null)
  const logRef = useRef(null)

  useEffect(() => {
    function onKeyDown(event) {
      if (event.key === '/' && !isOpen) {
        if (event.target?.closest?.('input, textarea, select')) return
        if (event.ctrlKey || event.metaKey || event.altKey) return
        event.preventDefault()
        if (controlledOpen === undefined) {
          setInternalOpen(true)
        }
      } else if (event.key === 'Escape' && isOpen) {
        event.preventDefault()
        if (controlledOpen === undefined) {
          setInternalOpen(false)
        }
        onClose?.()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [isOpen, controlledOpen, onClose])

  useEffect(() => {
    if (isOpen) {
      const timer = setTimeout(() => {
        inputRef.current?.focus()
      }, 20)
      return () => clearTimeout(timer)
    }
  }, [isOpen])

  useEffect(() => {
    function onResize() {
      const size = terminalRef.current
        ? { width: terminalRef.current.offsetWidth, height: terminalRef.current.offsetHeight }
        : DEFAULT_TERMINAL_SIZE
      setPos((current) => {
        const next = clampPosition(current, size, {
          windowWidth: window.innerWidth,
          windowHeight: window.innerHeight,
        })
        saveAssistantPosition(storage, next)
        return next
      })
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [storage])

  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight
    }
  }, [entries, isOpen])

  function handleClose() {
    if (controlledOpen === undefined) {
      setInternalOpen(false)
    }
    onClose?.()
  }

  function handlePointerDown(event) {
    if (event.target?.closest?.('button')) return
    if (typeof window !== 'undefined' && window.innerWidth < 900) return
    event.preventDefault()

    const startX = event.clientX
    const startY = event.clientY
    const startPosX = pos.x
    const startPosY = pos.y

    function onPointerMove(e) {
      const dx = e.clientX - startX
      const dy = e.clientY - startY
      const size = terminalRef.current
        ? { width: terminalRef.current.offsetWidth, height: terminalRef.current.offsetHeight }
        : DEFAULT_TERMINAL_SIZE
      const nextPos = clampPosition(
        { x: startPosX + dx, y: startPosY + dy },
        size,
        { windowWidth: window.innerWidth, windowHeight: window.innerHeight }
      )
      setPos(nextPos)
    }

    function onPointerUp(e) {
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerup', onPointerUp)
      const dx = e.clientX - startX
      const dy = e.clientY - startY
      const size = terminalRef.current
        ? { width: terminalRef.current.offsetWidth, height: terminalRef.current.offsetHeight }
        : DEFAULT_TERMINAL_SIZE
      const finalPos = clampPosition(
        { x: startPosX + dx, y: startPosY + dy },
        size,
        { windowWidth: window.innerWidth, windowHeight: window.innerHeight }
      )
      setPos(finalPos)
      saveAssistantPosition(storage, finalPos)
    }

    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', onPointerUp)
  }

  async function processText(textToSend) {
    const raw = String(textToSend ?? '').trim()
    if (!raw) return

    const isSecret = containsSecret(raw)
    const commandText = formatCommandLine(raw, isSecret)

    setInput('')
    setDraft('')
    setHistoryIndex(-1)
    setHistory((prev) => addToHistory(prev, commandText))

    const commandEntry = {
      id: `cmd-${nextEntryId++}`,
      kind: 'command',
      text: commandText,
      isBlocked: isSecret,
    }

    if (isSecret) {
      const blockedResult = interpret(raw, context)
      const say = getBlockedSay(blockedResult)
      const blockedEntry = {
        id: `entry-${nextEntryId++}`,
        kind: 'blocked',
        say,
      }
      setEntries((prev) => [...prev, commandEntry, blockedEntry])
      if (blockedResult.action) {
        onAction(blockedResult.action)
      }
      return
    }

    const result = interpret(raw, context)

    if (result.kind === 'action') {
      const actionEntry = {
        id: `entry-${nextEntryId++}`,
        kind: 'action',
        say: result.say,
      }
      setEntries((prev) => [...prev, commandEntry, actionEntry])
      if (result.action) {
        onAction(result.action)
      }
    } else if (result.kind === 'propose') {
      const proposeEntry = {
        id: `entry-${nextEntryId++}`,
        kind: 'propose',
        say: result.say,
        action: result.action,
        status: 'pending',
      }
      setEntries((prev) => [...prev, commandEntry, proposeEntry])
    } else if (result.kind === 'ask') {
      const askEntry = {
        id: `entry-${nextEntryId++}`,
        kind: 'ask',
        say: result.say,
        options: Array.isArray(result.options) ? result.options : [],
      }
      setEntries((prev) => [...prev, commandEntry, askEntry])
    } else if (result.kind === 'blocked') {
      const say = getBlockedSay(result)
      const blockedEntry = {
        id: `entry-${nextEntryId++}`,
        kind: 'blocked',
        say,
      }
      setEntries((prev) => [...prev, commandEntry, blockedEntry])
      if (result.action) {
        onAction(result.action)
      }
    } else if (result.kind === 'unknown') {
      if (result.fallback && typeof ask === 'function') {
        const thinkingId = `entry-${nextEntryId++}`
        const thinkingEntry = {
          id: thinkingId,
          kind: 'thinking',
          say: 'Thinking...',
        }
        setEntries((prev) => [...prev, commandEntry, thinkingEntry])

        try {
          const reply = await ask(raw)
          handleAsyncReply(thinkingId, reply, result.say)
        } catch {
          setEntries((prev) =>
            prev.map((item) =>
              item.id === thinkingId
                ? {
                    id: thinkingId,
                    kind: 'unknown',
                    say: result.say,
                  }
                : item
            )
          )
        }
      } else {
        const unknownEntry = {
          id: `entry-${nextEntryId++}`,
          kind: 'unknown',
          say: result.say,
        }
        setEntries((prev) => [...prev, commandEntry, unknownEntry])
      }
    } else {
      const fallbackEntry = {
        id: `entry-${nextEntryId++}`,
        kind: 'unknown',
        say: result.say ?? 'Unknown command.',
      }
      setEntries((prev) => [...prev, commandEntry, fallbackEntry])
    }
  }

  function handleAsyncReply(targetId, reply, defaultSay) {
    if (!reply || typeof reply !== 'object') {
      setEntries((prev) =>
        prev.map((item) =>
          item.id === targetId ? { id: targetId, kind: 'unknown', say: defaultSay } : item
        )
      )
      return
    }

    if (reply.kind === 'action') {
      setEntries((prev) =>
        prev.map((item) =>
          item.id === targetId ? { id: targetId, kind: 'action', say: reply.say } : item
        )
      )
      if (reply.action) onAction(reply.action)
    } else if (reply.kind === 'propose') {
      setEntries((prev) =>
        prev.map((item) =>
          item.id === targetId
            ? {
                id: targetId,
                kind: 'propose',
                say: reply.say,
                action: reply.action,
                status: 'pending',
              }
            : item
        )
      )
    } else if (reply.kind === 'ask') {
      setEntries((prev) =>
        prev.map((item) =>
          item.id === targetId
            ? {
                id: targetId,
                kind: 'ask',
                say: reply.say,
                options: Array.isArray(reply.options) ? reply.options : [],
              }
            : item
        )
      )
    } else if (reply.kind === 'blocked') {
      setEntries((prev) =>
        prev.map((item) =>
          item.id === targetId ? { id: targetId, kind: 'blocked', say: getBlockedSay(reply) } : item
        )
      )
      if (reply.action) onAction(reply.action)
    } else {
      setEntries((prev) =>
        prev.map((item) =>
          item.id === targetId ? { id: targetId, kind: 'unknown', say: reply.say ?? defaultSay } : item
        )
      )
    }
  }

  function handleConfirm(id) {
    setEntries((prev) =>
      prev.map((item) => {
        if (item.id === id && item.status === 'pending') {
          if (item.action) onAction(item.action)
          return { ...item, status: 'confirmed' }
        }
        return item
      })
    )
  }

  function handleCancel(id) {
    setEntries((prev) =>
      prev.map((item) => {
        if (item.id === id && item.status === 'pending') {
          return { ...item, status: 'cancelled' }
        }
        return item
      })
    )
  }

  function handleSubmit(event) {
    event.preventDefault()
    processText(input)
  }

  function handleKeyDown(event) {
    if (event.key === 'ArrowUp') {
      event.preventDefault()
      const currentDraft = historyIndex === -1 ? input : draft
      if (historyIndex === -1) {
        setDraft(input)
      }
      const next = stepHistory(history, historyIndex, 'up', currentDraft)
      setHistoryIndex(next.index)
      setInput(next.value)
    } else if (event.key === 'ArrowDown') {
      event.preventDefault()
      const next = stepHistory(history, historyIndex, 'down', draft)
      setHistoryIndex(next.index)
      setInput(next.value)
    }
  }

  if (!isOpen) return null

  return (
    <aside
      ref={terminalRef}
      id="hud-assistant-terminal"
      className="mr-assistant"
      style={{ left: `${pos.x}px`, top: `${pos.y}px` }}
      aria-label="Assistant terminal"
    >
      <header className="mr-assistant-title mono" onPointerDown={handlePointerDown}>
        <span className="mr-assistant-title-text">Assistant</span>
        <button
          type="button"
          className="mr-assistant-close"
          onClick={handleClose}
          aria-label="Close assistant"
        >
          ×
        </button>
      </header>

      <div
        ref={logRef}
        className="mr-assistant-log mono"
        role="log"
        aria-live="polite"
      >
        {entries.map((entry) => {
          if (entry.kind === 'command') {
            return (
              <div
                key={entry.id}
                className={`mr-assistant-line is-command ${entry.isBlocked ? 'is-blocked' : ''}`}
              >
                <span className="mr-assistant-line-prompt">&gt; </span>
                <span className="mr-assistant-line-text">{entry.text}</span>
              </div>
            )
          }

          if (entry.kind === 'action') {
            return (
              <div key={entry.id} className="mr-assistant-line is-action">
                {entry.say}
              </div>
            )
          }

          if (entry.kind === 'propose') {
            return (
              <div key={entry.id} className="mr-assistant-card">
                <div className="mr-assistant-card-say">{entry.say}</div>
                {entry.status === 'pending' ? (
                  <div className="mr-assistant-card-actions">
                    <button
                      type="button"
                      className="mr-assistant-btn-confirm"
                      onClick={() => handleConfirm(entry.id)}
                    >
                      Confirm
                    </button>
                    <button
                      type="button"
                      className="mr-assistant-btn-cancel"
                      onClick={() => handleCancel(entry.id)}
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <div className="mr-assistant-card-status">
                    {entry.status === 'confirmed' ? 'Confirmed.' : 'Cancelled.'}
                  </div>
                )}
              </div>
            )
          }

          if (entry.kind === 'ask') {
            return (
              <div key={entry.id} className="mr-assistant-ask">
                <div className="mr-assistant-line is-ask">{entry.say}</div>
                <div className="mr-assistant-options">
                  {entry.options.map((opt, i) => (
                    <button
                      key={`${opt.text}-${i}`}
                      type="button"
                      className="mr-assistant-option-btn mono"
                      onClick={() => processText(opt.text)}
                    >
                      {opt.label || opt.text}
                    </button>
                  ))}
                </div>
              </div>
            )
          }

          if (entry.kind === 'blocked') {
            return (
              <div key={entry.id} className="mr-assistant-line is-blocked">
                {entry.say}
              </div>
            )
          }

          if (entry.kind === 'thinking') {
            return (
              <div key={entry.id} className="mr-assistant-line is-thinking">
                {entry.say}
              </div>
            )
          }

          return (
            <div key={entry.id} className="mr-assistant-line is-unknown">
              {entry.say}
            </div>
          )
        })}
      </div>

      <form onSubmit={handleSubmit} className="mr-assistant-form">
        <label htmlFor={inputId} className="mr-assistant-prompt mono">
          &gt;
        </label>
        <input
          id={inputId}
          ref={inputRef}
          type="text"
          className="mr-assistant-input mono"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          autoComplete="off"
          spellCheck="false"
          aria-label="Assistant input"
        />
      </form>
    </aside>
  )
}
