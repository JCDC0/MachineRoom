import * as THREE from 'three'

export const WHITE = 0xffffff
export const YELLOW = 0xe5ff00
export const RED = 0xff2a2a
export const GREEN = 0x2aff80
export const WEB = 0x2a9dff

const RANDOM_RANGE = 4294967296
const RANDOM_STEP = 1664525
const RANDOM_OFFSET = 1013904223

const MOTION_QUERY = '(prefers-reduced-motion: reduce)'

const GLOW_SIZE = 128
const GLOW_STOPS = [
  { at: 0, color: 'rgba(255,255,255,1)' },
  { at: 0.25, color: 'rgba(255,255,255,.45)' },
  { at: 1, color: 'rgba(255,255,255,0)' },
]

const LABEL_COLOR = 'rgba(255,255,255,.55)'
const LABEL_FONT = '400 28px "Space Mono", monospace'
const LABEL_SCALE = 1.6
const LABEL_HEIGHT = 40
const LABEL_BASELINE = 30
const LABEL_PAD = 8

export function seeded(seed) {
  let state = seed
  return () => {
    state = (state * RANDOM_STEP + RANDOM_OFFSET) % RANDOM_RANGE
    return state / RANDOM_RANGE
  }
}

export function easeInOut(t) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2
}

export function easeRate(delta, speed, still = false) {
  return still ? 1 : 1 - Math.exp(-delta * speed)
}

function browserWindow() {
  return typeof window === 'undefined' ? null : window
}

export function reducedMotion(win = browserWindow()) {
  let mql = null
  let changed = null
  let listening = false

  const onChange = (event) => {
    changed = Boolean(event?.matches)
  }

  const listen = (query) => {
    if (typeof query.addEventListener === 'function') {
      query.addEventListener('change', onChange)
      return true
    }
    if (typeof query.addListener === 'function') {
      query.addListener(onChange)
      return true
    }
    return false
  }

  const release = () => {
    if (!listening || !mql) return
    if (typeof mql.removeEventListener === 'function') mql.removeEventListener('change', onChange)
    else if (typeof mql.removeListener === 'function') mql.removeListener(onChange)
    listening = false
    changed = null
  }

  try {
    if (win && typeof win.matchMedia === 'function') {
      mql = win.matchMedia(MOTION_QUERY)
      if (mql) listening = listen(mql)
    }
  } catch {
    mql = null
    listening = false
  }

  return {
    mql,
    still: () => (changed === null ? Boolean(mql?.matches) : changed),
    dispose: release,
  }
}

let shared = null
let sharedWindow
let sharedMatchMedia

export function still() {
  const win = browserWindow()
  const matchMedia = win ? win.matchMedia : null
  if (!shared || sharedWindow !== win || sharedMatchMedia !== matchMedia) {
    shared?.dispose()
    shared = reducedMotion(win)
    sharedWindow = win
    sharedMatchMedia = matchMedia
  }
  return shared.still()
}

export function disposeStill() {
  shared?.dispose()
  shared = null
  sharedWindow = undefined
  sharedMatchMedia = undefined
}

export function glowTexture() {
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = GLOW_SIZE
  const context = canvas.getContext('2d')
  const centre = GLOW_SIZE / 2
  const gradient = context.createRadialGradient(centre, centre, 0, centre, centre, centre)
  for (const stop of GLOW_STOPS) gradient.addColorStop(stop.at, stop.color)
  context.fillStyle = gradient
  context.fillRect(0, 0, GLOW_SIZE, GLOW_SIZE)
  return new THREE.CanvasTexture(canvas)
}

function labelCanvas(label, { color, background, font, spacing, pad }) {
  const canvas = document.createElement('canvas')
  const context = canvas.getContext('2d')
  const useFont = () => {
    context.font = font
    if ('letterSpacing' in context) context.letterSpacing = `${spacing}px`
  }

  useFont()
  canvas.width = Math.ceil(context.measureText(label).width) + pad * 2
  canvas.height = LABEL_HEIGHT
  if (background) {
    context.fillStyle = background
    context.fillRect(0, 0, canvas.width, canvas.height)
  }
  useFont()
  context.fillStyle = color
  context.fillText(label, pad, LABEL_BASELINE)
  return canvas
}

export function textSprite(text, {
  color = LABEL_COLOR,
  background = null,
  scale = LABEL_SCALE,
  font = LABEL_FONT,
  spacing = 0,
  pad = LABEL_PAD,
} = {}) {
  const material = new THREE.SpriteMaterial({ transparent: true, depthWrite: false })
  const sprite = new THREE.Sprite(material)
  let label = String(text ?? '')

  const draw = () => {
    const canvas = labelCanvas(label, { color, background, font, spacing, pad })
    if (material.map) material.map.dispose()
    material.map = new THREE.CanvasTexture(canvas)
    material.needsUpdate = true
    sprite.scale.set(canvas.width * scale, canvas.height * scale, 1)
  }

  draw()
  sprite.userData.redraw = draw
  sprite.userData.setText = (next) => {
    const value = String(next ?? '')
    if (value === label) return false
    label = value
    draw()
    return true
  }
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
