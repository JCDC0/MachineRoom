import { describe, expect, it } from 'vitest'
import { isLocalAddress, isOnlineCall, laneNeedsNetwork } from '../src/model/online.js'

const TRUE_CASES = [
  ['a web tool call', { tool: 'web', label: 'web search deepseek' }],
  ['a web fetch on a remote address', { tool: 'web', label: 'web fetch https://example.com/docs' }],
  ['a web search about localhost', { tool: 'web', label: 'web search localhost setup' }],
  ['git push', { tool: 'shell', label: '$ git push' }],
  ['git pull', { tool: 'shell', label: '$ git pull' }],
  ['git fetch', { tool: 'shell', label: '$ git fetch' }],
  ['git clone', { tool: 'shell', label: '$ git clone https://github.com/example/repo.git' }],
  ['git ls-remote', { tool: 'shell', label: '$ git ls-remote origin' }],
  ['gh', { tool: 'shell', label: '$ gh pr list' }],
  ['curl', { tool: 'shell', label: '$ curl https://example.com' }],
  ['wget', { tool: 'shell', label: '$ wget https://example.com/archive.zip' }],
  ['Invoke-WebRequest', { tool: 'shell', label: '$ Invoke-WebRequest https://example.com' }],
  ['Invoke-RestMethod', { tool: 'shell', label: '$ Invoke-RestMethod https://api.example.com/status' }],
  ['ssh', { tool: 'shell', label: '$ ssh build.example.com' }],
  ['scp', { tool: 'shell', label: '$ scp ./a.txt build.example.com:/tmp' }],
  ['ngrok', { tool: 'shell', label: '$ ngrok http 3000' }],
  ['cloudflared', { tool: 'shell', label: '$ cloudflared tunnel run' }],
  ['localtunnel', { tool: 'shell', label: '$ localtunnel --port 3000' }],
  ['lt --port', { tool: 'shell', label: '$ lt --port 3000' }],
  ['a git push with -C', { tool: 'shell', label: '$ git -C src push' }],
  ['a wrapped curl', { tool: 'shell', label: '$ npx curl https://example.com' }],
  ['an MCP browser tool', { tool: 'mcp', label: 'mcp playwright browser_navigate https://example.com' }],
  ['an MCP playwright tool', { tool: 'mcp', label: 'mcp playwright click' }],
  ['an MCP puppeteer tool', { tool: 'mcp', label: 'mcp puppeteer open' }],
  ['an MCP fetch tool', { tool: 'mcp', label: 'mcp fetch get https://example.com' }],
  ['an MCP http tool', { tool: 'mcp', label: 'mcp http request https://example.com' }],
  ['an MCP browser tool with no address', { tool: 'mcp', label: 'mcp browser snapshot' }],
]

const FALSE_CASES = [
  ['a plain git commit', { tool: 'shell', label: '$ git commit -m ship' }],
  ['a git status', { tool: 'shell', label: '$ git status' }],
  ['a commit message holding push', { tool: 'shell', label: '$ git commit -m "add push support"' }],
  ['a quoted word in echo', { tool: 'shell', label: '$ echo "git push"' }],
  ['a quoted curl word', { tool: 'shell', label: "$ printf 'curl'" }],
  ['a commit message holding curl and a URL', { tool: 'shell', label: '$ git commit -m "curl https://example.com"' }],
  ['a localhost address', { tool: 'shell', label: '$ curl http://localhost:3000' }],
  ['a 127.0.0.1 address', { tool: 'shell', label: '$ wget http://127.0.0.1:8080/file' }],
  ['a [::1] address', { tool: 'shell', label: '$ curl "http://[::1]:5173"' }],
  ['a localhost address in an MCP browser call', { tool: 'mcp', label: 'mcp browser navigate http://localhost:3000' }],
  ['a localhost address in a web call', { tool: 'web', label: 'web fetch http://127.0.0.1:5173' }],
  ['a file read', { tool: 'read', label: 'read curl.md' }],
  ['a file write', { tool: 'write', label: 'write gh' }],
  ['a file edit', { tool: 'edit', label: 'edit fetch.js' }],
  ['a search', { tool: 'search', label: 'grep ssh' }],
  ['a harness model call', { tool: 'other', label: 'model call claude-sonnet' }],
  ['an MCP file tool', { tool: 'mcp', label: 'mcp filesystem read_file' }],
  ['a plain command', { tool: 'shell', label: '$ npm test' }],
  ['a missing tool', { label: '$ curl https://example.com' }],
]

describe('isOnlineCall', () => {
  for (const [name, call] of TRUE_CASES) {
    it(`is true for ${name}`, () => {
      expect(isOnlineCall(call)).toBe(true)
    })
  }

  for (const [name, call] of FALSE_CASES) {
    it(`is false for ${name}`, () => {
      expect(isOnlineCall(call)).toBe(false)
    })
  }

  it('reads junk and missing fields as no online call', () => {
    expect(isOnlineCall()).toBe(false)
    expect(isOnlineCall(null)).toBe(false)
    expect(isOnlineCall({ tool: 'shell', label: null })).toBe(false)
    expect(isOnlineCall({ tool: 'shell', label: 42 })).toBe(false)
  })
})

describe('isLocalAddress', () => {
  it('finds a local endpoint and leaves a remote one alone', () => {
    expect(isLocalAddress('http://localhost:11434/v1')).toBe(true)
    expect(isLocalAddress('http://127.0.0.1:1234/v1')).toBe(true)
    expect(isLocalAddress('http://[::1]:8080/v1')).toBe(true)
    expect(isLocalAddress('https://example.com/v1')).toBe(false)
    expect(isLocalAddress('opencode-go/deepseek-v4.1-flash')).toBe(false)
    expect(isLocalAddress('')).toBe(false)
    expect(isLocalAddress(null)).toBe(false)
  })

  it('does not read a word that only holds localhost as a local address', () => {
    expect(isLocalAddress('mylocalhost.example.com')).toBe(false)
  })
})

describe('laneNeedsNetwork', () => {
  it('needs the network for a remote model and not for a local endpoint', () => {
    expect(laneNeedsNetwork({ model: 'opencode-go/deepseek-v4.1-flash' })).toBe(true)
    expect(laneNeedsNetwork({ model: 'http://127.0.0.1:11434/v1/llama3.3' })).toBe(false)
    expect(laneNeedsNetwork({ baseUrl: 'http://localhost:1234/v1', model: 'Ollama/llama3.3' })).toBe(false)
    expect(laneNeedsNetwork({ baseUrl: 'http://[::1]:8080/v1', model: 'local/model' })).toBe(false)
    expect(laneNeedsNetwork({ local: true, model: 'local/model' })).toBe(false)
    expect(laneNeedsNetwork(null)).toBe(true)
  })
})
