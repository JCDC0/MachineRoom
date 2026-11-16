import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { act, createElement } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createAgentsConfigApi } from '../server/agents-config.js'
import { readHarnessSettings, saveHarnessSettings } from '../server/harness-settings.js'
import HarnessesSettings from '../src/ui/HarnessesSettings.jsx'
import { settle, type, withDom } from './helpers/uiDom.js'

const dirs = []
function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'mr-lane-replies-'))
  dirs.push(dir)
  return dir
}
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }) })

function api(folder) {
  const instance = createAgentsConfigApi({
    runsFolder: folder,
    lanes: {},
    env: { PATH: '' },
    readJsonBody: async (req) => req.body,
    sendJson: (req, res, status, body) => {
      res.status = status
      res.body = body
    },
  })
  return async (path, body, origin = 'http://localhost') => {
    const res = {}
    await instance.handle({ method: body ? 'POST' : 'GET', headers: origin ? { origin } : {}, body }, res, new URL(path, 'http://localhost'))
    return res
  }
}

const rows = [
  {
    key: 'claude',
    name: 'Claude Code',
    available: true,
    ready: true,
    enabled: true,
    program: 'claude',
    version: '2.1.0',
    reason: '',
    laneReplies: 'next-turn',
  },
  {
    key: 'machineroom',
    name: 'MachineRoom',
    available: false,
    ready: false,
    enabled: true,
    program: '',
    version: '',
    reason: 'No key is saved.',
    laneReplies: 'next-turn',
  },
]

function fakeClient() {
  return {
    harnesses: vi.fn().mockResolvedValue(rows),
    harnessSettings: vi.fn().mockImplementation(async ({ laneReplies }) => rows.map((row) => ({ ...row, laneReplies }))),
  }
}

describe('the reply choice in harness settings', () => {
  it('reads next-turn when the file has no choice or an unknown one', () => {
    const dir = setup()
    expect(readHarnessSettings(dir).laneReplies).toBe('next-turn')
    saveHarnessSettings(dir, { programs: {}, off: [], laneReplies: 'interrupt' })
    expect(readHarnessSettings(dir).laneReplies).toBe('interrupt')
    writeFileSync(join(dir, 'harnesses.json'), JSON.stringify({ laneReplies: 'sometimes' }))
    expect(readHarnessSettings(dir).laneReplies).toBe('next-turn')
  })

  it('saves the choice through the Settings route and reads it back', async () => {
    const dir = setup()
    const request = api(dir)
    expect((await request('/api/harnesses')).body.every((row) => row.laneReplies === 'next-turn')).toBe(true)

    const saved = await request('/api/harnesses/settings', { confirmed: true, laneReplies: 'interrupt' })
    expect(saved.status).toBe(200)
    expect(saved.body.every((row) => row.laneReplies === 'interrupt')).toBe(true)
    expect(readHarnessSettings(dir).laneReplies).toBe('interrupt')

    const listed = (await request('/api/harnesses')).body
    expect(listed.every((row) => row.laneReplies === 'interrupt')).toBe(true)

    expect((await request('/api/harnesses/settings', { confirmed: true, laneReplies: 'sometimes' })).status).toBe(400)
    expect((await request('/api/harnesses/settings', { confirmed: true, laneReplies: 'interrupt' }, '')).status).toBe(403)
  })
})

describe('the reply choice in Settings', () => {
  it('shows the select and saves the choice', async () => {
    const client = fakeClient()
    await withDom(async ({ container, root }) => {
      await act(async () => {
        root.render(createElement(HarnessesSettings, { client }))
      })
      await settle()

      const select = container.querySelector('#harness-lane-replies')
      expect(select).not.toBeNull()
      expect(container.textContent).toContain('Replies to a working lane')
      const options = select.querySelectorAll('option')
      expect(options.map((option) => option.textContent)).toEqual(['Wait for its next turn', 'Interrupt it at once'])

      await type(root, select, 'interrupt')
      await settle()

      expect(client.harnessSettings).toHaveBeenCalledWith({ laneReplies: 'interrupt', confirmed: true })
    })
  })
})
