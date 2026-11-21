import { spawnSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'
import { AGY_QUIET_ENV, quietAgy } from '../server/quiet-agy.js'

function envAfterImport(file) {
  const env = { ...process.env }
  delete env[AGY_QUIET_ENV]
  const url = pathToFileURL(new URL(`../${file}`, import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')).href
  const script = `await import(${JSON.stringify(url)}); console.log(process.env.${AGY_QUIET_ENV} ?? 'unset')`
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], { env, encoding: 'utf8', windowsHide: true, timeout: 60000 })
  return result.stdout.trim().split(/\r?\n/).pop()
}

describe('quietAgy', () => {
  it('turns the AGY updater off when the owner has not chosen', () => {
    expect(quietAgy({})).toEqual({ [AGY_QUIET_ENV]: '1' })
  })

  it('keeps the owner\'s own choice', () => {
    expect(quietAgy({ [AGY_QUIET_ENV]: '0' })[AGY_QUIET_ENV]).toBe('0')
  })

  it('is set as the bridge and the lane runner load', () => {
    expect(envAfterImport('server/index.js')).toBe('1')
    expect(envAfterImport('scripts/run-lane.mjs')).toBe('1')
  }, 120000)
})
