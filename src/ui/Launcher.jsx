import { useCallback, useEffect, useRef, useState } from 'react'
import { useDialogFocus } from './dialogFocus.js'
import {
  LAUNCHER_EVENT,
  LAUNCHER_TIMEOUT_TEXT,
  absolutePathProblem,
  keepWorkingLabel,
  launcherRows,
  launcherSeen,
  markLauncherSeen,
  openingLabel,
  pathName,
  pollProject,
  samePath,
  shouldOpenLauncher,
} from './launcher.js'

const NO_OPEN_PROJECT = 'This room cannot open another project. Run machineroom in that folder.'

export default function Launcher({ client = null, live = false }) {
  const [open, setOpen] = useState(false)
  const [projects, setProjects] = useState(null)
  const [opening, setOpening] = useState(null)
  const [error, setError] = useState('')
  const [typed, setTyped] = useState('')
  const [pathProblem, setPathProblem] = useState('')
  const projectsRef = useRef(null)
  const attemptRef = useRef(0)
  const aliveRef = useRef(true)
  const panelRef = useRef(null)

  useDialogFocus(open, {
    containerRef: panelRef,
    getInitialFocus: () => panelRef.current?.querySelector?.('.mr-launcher-row.is-current') ?? null,
  })

  useEffect(() => {
    aliveRef.current = true
    return () => {
      aliveRef.current = false
    }
  }, [])

  const readProjects = useCallback(async () => {
    if (!client || typeof client.projects !== 'function') return null
    try {
      const data = await client.projects()
      if (!aliveRef.current) return null
      projectsRef.current = data ?? null
      setProjects(data ?? null)
      return data ?? null
    } catch {
      return null
    }
  }, [client])

  const close = useCallback(() => {
    attemptRef.current += 1
    markLauncherSeen()
    setOpen(false)
    setOpening(null)
    setError('')
    setPathProblem('')
    setTyped('')
  }, [])

  useEffect(() => {
    if (typeof window === 'undefined') return undefined
    if (!live || !client) {
      setOpen(false)
      return undefined
    }
    let cancelled = false
    readProjects().then((data) => {
      if (cancelled) return
      if (shouldOpenLauncher({ live, seen: launcherSeen(), projects: data })) setOpen(true)
    })
    function onProjects() {
      setOpen(true)
      if (projectsRef.current === null) readProjects()
    }
    window.addEventListener(LAUNCHER_EVENT, onProjects)
    return () => {
      cancelled = true
      window.removeEventListener(LAUNCHER_EVENT, onProjects)
    }
  }, [live, client, readProjects])

  useEffect(() => {
    const classes = typeof document !== 'undefined' ? document.body?.classList : null
    if (!classes || typeof classes.add !== 'function' || typeof classes.remove !== 'function') return undefined
    if (open) classes.add('has-launcher')
    else classes.remove('has-launcher')
    return () => classes.remove('has-launcher')
  }, [open])

  useEffect(() => {
    if (!open || typeof window === 'undefined') return undefined
    function onKey(event) {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopPropagation()
      close()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [open, close])

  async function probeProject() {
    if (typeof client?.health === 'function') {
      const health = await client.health()
      if (!health || health.ok !== true) return null
    }
    if (typeof client?.projects !== 'function') return null
    return client.projects()
  }

  async function pick(row) {
    if (!row || typeof row.path !== 'string' || row.path === '') return
    const current = projectsRef.current?.current
    if (current && samePath(row.path, current.path)) {
      close()
      return
    }
    if (!client || typeof client.openProject !== 'function') {
      setError(NO_OPEN_PROJECT)
      return
    }
    const token = attemptRef.current + 1
    attemptRef.current = token
    setOpening(row)
    setError('')
    setPathProblem('')
    try {
      await client.openProject({ path: row.path, confirmed: true })
    } catch (failure) {
      if (attemptRef.current !== token) return
      setOpening(null)
      setError(failure?.message || 'The room could not open that folder.')
      return
    }
    if (attemptRef.current !== token) return
    const result = await pollProject({
      probe: probeProject,
      path: row.path,
      shouldStop: () => attemptRef.current !== token,
    })
    if (attemptRef.current !== token) return
    if (result.ok) {
      markLauncherSeen()
      if (typeof window !== 'undefined' && window.location?.reload) window.location.reload()
      return
    }
    setOpening(null)
    setError(LAUNCHER_TIMEOUT_TEXT)
  }

  function submitPath(event) {
    event.preventDefault()
    const problem = absolutePathProblem(typed)
    if (problem) {
      setPathProblem(problem)
      return
    }
    setPathProblem('')
    const path = typed.trim()
    pick({ path, name: pathName(path), git: false })
  }

  if (!open) return null

  const current = projects?.current ?? null
  const currentPath = typeof current?.path === 'string' ? current.path : ''
  const currentName = current?.name || pathName(currentPath) || 'this folder'
  const rows = launcherRows(projects)
  const busy = opening !== null
  const openingName = opening?.name || pathName(opening?.path) || 'the folder'

  return (
    <section ref={panelRef} className="mr-launcher" role="dialog" aria-modal="true" aria-labelledby="mr-launcher-title">
      <header className="mr-launcher-head">
        <h2 id="mr-launcher-title" className="mr-launcher-title">
          Which folder do you want to work in?
        </h2>
        <button type="button" className="mr-launcher-close" onClick={close}>
          Close
        </button>
      </header>
      {busy ? (
        <p className="mr-launcher-status mono" role="status">
          {openingLabel(openingName)}
        </p>
      ) : (
        <div className="mr-launcher-list">
          {currentPath !== '' && (
            <button
              type="button"
              className="mr-launcher-row is-current"
              onClick={() => pick({ path: currentPath, name: currentName })}
            >
              <span className="mr-launcher-name">{keepWorkingLabel(currentName)}</span>
              <span className="mr-launcher-path mono">{currentPath}</span>
            </button>
          )}
          {rows.map((row) => (
            <button key={row.path} type="button" className="mr-launcher-row" onClick={() => pick(row)}>
              <span className="mr-launcher-name">
                {row.name}
                {row.git && <span className="mr-launcher-git mono">git</span>}
              </span>
              <span className="mr-launcher-path mono">{row.path}</span>
            </button>
          ))}
        </div>
      )}
      {error !== '' && (
        <p className="mr-launcher-error" role="alert">
          {error}
        </p>
      )}
      <form className="mr-launcher-form" onSubmit={submitPath}>
        <label className="mr-launcher-label mono" htmlFor="mr-launcher-path">
          Folder path
        </label>
        <input
          id="mr-launcher-path"
          className="mr-launcher-input mono"
          type="text"
          value={typed}
          placeholder="C:\Users\<name>\project"
          autoComplete="off"
          spellCheck={false}
          disabled={busy}
          onChange={(event) => setTyped(event.target.value)}
        />
        <button type="submit" className="mr-launcher-open" disabled={busy}>
          Open
        </button>
      </form>
      {pathProblem !== '' && (
        <p className="mr-launcher-error" role="alert">
          {pathProblem}
        </p>
      )}
    </section>
  )
}
