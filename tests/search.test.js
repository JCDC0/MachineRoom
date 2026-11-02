import { createServer } from 'node:http'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { createBridge } from '../server/index.js'
import {
  FETCH_BYTES,
  MAX_RESULTS,
  SEARCH_OFF,
  addressProblem,
  fetchPage,
  htmlToText,
  parseDuckDuckGo,
  publicHostProblem,
  readSearchChoice,
  searchWeb,
  writeSearchChoice,
} from '../server/search.js'
import { makeTempDir, removeTempDir } from './helpers/tempRoot.js'

const servers = new Set()
const tempDirs = []

function tempDir(prefix) {
  const dir = makeTempDir(prefix)
  tempDirs.push(dir)
  return dir
}

async function fakeServer(handler) {
  const seen = []
  const server = createServer((req, res) => {
    Promise.resolve(handler(req, res, seen)).catch(() => {
      if (!res.headersSent) res.statusCode = 500
      res.end()
    })
  })
  servers.add(server)
  await new Promise((done) => server.listen(0, '127.0.0.1', done))
  const address = server.address()
  return {
    url: `http://127.0.0.1:${address.port}`,
    port: address.port,
    seen,
  }
}

async function bodyOf(req) {
  const chunks = []
  for await (const chunk of req) chunks.push(chunk)
  return Buffer.concat(chunks).toString('utf8')
}

async function closeServers() {
  for (const server of servers) {
    server.closeAllConnections?.()
    await new Promise((done) => server.close(() => done()))
  }
  servers.clear()
}

afterEach(async () => {
  await closeServers()
  while (tempDirs.length > 0) removeTempDir(tempDirs.pop())
})

describe('web search providers', () => {
  it('reads SearXNG JSON at the owner address and keeps 8 results', async () => {
    let request = null
    const fake = await fakeServer((req, res) => {
      request = new URL(req.url, 'http://127.0.0.1')
      const results = Array.from({ length: 10 }, (_, index) => ({
        title: `Result ${index}`,
        url: `https://example.com/${index}`,
        content: `Snippet ${index}`,
      }))
      res.setHeader('content-type', 'application/json')
      res.end(JSON.stringify({ results }))
    })
    const outcome = await searchWeb('machineroom room', {
      choice: { provider: 'searxng', url: fake.url, keyName: '' },
    })
    expect(outcome.error).toBeUndefined()
    expect(outcome.results).toHaveLength(MAX_RESULTS)
    expect(outcome.results[0]).toEqual({ title: 'Result 0', url: 'https://example.com/0', snippet: 'Snippet 0' })
    expect(request.pathname).toBe('/search')
    expect(request.searchParams.get('format')).toBe('json')
    expect(request.searchParams.get('q')).toBe('machineroom room')
    expect(outcome.text).toContain('1. Result 0')
    expect(outcome.text).toContain('https://example.com/0')
  })

  it('reads Tavily with its key slot', async () => {
    let sent = null
    const fake = await fakeServer(async (req, res) => {
      sent = { method: req.method, headers: req.headers, body: JSON.parse(await bodyOf(req)) }
      res.setHeader('content-type', 'application/json')
      res.end(JSON.stringify({ results: [{ title: 'Tavily hit', url: 'https://example.org/a', content: 'A snippet' }] }))
    })
    const outcome = await searchWeb('query', {
      choice: { provider: 'tavily', url: '', keyName: 'TAVILY_API_KEY' },
      key: 'test-key',
      endpoints: { tavily: fake.url, brave: fake.url, duckduckgo: fake.url },
    })
    expect(outcome.results).toEqual([{ title: 'Tavily hit', url: 'https://example.org/a', snippet: 'A snippet' }])
    expect(sent.method).toBe('POST')
    expect(sent.headers.authorization).toBe('Bearer test-key')
    expect(sent.body.api_key).toBe('test-key')
    expect(sent.body.query).toBe('query')
  })

  it('answers when a Tavily key slot is missing', async () => {
    const outcome = await searchWeb('query', { choice: { provider: 'tavily', url: '', keyName: '' } })
    expect(outcome.error).toBe('Set a key for Tavily in Settings.')
  })

  it('reads Brave with its key slot', async () => {
    let headers = null
    const fake = await fakeServer((req, res) => {
      headers = req.headers
      res.setHeader('content-type', 'application/json')
      res.end(JSON.stringify({ web: { results: [{ title: 'Brave hit', url: 'https://example.org/b', description: 'B snippet' }] } }))
    })
    const outcome = await searchWeb('query', {
      choice: { provider: 'brave', url: '', keyName: 'BRAVE_API_KEY' },
      key: 'brave-test-key',
      endpoints: { tavily: fake.url, brave: fake.url, duckduckgo: fake.url },
    })
    expect(outcome.results).toEqual([{ title: 'Brave hit', url: 'https://example.org/b', snippet: 'B snippet' }])
    expect(headers['x-subscription-token']).toBe('brave-test-key')
  })

  it('reads DuckDuckGo result links from the HTML', async () => {
    const anchors = Array.from({ length: 9 }, (_, index) => {
      const target = encodeURIComponent(`https://example.net/${index}`)
      return `<div class="result"><a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=${target}&rut=abc">Hit ${index}</a><a class="result__snippet">Snippet ${index}</a></div>`
    }).join('')
    const fake = await fakeServer((req, res) => {
      res.setHeader('content-type', 'text/html')
      res.end(`<html><body>${anchors}</body></html>`)
    })
    const outcome = await searchWeb('query', {
      choice: { provider: 'duckduckgo', url: '', keyName: '' },
      endpoints: { tavily: fake.url, brave: fake.url, duckduckgo: fake.url },
    })
    expect(outcome.results).toHaveLength(MAX_RESULTS)
    expect(outcome.results[0]).toEqual({ title: 'Hit 0', url: 'https://example.net/0', snippet: 'Snippet 0' })
    expect(outcome.results[7].url).toBe('https://example.net/7')
  })

  it('reads a plain DuckDuckGo link too', () => {
    const html = '<a class="result__a" href="https://example.com/plain">Plain</a><span class="result__snippet">Words</span>'
    expect(parseDuckDuckGo(html)).toEqual([{ title: 'Plain', url: 'https://example.com/plain', snippet: 'Words' }])
  })

  it('answers the off sentence with no provider saved', async () => {
    const outcome = await searchWeb('anything', { choice: { provider: '', url: '', keyName: '' } })
    expect(outcome).toEqual({ results: [], text: SEARCH_OFF })
    expect(outcome.text).toBe('Web search is off. Pick a provider in Settings.')
  })

  it('reads an unknown saved provider as off', () => {
    const folder = tempDir('mr-search-choice-')
    writeFileSync(join(folder, 'search.json'), JSON.stringify({ provider: 'elsewhere', url: 'https://x.example', keyName: '' }))
    expect(readSearchChoice(folder)).toEqual({ provider: '', url: '', keyName: '' })
  })
})

describe('web fetch address checks', () => {
  it('refuses loopback, private and link-local addresses', () => {
    for (const address of ['127.0.0.1', '10.1.2.3', '172.20.0.1', '192.168.1.5', '169.254.10.20', '100.64.0.1']) {
      expect(addressProblem(address), address).toContain('not public')
    }
    for (const address of ['::1', 'fe80::1', 'fc00::1', '::ffff:127.0.0.1', '2001:db8::1']) {
      expect(addressProblem(address), address).toContain('not public')
    }
    expect(addressProblem('8.8.8.8')).toBe('')
    expect(addressProblem('2606:4700:4700::1111')).toBe('')
  })

  it('refuses localhost and a name that resolves privately', async () => {
    expect(await publicHostProblem('localhost')).toContain('not public')
    expect(await publicHostProblem('room.localhost')).toContain('not public')
    expect(await publicHostProblem('example.com', async () => [{ address: '10.0.0.5', family: 4 }])).toContain('not public')
    expect(await publicHostProblem('example.com', async () => [{ address: '93.184.216.34', family: 4 }])).toBe('')
  })

  it('refuses localhost before it asks for the page', async () => {
    const page = await fetchPage('http://localhost/')
    expect(page.error).toContain('not public')
    const loopback = await fetchPage('http://127.0.0.1/')
    expect(loopback.error).toContain('not public')
    const other = await fetchPage('ftp://example.com/file')
    expect(other.error).toBe('Only http and https pages can be fetched.')
    const invalid = await fetchPage('not a url')
    expect(invalid.error).toBe('That is not a web address.')
  })
})

describe('web fetch page', () => {
  const allow = async () => ''

  it('reads a page as plain text and drops scripts and markup', async () => {
    const fake = await fakeServer((req, res) => {
      res.setHeader('content-type', 'text/html; charset=utf-8')
      res.end('<html><head><title>Ignored</title><style>.x{}</style></head><body><h1>Hello &amp; welcome</h1><script>bad()</script><p>Second line.</p></body></html>')
    })
    const page = await fetchPage(`${fake.url}/page`, { checkHost: allow })
    expect(page.error).toBe('')
    expect(page.text).toContain('Hello & welcome')
    expect(page.text).toContain('Second line.')
    expect(page.text).not.toContain('Ignored')
    expect(page.text).not.toContain('bad()')
    expect(page.text).not.toContain('<h1>')
  })

  it('stops at 1 MB and cuts the text at 20000 characters', async () => {
    const fake = await fakeServer((req, res) => {
      res.setHeader('content-type', 'text/plain')
      res.end('a'.repeat(FETCH_BYTES + 200000))
    })
    const page = await fetchPage(`${fake.url}/big`, { checkHost: allow })
    expect(page.error).toBe('')
    expect(page.text).toHaveLength(20000)
    expect(page.truncated).toBe(true)
  })

  it('gives up after the time limit', async () => {
    const fake = await fakeServer(async (req, res) => {
      await new Promise((done) => setTimeout(done, 1500))
      res.setHeader('content-type', 'text/plain')
      res.end('late')
    })
    const page = await fetchPage(`${fake.url}/slow`, { checkHost: allow, timeoutMs: 1000 })
    expect(page.error).toBe('The page took longer than 1 second.')
  })

  it('follows a redirect to a public page', async () => {
    const fake = await fakeServer((req, res) => {
      if (req.url === '/start') {
        res.statusCode = 302
        res.setHeader('location', '/end')
        res.end()
        return
      }
      res.setHeader('content-type', 'text/plain')
      res.end('Final page')
    })
    const page = await fetchPage(`${fake.url}/start`, { checkHost: allow })
    expect(page.error).toBe('')
    expect(page.text).toBe('Final page')
    expect(page.url).toBe(`${fake.url}/end`)
  })

  it('checks the address of every redirect', async () => {
    const fake = await fakeServer((req, res) => {
      res.statusCode = 302
      res.setHeader('location', `http://localhost:${fake.port}/end`)
      res.end()
    })
    const page = await fetchPage(`${fake.url}/go`, {
      checkHost: async (hostname) => (hostname === 'localhost' ? 'The page address is not public.' : ''),
    })
    expect(page.error).toBe('The page address is not public.')
  })

  it('stops after 3 redirects', async () => {
    let fake = null
    fake = await fakeServer((req, res) => {
      res.statusCode = 302
      res.setHeader('location', `${fake.url}/loop`)
      res.end()
    })
    const page = await fetchPage(`${fake.url}/loop`, { checkHost: allow })
    expect(page.error).toBe('The page redirected more than 3 times.')
  })

  it('reports an HTTP failure', async () => {
    const fake = await fakeServer((req, res) => {
      res.statusCode = 500
      res.end('no')
    })
    const page = await fetchPage(`${fake.url}/fail`, { checkHost: allow })
    expect(page.error).toBe('The page answered 500.')
  })

  it('turns simple HTML into text', () => {
    expect(htmlToText('<div>One</div><div>Two&nbsp;words</div>')).toBe('One\n\nTwo words')
    expect(htmlToText('&#99999999999; stays')).toBe('&#99999999999; stays')
  })
})

describe('the search provider route', () => {
  let bridge = null
  let url = ''
  let runs = ''
  let project = ''

  beforeAll(async () => {
    runs = makeTempDir('mr-search-runs-')
    project = makeTempDir('mr-search-project-')
    bridge = createBridge({ projectRoot: project, runsFolder: runs, port: 0, env: {} })
    const started = await bridge.start()
    url = started.url
  })

  afterAll(async () => {
    if (bridge) await bridge.stop()
    bridge = null
    removeTempDir(runs)
    removeTempDir(project)
  })

  async function ask(method, body, { origin = true } = {}) {
    const response = await fetch(`${url}/api/search-provider`, {
      method,
      headers: {
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        ...(origin ? { origin: url } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(10000),
    })
    const text = await response.text()
    return { status: response.status, body: text ? JSON.parse(text) : null }
  }

  it('starts off and saves a SearXNG address', async () => {
    const off = await ask('GET')
    expect(off.body).toEqual({ provider: '', url: '', keyName: '' })
    const saved = await ask('POST', { provider: 'searxng', url: 'http://127.0.0.1:8888/', keyName: 'ignored', confirmed: true })
    expect(saved.status).toBe(200)
    expect(saved.body).toEqual({ provider: 'searxng', url: 'http://127.0.0.1:8888/', keyName: '' })
    const file = JSON.parse(readFileSync(join(runs, 'search.json'), 'utf8'))
    expect(file).toEqual({ provider: 'searxng', url: 'http://127.0.0.1:8888/', keyName: '' })
    const again = await ask('GET')
    expect(again.body).toEqual(file)
  })

  it('keeps a key slot name and never its value', async () => {
    const saved = await ask('POST', { provider: 'brave', url: '', keyName: 'BRAVE_API_KEY', confirmed: true })
    expect(saved.status).toBe(200)
    expect(saved.body).toEqual({ provider: 'brave', url: '', keyName: 'BRAVE_API_KEY' })
    expect(JSON.stringify(saved.body)).not.toContain('secret')
  })

  it('needs a page Origin', async () => {
    const answer = await ask('POST', { provider: 'duckduckgo', confirmed: true }, { origin: false })
    expect(answer.status).toBe(403)
    expect(answer.body.error).toBe('A request with no Origin cannot set web search.')
  })

  it('needs a confirmation', async () => {
    const answer = await ask('POST', { provider: 'duckduckgo' })
    expect(answer.status).toBe(400)
    expect(answer.body.error).toBe('Confirm web search first.')
  })

  it('refuses a provider it does not know and a URL that is not http or https', async () => {
    const provider = await ask('POST', { provider: 'elsewhere', confirmed: true })
    expect(provider.status).toBe(400)
    expect(provider.body.error).toBe('Pick SearXNG, Tavily, Brave, DuckDuckGo or Off.')
    const address = await ask('POST', { provider: 'searxng', url: 'ftp://search.example', confirmed: true })
    expect(address.status).toBe(400)
    expect(address.body.error).toBe('The SearXNG address must be an http or https address.')
    const missing = await ask('POST', { provider: 'searxng', url: '', confirmed: true })
    expect(missing.status).toBe(400)
  })

  it('writes and reads a choice that leaves a file behind', () => {
    const folder = tempDir('mr-search-write-')
    mkdirSync(folder, { recursive: true })
    writeSearchChoice(folder, { provider: 'duckduckgo', url: '', keyName: '' })
    expect(readSearchChoice(folder)).toEqual({ provider: 'duckduckgo', url: '', keyName: '' })
  })

  it('writes search.json atomically via rename and cleans up on fallback', () => {
    const folder = tempDir('mr-search-atomic-')
    mkdirSync(folder, { recursive: true })
    let renamed = false
    writeSearchChoice(folder, { provider: 'duckduckgo', url: '', keyName: '' }, {
      rename: (from, to) => {
        renamed = true
        expect(from.endsWith('.tmp')).toBe(true)
        expect(to.endsWith('search.json')).toBe(true)
        renameSync(from, to)
      },
    })
    expect(renamed).toBe(true)
    expect(existsSync(join(folder, 'search.json'))).toBe(true)
    expect(existsSync(join(folder, 'search.json.tmp'))).toBe(false)

    writeSearchChoice(folder, { provider: 'searxng', url: 'https://example.com', keyName: '' }, {
      rename: () => {
        const err = new Error('EPERM')
        err.code = 'EPERM'
        throw err
      },
    })
    expect(existsSync(join(folder, 'search.json'))).toBe(true)
    expect(existsSync(join(folder, 'search.json.tmp'))).toBe(false)
  })
})
