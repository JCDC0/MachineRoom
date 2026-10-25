import { useEffect, useMemo, useState } from 'react'
import AutocompactInput from './AutocompactInput.jsx'
import {
  DIRECT_HARNESS,
  childConfirmText,
  childDetail,
  childDraft,
  childFormProblem,
  childHarnesses,
  convertPlan,
  familyMeta,
  familyTree,
  findHarness,
  harnessEfforts,
  harnessGroups,
  harnessModels,
  keyFormProblem,
  keyNames,
  labelProblem,
  stateWord,
} from './family.js'
import { changeSub, ladderFromOrchestrators } from './ladderForm.js'
import { AGENT_NAME_MAX, agentCountLine, cleanText, laneChoice, laneSummary } from './sidebar.js'

function messageOf(error) {
  return error instanceof Error && error.message ? error.message : 'The bridge refused the change.'
}

function lanesOf(answer) {
  return laneSummary(answer).lanes.map((lane) => lane.key)
}

export function FamilyTree({ client = null }) {
  const canFamily = typeof client?.family === 'function'
  const [family, setFamily] = useState(null)
  const [lanes, setLanes] = useState(null)
  const [harnesses, setHarnesses] = useState(null)
  const [models, setModels] = useState(null)
  const [keys, setKeys] = useState([])
  const [readError, setReadError] = useState('')
  const [actionError, setActionError] = useState('')
  const [open, setOpen] = useState(true)
  const [editing, setEditing] = useState(null)
  const [nodeDraft, setNodeDraft] = useState(null)
  const [orchestrator, setOrchestrator] = useState(null)
  const [orchLoaded, setOrchLoaded] = useState(false)
  const [childFor, setChildFor] = useState(null)
  const [childPicked, setChildPicked] = useState(false)
  const [draft, setDraft] = useState(null)
  const [childProblem, setChildProblem] = useState('')
  const [keyOpen, setKeyOpen] = useState(false)
  const [keyName, setKeyName] = useState('')
  const [keyValue, setKeyValue] = useState('')
  const [confirm, setConfirm] = useState(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!canFamily) return undefined
    let active = true
    setReadError('')
    const jobs = [
      ['family', () => client.family()],
      ['lanes', () => client.lanes?.()],
      ['harnesses', () => client.harnesses?.()],
      ['models', () => client.models?.()],
      ['keys', () => client.keys?.()],
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
      if (values.family) setFamily(values.family)
      if (values.lanes) setLanes(values.lanes)
      if (values.harnesses) setHarnesses(values.harnesses)
      if (values.models) setModels(values.models)
      if (values.keys) setKeys(keyNames(values.keys))
      else if (values.family) setKeys(keyNames(values.family.keys))
      const failed = results.find((result) => result.status === 'rejected')
      if (failed) setReadError(messageOf(failed.reason))
    })
    return () => {
      active = false
    }
  }, [client, canFamily])

  async function refresh() {
    const jobs = []
    if (typeof client?.family === 'function') {
      jobs.push(
        Promise.resolve(client.family()).then((answer) => {
          if (answer) setFamily(answer)
        })
      )
    }
    if (typeof client?.lanes === 'function') {
      jobs.push(
        Promise.resolve(client.lanes()).then((answer) => {
          if (answer) setLanes(answer)
        })
      )
    }
    if (typeof client?.keys === 'function') {
      jobs.push(
        Promise.resolve(client.keys()).then((answer) => {
          if (answer) setKeys(keyNames(answer))
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

  const tree = useMemo(() => familyTree(family), [family])
  const summary = laneSummary(lanes)
  const countLine = lanes ? agentCountLine(summary.active.length, summary.max) : 'Loading agents...'
  const editingNode = editing ? tree.nodes.find((node) => node.id === editing) ?? null : null

  useEffect(() => {
    if (editing && !tree.nodes.some((node) => node.id === editing)) {
      setEditing(null)
      setNodeDraft(null)
    }
    if (childFor && !tree.nodes.some((node) => node.id === childFor)) {
      setChildFor(null)
      setDraft(null)
    }
  }, [editing, childFor, tree])

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
    setActionError('')
    setEditing(node.id)
    setNodeDraft({
      label: node.label,
      harness: node.harness,
      model: node.model,
      effort: node.effort,
    })
    setChildFor(null)
    setDraft(null)
    setChildProblem('')
    setKeyOpen(false)
    setKeyName('')
    setKeyValue('')
  }

  function closeEditor() {
    setEditing(null)
    setNodeDraft(null)
    setOrchestrator(null)
    setOrchLoaded(false)
  }

  function nodeHarnessOptions(node) {
    const groups = harnessGroups(harnesses)
    const list = groups.available.slice()
    if (node && node.harness && !list.some((row) => row.key === node.harness)) {
      const known = findHarness(harnesses, node.harness)
      list.push({
        key: node.harness,
        name: known?.name ?? node.harness,
        available: false,
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
      model: harnessModels(harness, models)[0]?.id ?? '',
    }))
  }

  function askLabel(node) {
    if (!nodeDraft) return
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
    ask({
      text: `Set the label of ${node.label} to "${label}"?`,
      label: 'Save label',
      busyText: 'Saving the label...',
      run: async () => {
        await client.setAgentLabel({ id: node.id, label, confirmed: true })
        setNodeDraft((current) => (current ? { ...current, label } : current))
        await refresh()
      },
    })
  }

  function askSetup(node) {
    if (!nodeDraft) return
    const harness = nodeHarnessOptions(node).find((row) => row.key === nodeDraft.harness)
    if (!harness) {
      setActionError('Choose a harness.')
      return
    }
    const choices = harnessModels(harness, models)
    const model = cleanText(nodeDraft.model, 120)
    if (choices.length === 0) {
      setActionError('This harness has no models.')
      return
    }
    if (!choices.some((row) => row.id === model)) {
      setActionError('Choose a model for this harness.')
      return
    }
    const effort = cleanText(nodeDraft.effort, 20)
    const harnessChanged = harness.key !== node.harness || model !== node.model
    const effortChanged = effort !== (node.effort || '')
    if (!harnessChanged && !effortChanged) return
    if (harnessChanged && typeof client?.setOrchestratorHarness !== 'function') {
      setActionError('This bridge cannot set a harness.')
      return
    }
    if (effortChanged && typeof client?.setOrchestratorEffort !== 'function') {
      setActionError('This bridge cannot set an effort.')
      return
    }
    ask({
      text: `Run ${node.label} on ${harness.name} with ${model}?`,
      detail: effort ? `Effort ${effort}` : 'Effort default',
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
        setNodeDraft((current) => (current ? { ...current, harness: harness.key, model, effort } : current))
        await refresh()
      },
    })
  }

  function askLaneSave(node) {
    if (!nodeDraft) return
    if (typeof client?.updateLane !== 'function') {
      setActionError('This bridge cannot change an agent.')
      return
    }
    const harness = findHarness(harnesses, node.harness)
    const choices = harnessModels(harness, models)
    const model = cleanText(nodeDraft.model, 120)
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
    ask({
      text: `Save ${node.label} on ${model || 'its model'}?`,
      label: 'Save',
      busyText: 'Saving the agent...',
      run: async () => {
        await client.updateLane({
          key: node.id,
          model: model || undefined,
          effort: effort || null,
          confirmed: true,
        })
        await refresh()
      },
    })
  }

  function askRemove(node) {
    if (!node.custom) return
    if (typeof client?.deleteLane !== 'function') {
      setActionError('This bridge cannot remove an agent.')
      return
    }
    ask({
      text: `Remove "${node.label}"? This cannot be undone.`,
      label: 'Remove',
      tone: 'danger',
      busyText: 'Removing the agent...',
      run: async () => {
        await client.deleteLane({ key: node.id, confirmed: true })
        closeEditor()
        await refresh()
      },
    })
  }

  function askLaneToggle(node, on) {
    if (typeof client?.setActiveLanes !== 'function') {
      setActionError('This bridge cannot change the agents.')
      return
    }
    if (!lanes) {
      setActionError('The lanes are not loaded yet.')
      return
    }
    const choice = laneChoice(lanes.lanes, on ? { add: [node.id] } : { remove: [node.id] })
    ask({
      text: on ? `Turn on ${node.label}?` : `Turn off ${node.label}?`,
      label: on ? 'Turn on' : 'Turn off',
      tone: on ? 'primary' : 'danger',
      busyText: on ? 'Turning on the agent...' : 'Turning off the agent...',
      run: async () => {
        await client.setActiveLanes({ lanes: choice, confirmed: true })
        await refresh()
      },
    })
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
    setKeyOpen(false)
    setKeyName('')
    setKeyValue('')
  }

  function toggleChild(node) {
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
    setKeyOpen(false)
    setKeyName('')
    setKeyValue('')
  }

  function chooseChildHarness(harness) {
    setChildProblem('')
    setChildPicked(true)
    if (harness.key !== DIRECT_HARNESS) {
      setKeyOpen(false)
      setKeyName('')
      setKeyValue('')
    }
    setDraft((current) => ({
      ...(current ?? {}),
      harness: harness.key,
      model: harnessModels(harness, models)[0]?.id ?? '',
      effort: harnessEfforts(harness)[0] ?? '',
      key: harness.key === DIRECT_HARNESS ? current?.key ?? '' : '',
    }))
  }

  function askAddKey() {
    const problem = keyFormProblem(keyName, keyValue)
    if (problem) {
      setActionError(problem)
      return
    }
    if (typeof client?.setKey !== 'function') {
      setActionError('This bridge cannot store a key.')
      return
    }
    const name = cleanText(keyName)
    const value = keyValue
    ask({
      text: `Save the key slot "${name}"?`,
      label: 'Add key',
      busyText: 'Saving the key...',
      run: async () => {
        await client.setKey({ name, value, confirmed: true })
        setKeyName('')
        setKeyValue('')
        setKeyOpen(false)
        setDraft((current) => (current ? { ...current, key: name } : current))
        setKeys((current) => (current.includes(name) ? current : [...current, name]))
        await refresh()
      },
    })
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
    const problem = childFormProblem(draft, { harnesses, models })
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
              <span className="mono">{familyMeta(proposal)}</span>
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

  function renderEditor(node, depth) {
    if (!nodeDraft) return null
    const lane = node.kind === 'lane'
    const options = lane ? [] : nodeHarnessOptions(node)
    const harness = lane
      ? findHarness(harnesses, node.harness)
      : options.find((row) => row.key === nodeDraft.harness) ?? null
    const choices = harness ? harnessModels(harness, models) : []
    const efforts = harness ? harnessEfforts(harness) : []
    const canLabel = typeof client?.setAgentLabel === 'function'
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
            disabled={busy || !canLabel}
            onClick={() => askLabel(node)}
          >
            Save label
          </button>
        </div>
        {lane ? (
          <>
            <p className="mr-family-note mono">{`Harness ${node.harness || 'unknown'}`}</p>
            {choices.length > 0 ? (
              <label className="mr-side-field">
                <span className="mr-side-field-label mono">Model</span>
                <select
                  className="mr-side-select mono"
                  aria-label={`Model for ${node.label}`}
                  value={nodeDraft.model}
                  onChange={(event) => setNodeDraft({ ...nodeDraft, model: event.target.value })}
                >
                  {!nodeDraft.model ? (
                    <option value="" disabled>
                      Choose a model
                    </option>
                  ) : null}
                  {choices.map((choice) => (
                    <option value={choice.id} key={choice.id}>
                      {choice.label}
                    </option>
                  ))}
                  {nodeDraft.model && !choices.some((choice) => choice.id === nodeDraft.model) ? (
                    <option value={nodeDraft.model}>{nodeDraft.model}</option>
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
                disabled={busy || typeof client?.updateLane !== 'function'}
                onClick={() => askLaneSave(node)}
              >
                Save
              </button>
              {node.custom ? (
                <button
                  type="button"
                  className="mr-side-action is-danger"
                  disabled={busy || typeof client?.deleteLane !== 'function'}
                  onClick={() => askRemove(node)}
                >
                  Remove
                </button>
              ) : null}
            </div>
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
                      {row.name || row.key}
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              <p className="mr-side-note is-dim">No harnesses are listed.</p>
            )}
            {harness ? (
              choices.length > 0 ? (
                <label className="mr-side-field">
                  <span className="mr-side-field-label mono">Model</span>
                  <select
                    className="mr-side-select mono"
                    aria-label={`Model for ${node.label}`}
                    value={nodeDraft.model}
                    onChange={(event) => setNodeDraft({ ...nodeDraft, model: event.target.value })}
                  >
                    {!nodeDraft.model ? (
                      <option value="" disabled>
                        Choose a model
                      </option>
                    ) : null}
                    {choices.map((choice) => (
                      <option value={choice.id} key={choice.id}>
                        {choice.label}
                      </option>
                    ))}
                    {nodeDraft.model && !choices.some((choice) => choice.id === nodeDraft.model) ? (
                      <option value={nodeDraft.model}>{nodeDraft.model}</option>
                    ) : null}
                  </select>
                </label>
              ) : (
                <p className="mr-side-note is-dim">No models listed for this harness.</p>
              )
            ) : null}
            {harness ? (
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
                  (typeof client?.setOrchestratorHarness !== 'function' &&
                    typeof client?.setOrchestratorEffort !== 'function')
                }
                onClick={() => askSetup(node)}
              >
                Save
              </button>
            </div>
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
    const choices = selected ? harnessModels(selected, models) : []
    const efforts = selected ? harnessEfforts(selected) : []
    const direct = draft.harness === DIRECT_HARNESS
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
          <p className="mr-side-note is-dim">Loading harnesses...</p>
        )}
        {direct ? (
          <div className="mr-family-keys">
            <label className="mr-side-field">
              <span className="mr-side-field-label mono">Key slot</span>
              <select
                className="mr-side-select mono"
                aria-label="Key slot"
                value={draft.key}
                onChange={(event) => setDraft({ ...draft, key: event.target.value })}
              >
                <option value="">Choose a key slot</option>
                {keys.map((name) => (
                  <option value={name} key={name}>
                    {name}
                  </option>
                ))}
              </select>
            </label>
            <div className="mr-family-key-actions">
              <button
                type="button"
                className="mr-side-action"
                disabled={busy || typeof client?.setKey !== 'function'}
                aria-expanded={keyOpen}
                onClick={() => {
                  setKeyOpen((value) => !value)
                  setKeyName('')
                  setKeyValue('')
                }}
              >
                Add key
              </button>
            </div>
            {keyOpen ? (
              <div className="mr-family-key-form">
                <input
                  className="mr-side-input mono"
                  value={keyName}
                  maxLength={40}
                  aria-label="Key name"
                  placeholder="Name"
                  autoComplete="off"
                  onChange={(event) => setKeyName(event.target.value)}
                />
                <input
                  className="mr-side-input mono"
                  type="password"
                  value={keyValue}
                  maxLength={500}
                  aria-label="Key value"
                  placeholder="Key"
                  autoComplete="off"
                  onChange={(event) => setKeyValue(event.target.value)}
                />
                <button
                  type="button"
                  className="mr-side-primary"
                  disabled={busy || !keyName || !keyValue}
                  onClick={askAddKey}
                >
                  Add key
                </button>
              </div>
            ) : null}
            {typeof client?.setKey !== 'function' ? (
              <p className="mr-side-note is-dim">This bridge cannot store keys.</p>
            ) : null}
          </div>
        ) : null}
        {selected && choices.length > 0 ? (
          <label className="mr-side-field">
            <span className="mr-side-field-label mono">Model</span>
            <select
              className="mr-side-select mono"
              aria-label="New agent model"
              value={draft.model}
              onChange={(event) => setDraft({ ...draft, model: event.target.value })}
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
          <button type="submit" className="mr-side-primary" disabled={busy || !canCreate}>
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

  function renderRow(row) {
    const node = row
    const state = stateWord(node)
    return (
      <div className="mr-family-node" key={node.id} data-kind={node.kind} data-depth={row.depth}>
        <div className="mr-family-row">
          <span className="mr-family-indent" style={{ width: `${row.depth * 16}px` }} aria-hidden="true">
            {Array.from({ length: row.depth }, (_, level) => (
              <span
                className="mr-family-vline"
                key={level}
                style={{ left: `${level * 16 + 7}px` }}
              />
            ))}
            {row.depth > 0 ? (
              <span className="mr-family-hline" style={{ left: `${(row.depth - 1) * 16 + 7}px` }} />
            ) : null}
          </span>
          <button
            type="button"
            className={`mr-family-open is-${node.kind}`}
            aria-expanded={editing === node.id}
            aria-label={`Edit ${node.label}`}
            onClick={() => openNode(node)}
          >
            <span className="mr-family-top">
              <span className={`mr-family-dot is-${state}`} aria-hidden="true" />
              <span className="mr-family-label">{node.label}</span>
              <span className="mr-family-kind mono">{node.kind === 'lane' ? 'lane' : node.kind}</span>
            </span>
            <span className="mr-family-meta mono">{familyMeta(node)}</span>
          </button>
          {node.kind === 'lane' ? (
            <button
              type="button"
              role="switch"
              aria-checked={node.active}
              aria-label={`${node.active ? 'Turn off' : 'Turn on'} ${node.label}`}
              className={`mr-side-switch${node.active ? ' is-on' : ''}`}
              disabled={busy || typeof client?.setActiveLanes !== 'function'}
              onClick={() => askLaneToggle(node, !node.active)}
            >
              <span className="mr-side-switch-knob" aria-hidden="true" />
            </button>
          ) : null}
          <button
            type="button"
            className="mr-family-add"
            aria-label={`Add child to ${node.label}`}
            aria-expanded={childFor === node.id}
            disabled={busy}
            onClick={() => toggleChild(node)}
          >
            +
          </button>
        </div>
        {editing === node.id ? renderEditor(node, row.depth) : null}
        {childFor === node.id ? renderChildForm(node, row.depth) : null}
      </div>
    )
  }

  return (
    <section className="mr-family" aria-label="Agents">
      <button
        type="button"
        className="mr-side-head is-button"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <span className="mr-side-head-title mono">Agents</span>
        <span className="mr-side-count mono">{countLine}</span>
        <span className="mr-side-twist" aria-hidden="true">
          {open ? '-' : '+'}
        </span>
      </button>
      {open ? (
        <div className="mr-family-body">
          {actionError ? (
            <p className="mr-side-error mono" role="alert">
              {actionError}
            </p>
          ) : null}
          {family && readError ? <p className="mr-side-note">{readError}</p> : null}
          {!family ? (
            <p className="mr-side-note">
              {readError ? 'The family tree is not available.' : 'Loading agents...'}
            </p>
          ) : (
            <>
              {renderRequests()}
              {tree.rows.length === 0 ? <p className="mr-side-note">No agents are listed.</p> : null}
              {tree.rows.map(renderRow)}
            </>
          )}
        </div>
      ) : null}
      {confirm ? (
        <div className="mr-side-confirm" role="dialog" aria-modal="true" aria-label={confirm.label}>
          <section className="mr-side-confirm-card">
            <p className="mr-side-confirm-text">{busy && confirm.busyText ? confirm.busyText : confirm.text}</p>
            {confirm.detail ? <p className="mr-family-confirm-detail mono">{confirm.detail}</p> : null}
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
