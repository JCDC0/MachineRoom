const ONLINE_GIT = new Set(['push', 'pull', 'fetch', 'clone', 'ls-remote'])
const ONLINE_SHELL = new Set([
  'gh',
  'curl',
  'wget',
  'invoke-webrequest',
  'invoke-restmethod',
  'ssh',
  'scp',
  'ngrok',
  'cloudflared',
  'localtunnel',
])
const WRAPPERS = new Set(['sudo', 'command', 'env', 'npx', 'pnpx', 'bunx', 'exec'])
const GIT_VALUE_FLAGS = new Set(['-C', '-c', '--git-dir', '--work-tree', '--namespace', '--exec-path', '--super-prefix', '--config-env'])
const MCP_ONLINE = /browser|playwright|puppeteer|fetch|http/i
const LOCAL_HOST = /(?:^|[^\w.-])(localhost|127\.0\.0\.1|\[::1\]|::1)(?![\w.-])/i
const REMOTE_URL = /[a-z][a-z0-9+.-]*:\/\/[^\s"'<>]+/gi

function hostOf(url) {
  const match = /^[a-z][a-z0-9+.-]*:\/\/(?:[^@/?#]*@)?(\[[^\]]+\]|[^:/?#]+)/i.exec(String(url ?? ''))
  return match ? match[1].toLowerCase() : ''
}

function localHost(host) {
  const value = String(host ?? '').toLowerCase()
  return value === 'localhost' || value === '127.0.0.1' || value === '[::1]' || value === '::1'
}

export function isLocalAddress(value) {
  if (typeof value !== 'string' || value === '') return false
  if (LOCAL_HOST.test(value)) return true
  const urls = value.match(REMOTE_URL) ?? []
  return urls.length > 0 && urls.every((url) => localHost(hostOf(url)))
}

function remoteAddress(text) {
  for (const url of String(text).match(REMOTE_URL) ?? []) {
    if (!localHost(hostOf(url))) return true
  }
  const scp = /(?:^|\s)[\w.-]+@(\[[^\]]+\]|[\w.-]+):/g
  for (const match of String(text).matchAll(scp)) {
    if (!localHost(match[1])) return true
  }
  return false
}

function onlyLocalAddress(text) {
  return LOCAL_HOST.test(text) && !remoteAddress(text)
}

function segmentsOf(text) {
  const value = String(text ?? '').replace(/^\s*\$\s*/, '')
  const segments = []
  let tokens = []
  let token = ''
  let quoted = false
  let tokenQuoted = false
  let quote = ''
  function pushToken() {
    if (token !== '' || tokenQuoted) tokens.push({ value: token, quoted: tokenQuoted })
    token = ''
    tokenQuoted = false
  }
  function pushSegment() {
    pushToken()
    if (tokens.length > 0) segments.push(tokens)
    tokens = []
  }
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index]
    if (quoted) {
      if (char === quote) quoted = false
      else token += char
      continue
    }
    if (char === '"' || char === "'") {
      quoted = true
      quote = char
      tokenQuoted = true
      continue
    }
    if (/\s/.test(char)) {
      pushToken()
      continue
    }
    if ((char === '&' && value[index + 1] === '&') || (char === '|' && value[index + 1] === '|')) {
      pushSegment()
      index += 1
      continue
    }
    if (char === ';' || char === '|' || char === '&' || char === '\n' || char === '\r') {
      pushSegment()
      continue
    }
    token += char
  }
  pushSegment()
  return segments
}

function commandName(value) {
  const text = String(value ?? '').replace(/\.(?:exe|cmd|bat|ps1|com)$/i, '')
  const parts = text.split(/[\\/]/)
  return (parts[parts.length - 1] ?? '').toLowerCase()
}

function firstWord(tokens) {
  let index = 0
  while (index < tokens.length) {
    const token = tokens[index]
    if (token.quoted) return ''
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(token.value)) {
      index += 1
      continue
    }
    const name = commandName(token.value)
    if (WRAPPERS.has(name)) {
      index += 1
      if (name === 'env') {
        while (index < tokens.length && tokens[index].value.startsWith('-')) index += 1
      }
      continue
    }
    return name === '' ? '' : name
  }
  return ''
}

function gitOnline(tokens) {
  let index = 1
  while (index < tokens.length) {
    const token = tokens[index]
    if (token.quoted) return false
    const value = token.value
    if (value.startsWith('-')) {
      const flag = value.includes('=') ? value.slice(0, value.indexOf('=')) : value
      index += GIT_VALUE_FLAGS.has(flag) && !value.includes('=') ? 2 : 1
      continue
    }
    return ONLINE_GIT.has(value.toLowerCase())
  }
  return false
}

function segmentOnline(tokens) {
  const word = firstWord(tokens)
  if (word === '') return false
  if (word === 'git') {
    const at = tokens.findIndex((token) => !token.quoted && commandName(token.value) === 'git')
    return at === -1 ? false : gitOnline(tokens.slice(at))
  }
  if (word === 'lt') {
    return tokens.some((token) => !token.quoted && token.value.toLowerCase() === '--port')
  }
  if (!ONLINE_SHELL.has(word)) return false
  const text = tokens.map((token) => token.value).join(' ')
  return !onlyLocalAddress(text)
}

function mcpOnline(tokens) {
  const name = tokens
    .filter((token) => !token.quoted)
    .map((token) => token.value)
    .join(' ')
    .replace(/^mcp\s*/i, '')
  if (!MCP_ONLINE.test(name)) return false
  const text = tokens.map((token) => token.value).join(' ')
  return !onlyLocalAddress(text)
}

function webOnline(label) {
  const urls = String(label ?? '').match(REMOTE_URL) ?? []
  if (urls.length === 0) return true
  return !urls.every((url) => localHost(hostOf(url)))
}

export function isOnlineCall(call = {}) {
  const tool = call?.tool
  const label = call?.label
  if (tool === 'web') return webOnline(label)
  if (tool !== 'shell' && tool !== 'mcp') return false
  const segments = segmentsOf(label)
  if (tool === 'mcp') {
    return segments.some((tokens) => mcpOnline(tokens))
  }
  return segments.some((tokens) => segmentOnline(tokens))
}

function localEndpoint(value) {
  return isLocalAddress(typeof value === 'string' ? value : '')
}

export function laneNeedsNetwork(lane) {
  if (!lane || typeof lane !== 'object') return true
  if (lane.local === true) return false
  for (const key of ['baseUrl', 'baseURL', 'endpoint', 'url']) {
    if (localEndpoint(lane[key])) return false
  }
  return !localEndpoint(lane.model)
}
