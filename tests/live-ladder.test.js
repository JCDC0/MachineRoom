import { describe, expect, it } from 'vitest'
import { sectorArcs } from '../src/model/hierarchy.js'
import { ladderFromAnswer } from '../src/ui/liveLadder.js'

const MAIN = {
  id: 'orchestrator',
  name: 'Orchestrator',
  harness: 'claude',
  model: 'opus',
  state: 'idle',
  lanes: ['claude', 'opencode'],
  scope: [],
  restricted: false,
  setBy: 'owner',
}

const FRONTEND = {
  id: 'frontend',
  name: 'Frontend',
  harness: 'opencode',
  model: 'opencode-go/deepseek-v4.1-flash',
  state: 'working',
  lanes: ['opencode'],
  scope: ['src/ui/**'],
  restricted: true,
  setBy: 'owner',
}

const BACKEND = {
  id: 'backend',
  name: 'Backend',
  harness: 'claude',
  model: 'sonnet',
  state: 'idle',
  lanes: ['claude'],
  scope: ['server/**'],
  restricted: false,
  setBy: 'orchestrator',
}

describe('ladderFromAnswer', () => {
  it('reads an empty answer as a ladder with no subs', () => {
    expect(ladderFromAnswer([])).toEqual({ subs: [] })
    expect(ladderFromAnswer({ orchestrators: [] })).toEqual({ subs: [] })
  })

  it('leaves the main orchestrator out', () => {
    expect(ladderFromAnswer([MAIN])).toEqual({ subs: [] })
    expect(ladderFromAnswer({ orchestrators: [MAIN] })).toEqual({ subs: [] })
  })

  it('turns two subs into a ladder in the answer order', () => {
    const ladder = ladderFromAnswer({ orchestrators: [MAIN, FRONTEND, BACKEND] })
    expect(ladder).toEqual({
      subs: [
        {
          id: 'frontend',
          name: 'Frontend',
          harness: 'opencode',
          model: 'opencode-go/deepseek-v4.1-flash',
          lanes: ['opencode'],
          scope: ['src/ui/**'],
          restricted: true,
          setBy: 'owner',
        },
        {
          id: 'backend',
          name: 'Backend',
          harness: 'claude',
          model: 'sonnet',
          lanes: ['claude'],
          scope: ['server/**'],
          restricted: false,
          setBy: 'orchestrator',
        },
      ],
    })
  })

  it('answers null to a bad answer', () => {
    expect(ladderFromAnswer(null)).toBeNull()
    expect(ladderFromAnswer(undefined)).toBeNull()
    expect(ladderFromAnswer('no')).toBeNull()
    expect(ladderFromAnswer({})).toBeNull()
    expect(ladderFromAnswer({ orchestrators: 'no' })).toBeNull()
    expect(ladderFromAnswer({ subs: [] })).toBeNull()
  })

  it('keeps a lane sector when the sub agent is not in the roster', () => {
    const ladder = ladderFromAnswer([MAIN, FRONTEND, BACKEND])
    const arcs = sectorArcs(ladder, ['claude', 'opencode'])
    expect(arcs.map((arc) => [arc.id, arc.lanes])).toEqual([
      ['frontend', ['opencode']],
      ['backend', ['claude']],
      ['orchestrator', []],
    ])
    expect(arcs[0].end).toBeGreaterThan(arcs[0].start)
    expect(arcs[1].end).toBeGreaterThan(arcs[1].start)
  })
})
