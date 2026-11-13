import { describe, expect, it } from 'vitest'
import { chromePath } from '../scripts/screenshots.mjs'

const env = { LOCALAPPDATA: 'C:\\Users\\<name>\\AppData\\Local' }
const shown = '%LOCALAPPDATA%\\ms-playwright'

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
