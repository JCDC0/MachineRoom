import { useCallback, useEffect, useRef, useState } from 'react'
import {
  branchFromProblem,
  branchRows,
  createConfirmText,
  defaultBranchFrom,
  isGitState,
  newBranchProblem,
  repositoryBranchesNotice,
  repositoryHead,
  repositoryStatusNotice,
  switchBlockReason,
  switchConfirmText,
  visibleBranches,
} from './repository.js'

function messageOf(error) {
  if (error instanceof Error && error.message) return error.message
  if (typeof error === 'string' && error.trim()) return error.trim()
  return 'The bridge refused the change.'
}

export default function RepositoryPanel({ client = null, live = false, project = '' }) {
  const supported = live === true && typeof client?.gitState === 'function'
  const [state, setState] = useState(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState('')
  const [confirm, setConfirm] = useState(null)
  const [formOpen, setFormOpen] = useState(false)
  const [name, setName] = useState('')
  const [from, setFrom] = useState('')
  const [formError, setFormError] = useState('')
  const [filter, setFilter] = useState('')
  const requestRef = useRef(0)

  const refresh = useCallback(async () => {
    if (typeof client?.gitState !== 'function') return
    const ticket = requestRef.current + 1
    requestRef.current = ticket
    try {
      const answer = await client.gitState()
      if (requestRef.current !== ticket) return
      setState(answer && typeof answer === 'object' ? answer : null)
      setError('')
    } catch (err) {
      if (requestRef.current !== ticket) return
      setError(messageOf(err))
    }
  }, [client])

  useEffect(() => {
    if (!supported) return undefined
    let active = true
    function read() {
      if (active) refresh()
    }
    read()
    const interval = setInterval(read, 60000)
    const unsubscribe =
      typeof client?.subscribe === 'function'
        ? client.subscribe((notice) => {
            if (notice && notice.topic === 'git') read()
          })
        : null
    return () => {
      active = false
      clearInterval(interval)
      if (typeof unsubscribe === 'function') unsubscribe()
      requestRef.current += 1
    }
  }, [client, refresh, supported])

  function adopt(answer) {
    requestRef.current += 1
    if (isGitState(answer) || answer?.git === false) {
      setState(answer)
      setError('')
      return
    }
    refresh()
  }

  function askSwitch(row) {
    if (!row || row.current) return
    const reason = switchBlockReason(state, row)
    if (reason !== '') {
      setError(reason)
      return
    }
    setError('')
    setConfirm({
      kind: 'switch',
      branch: row.name,
      worktree: row.worktree,
      text: switchConfirmText(project, row.name),
      label: 'Switch',
    })
  }

  function toggleForm() {
    if (formOpen) {
      setFormOpen(false)
      setFormError('')
      return
    }
    setFormOpen(true)
    setName('')
    setFrom(defaultBranchFrom(state))
    setFormError('')
    setError('')
  }

  function askCreate(event) {
    event.preventDefault()
    if (!isGitState(state)) return
    const trimmed = name.trim()
    const problem = newBranchProblem(trimmed, state)
    if (problem !== '') {
      setFormError(problem)
      return
    }
    const fromProblem = branchFromProblem(from, state)
    if (fromProblem !== '') {
      setFormError(fromProblem)
      return
    }
    setFormError('')
    setError('')
    setConfirm({
      kind: 'create',
      name: trimmed,
      from,
      text: createConfirmText(trimmed, from),
      label: 'Create branch',
    })
  }

  async function runConfirm() {
    if (!confirm || busy !== '') return
    const current = confirm
    if (current.kind === 'switch') {
      const reason = switchBlockReason(state, { worktree: current.worktree })
      if (reason !== '') {
        setConfirm(null)
        setError(reason)
        return
      }
      if (typeof client?.switchBranch !== 'function') {
        setConfirm(null)
        setError('This bridge cannot switch branches.')
        return
      }
      setBusy('switch')
      setError('')
      try {
        const answer = await client.switchBranch({ branch: current.branch, confirmed: true })
        adopt(answer)
        setConfirm(null)
      } catch (err) {
        setConfirm(null)
        setError(messageOf(err))
      } finally {
        setBusy('')
      }
      return
    }
    if (typeof client?.createBranch !== 'function') {
      setConfirm(null)
      setError('This bridge cannot make a branch.')
      return
    }
    setBusy('create')
    setError('')
    try {
      const answer = await client.createBranch({ name: current.name, from: current.from, confirmed: true })
      adopt(answer)
      setConfirm(null)
      setFormOpen(false)
      setName('')
      setFrom('')
      setFormError('')
    } catch (err) {
      setConfirm(null)
      setError(messageOf(err))
    } finally {
      setBusy('')
    }
  }

  function showTree() {
    if (typeof window === 'undefined' || typeof CustomEvent !== 'function') return
    window.dispatchEvent(new CustomEvent('machineroom:show-git-tree'))
  }

  if (!supported) return null
  const ready = isGitState(state)
  if (!ready && error === '') return null

  const rows = ready ? branchRows(state) : []
  const fromOptions = rows.map((row) => row.name)
  const statusNotice = ready ? repositoryStatusNotice(state) : ''
  const branchesNotice = ready ? repositoryBranchesNotice(state) : ''
  const visible = visibleBranches(rows, filter)

  return (
    <section className="mr-repo" aria-label="Repository">
      <div className="mr-repo-head">
        <span className="mr-repo-title mono">Repository</span>
        {ready ? (
          <button type="button" className="mr-repo-tree" onClick={showTree}>
            Show the tree
          </button>
        ) : null}
      </div>
      {error ? (
        <p className="mr-repo-error mono" role="alert">
          {error}
        </p>
      ) : null}
      {ready ? (
        <>
          <div className="mr-repo-current">
            <span className={`mr-repo-branch mono${state.detached === true ? ' is-detached' : ''}`}>
              {repositoryHead(state)}
            </span>
            {statusNotice === '' && state.dirty === true ? (
              <span className="mr-repo-dirty mono">Uncommitted changes</span>
            ) : null}
          </div>
          {statusNotice !== '' ? <p className="mr-repo-error mono">{statusNotice}</p> : null}
          {rows.length > 0 ? (
            <label className="mr-repo-field mr-repo-filter">
              <span className="mr-repo-label mono">Filter</span>
              <input
                className="mr-repo-input mono"
                value={filter}
                aria-label="Filter branches"
                placeholder="Filter branches"
                onChange={(event) => setFilter(event.target.value)}
              />
            </label>
          ) : null}
          <div className="mr-repo-branches" aria-label="Branches">
            {rows.length === 0 ? (
              branchesNotice !== '' ? (
                <p className="mr-repo-error mono">{branchesNotice}</p>
              ) : (
                <p className="mr-side-note">No branches.</p>
              )
            ) : (
              visible.rows.map((row) => (
                <div className={`mr-repo-row${row.current ? ' is-current' : ''}`} key={row.name}>
                  <span className="mr-repo-name mono" title={row.name}>
                    {row.name}
                  </span>
                  {row.ahead !== null && row.ahead > 0 ? (
                    <span className="mr-repo-tag mono">{`ahead ${row.ahead}`}</span>
                  ) : null}
                  {row.behind !== null && row.behind > 0 ? (
                    <span className="mr-repo-tag mono">{`behind ${row.behind}`}</span>
                  ) : null}
                  {row.worktree ? <span className="mr-repo-tag mono">in a worktree</span> : null}
                  {!row.current ? (
                    <button
                      type="button"
                      className="mr-repo-switch"
                      disabled={busy !== '' || !row.switchable}
                      title={row.reason || `Switch to ${row.name}`}
                      aria-label={`Switch to ${row.name}`}
                      onClick={() => askSwitch(row)}
                    >
                      Switch
                    </button>
                  ) : null}
                  {row.reason ? <span className="mr-repo-reason mono">{row.reason}</span> : null}
                </div>
              ))
            )}
          </div>
          {visible.line ? <p className="mr-side-note mr-repo-count">{visible.line}</p> : null}
          <div className="mr-repo-actions">
            <button type="button" className="mr-repo-new" onClick={toggleForm} disabled={busy !== ''}>
              New branch
            </button>
          </div>
          {formOpen ? (
            <form className="mr-repo-form" onSubmit={askCreate}>
              <label className="mr-repo-field">
                <span className="mr-repo-label mono">Name</span>
                <input
                  className="mr-repo-input mono"
                  value={name}
                  maxLength={200}
                  aria-label="New branch name"
                  onChange={(event) => {
                    setName(event.target.value)
                    setFormError('')
                  }}
                />
              </label>
              <label className="mr-repo-field">
                <span className="mr-repo-label mono">From</span>
                <select
                  className="mr-repo-select mono"
                  value={from}
                  aria-label="Start the branch from"
                  onChange={(event) => {
                    setFrom(event.target.value)
                    setFormError('')
                  }}
                >
                  {fromOptions.map((option) => (
                    <option value={option} key={option}>
                      {option}
                    </option>
                  ))}
                </select>
              </label>
              {formError ? <p className="mr-repo-error mono">{formError}</p> : null}
              <div className="mr-repo-form-actions">
                <button type="submit" className="mr-repo-form-btn is-primary" disabled={busy !== '' || from === ''}>
                  Create
                </button>
                <button
                  type="button"
                  className="mr-repo-form-btn"
                  disabled={busy !== ''}
                  onClick={() => {
                    setFormOpen(false)
                    setFormError('')
                  }}
                >
                  Cancel
                </button>
              </div>
            </form>
          ) : null}
          {confirm ? (
            <div className="mr-repo-confirm" role="dialog" aria-label={confirm.label}>
              <p className="mr-repo-confirm-text">{busy !== '' ? `${confirm.label}...` : confirm.text}</p>
              <div className="mr-repo-confirm-actions">
                <button
                  type="button"
                  className="mr-repo-confirm-btn is-primary"
                  disabled={busy !== ''}
                  onClick={runConfirm}
                >
                  {confirm.label}
                </button>
                <button
                  type="button"
                  className="mr-repo-confirm-btn"
                  disabled={busy !== ''}
                  onClick={() => setConfirm(null)}
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : null}
        </>
      ) : null}
    </section>
  )
}
