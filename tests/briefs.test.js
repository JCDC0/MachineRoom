import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { branchFor, briefFileList, buildPrompt, modelFor, nextVersion, parseBriefs, parseRules } from '../src/briefs/briefs.js'

const read = (name) => readFileSync(new URL(`../docs/agents/${name}`, import.meta.url), 'utf8')
const taskBriefs = parseBriefs(read('TASKS.md'))
const archiveBriefs = parseBriefs(read('history/TASKS-ARCHIVE.md'))
const briefs = [...taskBriefs, ...archiveBriefs]
const lanes = JSON.parse(read('lanes.json'))
const rules = parseRules(read('HOUSE-RULES.md'))
const byId = (id) => briefs.find((brief) => brief.id === id)

describe('parseBriefs', () => {
  it('reads the real task file and its archive', () => {
    expect(taskBriefs.length).toBeGreaterThan(5)
    expect(archiveBriefs.length).toBeGreaterThan(300)
    expect(new Set(briefs.map((brief) => brief.id)).size).toBe(briefs.length)
    for (const id of ['C2', 'C3e', 'T1a', 'T1b', 'P5', 'P6', 'G5', 'U4', 'M1', 'D1', 'A3']) expect(byId(id), id).toBeTruthy()
  })

  it('keeps every id in one file only', () => {
    const taskIds = new Set(taskBriefs.map((brief) => brief.id))
    expect(archiveBriefs.filter((brief) => taskIds.has(brief.id)).map((brief) => brief.id)).toEqual([])
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
      { id: 'Y2b', title: 'No owner', ownerText: '', owners: [], done: false, section: 'Open', text: 'Plain text.\nnot a brief' },
    ])
  })

  it('keeps the body down to the next brief or section heading', () => {
    const text = [
      '## Fixes',
      '',
      '**P114. Review the merges (Codex).** Read this brief only.',
      '',
      'Review what these merges brought.',
      '',
      'Files: docs/agents/AUDIT-2026-11-REVIEW-17.md.',
      '',
      '**P115. Finish the menu (OpenCode).** Do the work.',
      '',
      '### A later section',
      'Prose that belongs to no brief.',
    ].join('\n')
    const [first, second] = parseBriefs(text)
    expect(first.text).toBe('Read this brief only.\n\nReview what these merges brought.\n\nFiles: docs/agents/AUDIT-2026-11-REVIEW-17.md.')
    expect(briefFileList(first.text)).toEqual(['docs/agents/AUDIT-2026-11-REVIEW-17.md'])
    expect(second.text).toBe('Do the work.')
  })

  it('finds two owners in one brief', () => {
    const [brief] = parseBriefs('**Z9. Both (OpenCode for the route, AGY for the panel).** Text.')
    expect(brief.owners).toEqual(['opencode', 'agy'])
  })

  it('ignores an empty file', () => {
    expect(parseBriefs('')).toEqual([])
  })
})

describe('briefFileList', () => {
  it('reads a backticked Files: list', () => {
    expect(briefFileList('Files: `src/a.js`, `tests/a.test.js` and `docs/agents/CHANGELOG.md`.')).toEqual([
      'src/a.js', 'tests/a.test.js', 'docs/agents/CHANGELOG.md',
    ])
  })

  it('reads a plain Files: list without backticks', () => {
    expect(briefFileList('Files: server/index.js and ..\\..\\outside.txt')).toEqual(['server/index.js', '..\\..\\outside.txt'])
  })

  it('strips a parenthetical note and ignores prose after the entry', () => {
    expect(briefFileList('Files: `scripts/run-lane.mjs` (the call only), `docs/agents/CONTROL-CLIENT.md` only if it describes `/api/health`.')).toEqual([
      'scripts/run-lane.mjs', 'docs/agents/CONTROL-CLIENT.md',
    ])
  })

  it('keeps each entry once and reads the real U77 brief', () => {
    expect(briefFileList('Files: `src/a.js`, `src/a.js`.')).toEqual(['src/a.js'])
    expect(briefFileList(byId('U77').text)).toEqual([
      'src/briefs/run.js', 'src/briefs/briefs.js', 'scripts/run-lane.mjs', 'docs/agents/CHANGELOG.md',
    ])
  })

  it('reads a Files: line two paragraphs below the real P114 heading', () => {
    expect(briefFileList(byId('P114').text)).toEqual(['docs/agents/AUDIT-2026-11-REVIEW-17.md'])
  })

  it('answers an empty list for no marker, none or a reference to another brief', () => {
    expect(briefFileList('No list here.')).toEqual([])
    expect(briefFileList('Files: none.')).toEqual([])
    expect(briefFileList('Files: as R3.')).toEqual([])
    expect(briefFileList('')).toEqual([])
  })

  it('reads only up to the end of the paragraph that holds the Files: marker', () => {
    const text = [
      'Files: src/allowed.js.',
      '',
      'Read docs/setup.md and private/config.json for context.',
    ].join('\n')
    expect(briefFileList(text)).toEqual(['src/allowed.js'])
  })

  it('reads the real P116, P121, P124 and P132 briefs from TASKS.md', () => {
    expect(briefFileList(byId('P116').text)).toEqual([])
    expect(briefFileList(byId('P121').text)).toEqual([
      'src/briefs/briefs.js',
      'scripts/mr-agent.mjs',
      'tests/briefs.test.js',
      'tests/mr-agent.test.js',
      'docs/agents/CHANGELOG.md',
    ])
    expect(briefFileList(byId('P124').text)).toEqual([
      'server/orchestrator.js',
      'tests/orchestrator.test.js',
      'docs/agents/CHANGELOG.md',
    ])
    expect(briefFileList(byId('P132').text)).toEqual([
      'server/orchestrator.js',
      'tests/orchestrator.test.js',
      'docs/agents/CHANGELOG.md',
    ])
  })

  it('ignores Files: markers inside code spans and fences and keeps only the real paragraph', () => {
    expect(briefFileList('Check the `Files: src/ignored.js` and ``Files: src/ignored2.js`` mention.')).toEqual([])
    expect(briefFileList('Check ```Files: src/a.js``` and ````Files: src/b.js```` and `` `Files: src/c.js` ``.')).toEqual([])
    expect(briefFileList('```\nFiles: src/a.js\n```')).toEqual([])
    expect(briefFileList("Check the brief's 'Files:' note. Files: src/real.js.")).toEqual(['src/real.js'])

    const codeAfter = [
      "Read the owner's and agents' notes. Files: src/real.js, tests/real.test.js.",
      '',
      '1. Keep the `Files:` marker and `Files: src/a.js` out of the result.',
      '2. Also ignore `` `Files: src/b.js` `` and ```Files: src/c.js```.',
      '',
      '```',
      'Files: src/d.js',
      '```',
    ].join('\n')
    expect(briefFileList(codeAfter)).toEqual(['src/real.js', 'tests/real.test.js'])

    const twoParagraphCode = [
      'Files: src/allowed.js.',
      '',
      'Read docs/setup.md and quote `Files:` or `Files: private/config.json` for context.',
    ].join('\n')
    expect(briefFileList(twoParagraphCode)).toEqual(['src/allowed.js'])
  })

  it('masks fenced blocks of three or more backticks or tildes until a matching closing fence', () => {
    const fourBacktick = [
      'Files: src/real.js.',
      '',
      '````markdown',
      '```',
      'Files: src/fake.js',
      '```',
      '````',
    ].join('\n')
    expect(briefFileList(fourBacktick)).toEqual(['src/real.js'])

    const plainFourBacktick = [
      'Files: src/real.js.',
      '',
      '````',
      '```',
      'Files: src/fake.js',
      '```',
      '````',
    ].join('\n')
    expect(briefFileList(plainFourBacktick)).toEqual(['src/real.js'])

    const tildeFence = [
      'Files: src/real.js.',
      '',
      '~~~',
      'Files: src/fake.js',
      '~~~',
    ].join('\n')
    expect(briefFileList(tildeFence)).toEqual(['src/real.js'])

    const nestedTildeFence = [
      'Files: src/real.js.',
      '',
      '~~~~markdown',
      '~~~',
      'Files: src/fake.js',
      '~~~',
      '```',
      'Files: src/also-fake.js',
      '```',
      '~~~~',
    ].join('\n')
    expect(briefFileList(nestedTildeFence)).toEqual(['src/real.js'])

    const longerClosingFence = [
      'Files: src/real.js.',
      '',
      '```',
      'Files: src/fake.js',
      '~~~',
      '```js',
      '````',
    ].join('\n')
    expect(briefFileList(longerClosingFence)).toEqual(['src/real.js'])

    expect(briefFileList('```Files: src/fake.js```\nFiles: src/real.js.')).toEqual(['src/real.js'])
    expect(briefFileList('```\nunclosed\n\nFiles: src/real.js.')).toEqual(['src/real.js'])
    expect(briefFileList('Keep `unclosed.\n\nFiles: src/real.js.')).toEqual(['src/real.js'])
  })

  it('does not let prose apostrophes or quotes hide a real Files: marker', () => {
    expect(briefFileList("Keep 'em small. Files: src/real.js. Read the agents' notes.")).toEqual(['src/real.js'])
    expect(briefFileList("Read René's note. Files: src/real.js. Keep the agents' guide.")).toEqual(['src/real.js'])
    expect(briefFileList('Say "keep \'em" and \'check\' here. Files: src/real.js. Read René\'s notes.')).toEqual(['src/real.js'])
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
    expect(modelFor(mapped, 'C3b')).toBe(lanes.agy.model)
    expect(modelFor(lanes.agy, 'C3e')).toBe(lanes.agy.model)
    expect(modelFor(lanes.hermes, 'P5')).toBe(lanes.hermes.model)
  })
})

describe('lanes', () => {
  it('have every field a prompt needs', () => {
    const promptLanes = Object.entries(lanes).filter(([key]) => key !== 'orchestrator')
    for (const [key, lane] of promptLanes) {
      for (const field of ['name', 'harness', 'model', 'worktree', 'role']) expect(typeof lane[field], `${key} ${field}`).toBe('string')
      expect(Array.isArray(lane.forbidden), key).toBe(true)
      expect(lane.worktree, key).toMatch(/^C:\\GitHub\\MachineRoom\\\.worktrees\\/)
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
    expect(prompt).toContain('Your worktree is C:\\GitHub\\MachineRoom\\.worktrees\\opencode. Run: git switch -c feat/u4-reject-a-foreign refs/heads/main')
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

  it('tells the lane how deep subagents may spawn, from the saved limit', () => {
    const prompt = make(['U4'], 'opencode')
    expect(prompt).toContain('Spawn subagents at most 2 levels deep. A subagent at depth 2 spawns none.')
    const deeper = buildPrompt({
      briefs: [byId('U4')],
      laneKey: 'opencode',
      lanes,
      rules,
      version: '0.1.35',
      agentDepth: 4,
    })
    expect(deeper).toContain('Spawn subagents at most 4 levels deep. A subagent at depth 4 spawns none.')
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
    expect(prompt).toContain(`Task C3b: Change notices in the panels (select ${lanes.agy.model} for this task).`)
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
      const namesUndefined = `${brief.title}\n${brief.text}`.includes('undefined')
      if (!namesUndefined) expect(prompt, brief.id).not.toContain('undefined')
      expect(prompt, brief.id).toContain(`Task ${brief.id}:`)
      expect(prompt.length, brief.id).toBeLessThan(12000)
    }
  })
})
