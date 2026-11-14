import { describe, expect, it } from 'vitest'
import { subPrompt } from '../src/model/hierarchy.js'
import { unattendedPrompt } from '../src/briefs/run.js'

const TICKET_VALUE = '9f8e7d6c5b4a39281706f5e4d3c2b1a0'
const BRIDGE_VALUE = 'http://127.0.0.1:5999'
const OLD_END = 'You get no reply during this run, so keep working on what you can, and send at most 4.'
const NEW_START = 'Send at most 4. A reply does not interrupt you: read your replies with GET on the same address and header, which answers {"messages": [{"from", "text", "at"}]}, after you ask and once more before you finish. Keep working on what you can meanwhile. To message another lane that is running, add "to": "lane:KEY".'

describe('a lane is told how replies work', () => {
  it('changes the paragraph only when the ticket and the bridge are both set', () => {
    const both = unattendedPrompt('Do it.', { MACHINEROOM_LANE_TICKET: TICKET_VALUE, MACHINEROOM_BRIDGE: BRIDGE_VALUE })
    expect(both).toContain(NEW_START)
    expect(both).not.toContain(OLD_END)
    expect(unattendedPrompt('Do it.', { MACHINEROOM_LANE_TICKET: TICKET_VALUE })).not.toContain(NEW_START)
    expect(unattendedPrompt('Do it.', { MACHINEROOM_BRIDGE: BRIDGE_VALUE })).not.toContain(NEW_START)
  })

  it('never holds the ticket value', () => {
    const text = unattendedPrompt('Do it.', { MACHINEROOM_LANE_TICKET: TICKET_VALUE, MACHINEROOM_BRIDGE: BRIDGE_VALUE })
    expect(text).not.toContain(TICKET_VALUE)
  })
})

describe('a sub is told how to answer a lane', () => {
  it('holds the line with the bridge placeholder in place', () => {
    const text = subPrompt(
      { id: 'frontend', name: 'Frontend', lanes: ['opencode'], scope: ['src/ui/**'], restricted: true },
      'orchestrator',
    )
    expect(text).toContain(
      'A lane may message you while it runs, as lane:KEY. To answer it while it still runs, POST {{BRIDGE}}/api/orchestrator/messages with { "to": "lane:KEY", "text": "..." }; a 409 means its run has ended, so start a follow-up run.',
    )
  })
})
