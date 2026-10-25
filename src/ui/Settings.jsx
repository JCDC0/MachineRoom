import { useState } from 'react'
import MusicPlayer from './MusicPlayer.jsx'
import { store } from '../storage.js'
import { effectSettings, loadSoundSettings, saveSoundSettings } from './settings.js'
import { sound } from './sound.js'

export const EFFECTS = [
  { key: 'fishEye', label: 'Fish eye', costly: false },
  { key: 'aberration', label: 'Chromatic aberration', costly: false },
  { key: 'vignette', label: 'Vignette', costly: false },
  { key: 'grain', label: 'Grain', costly: false },
  { key: 'dust', label: 'Fine dust', costly: false },
]

export default function Settings({ effects, onChange, onClose }) {
  const current = effectSettings(effects)
  const [soundState, setSoundState] = useState(() => loadSoundSettings(store()))

  function updateSound(patch) {
    const next = saveSoundSettings(store(), patch)
    setSoundState(next)
    sound.setSettings(next)
  }

  function updateDepth(depth) {
    onChange?.({ ...current, alwaysDepth: depth })
  }

  function updateEffect(key, patch) {
    const prev = current[key] ?? { on: false, strength: 0.2 }
    onChange?.({
      ...current,
      [key]: { ...prev, ...patch },
    })
  }

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
                        className={`hud-settings-switch ${effect.on ? 'is-on' : ''}`}
                        onClick={() => updateEffect(key, { on: !effect.on })}
                      >
                        {effect.on ? 'On' : 'Off'}
                      </button>
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
          <h3 className="hud-settings-section-title">Sound</h3>
          <div className="hud-settings-effects">
            <div className="hud-settings-effect">
              <div className="hud-settings-row">
                <span className="hud-settings-label">Beeps</span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={soundState.on}
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
      </div>
    </section>
  )
}
