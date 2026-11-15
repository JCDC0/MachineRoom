import { act, createElement } from 'react'
import { describe, expect, it } from 'vitest'
import ModelPicker from '../src/ui/ModelPicker.jsx'
import { withDom } from './helpers/uiDom.js'

const SAVED = 'claude-opus-5-5'

async function renderPicker(root, props) {
  await act(async () => {
    root.render(createElement(ModelPicker, props))
  })
}

function triggerText(container) {
  return container.querySelector('.mr-picker-trigger').textContent.trim()
}

describe('a saved model that is not in the picker list', () => {
  it('shows the saved model when no row names it', async () => {
    await withDom(async ({ container, root }) => {
      await renderPicker(root, {
        value: SAVED,
        allowDefault: true,
        placeholder: 'Harness default',
      })
      expect(triggerText(container)).toBe(SAVED)
      expect(triggerText(container)).not.toBe('Harness default')
    })
  })

  it('shows the saved model while the list loads', async () => {
    await withDom(async ({ container, root }) => {
      await renderPicker(root, {
        value: SAVED,
        allowDefault: true,
        placeholder: 'Harness default',
        loading: true,
      })
      expect(triggerText(container)).toBe(SAVED)
      expect(triggerText(container)).not.toBe('Harness default')
    })
  })

  it('keeps Harness default for an empty value', async () => {
    await withDom(async ({ container, root }) => {
      await renderPicker(root, {
        value: '',
        allowDefault: true,
        placeholder: 'Harness default',
      })
      expect(triggerText(container)).toBe('Harness default')
    })
  })
})
