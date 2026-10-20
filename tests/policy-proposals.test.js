import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { readPolicy } from '../src/policy/route.js'
import { policyDiff, policyText, proposePolicy } from '../src/policy/proposals.js'
import { makeTempDir as makeTempRoot } from './helpers/tempRoot.js'

const POLICY_TEXT = readFileSync(new URL('../docs/agents/policy.json', import.meta.url), 'utf8')
const NO_GIT_CONFIG = join(tmpdir(), 'machineroom-policy-no-git-config')
const LIMITS = { runUsd: 0.25, issueUsd: 1, agentMonthlyUsd: 10, companyMonthlyUsd: 30, maxTurnsPerRun: 200, timeoutSec: 3600 }
const cleanups = []

afterEach(() => {
  while (cleanups.length > 0) {
    const fn = cleanups.pop()
    fn()
  }
})

function makeTempDir() {
  const dir = makeTempRoot('mr-policy-')
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }))
  return dir
}

function git(cwd, args) {
  return execFileSync('git', args, {
    cwd,
    shell: false,
    windowsHide: true,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      GIT_CONFIG_SYSTEM: NO_GIT_CONFIG,
      GIT_CONFIG_GLOBAL: NO_GIT_CONFIG,
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_TERMINAL_PROMPT: '0',
    },
  })
}

const A = { lane: 'hermes', model: 'deepseek/deepseek-v4.1-flash-1017', reasoning: 'xhigh', provider: 'openrouter' }
const B = { lane: 'hermes', model: 'minimax/minimax-m3.1-flash:free', reasoning: 'high', provider: 'openrouter' }
const OWNER = { lane: 'owner', model: null, reasoning: null, provider: null }

function choice(lane, model) {
  return { lane, model, reasoning: 'high', provider: 'openrouter' }
}

function policyOf(small, medium = [choice('opencode', 'opencode-go/deepseek-v4.1-flash')], large = [choice('agy', 'Gemini 4 Argon (Medium)')]) {
  return { tiers: { small, medium, large }, limits: { ...LIMITS }, quotaSkipPercent: 90 }
}

function row(lane, model, merged, rejected, costPerMerge) {
  const decided = merged + rejected
  return {
    lane,
    model,
    runs: decided,
    merged,
    rejected,
    pending: 0,
    mergeRate: decided === 0 ? null : merged / decided,
    averageFixes: null,
    costUsd: 0,
    decidedCostUsd: 0,
    costPerMerge,
  }
}

function smallNotes(answer) {
  return answer.notes.filter((note) => note.startsWith('The small tier'))
}

describe('proposePolicy', () => {
  it('moves a choice with a better merge rate and no higher cost ahead', () => {
    const answer = proposePolicy({
      policy: policyOf([A, B]),
      rows: [row(A.lane, A.model, 14, 6, 0.05), row(B.lane, B.model, 11, 1, 0.03)],
    })
    expect(answer.changes).toEqual([
      'Move hermes on minimax/minimax-m3.1-flash:free ahead of hermes on deepseek/deepseek-v4.1-flash-1017 in the small tier: 92% merged over 12 decided runs against 70% over 20, $0.03 a merge against $0.05.',
    ])
    expect(answer.policy.tiers.small).toEqual([B, A])
    expect(smallNotes(answer)).toEqual([])
    expect(readPolicy(answer.policy)).toEqual(answer.policy)
  })

  it('keeps the order when the later choice has too few decided runs', () => {
    const answer = proposePolicy({
      policy: policyOf([A, B]),
      rows: [row(A.lane, A.model, 10, 2, 0.05), row(B.lane, B.model, 8, 1, 0.03)],
    })
    expect(answer.changes).toEqual([])
    expect(answer.policy.tiers.small).toEqual([A, B])
    expect(smallNotes(answer)).toEqual([
      'The small tier keeps its order: hermes on minimax/minimax-m3.1-flash:free has 9 decided runs, fewer than 10.',
    ])
  })

  it('keeps the order when the merge rate is less than the margin ahead', () => {
    const answer = proposePolicy({
      policy: policyOf([A, B]),
      rows: [row(A.lane, A.model, 14, 6, 0.05), row(B.lane, B.model, 8, 2, 0.03)],
    })
    expect(answer.changes).toEqual([])
    expect(smallNotes(answer)).toEqual([
      'The small tier keeps its order: hermes on minimax/minimax-m3.1-flash:free merges 80% against 70% for hermes on deepseek/deepseek-v4.1-flash-1017, less than 15 points ahead.',
    ])
  })

  it('keeps the order when the later choice costs more a merge', () => {
    const answer = proposePolicy({
      policy: policyOf([A, B]),
      rows: [row(A.lane, A.model, 10, 10, 0.03), row(B.lane, B.model, 11, 1, 0.05)],
    })
    expect(answer.changes).toEqual([])
    expect(smallNotes(answer)).toEqual([
      'The small tier keeps its order: hermes on minimax/minimax-m3.1-flash:free costs $0.05 a merge against $0.03 for hermes on deepseek/deepseek-v4.1-flash-1017.',
    ])
  })

  it('treats a null cost as the highest cost', () => {
    const answer = proposePolicy({
      policy: policyOf([A, B]),
      rows: [row(A.lane, A.model, 10, 10, 0.03), row(B.lane, B.model, 11, 1, null)],
    })
    expect(answer.changes).toEqual([])
    expect(smallNotes(answer)).toEqual([
      'The small tier keeps its order: hermes on minimax/minimax-m3.1-flash:free costs no cost a merge against $0.03 for hermes on deepseek/deepseek-v4.1-flash-1017.',
    ])
  })

  it('never moves the owner choice', () => {
    const rows = [row('agy', 'Gemini 4 Argon (Medium)', 11, 1, 0.03)]
    const after = proposePolicy({ policy: policyOf([choice('agy', 'Gemini 4 Argon (Medium)'), OWNER]), rows })
    expect(after.changes).toEqual([])
    expect(after.policy.tiers.small).toEqual([choice('agy', 'Gemini 4 Argon (Medium)'), OWNER])
    expect(smallNotes(after)).toEqual(['The small tier keeps its order: the owner choice stays where it is.'])

    const before = proposePolicy({ policy: policyOf([OWNER, choice('agy', 'Gemini 4 Argon (Medium)')]), rows })
    expect(before.changes).toEqual([])
    expect(before.policy.tiers.small).toEqual([OWNER, choice('agy', 'Gemini 4 Argon (Medium)')])
    expect(smallNotes(before)).toEqual(['The small tier keeps its order: the owner choice stays where it is.'])
  })

  it('swaps at most one pair in a tier', () => {
    const first = choice('hermes', 'model-a')
    const second = choice('hermes', 'model-b')
    const third = choice('hermes', 'model-c')
    const answer = proposePolicy({
      policy: policyOf([first, second, third]),
      rows: [
        row('hermes', 'model-a', 10, 10, 0.05),
        row('hermes', 'model-b', 11, 1, 0.03),
        row('hermes', 'model-c', 12, 0, 0.02),
      ],
    })
    expect(answer.changes).toEqual([
      'Move hermes on model-b ahead of hermes on model-a in the small tier: 92% merged over 12 decided runs against 50% over 20, $0.03 a merge against $0.05.',
    ])
    expect(answer.policy.tiers.small).toEqual([second, first, third])
  })

  it('leaves limits and quotaSkipPercent alone and changes no choice', () => {
    const rows = [
      row(A.lane, A.model, 14, 6, 0.05),
      row(B.lane, B.model, 11, 1, 0.03),
      row('opencode', 'opencode-go/deepseek-v4.1-flash', 10, 10, 0.04),
    ]
    const answer = proposePolicy({ policy: POLICY_TEXT, rows })
    const before = readPolicy(POLICY_TEXT)
    expect(answer.changes).toHaveLength(1)
    expect(answer.policy.limits).toEqual(before.limits)
    expect(answer.policy.quotaSkipPercent).toBe(before.quotaSkipPercent)
    for (const tier of ['small', 'medium', 'large']) {
      const was = before.tiers[tier].map((entry) => `${entry.lane}|${entry.model}`).sort()
      const now = answer.policy.tiers[tier].map((entry) => `${entry.lane}|${entry.model}`).sort()
      expect(now).toEqual(was)
    }
  })

  it('takes the defaults when it is given no rows', () => {
    const answer = proposePolicy({ policy: POLICY_TEXT })
    expect(answer.changes).toEqual([])
    expect(readPolicy(answer.policy)).toEqual(readPolicy(POLICY_TEXT))
  })
})

describe('policyText', () => {
  it('writes the real policy file back unchanged', () => {
    expect(policyText(readPolicy(POLICY_TEXT))).toBe(POLICY_TEXT)
  })

  it('ends with one newline', () => {
    expect(policyText({ tiers: {}, limits: {}, quotaSkipPercent: 0 })).toBe('{\n  "tiers": {},\n  "limits": {},\n  "quotaSkipPercent": 0\n}\n')
  })
})

describe('policyDiff', () => {
  it('gives an empty string when the texts match', () => {
    const text = policyText(readPolicy(POLICY_TEXT))
    expect(policyDiff(text, text)).toBe('')
  })

  it('writes a diff with the policy headers and three lines of context', () => {
    const rows = [
      row(A.lane, A.model, 14, 6, 0.05),
      row(B.lane, B.model, 11, 1, 0.03),
      row('opencode', 'opencode-go/deepseek-v4.1-flash', 10, 10, 0.04),
    ]
    const before = policyText(readPolicy(POLICY_TEXT))
    const after = policyText(proposePolicy({ policy: POLICY_TEXT, rows }).policy)
    const diff = policyDiff(before, after)
    const lines = diff.split('\n')
    expect(lines[0]).toBe('--- a/docs/agents/policy.json')
    expect(lines[1]).toBe('+++ b/docs/agents/policy.json')
    expect(lines[2].startsWith('@@ ')).toBe(true)
    expect(lines.slice(3, 6).every((line) => line.startsWith(' '))).toBe(true)
    expect(lines).toContain('-        "model": "deepseek/deepseek-v4.1-flash-1017",')
    expect(lines).toContain('+        "model": "minimax/minimax-m3.1-flash:free",')
  })

  it('writes a diff that git apply takes', () => {
    const dir = makeTempDir()
    const file = join(dir, 'docs', 'agents', 'policy.json')
    mkdirSync(dirname(file), { recursive: true })
    const rows = [
      row(A.lane, A.model, 14, 6, 0.05),
      row(B.lane, B.model, 11, 1, 0.03),
      row('opencode', 'opencode-go/deepseek-v4.1-flash', 10, 10, 0.04),
    ]
    const before = policyText(readPolicy(POLICY_TEXT))
    const after = policyText(proposePolicy({ policy: POLICY_TEXT, rows }).policy)
    writeFileSync(file, before)
    writeFileSync(join(dir, 'policy.patch'), policyDiff(before, after))
    git(dir, ['init', '-b', 'main'])
    git(dir, ['apply', '--check', 'policy.patch'])
    git(dir, ['apply', 'policy.patch'])
    expect(readFileSync(file, 'utf8')).toBe(after)
  })

  it('writes a second hunk when the change is far from the first', () => {
    const rows = [
      row(A.lane, A.model, 14, 6, 0.05),
      row(B.lane, B.model, 11, 1, 0.03),
      row('opencode', 'opencode-go/deepseek-v4.1-flash', 10, 10, 0.04),
    ]
    const before = policyText(readPolicy(POLICY_TEXT))
    const swapped = policyText(proposePolicy({ policy: POLICY_TEXT, rows }).policy)
    const after = swapped
      .split('\n')
      .map((line) => (line === '  "quotaSkipPercent": 90' ? '  "quotaSkipPercent": 91' : line))
      .join('\n')
    const diff = policyDiff(before, after)
    expect(diff.split('\n').filter((line) => line.startsWith('@@ '))).toHaveLength(2)
  })
})
