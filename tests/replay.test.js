import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_FIXTURE, describeRecording, filterRecordings, loadRecordingIndex, loadReplay, parseRecordingIndex, replayFiles } from '../src/model/replay.js'

const READ_FAILED = 'The list of recordings could not be read.'
const DEFAULT_FILES = {
  run: 'fixtures/scenario-i-run.jsonl',
  agents: 'fixtures/scenario-i-agents.json',
  tree: 'fixtures/scenario-i-tree.json',
}
const SANDBOX_FILES = {
  run: 'fixtures/sandbox-run.jsonl',
  agents: 'fixtures/agents.json',
  tree: 'fixtures/sandbox-tree.json',
}

function entry(name, extra = {}) {
  return {
    name,
    lane: 'hermes',
    briefs: ['T12'],
    model: 'deepseek/deepseek-v4.1-flash-1017',
    start: '2026-10-20T06:00:00.000Z',
    minutes: 4,
    exitCode: 0,
    frames: 12,
    toolCalls: 7,
    ...extra,
  }
}

function answer(body, status = 200) {
  return async () => ({ ok: status >= 200 && status < 300, status, json: async () => body })
}

function refused(status) {
  return async () => ({ ok: false, status, json: async () => ({}) })
}

describe('parseRecordingIndex', () => {
  it('keeps the nine known keys and nothing else', () => {
    const parsed = parseRecordingIndex([entry('run-1', { log: 'C:/private/run.log', costUsd: 0.04 })])
    expect(parsed).toEqual([entry('run-1')])
    expect(Object.keys(parsed[0])).toEqual([
      'name',
      'lane',
      'briefs',
      'model',
      'start',
      'minutes',
      'exitCode',
      'frames',
      'toolCalls',
    ])
  })

  it('drops junk entries and names that are not plain file names', () => {
    const parsed = parseRecordingIndex([
      null,
      'run-1',
      42,
      [],
      { name: '../x' },
      { name: 'a/b' },
      { name: '.hidden' },
      { name: 7 },
      { lane: 'hermes' },
      entry('run-2'),
    ])
    expect(parsed.map((item) => item.name)).toEqual(['run-2'])
  })

  it('keeps a repeated name once, the first one', () => {
    const parsed = parseRecordingIndex([entry('run-1', { lane: 'first' }), entry('run-1', { lane: 'second' })])
    expect(parsed).toHaveLength(1)
    expect(parsed[0].lane).toBe('first')
  })

  it('cuts the list at 50 in the order given', () => {
    const raw = Array.from({ length: 60 }, (_, index) => entry(`run-${index}`))
    const parsed = parseRecordingIndex(raw)
    expect(parsed).toHaveLength(50)
    expect(parsed[0].name).toBe('run-0')
    expect(parsed[49].name).toBe('run-49')
  })

  it('cleans values of the wrong type', () => {
    const parsed = parseRecordingIndex([
      {
        name: 'run-1',
        lane: 5,
        briefs: ['T1', 3, null, 'T2'],
        model: { id: 'x' },
        start: null,
        minutes: '4',
        exitCode: 0,
        frames: Number.POSITIVE_INFINITY,
        toolCalls: Number.NaN,
      },
    ])
    expect(parsed).toEqual([
      {
        name: 'run-1',
        lane: '',
        briefs: ['T1', 'T2'],
        model: '',
        start: '',
        minutes: null,
        exitCode: 0,
        frames: null,
        toolCalls: null,
      },
    ])
  })

  it('gives an empty list for anything that is not an array', () => {
    for (const raw of [null, undefined, {}, 'run-1', 42, true]) {
      expect(parseRecordingIndex(raw)).toEqual([])
    }
  })
})

describe('describeRecording', () => {
  function localStamp(date) {
    const pad = (value) => String(value).padStart(2, '0')
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
  }

  it('names the entry and joins the lane and the briefs in the title', () => {
    expect(describeRecording(entry('run-1', { lane: 'hermes', briefs: ['T13'] }))).toMatchObject({
      name: 'run-1',
      title: 'hermes T13',
    })
    expect(describeRecording(entry('run-1', { lane: 'hermes', briefs: ['T13', 'T14'] })).title).toBe('hermes T13 T14')
  })

  it('gives the lane alone when there are no briefs', () => {
    expect(describeRecording(entry('run-1', { lane: 'opencode', briefs: [] })).title).toBe('opencode')
  })

  it('gives run when the lane is empty', () => {
    expect(describeRecording(entry('run-1', { lane: '', briefs: [] })).title).toBe('run')
    expect(describeRecording(entry('run-1', { lane: '', briefs: ['T13'] })).title).toBe('run')
  })

  it('rounds the minutes and counts the tool calls', () => {
    expect(describeRecording(entry('run-1', { minutes: 8, toolCalls: 42, exitCode: 0 })).detail).toBe(
      '8 min, 42 tool calls, finished',
    )
    expect(describeRecording(entry('run-1', { minutes: 8.4, toolCalls: 42, exitCode: null })).detail).toBe(
      '8 min, 42 tool calls',
    )
    expect(describeRecording(entry('run-1', { minutes: 7.6, toolCalls: null, exitCode: null })).detail).toBe('8 min')
  })

  it('writes one tool call in the singular', () => {
    expect(describeRecording(entry('run-1', { minutes: null, toolCalls: 1, exitCode: null })).detail).toBe('1 tool call')
    expect(describeRecording(entry('run-1', { minutes: null, toolCalls: 0, exitCode: null })).detail).toBe(
      '0 tool calls',
    )
  })

  it('writes under 1 min below one minute', () => {
    expect(describeRecording(entry('run-1', { minutes: 0.4, toolCalls: 3, exitCode: null })).detail).toBe(
      'under 1 min, 3 tool calls',
    )
    expect(describeRecording(entry('run-1', { minutes: 0, toolCalls: null, exitCode: null })).detail).toBe(
      'under 1 min',
    )
  })

  it('writes failed for an exit code that is not zero', () => {
    expect(describeRecording(entry('run-1', { minutes: 3, toolCalls: 5, exitCode: 1 })).detail).toBe(
      '3 min, 5 tool calls, failed',
    )
    expect(describeRecording(entry('run-1', { minutes: null, toolCalls: null, exitCode: 130 })).detail).toBe('failed')
  })

  it('leaves out the numbers it does not have', () => {
    expect(describeRecording(entry('run-1', { minutes: null, toolCalls: 4, exitCode: 0 })).detail).toBe(
      '4 tool calls, finished',
    )
    expect(describeRecording(entry('run-1', { minutes: 2, toolCalls: null, exitCode: 0 })).detail).toBe('2 min, finished')
    expect(describeRecording(entry('run-1', { minutes: 2, toolCalls: 4, exitCode: null })).detail).toBe(
      '2 min, 4 tool calls',
    )
    expect(describeRecording(entry('run-1', { minutes: null, toolCalls: null, exitCode: null })).detail).toBe('')
  })

  it('shows the start in the local time', () => {
    const start = new Date(2026, 9, 20, 14, 5).toISOString()
    expect(describeRecording(entry('run-1', { start })).when).toBe(localStamp(new Date(start)))
  })

  it('shows a start with an offset in the local time', () => {
    for (const start of ['2026-10-20T23:30:00.000Z', '2026-10-20T06:00:00+08:00']) {
      expect(describeRecording(entry('run-1', { start })).when).toBe(localStamp(new Date(start)))
    }
  })

  it('gives an empty when for a start that is not a time', () => {
    for (const start of ['', 'not a time', '2026-13-45', 'yesterday']) {
      expect(describeRecording(entry('run-1', { start })).when).toBe('')
    }
    expect(describeRecording(entry('run-1', { start: null })).when).toBe('')
  })

  it('takes junk for an entry', () => {
    expect(describeRecording(null)).toEqual({ name: '', title: 'run', detail: '', when: '' })
  })
})

describe('filterRecordings', () => {
  const runs = [
    entry('hermes-1', { lane: 'hermes', briefs: ['T13'], model: 'deepseek/deepseek-v4.1-flash-1017' }),
    entry('opencode-1', { lane: 'opencode', briefs: ['T12'], model: 'opencode-go/mimo-v2.6-pro' }),
    entry('agy-1', { lane: 'agy', briefs: ['V5b'], model: 'gemini-3.8-flash' }),
    entry('hermes-2', { lane: 'hermes', briefs: ['T14', 'G3b'], model: 'deepseek/deepseek-v4.1-flash-1017' }),
  ]

  function names(entries) {
    return entries.map((item) => item.name)
  }

  it('keeps the order and every entry with no filter', () => {
    expect(names(filterRecordings(runs))).toEqual(['hermes-1', 'opencode-1', 'agy-1', 'hermes-2'])
    expect(names(filterRecordings(runs, {}))).toEqual(['hermes-1', 'opencode-1', 'agy-1', 'hermes-2'])
  })

  it('keeps one lane', () => {
    expect(names(filterRecordings(runs, { lane: 'hermes' }))).toEqual(['hermes-1', 'hermes-2'])
    expect(names(filterRecordings(runs, { lane: 'claude' }))).toEqual([])
  })

  it('matches the text in the name, the lane, a brief and the model', () => {
    expect(names(filterRecordings(runs, { text: 'agy-1' }))).toEqual(['agy-1'])
    expect(names(filterRecordings(runs, { text: 'opencode' }))).toEqual(['opencode-1'])
    expect(names(filterRecordings(runs, { text: 'V5b' }))).toEqual(['agy-1'])
    expect(names(filterRecordings(runs, { text: 'mimo' }))).toEqual(['opencode-1'])
  })

  it('ignores case and the space around the text', () => {
    expect(names(filterRecordings(runs, { text: 'HERMES' }))).toEqual(['hermes-1', 'hermes-2'])
    expect(names(filterRecordings(runs, { text: '  deepseek  ' }))).toEqual(['hermes-1', 'hermes-2'])
  })

  it('keeps every entry for a blank text', () => {
    expect(names(filterRecordings(runs, { text: '' }))).toHaveLength(4)
    expect(names(filterRecordings(runs, { text: '   ' }))).toHaveLength(4)
  })

  it('applies the lane and the text together', () => {
    expect(names(filterRecordings(runs, { lane: 'hermes', text: 'T14' }))).toEqual(['hermes-2'])
    expect(names(filterRecordings(runs, { lane: 'hermes', text: 'V5b' }))).toEqual([])
  })

  it('gives an empty list for junk', () => {
    for (const entries of [null, undefined, 'hermes-1', 42, {}, true]) {
      expect(filterRecordings(entries, { text: 'hermes' })).toEqual([])
    }
  })

  it('skips junk entries and takes junk options', () => {
    const mixed = [null, 'run', 7, [], runs[0], { name: 'no-lane' }]
    expect(names(filterRecordings(mixed))).toEqual(['hermes-1', 'no-lane'])
    expect(names(filterRecordings(runs, null))).toHaveLength(4)
  })
})

describe('loadRecordingIndex', () => {
  it('reads the index under the base it is given', async () => {
    const asked = []
    const fetchImpl = async (url) => {
      asked.push(url)
      return answer([entry('run-1')])()
    }
    const parsed = await loadRecordingIndex({ base: '/app/', fetchImpl })
    expect(asked).toEqual(['/app/recordings/index.json'])
    expect(parsed).toEqual([entry('run-1')])
  })

  it('gives an empty list when the file is missing', async () => {
    expect(await loadRecordingIndex({ base: '/', fetchImpl: refused(404) })).toEqual([])
  })

  it('gives an empty list when a dev server answers the missing file with its page', async () => {
    const fetchImpl = async () => ({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'text/html' }),
      json: async () => {
        throw new SyntaxError('Unexpected token <')
      },
    })
    expect(await loadRecordingIndex({ base: '/', fetchImpl })).toEqual([])
  })

  it('throws a plain sentence on another failed answer', async () => {
    await expect(loadRecordingIndex({ base: '/', fetchImpl: refused(500) })).rejects.toThrow(READ_FAILED)
  })

  it('throws a plain sentence when the body is not JSON', async () => {
    const fetchImpl = async () => ({
      ok: true,
      status: 200,
      json: async () => {
        throw new SyntaxError('Unexpected token')
      },
    })
    await expect(loadRecordingIndex({ base: '/', fetchImpl })).rejects.toThrow(READ_FAILED)
  })

  it('throws a plain sentence when the fetch itself fails', async () => {
    const fetchImpl = async () => {
      throw new Error('refused')
    }
    await expect(loadRecordingIndex({ base: '/', fetchImpl })).rejects.toThrow(READ_FAILED)
  })
})

describe('replayFiles', () => {
  it('names the default scenario-i fixture with no recording', () => {
    expect(DEFAULT_FIXTURE).toBe('scenario-i')
    expect(replayFiles()).toEqual(DEFAULT_FILES)
    expect(replayFiles(null)).toEqual(DEFAULT_FILES)
    expect(replayFiles(null, null)).toEqual(DEFAULT_FILES)
  })

  it('names the three files of a recording', () => {
    expect(replayFiles('hermes-20261020-060000')).toEqual({
      run: 'recordings/hermes-20261020-060000-run.jsonl',
      agents: 'recordings/hermes-20261020-060000-agents.json',
      tree: 'recordings/hermes-20261020-060000-tree.json',
    })
  })

  it('names the three files of a fixture', () => {
    expect(replayFiles(null, 'scenario-e')).toEqual({
      run: 'fixtures/scenario-e-run.jsonl',
      agents: 'fixtures/scenario-e-agents.json',
      tree: 'fixtures/scenario-e-tree.json',
    })
  })

  it('keeps the sandbox run reachable by its name', () => {
    expect(replayFiles(null, 'sandbox')).toEqual(SANDBOX_FILES)
  })

  it('falls back to the default fixture for a fixture name that is not allowed', () => {
    for (const name of ['scenario-', 'scenario-ee', 'scenario-E', 'scenario-1', '../scenario-e', 'scenario-e/../x', '']) {
      expect(replayFiles(null, name)).toEqual(DEFAULT_FILES)
    }
  })

  it('keeps a recording ahead of a fixture name', () => {
    expect(replayFiles('hermes-20261020-060000', 'scenario-e')).toEqual(replayFiles('hermes-20261020-060000'))
    expect(replayFiles('hermes-20261020-060000', 'sandbox')).toEqual(replayFiles('hermes-20261020-060000'))
  })
})

describe('loadReplay', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  function answer() {
    return async (url) => ({
      ok: true,
      status: 200,
      text: async () => '',
      json: async () => (String(url).endsWith('agents.json') ? { agents: [] } : { root: 'agent-sandbox', files: [], created: [] }),
    })
  }

  it('names the fixture it played so the room can set the demo ladder', async () => {
    vi.stubGlobal('fetch', answer())
    expect((await loadReplay({ base: '/' })).fixture).toBe(DEFAULT_FIXTURE)
    expect((await loadReplay({ base: '/', fixture: 'scenario-e' })).fixture).toBe('scenario-e')
    expect((await loadReplay({ base: '/', fixture: 'sandbox' })).fixture).toBe('sandbox')
  })

  it('names no fixture for a recording', async () => {
    vi.stubGlobal('fetch', answer())
    expect((await loadReplay({ base: '/', recording: 'hermes-20261020-060000' })).fixture).toBeUndefined()
  })

  it('names the fixture it could not load', async () => {
    vi.stubGlobal('fetch', async () => ({ ok: false, status: 404 }))
    await expect(loadReplay({ base: '/' })).rejects.toThrow('The fixture scenario-i could not be loaded.')
    await expect(loadReplay({ base: '/', fixture: 'sandbox' })).rejects.toThrow('The fixture sandbox could not be loaded.')
  })
})
