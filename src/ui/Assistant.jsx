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
  onAction,
  onAssistantAction,
  ask,
  askAssistant,
  open: controlledOpen,
  onClose,
  initialOpen = false,
  storage = (typeof window !== 'undefined' ? window.localStorage : null),
}) {
  const handleAction = onAssistantAction ?? onAction ?? (() => {})
  const handleAsk = askAssistant ?? ask ?? null

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

  const savedPosRef = useRef(null)
  const [pos, setPos] = useState(() => {
    const saved = loadAssistantPosition(storage)
    const win = typeof window !== 'undefined'
      ? { windowWidth: window.innerWidth, windowHeight: window.innerHeight }
      : { windowWidth: 1280, windowHeight: 800 }
    if (saved && Number.isFinite(saved.x) && Number.isFinite(saved.y)) {
      savedPosRef.current = { x: saved.x, y: saved.y }
      return clampPosition(saved, DEFAULT_TERMINAL_SIZE, win)
    }
    return getDefaultPosition(DEFAULT_TERMINAL_SIZE, win)
  })

  const inputId = useId()
  const terminalRef = useRef(null)
  const inputRef = useRef(null)
  const logRef = useRef(null)
  const posRef = useRef(pos)
  posRef.current = pos

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
        if (containsSecret(input)) {
          setInput('')
          setDraft('')
          setHistoryIndex(-1)
        }
        onClose?.()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [isOpen, controlledOpen, onClose, input])

  useEffect(() => {
    if (isOpen) {
      const timer = setTimeout(() => {
        inputRef.current?.focus()
      }, 20)
      if (terminalRef.current) {
        const rect = terminalRef.current.getBoundingClientRect()
        const size = {
          width: rect.width || DEFAULT_TERMINAL_SIZE.width,
          height: rect.height || DEFAULT_TERMINAL_SIZE.height,
        }
        const win = {
          windowWidth: window.innerWidth,
          windowHeight: window.innerHeight,
        }
        const saved = loadAssistantPosition(storage)
        if (saved && Number.isFinite(saved.x) && Number.isFinite(saved.y)) {
          savedPosRef.current = { x: saved.x, y: saved.y }
          setPos(clampPosition(saved, size, win))
        } else {
          savedPosRef.current = null
          setPos(getDefaultPosition(size, win))
        }
      }
      return () => clearTimeout(timer)
    }
  }, [isOpen, storage])

  useEffect(() => {
    function onResize() {
      const size = terminalRef.current
        ? {
            width: terminalRef.current.getBoundingClientRect().width || DEFAULT_TERMINAL_SIZE.width,
            height: terminalRef.current.getBoundingClientRect().height || DEFAULT_TERMINAL_SIZE.height,
          }
        : DEFAULT_TERMINAL_SIZE
      const win = {
        windowWidth: window.innerWidth,
        windowHeight: window.innerHeight,
      }
      if (savedPosRef.current) {
        setPos(clampPosition(savedPosRef.current, size, win))
      } else {
        setPos(getDefaultPosition(size, win))
      }
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
    if (containsSecret(input)) {
      setInput('')
      setDraft('')
      setHistoryIndex(-1)
    }
    onClose?.()
  }

  function handlePointerDown(event) {
    if (event.button !== undefined && event.button !== 0) return
    if (event.target?.closest?.('button')) return
    if (typeof window !== 'undefined' && window.innerWidth < 900) return
    event.preventDefault()

    const startX = event.clientX
    const startY = event.clientY
    const startPosX = posRef.current.x
    const startPosY = posRef.current.y

    function getTerminalSize() {
      if (!terminalRef.current) return DEFAULT_TERMINAL_SIZE
      const rect = terminalRef.current.getBoundingClientRect()
      return {
        width: rect.width || DEFAULT_TERMINAL_SIZE.width,
        height: rect.height || DEFAULT_TERMINAL_SIZE.height,
      }
    }

    function onPointerMove(e) {
      const dx = e.clientX - startX
      const dy = e.clientY - startY
      const size = getTerminalSize()
      const nextPos = clampPosition(
        { x: startPosX + dx, y: startPosY + dy },
        size,
        { windowWidth: window.innerWidth, windowHeight: window.innerHeight }
      )
      setPos(nextPos)
    }

    function onPointerEnd(e) {
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerup', onPointerEnd)
      window.removeEventListener('pointercancel', onPointerEnd)
      const dx = e.clientX - startX
      const dy = e.clientY - startY
      const size = getTerminalSize()
      const finalPos = clampPosition(
        { x: startPosX + dx, y: startPosY + dy },
        size,
        { windowWidth: window.innerWidth, windowHeight: window.innerHeight }
      )
      savedPosRef.current = finalPos
      setPos(finalPos)
      saveAssistantPosition(storage, finalPos)
    }

    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', onPointerEnd)
    window.addEventListener('pointercancel', onPointerEnd)
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
        handleAction(blockedResult.action)
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
        handleAction(result.action)
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
      const maskedCommandEntry = { ...commandEntry, text: BLOCKED_MASK, isBlocked: true }
      setHistory((prev) => (prev.length > 0 ? [...prev.slice(0, -1), BLOCKED_MASK] : [BLOCKED_MASK]))
      const blockedEntry = {
        id: `entry-${nextEntryId++}`,
        kind: 'blocked',
        say,
      }
      setEntries((prev) => [...prev, maskedCommandEntry, blockedEntry])
      if (result.action) {
        handleAction(result.action)
      }
    } else if (result.kind === 'unknown') {
      if (result.fallback && typeof handleAsk === 'function') {
        const thinkingId = `entry-${nextEntryId++}`
        const thinkingEntry = {
          id: thinkingId,
          kind: 'thinking',
          say: 'Thinking...',
        }
        setEntries((prev) => [...prev, commandEntry, thinkingEntry])

        try {
          const reply = await handleAsk(raw)
          handleAsyncReply(thinkingId, commandEntry.id, reply, result.say)
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

  function handleAsyncReply(targetId, cmdId, reply, defaultSay) {
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
      if (reply.action) handleAction(reply.action)
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
      setHistory((prev) => (prev.length > 0 ? [...prev.slice(0, -1), BLOCKED_MASK] : [BLOCKED_MASK]))
      setEntries((prev) =>
        prev.map((item) => {
          if (item.id === cmdId) return { ...item, text: BLOCKED_MASK, isBlocked: true }
          if (item.id === targetId) return { id: targetId, kind: 'blocked', say: getBlockedSay(reply) }
          return item
        })
      )
      if (reply.action) handleAction(reply.action)
    } else {
      setEntries((prev) =>
        prev.map((item) =>
          item.id === targetId ? { id: targetId, kind: 'unknown', say: reply.say ?? defaultSay } : item
        )
      )
    }
  }

  function handleConfirm(id) {
    const target = entries.find((item) => item.id === id && item.status === 'pending')
    if (!target) return
    if (target.action) {
      handleAction(target.action)
    }
    setEntries((prev) =>
      prev.map((item) => (item.id === id ? { ...item, status: 'confirmed' } : item))
    )
  }

  function handleCancel(id) {
    setEntries((prev) =>
      prev.map((item) =>
        item.id === id && item.status === 'pending'
          ? { ...item, status: 'cancelled' }
          : item
      )
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
      if (historyIndex === -1) return
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

          if (entry.kind === 'info') {
            return (
              <div key={entry.id} className="mr-assistant-line is-info">
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
