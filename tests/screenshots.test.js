import { spawnSync } from 'node:child_process'
import { existsSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { chromePath } from '../scripts/screenshots.mjs'
import { makeTempDir } from './helpers/tempRoot.js'

const SCRIPT = fileURLToPath(new URL('../scripts/screenshots.mjs', import.meta.url))
const env = { LOCALAPPDATA: 'C:\\Users\\<name>\\AppData\\Local' }
const shown = '%LOCALAPPDATA%\\ms-playwright'

describe('screenshots help', () => {
  it('prints the usage for --help and -h before the room check and writes no file', () => {
    const temp = makeTempDir('mr-screenshots-help-')
    const out = join(temp, 'images')
    try {
      for (const flag of ['--help', '-h']) {
        const result = spawnSync(process.execPath, [SCRIPT, flag, '--port', '1', '--out', out], {
          encoding: 'utf8',
          windowsHide: true,
        })
        expect(result.status, flag).toBe(0)
        expect(result.stdout.trim(), flag).toBe('Usage: npm run screenshots -- [--port 5180] [--out docs/images]')
        expect(result.stderr, flag).toBe('')
      }
      expect(existsSync(out)).toBe(false)
    } finally {
      rmSync(temp, { recursive: true, force: true, maxRetries: 5 })
    }
  })
})

describe('chromePath', () => {
  it('says the Playwright folder could not be read, with the folder masked and its code', () => {
    const denied = Object.assign(new Error('Access is denied.'), { code: 'EACCES' })
    expect(() =>
      chromePath({
        env,
        readFolder: () => {
          throw denied
        },
      })
    ).toThrow(`Could not read ${shown}: EACCES. Set MACHINEROOM_CHROME to the browser program.`)
  })

  it('says no Chromium was found only when the folder was read and holds none', () => {
    expect(() => chromePath({ env, readFolder: () => [] })).toThrow(
      `No Playwright Chromium found under ${shown}. Set MACHINEROOM_CHROME to its program.`
    )
  })
})
