export const IDLE_AFTER_MS = 60000

export const IDLE_EVENTS = ['pointermove', 'pointerdown', 'wheel', 'keydown', 'scroll', 'touchstart']

const LISTEN = { capture: true, passive: true }

export function idleAllowed({ width, scrollY, panelOpen, focusedInput, following, holding, still } = {}) {
  const w = Number(width)
  const top = Number(scrollY)
  if (!(w >= 900)) return false
  if (!(top <= 0)) return false
  if (panelOpen || focusedInput || following || holding || still) return false
  return true
}

export function stageClassName({ disconnected = false, idle = false, scrolled = false } = {}) {
  const classes = ['stage']
  if (scrolled) classes.push('is-scrolled')
  if (disconnected) classes.push('is-disconnected')
  if (idle && !disconnected) classes.push('is-idle')
  return classes.join(' ')
}

export function createIdleWatch({
  isAllowed = () => false,
  onIdle = () => {},
  target = typeof window === 'undefined' ? null : window,
  doc = typeof document === 'undefined' ? null : document,
} = {}) {
  if (!target) return { arm() {}, halt() {}, stop() {} }
  let timer = null
  let idle = false
  let paused = false

  function clear() {
    if (timer === null) return
    clearTimeout(timer)
    timer = null
  }

  function endIdle() {
    if (!idle) return
    idle = false
    onIdle(false)
  }

  function restart() {
    clear()
    if (paused || doc?.hidden) return
    timer = setTimeout(check, IDLE_AFTER_MS)
  }

  function check() {
    timer = null
    if (paused || doc?.hidden) return
    if (!isAllowed()) {
      restart()
      return
    }
    idle = true
    onIdle(true)
  }

  function wake() {
    endIdle()
    restart()
  }

  function arm() {
    paused = false
    restart()
  }

  function halt() {
    paused = true
    clear()
    endIdle()
  }

  function onVisibility() {
    if (doc?.hidden) {
      clear()
      endIdle()
      return
    }
    restart()
  }

  for (const type of IDLE_EVENTS) target.addEventListener(type, wake, LISTEN)
  doc?.addEventListener('visibilitychange', onVisibility)

  restart()

  return {
    arm,
    halt,
    stop() {
      clear()
      for (const type of IDLE_EVENTS) target.removeEventListener(type, wake, LISTEN)
      doc?.removeEventListener('visibilitychange', onVisibility)
    },
  }
}
