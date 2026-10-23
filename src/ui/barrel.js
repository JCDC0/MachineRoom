export const BARREL_SIZE = 128

export function barrelPixels(size = BARREL_SIZE) {
  const pixels = new Uint8ClampedArray(size * size * 4)
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const nx = ((x + 0.5) / size) * 2 - 1
      const ny = ((y + 0.5) / size) * 2 - 1
      const r = Math.hypot(nx, ny)
      const pull = r < 1 ? r - 1 : 0
      const at = (y * size + x) * 4
      pixels[at] = Math.round(128 + 127 * nx * pull)
      pixels[at + 1] = Math.round(128 + 127 * ny * pull)
      pixels[at + 2] = 128
      pixels[at + 3] = 255
    }
  }
  return pixels
}

export function barrelDataUri(size = BARREL_SIZE) {
  if (typeof document === 'undefined') return ''
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const context = canvas.getContext('2d')
  if (!context) return ''
  context.putImageData(new ImageData(barrelPixels(size), size, size), 0, 0)
  return canvas.toDataURL('image/png')
}
