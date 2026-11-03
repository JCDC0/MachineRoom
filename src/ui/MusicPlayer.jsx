import { useEffect, useState } from 'react'
import { store } from '../storage.js'
import { loadSettings, loadSoundSettings, saveSoundSettings } from './settings.js'
import { sound } from './sound.js'

function cleanBase(value) {
  return String(value ?? '').replace(/\/+$/, '')
}

function musicBases() {
  const bases = []
  const saved = loadSettings(store())
  const bridge = saved.source === 'bridge' ? cleanBase(saved.bridge) : ''
  const origin = typeof window === 'undefined' ? '' : window.location.origin
  const dev = typeof window !== 'undefined' && window.location.port === '5173'
  const linked = typeof window === 'undefined' ? '' : cleanBase(new URLSearchParams(window.location.search).get('bridge'))
  if (!dev && origin) bases.push('')
  if (linked) bases.push(linked)
  if (bridge) bases.push(bridge)
  if (!bases.includes('')) bases.push('')
  return [...new Set(bases)]
}

async function readMusicList(signal = null) {
  for (const base of musicBases()) {
    if (signal?.aborted) return null
    const controller = new AbortController()
    const stop = () => controller.abort()
    if (signal) signal.addEventListener('abort', stop)
    const timer = setTimeout(stop, 5000)
    try {
      const response = await fetch(`${base}/api/music`, { signal: controller.signal })
      if (!response.ok) continue
      const body = await response.json()
      if (!body || !Array.isArray(body.tracks)) continue
      return {
        base,
        folder: typeof body.folder === 'string' ? body.folder : '',
        tracks: body.tracks.filter((name) => typeof name === 'string'),
      }
    } catch {
      if (signal?.aborted) return null
    } finally {
      clearTimeout(timer)
      if (signal) signal.removeEventListener('abort', stop)
    }
  }
  return null
}

function trackUrl(base, name) {
  return `${base}/music/${encodeURIComponent(name)}`
}

function nextIndex(index, length, shuffle, random = Math.random) {
  if (length <= 0) return -1
  if (shuffle && length > 1) {
    let pick = index
    while (pick === index) pick = Math.floor(random() * length)
    return Math.min(length - 1, Math.max(0, pick))
  }
  return (index + 1) % length
}

function previousIndex(index, length) {
  if (length <= 0) return -1
  return (index - 1 + length) % length
}

export default function MusicPlayer() {
  const [list, setList] = useState({ base: '', folder: '', tracks: [] })
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)
  const [index, setIndex] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [playError, setPlayError] = useState('')
  const [shuffle, setShuffle] = useState(false)
  const [repeat, setRepeat] = useState(false)
  const [volume, setVolume] = useState(() => loadSoundSettings(store()).musicVolume)

  useEffect(() => {
    let active = true
    const controller = new AbortController()
    readMusicList(controller.signal).then((found) => {
      if (!active) return
      setLoading(false)
      if (!found) {
        setFailed(true)
        return
      }
      setList(found)
      const playingUrl = sound.musicTrack()
      const at = playingUrl === '' ? -1 : found.tracks.findIndex((name) => trackUrl(found.base, name) === playingUrl)
      setIndex(at >= 0 ? at : 0)
      setPlaying(at >= 0 && sound.musicPlaying())
    })
    return () => {
      active = false
      controller.abort()
    }
  }, [])

  useEffect(() => {
    sound.setMusicVolume(volume)
  }, [volume])

  useEffect(() => {
    return sound.onMusicEnded(() => {
      if (repeat) {
        changeTrack(1)
        return
      }
      if (index < list.tracks.length - 1) {
        changeTrack(1)
        return
      }
      setPlaying(false)
    })
  })

  function changeTrack(step) {
    if (list.tracks.length === 0) return
    const next = step > 0
      ? nextIndex(index, list.tracks.length, shuffle)
      : previousIndex(index, list.tracks.length)
    if (next < 0) return
    setIndex(next)
    setPlayError('')
    if (playing) {
      sound.arm()
      const started = sound.playMusic(trackUrl(list.base, list.tracks[next]))
      started.then((ok) => {
        if (ok) return
        setPlaying(false)
        setPlayError(`Could not play ${list.tracks[next]}.`)
      })
    }
  }

  function togglePlay() {
    if (list.tracks.length === 0) return
    if (playing) {
      sound.pauseMusic()
      setPlaying(false)
      setPlayError('')
      return
    }
    sound.arm()
    setPlayError('')
    const started = sound.playMusic(trackUrl(list.base, list.tracks[index]))
    setPlaying(true)
    started.then((ok) => {
      if (ok) return
      setPlaying(false)
      setPlayError(`Could not play ${list.tracks[index]}.`)
    })
  }

  function changeVolume(value) {
    const next = Math.min(1, Math.max(0, Number(value)))
    if (!Number.isFinite(next)) return
    setVolume(next)
    sound.setMusicVolume(next)
    saveSoundSettings(store(), { musicVolume: next })
  }

  const current = list.tracks[index] ?? ''

  return (
    <div className="hud-sound-player">
      <div className="hud-sound-row">
        <span className="hud-settings-label">Music</span>
        <span className="hud-settings-value mono">{current || (loading ? 'Loading' : 'Off')}</span>
      </div>
      <div className="hud-sound-controls">
        <button type="button" className="hud-sound-button" onClick={() => changeTrack(-1)} disabled={list.tracks.length < 2} aria-label="Previous track">
          Previous
        </button>
        <button type="button" className="hud-sound-button is-main" onClick={togglePlay} disabled={list.tracks.length === 0}>
          {playing ? 'Pause' : 'Play'}
        </button>
        <button type="button" className="hud-sound-button" onClick={() => changeTrack(1)} disabled={list.tracks.length < 2} aria-label="Next track">
          Next
        </button>
      </div>
      <div className="hud-sound-controls">
        <button
          type="button"
          role="switch"
          aria-checked={shuffle}
          aria-label="Shuffle"
          className={`hud-settings-switch ${shuffle ? 'is-on' : ''}`}
          onClick={() => setShuffle((now) => !now)}
        >
          Shuffle
        </button>
        <button
          type="button"
          role="switch"
          aria-checked={repeat}
          aria-label="Repeat"
          className={`hud-settings-switch ${repeat ? 'is-on' : ''}`}
          onClick={() => setRepeat((now) => !now)}
        >
          Repeat
        </button>
      </div>
      <div className="hud-sound-control">
        <input
          type="range"
          min="0"
          max="1"
          step="0.05"
          value={volume}
          aria-label="Music volume"
          onChange={(event) => changeVolume(event.target.value)}
        />
        <span className="hud-settings-value mono">{Math.round(volume * 100)}%</span>
      </div>
      {!loading && !failed && list.tracks.length === 0 && (
        <div className="hud-sound-empty">
          <p>Put music files in the music folder of MachineRoom.</p>
          {list.folder && <p className="mono">{list.folder}</p>}
        </div>
      )}
      {failed && <p className="hud-sound-empty">Could not read the music folder.</p>}
      {playError && <p className="hud-sound-empty">{playError}</p>}
    </div>
  )
}
