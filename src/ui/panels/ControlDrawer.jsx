import { useEffect, useMemo, useRef, useState } from 'react'
import { useDialogFocus } from '../dialogFocus.js'
import DispatchPanel from './DispatchPanel.jsx'
import TasksPanel from './TasksPanel.jsx'
import MetersPanel from './MetersPanel.jsx'
import AgentBuilder from './AgentBuilder.jsx'
import ReviewsPanel from './ReviewsPanel.jsx'
import PanelBoundary from './PanelBoundary.jsx'
import { cancelSplitRun } from './runs.js'

export default function ControlDrawer({
  client,
  open,
  onClose,
  controlTarget = null,
  activeTab: initialTab = null,
}) {
  const hasTeamTab = typeof client?.agents === 'function'
  const hasReviewsTab = typeof client?.reviews === 'function'
  const hasTasksTab =
    typeof client?.issues === 'function' &&
    typeof client?.agents === 'function' &&
    typeof client?.liveRuns === 'function' &&
    typeof client?.comments === 'function'
  const hasMetersTab = typeof client?.costs === 'function'
  const tabs = useMemo(() => {
    const next = [{ id: 'dispatch', label: 'Dispatch' }]
    if (hasTasksTab) next.push({ id: 'tasks', label: 'Tasks' })
    if (hasMetersTab) next.push({ id: 'meters', label: 'Meters' })
    if (hasTeamTab) next.push({ id: 'agents', label: 'Team' })
    if (hasReviewsTab) next.push({ id: 'reviews', label: 'Reviews' })
    return next
  }, [hasTasksTab, hasMetersTab, hasTeamTab, hasReviewsTab])

  const [activeTab, setActiveTab] = useState(() => {
    const rawId = controlTarget?.issueIdentifier
    const hasId = typeof rawId === 'string' ? rawId.trim().length > 0 : rawId != null && String(rawId).trim().length > 0
    if (hasId) return 'tasks'
    if (controlTarget?.tab && tabs.some((t) => t.id === controlTarget.tab)) return controlTarget.tab
    if (initialTab && tabs.some((t) => t.id === initialTab)) return initialTab
    return 'dispatch'
  })
  const tabRefs = useRef({})
  const drawerRef = useRef(null)
  const lastTargetNonceRef = useRef(controlTarget?.nonce ?? null)

  useEffect(() => {
    if (!tabs.some((t) => t.id === activeTab)) {
      setActiveTab('dispatch')
    }
  }, [tabs, activeTab])

  useEffect(() => {
    if (controlTarget?.nonce != null) {
      if (controlTarget.nonce !== lastTargetNonceRef.current) {
        lastTargetNonceRef.current = controlTarget.nonce
        const rawId = controlTarget.issueIdentifier
        const hasId = typeof rawId === 'string' ? rawId.trim().length > 0 : rawId != null && String(rawId).trim().length > 0
        if (hasId) {
          setActiveTab('tasks')
        } else if (controlTarget.tab && tabs.some((t) => t.id === controlTarget.tab)) {
          setActiveTab(controlTarget.tab)
        }
      }
    } else {
      lastTargetNonceRef.current = null
    }
  }, [controlTarget, tabs])

  useDialogFocus(open, {
    containerRef: drawerRef,
    getInitialFocus: () => tabRefs.current[activeTab] ?? null,
    openerSelector: 'hud-control-drawer',
    trap: false,
  })

  const wasOpenRef = useRef(open)

  useEffect(() => {
    if (wasOpenRef.current && !open) cancelSplitRun()
    wasOpenRef.current = open
  }, [open])

  useEffect(() => {
    return () => {
      cancelSplitRun()
    }
  }, [])

  useEffect(() => {
    function onKeyDown(event) {
      if (!open || event.defaultPrevented) return
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose?.()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open, onClose])

  function handleTabKeyDown(event, currentIndex) {
    let nextIndex = null
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
      nextIndex = (currentIndex + 1) % tabs.length
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
      nextIndex = (currentIndex - 1 + tabs.length) % tabs.length
    } else if (event.key === 'Home') {
      nextIndex = 0
    } else if (event.key === 'End') {
      nextIndex = tabs.length - 1
    }

    if (nextIndex !== null) {
      event.preventDefault()
      const nextTab = tabs[nextIndex]
      setActiveTab(nextTab.id)
      tabRefs.current[nextTab.id]?.focus()
    }
  }

  const dispatchBriefId =
    controlTarget?.tab === 'dispatch' && typeof controlTarget.briefId === 'string' && controlTarget.briefId.trim()
      ? controlTarget.briefId.trim()
      : undefined

  if (!open) return null

  return (
    <aside
      id="hud-control-drawer"
      ref={drawerRef}
      className="control-drawer"
      aria-label="Control panels"
    >
      <header className="control-drawer-header hud-header-strip">
        <h2 className="control-drawer-title">Control</h2>
        <button
          type="button"
          className="control-close-btn"
          aria-label="Close control drawer"
          onClick={onClose}
        >
          Close
        </button>
      </header>

      <div
        className="control-tabs"
        role="tablist"
        aria-label="Control panel sections"
      >
        {tabs.map((tab, index) => {
          const isSelected = activeTab === tab.id

          return (
            <button
              key={tab.id}
              ref={(el) => {
                tabRefs.current[tab.id] = el
              }}
              type="button"
              role="tab"
              id={`tab-${tab.id}`}
              className="control-tab-btn"
              aria-selected={isSelected}
              aria-controls={`panel-${tab.id}`}
              tabIndex={isSelected ? 0 : -1}
              onClick={() => setActiveTab(tab.id)}
              onKeyDown={(e) => handleTabKeyDown(e, index)}
            >
              <span>{tab.label}</span>
            </button>
          )
        })}
      </div>

      <div
        role="tabpanel"
        id={`panel-${activeTab}`}
        aria-labelledby={`tab-${activeTab}`}
        tabIndex={0}
        className="control-panel-content"
      >
        <PanelBoundary key={activeTab}>
          {activeTab === 'dispatch' && (
            <DispatchPanel
              client={client}
              targetBriefId={dispatchBriefId}
            />
          )}
          {activeTab === 'tasks' && <TasksPanel client={client} controlTarget={controlTarget} />}
          {activeTab === 'meters' && <MetersPanel client={client} />}
          {activeTab === 'agents' && hasTeamTab && (
            <AgentBuilder client={client} />
          )}
          {activeTab === 'reviews' && hasReviewsTab && (
            <ReviewsPanel client={client} />
          )}
        </PanelBoundary>
      </div>
    </aside>
  )
}
