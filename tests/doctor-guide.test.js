import { act, createElement } from 'react'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, test } from 'vitest'
import { READY_MEANS, runDoctor } from '../server/doctor.js'
import HarnessesSettings from '../src/ui/HarnessesSettings.jsx'
import { settle, withDom } from './helpers/uiDom.js'
import { makeTempDir, removeTempDir } from './helpers/tempRoot.js'

const cleanups = []

afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()()
})

function makeFolder(prefix) {
  const folder = makeTempDir(prefix)
  cleanups.push(() => removeTempDir(folder))
  return folder
}

function doctorOptions(project) {
  const dist = join(makeFolder('doctor-guide-dist-'), 'dist')
  mkdirSync(dist, { recursive: true })
  writeFileSync(join(dist, 'index.html'), '<!doctype html><title>Room</title>')
  const lanes = join(makeFolder('doctor-guide-lanes-'), 'lanes.json')
  writeFileSync(lanes, '{}')
  const runs = join(makeFolder('doctor-guide-runs-'), 'runs')
  return { projectRoot: project, dist, lanesFile: lanes, runsFolder: runs, env: process.env }
}

describe('the doctor agent guide check', () => {
  test('warns when the project has no agent guide', () => {
    const project = makeFolder('doctor-guide-bare-')
    const result = runDoctor(doctorOptions(project))

    expect(result.lines).toContain('warn The project has no agent guide (AGENTS.md, CLAUDE.md or GEMINI.md).')
  })

  test('names the agent guide it found', () => {
    const project = makeFolder('doctor-guide-agents-')
    writeFileSync(join(project, 'AGENTS.md'), '# Guide')
    const result = runDoctor(doctorOptions(project))

    expect(result.lines).toContain('ok The project has an agent guide: AGENTS.md.')
    expect(result.lines).not.toContain('warn The project has no agent guide (AGENTS.md, CLAUDE.md or GEMINI.md).')
  })
})

describe('the Ready help text', () => {
  test('Settings says what Ready checked', async () => {
    const client = {
      harnesses: async () => [{ key: 'claude', name: 'Claude Code', ready: true, enabled: true, version: '2.1.0' }],
      keys: async () => [],
      endpoints: async () => [],
    }
    await withDom(async ({ container, root }) => {
      await act(async () => {
        root.render(createElement(HarnessesSettings, { client }))
      })
      await settle()

      const help = container.querySelector('[data-harness-ready-help="true"]')
      expect(help).not.toBeNull()
      expect(help.textContent).toBe(READY_MEANS)
    })
  })
})
