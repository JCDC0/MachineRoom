import { act, createElement } from 'react'
import { describe, expect, it } from 'vitest'
import OrchestratorChat from '../src/ui/OrchestratorChat.jsx'
import { roomNoticeSummary } from '../src/ui/roomNotice.js'
import { buttonWithText, click, withDom } from './helpers/uiDom.js'

const success = 'Run codex2-P536-20261118-012152 on lane codex2 ended: succeeded.\nlane codex2 | briefs P536, P537 | exit 0 | branch feat/test | commits a2d359be 0.1.402: Fix the rail; b1234567 0.1.403: Next | cost not reported'
const failed = 'Run test on lane codex2 ended: failed.\nlane codex2 | briefs P536 | exit 1 | branch feat/test | commits none | cost not reported\nError: failed'

describe('run-end room notices', () => {
  it('summarizes the first commit', () => {
    expect(roomNoticeSummary(success)).toEqual({ lane: 'codex2', briefs: 'P536, P537', status: 'succeeded', subject: 'Fix the rail' })
  })
  it('summarizes a failure without commits', () => {
    expect(roomNoticeSummary(failed)).toEqual({ lane: 'codex2', briefs: 'P536', status: 'failed', subject: null })
  })
  it('summarizes a stopped run without a record', () => {
    expect(roomNoticeSummary('Run test on lane codex2 ended: stopped.')).toEqual({ lane: 'codex2', briefs: null, status: 'stopped', subject: null })
  })
  it('leaves other text alone', () => {
    expect(roomNoticeSummary('The room is ready.')).toBeNull()
  })
  it('folds the full message behind Details', async () => {
    const client = {
      orchestrator: async () => ({ state: 'idle', messages: [{ id: 'r1', from: 'room', text: success }, { id: 'r2', from: 'room', text: 'The room is ready.' }] }),
      orchestrators: async () => [],
      subscribe: () => () => {},
    }
    await withDom(async ({ container, root }) => {
      await act(async () => { root.render(createElement(OrchestratorChat, { client, open: true })) })
      await act(async () => {})
      const row = container.querySelector('.mr-orch-line.is-run-notice')
      const summary = row.querySelector('.mr-orch-run-summary')
      expect(summary.textContent).toContain('codex2')
      expect(summary.textContent).toContain('P536, P537')
      expect(summary.textContent).toContain('succeeded')
      expect(summary.querySelector('.mr-orch-run-subject').textContent).toBe('Fix the rail')
      expect(row.textContent).not.toContain('exit 0')
      expect(container.textContent).toContain('The room is ready.')
      const button = buttonWithText(summary, 'Details')
      expect(button.getAttribute('aria-expanded')).toBe('false')
      await click(root, button)
      expect(button.getAttribute('aria-expanded')).toBe('true')
      expect(row.textContent).toContain('exit 0')
      expect(row.textContent).toContain('cost not reported')
      await click(root, button)
      expect(row.textContent).not.toContain('exit 0')
    })
  })
})
