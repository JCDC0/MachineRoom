import { act, createElement } from 'react'
import { describe, expect, it } from 'vitest'
import { createOrchestrators } from '../server/orchestrators.js'
import { makeTempDir, removeTempDir } from './helpers/tempRoot.js'
import Hud from '../src/ui/Hud.jsx'
import { createClient } from '../src/control/client.js'
import LaneConversation from '../src/ui/LaneConversation.jsx'
import {
  LANE_READ_GAP_MS,
  foldPrompt,
  foldToolCalls,
  readDue,
  runOptions,
  runOutcome,
} from '../src/ui/laneConversation.js'
import { buttonWithText, click, settle, type, withDom } from './helpers/uiDom.js'

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
  it('keeps the lane runs, including a live run with no record', () => {
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
    expect(options).toHaveLength(13)
    expect(options[0]).toMatchObject({
      startedAt: '2026-10-24T14:00:00.000Z',
      running: true,
    })
    expect(options.map((run) => run.startedAt)).not.toContain('2026-10-24T13:00:00.000Z')
    expect(options.map((run) => run.startedAt)).toContain('2026-10-24T12:00:00.000Z')
  })

  it('keeps live context on an existing running option', () => {
    const runs = { running: [{ lane: 'opencode', startedAt: STARTED, briefs: ['P1'] }] }
    const liveRuns = [{ lane: 'opencode', startedAt: STARTED, contextTokens: 42, contextWindow: 100, extra: 'live' }]
    expect(runOptions(runs, 'opencode', { liveRuns })).toEqual([expect.objectContaining({
      briefs: ['P1'], contextTokens: 42, contextWindow: 100, extra: 'live', running: true,
    })])
  })

  it('includes a lane absent from the fleet recent runs through last', () => {
    const runs = { recent: [{ lane: 'other', startedAt: STARTED }], last: [{ lane: 'opencode', startedAt: STARTED }] }
    expect(runOptions(runs, 'opencode')).toHaveLength(1)
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
  it('rejects a message for a previous run before it reaches the inbox', async () => {
    const folder = makeTempDir('mr-message-start-')
    const held = { lane: 'opencode', startedAt: STARTED, inbox: [] }
    const orchestrators = createOrchestrators({ runsFolder: folder, laneTickets: () => [held] })
    try {
      const send = (startedAt) => orchestrators.message({ to: 'lane:opencode', text: 'Hello', interrupt: false, ...(startedAt === undefined ? {} : { startedAt }) }, true)
      expect(await send('old')).toEqual({ status: 409, body: { error: 'That run is no longer running.' } })
      expect(held.inbox).toHaveLength(0)
      expect((await send(STARTED)).status).toBe(202)
      expect((await send()).status).toBe(202)
      expect(held.inbox).toHaveLength(2)
    } finally {
      orchestrators.close()
      removeTempDir(folder)
    }
  })

  it('includes the selected start time in lane message requests', async () => {
    let body
    const client = createClient({ fetchImpl: async (_url, options) => { body = JSON.parse(options.body); return { ok: true, json: async () => ({}) } } })
    await client.sendLaneMessage({ lane: 'opencode', text: 'Hello', startedAt: STARTED })
    expect(body).toEqual({ to: 'lane:opencode', text: 'Hello', startedAt: STARTED })
  })

  it('requests a lane with an encoded key while preserving the fleet request', async () => {
    const urls = []
    const client = createClient({ fetchImpl: async (url) => { urls.push(url); return { ok: true, json: async () => ({}) } } })
    await client.runs()
    await client.runs({ lane: 'lane + one' })
    expect(urls).toEqual(['/api/control/runs', '/api/control/runs?lane=lane%20%2B%20one'])
  })

  it('loads older runs for the lane picker', async () => {
    const earlier = '2026-10-23T12:00:00.000Z'
    const client = {
      runs: async () => ({ running: [], recent: [{ lane: 'opencode', startedAt: STARTED }, { lane: 'opencode', startedAt: earlier }] }),
      runConversation: async () => ({ running: false, entries: [] }),
    }
    await withDom(async ({ container, root }) => {
      await mount(root, { client, lane: 'opencode', laneName: 'OpenCode' })
      const picker = container.querySelector('[aria-label="Run"]')
      expect(picker.querySelectorAll('option')).toHaveLength(2)
      expect(picker.querySelectorAll('option')[1].getAttribute('value')).toBe(earlier)
    })
  })

  it('loads the selected lane history and shows no runs only when empty', async () => {
    const requested = []
    const client = { runs: async (options) => { requested.push(options); return { running: [], recent: [] } } }
    await withDom(async ({ container, root }) => {
      await mount(root, { client, lane: 'opencode', laneName: 'OpenCode', onRecipientSend: () => {}, recipientOptions: [] })
      expect(requested).toEqual([{ lane: 'opencode' }])
      expect(container.textContent).toContain('No runs yet.')
      expect(container.textContent).not.toContain('Nothing has been said yet.')
      expect(container.textContent).not.toContain('has no run that can read')
      expect(container.querySelector('textarea').getAttribute('placeholder')).toBe('Start OpenCode with a message')
    })
  })

  it('draws a disabled picker that says No runs for a lane with no runs', async () => {
    const client = { ...makeClient({ entries: [] }), runs: async () => ({ running: [], recent: [] }) }
    await withDom(async ({ container, root }) => {
      await mount(root, { client, lane: 'opencode', laneName: 'OpenCode', lanes: LANES, initialStartedAt: STARTED })
      const picker = container.querySelector('.mr-lane-conv-select')
      expect(picker.hasAttribute('disabled')).toBe(true)
      expect(picker.querySelectorAll('option').map((node) => node.textContent)).toEqual(['No runs'])
      expect(container.textContent).toContain('No runs yet.')
    })
  })

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
      expect(card.textContent).toContain('Lane: OpenCode')
      expect(card.textContent).toContain(`Started: ${STARTED}`)
      expect(stopCalls).toEqual([])

      await click(root, buttonWithText(card, 'Confirm'))
      await settle(15)
      expect(stopCalls).toEqual([{ lane: 'opencode', startedAt: STARTED, confirmed: true }])
      expect(buttonWithText(container, 'Stop')).toBeNull()
      expect(container.textContent).toContain('finished')
    })
  })

  it('keeps the selected run when an older answer arrives last', async () => {
    const later = '2026-10-24T13:00:00.000Z'
    let finishA
    let finishB
    const client = {
      runConversation: ({ startedAt }) => new Promise((resolve) => {
        if (startedAt === STARTED) finishA = resolve
        else finishB = resolve
      }),
    }
    const runs = [
      { lane: 'opencode', startedAt: STARTED, exitCode: 0 },
      { lane: 'opencode', startedAt: later, exitCode: 0 },
    ]

    await withDom(async ({ container, root }) => {
      await mount(root, { client, lane: 'opencode', lanes: LANES, runs, initialStartedAt: STARTED })
      await act(async () => {
        const picker = container.querySelector('select')
        picker.value = later
        picker.dispatchEvent({ type: 'change', bubbles: true })
      })
      await act(async () => {
        finishB({ running: false, entries: [{ role: 'agent', text: 'Run B' }] })
      })
      expect(container.textContent).toContain('Run B')
      expect(buttonWithText(container, 'Stop')).toBeNull()
      await act(async () => {
        finishA({ running: true, entries: [{ role: 'agent', text: 'Run A' }] })
      })
      expect(container.textContent).toContain('Run B')
      expect(container.textContent).not.toContain('Run A')
      expect(buttonWithText(container, 'Stop')).toBeNull()
      await act(async () => {
        const picker = container.querySelector('select')
        picker.value = STARTED
        picker.dispatchEvent({ type: 'change', bubbles: true })
      })
      expect(container.textContent).not.toContain('Run B')
      expect(container.textContent).toContain('Reading the conversation.')
    })
  })

  it('ignores an error from a lane that is no longer selected', async () => {
    let failA
    const client = {
      runConversation: ({ lane }) => lane === 'opencode'
        ? new Promise((resolve, reject) => { failA = reject })
        : Promise.resolve({ running: false, entries: [{ role: 'agent', text: 'Other lane' }] }),
    }
    const runs = [
      { lane: 'opencode', startedAt: STARTED },
      { lane: 'hermes', startedAt: STARTED },
    ]
    const props = { client, lane: 'opencode', runs, initialStartedAt: STARTED }

    await withDom(async ({ container, root }) => {
      await mount(root, props)
      await act(async () => {
        root.render(createElement(LaneConversation, { ...props, lane: 'hermes' }))
      })
      await act(async () => { failA(new Error('Old lane failed')) })
      expect(container.textContent).toContain('Other lane')
      expect(container.textContent).not.toContain('Old lane failed')
    })
  })

  it('clears a running conversation while the next run loads', async () => {
    const later = '2026-10-24T13:00:00.000Z'
    const client = {
      runConversation: ({ startedAt }) => startedAt === STARTED
        ? Promise.resolve({ running: true, entries: [{ role: 'agent', text: 'Running A' }] })
        : new Promise(() => {}),
    }
    const runs = [
      { lane: 'opencode', startedAt: STARTED },
      { lane: 'opencode', startedAt: later, running: true },
    ]

    await withDom(async ({ container, root }) => {
      await mount(root, { client, lane: 'opencode', runs, initialStartedAt: STARTED })
      expect(buttonWithText(container, 'Stop')).not.toBeNull()
      await act(async () => {
        const picker = container.querySelector('select')
        picker.value = later
        picker.dispatchEvent({ type: 'change', bubbles: true })
      })
      expect(container.textContent).not.toContain('Running A')
      expect(buttonWithText(container, 'Stop')).toBeNull()
      expect(container.textContent).toContain('Reading the conversation.')
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
      expect(calls).toEqual([{ lane: 'opencode', startedAt: STARTED }])
    })
  })

  it('opens the requested history when switching lanes in either HUD layout', async () => {
    const failed = { lane: 'codex', startedAt: '2026-10-24T11:00:00.000Z', exitCode: 1 }
    const liveRuns = [{ lane: 'codex', startedAt: STARTED }]
    for (const width of [900, 899]) {
      const calls = []
      let finishHistory
      const client = {
        ...makeClient({ calls }),
        runs: ({ lane } = {}) => lane === 'codex'
          ? new Promise((resolve) => { finishHistory = () => resolve({ recent: [failed] }) })
          : Promise.resolve({ recent: [{ lane: 'opencode', startedAt: STARTED }] }),
      }
      await withDom(async ({ dom, root }) => {
        dom.window.innerWidth = width
        dom.window.localStorage.setItem('machineroom.guide', '1')
        await act(async () => {
          root.render(createElement(Hud, {
            snapshot: { agents: LANES, status: 'live', position: 0 },
            project: 'MachineRoom',
            client,
            mode: 'live',
            liveRuns,
            log: [],
            speeds: [1],
            markers: [],
          }))
        })
        const open = (detail) => act(async () => {
          dom.window.dispatchEvent(new dom.window.CustomEvent('machineroom:open-chat', { detail }))
        })
        await open({ lane: 'opencode' })
        expect(calls.at(-1)).toEqual({ lane: 'opencode', startedAt: STARTED })
        await open({ lane: failed.lane, startedAt: failed.startedAt })
        await act(async () => finishHistory())
        expect(calls.at(-1), `HUD width ${width}`).toEqual({ lane: failed.lane, startedAt: failed.startedAt })
      })
    }
  })

  it('keeps sent messages and their pending status across lane switches in either HUD layout', async () => {
    const text = 'Check the header.'
    for (const width of [900, 899]) {
      let finishSend
      let finishStatus
      const lanes = [...LANES, { key: 'codex', name: 'Codex' }]
      const liveRuns = [{ lane: 'opencode', startedAt: STARTED }]
      const client = {
        ...makeClient({ running: true }),
        sendLaneMessage: () => new Promise((resolve) => { finishSend = resolve }),
        laneMessageStatus: () => new Promise((resolve) => { finishStatus = resolve }),
      }
      await withDom(async ({ container, dom, root }) => {
        dom.window.innerWidth = width
        dom.window.localStorage.setItem('machineroom.guide', '1')
        await act(async () => {
          root.render(createElement(Hud, {
            snapshot: { agents: lanes, status: 'live', position: 0 },
            project: 'MachineRoom',
            client,
            mode: 'live',
            liveRuns,
            speeds: [1],
          }))
        })
        const open = (lane) => act(async () => {
          dom.window.dispatchEvent(new dom.window.CustomEvent('machineroom:open-chat', { detail: { lane } }))
        })
        const sent = () => container.querySelector('[aria-label="Sent messages"]')
        await open('opencode')
        await type(root, container.querySelector('textarea'), text)
        await click(root, buttonWithText(container, 'Send'))
        await open('codex')
        await act(async () => finishSend({ id: 'msg-1' }))
        expect(sent()).toBeNull()
        await open('opencode')
        expect(sent()?.textContent ?? '').toContain(text)
        expect(sent()?.textContent ?? '').toContain('Queued')
        await open('codex')
        await act(async () => finishStatus({ status: 'fetched' }))
        expect(sent()).toBeNull()
        await open('opencode')
        expect(sent()?.textContent ?? '').toContain(text)
        expect(sent()?.textContent ?? '').toContain('Read by the runner')
      })
    }
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

  it('selects the run an open-chat request names while the lane view is open', async () => {
    const OTHER = '2026-10-24T11:00:00.000Z'
    const calls = []
    const client = {
      ...makeClient({ entries: [{ role: 'prompt', text: 'Go.', at: STARTED }], calls }),
      runs: async () => ({
        running: [],
        recent: [
          { lane: 'opencode', startedAt: STARTED, exitCode: 0, briefs: [] },
          { lane: 'opencode', startedAt: OTHER, exitCode: 1, briefs: [] },
        ],
      }),
    }
    const props = { client, lane: 'opencode', laneName: 'OpenCode', project: 'MachineRoom', lanes: LANES, tick: 0 }
    await withDom(async ({ root }) => {
      await mount(root, { ...props, initialStartedAt: STARTED, requestKey: 1 })
      await mount(root, { ...props, initialStartedAt: OTHER, requestKey: 2 })
      await settle(10)
      expect(calls.at(-1)).toEqual({ lane: 'opencode', startedAt: OTHER })
    })
  })
})
