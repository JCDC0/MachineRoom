import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { createOrchestrators } from '../server/orchestrators.js'
import { chatFileFor } from '../server/orchestrator.js'
import { activeLanesFileFor, writeActiveLanes } from '../server/active-lanes.js'
import { makeTempDir } from './helpers/tempRoot.js'

const cleanup = []
afterEach(() => { while (cleanup.length) cleanup.pop()() })

function setup() {
  const root = makeTempDir('mr-lane-message-sector-')
  const runs = join(root, 'runs')
  mkdirSync(runs)
  writeActiveLanes(activeLanesFileFor(root, runs), ['inside', 'outside'])
  const ladder = { subs: [{ id: 'scout', name: 'Scout', harness: 'opencode', model: '', lanes: ['inside'], scope: [], restricted: false, setBy: 'owner' }] }
  writeFileSync(chatFileFor(root, runs, 'orchestrator'), JSON.stringify({ project: root, messages: [], pending: [], ladder }))
  const inboxes = {
    inside: { lane: 'inside', startedBy: 'scout', startedAt: '2026-01-01T00:00:00Z', inbox: [] },
    outside: { lane: 'outside', startedBy: 'orchestrator', startedAt: '2026-01-01T00:00:00Z', inbox: [] },
  }
  const registry = createOrchestrators({
    projectRoot: root,
    runsFolder: runs,
    lanes: {
      inside: { name: 'Inside', cli: { harness: 'opencode', bin: 'opencode' } },
      outside: { name: 'Outside', cli: { harness: 'opencode', bin: 'opencode' } },
    },
    harnessAvailable: () => true,
    laneTickets: (lane) => (inboxes[lane] ? [inboxes[lane]] : []),
  })
  cleanup.push(() => rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }))
  cleanup.push(() => registry.close())
  return { registry, inboxes }
}

it('refuses a sub token a prefixed lane outside its sector and leaves its inbox empty', async () => {
  const { registry, inboxes } = setup()
  const answer = await registry.message({ to: 'lane:outside', text: 'work' }, false, registry.token('scout'))
  expect(answer.status).toBe(403)
  expect(answer.body).toEqual({ error: 'The Scout sector does not hold the lane outside.' })
  expect(inboxes.outside.inbox).toEqual([])
})

it('lets a sub token message a prefixed lane inside its sector', async () => {
  const { registry, inboxes } = setup()
  const answer = await registry.message({ to: 'lane:inside', text: 'work' }, false, registry.token('scout'))
  expect(answer.status).toBe(202)
  expect(inboxes.inside.inbox).toHaveLength(1)
  expect(inboxes.inside.inbox[0]).toMatchObject({ from: 'sub:scout', text: 'work' })
})

it('lets Main message a prefixed lane outside a sub sector', async () => {
  const { registry, inboxes } = setup()
  const answer = await registry.message({ to: 'lane:outside', text: 'main work' }, false, registry.token('orchestrator'))
  expect(answer.status).toBe(202)
  expect(inboxes.outside.inbox).toHaveLength(1)
  expect(inboxes.outside.inbox[0]).toMatchObject({ from: 'orchestrator', text: 'main work' })
})
