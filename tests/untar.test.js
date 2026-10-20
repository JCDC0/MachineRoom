import { existsSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { gzipSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { untar } from '../scripts/untar.mjs'
import { makeTempDir } from './helpers/tempRoot.js'

function header({ name, size = 0, type = '0', prefix = '' }) {
  const block = Buffer.alloc(512)
  block.write(name, 0, 100, 'utf8')
  block.write('0000644\0', 100, 8, 'utf8')
  block.write('0000000\0', 108, 8, 'utf8')
  block.write('0000000\0', 116, 8, 'utf8')
  block.write(`${size.toString(8).padStart(11, '0')}\0`, 124, 12, 'utf8')
  block.write('00000000000\0', 136, 12, 'utf8')
  block.write('        ', 148, 8, 'utf8')
  block.write(type, 156, 1, 'utf8')
  block.write('ustar\0', 257, 6, 'utf8')
  block.write('00', 263, 2, 'utf8')
  if (prefix !== '') block.write(prefix, 345, 155, 'utf8')
  return block
}

function buildTar(entries) {
  const blocks = []
  for (const entry of entries) {
    const data = Buffer.from(entry.data ?? '', 'utf8')
    blocks.push(header({ ...entry, size: data.length }))
    if (data.length > 0) {
      const padded = Buffer.alloc(Math.ceil(data.length / 512) * 512)
      data.copy(padded)
      blocks.push(padded)
    }
  }
  blocks.push(Buffer.alloc(1024))
  return gzipSync(Buffer.concat(blocks))
}

function withTemp(work) {
  const base = makeTempDir('machine-room-untar-')
  try {
    return work(base)
  } finally {
    rmSync(base, { recursive: true, force: true })
  }
}

describe('untar', () => {
  it('writes a file in a folder', () => {
    withTemp((base) => {
      untar(buildTar([{ name: 'package/index.js', data: 'hello' }]), base)
      expect(readFileSync(join(base, 'package', 'index.js'), 'utf8')).toBe('hello')
    })
  })

  it('joins the prefix in front of a long name', () => {
    withTemp((base) => {
      const prefix = 'package/src/a-folder-with-a-long-name/another-folder'
      untar(buildTar([{ name: 'file.txt', prefix, data: 'long' }]), base)
      expect(readFileSync(join(base, ...prefix.split('/'), 'file.txt'), 'utf8')).toBe('long')
    })
  })

  it('skips a folder entry and keeps the files after it', () => {
    withTemp((base) => {
      untar(
        buildTar([
          { name: 'package/empty/', type: '5' },
          { name: 'package/a.txt', data: 'a' },
        ]),
        base,
      )
      expect(existsSync(join(base, 'package', 'empty'))).toBe(false)
      expect(readFileSync(join(base, 'package', 'a.txt'), 'utf8')).toBe('a')
    })
  })

  it('refuses an absolute name', () => {
    withTemp((base) => {
      expect(() => untar(buildTar([{ name: '/etc/passwd', data: 'x' }]), base)).toThrow(
        'Unsafe path in the pack: /etc/passwd',
      )
    })
  })

  it('refuses a name with a parent part', () => {
    withTemp((base) => {
      expect(() => untar(buildTar([{ name: 'package/../../evil.txt', data: 'x' }]), base)).toThrow(
        'Unsafe path in the pack: package/../../evil.txt',
      )
    })
  })
})
