import { existsSync, mkdirSync, realpathSync, rmSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { cleanTempRoot, staleFolders } from './helpers/cleanTemp.js'
import { TEMP_ROOT, makeTempDir } from './helpers/tempRoot.js'

const made = []

function track(dir) {
  made.push(dir)
  return dir
}

afterAll(() => {
  for (const dir of made) rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
})

describe('makeTempDir', () => {
  it('puts the folder under the root in the process id folder', () => {
    const dir = track(makeTempDir('temp-root-'))
    expect(dirname(dir)).toBe(realpathSync.native(join(TEMP_ROOT, String(process.pid))))
    expect(existsSync(dir)).toBe(true)
    expect(basename(dir).startsWith('temp-root-')).toBe(true)
  })

  it('gives a new folder for each call', () => {
    const first = track(makeTempDir('temp-root-'))
    const second = track(makeTempDir('temp-root-'))
    expect(first).not.toBe(second)
    expect(existsSync(first)).toBe(true)
    expect(existsSync(second)).toBe(true)
  })
})

describe('staleFolders', () => {
  it('deletes the folders of dead processes and keeps the live and unreadable names', () => {
    const names = ['100', '200', 'live', 'abc', '12x', '', '-4', '0']
    const alive = (pid) => pid === 200
    expect(staleFolders(names, alive)).toEqual(['100'])
  })

  it('keeps a name whose check throws', () => {
    const alive = () => {
      throw new Error('no answer')
    }
    expect(staleFolders(['100'], alive)).toEqual([])
  })
})

describe('cleanTempRoot', () => {
  it('removes only the dead folders under the given root', () => {
    const root = track(makeTempDir('temp-root-clean-'))
    const dead = join(root, '4100')
    const live = join(root, '4200')
    const odd = join(root, 'notes')
    for (const dir of [dead, live, odd]) track(dir)
    for (const dir of [dead, live, odd]) mkdirSync(dir, { recursive: true })
    const removed = cleanTempRoot(root, (pid) => pid === 4200)
    expect(removed).toEqual(['4100'])
    expect(existsSync(dead)).toBe(false)
    expect(existsSync(live)).toBe(true)
    expect(existsSync(odd)).toBe(true)
  })
})
