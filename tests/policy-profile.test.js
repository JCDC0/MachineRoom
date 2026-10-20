import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parseBriefs } from '../src/briefs/briefs.js'
import { profileFromBrief } from '../src/policy/profile.js'
import { tierFor } from '../src/policy/route.js'

const TASKS_TEXT = readFileSync(new URL('../docs/agents/TASKS.md', import.meta.url), 'utf8')
const REAL_BRIEFS = parseBriefs(TASKS_TEXT)

const EMPTY = {
  files: 0,
  hasTests: false,
  newTest: false,
  clarity: 'unclear',
  reversible: true,
  touchesSecrets: false,
  touchesDeploy: false,
  touchesData: false,
  kind: 'change',
}

const briefFor = (text, owner = 'Hermes') => parseBriefs(`**X1. A made up task (${owner}).** ${text}`)[0]
const read = (text, owner) => profileFromBrief(briefFor(text, owner))

const real = (id) => {
  const brief = REAL_BRIEFS.find((entry) => entry.id === id)
  expect(brief, `the real brief ${id} is in TASKS.md`).toBeTruthy()
  return brief
}

describe('profileFromBrief', () => {
  it('counts the files after Files: and leaves out the changelog and the tests', () => {
    const text = 'Files: `src/a.js`, `src/b.js`, `tests/a.test.js`, `docs/agents/CHANGELOG.md`. Tests in `tests/a.test.js`.'
    expect(read(text).files).toBe(2)
  })

  it('counts a path once when the list names it twice', () => {
    expect(read('Files: `src/a.js`, `src/a.js`. Tests in `tests/a.test.js`.').files).toBe(1)
  })

  it('counts only the paths after Files:', () => {
    expect(read('The old file `src/old.js` goes. Files: `src/new.js`. Tests in `tests/new.test.js`.').files).toBe(1)
  })

  it('counts nothing when the text has no Files: list', () => {
    expect(read('Change `src/a.js` and run `tests/a.test.js`.').files).toBe(0)
  })

  it('counts nothing when the list holds only the changelog and the tests', () => {
    expect(read('Files: `tests/a.test.js`, `docs/agents/CHANGELOG.md`. Tests in `tests/a.test.js`.').files).toBe(0)
  })

  it('finds a test when the text says Tests in', () => {
    expect(read('Files: `src/a.js`. Tests in `tests/a.test.js`.').hasTests).toBe(true)
  })

  it('finds a test when the text names a test file', () => {
    expect(read('Files: `src/a.js`. Run `tests/commands.test.js` again.').hasTests).toBe(true)
  })

  it('finds no test when the text names none', () => {
    expect(read('Files: `src/a.js`. Run the tests by hand.').hasTests).toBe(false)
  })

  it('marks a new test only when a new comes right before a tests path', () => {
    expect(read('Files: `src/a.js`. Tests in a new `tests/b.test.js`.').newTest).toBe(true)
    expect(read('Files: `src/a.js`. Tests in `tests/b.test.js`.').newTest).toBe(false)
    expect(read('Files: `src/a.js`. A new line goes in the file.').newTest).toBe(false)
  })

  it('calls a brief with a file list and a test clear', () => {
    expect(read('Files: `src/a.js`. Tests in `tests/a.test.js`.').clarity).toBe('clear')
  })

  it('calls a brief with no file list unclear', () => {
    expect(read('Change `src/a.js` and run `tests/a.test.js`.').clarity).toBe('unclear')
  })

  it('calls a brief that names no test unclear', () => {
    expect(read('Files: `src/a.js`. Run the tests by hand.').clarity).toBe('unclear')
  })

  it('reads the three phrases that make a brief hard to undo', () => {
    expect(read("Files: `src/a.js`. This needs the owner's yes.").reversible).toBe(false)
    expect(read('Files: `src/a.js`. It writes to Paperclip.').reversible).toBe(false)
    expect(read('Files: `src/a.js`. This spends money.').reversible).toBe(false)
  })

  it('keeps a brief that only edits files reversible', () => {
    expect(read('Files: `src/a.js`. It changes one file and nothing else.').reversible).toBe(true)
  })

  it('reads each path that touches secrets', () => {
    for (const path of ['server/index.js', 'src/assistant/intent.js', 'src/assistant/actions.js', '.env.example']) {
      expect(read(`Files: \`${path}\`. Tests in \`tests/a.test.js\`.`).touchesSecrets, path).toBe(true)
    }
    expect(read('Files: `src/policy/profile.js`. Tests in `tests/a.test.js`.').touchesSecrets).toBe(false)
  })

  it('reads each path that touches deployment', () => {
    for (const path of ['package.json', '.gitignore', '.github/workflows/ci.yml']) {
      expect(read(`Files: \`${path}\`. Tests in \`tests/a.test.js\`.`).touchesDeploy, path).toBe(true)
    }
    expect(read('Files: `src/policy/route.js`. Tests in `tests/a.test.js`.').touchesDeploy).toBe(false)
  })

  it('reads each folder that holds recorded data', () => {
    for (const path of ['public/fixtures/run.jsonl', 'public/recordings/index.json']) {
      expect(read(`Files: \`${path}\`. Tests in \`tests/a.test.js\`.`).touchesData, path).toBe(true)
    }
    expect(read('Files: `src/model/replay.js`. Tests in `tests/a.test.js`.').touchesData).toBe(false)
  })

  it('reads a path named outside the file list too', () => {
    const text = 'Files: `src/a.js`. The route lives in `server/index.js`. Tests in `tests/a.test.js`.'
    expect(read(text).touchesSecrets).toBe(true)
  })

  it('calls AGY work checked by eye design', () => {
    expect(read('Files: `src/ui/Hud.jsx`. Check by eye at 1280 by 800.', 'AGY').kind).toBe('design')
  })

  it('keeps AGY work that is not checked by eye a change', () => {
    expect(read('Files: `src/ui/Hud.jsx`. Change the label.', 'AGY').kind).toBe('change')
  })

  it('keeps another owner checked by eye a change', () => {
    expect(read('Files: `src/a.js`. Check by eye at 1280 by 800.', 'Hermes').kind).toBe('change')
  })

  it('takes junk as an unclear change with nothing in it', () => {
    expect(profileFromBrief(null)).toEqual(EMPTY)
    expect(profileFromBrief({})).toEqual(EMPTY)
    expect(profileFromBrief({ text: null, owners: null })).toEqual(EMPTY)
  })

  it('gives the same answer for the same brief', () => {
    const brief = real('C6b')
    expect(profileFromBrief(brief)).toEqual(profileFromBrief(brief))
  })
})

describe('the real briefs', () => {
  it('reads C6b as a medium change over five files', () => {
    const profile = profileFromBrief(real('C6b'))
    expect(profile.files).toBe(5)
    expect(profile.hasTests).toBe(true)
    expect(profile.clarity).toBe('clear')
    expect(tierFor(profile)).toBe('medium')
  })

  it('reads M1a as AGY design work checked by eye', () => {
    const profile = profileFromBrief(real('M1a'))
    expect(profile.kind).toBe('design')
    expect(profile.newTest).toBe(true)
    expect(tierFor(profile)).toBe('large')
  })

  it('reads U4 as an unclear brief with no file list', () => {
    const profile = profileFromBrief(real('U4'))
    expect(profile.files).toBe(0)
    expect(profile.clarity).toBe('unclear')
    expect(tierFor(profile)).toBe('large')
  })

  it('reads C6a as a change that touches deployment', () => {
    const profile = profileFromBrief(real('C6a'))
    expect(profile.touchesDeploy).toBe(true)
    expect(tierFor(profile)).toBe('large')
  })
})
