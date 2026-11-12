import { act, createElement } from 'react'
import { describe, expect, it } from 'vitest'
import ModelPicker, {
  MODEL_SORT_STORAGE,
  MODEL_SORTS,
  cleanPickerPins,
  filterPickerRows,
  formatContext,
  formatCreated,
  formatPrice,
  modelDetailMap,
  modelRowParts,
  pickerRows,
  pickerSections,
  sortPickerRows,
} from '../src/ui/ModelPicker.jsx'
import { click, settle, type, withDom } from './helpers/uiDom.js'

const DETAILS = [
  {
    id: 'openai/gpt-5',
    name: 'GPT-5',
    contextLength: 128000,
    promptPrice: 0.00000027,
    completionPrice: 0.0000011,
    created: 1767225600,
  },
  {
    id: 'free/model',
    name: 'Free Model',
    contextLength: 32000,
    promptPrice: 0,
    completionPrice: 0,
    created: 1704067200,
  },
  {
    id: 'old/model',
    name: 'Alpha',
    contextLength: 1000,
    promptPrice: 0.000002,
    completionPrice: 0.000008,
    created: 1600000000,
  },
]

const CHOICES = [
  'openai/gpt-5',
  'free/model',
  'old/model',
  'bare/model',
]

function makeRows() {
  return pickerRows(CHOICES, modelDetailMap(DETAILS))
}

describe('the model picker helpers', () => {
  it('formats a context length, a price per million tokens, a free price and a date', () => {
    expect(formatContext(128000)).toBe('128K')
    expect(formatContext(1000000)).toBe('1M')
    expect(formatContext(1500000)).toBe('1.5M')
    expect(formatContext(900)).toBe('900')
    expect(formatContext(null)).toBe('')
    expect(formatPrice({ promptPrice: 0.00000027, completionPrice: 0.0000011 })).toBe('$0.27 / $1.10')
    expect(formatPrice({ promptPrice: 0, completionPrice: 0 })).toBe('free')
    expect(formatPrice({ promptPrice: null, completionPrice: 0 })).toBe('')
    expect(formatPrice(null)).toBe('')
    expect(formatCreated(1767225600)).toBe('2026-01')
    expect(formatCreated(null)).toBe('')
  })

  it('shows a priced, a free and a bare model with the right parts', () => {
    const rows = makeRows()
    const priced = modelRowParts(rows.find((row) => row.id === 'openai/gpt-5'))
    expect(priced).toEqual({
      name: 'GPT-5',
      id: 'openai/gpt-5',
      hasDetail: true,
      context: '128K',
      price: '$0.27 / $1.10',
      date: '2026-01',
    })
    const free = modelRowParts(rows.find((row) => row.id === 'free/model'))
    expect(free.price).toBe('free')
    expect(free.context).toBe('32K')
    const bare = modelRowParts(rows.find((row) => row.id === 'bare/model'))
    expect(bare).toEqual({
      name: 'bare/model',
      id: 'bare/model',
      hasDetail: false,
      context: '',
      price: '',
      date: '',
    })
  })

  it('searches by name and by id', () => {
    const rows = makeRows()
    expect(filterPickerRows(rows, 'gpt').map((row) => row.id)).toEqual(['openai/gpt-5'])
    expect(filterPickerRows(rows, 'free/').map((row) => row.id)).toEqual(['free/model'])
    expect(filterPickerRows(rows, 'ALPHA').map((row) => row.id)).toEqual(['old/model'])
    expect(filterPickerRows(rows, 'nothing')).toEqual([])
    expect(filterPickerRows(rows, '')).toHaveLength(CHOICES.length)
  })

  it('sorts by each order', () => {
    const rows = makeRows()
    expect(sortPickerRows(rows, 'name-asc').map((row) => row.name)).toEqual([
      'Alpha',
      'bare/model',
      'Free Model',
      'GPT-5',
    ])
    expect(sortPickerRows(rows, 'name-desc').map((row) => row.name)).toEqual([
      'GPT-5',
      'Free Model',
      'bare/model',
      'Alpha',
    ])
    expect(sortPickerRows(rows, 'price-asc').map((row) => row.id)).toEqual([
      'free/model',
      'openai/gpt-5',
      'old/model',
      'bare/model',
    ])
    expect(sortPickerRows(rows, 'price-desc').map((row) => row.id)).toEqual([
      'old/model',
      'openai/gpt-5',
      'free/model',
      'bare/model',
    ])
    expect(sortPickerRows(rows, 'newest').map((row) => row.id)).toEqual([
      'openai/gpt-5',
      'free/model',
      'old/model',
      'bare/model',
    ])
    expect(sortPickerRows(rows, 'context').map((row) => row.id)).toEqual([
      'openai/gpt-5',
      'free/model',
      'old/model',
      'bare/model',
    ])
    expect(MODEL_SORTS.map((entry) => entry.label)).toEqual([
      'Name A to Z',
      'Name Z to A',
      'Price low to high',
      'Price high to low',
      'Newest',
      'Context largest',
    ])
  })

  it('puts the pins first in every sort and the chosen model above them', () => {
    const rows = makeRows()
    for (const entry of MODEL_SORTS) {
      const sections = pickerSections(rows, { sort: entry.id, pins: ['old/model', 'bare/model'] })
      expect(sections[0].label).toBe('Pinned')
      expect(sections[0].rows.map((row) => row.id).sort()).toEqual(['bare/model', 'old/model'])
      expect(sections.slice(1).every((section) => section.rows.every((row) => row.id !== 'bare/model' && row.id !== 'old/model'))).toBe(true)
      expect(sections.flatMap((section) => section.rows)).toHaveLength(rows.length)
    }
    const chosen = pickerSections(rows, { sort: 'name-asc', current: 'free/model', pins: ['old/model'] })
    expect(chosen[0].label).toBe('Current')
    expect(chosen[0].rows.map((row) => row.id)).toEqual(['free/model'])
    expect(chosen[1].label).toBe('Pinned')
    expect(chosen[1].rows.map((row) => row.id)).toEqual(['old/model'])
  })

  it('keeps at most 200 pins of 200 characters', () => {
    expect(cleanPickerPins([' a ', 'a', '', 7, 'b'])).toEqual(['a', 'b'])
    expect(cleanPickerPins(Array.from({ length: 205 }, (_, index) => `m-${index}`))).toHaveLength(200)
    expect(cleanPickerPins(['x'.repeat(201), 'ok'])).toEqual(['ok'])
  })
})

describe('ModelPicker', () => {
  it('opens on the chosen model, shows each row and closes on Escape', async () => {
    await withDom(async ({ container, dom, root }) => {
      await act(async () => {
        root.render(createElement(ModelPicker, { choices: CHOICES, details: DETAILS, value: 'openai/gpt-5' }))
      })
      const trigger = container.querySelector('.mr-picker-trigger')
      expect(trigger.textContent).toContain('GPT-5')
      await click(root, trigger)

      const rows = container.querySelectorAll('.mr-picker-row')
      expect(rows).toHaveLength(4)
      expect(rows.map((row) => row.textContent)).toEqual([
        'GPT-5openai/gpt-5128K$0.27 / $1.102026-01',
        'Alphaold/model1K$2.00 / $8.002020-09',
        'bare/model',
        'Free Modelfree/model32Kfree2024-01',
      ])
      expect(container.querySelector('.mr-picker-group').textContent).toBe('Current')

      const search = container.querySelector('.mr-picker-search')
      expect(dom.document.activeElement).toBe(search)
      await type(root, search, '')
      await act(async () => {
        search.dispatchEvent({ type: 'keydown', key: 'Escape', bubbles: true, cancelable: true })
      })
      expect(container.querySelector('.mr-picker-pop')).toBeNull()
    })
  })

  it('moves with the arrow keys and picks with Enter', async () => {
    const picked = []
    await withDom(async ({ container, root }) => {
      await act(async () => {
        root.render(
          createElement(ModelPicker, {
            choices: CHOICES,
            details: DETAILS,
            onChange: (id) => picked.push(id),
          })
        )
      })
      await click(root, container.querySelector('.mr-picker-trigger'))
      const search = container.querySelector('.mr-picker-search')
      await type(root, search, 'model')
      await act(async () => {
        search.dispatchEvent({ type: 'keydown', key: 'ArrowDown', bubbles: true, cancelable: true })
      })
      expect(container.querySelector('.mr-picker-row.is-active').textContent).toBe('bare/model')
      await act(async () => {
        search.dispatchEvent({ type: 'keydown', key: 'ArrowDown', bubbles: true, cancelable: true })
      })
      expect(container.querySelector('.mr-picker-row.is-active').textContent).toContain('Free Model')
      await act(async () => {
        search.dispatchEvent({ type: 'keydown', key: 'Enter', bubbles: true, cancelable: true })
      })
      expect(picked).toEqual(['free/model'])
      expect(container.querySelector('.mr-picker-pop')).toBeNull()
    })
  })

  it('narrows the list as the owner types and picks with Enter', async () => {
    const picked = []
    await withDom(async ({ container, root }) => {
      await act(async () => {
        root.render(
          createElement(ModelPicker, {
            choices: CHOICES,
            details: DETAILS,
            onChange: (id) => picked.push(id),
          })
        )
      })
      await click(root, container.querySelector('.mr-picker-trigger'))
      const search = container.querySelector('.mr-picker-search')
      await type(root, search, 'gpt')
      expect(container.querySelectorAll('.mr-picker-row')).toHaveLength(1)
      await act(async () => {
        search.dispatchEvent({ type: 'keydown', key: 'Enter', bubbles: true, cancelable: true })
      })
      expect(picked).toEqual(['openai/gpt-5'])
    })
  })

  it('loads the pins, saves a pin and keeps the sort in localStorage', async () => {
    const saved = []
    const client = {
      modelPins: async () => ['free/model'],
      saveModelPins: async (payload) => {
        saved.push(payload)
        return { ok: true, pins: payload.pins }
      },
    }
    await withDom(async ({ container, dom, root }) => {
      await act(async () => {
        root.render(createElement(ModelPicker, { choices: CHOICES, details: DETAILS, client }))
      })
      await click(root, container.querySelector('.mr-picker-trigger'))
      await settle()
      const pinnedRow = container.querySelectorAll('.mr-picker-row').find((row) => row.textContent.includes('Free Model'))
      expect(pinnedRow.querySelector('.mr-picker-pin').getAttribute('aria-pressed')).toBe('true')

      const gptRow = container.querySelectorAll('.mr-picker-row').find((row) => row.textContent.includes('GPT-5'))
      await click(root, gptRow.querySelector('.mr-picker-pin'))
      await settle()
      expect(saved).toEqual([{ pins: ['free/model', 'openai/gpt-5'] }])

      const sort = container.querySelector('.mr-picker-sort')
      await act(async () => {
        sort.value = 'price-desc'
        sort.dispatchEvent({ type: 'change', bubbles: true, cancelable: true })
      })
      expect(dom.window.localStorage.getItem(MODEL_SORT_STORAGE)).toBe('price-desc')
      expect(MODEL_SORT_STORAGE).toBe('machineroom.modelSort')
    })
  })

  it('disables pinning until the saved pins load and keeps them in the next save', async () => {
    let resolvePins
    const pending = new Promise((resolve) => { resolvePins = resolve })
    const saved = []
    const client = {
      modelPins: () => pending,
      saveModelPins: async (payload) => { saved.push(payload) },
    }
    await withDom(async ({ container, root }) => {
      await act(async () => {
        root.render(createElement(ModelPicker, { choices: CHOICES, details: DETAILS, client }))
      })
      await click(root, container.querySelector('.mr-picker-trigger'))
      const pin = container.querySelector('[aria-label="Pin GPT-5"]')
      expect(pin.hasAttribute('disabled')).toBe(true)
      await click(root, pin)
      expect(saved).toEqual([])

      await act(async () => { resolvePins(['free/model', 'saved/hidden']) })
      expect(container.querySelector('[aria-label="Pin GPT-5"]').hasAttribute('disabled')).toBe(false)
      await click(root, container.querySelector('[aria-label="Pin GPT-5"]'))
      expect(saved).toEqual([{ pins: ['free/model', 'saved/hidden', 'openai/gpt-5'] }])
    })
  })

  it('retries a cancelled pin read on opening and ignores its late answer', async () => {
    const reads = []
    const saved = []
    const client = {
      modelPins: () => new Promise((resolve) => { reads.push(resolve) }),
      saveModelPins: async (payload) => { saved.push(payload) },
    }
    await withDom(async ({ container, root }) => {
      await act(async () => {
        root.render(createElement(ModelPicker, { choices: CHOICES, details: DETAILS, client }))
      })
      const trigger = container.querySelector('.mr-picker-trigger')
      await click(root, trigger)
      await click(root, trigger)
      await click(root, trigger)
      expect(reads).toHaveLength(2)
      expect(container.querySelector('[aria-label="Pin GPT-5"]').hasAttribute('disabled')).toBe(true)
      await act(async () => { reads[1](['free/model']) })
      await act(async () => { reads[0](['old/model']) })
      await click(root, container.querySelector('[aria-label="Pin GPT-5"]'))
      expect(saved).toEqual([{ pins: ['free/model', 'openai/gpt-5'] }])
    })
  })

  it('keeps pins disabled after a failed read and retries on opening', async () => {
    let attempts = 0
    const saved = []
    const client = {
      modelPins: async () => {
        attempts += 1
        if (attempts === 1) throw new Error('Read failed')
        return ['free/model']
      },
      saveModelPins: async (payload) => { saved.push(payload) },
    }
    await withDom(async ({ container, root }) => {
      await act(async () => {
        root.render(createElement(ModelPicker, { choices: CHOICES, details: DETAILS, client }))
      })
      const trigger = container.querySelector('.mr-picker-trigger')
      await click(root, trigger)
      const pin = container.querySelector('[aria-label="Pin GPT-5"]')
      expect(pin.hasAttribute('disabled')).toBe(true)
      await click(root, pin)
      expect(saved).toEqual([])
      await click(root, trigger)
      await click(root, trigger)
      expect(attempts).toBe(2)
      expect(container.querySelector('[aria-label="Pin GPT-5"]').hasAttribute('disabled')).toBe(false)
      await click(root, container.querySelector('[aria-label="Pin GPT-5"]'))
      expect(saved).toEqual([{ pins: ['free/model', 'openai/gpt-5'] }])
    })
  })

  it('reads the endpoint details when the picker opens', async () => {
    const client = {
      endpoints: async () => [
        {
          name: 'OpenRouter Work',
          models: ['openai/gpt-5'],
          modelDetails: DETAILS,
        },
      ],
    }
    await withDom(async ({ container, root }) => {
      await act(async () => {
        root.render(createElement(ModelPicker, { choices: ['OpenRouter Work/openai/gpt-5'], client }))
      })
      await click(root, container.querySelector('.mr-picker-trigger'))
      await settle()
      expect(container.querySelector('.mr-picker-row').textContent).toContain('GPT-5')
      expect(container.querySelector('.mr-picker-row').textContent).toContain('128K')
    })
  })
})
