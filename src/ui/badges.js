function listOf(value, key) {
  if (Array.isArray(value)) return value
  if (value && typeof value === 'object' && Array.isArray(value[key])) return value[key]
  return []
}

export function reviewBadgeCount(value) {
  let count = 0
  for (const review of listOf(value, 'reviews')) {
    if (!review || typeof review !== 'object' || review.error) continue
    const ahead = Number(review.ahead)
    if (Number.isFinite(ahead) && ahead > 0) count += 1
  }
  return count
}

export function proposalBadgeCount(value) {
  const ids = new Set()
  for (const proposal of listOf(value, 'proposals')) {
    if (!proposal || typeof proposal !== 'object') continue
    const id = typeof proposal.id === 'string' ? proposal.id.trim() : ''
    if (id) ids.add(id)
  }
  return ids.size
}

export function orchestratorBadgeCount(value) {
  let count = 0
  for (const entry of listOf(value, 'orchestrators')) {
    if (!entry || typeof entry !== 'object') continue
    const state = typeof entry.state === 'string' ? entry.state.trim().toLowerCase() : 'idle'
    if (state === 'paused' || state === 'idle' || state === 'waiting') count += 1
  }
  return count
}

export function actionBadges({ reviews = null, proposals = null, orchestrators = null } = {}) {
  return {
    control: reviewBadgeCount(reviews),
    orchestrator: proposalBadgeCount(proposals) + orchestratorBadgeCount(orchestrators),
  }
}
