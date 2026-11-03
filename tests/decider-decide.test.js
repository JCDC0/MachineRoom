import { describe, expect, it } from 'vitest'
import { decide, sanitize } from '../src/decider/decide.js'
import { DEFAULT_URL, choice, noul } from '../src/decider/wire.js'
import { startFakeDecisions } from './fakeDecisions.js'

const questions = {
  tier: choice('Which tier?', { small: 'A small one.', large: 'A large one.' }),
  risky: noul('Is it risky?', 'Yes.', 'No.'),
}

const good = {
  model: 'typesafe/jev-1.14',
  answers: {
    tier: { type: 'choice', choice: 'small', confidence: 0.9, probabilities: { small: 0.9, large: 0.1 } },
    risky: { type: 'noul', noul: 0.2 },
  },
  usage: { input_tokens: 200, output_tokens: 10, cost: 0.00001 },
}

const base = { key: 'test-key-abc123', model: 'typesafe/jev-1.14', state: 'Task', questions, sleep: async () => {} }

function scripted(responses) {
  const calls = []
  const fetch = async (url, init) => {
    calls.push({ url, init })
    const next = responses[Math.min(calls.length - 1, responses.length - 1)]
    if (next instanceof Error) throw next
    return {
      ok: next.status < 400,
      status: next.status,
      headers: { get: (name) => next.headers?.[name] ?? null },
      text: async () => (typeof next.body === 'string' ? next.body : JSON.stringify(next.body)),
    }
  }
  return { fetch, calls }
}

describe('decide', () => {
  it('sends the key as a bearer token and the body as json', async () => {
    const { fetch, calls } = scripted([{ status: 200, body: good }])
    const result = await decide({ ...base, fetch, url: 'https://example.test/decide' })
    expect(result.ok).toBe(true)
    expect(calls).toHaveLength(1)
    expect(calls[0].url).toBe('https://example.test/decide')
    expect(calls[0].init.headers.Authorization).toBe('Bearer test-key-abc123')
    expect(JSON.parse(calls[0].init.body)).toEqual({ model: 'typesafe/jev-1.14', state: 'Task', questions })
    expect(result.answers.tier.choice).toBe('small')
    expect(result.attempts).toBe(1)
  })

  it('refuses to call without a key, a model or questions', async () => {
    const { fetch, calls } = scripted([{ status: 200, body: good }])
    expect((await decide({ ...base, fetch, key: '' })).kind).toBe('no_key')
    expect((await decide({ ...base, fetch, model: '' })).kind).toBe('bad_request')
    expect((await decide({ ...base, fetch, questions: {} })).kind).toBe('bad_request')
    expect(calls).toHaveLength(0)
  })

  it('names a refused key in plain words and does not retry it', async () => {
    const { fetch, calls } = scripted([{ status: 401, body: { error: { message: 'bad key test-key-abc123' } } }])
    const result = await decide({ ...base, fetch })
    expect(result.ok).toBe(false)
    expect(result.kind).toBe('unauthorized')
    expect(result.error).toMatch(/key was refused/i)
    expect(JSON.stringify(result)).not.toContain('test-key-abc123')
    expect(calls).toHaveLength(1)
    expect(calls[0].url).toBe(DEFAULT_URL)
  })

  it('names a missing model or alpha access, a payment problem and a size problem', async () => {
    for (const [status, kind] of [[404, 'not_found'], [402, 'payment'], [413, 'too_large'], [400, 'bad_request']]) {
      const { fetch } = scripted([{ status, body: {} }])
      expect((await decide({ ...base, fetch })).kind).toBe(kind)
    }
  })

  it('retries a server error once and then succeeds', async () => {
    const { fetch, calls } = scripted([{ status: 503, body: {} }, { status: 200, body: good }])
    const result = await decide({ ...base, fetch, retries: 1 })
    expect(result.ok).toBe(true)
    expect(result.attempts).toBe(2)
    expect(calls).toHaveLength(2)
  })

  it('gives up after the retries and reports the last failure', async () => {
    const { fetch, calls } = scripted([{ status: 500, body: { error: { message: 'boom' } } }])
    const result = await decide({ ...base, fetch, retries: 2 })
    expect(result.ok).toBe(false)
    expect(result.kind).toBe('server')
    expect(result.error).toContain('boom')
    expect(result.attempts).toBe(3)
    expect(calls).toHaveLength(3)
  })

  it('waits for the time the service names on a rate limit, at most two seconds', async () => {
    const waits = []
    const { fetch } = scripted([{ status: 429, body: {}, headers: { 'retry-after': '30' } }, { status: 200, body: good }])
    const result = await decide({ ...base, fetch, sleep: async (ms) => waits.push(ms) })
    expect(result.ok).toBe(true)
    expect(waits).toEqual([2000])
  })

  it('turns a dropped connection into a plain failure', async () => {
    const { fetch } = scripted([new Error('connect ECONNREFUSED')])
    const result = await decide({ ...base, fetch, retries: 0 })
    expect(result).toMatchObject({ ok: false, kind: 'network' })
    expect(result.error).not.toContain('ECONNREFUSED')
  })

  it('stops waiting after the time limit', async () => {
    const fetch = (url, init) =>
      new Promise((resolve, reject) => {
        init.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })))
      })
    const result = await decide({ ...base, fetch, timeoutMs: 20, retries: 0 })
    expect(result).toMatchObject({ ok: false, kind: 'timeout' })
  })

  it('reports a reply that is not valid as a bad answer, and does not retry it', async () => {
    const { fetch, calls } = scripted([{ status: 200, body: { answers: { tier: { type: 'choice', choice: 'huge' } } } }])
    const result = await decide({ ...base, fetch, retries: 2 })
    expect(result).toMatchObject({ ok: false, kind: 'bad_answer' })
    expect(calls).toHaveLength(1)
    expect(calls[0].url).toBe(DEFAULT_URL)
  })

  it('scrubs the key from a server error that echoes it', async () => {
    const { fetch } = scripted([{ status: 500, body: { error: { message: 'failed for Bearer test-key-abc123 and test-key-abc123' } } }])
    const result = await decide({ ...base, fetch, retries: 0 })
    expect(result.kind).toBe('server')
    expect(result.error).toContain('[key]')
    expect(JSON.stringify(result)).not.toContain('test-key-abc123')
  })

  it('reports a reply that is not json', async () => {
    const { fetch } = scripted([{ status: 200, body: 'not json' }])
    expect((await decide({ ...base, fetch, retries: 0 })).kind).toBe('bad_answer')
  })

  it('works against a real local server', async () => {
    const server = await startFakeDecisions(() => ({ body: good }))
    try {
      const result = await decide({ ...base, url: server.url })
      expect(result.ok).toBe(true)
      expect(server.seen[0].authorization).toBe('Bearer test-key-abc123')
      expect(server.seen[0].body.model).toBe('typesafe/jev-1.14')
    } finally {
      await server.close()
    }
  })
})

describe('sanitize', () => {
  it('removes the key, bearer tokens and key shaped words, and shortens the text', () => {
    expect(sanitize('bad key abc123 here', 'abc123')).toBe('bad key [key] here')
    expect(sanitize('Authorization: Bearer xyz.789', null)).toBe('Authorization: Bearer [key]')
    expect(sanitize('used sk-or-v1-abcdefghijkl today', null)).toBe('used [key] today')
    expect(sanitize('x'.repeat(500), null)).toHaveLength(200)
    expect(sanitize(undefined, 'k')).toBe('')
  })
})
