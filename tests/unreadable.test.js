import { describe, expect, it } from 'vitest'
import { unreadableLines } from '../src/model/parsers/unreadable.js'

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
