import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { branchFor, buildPrompt, modelFor, nextVersion, parseBriefs, parseRules } from '../src/briefs/briefs.js'

const read = (name) => readFileSync(new URL(`../docs/agents/${name}`, import.meta.url), 'utf8')
const briefs = parseBriefs(read('TASKS.md'))
const lanes = JSON.parse(read('lanes.json'))
const rules = parseRules(read('HOUSE-RULES.md'))
const byId = (id) => briefs.find((brief) => brief.id === id)

describe('parseBriefs', () => {
  it('reads the real task file', () => {
    expect(briefs.length).toBeGreaterThan(30)
    expect(new Set(briefs.map((brief) => brief.id)).size).toBe(briefs.length)
    for (const id of ['C2', 'C3e', 'T1a', 'T1b', 'P5', 'P6', 'G5', 'U4', 'M1', 'D1', 'A3']) expect(byId(id), id).toBeTruthy()
  })

  it('reads owner, done and section', () => {
    expect(byId('P3a')).toMatchObject({ title: 'Folder collapse plan', owners: ['hermes'], done: true })
    expect(byId('P3b')).toMatchObject({ owners: ['claude'], done: false })
    expect(byId('P7')).toMatchObject({ title: 'A here-string body is not a file touch', owners: ['hermes'], done: true })
    expect(byId('P5')).toMatchObject({ title: 'Recover cut and redacted tool lines', owners: ['hermes'], done: true })
    expect(byId('C2')).toMatchObject({ owners: ['opencode'], done: true })
    expect(byId('C3e').owners).toEqual(['agy'])
    expect(byId('T1a').owners).toEqual(['opencode'])
    expect(byId('M1').owners).toEqual(['claude'])
    expect(byId('P4').owners).toEqual([])
    expect(byId('S1').owners).toEqual(['opencode'])
    expect(byId('G5').section).toBe('Roadmap: the next plan')
    expect(byId('C2').text.length).toBeGreaterThan(100)
  })

  it('reads a made-up file, with Windows line endings and an ID that has a letter after the digit', () => {
    const text = '## Open\r\n\r\n**X1. Do the thing (AGY, merged as 0.1.2).** Text here.\r\n\r\n**Y2b. No owner.** Plain text.\r\nnot a brief\r\n'
    expect(parseBriefs(text)).toEqual([
      { id: 'X1', title: 'Do the thing', ownerText: 'AGY, merged as 0.1.2', owners: ['agy'], done: true, section: 'Open', text: 'Text here.' },
      { id: 'Y2b', title: 'No owner', ownerText: '', owners: [], done: false, section: 'Open', text: 'Plain text.' },
    ])
  })

  it('finds two owners in one brief', () => {
    const [brief] = parseBriefs('**Z9. Both (OpenCode for the route, AGY for the panel).** Text.')
    expect(brief.owners).toEqual(['opencode', 'agy'])
  })

  it('ignores an empty file', () => {
    expect(parseBriefs('')).toEqual([])
  })
})

describe('parseRules', () => {
  it('reads the house rules file', () => {
    expect(rules.about).toMatch(/MachineRoom is a React and three\.js viewer/)
    expect(rules.rules.length).toBeGreaterThanOrEqual(6)
    expect(rules.rules.join(' ')).toMatch(/Never push/)
    expect(rules.report).toMatch(/^Give the report in your reply/)
  })
})

describe('helpers', () => {
  it('raises the patch number', () => {
    expect(nextVersion('0.1.35')).toBe('0.1.36')
    expect(nextVersion('0.1.9')).toBe('0.1.10')
    expect(() => nextVersion('v1')).toThrow(/version/)
  })

  it('builds a branch name from the id and the first three words of the title', () => {
    expect(branchFor(byId('C3e'))).toBe('feat/c3e-hud-polish')
    expect(branchFor(byId('P5'))).toBe('feat/p5-recover-cut-and')
  })

  it('picks the model of a task, with a default per lane', () => {
    const mapped = { ...lanes.agy, models: { C3e: 'Gemini 4 Argon (Medium)' } }
    expect(modelFor(mapped, 'C3e')).toBe('Gemini 4 Argon (Medium)')
    expect(modelFor(mapped, 'C3b')).toBe('Gemini 3.8 Flash (High)')
    expect(modelFor(lanes.agy, 'C3e')).toBe('Gemini 3.8 Flash (High)')
    expect(modelFor(lanes.hermes, 'P5')).toBe('deepseek/deepseek-v4.1-flash-1017')
  })
})

describe('lanes', () => {
  it('have every field a prompt needs', () => {
    const promptLanes = Object.entries(lanes).filter(([key]) => key !== 'orchestrator')
    for (const [key, lane] of promptLanes) {
      for (const field of ['name', 'harness', 'model', 'worktree', 'role']) expect(typeof lane[field], `${key} ${field}`).toBe('string')
      expect(Array.isArray(lane.forbidden), key).toBe(true)
      expect(lane.worktree, key).toMatch(/^C:\\GitHub\\MachineRoom-/)
    }
    expect(new Set(promptLanes.map(([, lane]) => lane.worktree)).size).toBe(promptLanes.length)
    expect(lanes.orchestrator).toMatchObject({
      name: 'Orchestrator',
      harness: 'Claude Code',
      cli: { harness: 'claude', bin: 'claude', model: 'opus' },
    })
    expect(lanes.orchestrator.worktree).toBeUndefined()
    expect(lanes.orchestrator.role).toBeUndefined()
  })

  it('keep each agent out of the files another agent owns', () => {
    expect(lanes.hermes.forbidden).toContain('server/**')
    expect(lanes.opencode.forbidden).not.toContain('src/ui/**')
    expect(lanes.opencode.forbidden).not.toContain('src/Stage.jsx')
    for (const key of ['agy', 'agy2', 'agy3']) {
      expect(lanes[key].forbidden, key).toContain('src/styles.css')
      expect(lanes[key].forbidden, key).toContain('src/engine/**')
      expect(lanes[key].forbidden, key).toContain('src/Stage.jsx')
    }
    for (const key of ['hermes', 'claude']) expect(lanes[key].forbidden).toContain('src/Stage.jsx')
  })
})

describe('buildPrompt', () => {
  const make = (ids, laneKey) => buildPrompt({ briefs: ids.map(byId), laneKey, lanes, rules, version: '0.1.35' })
  const argonLanes = { ...lanes, agy: { ...lanes.agy, models: { C3e: 'Gemini 4 Argon (Medium)' } } }

  it('builds a prompt for one task', () => {
    const prompt = make(['U4'], 'opencode')
    expect(prompt.split('\n')[0]).toBe("Model to select in OpenCode: DeepSeek V4.1 Flash 1017 (in OpenCode's list it appears as opencode-go/deepseek-v4.1-flash), reasoning max.")
    expect(prompt).toContain('Your worktree is C:\\GitHub\\MachineRoom-opencode. Run: git switch -c feat/u4-reject-a-foreign refs/heads/main')
    expect(prompt).toContain('Task U4: Reject a foreign Host header in the bridge.')
    expect(prompt).toContain(byId('U4').text)
    expect(prompt).toContain('Commit with the prefix 0.1.36 and one plain sentence. Do not push.')
    expect(prompt).toContain('Never push.')
    expect(prompt).not.toContain('Do not touch these paths')
    expect(make(['U4'], 'agy')).toContain('Do not touch these paths: src/styles.css')
    expect(prompt).toContain('Test anything that starts a process')
    expect(prompt).toMatch(/Report: Give the report in your reply/)
    expect(prompt).not.toContain('undefined')
  })

  it('builds one prompt for several tasks and says how to commit and report', () => {
    const prompt = make(['G5', 'P5'], 'hermes')
    expect(prompt).toContain('Model to select in Hermes: deepseek/deepseek-v4.1-flash-1017 (the OpenRouter id')
    expect(prompt.split('\n')[0]).toBe("Model to select in Hermes: deepseek/deepseek-v4.1-flash-1017 (the OpenRouter id; pick it from Hermes' own model list), reasoning xhigh.")
    expect(prompt).toContain('git switch -c feat/g5-ci-workflow refs/heads/main')
    expect(prompt).toContain('Task G5: CI workflow.')
    expect(prompt).toContain('Task P5: Recover cut and redacted tool lines.')
    expect(prompt).toContain('Do the tasks in order.')
    expect(prompt).toContain('Report once, at the end.')
    expect(prompt).toContain('Run one command per tool call.')
    expect(prompt.indexOf('Task G5')).toBeLessThan(prompt.indexOf('Task P5'))
  })

  it('never ends a prompt line in the bare main branch', () => {
    for (const laneKey of Object.keys(lanes).filter((key) => key !== 'orchestrator')) {
      const prompt = make(['U4', 'G5'], laneKey)
      for (const line of prompt.split('\n')) expect(line, `${laneKey}: ${line}`).not.toMatch(/ main$/)
    }
  })

  it('names the stronger model for a task that needs it and leaves out the hint', () => {
    const prompt = buildPrompt({ briefs: [byId('C3e')], laneKey: 'agy', lanes: argonLanes, rules, version: '0.1.35' })
    expect(prompt.startsWith('Model to select in agy: Gemini 4 Argon (Medium).')).toBe(true)
    expect(prompt.split('\n')[0]).not.toContain('reasoning')
  })

  it('marks a task whose model differs from the first one', () => {
    const prompt = buildPrompt({ briefs: [byId('C3e'), byId('C3b')], laneKey: 'agy', lanes: argonLanes, rules, version: '0.1.35' })
    expect(prompt).toContain('Task C3b: Change notices in the panels (select Gemini 3.8 Flash (High) for this task).')
  })

  it('refuses an unknown lane and an empty list', () => {
    expect(() => make(['U4'], 'nobody')).toThrow(/no lane/)
    expect(() => buildPrompt({ briefs: [], laneKey: 'agy', lanes, rules, version: '0.1.35' })).toThrow(/at least one/)
  })

  it('builds a prompt for every open brief that has an agent owner', () => {
    const open = briefs.filter((brief) => !brief.done && brief.owners.some((owner) => lanes[owner]))
    expect(open.length).toBeGreaterThan(5)
    for (const brief of open) {
      const laneKey = brief.owners.find((owner) => lanes[owner])
      const prompt = buildPrompt({ briefs: [brief], laneKey, lanes, rules, version: '0.1.35' })
      expect(prompt, brief.id).not.toContain('undefined')
      expect(prompt, brief.id).toContain(`Task ${brief.id}:`)
      expect(prompt.length, brief.id).toBeLessThan(9000)
    }
  })
})
