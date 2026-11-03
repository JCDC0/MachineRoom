import { act, createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import McpSettings, {
  MCP_ARGS_PROBLEM,
  MCP_COMMAND_PROBLEM,
  MCP_EMPTY_DRAFT,
  MCP_NAME_PROBLEM,
  MCP_SERVER_PROBLEM,
  MCP_TOOL_PROBLEM,
  MCP_TRANSPORT_PROBLEM,
  MCP_UNAVAILABLE,
  MCP_URL_PROBLEM,
  mcpArguments,
  mcpDraftProblem,
  mcpResultText,
  mcpServerList,
  mcpServerTarget,
  mcpTesterProblem,
  mcpToolErrors,
  mcpToolList,
  saveMcpPayload,
  splitArgs,
  toggleMcpPayload,
} from '../src/ui/McpSettings.jsx'
import Settings from '../src/ui/Settings.jsx'
import { buttonWithText, click, withDom } from './helpers/uiDom.js'

const SERVERS = [
  {
    name: 'docs',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-filesystem'],
    url: '',
    enabled: true,
  },
  {
    name: 'remote',
    transport: 'http',
    command: '',
    args: [],
    url: 'https://mcp.example/rpc',
    enabled: false,
  },
]

const TOOLS = [
  { server: 'docs', name: 'read_file', description: 'Read a file from the project' },
  { server: 'remote', name: 'search', description: '' },
]

function makeClient({ servers = SERVERS, tools = TOOLS, errors = [] } = {}) {
  const calls = { save: [], remove: [], tools: 0, call: [] }
  const client = {
    mcpServers: async () => ({ ok: true, servers }),
    saveMcpServer: async (payload) => {
      calls.save.push(payload)
      return { ok: true }
    },
    deleteMcpServer: async (payload) => {
      calls.remove.push(payload)
      return { ok: true }
    },
    mcpTools: async () => {
      calls.tools += 1
      return { ok: true, tools, errors }
    },
    callMcpTool: async (payload) => {
      calls.call.push(payload)
      return { ok: true, result: { content: 'ok' } }
    },
  }
  return { client, calls }
}

async function mount(root, props) {
  await act(async () => {
    root.render(createElement(McpSettings, props))
  })
  await act(async () => {})
}

async function submit(root, node) {
  await act(async () => {
    node.dispatchEvent({ type: 'submit', bubbles: true, cancelable: true })
  })
}

describe('the MCP settings helpers', () => {
  it('reads the server list from an array or an answer and drops nameless rows', () => {
    const rows = mcpServerList({
      ok: true,
      servers: [
        { name: ' docs ', transport: 'stdio', command: 'npx', args: ['-y', 7], envNames: ['A'], enabled: false },
        { name: 'remote', transport: 'http', url: 'https://mcp.example/rpc' },
        { transport: 'stdio' },
        null,
      ],
    })
    expect(rows).toEqual([
      {
        name: 'docs',
        transport: 'stdio',
        command: 'npx',
        args: ['-y', '7'],
        envNames: ['A'],
        url: '',
        enabled: false,
      },
      {
        name: 'remote',
        transport: 'http',
        command: '',
        args: [],
        envNames: [],
        url: 'https://mcp.example/rpc',
        enabled: true,
      },
    ])
    expect(mcpServerList([{ name: 'one', transport: 'sse' }])[0].transport).toBe('stdio')
    expect(mcpServerList([{ name: 'secret', transport: 'stdio', env: { TOKEN: 'value' } }])[0].envNames).toEqual([])
    expect(mcpServerList([{ name: 'secret', transport: 'stdio', env: { TOKEN: 'value' } }])[0].env).toBeUndefined()
    expect(mcpServerList(null)).toEqual([])
    expect(mcpServerList({ servers: 'nope' })).toEqual([])
  })

  it('reads the tool list and its errors', () => {
    expect(mcpToolList({ tools: TOOLS })).toEqual([
      { server: 'docs', name: 'read_file', description: 'Read a file from the project' },
      { server: 'remote', name: 'search', description: '' },
    ])
    expect(mcpToolList([{ name: ' one ', server: 'docs' }, { description: 'no name' }])).toEqual([
      { server: 'docs', name: 'one', description: '' },
    ])
    expect(mcpToolList(null)).toEqual([])
    expect(mcpToolErrors({ errors: ['docs did not answer', '', { message: 'remote did not answer' }] })).toEqual([
      'docs did not answer',
      'remote did not answer',
    ])
    expect(mcpToolErrors(null)).toEqual([])
  })

  it('splits args on spaces and keeps quoted groups together', () => {
    expect(splitArgs('')).toEqual([])
    expect(splitArgs('   ')).toEqual([])
    expect(splitArgs('-y @scope/server')).toEqual(['-y', '@scope/server'])
    expect(splitArgs('"--a b" c')).toEqual(['--a b', 'c'])
    expect(splitArgs("'one two' three")).toEqual(['one two', 'three'])
    expect(splitArgs('a  b\tc')).toEqual(['a', 'b', 'c'])
  })

  it('checks the add form', () => {
    expect(mcpDraftProblem(MCP_EMPTY_DRAFT)).toBe(MCP_NAME_PROBLEM)
    expect(mcpDraftProblem({ ...MCP_EMPTY_DRAFT, name: 'bad/name', command: 'npx' })).toBe(MCP_NAME_PROBLEM)
    expect(mcpDraftProblem({ ...MCP_EMPTY_DRAFT, name: 'a'.repeat(41), command: 'npx' })).toBe(MCP_NAME_PROBLEM)
    expect(mcpDraftProblem({ ...MCP_EMPTY_DRAFT, name: 'docs', transport: 'sse', command: 'npx' })).toBe(MCP_TRANSPORT_PROBLEM)
    expect(mcpDraftProblem({ ...MCP_EMPTY_DRAFT, name: 'docs', transport: 'stdio', command: ' ' })).toBe(MCP_COMMAND_PROBLEM)
    expect(mcpDraftProblem({ ...MCP_EMPTY_DRAFT, name: 'docs', transport: 'stdio', command: 'npx' })).toBe('')
    expect(mcpDraftProblem({ ...MCP_EMPTY_DRAFT, name: 'remote', transport: 'http', url: '' })).toBe(MCP_URL_PROBLEM)
    expect(mcpDraftProblem({ ...MCP_EMPTY_DRAFT, name: 'remote', transport: 'http', url: 'ftp://mcp.example' })).toBe(MCP_URL_PROBLEM)
    expect(mcpDraftProblem({ ...MCP_EMPTY_DRAFT, name: 'remote', transport: 'http', url: 'not a url' })).toBe(MCP_URL_PROBLEM)
    expect(mcpDraftProblem({ ...MCP_EMPTY_DRAFT, name: 'remote', transport: 'http', url: 'https://mcp.example/rpc' })).toBe('')
  })

  it('builds the save body with the confirmation and the right fields', () => {
    expect(saveMcpPayload({ name: ' docs ', transport: 'stdio', command: ' npx ', args: '-y @scope/server' })).toEqual({
      name: 'docs',
      transport: 'stdio',
      command: 'npx',
      args: ['-y', '@scope/server'],
      url: '',
      enabled: true,
      confirmed: true,
    })
    expect(saveMcpPayload({ name: 'remote', transport: 'http', command: 'npx', args: 'x', url: ' https://mcp.example/rpc ' })).toEqual({
      name: 'remote',
      transport: 'http',
      command: '',
      args: [],
      url: 'https://mcp.example/rpc',
      enabled: true,
      confirmed: true,
    })
    expect(saveMcpPayload({ name: 'docs', transport: 'stdio', command: 'npx' }).env).toBeUndefined()
  })

  it('turns a server on or off without its saved env', () => {
    const payload = toggleMcpPayload({
      name: 'docs',
      transport: 'stdio',
      command: 'npx',
      args: ['-y'],
      envNames: ['TOKEN_NAME'],
      enabled: true,
    })
    expect(payload).toEqual({
      name: 'docs',
      transport: 'stdio',
      command: 'npx',
      args: ['-y'],
      url: '',
      enabled: false,
      confirmed: true,
    })
    expect(toggleMcpPayload({ ...SERVERS[1] }).enabled).toBe(true)
  })

  it('shows either the command or the URL of a server', () => {
    expect(mcpServerTarget(SERVERS[0])).toBe('npx -y @modelcontextprotocol/server-filesystem')
    expect(mcpServerTarget(SERVERS[1])).toBe('https://mcp.example/rpc')
    expect(mcpServerTarget({ transport: 'stdio', command: '', args: [] })).toBe('No command')
    expect(mcpServerTarget({ transport: 'http', url: '' })).toBe('No URL')
  })

  it('reads the tool arguments as a JSON object', () => {
    expect(mcpArguments('')).toEqual({ value: {}, problem: '' })
    expect(mcpArguments('{"path":"a.md"}')).toEqual({ value: { path: 'a.md' }, problem: '' })
    expect(mcpArguments('[]').problem).toBe(MCP_ARGS_PROBLEM)
    expect(mcpArguments('null').problem).toBe(MCP_ARGS_PROBLEM)
    expect(mcpArguments('{bad').problem).toBe(MCP_ARGS_PROBLEM)
    expect(mcpArguments('"text"').problem).toBe(MCP_ARGS_PROBLEM)
  })

  it('checks the run tool tester', () => {
    expect(mcpTesterProblem({ server: '', tool: 'read', arguments: '' })).toBe(MCP_SERVER_PROBLEM)
    expect(mcpTesterProblem({ server: 'docs', tool: ' ', arguments: '' })).toBe(MCP_TOOL_PROBLEM)
    expect(mcpTesterProblem({ server: 'docs', tool: 'read', arguments: '[]' })).toBe(MCP_ARGS_PROBLEM)
    expect(mcpTesterProblem({ server: 'docs', tool: 'read', arguments: '{}' })).toBe('')
  })

  it('turns a tool answer into text', () => {
    expect(mcpResultText({ ok: true, result: { content: 'ok' } })).toContain('"content": "ok"')
    expect(mcpResultText({ ok: true, result: 'plain' })).toBe('plain')
    expect(mcpResultText({ ok: false, problem: 'The server did not answer.' })).toBe('The server did not answer.')
    expect(mcpResultText({ ok: false })).toBe('The tool call failed.')
    expect(mcpResultText({ content: 'ok' })).toContain('"content": "ok"')
    expect(mcpResultText(null)).toBe('')
  })
})

describe('the MCP settings panel', () => {
  it('lists each server with its transport, command or URL, switch and Remove', async () => {
    const { client } = makeClient()
    await withDom(async ({ container, root }) => {
      await mount(root, { client })
      const rows = container.querySelectorAll('.mr-mcp-server')
      expect(rows).toHaveLength(2)
      expect(rows[0].textContent).toContain('docs')
      expect(rows[0].textContent).toContain('stdio')
      expect(rows[0].textContent).toContain('npx -y @modelcontextprotocol/server-filesystem')
      expect(rows[1].textContent).toContain('remote')
      expect(rows[1].textContent).toContain('http')
      expect(rows[1].textContent).toContain('https://mcp.example/rpc')
      const switches = rows.map((row) => row.querySelector('[role="switch"]'))
      expect(switches[0].getAttribute('aria-checked')).toBe('true')
      expect(switches[0].textContent.trim()).toBe('On')
      expect(switches[1].getAttribute('aria-checked')).toBe('false')
      expect(switches[1].textContent.trim()).toBe('Off')
      expect(buttonWithText(rows[0], 'Remove')).not.toBeNull()
    })
  })

  it('turns a server off through saveMcpServer with the confirmation', async () => {
    const { client, calls } = makeClient()
    await withDom(async ({ container, root }) => {
      await mount(root, { client })
      const row = container.querySelectorAll('.mr-mcp-server')[0]
      await click(root, row.querySelector('[role="switch"]'))
      expect(calls.save).toHaveLength(1)
      expect(calls.save[0]).toMatchObject({ name: 'docs', transport: 'stdio', enabled: false, confirmed: true })
      expect(container.textContent).toContain('docs is off.')
    })
  })

  it('closes its confirm card on Escape without closing Settings', async () => {
    const { client, calls } = makeClient()
    await withDom(async ({ container, root, dom }) => {
      await mount(root, { client })
      const row = container.querySelectorAll('.mr-mcp-server')[0]
      await click(root, buttonWithText(row, 'Remove'))
      expect(container.querySelector('.brief-confirm-card')).not.toBeNull()
      const event = { type: 'keydown', key: 'Escape', bubbles: true, cancelable: true }
      await act(async () => {
        dom.window.dispatchEvent(event)
      })
      expect(container.querySelector('.brief-confirm-card')).toBeNull()
      expect(event.cancelBubble).toBe(true)
      expect(calls.remove).toEqual([])
    })
  })

  it('removes a server through deleteMcpServer with the confirmation', async () => {
    const { client, calls } = makeClient()
    await withDom(async ({ container, root }) => {
      await mount(root, { client })
      const row = container.querySelectorAll('.mr-mcp-server')[0]
      await click(root, buttonWithText(row, 'Remove'))
      expect(calls.remove).toEqual([])
      const card = container.querySelector('.brief-confirm-card')
      expect(card).not.toBeNull()
      expect(card.textContent).toContain('Remove docs? Its command and settings are lost.')
      await click(root, buttonWithText(card, 'Remove server'))
      expect(calls.remove).toEqual([{ name: 'docs', confirmed: true }])
      expect(container.querySelector('.brief-confirm-card')).toBeNull()
    })
  })

  it('adds an MCP server with its command and args behind the confirmation', async () => {
    const { client, calls } = makeClient({ servers: [] })
    await withDom(async ({ container, root }) => {
      await mount(root, {
        client,
        initialDraft: { name: 'files', transport: 'stdio', command: 'npx', args: '-y @scope/server' },
      })
      await submit(root, container.querySelector('.mr-mcp-form'))
      expect(calls.save).toEqual([
        {
          name: 'files',
          transport: 'stdio',
          command: 'npx',
          args: ['-y', '@scope/server'],
          url: '',
          enabled: true,
          confirmed: true,
        },
      ])
      expect(container.textContent).toContain('Added files.')
    })
  })

  it('refuses an add with no name and names the problem', async () => {
    const { client, calls } = makeClient({ servers: [] })
    await withDom(async ({ container, root }) => {
      await mount(root, { client })
      await submit(root, container.querySelector('.mr-mcp-form'))
      expect(calls.save).toEqual([])
      expect(container.textContent).toContain(MCP_NAME_PROBLEM)
    })
  })

  it('refreshes the tools and lists them under the Tools heading', async () => {
    const { client, calls } = makeClient()
    await withDom(async ({ container, root }) => {
      await mount(root, { client })
      expect(container.textContent).toContain('Refresh tools to list the tools each server offers.')
      await click(root, buttonWithText(container, 'Refresh tools'))
      expect(calls.tools).toBe(1)
      const tools = container.querySelectorAll('.mr-mcp-tool')
      expect(tools).toHaveLength(2)
      expect(tools[0].textContent).toContain('read_file')
      expect(tools[0].textContent).toContain('docs')
      expect(tools[0].textContent).toContain('Read a file from the project')
    })
  })

  it('asks on a card naming the server and tool, and only the card calls it', async () => {
    const { client, calls } = makeClient()
    await withDom(async ({ container, root }) => {
      await mount(root, {
        client,
        initialTester: { server: 'docs', tool: 'read_file', arguments: '{"path":"README.md"}' },
      })
      await submit(root, container.querySelector('.mr-mcp-run'))
      expect(calls.call).toEqual([])
      const card = container.querySelector('.mr-mcp-run-confirm')
      expect(card).not.toBeNull()
      expect(card.textContent).toContain('Run read_file on docs?')
      expect(card.textContent).toContain('{"path":"README.md"}')
      await click(root, buttonWithText(card, 'Run tool'))
      expect(calls.call).toEqual([
        { server: 'docs', tool: 'read_file', arguments: { path: 'README.md' }, confirmed: true },
      ])
      expect(container.querySelector('.mr-mcp-run-confirm')).toBeNull()
      expect(container.querySelector('.mr-mcp-result').textContent).toContain('"content": "ok"')
    })
  })

  it('cancels a run tool card without calling the tool', async () => {
    const { client, calls } = makeClient()
    await withDom(async ({ container, root }) => {
      await mount(root, {
        client,
        initialTester: { server: 'docs', tool: 'read_file', arguments: '{"path":"README.md"}' },
      })
      await submit(root, container.querySelector('.mr-mcp-run'))
      const card = container.querySelector('.mr-mcp-run-confirm')
      await click(root, buttonWithText(card, 'Cancel'))
      expect(calls.call).toEqual([])
      expect(container.querySelector('.mr-mcp-run-confirm')).toBeNull()
    })
  })

  it('refuses a tool call with arguments that are not a JSON object', async () => {
    const { client, calls } = makeClient()
    await withDom(async ({ container, root }) => {
      await mount(root, {
        client,
        initialTester: { server: 'docs', tool: 'read_file', arguments: '[]' },
      })
      await submit(root, container.querySelector('.mr-mcp-run'))
      expect(calls.call).toEqual([])
      expect(container.querySelector('.mr-mcp-result').textContent).toContain(MCP_ARGS_PROBLEM)
    })
  })

  it('says a newer bridge is needed when the client has no MCP methods', async () => {
    await withDom(async ({ container, root }) => {
      await mount(root, { client: {} })
      expect(container.textContent).toContain('MCP tools')
      expect(container.textContent).toContain(MCP_UNAVAILABLE)
    })
  })

  it('renders the server form with Name, Transport, Command and Args', () => {
    const html = renderToString(
      createElement(McpSettings, {
        client: makeClient().client,
        initialServers: SERVERS,
        initialTools: { ok: true, tools: TOOLS, errors: [] },
      })
    )
    expect(html).toContain('MCP tools')
    expect(html).toContain('Servers')
    expect(html).toContain('Add MCP server')
    expect(html).toContain('Name')
    expect(html).toContain('Transport')
    expect(html).toContain('Command')
    expect(html).toContain('Args')
    expect(html).toContain('id="mr-mcp-name"')
    expect(html).toContain('id="mr-mcp-transport"')
    expect(html).toContain('id="mr-mcp-command"')
    expect(html).toContain('id="mr-mcp-args"')
    expect(html).toContain('Tools')
    expect(html).toContain('Refresh tools')
    expect(html).toContain('Run tool')
    expect(html).toContain('read_file')
  })

  it('shows URL instead of Command and Args for an http server', () => {
    const html = renderToString(
      createElement(McpSettings, {
        initialDraft: { name: 'remote', transport: 'http', url: 'https://mcp.example/rpc' },
        initialServers: [],
      })
    )
    expect(html).toContain('id="mr-mcp-url"')
    expect(html).not.toContain('id="mr-mcp-command"')
    expect(html).not.toContain('id="mr-mcp-args"')
  })

  it('mounts the MCP section in Settings and can be closed', () => {
    const open = renderToString(
      createElement(Settings, { effects: { alwaysDepth: 2 }, onChange: () => {}, onClose: () => {} })
    )
    expect(open).toContain('MCP tools')
    expect(open).toContain(MCP_UNAVAILABLE)
    const closed = renderToString(
      createElement(Settings, { open: false, effects: { alwaysDepth: 2 }, onChange: () => {}, onClose: () => {} })
    )
    expect(closed).toBe('')
  })
})