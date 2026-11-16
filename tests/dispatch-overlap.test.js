import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { act, createElement } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { briefFileList } from '../src/briefs/briefs.js'
import { overlappingLanes } from '../src/briefs/plan.js'
import { harnessStatus, readHarnessSettings, saveHarnessSettings, updateHarnessSettings } from '../server/harness-settings.js'
import HarnessesSettings from '../src/ui/HarnessesSettings.jsx'
import DispatchPanel from '../src/ui/panels/DispatchPanel.jsx'
import { clearSplitRun, laneCountWarningLine, overlapCardLines, runningLaneFiles } from '../src/ui/panels/runs.js'
import { buttonWithText, settle, type, withDom } from './helpers/uiDom.js'

const dirs = []
function setupDir() {
  const dir = mkdtempSync(join(tmpdir(), 'mr-dispatch-overlap-'))
  dirs.push(dir)
  return dir
}

afterEach(() => {
  vi.useRealTimers()
  clearSplitRun()
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('overlappingLanes', () => {
  it('finds two briefs that declare the same file', () => {
    const first = 'Start the room.\n\nFiles: `src/briefs/plan.js`, `src/ui/panels/runs.js`.'
    const second = 'Warn about work.\n\nFiles: `src\\briefs\\plan.js`.'
    const active = runningLaneFiles([{ lane: 'opencode2', task: second }], [])

    expect(overlappingLanes({ files: briefFileList(first), active })).toEqual([
      { lane: 'opencode2', files: ['src/briefs/plan.js'] },
    ])
  })

  it('matches a case and slash difference on Windows', () => {
    if (process.platform !== 'win32') return
    const active = [{ lane: 'opencode3', files: ['SRC\\Briefs\\Plan.js'] }]

    expect(overlappingLanes({ files: ['src/briefs/plan.js'], active })).toEqual([
      { lane: 'opencode3', files: ['src/briefs/plan.js'] },
    ])
  })

  it('calls a free-text task unknown and says so on the card', () => {
    const active = [{ lane: 'opencode', files: ['src/ui/panels/runs.js'] }]

    expect(overlappingLanes({ files: 'Move the button.', active })).toBe('unknown')
    expect(
      overlapCardLines({
        files: 'Move the button.',
        active,
        runningCount: 1,
        startingCount: 1,
        laneCountWarning: 0,
      })
    ).toContain('Overlap unknown: this task names no files.')
  })

  it('adds the lane count only above the set threshold', () => {
    expect(laneCountWarningLine({ runningCount: 2, startingCount: 1, laneCountWarning: 3 })).toBe('')
    expect(laneCountWarningLine({ runningCount: 3, startingCount: 1, laneCountWarning: 4 })).toBe('')
    expect(laneCountWarningLine({ runningCount: 3, startingCount: 1, laneCountWarning: 3 })).toBe(
      '4 lanes will be running.'
    )
    expect(laneCountWarningLine({ runningCount: 4, startingCount: 1, laneCountWarning: 3 })).toBe(
      '5 lanes will be running.'
    )
    expect(
      overlapCardLines({ files: ['src/a.js'], active: [], runningCount: 2, startingCount: 1, laneCountWarning: 0 })
    ).toEqual(['2 lanes are running now.'])
    expect(
      overlapCardLines({ files: ['src/a.js'], active: [], runningCount: 2, startingCount: 1, laneCountWarning: 2 })
    ).toEqual(['2 lanes are running now.', '3 lanes will be running.'])
  })
})

describe('lane count warning setting', () => {
  it('keeps a whole number and refuses anything else', () => {
    const dir = setupDir()

    expect(readHarnessSettings(dir).laneCountWarning).toBe(0)
    expect(updateHarnessSettings(dir, { laneCountWarning: 3 })).toBe('')
    expect(readHarnessSettings(dir).laneCountWarning).toBe(3)
    expect(updateHarnessSettings(dir, { laneCountWarning: -1 })).toBe(
      'Write the lane count warning as a whole number, 0 or more.'
    )
    expect(updateHarnessSettings(dir, { laneCountWarning: 1.5 })).toBe(
      'Write the lane count warning as a whole number, 0 or more.'
    )
    expect(readHarnessSettings(dir).laneCountWarning).toBe(3)
  })

  it('lists the saved count on the harness rows Settings reads', async () => {
    const dir = setupDir()
    saveHarnessSettings(dir, { programs: {}, off: [], laneCountWarning: 2 })

    const row = await harnessStatus('machineroom', { runsFolder: dir, lanes: {}, env: {}, available: true })

    expect(row.laneCountWarning).toBe(2)
  })

  it('saves the lane count warning from Settings', async () => {
    const rows = [
      {
        key: 'claude',
        name: 'Claude Code',
        available: true,
        ready: true,
        enabled: true,
        program: 'claude',
        version: '1.0',
        reason: '',
        laneCountWarning: 2,
      },
    ]
    const client = {
      harnesses: vi.fn().mockResolvedValue(rows),
      harnessSettings: vi.fn().mockImplementation(async (body) => [
        { ...rows[0], laneCountWarning: body.laneCountWarning },
      ]),
      keys: vi.fn().mockResolvedValue([]),
      endpoints: vi.fn().mockResolvedValue([]),
      subscribe: vi.fn().mockReturnValue(() => {}),
    }

    await withDom(async ({ container, root }) => {
      await act(async () => {
        root.render(createElement(HarnessesSettings, { client }))
      })
      await settle(20)

      const input = container.querySelector('#harness-lane-count-warning')
      expect(input.value).toBe('2')
      await type(root, input, '3')
      await act(async () => {
        buttonWithText(container, 'Save').click()
      })
      await settle()

      expect(client.harnessSettings).toHaveBeenCalledWith({ laneCountWarning: 3, confirmed: true })
    })
  })
})

const AGENTS = [
  { id: 'agent-beta', key: 'beta', name: 'Beta', adapterType: 'opencode_local', role: null },
  { id: 'agent-opencode', key: 'opencode', name: 'OpenCode', adapterType: 'opencode_local', role: null },
]

function makeClient() {
  return {
    health: async () => ({ lanes: true }),
    agents: async () => AGENTS,
    runs: async () => ({
      running: [
        {
          lane: 'beta',
          briefs: [],
          startedAt: '2026-11-16T10:00:00Z',
          lastLines: [],
          task: 'Other.\n\nFiles: `src/ui/panels/runs.js`.',
        },
      ],
      recent: [],
      project: 'demo',
    }),
    harnesses: async () => [{ key: 'opencode', laneCountWarning: 1 }],
    routeLane: async () => ({ lane: 'opencode', tier: 'small', reason: 'The small tier runs opencode.', skipped: [] }),
    startRun: async () => ({ lane: 'opencode' }),
  }
}

async function typeInto(node, text) {
  await act(async () => {
    node.focus()
    node.dispatchEvent({ type: 'focusin', bubbles: true, cancelable: true })
    node.value = text
    node.dispatchEvent({ type: 'keyup', bubbles: true, cancelable: true })
  })
}

describe('DispatchPanel overlap warning', () => {
  it('names the running lane, the shared files, the running count and the next count', async () => {
    vi.useFakeTimers()
    const client = makeClient()
    await withDom(async ({ container, root }) => {
      await act(async () => {
        root.render(createElement(DispatchPanel, { client, initialAgents: AGENTS }))
      })
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0)
      })

      await typeInto(container.querySelector('#project-run-task'), 'Mine.\n\nFiles: `src/ui/panels/runs.js`.')
      await act(async () => {
        await vi.advanceTimersByTimeAsync(400)
      })
      await act(async () => {
        buttonWithText(container, 'Run').click()
      })

      expect(container.textContent).toContain('Also declared by beta: src/ui/panels/runs.js')
      expect(container.textContent).toContain('1 lane is running now.')
      expect(container.textContent).toContain('2 lanes will be running.')
    })
  })
})
