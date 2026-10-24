import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import Hud from '../src/ui/Hud.jsx'
import OrchestratorChat from '../src/ui/OrchestratorChat.jsx'
import Waiting from '../src/ui/Waiting.jsx'
import {
  ORCH_STOP_CONFIRM,
  OrchestratorActivity,
  canSend,
  charCount,
  chatBlocks,
  chatLines,
  clampDraft,
  isSendKey,
  listsOrchestrator,
  needsStartConfirm,
  normalizeChat,
  orchestratorDoing,
  statusDetail,
  statusText,
  statusTone,
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
    expect(normalizeChat(null)).toEqual({ state: 'idle', model: '', project: '', messages: [] })
    expect(normalizeChat({ state: 'nope', messages: 'no' })).toEqual({
      state: 'idle',
      model: '',
      project: '',
      messages: [],
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
        initialDraft: 'Build the settings page.',
        initialConfirm: 'start',
      })
    )
    expect(html).toContain(
      'The orchestrator runs Claude Code (Opus) on this project with full permissions. It plans, starts lanes, merges what passes on a branch and never pushes. It uses your Claude subscription.'
    )
    expect(html).toContain('>Start</button>')
    expect(html).toContain('>Cancel</button>')
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

  it('points a beginner at the chat on the waiting card', () => {
    const html = renderToString(
      createElement(Waiting, {
        status: 'live',
        agents: [{ key: 'orchestrator', name: 'Orchestrator', status: 'idle' }],
      })
    )
    expect(html).toContain(
      'Nothing is running yet. Press / or click ORCHESTRATOR and tell it what you want built.'
    )
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
