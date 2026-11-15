import { act, createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { modesFor } from '../src/control/modes.js'
import OrchestratorChat from '../src/ui/OrchestratorChat.jsx'
import { startConfirmText } from '../src/ui/orchestratorChat.js'
import { buttonWithText, click, type, withDom } from './helpers/uiDom.js'

function fakeClient(calls = []) {
  return {
    orchestrator: async () => ({
      state: 'idle',
      messages: [{ id: 'm1', from: 'owner', text: 'Start.' }],
    }),
    orchestrators: async () => [],
    sendOrchestrator: async (text, options) => {
      calls.push({ text, options })
      return { id: 'm2' }
    },
    subscribe: () => () => {},
  }
}

async function send(container, root, text) {
  await type(root, container.querySelector('.mr-orch-input'), text)
  await act(async () => {
    container.querySelector('.mr-orch-form').dispatchEvent({
      type: 'submit',
      bubbles: true,
      cancelable: true,
    })
  })
}

describe('friendly chat forms', () => {
  it("sets To to a sub's tab when it opens", async () => {
    const list = [
      { id: 'orchestrator', name: 'Main', state: 'idle' },
      { id: 'sub-frontend', name: 'Frontend', state: 'idle' },
    ]
    const calls = []
    await withDom(async ({ container, root }) => {
      await act(async () => {
        root.render(
          createElement(OrchestratorChat, {
            client: fakeClient(calls),
            inline: true,
            initialOrchestrators: list,
          })
        )
      })
      await act(async () => {})
      await click(root, buttonWithText(container, 'Frontend'))
      await send(container, root, 'Fix the header')
      await click(root, buttonWithText(container, 'Main'))
      await send(container, root, 'Fix the footer')
    })
    expect(calls).toEqual([
      { text: 'Fix the header', options: { id: 'sub-frontend' } },
      { text: 'Fix the footer', options: {} },
    ])
  })

  it('names Plan in the start text and not full permissions', () => {
    const text = startConfirmText('C:\\work\\projects\\app', 'claude', 'plan', modesFor('claude'))
    expect(text).toContain('in Plan mode.')
    expect(text).toContain('Reads and plans.')
    expect(text).not.toContain('full permissions')
  })

  it('names Plan in a sub start text and not full permissions', () => {
    const list = [
      { id: 'orchestrator', name: 'Main', state: 'idle' },
      {
        id: 'sub-frontend',
        name: 'Frontend',
        state: 'idle',
        mode: 'plan',
        modes: modesFor('claude'),
      },
    ]
    const html = renderToString(
      createElement(OrchestratorChat, {
        open: true,
        client: fakeClient(),
        initialOrchestrators: list,
        initialSelected: 'sub-frontend',
        initialDraft: 'Build it.',
        initialConfirm: 'start',
      })
    )
    expect(html).toContain('Frontend runs on this project in Plan mode.')
    expect(html).toContain('Reads and plans. Makes no edits and runs no commands.')
    expect(html).not.toContain('full permissions')
  })

  it('draws no Effort control when the harness has no effort levels', () => {
    const html = renderToString(
      createElement(OrchestratorChat, {
        open: true,
        inline: true,
        client: fakeClient(),
        initialChat: { state: 'idle', messages: [] },
        initialOrchestrators: [
          { id: 'orchestrator', name: 'Orchestrator', harness: 'agy', effort: 'high' },
        ],
      })
    )
    expect(html).not.toContain('class="hud-strip-effort"')
    expect(html).not.toContain('Effort:')
  })
})
