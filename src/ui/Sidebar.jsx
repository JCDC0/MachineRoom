import { Fragment, useEffect, useState } from 'react'
import {
  AGENT_NAME_MAX,
  AUTOCOMPACT_MAX,
  AUTOCOMPACT_MIN,
  ORCHESTRATOR_ID,
  SESSION_LIMIT,
  agentDraft,
  agentFormProblem,
  agentFormSummary,
  autocompactLine,
  cleanText,
  clampAutocompactPercent,
  findHarness,
  harnessEfforts,
  harnessGroups,
  harnessModels,
  laneChoice,
  laneFormProblem,
  previewLines,
  projectName,
  rosterSummary,
  sessionAge,
  sessionTitle,
  sessionRows,
  waitForBridge,
} from './sidebar.js'

const GROUP_LABEL = { pinned: 'Pinned', starred: 'Starred', recent: 'Recent' }

function messageOf(error) {
  return error instanceof Error && error.message ? error.message : 'The bridge refused the change.'
}

function Gear() {
  return (
    <svg className="mr-side-gear" viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
      <circle cx="8" cy="8" r="2.6" fill="none" stroke="currentColor" strokeWidth="1.2" />
      <path
        d="M8 1v2.2M8 12.8V15M1 8h2.2M12.8 8H15M3 3l1.6 1.6M11.4 11.4L13 13M13 3l-1.6 1.6M4.6 11.4L3 13"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
      />
    </svg>
  )
}

export function Sidebar({ client = null, live = false, onOpenSettings = () => {}, project = '' }) {
  const connected = live === true
  const canProjects = typeof client?.projects === 'function'
  const canSessions = typeof client?.orchestratorSessions === 'function'
  const available = connected && canProjects && canSessions
  const [projects, setProjects] = useState(null)
  const [sessions, setSessions] = useState(null)
  const [lanes, setLanes] = useState(null)
  const [orchestrators, setOrchestrators] = useState(null)
  const [harnesses, setHarnesses] = useState(null)
  const [models, setModels] = useState(null)
  const [readError, setReadError] = useState('')
  const [actionError, setActionError] = useState('')
  const [busy, setBusy] = useState(false)
  const [confirm, setConfirm] = useState(null)
  const [preview, setPreview] = useState(null)
  const [showAll, setShowAll] = useState(false)
  const [collapsed, setCollapsed] = useState([])
  const [opened, setOpened] = useState([])
  const [agentsOpen, setAgentsOpen] = useState(true)
  const [adding, setAdding] = useState(false)
  const [draft, setDraft] = useState(null)
  const [editing, setEditing] = useState(null)
  const [renaming, setRenaming] = useState(null)

  useEffect(() => {
    if (!connected) return undefined
    let active = true
    setReadError('')
    const reads = [
      ['projects', () => client?.projects?.()],
      ['sessions', () => client?.orchestratorSessions?.({ id: ORCHESTRATOR_ID })],
      ['lanes', () => client?.lanes?.()],
      ['orchestrators', () => client?.orchestrators?.()],
      ['harnesses', () => client?.harnesses?.()],
      ['models', () => client?.models?.()],
    ]
    const jobs = reads.map(([, read]) => {
      try {
        return Promise.resolve(read())
      } catch (error) {
        return Promise.reject(error)
      }
    })
    Promise.allSettled(jobs).then((results) => {
      if (!active) return
      const values = {}
      results.forEach((result, index) => {
        if (result.status === 'fulfilled' && result.value) values[reads[index][0]] = result.value
      })
      if (values.projects) setProjects(values.projects)
      if (values.sessions) setSessions(values.sessions)
      if (values.lanes) setLanes(values.lanes)
      if (values.orchestrators) setOrchestrators(values.orchestrators)
      if (values.harnesses) setHarnesses(values.harnesses)
      if (values.models) setModels(values.models)
      const failed = results.find((result) => result.status === 'rejected')
      if (failed) setReadError(messageOf(failed.reason))
    })
    return () => {
      active = false
    }
  }, [client, connected])

  useEffect(() => {
    if (!adding) return
    const groups = harnessGroups(harnesses)
    if (groups.available.length === 0) return
    if (!draft || !draft.harness) {
      setDraft((current) => ({
        ...agentDraft(harnesses, models),
        name: current?.name ?? '',
      }))
    }
  }, [adding, draft, harnesses, models])

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

  async function refreshSessions() {
    if (typeof client?.orchestratorSessions !== 'function') return
    const answer = await client.orchestratorSessions({ id: ORCHESTRATOR_ID })
    setSessions(answer)
  }

  async function refreshLanes() {
    if (typeof client?.lanes !== 'function') return
    const answer = await client.lanes()
    setLanes(answer)
  }

  async function refreshOrchestrators() {
    if (typeof client?.orchestrators !== 'function') return
    const answer = await client.orchestrators()
    setOrchestrators(answer)
  }

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
    } finally {
      setBusy(false)
    }
  }

  function askNew() {
    if (typeof client?.newOrchestratorSession !== 'function') {
      setActionError('This bridge cannot start a conversation.')
      return
    }
    ask({
      text: 'Start a new conversation? The current one is kept in Recent.',
      label: 'New conversation',
      busyText: 'Starting a conversation...',
      run: async () => {
        await client.newOrchestratorSession({ id: ORCHESTRATOR_ID, confirmed: true })
        setPreview(null)
        setShowAll(false)
        await refreshSessions()
      },
    })
  }

  async function openPreview(row) {
    if (!row) return
    setActionError('')
    setPreview({ loading: true, current: row.current, session: row.id, title: row.title })
    try {
      if (row.current) {
        if (typeof client?.orchestrator !== 'function') throw new Error('This bridge cannot show this conversation.')
        const answer = await client.orchestrator()
        setPreview({
          loading: false,
          current: true,
          session: '',
          title: row.title,
          messages: Array.isArray(answer?.messages) ? answer.messages : [],
        })
        return
      }
      if (!row.id) throw new Error('This conversation has no session.')
      if (typeof client?.orchestratorSession !== 'function') {
        throw new Error('This bridge cannot show a conversation.')
      }
      const answer = await client.orchestratorSession({ id: ORCHESTRATOR_ID, session: row.id })
      setPreview({
        loading: false,
        current: false,
        session: row.id,
        title: sessionTitle(answer?.title ?? row.title),
        messages: Array.isArray(answer?.messages) ? answer.messages : [],
      })
    } catch (error) {
      setPreview(null)
      setActionError(messageOf(error))
    }
  }

  function askContinue() {
    if (!preview || preview.current) return
    if (typeof client?.openOrchestratorSession !== 'function') {
      setActionError('This bridge cannot open a conversation.')
      return
    }
    const target = preview
    ask({
      text: 'Continue this conversation? The current one is kept in Recent.',
      label: 'Continue',
      busyText: 'Opening the conversation...',
      run: async () => {
        await client.openOrchestratorSession({
          id: ORCHESTRATOR_ID,
          session: target.session,
          confirmed: true,
        })
        setPreview(null)
        setShowAll(false)
        await refreshSessions()
      },
    })
  }

  async function setFlag(row, patch) {
    if (typeof client?.updateOrchestratorSession !== 'function') {
      setActionError('This bridge cannot change conversations.')
      return
    }
    setBusy(true)
    setActionError('')
    try {
      await client.updateOrchestratorSession({
        id: ORCHESTRATOR_ID,
        session: row.id,
        ...patch,
        confirmed: true,
      })
      await refreshSessions()
    } catch (error) {
      setActionError(messageOf(error))
    } finally {
      setBusy(false)
    }
  }

  function startRename(row) {
    if (!row.id) return
    setRenaming({ id: row.id, value: row.title })
    setActionError('')
  }

  async function saveRename() {
    if (!renaming) return
    const title = cleanText(renaming.value)
    if (!title) {
      setActionError('Write a name for the conversation.')
      return
    }
    if (title.length > 80) {
      setActionError('Keep the name to 80 characters.')
      return
    }
    if (typeof client?.updateOrchestratorSession !== 'function') {
      setActionError('This bridge cannot change conversations.')
      return
    }
    setBusy(true)
    setActionError('')
    try {
      await client.updateOrchestratorSession({
        id: ORCHESTRATOR_ID,
        session: renaming.id,
        title,
        confirmed: true,
      })
      setRenaming(null)
      await refreshSessions()
    } catch (error) {
      setActionError(messageOf(error))
    } finally {
      setBusy(false)
    }
  }

  function askDelete(row) {
    if (!row.id) return
    if (typeof client?.deleteOrchestratorSession !== 'function') {
      setActionError('This bridge cannot delete a conversation.')
      return
    }
    ask({
      text: `Delete "${row.title}"? This cannot be undone.`,
      label: 'Delete',
      tone: 'danger',
      busyText: 'Deleting the conversation...',
      run: async () => {
        await client.deleteOrchestratorSession({ id: ORCHESTRATOR_ID, session: row.id, confirmed: true })
        setPreview((current) => (current && current.session === row.id ? null : current))
        await refreshSessions()
      },
    })
  }

  function askProject(entry) {
    const path = cleanText(entry?.path)
    if (!path) return
    const label = projectName(entry)
    if (path) setOpened((current) => (current.includes(path) ? current : [...current, path]))
    ask({
      text: `Open ${label}? The room restarts on that folder.`,
      label: 'Open project',
      busyText: `Opening ${label}...`,
      run: async () => {
        if (typeof client?.openProject !== 'function') {
          throw new Error('This bridge cannot open another project.')
        }
        await client.openProject({ path, confirmed: true })
        const ready = await waitForBridge(client, { path })
        if (!ready) throw new Error('The room did not come back. Run machineroom in that folder.')
        if (typeof window !== 'undefined') window.location.reload()
      },
    })
  }

  function askLane(lane, on) {
    if (typeof client?.setActiveLanes !== 'function') {
      setActionError('This bridge cannot change the agents.')
      return
    }
    const label = cleanText(lane?.name, 80) || cleanText(lane?.key, 80)
    const choice = laneChoice(lanes?.lanes, on ? { add: [lane.key] } : { remove: [lane.key] })
    ask({
      text: on ? `Add ${label} to the active agents?` : `Remove ${label} from the active agents?`,
      label: on ? 'Add agent' : 'Remove agent',
      tone: on ? 'primary' : 'danger',
      busyText: on ? 'Adding the agent...' : 'Removing the agent...',
      run: async () => {
        await client.setActiveLanes({ lanes: choice, confirmed: true })
        await refreshLanes()
      },
    })
  }

  function harnessFor(key) {
    return findHarness(harnesses, key) ?? cleanText(key, 40)
  }

  function openOrchestrator(row) {
    if (editing && editing.kind === 'orchestrator' && editing.id === row.id) {
      setEditing(null)
      return
    }
    setActionError('')
    setAdding(false)
    setDraft(null)
    setEditing({
      kind: 'orchestrator',
      id: row.id,
      name: row.name,
      harness: row.harness,
      model: row.model,
      effort: row.effort,
      autocompact: row.autocompact,
      percent: row.percent,
    })
  }

  function askOrchestratorModel(row, model) {
    if (!model || model === row.model) return
    if (typeof client?.setOrchestratorModel !== 'function') {
      setActionError('This bridge cannot set a model.')
      return
    }
    ask({
      text: `Set ${model} for ${row.name}?`,
      label: 'Set model',
      busyText: 'Setting the model...',
      run: async () => {
        await client.setOrchestratorModel({ id: row.id, model, confirmed: true })
        setEditing((current) =>
          current && current.kind === 'orchestrator' && current.id === row.id
            ? { ...current, model }
            : current
        )
        await refreshOrchestrators()
      },
    })
  }

  function askOrchestratorEffort(row, effort) {
    if (!effort || effort === row.effort) return
    if (typeof client?.setOrchestratorEffort !== 'function') {
      setActionError('This bridge cannot set an effort.')
      return
    }
    ask({
      text: `Set effort ${effort} for ${row.name}?`,
      label: 'Set effort',
      busyText: 'Setting the effort...',
      run: async () => {
        await client.setOrchestratorEffort({ id: row.id, effort, confirmed: true })
        setEditing((current) =>
          current && current.kind === 'orchestrator' && current.id === row.id
            ? { ...current, effort }
            : current
        )
        await refreshOrchestrators()
      },
    })
  }

  function askAutocompact(row) {
    if (!editing || editing.kind !== 'orchestrator' || editing.id !== row.id) return
    if (typeof client?.setAutocompact !== 'function') {
      setActionError('This bridge cannot set autocompact.')
      return
    }
    const on = editing.autocompact === true
    const percent = clampAutocompactPercent(editing.percent)
    ask({
      text: on
        ? `Turn autocompact on at ${percent}% for ${row.name}?`
        : `Turn autocompact off for ${row.name}?`,
      label: 'Save',
      busyText: 'Saving autocompact...',
      run: async () => {
        await client.setAutocompact({ id: row.id, on, percent, confirmed: true })
        setEditing((current) =>
          current && current.kind === 'orchestrator' && current.id === row.id
            ? { ...current, autocompact: on, percent }
            : current
        )
        await refreshOrchestrators()
      },
    })
  }

  function openLane(lane) {
    if (editing && editing.kind === 'lane' && editing.key === lane.key) {
      setEditing(null)
      return
    }
    setActionError('')
    setAdding(false)
    setDraft(null)
    setEditing({
      kind: 'lane',
      key: lane.key,
      harness: lane.harness,
      name: lane.name,
      model: lane.model,
      effort: lane.effort,
    })
  }

  function askLaneSave(lane) {
    if (!editing || editing.kind !== 'lane' || editing.key !== lane.key) return
    if (typeof client?.updateLane !== 'function') {
      setActionError('This bridge cannot change an agent.')
      return
    }
    const host = harnessFor(lane.harness)
    const problem = laneFormProblem(editing, {
      models: harnessModels(host, models),
      efforts: harnessEfforts(host),
    })
    if (problem) {
      setActionError(problem)
      return
    }
    const name = cleanText(editing.name, AGENT_NAME_MAX)
    ask({
      text: `Save "${name}"${editing.model ? ` on ${editing.model}` : ''}?`,
      label: 'Save',
      busyText: 'Saving the agent...',
      run: async () => {
        await client.updateLane({
          key: lane.key,
          name,
          model: editing.model,
          effort: editing.effort,
          confirmed: true,
        })
        setEditing(null)
        await refreshLanes()
      },
    })
  }

  function askLaneRemove(lane) {
    if (typeof client?.deleteLane !== 'function') {
      setActionError('This bridge cannot remove an agent.')
      return
    }
    ask({
      text: `Remove "${lane.name}"? This cannot be undone.`,
      label: 'Remove',
      tone: 'danger',
      busyText: 'Removing the agent...',
      run: async () => {
        await client.deleteLane({ key: lane.key, confirmed: true })
        setEditing((current) =>
          current && current.kind === 'lane' && current.key === lane.key ? null : current
        )
        await refreshLanes()
      },
    })
  }

  function toggleAdd() {
    if (adding) {
      setAdding(false)
      setDraft(null)
      return
    }
    setActionError('')
    setEditing(null)
    setDraft(agentDraft(harnesses, models))
    setAdding(true)
  }

  function chooseHarness(harness) {
    if (!harness || harness.available !== true) return
    const choices = harnessModels(harness, models)
    const efforts = harnessEfforts(harness)
    setDraft((current) => ({
      ...(current ?? { name: '' }),
      harness: harness.key,
      model: choices[0]?.id ?? '',
      effort: efforts[0] ?? '',
    }))
  }

  function askCreate() {
    if (typeof client?.createLane !== 'function') {
      setActionError('This bridge cannot create an agent.')
      return
    }
    const problem = agentFormProblem(draft, harnesses, models)
    if (problem) {
      setActionError(problem)
      return
    }
    const payload = {
      name: cleanText(draft?.name, AGENT_NAME_MAX),
      harness: draft.harness,
      model: draft.model,
      effort: draft.effort,
    }
    ask({
      text: agentFormSummary(draft, harnesses),
      label: 'Create',
      busyText: 'Creating the agent...',
      run: async () => {
        await client.createLane({ ...payload, confirmed: true })
        setAdding(false)
        setDraft(null)
        await refreshLanes()
      },
    })
  }

  function showProjects() {
    if (typeof window === 'undefined') return
    window.dispatchEvent(new CustomEvent('machineroom:projects'))
  }

  function toggleCollapsed(path) {
    if (!path) return
    setCollapsed((current) =>
      current.includes(path) ? current.filter((item) => item !== path) : [...current, path]
    )
  }

  function toggleOpened(path) {
    if (!path) return
    setOpened((current) =>
      current.includes(path) ? current.filter((item) => item !== path) : [...current, path]
    )
  }

  const now = Date.now()
  const rows = sessionRows(sessions, { expanded: showAll })
  const roster = rosterSummary(orchestrators, lanes)
  const fallbackName =
    cleanText(String(project ?? '').replace(/^\/+/, '')) || 'Project'
  const currentProject = projects?.current && typeof projects.current === 'object' ? projects.current : null
  const currentPath = cleanText(currentProject?.path)
  const currentOpen = currentPath ? !collapsed.includes(currentPath) : true
  const recentProjects = (Array.isArray(projects?.recent) ? projects.recent : []).filter(
    (entry) => entry && typeof entry === 'object' && cleanText(entry.path)
  )
  const projectLabel = currentProject ? projectName(currentProject) : fallbackName
  const title = preview ? sessionTitle(preview.title) : ''
  const lines = preview && !preview.loading ? previewLines(preview) : []

  function renderSessionRow(row) {
    if (renaming && renaming.id === row.id) {
      return (
        <form
          className="mr-side-rename"
          key={`rename-${row.id}`}
          onSubmit={(event) => {
            event.preventDefault()
            saveRename()
          }}
        >
          <input
            className="mr-side-rename-input mono"
            value={renaming.value}
            maxLength={80}
            aria-label={`Rename ${row.title}`}
            autoFocus
            onChange={(event) => setRenaming({ ...renaming, value: event.target.value })}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                event.preventDefault()
                setRenaming(null)
              }
            }}
          />
          <button type="submit" className="mr-side-action" disabled={busy}>
            Save
          </button>
          <button type="button" className="mr-side-action" disabled={busy} onClick={() => setRenaming(null)}>
            Cancel
          </button>
        </form>
      )
    }
    return (
      <div className={`mr-side-row${row.current ? ' is-current' : ''}`} key={row.id || 'current'}>
        <button
          type="button"
          className="mr-side-session"
          title={row.title}
          onClick={() => openPreview(row)}
        >
          <span className="mr-side-title">{row.title}</span>
        </button>
        {row.current && <span className="mr-side-current mono">Current</span>}
        <span className="mr-side-age mono">{sessionAge(row, now)}</span>
        {!row.current && row.id ? (
          <span className="mr-side-actions">
            <button
              type="button"
              className={`mr-side-action${row.pinned ? ' is-on' : ''}`}
              disabled={busy}
              aria-label={`${row.pinned ? 'Unpin' : 'Pin'} ${row.title}`}
              onClick={() => setFlag(row, { pinned: !row.pinned })}
            >
              {row.pinned ? 'Unpin' : 'Pin'}
            </button>
            <button
              type="button"
              className={`mr-side-action${row.starred ? ' is-on' : ''}`}
              disabled={busy}
              aria-label={`${row.starred ? 'Unstar' : 'Star'} ${row.title}`}
              onClick={() => setFlag(row, { starred: !row.starred })}
            >
              {row.starred ? 'Unstar' : 'Star'}
            </button>
            <button
              type="button"
              className="mr-side-action"
              disabled={busy}
              aria-label={`Rename ${row.title}`}
              onClick={() => startRename(row)}
            >
              Rename
            </button>
            <button
              type="button"
              className="mr-side-action is-danger"
              disabled={busy}
              aria-label={`Delete ${row.title}`}
              onClick={() => askDelete(row)}
            >
              Delete
            </button>
          </span>
        ) : null}
      </div>
    )
  }

  function renderSessionRows() {
    let group = ''
    return rows.rows.map((row) => {
      const label = row.group !== 'current' && row.group !== group ? GROUP_LABEL[row.group] : ''
      group = row.group
      return (
        <Fragment key={row.id || 'current'}>
          {label ? <p className="mr-side-group mono">{label}</p> : null}
          {renderSessionRow(row)}
        </Fragment>
      )
    })
  }

  function renderProjectsHead() {
    return (
      <div className="mr-side-head">
        <span className="mr-side-head-title mono">Projects</span>
        <button type="button" className="mr-side-open-folder" onClick={showProjects}>
          Open folder
        </button>
      </div>
    )
  }

  function renderProjects() {
    return (
      <section className="mr-side-projects" aria-label="Projects">
        {renderProjectsHead()}
        {!projects ? (
          <p className="mr-side-note">{readError ? 'Projects are not available.' : 'Loading projects...'}</p>
        ) : null}
        {currentProject ? (
          <>
            <div className={`mr-side-project${currentOpen ? ' is-open' : ''}`}>
              <button
                type="button"
                className="mr-side-twist"
                aria-expanded={currentOpen}
                aria-label={currentOpen ? `Close ${projectLabel}` : `Open ${projectLabel}`}
                onClick={() => toggleCollapsed(currentPath)}
              >
                {currentOpen ? '-' : '+'}
              </button>
              <span className="mr-side-folder" aria-hidden="true" />
              <button
                type="button"
                className="mr-side-project-name"
                title={currentPath}
                onClick={() => toggleCollapsed(currentPath)}
              >
                {projectLabel}
              </button>
            </div>
            {currentOpen ? (
              <div className="mr-side-conversations">
                {!sessions ? (
                  <p className="mr-side-note">Loading conversations...</p>
                ) : rows.total === 0 ? (
                  <p className="mr-side-note">No conversations yet.</p>
                ) : (
                  <>
                    {renderSessionRows()}
                    {rows.hidden > 0 ? (
                      <button type="button" className="mr-side-more" onClick={() => setShowAll(true)}>
                        {`See all (${rows.total})`}
                      </button>
                    ) : null}
                    {showAll && rows.total > SESSION_LIMIT ? (
                      <button type="button" className="mr-side-more" onClick={() => setShowAll(false)}>
                        Show less
                      </button>
                    ) : null}
                  </>
                )}
              </div>
            ) : null}
          </>
        ) : null}
        {recentProjects.map((entry) => {
          const path = cleanText(entry.path)
          const label = projectName(entry)
          const isOpen = opened.includes(path)
          const entrySessions = Array.isArray(entry.sessions) ? entry.sessions : []
          return (
            <Fragment key={path}>
              <div className={`mr-side-project${isOpen ? ' is-open' : ''}`}>
                <button
                  type="button"
                  className="mr-side-twist"
                  aria-expanded={isOpen}
                  aria-label={isOpen ? `Close ${label}` : `Open ${label}`}
                  onClick={() => toggleOpened(path)}
                >
                  {isOpen ? '-' : '+'}
                </button>
                <span className="mr-side-folder" aria-hidden="true" />
                <button
                  type="button"
                  className="mr-side-project-name"
                  title={path}
                  onClick={() => askProject(entry)}
                >
                  {label}
                </button>
              </div>
              {isOpen ? (
                <div className="mr-side-conversations">
                  {entrySessions.length === 0 ? (
                    <p className="mr-side-note">No conversations yet.</p>
                  ) : (
                    entrySessions.map((session, index) => (
                      <button
                        type="button"
                        className="mr-side-row is-recent"
                        key={session?.id ?? `${path}-${index}`}
                        title={sessionTitle(session?.title)}
                        onClick={() => askProject(entry)}
                      >
                        <span className="mr-side-title">{sessionTitle(session?.title)}</span>
                        <span className="mr-side-age mono">{sessionAge(session, now)}</span>
                      </button>
                    ))
                  )}
                </div>
              ) : null}
            </Fragment>
          )
        })}
      </section>
    )
  }

  function renderOrchestrator(row) {
    const isEditing = Boolean(
      editing && editing.kind === 'orchestrator' && editing.id === row.id
    )
    return (
      <Fragment key={row.id}>
        <button
          type="button"
          className={`mr-side-orch${isEditing ? ' is-open' : ''}`}
          aria-expanded={isEditing}
          aria-label={`Edit ${row.name}`}
          onClick={() => openOrchestrator(row)}
        >
          <span className="mr-side-orch-top">
            <span className="mr-side-lane-name">{row.name}</span>
            {row.sub ? <span className="mr-side-tag mono">sub</span> : null}
          </span>
          <span className="mr-side-meta mono">
            <span>{row.harness || 'harness unknown'}</span>
            <span className="mr-side-meta-model" title={row.model}>
              {row.model || 'no model'}
            </span>
            <span>{row.effort || 'default'}</span>
            <span>{autocompactLine(row)}</span>
          </span>
        </button>
        {isEditing ? renderOrchestratorEditor(row) : null}
      </Fragment>
    )
  }

  function renderOrchestratorEditor(row) {
    const host = harnessFor(row.harness)
    const choices = harnessModels(host, models)
    const efforts = harnessEfforts(host)
    const current = editing
    return (
      <div className="mr-side-editor" role="group" aria-label={`Settings for ${row.name}`}>
        {typeof client?.setOrchestratorModel === 'function' ? (
          <label className="mr-side-field">
            <span className="mr-side-field-label mono">Model</span>
            <select
              className="mr-side-select mono"
              aria-label={`Model for ${row.name}`}
              value={current.model}
              onChange={(event) => askOrchestratorModel(row, event.target.value)}
            >
              {!current.model ? (
                <option value="" disabled>
                  Choose a model
                </option>
              ) : null}
              {choices.map((choice) => (
                <option value={choice.id} key={choice.id}>
                  {choice.label}
                </option>
              ))}
              {current.model && !choices.some((choice) => choice.id === current.model) ? (
                <option value={current.model}>{current.model}</option>
              ) : null}
            </select>
          </label>
        ) : (
          <p className="mr-side-note is-dim">This bridge cannot set a model.</p>
        )}
        {typeof client?.setOrchestratorEffort === 'function' ? (
          efforts.length > 0 ? (
            <label className="mr-side-field">
              <span className="mr-side-field-label mono">Effort</span>
              <select
                className="mr-side-select mono"
                aria-label={`Effort for ${row.name}`}
                value={current.effort}
                onChange={(event) => askOrchestratorEffort(row, event.target.value)}
              >
                <option value="" disabled>
                  default
                </option>
                {efforts.map((level) => (
                  <option value={level} key={level}>
                    {level}
                  </option>
                ))}
                {current.effort && !efforts.includes(current.effort) ? (
                  <option value={current.effort}>{current.effort}</option>
                ) : null}
              </select>
            </label>
          ) : (
            <p className="mr-side-note is-dim">No effort levels for this harness.</p>
          )
        ) : (
          <p className="mr-side-note is-dim">This bridge cannot set an effort.</p>
        )}
        {typeof client?.setAutocompact === 'function' ? (
          <div className="mr-side-auto">
            <label className="mr-side-field is-inline">
              <span className="mr-side-field-label mono">Autocompact</span>
              <input
                type="checkbox"
                role="switch"
                aria-label={`Autocompact for ${row.name}`}
                checked={current.autocompact === true}
                onChange={(event) => setEditing({ ...current, autocompact: event.target.checked })}
              />
            </label>
            <label className="mr-side-field is-inline">
              <span className="mr-side-field-label mono">Percent</span>
              <input
                type="range"
                min={AUTOCOMPACT_MIN}
                max={AUTOCOMPACT_MAX}
                step="1"
                aria-label="Autocompact percent"
                value={current.percent}
                disabled={current.autocompact !== true}
                onChange={(event) =>
                  setEditing({ ...current, percent: clampAutocompactPercent(event.target.value) })
                }
              />
              <span className="mr-side-percent mono">{`${current.percent}%`}</span>
            </label>
            <button type="button" className="mr-side-action" disabled={busy} onClick={() => askAutocompact(row)}>
              Save
            </button>
          </div>
        ) : (
          <p className="mr-side-note is-dim">This bridge cannot set autocompact.</p>
        )}
        <div className="mr-side-form-actions">
          <button type="button" className="mr-side-action" onClick={() => setEditing(null)}>
            Close
          </button>
        </div>
      </div>
    )
  }

  function renderLane(lane) {
    const isEditing = Boolean(editing && editing.kind === 'lane' && editing.key === lane.key)
    const host = harnessFor(lane.harness)
    const choices = harnessModels(host, models)
    const efforts = harnessEfforts(host)
    return (
      <Fragment key={lane.key}>
        <div className={`mr-side-lane${lane.active ? ' is-active' : ''}`}>
          <span className={`mr-side-dot${lane.working ? ' is-working' : ''}`} aria-hidden="true" />
          <div className="mr-side-lane-body">
            <div className="mr-side-lane-top">
              {lane.custom ? (
                <button
                  type="button"
                  className="mr-side-lane-name"
                  aria-expanded={isEditing}
                  onClick={() => openLane(lane)}
                >
                  {lane.name}
                </button>
              ) : (
                <span className="mr-side-lane-name">{lane.name}</span>
              )}
              <button
                type="button"
                role="switch"
                aria-checked={lane.active}
                aria-label={`${lane.active ? 'Turn off' : 'Turn on'} ${lane.name}`}
                className={`mr-side-switch${lane.active ? ' is-on' : ''}`}
                disabled={busy}
                onClick={() => askLane(lane, !lane.active)}
              >
                <span className="mr-side-switch-knob" aria-hidden="true" />
              </button>
            </div>
            <div className="mr-side-meta mono">
              <span>{lane.harness || 'harness unknown'}</span>
              <span className="mr-side-meta-model" title={lane.model}>
                {lane.model || 'no model'}
              </span>
              <span>{lane.effort || 'default'}</span>
            </div>
            {lane.custom ? (
              <div className="mr-side-lane-actions">
                <button
                  type="button"
                  className="mr-side-action"
                  disabled={busy || typeof client?.updateLane !== 'function'}
                  onClick={() => openLane(lane)}
                >
                  {isEditing ? 'Close' : 'Edit'}
                </button>
                <button
                  type="button"
                  className="mr-side-action is-danger"
                  disabled={busy || typeof client?.deleteLane !== 'function'}
                  onClick={() => askLaneRemove(lane)}
                >
                  Remove
                </button>
              </div>
            ) : null}
          </div>
        </div>
        {isEditing ? renderLaneEditor(lane, choices, efforts) : null}
      </Fragment>
    )
  }

  function renderLaneEditor(lane, choices, efforts) {
    const current = editing
    return (
      <form
        className="mr-side-editor"
        aria-label={`Edit ${lane.name}`}
        onSubmit={(event) => {
          event.preventDefault()
          askLaneSave(lane)
        }}
      >
        <label className="mr-side-field">
          <span className="mr-side-field-label mono">Name</span>
          <input
            className="mr-side-input mono"
            value={current.name}
            maxLength={AGENT_NAME_MAX}
            aria-label={`Name for ${lane.name}`}
            onChange={(event) => setEditing({ ...current, name: event.target.value })}
          />
        </label>
        {choices.length > 0 ? (
          <label className="mr-side-field">
            <span className="mr-side-field-label mono">Model</span>
            <select
              className="mr-side-select mono"
              aria-label={`Model for ${lane.name}`}
              value={current.model}
              onChange={(event) => setEditing({ ...current, model: event.target.value })}
            >
              {!current.model ? (
                <option value="" disabled>
                  Choose a model
                </option>
              ) : null}
              {choices.map((choice) => (
                <option value={choice.id} key={choice.id}>
                  {choice.label}
                </option>
              ))}
              {current.model && !choices.some((choice) => choice.id === current.model) ? (
                <option value={current.model}>{current.model}</option>
              ) : null}
            </select>
          </label>
        ) : (
          <p className="mr-side-note is-dim">No models listed for this harness.</p>
        )}
        {efforts.length > 0 ? (
          <label className="mr-side-field">
            <span className="mr-side-field-label mono">Effort</span>
            <select
              className="mr-side-select mono"
              aria-label={`Effort for ${lane.name}`}
              value={current.effort}
              onChange={(event) => setEditing({ ...current, effort: event.target.value })}
            >
              <option value="" disabled>
                default
              </option>
              {efforts.map((level) => (
                <option value={level} key={level}>
                  {level}
                </option>
              ))}
              {current.effort && !efforts.includes(current.effort) ? (
                <option value={current.effort}>{current.effort}</option>
              ) : null}
            </select>
          </label>
        ) : null}
        <div className="mr-side-form-actions">
          <button
            type="submit"
            className="mr-side-primary"
            disabled={busy || typeof client?.updateLane !== 'function'}
          >
            Save
          </button>
          <button type="button" className="mr-side-action" disabled={busy} onClick={() => setEditing(null)}>
            Cancel
          </button>
        </div>
        {typeof client?.updateLane !== 'function' ? (
          <p className="mr-side-note is-dim">This bridge cannot change an agent.</p>
        ) : null}
      </form>
    )
  }

  function renderAgentForm() {
    const groups = harnessGroups(harnesses)
    const selected = draft ? findHarness(harnesses, draft.harness) : null
    const choices = selected ? harnessModels(selected, models) : []
    const efforts = selected ? harnessEfforts(selected) : []
    const canCreate = typeof client?.createLane === 'function'
    return (
      <form
        className="mr-side-agent-form"
        aria-label="Add agent"
        onSubmit={(event) => {
          event.preventDefault()
          askCreate()
        }}
      >
        {typeof client?.harnesses !== 'function' ? (
          <p className="mr-side-note is-dim">This bridge cannot list the harnesses.</p>
        ) : null}
        {harnesses === null && typeof client?.harnesses === 'function' ? (
          <p className="mr-side-note">Loading harnesses...</p>
        ) : null}
        {harnesses !== null && groups.all.length === 0 ? (
          <p className="mr-side-note is-dim">No harnesses are listed.</p>
        ) : null}
        <label className="mr-side-field">
          <span className="mr-side-field-label mono">Name</span>
          <input
            className="mr-side-input mono"
            value={draft?.name ?? ''}
            maxLength={AGENT_NAME_MAX}
            aria-label="Agent name"
            onChange={(event) => setDraft({ ...(draft ?? {}), name: event.target.value })}
          />
        </label>
        <div className="mr-side-harnesses" role="group" aria-label="Harness">
          {groups.available.map((harness) => (
            <button
              key={harness.key}
              type="button"
              className={`mr-side-harness${draft?.harness === harness.key ? ' is-on' : ''}`}
              aria-pressed={draft?.harness === harness.key}
              onClick={() => chooseHarness(harness)}
            >
              {harness.name}
            </button>
          ))}
          {groups.unavailable.map((harness) => (
            <span className="mr-side-harness is-missing" key={harness.key}>
              <span>{harness.name}</span>
              <span className="mono">not found on this computer</span>
            </span>
          ))}
        </div>
        {selected && choices.length > 0 ? (
          <label className="mr-side-field">
            <span className="mr-side-field-label mono">Model</span>
            <select
              className="mr-side-select mono"
              aria-label="Agent model"
              value={draft?.model ?? ''}
              onChange={(event) => setDraft((current) => ({ ...(current ?? {}), model: event.target.value }))}
            >
              {choices.map((choice) => (
                <option value={choice.id} key={choice.id}>
                  {choice.label}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        {selected && choices.length === 0 ? (
          <p className="mr-side-note is-dim">No models listed for this harness.</p>
        ) : null}
        {selected && efforts.length > 0 ? (
          <label className="mr-side-field">
            <span className="mr-side-field-label mono">Effort</span>
            <select
              className="mr-side-select mono"
              aria-label="Agent effort"
              value={draft?.effort ?? ''}
              onChange={(event) => setDraft((current) => ({ ...(current ?? {}), effort: event.target.value }))}
            >
              {efforts.map((level) => (
                <option value={level} key={level}>
                  {level}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <div className="mr-side-form-actions">
          <button type="submit" className="mr-side-primary" disabled={busy || !canCreate}>
            Create
          </button>
          <button
            type="button"
            className="mr-side-action"
            disabled={busy}
            onClick={() => {
              setAdding(false)
              setDraft(null)
            }}
          >
            Cancel
          </button>
        </div>
        {!canCreate ? <p className="mr-side-note is-dim">This bridge cannot create an agent.</p> : null}
      </form>
    )
  }

  function renderAgents() {
    if (!connected) return null
    const canOrchestrators = typeof client?.orchestrators === 'function'
    const canListLanes = typeof client?.lanes === 'function'
    if (!canOrchestrators && !canListLanes) return null
    return (
      <section className="mr-side-agents" aria-label="Agents">
        <button
          type="button"
          className="mr-side-head is-button"
          aria-expanded={agentsOpen}
          onClick={() => setAgentsOpen((open) => !open)}
        >
          <span className="mr-side-head-title mono">Agents</span>
          <span className="mr-side-count mono">
            {lanes ? roster.line : canListLanes ? 'Loading agents...' : 'No lanes'}
          </span>
          <span className="mr-side-twist" aria-hidden="true">
            {agentsOpen ? '-' : '+'}
          </span>
        </button>
        {agentsOpen ? (
          <div className="mr-side-agent-list">
            <p className="mr-side-roster-group mono">Orchestrators</p>
            {!canOrchestrators ? (
              <p className="mr-side-note is-dim">This bridge cannot list the orchestrators.</p>
            ) : null}
            {orchestrators === null && canOrchestrators ? (
              <p className="mr-side-note">Loading orchestrators...</p>
            ) : null}
            {orchestrators !== null && roster.orchestrators.length === 0 ? (
              <p className="mr-side-note is-dim">No orchestrators are listed.</p>
            ) : null}
            {roster.orchestrators.map(renderOrchestrator)}
            <p className="mr-side-roster-group mono">Lanes</p>
            {!canListLanes ? <p className="mr-side-note is-dim">This bridge cannot list the lanes.</p> : null}
            {lanes === null && canListLanes ? <p className="mr-side-note">Loading agents...</p> : null}
            {lanes !== null && roster.lanes.length === 0 ? (
              <p className="mr-side-note">No lanes yet.</p>
            ) : null}
            {roster.lanes.map(renderLane)}
            {adding ? renderAgentForm() : null}
            <button type="button" className="mr-side-add" aria-expanded={adding} onClick={toggleAdd}>
              Add agent
            </button>
          </div>
        ) : null}
      </section>
    )
  }

  function renderPreview() {
    return (
      <section className="mr-side-preview" aria-label="Conversation preview">
        <div className="mr-side-preview-head">
          <button type="button" className="mr-side-back" onClick={() => setPreview(null)}>
            Back
          </button>
          <span className="mr-side-preview-title" title={title}>
            {title}
          </span>
        </div>
        <div className="mr-side-preview-body">
          {preview.loading ? (
            <p className="mr-side-note">Loading conversation...</p>
          ) : lines.length === 0 ? (
            <p className="mr-side-note">This conversation has no messages yet.</p>
          ) : (
            lines.map((line) => (
              <div className={`mr-side-message is-${line.from === 'owner' ? 'owner' : line.from === 'room' ? 'room' : 'agent'}`} key={line.id}>
                <span className="mr-side-message-from mono">{line.from}</span>
                <span className="mr-side-message-text">{line.text}</span>
              </div>
            ))
          )}
        </div>
        {!preview.loading && !preview.current ? (
          <div className="mr-side-preview-actions">
            <button type="button" className="mr-side-primary" onClick={askContinue}>
              Continue this conversation
            </button>
          </div>
        ) : null}
        {!preview.loading && preview.current ? (
          <p className="mr-side-note">This conversation is open.</p>
        ) : null}
      </section>
    )
  }

  return (
    <aside className="mr-side" aria-label="Projects and conversations">
      <button
        type="button"
        className="hud-sessions-button mr-side-new"
        disabled={!available || typeof client?.newOrchestratorSession !== 'function'}
        onClick={askNew}
      >
        <span className="mr-side-plus" aria-hidden="true">+</span>
        <span>New conversation</span>
      </button>
      {readError ? <p className="mr-side-error mono">{readError}</p> : null}
      {actionError ? <p className="mr-side-error mono" role="alert">{actionError}</p> : null}
      <div className="mr-side-body">
        {preview ? (
          renderPreview()
        ) : (
          <>
            {renderAgents()}
            {available ? (
              renderProjects()
            ) : (
              <section className="mr-side-projects" aria-label="Projects">
                {renderProjectsHead()}
                <div className="mr-side-offline">
                  <p className="mr-side-project-name">{projectLabel}</p>
                  <p className="mr-side-note">Projects and conversations appear when the room runs live.</p>
                </div>
              </section>
            )}
          </>
        )}
      </div>
      <footer className="mr-side-foot">
        <button type="button" className="hud-strip-settings" onClick={() => onOpenSettings?.()}>
          <Gear />
          <span>Settings</span>
        </button>
      </footer>
      {confirm ? (
        <div className="mr-side-confirm" role="dialog" aria-modal="true" aria-label={confirm.label}>
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
    </aside>
  )
}

export default Sidebar
