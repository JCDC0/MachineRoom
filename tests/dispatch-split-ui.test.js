import { act, createElement } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import DispatchPanel from '../src/ui/panels/DispatchPanel.jsx'
import { clearSplitRun } from '../src/ui/panels/runs.js'
import { buttonWithText, withDom } from './helpers/uiDom.js'

const AGENTS = [
  { id: 'agent-alpha', key: 'alpha', name: 'Alpha', adapterType: 'opencode_local', role: null },
  { id: 'agent-beta', key: 'beta', name: 'Beta', adapterType: 'opencode_local', role: null },
  { id: 'agent-gamma', key: 'gamma', name: 'Gamma', adapterType: 'opencode_local', role: null },
]

function makeClient() {
  const calls = []
  const client = {
    health: async () => ({ lanes: true }),
    agents: async () => AGENTS,
    runs: async () => ({ running: [], recent: [], project: 'C:\\work\\demo' }),
    startRun: async (lane, body) => {
      calls.push({ lane, body })
      return { lane, queue: true, tasks: 1 }
    },
  }
  return { client, calls }
}

async function typeInto(node, text) {
  await act(async () => {
    node.focus()
    node.dispatchEvent({ type: 'focusin', bubbles: true, cancelable: true })
    node.value = text
    node.dispatchEvent({ type: 'keyup', bubbles: true, cancelable: true })
  })
}

describe('DispatchPanel split run', () => {
  afterEach(() => {
    vi.useRealTimers()
    clearSplitRun()
  })

  it('keeps starting after the panel closes and shows the progress when it reopens', async () => {
    vi.useFakeTimers()
    const { client, calls } = makeClient()
    await withDom(async ({ container, root }) => {
      await act(async () => {
        root.render(createElement(DispatchPanel, { client, initialAgents: AGENTS }))
      })
      await settleTimers()

      await typeInto(container.querySelector('#project-run-task'), 'One\n---\nTwo\n---\nThree')
      const oneLane = container
        .querySelectorAll('label')
        .find((label) => label.textContent.includes('One lane per task'))
      const checkbox = oneLane.querySelector('input')
      await act(async () => {
        checkbox.checked = true
        checkbox.click()
      })

      const runButton = buttonWithText(container, 'Run 3 tasks on 3 lanes')
      expect(runButton).not.toBeNull()
      await act(async () => {
        runButton.click()
      })
      const confirm = buttonWithText(container, 'Confirm')
      expect(confirm).not.toBeNull()
      await act(async () => {
        confirm.click()
      })
      await settleTimers()

      expect(calls).toEqual([{ lane: 'alpha', body: { tasks: ['One'], worktree: true } }])

      await act(async () => {
        root.render(null)
      })
      await act(async () => {
        root.render(createElement(DispatchPanel, { client, initialAgents: AGENTS }))
      })
      await settleTimers()

      expect(container.textContent).toContain('Starting 3 tasks, 1 started.')
      const starting = buttonWithText(container, 'Starting')
      expect(starting).not.toBeNull()
      expect(starting.getAttribute('disabled')).not.toBeNull()
      expect(buttonWithText(container, 'Stop')).not.toBeNull()

      await act(async () => {
        await vi.advanceTimersByTimeAsync(3000)
      })
      await act(async () => {
        await vi.advanceTimersByTimeAsync(3000)
      })
      await settleTimers()

      expect(calls.map((call) => call.lane)).toEqual(['alpha', 'beta', 'gamma'])
      expect(container.textContent).toContain('Started 3 tasks.')
    })
  })

  it('stops the split run from the card and says how many started', async () => {
    vi.useFakeTimers()
    const { client, calls } = makeClient()
    await withDom(async ({ container, root }) => {
      await act(async () => {
        root.render(createElement(DispatchPanel, { client, initialAgents: AGENTS }))
      })
      await settleTimers()

      await typeInto(container.querySelector('#project-run-task'), 'One\n---\nTwo\n---\nThree')
      const oneLane = container
        .querySelectorAll('label')
        .find((label) => label.textContent.includes('One lane per task'))
      const checkbox = oneLane.querySelector('input')
      await act(async () => {
        checkbox.checked = true
        checkbox.click()
      })

      const runButton = buttonWithText(container, 'Run 3 tasks on 3 lanes')
      await act(async () => {
        runButton.click()
      })
      const confirm = buttonWithText(container, 'Confirm')
      await act(async () => {
        confirm.click()
      })
      await settleTimers()

      expect(calls.map((call) => call.lane)).toEqual(['alpha'])
      const stop = buttonWithText(container, 'Stop')
      expect(stop).not.toBeNull()
      await act(async () => {
        stop.click()
      })
      await settleTimers()

      expect(calls.map((call) => call.lane)).toEqual(['alpha'])
      expect(container.textContent).toContain(
        'Stopped after starting 1 of 3 tasks. The runs already started keep running.'
      )
      expect(buttonWithText(container, 'Stop')).toBeNull()
      expect(buttonWithText(container, 'Stopped')).not.toBeNull()
    })
  })
})

async function settleTimers() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0)
  })
}
