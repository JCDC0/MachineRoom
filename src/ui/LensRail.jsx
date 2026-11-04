import { useEffect, useRef, useState } from 'react'
import { railShareFromPointer, railStep } from './lensResize.js'

export const RAIL_REACH = 64
export const RAIL_WHEEL_HOLD_MS = 1000

export function railNear(x, rect, side, reach = RAIL_REACH) {
  if (side !== 'left' && side !== 'right') return false
  const point = Number(x)
  const gap = Number(reach)
  const edge = Number(side === 'left' ? rect?.left : rect?.right)
  if (!Number.isFinite(point) || !Number.isFinite(edge) || !Number.isFinite(gap) || gap < 0) return false
  return Math.abs(point - edge) <= gap
}

function lensAround(node) {
  let current = node?.parentNode
  while (current) {
    if (current.nodeType === 1 && String(current.className).split(/\s+/).includes('lens')) return current
    current = current.parentNode
  }
  return null
}

export default function LensRail({ side, label, share, multiplier, ariaLabel, valueText, onShare, onWheel }) {
  const dragRef = useRef(null)
  const railRef = useRef(null)
  const wheelRef = useRef(onWheel)
  const hotTimer = useRef(null)
  const [near, setNear] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [hot, setHot] = useState(false)
  wheelRef.current = onWheel

  useEffect(() => {
    const rail = railRef.current
    const lens = lensAround(rail)
    if (!lens) return undefined
    function move(event) {
      setNear(railNear(event.clientX, lens.getBoundingClientRect(), side))
    }
    lens.addEventListener('pointermove', move)
    return () => lens.removeEventListener('pointermove', move)
  }, [side])

  useEffect(() => {
    const rail = railRef.current
    if (!rail) return undefined
    function wheel(event) {
      event.preventDefault()
      event.stopPropagation()
      wheelRef.current(event.deltaY)
      setHot(true)
      if (hotTimer.current) clearTimeout(hotTimer.current)
      hotTimer.current = setTimeout(() => setHot(false), RAIL_WHEEL_HOLD_MS)
    }
    rail.addEventListener('wheel', wheel, { passive: false })
    return () => {
      rail.removeEventListener('wheel', wheel)
      if (hotTimer.current) clearTimeout(hotTimer.current)
    }
  }, [])
  const position = Math.min(1, Math.max(0, Number(share) || 0))
  const shown = near || dragging || hot

  function down(event) {
    if (event.button !== 0) return
    event.preventDefault()
    event.stopPropagation()
    const track = event.currentTarget.querySelector('.lens-rail-track')
    dragRef.current = track ? track.getBoundingClientRect() : null
    if (!dragRef.current) return
    setDragging(true)
    event.currentTarget.setPointerCapture?.(event.pointerId)
    onShare(railShareFromPointer(event.clientY, dragRef.current), false)
  }

  function move(event) {
    if (!dragRef.current) return
    onShare(railShareFromPointer(event.clientY, dragRef.current), false)
  }

  function up(event) {
    if (!dragRef.current) return
    onShare(railShareFromPointer(event.clientY, dragRef.current), true)
    dragRef.current = null
    setDragging(false)
    event.currentTarget.releasePointerCapture?.(event.pointerId)
  }

  function lost() {
    if (!dragRef.current) return
    dragRef.current = null
    setDragging(false)
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
      className={`lens-rail is-${side}${shown ? ' is-shown' : ''}`}
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={up}
      onLostPointerCapture={lost}
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
