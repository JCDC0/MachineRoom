import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, join } from 'node:path'
import { gunzipSync } from 'node:zlib'

const BLOCK = 512

function text(block, offset, length) {
  const slice = block.subarray(offset, offset + length)
  const end = slice.indexOf(0)
  const cut = end === -1 ? slice.length : end
  return slice.subarray(0, cut).toString('utf8').trim()
}

function octal(block, offset, length) {
  const value = text(block, offset, length).replace(/[^0-7]/g, '')
  if (value === '') return 0
  return Number.parseInt(value, 8)
}

function isUnsafe(full, parts) {
  if (isAbsolute(full)) return true
  if (/^[A-Za-z]:/.test(full)) return true
  return parts.includes('..')
}

export function untar(gzipBuffer, destination) {
  const tar = gunzipSync(gzipBuffer)
  let offset = 0
  while (offset + BLOCK <= tar.length) {
    const header = tar.subarray(offset, offset + BLOCK)
    if (header.every((byte) => byte === 0)) break
    const name = text(header, 0, 100)
    const prefix = text(header, 345, 155)
    const type = header[156]
    const size = octal(header, 124, 12)
    const next = offset + BLOCK + Math.ceil(size / BLOCK) * BLOCK
    const full = prefix === '' ? name : `${prefix}/${name}`
    if (full !== '') {
      const parts = full.split(/[\\/]/)
      if (isUnsafe(full, parts)) throw new Error(`Unsafe path in the pack: ${full}`)
      const target = join(destination, ...parts.filter((part) => part !== '' && part !== '.'))
      if (type === 0 || type === 0x30) {
        mkdirSync(dirname(target), { recursive: true })
        writeFileSync(target, tar.subarray(offset + BLOCK, offset + BLOCK + size))
      }
    }
    offset = next
  }
}
