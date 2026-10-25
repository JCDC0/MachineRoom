import * as THREE from 'three'

export const WHITE = 0xffffff
export const YELLOW = 0xe5ff00
export const RED = 0xff2a2a
export const GREEN = 0x2aff80
export const WEB = 0x2a9dff
export const BLUE = 0x3d7bff

export function seeded(seed) {
  let state = seed
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296
    return state / 4294967296
  }
}

export function easeInOut(t) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2
}

export function easeRate(delta, speed, still = false) {
  return still ? 1 : 1 - Math.exp(-delta * speed)
}

export function reducedMotion(win = (typeof window !== 'undefined' ? window : null)) {
  let mql = null
  let fromChange = null
  let listening = false
  const onChange = (event) => {
    fromChange = Boolean(event?.matches)
  }
  try {
    if (win && typeof win.matchMedia === 'function') {
      mql = win.matchMedia('(prefers-reduced-motion: reduce)')
      if (mql && typeof mql.addEventListener === 'function') {
        mql.addEventListener('change', onChange)
        listening = true
      } else if (mql && typeof mql.addListener === 'function') {
        mql.addListener(onChange)
        listening = true
      }
    }
  } catch {
    mql = null
    listening = false
  }
  return {
    mql,
    still: () => (fromChange === null ? Boolean(mql?.matches) : fromChange),
    dispose: () => {
      if (!listening || !mql) return
      if (typeof mql.removeEventListener === 'function') mql.removeEventListener('change', onChange)
      else if (typeof mql.removeListener === 'function') mql.removeListener(onChange)
      listening = false
      fromChange = null
    },
  }
}

let defaultHelper = null
let lastWindow
let lastMatchMedia

export function still() {
  const currentWindow = typeof window !== 'undefined' ? window : null
  const currentMatchMedia = currentWindow ? currentWindow.matchMedia : null
  if (!defaultHelper || lastWindow !== currentWindow || lastMatchMedia !== currentMatchMedia) {
    defaultHelper?.dispose()
    defaultHelper = reducedMotion(currentWindow)
    lastWindow = currentWindow
    lastMatchMedia = currentMatchMedia
  }
  return defaultHelper.still()
}

export function disposeStill() {
  defaultHelper?.dispose()
  defaultHelper = null
  lastWindow = undefined
  lastMatchMedia = undefined
}

export function glowTexture() {
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = 128
  const context = canvas.getContext('2d')
  const gradient = context.createRadialGradient(64, 64, 0, 64, 64, 64)
  gradient.addColorStop(0, 'rgba(255,255,255,1)')
  gradient.addColorStop(0.25, 'rgba(255,255,255,.45)')
  gradient.addColorStop(1, 'rgba(255,255,255,0)')
  context.fillStyle = gradient
  context.fillRect(0, 0, 128, 128)
  return new THREE.CanvasTexture(canvas)
}

export function textSprite(text, {
  color = 'rgba(255,255,255,.55)',
  background = null,
  scale = 1.6,
  font = '28px "Space Mono", monospace',
  spacing = 0,
  pad = 8,
} = {}) {
  const material = new THREE.SpriteMaterial({ transparent: true, depthWrite: false })
  const sprite = new THREE.Sprite(material)

  function draw() {
    const canvas = document.createElement('canvas')
    const context = canvas.getContext('2d')
    const prepare = () => {
      context.font = font
      if ('letterSpacing' in context) context.letterSpacing = `${spacing}px`
    }
    prepare()
    canvas.width = Math.ceil(context.measureText(text).width) + pad * 2
    canvas.height = 40
    if (background) {
      context.fillStyle = background
      context.fillRect(0, 0, canvas.width, canvas.height)
    }
    prepare()
    context.fillStyle = color
    context.fillText(text, pad, 30)
    if (material.map) material.map.dispose()
    material.map = new THREE.CanvasTexture(canvas)
    material.needsUpdate = true
    sprite.scale.set(canvas.width * scale, canvas.height * scale, 1)
  }

  draw()
  sprite.userData.redraw = draw
  return sprite
}

export function lineMaterial(color, opacity) {
  return new THREE.LineBasicMaterial({
    color,
    transparent: true,
    opacity,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  })
}
