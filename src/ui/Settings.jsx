import { useEffect, useRef, useState } from 'react'
import EndpointsPanel from './EndpointsPanel.jsx'
import McpSettings from './McpSettings.jsx'
import MusicPlayer from './MusicPlayer.jsx'
import SearchSettings from './SearchSettings.jsx'
import { store } from '../storage.js'
import { RECORD_MINUTES_MAX, RECORD_MINUTES_MIN, clampRecordMinutes } from '../model/recordLimits.js'
import { effectSettings, clampFileLimit, FILE_LIMIT_MAX, FILE_LIMIT_MIN, loadSettings, loadSoundSettings, saveSettings, saveSoundSettings } from './settings.js'
import { sound } from './sound.js'

export const EFFECTS = [
  { key: 'aberration', label: 'Chromatic aberration', costly: false },
  { key: 'vignette', label: 'Vignette', costly: false },
  { key: 'grain', label: 'Grain', costly: false },
  { key: 'dust', label: 'Fine dust', costly: false },
]

export default function Settings({ open = true, effects, onChange, onSettingsChange, onClose, client = null, focusDirectApi = 0 }) {
  const current = effectSettings(effects)
  const [soundState, setSoundState] = useState(() => loadSoundSettings(store()))
  const [recordDraft, setRecordDraft] = useState(() => String(loadSettings(store()).recordMinutes))
  const recordDraftRef = useRef(recordDraft)
  const seenDirectApi = useRef(0)

  useEffect(() => {
    const nonce = Number(focusDirectApi) || 0
    if (!open || nonce === 0 || seenDirectApi.current === nonce) return
    seenDirectApi.current = nonce
    const target = typeof document !== 'undefined' ? document.getElementById('settings-direct-api') : null
    if (target && typeof target.scrollIntoView === 'function') {
      target.scrollIntoView({ block: 'start' })
    }
  }, [open, focusDirectApi])

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
      saveSettings(store(), { recordMinutes: minutes })
    }
  }, [])

  if (!open) return null

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

      <div className="hud-settings-body">
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
              <div className="hud-settings-control">
                <input
                  type="number"
                  min="0"
                  max="100"
                  step="1"
                  value={Math.round(soundState.volume * 100)}
                  aria-label="Beep volume percent"
                  onChange={(event) => {
                    const percent = Math.min(100, Math.max(0, Number(event.target.value) || 0))
                    updateSound({ volume: percent / 100 })
                  }}
                />
                <span className="hud-settings-value mono">{Math.round(soundState.volume * 100)}%</span>
              </div>
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
            <MusicPlayer />
          </div>
        </div>

        <EndpointsPanel client={client} />
        <McpSettings client={client} />
        <SearchSettings client={client} />
      </div>
    </section>
  )
}
