import { describe, expect, it } from 'vitest'
import { loadRecordingIndex, parseRecordingIndex, replayFiles } from '../src/model/replay.js'

const READ_FAILED = 'The list of recordings could not be read.'

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
  it('names the sandbox fixtures with no recording', () => {
    expect(replayFiles()).toEqual({
      run: 'fixtures/sandbox-run.jsonl',
      agents: 'fixtures/agents.json',
      tree: 'fixtures/sandbox-tree.json',
    })
    expect(replayFiles(null)).toEqual(replayFiles())
  })

  it('names the three files of a recording', () => {
    expect(replayFiles('hermes-20261020-060000')).toEqual({
      run: 'recordings/hermes-20261020-060000-run.jsonl',
      agents: 'recordings/hermes-20261020-060000-agents.json',
      tree: 'recordings/hermes-20261020-060000-tree.json',
    })
  })
})
