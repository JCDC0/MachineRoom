import { describe, expect, it } from 'vitest'
import {
  SECTOR_GAP,
  canChange,
  inScope,
  outsideScope,
  ownerOf,
  readLadder,
  sectorArcs,
  subPrompt,
} from '../src/model/hierarchy.js'

const LANES = ['orchestrator', 'claude', 'opencode', 'opencode2', 'opencode3', 'opencode4', 'opencode5']

function sub(overrides = {}) {
  return {
    id: 'frontend',
    name: 'Frontend',
    harness: 'opencode',
    model: 'opencode-go/deepseek-v4.1-flash',
    lanes: ['opencode', 'opencode2'],
    scope: ['src/ui/**', 'src/styles.css'],
    restricted: true,
    setBy: 'owner',
    ...overrides,
  }
}

function read(...subs) {
  return readLadder({ subs }, { lanes: LANES })
}

describe('readLadder', () => {
  it('reads a good ladder and keeps every field', () => {
    const { ladder, problems } = read(sub())
    expect(problems).toEqual([])
    expect(ladder).toEqual({
      subs: [
        {
          id: 'frontend',
          name: 'Frontend',
          harness: 'opencode',
          model: 'opencode-go/deepseek-v4.1-flash',
          lanes: ['opencode', 'opencode2'],
          scope: ['src/ui/**', 'src/styles.css'],
          restricted: true,
          setBy: 'owner',
        },
      ],
    })
  })

  it('treats an empty ladder as valid', () => {
    expect(readLadder({ subs: [] }, { lanes: LANES })).toEqual({ ladder: { subs: [] }, problems: [] })
    expect(readLadder({}, { lanes: LANES })).toEqual({ ladder: { subs: [] }, problems: [] })
  })

  it('refuses a value that is not an object or has no subs list', () => {
    expect(readLadder(null).ladder.subs).toEqual([])
    expect(readLadder(null).problems).toEqual(['The ladder is not an object.'])
    expect(readLadder([]).problems).toEqual(['The ladder is not an object.'])
    expect(readLadder({ subs: 'frontend' }).problems).toEqual(['The ladder subs must be a list.'])
  })

  it('fills the name, harness and model when they are missing', () => {
    const { ladder, problems } = read({ id: 'backend', lanes: [], scope: ['server/**'], restricted: false })
    expect(problems).toEqual([])
    expect(ladder.subs[0]).toMatchObject({ id: 'backend', name: 'backend', harness: '', model: '' })
  })
})

describe('readLadder rules', () => {
  it('checks the id shape', () => {
    expect(read(sub({ id: 'Frontend' })).ladder.subs).toEqual([])
    expect(read(sub({ id: 'front_end' })).ladder.subs).toEqual([])
    expect(read(sub({ id: 'a'.repeat(25) })).ladder.subs).toEqual([])
    expect(read(sub({ id: 'a'.repeat(24) })).ladder.subs).toHaveLength(1)
    expect(read(sub({ id: 'ui-2' })).ladder.subs).toHaveLength(1)
    expect(read(sub({ id: '' })).problems[0]).toBe('Sub 1 has no id.')
    expect(read({ id: undefined }).problems[0]).toBe('Sub 1 has no id.')
  })

  it('refuses the orchestrator id and a lane key as an id', () => {
    const reserved = read(sub({ id: 'orchestrator' }))
    expect(reserved.ladder.subs).toEqual([])
    expect(reserved.problems).toContain('The id "orchestrator" belongs to the main orchestrator.')

    const laneKey = read(sub({ id: 'opencode3' }))
    expect(laneKey.ladder.subs).toEqual([])
    expect(laneKey.problems).toContain('The id "opencode3" is a lane key.')
  })

  it('refuses two sub orchestrators with the same id', () => {
    const { ladder, problems } = read(
      sub({ lanes: ['opencode'] }),
      sub({ lanes: ['opencode2'] }),
    )
    expect(ladder.subs).toHaveLength(1)
    expect(problems).toContain('The sub id "frontend" appears twice.')
  })

  it('keeps at most five sub orchestrators', () => {
    const ids = ['one', 'two', 'three', 'four', 'five', 'six']
    const { ladder, problems } = read(...ids.map((id) => sub({ id, lanes: [] })))
    expect(ladder.subs.map((entry) => entry.id)).toEqual(['one', 'two', 'three', 'four', 'five'])
    expect(problems).toContain('There are at most 5 sub orchestrators; "six" is left out.')
  })

  it('lets a lane belong to one sub only', () => {
    const { ladder, problems } = read(
      sub({ id: 'frontend', lanes: ['opencode', 'opencode2'] }),
      sub({ id: 'backend', lanes: ['opencode', 'opencode3'] }),
    )
    expect(ladder.subs[1].lanes).toEqual(['opencode3'])
    expect(problems).toContain('The lane "opencode" already belongs to sub "frontend".')
  })

  it('refuses a lane that is not a lane key and a lane that is not a name', () => {
    const { ladder, problems } = read(sub({ lanes: ['opencode', 'opencode99', 7] }))
    expect(ladder.subs[0].lanes).toEqual(['opencode'])
    expect(problems).toContain('Sub "frontend" names the lane "opencode99", which is not a lane key.')
    expect(problems).toContain('Sub "frontend" has a lane that is not a name.')
  })

  it('accepts any lane name when no lane list is given', () => {
    const { ladder, problems } = readLadder({ subs: [sub({ lanes: ['unknown'] })] })
    expect(ladder.subs[0].lanes).toEqual(['unknown'])
    expect(problems).toEqual([])
  })

  it('needs a scope of one to twenty relative globs', () => {
    const empty = read(sub({ scope: [] }))
    expect(empty.problems).toContain('Sub "frontend" has no scope.')

    const many = read(sub({ scope: Array.from({ length: 21 }, (_, index) => `src/f${index}/**`) }))
    expect(many.ladder.subs[0].scope).toHaveLength(20)
    expect(many.problems).toContain('Sub "frontend" has more than 20 scope entries; the extra ones are left out.')
  })

  it('refuses a scope entry with an absolute path or a parent step', () => {
    const { ladder, problems } = read(sub({ scope: ['src/ui/**', '../secret', '/etc/passwd', 'C:/Windows', 'src/../x', 'src/ok.js'] }))
    expect(ladder.subs[0].scope).toEqual(['src/ui/**', 'src/ok.js'])
    expect(problems).toContain('Sub "frontend" has a scope entry that is not a relative folder or file glob.')
  })

  it('cleans scope separators and drops repeats', () => {
    const { ladder, problems } = read(sub({ scope: ['.\\src\\ui\\**', 'src/ui/**', 'src/styles.css'] }))
    expect(ladder.subs[0].scope).toEqual(['src/ui/**', 'src/styles.css'])
    expect(problems).toEqual([])
  })

  it('defaults a missing restriction to restricted and checks a value that is not a boolean', () => {
    expect(read(sub({ restricted: undefined })).ladder.subs[0].restricted).toBe(true)
    const { ladder, problems } = read(sub({ restricted: 'yes' }))
    expect(ladder.subs[0].restricted).toBe(true)
    expect(problems).toContain('Sub "frontend" says whether it is restricted with a value that is not true or false.')
  })

  it('defaults setBy to the orchestrator and checks another value', () => {
    expect(read(sub({ setBy: undefined })).ladder.subs[0].setBy).toBe('orchestrator')
    const { ladder, problems } = read(sub({ setBy: 'lane' }))
    expect(ladder.subs[0].setBy).toBe('orchestrator')
    expect(problems).toContain('Sub "frontend" says setBy "lane", which is not owner or orchestrator.')
  })

  it('skips a sub that is not an object', () => {
    const { ladder, problems } = readLadder({ subs: ['frontend'] }, { lanes: LANES })
    expect(ladder.subs).toEqual([])
    expect(problems).toEqual(['Sub 1 is not an object.'])
  })
})

describe('ownerOf', () => {
  const { ladder } = read(sub({ lanes: ['opencode', 'opencode2'] }))

  it('gives the sub id of the lane', () => {
    expect(ownerOf(ladder, 'opencode')).toBe('frontend')
    expect(ownerOf(ladder, 'opencode2')).toBe('frontend')
  })

  it('gives the orchestrator for a lane in no sub', () => {
    expect(ownerOf(ladder, 'claude')).toBe('orchestrator')
    expect(ownerOf({ subs: [] }, 'opencode')).toBe('orchestrator')
    expect(ownerOf(null, 'opencode')).toBe('orchestrator')
  })
})

describe('inScope', () => {
  it('matches a folder glob and its children', () => {
    expect(inScope('src/ui/Hud.jsx', ['src/ui/**'])).toBe(true)
    expect(inScope('src/ui/deep/a.js', ['src/ui/**'])).toBe(true)
    expect(inScope('src/ui', ['src/ui/**'])).toBe(true)
    expect(inScope('src/server/a.js', ['src/ui/**'])).toBe(false)
  })

  it('treats a plain folder as everything under it', () => {
    expect(inScope('src/ui/Hud.jsx', ['src/ui'])).toBe(true)
    expect(inScope('src/ui', ['src/ui'])).toBe(true)
    expect(inScope('src/uiExtra/a.js', ['src/ui'])).toBe(false)
  })

  it('treats a plain file as itself', () => {
    expect(inScope('src/styles.css', ['src/styles.css'])).toBe(true)
    expect(inScope('src/styles.css.bak', ['src/styles.css'])).toBe(false)
  })

  it('keeps a single star inside one segment and lets a double star cross folders', () => {
    expect(inScope('src/a.js', ['src/*.js'])).toBe(true)
    expect(inScope('src/deep/a.js', ['src/*.js'])).toBe(false)
    expect(inScope('src/deep/a.js', ['src/**'])).toBe(true)
    expect(inScope('a.js', ['**/*.js'])).toBe(true)
    expect(inScope('src/a.js', ['*.js'])).toBe(false)
    expect(inScope('a.js', ['*'])).toBe(true)
    expect(inScope('src/a.js', ['*'])).toBe(false)
    expect(inScope('anything/at/all.js', ['**'])).toBe(true)
    expect(inScope('', ['**'])).toBe(true)
  })

  it('reads both separators', () => {
    expect(inScope('src\\ui\\Hud.jsx', ['src/ui/**'])).toBe(true)
    expect(inScope('src/ui/Hud.jsx', ['src\\ui\\**'])).toBe(true)
  })

  it('ignores case only when the windows flag is set', () => {
    expect(inScope('SRC/UI/Hud.jsx', ['src/ui/**'])).toBe(false)
    expect(inScope('SRC/UI/Hud.jsx', ['src/ui/**'], { windows: true })).toBe(true)
    expect(inScope('src/ui/Hud.jsx', ['SRC/UI/**'], { windows: true })).toBe(true)
  })

  it('takes one glob or a list and an empty scope matches nothing', () => {
    expect(inScope('src/ui/Hud.jsx', 'src/ui/**')).toBe(true)
    expect(inScope('src/ui/Hud.jsx', [])).toBe(false)
    expect(inScope('src/ui/Hud.jsx', undefined)).toBe(false)
  })
})

describe('outsideScope', () => {
  const restricted = sub({ scope: ['src/ui/**'] })

  it('lists the paths a restricted sub may not change', () => {
    expect(outsideScope(['src/ui/a.js', 'src/server/a.js', 'README.md'], restricted)).toEqual([
      'src/server/a.js',
      'README.md',
    ])
  })

  it('gives nothing for an open sub', () => {
    expect(outsideScope(['src/server/a.js'], { ...restricted, restricted: false })).toEqual([])
  })

  it('gives every path when the scope is empty', () => {
    expect(outsideScope(['a.js'], { ...restricted, scope: [] })).toEqual(['a.js'])
  })

  it('passes the windows flag to the glob', () => {
    expect(outsideScope(['SRC/UI/a.js'], restricted, { windows: true })).toEqual([])
    expect(outsideScope(['SRC/UI/a.js'], restricted)).toEqual(['SRC/UI/a.js'])
  })
})

describe('canChange', () => {
  const { ladder } = read(sub())

  it('lets the owner change an owner-set scope or restriction', () => {
    expect(canChange(ladder, { id: 'frontend', scope: ['server/**'], restricted: false }, 'owner')).toBe(true)
  })

  it('stops the main orchestrator from changing an owner-set scope', () => {
    expect(canChange(ladder, { id: 'frontend', scope: ['server/**'] }, 'orchestrator')).toBe(false)
    expect(canChange(ladder, { id: 'frontend', scope: ['src/ui/**', 'src/styles.css'] }, 'orchestrator')).toBe(true)
  })

  it('stops the main orchestrator from changing an owner-set restriction or owner', () => {
    expect(canChange(ladder, { id: 'frontend', restricted: false }, 'orchestrator')).toBe(false)
    expect(canChange(ladder, { id: 'frontend', setBy: 'orchestrator' }, 'orchestrator')).toBe(false)
  })

  it('lets the main orchestrator change other fields of an owner-set sub', () => {
    expect(canChange(ladder, { id: 'frontend', name: 'Web' }, 'orchestrator')).toBe(true)
    expect(canChange(ladder, { id: 'frontend', lanes: ['opencode'] }, 'orchestrator')).toBe(true)
  })

  it('lets the main orchestrator change a sub it set', () => {
    const own = readLadder({ subs: [sub({ setBy: 'orchestrator' })] }, { lanes: LANES }).ladder
    expect(canChange(own, { id: 'frontend', scope: ['server/**'], restricted: false }, 'orchestrator')).toBe(true)
  })

  it('lets a change to a sub that is not in the ladder and refuses a change that is not an object', () => {
    expect(canChange(ladder, { id: 'missing', scope: ['server/**'] }, 'orchestrator')).toBe(true)
    expect(canChange(ladder, null, 'orchestrator')).toBe(false)
  })
})

describe('sectorArcs', () => {
  const roster = ['opencode', 'opencode2', 'opencode3', 'opencode4', 'opencode5']
  const full = Math.PI * 2

  it('gives the main orchestrator the whole ring when there are no subs', () => {
    const arcs = sectorArcs({ subs: [] }, ['opencode', 'claude'])
    expect(arcs).toHaveLength(1)
    expect(arcs[0]).toMatchObject({ id: 'orchestrator', lanes: ['opencode', 'claude'] })
    expect(arcs[0].start).toBeCloseTo(SECTOR_GAP)
    expect(arcs[0].end).toBeCloseTo(full - SECTOR_GAP)
  })

  it('gives one sub an arc for its lanes and the rest to the main orchestrator', () => {
    const { ladder } = read(sub({ lanes: ['opencode'] }))
    const arcs = sectorArcs(ladder, ['opencode', 'claude'])
    expect(arcs).toHaveLength(2)
    expect(arcs[0]).toMatchObject({ id: 'frontend', name: 'Frontend', lanes: ['opencode'] })
    expect(arcs[0].start).toBeCloseTo(SECTOR_GAP)
    expect(arcs[0].end).toBeCloseTo(Math.PI - SECTOR_GAP)
    expect(arcs[1]).toMatchObject({ id: 'orchestrator', lanes: ['claude'] })
    expect(arcs[1].start).toBeCloseTo(Math.PI + SECTOR_GAP)
    expect(arcs[1].end).toBeCloseTo(full - SECTOR_GAP)
  })

  it('gives five subs equal arcs and leaves the rest to the main orchestrator', () => {
    const subs = roster.map((lane, index) => sub({ id: `s${index + 1}`, lanes: [lane] }))
    const { ladder } = read(...subs, sub({ id: 'spare', lanes: [] }))
    const arcs = sectorArcs(ladder, ['opencode', 'opencode2', 'opencode3', 'opencode4', 'opencode5', 'claude'])
    expect(arcs).toHaveLength(6)
    const width = full / 6
    arcs.forEach((arc, index) => {
      expect(arc.start).toBeCloseTo(index * width + SECTOR_GAP)
      expect(arc.end).toBeCloseTo((index + 1) * width - SECTOR_GAP)
    })
    expect(arcs[5]).toMatchObject({ id: 'orchestrator', lanes: ['claude'] })
  })

  it('gives a sub with no lanes a zero width arc in its place', () => {
    const { ladder } = read(
      sub({ id: 'frontend', lanes: ['opencode'] }),
      sub({ id: 'empty', lanes: [] }),
    )
    const arcs = sectorArcs(ladder, ['opencode', 'claude'])
    expect(arcs.map((arc) => arc.id)).toEqual(['frontend', 'empty', 'orchestrator'])
    expect(arcs[1].lanes).toEqual([])
    expect(arcs[1].start).toBeCloseTo(Math.PI)
    expect(arcs[1].end).toBeCloseTo(Math.PI)
    expect(arcs[2].start).toBeCloseTo(Math.PI + SECTOR_GAP)
  })

  it('keeps the lane keys in roster order', () => {
    const { ladder } = read(sub({ lanes: ['opencode', 'opencode2', 'opencode3'] }))
    const arcs = sectorArcs(ladder, ['opencode3', 'opencode', 'opencode2'])
    expect(arcs[0].lanes).toEqual(['opencode3', 'opencode', 'opencode2'])
  })

  it('reads an agent roster as well as lane keys', () => {
    const { ladder } = read(sub({ lanes: ['opencode'] }))
    const arcs = sectorArcs(ladder, [{ key: 'opencode' }, { key: 'claude' }])
    expect(arcs[0].lanes).toEqual(['opencode'])
    expect(arcs[1].lanes).toEqual(['claude'])
  })

  it('gives the same angles for the same input', () => {
    const { ladder } = read(sub({ lanes: ['opencode', 'opencode2'] }))
    expect(sectorArcs(ladder, roster)).toEqual(sectorArcs(ladder, roster))
  })

  it('gives zero width arcs when the roster is empty', () => {
    const { ladder } = read(sub({ lanes: ['opencode'] }))
    const arcs = sectorArcs(ladder, [])
    expect(arcs.every((arc) => arc.start === 0 && arc.end === 0)).toBe(true)
    expect(arcs.every((arc) => arc.lanes.length === 0)).toBe(true)
  })
})

describe('subPrompt', () => {
  const { ladder } = read(sub())
  const text = subPrompt(ladder.subs[0], 'orchestrator')

  it('names the id, name, parent, lanes, scope, restriction, branch and report', () => {
    expect(text).toContain('## Your sector')
    expect(text).toContain('Your id is `frontend` and your name is Frontend.')
    expect(text).toContain('Your parent is `orchestrator`.')
    expect(text).toContain('Your lanes: `opencode`, `opencode2`.')
    expect(text).toContain('Your scope: `src/ui/**`, `src/styles.css`.')
    expect(text).toContain('Your scope is restricted. Your lanes may change files only in that scope.')
    expect(text).toContain('Your sector branch is `machineroom/sector-frontend`.')
    expect(text).toContain('Then report to your parent as `sub:frontend`.')
    expect(text).not.toContain('undefined')
    expect(text).not.toContain('\u2014')
  })

  it('says an open scope is open and lists no lanes when there are none', () => {
    const open = subPrompt(sub({ lanes: [], restricted: false }), { id: 'main-2', name: 'Main' })
    expect(open).toContain('Your lanes: none.')
    expect(open).toContain('Your parent is `main-2`.')
    expect(open).toContain('Your scope is open. Your lanes may change files anywhere in the project.')
  })

  it('falls back to the orchestrator as parent', () => {
    expect(subPrompt(sub(), null)).toContain('Your parent is `orchestrator`.')
    expect(subPrompt(sub(), { name: 'Main' })).toContain('Your parent is `orchestrator`.')
  })

  it('says there are no siblings when the ladder holds no other sub', () => {
    expect(text).toContain('Your siblings: none.')
    expect(subPrompt(ladder.subs[0], 'orchestrator', ladder)).toContain('Your siblings: none.')
    expect(text).toContain('To message another sub, ask your parent to pass it on.')
    expect(text).toContain('Your lanes do not talk. They report when their run ends.')
  })

  it('asks for the report as the reply and never through the messages route', () => {
    expect(text).toContain(
      'Your reply is your report. End your turn with it. Never send it to /api/orchestrator/messages.',
    )
  })

  it('names the two sibling subs by id and name and leaves itself out', () => {
    const three = read(
      sub(),
      sub({ id: 'backend', name: 'Backend', lanes: ['opencode3'], scope: ['server/**'] }),
      sub({ id: 'data', name: 'Data', lanes: ['opencode4'], scope: ['docs/**'] }),
    )
    const first = subPrompt(three.ladder.subs[0], 'orchestrator', three.ladder)
    expect(first).toContain('Your siblings: `backend` (Backend), `data` (Data).')
    expect(first).not.toContain('`frontend` (Frontend)')
    const last = subPrompt(three.ladder.subs[2], 'orchestrator', three.ladder)
    expect(last).toContain('Your siblings: `frontend` (Frontend), `backend` (Backend).')
    expect(last).not.toContain('`data` (Data)')
  })
})
