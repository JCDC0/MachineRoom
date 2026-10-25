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
  projectBaseName,
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
        initialDraft: 'Build the settings page.',
        initialConfirm: 'start',
      })
    )
    expect(html).toContain('class="mr-orch-project mr-orch-model mono"')
    expect(html).toContain('title="C:\\work\\projects\\app"')
    expect(html).toContain('>app</span>')
    expect(html).toContain('>opus</span>')
    expect(html).toContain(
      'The orchestrator works in C:\\work\\projects\\app with full permissions.'
    )
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
    expect(html).toContain('aria-label="Detach Frontend"')
    expect(html).toContain('aria-label="Detach Bridge"')
    expect(html).toContain('aria-pressed="true"')
    expect(html).toContain('>Attach</button>')
    expect(html).toContain('Orchestrator is working')
  })

  it('draws the attach form with free lanes, scope and Restricted on', () => {
    const list = [
      {
        id: 'orchestrator',
        name: 'Orchestrator',
        harness: 'claude',
        model: 'opus',
        state: 'idle',
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
        state: 'idle',
        lanes: ['opencode2'],
        scope: ['src/ui/**'],
        restricted: true,
        setBy: 'owner',
      },
    ]
    const html = renderToString(
      createElement(OrchestratorChat, {
        open: true,
        client: fakeClient(),
        initialOrchestrators: list,
        initialForm: { name: 'Bridge', id: 'bridge', harness: 'claude', model: 'sonnet', lanes: ['opencode'], scope: 'server/**', restricted: true },
      })
    )
    expect(html).toContain('aria-label="Attach a sub orchestrator"')
    expect(html).toContain('>Name</span>')
    expect(html).toContain('>Id</span>')
    expect(html).toContain('>Harness</span>')
    expect(html).toContain('>Model</span>')
    expect(html).toContain('>Lanes</legend>')
    expect(html).toContain('>opencode</span>')
    expect(html).toContain('>opencode4</span>')
    expect(html).not.toContain('>opencode2</span>')
    expect(html).toContain('>Scope, one glob per line</span>')
    expect(html).toContain('>Restricted</span>')
    expect(html).toContain('>Review</button>')
    expect(html).toContain('>Cancel</button>')
    expect(html).toContain('checked=""')
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

  it('points a beginner at the chat on the waiting card', () => {
    const html = renderToString(
      createElement(Waiting, {
        status: 'live',
        agents: [{ key: 'orchestrator', name: 'Orchestrator', status: 'idle' }],
      })
    )
    expect(html).toContain(
      'Nothing is running yet. Press / or click ORCHESTRATOR at the top, and the chat opens at the bottom right.'
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
