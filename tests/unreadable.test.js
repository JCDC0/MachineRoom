import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { createUnreadableCounter, unreadableLines } from '../src/model/parsers/unreadable.js'
import { parseFrames } from '../src/model/source.js'

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'fixtures')

const BAR = '\u250a'
const BOOK = '\ud83d\udcd6'
const MASK = '***REDACTED***'

const chunk = (...items) => items.join('\n') + '\n'
const json = (value) => JSON.stringify(value)

const claudeCall = { type: 'acpx.tool_call', name: 'Edit src\\math.js', toolCallId: 't1', tag: 'tool_call_update' }
const opencodeCall = {
  type: 'tool_use',
  part: { id: 'p1', tool: 'read', state: { status: 'completed', input: { path: 'C:\\Temp\\agent-sandbox\\src\\math.js' }, output: 'x' } },
}
const agyCall = {
  event: 'step_update',
  step_update: { conversation_id: 'c1', step_index: 4, state: 'ACTIVE', step_type: 'tool', tool_name: 'view_file', tool_info: { parameters: { AbsolutePath: 'C:\\Temp\\agent-sandbox\\src\\math.js' }, output: '' } },
}

describe('unreadableLines', () => {
  it('keeps a well formed Claude call and returns a broken one', () => {
    expect(unreadableLines('claude', chunk(json(claudeCall)))).toEqual([])
    const cut = '{"type":"acpx.tool_call","name":"Edit src\\\\math.js","toolCallId":"t1"'
    expect(unreadableLines('claude', chunk(cut))).toEqual([cut])
    const noId = '{"type":"acpx.tool_call","name":"Read"}'
    expect(unreadableLines('claude', chunk(noId))).toEqual([noId])
  })

  it('keeps a well formed Hermes line and returns one whose shape changed', () => {
    const good = `  ${BAR} ${BOOK} read      strings.js  1.2s`
    expect(unreadableLines('hermes', chunk(good))).toEqual([])
    const changed = `  ${BAR} ${BOOK} read      strings.js`
    expect(unreadableLines('hermes', chunk(changed))).toEqual([changed])
  })

  it('does not count the Hermes progress lines that hold no call', () => {
    const text = chunk(`  ${BAR} 💻 preparing terminal…`, `  ${BAR} ${BOOK} preparing read_file…`, `  ${BAR} review diff`)
    expect(unreadableLines('hermes', text)).toEqual([])
  })

  it('keeps a well formed OpenCode call and returns a line cut inside its JSON', () => {
    expect(unreadableLines('opencode', chunk(json(opencodeCall)))).toEqual([])
    const cut = '{"type":"tool_use","part":{"id":"p13","tool":"shell","state":{"input":{"command":"cat docs/notes.md"'
    expect(unreadableLines('opencode', chunk(cut))).toEqual([cut])
  })

  it('does not count an OpenCode masked line that the recovery reads', () => {
    const masked = `{"type":"tool_use","part":{"id":"p11","tool":"read","state":{"status":"completed","input":{"path":"docs/notes.md"},"output":"Authorization: ${MASK}`
    expect(unreadableLines('opencode', chunk(masked))).toEqual([])
  })

  it('keeps a well formed agy step and returns a broken one', () => {
    expect(unreadableLines('agy', chunk(json(agyCall)))).toEqual([])
    const cut = '{"event":"step_update","step_update":{"conversation_id":"c1","step_index":4'
    expect(unreadableLines('agy', chunk(cut))).toEqual([cut])
  })

  it('never counts plain text or blank lines', () => {
    const text = 'Reading src/math.js now.\n\ndone, three files changed.\n   \n'
    for (const parser of ['claude', 'hermes', 'opencode', 'agy']) expect(unreadableLines(parser, text)).toEqual([])
  })

  it('returns nothing for an unknown parser name', () => {
    const cut = '{"type":"tool_use","part":{"tool":"read"'
    expect(unreadableLines('gemini', chunk(cut))).toEqual([])
    expect(unreadableLines('constructor', chunk(cut))).toEqual([])
    expect(unreadableLines(undefined, chunk(cut))).toEqual([])
  })

  it('returns only the broken lines of a chunk that holds several', () => {
    const good = json(opencodeCall)
    const cut = '{"type":"tool_use","part":{"id":"p13","tool":"shell","state":{"input":{"command":"cat docs/notes.md"'
    const masked = `{"type":"tool_use","part":{"id":"p11","tool":"read","state":{"input":{"path":"docs/notes.md"},"output":"${MASK}`
    const text = chunk(good, 'plain words', cut, masked)
    expect(unreadableLines('opencode', text)).toEqual([cut])
  })

  it('drops the line break only and keeps the rest of the line as it came', () => {
    const cut = '  {"type":"acpx.tool_call","name":"Read src\\\\math.js"'
    expect(unreadableLines('claude', cut + '\r\n')).toEqual([cut])
    expect(unreadableLines('claude', cut)).toEqual([cut])
  })
})

describe('createUnreadableCounter', () => {
  const CLAUDE_CUT = '{"type":"acpx.tool_call","name":"Edit src\\\\math.js","toolCallId":"t1"'
  const OPENCODE_CUT = '{"type":"tool_use","part":{"id":"p13","tool":"shell","state":{"input":{"command":"cat docs/notes.md"'
  const HERMES_CUT = `  ${BAR} ${BOOK} read      strings.js`
  const ZERO = { claude: 0, hermes: 0, opencode: 0, agy: 0 }

  it('counts a broken line split over two chunks once', () => {
    const counter = createUnreadableCounter()
    const half = Math.floor(CLAUDE_CUT.length / 2)
    counter.push('claude', 'run-1', CLAUDE_CUT.slice(0, half))
    expect(counter.counts()).toEqual({ total: 0, byParser: ZERO })
    counter.push('claude', 'run-1', CLAUDE_CUT.slice(half) + '\n')
    expect(counter.counts()).toEqual({ total: 1, byParser: { ...ZERO, claude: 1 } })
  })

  it('counts a well formed OpenCode line split over three chunks as zero', () => {
    const counter = createUnreadableCounter()
    const line = json(opencodeCall)
    const third = Math.ceil(line.length / 3)
    counter.push('opencode', 'run-2', line.slice(0, third))
    counter.push('opencode', 'run-2', line.slice(third, third * 2))
    counter.push('opencode', 'run-2', line.slice(third * 2) + '\n')
    expect(counter.counts()).toEqual({ total: 0, byParser: ZERO })
    counter.end('run-2')
    expect(counter.counts()).toEqual({ total: 0, byParser: ZERO })
  })

  it('counts a broken tail at end and then forgets the run', () => {
    const counter = createUnreadableCounter()
    counter.push('opencode', 'run-3', OPENCODE_CUT)
    expect(counter.counts().total).toBe(0)
    counter.end('run-3')
    expect(counter.counts()).toEqual({ total: 1, byParser: { ...ZERO, opencode: 1 } })
    counter.end('run-3')
    expect(counter.counts().total).toBe(1)
    counter.push('opencode', 'run-3', 'plain words\n')
    counter.end('run-3')
    expect(counter.counts().total).toBe(1)
  })

  it('keeps two interleaved runs apart', () => {
    const counter = createUnreadableCounter()
    counter.push('claude', 'a', CLAUDE_CUT.slice(0, 12))
    counter.push('hermes', 'b', HERMES_CUT)
    counter.push('claude', 'a', CLAUDE_CUT.slice(12) + '\n')
    counter.push('hermes', 'b', '\n')
    expect(counter.counts()).toEqual({ total: 2, byParser: { ...ZERO, claude: 1, hermes: 1 } })
  })

  it('drops a tail longer than the tail limit without counting it', () => {
    const tight = createUnreadableCounter({ tailLimit: 8 })
    tight.push('claude', 'run-4', CLAUDE_CUT)
    tight.push('claude', 'run-4', '\n')
    tight.end('run-4')
    expect(tight.counts().total).toBe(0)

    const loose = createUnreadableCounter({ tailLimit: CLAUDE_CUT.length })
    loose.push('claude', 'run-4', CLAUDE_CUT)
    loose.push('claude', 'run-4', '\n')
    expect(loose.counts().total).toBe(1)
  })

  it('skips the rest of a line that grew past the tail limit', () => {
    const tight = createUnreadableCounter({ tailLimit: 8 })
    tight.push('claude', 'run-5', CLAUDE_CUT)
    tight.push('claude', 'run-5', 'more "acpx.tool_call" text')
    tight.push('claude', 'run-5', ' still the same line\n' + CLAUDE_CUT + '\n')
    expect(tight.counts().total).toBe(1)
    tight.end('run-5')
    expect(tight.counts().total).toBe(1)
  })

  it('keeps a tail for at most 50 runs and drops the oldest', () => {
    const counter = createUnreadableCounter()
    for (let i = 1; i <= 51; i += 1) counter.push('claude', `r${i}`, CLAUDE_CUT)
    counter.push('claude', 'r1', '\n')
    expect(counter.counts().total).toBe(0)
    counter.push('claude', 'r2', '\n')
    expect(counter.counts().total).toBe(1)
    for (let i = 3; i <= 51; i += 1) counter.end(`r${i}`)
    expect(counter.counts()).toEqual({ total: 50, byParser: { ...ZERO, claude: 50 } })
  })

  it('counts nothing and keeps no tail for an unknown parser', () => {
    const counter = createUnreadableCounter()
    counter.push('gemini', 'run-5', CLAUDE_CUT + '\n')
    counter.push('gemini', 'run-5', CLAUDE_CUT)
    counter.end('run-5')
    expect(counter.counts()).toEqual({ total: 0, byParser: ZERO })
    expect(Object.keys(counter.counts().byParser)).toEqual(['claude', 'hermes', 'opencode', 'agy'])
  })

  it('joins a line across a CRLF line break', () => {
    const counter = createUnreadableCounter()
    counter.push('claude', 'run-6', CLAUDE_CUT + '\r\n')
    expect(counter.counts().total).toBe(1)
    counter.push('claude', 'run-7', CLAUDE_CUT + '\r')
    counter.push('claude', 'run-7', '\n')
    expect(counter.counts().total).toBe(2)
    counter.push('claude', 'run-8', json(claudeCall) + '\r\n')
    expect(counter.counts().total).toBe(2)
  })

  it('gives a copy from counts and clears everything on reset', () => {
    const counter = createUnreadableCounter()
    const cut = '{"event":"step_update","step_update":{"conversation_id":"c1","step_index":4'
    counter.push('agy', 'run-9', cut.slice(0, 10))
    counter.push('agy', 'run-9', cut.slice(10) + '\n')
    const first = counter.counts()
    expect(first).toEqual({ total: 1, byParser: { ...ZERO, agy: 1 } })
    first.total = 99
    first.byParser.agy = 99
    expect(counter.counts()).toEqual({ total: 1, byParser: { ...ZERO, agy: 1 } })
    counter.reset()
    expect(counter.counts()).toEqual({ total: 0, byParser: ZERO })
  })

  it('counts nothing across the sandbox fixture', () => {
    const frames = parseFrames(readFileSync(join(FIXTURES, 'sandbox-run.jsonl'), 'utf8'))
    const agents = JSON.parse(readFileSync(join(FIXTURES, 'agents.json'), 'utf8')).agents
    const parserOf = new Map(agents.map((agent) => [agent.id, agent.parser]))
    const counter = createUnreadableCounter()
    const runs = new Set()
    for (const frame of frames) {
      if (frame.type !== 'heartbeat.run.log') continue
      counter.push(parserOf.get(frame.payload.agentId), frame.payload.runId, frame.payload.chunk)
      runs.add(frame.payload.runId)
    }
    for (const runId of runs) counter.end(runId)
    expect(runs.size).toBeGreaterThan(0)
    expect(counter.counts()).toEqual({ total: 0, byParser: ZERO })
  })
})
