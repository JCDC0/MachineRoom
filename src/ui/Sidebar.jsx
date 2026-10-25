import { Fragment, useEffect, useState } from 'react'
import {
  ORCHESTRATOR_ID,
  SESSION_LIMIT,
  cleanText,
  laneChoice,
  laneSummary,
  previewLines,
  projectName,
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
  const canLanes = typeof client?.lanes === 'function'
  const available = connected && canProjects && canSessions
  const [projects, setProjects] = useState(null)
  const [sessions, setSessions] = useState(null)
  const [lanes, setLanes] = useState(null)
  const [readError, setReadError] = useState('')
  const [actionError, setActionError] = useState('')
  const [busy, setBusy] = useState(false)
  const [confirm, setConfirm] = useState(null)
  const [preview, setPreview] = useState(null)
  const [showAll, setShowAll] = useState(false)
  const [collapsed, setCollapsed] = useState([])
  const [opened, setOpened] = useState([])
  const [agentsOpen, setAgentsOpen] = useState(false)
  const [adding, setAdding] = useState(false)
  const [renaming, setRenaming] = useState(null)

  useEffect(() => {
    if (!connected) return undefined
    let active = true
    setReadError('')
    const jobs = [
      typeof client?.projects === 'function' ? client.projects() : Promise.resolve(null),
      typeof client?.orchestratorSessions === 'function'
        ? client.orchestratorSessions({ id: ORCHESTRATOR_ID })
        : Promise.resolve(null),
      typeof client?.lanes === 'function' ? client.lanes() : Promise.resolve(null),
    ]
    Promise.allSettled(jobs).then((results) => {
      if (!active) return
      if (results[0].status === 'fulfilled' && results[0].value) setProjects(results[0].value)
      if (results[1].status === 'fulfilled' && results[1].value) setSessions(results[1].value)
      if (results[2].status === 'fulfilled' && results[2].value) setLanes(results[2].value)
      const failed = results.find((result) => result.status === 'rejected')
      if (failed) setReadError(messageOf(failed.reason))
    })
    return () => {
      active = false
    }
  }, [client, connected])

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
        setAdding(false)
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
  const summary = laneSummary(lanes)
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

  function renderAgents() {
    if (!connected || !canLanes) return null
    return (
      <section className="mr-side-agents" aria-label="Agents">
        <button
          type="button"
          className="mr-side-head is-button"
          aria-expanded={agentsOpen}
          onClick={() => setAgentsOpen((open) => !open)}
        >
          <span className="mr-side-head-title mono">Agents</span>
          <span className="mr-side-count mono">{lanes ? summary.line : 'Loading agents...'}</span>
          <span className="mr-side-twist" aria-hidden="true">
            {agentsOpen ? '-' : '+'}
          </span>
        </button>
        {agentsOpen ? (
          <div className="mr-side-agent-list">
            {summary.active.map((lane) => (
              <div className="mr-side-lane" key={lane.key}>
                <span className={`mr-side-dot${lane.working ? ' is-working' : ''}`} aria-hidden="true" />
                <span className="mr-side-lane-name">{cleanText(lane.name, 80) || lane.key}</span>
                <span className="mr-side-lane-model mono">{cleanText(lane.model, 60) || cleanText(lane.harness, 40)}</span>
                <button
                  type="button"
                  className="mr-side-action is-danger"
                  disabled={busy}
                  aria-label={`Remove ${cleanText(lane.name, 80) || lane.key}`}
                  onClick={() => askLane(lane, false)}
                >
                  Remove
                </button>
              </div>
            ))}
            {summary.inactive.length > 0 ? (
              <button
                type="button"
                className="mr-side-add"
                aria-expanded={adding}
                onClick={() => setAdding((open) => !open)}
              >
                Add agent
              </button>
            ) : null}
            {adding
              ? summary.inactive.map((lane) => (
                  <div className="mr-side-lane is-inactive" key={lane.key}>
                    <span className="mr-side-lane-name">{cleanText(lane.name, 80) || lane.key}</span>
                    <span className="mr-side-lane-model mono">
                      {cleanText(lane.model, 60) || cleanText(lane.harness, 40)}
                    </span>
                    <button
                      type="button"
                      className="mr-side-action"
                      disabled={busy}
                      aria-label={`Add ${cleanText(lane.name, 80) || lane.key}`}
                      onClick={() => askLane(lane, true)}
                    >
                      Add
                    </button>
                  </div>
                ))
              : null}
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
        ) : available ? (
          <>
            {renderProjects()}
            {renderAgents()}
          </>
        ) : (
          <section className="mr-side-projects" aria-label="Projects">
            {renderProjectsHead()}
            <div className="mr-side-offline">
              <p className="mr-side-project-name">{projectLabel}</p>
              <p className="mr-side-note">Projects and conversations appear when the room runs live.</p>
            </div>
          </section>
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
