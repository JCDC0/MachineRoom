export const RADIAL_MAP_SIZE = 256
export const ABERRATION_MAX_PX = 12
export const ABERRATION_REACH = 2.5

const mapUrls = new Map()

export function radialMapValue(x, y) {
  const distance = Math.hypot(x, y)
  if (!(distance > 0)) return { r: 127.5, g: 127.5, radius: 0 }
  const radius = Math.min(1, distance)
  return {
    r: 127.5 + (x / distance) * radius * 127.5,
    g: 127.5 + (y / distance) * radius * 127.5,
    radius,
  }
}

export function radialMapPixels(size = RADIAL_MAP_SIZE) {
  const requested = Math.floor(Number(size))
  const side = Math.max(2, Number.isFinite(requested) ? requested : RADIAL_MAP_SIZE)
  const half = side / 2
  const data = new Uint8ClampedArray(side * side * 4)
  for (let y = 0; y < side; y += 1) {
    for (let x = 0; x < side; x += 1) {
      const value = radialMapValue((x + 0.5 - half) / half, (y + 0.5 - half) / half)
      const at = (y * side + x) * 4
      data[at] = Math.round(value.r)
      data[at + 1] = Math.round(value.g)
      data[at + 2] = 0
      data[at + 3] = 255
    }
  }
  return { size: side, data }
}

export function mapPlacement({ width = 0, height = 0, centerX = 0, centerY = 0, radius = 0, limit = 2 } = {}) {
  const regionWidth = Number.isFinite(Number(width)) && Number(width) > 0 ? Number(width) : 0
  const regionHeight = Number.isFinite(Number(height)) && Number(height) > 0 ? Number(height) : 0
  const x = Number.isFinite(Number(centerX)) ? Number(centerX) : 0
  const y = Number.isFinite(Number(centerY)) ? Number(centerY) : 0
  if (!(regionWidth > 0) || !(regionHeight > 0)) {
    return {
      x: x - RADIAL_MAP_SIZE / 2,
      y: y - RADIAL_MAP_SIZE / 2,
      width: RADIAL_MAP_SIZE,
      height: RADIAL_MAP_SIZE,
    }
  }
  const ring = Number.isFinite(Number(radius)) && Number(radius) > 0 ? Number(radius) : 0
  const far = Math.max(
    Math.hypot(x, y),
    Math.hypot(regionWidth - x, y),
    Math.hypot(x, regionHeight - y),
    Math.hypot(regionWidth - x, regionHeight - y)
  )
  if (!(ring > 0)) {
    const side = far * 2
    return { x: x - side / 2, y: y - side / 2, width: side, height: side }
  }
  const ratio = Number.isFinite(Number(limit)) && Number(limit) > 0 ? Number(limit) : 2
  const side = Math.min(
    Math.max(ring * ABERRATION_REACH * 2, far * 2),
    Math.hypot(regionWidth, regionHeight) * ratio
  )
  return {
    x: coverAxis(x, side, regionWidth) - side / 2,
    y: coverAxis(y, side, regionHeight) - side / 2,
    width: side,
    height: side,
  }
}

function coverAxis(center, side, length) {
  const low = length - side / 2
  const high = side / 2
  if (!(low <= high)) return length / 2
  return Math.min(high, Math.max(low, center))
}

export function aberrationChannels(strength) {
  const amount = Math.min(1, Math.max(0, Number(strength) || 0))
  const scale = Math.round(amount * ABERRATION_MAX_PX * 10) / 10
  return { red: scale > 0 ? -scale : 0, green: 0, blue: scale }
}

export function radialMapDataUrl(doc = typeof document === 'undefined' ? null : document, size = RADIAL_MAP_SIZE) {
  const requested = Math.floor(Number(size))
  const side = Math.max(2, Number.isFinite(requested) ? requested : RADIAL_MAP_SIZE)
  if (mapUrls.has(side)) return mapUrls.get(side)
  if (!doc || typeof doc.createElement !== 'function') return ''
  const canvas = doc.createElement('canvas')
  if (!canvas || typeof canvas.getContext !== 'function') return ''
  canvas.width = side
  canvas.height = side
  const context = canvas.getContext('2d')
  if (!context || typeof context.createImageData !== 'function' || typeof context.putImageData !== 'function') return ''
  const frame = radialMapPixels(side)
  const image = context.createImageData(side, side)
  image.data.set(frame.data)
  context.putImageData(image, 0, 0)
  if (typeof canvas.toDataURL !== 'function') return ''
  let url = ''
  try {
    url = canvas.toDataURL('image/png')
  } catch {
    return ''
  }
  if (url) mapUrls.set(side, url)
  return url
}
