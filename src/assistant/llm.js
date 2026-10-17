import { ACTION_TYPES, SECTIONS, SPEEDS, TABS } from './actions.js'
import { containsSecret, finalizeModelAction, redact } from './intent.js'

const SCHEMA = [
  '{"type":"focus_agent","agent":KEY,"view":"wide"|"close"}',
  '{"type":"focus_terminal","agent":KEY}',
  '{"type":"focus_path","query":"words naming a folder or file"}',
  '{"type":"overview"}',
  '{"type":"follow","mode":"wide"|"close"|"off"}',
  `{"type":"open_panel","tab":${TABS.map((tab) => `"${tab}"`).join('|')}}`,
  '{"type":"open_issue","identifier":"JC-12"}',
  `{"type":"open_config","agent":KEY,"section":${SECTIONS.map((section) => `"${section}"`).join('|')}}`,
  '{"type":"open_log"}',
  '{"type":"open_help"}',
  `{"type":"replay","op":"play"|"pause"|"faster"|"slower"|"speed","value":${SPEEDS.join('|')}}`,
  '{"type":"propose_dispatch","assignee":KEY,"title":"short task title"}',
  '{"type":"propose_budget","agent":KEY,"cents":whole number}',
  '{"type":"propose_subagents","agent":KEY,"allowed":true|false}',
]

export const MAX_SAY = 160

export function buildPrompt(text, context) {
  if (containsSecret(text)) return null
  const agents = context.agents.map((agent) => `${agent.key} (${agent.name})`).join(', ')
  return [
    'You route one request from a user of a 3D control room for coding agents.',
    'Reply with one JSON object and nothing else. Use only these shapes:',
    ...SCHEMA,
    '{"type":"none","say":"one short question to clear up what the user means"}',
    `KEY is one of: ${agents}.`,
    'Add "say" with one short sentence of at most 12 words.',
    'Never invent a key, a path or a number. If the request is unclear, use "none".',
    `Request: ${redact(text).slice(0, 400)}`,
  ].join('\n')
}

function firstObject(reply) {
  const start = reply.indexOf('{')
  if (start === -1) return null
  let depth = 0
  let quoted = false
  for (let index = start; index < reply.length; index += 1) {
    const char = reply[index]
    if (quoted) {
      if (char === '\\') index += 1
      else if (char === '"') quoted = false
    } else if (char === '"') quoted = true
    else if (char === '{') depth += 1
    else if (char === '}') {
      depth -= 1
      if (depth === 0) return reply.slice(start, index + 1)
    }
  }
  return null
}

const clip = (text) => (typeof text === 'string' ? text.replace(/\s+/g, ' ').trim().slice(0, MAX_SAY) : '')

export function parseReply(reply, context) {
  const slice = firstObject(String(reply ?? ''))
  if (!slice) return { kind: 'unknown', say: 'I did not understand that.' }
  let data
  try {
    data = JSON.parse(slice)
  } catch {
    return { kind: 'unknown', say: 'I did not understand that.' }
  }
  if (!data || typeof data !== 'object') return { kind: 'unknown', say: 'I did not understand that.' }
  const say = clip(data.say)
  if (data.type === 'none') return { kind: 'ask', say: say || 'Can you say that another way?', options: [] }
  if (!ACTION_TYPES.includes(data.type) && data.type !== undefined) return { kind: 'unknown', say: 'I did not understand that.' }
  const checked = finalizeModelAction(data, context)
  if (!checked.ok) return { kind: 'unknown', say: 'I did not understand that.' }
  return { kind: checked.confirm ? 'propose' : 'action', action: checked.action, say: say || 'Done.' }
}

export async function askModel(text, context, run) {
  const prompt = buildPrompt(text, context)
  if (prompt === null) return { kind: 'blocked', say: 'That looks like a key. I never read keys.' }
  let reply
  try {
    reply = await run(prompt)
  } catch {
    return { kind: 'unknown', say: 'The helper model is not reachable. Plain commands still work.' }
  }
  return parseReply(reply, context)
}
