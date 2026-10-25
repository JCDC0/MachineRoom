import { mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import {
  CONFIRM_KEY_PROBLEM,
  CONFIRM_LABEL_PROBLEM,
  KEY_NAME_PROBLEM,
  KEY_VALUE_PROBLEM,
  LABEL_LENGTH_PROBLEM,
  ORIGIN_APPROVE_PROBLEM,
  ORIGIN_DECLINE_PROBLEM,
  ORIGIN_DELETE_KEY_PROBLEM,
  ORIGIN_KEY_PROBLEM,
  ORIGIN_LABEL_PROBLEM,
  buildFamilyNodes,
  labelsFileFor,
  readKey,
  readKeys,
  readLabels,
  readProposals,
} from '../server/family.js'
import { createBridge } from '../server/index.js'
import { NO_TOKEN_PROBLEM } from '../server/orchestrators.js'
import { createClient } from '../src/control/client.js'
import { createMockClient } from '../src/control/mock.js'
import { makeTempDir } from './helpers/tempRoot.js'

const REPO_ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)))
const cleanups = []

afterEach(async () => {
  while (cleanups.length > 0) {
    const fn = cleanups.pop()
    await fn()
  }
})

function tempDir(prefix = 'mr-fam-') {
  const dir = makeTempDir(prefix)
  cleanups.push(() => {
    try {
      rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
    } catch {}
  })
  return dir
}

const SAMPLE_LANES = {
  orchestrator: {
    name: 'Orchestrator',
    harness: 'Claude Code',
    cli: { harness: 'claude', bin: process.execPath, model: 'opus', contextWindow: 200000 },
  },
  opencode: {
    name: 'OpenCode',
    harness: 'OpenCode',
    cli: { harness: 'opencode', bin: process.execPath, model: 'opencode-go/deepseek-v4.1-flash' },
  },
  opencode2: {
    name: 'OpenCode 2',
    harness: 'OpenCode',
    cli: { harness: 'opencode', bin: process.execPath, model: 'opencode-go/deepseek-v4.1-flash' },
  },
  claude: {
    name: 'Claude Code',
    harness: 'Claude Code',
    cli: { harness: 'claude', bin: process.execPath, model: 'sonnet' },
  },
}

async function startBridge({
  projectRoot = tempDir('mr-proj-'),
  runsFolder = tempDir('mr-runs-'),
  lanes = SAMPLE_LANES,
} = {}) {
  mkdirSync(runsFolder, { recursive: true })
  mkdirSync(join(projectRoot, 'docs', 'agents'), { recursive: true })
  const lanesFile = join(projectRoot, 'docs', 'agents', 'lanes.json')
  writeFileSync(lanesFile, JSON.stringify(lanes, null, 2))
  writeFileSync(join(projectRoot, 'docs', 'agents', 'TASKS.md'), '## Open work\n\n**T1. Task (Claude Code).** Brief.\n')

  const promptFile = join(runsFolder, 'prompt.txt')
  writeFileSync(promptFile, 'PROMPT')

  const bridge = createBridge({
    port: 0,
    projectRoot,
    runsFolder,
    lanesFile,
    lanesSource: {
      folder: runsFolder,
      lanes,
      pollMs: 20,
      quietMs: 60000,
    },
    orchestratorPrompt: promptFile,
    orchestratorSpawn: () => {
      throw new Error('No real agent in tests.')
    },
    env: {},
  })

  const { url } = await bridge.start()
  cleanups.push(() => bridge.stop())
  return { bridge, url, projectRoot, runsFolder, lanesFile }
}

async function request(url, { method = 'GET', origin = 'http://localhost:5173', token = '', body = null } = {}) {
  const headers = {}
  if (origin) headers.Origin = origin
  if (token) headers['X-MachineRoom-Orchestrator'] = token
  if (body !== null) headers['Content-Type'] = 'application/json'

  const res = await fetch(url, {
    method,
    headers,
    body: body !== null ? JSON.stringify(body) : undefined,
  })
  const text = await res.text()
  let json = null
  try {
    json = text ? JSON.parse(text) : null
  } catch {}
  return { status: res.status, body: json }
}

describe('buildFamilyNodes pure helper', () => {
  it('builds nodes with defaults when labels file is missing', () => {
    const root = tempDir('mr-bn-')
    const runs = tempDir('mr-bn-runs-')
    const nodes = buildFamilyNodes({
      projectRoot: root,
      runsFolder: runs,
      lanesConfig: SAMPLE_LANES,
    })

    expect(nodes.length).toBeGreaterThanOrEqual(4)
    const main = nodes.find((n) => n.id === 'orchestrator')
    expect(main).toMatchObject({
      id: 'orchestrator',
      kind: 'orchestrator',
      label: 'Orchestrator',
      harness: 'claude',
      model: 'opus',
      parent: null,
      active: true,
      custom: false,
    })
    expect(main.children).toContain('opencode')

    const lane = nodes.find((n) => n.id === 'opencode')
    expect(lane).toMatchObject({
      id: 'opencode',
      kind: 'lane',
      label: 'Code agent',
      parent: 'orchestrator',
      active: true,
      custom: false,
    })
  })

  it('uses custom labels from labels file', () => {
    const root = tempDir('mr-lbl-')
    const runs = tempDir('mr-lbl-runs-')
    const file = labelsFileFor(root, runs)
    writeFileSync(file, JSON.stringify({ orchestrator: 'Boss', opencode: 'Frontend Engineer' }))

    const nodes = buildFamilyNodes({
      projectRoot: root,
      runsFolder: runs,
      lanesConfig: SAMPLE_LANES,
    })
    const main = nodes.find((n) => n.id === 'orchestrator')
    const opencode = nodes.find((n) => n.id === 'opencode')
    expect(main.label).toBe('Boss')
    expect(opencode.label).toBe('Frontend Engineer')
  })
})

describe('GET /api/family and POST /api/family/label', () => {
  it('answers nodes, keys and proposals in family response', async () => {
    const { url } = await startBridge()
    const res = await request(`${url}/api/family`, { origin: '' })
    expect(res.status).toBe(200)
    expect(Array.isArray(res.body.nodes)).toBe(true)
    expect(Array.isArray(res.body.keys)).toBe(true)
    expect(Array.isArray(res.body.proposals)).toBe(true)
  })

  it('sets agent label with confirmed write and page Origin', async () => {
    const { url, projectRoot, runsFolder } = await startBridge()

    const noOrigin = await request(`${url}/api/family/label`, {
      method: 'POST',
      origin: '',
      body: { id: 'opencode', label: 'Backend Agent', confirmed: true },
    })
    expect(noOrigin.status).toBe(403)
    expect(noOrigin.body.error).toBe(ORIGIN_LABEL_PROBLEM)

    const unconfirmed = await request(`${url}/api/family/label`, {
      method: 'POST',
      body: { id: 'opencode', label: 'Backend Agent' },
    })
    expect(unconfirmed.status).toBe(400)
    expect(unconfirmed.body.error).toBe(CONFIRM_LABEL_PROBLEM)

    const tooLong = await request(`${url}/api/family/label`, {
      method: 'POST',
      body: { id: 'opencode', label: 'a'.repeat(45), confirmed: true },
    })
    expect(tooLong.status).toBe(400)
    expect(tooLong.body.error).toBe(LABEL_LENGTH_PROBLEM)

    const ok = await request(`${url}/api/family/label`, {
      method: 'POST',
      body: { id: 'opencode', label: 'Backend Agent', confirmed: true },
    })
    expect(ok.status).toBe(200)
    expect(ok.body).toEqual({ ok: true, id: 'opencode', label: 'Backend Agent' })

    const saved = readLabels(labelsFileFor(projectRoot, runsFolder))
    expect(saved.opencode).toBe('Backend Agent')

    const family = await request(`${url}/api/family`, { origin: '' })
    const opencode = family.body.nodes.find((n) => n.id === 'opencode')
    expect(opencode.label).toBe('Backend Agent')
  })
})

describe('Key slots: /api/keys, /api/keys/NAME/delete and readKey', () => {
  it('rejects writing key without page Origin or confirmation', async () => {
    const { url } = await startBridge()

    const noOrigin = await request(`${url}/api/keys`, {
      method: 'POST',
      origin: '',
      body: { name: 'ANTHROPIC_KEY', value: 'secret-123', confirmed: true },
    })
    expect(noOrigin.status).toBe(403)
    expect(noOrigin.body.error).toBe(ORIGIN_KEY_PROBLEM)

    const unconfirmed = await request(`${url}/api/keys`, {
      method: 'POST',
      body: { name: 'ANTHROPIC_KEY', value: 'secret-123' },
    })
    expect(unconfirmed.status).toBe(400)
    expect(unconfirmed.body.error).toBe(CONFIRM_KEY_PROBLEM)
  })

  it('validates key name and value lengths and characters', async () => {
    const { url } = await startBridge()

    const badName = await request(`${url}/api/keys`, {
      method: 'POST',
      body: { name: 'KEY$INVALID', value: 'secret-123', confirmed: true },
    })
    expect(badName.status).toBe(400)
    expect(badName.body.error).toBe(KEY_NAME_PROBLEM)

    const emptyValue = await request(`${url}/api/keys`, {
      method: 'POST',
      body: { name: 'KEY_ONE', value: '', confirmed: true },
    })
    expect(emptyValue.status).toBe(400)
    expect(emptyValue.body.error).toBe(KEY_VALUE_PROBLEM)

    const longValue = await request(`${url}/api/keys`, {
      method: 'POST',
      body: { name: 'KEY_ONE', value: 'a'.repeat(501), confirmed: true },
    })
    expect(longValue.status).toBe(400)
    expect(longValue.body.error).toBe(KEY_VALUE_PROBLEM)
  })

  it('saves key with mode 0o600 and NEVER returns the value in any response or error', async () => {
    const { url, runsFolder } = await startBridge()
    const secretValue = 'super-secret-token-xyz'

    const saveRes = await request(`${url}/api/keys`, {
      method: 'POST',
      body: { name: 'OPENAI_KEY', value: secretValue, confirmed: true },
    })
    expect(saveRes.status).toBe(200)
    expect(saveRes.body).toEqual({ ok: true, name: 'OPENAI_KEY' })
    expect(JSON.stringify(saveRes.body)).not.toContain(secretValue)

    const keysFile = join(runsFolder, 'keys.json')
    const stats = statSync(keysFile)
    if (process.platform !== 'win32') {
      expect(stats.mode & 0o777).toBe(0o600)
    }

    const listRes = await request(`${url}/api/keys`, { origin: '' })
    expect(listRes.status).toBe(200)
    expect(listRes.body).toEqual([{ name: 'OPENAI_KEY' }])
    expect(JSON.stringify(listRes.body)).not.toContain(secretValue)

    const familyRes = await request(`${url}/api/family`, { origin: '' })
    expect(familyRes.body.keys).toEqual([{ name: 'OPENAI_KEY' }])
    expect(JSON.stringify(familyRes.body)).not.toContain(secretValue)

    expect(readKey(runsFolder, 'OPENAI_KEY')).toBe(secretValue)
    expect(readKey(runsFolder, 'NO_SUCH_KEY')).toBeNull()

    const deleteNoOrigin = await request(`${url}/api/keys/OPENAI_KEY/delete`, {
      method: 'POST',
      origin: '',
      body: { confirmed: true },
    })
    expect(deleteNoOrigin.status).toBe(403)
    expect(deleteNoOrigin.body.error).toBe(ORIGIN_DELETE_KEY_PROBLEM)

    const deleteRes = await request(`${url}/api/keys/OPENAI_KEY/delete`, {
      method: 'POST',
      body: { confirmed: true },
    })
    expect(deleteRes.status).toBe(200)
    expect(deleteRes.body).toEqual({ ok: true, deleted: 'OPENAI_KEY' })
    expect(readKey(runsFolder, 'OPENAI_KEY')).toBeNull()

    const deleteAgain = await request(`${url}/api/keys/OPENAI_KEY/delete`, {
      method: 'POST',
      body: { confirmed: true },
    })
    expect(deleteAgain.status).toBe(404)
  })
})

describe('Proposals: POST /api/family/proposals', () => {
  it('accepts proposal from page and from orchestrator token', async () => {
    const { url, bridge } = await startBridge()
    const orchs = bridge.orchestrators()
    const token = orchs.token('orchestrator')

    const fromPage = await request(`${url}/api/family/proposals`, {
      method: 'POST',
      body: {
        parent: 'orchestrator',
        label: 'Junior Dev',
        harness: 'claude',
        model: 'claude-sonnet-5-5',
        effort: 'low',
        reason: 'To help with tasks.',
      },
    })
    expect(fromPage.status).toBe(200)
    expect(fromPage.body).toMatchObject({
      from: 'owner',
      parent: 'orchestrator',
      label: 'Junior Dev',
      harness: 'claude',
      model: 'claude-sonnet-5-5',
      effort: 'low',
      reason: 'To help with tasks.',
    })

    const fromToken = await request(`${url}/api/family/proposals`, {
      method: 'POST',
      origin: '',
      token,
      body: {
        parent: 'orchestrator',
        label: 'Tester',
        harness: 'opencode',
        model: 'opencode-go/deepseek-v4.1-flash',
        reason: 'For testing.',
      },
    })
    expect(fromToken.status).toBe(200)
    expect(fromToken.body).toMatchObject({
      from: 'orchestrator',
      label: 'Tester',
    })

    const noToken = await request(`${url}/api/family/proposals`, {
      method: 'POST',
      origin: '',
      body: {
        parent: 'orchestrator',
        label: 'Tester',
        harness: 'opencode',
        model: 'opencode-go/deepseek-v4.1-flash',
      },
    })
    expect(noToken.status).toBe(403)
    expect(noToken.body.error).toBe(NO_TOKEN_PROBLEM)
  })

  it('refuses an unavailable harness or an unlisted model with 400', async () => {
    const { url } = await startBridge()

    const badHarness = await request(`${url}/api/family/proposals`, {
      method: 'POST',
      body: {
        label: 'Worker',
        harness: 'unknown-harness',
        model: 'sonnet',
      },
    })
    expect(badHarness.status).toBe(400)

    const badModel = await request(`${url}/api/family/proposals`, {
      method: 'POST',
      body: {
        label: 'Worker',
        harness: 'claude',
        model: 'unlisted-model-xyz',
      },
    })
    expect(badModel.status).toBe(400)
  })

  it('keeps at most 20 pending proposals', async () => {
    const { url } = await startBridge()

    for (let i = 1; i <= 22; i++) {
      const res = await request(`${url}/api/family/proposals`, {
        method: 'POST',
        body: {
          label: `Agent ${i}`,
          harness: 'opencode',
          model: 'opencode-go/deepseek-v4.1-flash',
        },
      })
      expect(res.status).toBe(200)
    }

    const family = await request(`${url}/api/family`, { origin: '' })
    expect(family.body.proposals.length).toBe(20)
    expect(family.body.proposals[0].label).toBe('Agent 3')
    expect(family.body.proposals[19].label).toBe('Agent 22')
  })
})

describe('Approve and decline proposals', () => {
  it('approves proposal, creates lane, and sends room message to proposing orchestrator', async () => {
    const { url, bridge, runsFolder } = await startBridge()
    const orchs = bridge.orchestrators()
    const token = orchs.token('orchestrator')

    const proposed = await request(`${url}/api/family/proposals`, {
      method: 'POST',
      origin: '',
      token,
      body: {
        parent: 'orchestrator',
        label: 'Reviewer',
        harness: 'opencode',
        model: 'opencode-go/deepseek-v4.1-flash',
        reason: 'Review tasks.',
      },
    })
    expect(proposed.status).toBe(200)
    const proposalId = proposed.body.id

    const approveNoOrigin = await request(`${url}/api/family/proposals/${proposalId}/approve`, {
      method: 'POST',
      origin: '',
      body: { confirmed: true },
    })
    expect(approveNoOrigin.status).toBe(403)
    expect(approveNoOrigin.body.error).toBe(ORIGIN_APPROVE_PROBLEM)

    const approve = await request(`${url}/api/family/proposals/${proposalId}/approve`, {
      method: 'POST',
      body: { confirmed: true },
    })
    expect(approve.status).toBe(200)
    expect(approve.body.ok).toBe(true)
    expect(approve.body.lane.name).toBe('Reviewer')

    const remainingProposals = readProposals(runsFolder)
    expect(remainingProposals.some((p) => p.id === proposalId)).toBe(false)

    const orchAnswer = orchs.find('orchestrator').answer()
    const roomMessage = orchAnswer.messages.find((m) => m.from === 'room' && m.text.includes('approved Reviewer'))
    expect(roomMessage).toBeDefined()
    expect(roomMessage.text).toBe('The owner approved Reviewer.')
  })

  it('declines proposal, drops it, and sends room message to proposing orchestrator', async () => {
    const { url, bridge, runsFolder } = await startBridge()
    const orchs = bridge.orchestrators()
    const token = orchs.token('orchestrator')

    const proposed = await request(`${url}/api/family/proposals`, {
      method: 'POST',
      origin: '',
      token,
      body: {
        parent: 'orchestrator',
        label: 'Cleaner',
        harness: 'claude',
        model: 'claude-sonnet-5-5',
        reason: 'Clean logs.',
      },
    })
    expect(proposed.status).toBe(200)
    const proposalId = proposed.body.id

    const declineNoOrigin = await request(`${url}/api/family/proposals/${proposalId}/decline`, {
      method: 'POST',
      origin: '',
      body: { confirmed: true },
    })
    expect(declineNoOrigin.status).toBe(403)
    expect(declineNoOrigin.body.error).toBe(ORIGIN_DECLINE_PROBLEM)

    const decline = await request(`${url}/api/family/proposals/${proposalId}/decline`, {
      method: 'POST',
      body: { confirmed: true },
    })
    expect(decline.status).toBe(200)
    expect(decline.body.ok).toBe(true)

    const remainingProposals = readProposals(runsFolder)
    expect(remainingProposals.some((p) => p.id === proposalId)).toBe(false)

    const orchAnswer = orchs.find('orchestrator').answer()
    const roomMessage = orchAnswer.messages.find((m) => m.from === 'room' && m.text.includes('declined Cleaner'))
    expect(roomMessage).toBeDefined()
    expect(roomMessage.text).toBe('The owner declined Cleaner.')
  })

  it('adds approved lane to parent sub lanes through ladder save', async () => {
    const { url, bridge } = await startBridge()
    const orchs = bridge.orchestrators()
    orchs.ladderChange(
      {
        confirmed: true,
        by: 'owner',
        ladder: {
          subs: [
            {
              id: 'frontend',
              name: 'Frontend',
              harness: 'opencode',
              model: 'opencode-go/deepseek-v4.1-flash',
              lanes: ['opencode'],
              scope: ['src/ui/**'],
              restricted: true,
              setBy: 'owner',
            },
          ],
        },
      },
      true
    )

    const token = orchs.token('orchestrator')
    const proposed = await request(`${url}/api/family/proposals`, {
      method: 'POST',
      origin: '',
      token,
      body: {
        parent: 'frontend',
        label: 'Frontend Assistant',
        harness: 'opencode',
        model: 'opencode-go/deepseek-v4.1-flash',
        reason: 'Work on CSS.',
      },
    })
    expect(proposed.status).toBe(200)

    const approve = await request(`${url}/api/family/proposals/${proposed.body.id}/approve`, {
      method: 'POST',
      body: { confirmed: true },
    })
    expect(approve.status).toBe(200)
    const newKey = approve.body.lane.key

    const currentLadder = orchs.getLadder()
    const sub = currentLadder.subs.find((s) => s.id === 'frontend')
    expect(sub.lanes).toContain(newKey)
  })
})

describe('turned-off lanes in the family tree', () => {
  function bridgeClient(url) {
    return createClient({
      baseUrl: url,
      fetchImpl: (input, init) =>
        fetch(input, { ...init, headers: { ...init?.headers, origin: 'http://localhost:5173' } }),
    })
  }

  it('keeps every eligible lane in the nodes and children with active false', async () => {
    const { url } = await startBridge()
    const client = bridgeClient(url)

    await client.setActiveLanes({ lanes: ['opencode2'], confirmed: true })

    const family = await client.family()
    const ids = family.nodes.map((node) => node.id)
    expect(ids).toContain('opencode')
    expect(ids).toContain('claude')
    expect(family.nodes.find((node) => node.id === 'opencode').active).toBe(false)
    expect(family.nodes.find((node) => node.id === 'claude').active).toBe(false)
    expect(family.nodes.find((node) => node.id === 'opencode2').active).toBe(true)

    const main = family.nodes.find((node) => node.id === 'orchestrator')
    expect(main.children).toContain('opencode')
    expect(main.children).toContain('opencode2')
    expect(main.children).toContain('claude')

    const agents = await request(`${url}/api/agents`, { origin: '' })
    expect(agents.body.map((agent) => agent.key)).not.toContain('opencode')
    expect(agents.body.map((agent) => agent.key)).toContain('opencode2')
  })

  it('keeps the tree when the owner turns off the last active lane, and the mock does the same', async () => {
    const { url } = await startBridge()
    const client = bridgeClient(url)

    await client.setActiveLanes({ lanes: [], confirmed: true })

    const family = await client.family()
    expect(family.nodes.filter((node) => node.kind === 'lane')).toHaveLength(3)
    expect(family.nodes.filter((node) => node.kind === 'lane').every((node) => node.active === false)).toBe(true)
    const main = family.nodes.find((node) => node.id === 'orchestrator')
    expect(main.children).toEqual(expect.arrayContaining(['opencode', 'opencode2', 'claude']))

    const mock = createMockClient({ latencyMs: 0 })
    await mock.setActiveLanes({ lanes: [], confirmed: true })
    const mockFamily = await mock.family()
    expect(mockFamily.nodes.filter((node) => node.kind === 'lane')).toHaveLength(5)
    expect(mockFamily.nodes.filter((node) => node.kind === 'lane').every((node) => node.active === false)).toBe(true)
    expect((await mock.agents()).length).toBe(0)
  })

  it('deletes any lane except the orchestrator on the mock', async () => {
    const mock = createMockClient({ latencyMs: 0 })
    await mock.deleteLane({ key: 'opencode3', confirmed: true })
    const family = await mock.family()
    expect(family.nodes.some((node) => node.id === 'opencode3')).toBe(false)
    const sub = family.nodes.find((node) => node.id === 'frontend')
    expect(sub.children).not.toContain('opencode3')
    await expect(mock.deleteLane({ key: 'orchestrator', confirmed: true })).rejects.toThrow(
      'A lane from lanes.json cannot be deleted; make it inactive instead.'
    )
  })
})

describe('Control client and mock family methods', () => {
  it('calls family methods on mock client', async () => {
    const mock = createMockClient({ latencyMs: 0 })

    const fam = await mock.family()
    expect(fam.nodes.length).toBeGreaterThan(0)
    expect(fam.keys).toEqual([])
    expect(fam.proposals).toEqual([])

    await mock.setAgentLabel({ id: 'opencode', label: 'Lead Developer' })
    const famAfterLabel = await mock.family()
    const opencode = famAfterLabel.nodes.find((n) => n.id === 'opencode')
    expect(opencode.label).toBe('Lead Developer')

    await mock.setKey({ name: 'TEST_KEY', value: 'secret' })
    const keys = await mock.keys()
    expect(keys).toEqual([{ name: 'TEST_KEY' }])

    await mock.deleteKey({ name: 'TEST_KEY' })
    const keysAfterDelete = await mock.keys()
    expect(keysAfterDelete).toEqual([])
  })

  it('calls family methods on bridge client', async () => {
    const { url } = await startBridge()
    const client = createClient({
      baseUrl: url,
      fetchImpl: (input, init) =>
        fetch(input, { ...init, headers: { ...init?.headers, origin: 'http://localhost:5173' } }),
    })

    const fam = await client.family()
    expect(fam.nodes.length).toBeGreaterThan(0)

    await client.setAgentLabel({ id: 'opencode', label: 'Bridge Coder' })
    const famAfterLabel = await client.family()
    const opencode = famAfterLabel.nodes.find((n) => n.id === 'opencode')
    expect(opencode.label).toBe('Bridge Coder')

    await client.setKey({ name: 'API_KEY', value: 'my-value' })
    const keys = await client.keys()
    expect(keys).toEqual([{ name: 'API_KEY' }])

    await client.deleteKey({ name: 'API_KEY' })
    const keysAfterDelete = await client.keys()
    expect(keysAfterDelete).toEqual([])
  })
})
