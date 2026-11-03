import { useEffect, useMemo, useRef, useState } from 'react'
import { useDialogFocus } from './dialogFocus.js'
import {
  harnessModels,
  teamDraft,
  teamHarnesses,
  teamPlan,
} from './family.js'
import { ladderFromOrchestrators } from './ladderForm.js'
import { ModelSelect, useHarnessModels } from './ModelRefresh.jsx'
import { withHarnessModels, withModelRows } from './modelRefresh.js'
import { cleanText } from './sidebar.js'

function messageOf(error) {
  return error instanceof Error && error.message ? error.message : 'The bridge refused the change.'
}

function countLine(count, one, many) {
  return count === 1 ? `1 ${one}` : `${count} ${many}`
}

export function sameTeamPlan(left, right) {
  const one = Array.isArray(left) ? left : []
  const two = Array.isArray(right) ? right : []
  if (one.length !== two.length) return false
  return one.every((team, index) => {
    const other = two[index]
    return (
      team?.id === other?.id &&
      team?.name === other?.name &&
      (team?.lanes ?? []).join('\n') === (other?.lanes ?? []).join('\n')
    )
  })
}

export function FamilyTeam({ client = null }) {
  const canTeam =
    typeof client?.setLadder === 'function' && typeof client?.setAgentLabel === 'function'
  const [open, setOpen] = useState(false)
  const [lanes, setLanes] = useState(null)
  const [ladder, setLadder] = useState(null)
  const [harnesses, setHarnesses] = useState(null)
  const [models, setModels] = useState(null)
  const [draft, setDraft] = useState({ orchestrators: 1, coders: 1, harness: '', model: '' })
  const [picked, setPicked] = useState(false)
  const [readError, setReadError] = useState('')
  const [actionError, setActionError] = useState('')
  const [confirm, setConfirm] = useState(null)
  const [busy, setBusy] = useState(false)
  const confirmRef = useRef(null)

  useDialogFocus(Boolean(confirm), { containerRef: confirmRef })

  useEffect(() => {
    let active = true
    setReadError('')
    const jobs = [
      ['lanes', () => client?.lanes?.()],
      ['ladder', () => client?.orchestrators?.()],
      ['harnesses', () => client?.harnesses?.()],
      ['models', () => client?.models?.()],
    ]
    const promises = jobs.map(([, read]) => {
      try {
        return Promise.resolve(read())
      } catch (error) {
        return Promise.reject(error)
      }
    })
    Promise.allSettled(promises).then((results) => {
      if (!active) return
      const values = {}
      results.forEach((result, index) => {
        if (result.status === 'fulfilled' && result.value) values[jobs[index][0]] = result.value
      })
      if (values.lanes) setLanes(values.lanes)
      if (values.ladder) setLadder(ladderFromOrchestrators(values.ladder))
      if (values.harnesses) setHarnesses(values.harnesses)
      if (values.models) setModels(values.models)
      const failed = results.find((result) => result.status === 'rejected')
      if (failed) setReadError(messageOf(failed.reason))
    })
    return () => {
      active = false
    }
  }, [client])

  async function refresh() {
    const jobs = []
    if (typeof client?.lanes === 'function') {
      jobs.push(
        Promise.resolve(client.lanes()).then((answer) => {
          if (answer) setLanes(answer)
        })
      )
    }
    if (typeof client?.orchestrators === 'function') {
      jobs.push(
        Promise.resolve(client.orchestrators()).then((answer) => {
          if (answer) setLadder(ladderFromOrchestrators(answer))
        })
      )
    }
    const results = await Promise.allSettled(jobs)
    const failed = results.find((result) => result.status === 'rejected')
    if (failed) setActionError(messageOf(failed.reason))
  }

  useEffect(() => {
    if (typeof client?.subscribe !== 'function') return undefined
    return client.subscribe((notice) => {
      if (!notice || (notice.topic !== 'family' && notice.topic !== 'agents')) return
      refresh()
    })
  }, [client])

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
    if (!open || picked || draft.harness) return
    const next = teamDraft(harnesses, models)
    setDraft((current) => ({ ...current, harness: next.harness, model: next.model }))
  }, [open, picked, draft.harness, harnesses, models])

  const offered = useMemo(() => teamHarnesses(harnesses, models), [harnesses, models])
  const selected = offered.find((row) => row.key === draft.harness) ?? null
  const fallback = useMemo(
    () => (selected ? harnessModels(selected, models) : []),
    [selected, models]
  )
  const live = useHarnessModels({
    client,
    harness: selected?.key ?? '',
    open,
    fallback,
    value: draft.model,
  })

  useEffect(() => {
    if (!selected?.key || !live.live || live.live.length === 0) return
    setHarnesses((current) => withHarnessModels(current, selected.key, live.live))
    setModels((current) => withModelRows(current, live.live, selected.key))
  }, [selected?.key, live.live])

  const ready = Boolean(lanes && ladder)
  const plan = useMemo(() => {
    if (!ready) return null
    return teamPlan({
      lanes,
      ladder,
      orchestrators: draft.orchestrators,
      coders: draft.coders,
      harness: draft.harness,
      model: draft.model,
    })
  }, [ready, lanes, ladder, draft])

  function harnessProblem() {
    if (!selected) return offered.length === 0 ? 'Loading harnesses...' : 'Choose a harness.'
    if (!selected.available) return 'That harness is not on this computer.'
    if (live.choices.length === 0) return 'This harness has no models.'
    if (!live.choices.some((row) => row.id === cleanText(draft.model, 120))) {
      return 'Choose a model for this harness.'
    }
    return ''
  }

  const formProblem = !ready
    ? ''
    : plan?.problem || harnessProblem() || (canTeam ? '' : 'This bridge cannot build a team.')

  function chooseHarness(key) {
    const harness = offered.find((row) => row.key === key)
    if (!harness) return
    setPicked(true)
    setActionError('')
    setDraft((current) => ({
      ...current,
      harness: harness.key,
      model: harnessModels(harness, models)[0]?.id ?? '',
    }))
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

  async function readLadder() {
    if (typeof client?.orchestrators !== 'function') {
      throw new Error('This bridge cannot read the ladder.')
    }
    return ladderFromOrchestrators(await client.orchestrators())
  }

  function askSave() {
    if (busy) return
    if (!ready) {
      setActionError('The lanes are not loaded yet.')
      return
    }
    const draftForPlan = { ...draft }
    function planTeams(ladderValue) {
      return teamPlan({
        lanes,
        ladder: ladderValue,
        orchestrators: draftForPlan.orchestrators,
        coders: draftForPlan.coders,
        harness: draftForPlan.harness,
        model: draftForPlan.model,
      })
    }
    const next = planTeams(ladder)
    if (next.problem) {
      setActionError(next.problem)
      return
    }
    const problem = harnessProblem()
    if (problem) {
      setActionError(problem)
      return
    }
    if (!canTeam) {
      setActionError('This bridge cannot build a team.')
      return
    }
    ask({
      text: `Build ${countLine(next.teams.length, 'sub orchestrator', 'sub orchestrators')}?`,
      label: 'Build the team',
      busyText: 'Building the team...',
      teams: next.teams,
      run: async () => {
        const fresh = planTeams(await readLadder())
        if (fresh.problem) throw new Error(fresh.problem)
        if (!sameTeamPlan(fresh.teams, next.teams)) {
          throw new Error('The team changed while the card was open. Open it again.')
        }
        await client.setLadder({ subs: fresh.subs })
        try {
          for (const team of fresh.teams) {
            await client.setAgentLabel({ id: team.id, label: team.name, confirmed: true })
          }
        } catch (error) {
          await refresh().catch(() => {})
          throw new Error(`The team was created. ${messageOf(error)}`)
        }
        setOpen(false)
        setPicked(false)
        await refresh()
      },
    })
  }

  function renderPreview() {
    if (!plan) return <p className="mr-side-note">Loading the lanes...</p>
    if (plan.teams.length === 0) return null
    return (
      <div className="mr-team-preview" role="group" aria-label="Team preview">
        {plan.teams.map((team) => (
          <div className="mr-team-preview-row" key={team.id}>
            <span className="mr-team-preview-name">{team.name}</span>
            <span className="mr-team-preview-lanes mono">
              {team.laneNames.length > 0 ? team.laneNames.join(', ') : 'No lanes yet'}
            </span>
          </div>
        ))}
      </div>
    )
  }

  return (
    <section className="mr-team" aria-label="Build a team">
      <button
        type="button"
        className="mr-side-head is-button"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <span className="mr-side-head-title mono">Build a team</span>
        <span className="mr-side-twist" aria-hidden="true">
          {open ? '-' : '+'}
        </span>
      </button>
      {open ? (
        <form
          className="mr-team-form"
          aria-label="Build a team"
          onSubmit={(event) => {
            event.preventDefault()
            askSave()
          }}
        >
          {readError ? <p className="mr-side-note">{readError}</p> : null}
          <div className="mr-team-counts">
            <label className="mr-side-field">
              <span className="mr-side-field-label mono">Orchestrators</span>
              <select
                className="mr-side-select mono"
                aria-label="Orchestrators under the main"
                value={draft.orchestrators}
                onChange={(event) =>
                  setDraft({ ...draft, orchestrators: Number(event.target.value) })
                }
              >
                {[1, 2, 3, 4].map((count) => (
                  <option value={count} key={count}>
                    {count}
                  </option>
                ))}
              </select>
            </label>
            <label className="mr-side-field">
              <span className="mr-side-field-label mono">Coders each</span>
              <select
                className="mr-side-select mono"
                aria-label="Coders for each orchestrator"
                value={draft.coders}
                onChange={(event) => setDraft({ ...draft, coders: Number(event.target.value) })}
              >
                {[1, 2, 3].map((count) => (
                  <option value={count} key={count}>
                    {count}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {offered.length > 0 ? (
            <label className="mr-side-field">
              <span className="mr-side-field-label mono">Harness</span>
              <select
                className="mr-side-select mono"
                aria-label="Harness for the new sub orchestrators"
                value={draft.harness}
                onChange={(event) => chooseHarness(event.target.value)}
              >
                {!draft.harness ? (
                  <option value="" disabled>
                    Choose a harness
                  </option>
                ) : null}
                {offered.map((row) => (
                  <option value={row.key} key={row.key}>
                    {row.name || row.key}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <p className="mr-side-note is-dim">Loading harnesses...</p>
          )}
          {selected ? (
            <ModelSelect
              label="Model"
              ariaLabel="Model for the new sub orchestrators"
              value={draft.model}
              choices={live.choices}
              onChange={(model) => setDraft({ ...draft, model })}
              onRefresh={live.refresh}
              loading={live.loading}
              error={live.error}
              canRefresh={live.canRefresh}
            />
          ) : null}
          {renderPreview()}
          {formProblem ? <p className="mr-family-note is-error">{formProblem}</p> : null}
          {canTeam && ready && !formProblem ? (
            <div className="mr-side-form-actions">
              <button type="submit" className="mr-side-primary" disabled={busy}>
                Save
              </button>
            </div>
          ) : null}
          <div className="mr-side-form-actions">
            <button type="button" className="mr-side-action" disabled={busy} onClick={() => setOpen(false)}>
              Cancel
            </button>
          </div>
        </form>
      ) : null}
      {actionError ? (
        <p className="mr-side-error mono" role="alert">
          {actionError}
        </p>
      ) : null}
      {confirm ? (
        <div ref={confirmRef} className="mr-side-confirm" role="dialog" aria-modal="true" aria-label={confirm.label}>
          <section className="mr-side-confirm-card">
            <p className="mr-side-confirm-text">
              {busy && confirm.busyText ? confirm.busyText : confirm.text}
            </p>
            <ul className="mr-team-confirm-list">
              {confirm.teams.map((team) => (
                <li className="mr-team-confirm-row" key={team.id}>
                  <span>{team.name}</span>
                  <span className="mono">{team.laneNames.join(', ') || 'No lanes'}</span>
                </li>
              ))}
            </ul>
            <div className="mr-side-confirm-actions">
              <button
                type="button"
                className="mr-side-confirm-btn is-primary"
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

export default FamilyTeam
