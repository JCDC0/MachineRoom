# Control client: MCP servers and tools

This note documents the MCP server and tool methods of the control client, task U63. The older methods of the contract are in `docs/agents/history/CONTROL-CLIENT.md`. The real client (`src/control/client.js`) calls the bridge routes in `server/index.js`, and the mock (`src/control/mock.js`) keeps the same data in memory. Panels use only this object and never call `fetch`.

The five methods are also in `CLIENT_METHODS` in `src/control/mock.js`, so the shared suite (`tests/control-contract.test.js`) fails when either client leaves one out.

## Methods

| Method | Bridge route | Returns |
| --- | --- | --- |
| `mcpServers()` | `GET /api/mcp/servers` | `{ ok, servers }`, the saved server entries |
| `saveMcpServer({ name, transport = 'stdio', command = '', args = [], env = {}, url = '', enabled = true, confirmed = false })` | `POST /api/mcp/servers` | `{ ok, server, servers }` on the mock, the saved entry and the whole list |
| `deleteMcpServer({ name, confirmed = false })` | `POST /api/mcp/servers/NAME/delete` | `{ ok, deleted, servers }` on the mock |
| `mcpTools()` | `GET /api/mcp/tools` | `{ ok, tools, errors }`, the tools of every enabled server |
| `callMcpTool({ server, tool, arguments: toolArgs = {} })` | `POST /api/mcp/call` | `{ ok, result, problem }` |

A save or a delete sends `confirmed: false` unless the caller passes `confirmed: true`, so call either only after the owner confirmed. The bridge refuses an unconfirmed write, and the mock refuses it with `Confirm saving the MCP server first.` or `Confirm deleting the MCP server first.`

A name is 1 to 40 letters, digits, dashes or underscores, and the request path encodes it. A `stdio` server needs a non-empty `command`; an `http` server needs an `http` or `https` `url`. The mock refuses a bad entry with one sentence: `The server name must be 1 to 40 letters, digits, dashes or underscores.`, `Choose stdio or http.`, `A stdio server needs a command.` or `An http server needs an http or https address.` A save with an existing name replaces that entry, and fields left out keep their saved values, so a switch can send only `{ name, enabled, confirmed: true }`.

A server change sends `{ topic: 'mcp' }` to a listener from `subscribe`, so a panel reads `mcpServers()` again. A failed tool call answers `ok: false` with a `problem` sentence instead of rejecting. The mock answers `The MCP server NAME is not saved.`, `The MCP server NAME is off.` or `The server NAME has no tool TOOL.`; a call with no server or tool name rejects with `Choose an MCP server and a tool.`

## Shapes

```
McpServer  { name, transport: 'stdio' | 'http', command, args: string[], env: object, url, enabled: boolean }
McpTool    { server, name, description, inputSchema: object }
McpTools   { ok: boolean, tools: McpTool[], errors: string[] }
McpCall    { ok: boolean, result: { content: [{ type: 'text', text }], isError } | null, problem: string | null }
```

`mcpTools()` lists the tools of every enabled server, so a disabled server keeps its entry in `mcpServers()` and drops out of the tool list. The mock serves two servers, `filesystem` on stdio and `docs` on http, and three sample tools.

## Tests

`tests/control-contract.test.js` checks the URL, method and body of all five methods on the real HTTP client, including the encoded name and the confirm flags. It checks the same five methods on the mock: the sample list, a save, a replace that keeps the saved fields, a delete, the `mcp` notice, the tool list, one tool call and each refusal.
