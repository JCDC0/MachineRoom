import { SIDEBAR_TABS, normalizeSidebarTab } from './sidebar.js'

function ChatIcon() {
  return (
    <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
      <path
        d="M2.5 3.5h11v7h-6L4.5 13v-2.5h-2z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.1"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function FolderIcon() {
  return (
    <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
      <path
        d="M1.8 4h4.5l1.2 1.4h6.7v6.8H1.8z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.1"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function AgentsIcon() {
  return (
    <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
      <path
        d="M7 6.9 4 5.1M9 6.9l3-1.8M7 9.1 4 10.9M9 9.1l3 1.8"
        fill="none"
        stroke="currentColor"
        strokeWidth="1"
        strokeLinecap="round"
      />
      <circle cx="8" cy="8" r="1.7" fill="none" stroke="currentColor" strokeWidth="1.1" />
      <circle cx="3.4" cy="4.4" r="1.1" fill="none" stroke="currentColor" strokeWidth="1" />
      <circle cx="12.6" cy="4.4" r="1.1" fill="none" stroke="currentColor" strokeWidth="1" />
      <circle cx="3.4" cy="11.6" r="1.1" fill="none" stroke="currentColor" strokeWidth="1" />
      <circle cx="12.6" cy="11.6" r="1.1" fill="none" stroke="currentColor" strokeWidth="1" />
    </svg>
  )
}

const ICONS = { chat: ChatIcon, projects: FolderIcon, agents: AgentsIcon }

export function SidebarTabs({ value = 'chat', onChange = () => {} }) {
  const active = normalizeSidebarTab(value)
  return (
    <div className="mr-side-tabs" role="tablist" aria-label="Sidebar tabs">
      {SIDEBAR_TABS.map((tab) => {
        const Icon = ICONS[tab.key]
        const open = tab.key === active
        return (
          <button
            key={tab.key}
            type="button"
            role="tab"
            aria-selected={open}
            className={`mr-side-tab${open ? ' is-open' : ''}`}
            onClick={() => onChange(tab.key)}
          >
            <Icon />
            <span className="mr-side-tab-label mono">{tab.label}</span>
          </button>
        )
      })}
    </div>
  )
}

export default SidebarTabs
