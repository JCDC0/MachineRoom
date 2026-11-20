import { useEffect, useMemo, useRef, useState } from 'react'
import { toAgents } from '../live/source.js'
import { defaultMode, laneModesFor, modesFor } from '../control/modes.js'
import { sessionKeyFor } from '../model/laneStarter.js'
import { agentTasks } from '../model/liveTasks.js'
import AutocompactInput from './AutocompactInput.jsx'
import { Chip, HoverCard, IconButton, Menu, Row, Switch } from './controls.jsx'
import { useDialogFocus } from './dialogFocus.js'
import {
  DIRECT_HARNESS,
  DIRECT_KEY_PROBLEM,
  LANES_JSON_SAVE_PROBLEM,
  MAX_SUBS,
  NO_READY_HARNESS,
  affectedSubText,
  agentCountLine,
  childConfirmText,
  childDetail,
  childDraft,
  childFormProblem,
  childHarnesses,
  convertPlan,
  droppedLaneLine,
  familyMeta,
  familyModel,
  familyTree,
  findHarness,
  harnessEfforts,
  harnessLabel,
  harnessModels,
  harnessReady,
  hideLaneText,
  labelProblem,
  laneParentLabel,
  familyBoxes,
  moreLanesLabel,
  removeLaneText,
  rowText,
  stateWord,
  subsLosingLanes,
  teamRows,
} from './family.js'
import {
  changeSub,
  idFromName,
  ladderFromOrchestrators,
  ladderSubs,
  orchestratorHarnesses,
  scopeText,
  setSubScope,
  subEntry,
  subFromForm,
  subScope,
} from './ladderForm.js'
import { runClock, runOutcome } from './laneConversation.js'
import { useHarnessModels } from './ModelRefresh.jsx'
import ModelPicker from './ModelPicker.jsx'
import { modelName, withHarnessModels, withModelRows } from './modelRefresh.js'
import { AGENT_NAME_MAX, cleanText, laneChoice, laneSummary, projectName } from './sidebar.js'

const SCOPE_NOTE =
  "A restricted sub's lanes cannot merge files outside its scope without the orchestrator above."

function lastRunText(last) {
  return last ? `Last run ${runClock(last.startedAt)} · ${last.outcome}` : ''
}

const chatIcon = (
  <svg viewBox="0 0 12 12" aria-hidden="true" focusable="false">
    <path d="M2 2.5h8v5.5H6L3.5 10V8H2z" fill="none" stroke="currentColor" strokeLinejoin="round" />
  </svg>
)

function ScopeFields({
  scope,
  restricted,
  scopeAriaLabel,
  restrictedAriaLabel,
  disabled = false,
  onScopeChange,
  onRestrictedChange,
}) {
  const rows = Math.min(4, Math.max(2, String(scope ?? '**').split(/\r?\n/).length))
  return (
    <>
      <label className="mr-side-field">
        <span className="mr-side-field-label mono">Scope</span>
        <textarea
          className="mr-side-input mr-side-scope mono"
          rows={rows}
          placeholder="**"
          aria-label={scopeAriaLabel}
          value={scope ?? '**'}
          disabled={disabled}
          onChange={(event) => onScopeChange(event.target.value)}
        />
      </label>
      <label className="mr-side-field is-inline">
        <input
          type="checkbox"
          aria-label={restrictedAriaLabel}
          checked={restricted === true}
          disabled={disabled}
          onChange={(event) => onRestrictedChange(event.target.checked)}
        />
        <span>Restricted</span>
      </label>
      <p className="mr-side-note is-dim">{SCOPE_NOTE}</p>
    </>
  )
}

function messageOf(error) {
  return error instanceof Error && error.message ? error.message : 'The bridge refused the change.'
}

function modeSetter(client) {
  if (typeof client?.setOrchestratorMode === 'function') return client.setOrchestratorMode.bind(client)
  if (typeof client?.setMode === 'function') return client.setMode.bind(client)
  return null
}

function chosenSubMode(harness, raw) {
  const list = modesFor(harness)
  if (list.length === 0) return ''
  const picked = cleanText(raw, 40)
  return list.some((entry) => entry.id === picked) ? picked : defaultMode(harness) ?? ''
}

function lanesOf(answer) {
  return laneSummary(answer).lanes.map((lane) => lane.key)
}

function openChat(id) {
  if (typeof window === 'undefined' || typeof window.dispatchEvent !== 'function') return
  const detail = { id }
  const event =
    typeof window.CustomEvent === 'function'
      ? new window.CustomEvent('machineroom:open-chat', { detail })
      : { type: 'machineroom:open-chat', detail }
  window.dispatchEvent(event)
}

function openLaneChat(lane) {
  if (typeof window === 'undefined' || typeof window.dispatchEvent !== 'function') return
  const detail = { lane }
  const event =
    typeof window.CustomEvent === 'function'
      ? new window.CustomEvent('machineroom:open-chat', { detail })
      : { type: 'machineroom:open-chat', detail }
  window.dispatchEvent(event)
}

function openSettings() {
  if (typeof window === 'undefined' || typeof window.dispatchEvent !== 'function') return
  const event =
    typeof window.CustomEvent === 'function'
      ? new window.CustomEvent('machineroom:open-settings')
      : { type: 'machineroom:open-settings' }
  window.dispatchEvent(event)
}

function taskFor(tasks, id) {
  if (tasks instanceof Map) return tasks.get(id) ?? ''
  if (tasks && typeof tasks === 'object') return tasks[id] ?? ''
  return ''
}

function cleanLaneIds(value) {
  const ids = []
  for (const entry of Array.isArray(value) ? value : []) {
    const id = cleanText(entry, 80)
    if (!id || ids.includes(id)) continue
    ids.push(id)
  }
  return ids
}

function subIdFor(taken, label) {
  const base = idFromName(label) || 'sub'
  let root = base.slice(0, 24).replace(/-+$/g, '') || 'sub'
  if (root === 'orchestrator') root = 'orchestrator-sub'
  let id = root
  let number = 2
  while (taken.has(id)) {
    const suffix = `-${number}`
    id = `${root.slice(0, 24 - suffix.length).replace(/-+$/g, '')}${suffix}`
    number += 1
  }
  return id
}

function groupSubLadder(ladder, draft, laneIds, laneKeys = [], allowedHarnesses = null) {
  const subs = ladderSubs(ladder)
  const picked = cleanLaneIds(laneIds)
  const problem = labelProblem(draft?.label)
  if (problem) return { problem, subs, sub: null, affected: [] }
  if (picked.length === 0) return { problem: 'Select at least one code agent.', subs, sub: null, affected: [] }
  if (subs.length >= MAX_SUBS) {
    return { problem: `There are at most ${MAX_SUBS} sub orchestrators.`, subs, sub: null, affected: [] }
  }
  const affected = subsLosingLanes(subs, picked).map((row) => ({ ...row, removed: row.empty }))
  const next = []
  for (const sub of subs) {
    const before = cleanLaneIds(sub.lanes)
    const lanes = before.filter((key) => !picked.includes(key))
    if (before.length > 0 && lanes.length === 0) continue
    next.push({ ...sub, lanes })
  }
  const taken = new Set(next.map((sub) => sub.id))
  for (const key of [...laneKeys, ...picked]) {
    const id = cleanText(key, 80)
    if (id) taken.add(id)
  }
  const sub = subFromForm(
    {
      id: subIdFor(taken, draft.label),
      name: cleanText(draft.label, AGENT_NAME_MAX),
      harness: cleanText(draft.harness, 40) || 'opencode',
      model: cleanText(draft.model, 120),
      effort: cleanText(draft.effort, 20),
      lanes: picked,
      scope: subScope(draft?.scope),
      restricted: draft?.restricted === true,
    },
    allowedHarnesses
  )
  return { problem: '', subs: [...next, sub], sub, affected }
}

function removeSubLadder(ladder, subId) {
  const subs = ladderSubs(ladder)
  const next = subs.filter((sub) => sub.id !== subId)
  if (next.length === subs.length) {
    return { problem: 'Choose a sub orchestrator to remove.', subs }
  }
  return { problem: '', subs: next }
}

function assignSubLadder(ladder, subId, laneIds) {
  const subs = ladderSubs(ladder)
  if (!subs.some((sub) => sub.id === subId)) {
    return { problem: 'This sub orchestrator is not in the ladder.', subs, affected: [] }
  }
  const picked = cleanLaneIds(laneIds)
  if (picked.length === 0) {
    return { problem: 'Select at least one code agent.', subs, affected: [] }
  }
  const affected = subsLosingLanes(
    subs.filter((sub) => sub.id !== subId),
    picked
  )
  const next = subs.map((sub) => {
    if (sub.id === subId) return { ...sub, lanes: picked }
    return { ...sub, lanes: cleanLaneIds(sub.lanes).filter((key) => !picked.includes(key)) }
  })
  return { problem: '', subs: next, affected }
}

function agentCount(count) {
  return `${count} ${count === 1 ? 'agent' : 'agents'}`
}

export function sessionRowsFor({ agents = [], liveRuns = [], records = [] } = {}) {
  const roster = Array.isArray(agents) ? agents : []
  const rows = new Map()
  const runs = [
    ...(Array.isArray(liveRuns) ? liveRuns : []).map((run) => ({ run, open: true })),
    ...(Array.isArray(records) ? records : []).map((run) => ({ run, open: false })),
  ]
  for (const entry of runs) {
    const key = sessionKeyFor(entry.run?.startedBy)
    if (!key) continue
    const agent = roster.find((item) => item && item.key === key)
    if (!agent) continue
    const at = Date.parse(entry.run?.startedAt ?? '') || 0
    const existing = rows.get(key)
    if (existing && (existing.at > at || (existing.open && !entry.open))) continue
    rows.set(key, {
      id: `session:${key}`,
      kind: 'session',
      label: cleanText(agent.name, AGENT_NAME_MAX) || cleanText(agent.key, 80),
      harness: cleanText(agent.harness ?? agent.parser, 40),
      model: cleanText(agent.model, 120),
      working: entry.open,
      open: entry.open,
      at,
      step: `started ${cleanText(entry.run?.lane, 40) || 'a lane'}`,
    })
  }
  return [...rows.values()].sort((a, b) => a.label.localeCompare(b.label))
}

export function FamilyTeams({ client = null, project = '' }) {
  const canList = typeof client?.teams === 'function'
  const canSave = typeof client?.saveTeam === 'function'
  const canApply = typeof client?.applyTeam === 'function'
  const canDelete = typeof client?.deleteTeam === 'function'
  const canCopy = typeof client?.copyProjectTeam === 'function'
  const [open, setOpen] = useState(() => {
    try {
      return window.localStorage.getItem('machineroom:teams-open') === 'true'
    } catch {
      return false
    }
  })
  const [teams, setTeams] = useState(null)
  const [choice, setChoice] = useState('')
  const [name, setName] = useState('')
  const [source, setSource] = useState('')
  const [projects, setProjects] = useState([])
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const [confirm, setConfirm] = useState(null)
  const [busy, setBusy] = useState(false)
  const confirmRef = useRef(null)
  const where = projectName({ path: project })

  useDialogFocus(Boolean(confirm), { containerRef: confirmRef })

  useEffect(() => {
    if (!canList) return undefined
    let alive = true
    Promise.resolve()
      .then(() => client.teams())
      .then((answer) => {
        if (alive) setTeams(teamRows(answer))
      })
      .catch((failure) => {
        if (!alive) return
        setTeams([])
        setError(messageOf(failure))
      })
    return () => {
      alive = false
    }
  }, [client, canList])

  useEffect(() => {
    if (typeof client?.projects !== 'function') return undefined
    let alive = true
    Promise.resolve()
      .then(() => client.projects())
      .then((answer) => {
        if (!alive) return
        const rows = []
        const seen = new Set()
        for (const entry of Array.isArray(answer?.recent) ? answer.recent : []) {
          const path = cleanText(entry?.path)
          if (!path || seen.has(path)) continue
          seen.add(path)
          rows.push({ path, name: projectName(entry) })
        }
        setProjects(rows)
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [client])

  useEffect(() => {
    if (typeof client?.subscribe !== 'function') return undefined
    return client.subscribe((notice) => {
      if (!notice || notice.topic !== 'family') return
      readTeams()
    })
  }, [client])

  useEffect(() => {
    if (!teams) return
    setChoice((current) => (teams.some((row) => row.name === current) ? current : teams[0]?.name ?? ''))
  }, [teams])

  useEffect(() => {
    if (!confirm) return undefined
    function onKey(event) {
      if (event.key !== 'Escape' || busy) return
      event.preventDefault()
      event.stopPropagation()
      setConfirm(null)
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [confirm, busy])

  if (!canList) return null

  async function readTeams() {
    try {
      const answer = await client.teams()
      setTeams(teamRows(answer))
    } catch (failure) {
      setError(messageOf(failure))
    }
  }

  function ask(config) {
    setError('')
    setNotice('')
    setConfirm(config)
  }

  function applied(answer, name) {
    const parts = []
    if (name) parts.push(`Applied ${name}.`)
    const dropped = droppedLaneLine(answer)
    if (dropped) parts.push(dropped)
    if (typeof answer?.ladderError === 'string' && answer.ladderError.trim()) {
      parts.push(answer.ladderError.trim())
    }
    setNotice(parts.join(' '))
  }

  async function runConfirm() {
    if (!confirm || busy) return
    const current = confirm
    setBusy(true)
    setError('')
    try {
      await current.run()
      setConfirm(null)
    } catch (failure) {
      setError(messageOf(failure))
      setConfirm(null)
    } finally {
      setBusy(false)
    }
  }

  function askApply() {
    if (!choice || busy) return
    if (!canApply) {
      setError('This bridge cannot apply a team.')
      return
    }
    const team = choice
    ask({
      text: `Apply ${team} to ${where}? Its lanes, labels and sub orchestrators replace this project's.`,
      label: 'Apply',
      busyText: 'Applying the team...',
      run: async () => {
        applied(await client.applyTeam({ name: team, confirmed: true }), team)
        await readTeams()
      },
    })
  }

  function askSave() {
    if (busy) return
    const team = cleanText(name, 40)
    if (!team) {
      setError('Write a name for the team.')
      return
    }
    if (!canSave) {
      setError('This bridge cannot save a team.')
      return
    }
    ask({
      text: `Save "${team}" as a team? It takes this project's lanes, labels and sub orchestrators.`,
      label: 'Save team',
      busyText: 'Saving the team...',
      run: async () => {
        await client.saveTeam({ name: team, confirmed: true })
        setName('')
        await readTeams()
      },
    })
  }

  function askDelete() {
    if (!choice || busy) return
    if (!canDelete) {
      setError('This bridge cannot delete a team.')
      return
    }
    const team = choice
    ask({
      text: `Delete "${team}"? This cannot be undone.`,
      label: 'Delete',
      tone: 'danger',
      busyText: 'Deleting the team...',
      run: async () => {
        await client.deleteTeam({ name: team, confirmed: true })
        await readTeams()
      },
    })
  }

  function askCopy() {
    if (!source || busy) return
    if (!canCopy) {
      setError('This bridge cannot copy a team.')
      return
    }
    const path = source
    const other = projects.find((row) => row.path === path)?.name ?? 'the project'
    ask({
      text: `Copy the team of ${other} into ${where}?`,
      label: 'Copy',
      busyText: 'Copying the team...',
      run: async () => {
        applied(await client.copyProjectTeam({ path, confirmed: true }), other)
        await readTeams()
      },
    })
  }

  const rows = teams ?? []

  return (
    <section className="mr-teams" aria-label="Saved teams">
      <button
        type="button"
        className="mr-side-head mr-family-heading is-button"
        aria-expanded={open}
        onClick={() => {
          const next = !open
          setOpen(next)
          try {
            window.localStorage.setItem('machineroom:teams-open', String(next))
          } catch {}
        }}
      >
        <span className="mr-side-head-title mono">Teams</span>
        {rows.length > 0 && <span className="mr-side-count mono">{rows.length}</span>}
        <span className="ui-chip-chevron" aria-hidden="true" />
      </button>
      {open ? <>
      {teams === null ? <p className="mr-side-note">Loading teams...</p> : null}
      {teams !== null && rows.length === 0 ? (
        <p className="mr-side-note is-dim">No saved teams yet.</p>
      ) : null}
      {rows.length > 0 ? (
        <>
          <label className="mr-side-field">
            <span className="mr-side-field-label mono">Saved team</span>
            <select
              className="mr-side-select mono"
              aria-label="Saved team"
              value={choice}
              onChange={(event) => {
                setChoice(event.target.value)
                setNotice('')
                setError('')
              }}
            >
              {rows.map((row) => (
                <option value={row.name} key={row.name}>
                  {row.name}
                </option>
              ))}
            </select>
          </label>
          <div className="mr-side-form-actions">
            <button
              type="button"
              className="mr-side-primary"
              disabled={busy || !canApply || !choice}
              onClick={askApply}
            >
              Apply
            </button>
            <button
              type="button"
              className="mr-side-action"
              disabled={busy || !canDelete || !choice}
              onClick={askDelete}
            >
              Delete
            </button>
          </div>
        </>
      ) : null}
      {canSave ? (
        <form
          className="mr-teams-form"
          aria-label="Save as team"
          onSubmit={(event) => {
            event.preventDefault()
            askSave()
          }}
        >
          <label className="mr-side-field">
            <span className="mr-side-field-label mono">Save as team</span>
            <input
              className="mr-side-input mono"
              aria-label="Team name"
              maxLength={40}
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </label>
          <div className="mr-side-form-actions">
            <button type="submit" className="mr-side-action" disabled={busy}>
              Save
            </button>
          </div>
        </form>
      ) : null}
      {canCopy && projects.length > 0 ? (
        <>
          <label className="mr-side-field">
            <span className="mr-side-field-label mono">Copy from</span>
            <select
              className="mr-side-select mono"
              aria-label="Copy from project"
              value={source}
              onChange={(event) => {
                setSource(event.target.value)
                setNotice('')
                setError('')
              }}
            >
              <option value="">Choose a project</option>
              {projects.map((row) => (
                <option value={row.path} key={row.path}>
                  {row.name}
                </option>
              ))}
            </select>
          </label>
          <div className="mr-side-form-actions">
            <button
              type="button"
              className="mr-side-action"
              disabled={busy || !source}
              onClick={askCopy}
            >
              Copy
            </button>
          </div>
        </>
      ) : null}
      {notice ? <p className="mr-side-note">{notice}</p> : null}
      {confirm ? (
        <div ref={confirmRef} className="mr-side-confirm" role="dialog" aria-modal="true" aria-label={confirm.label}>
          <section className="mr-side-confirm-card">
            <p className="mr-side-confirm-text">{busy && confirm.busyText ? confirm.busyText : confirm.text}</p>
            <div className="mr-side-confirm-actions">
              <button
                type="button"
                className={`mr-side-confirm-btn${confirm.tone === 'danger' ? ' is-danger' : ' is-primary'}`}
                disabled={busy}
                onClick={runConfirm}
              >
                {confirm.label}
              </button>
              <button
                type="button"
                className="mr-side-confirm-btn"
                disabled={busy}
                onClick={() => setConfirm(null)}
              >
                Cancel
              </button>
            </div>
          </section>
        </div>
      ) : null}
      </> : null}
      {error ? (
        <p className="mr-side-error mono" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  )
}

export function FamilyTree({ client = null, tasks = null, project = '' }) {
  const canFamily = typeof client?.family === 'function'
  const [family, setFamily] = useState(null)
  const [lanes, setLanes] = useState(null)
  const [harnesses, setHarnesses] = useState(null)
  const [models, setModels] = useState(null)
  const [backups, setBackups] = useState(null)
  const [readError, setReadError] = useState(null)
  const [actionError, setActionError] = useState('')
  const [open, setOpen] = useState(true)
  const [moreOpen, setMoreOpen] = useState({})
  const [editing, setEditing] = useState(null)
  const [nodeDraft, setNodeDraft] = useState(null)
  const [orchestrator, setOrchestrator] = useState(null)
  const [orchLoaded, setOrchLoaded] = useState(false)
  const [childFor, setChildFor] = useState(null)
  const [childPicked, setChildPicked] = useState(false)
  const [draft, setDraft] = useState(null)
  const [childProblem, setChildProblem] = useState('')
  const [confirm, setConfirm] = useState(null)
  const [busy, setBusy] = useState(false)
  const confirmRef = useRef(null)

  const [selecting, setSelecting] = useState(false)
  const [selectedLanes, setSelectedLanes] = useState([])
  const [groupOpen, setGroupOpen] = useState(false)
  const [subDraft, setSubDraft] = useState(null)
  const [subProblem, setSubProblem] = useState('')
  const [orchestrators, setOrchestrators] = useState(null)
  const [liveTaskMap, setLiveTaskMap] = useState(null)
  const [sessionRows, setSessionRows] = useState([])
  const [lastRuns, setLastRuns] = useState(null)
  const [cardDismiss, setCardDismiss] = useState({})
  const [, setDayTick] = useState(0)
  const headerRef = useRef(null)

  useDialogFocus(Boolean(confirm), { containerRef: confirmRef })

  useEffect(() => {
    let timer = null
    function schedule() {
      const next = new Date()
      next.setHours(24, 0, 1, 0)
      timer = setTimeout(() => {
        setDayTick((count) => count + 1)
        schedule()
      }, Math.max(0, next.getTime() - Date.now()))
    }
    schedule()
    return () => clearTimeout(timer)
  }, [])

  useEffect(() => {
    if (!canFamily) return undefined
    let active = true
    setReadError(null)
    refresh(true, () => active)
    return () => {
      active = false
    }
  }, [client, canFamily])

  async function refresh(initial = false, isCurrent = () => true) {
    const jobs = [
      ['the agents list', () => client.family?.(), setFamily],
      ['the lanes', () => client.lanes?.(), setLanes],
      ['the lane backups', () => client.laneBackups?.(), setBackups],
      ['the harnesses', () => client.harnesses?.(), setHarnesses],
      ['the orchestrators', () => client.orchestrators?.(), setOrchestrators],
    ]
    if (initial) jobs.push(['the models', () => client.models?.(), setModels])
    const results = await Promise.allSettled(jobs.map(async ([, read]) => read()))
    if (!isCurrent()) return
    results.forEach((result, index) => {
      if (result.status === 'fulfilled' && result.value && typeof result.value === 'object') {
        jobs[index][2](result.value)
      }
    })
    const failed = results.findIndex((result) => result.status === 'rejected')
    setReadError(failed === -1 ? null : { source: jobs[failed][0], detail: messageOf(results[failed].reason) })
  }

  async function readOrchestrators() {
    if (typeof client?.orchestrators !== 'function') return
    try {
      const answer = await client.orchestrators()
      if (answer) setOrchestrators(answer)
    } catch {
      setOrchestrators(null)
    }
  }

  useEffect(() => {
    if (typeof client?.subscribe !== 'function') return undefined
    return client.subscribe((notice) => {
      if (!notice) return
      if (notice.topic === 'orchestrator') readOrchestrators()
      else if (notice.topic === 'family' || notice.topic === 'agents' || notice.topic === 'harnesses') refresh()
    })
  }, [client])

  useEffect(() => {
    if (tasks || !canFamily) {
      setLiveTaskMap(null)
      return undefined
    }
    if (
      typeof client?.agents !== 'function' ||
      typeof client?.issues !== 'function' ||
      typeof client?.liveRuns !== 'function'
    ) {
      setLiveTaskMap(null)
      return undefined
    }
    let active = true
    async function readTasks() {
      try {
        const [agentsRaw, issuesRaw, liveRunsRaw] = await Promise.all([
          client.agents(),
          client.issues(),
          client.liveRuns(),
        ])
        if (!active) return
        setLiveTaskMap(
          agentTasks(
            Array.isArray(liveRunsRaw) ? liveRunsRaw : [],
            Array.isArray(issuesRaw) ? issuesRaw : [],
            toAgents(Array.isArray(agentsRaw) ? agentsRaw : [])
          )
        )
      } catch {
        if (active) setLiveTaskMap(null)
      }
    }
    readTasks()
    const unsubscribe =
      typeof client.subscribe === 'function'
        ? client.subscribe((notice) => {
            if (!notice) return
            if (notice.topic === 'agents' || notice.topic === 'issues' || notice.topic === 'liveRuns') readTasks()
          })
        : null
    return () => {
      active = false
      if (typeof unsubscribe === 'function') unsubscribe()
    }
  }, [client, canFamily, tasks])

  useEffect(() => {
    if (!canFamily) return undefined
    let active = true
    async function readSessions() {
      const jobs = []
      if (typeof client?.agents === 'function') jobs.push(Promise.resolve(client.agents()).catch(() => []))
      else jobs.push(Promise.resolve([]))
      if (typeof client?.liveRuns === 'function') jobs.push(Promise.resolve(client.liveRuns()).catch(() => []))
      else jobs.push(Promise.resolve([]))
      if (typeof client?.runs === 'function') jobs.push(Promise.resolve(client.runs()).catch(() => null))
      else jobs.push(Promise.resolve(null))
      const [agentsRaw, liveRaw, runsRaw] = await Promise.all(jobs)
      if (!active) return
      setSessionRows(
        sessionRowsFor({
          agents: Array.isArray(agentsRaw) ? agentsRaw : [],
          liveRuns: Array.isArray(liveRaw) ? liveRaw : [],
          records: Array.isArray(runsRaw?.recent) ? runsRaw.recent : [],
        })
      )
      setLastRuns(runsRaw)
    }
    readSessions()
    const unsubscribe =
      typeof client?.subscribe === 'function'
        ? client.subscribe((notice) => {
            if (!notice) return
            if (notice.topic === 'agents' || notice.topic === 'liveRuns' || notice.topic === 'runs') readSessions()
          })
        : null
    return () => {
      active = false
      if (typeof unsubscribe === 'function') unsubscribe()
    }
  }, [client, canFamily])

  useEffect(() => {
    if (!confirm) return undefined
    function onKey(event) {
      if (event.key !== 'Escape' || busy) return
      event.preventDefault()
      event.stopPropagation()
      setConfirm(null)
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [confirm, busy])

  useEffect(() => {
    if (!selecting || confirm || busy) return undefined
    function onKey(event) {
      if (event.key !== 'Escape' || event.defaultPrevented) return
      event.preventDefault()
      endSelection()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selecting, confirm, busy])

  const tree = useMemo(() => familyTree(family), [family])
  const manualIds = useMemo(() => {
    const ids = new Set()
    const seen = new Set()
    for (const raw of Array.isArray(family?.nodes) ? family.nodes : []) {
      const id = cleanText(raw?.id, 80)
      if (!id || seen.has(id)) continue
      seen.add(id)
      if (raw.manual === true) ids.add(id)
    }
    return ids
  }, [family])
  const isManualLane = (node) => node?.kind === 'lane' && (node.manual === true || manualIds.has(node.id))
  const lastRunByLane = useMemo(() => {
    const latest = new Map()
    for (const list of [lastRuns?.last, lastRuns?.recent]) {
      for (const run of Array.isArray(list) ? list : []) {
        const at = Date.parse(run?.startedAt)
        if (!run?.lane || !Number.isFinite(at)) continue
        if (at > (latest.get(run.lane)?.at ?? -Infinity)) {
          latest.set(run.lane, { at, startedAt: run.startedAt, outcome: cleanText(runOutcome(run), 60) })
        }
      }
    }
    return latest
  }, [lastRuns])
  const orchestratorStates = useMemo(() => {
    const map = new Map()
    const list = Array.isArray(orchestrators)
      ? orchestrators
      : Array.isArray(orchestrators?.orchestrators)
        ? orchestrators.orchestrators
        : []
    for (const entry of list) {
      if (!entry || typeof entry !== 'object') continue
      const id = cleanText(entry.id, 80)
      if (id) map.set(id, typeof entry.state === 'string' ? entry.state : '')
    }
    return map
  }, [orchestrators])
  const activeSubHarnesses = useMemo(
    () => orchestratorHarnesses(orchestrators, harnesses),
    [orchestrators, harnesses]
  )
  const subHarnesses = useMemo(
    () => activeSubHarnesses ?? childHarnesses(harnesses, models),
    [activeSubHarnesses, harnesses, models]
  )
  const taskMap = tasks instanceof Map ? tasks : liveTaskMap
  const boxes = useMemo(() => {
    return familyBoxes(tree.rows, sessionRows)
  }, [tree, sessionRows])
  const countLine = family ? agentCountLine(tree.nodes) : ''
  const mainAgent = tree.nodes.find((node) => node.kind === 'orchestrator')
  const orchestratorTarget = mainAgent ?? { id: 'orchestrator', kind: 'orchestrator', label: 'Orchestrator', depth: 0 }
  const canCreateLane = typeof client?.createLane === 'function'
  const hasLanes = tree.nodes.some((node) => node.kind === 'lane' && !isManualLane(node))
  const editingNode = editing ? tree.nodes.find((node) => node.id === editing) ?? null : null

  const editorHarness = useMemo(() => {
    if (!editingNode) return null
    if (editingNode.kind === 'lane') {
      return (
        findHarness(harnesses, editingNode.harness) ??
        (editingNode.harness
          ? {
              key: editingNode.harness,
              name: harnessLabel(editingNode.harness),
              available: true,
              models: [],
              efforts: [],
            }
          : null)
      )
    }
    const key = nodeDraft?.harness ?? editingNode.harness
    return nodeHarnessOptions(editingNode).find((row) => row.key === key) ?? null
  }, [editingNode, harnesses, nodeDraft?.harness, subHarnesses])
  const editorFallback = useMemo(
    () => (editorHarness && editorHarness.key !== DIRECT_HARNESS ? harnessModels(editorHarness, models) : []),
    [editorHarness, models]
  )
  const editorModels = useHarnessModels({
    client,
    harness: editorHarness?.key ?? '',
    open: Boolean(editingNode),
    fallback: editorFallback,
    value: nodeDraft?.model ?? '',
  })
  const backupChoices = useMemo(() => {
    if (!editingNode || editingNode.kind !== 'lane') return []
    return tree.nodes
      .filter((row) => row.kind === 'lane' && !isManualLane(row) && row.id !== editingNode.id && row.active === true)
      .map((row) => ({ id: row.id, label: row.label || row.id }))
  }, [editingNode, tree, manualIds])

  const childHarness = useMemo(() => {
    if (!childFor) return null
    return childHarnesses(harnesses, models).find((row) => row.key === draft?.harness) ?? null
  }, [childFor, draft?.harness, harnesses, models])
  const childFallback = useMemo(
    () => (childHarness && childHarness.key !== DIRECT_HARNESS ? harnessModels(childHarness, models) : []),
    [childHarness, models]
  )
  const childModels = useHarnessModels({
    client,
    harness: childHarness?.key ?? '',
    open: Boolean(childFor),
    fallback: childFallback,
    value: draft?.model ?? '',
  })

  const subHarness = useMemo(() => {
    if (!groupOpen) return null
    return subHarnesses.filter((row) => harnessReady(row)).find((row) => row.key === subDraft?.harness) ?? null
  }, [groupOpen, subDraft?.harness, subHarnesses])
  const subFallback = useMemo(
    () => (subHarness && subHarness.key !== DIRECT_HARNESS ? harnessModels(subHarness, models) : []),
    [subHarness, models]
  )
  const subModels = useHarnessModels({
    client,
    harness: subHarness?.key ?? '',
    open: groupOpen,
    fallback: subFallback,
    value: subDraft?.model ?? '',
  })

  useEffect(() => {
    if (!editorHarness?.key || !editorModels.live || editorModels.live.length === 0) return
    setHarnesses((current) => withHarnessModels(current, editorHarness.key, editorModels.live))
    setModels((current) => withModelRows(current, editorModels.live, editorHarness.key))
  }, [editorHarness?.key, editorModels.live])

  useEffect(() => {
    if (!childHarness?.key || !childModels.live || childModels.live.length === 0) return
    setHarnesses((current) => withHarnessModels(current, childHarness.key, childModels.live))
    setModels((current) => withModelRows(current, childModels.live, childHarness.key))
  }, [childHarness?.key, childModels.live])

  useEffect(() => {
    if (!subHarness?.key || !subModels.live || subModels.live.length === 0) return
    setHarnesses((current) => withHarnessModels(current, subHarness.key, subModels.live))
    setModels((current) => withModelRows(current, subModels.live, subHarness.key))
  }, [subHarness?.key, subModels.live])

  useEffect(() => {
    if (editorHarness?.key !== DIRECT_HARNESS || !nodeDraft || nodeDraft.model) return
    const first = editorModels.choices[0]?.id
    if (first) setNodeDraft((current) => (current && !current.model ? { ...current, model: first } : current))
  }, [editorHarness?.key, editorModels.choices, nodeDraft])

  useEffect(() => {
    if (childHarness?.key !== DIRECT_HARNESS || !draft || draft.model) return
    const first = childModels.choices[0]?.id
    if (first) setDraft((current) => (current && !current.model ? { ...current, model: first } : current))
  }, [childHarness?.key, childModels.choices, draft])

  useEffect(() => {
    if (subHarness?.key !== DIRECT_HARNESS || !subDraft || subDraft.model) return
    const first = subModels.choices[0]?.id
    if (first) setSubDraft((current) => (current && !current.model ? { ...current, model: first } : current))
  }, [subHarness?.key, subModels.choices, subDraft])

  useEffect(() => {
    const lanesInTree = new Set(
      tree.nodes.filter((node) => node.kind === 'lane' && !isManualLane(node)).map((node) => node.id)
    )
    setSelectedLanes((current) => {
      const next = current.filter((id) => lanesInTree.has(id))
      return next.length === current.length ? current : next
    })
  }, [tree, manualIds])

  useEffect(() => {
    if (!groupOpen || selectedLanes.length > 0) return
    setGroupOpen(false)
    setSubDraft(null)
  }, [groupOpen, selectedLanes])

  useEffect(() => {
    if (editing && !tree.nodes.some((node) => node.id === editing)) {
      setEditing(null)
      setNodeDraft(null)
    }
    if (childFor && childFor !== orchestratorTarget.id && !tree.nodes.some((node) => node.id === childFor)) {
      setChildFor(null)
      setDraft(null)
    }
  }, [editing, childFor, tree, orchestratorTarget.id])

  useEffect(() => {
    if (!childFor || childPicked) return
    const next = childDraft(harnesses, models)
    setDraft((current) => ({ ...next, label: current?.label ?? '' }))
  }, [childFor, childPicked, harnesses, models])

  useEffect(() => {
    if (!editingNode || editingNode.kind === 'lane' || typeof client?.orchestrator !== 'function') {
      setOrchestrator(null)
      setOrchLoaded(false)
      return undefined
    }
    let active = true
    setOrchestrator(null)
    setOrchLoaded(false)
    let promise
    try {
      promise = Promise.resolve(client.orchestrator(editingNode.id))
    } catch (error) {
      promise = Promise.reject(error)
    }
    promise
      .then((answer) => {
        if (!active) return
        setOrchestrator(answer && typeof answer === 'object' ? answer : null)
        setOrchLoaded(true)
      })
      .catch(() => {
        if (!active) return
        setOrchestrator(null)
        setOrchLoaded(true)
      })
    return () => {
      active = false
    }
  }, [client, editingNode])

  if (!canFamily) return null

  function ask(config) {
    setActionError('')
    setConfirm(config)
  }

  async function runConfirm() {
    if (!confirm || busy) return
    const current = confirm
    setBusy(true)
    setActionError('')
    try {
      await current.run()
      setConfirm(null)
    } catch (error) {
      setActionError(messageOf(error))
      setConfirm(null)
      await refresh().catch(() => {})
    } finally {
      setBusy(false)
    }
  }

  function openNode(node) {
    if (!node) return
    if (editing === node.id) {
      setEditing(null)
      setNodeDraft(null)
      return
    }
    const currentSub = node.kind === 'sub' ? subEntry(orchestrators, node.id) : null
    setActionError('')
    setEditing(node.id)
    setNodeDraft({
      label: node.label,
      harness: node.harness,
      model: node.model,
      effort: node.effort,
      mode:
        node.kind === 'lane'
          ? laneSummary(lanes).lanes.find((lane) => lane.key === node.id)?.mode ?? defaultMode(node.harness) ?? ''
          : node.kind === 'sub'
            ? chosenSubMode(node.harness, currentSub?.mode)
            : '',
      fallback: typeof backups?.[node.id] === 'string' ? backups[node.id] : '',
      lanes:
        node.kind === 'sub'
          ? tree.nodes.filter((row) => row.kind === 'lane' && !isManualLane(row) && row.parent === node.id).map((row) => row.id)
          : [],
      scope: node.kind === 'sub' ? scopeText(currentSub?.scope) : '**',
      restricted: node.kind === 'sub' ? currentSub?.restricted === true : false,
    })
    setChildFor(null)
    setDraft(null)
    setChildProblem('')
  }

  function closeEditor() {
    setEditing(null)
    setNodeDraft(null)
    setOrchestrator(null)
    setOrchLoaded(false)
  }

  function nodeHarnessOptions(node) {
    const key = cleanText(node?.harness, 40)
    const list = subHarnesses.filter((row) => harnessReady(row))
    if (key && !list.some((row) => row.key === key)) {
      const known = subHarnesses.find((row) => row.key === key) ?? findHarness(harnesses, key)
      list.push({
        key,
        name: known?.name || harnessLabel(key) || key,
        available: known?.available === true,
        ready: known && typeof known.ready === 'boolean' ? known.ready : null,
        enabled: known ? known.enabled !== false : true,
        models: known?.models ?? [],
        efforts: known?.efforts ?? [],
        fallback: true,
      })
    }
    return list
  }

  function chooseNodeHarness(key) {
    const harness = nodeHarnessOptions(editingNode).find((row) => row.key === key)
    if (!harness) return
    setNodeDraft((current) => ({
      ...(current ?? {}),
      harness: harness.key,
      model: harness.key === DIRECT_HARNESS ? harnessModels(harness, models)[0]?.id ?? '' : '',
      ...(editingNode?.kind === 'sub' ? { mode: defaultMode(harness.key) ?? '' } : {}),
    }))
  }

  async function askLabel(node) {
    if (!nodeDraft || busy) return
    const problem = labelProblem(nodeDraft.label)
    if (problem) {
      setActionError(problem)
      return
    }
    const label = cleanText(nodeDraft.label, AGENT_NAME_MAX)
    if (label === node.label) return
    if (typeof client?.setAgentLabel !== 'function') {
      setActionError('This bridge cannot rename an agent.')
      return
    }
    const openDraft = nodeDraft
    setBusy(true)
    setActionError('')
    try {
      await client.setAgentLabel({ id: node.id, label, confirmed: true })
      setNodeDraft((current) =>
        current === openDraft && cleanText(current.label, AGENT_NAME_MAX) === label
          ? { ...current, label }
          : current
      )
      await refresh()
    } catch (error) {
      setActionError(messageOf(error))
      await refresh().catch(() => {})
    } finally {
      setBusy(false)
    }
  }

  function askSetup(node) {
    if (!nodeDraft) return
    const sub = node.kind === 'sub'
    const harness = nodeHarnessOptions(node).find((row) => row.key === nodeDraft.harness)
    if (!harness) {
      setActionError('Choose a harness.')
      return
    }
    const choices = harness.key === DIRECT_HARNESS ? editorModels.choices : harnessModels(harness, models)
    const model = cleanText(nodeDraft.model, 120)
    if (choices.length === 0) {
      if (harness.key === DIRECT_HARNESS) {
        setActionError(DIRECT_KEY_PROBLEM)
        return
      }
      if (model) {
        setActionError('This harness has no models.')
        return
      }
    }
    if ((harness.key === DIRECT_HARNESS || model) && !choices.some((row) => row.id === model)) {
      setActionError('Choose a model for this harness.')
      return
    }
    const effort = cleanText(nodeDraft.effort, 20)
    const availableModes = sub ? modesFor(harness.key) : []
    const currentSub = sub ? subEntry(orchestrators, node.id) : null
    const previousMode = sub ? chosenSubMode(node.harness, currentSub?.mode) : ''
    const mode = sub ? chosenSubMode(harness.key, nodeDraft.mode) : ''
    const harnessChanged = harness.key !== node.harness || model !== node.model
    const effortChanged = effort !== (node.effort || '')
    const modeChanged = sub && availableModes.length > 0 && mode !== previousMode
    if (!harnessChanged && !effortChanged && !modeChanged) return
    if (harnessChanged && typeof client?.setOrchestratorHarness !== 'function') {
      setActionError('This bridge cannot set a harness.')
      return
    }
    if (effortChanged && typeof client?.setOrchestratorEffort !== 'function') {
      setActionError('This bridge cannot set an effort.')
      return
    }
    const saveMode = modeSetter(client)
    if (modeChanged && (!harnessChanged || mode !== defaultMode(harness.key)) && typeof saveMode !== 'function') {
      setActionError('This bridge cannot set a mode.')
      return
    }
    const modeLabel = availableModes.find((entry) => entry.id === mode)?.label ?? mode
    const detailParts = [effort ? `Effort ${effort}` : 'Effort default']
    if (sub && modeLabel) detailParts.push(`Mode ${modeLabel}`)
    ask({
      text: `Run ${node.label} on ${harness.name} with ${model || 'Harness default'}?`,
      detail: detailParts.join(' · '),
      label: 'Save',
      busyText: 'Saving the orchestrator...',
      run: async () => {
        if (harnessChanged) {
          await client.setOrchestratorHarness({
            id: node.id,
            harness: harness.key,
            model,
            confirmed: true,
          })
        }
        if (effortChanged) {
          await client.setOrchestratorEffort({
            id: node.id,
            effort: effort || null,
            confirmed: true,
          })
        }
        if (modeChanged && typeof saveMode === 'function') {
          await saveMode({
            id: node.id,
            mode,
            confirmed: true,
          })
        }
        setNodeDraft((current) =>
          current ? { ...current, harness: harness.key, model, effort, ...(sub ? { mode } : {}) } : current
        )
        await refresh()
      },
    })
  }

  function askLaneSave(node) {
    if (!nodeDraft) return
    if (node.custom !== true) {
      setActionError(LANES_JSON_SAVE_PROBLEM)
      return
    }
    if (typeof client?.updateLane !== 'function') {
      setActionError('This bridge cannot change an agent.')
      return
    }
    const harness = findHarness(harnesses, node.harness)
    const choices = node.harness === DIRECT_HARNESS ? editorModels.choices : harnessModels(harness, models)
    const model = cleanText(nodeDraft.model, 120)
    if (choices.length === 0 && node.harness === DIRECT_HARNESS) {
      setActionError(DIRECT_KEY_PROBLEM)
      return
    }
    if (choices.length > 0 && !choices.some((row) => row.id === model)) {
      setActionError('Choose a model for this agent.')
      return
    }
    const efforts = harnessEfforts(harness)
    const effort = cleanText(nodeDraft.effort, 20)
    if (efforts.length > 0 && effort && !efforts.includes(effort)) {
      setActionError('Choose an effort for this agent.')
      return
    }
    const fallback = cleanText(nodeDraft.fallback, 60)
    ask({
      text: `Save ${node.label} on ${model || 'its model'}?`,
      detail: fallback ? `Backup lane ${fallback}` : 'No backup lane',
      label: 'Save',
      busyText: 'Saving the agent...',
      run: async () => {
        await client.updateLane({
          key: node.id,
          model: model || undefined,
          effort: effort || null,
          mode: nodeDraft.mode || undefined,
          fallback: fallback || null,
          confirmed: true,
        })
        await refresh()
      },
    })
  }

  function askHide(node) {
    if (node.kind !== 'lane' || isManualLane(node)) return
    if (typeof client?.hideLane !== 'function') {
      setActionError('This bridge cannot hide an agent.')
      return
    }
    const made = node.custom === true
    const where = projectName({ path: project })
    ask({
      text: made ? hideLaneText(node.label, where) : removeLaneText(node.label, where),
      label: made ? 'Hide' : 'Remove',
      busyText: made ? 'Hiding the agent...' : 'Removing the agent...',
      run: async () => {
        await client.hideLane({ key: node.id, confirmed: true })
        if (editing === node.id) closeEditor()
        await refresh()
      },
    })
  }

  function askTop(node) {
    if (typeof client?.setFamilyTop !== 'function') {
      setActionError('This bridge cannot set the top agent.')
      return
    }
    const key = node.kind === 'session' ? node.id.replace(/^session:/, '') : 'orchestrator'
    ask({
      text: `Put ${node.label} at the top of the Agents list?`,
      label: 'Put at the top',
      busyText: 'Setting the top...',
      run: async () => {
        await client.setFamilyTop({ top: key, confirmed: true })
        await refresh()
      },
    })
  }

  function subDraftFor() {
    const offered = subHarnesses.filter((row) => harnessReady(row))
    const harness = offered.find((row) => row.key === 'opencode') ?? offered[0] ?? null
    return {
      label: 'Sub orchestrator',
      harness: harness?.key ?? '',
      model: '',
      effort: harness?.efforts?.[0] ?? '',
      mode: defaultMode(harness?.key ?? '') ?? '',
      scope: '**',
      restricted: false,
    }
  }

  function openGroupForm(laneIds, fresh = false) {
    const ids = cleanLaneIds(laneIds)
    if (ids.length === 0) {
      setActionError('Select at least one code agent.')
      return
    }
    setActionError('')
    closeEditor()
    closeChild()
    setSelectedLanes(ids)
    setGroupOpen(true)
    if (fresh || !subDraft) setSubDraft(subDraftFor())
    setSubProblem('')
  }

  function clearSelection() {
    setSelectedLanes([])
    closeGroupForm()
  }

  function endSelection() {
    clearSelection()
    setSelecting(false)
    headerRef.current?.querySelector('[aria-haspopup="menu"]')?.focus()
  }

  function closeGroupForm() {
    setGroupOpen(false)
    setSubDraft(null)
    setSubProblem('')
  }

  function toggleSelected(node, on) {
    if (!node || node.kind !== 'lane' || isManualLane(node)) return
    setSubProblem('')
    setSelectedLanes((current) => {
      if (on) return current.includes(node.id) ? current : [...current, node.id]
      return current.filter((id) => id !== node.id)
    })
  }

  function chooseSubHarness(key) {
    const harness = subHarnesses.find((row) => row.key === key)
    if (!harness) return
    setSubProblem('')
    setSubDraft((current) => ({
      ...(current ?? subDraftFor()),
      harness: harness.key,
      model: harness.key === DIRECT_HARNESS ? harnessModels(harness, models)[0]?.id ?? '' : '',
      effort: harnessEfforts(harness)[0] ?? '',
      mode: defaultMode(harness.key) ?? '',
    }))
  }

  async function askGroupSub() {
    if (!subDraft || busy) return
    const draftForPlan = subDraft
    const pickedForPlan = selectedLanes
    const subFormHarnesses = activeSubHarnesses ? { harnesses: activeSubHarnesses } : harnesses
    const problem = childFormProblem(draftForPlan, { harnesses: subFormHarnesses, models, directModels: subModels.choices })
    if (problem) {
      setSubProblem(problem)
      return
    }
    if (pickedForPlan.length === 0) {
      setSubProblem('Select at least one code agent.')
      return
    }
    if (typeof client?.setLadder !== 'function' || typeof client?.orchestrators !== 'function') {
      setActionError('This bridge cannot change the ladder.')
      return
    }
    setSubProblem('')
    setActionError('')
    const laneKeys = lanesOf(lanes)
    for (const node of tree.nodes) {
      if (node.kind === 'lane' && !laneKeys.includes(node.id)) laneKeys.push(node.id)
    }
    function planGroup(ladder) {
      return groupSubLadder(ladder, draftForPlan, pickedForPlan, laneKeys, activeSubHarnesses)
    }
    let ladder
    try {
      ladder = await readLadder()
    } catch (error) {
      setActionError(messageOf(error))
      return
    }
    const plan = planGroup(ladder)
    if (plan.problem) {
      setSubProblem(plan.problem)
      return
    }
    ask({
      text: `Add "${plan.sub.name}" to lead ${agentCount(plan.sub.lanes.length)}?`,
      detail: childDetail(draftForPlan, subFormHarnesses, models),
      notes: affectedSubText(plan.affected),
      label: 'Create',
      busyText: 'Creating the sub orchestrator...',
      run: async () => {
        const fresh = planGroup(await readLadder())
        if (fresh.problem) throw new Error(fresh.problem)
        const same =
          fresh.sub &&
          plan.sub &&
          fresh.sub.id === plan.sub.id &&
          fresh.sub.name === plan.sub.name &&
          fresh.sub.lanes.join('\n') === plan.sub.lanes.join('\n')
        if (!same) throw new Error('The team changed while the card was open. Open it again.')
        await client.setLadder({ subs: fresh.subs })
        endSelection()
        const mode = chosenSubMode(fresh.sub.harness, draftForPlan.mode)
        const saveMode = modeSetter(client)
        if (mode && typeof saveMode === 'function') {
          await saveMode({ id: fresh.sub.id, mode, confirmed: true })
        }
        await refresh()
      },
    })
  }

  async function askSubLanes(node) {
    if (!nodeDraft || busy) return
    const picked = cleanLaneIds(nodeDraft.lanes)
    if (picked.length === 0) {
      setActionError('Select at least one code agent.')
      return
    }
    if (typeof client?.setLadder !== 'function' || typeof client?.orchestrators !== 'function') {
      setActionError('This bridge cannot change the ladder.')
      return
    }
    setActionError('')
    let ladder
    try {
      ladder = await readLadder()
    } catch (error) {
      setActionError(messageOf(error))
      return
    }
    const plan = assignSubLadder(ladder, node.id, picked)
    if (plan.problem) {
      setActionError(plan.problem)
      return
    }
    ask({
      text: `Save the agents under "${node.label}"?`,
      detail: agentCount(picked.length),
      notes: affectedSubText(plan.affected),
      label: 'Save',
      busyText: 'Saving the sub orchestrator...',
      run: async () => {
        const fresh = assignSubLadder(await readLadder(), node.id, picked)
        if (fresh.problem) throw new Error(fresh.problem)
        await client.setLadder({ subs: fresh.subs })
        await refresh()
      },
    })
  }

  async function askSubScope(node) {
    if (!nodeDraft || node.kind !== 'sub' || busy) return
    if (typeof client?.setLadder !== 'function' || typeof client?.orchestrators !== 'function') {
      setActionError('This bridge cannot change the ladder.')
      return
    }
    setActionError('')
    const draftScope = nodeDraft.scope
    const draftRestricted = nodeDraft.restricted === true
    let ladder
    try {
      ladder = await readLadder()
    } catch (error) {
      setActionError(messageOf(error))
      return
    }
    const plan = setSubScope(ladder, node.id, { scope: draftScope, restricted: draftRestricted })
    if (plan.problem) {
      setActionError(plan.problem)
      return
    }
    ask({
      text: `Save scope for "${node.label}"?`,
      detail: `${plan.scope.join(', ')} · ${plan.restricted ? 'Restricted' : 'Unrestricted'}`,
      label: 'Save',
      busyText: 'Saving the sub orchestrator...',
      run: async () => {
        const fresh = setSubScope(await readLadder(), node.id, {
          scope: draftScope,
          restricted: draftRestricted,
        })
        if (fresh.problem) throw new Error(fresh.problem)
        await client.setLadder({ subs: fresh.subs })
        setNodeDraft((current) =>
          current
            ? { ...current, scope: fresh.scope.join('\n'), restricted: fresh.restricted }
            : current
        )
        await refresh()
      },
    })
  }

  async function askRemoveSub(node) {
    if (node.kind !== 'sub' || busy) return
    if (typeof client?.setLadder !== 'function' || typeof client?.orchestrators !== 'function') {
      setActionError('This bridge cannot remove a sub orchestrator.')
      return
    }
    setActionError('')
    let ladder
    try {
      ladder = await readLadder()
    } catch (error) {
      setActionError(messageOf(error))
      return
    }
    const plan = removeSubLadder(ladder, node.id)
    if (plan.problem) {
      setActionError(plan.problem)
      return
    }
    ask({
      text: `Remove "${node.label}"? Its agents return to the orchestrator.`,
      label: 'Remove',
      tone: 'danger',
      busyText: 'Removing the sub orchestrator...',
      run: async () => {
        const fresh = removeSubLadder(await readLadder(), node.id)
        if (fresh.problem) throw new Error(fresh.problem)
        await client.setLadder({ subs: fresh.subs })
        if (editing === node.id) closeEditor()
        await refresh()
      },
    })
  }

  async function toggleLane(node, on) {
    if (typeof client?.setActiveLanes !== 'function') {
      setActionError('This bridge cannot change the agents.')
      return
    }
    if (!lanes) {
      setActionError('The lanes are not loaded yet.')
      return
    }
    if (busy) return
    const choice = laneChoice(lanes.lanes, on ? { add: [node.id] } : { remove: [node.id] })
    setActionError('')
    setBusy(true)
    try {
      await client.setActiveLanes({ lanes: choice, confirmed: true })
      await refresh()
    } catch (error) {
      setActionError(messageOf(error))
      await refresh().catch(() => {})
    } finally {
      setBusy(false)
    }
  }

  function askProposal(proposal, approve) {
    const method = approve ? client?.approveProposal : client?.declineProposal
    if (typeof method !== 'function') {
      setActionError('This bridge cannot answer a request.')
      return
    }
    const from = proposal.from || 'an orchestrator'
    ask({
      text: approve ? `Approve "${proposal.label}" from ${from}?` : `Decline "${proposal.label}" from ${from}?`,
      label: approve ? 'Approve' : 'Decline',
      tone: approve ? 'primary' : 'danger',
      busyText: approve ? 'Approving the agent...' : 'Declining the request...',
      run: async () => {
        await method.call(client, { id: proposal.id, confirmed: true })
        await refresh()
      },
    })
  }

  function closeChild() {
    setChildFor(null)
    setChildPicked(false)
    setDraft(null)
    setChildProblem('')
  }

  function toggleChild(node) {
    if (node.kind === 'lane') {
      if (groupOpen && selectedLanes.length === 1 && selectedLanes[0] === node.id) {
        endSelection()
        return
      }
      const next = selectedLanes.includes(node.id) ? selectedLanes : [...selectedLanes, node.id]
      setSelecting(true)
      openGroupForm(next, true)
      return
    }
    if (childFor === node.id) {
      closeChild()
      return
    }
    setActionError('')
    closeEditor()
    setChildFor(node.id)
    setChildPicked(false)
    setDraft(childDraft(harnesses, models))
    setChildProblem('')
  }

  function chooseChildHarness(harness) {
    setChildProblem('')
    setChildPicked(true)
    setDraft((current) => ({
      ...(current ?? {}),
      harness: harness.key,
      model: harness.key === DIRECT_HARNESS ? harnessModels(harness, models)[0]?.id ?? '' : '',
      effort: harnessEfforts(harness)[0] ?? '',
      mode: defaultMode(harness.key) ?? '',
    }))
  }

  async function readLadder() {
    if (typeof client?.orchestrators !== 'function') {
      throw new Error('This bridge cannot read the ladder.')
    }
    const answer = await client.orchestrators()
    return ladderFromOrchestrators(answer)
  }

  async function askCreate(parent) {
    if (!parent || !draft || busy) return
    const problem = childFormProblem(draft, { harnesses, models, directModels: childModels.choices })
    if (problem) {
      setChildProblem(problem)
      return
    }
    setChildProblem('')
    if (typeof client?.createLane !== 'function') {
      setActionError('This bridge cannot create an agent.')
      return
    }
    const needsLadder = parent.kind === 'sub' || parent.kind === 'lane'
    if (needsLadder && (typeof client?.setLadder !== 'function' || typeof client?.orchestrators !== 'function')) {
      setActionError('This bridge cannot change the ladder.')
      return
    }
    if (parent.kind === 'lane' && (typeof client?.setActiveLanes !== 'function' || typeof client?.lanes !== 'function')) {
      setActionError('This bridge cannot change the active agents.')
      return
    }
    if (needsLadder) {
      let ladder
      try {
        ladder = await readLadder()
      } catch (error) {
        setActionError(messageOf(error))
        return
      }
      if (parent.kind === 'sub' && !ladder.subs.some((sub) => sub.id === parent.id)) {
        setActionError('This sub orchestrator is not in the ladder.')
        return
      }
      if (parent.kind === 'lane') {
        const check = convertPlan(ladder, parent, '', lanesOf(lanes))
        if (check.problem) {
          setActionError(check.problem)
          return
        }
      }
    }
    const label = cleanText(draft.label, AGENT_NAME_MAX)
    const payload = {
      name: label,
      harness: draft.harness,
      model: cleanText(draft.model, 120),
      effort: cleanText(draft.effort, 20) || null,
      mode: draft.mode || defaultMode(draft.harness) || undefined,
    }
    ask({
      text: childConfirmText(draft, parent),
      detail: childDetail(draft, harnesses, models),
      label: 'Create',
      busyText: 'Creating the agent...',
      run: async () => {
        const created = await client.createLane({ ...payload, confirmed: true })
        const key = cleanText(created?.key, 80)
        if (!key) throw new Error('The bridge did not name the new agent.')
        try {
          if (parent.kind === 'sub') {
            const ladder = await readLadder()
            const sub = ladder.subs.find((entry) => entry.id === parent.id)
            if (!sub) throw new Error('This sub orchestrator is not in the ladder.')
            await client.setLadder(changeSub(ladder, { ...sub, lanes: [...sub.lanes, key] }))
          } else if (parent.kind === 'lane') {
            const ladder = await readLadder()
            const plan = convertPlan(ladder, parent, key, lanesOf(lanes))
            if (plan.problem) throw new Error(plan.problem)
            await client.setLadder(plan.ladder)
            const fresh = await client.lanes()
            await client.setActiveLanes({
              lanes: laneChoice(fresh?.lanes ?? [], { remove: [parent.id] }),
              confirmed: true,
            })
          }
        } catch (error) {
          closeChild()
          await refresh().catch(() => {})
          throw new Error(`The agent was created. ${messageOf(error)}`)
        }
        closeChild()
        await refresh()
      },
    })
  }

  function renderRequests() {
    if (tree.proposals.length === 0) return null
    return (
      <section className="mr-family-requests" aria-label="Requests">
        <p className="mr-family-group mono">Requests</p>
        {tree.proposals.map((proposal) => (
          <div className="mr-family-request" key={proposal.id}>
            <p className="mr-family-request-title">
              <span>{proposal.label}</span>
              <span className="mono">{familyMeta(proposal, { harnesses, models })}</span>
            </p>
            <p className="mr-family-request-meta mono">{`from ${proposal.from || 'an orchestrator'}`}</p>
            {proposal.reason ? <p className="mr-family-request-reason">{proposal.reason}</p> : null}
            <div className="mr-family-request-actions">
              <button
                type="button"
                className="mr-side-action"
                disabled={busy}
                onClick={() => askProposal(proposal, true)}
              >
                Approve
              </button>
              <button
                type="button"
                className="mr-side-action is-danger"
                disabled={busy}
                onClick={() => askProposal(proposal, false)}
              >
                Decline
              </button>
            </div>
          </div>
        ))}
      </section>
    )
  }

  function renderDirectNotice(onRefresh = null, error = '') {
    if (error && error !== DIRECT_KEY_PROBLEM) {
      return (
        <div className="mr-family-direct">
          <p className="mr-side-note is-error" role="alert">
            {error}
          </p>
          <div className="mr-family-direct-actions">
            {onRefresh ? (
              <button type="button" className="mr-side-action" onClick={onRefresh}>
                Retry
              </button>
            ) : null}
          </div>
        </div>
      )
    }
    return (
      <div className="mr-family-direct">
        <p className="mr-side-note">{DIRECT_KEY_PROBLEM}</p>
        <div className="mr-family-direct-actions">
          <button type="button" className="mr-side-action" onClick={openSettings}>
            Open Settings
          </button>
          {onRefresh ? (
            <button type="button" className="mr-side-action" onClick={onRefresh}>
              Refresh models
            </button>
          ) : null}
        </div>
      </div>
    )
  }

  function renderEditor(node, depth) {
    if (!nodeDraft) return null
    const lane = node.kind === 'lane'
    const sub = node.kind === 'sub'
    const laneNodes = tree.nodes.filter((row) => row.kind === 'lane' && !isManualLane(row))
    const options = lane ? [] : nodeHarnessOptions(node)
    const harness = lane
      ? editorHarness
      : options.find((row) => row.key === nodeDraft.harness) ?? null
    const direct = harness?.key === DIRECT_HARNESS
    const choices = harness ? editorModels.choices : []
    const directMissing = direct && !editorModels.loading && choices.length === 0
    const efforts = harness ? harnessEfforts(harness) : []
    const subModes = sub && harness ? modesFor(harness.key) : []
    const canLabel = typeof client?.setAgentLabel === 'function'
    const fallbackLabel = nodeDraft.fallback
      ? backupChoices.find((row) => row.id === nodeDraft.fallback)?.label ?? nodeDraft.fallback
      : 'None'
    return (
      <div
        className="mr-family-editor"
        style={{ marginLeft: `${depth * 16}px` }}
        role="group"
        aria-label={`Settings for ${node.label}`}
      >
        <label className="mr-side-field">
          <span className="mr-side-field-label mono">Label</span>
          <input
            className="mr-side-input mono"
            value={nodeDraft.label}
            maxLength={AGENT_NAME_MAX}
            aria-label={`Label for ${node.label}`}
            onChange={(event) => setNodeDraft({ ...nodeDraft, label: event.target.value })}
          />
        </label>
        <div className="mr-side-form-actions">
          <button
            type="button"
            className="mr-side-action"
            disabled={busy || !canLabel || cleanText(nodeDraft.label, AGENT_NAME_MAX) === node.label}
            onClick={() => askLabel(node)}
          >
            Save label
          </button>
        </div>
        {lane ? (
          <>
            <p className="mr-family-note mono">{`Harness ${harnessLabel(node.harness) || 'unknown'}`}</p>
            {node.custom !== true ? (
              <>
                <p className="mr-family-note mono">{`Model ${modelName(nodeDraft.model, choices)}`}</p>
                <p className="mr-family-note mono">{`Effort ${nodeDraft.effort || 'default'}`}</p>
                <p className="mr-family-note mono">{`Backup lane ${fallbackLabel}`}</p>
                <p className="mr-side-note is-dim">Edit this agent in lanes.json.</p>
                {!isManualLane(node) ? (
                  <div className="mr-side-form-actions">
                    <button
                      type="button"
                      className="mr-side-action"
                      disabled={busy || typeof client?.hideLane !== 'function'}
                      onClick={() => askHide(node)}
                    >
                      Remove
                    </button>
                  </div>
                ) : null}
              </>
            ) : (
              <>
                {laneModesFor(node.harness).length > 0 ? (
                  <label className="mr-side-field"><span className="mr-side-field-label mono">Mode</span>
                    <select className="mr-side-select mono" aria-label={`Mode for ${node.label}`} value={nodeDraft.mode} onChange={(event) => setNodeDraft({ ...nodeDraft, mode: event.target.value })}>
                      {laneModesFor(node.harness).map((mode) => <option key={mode.id} value={mode.id}>{mode.label}</option>)}
                      <option value="choice">Orchestrator's choice</option>
                    </select>
                  </label>
                ) : null}
                {directMissing ? (
                  renderDirectNotice(editorModels.refresh, editorModels.error)
                ) : harness ? (
                  <ModelPicker
                    label="Model"
                    ariaLabel={`Model for ${node.label}`}
                    value={nodeDraft.model}
                    choices={choices}
                    client={client}
                    onChange={(model) => setNodeDraft({ ...nodeDraft, model })}
                    onRefresh={editorModels.refresh}
                    loading={editorModels.loading}
                    error={editorModels.error}
                    canRefresh={editorModels.canRefresh}
                    allowDefault={!direct}
                    placeholder={direct ? 'Choose a model' : 'Harness default'}
                  />
                ) : (
                  <p className="mr-side-note is-dim">No models listed for this harness.</p>
                )}
                {efforts.length > 0 ? (
                  <label className="mr-side-field">
                    <span className="mr-side-field-label mono">Effort</span>
                    <select
                      className="mr-side-select mono"
                      aria-label={`Effort for ${node.label}`}
                      value={nodeDraft.effort}
                      onChange={(event) => setNodeDraft({ ...nodeDraft, effort: event.target.value })}
                    >
                      <option value="">default</option>
                      {efforts.map((level) => (
                        <option value={level} key={level}>
                          {level}
                        </option>
                      ))}
                      {nodeDraft.effort && !efforts.includes(nodeDraft.effort) ? (
                        <option value={nodeDraft.effort}>{nodeDraft.effort}</option>
                      ) : null}
                    </select>
                  </label>
                ) : null}
                <label className="mr-side-field">
                  <span className="mr-side-field-label mono">Backup lane</span>
                  <select
                    className="mr-side-select mono"
                    aria-label={`Backup lane for ${node.label}`}
                    value={nodeDraft.fallback ?? ''}
                    onChange={(event) => setNodeDraft({ ...nodeDraft, fallback: event.target.value })}
                  >
                    <option value="">None</option>
                    {backupChoices.map((row) => (
                      <option value={row.id} key={row.id}>
                        {row.label}
                      </option>
                    ))}
                    {nodeDraft.fallback && !backupChoices.some((row) => row.id === nodeDraft.fallback) ? (
                      <option value={nodeDraft.fallback}>{nodeDraft.fallback}</option>
                    ) : null}
                  </select>
                </label>
                <div className="mr-side-form-actions">
                  <button
                    type="button"
                    className="mr-side-primary"
                    disabled={busy || typeof client?.updateLane !== 'function' || directMissing}
                    onClick={() => askLaneSave(node)}
                  >
                    Save
                  </button>
                  <button
                    type="button"
                    className="mr-side-action"
                    disabled={busy || typeof client?.hideLane !== 'function'}
                    onClick={() => askHide(node)}
                  >
                    Hide
                  </button>
                </div>
              </>
            )}
          </>
        ) : (
          <>
            {options.length > 0 ? (
              <label className="mr-side-field">
                <span className="mr-side-field-label mono">Harness</span>
                <select
                  className="mr-side-select mono"
                  aria-label={`Harness for ${node.label}`}
                  value={nodeDraft.harness}
                  onChange={(event) => chooseNodeHarness(event.target.value)}
                >
                  {!nodeDraft.harness ? (
                    <option value="" disabled>
                      Choose a harness
                    </option>
                  ) : null}
                  {options.map((row) => (
                    <option value={row.key} key={row.key}>
                      {harnessLabel(row) || row.key}
                      {harnessReady(row) ? '' : ' (not ready)'}
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              <p className="mr-side-note is-dim">{NO_READY_HARNESS}</p>
            )}
            {directMissing ? (
              renderDirectNotice(editorModels.refresh, editorModels.error)
            ) : harness ? (
              <ModelPicker
                label="Model"
                ariaLabel={`Model for ${node.label}`}
                value={nodeDraft.model}
                choices={choices}
                client={client}
                onChange={(model) => setNodeDraft({ ...nodeDraft, model })}
                onRefresh={editorModels.refresh}
                loading={editorModels.loading}
                error={editorModels.error}
                canRefresh={editorModels.canRefresh}
                allowDefault={!direct}
                placeholder={direct ? 'Choose a model' : 'Harness default'}
              />
            ) : null}
            {sub && harness && subModes.length > 0 ? (
              <label className="mr-side-field">
                <span className="mr-side-field-label mono">Mode</span>
                <select
                  className="mr-side-select mono"
                  aria-label={`Mode for ${node.label}`}
                  value={chosenSubMode(harness.key, nodeDraft.mode)}
                  onChange={(event) => setNodeDraft({ ...nodeDraft, mode: event.target.value })}
                >
                  {subModes.map((entry) => (
                    <option key={entry.id} value={entry.id}>
                      {entry.label}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            {harness && efforts.length > 0 ? (
              <label className="mr-side-field">
                <span className="mr-side-field-label mono">Effort</span>
                <select
                  className="mr-side-select mono"
                  aria-label={`Effort for ${node.label}`}
                  value={nodeDraft.effort}
                  onChange={(event) => setNodeDraft({ ...nodeDraft, effort: event.target.value })}
                >
                  <option value="">default</option>
                  {efforts.map((level) => (
                    <option value={level} key={level}>
                      {level}
                    </option>
                  ))}
                  {nodeDraft.effort && !efforts.includes(nodeDraft.effort) ? (
                    <option value={nodeDraft.effort}>{nodeDraft.effort}</option>
                  ) : null}
                </select>
              </label>
            ) : null}
            <div className="mr-side-form-actions">
              <button
                type="button"
                className="mr-side-primary"
                disabled={
                  busy ||
                  directMissing ||
                  !harness ||
                  (typeof client?.setOrchestratorHarness !== 'function' &&
                    typeof client?.setOrchestratorEffort !== 'function' &&
                    (!sub || typeof modeSetter(client) !== 'function'))
                }
                onClick={() => askSetup(node)}
              >
                Save
              </button>
              {sub ? (
                <button
                  type="button"
                  className="mr-side-action is-danger"
                  disabled={
                    busy ||
                    typeof client?.setLadder !== 'function' ||
                    typeof client?.orchestrators !== 'function'
                  }
                  onClick={() => askRemoveSub(node)}
                >
                  Remove
                </button>
              ) : null}
            </div>
            {sub ? (
              <div className="mr-family-agents" role="group" aria-label={`Agents under ${node.label}`}>
                <p className="mr-side-field-label mono">Agents</p>
                {laneNodes.length === 0 ? (
                  <p className="mr-side-note is-dim">No code agents are listed.</p>
                ) : (
                  laneNodes.map((row) => {
                    const checked = cleanLaneIds(nodeDraft.lanes).includes(row.id)
                    return (
                      <label className="mr-family-agent" key={row.id}>
                        <input
                          type="checkbox"
                          className="mr-family-agent-check"
                          aria-label={`${row.label} under ${node.label}`}
                          checked={checked}
                          disabled={busy}
                          onChange={(event) => {
                            const picked = new Set(cleanLaneIds(nodeDraft.lanes))
                            if (event.target.checked) picked.add(row.id)
                            else picked.delete(row.id)
                            const lanes = laneNodes.map((entry) => entry.id).filter((id) => picked.has(id))
                            setNodeDraft({ ...nodeDraft, lanes })
                          }}
                        />
                        <span className="mr-family-agent-label">{row.label}</span>
                        <span className="mr-family-agent-id mono">{laneParentLabel(tree.nodes, row)}</span>
                      </label>
                    )
                  })
                )}
                <div className="mr-side-form-actions">
                  <button
                    type="button"
                    className="mr-side-primary"
                    disabled={
                      busy ||
                      typeof client?.setLadder !== 'function' ||
                      typeof client?.orchestrators !== 'function'
                    }
                    onClick={() => askSubLanes(node)}
                  >
                    Save agents
                  </button>
                </div>
              </div>
            ) : null}
            {sub ? (
              <div className="mr-family-agents" role="group" aria-label={`Scope for ${node.label}`}>
                <ScopeFields
                  scope={nodeDraft.scope}
                  restricted={nodeDraft.restricted}
                  scopeAriaLabel={`Scope for ${node.label}`}
                  restrictedAriaLabel={`Restricted for ${node.label}`}
                  disabled={busy}
                  onScopeChange={(scope) => setNodeDraft({ ...nodeDraft, scope })}
                  onRestrictedChange={(restricted) => setNodeDraft({ ...nodeDraft, restricted })}
                />
                <div className="mr-side-form-actions">
                  <button
                    type="button"
                    className="mr-side-primary"
                    disabled={
                      busy ||
                      typeof client?.setLadder !== 'function' ||
                      typeof client?.orchestrators !== 'function'
                    }
                    onClick={() => askSubScope(node)}
                  >
                    Save scope
                  </button>
                </div>
              </div>
            ) : null}
            {orchLoaded && orchestrator ? (
              <AutocompactInput orchestrator={orchestrator} client={client} onSaved={refresh} />
            ) : null}
            {orchLoaded && !orchestrator ? (
              <p className="mr-side-note is-dim">Autocompact is not available.</p>
            ) : null}
          </>
        )}
        <div className="mr-side-form-actions">
          <button type="button" className="mr-side-action" disabled={busy} onClick={closeEditor}>
            Close
          </button>
        </div>
      </div>
    )
  }

  function renderChildForm(parent, depth) {
    if (!draft) return null
    const offered = childHarnesses(harnesses, models)
    const selected = offered.find((row) => row.key === draft.harness) ?? null
    const choices = selected ? childModels.choices : []
    const efforts = selected ? harnessEfforts(selected) : []
    const direct = draft.harness === DIRECT_HARNESS
    const directMissing = direct && !childModels.loading && choices.length === 0
    const canCreate = typeof client?.createLane === 'function'
    return (
      <form
        className="mr-side-agent-form mr-family-child"
        style={{ marginLeft: `${depth * 16}px` }}
        aria-label={`Add child to ${parent.label}`}
        onSubmit={(event) => {
          event.preventDefault()
          askCreate(parent)
        }}
      >
        <label className="mr-side-field">
          <span className="mr-side-field-label mono">Label</span>
          <input
            className="mr-side-input mono"
            value={draft.label}
            maxLength={AGENT_NAME_MAX}
            aria-label="New agent label"
            onChange={(event) => setDraft({ ...draft, label: event.target.value })}
          />
        </label>
        {offered.length > 0 ? (
          <div className="mr-side-harnesses" role="group" aria-label="Harness">
            {offered.map((row) => (
              <button
                key={row.key}
                type="button"
                className={`mr-side-harness${draft.harness === row.key ? ' is-on' : ''}`}
                aria-pressed={draft.harness === row.key}
                onClick={() => chooseChildHarness(row)}
              >
                {row.key === DIRECT_HARNESS ? 'Direct API' : row.name || row.key}
              </button>
            ))}
          </div>
        ) : (
          <p className="mr-side-note is-dim">{NO_READY_HARNESS}</p>
        )}
        {directMissing ? renderDirectNotice(childModels.refresh, childModels.error) : null}
        {selected && !directMissing ? (
          <ModelPicker
            label="Model"
            ariaLabel="New agent model"
            value={draft.model}
            choices={choices}
            client={client}
            onChange={(model) => setDraft({ ...draft, model })}
            onRefresh={childModels.refresh}
            loading={childModels.loading}
            error={childModels.error}
            canRefresh={childModels.canRefresh}
            allowDefault={!direct}
            placeholder={direct ? 'Choose a model' : 'Harness default'}
          />
        ) : null}
        {selected && laneModesFor(draft.harness).length > 0 ? (
          <label className="mr-side-field"><span className="mr-side-field-label mono">Mode</span>
            <select className="mr-side-select mono" aria-label="New agent mode" value={draft.mode ?? defaultMode(draft.harness) ?? ''} onChange={(event) => setDraft({ ...draft, mode: event.target.value })}>
              {laneModesFor(draft.harness).map((mode) => <option key={mode.id} value={mode.id}>{mode.label}</option>)}
              <option value="choice">Orchestrator's choice</option>
            </select>
          </label>
        ) : null}
        {selected && !directMissing && efforts.length > 0 ? (
          <label className="mr-side-field">
            <span className="mr-side-field-label mono">Effort</span>
            <select
              className="mr-side-select mono"
              aria-label="New agent effort"
              value={draft.effort}
              onChange={(event) => setDraft({ ...draft, effort: event.target.value })}
            >
              <option value="">default</option>
              {efforts.map((level) => (
                <option value={level} key={level}>
                  {level}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        {childProblem ? <p className="mr-family-note is-error">{childProblem}</p> : null}
        <div className="mr-side-form-actions">
          <button type="submit" className="mr-side-primary" disabled={busy || !canCreate || directMissing || !selected}>
            Create
          </button>
          <button type="button" className="mr-side-action" disabled={busy} onClick={closeChild}>
            Cancel
          </button>
        </div>
        {!canCreate ? <p className="mr-side-note is-dim">This bridge cannot create an agent.</p> : null}
      </form>
    )
  }

  function renderSubForm() {
    if (!subDraft) return null
    const offered = subHarnesses.filter((row) => harnessReady(row))
    const selected = offered.find((row) => row.key === subDraft.harness) ?? null
    const efforts = selected ? harnessEfforts(selected) : []
    const subModes = selected ? modesFor(selected.key) : []
    const direct = selected?.key === DIRECT_HARNESS
    const directMissing = direct && !subModels.loading && subModels.choices.length === 0
    const canGroup = typeof client?.setLadder === 'function' && typeof client?.orchestrators === 'function'
    return (
      <form
        className="mr-family-sub-form"
        aria-label="Add sub orchestrator"
        onSubmit={(event) => {
          event.preventDefault()
          askGroupSub()
        }}
      >
        <label className="mr-side-field">
          <span className="mr-side-field-label mono">Label</span>
          <input
            className="mr-side-input mono"
            value={subDraft.label}
            maxLength={AGENT_NAME_MAX}
            aria-label="Sub orchestrator label"
            onChange={(event) => setSubDraft({ ...subDraft, label: event.target.value })}
          />
        </label>
        {offered.length > 0 ? (
          <label className="mr-side-field">
            <span className="mr-side-field-label mono">Harness</span>
            <select
              className="mr-side-select mono"
              aria-label="Sub orchestrator harness"
              value={subDraft.harness}
              onChange={(event) => chooseSubHarness(event.target.value)}
            >
              {offered.map((row) => (
                <option value={row.key} key={row.key}>
                  {row.key === DIRECT_HARNESS ? 'Direct API' : row.name || row.key}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <p className="mr-side-note is-dim">{NO_READY_HARNESS}</p>
        )}
        {directMissing ? renderDirectNotice(subModels.refresh, subModels.error) : null}
        {selected && !directMissing ? (
          <ModelPicker
            label="Model"
            ariaLabel="Sub orchestrator model"
            value={subDraft.model}
            choices={subModels.choices}
            client={client}
            onChange={(model) => setSubDraft({ ...subDraft, model })}
            onRefresh={subModels.refresh}
            loading={subModels.loading}
            error={subModels.error}
            canRefresh={subModels.canRefresh}
            allowDefault={!direct}
            placeholder={direct ? 'Choose a model' : 'Harness default'}
          />
        ) : null}
        {selected && subModes.length > 0 ? (
          <label className="mr-side-field">
            <span className="mr-side-field-label mono">Mode</span>
            <select
              className="mr-side-select mono"
              aria-label="Sub orchestrator mode"
              value={chosenSubMode(selected.key, subDraft.mode)}
              onChange={(event) => setSubDraft({ ...subDraft, mode: event.target.value })}
            >
              {subModes.map((mode) => (
                <option key={mode.id} value={mode.id}>
                  {mode.label}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        {selected && !directMissing && efforts.length > 0 ? (
          <label className="mr-side-field">
            <span className="mr-side-field-label mono">Effort</span>
            <select
              className="mr-side-select mono"
              aria-label="Sub orchestrator effort"
              value={subDraft.effort}
              onChange={(event) => setSubDraft({ ...subDraft, effort: event.target.value })}
            >
              <option value="">default</option>
              {efforts.map((level) => (
                <option value={level} key={level}>
                  {level}
                </option>
              ))}
              {subDraft.effort && !efforts.includes(subDraft.effort) ? (
                <option value={subDraft.effort}>{subDraft.effort}</option>
              ) : null}
            </select>
          </label>
        ) : null}
        <ScopeFields
          scope={subDraft.scope}
          restricted={subDraft.restricted}
          scopeAriaLabel="Sub orchestrator scope"
          restrictedAriaLabel="Sub orchestrator restricted"
          disabled={busy}
          onScopeChange={(scope) => setSubDraft({ ...subDraft, scope })}
          onRestrictedChange={(restricted) => setSubDraft({ ...subDraft, restricted })}
        />
        {subProblem ? <p className="mr-family-note is-error">{subProblem}</p> : null}
        <div className="mr-side-form-actions">
          <button type="submit" className="mr-side-primary" disabled={busy || !canGroup || directMissing || !selected}>
            Create
          </button>
          <button type="button" className="mr-side-action" disabled={busy} onClick={closeGroupForm}>
            Cancel
          </button>
        </div>
        {!canGroup ? <p className="mr-side-note is-dim">This bridge cannot change the ladder.</p> : null}
      </form>
    )
  }

  function renderSelection() {
    if (!selecting) return null
    return (
      <>
        <div className="mr-family-selection" role="group" aria-label="Selected code agents">
          <span className="mr-family-selection-count mono" role="status">{`${selectedLanes.length} selected`}</span>
          <Chip
            className="is-primary"
            label="Make sub"
            aria-label="Make sub orchestrator"
            disabled={busy || selectedLanes.length === 0}
            onClick={() => openGroupForm(selectedLanes)}
          />
          <Chip className="is-quiet" label="Clear" disabled={busy || selectedLanes.length === 0} onClick={clearSelection} />
          <Chip className="is-done" label="Done" disabled={busy} onClick={endSelection} />
        </div>
        {groupOpen ? renderSubForm() : null}
      </>
    )
  }

  function renderMoreLanes(box) {
    if (box.more.length === 0) return null
    const open = moreOpen[box.node.id] === true
    return (
      <div className="mr-family-more">
        <button
          type="button"
          className="mr-family-more-head"
          aria-expanded={open}
          onClick={() => setMoreOpen((value) => ({ ...value, [box.node.id]: !open }))}
        >
          <span className="mono">
            {open ? 'Hide' : 'Show'} {moreLanesLabel(box.more.length)}
          </span>
          <span className="ui-chip-chevron" aria-hidden="true" />
        </button>
        {open ? box.more.map((row) => renderRow(row)) : null}
      </div>
    )
  }

  function renderBox(box) {
    return (
      <div className="mr-family-box" key={box.node.id}>
        <div className="mr-family-head">{renderRow(box.node)}</div>
        {box.subs.length > 0 ? <div className="mr-family-kids">{box.subs.map((kid) => <div className="mr-family-kid" key={kid.node.id}>{renderBox(kid)}</div>)}</div> : null}
        {box.lanes.length + box.more.length > 0 ? (
          <div className="mr-family-lanes">
            {box.lanes.map((row) => renderRow(row))}
            {renderMoreLanes(box)}
          </div>
        ) : null}
      </div>
    )
  }

  function renderRow(node) {
    const lane = node.kind === 'lane'
    const sub = node.kind === 'sub'
    const session = node.kind === 'session'
    const manual = isManualLane(node)
    const selectable = lane && !manual && selecting
    const selected = selectable && selectedLanes.includes(node.id)
    const orchestratorState = orchestratorStates.get(node.id) ?? ''
    const task = lane ? rowText(node, '', taskFor(taskMap, node.id)) : ''
    const state = lane || session ? stateWord(node) : rowText(node, orchestratorState)
    const status = state === 'paused' ? 'waiting' : state
    const dot = state === 'waiting' ? 'idle' : state
    const detail = familyModel(node, { harnesses, models })
    const mode = node.mode || defaultMode(node.harness)
    const effortMode = `Effort ${node.effort || 'default'}${mode ? ` · Mode ${mode}` : ''}`
    const items = []
    if (!session && !manual) {
      items.push({
        label: lane ? 'Make sub from this lane…' : 'Add a lane under this…',
        disabled: busy,
        onSelect: () => toggleChild(node),
      })
    }
    const topKey = family?.top ?? (tree.root?.kind === 'session' ? tree.root.id.slice(8) : 'orchestrator')
    if ((session || node.kind === 'orchestrator') && (session ? node.id.slice(8) : 'orchestrator') !== topKey) {
      items.push({ label: 'Put at the top', disabled: busy, onSelect: () => askTop(node) })
    }
    if (!mainAgent && session && node.id.slice(8) === topKey) {
      items.push({ label: 'Put Orchestrator at the top', disabled: busy, onSelect: () => askTop(orchestratorTarget) })
    }
    if (lane && !manual) {
      items.push({
        label: node.active ? 'Turn off' : 'Turn on',
        disabled: busy || typeof client?.setActiveLanes !== 'function',
        onSelect: () => toggleLane(node, !node.active),
      })
    }
    if ((lane && !manual) || sub) {
      items.push({
        label: 'Delete…',
        danger: true,
        disabled: busy || (sub
          ? typeof client?.setLadder !== 'function' || typeof client?.orchestrators !== 'function'
          : typeof client?.hideLane !== 'function'),
        onSelect: () => (sub ? askRemoveSub(node) : askHide(node)),
      })
    }
    return (
      <div className="mr-family-node" key={node.id} data-kind={node.kind} data-depth={node.depth}>
        <HoverCard title={node.label} dismissKey={cardDismiss[node.id] ?? 0} details={() => [
          detail,
          !session && effortMode,
          `Status ${state}${task ? ` · ${task}` : ''}`,
          session ? node.step : lastRunText(lastRunByLane.get(node.id)),
        ].filter(Boolean)}>
          <Row
            className={`mr-family-row${state === 'off' ? ' is-off' : ''}${selectable ? ' is-selectable' : ''}`}
            selected={selected}
            onClick={selectable && !busy ? () => toggleSelected(node, !selected) : undefined}
            leading={
              <>
                {selectable && (
                  <Switch
                    label={`Select ${node.label}`}
                    checked={selected}
                    showLabel={false}
                    disabled={busy}
                    onChange={(on, event) => {
                      event.stopPropagation()
                      toggleSelected(node, on)
                    }}
                  />
                )}
              </>
            }
            label={
              <span className="mr-family-top">
                <span className={`mr-family-dot is-${dot}`} aria-hidden="true" />
                {session || selectable ? (
                  <span className="mr-family-label">{node.label}</span>
                ) : (
                  <button type="button" className="mr-family-label mr-family-open"
                    aria-expanded={editing === node.id} aria-label={`Edit ${node.label}`}
                    onClick={() => openNode(node)}>
                    {node.label}
                  </button>
                )}
              </span>
            }
            detail={status ? (
              <>
                <span className="mr-family-state mono">{status}</span>
                {detail ? ` · ${detail}` : ''}
              </>
            ) : detail}
            trailing={session && items.length === 0 ? <span className="mr-family-actions" aria-hidden="true" /> : session ? (
              <span className="mr-family-actions">
                <Menu label={`Actions for ${node.label}`} items={items} disabled={busy} />
              </span>
            ) : (
              <span className="mr-family-actions">
                <IconButton
                  className="mr-family-chat"
                  label={lane ? `Open conversation with ${node.label}` : `Open chat with ${node.label}`}
                  icon={chatIcon}
                  onClick={(event) => {
                    event.stopPropagation()
                    setCardDismiss((current) => ({ ...current, [node.id]: (current[node.id] ?? 0) + 1 }))
                    if (lane) openLaneChat(node.id)
                    else openChat(node.id)
                  }}
                />
                {items.length > 0 ? <Menu label={`Actions for ${node.label}`} items={items} disabled={busy} /> : null}
              </span>
            )}
          />
        </HoverCard>
        {editing === node.id ? renderEditor(node, node.depth) : null}
        {childFor === node.id ? renderChildForm(node, node.depth) : null}
      </div>
    )
  }

  function openTeamBuilder() {
    const header = headerRef.current?.parentNode?.querySelector('.mr-team')?.querySelector('.mr-side-head')
    if (!header) return
    if (header.getAttribute('aria-expanded') !== 'true') header.click()
    header.focus()
  }

  function startSelection() {
    setOpen(true)
    setSelecting(true)
  }

  return (
    <section className="mr-family" aria-label="Agents" ref={headerRef}>
      <div className="mr-family-header">
        <button
          type="button"
          className="mr-side-head mr-family-heading is-button"
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
        >
          <span className="mr-side-head-title mono">Agents</span>
          {countLine ? <span className="mr-side-count mono">{countLine}</span> : null}
          <span className="ui-chip-chevron" aria-hidden="true" />
        </button>
        <span className="mr-family-header-actions">
          <IconButton className="mr-family-add" label="Add a lane" icon="+" disabled={busy || (!mainAgent && !canCreateLane)}
            onClick={() => {
              setOpen(true)
              toggleChild(orchestratorTarget)
            }}
          />
          <Menu label="Agents actions" disabled={busy} items={[
            {
              label: 'Add sub orchestrator…',
              disabled: !hasLanes,
              onSelect: () => {
                startSelection()
                if (selectedLanes.length > 0) openGroupForm(selectedLanes)
              },
            },
            {
              label: 'Select lanes',
              disabled: !hasLanes,
              onSelect: startSelection,
            },
            { label: 'Build a team…', onSelect: openTeamBuilder },
          ]} />
        </span>
      </div>
      {open ? (
        <div className="mr-family-body">
          {readError ? <p className="mr-side-note" title={readError.detail}>{`Could not read ${readError.source}.`}</p> : null}
          {actionError ? (
            <p className="mr-side-error mono" role="alert">
              {actionError}
            </p>
          ) : null}
          {family ? (
            <>
              {renderRequests()}
              {renderSelection()}
              {!mainAgent && childFor === orchestratorTarget.id ? renderChildForm(orchestratorTarget, 0) : null}
              {tree.rows.length === 0 ? <p className="mr-side-note">No agents are listed.</p> : null}
              <div className="mr-family-tree">{boxes.map(renderBox)}</div>
            </>
          ) : readError ? null : <p className="mr-side-note">Loading agents...</p>}
        </div>
      ) : null}
      {confirm ? (
        <div ref={confirmRef} className="mr-side-confirm" role="dialog" aria-modal="true" aria-label={confirm.label}>
          <section className="mr-side-confirm-card">
            <p className="mr-side-confirm-text">{busy && confirm.busyText ? confirm.busyText : confirm.text}</p>
            {confirm.detail ? <p className="mr-family-confirm-detail mono">{confirm.detail}</p> : null}
            {confirm.notes ? <p className="mr-side-note">{confirm.notes}</p> : null}
            <div className="mr-side-confirm-actions">
              <button
                type="button"
                className={`mr-side-confirm-btn${confirm.tone === 'danger' ? ' is-danger' : ' is-primary'}`}
                disabled={busy}
                onClick={runConfirm}
              >
                {confirm.label}
              </button>
              <button
                type="button"
                className="mr-side-confirm-btn"
                disabled={busy}
                onClick={() => setConfirm(null)}
              >
                Cancel
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </section>
  )
}

export default FamilyTree
