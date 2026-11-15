import { act, createElement } from 'react'
import { describe, expect, it } from 'vitest'
import FamilyTeam from '../src/ui/FamilyTeam.jsx'
import { buttonWithText, click, settle, type, withDom } from './helpers/uiDom.js'

const HARNESSES = {
  harnesses: [
    {
      key: 'opencode',
      name: 'OpenCode',
      available: true,
      models: [
        { id: 'opencode-go/deepseek-v4.1-flash', label: 'DeepSeek V4.1 Flash' },
        { id: 'openrouter/anthropic/claude-opus-4.6', label: 'Claude Opus 4.6' },
      ],
    },
    {
      key: 'claude',
      name: 'Claude Code',
      available: true,
      models: [{ id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6' }],
    },
  ],
}

const LANES = {
  lanes: [
    { key: 'alpha', name: 'Alpha', harness: 'opencode', active: true },
    { key: 'beta', name: 'Beta', harness: 'opencode', active: true },
    { key: 'gamma', name: 'Gamma', harness: 'claude', active: true },
  ],
}

function makeClient({
  harnessModels = null,
  pins = ['openrouter/anthropic/claude-opus-4.6'],
  endpoints = [],
} = {}) {
  const calls = {
    harnessModels: [],
    modelPins: 0,
    saveModelPins: [],
    endpoints: 0,
    setLadder: [],
    setAgentLabel: [],
  }
  const subs = []
  const client = {
    lanes: async () => LANES,
    orchestrators: async () => [{ id: 'orchestrator', name: 'Orchestrator', ladder: { subs } }],
    harnesses: async () => HARNESSES,
    models: async () => ({ models: [] }),
    harnessModels: async (options = {}) => {
      calls.harnessModels.push(options)
      if (harnessModels) return harnessModels(options)
      const row = HARNESSES.harnesses.find((entry) => entry.key === options.harness)
      return { harness: options.harness, models: row?.models ?? [] }
    },
    modelPins: async () => {
      calls.modelPins += 1
      return pins
    },
    saveModelPins: async (payload) => {
      calls.saveModelPins.push(payload)
      return { ok: true, pins: payload.pins }
    },
    endpoints: async () => {
      calls.endpoints += 1
      return endpoints
    },
    setLadder: async (payload) => {
      calls.setLadder.push(payload)
      subs.splice(0, subs.length, ...(payload?.subs ?? []))
      return { ok: true }
    },
    setAgentLabel: async (payload) => {
      calls.setAgentLabel.push(payload)
      return { ok: true }
    },
  }
  return { client, calls }
}

async function openTeamForm(root, container) {
  await settle()
  await click(root, container.querySelector('.mr-team').querySelector('.mr-side-head'))
  await settle()
}

describe('Build a team ModelPicker', () => {
  it('renders a ModelPicker with search, pins, details and refresh', async () => {
    const { client, calls } = makeClient({
      endpoints: [
        {
          name: 'openrouter',
          models: ['anthropic/claude-opus-4.6'],
          modelDetails: [
            {
              id: 'anthropic/claude-opus-4.6',
              name: 'Claude Opus 4.6',
              contextLength: 200000,
              promptPrice: 0.000005,
              completionPrice: 0.000025,
              created: 1767225600,
            },
          ],
        },
      ],
      harnessModels: ({ harness, refresh }) => {
        if (harness === 'opencode' && refresh) {
          return {
            harness,
            models: [
              { id: 'opencode-go/deepseek-v4.1-flash', label: 'DeepSeek V4.1 Flash' },
              { id: 'openrouter/anthropic/claude-opus-4.6', label: 'Claude Opus 4.6' },
              { id: 'openai/gpt-5.4', label: 'GPT-5.4' },
            ],
          }
        }
        const row = HARNESSES.harnesses.find((entry) => entry.key === harness)
        return { harness, models: row?.models ?? [] }
      },
    })

    await withDom(async ({ container, root }) => {
      await act(async () => {
        root.render(createElement(FamilyTeam, { client }))
      })
      await openTeamForm(root, container)

      const form = container.querySelector('.mr-team-form')
      expect(form.querySelector('select[aria-label="Model for the new sub orchestrators"]')).toBeNull()

      const picker = form.querySelector('.mr-picker')
      expect(picker).not.toBeNull()
      const trigger = picker.querySelector('button.mr-picker-trigger[aria-label="Model for the new sub orchestrators"]')
      expect(trigger).not.toBeNull()
      expect(trigger.textContent).toContain('DeepSeek V4.1 Flash')

      await click(root, trigger)
      await settle()
      expect(calls.modelPins).toBe(1)
      expect(calls.endpoints).toBe(1)
      expect(form.querySelector('.mr-picker-pop')).not.toBeNull()
      expect(form.querySelector('.mr-picker-search')).not.toBeNull()
      expect(form.querySelector('.mr-picker-sort')).not.toBeNull()
      const opusRow = form
        .querySelectorAll('.mr-picker-row')
        .find((row) => row.textContent.includes('Claude Opus 4.6'))
      expect(opusRow.textContent).toContain('200K')

      const pinButton = form
        .querySelectorAll('.mr-picker-pin')
        .find((button) => button.getAttribute('aria-label') === 'Pin DeepSeek V4.1 Flash')
      expect(pinButton).not.toBeNull()
      await click(root, pinButton)
      await settle()
      expect(calls.saveModelPins).toEqual([
        { pins: ['openrouter/anthropic/claude-opus-4.6', 'opencode-go/deepseek-v4.1-flash'] },
      ])

      await click(root, form.querySelector('button[aria-label="Refresh models"]'))
      await settle()
      expect(calls.harnessModels.some((entry) => entry.harness === 'opencode' && entry.refresh === true)).toBe(true)
      expect(
        form
          .querySelectorAll('.mr-picker-pick')
          .some((button) => button.getAttribute('title') === 'openai/gpt-5.4')
      ).toBe(true)
    })
  })

  it('puts the picked model id into the team plan', async () => {
    const { client, calls } = makeClient()

    await withDom(async ({ container, root }) => {
      await act(async () => {
        root.render(createElement(FamilyTeam, { client }))
      })
      await openTeamForm(root, container)

      const form = container.querySelector('.mr-team-form')
      const trigger = form.querySelector('.mr-picker-trigger[aria-label="Model for the new sub orchestrators"]')
      expect(trigger).not.toBeNull()
      await click(root, trigger)
      await settle()

      const search = form.querySelector('.mr-picker-search')
      await type(root, search, 'opus')
      await act(async () => {
        search.dispatchEvent({ type: 'keydown', key: 'Enter', bubbles: true, cancelable: true })
      })

      expect(form.querySelector('.mr-picker-pop')).toBeNull()
      expect(trigger.textContent).toContain('Claude Opus 4.6')

      await act(async () => {
        form.dispatchEvent({ type: 'submit', bubbles: true, cancelable: true })
      })
      const card = container.querySelector('.mr-side-confirm-card')
      await click(root, buttonWithText(card, 'Build the team'))
      await settle()

      expect(calls.setLadder).toHaveLength(1)
      expect(calls.setLadder[0].subs).toEqual([
        expect.objectContaining({
          id: 'team-1',
          harness: 'opencode',
          model: 'openrouter/anthropic/claude-opus-4.6',
        }),
      ])
    })
  })

  it('keeps the preview and Save behaving as before after picking a model', async () => {
    const { client, calls } = makeClient()

    await withDom(async ({ container, root }) => {
      await act(async () => {
        root.render(createElement(FamilyTeam, { client }))
      })
      await openTeamForm(root, container)

      const form = container.querySelector('.mr-team-form')
      const trigger = form.querySelector('.mr-picker-trigger[aria-label="Model for the new sub orchestrators"]')
      expect(trigger).not.toBeNull()
      await click(root, trigger)
      await settle()

      const option = form
        .querySelectorAll('.mr-picker-pick')
        .find((button) => button.getAttribute('title') === 'openrouter/anthropic/claude-opus-4.6')
      expect(option).not.toBeNull()
      await click(root, option)

      const countSelect = form.querySelector('select[aria-label="Orchestrators under the main"]')
      await act(async () => {
        countSelect.value = '2'
        countSelect.dispatchEvent({ type: 'change', bubbles: true, cancelable: true })
      })

      const previewNames = form.querySelectorAll('.mr-team-preview-name').map((node) => node.textContent)
      const previewLanes = form.querySelectorAll('.mr-team-preview-lanes').map((node) => node.textContent)
      expect(previewNames).toEqual(['Team 1', 'Team 2'])
      expect(previewLanes).toEqual(['Alpha', 'Beta'])

      await act(async () => {
        form.dispatchEvent({ type: 'submit', bubbles: true, cancelable: true })
      })
      const card = container.querySelector('.mr-side-confirm-card')
      expect(card.textContent).toContain('Build 2 sub orchestrators?')
      expect(card.textContent).toContain('Team 1')
      expect(card.textContent).toContain('Team 2')
      expect(card.textContent).toContain('Alpha')
      expect(card.textContent).toContain('Beta')

      await click(root, buttonWithText(card, 'Build the team'))
      await settle()

      expect(calls.setLadder).toHaveLength(1)
      expect(calls.setLadder[0].subs).toEqual([
        expect.objectContaining({
          id: 'team-1',
          name: 'Team 1',
          harness: 'opencode',
          model: 'openrouter/anthropic/claude-opus-4.6',
          lanes: ['alpha'],
          scope: ['**'],
          restricted: false,
          setBy: 'owner',
        }),
        expect.objectContaining({
          id: 'team-2',
          name: 'Team 2',
          harness: 'opencode',
          model: 'openrouter/anthropic/claude-opus-4.6',
          lanes: ['beta'],
          scope: ['**'],
          restricted: false,
          setBy: 'owner',
        }),
      ])
      expect(calls.setAgentLabel).toEqual([
        { id: 'team-1', label: 'Team 1', confirmed: true },
        { id: 'team-2', label: 'Team 2', confirmed: true },
      ])
      expect(container.querySelector('.mr-team-form')).toBeNull()
    })
  })

  it('refreshes models and shows model read errors inside the picker after switching harness', async () => {
    let failRefresh = false
    const { client, calls } = makeClient({
      harnessModels: ({ harness, refresh }) => {
        if (harness === 'claude' && refresh && failRefresh) {
          return { harness, models: [], error: 'Could not read Claude models.' }
        }
        if (harness === 'claude' && refresh) {
          return {
            harness,
            models: [
              { id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6' },
              { id: 'claude-opus-4-6', label: 'Claude Opus 4.6' },
            ],
          }
        }
        const row = HARNESSES.harnesses.find((entry) => entry.key === harness)
        return { harness, models: row?.models ?? [] }
      },
    })

    await withDom(async ({ container, root }) => {
      await act(async () => {
        root.render(createElement(FamilyTeam, { client }))
      })
      await openTeamForm(root, container)

      const form = container.querySelector('.mr-team-form')
      const harnessSelect = form.querySelector('select[aria-label="Harness for the new sub orchestrators"]')
      await act(async () => {
        harnessSelect.value = 'claude'
        harnessSelect.dispatchEvent({ type: 'change', bubbles: true, cancelable: true })
      })
      await settle()

      const trigger = form.querySelector('.mr-picker-trigger[aria-label="Model for the new sub orchestrators"]')
      expect(trigger).not.toBeNull()
      expect(trigger.textContent).toContain('Claude Sonnet 4.6')

      await click(root, form.querySelector('button[aria-label="Refresh models"]'))
      await settle()
      await click(root, trigger)
      await settle()

      const opus = form
        .querySelectorAll('.mr-picker-pick')
        .find((button) => button.getAttribute('title') === 'claude-opus-4-6')
      expect(opus).not.toBeNull()
      await click(root, opus)
      expect(trigger.textContent).toContain('Claude Opus 4.6')

      failRefresh = true
      await click(root, form.querySelector('button[aria-label="Refresh models"]'))
      await settle()
      expect(form.querySelector('.mr-picker').querySelector('.mr-model-error[role="alert"]').textContent).toBe(
        'Could not read Claude models.'
      )

      await act(async () => {
        form.dispatchEvent({ type: 'submit', bubbles: true, cancelable: true })
      })
      await click(root, buttonWithText(container.querySelector('.mr-side-confirm-card'), 'Build the team'))
      await settle()

      expect(calls.setLadder[0].subs).toEqual([
        expect.objectContaining({
          harness: 'claude',
          model: 'claude-opus-4-6',
        }),
      ])
    })
  })
})
