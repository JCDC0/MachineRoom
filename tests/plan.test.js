import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parseBriefs, parseRules } from '../src/briefs/briefs.js'
import { briefMarkdown, parsePlan, pathAllowed, planPrompt } from '../src/briefs/plan.js'

const read = (name) => readFileSync(new URL(`../docs/agents/${name}`, import.meta.url), 'utf8')
const lanes = JSON.parse(read('lanes.json'))
const rules = parseRules(read('HOUSE-RULES.md'))
const realIds = parseBriefs(read('TASKS.md')).map((brief) => brief.id)

const good = (over = {}) => ({
  id: 'C7a',
  title: 'A plan',
  owner: 'hermes',
  size: 'small',
  files: ['src/briefs/plan.js'],
  tests: ['tests/plan.test.js'],
  text: 'Do the thing.',
  dependsOn: [],
  ...over,
})

const plan = (...briefs) => JSON.stringify({ briefs })
const problems = (text, ids = []) => parsePlan(text, { lanes, ids }).problems

describe('planPrompt', () => {
  const prompt = planPrompt({ goal: 'Split the planner work.', lanes, rules, ids: realIds })

  it('holds the goal, the rules and the lanes', () => {
    expect(prompt).toContain('Goal: Split the planner work.')
    expect(prompt).toContain('MachineRoom is a React and three.js viewer')
    expect(prompt).toContain('- Work only in your own worktree and branch.')
    expect(prompt).toContain('- hermes (Hermes): You take cheap tasks with named files and clear tests.')
    expect(prompt).toContain('server/**')
    expect(prompt).toContain('  Forbidden: src/ui/**, src/styles.css')
  })

  it('holds the used ids and the answer format', () => {
    expect(prompt).toContain('Ids already used: ')
    expect(prompt).toContain('C4b')
    expect(prompt).toContain('{ "briefs": [')
    for (const field of ['"id"', '"title"', '"owner"', '"size"', '"files"', '"tests"', '"text"', '"dependsOn"']) {
      expect(prompt).toContain(field)
    }
  })

  it('holds the style rules and no em dash', () => {
    expect(prompt).toContain('One paragraph per brief.')
    expect(prompt).toContain('Plain words, short sentences.')
    expect(prompt).toContain('No em dashes.')
    expect(prompt).toContain('in backticks')
    expect(prompt).toContain('by its file name')
    expect(prompt).toContain('At most 8 briefs.')
    expect(prompt).not.toMatch(/\u2014/)
  })

  it('says none when no id is used yet', () => {
    expect(planPrompt({ goal: 'A goal.', lanes, rules, ids: [] })).toContain('Ids already used: none.')
  })
})

describe('pathAllowed', () => {
  it('refuses a path under a dir/** entry and a plain entry', () => {
    expect(pathAllowed('server/index.js', lanes.hermes.forbidden)).toBe(false)
    expect(pathAllowed('server', lanes.hermes.forbidden)).toBe(false)
    expect(pathAllowed('src/ui/panels/PlanPanel.jsx', lanes.hermes.forbidden)).toBe(false)
    expect(pathAllowed('src/styles.css', lanes.hermes.forbidden)).toBe(false)
    expect(pathAllowed('src/App.jsx', lanes.hermes.forbidden)).toBe(false)
    expect(pathAllowed('src/briefs/plan.js', lanes.hermes.forbidden)).toBe(true)
    expect(pathAllowed('tests/plan.test.js', lanes.hermes.forbidden)).toBe(true)
  })

  it('reads each lane of the real lanes.json', () => {
    expect(pathAllowed('src/ui/Hud.jsx', lanes.opencode.forbidden)).toBe(false)
    expect(pathAllowed('server/index.js', lanes.opencode.forbidden)).toBe(true)
    expect(pathAllowed('src/engine/room.js', lanes.agy.forbidden)).toBe(true)
    expect(pathAllowed('server/plans.js', lanes.agy.forbidden)).toBe(false)
    expect(pathAllowed('src/control/client.js', lanes.agy.forbidden)).toBe(false)
  })

  it('reads a Windows path and a leading ./', () => {
    expect(pathAllowed('src\\ui\\Hud.jsx', lanes.opencode.forbidden)).toBe(false)
    expect(pathAllowed('./src/ui/Hud.jsx', lanes.opencode.forbidden)).toBe(false)
    expect(pathAllowed('src/briefs/plan.js', [])).toBe(true)
    expect(pathAllowed('src/briefs/plan.js', undefined)).toBe(true)
  })
})

describe('parsePlan', () => {
  it('reads a good plan', () => {
    const text = `Here is the plan.\n${plan(
      good({ id: 'C7a', dependsOn: [] }),
      good({ id: 'C7b', dependsOn: ['C7a'], text: 'Then the rest.' }),
    )}`
    const answer = parsePlan(text, { lanes, ids: [] })
    expect(answer.problems).toEqual([])
    expect(answer.briefs).toEqual([
      good({ id: 'C7a' }),
      good({ id: 'C7b', dependsOn: ['C7a'], text: 'Then the rest.' }),
    ])
  })

  it('reads the first JSON object in the text', () => {
    const text = `Sure. ${plan(good())} Trailing words.`
    expect(parsePlan(text, { lanes, ids: [] }).briefs).toHaveLength(1)
  })

  it('says the plan is not JSON', () => {
    expect(problems('no braces here')).toEqual(['The plan is not JSON.'])
    expect(problems('{ briefs: oops }')).toEqual(['The plan is not JSON.'])
    expect(parsePlan('', { lanes, ids: [] })).toEqual({ briefs: [], problems: ['The plan is not JSON.'] })
  })

  it('says the plan has no briefs', () => {
    expect(problems('{"briefs": []}')).toEqual(['The plan has no briefs.'])
    expect(problems('{"goal": "no list"}')).toEqual(['The plan has no briefs.'])
  })

  it('says the plan has more than 8 briefs', () => {
    const many = Array.from({ length: 9 }, (_, index) => good({ id: `C7${'abcdefghi'[index]}` }))
    expect(problems(plan(...many))).toEqual(['The plan has more than 8 briefs.'])
  })

  it('says a brief has no id like C7a', () => {
    expect(problems(plan(good(), good({ id: 'seven' })))).toEqual(['Brief 2 has no id like C7a.'])
  })

  it('says a brief id is taken', () => {
    expect(problems(plan(good()), ['C7a'])).toEqual(['Brief C7a uses an id that is taken.'])
  })

  it('says a brief id appears twice', () => {
    expect(problems(plan(good(), good()))).toEqual(['Brief C7a appears twice.', 'Brief C7a appears twice.'])
    expect(parsePlan(plan(good(), good()), { lanes, ids: [] }).briefs).toEqual([])
  })

  it('says a brief names an owner that is not a lane', () => {
    expect(problems(plan(good({ owner: 'claude' })))).toEqual([
      'Brief C7a names an owner that is not a lane: claude.',
    ])
  })

  it('says a brief has no size', () => {
    expect(problems(plan(good({ size: 'huge' })))).toEqual([
      'Brief C7a has no size of small, medium or large.',
    ])
    expect(problems(plan(good({ size: '' })))).toEqual(['Brief C7a has no size of small, medium or large.'])
  })

  it('says a brief lists no files', () => {
    expect(problems(plan(good({ files: [] })))).toEqual(['Brief C7a lists no files.'])
  })

  it('says a brief lets its owner touch a forbidden path', () => {
    expect(problems(plan(good({ files: ['src/briefs/plan.js', 'server/plans.js'] })))).toEqual([
      'Brief C7a lets hermes touch server/plans.js, which lanes.json forbids.',
    ])
  })

  it('says a brief names no test', () => {
    expect(problems(plan(good({ tests: [] })))).toEqual(['Brief C7a names no test.'])
  })

  it('says a brief has an em dash', () => {
    expect(problems(plan(good({ text: 'Do the thing \u2014 now.' })))).toEqual(['Brief C7a has an em dash.'])
    expect(problems(plan(good({ title: 'A \u2014 plan' })))).toEqual(['Brief C7a has an em dash.'])
  })

  it('says a brief depends on an id that is not in the plan', () => {
    expect(problems(plan(good({ dependsOn: ['C9z'] })))).toEqual([
      'Brief C7a depends on C9z, which is not in the plan.',
    ])
  })

  it('says the plan has a loop in its dependencies', () => {
    const text = plan(good({ id: 'C7a', dependsOn: ['C7b'] }), good({ id: 'C7b', dependsOn: ['C7a'] }))
    expect(problems(text)).toEqual(['The plan has a loop in its dependencies.'])
    expect(parsePlan(text, { lanes, ids: [] }).briefs).toEqual([])
  })

  it('says a loop when a brief depends on itself', () => {
    expect(problems(plan(good({ dependsOn: ['C7a'] })))).toEqual(['The plan has a loop in its dependencies.'])
  })

  it('keeps a chain of dependencies', () => {
    const text = plan(good({ id: 'C7a', dependsOn: ['C7b'] }), good({ id: 'C7b' }))
    expect(problems(text)).toEqual([])
    expect(parsePlan(text, { lanes, ids: [] }).briefs.map((brief) => brief.id)).toEqual(['C7a', 'C7b'])
  })

  it('keeps the good brief when the other one is bad', () => {
    const text = plan(good({ id: 'C7a' }), good({ id: 'C7b', size: 'huge' }))
    const answer = parsePlan(text, { lanes, ids: [] })
    expect(answer.problems).toEqual(['Brief C7b has no size of small, medium or large.'])
    expect(answer.briefs).toEqual([good({ id: 'C7a' })])
  })

  it('reads a plan that names an owner with an own key of lanes', () => {
    expect(problems(plan(good({ owner: 'constructor' })))).toEqual([
      'Brief C7a names an owner that is not a lane: constructor.',
    ])
  })
})

describe('briefMarkdown', () => {
  it('writes the line and adds the files when the text has none', () => {
    expect(briefMarkdown(good(), lanes)).toBe(
      '**C7a. A plan (Hermes).** Do the thing. Files: `src/briefs/plan.js`.',
    )
  })

  it('keeps a Files: list that the text already has', () => {
    const brief = good({ text: 'Do it. Files: `src/a.js`.' })
    expect(briefMarkdown(brief, lanes)).toBe('**C7a. A plan (Hermes).** Do it. Files: `src/a.js`.')
  })

  it('reads back through parseBriefs with the id, the title and the owner', () => {
    const [brief] = parseBriefs(briefMarkdown(good(), lanes))
    expect(brief).toMatchObject({ id: 'C7a', title: 'A plan', owners: ['hermes'] })
    expect(brief.text).toBe('Do the thing. Files: `src/briefs/plan.js`.')
  })

  it('reads back a brief whose owner is not in lanes.json', () => {
    const [brief] = parseBriefs(briefMarkdown(good({ owner: 'claude' }), lanes))
    expect(brief).toMatchObject({ id: 'C7a', title: 'A plan', owners: ['claude'] })
  })
})
