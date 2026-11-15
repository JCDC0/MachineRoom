import { act, createElement } from 'react'
import { describe, expect, it } from 'vitest'
import OrchestratorChat from '../src/ui/OrchestratorChat.jsx'
import { click, withDom } from './helpers/uiDom.js'

function isDisabled(node) {
  return node?.disabled === true || node?.hasAttribute('disabled') === true
}

function modelTrigger(container) {
  return container.querySelector('.mr-picker-trigger')
}

async function pickModel(container, root, id) {
  await click(root, modelTrigger(container))
  const option = container
    .querySelectorAll('.mr-picker-pick')
    .find((button) => button.getAttribute('title') === id)
  expect(option).toBeTruthy()
  await click(root, option)
}

function deferred() {
  let resolve
  let reject
  const promise = new Promise((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

describe('review 39 fixes: R39-2 chat model picker', () => {
  it('disables the chat model picker while a save waits and lets a second choice save after it ends', async () => {
    const list = [
      { id: 'orchestrator', name: 'Main', harness: 'claude', model: 'opus', effort: 'high', state: 'idle' },
    ]
    const pending = []
    const calls = []
    const client = {
      orchestrator: async () => ({ state: 'idle', messages: [], model: 'opus' }),
      models: async () => ['opus', 'sonnet', 'gpt'].map((id) => ({ id, label: id, harness: 'claude' })),
      setOrchestratorModel: (payload) => {
        calls.push(payload)
        const gate = deferred()
        pending.push(gate)
        return gate.promise
      },
    }

    await withDom(async ({ container, root }) => {
      await act(async () => {
        root.render(
          createElement(OrchestratorChat, {
            client,
            inline: true,
            orchestrators: list,
            initialOrchestrators: list,
          }),
        )
      })

      expect(isDisabled(modelTrigger(container))).toBe(false)

      await pickModel(container, root, 'sonnet')
      expect(calls).toEqual([{ id: 'orchestrator', model: 'sonnet', confirmed: true }])
      expect(container.querySelector('.mr-picker-pop')).toBeNull()
      expect(isDisabled(modelTrigger(container))).toBe(true)

      await act(async () => {
        pending[0].resolve({ ok: true })
      })

      expect(isDisabled(modelTrigger(container))).toBe(false)
      expect(modelTrigger(container).textContent).toContain('sonnet')

      await pickModel(container, root, 'gpt')
      expect(calls).toEqual([
        { id: 'orchestrator', model: 'sonnet', confirmed: true },
        { id: 'orchestrator', model: 'gpt', confirmed: true },
      ])
      expect(isDisabled(modelTrigger(container))).toBe(true)

      await act(async () => {
        pending[1].resolve({ ok: true })
      })

      expect(isDisabled(modelTrigger(container))).toBe(false)
      expect(modelTrigger(container).textContent).toContain('gpt')
    })
  })

  it('re-enables the picker after a failed save on the same tab', async () => {
    const list = [
      { id: 'orchestrator', name: 'Main', harness: 'claude', model: 'opus', effort: 'high', state: 'idle' },
    ]
    const pending = []
    const calls = []
    const client = {
      orchestrator: async () => ({ state: 'idle', messages: [], model: 'opus' }),
      models: async () => ['opus', 'sonnet', 'gpt'].map((id) => ({ id, label: id, harness: 'claude' })),
      setOrchestratorModel: (payload) => {
        calls.push(payload)
        const gate = deferred()
        pending.push(gate)
        return gate.promise
      },
    }

    await withDom(async ({ container, root }) => {
      await act(async () => {
        root.render(
          createElement(OrchestratorChat, {
            client,
            inline: true,
            orchestrators: list,
            initialOrchestrators: list,
          }),
        )
      })

      await pickModel(container, root, 'sonnet')
      expect(isDisabled(modelTrigger(container))).toBe(true)

      await act(async () => {
        pending[0].reject(new Error('Save failed'))
      })

      expect(isDisabled(modelTrigger(container))).toBe(false)
      expect(container.textContent).toContain('Save failed')

      await pickModel(container, root, 'gpt')
      expect(calls).toHaveLength(2)
      expect(isDisabled(modelTrigger(container))).toBe(true)

      await act(async () => {
        pending[1].resolve({ ok: true })
      })

      expect(isDisabled(modelTrigger(container))).toBe(false)
      expect(modelTrigger(container).textContent).toContain('gpt')
    })
  })

  it('only lets a finished save re-enable the tab that started it', async () => {
    const list = [
      { id: 'orchestrator', name: 'Main', harness: 'claude', model: 'opus', effort: 'high', state: 'idle' },
      { id: 'sub', name: 'Sub', harness: 'claude', model: 'gpt', effort: 'medium', state: 'idle' },
    ]
    const pending = []
    const client = {
      orchestrator: async (id) => ({ state: 'idle', messages: [], model: id === 'sub' ? 'gpt' : 'opus' }),
      models: async () => ['opus', 'sonnet', 'gpt'].map((id) => ({ id, label: id, harness: 'claude' })),
      setOrchestratorModel: () => {
        const gate = deferred()
        pending.push(gate)
        return gate.promise
      },
    }

    await withDom(async ({ container, root }) => {
      const render = (selected) =>
        root.render(
          createElement(OrchestratorChat, {
            client,
            inline: true,
            selected,
            orchestrators: list,
            initialOrchestrators: list,
          }),
        )

      await act(async () => render('orchestrator'))
      await pickModel(container, root, 'sonnet')
      expect(isDisabled(modelTrigger(container))).toBe(true)

      await act(async () => render('sub'))
      expect(isDisabled(modelTrigger(container))).toBe(false)

      await pickModel(container, root, 'sonnet')
      expect(isDisabled(modelTrigger(container))).toBe(true)

      await act(async () => {
        pending[0].resolve({ ok: true })
      })

      expect(isDisabled(modelTrigger(container))).toBe(true)

      await act(async () => {
        pending[1].resolve({ ok: true })
      })

      expect(isDisabled(modelTrigger(container))).toBe(false)
      expect(modelTrigger(container).textContent).toContain('sonnet')
    })
  })
})
