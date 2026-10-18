import { useCallback, useEffect, useRef, useState } from 'react'
import DispatchPanel from './DispatchPanel.jsx'
import TasksPanel from './TasksPanel.jsx'
import ApprovalsPanel from './ApprovalsPanel.jsx'
import MetersPanel from './MetersPanel.jsx'

const TABS = [
  { id: 'dispatch', label: 'Dispatch' },
  { id: 'tasks', label: 'Tasks' },
  { id: 'approvals', label: 'Approvals' },
  { id: 'meters', label: 'Meters' },
]

export default function ControlDrawer({ client, open, onClose, controlTarget = null }) {
  const [activeTab, setActiveTab] = useState(() => {
    const rawId = controlTarget?.issueIdentifier
    const hasId = typeof rawId === 'string' ? rawId.trim().length > 0 : rawId != null && String(rawId).trim().length > 0
    if (hasId) return 'tasks'
    if (controlTarget?.tab && TABS.some((t) => t.id === controlTarget.tab)) return controlTarget.tab
    return 'dispatch'
  })
  const [pendingApprovalsCount, setPendingApprovalsCount] = useState(0)
  const tabRefs = useRef({})
  const triggerRef = useRef(null)
  const lastTargetNonceRef = useRef(controlTarget?.nonce ?? null)

  const loadPendingCount = useCallback(async () => {
    if (!client) return
    try {
      const list = await client.approvals()
      const pending = list.filter((a) => a.status === 'pending').length
      setPendingApprovalsCount(pending)
    } catch {
      setPendingApprovalsCount(0)
    }
  }, [client])

  useEffect(() => {
    if (controlTarget?.nonce != null) {
      if (controlTarget.nonce !== lastTargetNonceRef.current) {
        lastTargetNonceRef.current = controlTarget.nonce
        const rawId = controlTarget.issueIdentifier
        const hasId = typeof rawId === 'string' ? rawId.trim().length > 0 : rawId != null && String(rawId).trim().length > 0
        if (hasId) {
          setActiveTab('tasks')
        } else if (controlTarget.tab && TABS.some((t) => t.id === controlTarget.tab)) {
          setActiveTab(controlTarget.tab)
        }
      }
    } else {
      lastTargetNonceRef.current = null
    }
  }, [controlTarget])

  useEffect(() => {
    if (open) {
      const active = document.activeElement
      triggerRef.current =
        active?.getAttribute?.('aria-controls') === 'hud-control-drawer'
          ? active
          : document.querySelector('[aria-controls="hud-control-drawer"]') || active
      loadPendingCount()
      const currentTabEl = tabRefs.current[activeTab]
      currentTabEl?.focus()
    } else if (triggerRef.current) {
      if (typeof triggerRef.current.focus === 'function') {
        triggerRef.current.focus()
      }
      triggerRef.current = null
    }
  }, [open, loadPendingCount])

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
      nextIndex = (currentIndex + 1) % TABS.length
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
      nextIndex = (currentIndex - 1 + TABS.length) % TABS.length
    } else if (event.key === 'Home') {
      nextIndex = 0
    } else if (event.key === 'End') {
      nextIndex = TABS.length - 1
    }

    if (nextIndex !== null) {
      event.preventDefault()
      const nextTab = TABS[nextIndex]
      setActiveTab(nextTab.id)
      tabRefs.current[nextTab.id]?.focus()
    }
  }

  if (!open) return null

  return (
    <aside
      id="hud-control-drawer"
      className="control-drawer"
      aria-label="Control panels"
    >
      <header className="control-drawer-header">
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
        {TABS.map((tab, index) => {
          const isSelected = activeTab === tab.id
          const count = tab.id === 'approvals' ? pendingApprovalsCount : 0

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
              {count > 0 && <span className="tab-badge mono">{count}</span>}
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
        {activeTab === 'dispatch' && (
          <DispatchPanel
            client={client}
            onCreated={() => {
              loadPendingCount()
            }}
          />
        )}
        {activeTab === 'tasks' && <TasksPanel client={client} controlTarget={controlTarget} />}
        {activeTab === 'approvals' && (
          <ApprovalsPanel
            client={client}
            onPendingCountChange={setPendingApprovalsCount}
          />
        )}
        {activeTab === 'meters' && <MetersPanel client={client} />}
      </div>
    </aside>
  )
}
