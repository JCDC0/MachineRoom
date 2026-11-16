import { act, createElement } from 'react'
import { describe, expect, it } from 'vitest'
import OrchestratorChat from '../src/ui/OrchestratorChat.jsx'
import { buttonWithText, classesOf, click, withDom } from './helpers/uiDom.js'

function makeChatClient({ list, states = {}, onStopTree, onStopOrchestrator } = {}) {
  const chatStates = { ...states }
  const stopTreeCalls = []
  const stopOrchestratorCalls = []

  const client = {
    orchestrators: async () => list.map((entry) => ({ ...entry, state: chatStates[entry.id] ?? entry.state })),
    orchestrator: async (id) => {
      const key = id || 'orchestrator'
      return { state: chatStates[key] ?? 'idle', messages: [{ id: 'm1', from: 'owner', text: 'Work.' }] }
    },
    orchestratorCommands: async () => [],
    lanes: async () => [],
    stopOrchestrator: async (options) => {
      stopOrchestratorCalls.push(options)
      const key = options?.id || 'orchestrator'
      chatStates[key] = 'paused'
      if (typeof onStopOrchestrator === 'function') return onStopOrchestrator(options)
      return { ok: true }
    },
    stopTree: async (options) => {
      stopTreeCalls.push(options)
      if (typeof onStopTree === 'function') return onStopTree(options, chatStates)
      return { stoppedOrchestrators: [], stoppedLanes: [], stillRunning: [] }
    },
    subscribe: () => () => {},
  }

  return { client, stopTreeCalls, stopOrchestratorCalls }
}

describe('OrchestratorChat stopTree confirm', () => {
  it('keeps Stop, adds Stop everything for Main, calls stopTree without id and shows both lines', async () => {
    const list = [
      { id: 'orchestrator', name: 'Orchestrator', harness: 'claude', state: 'working', lanes: ['a', 'b', 'c'] },
      { id: 'sub-1', name: 'Team 1', harness: 'claude', state: 'working', lanes: ['d'] },
    ]
    const { client, stopTreeCalls } = makeChatClient({
      list,
      states: { orchestrator: 'working', 'sub-1': 'working' },
      onStopTree: (_options, chatStates) => {
        chatStates.orchestrator = 'paused'
        chatStates['sub-1'] = 'paused'
        return {
          stoppedOrchestrators: ['orchestrator', 'sub-1'],
          stoppedLanes: ['a', 'b'],
          stillRunning: ['c', 'd'],
        }
      },
    })

    await withDom(async ({ container, root }) => {
      await act(async () => {
        root.render(
          createElement(OrchestratorChat, {
            client,
            orchestrators: list,
            initialOrchestrators: list,
            initialSelected: 'orchestrator',
          })
        )
      })
      await act(async () => {})

      await click(root, container.querySelector('.mr-orch-stop'))
      const card = container.querySelector('.mr-orch-confirm.is-stop')
      expect(card).not.toBeNull()

      const plainStop = buttonWithText(card, 'Stop')
      const treeStop = buttonWithText(card, 'Stop everything')
      expect(plainStop).not.toBeNull()
      expect(treeStop).not.toBeNull()
      expect(buttonWithText(card, 'Stop with its lanes')).toBeNull()
      expect(classesOf(treeStop)).toEqual(expect.arrayContaining(['mr-orch-confirm-btn', 'is-stop']))

      await click(root, treeStop)
      expect(stopTreeCalls).toEqual([{ confirmed: true }])
      expect(container.querySelector('.mr-orch-confirm.is-stop')).not.toBeNull()
      expect(card.textContent).toContain('Stopped 2 lanes.')
      expect(card.textContent).toContain('Still running: c, d.')

      const close = buttonWithText(card, 'Close')
      expect(close).not.toBeNull()
      await click(root, close)
      expect(container.querySelector('.mr-orch-confirm.is-stop')).toBeNull()
    })
  })

  it('adds Stop with its lanes for a sub, posts id and omits Still running when empty', async () => {
    const list = [
      { id: 'orchestrator', name: 'Orchestrator', harness: 'claude', state: 'idle', lanes: [] },
      { id: 'sub-1', name: 'Team 1', harness: 'claude', state: 'working', lanes: ['inside1', 'inside2'] },
    ]
    const { client, stopTreeCalls } = makeChatClient({
      list,
      states: { orchestrator: 'idle', 'sub-1': 'working' },
      onStopTree: (_options, chatStates) => {
        chatStates['sub-1'] = 'paused'
        return {
          stoppedOrchestrators: ['sub-1'],
          stoppedLanes: ['inside1'],
          stillRunning: [],
        }
      },
    })

    await withDom(async ({ container, root }) => {
      await act(async () => {
        root.render(
          createElement(OrchestratorChat, {
            client,
            orchestrators: list,
            initialOrchestrators: list,
            initialSelected: 'sub-1',
          })
        )
      })
      await act(async () => {})

      await click(root, container.querySelector('.mr-orch-stop'))
      const card = container.querySelector('.mr-orch-confirm.is-stop')
      expect(card).not.toBeNull()
      expect(buttonWithText(card, 'Stop everything')).toBeNull()
      const treeStop = buttonWithText(card, 'Stop with its lanes')
      expect(treeStop).not.toBeNull()

      await click(root, treeStop)
      expect(stopTreeCalls).toEqual([{ confirmed: true, id: 'sub-1' }])
      expect(card.textContent).toContain('Stopped 1 lane.')
      expect(card.textContent).not.toContain('Still running:')
    })
  })

  it('never counts a lane as stopped unless the server listed it', async () => {
    const list = [
      { id: 'orchestrator', name: 'Orchestrator', harness: 'claude', state: 'working', lanes: ['claude', 'opencode'] },
    ]
    const { client } = makeChatClient({
      list,
      states: { orchestrator: 'working' },
      onStopTree: (_options, chatStates) => {
        chatStates.orchestrator = 'paused'
        return {
          stoppedOrchestrators: ['orchestrator'],
          stoppedLanes: [],
          stillRunning: ['opencode'],
        }
      },
    })

    await withDom(async ({ container, root }) => {
      await act(async () => {
        root.render(
          createElement(OrchestratorChat, {
            client,
            orchestrators: list,
            initialOrchestrators: list,
            lanes: [
              { key: 'claude', name: 'Claude Code', active: true, working: true },
              { key: 'opencode', name: 'OpenCode', active: true, working: true },
            ],
          })
        )
      })
      await act(async () => {})

      await click(root, container.querySelector('.mr-orch-stop'))
      const card = container.querySelector('.mr-orch-confirm.is-stop')
      await click(root, buttonWithText(card, 'Stop everything'))
      expect(card.textContent).toContain('Stopped 0 lanes.')
      expect(card.textContent).toContain('Still running: opencode.')
    })
  })

  it('shows the server error when stopTree fails and keeps the confirm open', async () => {
    const list = [
      { id: 'orchestrator', name: 'Orchestrator', harness: 'claude', state: 'idle', lanes: [] },
      { id: 'sub-1', name: 'Team 1', harness: 'claude', state: 'working', lanes: ['inside1'] },
    ]
    const { client, stopTreeCalls } = makeChatClient({
      list,
      states: { orchestrator: 'idle', 'sub-1': 'working' },
      onStopTree: () => {
        throw new Error('That sector is stopping.')
      },
    })

    await withDom(async ({ container, root }) => {
      await act(async () => {
        root.render(
          createElement(OrchestratorChat, {
            client,
            orchestrators: list,
            initialOrchestrators: list,
            initialSelected: 'sub-1',
          })
        )
      })
      await act(async () => {})

      await click(root, container.querySelector('.mr-orch-stop'))
      const card = container.querySelector('.mr-orch-confirm.is-stop')
      await click(root, buttonWithText(card, 'Stop with its lanes'))

      expect(stopTreeCalls).toEqual([{ confirmed: true, id: 'sub-1' }])
      const alert = container.querySelector('.mr-orch-error')
      expect(alert).not.toBeNull()
      expect(alert.textContent).toContain('That sector is stopping.')
      expect(container.querySelector('.mr-orch-confirm.is-stop')).not.toBeNull()
      expect(card.textContent).not.toContain('Stopped ')

      await click(root, buttonWithText(card, 'Cancel'))
      expect(container.querySelector('.mr-orch-confirm.is-stop')).toBeNull()
    })
  })

  it('keeps plain Stop calling stopOrchestrator without calling stopTree', async () => {
    const list = [
      { id: 'orchestrator', name: 'Orchestrator', harness: 'claude', state: 'working', lanes: ['a'] },
    ]
    const { client, stopTreeCalls, stopOrchestratorCalls } = makeChatClient({
      list,
      states: { orchestrator: 'working' },
    })

    await withDom(async ({ container, root }) => {
      await act(async () => {
        root.render(
          createElement(OrchestratorChat, {
            client,
            orchestrators: list,
            initialOrchestrators: list,
          })
        )
      })
      await act(async () => {})

      await click(root, container.querySelector('.mr-orch-stop'))
      const card = container.querySelector('.mr-orch-confirm.is-stop')
      await click(root, buttonWithText(card, 'Stop'))

      expect(stopOrchestratorCalls).toEqual([{ confirmed: true }])
      expect(stopTreeCalls).toEqual([])
      expect(container.querySelector('.mr-orch-confirm.is-stop')).toBeNull()
    })
  })
})
