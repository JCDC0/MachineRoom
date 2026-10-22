import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createNoticeBatcher,
  findIssueByIdentifier,
  latestOnly,
  matchesNotice,
  subscribeToNotices,
} from '../src/ui/panels/notices.js'

describe('matchesNotice', () => {
  it('matches matching string topics', () => {
    expect(matchesNotice('issues', { topic: 'issues' })).toBe(true)
    expect(matchesNotice('agents', { topic: 'agents' })).toBe(true)
    expect(matchesNotice('approvals', { topic: 'approvals' })).toBe(true)
    expect(matchesNotice('issues', { topic: 'agents' })).toBe(false)
  })

  it('matches array of topics for meters panel', () => {
    expect(matchesNotice(['agents', 'costs'], { topic: 'agents' })).toBe(true)
    expect(matchesNotice(['agents', 'costs'], { topic: 'costs' })).toBe(true)
    expect(matchesNotice(['agents', 'costs'], { topic: 'issues' })).toBe(false)
    expect(matchesNotice(['agents', 'costs'], { topic: 'approvals' })).toBe(false)
    expect(matchesNotice(['agents', 'costs'], { topic: 'comments', id: 'issue-18' })).toBe(false)
  })

  it('matches topic and id for thread comments', () => {
    expect(matchesNotice({ topic: 'comments', id: 'issue-18' }, { topic: 'comments', id: 'issue-18' })).toBe(true)
    expect(matchesNotice({ topic: 'comments', id: 'issue-18' }, { topic: 'comments', id: 'issue-22' })).toBe(false)
    expect(matchesNotice({ topic: 'comments', id: 'issue-18' }, { topic: 'comments' })).toBe(false)
    expect(matchesNotice({ topic: 'comments', id: 'issue-18' }, { topic: 'issues', id: 'issue-18' })).toBe(false)
    expect(matchesNotice({ topic: 'comments', id: 'issue-18' }, { topic: 'comments', id: 'issue-18', extra: 'data' })).toBe(true)
  })

  it('handles object filter without id', () => {
    expect(matchesNotice({ topic: 'approvals' }, { topic: 'approvals' })).toBe(true)
    expect(matchesNotice({ topic: 'approvals' }, { topic: 'issues' })).toBe(false)
  })

  it('rejects falsy or non-object events and filters', () => {
    expect(matchesNotice(null, { topic: 'issues' })).toBe(false)
    expect(matchesNotice(undefined, { topic: 'issues' })).toBe(false)
    expect(matchesNotice('', { topic: 'issues' })).toBe(false)
    expect(matchesNotice([], { topic: 'issues' })).toBe(false)
    expect(matchesNotice('issues', null)).toBe(false)
    expect(matchesNotice('issues', undefined)).toBe(false)
    expect(matchesNotice('issues', 'issues')).toBe(false)
    expect(matchesNotice('issues', 123)).toBe(false)
    expect(matchesNotice('issues', {})).toBe(false)
    expect(matchesNotice({}, { topic: 'issues' })).toBe(false)
  })
})

describe('createNoticeBatcher', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('batches calls within 100 ms into a single invocation', () => {
    const callback = vi.fn()
    const batcher = createNoticeBatcher(callback, 100)

    expect(batcher.isPending()).toBe(false)

    batcher.schedule()
    expect(batcher.isPending()).toBe(true)

    vi.advanceTimersByTime(30)
    batcher.schedule()

    vi.advanceTimersByTime(50)
    batcher.schedule()

    expect(callback).not.toHaveBeenCalled()

    vi.advanceTimersByTime(20)
    expect(callback).toHaveBeenCalledTimes(1)
    expect(batcher.isPending()).toBe(false)
  })

  it('allows scheduling again after batch executes', () => {
    const callback = vi.fn()
    const batcher = createNoticeBatcher(callback, 100)

    batcher.schedule()
    vi.advanceTimersByTime(100)
    expect(callback).toHaveBeenCalledTimes(1)

    vi.advanceTimersByTime(10)
    batcher.schedule()
    vi.advanceTimersByTime(100)
    expect(callback).toHaveBeenCalledTimes(2)
  })

  it('cancels pending executions', () => {
    const callback = vi.fn()
    const batcher = createNoticeBatcher(callback, 100)

    batcher.schedule()
    expect(batcher.isPending()).toBe(true)

    batcher.cancel()
    expect(batcher.isPending()).toBe(false)

    vi.advanceTimersByTime(200)
    expect(callback).not.toHaveBeenCalled()
  })

  it('flushes pending executions immediately', () => {
    const callback = vi.fn()
    const batcher = createNoticeBatcher(callback, 100)

    batcher.schedule()
    batcher.flush()

    expect(callback).toHaveBeenCalledTimes(1)
    expect(batcher.isPending()).toBe(false)

    vi.advanceTimersByTime(200)
    expect(callback).toHaveBeenCalledTimes(1)
  })

  it('flush does nothing when no execution is pending', () => {
    const callback = vi.fn()
    const batcher = createNoticeBatcher(callback, 100)

    batcher.flush()
    expect(callback).not.toHaveBeenCalled()
  })
})

describe('subscribeToNotices', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  function createFakeClient() {
    const listeners = new Set()
    return {
      subscribe(listener) {
        listeners.add(listener)
        return () => listeners.delete(listener)
      },
      emit(event) {
        for (const listener of [...listeners]) listener(event)
      },
      listenerCount() {
        return listeners.size
      },
    }
  }

  it('subscribes and batches matching notices', () => {
    const client = createFakeClient()
    const callback = vi.fn()

    const unsubscribe = subscribeToNotices(client, 'issues', callback, 100)
    expect(client.listenerCount()).toBe(1)

    client.emit({ topic: 'agents' })
    vi.advanceTimersByTime(150)
    expect(callback).not.toHaveBeenCalled()

    client.emit({ topic: 'issues' })
    client.emit({ topic: 'issues' })
    vi.advanceTimersByTime(50)
    client.emit({ topic: 'issues' })

    expect(callback).not.toHaveBeenCalled()

    vi.advanceTimersByTime(50)
    expect(callback).toHaveBeenCalledTimes(1)

    unsubscribe()
    expect(client.listenerCount()).toBe(0)
  })

  it('only fires for matching comment id in open thread', () => {
    const client = createFakeClient()
    const callback = vi.fn()

    const unsubscribe = subscribeToNotices(client, { topic: 'comments', id: 'issue-18' }, callback, 100)

    client.emit({ topic: 'comments', id: 'issue-19' })
    client.emit({ topic: 'comments' })
    vi.advanceTimersByTime(150)
    expect(callback).not.toHaveBeenCalled()

    client.emit({ topic: 'comments', id: 'issue-18' })
    vi.advanceTimersByTime(100)
    expect(callback).toHaveBeenCalledTimes(1)

    unsubscribe()
  })

  it('cleans up pending timer on unsubscribe', () => {
    const client = createFakeClient()
    const callback = vi.fn()

    const unsubscribe = subscribeToNotices(client, 'approvals', callback, 100)
    client.emit({ topic: 'approvals' })

    unsubscribe()
    vi.advanceTimersByTime(200)
    expect(callback).not.toHaveBeenCalled()
  })

  it('handles missing or invalid client safely', () => {
    const callback = vi.fn()
    const unsubscribe1 = subscribeToNotices(null, 'issues', callback)
    const unsubscribe2 = subscribeToNotices({}, 'issues', callback)

    expect(typeof unsubscribe1).toBe('function')
    expect(typeof unsubscribe2).toBe('function')
    expect(() => unsubscribe1()).not.toThrow()
    expect(() => unsubscribe2()).not.toThrow()
  })

  it('batches rapid notices on same topic into single callback', () => {
    const client = createFakeClient()
    const callback = vi.fn()

    const unsubscribe = subscribeToNotices(client, 'approvals', callback, 100)
    client.emit({ topic: 'approvals' })
    client.emit({ topic: 'approvals' })

    expect(callback).not.toHaveBeenCalled()
    vi.advanceTimersByTime(100)
    expect(callback).toHaveBeenCalledTimes(1)

    unsubscribe()
  })

  it('batches multiple topic writes into single callback for meters', () => {
    const client = createFakeClient()
    const callback = vi.fn()

    const unsubscribe = subscribeToNotices(client, ['agents', 'costs'], callback, 100)
    client.emit({ topic: 'agents' })
    client.emit({ topic: 'costs' })

    expect(callback).not.toHaveBeenCalled()
    vi.advanceTimersByTime(100)
    expect(callback).toHaveBeenCalledTimes(1)

    unsubscribe()
  })

  it('matches comment notice to matching issue thread only', () => {
    const client = createFakeClient()
    const callback18 = vi.fn()
    const callback22 = vi.fn()

    const unsubscribe18 = subscribeToNotices(client, { topic: 'comments', id: 'issue-18' }, callback18, 100)
    const unsubscribe22 = subscribeToNotices(client, { topic: 'comments', id: 'issue-22' }, callback22, 100)

    client.emit({ topic: 'comments', id: 'issue-18' })
    vi.advanceTimersByTime(100)

    expect(callback18).toHaveBeenCalledTimes(1)
    expect(callback22).not.toHaveBeenCalled()

    unsubscribe18()
    unsubscribe22()
  })
})

describe('findIssueByIdentifier', () => {
  const issues = [
    { id: 'issue-18', identifier: 'JC-18', title: 'First' },
    { id: 'issue-19', identifier: 'JC-19', title: 'Second' },
  ]

  it('finds issue by exact identifier', () => {
    expect(findIssueByIdentifier(issues, 'JC-18')).toEqual(issues[0])
    expect(findIssueByIdentifier(issues, 'JC-19')).toEqual(issues[1])
  })

  it('matches identifier case-insensitively', () => {
    expect(findIssueByIdentifier(issues, 'jc-18')).toEqual(issues[0])
    expect(findIssueByIdentifier(issues, 'Jc-19')).toEqual(issues[1])
  })

  it('matches by issue id', () => {
    expect(findIssueByIdentifier(issues, 'issue-18')).toEqual(issues[0])
    expect(findIssueByIdentifier(issues, 'ISSUE-19')).toEqual(issues[1])
  })

  it('trims leading and trailing whitespace', () => {
    expect(findIssueByIdentifier(issues, '  JC-18  ')).toEqual(issues[0])
  })

  it('returns null when not found', () => {
    expect(findIssueByIdentifier(issues, 'JC-99')).toBeNull()
  })

  it('handles empty, null, or non-array inputs safely', () => {
    expect(findIssueByIdentifier(issues, '')).toBeNull()
    expect(findIssueByIdentifier(issues, '   ')).toBeNull()
    expect(findIssueByIdentifier(issues, null)).toBeNull()
    expect(findIssueByIdentifier(issues, undefined)).toBeNull()
    expect(findIssueByIdentifier(null, 'JC-18')).toBeNull()
    expect(findIssueByIdentifier([], 'JC-18')).toBeNull()
  })
})

describe('latestOnly', () => {
  it('tells whether an answer is still the newest one started', () => {
    const latest = latestOnly()
    const isFirst = latest()
    expect(isFirst()).toBe(true)
    const isSecond = latest()
    expect(isFirst()).toBe(false)
    expect(isSecond()).toBe(true)
  })

  it('drops an answer that arrives after a newer one and applies the newest', async () => {
    const latest = latestOnly()
    let currentBoard = null

    async function fetchCosts(delayMs, boardData) {
      const isLatest = latest()
      await new Promise((resolve) => setTimeout(resolve, delayMs))
      if (!isLatest()) return
      currentBoard = boardData
    }

    const slowRead = fetchCosts(50, { spendCents: 100 })
    const fastRead = fetchCosts(10, { spendCents: 200 })

    await Promise.all([slowRead, fastRead])

    expect(currentBoard).toEqual({ spendCents: 200 })
  })

  it('does not clear a newer board on error from an older read', async () => {
    const latest = latestOnly()
    let currentBoard = null

    async function fetchCosts(delayMs, shouldFail, boardData) {
      const isLatest = latest()
      try {
        await new Promise((resolve, reject) => {
          setTimeout(() => {
            if (shouldFail) reject(new Error('fetch failed'))
            else resolve()
          }, delayMs)
        })
        if (!isLatest()) return
        currentBoard = boardData
      } catch {
        if (!isLatest()) return
        currentBoard = null
      }
    }

    const failingSlowRead = fetchCosts(50, true, null)
    const succeedingFastRead = fetchCosts(10, false, { spendCents: 500 })

    await Promise.all([failingSlowRead, succeedingFastRead])

    expect(currentBoard).toEqual({ spendCents: 500 })
  })

  it('clears board when error is from the newest read', async () => {
    const latest = latestOnly()
    let currentBoard = { spendCents: 300 }

    async function fetchCosts(delayMs, shouldFail, boardData) {
      const isLatest = latest()
      try {
        await new Promise((resolve, reject) => {
          setTimeout(() => {
            if (shouldFail) reject(new Error('network error'))
            else resolve()
          }, delayMs)
        })
        if (!isLatest()) return
        currentBoard = boardData
      } catch {
        if (!isLatest()) return
        currentBoard = null
      }
    }

    const fastSuccess = fetchCosts(10, false, { spendCents: 400 })
    const slowFailure = fetchCosts(30, true, null)

    await Promise.all([fastSuccess, slowFailure])

    expect(currentBoard).toBeNull()
  })

  it('keeps the newest started value across multiple out-of-order completions', async () => {
    const latest = latestOnly()
    let currentTask = null

    async function fetchTasks(delayMs, value) {
      const isLatest = latest()
      await new Promise((resolve) => setTimeout(resolve, delayMs))
      if (!isLatest()) return
      currentTask = value
    }

    const first = fetchTasks(80, 'TASK-1')
    const second = fetchTasks(20, 'TASK-2')
    const third = fetchTasks(50, 'TASK-3')

    await Promise.all([first, second, third])

    expect(currentTask).toBe('TASK-3')
  })

  it('isolates counters between different latestOnly instances', () => {
    const firstInstance = latestOnly()
    const secondInstance = latestOnly()

    const readA1 = firstInstance()
    const readB1 = secondInstance()
    const readA2 = firstInstance()

    expect(readA1()).toBe(false)
    expect(readA2()).toBe(true)
    expect(readB1()).toBe(true)
  })
})

