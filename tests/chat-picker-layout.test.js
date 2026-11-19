import { readFileSync } from 'node:fs'
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

  it('uses a shared chip and moves Refresh inside the upward picker in chat', async () => {
    const fullName = 'Claude Opus with an extended context window'
    await withDom(async ({ container, root }) => {
      for (const inline of [undefined, true]) {
        await act(async () => root.render(createElement(ModelPicker, {
          inline, choices: [{ id: 'opus', label: fullName }], value: 'opus',
        })))
        expect(Boolean(container.querySelector('.mr-picker.is-inline'))).toBe(Boolean(inline))
        expect(Boolean(container.querySelector('.mr-picker-trigger.ui-chip'))).toBe(Boolean(inline))
        expect(container.querySelector('.mr-picker-trigger').getAttribute('title')).toBe(fullName)
        expect(Boolean(container.querySelector('[aria-label="Refresh models"]'))).toBe(!inline)
        await click(root, container.querySelector('.mr-picker-trigger'))
        expect(Boolean(container.querySelector('.mr-picker-pop.is-upward'))).toBe(Boolean(inline))
        expect(Boolean(container.querySelector('.mr-picker-pop').querySelector('[aria-label="Refresh models"]'))).toBe(Boolean(inline))
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

describe('the composer toolbar styles', () => {
  const css = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8')
  const bodies = (selector) => [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .filter(([, names]) => names.split(',').map((name) => name.trim()).includes(selector))
    .map(([, , body]) => body)
    .join(';')

  it('wraps the toolbar rows and lets chips shrink and clip long values', () => {
    for (const selector of ['.mr-composer-toolbar', '.mr-composer-controls', '.mr-composer-actions']) {
      const body = bodies(selector)
      expect(body, selector).toMatch(/display:\s*flex/)
      expect(body, selector).toMatch(/flex-wrap:\s*wrap/)
      expect(body, selector).toMatch(/min-width:\s*0/)
    }
    expect(bodies('.mr-composer-controls .ui-chip')).toMatch(/max-width:\s*100%/)
    const value = bodies('.mr-composer-controls .ui-chip-value')
    expect(value).toMatch(/max-width:\s*220px/)
    expect(value).toMatch(/overflow:\s*hidden/)
    expect(value).toMatch(/text-overflow:\s*ellipsis/)
  })

  it('draws a visible keyboard focus outline on the composer controls and the chat input', () => {
    const block = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].find(([, names]) => names.includes('.mr-orch-input:focus-visible'))
    expect(block, 'the focus rule').toBeDefined()
    expect(block[1]).toContain('.mr-composer :is(button, input, select):focus-visible')
    expect(block[2]).toMatch(/outline:\s*1px solid var\(--white\)/)
    expect(block[2]).toMatch(/outline-offset:\s*2px/)
  })
})
