import { useEffect, useMemo, useState } from 'react'
import { toAgents } from '../live/source.js'
import { agentTasks } from '../model/liveTasks.js'
import AutocompactInput from './AutocompactInput.jsx'
import {
  DIRECT_HARNESS,
  DIRECT_KEY_PROBLEM,
  MAX_SUBS,
  affectedSubText,
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
  harnessLabel,
  harnessModels,
  labelProblem,
  rowText,
  stateWord,
  subsLosingLanes,
} from './family.js'
import { changeSub, idFromName, ladderFromOrchestrators, ladderSubs } from './ladderForm.js'
import { ModelSelect, useHarnessModels } from './ModelRefresh.jsx'
import { withHarnessModels, withModelRows } from './modelRefresh.js'
import { AGENT_NAME_MAX, agentCountLine, cleanText, laneChoice, laneSummary } from './sidebar.js'

function messageOf(error) {
  return error instanceof Error && error.message ? error.message : 'The bridge refused the change.'
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

function groupSubLadder(ladder, draft, laneIds, laneKeys = []) {
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
  const sub = {
    id: subIdFor(taken, draft.label),
    name: cleanText(draft.label, AGENT_NAME_MAX),
    harness: cleanText(draft.harness, 40) || 'opencode',
    model: cleanText(draft.model, 120),
    lanes: picked,
    scope: ['**'],
    restricted: false,
    setBy: 'owner',
  }
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

export function FamilyTree({ client = null, tasks = null }) {
  const canFamily = typeof client?.family === 'function'
  const [family, setFamily] = useState(null)
  const [lanes, setLanes] = useState(null)
  const [harnesses, setHarnesses] = useState(null)
  const [models, setModels] = useState(null)
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
  const [confirm, setConfirm] = useState(null)
  const [busy, setBusy] = useState(false)
  const [selectedLanes, setSelectedLanes] = useState([])
  const [groupOpen, setGroupOpen] = useState(false)
  const [subDraft, setSubDraft] = useState(null)
  const [subProblem, setSubProblem] = useState('')
  const [orchestrators, setOrchestrators] = useState(null)
  const [liveTaskMap, setLiveTaskMap] = useState(null)

  useEffect(() => {
    if (!canFamily) return undefined
    let active = true
    setReadError('')
    const jobs = [
      ['family', () => client.family()],
      ['lanes', () => client.lanes?.()],
      ['harnesses', () => client.harnesses?.()],
      ['models', () => client.models?.()],
      ['orchestrators', () => client.orchestrators?.()],
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
      if (values.orchestrators) setOrchestrators(values.orchestrators)
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
    if (typeof client?.orchestrators === 'function') {
      jobs.push(
        Promise.resolve(client.orchestrators()).then((answer) => {
          if (answer) setOrchestrators(answer)
        })
      )
    }
    const results = await Promise.allSettled(jobs)
    const failed = results.find((result) => result.status === 'rejected')
    if (failed) setActionError(messageOf(failed.reason))
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
      else if (notice.topic === 'family' || notice.topic === 'agents') refresh()
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
  const taskMap = tasks instanceof Map ? tasks : liveTaskMap
  const summary = laneSummary(lanes)
  const countLine = lanes ? agentCountLine(summary.active.length, summary.max) : 'Loading agents...'
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
  }, [editingNode, harnesses, nodeDraft?.harness])
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
    return childHarnesses(harnesses, models).find((row) => row.key === subDraft?.harness) ?? null
  }, [groupOpen, subDraft?.harness, harnesses, models])
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
    const lanesInTree = new Set(tree.nodes.filter((node) => node.kind === 'lane').map((node) => node.id))
    setSelectedLanes((current) => {
      const next = current.filter((id) => lanesInTree.has(id))
      return next.length === current.length ? current : next
    })
  }, [tree])

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
      lanes:
        node.kind === 'sub'
          ? tree.nodes.filter((row) => row.kind === 'lane' && row.parent === node.id).map((row) => row.id)
          : [],
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
    const list = childHarnesses(harnesses, models)
    if (node && node.harness && !list.some((row) => row.key === node.harness)) {
      const known = findHarness(harnesses, node.harness)
      list.push({
        key: node.harness,
        name: harnessLabel(node.harness) || known?.name || node.harness,
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
    const choices = harness.key === DIRECT_HARNESS ? editorModels.choices : harnessModels(harness, models)
    const model = cleanText(nodeDraft.model, 120)
    if (choices.length === 0) {
      setActionError(harness.key === DIRECT_HARNESS ? DIRECT_KEY_PROBLEM : 'This harness has no models.')
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
    if (node.kind !== 'lane') return
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

  function subDraftFor() {
    const offered = childHarnesses(harnesses, models)
    const harness = offered.find((row) => row.key === 'opencode') ?? offered[0] ?? null
    return {
      label: 'Sub orchestrator',
      harness: harness?.key ?? 'opencode',
      model: harness?.models?.[0]?.id ?? '',
      effort: harness?.efforts?.[0] ?? '',
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
    setGroupOpen(false)
    setSubDraft(null)
    setSubProblem('')
  }

  function closeGroupForm() {
    setGroupOpen(false)
    setSubDraft(null)
    setSubProblem('')
  }

  function toggleSelected(node, on) {
    if (!node || node.kind !== 'lane') return
    setSubProblem('')
    setSelectedLanes((current) => {
      if (on) return current.includes(node.id) ? current : [...current, node.id]
      return current.filter((id) => id !== node.id)
    })
  }

  function chooseSubHarness(key) {
    const harness = childHarnesses(harnesses, models).find((row) => row.key === key)
    if (!harness) return
    setSubProblem('')
    setSubDraft((current) => ({
      ...(current ?? subDraftFor()),
      harness: harness.key,
      model: harnessModels(harness, models)[0]?.id ?? '',
      effort: harnessEfforts(harness)[0] ?? '',
    }))
  }

  async function askGroupSub() {
    if (!subDraft || busy) return
    const draftForPlan = subDraft
    const pickedForPlan = selectedLanes
    const problem = childFormProblem(draftForPlan, { harnesses, models, directModels: subModels.choices })
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
      return groupSubLadder(ladder, draftForPlan, pickedForPlan, laneKeys)
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
      detail: childDetail(draftForPlan, harnesses, models),
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
        clearSelection()
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
        clearSelection()
        return
      }
      const next = selectedLanes.includes(node.id) ? selectedLanes : [...selectedLanes, node.id]
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
      model: harnessModels(harness, models)[0]?.id ?? '',
      effort: harnessEfforts(harness)[0] ?? '',
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

  function renderDirectNotice(onRefresh = null) {
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
    const laneNodes = tree.nodes.filter((row) => row.kind === 'lane')
    const options = lane ? [] : nodeHarnessOptions(node)
    const harness = lane
      ? editorHarness
      : options.find((row) => row.key === nodeDraft.harness) ?? null
    const direct = harness?.key === DIRECT_HARNESS
    const choices = harness ? editorModels.choices : []
    const directMissing = direct && !editorModels.loading && choices.length === 0
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
            <p className="mr-family-note mono">{`Harness ${harnessLabel(node.harness) || 'unknown'}`}</p>
            {directMissing ? (
              renderDirectNotice(editorModels.refresh)
            ) : harness ? (
              <ModelSelect
                label="Model"
                ariaLabel={`Model for ${node.label}`}
                value={nodeDraft.model}
                choices={choices}
                onChange={(model) => setNodeDraft({ ...nodeDraft, model })}
                onRefresh={editorModels.refresh}
                loading={editorModels.loading}
                error={editorModels.error}
                canRefresh={editorModels.canRefresh}
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
                className="mr-side-action is-danger"
                disabled={busy || typeof client?.deleteLane !== 'function'}
                onClick={() => askRemove(node)}
              >
                Remove
              </button>
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
                      {harnessLabel(row) || row.key}
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              <p className="mr-side-note is-dim">No harnesses are listed.</p>
            )}
            {directMissing ? (
              renderDirectNotice(editorModels.refresh)
            ) : harness ? (
              <ModelSelect
                label="Model"
                ariaLabel={`Model for ${node.label}`}
                value={nodeDraft.model}
                choices={choices}
                onChange={(model) => setNodeDraft({ ...nodeDraft, model })}
                onRefresh={editorModels.refresh}
                loading={editorModels.loading}
                error={editorModels.error}
                canRefresh={editorModels.canRefresh}
              />
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
                  directMissing ||
                  (typeof client?.setOrchestratorHarness !== 'function' &&
                    typeof client?.setOrchestratorEffort !== 'function')
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
                        <span className="mr-family-agent-id mono">{row.id}</span>
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
          <p className="mr-side-note is-dim">Loading harnesses...</p>
        )}
        {directMissing ? renderDirectNotice(childModels.refresh) : null}
        {selected && !directMissing ? (
          <ModelSelect
            label="Model"
            ariaLabel="New agent model"
            value={draft.model}
            choices={choices}
            onChange={(model) => setDraft({ ...draft, model })}
            onRefresh={childModels.refresh}
            loading={childModels.loading}
            error={childModels.error}
            canRefresh={childModels.canRefresh}
          />
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
          <button type="submit" className="mr-side-primary" disabled={busy || !canCreate || directMissing}>
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
    const offered = childHarnesses(harnesses, models)
    const selected = offered.find((row) => row.key === subDraft.harness) ?? null
    const efforts = selected ? harnessEfforts(selected) : []
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
        {directMissing ? renderDirectNotice(subModels.refresh) : null}
        {selected && !directMissing ? (
          <ModelSelect
            label="Model"
            ariaLabel="Sub orchestrator model"
            value={subDraft.model}
            choices={subModels.choices}
            onChange={(model) => setSubDraft({ ...subDraft, model })}
            onRefresh={subModels.refresh}
            loading={subModels.loading}
            error={subModels.error}
            canRefresh={subModels.canRefresh}
          />
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
        {subProblem ? <p className="mr-family-note is-error">{subProblem}</p> : null}
        <div className="mr-side-form-actions">
          <button type="submit" className="mr-side-primary" disabled={busy || !canGroup || directMissing}>
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
    if (selectedLanes.length === 0) return null
    return (
      <>
        <div className="mr-family-selection" role="group" aria-label="Selected code agents">
          <span className="mr-family-selection-count mono">{`${selectedLanes.length} selected`}</span>
          <button
            type="button"
            className="mr-side-action mr-family-sub-open"
            aria-expanded={groupOpen}
            disabled={busy}
            onClick={() => openGroupForm(selectedLanes)}
          >
            Add sub orchestrator
          </button>
          <button type="button" className="mr-side-action" disabled={busy} onClick={clearSelection}>
            Clear
          </button>
        </div>
        {groupOpen ? renderSubForm() : null}
      </>
    )
  }

  function renderRow(row) {
    const node = row
    const state = stateWord(node)
    const text = rowText(node, orchestratorStates.get(node.id) ?? '', taskFor(taskMap, node.id))
    const dotState =
      node.kind === 'lane' ? state : text === 'working' ? 'working' : text === 'paused' ? 'paused' : 'idle'
    const sub = node.kind === 'sub'
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
          {node.kind === 'lane' ? (
            <input
              type="checkbox"
              className="mr-family-check"
              aria-label={`Select ${node.label}`}
              checked={selectedLanes.includes(node.id)}
              disabled={busy}
              onChange={(event) => toggleSelected(node, event.target.checked)}
            />
          ) : (
            <span className="mr-family-check-space" aria-hidden="true" />
          )}
          <div className="mr-family-main">
            <button
              type="button"
              className={`mr-family-open is-${node.kind}`}
              aria-expanded={editing === node.id}
              aria-label={`Edit ${node.label}`}
              onClick={() => openNode(node)}
            >
              <span className="mr-family-top">
                <span className={`mr-family-dot is-${dotState}`} aria-hidden="true" />
                <span className="mr-family-label">{node.label}</span>
              </span>
            </button>
            <div className="mr-family-under">
              {text ? <span className={`mr-family-state is-${dotState} mono`}>{text}</span> : null}
              <span className="mr-family-kind mono">{node.kind === 'lane' ? 'lane' : node.kind}</span>
              <span className="mr-family-meta mono">{familyMeta(node)}</span>
              <span className="mr-family-actions">
                {node.kind === 'lane' ? (
                  <button
                    type="button"
                    role="switch"
                    aria-checked={node.active}
                    aria-label={`${node.active ? 'Turn off' : 'Turn on'} ${node.label}`}
                    className={`mr-side-switch${node.active ? ' is-on' : ''}`}
                    disabled={busy || typeof client?.setActiveLanes !== 'function'}
                    onClick={() => toggleLane(node, !node.active)}
                  >
                    <span className="mr-side-switch-knob" aria-hidden="true" />
                  </button>
                ) : null}
                {node.kind === 'lane' || sub ? (
                  <button
                    type="button"
                    className="mr-family-trash"
                    aria-label={`Delete ${node.label}`}
                    title={`Delete ${node.label}`}
                    disabled={
                      busy ||
                      (sub
                        ? typeof client?.setLadder !== 'function' || typeof client?.orchestrators !== 'function'
                        : typeof client?.deleteLane !== 'function')
                    }
                    onClick={() => (sub ? askRemoveSub(node) : askRemove(node))}
                  >
                    <svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true" focusable="false">
                      <path
                        d="M2 3.5h8M4.5 3.5V2.5h3v1M3.4 3.5l.4 6h4.4l.4-6M5 5.5v2.6M7 5.5v2.6"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </button>
                ) : null}
                <button
                  type="button"
                  className="mr-family-add"
                  aria-label={
                    node.kind === 'lane'
                      ? `Add sub orchestrator for ${node.label}`
                      : `Add child to ${node.label}`
                  }
                  aria-expanded={
                    node.kind === 'lane' ? groupOpen && selectedLanes.includes(node.id) : childFor === node.id
                  }
                  disabled={busy}
                  onClick={() => toggleChild(node)}
                >
                  +
                </button>
                {node.kind === 'lane' ? null : (
                  <button
                    type="button"
                    className="mr-family-chat"
                    aria-label={`Open chat with ${node.label}`}
                    title={`Open chat with ${node.label}`}
                    onClick={() => openChat(node.id)}
                  >
                    <svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true" focusable="false">
                      <path
                        d="M2 2.5h8v5.5H6L3.5 10V8H2z"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </button>
                )}
              </span>
            </div>
          </div>
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
              {renderSelection()}
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
