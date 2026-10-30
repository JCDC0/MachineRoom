import { act, createElement } from 'react'
import { describe, expect, it } from 'vitest'
import AutocompactInput from '../src/ui/AutocompactInput.jsx'
import { settle, type, withDom } from './helpers/uiDom.js'

const FIRST = {
  id: 'orchestrator',
  name: 'Orchestrator',
  autocompact: true,
  autocompactMode: 'tokens',
  autocompactValue: 160000,
  compactRules: 'Server rules',
  contextWindow: 200000,
}

async function mount(root, orchestrator) {
  await act(async () => {
    root.render(createElement(AutocompactInput, { orchestrator, client: { setAutocompact: async () => ({}) } }))
  })
  await settle()
}

async function rerender(root, orchestrator) {
  await act(async () => {
    root.render(createElement(AutocompactInput, { orchestrator, client: { setAutocompact: async () => ({}) } }))
  })
  await settle()
}

describe('the autocompact form under a poll', () => {
  it('keeps the fields the owner edited and takes the ones they did not', async () => {
    await withDom(async ({ container, root }) => {
      await mount(root, FIRST)

      const rules = container.querySelector('textarea[aria-label="Compact rules"]')
      const value = container.querySelector('input[aria-label="Autocompact value"]')
      const on = container.querySelector('input[aria-label="Autocompact"]')
      expect(rules.value).toBe('Server rules')
      expect(value.value).toBe('160000')

      await type(root, rules, 'My rules')
      await type(root, value, '90000')
      console.log('AFTER TYPE', rules.value, value.value)
      await act(async () => {
        on.checked = false
        on.click()
      })

      await rerender(root, {
        ...FIRST,
        autocompact: true,
        autocompactValue: 120000,
        compactRules: 'Changed on the server',
        contextWindow: 240000,
      })

      expect(rules.value).toBe('My rules')
      expect(value.value).toBe('90000')
      expect(on.checked).toBe(false)

      await rerender(root, {
        ...FIRST,
        id: 'frontend',
        autocompact: true,
        autocompactValue: 50000,
        compactRules: 'Sub rules',
        contextWindow: 200000,
      })

      expect(rules.value).toBe('Sub rules')
      expect(value.value).toBe('50000')
      expect(on.checked).toBe(true)
    })
  })
})
