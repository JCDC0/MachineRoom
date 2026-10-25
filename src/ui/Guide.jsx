import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import {
  DEFAULT_CARD_SIZE,
  DEFAULT_VIEWPORT,
  GUIDE_STEPS,
  TOUR_STEPS,
  clampStep,
  confirmCardOpen,
  connectHref,
  consumeHelpTour,
  findStepTarget,
  markGuideSeen,
  placeGuideCard,
  setTourSpeed,
  stepReady,
  stepTargetRect,
  tourRequested,
} from './guide.js'

const NOOP = () => {}
const useSafeLayoutEffect = typeof window !== 'undefined' ? useLayoutEffect : useEffect

export function clearTourUrl() {
  if (typeof window === 'undefined' || !window.location?.search) return
  const params = new URLSearchParams(window.location.search)
  if (!params.has('tour')) return
  params.delete('tour')
  const query = params.toString().replace(/\b(replay|live|connect)=(?=&|$)/g, '$1')
  window.history?.replaceState?.(null, '', `${window.location.pathname}${query ? `?${query}` : ''}`)
}

function goToConnect() {
  if (typeof window === 'undefined') return
  const href = connectHref(window.location?.pathname ?? '/')
  if (typeof window.location?.assign === 'function') window.location.assign(href)
  else if (window.location) window.location.href = href
}

function readViewport(doc) {
  const view = doc?.defaultView ?? (typeof window !== 'undefined' ? window : null)
  const width = Number(view?.innerWidth)
  const height = Number(view?.innerHeight)
  if (width > 0 && height > 0) return { width, height }
  return DEFAULT_VIEWPORT
}

export default function Guide({
  initialStep = 0,
  onClose = NOOP,
  tour = undefined,
  snapshot = undefined,
  onConnect = undefined,
  doc = undefined,
  viewport = undefined,
}) {
  const [fromHelp] = useState(() => consumeHelpTour())
  const urlTour = tourRequested()
  const isTour = Boolean(tour !== undefined ? tour : fromHelp || urlTour)
  const steps = isTour ? TOUR_STEPS : GUIDE_STEPS
  const [step, setStep] = useState(() => clampStep(initialStep, steps))
  const cardRef = useRef(null)
  const actionRef = useRef(null)
  const safeIndex = clampStep(step, steps)
  const current = steps[safeIndex]
  const last = safeIndex === steps.length - 1
  const activeDoc = doc !== undefined ? doc : typeof document !== 'undefined' ? document : null
  const [blocked, setBlocked] = useState(() => confirmCardOpen(activeDoc))

  const computeLayout = useCallback(() => {
    if (!isTour) return null
    const vp = viewport ?? readViewport(activeDoc)
    const readyNow = stepReady(current, snapshot, activeDoc, vp)
    const cardEl = cardRef.current
    const cardRect =
      cardEl && typeof cardEl.getBoundingClientRect === 'function'
        ? cardEl.getBoundingClientRect()
        : null
    const cardSize =
      cardRect && cardRect.width > 0 && cardRect.height > 0
        ? { width: cardRect.width, height: cardRect.height }
        : DEFAULT_CARD_SIZE
    const targetRect = readyNow ? stepTargetRect(activeDoc, current, vp) : null
    return {
      index: safeIndex,
      ready: readyNow,
      placement: placeGuideCard(targetRect, cardSize, vp),
    }
  }, [activeDoc, current, isTour, safeIndex, snapshot, viewport])

  const [layout, setLayout] = useState(computeLayout)

  useSafeLayoutEffect(() => {
    if (tour === true || (tour === undefined && urlTour)) setTourSpeed()
  }, [tour, urlTour])

  useSafeLayoutEffect(() => {
    if (!isTour) return
    const target = findStepTarget(activeDoc, current)
    if (target && typeof target.scrollIntoView === 'function' && target.closest?.('.hud-dock')) {
      target.scrollIntoView({ block: 'nearest' })
    }
  }, [activeDoc, current, isTour])

  useSafeLayoutEffect(() => {
    if (!isTour) return
    setBlocked(confirmCardOpen(activeDoc))
    setLayout(computeLayout())
  }, [activeDoc, computeLayout, isTour])

  useEffect(() => {
    if (!isTour) return undefined
    const update = () => {
      setBlocked(confirmCardOpen(activeDoc))
      setLayout(computeLayout())
    }
    update()
    const view = activeDoc?.defaultView ?? (typeof window !== 'undefined' ? window : null)
    if (!view || typeof view.addEventListener !== 'function') return undefined
    view.addEventListener('resize', update)
    view.addEventListener('scroll', update, true)
    const timer = setInterval(update, 250)
    return () => {
      view.removeEventListener('resize', update)
      view.removeEventListener('scroll', update, true)
      clearInterval(timer)
    }
  }, [activeDoc, computeLayout, isTour])

  useEffect(() => {
    if (!activeDoc || typeof MutationObserver === 'undefined') return undefined
    const body = activeDoc.body
    if (!body) return undefined
    const check = () => setBlocked(confirmCardOpen(activeDoc))
    const observer = new MutationObserver(check)
    observer.observe(body, { childList: true, subtree: true })
    return () => observer.disconnect()
  }, [activeDoc])

  useEffect(() => {
    actionRef.current?.focus?.()
  }, [safeIndex])

  const finishClose = useCallback(() => {
    markGuideSeen()
    if (isTour) clearTourUrl()
    onClose()
  }, [isTour, onClose])

  const handleConnect = useCallback(() => {
    markGuideSeen()
    if (isTour) clearTourUrl()
    onClose()
    if (typeof onConnect === 'function') {
      onConnect()
      return
    }
    goToConnect()
  }, [isTour, onClose, onConnect])

  useEffect(() => {
    if (typeof window === 'undefined') return undefined
    function onKey(event) {
      if (event.key === 'Escape') {
        event.preventDefault()
        finishClose()
        return
      }
      if (event.key !== 'Tab') return
      const card = cardRef.current
      if (!card) return
      const buttons = Array.from(card.querySelectorAll('button'))
      if (buttons.length === 0) return
      const first = buttons[0]
      const final = buttons[buttons.length - 1]
      const active = card.ownerDocument?.activeElement ?? null
      if (event.shiftKey && (active === first || !card.contains(active))) {
        event.preventDefault()
        final.focus()
      } else if (!event.shiftKey && (active === final || !card.contains(active))) {
        event.preventDefault()
        first.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [finishClose])

  if (blocked) return null

  const activeLayout = isTour
    ? layout && layout.index === safeIndex
      ? layout
      : computeLayout()
    : null
  const placement = activeLayout?.placement ?? null
  const ready = isTour ? Boolean(activeLayout?.ready) : true

  function advance() {
    if (last) {
      finishClose()
      return
    }
    setStep((value) => clampStep(value + 1, steps))
  }

  return (
    <div className={`mr-guide-backdrop${isTour ? ' is-tour' : ''}`}>
      {isTour && placement?.outline && (
        <div
          className="mr-guide-outline"
          aria-hidden="true"
          style={{
            left: `${placement.outline.left}px`,
            top: `${placement.outline.top}px`,
            width: `${placement.outline.width}px`,
            height: `${placement.outline.height}px`,
          }}
        />
      )}
      <section
        className={`mr-guide${
          isTour ? ` is-tour${placement?.centered ? ' is-centered' : ' is-placed'}` : ''
        }`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="mr-guide-title"
        data-selector={isTour ? current.selector : undefined}
        style={
          isTour && placement && !placement.centered
            ? { left: `${placement.left}px`, top: `${placement.top}px` }
            : undefined
        }
        ref={cardRef}
      >
        <header className="mr-guide-head">
          <h2 className="mr-guide-title" id="mr-guide-title">
            Guide
          </h2>
          <span className="mr-guide-count mono">{`${safeIndex + 1} / ${steps.length}`}</span>
          <button type="button" className="mr-guide-skip mono" onClick={finishClose}>
            Skip
          </button>
        </header>
        <p className="mr-guide-label mono">{current.label}</p>
        <p className="mr-guide-text" aria-live="polite">
          {current.text}
        </p>
        {isTour && !ready && current.waitText && (
          <p className="mr-guide-wait mono" role="status">
            {current.waitText}
          </p>
        )}
        <ol className="mr-guide-dots" aria-hidden="true">
          {steps.map((item, index) => (
            <li
              key={item.label}
              className={`mr-guide-dot${index === safeIndex ? ' is-current' : ''}${
                index < safeIndex ? ' is-done' : ''
              }`}
            />
          ))}
        </ol>
        <div className="mr-guide-actions">
          {isTour && last ? (
            <>
              <button type="button" className="mr-guide-secondary mono" onClick={finishClose}>
                Keep watching
              </button>
              <button
                type="button"
                className="mr-guide-next mono"
                onClick={handleConnect}
                ref={actionRef}
              >
                Connect to my project
              </button>
            </>
          ) : (
            <button type="button" className="mr-guide-next mono" onClick={advance} ref={actionRef}>
              {last ? 'Done' : 'Next'}
            </button>
          )}
        </div>
      </section>
    </div>
  )
}
