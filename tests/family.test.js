import { mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import {
  CONFIRM_KEY_PROBLEM,
  CONFIRM_LABEL_PROBLEM,
  CONFIRM_SEATS_PROBLEM,
  CONFIRM_TOP_PROBLEM,
  KEY_NAME_PROBLEM,
  KEY_VALUE_PROBLEM,
  LABEL_LENGTH_PROBLEM,
  ORIGIN_APPROVE_PROBLEM,
  ORIGIN_DECLINE_PROBLEM,
  ORIGIN_DELETE_KEY_PROBLEM,
  ORIGIN_KEY_PROBLEM,
  ORIGIN_LABEL_PROBLEM,
  ORIGIN_SEATS_PROBLEM,
  ORIGIN_TOP_PROBLEM,
  SEATS_SHAPE_PROBLEM,
  buildFamilyNodes,
  createFamilyApi,
  familySeatsFor,
  keyFromFile,
  labelsFileFor,
  readKey,
  readKeys,
  readLabels,
  readProposals,
  saveProposals,
  topFileFor,
} from '../server/family.js'
import { readAgentsConfig } from '../server/agents-config.js'
import { projectLanesFileFor } from '../server/active-lanes.js'
import { createBridge } from '../server/index.js'
import { saveEndpoints } from '../server/endpoints.js'
import { NO_TOKEN_PROBLEM } from '../server/orchestrators.js'
import { readSeats, seatCheck, seatsFileFor } from '../server/seats.js'
import { createClient } from '../src/control/client.js'
import { createMockClient } from '../src/control/mock.js'
import { childFormProblem } from '../src/ui/family.js'
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
      label: 'OpenCode',
      parent: 'orchestrator',
      active: false,
      custom: false,
    })
  })

  it('falls back to the lane name and then Code agent', () => {
    const root = tempDir('mr-bn-name-')
    const runs = tempDir('mr-bn-name-runs-')
    const lanes = {
      ...SAMPLE_LANES,
      opencode: { name: '  ', cli: { harness: 'opencode', bin: process.execPath, model: 'opencode-go/deepseek-v4.1-flash' } },
      opencode2: { cli: { harness: 'opencode', bin: process.execPath, model: 'opencode-go/deepseek-v4.1-flash' } },
    }
    const nodes = buildFamilyNodes({ projectRoot: root, runsFolder: runs, lanesConfig: lanes })
    expect(nodes.find((n) => n.id === 'opencode').label).toBe('Code agent')
    expect(nodes.find((n) => n.id === 'opencode2').label).toBe('opencode2')
    expect(nodes.find((n) => n.id === 'claude').label).toBe('Claude Code')
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

  it('adds built-in AGY lanes as active manual rows and skips retired, hidden and duplicate custom ones', () => {
    const root = tempDir('mr-agy-')
    const runs = tempDir('mr-agy-runs-')
    writeFileSync(projectLanesFileFor(root, runs), JSON.stringify({ hidden: ['agyHidden'] }))
    const lanes = {
      ...SAMPLE_LANES,
      agy3: { cli: { harness: 'agy', model: 'gemini-4-neon-high' } },
      agyRetired: { name: 'Retired AGY', retired: true, cli: { harness: 'agy', model: 'gemini-4-neon-high' } },
      agyHidden: { name: 'Hidden AGY', cli: { harness: 'agy', model: 'gemini-4-neon-high' } },
      agyCustom: { name: 'Custom AGY', custom: true, cli: { harness: 'agy', model: 'gemini-4-neon-high' } },
    }

    const nodes = buildFamilyNodes({
      projectRoot: root,
      runsFolder: runs,
      lanesConfig: lanes,
      isWorking: (key) => key === 'agy3',
    })

    const opencode = nodes.find((n) => n.id === 'opencode')
    const agy3 = nodes.find((n) => n.id === 'agy3')
    expect(agy3).toMatchObject({
      id: 'agy3',
      kind: 'lane',
      label: 'agy3',
      harness: 'agy',
      model: 'gemini-4-neon-high',
      effort: null,
      mode: null,
      parent: opencode.parent,
      active: true,
      working: true,
      custom: false,
      manual: true,
    })
    const parent = nodes.find((n) => n.id === opencode.parent)
    expect(parent.children).toContain('agy3')

    expect(nodes.some((n) => n.id === 'agyRetired')).toBe(false)
    expect(nodes.some((n) => n.id === 'agyHidden')).toBe(false)

    const customRows = nodes.filter((n) => n.id === 'agyCustom')
    expect(customRows).toHaveLength(1)
    expect(customRows[0]).toMatchObject({ id: 'agyCustom', custom: true, active: false })
    expect(customRows[0].manual).toBeUndefined()

    writeFileSync(topFileFor(root, runs), JSON.stringify({ top: 'claude-session' }))
    const sessionNodes = buildFamilyNodes({
      projectRoot: root,
      runsFolder: runs,
      lanesConfig: lanes,
      isWorking: () => false,
      hideIdleMain: true,
    })
    expect(sessionNodes.find((n) => n.id === 'agy3').parent).toBe('session:claude-session')
    expect(sessionNodes[0].children).toContain('agy3')
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

describe('ring seats in GET /api/family and POST /api/family/seats', () => {
  it('answers one seats row per ring up to the subagent depth', async () => {
    const { url } = await startBridge()
    const res = await request(`${url}/api/family`, { origin: '' })
    expect(res.status).toBe(200)
    expect(res.body.seats.map((row) => row.ring)).toEqual([0, 1])
    expect(res.body.seats.every((row) => row.limit === null)).toBe(true)
    expect(res.body.seats.every((row) => Number.isInteger(row.taken) && row.taken >= 0)).toBe(true)
  })

  it('saves the ring seats from a confirmed page request and answers the new rows', async () => {
    const { url, projectRoot, runsFolder } = await startBridge()
    const ok = await request(`${url}/api/family/seats`, {
      method: 'POST',
      body: { rings: [2, null], confirmed: true },
    })
    expect(ok.status).toBe(200)
    expect(ok.body.ok).toBe(true)
    expect(ok.body.seats.map((row) => [row.ring, row.limit])).toEqual([[0, 2], [1, null]])
    expect(readSeats(seatsFileFor(projectRoot, runsFolder)).rings).toEqual([2, null])

    const rest = await request(`${url}/api/family`, { origin: '' })
    expect(rest.body.seats.map((row) => row.limit)).toEqual([2, null])
  })

  it('refuses a lane ticket and a page request without a confirm', async () => {
    const { url } = await startBridge()
    const ticket = await request(`${url}/api/family/seats`, {
      method: 'POST',
      origin: '',
      token: 'a-lane-ticket',
      body: { rings: [1], confirmed: true },
    })
    expect(ticket.status).toBe(403)
    expect(ticket.body.error).toBe(ORIGIN_SEATS_PROBLEM)
    expect(ticket.body.error).toBe('A request to set the seats needs a page Origin.')

    const unconfirmed = await request(`${url}/api/family/seats`, {
      method: 'POST',
      body: { rings: [1] },
    })
    expect(unconfirmed.status).toBe(400)
    expect(unconfirmed.body.error).toBe(CONFIRM_SEATS_PROBLEM)
    expect(unconfirmed.body.error).toBe('Confirm the seats first.')
  })

  it('refuses rings that are not whole numbers from 0, or longer than the depth', async () => {
    const { url, projectRoot, runsFolder } = await startBridge()
    const bad = await request(`${url}/api/family/seats`, {
      method: 'POST',
      body: { rings: [2, -1], confirmed: true },
    })
    expect(bad.status).toBe(400)
    expect(bad.body.error).toBe(SEATS_SHAPE_PROBLEM)
    const long = await request(`${url}/api/family/seats`, {
      method: 'POST',
      body: { rings: [1, 1, 1], confirmed: true },
    })
    expect(long.status).toBe(400)
    expect(long.body.error).toBe(SEATS_SHAPE_PROBLEM)
    expect(readSeats(seatsFileFor(projectRoot, runsFolder)).rings).toEqual([])
  })
})

describe('sub orchestrator labels and the ladder round trip', () => {
  const FRONTEND = {
    id: 'frontend',
    name: 'Frontend',
    harness: 'opencode',
    model: 'opencode-go/deepseek-v4.1-flash',
    lanes: ['opencode', 'opencode2'],
    scope: ['src/ui/**'],
    restricted: false,
    setBy: 'owner',
  }

  function setLadder(orchestrators, subs) {
    const result = orchestrators.ladderChange({ confirmed: true, by: 'owner', ladder: { subs } }, true)
    expect(result.status).toBe(200)
  }

  it('labels a sub from its custom label, then its name, then the default', () => {
    const root = tempDir('mr-sub-')
    const runs = tempDir('mr-sub-runs-')
    const orchestrators = {
      getLadder: () => ({
        subs: [
          { id: 'frontend', name: 'Frontend', lanes: ['opencode'] },
          { id: 'plain', lanes: [] },
        ],
      }),
    }

    const nodes = buildFamilyNodes({ projectRoot: root, runsFolder: runs, lanesConfig: SAMPLE_LANES, orchestrators })
    expect(nodes.find((node) => node.id === 'frontend')).toMatchObject({ label: 'Frontend', custom: false })
    expect(nodes.find((node) => node.id === 'plain')).toMatchObject({ label: 'Sub orchestrator', custom: false })

    writeFileSync(labelsFileFor(root, runs), JSON.stringify({ frontend: 'Interface Lead' }))

    const labelled = buildFamilyNodes({ projectRoot: root, runsFolder: runs, lanesConfig: SAMPLE_LANES, orchestrators })
    expect(labelled.find((node) => node.id === 'frontend')).toMatchObject({ label: 'Interface Lead', custom: true })
    expect(labelled.find((node) => node.id === 'plain').custom).toBe(false)
  })

  it('renames a sub orchestrator through POST /api/family/label', async () => {
    const { url, bridge } = await startBridge()
    setLadder(bridge.orchestrators(), [FRONTEND])

    const rename = await request(`${url}/api/family/label`, {
      method: 'POST',
      body: { id: 'frontend', label: 'Interface Lead', confirmed: true },
    })
    expect(rename.status).toBe(200)
    expect(rename.body).toEqual({ ok: true, id: 'frontend', label: 'Interface Lead' })

    const family = await request(`${url}/api/family`, { origin: '' })
    const sub = family.body.nodes.find((node) => node.id === 'frontend')
    expect(sub).toMatchObject({ kind: 'sub', label: 'Interface Lead', custom: true, parent: 'orchestrator' })
    expect(family.body.nodes.find((node) => node.id === 'orchestrator').children).toContain('frontend')
  })

  it('groups existing opencode lanes under a sub orchestrator through ladderChange', async () => {
    const { url, bridge } = await startBridge()
    setLadder(bridge.orchestrators(), [FRONTEND])

    const family = await request(`${url}/api/family`, { origin: '' })
    const sub = family.body.nodes.find((node) => node.id === 'frontend')
    expect(sub.kind).toBe('sub')
    expect(sub.children).toEqual(['opencode', 'opencode2'])

    const root = family.body.nodes.find((node) => node.id === 'orchestrator')
    expect(root.children).toContain('frontend')
    expect(root.children).not.toContain('opencode')
    expect(family.body.nodes.find((node) => node.id === 'opencode').parent).toBe('frontend')
    expect(family.body.nodes.find((node) => node.id === 'opencode2').parent).toBe('frontend')
    expect(family.body.nodes.find((node) => node.id === 'claude').parent).toBe('orchestrator')
  })

  it('returns a removed sub orchestrator lanes to the orchestrator', async () => {
    const { url, bridge } = await startBridge()
    const orchs = bridge.orchestrators()
    setLadder(orchs, [FRONTEND])
    setLadder(orchs, [])

    const family = await request(`${url}/api/family`, { origin: '' })
    expect(family.body.nodes.some((node) => node.id === 'frontend')).toBe(false)

    const root = family.body.nodes.find((node) => node.id === 'orchestrator')
    expect(root.children).toEqual(expect.arrayContaining(['opencode', 'opencode2']))
    expect(family.body.nodes.find((node) => node.id === 'opencode').parent).toBe('orchestrator')
    expect(family.body.nodes.find((node) => node.id === 'opencode2').parent).toBe('orchestrator')
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
    expect(deleteAgain.body.error).toBe('The key OPENAI_KEY was not found.')
  })

  it('reads keys from both a map and a list of key objects', () => {
    const runsFolder = tempDir('mr-readkeys-')
    const file = join(runsFolder, 'keys.json')

    writeFileSync(file, JSON.stringify({ slot_a: 'val_a', slot_b: 'val_b' }))
    expect(readKeys(runsFolder)).toEqual({ slot_a: 'val_a', slot_b: 'val_b' })
    expect(readKey(runsFolder, 'slot_a')).toBe('val_a')
    expect(readKey(runsFolder, 'missing')).toBeNull()
    expect(keyFromFile(runsFolder, 'slot_a')).toBe('val_a')
    expect(keyFromFile(runsFolder, 'missing')).toBe('')

    writeFileSync(file, JSON.stringify({ keys: { slot_a: 'val_a' } }))
    expect(readKeys(runsFolder)).toEqual({ slot_a: 'val_a' })
    expect(readKey(runsFolder, 'slot_a')).toBe('val_a')
    expect(keyFromFile(runsFolder, 'slot_a')).toBe('val_a')

    writeFileSync(file, JSON.stringify({ keys: [{ name: 'slot_a', value: 'val_a' }, { name: 'slot_b', value: 'val_b' }] }))
    expect(readKeys(runsFolder)).toEqual({ slot_a: 'val_a', slot_b: 'val_b' })
    expect(readKey(runsFolder, 'slot_a')).toBe('val_a')
    expect(readKey(runsFolder, 'slot_b')).toBe('val_b')
    expect(keyFromFile(runsFolder, 'slot_a')).toBe('val_a')
    expect(keyFromFile(runsFolder, 'slot_b')).toBe('val_b')

    writeFileSync(file, JSON.stringify([{ name: 'slot_a', value: 'val_a' }]))
    expect(readKeys(runsFolder)).toEqual({ slot_a: 'val_a' })
    expect(readKey(runsFolder, 'slot_a')).toBe('val_a')
    expect(keyFromFile(runsFolder, 'slot_a')).toBe('val_a')
  })

  it('ensures readKey and keyFromFile never disagree', () => {
    const runsFolder = tempDir('mr-readkeys-agree-')
    const file = join(runsFolder, 'keys.json')

    const shapes = [
      { slot_one: 'alpha' },
      { keys: { slot_one: 'alpha' } },
      { keys: [{ name: 'slot_one', value: 'alpha' }] },
      [{ name: 'slot_one', value: 'alpha' }],
    ]

    for (const shape of shapes) {
      writeFileSync(file, JSON.stringify(shape))
      expect(keyFromFile(runsFolder, 'slot_one')).toBe(readKey(runsFolder, 'slot_one') ?? '')
      expect(keyFromFile(runsFolder, 'missing')).toBe(readKey(runsFolder, 'missing') ?? '')
    }
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
        harness: 'claude',
        model: 'claude-haiku-5-5',
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

  it('accepts a machineroom proposal when an endpoint is saved', async () => {
    const { url, runsFolder } = await startBridge()

    const noEndpoint = await request(`${url}/api/family/proposals`, {
      method: 'POST',
      body: {
        label: 'Direct Worker',
        harness: 'machineroom',
        model: 'Work/alpha',
      },
    })
    expect(noEndpoint.status).toBe(400)
    expect(noEndpoint.body.error).toBe('Add a Direct API key in Settings first.')

    saveEndpoints(runsFolder, [
      {
        name: 'Work',
        provider: 'OpenRouter',
        baseUrl: 'https://openrouter.ai/api/v1',
        keyName: 'openrouter',
        models: ['alpha'],
      },
    ])
    const accepted = await request(`${url}/api/family/proposals`, {
      method: 'POST',
      body: {
        label: 'Direct Worker',
        harness: 'machineroom',
        model: 'Work/alpha',
      },
    })
    expect(accepted.status).toBe(200)
    expect(accepted.body).toMatchObject({ label: 'Direct Worker', harness: 'machineroom', model: 'Work/alpha' })
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
        harness: 'claude',
        model: 'claude-sonnet-5-5',
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

  it('rolls back the new lane and keeps the proposal when the ladder write fails', async () => {
    const runsDir = tempDir('mr-fam-rollback-')
    const proposal = {
      id: 'proposal-1',
      from: 'orchestrator',
      parent: 'frontend',
      label: 'Reviewer',
      harness: 'opencode',
      model: 'opencode-go/deepseek-v4.1-flash',
      effort: null,
      reason: 'Review tasks.',
      createdAt: new Date().toISOString(),
    }
    saveProposals(runsDir, [proposal])
    const response = {}
    const api = createFamilyApi({
      runsFolder: runsDir,
      projectRoot: '',
      lanes: () => SAMPLE_LANES,
      env: { ...process.env, PATH: process.env.PATH },
      activeLanes: null,
      orchestrators: () => ({
        getLadder: () => ({ subs: [{ id: 'frontend', name: 'Frontend', lanes: [] }] }),
        ladderChange: () => ({ status: 400, body: { error: 'The ladder is not an object.' } }),
        find: () => null,
      }),
      sendJson: (req, res, status, body) => {
        response.status = status
        response.body = body
      },
      readJsonBody: async () => ({ confirmed: true }),
    })

    const handled = await api.handle(
      { method: 'POST', headers: { origin: 'http://localhost:5173' } },
      {},
      new URL('http://127.0.0.1/api/family/proposals/proposal-1/approve')
    )
    expect(handled).toBe(true)
    expect(response).toEqual({ status: 400, body: { error: 'The ladder is not an object.' } })
    expect(readProposals(runsDir).some((item) => item.id === 'proposal-1')).toBe(true)
    expect(readAgentsConfig(runsDir).agents).toHaveLength(0)
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
        harness: 'claude',
        model: 'claude-sonnet-5-5',
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
    expect(agents.body.map((agent) => agent.key)).not.toContain('opencode2')
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

  it('removes a lanes.json lane from the mock project and can show it again', async () => {
    const mock = createMockClient({ latencyMs: 0 })
    await mock.deleteLane({ key: 'opencode3', confirmed: true })
    const family = await mock.family()
    expect(family.nodes.some((node) => node.id === 'opencode3')).toBe(false)
    const sub = family.nodes.find((node) => node.id === 'frontend')
    expect(sub.children).not.toContain('opencode3')
    const hidden = (await mock.lanes()).lanes.find((lane) => lane.key === 'opencode3')
    expect(hidden.hidden).toBe(true)
    expect(hidden.active).toBe(false)

    await mock.showLane({ key: 'opencode3', confirmed: true })
    expect((await mock.family()).nodes.some((node) => node.id === 'opencode3')).toBe(true)

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

  it('keeps the ring seats in the mock and answers the same shape', async () => {
    const mock = createMockClient({ latencyMs: 0 })

    const before = await mock.family()
    expect(before.seats.map((row) => row.ring)).toEqual([0, 1])
    expect(before.seats.every((row) => row.limit === null)).toBe(true)

    const saved = await mock.setRingSeats({ rings: [2, null] })
    expect(saved.ok).toBe(true)
    expect(saved.seats.map((row) => row.limit)).toEqual([2, null])

    const after = await mock.family()
    expect(after.seats.map((row) => row.limit)).toEqual([2, null])

    await expect(mock.setRingSeats({ rings: [-1], confirmed: true })).rejects.toThrow(
      'Seats must be whole numbers from 0, or empty for no limit.'
    )
    await expect(mock.setRingSeats({ rings: [1], confirmed: false })).rejects.toThrow(
      'Confirm the ring seats first.'
    )
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

    const seats = await client.setRingSeats({ rings: [3, null] })
    expect(seats.seats.map((row) => row.limit)).toEqual([3, null])
  })
})

describe('the add child form takes the default effort', () => {
  const HARNESSES = {
    harnesses: [
      {
        key: 'claude',
        name: 'Claude Code',
        available: true,
        models: [{ id: 'claude-opus-5-5', label: 'Claude Opus 5.5' }],
        efforts: ['low', 'medium', 'high', 'xhigh', 'max'],
      },
      {
        key: 'opencode',
        name: 'OpenCode',
        available: true,
        models: [{ id: 'opencode-go/deepseek-v4.1-flash', label: 'DeepSeek v4.1 Flash' }],
        efforts: ['low', 'medium', 'high', 'max'],
      },
      {
        key: 'codex',
        name: 'Codex',
        available: true,
        models: [{ id: 'gpt-6.1-sol', label: 'GPT-6.1 Sol' }],
        efforts: ['low', 'medium', 'high', 'xhigh'],
      },
    ],
  }

  const DRAFTS = [
    { label: 'Claude writer', harness: 'claude', model: 'claude-opus-5-5', effort: '' },
    { label: 'OpenCode writer', harness: 'opencode', model: 'opencode-go/deepseek-v4.1-flash', effort: '' },
    { label: 'Codex writer', harness: 'codex', model: 'gpt-6.1-sol', effort: '' },
  ]

  it('accepts default for Claude Code, OpenCode and Codex and saves no effort', async () => {
    const lanes = {
      ...SAMPLE_LANES,
      codex: {
        name: 'Codex',
        harness: 'Codex',
        cli: { harness: 'codex', bin: process.execPath, model: 'gpt-6.1-sol' },
      },
    }
    const { url, runsFolder } = await startBridge({ lanes })

    for (const draft of DRAFTS) {
      expect(childFormProblem(draft, { harnesses: HARNESSES })).toBe('')
      const res = await request(`${url}/api/lanes/create`, {
        method: 'POST',
        body: {
          name: draft.label,
          harness: draft.harness,
          model: draft.model,
          effort: null,
          confirmed: true,
        },
      })
      expect(res.status).toBe(200)
      expect(res.body.effort).toBeNull()
    }

    const { agents } = readAgentsConfig(runsFolder)
    for (const draft of DRAFTS) {
      const saved = agents.find((agent) => agent.name === draft.label)
      expect(saved).toBeTruthy()
      expect(saved.effort).toBeNull()
    }
  })

  it('refuses a level the harness does not take', () => {
    expect(
      childFormProblem({ ...DRAFTS[2], effort: 'max' }, { harnesses: HARNESSES })
    ).toBe('Choose an effort for this harness.')
  })

  it('refuses a level for a harness with no levels', () => {
    const none = {
      harnesses: [
        {
          key: 'acp',
          name: 'ACP',
          available: true,
          models: [{ id: 'acp-agent', label: 'ACP agent' }],
          efforts: [],
        },
      ],
    }
    expect(
      childFormProblem(
        { label: 'Writer', harness: 'acp', model: 'acp-agent', effort: 'high' },
        { harnesses: none }
      )
    ).toBe('This harness has no effort levels.')
  })
})

describe('the chosen top and nested subs', () => {
  const ladder = {
    subs: [
      { id: 'a', name: 'A', harness: 'opencode', model: 'm', lanes: ['opencode'] },
      { id: 'b', name: 'B', harness: 'opencode', model: 'm', lanes: [], parent: 'a' },
      { id: 'c', name: 'C', harness: 'opencode', model: 'm', lanes: [], parent: 'missing' },
      { id: 'x', name: 'X', harness: 'opencode', model: 'm', lanes: [], parent: 'y' },
      { id: 'y', name: 'Y', harness: 'opencode', model: 'm', lanes: [], parent: 'x' },
    ],
  }
  const orchestrators = { getLadder: () => ladder }

  it('hangs a sub on the sub its ladder entry names, and any other on the orchestrator', () => {
    const nodes = buildFamilyNodes({
      projectRoot: tempDir('mr-top-'),
      runsFolder: tempDir('mr-top-runs-'),
      lanesConfig: SAMPLE_LANES,
      orchestrators,
    })
    const parent = (id) => nodes.find((n) => n.id === id).parent
    expect(parent('b')).toBe('a')
    expect(parent('c')).toBe('orchestrator')
    expect([parent('x'), parent('y')].sort()).toEqual(['orchestrator', 'orchestrator'])
    expect(nodes.find((n) => n.id === 'a').children).toContain('b')
    expect(nodes.find((n) => n.id === 'orchestrator').children).toEqual(expect.arrayContaining(['a', 'c']))
    expect(nodes.find((n) => n.id === 'orchestrator').children).not.toContain('b')
  })

  it('saves the top from a confirmed page request and makes a session the root', async () => {
    const { url } = await startBridge()
    const body = { top: 'claude-session', confirmed: true }
    expect((await request(`${url}/api/family/top`, { method: 'POST', origin: '', body })).status).toBe(403)
    expect((await request(`${url}/api/family/top`, { method: 'POST', body: { top: 'nope', confirmed: true } })).status).toBe(400)
    expect((await request(`${url}/api/family/top`, { method: 'POST', body: { top: 'claude-session' } })).status).toBe(400)
    expect((await request(`${url}/api/family/top`, { method: 'POST', body })).body).toEqual({ ok: true, top: 'claude-session' })
    const family = (await request(`${url}/api/family`, { origin: '' })).body
    expect(family.top).toBe('claude-session')
    expect(family.nodes[0]).toMatchObject({ id: 'session:claude-session', kind: 'session', parent: null })
    expect(family.nodes.some((n) => n.id === 'orchestrator')).toBe(false)
    expect(family.nodes.find((n) => n.id === 'opencode').parent).toBe('session:claude-session')
    expect(family.nodes[0].children).toEqual(expect.arrayContaining(['opencode', 'opencode2', 'claude']))
    await request(`${url}/api/family/top`, { method: 'POST', body: { top: 'orchestrator', confirmed: true } })
    const back = (await request(`${url}/api/family`, { origin: '' })).body
    expect(back.top).toBe('orchestrator')
    expect(back.nodes.some((n) => n.kind === 'session')).toBe(false)
    expect(back.nodes[0].id).toBe('orchestrator')
  })

  it('keeps an idle orchestrator by default and leaves it out only with hideIdleMain', () => {
    const root = tempDir('mr-top-hide-')
    const runs = tempDir('mr-top-hide-runs-')
    writeFileSync(topFileFor(root, runs), JSON.stringify({ top: 'claude-session' }))

    const keptNodes = buildFamilyNodes({
      projectRoot: root,
      runsFolder: runs,
      lanesConfig: SAMPLE_LANES,
      isWorking: () => false,
    })
    expect(keptNodes[0]).toMatchObject({
      id: 'session:claude-session',
      kind: 'session',
      parent: null,
      children: ['orchestrator'],
    })
    expect(keptNodes.find((n) => n.id === 'orchestrator')).toMatchObject({
      id: 'orchestrator',
      parent: 'session:claude-session',
      working: false,
      children: ['opencode', 'opencode2', 'claude'],
    })
    for (const laneId of ['opencode', 'opencode2', 'claude']) {
      expect(keptNodes.find((n) => n.id === laneId).parent).toBe('orchestrator')
    }

    const plainNodes = buildFamilyNodes({
      projectRoot: root,
      runsFolder: runs,
      lanesConfig: SAMPLE_LANES,
      isWorking: () => false,
      hideIdleMain: true,
    })
    expect(plainNodes.some((n) => n.id === 'orchestrator')).toBe(false)
    expect(plainNodes[0]).toMatchObject({
      id: 'session:claude-session',
      kind: 'session',
      parent: null,
      children: ['opencode', 'opencode2', 'claude'],
    })
    for (const laneId of ['opencode', 'opencode2', 'claude']) {
      expect(plainNodes.find((n) => n.id === laneId).parent).toBe('session:claude-session')
    }

    const withSubs = buildFamilyNodes({
      projectRoot: root,
      runsFolder: runs,
      lanesConfig: SAMPLE_LANES,
      orchestrators,
      isWorking: () => false,
      hideIdleMain: true,
    })
    expect(withSubs.some((n) => n.id === 'orchestrator')).toBe(false)
    expect(withSubs[0].children).toEqual(expect.arrayContaining(['a', 'c', 'x', 'y', 'opencode2', 'claude']))
    expect(withSubs.find((n) => n.id === 'a').parent).toBe('session:claude-session')
    expect(withSubs.find((n) => n.id === 'b').parent).toBe('a')
    expect(withSubs.find((n) => n.id === 'opencode').parent).toBe('a')
    expect(withSubs.find((n) => n.id === 'claude').parent).toBe('session:claude-session')
  })

  it('keeps the orchestrator under a session top while it is working, and when it is the top', () => {
    const root = tempDir('mr-top-keep-')
    const runs = tempDir('mr-top-keep-runs-')
    writeFileSync(topFileFor(root, runs), JSON.stringify({ top: 'claude-session' }))

    const workingNodes = buildFamilyNodes({
      projectRoot: root,
      runsFolder: runs,
      lanesConfig: SAMPLE_LANES,
      isWorking: (key) => key === 'orchestrator',
      hideIdleMain: true,
    })
    expect(workingNodes[0]).toMatchObject({
      id: 'session:claude-session',
      kind: 'session',
      parent: null,
      children: ['orchestrator'],
    })
    expect(workingNodes.find((n) => n.id === 'orchestrator')).toMatchObject({
      id: 'orchestrator',
      parent: 'session:claude-session',
      working: true,
      children: ['opencode', 'opencode2', 'claude'],
    })
    for (const laneId of ['opencode', 'opencode2', 'claude']) {
      expect(workingNodes.find((n) => n.id === laneId).parent).toBe('orchestrator')
    }

    writeFileSync(topFileFor(root, runs), JSON.stringify({ top: 'orchestrator' }))
    const orchTopNodes = buildFamilyNodes({
      projectRoot: root,
      runsFolder: runs,
      lanesConfig: SAMPLE_LANES,
      isWorking: () => false,
      hideIdleMain: true,
    })
    expect(orchTopNodes.some((n) => n.kind === 'session')).toBe(false)
    expect(orchTopNodes[0]).toMatchObject({
      id: 'orchestrator',
      kind: 'orchestrator',
      parent: null,
      children: ['opencode', 'opencode2', 'claude'],
    })
    for (const laneId of ['opencode', 'opencode2', 'claude']) {
      expect(orchTopNodes.find((n) => n.id === laneId).parent).toBe('orchestrator')
    }
  })

  it('familySeatsFor keeps the idle orchestrator, drops manual AGY nodes and lets owner createLane pass', () => {
    const root = tempDir('mr-seats-top-')
    const runs = tempDir('mr-seats-top-runs-')
    writeFileSync(topFileFor(root, runs), JSON.stringify({ top: 'claude-session' }))
    const lanes = {
      ...SAMPLE_LANES,
      agy2: { name: 'AGY 2', cli: { harness: 'agy', model: 'gemini-4-neon-high' } },
      agy3: { name: 'AGY 3', cli: { harness: 'agy', model: 'gemini-4-neon-high' } },
    }

    const context = familySeatsFor(null, {
      projectRoot: root,
      runsFolder: runs,
      lanesConfig: lanes,
      isWorking: () => false,
    })

    expect(context.tree.some((n) => n.id === 'orchestrator')).toBe(true)
    expect(context.tree.some((n) => n.manual === true)).toBe(false)
    expect(context.tree.some((n) => n.id === 'agy2' || n.id === 'agy3')).toBe(false)

    const result = seatCheck({
      seats: { rings: [1, 2], grants: {} },
      tree: context.tree,
      depth: context.depth,
      actor: { owner: true },
      action: 'createLane',
    })
    expect(result).toEqual({ ok: true, on: true })
  })

  it('notifies both family and agents when POST /api/family/top changes the top', async () => {
    const root = tempDir('mr-top-notify-')
    const runs = tempDir('mr-top-notify-runs-')
    const notices = []
    const response = {}
    const api = createFamilyApi({
      projectRoot: root,
      runsFolder: runs,
      lanes: () => SAMPLE_LANES,
      notify: (event) => notices.push(event),
      sendJson: (req, res, status, body) => {
        response.status = status
        response.body = body
      },
      readJsonBody: async () => ({ top: 'claude-session', confirmed: true }),
    })

    const handled = await api.handle(
      { method: 'POST', headers: { origin: 'http://localhost:5173' } },
      {},
      new URL('http://127.0.0.1/api/family/top')
    )
    expect(handled).toBe(true)
    expect(response).toEqual({ status: 200, body: { ok: true, top: 'claude-session' } })
    expect(notices).toEqual([{ topic: 'family' }, { topic: 'agents' }])
  })

  it('keeps orchestrator in GET /api/agents under a session top while an orchestrator lane run is open', async () => {
    const { url, projectRoot, runsFolder } = await startBridge()
    await request(`${url}/api/family/top`, {
      method: 'POST',
      body: { top: 'claude-session', confirmed: true },
    })

    const before = await request(`${url}/api/agents`, { origin: '' })
    expect(before.body.some((agent) => agent.key === 'orchestrator')).toBe(false)

    writeFileSync(
      join(runsFolder, 'orchestrator-P661-20261121-010000.meta.json'),
      JSON.stringify({ project: projectRoot })
    )
    writeFileSync(join(runsFolder, 'orchestrator-P661-20261121-010000.log'), '{"type":"system","subtype":"init"}\n')
    let found = false
    const deadline = Date.now() + 2000
    while (!found && Date.now() < deadline) {
      const agents = await request(`${url}/api/agents`, { origin: '' })
      if (agents.body.some((agent) => agent.key === 'orchestrator')) {
        found = true
        break
      }
      await new Promise((resolve) => setTimeout(resolve, 25))
    }
    expect(found).toBe(true)
  })

  it('the mock client keeps the top too', async () => {
    const client = createMockClient()
    await client.setFamilyTop({ top: 'opencode-session' })
    const family = await client.family()
    expect(family.top).toBe('opencode-session')
    expect(family.nodes[0].kind).toBe('session')
  })

  it('sets the top session node working state from isWorking and from the sessions source', async () => {
    const root = tempDir('mr-top-work-')
    const runs = tempDir('mr-top-work-runs-')
    writeFileSync(topFileFor(root, runs), JSON.stringify({ top: 'claude-session' }))

    const workingNodes = buildFamilyNodes({
      projectRoot: root,
      runsFolder: runs,
      lanesConfig: SAMPLE_LANES,
      isWorking: (key) => key === 'claude-session',
    })
    expect(workingNodes[0]).toMatchObject({ id: 'session:claude-session', kind: 'session', working: true })

    const idleNodes = buildFamilyNodes({
      projectRoot: root,
      runsFolder: runs,
      lanesConfig: SAMPLE_LANES,
      isWorking: () => false,
    })
    expect(idleNodes[0]).toMatchObject({ id: 'session:claude-session', kind: 'session', working: false })

    const sessions = new Map([['s1', { run: { runId: 'r1', open: true } }]])
    const proj = tempDir('mr-top-bridge-')
    const runsDir = tempDir('mr-top-bridge-runs-')
    mkdirSync(join(proj, 'docs', 'agents'), { recursive: true })
    const lanesFile = join(proj, 'docs', 'agents', 'lanes.json')
    writeFileSync(lanesFile, JSON.stringify(SAMPLE_LANES, null, 2))
    writeFileSync(topFileFor(proj, runsDir), JSON.stringify({ top: 'claude-session' }))
    const bridge = createBridge({
      port: 0,
      projectRoot: proj,
      runsFolder: runsDir,
      lanesFile,
      sessionsSource: {
        readers: [() => ({
          agent: { id: 'agent-claude-session', key: 'claude-session', name: 'Claude Code session' },
          tick: () => {},
          stop: () => {},
          sessions: () => sessions,
        })],
      },
      env: {},
    })
    const { url } = await bridge.start()
    cleanups.push(() => bridge.stop())

    const busy = (await request(`${url}/api/family`, { origin: '' })).body
    expect(busy.nodes[0]).toMatchObject({ id: 'session:claude-session', working: true })

    sessions.set('s1', { run: null })
    const quiet = (await request(`${url}/api/family`, { origin: '' })).body
    expect(quiet.nodes[0]).toMatchObject({ id: 'session:claude-session', working: false })
  })
})
