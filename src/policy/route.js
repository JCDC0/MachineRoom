export const TIERS = ['small', 'medium', 'large']

const CHOICE_FIELDS = ['lane', 'model', 'reasoning', 'provider']
const MONEY_FIELDS = ['runUsd', 'issueUsd', 'agentMonthlyUsd', 'companyMonthlyUsd']
const LIMIT_FIELDS = [...MONEY_FIELDS, 'maxTurnsPerRun', 'timeoutSec']
const SPEND_LABELS = { runUsd: 'run', issueUsd: 'issue', agentMonthlyUsd: 'agent', companyMonthlyUsd: 'company' }
const OWNER = 'owner'

function fail(message) {
  throw new Error(message)
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function isText(value) {
  return typeof value === 'string' && value.trim() !== ''
}

function isNumber(value) {
  return typeof value === 'number' && Number.isFinite(value)
}

function money(value) {
  return `$${value.toFixed(2)}`
}

function readChoice(choice, path) {
  if (!isPlainObject(choice)) fail(`${path} must be an object.`)
  for (const key of Object.keys(choice)) {
    if (!CHOICE_FIELDS.includes(key)) fail(`${path}.${key} is not a choice field.`)
  }
  if (!isText(choice.lane)) fail(`${path}.lane must be text.`)
  const lane = choice.lane.trim()
  const owner = lane === OWNER
  const clean = { lane }
  for (const key of ['model', 'reasoning', 'provider']) {
    const value = choice[key] === undefined ? null : choice[key]
    if (value === null) {
      if (!owner) fail(`${path}.${key} must be text.`)
      clean[key] = null
    } else if (isText(value)) {
      clean[key] = value.trim()
    } else {
      fail(`${path}.${key} must be text.`)
    }
  }
  return clean
}

function readTiers(tiers) {
  if (!isPlainObject(tiers)) fail('policy.tiers must be an object.')
  for (const key of Object.keys(tiers)) {
    if (!TIERS.includes(key)) fail(`policy.tiers.${key} is not a tier.`)
  }
  const clean = {}
  for (const tier of TIERS) {
    const list = tiers[tier]
    if (!Array.isArray(list)) fail(`policy.tiers.${tier} must be a list of choices.`)
    if (list.length === 0) fail(`policy.tiers.${tier} must hold at least one choice.`)
    clean[tier] = list.map((choice, index) => readChoice(choice, `policy.tiers.${tier}[${index}]`))
  }
  return clean
}

function readLimits(limits) {
  if (!isPlainObject(limits)) fail('policy.limits must be an object.')
  for (const key of Object.keys(limits)) {
    if (!LIMIT_FIELDS.includes(key)) fail(`policy.limits.${key} is not a limit.`)
  }
  const clean = {}
  for (const key of LIMIT_FIELDS) {
    const value = limits[key]
    if (MONEY_FIELDS.includes(key)) {
      if (!isNumber(value) || value <= 0) fail(`policy.limits.${key} must be a number above 0.`)
    } else if (!Number.isInteger(value) || value <= 0) {
      fail(`policy.limits.${key} must be a whole number above 0.`)
    }
    clean[key] = value
  }
  return clean
}

export function readPolicy(json) {
  let source = json
  if (typeof source === 'string') {
    try {
      source = JSON.parse(source)
    } catch {
      fail('The policy file is not JSON.')
    }
  }
  if (!isPlainObject(source)) fail('policy must be an object.')
  const tiers = readTiers(source.tiers)
  const limits = readLimits(source.limits)
  const quotaSkipPercent = source.quotaSkipPercent
  if (!isNumber(quotaSkipPercent) || quotaSkipPercent < 0 || quotaSkipPercent > 100) {
    fail('policy.quotaSkipPercent must be a number from 0 to 100.')
  }
  return { tiers, limits, quotaSkipPercent }
}

export function tierFor(profile) {
  const source = isPlainObject(profile) ? profile : {}
  const risky =
    source.clarity === 'unclear' ||
    source.touchesSecrets === true ||
    source.touchesDeploy === true ||
    source.touchesData === true ||
    source.kind === 'design' ||
    source.reversible === false
  if (risky) return 'large'
  const files = source.files
  if (source.newTest !== true && source.hasTests === true && isNumber(files) && files <= 2) return 'small'
  return 'medium'
}

export function escalate(tier, failures) {
  const start = TIERS.includes(tier) ? TIERS.indexOf(tier) : 0
  const count = isNumber(failures) && failures > 0 ? Math.floor(failures) : 0
  return TIERS[Math.min(TIERS.length - 1, start + count)]
}

function providerOver(provider, quotas, skipPercent) {
  if (!isText(provider) || !Array.isArray(quotas)) return false
  const name = provider.trim().toLowerCase()
  for (const entry of quotas) {
    if (!isPlainObject(entry) || entry.ok === false) continue
    if (!isText(entry.provider) || entry.provider.trim().toLowerCase() !== name) continue
    const windows = Array.isArray(entry.windows) ? entry.windows : []
    for (const window of windows) {
      if (!isPlainObject(window) || !isNumber(window.usedPercent)) continue
      if (window.usedPercent > skipPercent) return true
    }
  }
  return false
}

function spendProblem(spent, limits) {
  if (!isPlainObject(spent)) return null
  for (const key of MONEY_FIELDS) {
    const value = spent[key]
    if (!isNumber(value) || value < limits[key]) continue
    const monthly = key === 'agentMonthlyUsd' || key === 'companyMonthlyUsd' ? ' monthly' : ''
    return `The ${SPEND_LABELS[key]} has spent ${money(value)} of its ${money(limits[key])}${monthly} limit.`
  }
  return null
}

function describe(tier, choice) {
  if (choice.lane === OWNER) return `The ${tier} tier asks the owner.`
  return `The ${tier} tier runs ${choice.lane} on ${choice.model} at ${choice.reasoning}.`
}

function escalationNote(base, tier, failures) {
  if (tier === base) return ''
  const count = isNumber(failures) ? Math.floor(failures) : 0
  return ` Escalated from the ${base} tier after ${count} ${count === 1 ? 'failure' : 'failures'}.`
}

export function chooseRoute({ policy, profile, failures, quotas, spent } = {}) {
  const clean = readPolicy(policy)
  const base = tierFor(profile)
  const tier = escalate(base, failures)
  const problem = spendProblem(spent, clean.limits)
  if (problem) return { tier, choice: null, reason: problem }
  for (const choice of clean.tiers[tier]) {
    if (providerOver(choice.provider, quotas, clean.quotaSkipPercent)) continue
    return { tier, choice, reason: `${describe(tier, choice)}${escalationNote(base, tier, failures)}` }
  }
  return { tier, choice: null, reason: `Every choice for the ${tier} tier is above its quota.` }
}

function readLanes(lanes) {
  const map = new Map()
  for (const lane of Array.isArray(lanes) ? lanes : []) {
    if (!isPlainObject(lane) || !isText(lane.key)) continue
    const key = lane.key.trim()
    if (map.has(key)) continue
    map.set(key, {
      key,
      eligible: lane.eligible === true,
      active: lane.active === true,
      busy: lane.busy === true,
    })
  }
  return map
}

function laneSkip(choice, lanes) {
  const lane = lanes.get(choice.lane)
  if (!lane) {
    if (choice.lane === OWNER) return 'The owner is not a lane.'
    return `The lane ${choice.lane} is not in this room.`
  }
  if (!lane.eligible) return `The lane ${choice.lane} is retired or has no command line.`
  if (!lane.active) return `The lane ${choice.lane} is turned off.`
  if (lane.busy) return `The lane ${choice.lane} is busy.`
  return ''
}

function freeLane(lanes) {
  for (const lane of lanes.values()) {
    if (lane.eligible && lane.active && !lane.busy) return lane.key
  }
  return null
}

export function routeLane({ policy, profile, failures, quotas, spent, lanes } = {}) {
  const clean = readPolicy(policy)
  const base = tierFor(profile)
  const tier = escalate(base, failures)
  const list = readLanes(lanes)
  const skipped = []
  const problem = spendProblem(spent, clean.limits)
  if (problem) return { lane: null, model: null, reasoning: null, tier, reason: problem, skipped }
  for (const choice of clean.tiers[tier]) {
    if (providerOver(choice.provider, quotas, clean.quotaSkipPercent)) {
      skipped.push({ lane: choice.lane, why: `The ${choice.provider} provider is over its quota.` })
      continue
    }
    const why = laneSkip(choice, list)
    if (why !== '') {
      skipped.push({ lane: choice.lane, why })
      continue
    }
    return {
      lane: choice.lane,
      model: choice.model,
      reasoning: choice.reasoning,
      tier,
      reason: `${describe(tier, choice)}${escalationNote(base, tier, failures)}`,
      skipped,
    }
  }
  const free = freeLane(list)
  if (free !== null) {
    const ownerOnly = clean.tiers[tier].every((choice) => choice.lane === OWNER)
    return {
      lane: free,
      model: null,
      reasoning: null,
      tier,
      reason: ownerOnly
        ? `The policy sends the ${tier} tier to you, so the first free lane was taken.`
        : `No lane of the ${tier} tier is free, so the first free lane was taken.`,
      skipped,
    }
  }
  return { lane: null, model: null, reasoning: null, tier, reason: 'Every lane is busy or turned off.', skipped }
}
