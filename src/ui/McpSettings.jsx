import { useEffect, useRef, useState } from 'react'
import { useDialogFocus } from './dialogFocus.js'

export const MCP_TRANSPORTS = ['stdio', 'http']
export const MCP_NAME_PATTERN = /^[A-Za-z0-9_-]{1,40}$/
export const MCP_EMPTY_DRAFT = Object.freeze({
  name: '',
  transport: 'stdio',
  command: '',
  args: '',
  url: '',
})
export const MCP_UNAVAILABLE = 'MCP tools need a newer bridge.'
export const MCP_NAME_PROBLEM = 'The server name must be 1 to 40 letters, digits, dashes or underscores.'
export const MCP_TRANSPORT_PROBLEM = 'Choose stdio or http.'
export const MCP_COMMAND_PROBLEM = 'Add the command that starts the server.'
export const MCP_URL_PROBLEM = 'The server URL must start with http:// or https://.'
export const MCP_ARGS_PROBLEM = 'The arguments must be a JSON object.'
export const MCP_SERVER_PROBLEM = 'Choose the MCP server to call.'
export const MCP_TOOL_PROBLEM = 'Add the tool name to call.'

export function mcpServerList(answer) {
  const list = Array.isArray(answer) ? answer : Array.isArray(answer?.servers) ? answer.servers : []
  const rows = []
  for (const entry of list) {
    if (!entry || typeof entry !== 'object') continue
    const name = typeof entry.name === 'string' ? entry.name.trim() : ''
    if (name === '') continue
    const envNames = Array.isArray(entry.envNames)
      ? entry.envNames.map((item) => String(item)).filter((item) => item !== '')
      : []
    rows.push({
      name,
      transport: entry.transport === 'http' ? 'http' : 'stdio',
      command: typeof entry.command === 'string' ? entry.command : '',
      args: Array.isArray(entry.args) ? entry.args.map((item) => String(item)) : [],
      envNames,
      url: typeof entry.url === 'string' ? entry.url : '',
      enabled: entry.enabled !== false,
    })
  }
  return rows
}

export function mcpToolList(answer) {
  const list = Array.isArray(answer) ? answer : Array.isArray(answer?.tools) ? answer.tools : []
  const rows = []
  for (const entry of list) {
    if (!entry || typeof entry !== 'object') continue
    const name = typeof entry.name === 'string' ? entry.name.trim() : ''
    if (name === '') continue
    rows.push({
      server: typeof entry.server === 'string' ? entry.server : '',
      name,
      description: typeof entry.description === 'string' ? entry.description : '',
    })
  }
  return rows
}

export function mcpToolErrors(answer) {
  const list = Array.isArray(answer?.errors) ? answer.errors : []
  return list.map((item) => (typeof item === 'string' ? item : String(item?.message ?? ''))).filter((item) => item !== '')
}

export function splitArgs(text) {
  const args = []
  let current = ''
  let quote = ''
  let has = false
  for (const char of String(text ?? '')) {
    if (quote !== '') {
      if (char === quote) {
        quote = ''
        continue
      }
      current += char
      continue
    }
    if (char === '"' || char === "'") {
      quote = char
      has = true
      continue
    }
    if (/\s/.test(char)) {
      if (has) args.push(current)
      current = ''
      has = false
      continue
    }
    current += char
    has = true
  }
  if (has) args.push(current)
  return args
}

export function mcpDraftProblem(draft) {
  const name = typeof draft?.name === 'string' ? draft.name.trim() : ''
  if (!MCP_NAME_PATTERN.test(name)) return MCP_NAME_PROBLEM
  const transport = String(draft?.transport ?? '')
  if (!MCP_TRANSPORTS.includes(transport)) return MCP_TRANSPORT_PROBLEM
  if (transport === 'stdio') {
    const command = typeof draft?.command === 'string' ? draft.command.trim() : ''
    if (command === '') return MCP_COMMAND_PROBLEM
    return ''
  }
  const text = typeof draft?.url === 'string' ? draft.url.trim() : ''
  try {
    const url = new URL(text)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return MCP_URL_PROBLEM
    if (url.hostname === '') return MCP_URL_PROBLEM
  } catch {
    return MCP_URL_PROBLEM
  }
  return ''
}

export function mcpServerFields(server, patch = {}) {
  const merged = { ...server, ...patch }
  const transport = merged.transport === 'http' ? 'http' : 'stdio'
  return {
    name: String(merged.name ?? '').trim(),
    transport,
    command: transport === 'stdio' && typeof merged.command === 'string' ? merged.command.trim() : '',
    args: transport === 'stdio' && Array.isArray(merged.args) ? merged.args.map((item) => String(item)) : [],
    url: transport === 'http' && typeof merged.url === 'string' ? merged.url.trim() : '',
    enabled: merged.enabled !== false,
  }
}

export function saveMcpPayload(draft) {
  return {
    name: typeof draft?.name === 'string' ? draft.name.trim() : '',
    transport: draft?.transport === 'http' ? 'http' : 'stdio',
    command: draft?.transport === 'http' ? '' : String(draft?.command ?? '').trim(),
    args: draft?.transport === 'http' ? [] : splitArgs(draft?.args),
    url: draft?.transport === 'http' ? String(draft?.url ?? '').trim() : '',
    enabled: true,
    confirmed: true,
  }
}

export function toggleMcpPayload(server) {
  return { ...mcpServerFields(server, { enabled: server?.enabled !== true }), confirmed: true }
}

export function mcpServerTarget(server) {
  if (server?.transport === 'http') return server.url || 'No URL'
  const args = Array.isArray(server?.args) ? server.args : []
  return [server?.command || 'No command', ...args].join(' ').trim()
}

export function mcpArguments(text) {
  const raw = String(text ?? '').trim()
  if (raw === '') return { value: {}, problem: '' }
  let parsed
  try {
    parsed = JSON.parse(raw)
  } catch {
    return { value: null, problem: MCP_ARGS_PROBLEM }
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { value: null, problem: MCP_ARGS_PROBLEM }
  }
  return { value: parsed, problem: '' }
}

export function mcpTesterProblem(tester) {
  const server = typeof tester?.server === 'string' ? tester.server.trim() : ''
  if (server === '') return MCP_SERVER_PROBLEM
  const tool = typeof tester?.tool === 'string' ? tester.tool.trim() : ''
  if (tool === '') return MCP_TOOL_PROBLEM
  return mcpArguments(tester?.arguments).problem
}

function prettyValue(value) {
  if (value === undefined) return ''
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

export function mcpResultText(answer) {
  if (answer === null || answer === undefined) return ''
  if (typeof answer === 'string') return answer
  const problem = typeof answer.problem === 'string' ? answer.problem.trim() : ''
  if (answer.ok === false) return problem || 'The tool call failed.'
  if (Object.hasOwn(answer, 'result')) return prettyValue(answer.result)
  return prettyValue(answer)
}

export default function McpSettings({
  client = null,
  initialServers = null,
  initialTools = null,
  initialDraft = null,
  initialTester = null,
}) {
  const supported = typeof client?.mcpServers === 'function'
  const [servers, setServers] = useState(() => mcpServerList(initialServers))
  const [loading, setLoading] = useState(() => supported && !Array.isArray(initialServers))
  const [listError, setListError] = useState(() => (supported ? '' : MCP_UNAVAILABLE))
  const [draft, setDraft] = useState(() => ({ ...MCP_EMPTY_DRAFT, ...(initialDraft ?? {}) }))
  const [busy, setBusy] = useState('')
  const [notice, setNotice] = useState({ text: '', error: false })
  const [tools, setTools] = useState(() => mcpToolList(initialTools))
  const [toolErrors, setToolErrors] = useState(() => mcpToolErrors(initialTools))
  const [toolsBusy, setToolsBusy] = useState(false)
  const [toolsLoaded, setToolsLoaded] = useState(Boolean(initialTools))
  const [tester, setTester] = useState(() => ({ server: '', tool: '', arguments: '', ...(initialTester ?? {}) }))
  const [toolBusy, setToolBusy] = useState(false)
  const [toolResult, setToolResult] = useState({ text: '', error: false })
  const [runConfirm, setRunConfirm] = useState(null)
  const [removeConfirm, setRemoveConfirm] = useState(null)
  const removeRef = useRef(null)
  const runRef = useRef(null)

  useDialogFocus(Boolean(removeConfirm), { containerRef: removeRef })
  useDialogFocus(Boolean(runConfirm), { containerRef: runRef })

  useEffect(() => {
    if (!removeConfirm && !runConfirm) return undefined
    function onKey(event) {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopPropagation()
      if (busy !== '' || toolBusy) return
      setRemoveConfirm(null)
      setRunConfirm(null)
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [removeConfirm, runConfirm, busy, toolBusy])

  async function readServers() {
    if (typeof client?.mcpServers !== 'function') {
      setListError(MCP_UNAVAILABLE)
      setLoading(false)
      return
    }
    try {
      const answer = await client.mcpServers()
      setServers(mcpServerList(answer))
      setListError('')
    } catch (error) {
      setListError(String(error?.message ?? 'Could not load the MCP servers.'))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (typeof client?.mcpServers !== 'function') return undefined
    let active = true
    setLoading(true)
    Promise.resolve()
      .then(() => client.mcpServers())
      .then((answer) => {
        if (!active) return
        setServers(mcpServerList(answer))
        setListError('')
        setLoading(false)
      })
      .catch((error) => {
        if (!active) return
        setListError(String(error?.message ?? 'Could not load the MCP servers.'))
        setLoading(false)
      })
    return () => {
      active = false
    }
  }, [client])

  function edit(patch) {
    setDraft((current) => ({ ...current, ...patch }))
    setNotice({ text: '', error: false })
  }

  async function addServer(event) {
    event.preventDefault()
    const problem = mcpDraftProblem(draft)
    if (problem !== '') {
      setNotice({ text: problem, error: true })
      return
    }
    if (typeof client?.saveMcpServer !== 'function') {
      setNotice({ text: MCP_UNAVAILABLE, error: true })
      return
    }
    const name = draft.name.trim()
    setBusy('add')
    try {
      await client.saveMcpServer(saveMcpPayload(draft))
      setDraft({ ...MCP_EMPTY_DRAFT })
      setNotice({ text: `Added ${name}.`, error: false })
      await readServers()
    } catch (error) {
      setNotice({ text: String(error?.message ?? 'Could not add the MCP server.'), error: true })
    }
    setBusy('')
  }

  async function toggleServer(server) {
    if (typeof client?.saveMcpServer !== 'function') {
      setNotice({ text: MCP_UNAVAILABLE, error: true })
      return
    }
    const next = !server.enabled
    setBusy(server.name)
    try {
      await client.saveMcpServer(toggleMcpPayload(server))
      setServers((current) => current.map((entry) => (entry.name === server.name ? { ...entry, enabled: next } : entry)))
      setNotice({ text: `${server.name} is ${next ? 'on' : 'off'}.`, error: false })
      await readServers()
    } catch (error) {
      setNotice({ text: String(error?.message ?? 'Could not change the MCP server.'), error: true })
    }
    setBusy('')
  }

  async function removeServer(server) {
    if (typeof client?.deleteMcpServer !== 'function') {
      setNotice({ text: MCP_UNAVAILABLE, error: true })
      return
    }
    setBusy(server.name)
    try {
      await client.deleteMcpServer({ name: server.name, confirmed: true })
      setServers((current) => current.filter((entry) => entry.name !== server.name))
      setTester((current) => (current.server === server.name ? { ...current, server: '' } : current))
      setNotice({ text: `Removed ${server.name}.`, error: false })
      setRemoveConfirm(null)
      await readServers()
    } catch (error) {
      setNotice({ text: String(error?.message ?? 'Could not remove the MCP server.'), error: true })
    }
    setBusy('')
  }

  async function refreshTools() {
    if (typeof client?.mcpTools !== 'function') {
      setTools([])
      setToolErrors([MCP_UNAVAILABLE])
      setToolsLoaded(true)
      return
    }
    setToolsBusy(true)
    try {
      const answer = await client.mcpTools()
      setTools(mcpToolList(answer))
      setToolErrors(mcpToolErrors(answer))
      setToolsLoaded(true)
    } catch (error) {
      setTools([])
      setToolErrors([String(error?.message ?? 'Could not read the MCP tools.')])
      setToolsLoaded(true)
    }
    setToolsBusy(false)
  }

  async function runTool(event) {
    event.preventDefault()
    const problem = mcpTesterProblem(tester)
    if (problem !== '') {
      setToolResult({ text: problem, error: true })
      return
    }
    const args = mcpArguments(tester.arguments).value
    if (typeof client?.callMcpTool !== 'function') {
      setToolResult({ text: MCP_UNAVAILABLE, error: true })
      return
    }
    setToolResult({ text: '', error: false })
    setRunConfirm({ server: tester.server.trim(), tool: tester.tool.trim(), arguments: args })
  }

  async function runConfirmed() {
    if (!runConfirm) return
    setToolBusy(true)
    setToolResult({ text: '', error: false })
    try {
      const answer = await client.callMcpTool({ ...runConfirm, confirmed: true })
      setToolResult({ text: mcpResultText(answer), error: answer?.ok === false })
    } catch (error) {
      setToolResult({ text: String(error?.message ?? 'The tool call failed.'), error: true })
    }
    setToolBusy(false)
    setRunConfirm(null)
  }

  const serverNames = []
  for (const item of [...servers.map((server) => server.name), ...tools.map((tool) => tool.server)]) {
    if (item !== '' && !serverNames.includes(item)) serverNames.push(item)
  }
  const rowLocked = busy !== '' || removeConfirm !== null

  return (
    <section className="hud-settings-section mr-mcp" aria-labelledby="mr-mcp-title">
      <h3 id="mr-mcp-title" className="hud-settings-section-title">MCP tools</h3>

      <div className="mr-mcp-group">
        <h4 className="mr-mcp-subtitle">Servers</h4>
        {loading && <p className="mr-mcp-state mono">Loading</p>}
        {listError !== '' && <p className="mr-mcp-state is-error">{listError}</p>}
        {!loading && listError === '' && servers.length === 0 && (
          <p className="mr-mcp-state">No MCP servers yet.</p>
        )}
        {servers.length > 0 && (
          <ul className="mr-mcp-servers">
            {servers.map((server) => (
              <li key={server.name} className="mr-mcp-server">
                <div className="mr-mcp-server-head">
                  <span className="mr-mcp-name mono">{server.name}</span>
                  <span className="mr-mcp-transport mono">{server.transport}</span>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={server.enabled}
                    aria-label={`${server.enabled ? 'Disable' : 'Enable'} ${server.name}`}
                    className={`hud-settings-switch ${server.enabled ? 'is-on' : ''}`}
                    disabled={rowLocked}
                    onClick={() => toggleServer(server)}
                  >
                    {server.enabled ? 'On' : 'Off'}
                  </button>
                  <button
                    type="button"
                    className="mr-mcp-remove mono"
                    disabled={rowLocked}
                    onClick={() => setRemoveConfirm(server)}
                  >
                    Remove
                  </button>
                </div>
                <p className="mr-mcp-target mono">{mcpServerTarget(server)}</p>
              </li>
            ))}
          </ul>
        )}
        {removeConfirm && (
          <div ref={removeRef} className="brief-confirm-card" role="dialog" aria-modal="true" aria-label="Remove MCP server">
            <p className="brief-confirm-warning">
              {`Remove ${removeConfirm.name}? Its command and settings are lost.`}
            </p>
            <div className="brief-confirm-actions">
              <button
                type="button"
                className="hud-settings-switch brief-confirm-btn"
                disabled={busy !== ''}
                onClick={() => removeServer(removeConfirm)}
              >
                Remove server
              </button>
              <button
                type="button"
                className="hud-settings-switch"
                disabled={busy !== ''}
                onClick={() => setRemoveConfirm(null)}
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>

      <form className="mr-mcp-form" onSubmit={addServer}>
        <h4 className="mr-mcp-subtitle">Add MCP server</h4>
        <div className="mr-mcp-field">
          <label className="hud-settings-label" htmlFor="mr-mcp-name">Name</label>
          <input
            id="mr-mcp-name"
            className="mr-mcp-input mono"
            type="text"
            value={draft.name}
            disabled={busy !== ''}
            onChange={(event) => edit({ name: event.target.value })}
          />
        </div>
        <div className="mr-mcp-field">
          <label className="hud-settings-label" htmlFor="mr-mcp-transport">Transport</label>
          <select
            id="mr-mcp-transport"
            className="mr-mcp-input mono"
            value={draft.transport}
            disabled={busy !== ''}
            onChange={(event) => edit({ transport: event.target.value })}
          >
            <option value="stdio">stdio</option>
            <option value="http">http</option>
          </select>
        </div>
        {draft.transport === 'stdio' ? (
          <>
            <div className="mr-mcp-field">
              <label className="hud-settings-label" htmlFor="mr-mcp-command">Command</label>
              <input
                id="mr-mcp-command"
                className="mr-mcp-input mono"
                type="text"
                value={draft.command}
                placeholder="npx"
                disabled={busy !== ''}
                onChange={(event) => edit({ command: event.target.value })}
              />
            </div>
            <div className="mr-mcp-field">
              <label className="hud-settings-label" htmlFor="mr-mcp-args">Args</label>
              <input
                id="mr-mcp-args"
                className="mr-mcp-input mono"
                type="text"
                value={draft.args}
                placeholder="-y @scope/server"
                disabled={busy !== ''}
                onChange={(event) => edit({ args: event.target.value })}
              />
            </div>
          </>
        ) : (
          <div className="mr-mcp-field">
            <label className="hud-settings-label" htmlFor="mr-mcp-url">URL</label>
            <input
              id="mr-mcp-url"
              className="mr-mcp-input mono"
              type="url"
              value={draft.url}
              placeholder="https://mcp.example/rpc"
              disabled={busy !== ''}
              onChange={(event) => edit({ url: event.target.value })}
            />
          </div>
        )}
        <div className="mr-mcp-actions">
          <button type="submit" className="mr-mcp-add mono" disabled={busy !== ''}>
            Add MCP server
          </button>
        </div>
        {notice.text !== '' && (
          <p className={`mr-mcp-state ${notice.error ? 'is-error' : 'is-good'}`}>{notice.text}</p>
        )}
      </form>

      <div className="mr-mcp-group">
        <div className="mr-mcp-tools-head">
          <h4 className="mr-mcp-subtitle">Tools</h4>
          <button
            type="button"
            className="mr-mcp-refresh mono"
            disabled={toolsBusy}
            onClick={refreshTools}
          >
            Refresh tools
          </button>
        </div>
        {tools.length > 0 && (
          <ul className="mr-mcp-tools">
            {tools.map((tool) => (
              <li key={`${tool.server}:${tool.name}`} className="mr-mcp-tool">
                <span className="mr-mcp-tool-name mono">{tool.name}</span>
                {tool.server !== '' && <span className="mr-mcp-tool-server mono">{tool.server}</span>}
                {tool.description !== '' && (
                  <span className="mr-mcp-tool-desc">{tool.description}</span>
                )}
              </li>
            ))}
          </ul>
        )}
        {tools.length === 0 && (
          <p className="mr-mcp-state">
            {toolsBusy
              ? 'Loading tools'
              : toolsLoaded
                ? 'No tools answered.'
                : 'Refresh tools to list the tools each server offers.'}
          </p>
        )}
        {toolErrors.length > 0 && (
          <ul className="mr-mcp-errors">
            {toolErrors.map((item) => (
              <li key={item} className="mr-mcp-state is-error">{item}</li>
            ))}
          </ul>
        )}
      </div>

      <form className="mr-mcp-form mr-mcp-run" onSubmit={runTool}>
        <h4 className="mr-mcp-subtitle">Run tool</h4>
        <div className="mr-mcp-field">
          <label className="hud-settings-label" htmlFor="mr-mcp-run-server">Server</label>
          {serverNames.length > 0 ? (
            <select
              id="mr-mcp-run-server"
              className="mr-mcp-input mono"
              value={tester.server}
              disabled={toolBusy}
              onChange={(event) => setTester((current) => ({ ...current, server: event.target.value }))}
            >
              <option value="">Choose a server</option>
              {serverNames.map((name) => (
                <option key={name} value={name}>{name}</option>
              ))}
            </select>
          ) : (
            <input
              id="mr-mcp-run-server"
              className="mr-mcp-input mono"
              type="text"
              value={tester.server}
              placeholder="server name"
              disabled={toolBusy}
              onChange={(event) => setTester((current) => ({ ...current, server: event.target.value }))}
            />
          )}
        </div>
        <div className="mr-mcp-field">
          <label className="hud-settings-label" htmlFor="mr-mcp-run-tool">Tool</label>
          <input
            id="mr-mcp-run-tool"
            className="mr-mcp-input mono"
            type="text"
            value={tester.tool}
            placeholder="search"
            disabled={toolBusy}
            onChange={(event) => setTester((current) => ({ ...current, tool: event.target.value }))}
          />
        </div>
        <div className="mr-mcp-field">
          <label className="hud-settings-label" htmlFor="mr-mcp-run-args">Arguments</label>
          <textarea
            id="mr-mcp-run-args"
            className="mr-mcp-input mr-mcp-args mono"
            rows={2}
            value={tester.arguments}
            placeholder='{"query": "test"}'
            disabled={toolBusy}
            onChange={(event) => setTester((current) => ({ ...current, arguments: event.target.value }))}
          />
        </div>
        <div className="mr-mcp-actions">
          <button type="submit" className="mr-mcp-run-btn mono" disabled={toolBusy}>
            Run tool
          </button>
        </div>
        {toolResult.text !== '' && (
          <pre className={`mr-mcp-result mono ${toolResult.error ? 'is-error' : ''}`}>{toolResult.text}</pre>
        )}
      </form>

      {runConfirm && (
        <div ref={runRef} className="brief-confirm-card mr-mcp-run-confirm" role="dialog" aria-modal="true" aria-label="Run MCP tool">
          <p className="brief-confirm-warning">{`Run ${runConfirm.tool} on ${runConfirm.server}?`}</p>
          <p className="mr-mcp-target mono">{JSON.stringify(runConfirm.arguments)}</p>
          <div className="brief-confirm-actions">
            <button
              type="button"
              className="hud-settings-switch brief-confirm-btn"
              disabled={toolBusy}
              onClick={runConfirmed}
            >
              Run tool
            </button>
            <button
              type="button"
              className="hud-settings-switch"
              disabled={toolBusy}
              onClick={() => setRunConfirm(null)}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </section>
  )
}
