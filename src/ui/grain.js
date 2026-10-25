export const GRAIN_SIZE = 128
export const GRAIN_INTERVAL_MS = 180

export function noiseFrame(size = GRAIN_SIZE, random = Math.random) {
  const requested = Math.floor(Number(size))
  const side = Math.max(1, Number.isFinite(requested) ? requested : GRAIN_SIZE)
  const pixels = side * side
  const data = new Uint8ClampedArray(pixels * 4)
  for (let index = 0; index < pixels; index += 1) {
    const level = Math.min(1, Math.max(0, Number(random()) || 0))
    const at = index * 4
    data[at] = 255
    data[at + 1] = 255
    data[at + 2] = 255
    data[at + 3] = Math.round(level * level * 255)
  }
  return data
}

export function startGrain(node, options = {}) {
  const doc = options.doc ?? (typeof document === 'undefined' ? null : document)
  const requested = Math.floor(Number(options.size))
  const size = Math.max(1, Number.isFinite(requested) ? requested : GRAIN_SIZE)
  const interval = Math.max(16, Number(options.interval) || GRAIN_INTERVAL_MS)
  const random = options.random ?? Math.random
  const setTimer = options.setTimer ?? setInterval
  const clearTimer = options.clearTimer ?? clearInterval
  if (!node?.style || !doc || typeof doc.createElement !== 'function') return () => {}
  const canvas = doc.createElement('canvas')
  if (!canvas || typeof canvas.getContext !== 'function') return () => {}
  canvas.width = size
  canvas.height = size
  const context = canvas.getContext('2d')
  if (!context || typeof context.createImageData !== 'function' || typeof context.putImageData !== 'function') {
    return () => {}
  }
  const paint = () => {
    if (doc.visibilityState === 'hidden') return
    const frame = noiseFrame(size, random)
    const image = context.createImageData(size, size)
    image.data.set(frame)
    context.putImageData(image, 0, 0)
    node.style.backgroundImage = `url("${canvas.toDataURL('image/png')}")`
    node.style.backgroundSize = `${size}px ${size}px`
  }
  paint()
  const timer = setTimer(paint, interval)
  return () => {
    clearTimer(timer)
    node.style.backgroundImage = 'none'
  }
}
