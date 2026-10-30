import { act, createElement } from 'react'
import { describe, expect, it } from 'vitest'
import DispatchPanel from '../src/ui/panels/DispatchPanel.jsx'
import { buttonWithText, settle, withDom } from './helpers/uiDom.js'

const OFFLINE_LINE = 'There is no connection, so this agent will likely fail.'

function agent(key, model) {
  return {
    id: `agent-${key}`,
    key,
    name: key,
    adapterType: 'opencode_local',
    role: null,
    harness: 'opencode',
    model,
  }
}

function makeClient(agents, online) {
  const calls = []
  const client = {
    health: async () => ({ lanes: true }),
    agents: async () => agents,
    runs: async () => ({ running: [], recent: [], project: 'demo' }),
    network: async () => ({ online }),
    startRun: async (lane, body) => {
      calls.push({ lane, body })
      return { lane, tasks: 1 }
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

async function choose(container, id, value) {
  const select = container.querySelector(`#${id}`)
  await act(async () => {
    select.value = value
    select.dispatchEvent({ type: 'change', bubbles: true })
  })
}

async function mount(root, client, agents) {
  await act(async () => {
    root.render(createElement(DispatchPanel, { client, initialAgents: agents }))
  })
  await settle()
}

async function openConfirm(container, lane, task) {
  await typeInto(container.querySelector('#project-run-task'), task)
  await choose(container, 'project-run-lane', lane)
  const run = buttonWithText(container, 'Run')
  expect(run).not.toBeNull()
  await act(async () => {
    run.click()
  })
  await settle()
}

describe('the DispatchPanel confirm card while offline', () => {
  it('warns that a lane on a remote model will likely fail and still starts it', async () => {
    const agents = [agent('alpha', 'opencode-go/deepseek-v4.1-flash')]
    const { client, calls } = makeClient(agents, false)
    await withDom(async ({ container, root }) => {
      await mount(root, client, agents)
      await openConfirm(container, 'alpha', 'Fix the typo')

      expect(container.textContent).toContain(OFFLINE_LINE)
      const confirm = buttonWithText(container, 'Confirm')
      expect(confirm).not.toBeNull()
      expect(confirm.getAttribute('disabled')).toBeNull()

      await act(async () => {
        confirm.click()
      })
      await settle()
      expect(calls).toHaveLength(1)
      expect(calls[0].lane).toBe('alpha')
    })
  })

  it('shows no line for a lane whose model is on a local endpoint', async () => {
    const agents = [agent('alpha', 'http://127.0.0.1:11434/v1/llama3.3')]
    const { client } = makeClient(agents, false)
    await withDom(async ({ container, root }) => {
      await mount(root, client, agents)
      await openConfirm(container, 'alpha', 'Fix the typo')

      expect(container.textContent).not.toContain(OFFLINE_LINE)
      expect(buttonWithText(container, 'Confirm')).not.toBeNull()
    })
  })

  it('shows no line while the room is online', async () => {
    const agents = [agent('alpha', 'opencode-go/deepseek-v4.1-flash')]
    const { client } = makeClient(agents, true)
    await withDom(async ({ container, root }) => {
      await mount(root, client, agents)
      await openConfirm(container, 'alpha', 'Fix the typo')

      expect(container.textContent).not.toContain(OFFLINE_LINE)
    })
  })
})
