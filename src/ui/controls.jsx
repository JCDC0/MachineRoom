import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { focusableIn } from './dialogFocus.js'

export function Chip({ label, value, open, disabled, options, onChange, className = '', ...props }) {
  const classNames = `ui-chip ${className}`.trimEnd()
  if (options) {
    const selected = options.find((option) => String(option.value) === String(value))
      ?? options.find((option) => !option.disabled)
    return (
      <span className={`${classNames} ui-chip-select`}>
        <span className="ui-chip-label" aria-hidden="true">{label}</span>
        <span className="ui-chip-value" aria-hidden="true">{selected?.label}</span>
        <span className="ui-chip-chevron" aria-hidden="true" />
        <select {...props} aria-label={label} value={value} disabled={disabled}
          onChange={(event) => onChange?.(event.target.value)}>
          {options.map((option) => (
            <option key={option.value} value={option.value} disabled={option.disabled}>{option.label}</option>
          ))}
        </select>
      </span>
    )
  }
  return (
    <button {...props} className={classNames} type="button" aria-expanded={open} disabled={disabled}>
      <span className="ui-chip-label">{label}</span>
      {value != null && <span className="ui-chip-value">{value}</span>}
      {open != null && <span className="ui-chip-chevron" aria-hidden="true" />}
    </button>
  )
}

export function IconButton({ label, icon, disabled, className = '', ...props }) {
  return (
    <button {...props} className={`ui-icon-btn ${className}`.trimEnd()} type="button"
      aria-label={label} title={label} disabled={disabled}>
      <span className="ui-icon" aria-hidden="true">{icon}</span>
    </button>
  )
}

export function Switch({ label, checked = false, disabled, showLabel = true, onChange, ...props }) {
  return (
    <button {...props} className="ui-switch" type="button" role="switch" aria-label={label}
      aria-checked={checked} disabled={disabled} onClick={(event) => onChange?.(!checked, event)}>
      <span className="ui-switch-track" aria-hidden="true" />
      {showLabel && label}
    </button>
  )
}

function usePopupPosition(open, anchorRef, popupRef, beside = false) {
  useLayoutEffect(() => {
    if (!open) return
    const anchor = anchorRef.current
    const popup = popupRef.current
    const view = anchor.ownerDocument.defaultView
    const edge = 8
    function place() {
      const rect = anchor.getBoundingClientRect()
      popup.style.maxHeight = ''
      let { width, height } = popup.getBoundingClientRect()
      const end = view.innerWidth - edge
      const bottom = view.innerHeight - edge
      let x = beside ? rect.left : rect.right - width
      let y = rect.top
      if (beside && rect.right + width <= end) {
        x = rect.right
      } else if (beside && rect.left - width >= edge) {
        x = rect.left - width
      } else {
        const gap = beside ? 0 : 4
        const below = bottom - rect.bottom - gap
        const above = rect.top - edge - gap
        const flip = height > below && above > below
        const room = Math.max(0, Math.min(bottom - edge, flip ? above : below))
        if (height > room) {
          popup.style.maxHeight = `${room}px`
          width = popup.getBoundingClientRect().width
          height = room
          if (!beside) x = rect.right - width
        }
        y = flip ? rect.top - gap - height : rect.bottom + gap
      }
      popup.style.left = `${Math.max(edge, Math.min(end - width, x))}px`
      popup.style.top = `${Math.max(edge, Math.min(bottom - height, y))}px`
    }
    place()
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(place) : null
    observer?.observe(anchor)
    observer?.observe(popup)
    view.addEventListener('resize', place)
    view.addEventListener('scroll', place, true)
    return () => {
      observer?.disconnect()
      view.removeEventListener('resize', place)
      view.removeEventListener('scroll', place, true)
    }
  }, [open, anchorRef, popupRef, beside])
}

export function Menu({ label, items, open, onOpenChange, disabled }) {
  const [localOpen, setLocalOpen] = useState(false)
  const expanded = !disabled && (open ?? localOpen)
  const id = useId()
  const trigger = useRef(null)
  const menu = useRef(null)
  const startAtEnd = useRef(false)
  usePopupPosition(expanded, trigger, menu)

  function changeOpen(next) {
    if (open == null) setLocalOpen(next)
    onOpenChange?.(next)
  }

  function closeToTrigger() {
    trigger.current.focus()
    changeOpen(false)
  }

  useLayoutEffect(() => {
    if (!expanded) return
    const entries = focusableIn(menu.current)
    const first = entries.at(startAtEnd.current ? -1 : 0) ?? menu.current
    first.focus()
    startAtEnd.current = false
  }, [expanded])

  useEffect(() => {
    if (!expanded) return
    const anchor = trigger.current
    const popup = menu.current
    const view = anchor.ownerDocument.defaultView
    function outside(event) {
      if (!anchor.contains(event.target) && !popup.contains(event.target)) changeOpen(false)
    }
    view.addEventListener('click', outside, true)
    return () => view.removeEventListener('click', outside, true)
  }, [expanded, open, onOpenChange])

  function moveFocus(event) {
    if (event.key === 'Tab') {
      closeToTrigger()
      return
    }
    if (!['Escape', 'ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
    event.preventDefault()
    event.stopPropagation()
    if (event.key === 'Escape') {
      closeToTrigger()
      return
    }
    const entries = focusableIn(menu.current)
    if (!entries.length) return
    const index = entries.indexOf(menu.current.ownerDocument.activeElement)
    let next = 0
    if (event.key === 'End') next = entries.length - 1
    if (event.key === 'ArrowDown') next = (index + 1) % entries.length
    if (event.key === 'ArrowUp') next = index > 0 ? index - 1 : entries.length - 1
    entries[next].focus()
  }

  return (
    <>
      <IconButton ref={trigger} label={label} icon={<span className="ui-kebab" />} disabled={disabled}
        aria-haspopup="menu" aria-expanded={expanded} aria-controls={expanded ? id : undefined}
        onClick={(event) => {
          event.stopPropagation()
          startAtEnd.current = false
          changeOpen(!expanded)
        }}
        onKeyDown={(event) => {
          if (expanded || !['ArrowDown', 'ArrowUp'].includes(event.key)) return
          event.preventDefault()
          event.stopPropagation()
          startAtEnd.current = event.key === 'ArrowUp'
          changeOpen(true)
        }}
      />
      {expanded && typeof document !== 'undefined' && createPortal(
        <div ref={menu} id={id} className="ui-menu" role="menu" aria-label={label} tabIndex={-1}
          onKeyDown={moveFocus} onClick={(event) => event.stopPropagation()}>
          {items.map(({ id, label, icon, disabled, danger, checked, onSelect }) => (
            <button key={id ?? label} type="button" role={checked == null ? 'menuitem' : 'menuitemcheckbox'}
              aria-checked={checked} className={`ui-menu-item${danger ? ' is-danger' : ''}`} disabled={disabled}
              onClick={(event) => {
                closeToTrigger()
                onSelect?.(event)
              }}>
              {icon && <span className="ui-icon" aria-hidden="true">{icon}</span>}
              <span className="ui-menu-item-label">{label}</span>
            </button>
          ))}
        </div>,
        document.body,
      )}
    </>
  )
}

export function Row({ label, detail, detailTitle, leading, trailing, selected, className = '', ...props }) {
  const title = detailTitle ?? (typeof detail === 'string' ? detail : undefined)
  return (
    <div {...props} className={`ui-row${selected ? ' is-selected' : ''} ${className}`.trimEnd()}>
      {leading}
      <div className="ui-row-main">
        <div className="ui-row-label">{label}</div>
        {detail != null && <div className="ui-row-detail" title={title}>{detail}</div>}
      </div>
      {trailing && <div className="ui-row-trailing">{trailing}</div>}
    </div>
  )
}

export function HoverCard({ title, details = [], dismissKey = 0, children }) {
  const [visible, setVisible] = useState(false)
  const id = useId()
  const anchor = useRef(null)
  const card = useRef(null)
  const timer = useRef(null)
  const hovered = useRef(false)
  const lastDismiss = useRef(dismissKey)
  usePopupPosition(visible, anchor, card, true)

  useEffect(() => {
    if (dismissKey === lastDismiss.current) return
    lastDismiss.current = dismissKey
    hovered.current = false
    clearTimeout(timer.current)
    setVisible(false)
  }, [dismissKey])

  function enter() {
    hovered.current = true
    clearTimeout(timer.current)
    if (!visible) timer.current = setTimeout(() => setVisible(true), 500)
  }

  function leave() {
    hovered.current = false
    clearTimeout(timer.current)
    timer.current = setTimeout(() => {
      if (!anchor.current.contains(anchor.current.ownerDocument.activeElement)) setVisible(false)
    }, 100)
  }

  useEffect(() => () => clearTimeout(timer.current), [])
  useEffect(() => {
    if (!visible) return
    const view = anchor.current.ownerDocument.defaultView
    function dismiss(event) {
      if (event.key === 'Escape') setVisible(false)
    }
    view.addEventListener('keydown', dismiss)
    return () => view.removeEventListener('keydown', dismiss)
  }, [visible])

  function detailRows() {
    const list = typeof details === 'function' ? details() : details
    return (Array.isArray(list) ? list : []).slice(0, 5).map((detail, index) => <div key={index}>{detail}</div>)
  }

  return (
    <>
      <div ref={anchor} tabIndex={0} className="ui-hover-anchor" aria-describedby={id}
        onPointerEnter={enter} onPointerLeave={leave}
        onFocus={(event) => {
          if (!event.currentTarget.contains(event.target)) return
          clearTimeout(timer.current)
          setVisible(true)
        }}
        onBlur={(event) => {
          if (event.currentTarget.contains(event.relatedTarget) || hovered.current) return
          clearTimeout(timer.current)
          setVisible(false)
        }}>
        {children}
      </div>
      {typeof document !== 'undefined' && createPortal(
        <div ref={card} className="ui-hovercard" id={id} role="tooltip" hidden={!visible}
          onPointerEnter={enter} onPointerLeave={leave}>
          <div className="ui-hovercard-title">{title}</div>
          {detailRows()}
        </div>,
        document.body,
      )}
    </>
  )
}
