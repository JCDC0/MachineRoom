import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { MODES } from '../src/control/modes.js'
import { laneConfigBody, laneConfigPlan } from '../scripts/run-lane.mjs'
import { makeTempDir } from './helpers/tempRoot.js'

const cleanups = []

afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()()
})

function runsFolder() {
  const folder = makeTempDir('mr-outside-writes-')
  cleanups.push(() => rmSync(folder, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }))
  return folder
}

function configFor(mode, folder) {
  const plan = laneConfigPlan({ cli: { harness: 'opencode', mode } }, folder, `run-${mode ?? 'none'}`)
  return { plan, body: laneConfigBody(plan) }
}

describe('an OpenCode lane cannot write outside the project', () => {
  it('denies external directories in auto, edits and plan', () => {
    const folder = runsFolder()
    for (const mode of ['auto', 'edits', 'plan']) {
      const { plan, body } = configFor(mode, folder)
      expect(plan.mcpConfigPath, mode).not.toBe('')
      expect(body.permission.external_directory, mode).toBe('deny')
    }
  })

  it('keeps the mode rules beside the external directory denial', () => {
    const folder = runsFolder()
    expect(configFor('auto', folder).body.permission).toEqual({ external_directory: 'deny' })
    expect(configFor('edits', folder).body.permission).toEqual({ external_directory: 'deny', bash: 'deny' })
    expect(configFor('plan', folder).body.permission).toEqual({ external_directory: 'deny', edit: 'deny', bash: 'deny' })
  })

  it('guards a run that names no mode', () => {
    const folder = runsFolder()
    expect(configFor(undefined, folder).body.permission).toEqual({ external_directory: 'deny' })
  })

  it('merges the denial with the enabled MCP servers', () => {
    const folder = runsFolder()
    mkdirSync(folder, { recursive: true })
    writeFileSync(join(folder, 'mcp.json'), JSON.stringify({
      servers: [{ name: 'browser', transport: 'http', url: 'https://example.com/mcp', enabled: true }],
    }))
    expect(configFor('auto', folder).body).toEqual({
      mcp: { browser: { type: 'remote', url: 'https://example.com/mcp', enabled: true } },
      permission: { external_directory: 'deny' },
    })
  })

  it('writes no permission in bypass', () => {
    const folder = runsFolder()
    const { plan, body } = configFor('bypass', folder)
    expect(plan.mcpConfigPath).toBe('')
    expect(body.permission).toBeUndefined()
  })
})

describe('the mode lines', () => {
  const lines = Object.fromEntries(MODES.map((mode) => [mode.id, mode.line]))

  it('says writes stay in the project in every mode that writes', () => {
    expect(lines.edits).toContain('Writes stay in the project.')
    expect(lines.auto).toContain('Writes stay in the project.')
  })

  it('says an outside write in Ask needs the owner', () => {
    expect(lines.ask).toContain('outside write needs your Allow')
  })

  it('says Bypass can write anywhere', () => {
    expect(lines.bypass).toContain('write anywhere')
  })

  it('says Plan makes no edits', () => {
    expect(lines.plan).toContain('Makes no edits')
  })
})
