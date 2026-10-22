import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { KEY_LONGEST, SPLIT_HOLD_MS, createSplitMasker, maskKeys, openKeyStart } from '../src/briefs/audit.js'
import { buildActivities } from '../src/model/pipeline.js'
import { parseFrames, prepare } from '../src/model/source.js'

const PUBLIC = join(dirname(fileURLToPath(import.meta.url)), '..', 'public')

const SK = 'sk-' + 'q'.repeat(40)
const GITHUB = 'ghp_' + 'Zq7'.repeat(12)
const SETTING_VALUE = 'r8Tq' + '5'.repeat(20)
const SETTING = 'OPENROUTER_API_KEY=' + SETTING_VALUE

function seeded(seed) {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function log(id, chunk, { runId = 'r1', stream = 'stdout', seq = id } = {}) {
  return { id, companyId: 'comp-1', type: 'heartbeat.run.log', createdAt: '2026-10-22T10:00:00.000Z', payload: { runId, agentId: 'a1', seq, stream, chunk, truncated: false } }
}

function status(id, runId, value) {
  return { id, companyId: 'comp-1', type: 'heartbeat.run.status', createdAt: '2026-10-22T10:00:00.000Z', payload: { runId, status: value } }
}

function run(frames, { now = () => 0, flush = true } = {}) {
  const masker = createSplitMasker()
  const out = []
  let count = 0
  for (const frame of frames) {
    const result = masker.push(frame, now(frame))
    out.push(...result.frames)
    count += result.count
  }
  if (flush) {
    const rest = masker.flush()
    out.push(...rest.frames)
    count += rest.count
  }
  return { frames: out, count, masker }
}

function joined(frames, runId = 'r1', stream = 'stdout') {
  return frames
    .filter((frame) => frame.type === 'heartbeat.run.log' && frame.payload.runId === runId && frame.payload.stream === stream)
    .map((frame) => frame.payload.chunk)
    .join('')
}

function chunks(frames) {
  return frames.map((frame) => frame.payload.chunk)
}

describe('the open tail test', () => {
  it('finds a tail that could still grow into a key', () => {
    for (const tail of ['s', 'sk', 'sk-', 'sk-or-v1-abc', 'gh', 'ghp_', 'ghp_abc', 'github_p', 'AKIA', 'AKIA1234', 'AIza', 'OPENROUTER_API', 'OPENAI_API_KEY', 'ANTHROPIC_API_KEY=', 'OPENAI_API_KEY: "abc', 'run-ghp_ab']) {
      expect(openKeyStart(`text ${tail}`), tail).not.toBe(-1)
    }
  })

  it('finds no open tail where no key can start', () => {
    for (const tail of ['', 'done', 'done ', 'sk-abc ', 'task-sk-abc', 'x_ghp_ab', 'AKIA' + '1234567890ABCDEF1', 'AKIAb', 'path/to/file.js', 'value\n', '42']) {
      expect(openKeyStart(tail), tail).toBe(-1)
    }
  })

  it('points at the start of the open key', () => {
    expect(openKeyStart('read sk-abc')).toBe(5)
    expect(openKeyStart('x OPENROUTER_API_KEY' + ' = ab')).toBe(2)
  })
})

describe('a key split across chunks', () => {
  for (const [name, key, line] of [
    ['an sk- key', SK, `reading ${SK} now`],
    ['a GitHub token', GITHUB, `token ${GITHUB} now`],
    ['a key setting value', SETTING, `export ${SETTING} now`],
  ]) {
    it(`masks ${name} cut at every position`, () => {
      const text = `${line}\n`
      const whole = maskKeys(text)
      expect(whole.count).toBe(1)
      const start = text.indexOf(key)
      for (let at = start; at <= start + key.length; at += 1) {
        const out = run([log(1, text.slice(0, at)), log(2, text.slice(at))])
        expect(out.frames.map((frame) => frame.id), `cut ${at}`).toEqual([1, 2])
        expect(joined(out.frames), `cut ${at}`).toBe(whole.text)
        expect(out.count, `cut ${at}`).toBe(1)
        expect(JSON.stringify(out.frames)).not.toContain(key.slice(-20))
      }
    })
  }

  it('puts the mark in the frame where the key starts and drops the rest from the next frame', () => {
    const out = run([log(1, `read ${SK.slice(0, 10)}`), log(2, `${SK.slice(10)} ok\n`)])
    expect(chunks(out.frames)).toEqual(['read [key]', ' ok\n'])
  })

  it('masks a key split across three chunks', () => {
    const out = run([log(1, `a ${SK.slice(0, 5)}`), log(2, SK.slice(5, 30)), log(3, `${SK.slice(30)} b\n`)])
    expect(chunks(out.frames)).toEqual(['a [key]', '', ' b\n'])
    expect(out.count).toBe(1)
  })

  it('keeps two interleaved runs apart', () => {
    const frames = [
      log(1, `one ${SK.slice(0, 8)}`, { runId: 'r1' }),
      log(2, `two ${GITHUB.slice(0, 8)}`, { runId: 'r2' }),
      log(3, `${SK.slice(8)}\n`, { runId: 'r1' }),
      log(4, `${GITHUB.slice(8)}\n`, { runId: 'r2' }),
    ]
    const out = run(frames)
    expect(out.frames.map((frame) => frame.id)).toEqual([1, 2, 3, 4])
    expect(joined(out.frames, 'r1')).toBe('one [key]\n')
    expect(joined(out.frames, 'r2')).toBe('two [key]\n')
    expect(out.count).toBe(2)
  })

  it('keeps stdout and stderr apart', () => {
    const frames = [
      log(1, `out ${SK.slice(0, 8)}`, { stream: 'stdout' }),
      log(2, 'err line\n', { stream: 'stderr' }),
      log(3, `${SK.slice(8)}\n`, { stream: 'stdout' }),
    ]
    const out = run(frames)
    expect(out.frames.map((frame) => frame.id)).toEqual([1, 2, 3])
    expect(joined(out.frames, 'r1', 'stdout')).toBe('out [key]\n')
    expect(joined(out.frames, 'r1', 'stderr')).toBe('err line\n')
  })

  it('releases a tail that turns out not to be a key unchanged', () => {
    const out = run([log(1, 'see sk-ab'), log(2, 'c is short\n')], { flush: false })
    expect(chunks(out.frames)).toEqual(['see sk-ab', 'c is short\n'])
    expect(out.count).toBe(0)
  })

  it('holds no frame whose tail cannot start a key', () => {
    const masker = createSplitMasker()
    expect(masker.push(log(1, 'plain text'), 0).frames).toHaveLength(1)
    expect(masker.push(log(2, 'line\n'), 0).frames).toHaveLength(1)
    expect(masker.push(status(3, 'r1', 'running'), 0).frames).toHaveLength(1)
    expect(masker.nextDue()).toBeNull()
  })

  it('holds later frames behind a held one so the order stays', () => {
    const masker = createSplitMasker()
    expect(masker.push(log(1, 'key sk-'), 0).frames).toEqual([])
    expect(masker.push(status(2, 'r9', 'running'), 0).frames).toEqual([])
    expect(masker.holding()).toBe(1)
    const out = masker.push(log(3, 'done\n'), 0)
    expect(out.frames.map((frame) => frame.id)).toEqual([1, 2, 3])
  })

  it('releases a held frame after one second on a fake clock', () => {
    const masker = createSplitMasker()
    expect(masker.push(log(1, `key ${SK.slice(0, 6)}`), 1000).frames).toEqual([])
    expect(masker.nextDue()).toBe(1000 + SPLIT_HOLD_MS)
    expect(masker.due(1999).frames).toEqual([])
    const out = masker.due(2000)
    expect(chunks(out.frames)).toEqual([`key ${SK.slice(0, 6)}`])
    expect(masker.nextDue()).toBeNull()
    const next = masker.push(log(2, `${SK.slice(6)}\n`), 2100)
    expect(chunks(next.frames)).toEqual(['[key]\n'])
    expect(next.count).toBe(1)
  })

  it('masks a whole key that is still open when the second passes', () => {
    const masker = createSplitMasker()
    masker.push(log(1, `key ${SK}`), 0)
    const out = masker.due(SPLIT_HOLD_MS)
    expect(chunks(out.frames)).toEqual(['key [key]'])
    expect(out.count).toBe(1)
    const next = masker.push(log(2, 'qqq tail\n'), 1100)
    expect(chunks(next.frames)).toEqual([' tail\n'])
    expect(next.count).toBe(0)
  })

  it('releases at the run end before the status frame', () => {
    const masker = createSplitMasker()
    masker.push(log(1, `last ${SK}`), 0)
    const out = masker.push(status(2, 'r1', 'succeeded'), 0)
    expect(out.frames.map((frame) => frame.id)).toEqual([1, 2])
    expect(out.frames[0].payload.chunk).toBe('last [key]')
    expect(out.count).toBe(1)
    expect(masker.nextDue()).toBeNull()
  })

  it('releases once the open tail is longer than any key', () => {
    const masker = createSplitMasker()
    expect(masker.push(log(1, 'sk-' + 'a'.repeat(KEY_LONGEST - 3)), 0).frames).toEqual([])
    const out = masker.push(log(2, 'b'), 0)
    expect(out.frames.map((frame) => frame.id)).toEqual([1, 2])
    expect(chunks(out.frames)).toEqual(['[key]', ''])
  })

  it('keeps every field but the chunk and never changes the frame it was given', () => {
    const first = log(1, `x ${SK.slice(0, 9)}`)
    const second = { ...log(2, `${SK.slice(9)}\n`), extra: { kept: true } }
    const before = JSON.stringify([first, second])
    const out = run([first, second])
    expect(JSON.stringify([first, second])).toBe(before)
    expect({ ...out.frames[1], payload: { ...out.frames[1].payload, chunk: second.payload.chunk } }).toEqual(second)
    expect({ ...out.frames[0], payload: { ...out.frames[0].payload, chunk: first.payload.chunk } }).toEqual(first)
  })

  it('masks a key in the message and error of any frame and in a log frame with no run', () => {
    const out = run([
      { id: 1, type: 'activity.logged', payload: { message: `saw ${SK}` } },
      { id: 2, type: 'heartbeat.run.status', payload: { runId: 'r1', status: 'failed', error: `bad ${GITHUB}` } },
      { id: 3, type: 'heartbeat.run.log', payload: { chunk: `no run ${SK}` } },
    ])
    expect(out.frames.map((frame) => frame.payload.message ?? frame.payload.error ?? frame.payload.chunk)).toEqual(['saw [key]', 'bad [key]', 'no run [key]'])
    expect(out.count).toBe(3)
  })
})

function recordings() {
  const found = []
  for (const folder of ['fixtures', 'recordings']) {
    const dir = join(PUBLIC, folder)
    if (!existsSync(dir)) continue
    for (const name of readdirSync(dir).filter((file) => file.endsWith('-run.jsonl')).sort()) {
      const stem = name.slice(0, -'-run.jsonl'.length)
      const agentsName = folder === 'fixtures' && stem === 'sandbox' ? 'agents.json' : `${stem}-agents.json`
      const agentsPath = join(dir, agentsName)
      const treePath = join(dir, `${stem}-tree.json`)
      if (!existsSync(agentsPath) || !existsSync(treePath)) continue
      found.push({
        name: `${folder}/${name}`,
        frames: parseFrames(readFileSync(join(dir, name), 'utf8')),
        agentsFile: JSON.parse(readFileSync(agentsPath, 'utf8')),
        treeFile: JSON.parse(readFileSync(treePath, 'utf8')),
      })
    }
  }
  return found
}

function cutFrames(frames, random, keys = []) {
  const out = []
  const seqs = new Map()
  for (const frame of frames) {
    const payload = frame.payload
    if (frame.type !== 'heartbeat.run.log' || typeof payload?.chunk !== 'string' || typeof payload.runId !== 'string') {
      out.push({ ...frame, id: out.length + 1 })
      continue
    }
    let chunk = payload.chunk
    if (keys.length > 0 && random() < 0.3) {
      const at = Math.floor(random() * (chunk.length + 1))
      chunk = `${chunk.slice(0, at)} ${keys[Math.floor(random() * keys.length)]} ${chunk.slice(at)}`
    }
    const cuts = Array.from({ length: Math.floor(random() * 4) }, () => Math.floor(random() * (chunk.length + 1))).sort((a, b) => a - b)
    let from = 0
    for (const at of [...cuts, chunk.length]) {
      const seq = (seqs.get(payload.runId) ?? 0) + 1
      seqs.set(payload.runId, seq)
      out.push({ ...frame, id: out.length + 1, payload: { ...payload, seq, chunk: chunk.slice(from, at) } })
      from = at
    }
  }
  return out
}

function streamTexts(frames) {
  const texts = new Map()
  for (const frame of frames) {
    if (frame.type !== 'heartbeat.run.log' || typeof frame.payload?.runId !== 'string') continue
    const key = `${frame.payload.runId} ${frame.payload.stream ?? ''}`
    texts.set(key, (texts.get(key) ?? '') + frame.payload.chunk)
  }
  return texts
}

function withoutChunk(frame) {
  if (!frame.payload || typeof frame.payload !== 'object') return frame
  const { chunk, ...payload } = frame.payload
  return { ...frame, payload }
}

describe('every recording cut at seeded random points', () => {
  const found = recordings()

  it('finds the recordings', () => {
    expect(found.length).toBeGreaterThanOrEqual(5)
  })

  for (const recording of found) {
    it(`gives the same text and activities for ${recording.name}`, () => {
      const { agents, tree } = prepare({ frames: recording.frames, agentsFile: recording.agentsFile, treeFile: recording.treeFile })
      for (const seed of [1, 2, 3]) {
        const random = seeded(seed * 7919)
        const cut = cutFrames(recording.frames, random)
        const out = run(cut, { now: () => 0 })
        expect(out.frames.map((frame) => frame.id)).toEqual(cut.map((frame) => frame.id))
        expect(out.frames.map(withoutChunk)).toEqual(cut.map(withoutChunk))
        for (const [stream, text] of streamTexts(cut)) {
          expect(streamTexts(out.frames).get(stream), stream).toBe(maskKeys(text).text)
        }
        expect(buildActivities(out.frames, { agents, tree })).toEqual(buildActivities(cut, { agents, tree }))
      }
    })

    it(`masks every key put into ${recording.name} at seeded points`, () => {
      const keys = [SK, GITHUB, SETTING]
      for (const seed of [11, 12, 13]) {
        const random = seeded(seed * 104729)
        const cut = cutFrames(recording.frames, random, keys)
        const out = run(cut, { now: () => 0 })
        expect(out.frames.map((frame) => frame.id)).toEqual(cut.map((frame) => frame.id))
        expect(out.frames.map(withoutChunk)).toEqual(cut.map(withoutChunk))
        let expected = 0
        for (const [stream, text] of streamTexts(cut)) {
          const whole = maskKeys(text)
          expected += whole.count
          expect(streamTexts(out.frames).get(stream), stream).toBe(whole.text)
        }
        expect(out.count).toBe(expected)
        const sent = JSON.stringify(out.frames)
        for (const key of keys) expect(sent).not.toContain(key.slice(-16))
        expect(sent).not.toContain(SETTING_VALUE.slice(0, 8))
      }
    })
  }
})
