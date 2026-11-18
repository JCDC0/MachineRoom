import { act, createElement } from 'react'
import { describe, expect, it } from 'vitest'
import LaneConversation from '../src/ui/LaneConversation.jsx'
import { buttonWithText, click, settle, type, withDom } from './helpers/uiDom.js'

const OPENCODE_LANES = [{ key: 'opencode', name: 'OpenCode', color: '#ff8c1a' }]
const CLAUDE_LANES = [{ key: 'claude', name: 'Claude Code', color: '#2aff80' }]

function selectValue(select, value) {
  select.value = value
  select.dispatchEvent({ type: 'change', bubbles: true })
}

function optionValues(select) {
  return select.querySelectorAll('option').map((option) => option.getAttribute('value'))
}

function selectedOptionValue(select) {
  const propKey = Object.keys(select).find((key) => key.startsWith('__reactProps'))
  if (propKey && select[propKey]?.value !== undefined) return select[propKey].value
  return select.value
}

describe('LaneConversation manual Plan handoff', () => {
  it('shows Edit from this plan only for a finished exit-0 Plan run', async () => {
    const runningPlan = '2026-11-17T10:05:00.000Z'
    const finishedPlan = '2026-11-17T10:00:00.000Z'
    const failedPlan = '2026-11-17T09:50:00.000Z'
    const stoppedPlan = '2026-11-17T09:40:00.000Z'
    const finishedAuto = '2026-11-17T09:30:00.000Z'
    const finishedPlain = '2026-11-17T09:20:00.000Z'

    const client = {
      runs: async () => ({
        running: [{ lane: 'opencode', startedAt: runningPlan, running: true, mode: 'plan' }],
        recent: [
          { lane: 'opencode', startedAt: finishedPlan, exitCode: 0, mode: 'plan' },
          { lane: 'opencode', startedAt: failedPlan, exitCode: 1, mode: 'plan' },
          { lane: 'opencode', startedAt: stoppedPlan, exitCode: 0, killed: true, mode: 'plan' },
          { lane: 'opencode', startedAt: finishedAuto, exitCode: 0, mode: 'auto' },
          { lane: 'opencode', startedAt: finishedPlain, exitCode: 0 },
        ],
      }),
      lanes: async () => ({
        lanes: [{ key: 'opencode', harness: 'opencode', mode: 'auto' }],
      }),
      runConversation: async ({ startedAt }) => ({
        lane: 'opencode',
        startedAt,
        harness: 'opencode',
        running: startedAt === runningPlan,
        entries: [
          { role: 'agent', text: `Report for ${startedAt}`, at: startedAt },
          { role: 'result', text: startedAt === failedPlan ? 'The run failed.' : 'The run ended.', at: startedAt },
        ],
      }),
      startRun: async () => ({ lane: 'opencode', queue: true, tasks: 1 }),
      subscribe: () => () => {},
    }

    await withDom(async ({ container, root }) => {
      await act(async () => {
        root.render(
          createElement(LaneConversation, {
            client,
            lane: 'opencode',
            laneName: 'OpenCode',
            project: 'MachineRoom',
            lanes: OPENCODE_LANES,
            initialStartedAt: finishedPlan,
          })
        )
      })
      await settle(15)

      expect(buttonWithText(container, 'Edit from this plan')).not.toBeNull()
      expect(container.querySelector('.brief-confirm-card')).toBeNull()

      const runPicker = container.querySelector('select[aria-label="Run"]')
      for (const startedAt of [runningPlan, failedPlan, stoppedPlan, finishedAuto, finishedPlain]) {
        await act(async () => {
          selectValue(runPicker, startedAt)
        })
        await settle(15)
        expect(buttonWithText(container, 'Edit from this plan')).toBeNull()
        expect(container.querySelector('.brief-confirm-card')).toBeNull()
      }

      await act(async () => {
        selectValue(runPicker, finishedPlan)
      })
      await settle(15)
      expect(buttonWithText(container, 'Edit from this plan')).not.toBeNull()
    })
  })

  it('opens a confirm card with Carry out this plan, final report text, and lane modes except Plan', async () => {
    const startedA = '2026-11-17T10:00:00.000Z'
    const startedB = '2026-11-17T10:10:00.000Z'
    const startCalls = []

    const opencodeClient = {
      runs: async () => ({
        running: [],
        recent: [{ lane: 'opencode', startedAt: startedA, exitCode: 0, mode: 'plan' }],
      }),
      lanes: async () => ({
        lanes: [{ key: 'opencode', harness: 'opencode', mode: 'edits' }],
      }),
      runConversation: async ({ startedAt }) => ({
        lane: 'opencode',
        startedAt,
        harness: 'opencode',
        running: false,
        entries: [
          { role: 'prompt', text: 'Plan the change.', at: startedAt },
          { role: 'agent', text: 'Reading the files first.', at: startedAt },
          { role: 'tool', text: 'read src/a.js', tool: 'read', at: startedAt },
          { role: 'agent', text: '1. Edit src/a.js\n2. Run tests.', at: startedAt },
          { role: 'result', text: 'The run ended.', at: startedAt },
        ],
      }),
      startRun: async (lane, run) => {
        startCalls.push({ lane, run })
        return { lane, queue: true, tasks: 1 }
      },
      subscribe: () => () => {},
    }

    await withDom(async ({ container, root }) => {
      await act(async () => {
        root.render(
          createElement(LaneConversation, {
            client: opencodeClient,
            lane: 'opencode',
            laneName: 'OpenCode',
            project: 'MachineRoom',
            lanes: OPENCODE_LANES,
            initialStartedAt: startedA,
          })
        )
      })
      await settle(15)

      await click(root, buttonWithText(container, 'Edit from this plan'))
      await settle(10)

      const card = container.querySelector('.brief-confirm-card')
      expect(card).not.toBeNull()
      const textarea = card.querySelector('textarea')
      expect(textarea).not.toBeNull()
      expect(textarea.value.startsWith('Carry out this plan:')).toBe(true)
      expect(textarea.value).toContain('1. Edit src/a.js\n2. Run tests.')
      expect(textarea.value).not.toContain('Reading the files first.')
      expect(textarea.value).not.toContain('The run ended.')

      const modeSelect = card.querySelector('select')
      expect(modeSelect).not.toBeNull()
      expect(optionValues(modeSelect)).toEqual(['edits', 'auto'])
      expect(optionValues(modeSelect)).not.toContain('plan')
      expect(selectedOptionValue(modeSelect)).toBe('edits')
      expect(buttonWithText(card, 'Start')).not.toBeNull()
      expect(buttonWithText(card, 'Cancel')).not.toBeNull()
      expect(startCalls).toEqual([])
    })

    const claudeClient = {
      runs: async () => ({
        running: [],
        recent: [{ lane: 'claude', startedAt: startedB, exitCode: 0, mode: 'plan' }],
      }),
      lanes: async () => ({
        lanes: [{ key: 'claude', harness: 'claude', mode: 'plan' }],
      }),
      runConversation: async ({ startedAt }) => ({
        lane: 'claude',
        startedAt,
        harness: 'claude',
        running: false,
        entries: [
          { role: 'agent', text: 'Inspecting files.', at: startedAt },
          { role: 'result', text: 'Plan:\n- Update app.js\n- Add tests', at: startedAt },
        ],
      }),
      startRun: async (lane, run) => {
        startCalls.push({ lane, run })
        return { lane, queue: true, tasks: 1 }
      },
      subscribe: () => () => {},
    }

    await withDom(async ({ container, root }) => {
      await act(async () => {
        root.render(
          createElement(LaneConversation, {
            client: claudeClient,
            lane: 'claude',
            laneName: 'Claude Code',
            project: 'MachineRoom',
            lanes: CLAUDE_LANES,
            initialStartedAt: startedB,
          })
        )
      })
      await settle(15)

      await click(root, buttonWithText(container, 'Edit from this plan'))
      await settle(10)

      const card = container.querySelector('.brief-confirm-card')
      expect(card).not.toBeNull()
      const textarea = card.querySelector('textarea')
      expect(textarea.value.startsWith('Carry out this plan:')).toBe(true)
      expect(textarea.value).toContain('Plan:\n- Update app.js\n- Add tests')

      const modeSelect = card.querySelector('select')
      expect(optionValues(modeSelect)).toEqual(['edits', 'auto', 'bypass'])
      expect(optionValues(modeSelect)).not.toContain('plan')
      expect(selectedOptionValue(modeSelect)).toBe('auto')
      expect(startCalls).toEqual([])
    })

    const startedC = '2026-11-17T10:20:00.000Z'
    const acpClient = {
      runs: async () => ({
        running: [],
        recent: [{ lane: 'acp', startedAt: startedC, exitCode: 0, mode: 'plan' }],
      }),
      lanes: async () => ({
        lanes: [{ key: 'acp', harness: 'acp', mode: 'choice' }],
      }),
      runConversation: async ({ startedAt }) => ({
        lane: 'acp',
        startedAt,
        harness: 'acp',
        running: false,
        entries: [{ role: 'line', text: '1. Inspect ACP handler.', at: startedAt }],
      }),
      startRun: async (lane, run) => {
        startCalls.push({ lane, run })
        return { lane, queue: true, tasks: 1 }
      },
      subscribe: () => () => {},
    }

    await withDom(async ({ container, root }) => {
      await act(async () => {
        root.render(
          createElement(LaneConversation, {
            client: acpClient,
            lane: 'acp',
            laneName: 'ACP',
            project: 'MachineRoom',
            lanes: [{ key: 'acp', name: 'ACP', color: '#2a9dff' }],
            initialStartedAt: startedC,
          })
        )
      })
      await settle(15)

      await click(root, buttonWithText(container, 'Edit from this plan'))
      await settle(10)

      const card = container.querySelector('.brief-confirm-card')
      expect(card).not.toBeNull()
      expect(card.querySelector('textarea').value).toContain('1. Inspect ACP handler.')
      const modeSelect = card.querySelector('select')
      expect(optionValues(modeSelect)).toEqual(['auto', 'bypass'])
      expect(optionValues(modeSelect)).not.toContain('plan')
      expect(selectedOptionValue(modeSelect)).toBe('auto')
      expect(startCalls).toEqual([])
    })
  })

  it('calls startRun once with the edited text and chosen mode and shows the answer line or error', async () => {
    const started = '2026-11-17T10:00:00.000Z'
    const startCalls = []
    let resolvePending
    let failNext = false

    const client = {
      runs: async () => ({
        running: [],
        recent: [{ lane: 'claude', startedAt: started, exitCode: 0, mode: 'plan' }],
      }),
      lanes: async () => ({
        lanes: [{ key: 'claude', harness: 'claude', mode: 'edits' }],
      }),
      runConversation: async ({ startedAt }) => ({
        lane: 'claude',
        startedAt,
        harness: 'claude',
        running: false,
        entries: [{ role: 'result', text: '1. Edit widget.js', at: startedAt }],
      }),
      startRun: (lane, run) => {
        startCalls.push({ lane, run })
        if (failNext) return Promise.reject(new Error('That lane is already running.'))
        return new Promise((resolve) => {
          resolvePending = resolve
        })
      },
      subscribe: () => () => {},
    }

    await withDom(async ({ container, root }) => {
      await act(async () => {
        root.render(
          createElement(LaneConversation, {
            client,
            lane: 'claude',
            laneName: 'Claude Code',
            project: 'MachineRoom',
            lanes: CLAUDE_LANES,
            initialStartedAt: started,
          })
        )
      })
      await settle(15)

      await click(root, buttonWithText(container, 'Edit from this plan'))
      await settle(10)

      const card = container.querySelector('.brief-confirm-card')
      const textarea = card.querySelector('textarea')
      const modeSelect = card.querySelector('select')
      await type(root, textarea, 'Carry out step 1 only.')
      await act(async () => {
        selectValue(modeSelect, 'bypass')
      })

      const startButton = buttonWithText(card, 'Start')
      await click(root, startButton)
      await click(root, startButton)
      expect(startCalls).toEqual([
        { lane: 'claude', run: { tasks: ['Carry out step 1 only.'], mode: 'bypass' } },
      ])

      await act(async () => {
        resolvePending({ lane: 'claude', queue: true, tasks: 1 })
      })
      await settle(10)

      expect(container.querySelector('.brief-confirm-card')).toBeNull()
      expect(container.textContent).toContain('claude started 1 task in order.')

      failNext = true
      await click(root, buttonWithText(container, 'Edit from this plan'))
      await settle(10)
      const retryCard = container.querySelector('.brief-confirm-card')
      await type(root, retryCard.querySelector('textarea'), 'Retry step 1.')
      await click(root, buttonWithText(retryCard, 'Start'))
      await settle(10)

      expect(container.querySelector('.brief-confirm-card')).not.toBeNull()
      expect(container.querySelector('.brief-confirm-error').textContent).toContain('That lane is already running.')
      expect(container.querySelector('.brief-confirm-card').querySelector('textarea').value).toBe('Retry step 1.')
      expect(selectedOptionValue(container.querySelector('.brief-confirm-card').querySelector('select'))).toBe('edits')

      failNext = false
      await click(root, buttonWithText(container.querySelector('.brief-confirm-card'), 'Start'))
      await act(async () => {
        resolvePending({ lane: 'claude' })
      })
      await settle(10)
      expect(container.querySelector('.brief-confirm-card')).toBeNull()
      expect(container.textContent).toContain('claude started.')
    })
  })

  it('sends nothing on Cancel and never starts a run automatically when a Plan run finishes', async () => {
    const started = '2026-11-17T10:00:00.000Z'
    const startCalls = []
    let live = true
    const listeners = new Set()

    const client = {
      runs: async () => ({
        running: live ? [{ lane: 'opencode', startedAt: started, running: true, mode: 'plan' }] : [],
        recent: live ? [] : [{ lane: 'opencode', startedAt: started, exitCode: 0, mode: 'plan' }],
      }),
      lanes: async () => ({
        lanes: [{ key: 'opencode', harness: 'opencode', mode: 'auto' }],
      }),
      runConversation: async ({ startedAt }) => ({
        lane: 'opencode',
        startedAt,
        harness: 'opencode',
        running: live,
        entries: live
          ? [{ role: 'agent', text: 'Planning.', at: startedAt }]
          : [
              { role: 'agent', text: '1. Add tests.', at: startedAt },
              { role: 'result', text: 'The run ended.', at: startedAt },
            ],
      }),
      startRun: async (lane, run) => {
        startCalls.push({ lane, run })
        return { lane, queue: true, tasks: 1 }
      },
      subscribe: (fn) => {
        listeners.add(fn)
        return () => listeners.delete(fn)
      },
    }

    await withDom(async ({ container, root }) => {
      await act(async () => {
        root.render(
          createElement(LaneConversation, {
            client,
            lane: 'opencode',
            laneName: 'OpenCode',
            project: 'MachineRoom',
            lanes: OPENCODE_LANES,
            initialStartedAt: started,
          })
        )
      })
      await settle(20)
      expect(buttonWithText(container, 'Edit from this plan')).toBeNull()
      expect(startCalls).toEqual([])

      live = false
      await act(async () => {
        for (const fn of listeners) fn({ topic: 'runs' })
      })
      await settle(25)
      expect(buttonWithText(container, 'Edit from this plan')).not.toBeNull()
      expect(startCalls).toEqual([])

      await click(root, buttonWithText(container, 'Edit from this plan'))
      await settle(10)
      expect(startCalls).toEqual([])

      const card = container.querySelector('.brief-confirm-card')
      await type(root, card.querySelector('textarea'), 'Edited text that is cancelled.')
      await click(root, buttonWithText(card, 'Cancel'))
      await settle(10)

      expect(container.querySelector('.brief-confirm-card')).toBeNull()
      expect(startCalls).toEqual([])
      expect(buttonWithText(container, 'Edit from this plan')).not.toBeNull()
    })
  })
})
