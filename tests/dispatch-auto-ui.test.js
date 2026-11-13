import { act, createElement } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import DispatchPanel from '../src/ui/panels/DispatchPanel.jsx'
import { clearSplitRun } from '../src/ui/panels/runs.js'
import { buttonWithText, withDom } from './helpers/uiDom.js'

const AGENTS = [
  { id: 'agent-opencode', key: 'opencode', name: 'OpenCode', adapterType: 'opencode_local', role: null },
  { id: 'agent-opencode2', key: 'opencode2', name: 'OpenCode 2', adapterType: 'opencode_local', role: null },
]

const REASON = 'The small tier runs opencode2 on opencode-go/deepseek-v4.1-flash at max.'

function makeClient({ route = true } = {}) {
  const calls = { route: [], start: [] }
  const client = {
    health: async () => ({ lanes: true }),
    agents: async () => AGENTS,
    runs: async () => ({ running: [], recent: [], project: 'demo' }),
    startRun: async (lane, body) => {
      calls.start.push({ lane, body })
      return { lane, queue: true, tasks: 1 }
    },
  }
  if (route) {
    client.routeLane = async (body) => {
      calls.route.push(body)
      return { lane: 'opencode2', model: 'opencode-go/deepseek-v4.1-flash', reasoning: 'max', tier: 'small', reason: REASON, skipped: [] }
    }
  }
  return { client, calls }
}

async function settleTimers() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0)
  })
}

async function typeInto(node, text) {
  await act(async () => {
    node.focus()
    node.dispatchEvent({ type: 'focusin', bubbles: true, cancelable: true })
    node.value = text
    node.dispatchEvent({ type: 'keyup', bubbles: true, cancelable: true })
  })
}

describe('DispatchPanel auto lane', () => {
  afterEach(() => {
    vi.useRealTimers()
    clearSplitRun()
  })

  it('starts on Auto, asks the route after 400 ms and shows the answer', async () => {
    vi.useFakeTimers()
    const { client, calls } = makeClient()
    await withDom(async ({ container, root }) => {
      await act(async () => {
        root.render(createElement(DispatchPanel, { client, initialAgents: AGENTS }))
      })
      await settleTimers()

      const picker = container.querySelector('#project-run-lane')
      expect(picker.querySelectorAll('option')[0].textContent).toBe('Auto')
      expect(picker.querySelectorAll('option')[0].getAttribute('value')).toBe('auto')

      await typeInto(container.querySelector('#project-run-task'), 'One.')
      expect(calls.route).toEqual([])
      await act(async () => {
        await vi.advanceTimersByTimeAsync(399)
      })
      expect(calls.route).toEqual([])
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1)
      })
      expect(calls.route).toEqual([{ task: 'One.' }])
      expect(container.textContent).toContain(`Auto: opencode2. ${REASON}`)

      await act(async () => {
        buttonWithText(container, 'Run').click()
      })
      expect(container.textContent).toContain('Lane: opencode2')
      expect(container.textContent).toContain(`Picked by the routing policy: ${REASON}`)

      await act(async () => {
        buttonWithText(container, 'Confirm').click()
      })
      await settleTimers()
      expect(calls.start).toEqual([{ lane: 'opencode2', body: { tasks: ['One.'], worktree: true } }])
    })
  })

  it('previews the highest tier across every task in the queue', async () => {
    vi.useFakeTimers()
    const { client, calls } = makeClient()
    client.routeLane = async (body) => {
      calls.route.push(body)
      if (body.task === 'Large one.') {
        return {
          lane: 'opencode',
          tier: 'large',
          reason: 'The large tier runs opencode at max.',
          skipped: [],
        }
      }
      return { lane: 'opencode2', tier: 'small', reason: REASON, skipped: [] }
    }
    await withDom(async ({ container, root }) => {
      await act(async () => {
        root.render(createElement(DispatchPanel, { client, initialAgents: AGENTS }))
      })
      await settleTimers()

      await typeInto(container.querySelector('#project-run-task'), 'Small one.\n---\nLarge one.')
      await act(async () => {
        await vi.advanceTimersByTimeAsync(400)
      })
      expect(calls.route).toEqual([{ task: 'Small one.' }, { task: 'Large one.' }])
      expect(container.textContent).toContain('Auto: opencode. The large tier runs opencode at max.')

      await act(async () => {
        buttonWithText(container, 'Run 2 tasks in order').click()
      })
      expect(container.textContent).toContain('Lane: opencode')
    })
  })

  it('sends the lane the card names on Confirm', async () => {
    vi.useFakeTimers()
    const { client, calls } = makeClient()
    await withDom(async ({ container, root }) => {
      await act(async () => {
        root.render(createElement(DispatchPanel, { client, initialAgents: AGENTS }))
      })
      await settleTimers()

      await typeInto(container.querySelector('#project-run-task'), 'One.')
      await act(async () => {
        await vi.advanceTimersByTimeAsync(400)
      })
      await act(async () => {
        buttonWithText(container, 'Run').click()
      })
      expect(container.textContent).toContain('Lane: opencode2')

      await act(async () => {
        buttonWithText(container, 'Confirm').click()
      })
      await settleTimers()
      expect(calls.start).toEqual([{ lane: 'opencode2', body: { tasks: ['One.'], worktree: true } }])
    })
  })

  it('shows the refusal and starts nothing when the previewed lane is taken', async () => {
    vi.useFakeTimers()
    const { client, calls } = makeClient()
    client.startRun = async (lane, body) => {
      calls.start.push({ lane, body })
      throw new Error('That lane is already running.')
    }
    await withDom(async ({ container, root }) => {
      await act(async () => {
        root.render(createElement(DispatchPanel, { client, initialAgents: AGENTS }))
      })
      await settleTimers()

      await typeInto(container.querySelector('#project-run-task'), 'One.')
      await act(async () => {
        await vi.advanceTimersByTimeAsync(400)
      })
      await act(async () => {
        buttonWithText(container, 'Run').click()
      })
      await act(async () => {
        buttonWithText(container, 'Confirm').click()
      })
      await settleTimers()

      expect(calls.start).toEqual([{ lane: 'opencode2', body: { tasks: ['One.'], worktree: true } }])
      expect(container.textContent).toContain('That lane is already running.')
      expect(container.textContent).toContain('Preview the route again.')
      expect(buttonWithText(container, 'Preview again')).not.toBeNull()
      const confirm = buttonWithText(container, 'Confirm')
      expect(confirm.disabled === true || confirm.getAttribute('disabled') !== null).toBe(true)
    })
  })

  it('asks again when the task changes and drops the old answer', async () => {
    vi.useFakeTimers()
    const { client, calls } = makeClient()
    await withDom(async ({ container, root }) => {
      await act(async () => {
        root.render(createElement(DispatchPanel, { client, initialAgents: AGENTS }))
      })
      await settleTimers()
      const task = container.querySelector('#project-run-task')
      await typeInto(task, 'One.')
      await act(async () => {
        await vi.advanceTimersByTimeAsync(400)
      })
      expect(container.textContent).toContain('Auto: opencode2.')

      client.routeLane = async (body) => {
        calls.route.push(body)
        return { lane: 'opencode', tier: 'medium', reason: 'The medium tier runs opencode at max.', skipped: [] }
      }
      await typeInto(task, 'Two.')
      expect(container.textContent).not.toContain('Auto: opencode2.')
      await act(async () => {
        await vi.advanceTimersByTimeAsync(400)
      })
      expect(calls.route).toEqual([{ task: 'One.' }, { task: 'Two.' }])
      expect(container.textContent).toContain('Auto: opencode. The medium tier runs opencode at max.')
    })
  })

  it('shows the manual sentence after Auto when no lane choice is saved', async () => {
    vi.useFakeTimers()
    const { client } = makeClient()
    client.routeLane = async () => {
      throw new Error('Pick the lanes for this project first.')
    }
    await withDom(async ({ container, root }) => {
      await act(async () => {
        root.render(createElement(DispatchPanel, { client, initialAgents: AGENTS }))
      })
      await settleTimers()
      await typeInto(container.querySelector('#project-run-task'), 'One.')
      await act(async () => {
        await vi.advanceTimersByTimeAsync(400)
      })
      expect(container.textContent).toContain('Auto: Pick the lanes for this project first.')
    })
  })

  it('shows no Auto when the bridge has no routeLane', async () => {
    vi.useFakeTimers()
    const { client } = makeClient({ route: false })
    await withDom(async ({ container, root }) => {
      await act(async () => {
        root.render(createElement(DispatchPanel, { client, initialAgents: AGENTS }))
      })
      await settleTimers()
      const picker = container.querySelector('#project-run-lane')
      expect(picker.querySelectorAll('option').some((option) => option.getAttribute('value') === 'auto')).toBe(false)
      expect(picker.querySelectorAll('option')[0].textContent).toBe('Select a lane')
    })
  })
})
