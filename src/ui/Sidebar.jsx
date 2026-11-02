import { Fragment, useEffect, useRef, useState } from 'react'
import { useDialogFocus } from './dialogFocus.js'
import FamilyTeam from './FamilyTeam.jsx'
import FamilyTree from './FamilyTree.jsx'
import RepositoryPanel from './RepositoryPanel.jsx'
import SidebarTabs from './SidebarTabs.jsx'
import { loadSettings, saveSettings } from './settings.js'
import {
  ORCHESTRATOR_ID,
  SESSION_LIMIT,
  cleanText,
  normalizeSidebarTab,
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

export function Sidebar({ client = null, live = false, project = '', tasks = null }) {
  const connected = live === true
  const canProjects = typeof client?.projects === 'function'
  const canSessions = typeof client?.orchestratorSessions === 'function'
  const canFamily = typeof client?.family === 'function'
  const available = connected && canProjects && canSessions
  const [tab, setTab] = useState(() => normalizeSidebarTab(loadSettings().sidebarTab))
  const [projects, setProjects] = useState(null)
  const [sessions, setSessions] = useState(null)
  const [readError, setReadError] = useState('')
  const [actionError, setActionError] = useState('')
  const [busy, setBusy] = useState(false)
  const [confirm, setConfirm] = useState(null)
  const [preview, setPreview] = useState(null)
  const [showAll, setShowAll] = useState(false)
  const [renaming, setRenaming] = useState(null)
  const previewReqRef = useRef(0)
  const confirmRef = useRef(null)

  useDialogFocus(Boolean(confirm), { containerRef: confirmRef })

  useEffect(() => {
    if (!connected) return undefined
    let active = true
    setReadError('')
    const reads = [
      ['projects', () => client?.projects?.()],
      ['sessions', () => client?.orchestratorSessions?.({ id: ORCHESTRATOR_ID })],
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

  function chooseTab(next) {
    const value = normalizeSidebarTab(next)
    setTab(value)
    saveSettings(undefined, { sidebarTab: value })
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
        previewReqRef.current += 1
        setPreview(null)
        setShowAll(false)
        await refreshSessions()
      },
    })
  }

  async function openPreview(row) {
    if (!row) return
    const ticket = previewReqRef.current + 1
    previewReqRef.current = ticket
    setActionError('')
    setPreview({ loading: true, current: row.current, session: row.id, title: row.title })
    try {
      if (row.current) {
        if (typeof client?.orchestrator !== 'function') throw new Error('This bridge cannot show this conversation.')
        const answer = await client.orchestrator()
        if (previewReqRef.current !== ticket) return
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
      if (previewReqRef.current !== ticket) return
      setPreview({
        loading: false,
        current: false,
        session: row.id,
        title: sessionTitle(answer?.title ?? row.title),
        messages: Array.isArray(answer?.messages) ? answer.messages : [],
      })
    } catch (error) {
      if (previewReqRef.current !== ticket) return
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

  function showProjects() {
    if (typeof window === 'undefined') return
    window.dispatchEvent(new CustomEvent('machineroom:projects'))
  }

  const now = Date.now()
  const rows = sessionRows(sessions, { expanded: showAll })
  const fallbackName =
    cleanText(String(project ?? '').replace(/^\/+/, '')) || 'Project'
  const currentProject = projects?.current && typeof projects.current === 'object' ? projects.current : null
  const currentPath = cleanText(currentProject?.path)
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

  function renderNewButton() {
    return (
      <button
        type="button"
        className="hud-sessions-button mr-side-new is-rounded"
        disabled={!available || typeof client?.newOrchestratorSession !== 'function'}
        onClick={askNew}
      >
        <span className="mr-side-plus" aria-hidden="true">+</span>
        <span>New conversation</span>
      </button>
    )
  }

  function renderChat() {
    return (
      <section className="mr-side-chat" aria-label="Conversations">
        {renderNewButton()}
        {available ? (
          <>
            <div className="mr-side-head">
              <span className="mr-side-head-title mono" title={currentPath}>
                {projectLabel}
              </span>
            </div>
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
          </>
        ) : (
          <div className="mr-side-offline">
            <p className="mr-side-project-name">{projectLabel}</p>
            <p className="mr-side-note">Projects and conversations appear when the room runs live.</p>
          </div>
        )}
      </section>
    )
  }

  function renderProjectsHead() {
    return (
      <div className="mr-side-head">
        <span className="mr-side-head-title mono">Projects</span>
        {connected ? (
          <button type="button" className="mr-side-open-folder" onClick={showProjects}>
            Open folder
          </button>
        ) : null}
      </div>
    )
  }

  function renderProjects() {
    return (
      <section className="mr-side-projects" aria-label="Projects">
        <RepositoryPanel client={client} live={connected} project={project} />
        {renderProjectsHead()}
        {!projects ? (
          <p className="mr-side-note">{readError ? 'Projects are not available.' : 'Loading projects...'}</p>
        ) : null}
        {available ? (
          <>
            {currentProject ? (
              <div className="mr-side-project is-current" title={currentPath}>
                <span className="mr-side-folder" aria-hidden="true" />
                <span className="mr-side-project-name">{projectLabel}</span>
                <span className="mr-side-current mono">Current</span>
              </div>
            ) : null}
            {recentProjects.map((entry) => {
              const path = cleanText(entry.path)
              return (
                <button
                  type="button"
                  className="mr-side-project is-button"
                  key={path}
                  title={path}
                  onClick={() => askProject(entry)}
                >
                  <span className="mr-side-folder" aria-hidden="true" />
                  <span className="mr-side-project-name">{projectName(entry)}</span>
                </button>
              )
            })}
          </>
        ) : (
          <div className="mr-side-offline">
            <p className="mr-side-project-name">{projectLabel}</p>
            <p className="mr-side-note">Projects and conversations appear when the room runs live.</p>
          </div>
        )}
      </section>
    )
  }

  function renderAgents() {
    return (
      <section className="mr-side-agents" aria-label="Agents">
        {connected && canFamily ? <FamilyTeam client={client} /> : null}
        {connected && canFamily ? <FamilyTree client={client} tasks={tasks} /> : null}
        {!connected || !canFamily ? (
          <p className="mr-side-note">Agents appear when the room runs live.</p>
        ) : null}
      </section>
    )
  }

  function renderPreview() {
    return (
      <section className="mr-side-preview" aria-label="Conversation preview">
        <div className="mr-side-preview-head">
          <button
            type="button"
            className="mr-side-back"
            onClick={() => {
              previewReqRef.current += 1
              setPreview(null)
            }}
          >
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
    <aside className="mr-side" aria-label="Sidebar">
      <SidebarTabs value={tab} onChange={chooseTab} />
      {readError ? <p className="mr-side-error mono">{readError}</p> : null}
      {actionError ? <p className="mr-side-error mono" role="alert">{actionError}</p> : null}
      <div className="mr-side-body">
        {tab === 'chat' ? (preview ? renderPreview() : renderChat()) : null}
        {tab === 'projects' ? renderProjects() : null}
        {tab === 'agents' ? renderAgents() : null}
      </div>
      {confirm ? (
        <div className="mr-side-confirm" ref={confirmRef} role="dialog" aria-modal="true" aria-label={confirm.label}>
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
