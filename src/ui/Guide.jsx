import { useEffect, useRef, useState } from 'react'
import { GUIDE_STEPS, clampStep } from './guide.js'

export default function Guide({ initialStep = 0, onClose = () => {} }) {
  const [step, setStep] = useState(() => clampStep(initialStep))
  const cardRef = useRef(null)
  const actionRef = useRef(null)
  const current = GUIDE_STEPS[step]
  const last = step === GUIDE_STEPS.length - 1

  useEffect(() => {
    actionRef.current?.focus?.()
  }, [step])

  useEffect(() => {
    function onKey(event) {
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
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
  }, [onClose])

  function advance() {
    if (last) {
      onClose()
      return
    }
    setStep((value) => clampStep(value + 1))
  }

  return (
    <div className="mr-guide-backdrop">
      <section
        className="mr-guide"
        role="dialog"
        aria-modal="true"
        aria-labelledby="mr-guide-title"
        ref={cardRef}
      >
        <header className="mr-guide-head">
          <h2 className="mr-guide-title" id="mr-guide-title">
            Guide
          </h2>
          <span className="mr-guide-count mono">{`${step + 1} / ${GUIDE_STEPS.length}`}</span>
          <button type="button" className="mr-guide-skip mono" onClick={onClose}>
            Skip
          </button>
        </header>
        <p className="mr-guide-label mono">{current.label}</p>
        <p className="mr-guide-text" aria-live="polite">
          {current.text}
        </p>
        <ol className="mr-guide-dots" aria-hidden="true">
          {GUIDE_STEPS.map((item, index) => (
            <li
              key={item.label}
              className={`mr-guide-dot${index === step ? ' is-current' : ''}${
                index < step ? ' is-done' : ''
              }`}
            />
          ))}
        </ol>
        <div className="mr-guide-actions">
          <button type="button" className="mr-guide-next mono" onClick={advance} ref={actionRef}>
            {last ? 'Done' : 'Next'}
          </button>
        </div>
      </section>
    </div>
  )
}
