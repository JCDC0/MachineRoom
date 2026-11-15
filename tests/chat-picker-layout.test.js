import { act, createElement } from 'react'
import { describe, expect, it } from 'vitest'
import ModelPicker from '../src/ui/ModelPicker.jsx'
import OrchestratorChat from '../src/ui/OrchestratorChat.jsx'
import { buttonWithText, click, type, withDom } from './helpers/uiDom.js'

const list = [
  { id: 'orchestrator', name: 'Main', harness: 'claude', model: 'opus', effort: 'high', state: 'idle' },
  { id: 'sub', name: 'Sub', harness: 'claude', model: 'gpt', effort: 'medium', state: 'idle' },
]

function clientWith(save = async () => {}) {
  return {
    orchestrator: async (id) => ({ state: 'idle', messages: [], model: id === 'sub' ? 'gpt' : 'opus' }),
    models: async () => ['opus', 'sonnet', 'gpt'].map((id) => ({ id, label: id, harness: 'claude' })),
    setOrchestratorModel: save,
    setOrchestratorEffort: save,
  }
}

describe('chat picker placement and saves', () => {
  it('uses the inline placement in chat', async () => {
    await withDom(async ({ container, root }) => {
      await act(async () => root.render(createElement(OrchestratorChat, { client: clientWith(), inline: true, initialOrchestrators: list })))
      expect(container.querySelector('.mr-picker.is-inline')).not.toBeNull()
    })
  })

  it('places the label inline and opens upward only when requested', async () => {
    await withDom(async ({ container, root }) => {
      for (const inline of [undefined, true]) {
        await act(async () => root.render(createElement(ModelPicker, { inline, choices: ['opus'], value: 'opus' })))
        expect(Boolean(container.querySelector('.mr-picker.is-inline'))).toBe(Boolean(inline))
        await click(root, container.querySelector('.mr-picker-trigger'))
        expect(Boolean(container.querySelector('.mr-picker-pop.is-upward'))).toBe(Boolean(inline))
        await click(root, container.querySelector('.mr-picker-trigger'))
      }
    })
  })

  it('returns focus after Escape and a pick', async () => {
    await withDom(async ({ container, dom, root }) => {
      await act(async () => root.render(createElement(ModelPicker, { choices: ['opus'] })))
      const trigger = container.querySelector('.mr-picker-trigger')
      await click(root, trigger)
      await type(root, container.querySelector('.mr-picker-search'), '')
      await act(async () => container.querySelector('.mr-picker-search').dispatchEvent({ type: 'keydown', key: 'Escape', bubbles: true }))
      expect(dom.document.activeElement).toBe(trigger)
      await click(root, trigger)
      await click(root, container.querySelector('.mr-picker-pick'))
      expect(dom.document.activeElement).toBe(trigger)
    })
  })

  for (const kind of ['model', 'effort']) {
    for (const fails of [false, true]) {
      it(`ignores a late ${kind} ${fails ? 'error' : 'save'} after switching tabs`, async () => {
        let finish
        const save = () => new Promise((resolve, reject) => { finish = fails ? () => reject(new Error('Late error')) : resolve })
        const client = clientWith(save)
        await withDom(async ({ container, root }) => {
          const render = (selected) => root.render(createElement(OrchestratorChat, { client, inline: true, selected, orchestrators: list, initialOrchestrators: list }))
          await act(async () => render('orchestrator'))
          if (kind === 'model') {
            await click(root, container.querySelector('.mr-picker-trigger'))
            await click(root, container.querySelectorAll('.mr-picker-pick').find((button) => button.getAttribute('title') === 'sonnet'))
          } else {
            await click(root, container.querySelector('.hud-strip-effort'))
            await click(root, buttonWithText(container.querySelector('.is-effort'), 'low'))
          }
          await act(async () => render('sub'))
          await act(async () => finish())
          expect(container.querySelector('.mr-picker-trigger').textContent).toContain('gpt')
          expect(container.querySelector('.hud-strip-effort').textContent).toContain('medium')
          expect(container.textContent).not.toContain('Late error')
        })
      })
    }
  }
})
