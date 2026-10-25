import { useEffect, useRef } from 'react'
import { railShareFromPointer, railStep } from './lensResize.js'

export default function LensRail({ side, label, share, multiplier, ariaLabel, valueText, onShare, onWheel }) {
  const dragRef = useRef(null)
  const railRef = useRef(null)
  const wheelRef = useRef(onWheel)
  wheelRef.current = onWheel

  useEffect(() => {
    const rail = railRef.current
    if (!rail) return undefined
    function wheel(event) {
      event.preventDefault()
      event.stopPropagation()
      wheelRef.current(event.deltaY)
    }
    rail.addEventListener('wheel', wheel, { passive: false })
    return () => rail.removeEventListener('wheel', wheel)
  }, [])
  const position = Math.min(1, Math.max(0, Number(share) || 0))

  function down(event) {
    if (event.button !== 0) return
    event.preventDefault()
    event.stopPropagation()
    const track = event.currentTarget.querySelector('.lens-rail-track')
    dragRef.current = track ? track.getBoundingClientRect() : null
    event.currentTarget.setPointerCapture?.(event.pointerId)
    if (dragRef.current) onShare(railShareFromPointer(event.clientY, dragRef.current), false)
  }

  function move(event) {
    if (!dragRef.current) return
    onShare(railShareFromPointer(event.clientY, dragRef.current), false)
  }

  function up(event) {
    if (!dragRef.current) return
    onShare(railShareFromPointer(event.clientY, dragRef.current), true)
    dragRef.current = null
    event.currentTarget.releasePointerCapture?.(event.pointerId)
  }

  function key(event) {
    const next = railStep(position, event.key)
    if (next === null) return
    event.preventDefault()
    event.stopPropagation()
    onShare(next, true)
  }

  return (
    <div
      className={`lens-rail is-${side}`}
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={up}
      ref={railRef}
    >
      <span className="lens-rail-label mono">{label}</span>
      <div
        className="lens-rail-track"
        role="slider"
        tabIndex={0}
        aria-label={ariaLabel}
        aria-orientation="vertical"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(position * 100)}
        aria-valuetext={valueText}
        onKeyDown={key}
      >
        <span className="lens-rail-fill" style={{ height: `${(position * 100).toFixed(1)}%` }} />
        <span className="lens-rail-handle" style={{ bottom: `${(position * 100).toFixed(1)}%` }} />
      </div>
      <span className="lens-rail-value mono">{multiplier}</span>
    </div>
  )
}
