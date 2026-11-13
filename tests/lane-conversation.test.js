import { act, createElement } from 'react'
import { describe, expect, it } from 'vitest'
import Hud from '../src/ui/Hud.jsx'
import LaneConversation from '../src/ui/LaneConversation.jsx'
import {
  LANE_READ_GAP_MS,
  foldPrompt,
  foldToolCalls,
  readDue,
  runOptions,
  runOutcome,
} from '../src/ui/laneConversation.js'
import { buttonWithText, click, settle, withDom } from './helpers/uiDom.js'

const LANES = [{ key: 'opencode', name: 'OpenCode', color: '#ff8c1a' }]
const STARTED = '2026-10-24T12:00:00.000Z'

function toolEntries(count = 10) {
  return Array.from({ length: count }, (_, index) => ({
    role: 'tool',
    text: `read f${index}`,
    tool: 'read',
    at: STARTED,
  }))
}

function makeClient({ entries, running = false, calls = [], stopCalls = [], run = {} } = {}) {
  let live = running
  const recent = [{ lane: 'opencode', startedAt: STARTED, exitCode: 0, briefs: [], ...run }]
  return {
    runs: async () => ({ running: [], recent }),
    runConversation: async ({ lane, startedAt }) => {
      calls.push({ lane, startedAt })
      return {
        lane,
        startedAt,
        harness: 'opencode',
        running: live,
        entries: typeof entries === 'function' ? entries() : entries,
      }
    },
    stopRun: async (payload) => {
      stopCalls.push(payload)
      live = false
      return { ok: true }
    },
    subscribe: () => () => {},
  }
}

async function mount(root, props) {
  await act(async () => {
    root.render(createElement(LaneConversation, props))
  })
  await settle(10)
}

describe('lane conversation helpers', () => {
  it('keeps the lane newest ten runs, including a live run with no record', () => {
    const recent = Array.from({ length: 12 }, (_, index) => ({
      lane: 'opencode',
      startedAt: `2026-10-24T12:${String(index).padStart(2, '0')}:00.000Z`,
      exitCode: 0,
    }))
    const runs = [
      ...recent,
      { lane: 'hermes', startedAt: '2026-10-24T13:00:00.000Z', exitCode: 0 },
    ]
    const liveRuns = [{ runId: 'run-opencode-project-20261024-140000', startedAt: '2026-10-24T14:00:00.000Z' }]

    const options = runOptions(runs, 'opencode', { liveRuns, lanes: LANES })
    expect(options).toHaveLength(10)
    expect(options[0]).toMatchObject({
      startedAt: '2026-10-24T14:00:00.000Z',
      running: true,
    })
    expect(options.every((run) => run.lane === 'opencode')).toBe(true)
    expect(options.map((run) => run.startedAt)).not.toContain('2026-10-24T13:00:00.000Z')
    expect(options.map((run) => run.startedAt)).not.toContain('2026-10-24T12:00:00.000Z')
  })

  it('folds a run of tool calls and opens the prompt after three lines', () => {
    const rows = foldToolCalls(toolEntries())
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ kind: 'tools', count: 10 })

    const prompt = foldPrompt('one\ntwo\nthree\nfour')
    expect(prompt).toEqual({ text: 'one\ntwo\nthree', folded: true })
    expect(foldPrompt('one\ntwo')).toEqual({ text: 'one\ntwo', folded: false })
    expect(foldPrompt('x'.repeat(400)).folded).toBe(true)
    expect(foldPrompt('x'.repeat(400)).text).toHaveLength(360)
  })

  it('reads at most once in two seconds and names how a run ended', () => {
    expect(readDue(null, 1000)).toBe(true)
    expect(readDue(1000, 1000 + LANE_READ_GAP_MS - 1)).toBe(false)
    expect(readDue(1000, 1000 + LANE_READ_GAP_MS)).toBe(true)

    expect(runOutcome({ running: true })).toBe('running')
    expect(runOutcome({ exitCode: 0 })).toBe('finished')
    expect(runOutcome({ exitCode: 1 })).toBe('failed')
    expect(runOutcome({ killed: true })).toBe('stopped')
  })
})

describe('the lane conversation view', () => {
  it('folds ten tool calls into one line and opens them on a click', async () => {
    const calls = []
    const client = makeClient({
      entries: [{ role: 'prompt', text: 'List the files.', at: STARTED }, ...toolEntries()],
      calls,
    })

    await withDom(async ({ container, root }) => {
      await mount(root, {
        client,
        lane: 'opencode',
        laneName: 'OpenCode',
        project: 'MachineRoom',
        lanes: LANES,
        initialStartedAt: STARTED,
      })

      const folded = buttonWithText(container, '10 tool calls')
      expect(folded).not.toBeNull()
      expect(container.textContent).not.toContain('read f0')
      await click(root, folded)
      expect(container.textContent).toContain('read f0')
      expect(container.textContent).toContain('read f9')
      const line = container.querySelectorAll('.mr-lane-conv-tool')[0]
      expect(line.style.color).toBe('#ff8c1a')
    })
  })

  it('folds the prompt to three lines and shows the rest on Show all', async () => {
    const client = makeClient({
      entries: [
        { role: 'prompt', text: 'one\ntwo\nthree\nfour\nfive', at: STARTED },
        { role: 'agent', text: 'Working on it.', at: STARTED },
      ],
    })

    await withDom(async ({ container, root }) => {
      await mount(root, {
        client,
        lane: 'opencode',
        laneName: 'OpenCode',
        project: 'MachineRoom',
        lanes: LANES,
        initialStartedAt: STARTED,
      })

      expect(container.textContent).toContain('one')
      expect(container.textContent).not.toContain('four')
      await click(root, buttonWithText(container, 'Show all'))
      expect(container.textContent).toContain('four')
      expect(container.textContent).toContain('five')
    })
  })

  it('shows Stop on a live run and sends the run start time when confirmed', async () => {
    const calls = []
    const stopCalls = []
    const client = makeClient({
      entries: [
        { role: 'prompt', text: 'List the files.', at: STARTED },
        { role: 'agent', text: 'Reading the files.', at: STARTED },
      ],
      running: true,
      calls,
      stopCalls,
    })

    await withDom(async ({ container, root }) => {
      await mount(root, {
        client,
        lane: 'opencode',
        laneName: 'OpenCode',
        project: 'MachineRoom',
        lanes: LANES,
        initialStartedAt: STARTED,
      })

      expect(container.textContent).toContain('MACHINEROOM / OPENCODE / run 12:00:00')
      const stop = buttonWithText(container, 'Stop')
      expect(stop).not.toBeNull()
      await click(root, stop)
      await settle(10)

      const card = container.querySelector('.brief-confirm-card')
      expect(card).not.toBeNull()
      expect(card.textContent).toContain('Lane: opencode')
      expect(card.textContent).toContain(`Started: ${STARTED}`)
      expect(stopCalls).toEqual([])

      await click(root, buttonWithText(card, 'Confirm'))
      await settle(15)
      expect(stopCalls).toEqual([{ lane: 'opencode', startedAt: STARTED, confirmed: true }])
      expect(buttonWithText(container, 'Stop')).toBeNull()
      expect(container.textContent).toContain('finished')
    })
  })

  it('shows no Stop on a finished run', async () => {
    const client = makeClient({
      entries: [
        { role: 'prompt', text: 'List the files.', at: STARTED },
        { role: 'result', text: 'The run ended.', at: STARTED },
      ],
      running: false,
    })

    await withDom(async ({ container, root }) => {
      await mount(root, {
        client,
        lane: 'opencode',
        laneName: 'OpenCode',
        project: 'MachineRoom',
        lanes: LANES,
        initialStartedAt: STARTED,
      })

      expect(buttonWithText(container, 'Stop')).toBeNull()
      expect(container.textContent).toContain('finished')
      expect(container.textContent).toContain('The run ended.')
    })
  })

  it('opens the lane view from the open-chat event', async () => {
    const calls = []
    const client = {
      ...makeClient({
        entries: [{ role: 'prompt', text: 'List the files.', at: STARTED }],
        calls,
      }),
      lanes: async () => ({ lanes: [], chosen: true }),
      orchestrators: async () => [],
    }

    await withDom(async ({ container, dom, root }) => {
      await act(async () => {
        root.render(
          createElement(Hud, {
            snapshot: {
              agents: [{ key: 'opencode', name: 'OpenCode', status: 'idle' }],
              status: 'live',
              position: 0,
            },
            project: 'MachineRoom',
            client,
            mode: 'live',
            liveRuns: [],
            log: [],
            health: { ok: true, orchestrator: true },
            focused: null,
            speeds: [1],
            markers: [],
          })
        )
      })
      await settle(10)
      await act(async () => {
        dom.window.dispatchEvent(
          new dom.window.CustomEvent('machineroom:open-chat', { detail: { lane: 'opencode' } })
        )
      })
      await settle(20)
      expect(container.querySelector('.mr-lane-conv')).not.toBeNull()
      expect(container.textContent).toContain('MACHINEROOM / OPENCODE / run 12:00:00')
      expect(calls.length).toBeGreaterThan(0)
    })
  })

  it('reads a live conversation at most once in two seconds', async () => {
    const calls = []
    const client = makeClient({
      entries: [{ role: 'agent', text: 'Working.', at: STARTED }],
      running: true,
      calls,
    })
    const props = {
      client,
      lane: 'opencode',
      laneName: 'OpenCode',
      project: 'MachineRoom',
      lanes: LANES,
      initialStartedAt: STARTED,
      tick: 0,
    }

    await withDom(async ({ root }) => {
      await mount(root, props)
      expect(calls).toHaveLength(1)

      await act(async () => {
        root.render(createElement(LaneConversation, { ...props, tick: 1 }))
      })
      await settle(5)
      await act(async () => {
        root.render(createElement(LaneConversation, { ...props, tick: 2 }))
      })
      await settle(5)
      expect(calls).toHaveLength(1)
    })
  })
})
