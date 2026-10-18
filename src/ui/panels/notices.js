export function matchesNotice(filter, event) {
  if (!filter || !event || typeof event !== 'object') {
    return false
  }
  if (Array.isArray(filter)) {
    return filter.some((item) => matchesNotice(item, event))
  }
  if (typeof filter === 'string') {
    return filter.length > 0 && event.topic === filter
  }
  if (typeof filter === 'object') {
    if (!filter.topic || event.topic !== filter.topic) {
      return false
    }
    if (filter.id !== undefined && filter.id !== null) {
      return event.id === filter.id
    }
    return true
  }
  return false
}

export function createNoticeBatcher(callback, delayMs = 100) {
  let timer = null

  function schedule() {
    if (timer !== null) return
    timer = setTimeout(() => {
      timer = null
      callback()
    }, delayMs)
  }

  function cancel() {
    if (timer !== null) {
      clearTimeout(timer)
      timer = null
    }
  }

  function flush() {
    if (timer !== null) {
      clearTimeout(timer)
      timer = null
      callback()
    }
  }

  function isPending() {
    return timer !== null
  }

  return { schedule, cancel, flush, isPending }
}

export function subscribeToNotices(client, filter, onNotice, delayMs = 100) {
  if (!client || typeof client.subscribe !== 'function') {
    return () => {}
  }
  const batcher = createNoticeBatcher(onNotice, delayMs)
  const unsubscribe = client.subscribe((event) => {
    if (matchesNotice(filter, event)) {
      batcher.schedule()
    }
  })
  return () => {
    batcher.cancel()
    unsubscribe?.()
  }
}

export function findIssueByIdentifier(issues, identifier) {
  if (!Array.isArray(issues) || identifier == null) return null
  const cleaned = String(identifier).trim().toLowerCase()
  if (!cleaned) return null
  return (
    issues.find(
      (issue) =>
        issue?.identifier?.toLowerCase() === cleaned ||
        issue?.id?.toLowerCase() === cleaned
    ) ?? null
  )
}
