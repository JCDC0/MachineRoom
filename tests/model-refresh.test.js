import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import ModelRefresh, { ModelSelect } from '../src/ui/ModelRefresh.jsx'
import {
  filterModelChoices,
  groupModelChoices,
  loadHarnessModels,
  mergeModelChoices,
  modelAnswerError,
  modelChoiceText,
  normalizeModelChoices,
  withHarnessModels,
  withModelRows,
} from '../src/ui/modelRefresh.js'

const MODELS = [
  { id: 'claude-opus', label: 'Claude Opus' },
  { id: 'claude-sonnet', label: 'Claude Sonnet' },
  { id: 'same', label: 'same' },
]

describe('the model refresh helper', () => {
  it('reads ids and labels from a list, an answer or strings', () => {
    expect(normalizeModelChoices(MODELS)).toEqual(MODELS)
    expect(normalizeModelChoices({ models: MODELS })).toEqual(MODELS)
    expect(normalizeModelChoices(['one', ' two ', '', 'one', null])).toEqual([
      { id: 'one', label: 'one' },
      { id: 'two', label: 'two' },
    ])
    expect(normalizeModelChoices(null)).toEqual([])
  })

  it('keeps a saved model that left the list, first and once', () => {
    expect(mergeModelChoices(MODELS, 'gone')).toEqual([{ id: 'gone', label: 'gone' }, ...MODELS])
    expect(mergeModelChoices(MODELS, 'claude-opus')).toEqual(MODELS)
    expect(mergeModelChoices(MODELS, '')).toEqual(MODELS)
    expect(mergeModelChoices(null, 'saved')).toEqual([{ id: 'saved', label: 'saved' }])
  })

  it('groups the current model apart from the rest', () => {
    const groups = groupModelChoices(MODELS, 'claude-sonnet')
    expect(groups.current).toEqual({ id: 'claude-sonnet', label: 'Claude Sonnet' })
    expect(groups.rest.map((row) => row.id)).toEqual(['claude-opus', 'same'])
    expect(groupModelChoices(MODELS, 'gone').current).toEqual({ id: 'gone', label: 'gone' })
    expect(groupModelChoices(MODELS, '').current).toBeNull()
  })

  it('searches the label and the id without case', () => {
    expect(filterModelChoices(MODELS, 'OPUS').map((row) => row.id)).toEqual(['claude-opus'])
    expect(filterModelChoices(MODELS, 'sonnet').map((row) => row.id)).toEqual(['claude-sonnet'])
    expect(filterModelChoices(MODELS, 'claude-').map((row) => row.id)).toEqual([
      'claude-opus',
      'claude-sonnet',
    ])
    expect(filterModelChoices(MODELS, '')).toEqual(MODELS)
    expect(filterModelChoices(MODELS, 'nope')).toEqual([])
  })

  it('writes one label for a native option', () => {
    expect(modelChoiceText({ id: 'claude-opus', label: 'Claude Opus' })).toBe(
      'Claude Opus (claude-opus)'
    )
    expect(modelChoiceText({ id: 'same', label: 'same' })).toBe('same')
    expect(modelChoiceText({ id: 'bare' })).toBe('bare')
  })

  it('reads the answer error and keeps the list it still carries', async () => {
    const calls = []
    const client = {
      harnessModels: async (options) => {
        calls.push(options)
        return {
          harness: 'claude',
          models: MODELS,
          source: 'live',
          error: 'The program is missing.',
        }
      },
    }
    expect(await loadHarnessModels(client, 'claude')).toEqual({
      models: MODELS,
      error: 'The program is missing.',
    })
    expect(calls).toEqual([{ harness: 'claude', refresh: false }])
    expect(await loadHarnessModels(client, 'claude', { refresh: true })).toMatchObject({
      error: 'The program is missing.',
    })
    expect(calls[1]).toEqual({ harness: 'claude', refresh: true })
    expect(modelAnswerError({ models: [] })).toBe('')
    expect(modelAnswerError({ error: '  no models  ' })).toBe('no models')
  })

  it('falls back when the bridge has no method and reports a thrown answer', async () => {
    expect(await loadHarnessModels(null, 'claude')).toEqual({ models: null, error: '' })
    expect(await loadHarnessModels({ models: async () => [] }, 'claude')).toEqual({
      models: null,
      error: '',
    })
    expect(await loadHarnessModels({ harnessModels: async () => [] }, '')).toEqual({
      models: null,
      error: '',
    })
    const failed = {
      harnessModels: async () => {
        throw new Error('The bridge is down.')
      },
    }
    expect(await loadHarnessModels(failed, 'claude', { refresh: true })).toEqual({
      models: null,
      error: 'The bridge is down.',
    })
  })

  it('appends the live rows to the bridge list and to the harness list', () => {
    const models = { models: [{ id: 'old', harness: 'claude', label: 'Old' }] }
    const next = withModelRows(models, MODELS, 'claude')
    expect(next.models.map((row) => row.id)).toEqual([
      'old',
      'claude-opus',
      'claude-sonnet',
      'same',
    ])
    expect(next.models[1].harness).toBe('claude')
    expect(withModelRows(next, MODELS, 'claude')).toEqual(next)

    const harnesses = {
      harnesses: [
        { key: 'claude', name: 'Claude Code', models: [{ id: 'old', label: 'Old' }] },
        { key: 'opencode', name: 'OpenCode', models: [] },
      ],
    }
    const updated = withHarnessModels(harnesses, 'claude', MODELS)
    expect(updated.harnesses[0].models).toEqual(MODELS)
    expect(updated.harnesses[1]).toBe(harnesses.harnesses[1])
    expect(withHarnessModels(harnesses, 'missing', MODELS)).toBe(harnesses)
  })
})

describe('ModelRefresh', () => {
  it('draws the circular arrow with the refresh title', () => {
    const html = renderToString(createElement(ModelRefresh))
    expect(html).toContain('title="Refresh models"')
    expect(html).toContain('aria-label="Refresh models"')
    expect(html).toContain('class="mr-model-refresh"')
    expect(html).toContain('<svg')
    expect(html).not.toContain('is-spinning')
  })

  it('spins and disables itself while it waits', () => {
    const html = renderToString(createElement(ModelRefresh, { loading: true }))
    expect(html).toContain('class="mr-model-refresh is-spinning"')
    expect(html).toContain('aria-busy="true"')
    expect(html).toContain('disabled')
  })
})

describe('ModelSelect', () => {
  it('shows the current model apart from the live list and its answer error', () => {
    const html = renderToString(
      createElement(ModelSelect, {
        value: 'saved',
        choices: MODELS,
        error: 'The program is missing.',
      })
    )
    expect(html).toContain('optgroup label="Current"')
    expect(html).toContain('>saved</option>')
    expect(html).toContain('optgroup label="Models"')
    expect(html).toContain('>Claude Opus (claude-opus)</option>')
    expect(html).toContain('role="alert"')
    expect(html).toContain('The program is missing.')
    expect(html).toContain('title="Refresh models"')
  })

  it('shows the empty sentence and still offers the refresh button', () => {
    const html = renderToString(createElement(ModelSelect, { choices: [] }))
    expect(html).toContain('No models listed for this harness.')
    expect(html).toContain('title="Refresh models"')
    expect(html).not.toContain('<select')
  })
})
