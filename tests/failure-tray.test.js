import { describe, expect, it } from 'vitest'
import {
  FAILURE_TRAY_LIMIT,
  addFailureActivities,
  emptyFailureTray,
  failureAge,
  failureRows,
} from '../src/ui/failureTray.js'

const NOW = Date.parse('2026-11-03T12:00:00Z')

function toolStart(id, label, at, runId = 'run-1', agent = 'opencode') {
  return { type: 'tool.start', id, label, time: at, runId, agent }
}

function toolEnd(id, ok, at, runId = 'run-1', agent = 'opencode') {
  return { type: 'tool.end', id, ok, time: at, runId, agent }
}

describe('addFailureActivities', () => {
  it('adds a failed tool call with the label its start carried', () => {
    const tray = addFailureActivities(
      emptyFailureTray(),
      [toolStart('call-1', 'shell npm test', NOW - 5000), toolEnd('call-1', false, NOW)],
      NOW
    )
    const { rows } = failureRows(tray)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      kind: 'tool',
      agent: 'opencode',
      text: 'shell npm test',
      at: NOW,
    })
  })

  it('names a failed tool call that started before this page opened', () => {
    const tray = addFailureActivities(emptyFailureTray(), [toolEnd('call-9', false, NOW)], NOW)
    expect(failureRows(tray).rows[0].text).toBe('tool call')
  })

  it('adds a failed run with its exit code', () => {
    const tray = addFailureActivities(
      emptyFailureTray(),
      [{ type: 'run.end', ok: false, error: 'exit 1', time: NOW, runId: 'run-2', agent: 'agy' }],
      NOW
    )
    const { rows } = failureRows(tray)
    expect(rows[0]).toMatchObject({ kind: 'run', agent: 'agy', text: 'exit 1' })
  })

  it('keeps only one row for a repeated failure', () => {
    let tray = addFailureActivities(emptyFailureTray(), [toolEnd('call-1', false, NOW)], NOW)
    tray = addFailureActivities(tray, [toolEnd('call-1', false, NOW + 1000)], NOW + 1000)
    expect(failureRows(tray).total).toBe(1)
    expect(failureRows(tray).rows[0].at).toBe(NOW + 1000)
  })

  it('removes a lane rows when that lane ends a run well', () => {
    const failed = [
      toolEnd('call-1', false, NOW, 'run-1', 'opencode'),
      toolEnd('call-2', false, NOW, 'run-1', 'agy'),
      { type: 'run.end', ok: false, error: 'exit 2', time: NOW, runId: 'run-3', agent: 'opencode' },
    ]
    const withFailures = addFailureActivities(emptyFailureTray(), failed, NOW)
    expect(failureRows(withFailures).total).toBe(3)
    const passed = addFailureActivities(
      withFailures,
      [{ type: 'run.end', ok: true, time: NOW + 5000, runId: 'run-4', agent: 'opencode' }],
      NOW + 5000
    )
    const { rows } = failureRows(passed)
    expect(rows).toHaveLength(1)
    expect(rows[0].agent).toBe('agy')
  })

  it('keeps no row when a tool call passes', () => {
    const tray = addFailureActivities(emptyFailureTray(), [
      toolStart('call-1', 'shell npm test', NOW),
      toolEnd('call-1', true, NOW),
    ])
    expect(failureRows(tray).rows).toEqual([])
  })
})

describe('failureRows', () => {
  it('lists the newest failure first and shows five with the rest counted', () => {
    const activities = []
    for (let index = 0; index < 8; index += 1) {
      activities.push(toolEnd(`call-${index}`, false, NOW + index, 'run-1', index % 2 ? 'agy' : 'opencode'))
    }
    const tray = addFailureActivities(emptyFailureTray(), activities, NOW)
    const shown = failureRows(tray)
    expect(shown.rows).toHaveLength(FAILURE_TRAY_LIMIT)
    expect(shown.more).toBe(3)
    expect(shown.total).toBe(8)
    expect(shown.rows[0].id).toBe('tool:run-1:call-7')
    expect(shown.rows[4].id).toBe('tool:run-1:call-3')
  })
})

describe('failureAge', () => {
  it('gives a short age word', () => {
    expect(failureAge(NOW, NOW)).toBe('just now')
    expect(failureAge(NOW - 120000, NOW)).toBe('2 min ago')
    expect(failureAge(NOW - 7200000, NOW)).toBe('2 h ago')
    expect(failureAge(NOW - 172800000, NOW)).toBe('2 d ago')
  })
})
