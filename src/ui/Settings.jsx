import { useEffect, useRef, useState } from 'react'
import EndpointsPanel from './EndpointsPanel.jsx'
import HarnessesSettings, { LaneSettingsFields } from './HarnessesSettings.jsx'
import AgentDepthSettings from './AgentDepthSettings.jsx'
import KeysSettings from './KeysSettings.jsx'
import LanesSettings from './LanesSettings.jsx'
import McpSettings from './McpSettings.jsx'
import MusicPlayer from './MusicPlayer.jsx'
import SearchSettings from './SearchSettings.jsx'
import StorageSettings from './StorageSettings.jsx'
import { readStorage, store, writeStorage } from '../storage.js'
import { RECORD_MINUTES_MAX, RECORD_MINUTES_MIN, clampRecordMinutes } from '../model/recordLimits.js'
import { effectSettings, clampFileLimit, FILE_LIMIT_MAX, FILE_LIMIT_MIN, loadSettings, loadSoundSettings, saveSettings, saveSoundSettings } from './settings.js'
import { sound } from './sound.js'

export const EFFECTS = [
  { key: 'aberration', label: 'Chromatic aberration', costly: false },
  { key: 'vignette', label: 'Vignette', costly: false },
  { key: 'grain', label: 'Grain', costly: false },
  { key: 'dust', label: 'Fine dust', costly: false },
  { key: 'bloom', label: 'Bloom', costly: false },
]

export const SETTINGS_TAB_KEY = 'machineroom.settingsTab'
export const SETTINGS_TABS = [
  { key: 'harnesses', label: 'Harnesses' },
  { key: 'direct-api', label: 'Direct API' },
  { key: 'keys', label: 'Keys' },
  { key: 'lanes', label: 'Lanes' },
  { key: 'effects', label: 'Screen effects' },
  { key: 'replay', label: 'Replay' },
  { key: 'sound', label: 'Sound' },
  { key: 'subagents', label: 'Subagents' },
  { key: 'mcp', label: 'MCP tools' },
  { key: 'search', label: 'Web search' },
  { key: 'storage', label: 'Storage' },
]

function savedTab() {
  const key = readStorage(SETTINGS_TAB_KEY)
  return SETTINGS_TABS.some((tab) => tab.key === key) ? key : SETTINGS_TABS[0].key
}

export default function Settings({ open = true, effects, onChange, onSettingsChange, onClose, client = null, project = '', focusDirectApi = false, onDirectApiFocused }) {
  const current = effectSettings(effects)
  const [soundState, setSoundState] = useState(() => loadSoundSettings(store()))
  const [recordDraft, setRecordDraft] = useState(() => String(loadSettings(store()).recordMinutes))
  const recordDraftRef = useRef(recordDraft)
  const currentRef = useRef(current)
  const onSettingsChangeRef = useRef(onSettingsChange)
  currentRef.current = current
  onSettingsChangeRef.current = onSettingsChange
  const [tab, setTab] = useState(savedTab)

  function openTab(key) {
    if (key !== tab && tab === 'replay') commitRecordMinutes()
    setTab(key)
    writeStorage(SETTINGS_TAB_KEY, key)
  }

  const scrollPending = useRef(false)

  useEffect(() => {
    if (!open || !focusDirectApi) return
    scrollPending.current = true
    setTab('direct-api')
    onDirectApiFocused?.()
  }, [open, focusDirectApi, onDirectApiFocused])

  useEffect(() => {
    if (!open || tab !== 'direct-api' || !scrollPending.current) return
    scrollPending.current = false
    const target = typeof document !== 'undefined' ? document.getElementById('settings-direct-api') : null
    if (target && typeof target.scrollIntoView === 'function') {
      target.scrollIntoView({ block: 'start' })
    }
  }, [open, tab, focusDirectApi])

  function updateSound(patch) {
    const next = saveSoundSettings(store(), patch)
    setSoundState(next)
    sound.setSettings(next)
  }

  function updateDepth(depth) {
    onChange?.({ ...current, alwaysDepth: depth })
  }

  function updateMaxFiles(maxFiles) {
    onChange?.({ ...current, maxFiles: clampFileLimit(maxFiles) })
  }

  function updateFolderOption(key, value) {
    onChange?.({ ...current, [key]: Boolean(value) })
  }

  function updateEffect(key, patch) {
    const prev = current[key] ?? { on: false, strength: 0.2 }
    onChange?.({
      ...current,
      [key]: { ...prev, ...patch },
    })
  }

  function commitRecordMinutes() {
    const minutes = clampRecordMinutes(recordDraftRef.current)
    setRecordDraft(String(minutes))
    const saved = saveSettings(store(), { recordMinutes: minutes })
    onSettingsChange?.({ ...current, recordMinutes: saved.recordMinutes })
  }

  useEffect(() => {
    return () => {
      const minutes = clampRecordMinutes(recordDraftRef.current)
      const saved = saveSettings(store(), { recordMinutes: minutes })
      onSettingsChangeRef.current?.({ ...currentRef.current, recordMinutes: saved.recordMinutes })
    }
  }, [])

  if (!open) return null

  const currentTab = SETTINGS_TABS.find((item) => item.key === tab) ?? SETTINGS_TABS[0]

  return (
    <section
      id="hud-settings"
      className="hud-settings"
      aria-labelledby="hud-settings-title"
    >
      <header className="hud-settings-header hud-header-strip">
        <h2 id="hud-settings-title">Settings</h2>
        <button
          type="button"
          className="hud-settings-close"
          onClick={onClose}
          aria-label="Close settings"
        >
          Close
        </button>
      </header>

      <label className="hud-settings-section">
        <span>Section</span>
        <select
          id="hud-settings-section"
          className="hud-settings-select mono"
          value={tab}
          onChange={(event) => openTab(event.target.value)}
        >
          {SETTINGS_TABS.map((item) => (
            <option key={item.key} value={item.key}>
              {item.label}
            </option>
          ))}
        </select>
      </label>

      <div className="hud-settings-body" id="hud-settings-panel" aria-label={currentTab.label}>
        <div hidden={tab !== 'harnesses'}><HarnessesSettings client={client} /></div>
        <div hidden={tab !== 'direct-api'}><EndpointsPanel client={client} /></div>
        <div hidden={tab !== 'keys'}><KeysSettings client={client} /></div>
        <div hidden={tab !== 'lanes'}>
          <>
            <LaneSettingsFields client={client} />
            <LanesSettings client={client} project={project} />
          </>
        </div>
        <div hidden={tab !== 'effects'}>
          <>
          <div className="hud-settings-section">
            <div className="hud-settings-row">
              <span className="hud-settings-label">Folder depth</span>
              <span className="hud-settings-value mono">{current.alwaysDepth}</span>
            </div>
            <div className="hud-settings-control">
              <input
                type="range"
                min="1"
                max="3"
                step="1"
                value={current.alwaysDepth}
                aria-label="Folder depth"
                onChange={(event) => updateDepth(Number(event.target.value))}
              />
              <div className="hud-settings-ticks mono">
                <span>1</span>
                <span>2</span>
                <span>3</span>
              </div>
            </div>
            <div className="hud-settings-row">
              <span className="hud-settings-label">Content files</span>
              <span className="hud-settings-value mono">{current.maxFiles}</span>
            </div>
            <div className="hud-settings-control">
              <input
                type="range"
                min={FILE_LIMIT_MIN}
                max={FILE_LIMIT_MAX}
                step="1"
                value={current.maxFiles}
                aria-label="Content files"
                onChange={(event) => updateMaxFiles(Number(event.target.value))}
              />
              <div className="hud-settings-ticks mono">
                <span>4</span>
                <span>12</span>
                <span>20</span>
              </div>
            </div>
            <div className="hud-settings-row">
              <span className="hud-settings-label">Show folder contents</span>
              <button
                type="button"
                role="switch"
                aria-checked={current.folderContents}
                aria-label="Show folder contents"
                className={`hud-settings-switch ${current.folderContents ? 'is-on' : ''}`}
                onClick={() => updateFolderOption('folderContents', !current.folderContents)}
              >
                {current.folderContents ? 'On' : 'Off'}
              </button>
            </div>
            <div className="hud-settings-row">
              <span className="hud-settings-label">Open when an agent touches it</span>
              <button
                type="button"
                role="switch"
                aria-checked={current.openOnTouch}
                aria-label="Open when an agent touches it"
                className={`hud-settings-switch ${current.openOnTouch ? 'is-on' : ''}`}
                disabled={current.folderContents}
                onClick={() => updateFolderOption('openOnTouch', !current.openOnTouch)}
              >
                {current.openOnTouch ? 'On' : 'Off'}
              </button>
            </div>
          </div>

          <div className="hud-settings-section">
            <h3 className="hud-settings-section-title">Screen effects</h3>
            <div className="hud-settings-effects">
              {EFFECTS.map(({ key, label, costly }) => {
                const effect = current[key] ?? { on: false, strength: 0.2 }
                const displayLabel = costly ? `${label} (costly)` : label
                return (
                  <div key={key} className="hud-settings-effect">
                    <div className="hud-settings-row">
                      <span className="hud-settings-label">{displayLabel}</span>
                      <div className="hud-settings-actions">
                        <button
                          type="button"
                          role="switch"
                          aria-checked={effect.on}
                          aria-label={displayLabel}
                          className={`hud-settings-switch ${effect.on ? 'is-on' : ''}`}
                          onClick={() => updateEffect(key, { on: !effect.on })}
                        >
                          {effect.on ? 'On' : 'Off'}
                        </button>
                        {key === 'dust' && (
                          <button
                            type="button"
                            role="switch"
                            aria-checked={effect.pulse === true}
                            aria-label="Fine dust pulse"
                            className={`hud-settings-switch ${effect.pulse ? 'is-on' : ''}`}
                            disabled={!effect.on}
                            onClick={() => updateEffect(key, { pulse: !effect.pulse })}
                          >
                            {effect.pulse ? 'Pulse' : 'Steady'}
                          </button>
                        )}
                        <span className="hud-settings-value mono">
                          {Math.round(effect.strength * 100)}%
                        </span>
                      </div>
                    </div>
                    <div className="hud-settings-control">
                      <input
                        type="range"
                        min="0"
                        max="1"
                        step="0.05"
                        value={effect.strength}
                        disabled={!effect.on}
                        aria-label={`${label} strength`}
                        onChange={(event) => updateEffect(key, { strength: Number(event.target.value) })}
                      />
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
          </>
        </div>
        <div hidden={tab !== 'replay'}>
          <>
          <div className="hud-settings-section">
            <h3 className="hud-settings-section-title">Replay</h3>
            <div className="hud-settings-row">
              <span className="hud-settings-label">Record time</span>
              <div className="hud-settings-actions">
                <input
                  type="number"
                  min={RECORD_MINUTES_MIN}
                  max={RECORD_MINUTES_MAX}
                  step="1"
                  value={recordDraft}
                  aria-label="Record time in minutes"
                  onChange={(event) => {
                    recordDraftRef.current = event.target.value
                    setRecordDraft(event.target.value)
                  }}
                  onBlur={commitRecordMinutes}
                  onKeyDown={(event) => {
                    if (event.key !== 'Enter') return
                    event.preventDefault()
                    commitRecordMinutes()
                  }}
                />
                <span className="hud-settings-value mono">min</span>
              </div>
            </div>
            <p className="hud-settings-hint">Replay keeps this many minutes, starting at the first conversation.</p>
          </div>
          </>
        </div>
        <div hidden={tab !== 'sound'}>
          <>
          <div className="hud-settings-section">
            <h3 className="hud-settings-section-title">Sound</h3>
            <div className="hud-settings-effects">
              <div className="hud-settings-effect">
                <div className="hud-settings-row">
                  <span className="hud-settings-label">Beeps</span>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={soundState.on}
                    aria-label="Beeps"
                    className={`hud-settings-switch ${soundState.on ? 'is-on' : ''}`}
                    onClick={() => updateSound({ on: !soundState.on })}
                  >
                    {soundState.on ? 'On' : 'Off'}
                  </button>
                </div>
                <div className="hud-settings-control hud-settings-slider">
                  <input
                    type="range"
                    min="0"
                    max="100"
                    step="1"
                    value={Math.round(soundState.volume * 100)}
                    aria-label="Beep volume"
                    onChange={(event) => {
                      const percent = Math.min(100, Math.max(0, Number(event.target.value) || 0))
                      updateSound({ volume: percent / 100 })
                    }}
                  />
                  <span className="hud-settings-value mono">{Math.round(soundState.volume * 100)}%</span>
                </div>
                <p className="hud-settings-hint">A short tone when an agent reads, writes, makes or deletes a file.</p>
              </div>
              <div className="hud-settings-effect">
                <div className="hud-settings-row">
                  <span className="hud-settings-label">Dance</span>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={soundState.dance}
                    aria-label="Dance"
                    className={`hud-settings-switch ${soundState.dance ? 'is-on' : ''}`}
                    onClick={() => updateSound({ dance: !soundState.dance })}
                  >
                    {soundState.dance ? 'On' : 'Off'}
                  </button>
                </div>
              </div>
              <div className="hud-settings-effect">
                <div className="hud-settings-row">
                  <span className="hud-settings-label">Pulse</span>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={soundState.pulse}
                    aria-label="Pulse"
                    className={`hud-settings-switch ${soundState.pulse ? 'is-on' : ''}`}
                    onClick={() => updateSound({ pulse: !soundState.pulse })}
                  >
                    {soundState.pulse ? 'On' : 'Off'}
                  </button>
                </div>
              </div>
              <MusicPlayer />
            </div>
          </div>
          </>
        </div>
        <div hidden={tab !== 'subagents'}><AgentDepthSettings client={client} /></div>
        <div hidden={tab !== 'mcp'}><McpSettings client={client} /></div>
        <div hidden={tab !== 'search'}><SearchSettings client={client} /></div>
        <div hidden={tab !== 'storage'}><StorageSettings client={client} /></div>
      </div>
    </section>
  )
}
