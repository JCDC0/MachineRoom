import { act, createElement } from 'react'
import { describe, expect, it } from 'vitest'
import OrchestratorChat from '../src/ui/OrchestratorChat.jsx'
import { buttonWithText, click, withDom } from './helpers/uiDom.js'

async function setup(run, fail = false) {
  const calls = []
  const list = [{ id: 'orchestrator', name: 'Main', harness: 'claude', model: 'opus', effort: 'high', state: 'idle' }]
  const client = {
    orchestrator: async () => ({ state: 'idle', messages: [], model: 'opus' }),
    models: async () => [{ id: 'opus', label: 'Opus', harness: 'claude' }, { id: 'sonnet', label: 'Sonnet', harness: 'claude' }],
    setOrchestratorModel: async (value) => { calls.push(value); if (fail) throw new Error('Save failed') },
    setOrchestratorEffort: async (value) => { calls.push(value); if (fail) throw new Error('Save failed') },
  }
  await withDom(async ({ container, root }) => {
    await act(async () => { root.render(createElement(OrchestratorChat, { client, inline: true, orchestrators: list, initialOrchestrators: list })) })
    await run({ container, root, calls })
  })
}

async function pickModel(container, root, id) {
  await click(root, container.querySelector('.mr-picker-trigger'))
  await click(root, container.querySelectorAll('.mr-picker-pick').find((button) => button.getAttribute('title') === id))
}

describe('chat pickers', () => {
  it('renders the shared model picker', async () => {
    await setup(async ({ container }) => { expect(container.querySelector('.mr-picker-trigger')).not.toBeNull() })
  })
  it('applies a different model without a Set card', async () => {
    await setup(async ({ container, root, calls }) => {
      await pickModel(container, root, 'sonnet')
      expect(calls).toEqual([{ id: 'orchestrator', model: 'sonnet', confirmed: true }])
      expect(container.querySelector('[aria-label="Set the model"]')).toBeNull()
    })
  })
  it('closes the current model without saving', async () => {
    await setup(async ({ container, root, calls }) => {
      await pickModel(container, root, 'opus')
      expect(calls).toEqual([])
      expect(container.querySelector('.mr-picker-pop')).toBeNull()
    })
  })
  it('applies a different effort without a Set card', async () => {
    await setup(async ({ container, root, calls }) => {
      await click(root, container.querySelector('.hud-strip-effort'))
      await click(root, buttonWithText(container.querySelector('.is-effort'), 'low'))
      expect(calls).toEqual([{ id: 'orchestrator', effort: 'low', confirmed: true }])
      expect(container.querySelector('[aria-label="Set the effort"]')).toBeNull()
    })
  })
  it('closes the current effort without saving', async () => {
    await setup(async ({ container, root, calls }) => {
      await click(root, container.querySelector('.hud-strip-effort'))
      await click(root, buttonWithText(container.querySelector('.is-effort'), 'high'))
      expect(calls).toEqual([])
      expect(container.querySelector('.is-effort')).toBeNull()
    })
  })
  it('shows an effort save error', async () => {
    await setup(async ({ container, root }) => {
      await click(root, container.querySelector('.hud-strip-effort'))
      await click(root, buttonWithText(container.querySelector('.is-effort'), 'low'))
      expect(container.textContent).toContain('Save failed')
    }, true)
  })
  it('shows a save error', async () => {
    await setup(async ({ container, root }) => {
      await pickModel(container, root, 'sonnet')
      expect(container.textContent).toContain('Save failed')
    }, true)
  })
})
