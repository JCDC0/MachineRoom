import { useEffect, useRef } from 'react'

const FOCUSABLE = 'button, [href], input, select, textarea, [tabindex]'

export function focusableIn(container) {
  if (!container || typeof container.querySelectorAll !== 'function') return []
  return [...container.querySelectorAll(FOCUSABLE)].filter((element) => {
    if (!element || element.hidden === true) return false
    if (element.disabled === true) return false
    if (element.getAttribute?.('disabled') != null) return false
    if (element.getAttribute?.('tabindex') === '-1') return false
    if (element.getAttribute?.('aria-hidden') === 'true') return false
    return true
  })
}

export function useDialogFocus(open, { containerRef = null, getInitialFocus = null, openerSelector = '', trap = true } = {}) {
  const openerRef = useRef(null)

  useEffect(() => {
    if (!open || typeof document === 'undefined') return undefined
    const container = containerRef?.current ?? null
    const active = document.activeElement ?? null
    const named = openerSelector ? document.querySelector?.(`[aria-controls="${openerSelector}"]`) : null
    openerRef.current =
      openerSelector && active?.getAttribute?.('aria-controls') === openerSelector ? active : named || active
    const first = focusableIn(container)[0] ?? container
    const target = getInitialFocus?.() ?? first
    if (
      target === container &&
      container &&
      typeof container.getAttribute === 'function' &&
      container.getAttribute('tabindex') == null
    ) {
      container.setAttribute('tabindex', '-1')
    }
    if (target && typeof target.focus === 'function') target.focus()

    function onKeyDown(event) {
      if (!trap || event.key !== 'Tab') return
      const current = document.activeElement
      if (!container || typeof container.contains !== 'function') return
      const list = focusableIn(container)
      if (list.length === 0) {
        event.preventDefault()
        if (typeof container.focus === 'function') container.focus()
        return
      }
      if (!container.contains(current)) {
        event.preventDefault()
        list[0].focus()
        return
      }
      const firstItem = list[0]
      const lastItem = list[list.length - 1]
      if (event.shiftKey && current === firstItem) {
        event.preventDefault()
        lastItem.focus()
      } else if (!event.shiftKey && current === lastItem) {
        event.preventDefault()
        firstItem.focus()
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      const opener = openerRef.current
      openerRef.current = null
      if (opener && typeof opener.focus === 'function') opener.focus()
    }
  }, [open])
}
