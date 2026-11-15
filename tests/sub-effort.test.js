import { spawn } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { act, createElement } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { EFFORT_PROBLEM } from '../server/orchestrator.js'
import { createOrchestrators } from '../server/orchestrators.js'
import OrchestratorChat from '../src/ui/OrchestratorChat.jsx'
import { effortMenuLevels } from '../src/ui/orchestratorChat.js'
import { click, settle, withDom } from './helpers/uiDom.js'
import { makeTempDir, removeTempDir } from './helpers/tempRoot.js'

const rigs = []

afterEach(() => {
  for (const rig of rigs.splice(0)) {
    rig.orchestrators.close()
    removeTempDir(rig.base)
  }
})

function makeRig() {
  const base = makeTempDir('mr-sub-effort-')
  const runs = join(base, 'runs')
  mkdirSync(runs)
  const calls = []
  const lanes = {
    orchestrator: {
      name: 'Orchestrator',
      harness: 'Claude Code',
      cli: { harness: 'claude', bin: 'claude', model: 'opus' },
    },
    'opencode-one': {
      name: 'OpenCode One',
      harness: 'OpenCode',
      cli: { harness: 'opencode', bin: 'opencode', model: 'opencode-go/deepseek-v4.1-flash' },
    },
  }
  const orchestrators = createOrchestrators({
    projectRoot: base,
    runsFolder: runs,
    lanes,
    harnessAvailable: () => true,
    spawn: (file, args, options) => {
      calls.push({ file, args })
      return spawn(process.execPath, ['-e', ''], options)
    },
  })
  const rig = { base, runs, calls, orchestrators }
  rigs.push(rig)
  return rig
}

function codexSub(effort) {
  return {
    id: 'codex-sub',
    name: 'Codex Sub',
    harness: 'codex',
    model: 'gpt-6.1-terra',
    effort,
    lanes: ['opencode-one'],
    scope: ['**'],
    restricted: false,
    setBy: 'owner',
  }
}

function saveLadder(rig, subs) {
  return rig.orchestrators.ladderChange({ ladder: { subs }, by: 'owner', confirmed: true }, true)
}

async function firstTurn(rig, id) {
  const instance = rig.orchestrators.find(id)
  expect(instance.send({ text: 'Work', confirmed: true }).status).toBe(202)
  for (let index = 0; index < 200 && rig.calls.length === 0; index += 1) {
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  expect(rig.calls).toHaveLength(1)
  return rig.calls[0]
}

describe('a sub orchestrator takes the effort of its ladder entry', () => {
  it('keeps high on a Codex sub and passes it to the first turn', async () => {
    const rig = makeRig()
    const saved = saveLadder(rig, [codexSub('high')])
    expect(saved.status).toBe(200)
    const entry = rig.orchestrators.list().find((row) => row.id === 'codex-sub')
    expect(entry.effort).toBe('high')
    const turn = await firstTurn(rig, 'codex-sub')
    expect(turn.args).toContain('model_reasoning_effort=high')
  })

  it('refuses an effort the harness does not take', () => {
    const rig = makeRig()
    const refused = saveLadder(rig, [codexSub('max')])
    expect(refused.status).toBe(400)
    expect(refused.body.error).toBe(EFFORT_PROBLEM)
    expect(rig.orchestrators.find('codex-sub')).toBeNull()
    expect(rig.orchestrators.list().map((row) => row.id)).toEqual(['orchestrator'])
  })
})

describe('the chat effort menu', () => {
  const codexRows = [{ key: 'codex', name: 'Codex', available: true, models: [], efforts: ['low', 'medium', 'high', 'xhigh'] }]

  it('offers the levels the bridge lists for Codex', () => {
    expect(effortMenuLevels('codex', codexRows)).toEqual(['low', 'medium', 'high', 'xhigh'])
  })

  it('shows those levels in the menu for a Codex orchestrator', async () => {
    const list = [
      { id: 'orchestrator', name: 'Orchestrator', harness: 'codex', model: 'gpt-6.1-terra', state: 'idle' },
    ]
    const chat = {
      state: 'idle',
      model: 'gpt-6.1-terra',
      messages: [{ id: 'm1', from: 'owner', text: 'Start.' }],
    }
    const client = {
      orchestrator: async () => chat,
      orchestrators: async () => list,
      harnesses: async () => codexRows,
      setOrchestratorEffort: async () => ({ ok: true }),
      subscribe: () => () => {},
    }
    await withDom(async ({ container, root }) => {
      await act(async () => {
        root.render(
          createElement(OrchestratorChat, {
            client,
            inline: true,
            open: true,
            orchestrators: list,
            initialOrchestrators: list,
            initialSelected: 'orchestrator',
            initialChat: chat,
          })
        )
      })
      await settle()
      await click(root, container.querySelector('.hud-strip-effort'))
      const pop = container.querySelector('.strip-pop.is-effort')
      expect(pop).not.toBeNull()
      const levels = pop.querySelectorAll('.strip-model-choice').map((node) => node.textContent.trim())
      expect(levels).toEqual(['low', 'medium', 'high', 'xhigh'])
      expect(pop.textContent).not.toContain('No effort levels for this harness.')
    })
  })
})
