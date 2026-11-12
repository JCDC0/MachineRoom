import { readFileSync } from 'node:fs'
import { act, createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import Hud from '../src/ui/Hud.jsx'
import OrchestratorChat, { pruneOrchestratorRecord } from '../src/ui/OrchestratorChat.jsx'
import Waiting from '../src/ui/Waiting.jsx'
import { buttonWithText, click, type, withDom } from './helpers/uiDom.js'
import {
  ORCH_STOP_CONFIRM,
  OrchestratorActivity,
  TEAM_TAB,
  approvalInputText,
  approvalTitle,
  canSend,
  charCount,
  chatBlocks,
  chatLines,
  clampDraft,
  copyChatText,
  isSendKey,
  listsOrchestrator,
  modeClass,
  modeLabel,
  nearChatBottom,
  needsStartConfirm,
  normalizeApprovals,
  normalizeChat,
  normalizeModes,
  orchestratorDoing,
  projectBaseName,
  retryTarget,
  sendChatMessage,
  startConfirmText,
  statusDetail,
  statusText,
  statusTone,
  teamLines,
  workRows,
  workText,
} from '../src/ui/orchestratorChat.js'

function textOf(spans) {
  return spans.map((span) => span.text).join('')
}

const SNAPSHOT = {
  position: 0,
  duration: 0,
  playing: false,
  speed: 1,
  agents: [],
  log: [],
}

function fakeClient(chat = { state: 'idle', messages: [] }) {
  const calls = []
  return {
    calls,
    orchestrator: async () => chat,
    orchestrators: async () => [],
    setLadder: async (ladder) => {
      calls.push({ name: 'ladder', ladder })
      return { ladder }
    },
    sendToOrchestrator: async (text, options) => {
      calls.push({ name: 'send', text, options })
      return { id: 'message-1' }
    },
    stopOrchestrator: async (options) => {
      calls.push({ name: 'stop', options })
      return { ok: true }
    },
    subscribe: () => () => {},
  }
}

describe('orchestratorChat helpers', () => {
  it('gives the status line for each state', () => {
    expect(statusText('working')).toBe('Orchestrator is working')
    expect(statusText('idle')).toBe('Orchestrator is waiting for you')
    expect(statusText('paused')).toBe('Paused')
    expect(statusText(undefined)).toBe('Orchestrator is waiting for you')
    expect(statusText('something else')).toBe('Orchestrator is waiting for you')
  })

  it('gives a tone for each state', () => {
    expect(statusTone('working')).toBe('working')
    expect(statusTone('paused')).toBe('paused')
    expect(statusTone('idle')).toBe('waiting')
    expect(statusTone('other')).toBe('waiting')
  })

  it('keeps the lines that hold text, masks control characters and keeps new lines', () => {
    const lines = chatLines({
      messages: [
        { id: 'a', from: 'owner', text: '  Build the page  ' },
        { id: 'b', from: 'orchestrator', text: 'What name?\nLine two' },
        { id: 'c', from: 'room', text: 'Run x ended: succeeded.' },
        { id: 'd', from: 'owner', text: '   ' },
        { from: 'orchestrator', text: 'Hidden \u202Etext' },
        { text: 42 },
        null,
      ],
    })
    expect(lines).toHaveLength(4)
    expect(lines[0]).toMatchObject({ id: 'a', from: 'owner', text: 'Build the page' })
    expect(lines[1].text).toBe('What name?\nLine two')
    expect(lines[2]).toMatchObject({ from: 'room', text: 'Run x ended: succeeded.' })
    expect(lines[3].text).toBe('Hidden [U+202E]text')
    expect(lines[3].from).toBe('orchestrator')
  })

  it('labels a sub orchestrator report with its id', () => {
    const lines = chatLines({
      messages: [
        { id: 's1', from: 'sub:frontend', text: 'Done.' },
        { id: 's2', from: 'sub:', text: 'No id.' },
      ],
    })
    expect(lines).toHaveLength(2)
    expect(lines[0]).toMatchObject({ id: 's1', from: 'sub', text: 'Sub frontend\n\nDone.' })
    expect(lines[1]).toMatchObject({ id: 's2', from: 'orchestrator', text: 'No id.' })
  })

  it('marks a sub chat message from the main without marking the main tab', () => {
    const chat = {
      messages: [
        { id: 's1', from: 'orchestrator', text: 'Write the header.' },
        { id: 's2', from: 'main', text: 'Then the footer.' },
        { id: 's3', from: 'owner', text: 'Keep going.' },
      ],
    }
    const sub = chatLines(chat, undefined, { id: 'frontend' })
    expect(sub.map((line) => line.fromMain)).toEqual([true, true, false])
    expect(sub[0].from).toBe('orchestrator')
    expect(sub[1].from).toBe('orchestrator')
    const main = chatLines(chat, undefined, { id: 'orchestrator' })
    expect(main.map((line) => line.fromMain)).toEqual([false, false, false])
    expect(chatLines(chat).map((line) => line.fromMain)).toEqual([false, false, false])
  })

  it('shows the newest lines only, up to the requested limit', () => {
    const messages = Array.from({ length: 5 }, (_, index) => ({
      id: `m${index}`,
      from: 'owner',
      text: `Line ${index}`,
    }))
    expect(chatLines({ messages }, 2).map((line) => line.text)).toEqual(['Line 3', 'Line 4'])
    expect(chatLines({ messages })).toHaveLength(5)
    expect(chatLines(null)).toEqual([])
    expect(chatLines({ messages: 'no' })).toEqual([])
  })

  it('counts characters past 7000 and stops the draft at 8000', () => {
    expect(charCount('')).toBe('')
    expect(charCount('a'.repeat(7000))).toBe('')
    expect(charCount('a'.repeat(7001))).toBe('7001 / 8000')
    expect(charCount('a'.repeat(8000))).toBe('8000 / 8000')
    expect(charCount(null)).toBe('')
    expect(clampDraft('a'.repeat(9000))).toHaveLength(8000)
    expect(clampDraft('short')).toBe('short')
    expect(clampDraft(null)).toBe('')
  })

  it('sends between 1 and 8000 characters after trimming', () => {
    expect(canSend('a')).toBe(true)
    expect(canSend('  Build it  ')).toBe(true)
    expect(canSend('a'.repeat(8000))).toBe(true)
    expect(canSend('a'.repeat(8001))).toBe(false)
    expect(canSend('   ')).toBe(false)
    expect(canSend('')).toBe(false)
    expect(canSend(null)).toBe(false)
  })

  it('asks for the confirm card only before the first owner message', () => {
    expect(needsStartConfirm({ messages: [] })).toBe(true)
    expect(needsStartConfirm(null)).toBe(true)
    expect(needsStartConfirm({ messages: [{ from: 'room', text: 'Run ended.' }] })).toBe(true)
    expect(
      needsStartConfirm({
        messages: [
          { from: 'orchestrator', text: 'What do you want?' },
          { from: 'owner', text: '   ' },
        ],
      })
    ).toBe(true)
    expect(needsStartConfirm({ messages: [{ from: 'owner', text: 'Build it.' }] })).toBe(false)
  })

  it('sends on Enter but not on Shift+Enter or while composing', () => {
    expect(isSendKey({ key: 'Enter' })).toBe(true)
    expect(isSendKey({ key: 'Enter', shiftKey: true })).toBe(false)
    expect(isSendKey({ key: 'Enter', ctrlKey: true })).toBe(false)
    expect(isSendKey({ key: 'Enter', metaKey: true })).toBe(false)
    expect(isSendKey({ key: 'Enter', altKey: true })).toBe(false)
    expect(isSendKey({ key: 'Enter', isComposing: true })).toBe(false)
    expect(isSendKey({ key: 'Enter', nativeEvent: { isComposing: true } })).toBe(false)
    expect(isSendKey({ key: 'a' })).toBe(false)
    expect(isSendKey(null)).toBe(false)
  })

  it('normalises the read and fills the default state', () => {
    expect(normalizeChat(null)).toEqual({
      state: 'idle',
      model: '',
      project: '',
      messages: [],
      mode: '',
      modes: [],
      approvals: [],
    })
    expect(normalizeChat({ state: 'nope', messages: 'no' })).toEqual({
      state: 'idle',
      model: '',
      project: '',
      messages: [],
      mode: '',
      modes: [],
      approvals: [],
    })
    const chat = normalizeChat({
      state: 'paused',
      model: ' opus ',
      project: 'C:\\Users\\<name>\\work\\app',
      messages: [{ from: 'owner', text: 'Hi' }],
    })
    expect(chat.state).toBe('paused')
    expect(chat.model).toBe('opus')
    expect(chat.project).toBe('C:\\Users\\<name>\\work\\app')
    expect(chat.messages).toHaveLength(1)
  })

  it('finds an orchestrator in the agent list by key, name or role', () => {
    expect(listsOrchestrator([{ key: 'opencode', name: 'OpenCode' }])).toBe(false)
    expect(listsOrchestrator([{ key: 'orchestrator', name: 'Orchestrator' }])).toBe(true)
    expect(listsOrchestrator([{ key: 'boss', name: 'Boss', role: 'ceo' }])).toBe(true)
    expect(listsOrchestrator([{ key: 'boss', name: 'Boss', orchestrator: true }])).toBe(true)
    expect(listsOrchestrator(null)).toBe(false)
  })

  it('names the current command on the working line only', () => {
    expect(statusDetail('working', 'npm test')).toBe('Orchestrator is working: npm test')
    expect(statusDetail('working', '  ')).toBe('Orchestrator is working')
    expect(statusDetail('idle', 'npm test')).toBe('Orchestrator is waiting for you')
    expect(statusDetail('paused', 'npm test')).toBe('Paused')
  })

  it('reads the orchestrator command from the room state', () => {
    expect(orchestratorDoing([{ key: 'orchestrator', status: 'working', label: 'npm test' }])).toBe(
      'npm test'
    )
    expect(orchestratorDoing([{ key: 'orchestrator', status: 'queued', label: 'npm run build' }])).toBe(
      'npm run build'
    )
    expect(orchestratorDoing([{ key: 'orchestrator', status: 'done', label: 'done' }])).toBe('')
    expect(orchestratorDoing([{ key: 'opencode', status: 'working', label: 'npm test' }])).toBe('')
    expect(orchestratorDoing([])).toBe('')
    expect(orchestratorDoing(null)).toBe('')
  })
})

const MODES = [
  { id: 'plan', label: 'Plan', line: 'Read and plan only.' },
  { id: 'ask', label: 'Ask', line: 'Every write or command waits for you.' },
  { id: 'edits', label: 'Edits', line: 'Edits files, runs no commands.' },
  { id: 'auto', label: 'Auto', line: 'Edits and commands, with a guard.' },
  { id: 'bypass', label: 'Bypass', line: 'Everything is allowed.' },
]

describe('the permission modes', () => {
  it('keeps the known modes in order and drops a bad or repeated one', () => {
    expect(normalizeModes(MODES).map((entry) => entry.id)).toEqual([
      'plan',
      'ask',
      'edits',
      'auto',
      'bypass',
    ])
    expect(
      normalizeModes([
        { id: 'bypass', label: ' Bypass ', line: ' Allowed. ' },
        { id: 'nope', label: 'No' },
        { id: 'bypass', label: 'Again' },
        null,
        'auto',
      ])
    ).toEqual([{ id: 'bypass', label: 'Bypass', line: 'Allowed.' }])
    expect(normalizeModes(null)).toEqual([])
  })

  it('reads the saved mode and the mode classes', () => {
    const chat = normalizeChat({ mode: 'auto', modes: MODES })
    expect(chat.mode).toBe('auto')
    expect(chat.modes).toHaveLength(5)
    expect(normalizeChat({ mode: 'unknown' }).mode).toBe('')
    expect(modeClass('plan')).toBe('is-mode-plan')
    expect(modeClass('bypass')).toBe('is-mode-bypass')
    expect(modeClass('')).toBe('')
    expect(modeLabel(MODES, 'edits')).toBe('Edits')
    expect(modeLabel(MODES, 'unknown')).toBe('')
  })

  it('reads an approval and shows its input as text', () => {
    expect(
      normalizeApprovals([
        { approvalId: 'a1', tool: 'shell', input: { command: 'npm test' }, at: '2026-11-09T10:00:00.000Z' },
        { approvalId: '', tool: 'shell' },
        null,
      ])
    ).toEqual([
      {
        approvalId: 'a1',
        tool: 'shell',
        input: { command: 'npm test' },
        at: '2026-11-09T10:00:00.000Z',
      },
    ])
    expect(approvalTitle('Orchestrator', 'shell')).toBe('ORCHESTRATOR wants to use shell')
    expect(approvalTitle('', '')).toBe('ORCHESTRATOR wants to use a tool')
    expect(approvalInputText({ command: 'npm test' })).toBe(
      '{\n  "command": "npm test"\n}'
    )
    expect(approvalInputText('plain')).toBe('plain')
  })

  it('leaves the Mode row out with fewer than two modes or no setter', () => {
    const chat = { state: 'idle', mode: 'plan', modes: MODES.slice(0, 1), messages: [] }
    const one = renderToString(
      createElement(OrchestratorChat, {
        open: true,
        inline: true,
        client: { ...fakeClient(chat), setOrchestratorMode: async () => ({}) },
        initialChat: chat,
      })
    )
    expect(one).not.toContain('class="hud-strip-mode"')

    const full = { state: 'idle', mode: 'plan', modes: MODES, messages: [] }
    const readOnly = renderToString(
      createElement(OrchestratorChat, { open: true, inline: true, client: fakeClient(full), initialChat: full })
    )
    expect(readOnly).not.toContain('class="hud-strip-mode"')

    const ready = renderToString(
      createElement(OrchestratorChat, {
        open: true,
        inline: true,
        client: { ...fakeClient(full), setOrchestratorMode: async () => ({}) },
        initialChat: full,
      })
    )
    expect(ready).toContain('class="hud-strip-mode"')
    expect(ready).toContain('Mode:')
    expect(ready).toContain('Plan')
  })

  it('marks the chat with the mode frame class and draws none without a mode', () => {
    const chat = { state: 'idle', mode: 'bypass', modes: MODES, messages: [] }
    const html = renderToString(
      createElement(OrchestratorChat, { open: true, client: fakeClient(chat), initialChat: chat })
    )
    expect(html).toContain('class="mr-orch is-mode-bypass"')
    const none = renderToString(
      createElement(OrchestratorChat, {
        open: true,
        client: fakeClient({ state: 'idle', messages: [] }),
        initialChat: { state: 'idle', messages: [] },
      })
    )
    expect(none).toContain('class="mr-orch"')
    expect(none).not.toContain('is-mode-')
  })

  it('sets a plain mode at once and says it applies from the next turn', async () => {
    vi.useFakeTimers()
    const calls = []
    const chat = { state: 'idle', mode: 'plan', modes: MODES, messages: [] }
    const client = {
      ...fakeClient(chat),
      setOrchestratorMode: async (options) => {
        calls.push(options)
        return { mode: options.mode }
      },
    }
    try {
      await withDom(async ({ container, root }) => {
        await act(async () => {
          root.render(
            createElement(OrchestratorChat, {
              client,
              inline: true,
              initialChat: chat,
              onClose: () => {},
            })
          )
        })
        await act(async () => {})
        await click(root, container.querySelector('.hud-strip-mode'))
        const choices = [...container.querySelectorAll('.mr-mode-choice')]
        expect(choices.map((button) => button.querySelector('.mr-mode-choice-label').textContent)).toEqual([
          'Plan',
          'Ask',
          'Edits',
          'Auto',
          'Bypass',
        ])
        expect(choices[0].querySelector('.mr-mode-choice-line').textContent).toBe('Read and plan only.')
        const edits = choices.find((button) => button.textContent.includes('Edits'))
        await click(root, edits)
        expect(calls).toEqual([{ id: 'orchestrator', mode: 'edits', confirmed: true }])
        expect(container.querySelector('.mr-orch').className).toContain('is-mode-edits')
        expect(container.querySelector('.mr-mode-note').textContent).toBe(
          'Applies from the next turn.'
        )
        await act(async () => {
          await vi.advanceTimersByTimeAsync(4000)
        })
        expect(container.querySelector('.mr-mode-note')).toBeNull()
      })
    } finally {
      vi.useRealTimers()
    }
  })

  it('asks before Bypass with Cancel first and closes only the card on Escape', async () => {
    const calls = []
    const closed = []
    const chat = { state: 'idle', mode: 'auto', modes: MODES, messages: [] }
    const client = {
      ...fakeClient(chat),
      setOrchestratorMode: async (options) => {
        calls.push(options)
        return { mode: options.mode }
      },
    }
    await withDom(async ({ container, root, dom }) => {
      await act(async () => {
        root.render(
          createElement(OrchestratorChat, {
            client,
            inline: true,
            initialChat: chat,
            initialOrchestrators: [{ id: 'orchestrator', name: 'Orchestrator', harness: 'claude' }],
            onClose: () => closed.push(true),
          })
        )
      })
      await act(async () => {})
      await click(root, container.querySelector('.hud-strip-mode'))
      const bypass = container
        .querySelectorAll('.mr-mode-choice')
        .find((button) => button.textContent.includes('Bypass'))
      await click(root, bypass)
      const card = container.querySelector('.mr-orch-confirm[aria-label="Set the mode"]')
      expect(card).not.toBeNull()
      expect(card.textContent).toContain(
        'Let ORCHESTRATOR run any command and edit any file without asking?'
      )
      expect(buttonWithText(card, 'Cancel')).not.toBeNull()
      expect(buttonWithText(card, 'Use Bypass')).not.toBeNull()
      expect(card.querySelector('button').textContent.trim()).toBe('Cancel')
      expect(dom.document.activeElement.textContent.trim()).toBe('Cancel')
      expect(calls).toEqual([])
      const escape = { type: 'keydown', key: 'Escape', bubbles: true, cancelable: true }
      await act(async () => {
        dom.window.dispatchEvent(escape)
      })
      expect(container.querySelector('.mr-orch-confirm[aria-label="Set the mode"]')).toBeNull()
      expect(container.querySelector('.mr-orch')).not.toBeNull()
      expect(closed).toEqual([])
      expect(calls).toEqual([])
    })
  })

  it('shows the sentence a refused mode answers with', async () => {
    const chat = { state: 'idle', mode: 'auto', modes: MODES, messages: [] }
    const client = {
      ...fakeClient(chat),
      setOrchestratorMode: async () => {
        throw new Error('A turn is running. Try again when it ends.')
      },
    }
    await withDom(async ({ container, root }) => {
      await act(async () => {
        root.render(createElement(OrchestratorChat, { client, inline: true, initialChat: chat }))
      })
      await act(async () => {})
      await click(root, container.querySelector('.hud-strip-mode'))
      const plan = container
        .querySelectorAll('.mr-mode-choice')
        .find((button) => button.textContent.includes('Plan'))
      await click(root, plan)
      expect(container.querySelector('.mr-mode-error').textContent).toBe(
        'A turn is running. Try again when it ends.'
      )
      expect(container.querySelector('.mr-orch').className).toContain('is-mode-auto')
    })
  })

  it('answers an approval, leaves the card and reads Deny as false', async () => {
    const calls = []
    const chat = {
      state: 'working',
      mode: 'ask',
      modes: MODES,
      messages: [{ id: 'm1', from: 'owner', text: 'Build it.' }],
      approvals: [
        {
          approvalId: 'a1',
          tool: 'shell',
          input: { command: 'npm test' },
          at: '2026-11-09T10:00:00.000Z',
        },
        {
          approvalId: 'a2',
          tool: 'write_file',
          input: { path: 'src/a.js' },
          at: '2026-11-09T10:00:01.000Z',
        },
      ],
    }
    const client = {
      ...fakeClient(chat),
      answerApproval: async (options) => {
        calls.push(options)
        return { ok: true }
      },
    }
    await withDom(async ({ container, root }) => {
      await act(async () => {
        root.render(createElement(OrchestratorChat, { client, inline: true, initialChat: chat }))
      })
      await act(async () => {})
      const cards = container.querySelectorAll('.mr-orch-approval')
      expect(cards).toHaveLength(2)
      expect(cards[0].textContent).toContain('ORCHESTRATOR wants to use shell')
      expect(cards[0].querySelector('.mr-orch-approval-input').textContent).toBe(
        '{\n  "command": "npm test"\n}'
      )
      await click(root, buttonWithText(cards[0], 'Allow'))
      expect(calls).toEqual([
        { id: 'orchestrator', approvalId: 'a1', allow: true, confirmed: true },
      ])
      expect(container.querySelectorAll('.mr-orch-approval')).toHaveLength(1)
      await click(root, buttonWithText(container.querySelector('.mr-orch-approval'), 'Deny'))
      expect(calls[1]).toEqual({
        id: 'orchestrator',
        approvalId: 'a2',
        allow: false,
        confirmed: true,
      })
      expect(container.querySelector('.mr-orch-approval')).toBeNull()
    })
  })
})

describe('sendChatMessage', () => {
  it('sends the main chat through sendOrchestrator with no id', async () => {
    const calls = []
    const client = {
      sendOrchestrator: async (text, options) => {
        calls.push({ text, options })
        return { id: 'message-1' }
      },
      sendToOrchestrator: async () => {
        throw new Error('The legacy call must not run.')
      },
    }
    expect(await sendChatMessage(client, 'Build it.')).toEqual({ ok: true })
    expect(calls).toEqual([{ text: 'Build it.', options: {} }])
  })

  it('sends a sub chat through sendOrchestrator with its id', async () => {
    const calls = []
    const client = {
      sendOrchestrator: async (text, options) => {
        calls.push({ text, options })
        return { id: 'message-1' }
      },
    }
    expect(await sendChatMessage(client, 'Write the header.', 'frontend')).toEqual({ ok: true })
    expect(calls).toEqual([{ text: 'Write the header.', options: { id: 'frontend' } }])
  })

  it('uses sendToOrchestrator with a confirmation on a client without sendOrchestrator', async () => {
    const calls = []
    const client = {
      sendToOrchestrator: async (text, options) => {
        calls.push({ text, options })
        return { id: 'message-1' }
      },
    }
    expect(await sendChatMessage(client, 'Build it.', 'orchestrator')).toEqual({ ok: true })
    expect(calls).toEqual([{ text: 'Build it.', options: { confirmed: true } }])
  })

  it('refuses a sub chat when the client has only the legacy main call', async () => {
    const calls = []
    const client = {
      sendToOrchestrator: async (text, options) => {
        calls.push({ text, options })
        return { id: 'message-1' }
      },
    }
    expect(await sendChatMessage(client, 'Build it.', 'frontend')).toEqual({
      ok: false,
      error: 'The orchestrator is not connected.',
    })
    expect(calls).toEqual([])
  })

  it('refuses a client with no send call at all', async () => {
    expect(await sendChatMessage(null, 'Build it.')).toEqual({
      ok: false,
      error: 'The orchestrator is not connected.',
    })
    expect(await sendChatMessage({}, 'Build it.')).toEqual({
      ok: false,
      error: 'The orchestrator is not connected.',
    })
  })

  it('gives up with the existing sentence when the send fails', async () => {
    const client = {
      sendOrchestrator: async () => {
        throw new Error('The bridge did not answer within 30 seconds.')
      },
    }
    expect(await sendChatMessage(client, 'Build it.')).toEqual({
      ok: false,
      error: 'The bridge did not answer within 30 seconds.',
    })
    const silent = { sendOrchestrator: async () => Promise.reject('no') }
    expect(await sendChatMessage(silent, 'Build it.')).toEqual({
      ok: false,
      error: 'Could not send the message.',
    })
  })

  it('ends when the send is accepted and starts no read of its own', async () => {
    const calls = []
    let accept
    const client = {
      sendOrchestrator: () => new Promise((resolve) => (accept = resolve)),
      orchestrator: async () => calls.push('chat'),
      orchestrators: async () => calls.push('list'),
    }
    let settled = false
    const pending = sendChatMessage(client, 'Build it.').then((result) => {
      settled = true
      return result
    })
    await Promise.resolve()
    expect(settled).toBe(false)
    accept({ id: 'message-1' })
    expect(await pending).toEqual({ ok: true })
    expect(calls).toEqual([])
  })
})

describe('message actions', () => {
  const LINES = [
    { id: 'o1', index: 0, from: 'owner', text: 'First' },
    { id: 'r1', index: 1, from: 'orchestrator', text: 'Reply one' },
    { id: 'o2', index: 2, from: 'owner', text: 'Second' },
    { id: 'r2', index: 3, from: 'orchestrator', text: 'The orchestrator stopped: exit 3.' },
    { id: 'o3', index: 4, from: 'owner', text: 'Third' },
    { id: 'r3', index: 5, from: 'orchestrator', text: 'Reply three' },
  ]

  it('copies the exact text', async () => {
    const written = []
    const copied = await copyChatText('Line one\nLine two', {
      writeText: async (text) => written.push(text),
    })
    expect(copied).toBe(true)
    expect(written).toEqual(['Line one\nLine two'])
    expect(await copyChatText('Text', null)).toBe(false)
    expect(
      await copyChatText('Text', {
        writeText: async () => {
          throw new Error('denied')
        },
      })
    ).toBe(false)
  })

  it('offers retry on the newest reply and on a stopped line when an owner message comes before it', () => {
    expect(retryTarget(LINES, 5)?.text).toBe('Third')
    expect(retryTarget(LINES, 3)?.text).toBe('Second')
    expect(retryTarget(LINES, 1)).toBeNull()
    expect(retryTarget(LINES, 0)).toBeNull()
    expect(retryTarget([{ from: 'orchestrator', text: 'A reply' }], 0)).toBeNull()
  })

  it('branches at the message and keeps the earlier messages', async () => {
    const chat = { state: 'idle', messages: LINES.map((line) => ({ id: line.id, from: line.from, text: line.text })) }
    const calls = []
    const client = {
      ...fakeClient(chat),
      branchOrchestratorSession: async (options) => {
        calls.push(options)
        return { ok: true }
      },
    }
    await withDom(async ({ container, root }) => {
      await act(async () => {
        root.render(createElement(OrchestratorChat, { client, inline: true, initialChat: chat }))
      })
      await act(async () => {})
      const lines = container.querySelectorAll('.mr-orch-line')
      expect(lines).toHaveLength(6)
      await click(root, buttonWithText(lines[2], 'Branch'))
      expect(calls).toEqual([{ id: 'orchestrator', index: 3, confirmed: true }])
    })
  })

  it('retries the owner message before the newest reply', async () => {
    const chat = { state: 'idle', messages: LINES.map((line) => ({ id: line.id, from: line.from, text: line.text })) }
    const calls = []
    const client = {
      ...fakeClient(chat),
      sendToOrchestrator: async (text, options) => {
        calls.push({ text, options })
        return { id: 'message-2' }
      },
    }
    await withDom(async ({ container, root }) => {
      await act(async () => {
        root.render(createElement(OrchestratorChat, { client, inline: true, initialChat: chat }))
      })
      await act(async () => {})
      const lines = container.querySelectorAll('.mr-orch-line')
      await click(root, buttonWithText(lines[5], 'Retry'))
      expect(calls).toEqual([{ text: 'Third', options: { confirmed: true } }])
    })
  })

  it('refuses a retry while a turn runs', async () => {
    const chat = { state: 'working', messages: LINES.map((line) => ({ id: line.id, from: line.from, text: line.text })) }
    const calls = []
    const client = {
      ...fakeClient(chat),
      sendToOrchestrator: async (text, options) => {
        calls.push({ text, options })
        return { id: 'message-2' }
      },
    }
    await withDom(async ({ container, root }) => {
      await act(async () => {
        root.render(createElement(OrchestratorChat, { client, inline: true, initialChat: chat }))
      })
      await act(async () => {})
      const lines = container.querySelectorAll('.mr-orch-line')
      await click(root, buttonWithText(lines[5], 'Retry'))
      expect(container.querySelector('.mr-orch-error').textContent).toContain(
        'Wait for the turn to end, or stop it.'
      )
      expect(calls).toEqual([])
    })
  })

  it('says Copied for two seconds and reaches the buttons with the keyboard', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('navigator', {
      clipboard: {
        writeText: async () => {},
      },
    })
    const chat = { state: 'idle', messages: LINES.map((line) => ({ id: line.id, from: line.from, text: line.text })) }
    try {
      await withDom(async ({ container, root, dom }) => {
        await act(async () => {
          root.render(createElement(OrchestratorChat, { client: fakeClient(chat), inline: true, initialChat: chat }))
        })
        await act(async () => {})
        const first = container.querySelectorAll('.mr-orch-line')[0]
        const copy = buttonWithText(first, 'Copy')
        expect(copy).not.toBeNull()
        await act(async () => {
          copy.focus()
        })
        expect(dom.document.activeElement).toBe(copy)
        await click(root, copy)
        expect(buttonWithText(first, 'Copied')).not.toBeNull()
        await act(async () => {
          await vi.advanceTimersByTimeAsync(2000)
        })
        expect(buttonWithText(first, 'Copy')).not.toBeNull()

        const css = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8')
        expect(css).toContain('.mr-orch-line:hover .mr-orch-line-actions')
        expect(css).toContain('.mr-orch-line:focus-within .mr-orch-line-actions')
      })
    } finally {
      vi.useRealTimers()
      vi.unstubAllGlobals()
    }
  })

  it('writes the work line, its step rows and the bottom test', () => {
    const steps = [
      { tool: 'read', target: 'src/a.js' },
      { tool: 'edit', target: 'src/b.js' },
      { tool: 'shell', target: 'npm test' },
      { tool: 'read', target: 'src/c.js' },
      { tool: 'read', target: 'src/d.js' },
    ]
    expect(workText({ state: 'working', steps: [steps[0]], seconds: 3 })).toBe(
      'Working: read src/a.js'
    )
    expect(workText({ state: 'working', steps: [], seconds: 3 })).toBe('Working')
    expect(workText({ steps, seconds: 12 })).toBe('Worked: 5 steps, 12 s')
    expect(workText({ steps: [steps[0]], seconds: 1 })).toBe('Worked: 1 step, 1 s')
    expect(workRows({ steps })[2]).toEqual({
      tool: 'shell',
      target: 'npm test',
      text: 'shell npm test',
    })
    expect(nearChatBottom({ scrollTop: 700, scrollHeight: 1000, clientHeight: 300 })).toBe(true)
    expect(nearChatBottom({ scrollTop: 100, scrollHeight: 1000, clientHeight: 300 })).toBe(false)
  })

  it('keeps the work on its message and leaves an old message without one', () => {
    const lines = chatLines({
      messages: [
        { id: 'old', from: 'owner', text: 'Old.' },
        {
          id: 'new',
          from: 'owner',
          text: 'New.',
          work: { steps: [{ tool: 'read', target: 'src/a.js' }], seconds: 4 },
        },
      ],
    })
    expect(lines[0].work).toBeUndefined()
    expect(lines[1].work).toEqual({
      state: 'done',
      steps: [{ tool: 'read', target: 'src/a.js' }],
      seconds: 4,
    })
  })

  it('opens the work to its steps and closes them again', async () => {
    const chat = {
      state: 'idle',
      messages: [
        {
          id: 'm1',
          from: 'owner',
          text: 'Build it.',
          work: {
            steps: [
              { tool: 'read', target: 'src/a.js' },
              { tool: 'edit', target: 'src/b.js' },
            ],
            seconds: 8,
          },
        },
        { id: 'm2', from: 'orchestrator', text: 'Done.' },
      ],
    }
    await withDom(async ({ container, root }) => {
      await act(async () => {
        root.render(createElement(OrchestratorChat, { client: fakeClient(chat), inline: true, initialChat: chat }))
      })
      await act(async () => {})
      const line = container.querySelectorAll('.mr-orch-line')[0]
      const fold = buttonWithText(line, 'Worked: 2 steps, 8 s')
      expect(fold).not.toBeNull()
      expect(fold.getAttribute('aria-expanded')).toBe('false')
      expect(line.querySelector('.mr-orch-work-steps')).toBeNull()
      await click(root, fold)
      expect(fold.getAttribute('aria-expanded')).toBe('true')
      const steps = line.querySelector('.mr-orch-work-steps').querySelectorAll('li')
      expect(steps.map((step) => step.textContent)).toEqual(['read src/a.js', 'edit src/b.js'])
      await click(root, fold)
      expect(line.querySelector('.mr-orch-work-steps')).toBeNull()
    })
  })

  it('stays where the owner scrolled and offers Jump to newest', async () => {
    vi.useFakeTimers()
    let chat = { state: 'working', messages: [{ id: 'm1', from: 'owner', text: 'Build it.' }] }
    const client = {
      ...fakeClient(chat),
      orchestrator: async () => chat,
      subscribe: () => () => {},
    }
    try {
      await withDom(async ({ container, root }) => {
        await act(async () => {
          root.render(createElement(OrchestratorChat, { client, inline: true, initialChat: chat }))
        })
        await act(async () => {})
        const log = container.querySelector('.mr-orch-log')
        Object.defineProperty(log, 'scrollHeight', { value: 1000, configurable: true })
        Object.defineProperty(log, 'clientHeight', { value: 300, configurable: true })
        log.scrollTop = 0
        await act(async () => {
          log.dispatchEvent({ type: 'scroll', bubbles: false })
        })
        expect(buttonWithText(container, 'Jump to newest')).not.toBeNull()

        chat = {
          state: 'working',
          messages: [
            { id: 'm1', from: 'owner', text: 'Build it.' },
            { id: 'm2', from: 'orchestrator', text: 'Working on it.' },
          ],
        }
        await act(async () => {
          await vi.advanceTimersByTimeAsync(10000)
        })
        expect(container.querySelectorAll('.mr-orch-line')).toHaveLength(2)
        expect(log.scrollTop).toBe(0)

        await click(root, buttonWithText(container, 'Jump to newest'))
        expect(log.scrollTop).toBe(1000)
        expect(buttonWithText(container, 'Jump to newest')).toBeNull()
      })
    } finally {
      vi.useRealTimers()
    }
  })

  it('scrolls to the bottom when the owner sends a message', async () => {
    let chat = { state: 'idle', messages: [{ id: 'm1', from: 'owner', text: 'First.' }] }
    const client = {
      ...fakeClient(chat),
      sendToOrchestrator: async (text) => {
        chat = {
          state: 'working',
          messages: [...chat.messages, { id: 'm2', from: 'owner', text }],
        }
        return { id: 'm2' }
      },
      orchestrator: async () => chat,
    }
    await withDom(async ({ container, root }) => {
      await act(async () => {
        root.render(createElement(OrchestratorChat, { client, inline: true, initialChat: chat }))
      })
      await act(async () => {})
      const log = container.querySelector('.mr-orch-log')
      Object.defineProperty(log, 'scrollHeight', { value: 1000, configurable: true })
      Object.defineProperty(log, 'clientHeight', { value: 300, configurable: true })
      log.scrollTop = 0
      await act(async () => {
        log.dispatchEvent({ type: 'scroll', bubbles: false })
      })
      expect(buttonWithText(container, 'Jump to newest')).not.toBeNull()
      await type(root, container.querySelector('.mr-orch-input'), 'Build it.')
      await act(async () => {
        container.querySelector('.mr-orch-form').dispatchEvent({
          type: 'submit',
          bubbles: true,
          cancelable: true,
        })
      })
      expect(log.scrollTop).toBe(1000)
      expect(buttonWithText(container, 'Jump to newest')).toBeNull()
      expect(container.querySelectorAll('.mr-orch-line')).toHaveLength(2)
    })
  })
})

describe('teamLines', () => {
  function entries() {
    return [
      {
        id: 'orchestrator',
        name: 'Orchestrator',
        chat: {
          messages: [
            { id: 'm3', from: 'room', text: 'Run ended.', at: '2026-10-29T10:00:05.000Z' },
            { id: 'm1', from: 'owner', text: 'Build the page.', at: '2026-10-29T10:00:01.000Z' },
            { id: 'm5', from: 'sub:frontend', text: 'Header done.', at: '2026-10-29T10:00:07.000Z' },
          ],
        },
      },
      {
        id: 'frontend',
        name: 'Frontend',
        chat: {
          messages: [
            { id: 's1', from: 'orchestrator', text: 'Build the header.', at: '2026-10-29T10:00:03.000Z' },
            { id: 's2', from: 'owner', text: 'Go on.', at: '2026-10-29T10:00:06.000Z' },
          ],
        },
      },
    ]
  }

  it('merges every orchestrator by time and tags where and who', () => {
    const rows = teamLines(entries())
    expect(rows.map((row) => row.text)).toEqual([
      'Build the page.',
      'Build the header.',
      'Run ended.',
      'Go on.',
      'Header done.',
    ])
    expect(rows.map((row) => row.where)).toEqual(['main', 'Frontend', 'main', 'Frontend', 'main'])
    expect(rows.map((row) => row.who)).toEqual(['owner', 'orchestrator', 'room', 'owner', 'Frontend'])
    expect(rows.map((row) => row.chatId)).toEqual([
      'orchestrator',
      'frontend',
      'orchestrator',
      'frontend',
      'orchestrator',
    ])
    expect(rows[1].fromMain).toBe(true)
    expect(rows[4]).toMatchObject({ from: 'sub', fromMain: false })
    expect(rows[0].fromMain).toBe(false)
  })

  it('falls back to the sub id, masks hidden text and keeps ids unique', () => {
    const rows = teamLines([
      {
        id: 'orchestrator',
        name: 'Orchestrator',
        chat: {
          messages: [
            { id: 'a', from: 'sub:qa', text: 'Report \u202Enow' },
            { id: 'b', from: 'sub:', text: 'No id.' },
            { id: 'c', from: 'owner', text: '   ' },
            null,
          ],
        },
      },
    ])
    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({
      where: 'main',
      who: 'Sub qa',
      from: 'sub',
      text: 'Report [U+202E]now',
    })
    expect(rows[1]).toMatchObject({
      where: 'main',
      who: 'orchestrator',
      from: 'orchestrator',
      text: 'No id.',
    })
    expect(new Set(rows.map((row) => row.id)).size).toBe(rows.length)
  })

  it('shows the newest rows only and keeps their order when times are missing', () => {
    const rows = teamLines(
      [
        {
          id: 'orchestrator',
          name: 'Main',
          chat: { messages: [{ id: 'a', from: 'owner', text: 'one' }, { id: 'b', from: 'owner', text: 'two' }] },
        },
        {
          id: 'frontend',
          name: 'Frontend',
          chat: { messages: [{ id: 'c', from: 'owner', text: 'three' }] },
        },
      ],
      2
    )
    expect(rows.map((row) => row.text)).toEqual(['two', 'three'])
    expect(teamLines(null)).toEqual([])
    expect(teamLines([null, { id: '' }])).toEqual([])
  })
})

describe('projectBaseName', () => {
  it('reads the last folder of a Windows or POSIX path', () => {
    expect(projectBaseName('C:\\work\\projects\\app')).toBe('app')
    expect(projectBaseName('C:/work/projects/app')).toBe('app')
    expect(projectBaseName('/home/<name>/work/app')).toBe('app')
    expect(projectBaseName('app')).toBe('app')
  })

  it('ignores a trailing separator', () => {
    expect(projectBaseName('C:\\work\\projects\\app\\')).toBe('app')
    expect(projectBaseName('/home/<name>/work/app/')).toBe('app')
    expect(projectBaseName('C:\\work\\projects\\app///')).toBe('app')
  })

  it('gives an empty name for an empty path or a drive root', () => {
    expect(projectBaseName('')).toBe('')
    expect(projectBaseName(null)).toBe('')
    expect(projectBaseName(undefined)).toBe('')
    expect(projectBaseName('/')).toBe('')
    expect(projectBaseName('C:\\')).toBe('')
  })
})

describe('pruneOrchestratorRecord', () => {
  it('drops every mark for a sub that left the list and keeps main', () => {
    const record = { orchestrator: { messages: ['main'] }, frontend: { messages: ['old'] }, gone: { messages: ['old'] } }
    const next = pruneOrchestratorRecord(record, ['orchestrator', 'frontend'])
    expect(Object.keys(next)).toEqual(['orchestrator', 'frontend'])
    expect(next.frontend).toBe(record.frontend)
    expect(next).not.toBe(record)
    expect(pruneOrchestratorRecord(record, ['orchestrator', 'frontend', 'gone'])).toBe(record)
    expect(pruneOrchestratorRecord({}, [])).toEqual({})
  })
})

describe('chatBlocks', () => {
  it('turns paragraphs into blocks and keeps their lines', () => {
    expect(chatBlocks('One line\ntwo lines\n\nSecond para')).toEqual([
      { kind: 'paragraph', spans: [{ kind: 'text', text: 'One line\ntwo lines' }] },
      { kind: 'paragraph', spans: [{ kind: 'text', text: 'Second para' }] },
    ])
    expect(chatBlocks('')).toEqual([])
    expect(chatBlocks(null)).toEqual([])
  })

  it('draws headings as plain text with their level', () => {
    const blocks = chatBlocks('# Plan\n\n### Next step')
    expect(blocks[0]).toMatchObject({ kind: 'heading', level: 1 })
    expect(textOf(blocks[0].spans)).toBe('Plan')
    expect(blocks[1]).toMatchObject({ kind: 'heading', level: 3 })
    expect(textOf(blocks[1].spans)).toBe('Next step')
  })

  it('groups bullet and numbered lists', () => {
    const blocks = chatBlocks('- one\n- two\n\n1. first\n2. second')
    expect(blocks).toHaveLength(2)
    expect(blocks[0]).toMatchObject({ kind: 'list', ordered: false, start: 1 })
    expect(blocks[0].items.map((item) => textOf(item.spans))).toEqual(['one', 'two'])
    expect(blocks[1]).toMatchObject({ kind: 'list', ordered: true, start: 1 })
    expect(blocks[1].items.map((item) => textOf(item.spans))).toEqual(['first', 'second'])

    const [started] = chatBlocks('3. three\n4. four')
    expect(started).toMatchObject({ kind: 'list', ordered: true, start: 3 })
    expect(started.items.map((item) => textOf(item.spans))).toEqual(['three', 'four'])
  })

  it('drops bold and italic markers, including nested ones', () => {
    const [plain] = chatBlocks('**bold** and *italic* and __strong__ and _em_')
    expect(textOf(plain.spans)).toBe('bold and italic and strong and em')

    const [nested] = chatBlocks('**bold with *italic* and `code`**')
    expect(textOf(nested.spans)).toBe('bold with italic and code')
    expect(nested.spans.filter((span) => span.kind === 'code')).toEqual([
      { kind: 'code', text: 'code' },
    ])

    const [outer] = chatBlocks('*outer **inner** outer*')
    expect(textOf(outer.spans)).toBe('outer inner outer')
  })

  it('reads inline code without reading its Markdown', () => {
    const [block] = chatBlocks('Run `npm test` then **stop**.')
    expect(textOf(block.spans)).toBe('Run npm test then stop.')
    expect(block.spans).toContainEqual({ kind: 'code', text: 'npm test' })

    const [literal] = chatBlocks('`**not bold**`')
    expect(literal.spans).toEqual([{ kind: 'code', text: '**not bold**' }])
  })

  it('keeps a code block exactly as written', () => {
    const [code] = chatBlocks('```md\n# not a heading\n**not bold**\n- not a list\n```')
    expect(code).toEqual({ kind: 'code', text: '# not a heading\n**not bold**\n- not a list' })
    expect(chatBlocks('~~~\n`inline` stays\n~~~')[0]).toEqual({
      kind: 'code',
      text: '`inline` stays',
    })
    expect(chatBlocks('```\nno close')[0]).toEqual({ kind: 'code', text: 'no close' })
  })

  it('keeps HTML as text', () => {
    const [block] = chatBlocks('<script>alert(1)</script>')
    expect(block.spans).toEqual([{ kind: 'text', text: '<script>alert(1)</script>' }])
    const [mixed] = chatBlocks('Use <b>this</b> and **that**')
    expect(textOf(mixed.spans)).toBe('Use <b>this</b> and that')
  })

  it('leaves unmatched markers and a lone star as written', () => {
    expect(textOf(chatBlocks('a ** b')[0].spans)).toBe('a ** b')
    expect(textOf(chatBlocks('src/*.js and *.ts')[0].spans)).toBe('src/*.js and *.ts')
  })
})

describe('OrchestratorChat panel', () => {
  it('renders the conversation, the status line and the send box', () => {
    const chat = {
      state: 'working',
      model: 'opus',
      messages: [
        { id: 'm1', from: 'owner', text: 'Build the settings page.' },
        { id: 'm2', from: 'orchestrator', text: 'What name?\nLine two' },
        { id: 'm3', from: 'room', text: 'Run x ended: succeeded.' },
      ],
    }
    const html = renderToString(
      createElement(OrchestratorChat, { open: true, client: fakeClient(chat), initialChat: chat })
    )
    expect(html).toContain('id="hud-orchestrator-chat"')
    expect(html).toContain('class="mr-orch-line is-owner"')
    expect(html).toContain('class="mr-orch-line is-orchestrator"')
    expect(html).toContain('class="mr-orch-line is-room"')
    expect(html).toContain('>room</span>')
    expect(html).toContain('What name?\nLine two')
    expect(html).toContain('Orchestrator is working')
    expect(html).toContain('maxLength="8000"')
    expect(html).toContain('Enter sends. Shift+Enter adds a line.')
    expect(html).toContain('>Send</button>')
    expect(html).toContain('>Stop</button>')
    expect(html).not.toContain('>Team</span>')
  })

  it('renders the inline chat with the model, effort and Compact controls under the input', () => {
    const chat = {
      state: 'working',
      model: 'opus',
      messages: [
        { id: 'm1', from: 'owner', text: 'Build it.' },
        { id: 'm2', from: 'orchestrator', text: '## Plan\n\n- one' },
      ],
    }
    const html = renderToString(
      createElement(OrchestratorChat, {
        open: true,
        inline: true,
        client: fakeClient(chat),
        initialChat: chat,
        initialOrchestrators: [
          {
            id: 'orchestrator',
            name: 'Orchestrator',
            harness: 'claude',
            model: 'opus',
            state: 'working',
            effort: 'high',
            contextTokens: 96000,
            contextWindow: 200000,
          },
        ],
      })
    )
    expect(html).toContain('class="mr-orch is-inline"')
    expect(html).not.toContain('id="hud-orchestrator-chat"')
    expect(html).toContain('Ask the orchestrator anything')
    expect(html).toContain('class="mr-orch-form hud-lower-input"')
    expect(html).toContain('class="hud-strip-model"')
    expect(html).toContain('title="Refresh models"')
    expect(html).toContain('class="mr-model-refresh"')
    expect(html).toContain('class="hud-strip-effort"')
    expect(html).toContain('class="hud-strip-compact"')
    expect(html).toContain('Model:')
    expect(html).toContain('opus')
    expect(html).toContain('Effort:')
    expect(html).toContain('high')
    expect(html).toContain('Context size 96.0k / 200.0k')
    expect(html).toContain('class="mr-orch-line is-owner"')
    expect(html).toContain('class="mr-orch-block is-heading"')
    expect(html).toContain('>Stop</button>')
    expect(html).toContain('aria-label="Send"')
  })

  it('forgets a sub that left the list and reads it again when it comes back', async () => {
    const main = { id: 'orchestrator', name: 'Main', state: 'idle' }
    const sub = { id: 'sub-frontend', name: 'Frontend', state: 'idle' }
    const oldChat = { state: 'idle', messages: [{ id: 'm1', from: 'owner', text: 'Old frontend line.' }] }
    let reads = 0
    const client = {
      orchestrator: async (id) => {
        if (id !== 'sub-frontend') return { state: 'idle', messages: [] }
        reads += 1
        if (reads === 1) return oldChat
        return new Promise(() => {})
      },
      orchestratorCommands: async () => [],
      orchestrators: async () => [],
      subscribe: () => () => {},
    }
    const chat = (selected, orchestrators) =>
      createElement(OrchestratorChat, {
        open: true,
        client,
        selected,
        orchestrators,
        onSelect: () => {},
      })

    await withDom(async ({ container, root }) => {
      await act(async () => {
        root.render(chat('sub-frontend', [main, sub]))
      })
      expect(container.textContent).toContain('Old frontend line.')

      await act(async () => {
        root.render(chat('orchestrator', [main]))
      })
      expect(container.textContent).not.toContain('Frontend')

      await act(async () => {
        root.render(chat('sub-frontend', [main, sub]))
      })
      expect(container.textContent).not.toContain('Old frontend line.')
      expect(container.textContent).toContain('Reading the chat.')
    })
  })

  it('takes the chosen tab from outside', () => {
    const html = renderToString(
      createElement(OrchestratorChat, {
        open: true,
        client: fakeClient(),
        selected: 'sub-frontend',
        initialOrchestrators: [
          { id: 'orchestrator', name: 'Orchestrator', state: 'idle', lanes: [] },
          { id: 'sub-frontend', name: 'Frontend', state: 'idle', lanes: ['opencode'] },
        ],
      })
    )
    const start = html.indexOf('mr-orch-tab is-active')
    expect(start).toBeGreaterThan(-1)
    const tab = html.slice(start, html.indexOf('</button>', start))
    expect(tab).toContain('<span>Frontend</span>')
    expect(html).toContain('aria-label="Orchestrators"')
  })

  it('shows a sub orchestrator report under its own label', () => {
    const chat = {
      state: 'idle',
      messages: [{ id: 'm1', from: 'sub:frontend', text: 'Done.' }],
    }
    const html = renderToString(
      createElement(OrchestratorChat, { open: true, client: fakeClient(chat), initialChat: chat })
    )
    expect(html).toContain('class="mr-orch-line is-sub"')
    expect(html).toContain('Sub frontend')
    expect(html).not.toContain('class="mr-orch-line is-orchestrator"')
  })

  it('draws orchestrator and room messages as blocks and keeps owner messages plain', () => {
    const chat = {
      state: 'working',
      messages: [
        { id: 'm1', from: 'owner', text: '**plain** `<owner>`' },
        { id: 'm2', from: 'orchestrator', text: '## Plan\n\n- **one**\n- two\n\nRun `npm test`.\n\n```sh\nnpm test\n```' },
        { id: 'm3', from: 'room', text: '### Run ended' },
      ],
    }
    const html = renderToString(
      createElement(OrchestratorChat, { open: true, client: fakeClient(chat), initialChat: chat })
    )
    expect(html).toContain('class="mr-orch-blocks is-orchestrator"')
    expect(html).toContain('class="mr-orch-block is-heading"')
    expect(html).toContain('class="mr-orch-block is-list"')
    expect(html).toContain('<pre class="mr-orch-block is-code"><code>npm test</code></pre>')
    expect(html).toContain('<code class="mr-orch-code">npm test</code>')
    expect(html).toContain('class="mr-orch-blocks is-room"')
    expect(html).toContain('**plain**')
    expect(html).toContain('&lt;owner&gt;')
  })

  it('keeps a script in a reply as text, never as HTML', () => {
    const chat = {
      state: 'idle',
      messages: [{ id: 'm1', from: 'orchestrator', text: '<script>alert(1)</script>' }],
    }
    const html = renderToString(
      createElement(OrchestratorChat, { open: true, client: fakeClient(chat), initialChat: chat })
    )
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;')
    expect(html).not.toContain('<script>')
  })

  it('names the command the room shows on the working line', () => {
    const chat = { state: 'working', messages: [{ id: 'm1', from: 'owner', text: 'Go.' }] }
    const withProp = renderToString(
      createElement(OrchestratorChat, {
        open: true,
        client: fakeClient(chat),
        initialChat: chat,
        activity: 'npm test',
      })
    )
    expect(withProp).toContain('Orchestrator is working: npm test')

    const withRoom = renderToString(
      createElement(
        OrchestratorActivity.Provider,
        { value: 'npm run build' },
        createElement(OrchestratorChat, { open: true, client: fakeClient(chat), initialChat: chat })
      )
    )
    expect(withRoom).toContain('Orchestrator is working: npm run build')
  })

  it('shows the confirm card with the exact first message before the first send', () => {
    const html = renderToString(
      createElement(OrchestratorChat, {
        open: true,
        client: fakeClient(),
        initialChat: { state: 'idle', messages: [] },
        initialOrchestrators: [{ id: 'orchestrator', name: 'Orchestrator', harness: 'claude' }],
        initialDraft: 'Build the settings page.',
        initialConfirm: 'start',
      })
    )
    expect(html).toContain(
      'The orchestrator runs Claude Code on this project with full permissions. It plans, starts lanes, merges what passes on a branch and never pushes. It uses your Claude subscription.'
    )
    expect(html).toContain('>Start</button>')
    expect(html).toContain('>Cancel</button>')
  })

  it('names the orchestrator harness in the start card', () => {
    const claude = startConfirmText('', 'claude')
    expect(claude).toContain('runs Claude Code on this project')
    expect(claude).toContain('It uses your Claude subscription.')

    const opencode = startConfirmText('', 'opencode')
    expect(opencode).toContain('runs OpenCode on this project')
    expect(opencode).toContain('It uses your OpenCode subscription.')
    expect(opencode).not.toContain('Claude')

    const direct = startConfirmText('', 'machineroom')
    expect(direct).toContain('runs Direct API on this project')
    expect(direct).toContain('It uses no subscription.')
    expect(direct).not.toContain('It uses your')

    expect(startConfirmText('', '')).toBe(
      'The orchestrator runs on this project with full permissions. It plans, starts lanes, merges what passes on a branch and never pushes.'
    )
  })

  it('names the project folder in the header and its full path in the start card', () => {
    const chat = {
      state: 'idle',
      model: 'opus',
      project: 'C:\\work\\projects\\app',
      messages: [],
    }
    const html = renderToString(
      createElement(OrchestratorChat, {
        open: true,
        client: fakeClient(chat),
        initialChat: chat,
        initialOrchestrators: [{ id: 'orchestrator', name: 'Orchestrator', harness: 'opencode' }],
        initialDraft: 'Build the settings page.',
        initialConfirm: 'start',
      })
    )
    expect(html).toContain('class="mr-orch-project mr-orch-model mono"')
    expect(html).toContain('title="C:\\work\\projects\\app"')
    expect(html).toContain('>app</span>')
    expect(html).toContain('>opus</span>')
    expect(html).toContain(
      'The orchestrator works in C:\\work\\projects\\app on OpenCode with full permissions.'
    )
    expect(html).toContain('It uses your OpenCode subscription.')
    expect(html).not.toContain('It uses your Claude subscription.')
    expect(html).not.toContain('on this project with full permissions')
  })

  it('shows the full path in the start card while the header holds a path with a trailing separator', () => {
    const chat = {
      state: 'idle',
      model: 'opus',
      project: 'C:\\work\\projects\\app\\',
      messages: [],
    }
    const html = renderToString(
      createElement(OrchestratorChat, {
        open: true,
        client: fakeClient(chat),
        initialChat: chat,
        initialConfirm: 'start',
      })
    )
    expect(html).toContain('>app</span>')
    expect(html).toContain(
      'The orchestrator works in C:\\work\\projects\\app\\ with full permissions.'
    )
  })

  it('asks before a stop and shows the stop sentence', () => {
    const chat = { state: 'working', messages: [{ id: 'm1', from: 'owner', text: 'Build it.' }] }
    const html = renderToString(
      createElement(OrchestratorChat, {
        open: true,
        client: fakeClient(chat),
        initialChat: chat,
        initialConfirm: 'stop',
      })
    )
    expect(html).toContain(ORCH_STOP_CONFIRM)
    expect(html).toContain('class="mr-orch-confirm is-stop"')
  })

  it('closes the model, effort and Compact cards on Escape without closing the chat', async () => {
    const closed = []
    const client = {
      ...fakeClient({ state: 'idle', model: 'opus', messages: [] }),
      models: async () => [
        { id: 'opus', label: 'Opus', harness: 'claude' },
        { id: 'sonnet', label: 'Sonnet', harness: 'claude' },
      ],
      setOrchestratorModel: async () => ({ ok: true }),
      setOrchestratorEffort: async () => ({ ok: true }),
      compactOrchestrator: async () => ({ ok: true }),
    }
    const list = [{ id: 'orchestrator', name: 'Orchestrator', harness: 'claude', model: 'opus', state: 'idle' }]
    await withDom(async ({ container, root, dom }) => {
      await act(async () => {
        root.render(
          createElement(OrchestratorChat, {
            client,
            inline: true,
            orchestrators: list,
            initialOrchestrators: list,
            initialSelected: 'orchestrator',
            initialChat: { state: 'idle', model: 'opus', messages: [] },
            onClose: () => closed.push(true),
          })
        )
      })
      await act(async () => {})

      await click(root, container.querySelector('.hud-strip-model'))
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0))
      })
      const modelsPop = container.querySelector('.strip-pop.is-models')
      const modelChoice = modelsPop ? modelsPop.querySelector('.mr-model-choice') : null
      expect(modelChoice).not.toBeNull()
      await click(root, modelChoice)
      expect(container.querySelector('.mr-orch-confirm[aria-label="Set the model"]')).not.toBeNull()
      const modelEscape = { type: 'keydown', key: 'Escape', bubbles: true, cancelable: true }
      await act(async () => {
        dom.window.dispatchEvent(modelEscape)
      })
      expect(container.querySelector('.mr-orch-confirm[aria-label="Set the model"]')).toBeNull()
      expect(modelEscape.cancelBubble).toBe(true)

      await click(root, container.querySelector('.hud-strip-effort'))
      const effortPop = container.querySelector('.strip-pop.is-effort')
      const effortChoice = effortPop ? effortPop.querySelector('.strip-model-choice') : null
      expect(effortChoice).not.toBeNull()
      await click(root, effortChoice)
      expect(container.querySelector('.mr-orch-confirm[aria-label="Set the effort"]')).not.toBeNull()
      const effortEscape = { type: 'keydown', key: 'Escape', bubbles: true, cancelable: true }
      await act(async () => {
        dom.window.dispatchEvent(effortEscape)
      })
      expect(container.querySelector('.mr-orch-confirm[aria-label="Set the effort"]')).toBeNull()
      expect(effortEscape.cancelBubble).toBe(true)

      await click(root, container.querySelector('.hud-strip-compact'))
      expect(container.querySelector('.strip-pop.is-compact')).not.toBeNull()
      const compactEscape = { type: 'keydown', key: 'Escape', bubbles: true, cancelable: true }
      await act(async () => {
        dom.window.dispatchEvent(compactEscape)
      })
      expect(container.querySelector('.strip-pop.is-compact')).toBeNull()
      expect(compactEscape.cancelBubble).toBe(true)
      expect(closed).toEqual([])
    })
  })

  it('shows the orchestrator list read error in the chat', async () => {
    const client = {
      ...fakeClient({ state: 'idle', messages: [] }),
      orchestrators: async () => {
        throw new Error('The bridge did not answer the orchestrator list.')
      },
    }
    await withDom(async ({ container, root }) => {
      await act(async () => {
        root.render(
          createElement(OrchestratorChat, {
            client,
            initialOrchestrators: [{ id: 'orchestrator', name: 'Orchestrator', state: 'idle' }],
          })
        )
      })
      await act(async () => {})
      const alert = container.querySelector('.mr-orch-error')
      expect(alert).not.toBeNull()
      expect(alert.textContent).toContain('The bridge did not answer the orchestrator list.')
    })
  })

  it('re-reads the stopped sub chat at once and hides its Stop button', async () => {
    let subReads = 0
    const stopped = []
    const list = [
      { id: 'orchestrator', name: 'Orchestrator', harness: 'claude', state: 'idle' },
      { id: 'sub-1', name: 'Team 1', harness: 'claude', state: 'working' },
    ]
    const client = {
      ...fakeClient({ state: 'idle', messages: [] }),
      orchestrator: async (id) => {
        if (id === 'sub-1') {
          subReads += 1
          return subReads === 1
            ? { state: 'working', messages: [{ id: 'm1', from: 'owner', text: 'Build it.' }] }
            : { state: 'idle', messages: [{ id: 'm1', from: 'owner', text: 'Build it.' }] }
        }
        return { state: 'idle', messages: [] }
      },
      stopOrchestrator: async (options) => {
        stopped.push(options)
        return { ok: true }
      },
    }
    await withDom(async ({ container, root }) => {
      await act(async () => {
        root.render(
          createElement(OrchestratorChat, {
            client,
            orchestrators: list,
            initialOrchestrators: list,
            initialSelected: 'sub-1',
          })
        )
      })
      await act(async () => {})
      expect(subReads).toBe(1)
      const stop = container.querySelector('.mr-orch-stop')
      expect(stop).not.toBeNull()
      await click(root, stop)
      const card = container.querySelector('.mr-orch-confirm.is-stop')
      expect(card).not.toBeNull()
      await click(root, buttonWithText(card, 'Stop'))
      expect(stopped).toEqual([{ confirmed: true, id: 'sub-1' }])
      expect(subReads).toBe(2)
      expect(container.querySelector('.mr-orch-stop')).toBeNull()
    })
  })

  it('shows the character count past 7000 and the waiting line', () => {
    const html = renderToString(
      createElement(OrchestratorChat, {
        open: true,
        client: fakeClient(),
        initialChat: { state: 'idle', messages: [] },
        initialDraft: 'a'.repeat(7001),
      })
    )
    expect(html).toContain('7001 / 8000')
    expect(html).toContain('Orchestrator is waiting for you')
  })

  it('draws a tab per orchestrator with Main first and a state dot', () => {
    const list = [
      {
        id: 'orchestrator',
        name: 'Orchestrator',
        harness: 'claude',
        model: 'opus',
        state: 'working',
        lanes: ['opencode', 'opencode4'],
        scope: [],
        restricted: false,
        setBy: 'owner',
      },
      {
        id: 'frontend',
        name: 'Frontend',
        harness: 'opencode',
        model: 'opencode-go/deepseek-v4.1-flash',
        state: 'working',
        lanes: ['opencode2'],
        scope: ['src/ui/**'],
        restricted: true,
        setBy: 'owner',
      },
      {
        id: 'bridge',
        name: 'Bridge',
        harness: 'claude',
        model: 'sonnet',
        state: 'paused',
        lanes: ['opencode3'],
        scope: ['server/**'],
        restricted: true,
        setBy: 'owner',
      },
    ]
    const chat = { state: 'working', model: 'opus', messages: [{ id: 'm1', from: 'owner', text: 'Build it.' }] }
    const html = renderToString(
      createElement(OrchestratorChat, {
        open: true,
        client: fakeClient(chat),
        initialChat: chat,
        initialOrchestrators: list,
        initialSelected: 'frontend',
      })
    )
    expect(html).toContain('class="mr-orch-tabs"')
    expect(html).toContain('>Main</span>')
    expect(html).toContain('>Frontend</span>')
    expect(html).toContain('>Bridge</span>')
    expect(html.indexOf('>Main<')).toBeLessThan(html.indexOf('>Frontend<'))
    expect(html).toContain('class="mr-orch-tab-dot is-working"')
    expect(html).toContain('class="mr-orch-tab-dot is-paused"')
    expect(html).toContain('aria-pressed="true"')
    expect(html).not.toContain('>Attach</button>')
    expect(html).not.toContain('aria-label="Detach Frontend"')
    expect(html).toContain('Orchestrator is working')
  })

  it('adds a read-only Team view after the sub tabs', () => {
    const list = [
      { id: 'orchestrator', name: 'Orchestrator', state: 'idle', lanes: [] },
      { id: 'frontend', name: 'Frontend', state: 'idle', lanes: ['opencode'] },
      { id: 'bridge', name: 'Bridge', state: 'paused', lanes: ['opencode2'] },
    ]
    const chat = {
      state: 'idle',
      messages: [
        { id: 'm1', from: 'owner', text: 'Build it.', at: '2026-10-29T10:00:01.000Z' },
        { id: 'm2', from: 'room', text: 'Run ended.', at: '2026-10-29T10:00:02.000Z' },
        { id: 'm3', from: 'sub:frontend', text: 'Header done.', at: '2026-10-29T10:00:03.000Z' },
      ],
    }
    const html = renderToString(
      createElement(OrchestratorChat, {
        open: true,
        client: fakeClient(chat),
        initialChat: chat,
        initialOrchestrators: list,
        selected: TEAM_TAB,
      })
    )
    expect(html).toContain('>Team</span>')
    expect(html.indexOf('>Team<')).toBeGreaterThan(html.indexOf('>Bridge<'))
    expect(html).toContain('Every orchestrator')
    expect(html).toContain('<button type="button" class="mr-orch-team-row is-owner"')
    expect(html).toContain('<button type="button" class="mr-orch-team-row is-room"')
    expect(html).toContain('<button type="button" class="mr-orch-team-row is-sub"')
    expect(html).toContain('>main</span>')
    expect(html).toContain('>owner</span>')
    expect(html).toContain('>room</span>')
    expect(html).toContain('>Frontend</span>')
    expect(html).toContain('Header done.')
    expect(html).not.toContain('<textarea')
    expect(html).not.toContain('class="mr-orch-form')
    expect(html).not.toContain('Ask the orchestrator anything')
  })

  it('renders nothing when closed', () => {
    expect(renderToString(createElement(OrchestratorChat, { open: false }))).toBe('')
  })
})

describe('Hud and Waiting with an orchestrator', () => {
  it('shows the ORCHESTRATOR button and the help line when the bridge reports one', () => {
    const html = renderToString(
      createElement(Hud, {
        mode: 'live',
        liveStatus: 'live',
        snapshot: SNAPSHOT,
        speeds: [1],
        client: fakeClient(),
        health: { orchestrator: true },
        helpOpen: true,
      })
    )
    expect(html).toContain('hud-action')
    expect(html).toContain('aria-controls="hud-orchestrator-chat"')
    expect(html).toContain('>Orchestrator</span>')
    expect(html).toContain('aria-pressed="false"')
    expect(html).toContain('Talk to the orchestrator')
    expect(html).not.toContain('Open assistant terminal')
  })

  it('puts the inline chat in the lower half at 900 pixels wide', () => {
    const savedWindow = globalThis.window
    const storage = {
      getItem: (key) => (key === 'machineroom.guide' ? '1' : null),
      setItem: () => {},
    }
    globalThis.window = {
      innerWidth: 1200,
      location: { search: '' },
      localStorage: storage,
      addEventListener: () => {},
      removeEventListener: () => {},
    }
    try {
      const html = renderToString(
        createElement(Hud, {
          mode: 'live',
          snapshot: SNAPSHOT,
          speeds: [1],
          client: fakeClient(),
          health: { orchestrator: true },
        })
      )
      expect(html).toContain('class="hud-lower"')
      expect(html).toContain('class="hud-lower-main"')
      expect(html).toContain('class="hud-lower-crumb mono"')
      expect(html).toContain('class="mr-orch is-inline"')
      expect(html).toContain('Ask the orchestrator anything')
      expect(html).toContain('class="hud-strip-model"')
      expect(html).toContain('class="hud-strip-effort"')
      expect(html).toContain('class="hud-strip-compact"')
      expect(html).not.toContain('id="hud-orchestrator-chat"')
      expect(html).not.toContain('class="hud-dock"')
    } finally {
      if (savedWindow === undefined) delete globalThis.window
      else globalThis.window = savedWindow
    }
  })

  it('keeps the assistant terminal for a room with no orchestrator', () => {
    const html = renderToString(
      createElement(Hud, {
        mode: 'replay',
        liveStatus: 'replay',
        snapshot: SNAPSHOT,
        speeds: [1],
        client: fakeClient(),
        assistantOpen: true,
        health: { orchestrator: false },
        helpOpen: true,
      })
    )
    expect(html).toContain('class="mr-assistant"')
    expect(html).not.toContain('aria-controls="hud-orchestrator-chat"')
    expect(html).toContain('Open assistant terminal')
  })

  it('hides the assistant terminal while the orchestrator chat is on', () => {
    const html = renderToString(
      createElement(Hud, {
        mode: 'live',
        liveStatus: 'live',
        snapshot: SNAPSHOT,
        speeds: [1],
        client: fakeClient(),
        assistantOpen: true,
        health: { orchestrator: true },
      })
    )
    expect(html).not.toContain('class="mr-assistant"')
  })

  it('keeps the lane wording and names no Paperclip when there is no orchestrator', () => {
    const html = renderToString(
      createElement(Waiting, {
        status: 'live',
        agents: [{ key: 'opencode', name: 'OpenCode', status: 'idle' }],
      })
    )
    expect(html).toContain('The room is waiting for the first run. Start one from Dispatch (C) or with npm run run-lane.')
    expect(html).not.toContain('Paperclip')
  })
})
