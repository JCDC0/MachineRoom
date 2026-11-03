import { useEffect, useState } from 'react'
import { readStorage, store, writeStorage } from '../storage.js'
import { loadSettings, loadSoundSettings, saveSoundSettings } from './settings.js'
import { sound } from './sound.js'

const SETTINGS_KEY = 'machineroom.settings'

export const ALL_CHOICE = 'all'
export const LOOSE_CHOICE = 'loose'
const PLAYLIST_PREFIX = 'playlist:'

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
      const playlists = Array.isArray(body.playlists)
        ? body.playlists
            .filter((playlist) => playlist && typeof playlist.name === 'string' && playlist.name && Array.isArray(playlist.tracks))
            .map((playlist) => ({
              name: playlist.name,
              tracks: playlist.tracks.filter((name) => typeof name === 'string'),
            }))
            .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
        : []
      return {
        base,
        folder: typeof body.folder === 'string' ? body.folder : '',
        tracks: body.tracks.filter((name) => typeof name === 'string'),
        playlists,
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

export function playlistChoice(raw, playlists = [], tracks = []) {
  const lists = Array.isArray(playlists) ? playlists : []
  const loose = Array.isArray(tracks) ? tracks : []
  if (raw === LOOSE_CHOICE) return loose.length > 0 ? LOOSE_CHOICE : ALL_CHOICE
  if (typeof raw === 'string' && raw.startsWith(PLAYLIST_PREFIX)) {
    const name = raw.slice(PLAYLIST_PREFIX.length)
    return lists.some((playlist) => playlist && playlist.name === name) ? raw : ALL_CHOICE
  }
  return ALL_CHOICE
}

export function playlistQueue(playlists, tracks, choice = ALL_CHOICE) {
  const lists = Array.isArray(playlists) ? playlists : []
  const loose = Array.isArray(tracks) ? tracks : []
  if (choice === LOOSE_CHOICE) return loose.map((name) => ({ playlist: '', name }))
  if (typeof choice === 'string' && choice.startsWith(PLAYLIST_PREFIX)) {
    const name = choice.slice(PLAYLIST_PREFIX.length)
    const found = lists.find((playlist) => playlist && playlist.name === name)
    return found && Array.isArray(found.tracks)
      ? found.tracks.map((track) => ({ playlist: found.name, name: track }))
      : []
  }
  const all = []
  for (const playlist of lists) {
    const named = Array.isArray(playlist?.tracks) ? playlist.tracks : []
    for (const name of named) all.push({ playlist: playlist.name, name })
  }
  for (const name of loose) all.push({ playlist: '', name })
  return all
}

export function musicTrackUrl(base, track) {
  const name = typeof track?.name === 'string' ? track.name : ''
  const playlist = typeof track?.playlist === 'string' ? track.playlist : ''
  return playlist
    ? `${base}/music/${encodeURIComponent(playlist)}/${encodeURIComponent(name)}`
    : `${base}/music/${encodeURIComponent(name)}`
}

export function readMusicPlaylist(storage = store()) {
  try {
    const raw = readStorage(SETTINGS_KEY, storage)
    const parsed = raw ? JSON.parse(raw) : null
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return ALL_CHOICE
    const music = parsed.music && typeof parsed.music === 'object' && !Array.isArray(parsed.music) ? parsed.music : {}
    return typeof music.playlist === 'string' && music.playlist ? music.playlist : ALL_CHOICE
  } catch {
    return ALL_CHOICE
  }
}

export function saveMusicPlaylist(choice, storage = store()) {
  if (typeof choice !== 'string' || choice === '') return false
  let parsed = null
  try {
    const raw = readStorage(SETTINGS_KEY, storage)
    parsed = raw ? JSON.parse(raw) : null
  } catch {
    parsed = null
  }
  const current = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
  const music = current.music && typeof current.music === 'object' && !Array.isArray(current.music) ? current.music : {}
  return writeStorage(SETTINGS_KEY, JSON.stringify({ ...current, music: { ...music, playlist: choice } }), storage)
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
  const [list, setList] = useState({ base: '', folder: '', tracks: [], playlists: [] })
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)
  const [index, setIndex] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [playError, setPlayError] = useState('')
  const [shuffle, setShuffle] = useState(false)
  const [choice, setChoice] = useState(() => readMusicPlaylist(store()))
  const [volume, setVolume] = useState(() => loadSoundSettings(store()).musicVolume)

  const shownChoice = playlistChoice(choice, list.playlists, list.tracks)
  const queue = playlistQueue(list.playlists, list.tracks, shownChoice)
  const current = queue[index] ?? null

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
      const saved = readMusicPlaylist(store())
      const next = playlistChoice(saved, found.playlists, found.tracks)
      saveMusicPlaylist(next, store())
      setChoice(next)
      const nextQueue = playlistQueue(found.playlists, found.tracks, next)
      const playingUrl = sound.musicTrack()
      const at = playingUrl === '' ? -1 : nextQueue.findIndex((track) => musicTrackUrl(found.base, track) === playingUrl)
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
      changeTrack(1)
    })
  })

  function startTrack(track) {
    if (!track) return
    sound.arm()
    const started = sound.playMusic(musicTrackUrl(list.base, track))
    started.then((ok) => {
      if (ok) return
      setPlaying(false)
      setPlayError(`Could not play ${track.name}.`)
    })
  }

  function changeTrack(step) {
    if (queue.length === 0) return
    const next = step > 0
      ? nextIndex(index, queue.length, shuffle)
      : previousIndex(index, queue.length)
    if (next < 0) return
    setIndex(next)
    setPlayError('')
    if (playing) startTrack(queue[next])
  }

  function togglePlay() {
    if (queue.length === 0) return
    if (playing) {
      sound.pauseMusic()
      setPlaying(false)
      setPlayError('')
      return
    }
    setPlayError('')
    setPlaying(true)
    startTrack(current ?? queue[0])
  }

  function choosePlaylist(raw) {
    const next = playlistChoice(raw, list.playlists, list.tracks)
    setChoice(next)
    saveMusicPlaylist(next, store())
    setIndex(0)
    setPlayError('')
    if (!playing) return
    const nextQueue = playlistQueue(list.playlists, list.tracks, next)
    if (nextQueue.length === 0) {
      sound.pauseMusic()
      setPlaying(false)
      return
    }
    startTrack(nextQueue[0])
  }

  function changeVolume(value) {
    const next = Math.min(1, Math.max(0, Number(value)))
    if (!Number.isFinite(next)) return
    setVolume(next)
    sound.setMusicVolume(next)
    saveSoundSettings(store(), { musicVolume: next })
    saveMusicPlaylist(shownChoice, store())
  }

  return (
    <div className="hud-sound-player">
      <div className="hud-sound-row">
        <span className="hud-settings-label">Music</span>
        <span className="hud-settings-value mono">{current?.name || (loading ? 'Loading' : 'Off')}</span>
      </div>
      <div className="hud-sound-row">
        <label className="hud-settings-label" htmlFor="music-playlist">Playlist</label>
        <select
          id="music-playlist"
          className="hud-sound-select"
          value={shownChoice}
          onChange={(event) => choosePlaylist(event.target.value)}
        >
          <option value={ALL_CHOICE}>All</option>
          {list.playlists.map((playlist) => (
            <option key={playlist.name} value={`${PLAYLIST_PREFIX}${playlist.name}`}>{playlist.name}</option>
          ))}
          {list.tracks.length > 0 && <option value={LOOSE_CHOICE}>Loose tracks</option>}
        </select>
      </div>
      <div className="hud-sound-controls">
        <button type="button" className="hud-sound-button" onClick={() => changeTrack(-1)} disabled={queue.length < 2} aria-label="Previous track">
          Previous
        </button>
        <button type="button" className="hud-sound-button is-main" onClick={togglePlay} disabled={queue.length === 0}>
          {playing ? 'Pause' : 'Play'}
        </button>
        <button type="button" className="hud-sound-button" onClick={() => changeTrack(1)} disabled={queue.length < 2} aria-label="Next track">
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
      {!loading && !failed && queue.length === 0 && (
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
