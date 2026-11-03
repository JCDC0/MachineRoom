import { describe, expect, it } from 'vitest'
import { REQUEST_LIMITS, REQUEST_TIMEOUT_MS, createClient } from '../src/control/client.js'

function hangingFetch() {
  const seen = { options: null }
  const fetchImpl = (url, options) => {
    seen.options = options
    return new Promise((resolve, reject) => {
      options.signal.addEventListener('abort', () => {
        const error = new Error('aborted')
        error.name = 'AbortError'
        reject(error)
      })
    })
  }
  return { fetchImpl, seen }
}

function harness(fetchImpl) {
  const timers = []
  const cleared = []
  const client = createClient({
    baseUrl: 'http://bridge',
    EventSourceImpl: null,
    fetchImpl,
    setTimer: (fn, ms) => {
      const id = timers.length + 1
      timers.push({ id, fn, ms })
      return id
    },
    clearTimer: (id) => cleared.push(id),
  })
  return { client, timers, cleared }
}

describe('control client request limits', () => {
  it('has no backup methods or their limit, since the bridge has no backup route', () => {
    const { client } = harness(hangingFetch().fetchImpl)
    expect(client.backupStatus).toBeUndefined()
    expect(client.backupNow).toBeUndefined()
    expect(REQUEST_LIMITS.backupNow).toBeUndefined()
  })

  it('gives up on a request that never answers at the default limit', async () => {
    const { fetchImpl, seen } = hangingFetch()
    const { client, timers, cleared } = harness(fetchImpl)
    const pending = client.issues()
    expect(timers).toHaveLength(1)
    expect(timers[0].ms).toBe(REQUEST_TIMEOUT_MS)
    timers[0].fn()
    await expect(pending).rejects.toThrow(`The bridge did not answer within ${REQUEST_TIMEOUT_MS / 1000} seconds.`)
    expect(seen.options.signal.aborted).toBe(true)
    expect(cleared).toEqual([timers[0].id])
  })

  it('gives the orchestrator send and read calls the default limit', async () => {
    const calls = [
      (client) => client.sendOrchestrator('Build it.'),
      (client) => client.sendToOrchestrator('Build it.', { confirmed: true }),
      (client) => client.orchestrator(),
      (client) => client.orchestrators(),
    ]
    for (const call of calls) {
      const { fetchImpl } = hangingFetch()
      const { client, timers } = harness(fetchImpl)
      const pending = call(client)
      expect(timers[0].ms).toBe(REQUEST_TIMEOUT_MS)
      timers[0].fn()
      await expect(pending).rejects.toThrow(`The bridge did not answer within ${REQUEST_TIMEOUT_MS / 1000} seconds.`)
    }
  })

  it('gives a long route a limit above the bridge limit', async () => {
    const { fetchImpl, seen } = hangingFetch()
    const { client, timers } = harness(fetchImpl)
    const pending = client.hireAgent({ name: 'New lane' })
    expect(timers[0].ms).toBe(REQUEST_LIMITS.hireAgent)
    timers[0].fn()
    await expect(pending).rejects.toThrow(
      `The bridge did not answer within ${REQUEST_LIMITS.hireAgent / 1000} seconds.`
    )
    expect(seen.options.signal.aborted).toBe(true)
  })

  it('gives the merge, the review list and the decision model their own limits', async () => {
    const calls = [
      [REQUEST_LIMITS.mergeReview, (client) => client.mergeReview('opencode', { head: 'a'.repeat(40), message: 'Merge it' })],
      [REQUEST_LIMITS.reviews, (client) => client.reviews()],
      [REQUEST_LIMITS.decide, (client) => client.decide({ state: 'open', questions: { ready: { type: 'noul' } } })],
    ]
    for (const [limit, call] of calls) {
      const { fetchImpl } = hangingFetch()
      const { client, timers } = harness(fetchImpl)
      const pending = call(client)
      expect(timers[0].ms).toBe(limit)
      timers[0].fn()
      await expect(pending).rejects.toThrow(`The bridge did not answer within ${limit / 1000} seconds.`)
    }
  })

  it('keeps the limit until the body is read and clears it when the answer arrives', async () => {
    let bodyStarted
    let finishBody
    const started = new Promise((resolve) => {
      bodyStarted = resolve
    })
    const body = new Promise((resolve) => {
      finishBody = resolve
    })
    const { client, timers, cleared } = harness(async () => ({
      ok: true,
      json: () => {
        bodyStarted()
        return body
      },
    }))
    const pending = client.issues()
    await started
    expect(cleared).toEqual([])
    finishBody([])
    await expect(pending).resolves.toEqual([])
    expect(cleared).toEqual([timers[0].id])
  })

  it('passes the abort signal to fetch and aborts it at the limit', async () => {
    const { fetchImpl, seen } = hangingFetch()
    const { client, timers } = harness(fetchImpl)
    const pending = client.agents()
    expect(seen.options.signal).toBeInstanceOf(AbortSignal)
    expect(seen.options.signal.aborted).toBe(false)
    timers[0].fn()
    expect(seen.options.signal.aborted).toBe(true)
    await expect(pending).rejects.toThrow(`The bridge did not answer within ${REQUEST_TIMEOUT_MS / 1000} seconds.`)
  })

  it('gives up while the body is still being read', async () => {
    let bodyStarted
    const started = new Promise((resolve) => {
      bodyStarted = resolve
    })
    const { client, timers } = harness((url, options) => {
      return Promise.resolve({
        ok: true,
        json: () => {
          bodyStarted()
          return new Promise((resolve, reject) => {
            options.signal.addEventListener('abort', () => {
              const error = new Error('aborted')
              error.name = 'AbortError'
              reject(error)
            })
          })
        },
      })
    })
    const pending = client.issues()
    await started
    timers[0].fn()
    await expect(pending).rejects.toThrow(`The bridge did not answer within ${REQUEST_TIMEOUT_MS / 1000} seconds.`)
  })
})
