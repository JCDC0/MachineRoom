import { SPEEDS, validateAction } from './actions.js'

const STOP = new Set([
  'a', 'an', 'the', 'me', 'my', 'to', 'of', 'for', 'at', 'in', 'on', 'and', 'or', 'please', 'show', 'see', 'watch',
  'look', 'go', 'goto', 'open', 'focus', 'take', 'bring', 'what', 'whats', 'is', 'are', 'doing', 'working', 'up',
  'close', 'closer', 'now', 'can', 'you', 'i', 'want', 'need', 'let', 'lets', 'us', 'agent', 'agents', 'terminal',
  'folder', 'file', 'path', 'where', 'find', 'who', 'how', 'much', 'has', 'spent', 'do', 'does', 'it', 'this',
  'that', 'with', 'about', 'from', 'tell', 'give', 'configure', 'config', 'settings', 'setting', 'set', 'edit',
  'change', 'budget', 'model', 'subagents', 'subagent', 'keys', 'key', 'api', 'costs', 'cost', 'log', 'output',
  'console', 'follow', 'allow', 'disable', 'enable', 'ask', 'have', 'get', 'new', 'task', 'tasks', 'code',
])

const PATH_STOP = new Set([
  'a', 'an', 'the', 'me', 'my', 'to', 'of', 'for', 'at', 'in', 'on', 'and', 'or', 'please', 'show', 'see', 'watch',
  'look', 'go', 'goto', 'open', 'focus', 'take', 'bring', 'what', 'whats', 'is', 'are', 'up', 'now', 'can', 'you',
  'i', 'want', 'need', 'let', 'lets', 'us', 'where', 'find', 'folder', 'file', 'path', 'dir', 'directory', 'it',
  'this', 'that', 'with', 'about', 'from', 'tell', 'give', 'there', 'here',
])

const HELP_SAY =
  'Try: "what is agy doing", "costs", "approvals", "new task", "terminal for hermes", "go to src/engine", "follow", "overview", "configure opencode".'

const tokenize = (text) =>
  String(text)
    .toLowerCase()
    .replace(/[^a-z0-9/._$-]+/g, ' ')
    .split(' ')
    .map((token) => token.replace(/[.-]+$/, ''))
    .filter(Boolean)

const squash = (text) => String(text).toLowerCase().replace(/[^a-z0-9]/g, '')

export function containsSecret(text) {
  const value = String(text)
  return (
    /\b(sk|pk|ghp|gho|xox[bap]|hf)[-_][A-Za-z0-9_-]{12,}/.test(value) ||
    /\bAIza[0-9A-Za-z_-]{20,}/.test(value) ||
    /\b[A-Za-z0-9_-]{32,}\b/.test(value.replace(/\S*\/\S*/g, ' ')) ||
    /(api[ _-]?key|secret|token|password|passphrase)\s*(is|=|:)\s*\S{6,}/i.test(value) ||
    /-----BEGIN [A-Z ]*KEY-----/.test(value)
  )
}

export function redact(text) {
  return String(text)
    .replace(/\b(sk|pk|ghp|gho|xox[bap]|hf)[-_][A-Za-z0-9_-]{12,}/g, '[hidden]')
    .replace(/\bAIza[0-9A-Za-z_-]{20,}/g, '[hidden]')
    .replace(/\b[A-Za-z0-9_-]{32,}\b/g, (match) => (match.includes('/') ? match : '[hidden]'))
}

function nameTokens(agent) {
  const parts = new Set()
  for (const word of [agent.name, agent.key]) for (const token of tokenize(word)) if (!STOP.has(token) && token.length >= 2) parts.add(token)
  return parts
}

export function resolveAgents(text, agents) {
  const phrase = squash(text)
  const tokens = tokenize(text).filter((token) => !STOP.has(token) && token.length >= 3)
  const scored = []
  for (const agent of agents) {
    let score = 0
    for (const full of [squash(agent.name), squash(agent.key)]) if (full.length >= 3 && phrase.includes(full)) score = 100
    if (score < 100) {
      const parts = nameTokens(agent)
      for (const token of tokens) {
        if (parts.has(token)) score = Math.max(score, 80)
        else if ([...parts].some((part) => part.startsWith(token))) score = Math.max(score, 60)
      }
    }
    if (score >= 60) scored.push({ agent, score })
  }
  scored.sort((a, b) => b.score - a.score)
  if (scored.length === 0) return { match: null, ambiguous: [] }
  const top = scored.filter((item) => item.score === scored[0].score)
  return top.length === 1 ? { match: top[0].agent, ambiguous: [] } : { match: null, ambiguous: top.map((item) => item.agent) }
}

function pathScore(path, token) {
  const lower = path.toLowerCase()
  const base = lower.split('/').pop()
  const bare = base.replace(/\.[a-z0-9]+$/, '')
  if (lower === token) return 100
  if (lower.endsWith(`/${token}`)) return 90
  if (base === token) return 85
  if (bare === token) return 80
  if (lower.split('/').includes(token)) return 70
  if (base.startsWith(token) && token.length >= 3) return 60
  if (token.length >= 4 && lower.includes(token)) return 40
  return 0
}

function scorePaths(tokens, paths, min) {
  const scored = []
  for (const path of paths) {
    let score = 0
    for (const token of tokens) score = Math.max(score, pathScore(path, token))
    if (score >= min) scored.push({ path, score })
  }
  scored.sort((a, b) => b.score - a.score || a.path.length - b.path.length)
  if (scored.length === 0) return { match: null, ambiguous: [] }
  const top = scored.filter((item) => item.score === scored[0].score).map((item) => item.path)
  if (top.length === 1) return { match: top[0], ambiguous: [] }
  const root = top.find((path) => top.every((other) => other === path || other.startsWith(`${path}/`)))
  if (root !== undefined) return { match: root, ambiguous: [] }
  return { match: null, ambiguous: top.slice(0, 4) }
}

export function resolvePaths(text, paths) {
  const tokens = tokenize(text).filter((token) => !PATH_STOP.has(token) && token.length >= 2)
  return scorePaths(tokens, paths, 40)
}

export function resolveExplicit(text, paths) {
  const tokens = tokenize(text).filter((token) => /[/.]/.test(token) && token.length >= 3)
  return scorePaths(tokens, paths, 80)
}

export function rankPaths(text, paths, limit = 20) {
  const tokens = tokenize(text).filter((token) => !PATH_STOP.has(token) && token.length >= 2)
  const scored = []
  const rest = []
  for (const path of paths) {
    if (path === '') continue
    let score = 0
    for (const token of tokens) score = Math.max(score, pathScore(path, token))
    if (score > 0) scored.push({ path, score })
    else rest.push(path)
  }
  scored.sort((a, b) => b.score - a.score || a.path.length - b.path.length)
  const chosen = scored.slice(0, limit).map((item) => item.path)
  const depth = (path) => path.split('/').length
  rest.sort((a, b) => depth(a) - depth(b) || a.length - b.length)
  return chosen.concat(rest.slice(0, Math.max(0, Math.min(limit, 12) - chosen.length)))
}

function dollarsToCents(text) {
  const found = /(\d+(?:\.\d{1,2})?)\s*(dollars?|usd|bucks|cents?|c)?\b/i.exec(text.replace(/\$\s*(\d)/g, '$1 dollars '))
  if (!found) return null
  const amount = Number(found[1])
  if (/^c/i.test(found[2] ?? '')) return Math.round(amount)
  return Math.round(amount * 100)
}

const cap = (text) => text.charAt(0).toUpperCase() + text.slice(1)
const done = (context, action, kind, say) => {
  const checked = validateAction(action, context)
  return checked.ok ? { kind, action: checked.action, say } : { kind: 'unknown', say: HELP_SAY, fallback: true }
}
const askAgent = (raw, agents, say) => ({
  kind: 'ask',
  say,
  options: agents.map((agent) => ({ agent: agent.key, label: agent.name, text: `${raw} ${agent.name}` })),
})

export function interpret(text, context) {
  const raw = String(text ?? '').trim()
  if (!raw) return { kind: 'unknown', say: HELP_SAY }
  const lower = raw.toLowerCase()
  const { match: agent, ambiguous } = resolveAgents(raw, context.agents)
  const needAgent = (say) => (ambiguous.length ? askAgent(raw, ambiguous, say) : askAgent(raw, context.agents, say))

  if (containsSecret(raw)) {
    const named = agent ? ` Opening the masked key form for ${agent.name}.` : ' Say "api keys for <agent>" to open the masked form.'
    const result = { kind: 'blocked', say: `That looks like a key. I never read keys.${named}` }
    if (agent) result.action = validateAction({ type: 'open_config', agent: agent.key, section: 'keys' }, context).action
    return result
  }

  if (/^(help|\?|commands|what can (you|i) do|how do i)/.test(lower)) return done(context, { type: 'open_help' }, 'action', HELP_SAY)

  if (/\b(unfollow|stop following|follow off|stop follow)\b/.test(lower)) return done(context, { type: 'follow', mode: 'off' }, 'action', 'Follow is off.')
  if (/\bfollow\b/.test(lower)) {
    const close = /\b(close|closer|up close)\b/.test(lower)
    return done(context, { type: 'follow', mode: close ? 'close' : 'wide' }, 'action', close ? 'Following up close.' : 'Following the working agent.')
  }
  if (/\b(overview|zoom out|show everything|whole room|reset (the )?camera)\b/.test(lower)) return done(context, { type: 'overview' }, 'action', 'Back to the overview.')

  if (/\b(pause|hold on)\b/.test(lower)) return done(context, { type: 'replay', op: 'pause' }, 'action', 'Paused.')
  if (/\b(faster|speed up)\b/.test(lower)) return done(context, { type: 'replay', op: 'faster' }, 'action', 'Faster.')
  if (/\b(slower|slow down)\b/.test(lower)) return done(context, { type: 'replay', op: 'slower' }, 'action', 'Slower.')
  const speed = /\bspeed\s*(?:to\s*)?(\d)x?\b|\b(\d)x\b/.exec(lower)
  if (speed) {
    const value = Number(speed[1] ?? speed[2])
    if (SPEEDS.includes(value)) return done(context, { type: 'replay', op: 'speed', value }, 'action', `Speed ${value}x.`)
  }
  if (/^(play|resume|continue)\b/.test(lower)) return done(context, { type: 'replay', op: 'play' }, 'action', 'Playing.')

  if (/\b(api[ -]?keys?|keys?|secrets?|credentials?)\b/.test(lower)) {
    if (!agent) return needAgent('Keys for which agent?')
    return done(context, { type: 'open_config', agent: agent.key, section: 'keys' }, 'action', `Opening the masked key form for ${agent.name}. I never see the key.`)
  }

  if (/\bsub[- ]?agents?\b|\bspawn(ing)?\b|\bdelegat(e|ion|ing)\b/.test(lower)) {
    if (!agent) return needAgent('Subagents for which agent?')
    if (/\b(no|disable|forbid|block|never|off|don'?t|dont|disallow)\b/.test(lower)) {
      return done(context, { type: 'propose_subagents', agent: agent.key, allowed: false }, 'propose', `Turn subagents off for ${agent.name}?`)
    }
    if (/\b(allow|enable|let|permit|on)\b/.test(lower)) {
      return done(context, { type: 'propose_subagents', agent: agent.key, allowed: true }, 'propose', `Allow ${agent.name} to start subagents?`)
    }
    return done(context, { type: 'open_config', agent: agent.key, section: 'subagents' }, 'action', `Opening subagent settings for ${agent.name}.`)
  }

  if (/\bbudget\b/.test(lower) && /\b(set|change|make|raise|lower|cap|limit|to)\b/.test(lower)) {
    const cents = dollarsToCents(raw)
    if (cents !== null) {
      if (!agent) return needAgent('Budget for which agent?')
      return done(context, { type: 'propose_budget', agent: agent.key, cents }, 'propose', `Set the monthly budget of ${agent.name} to $${(cents / 100).toFixed(2)}?`)
    }
  }
  if (/\bbudget\b/.test(lower) && agent) return done(context, { type: 'open_config', agent: agent.key, section: 'budget' }, 'action', `Opening the budget of ${agent.name}.`)

  if (/\b(configure|config|configuration|settings?|set up|setup|edit)\b/.test(lower) || (/\bmodel\b/.test(lower) && agent)) {
    if (!agent) return needAgent('Configure which agent?')
    const section = /\bmodel\b/.test(lower) ? 'model' : 'general'
    return done(context, { type: 'open_config', agent: agent.key, section }, 'action', `Opening settings for ${agent.name}.`)
  }

  const delegate = /^(?:please\s+)?(?:ask|tell|have|get)\s+(.+?)\s+to\s+(.+)$/i.exec(raw)
  if (delegate) {
    const target = resolveAgents(delegate[1], context.agents)
    if (target.match) {
      const title = cap(delegate[2].trim().replace(/[.!]+$/, ''))
      return done(context, { type: 'propose_dispatch', assignee: target.match.key, title }, 'propose', `Create a task for ${target.match.name}: "${title}"?`)
    }
    if (target.ambiguous.length) return askAgent(raw, target.ambiguous, 'Which agent?')
  }

  if (/\b(costs?|spend|spending|quota|usage|meters?|money|price|pricing|billing|how much)\b|\btokens\b/.test(lower)) {
    return done(context, { type: 'open_panel', tab: 'meters' }, 'action', agent ? `Showing costs. ${agent.name} is in the list.` : 'Showing costs and quota.')
  }
  if (/\b(approvals?|approve|pending|waiting for me)\b/.test(lower)) return done(context, { type: 'open_panel', tab: 'approvals' }, 'action', 'Showing approvals.')

  const issue = /\b([a-z]{1,8}-\d{1,6})\b/i.exec(raw)
  if (issue && !/\.[a-z]{2,4}\b/i.test(issue[1])) {
    return done(context, { type: 'open_issue', identifier: issue[1].toUpperCase() }, 'action', `Opening ${issue[1].toUpperCase()}.`)
  }
  if (/\b(new task|dispatch|create (a )?(task|issue)|start (a )?task|assign)\b/.test(lower)) return done(context, { type: 'open_panel', tab: 'dispatch' }, 'action', 'Opening the task form.')
  if (/\b(tasks?|issues?|board|threads?|comments?|conversation)\b/.test(lower)) return done(context, { type: 'open_panel', tab: 'tasks' }, 'action', 'Showing tasks.')

  if (/\b(terminal|console|output|log)\b/.test(lower)) {
    if (agent) return done(context, { type: 'focus_terminal', agent: agent.key }, 'action', `Showing the terminal of ${agent.name}.`)
    if (ambiguous.length) return askAgent(raw, ambiguous, 'Which terminal?')
    if (/\bterminal|console|output\b/.test(lower)) return needAgent('Which terminal?')
    return done(context, { type: 'open_log' }, 'action', 'Opening the event log.')
  }
  if (/\bwhat('?s| is) (happening|going on|everyone doing|everybody doing|up)\b/.test(lower)) return done(context, { type: 'open_log' }, 'action', 'Opening the event log.')

  const pathWords = /\b(folder|dir|directory|file|path)\b|\/|\.[a-z0-9]{1,5}\b/.test(lower)
  if (agent && !pathWords) {
    const close = /\b(close|closer|up close|doing|working on|up to|zoom|detail)\b/.test(lower)
    return done(
      context,
      { type: 'focus_agent', agent: agent.key, view: close ? 'close' : 'wide' },
      'action',
      close ? `Showing ${agent.name} up close.` : `Showing ${agent.name}.`
    )
  }
  if (ambiguous.length && !pathWords) return askAgent(raw, ambiguous, 'Which agent?')

  const found = resolvePaths(raw, context.paths)
  if (found.match) return done(context, { type: 'focus_path', path: found.match }, 'action', `Going to ${found.match}.`)
  if (found.ambiguous.length) {
    return { kind: 'ask', say: 'Which one?', options: found.ambiguous.map((path) => ({ path, label: path, text: path })) }
  }
  if (agent) return done(context, { type: 'focus_agent', agent: agent.key, view: 'wide' }, 'action', `Showing ${agent.name}.`)

  return { kind: 'unknown', say: HELP_SAY, fallback: true }
}

export function finalizeModelAction(action, context) {
  if (action && action.type === 'focus_path' && typeof action.query === 'string') {
    const found = resolvePaths(action.query, context.paths)
    if (!found.match) return { ok: false, error: 'No such folder or file.' }
    return validateAction({ type: 'focus_path', path: found.match }, context)
  }
  return validateAction(action, context)
}
