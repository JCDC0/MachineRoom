import { useEffect, useRef, useState } from 'react'
import { readStorage, store, writeStorage } from '../storage.js'
import { loadSettings, loadSoundSettings, saveSoundSettings } from './settings.js'
import { sound } from './sound.js'

const SETTINGS_KEY = 'machineroom.settings'

export const ALL_CHOICE = 'all'
export const LOOSE_CHOICE = 'loose'
export const LOOP_MODES = ['off', 'all', 'one']
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

export function readMusicSettings(storage = store()) {
  try {
    const raw = readStorage(SETTINGS_KEY, storage)
    const parsed = raw ? JSON.parse(raw) : null
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { playlist: ALL_CHOICE, shuffle: false, loop: 'off' }
    }
    const music = parsed.music && typeof parsed.music === 'object' && !Array.isArray(parsed.music) ? parsed.music : {}
    return {
      playlist: typeof music.playlist === 'string' && music.playlist ? music.playlist : ALL_CHOICE,
      shuffle: music.shuffle === true,
      loop: LOOP_MODES.includes(music.loop) ? music.loop : 'off',
    }
  } catch {
    return { playlist: ALL_CHOICE, shuffle: false, loop: 'off' }
  }
}

export function saveMusicSettings(next, storage = store()) {
  if (!next || typeof next !== 'object') return false
  let parsed = null
  try {
    const raw = readStorage(SETTINGS_KEY, storage)
    parsed = raw ? JSON.parse(raw) : null
  } catch {
    parsed = null
  }
  const current = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
  const music = current.music && typeof current.music === 'object' && !Array.isArray(current.music) ? current.music : {}
  const merged = { ...music }
  if (typeof next.playlist === 'string' && next.playlist) merged.playlist = next.playlist
  if (typeof next.shuffle === 'boolean') merged.shuffle = next.shuffle
  if (LOOP_MODES.includes(next.loop)) merged.loop = next.loop
  return writeStorage(SETTINGS_KEY, JSON.stringify({ ...current, music: merged }), storage)
}

export function readMusicPlaylist(storage = store()) {
  return readMusicSettings(storage).playlist
}

export function saveMusicPlaylist(choice, storage = store()) {
  return saveMusicSettings({ playlist: choice }, storage)
}

export function nextLoop(loop) {
  const at = LOOP_MODES.indexOf(loop)
  return LOOP_MODES[(at + 1) % LOOP_MODES.length] ?? 'off'
}

export function shuffleOrder(length, random = Math.random) {
  const order = Array.from({ length: Math.max(0, Math.floor(Number(length) || 0)) }, (_, index) => index)
  for (let at = order.length - 1; at > 0; at -= 1) {
    const pick = Math.min(at, Math.max(0, Math.floor(random() * (at + 1))))
    const held = order[at]
    order[at] = order[pick]
    order[pick] = held
  }
  return order
}

export function shuffleOrderFrom(start, length, random = Math.random) {
  const size = Math.max(0, Math.floor(Number(length) || 0))
  if (size === 0) return []
  const first = Math.min(size - 1, Math.max(0, Math.floor(Number(start) || 0)))
  return [first, ...shuffleOrder(size, random).filter((index) => index !== first)]
}

function trackCount(list) {
  const playlists = Array.isArray(list.playlists) ? list.playlists : []
  return (Array.isArray(list.tracks) ? list.tracks.length : 0) + playlists.reduce(
    (sum, playlist) => sum + (Array.isArray(playlist?.tracks) ? playlist.tracks.length : 0),
    0
  )
}

function Icon({ children }) {
  return (
    <svg
      className="hud-sound-icon"
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  )
}

function PreviousIcon() {
  return <Icon><path d="M4 3v10" /><path d="M12 3 6 8l6 5Z" /></Icon>
}

function PlayIcon() {
  return <Icon><path d="M5 3l8 5-8 5Z" /></Icon>
}

function PauseIcon() {
  return <Icon><path d="M6 3v10" /><path d="M10 3v10" /></Icon>
}

function NextIcon() {
  return <Icon><path d="M12 3v10" /><path d="M4 3l6 5-6 5Z" /></Icon>
}

function ShuffleIcon() {
  return (
    <Icon>
      <path d="M3 4h2l6 8h2" />
      <path d="M3 12h2l6-8h2" />
      <path d="M11 2l2 2-2 2" />
      <path d="M11 10l2 2-2 2" />
    </Icon>
  )
}

function LoopIcon({ mode }) {
  return (
    <Icon>
      <path d="M4 6V5a2 2 0 0 1 2-2h6" />
      <path d="M10 1l2 2-2 2" />
      <path d="M12 10v1a2 2 0 0 1-2 2H4" />
      <path d="M6 15l-2-2 2-2" />
      {mode === 'one' && (
        <text x="8" y="10" textAnchor="middle" fontSize="6" fontFamily="Space Mono, monospace" fill="currentColor" stroke="none">1</text>
      )}
    </Icon>
  )
}

function FolderIcon() {
  return (
    <Icon>
      <path d="M2 5a1 1 0 0 1 1-1h3l1.5 2H13a1 1 0 0 1 1 1v5a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1Z" />
    </Icon>
  )
}

function RefreshIcon() {
  return (
    <Icon>
      <path d="M13 8a5 5 0 1 1-1.5-3.5" />
      <path d="M13 2v3h-3" />
    </Icon>
  )
}

export default function MusicPlayer() {
  const [list, setList] = useState({ base: '', folder: '', tracks: [], playlists: [] })
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [failed, setFailed] = useState(false)
  const [index, setIndex] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [playError, setPlayError] = useState('')
  const [openError, setOpenError] = useState('')
  const [status, setStatus] = useState('')
  const [shuffle, setShuffle] = useState(() => readMusicSettings(store()).shuffle)
  const [loop, setLoop] = useState(() => readMusicSettings(store()).loop)
  const [order, setOrder] = useState([])
  const [choice, setChoice] = useState(() => readMusicSettings(store()).playlist)
  const [volume, setVolume] = useState(() => loadSoundSettings(store()).musicVolume)
  const statusTimer = useRef(null)

  const shownChoice = playlistChoice(choice, list.playlists, list.tracks)
  const queue = playlistQueue(list.playlists, list.tracks, shownChoice)
  const current = queue[index] ?? null
  const queueKey = queue.map((track) => `${track.playlist}\u0000${track.name}`).join('\u0000')

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
      applyList(found)
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
    if (statusTimer.current) clearTimeout(statusTimer.current)
    return () => {
      if (statusTimer.current) clearTimeout(statusTimer.current)
    }
  }, [])

  useEffect(() => {
    if (!shuffle) {
      setOrder([])
      return
    }
    setOrder(shuffleOrderFrom(index, queue.length))
  }, [shuffle, queueKey])

  useEffect(() => {
    return sound.onMusicEnded(() => {
      playNext()
    })
  })

  function applyList(found) {
    setList(found)
    const saved = readMusicSettings(store())
    const next = playlistChoice(saved.playlist, found.playlists, found.tracks)
    setChoice(next)
    if (next !== saved.playlist) saveMusicSettings({ playlist: next }, store())
    const nextQueue = playlistQueue(found.playlists, found.tracks, next)
    const playingUrl = sound.musicTrack()
    const at = playingUrl === '' ? -1 : nextQueue.findIndex((track) => musicTrackUrl(found.base, track) === playingUrl)
    if (at >= 0) {
      setIndex(at)
      setPlaying(sound.musicPlaying())
      return
    }
    setIndex(0)
    setPlaying(false)
    if (playingUrl !== '') sound.pauseMusic()
  }

  function flashStatus(text) {
    setStatus(text)
    if (statusTimer.current) clearTimeout(statusTimer.current)
    statusTimer.current = setTimeout(() => setStatus(''), 4000)
  }

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

  function stopPlayback() {
    sound.pauseMusic()
    setPlaying(false)
    setPlayError('')
  }

  function orderPosition() {
    const at = order.indexOf(index)
    return at < 0 ? 0 : at
  }

  function changeTrack(step) {
    if (queue.length === 0) return
    const shuffled = shuffle && order.length === queue.length
    const next = shuffled
      ? order[(orderPosition() + step + queue.length) % queue.length]
      : (index + step + queue.length) % queue.length
    if (next < 0) return
    setIndex(next)
    setPlayError('')
    setPlaying(true)
    startTrack(queue[next])
  }

  function playNext() {
    if (queue.length === 0) return
    if (loop === 'one') {
      setPlaying(true)
      setPlayError('')
      startTrack(current ?? queue[0])
      return
    }
    let next = -1
    if (shuffle && order.length === queue.length) {
      const at = orderPosition()
      next = at + 1 < order.length ? order[at + 1] : loop === 'all' ? order[0] : -1
    } else if (index + 1 < queue.length) {
      next = index + 1
    } else if (loop === 'all') {
      next = 0
    }
    if (next < 0) {
      stopPlayback()
      return
    }
    setIndex(next)
    setPlayError('')
    setPlaying(true)
    startTrack(queue[next])
  }

  function playAt(at) {
    const track = queue[at]
    if (!track) return
    setIndex(at)
    setPlayError('')
    setPlaying(true)
    startTrack(track)
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
    saveMusicSettings({ playlist: next }, store())
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

  function toggleShuffle() {
    const next = !shuffle
    setShuffle(next)
    saveMusicSettings({ shuffle: next }, store())
  }

  function cycleLoop() {
    const next = nextLoop(loop)
    setLoop(next)
    saveMusicSettings({ loop: next }, store())
  }

  async function refresh() {
    if (refreshing) return
    setRefreshing(true)
    const found = await readMusicList()
    setRefreshing(false)
    if (!found) {
      setFailed(true)
      return
    }
    setFailed(false)
    applyList(found)
    flashStatus(`${trackCount(found)} tracks in ${found.playlists.length} playlists.`)
  }

  async function openFolder() {
    setOpenError('')
    const base = list.base || musicBases()[0] || ''
    try {
      const response = await fetch(`${base}/api/music/open`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ confirmed: true }),
      })
      if (response.status === 204) return
      let sentence = 'Could not open the music folder.'
      try {
        const body = await response.json()
        if (body && typeof body.error === 'string' && body.error) sentence = body.error
      } catch {}
      setOpenError(sentence)
    } catch {
      setOpenError('Could not open the music folder.')
    }
  }

  function changeVolume(value) {
    const next = Math.min(1, Math.max(0, Number(value)))
    if (!Number.isFinite(next)) return
    setVolume(next)
    sound.setMusicVolume(next)
    saveSoundSettings(store(), { musicVolume: next })
  }

  const loopLabel = `Loop ${loop}`

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
        <button
          type="button"
          className="hud-sound-button"
          onClick={() => changeTrack(-1)}
          disabled={queue.length === 0}
          aria-label="Previous track"
          title="Previous track"
        >
          <PreviousIcon />
        </button>
        <button
          type="button"
          className="hud-sound-button"
          onClick={togglePlay}
          disabled={queue.length === 0}
          aria-label={playing ? 'Pause' : 'Play'}
          title={playing ? 'Pause' : 'Play'}
        >
          {playing ? <PauseIcon /> : <PlayIcon />}
        </button>
        <button
          type="button"
          className="hud-sound-button"
          onClick={() => changeTrack(1)}
          disabled={queue.length === 0}
          aria-label="Next track"
          title="Next track"
        >
          <NextIcon />
        </button>
        <button
          type="button"
          className={`hud-sound-button ${shuffle ? 'is-on' : ''}`}
          onClick={toggleShuffle}
          aria-label="Shuffle"
          aria-pressed={shuffle}
          title={shuffle ? 'Shuffle on' : 'Shuffle off'}
        >
          <ShuffleIcon />
        </button>
        <button
          type="button"
          className={`hud-sound-button ${loop === 'off' ? '' : 'is-on'}`}
          onClick={cycleLoop}
          aria-label={loopLabel}
          aria-pressed={loop !== 'off'}
          title={loopLabel}
        >
          <LoopIcon mode={loop} />
        </button>
        <button
          type="button"
          className="hud-sound-button"
          onClick={openFolder}
          aria-label="Open folder"
          title="Open folder"
        >
          <FolderIcon />
        </button>
        <button
          type="button"
          className="hud-sound-button"
          onClick={refresh}
          disabled={loading || refreshing}
          aria-label="Refresh"
          title="Refresh"
        >
          <RefreshIcon />
        </button>
      </div>
      <p className="hud-sound-hint">Put songs or folders of songs in the music folder, then press Refresh.</p>
      {status && <p className="hud-sound-status mono" role="status">{status}</p>}
      {!loading && !failed && queue.length === 0 && list.folder && (
        <p className="hud-sound-empty mono">{list.folder}</p>
      )}
      {queue.length > 0 && (
        <ul className="hud-sound-tracks">
          {queue.map((track, at) => (
            <li key={`${track.playlist}\u0000${track.name}\u0000${at}`}>
              <button
                type="button"
                className={`hud-sound-track ${at === index ? 'is-current' : ''}`}
                onClick={() => playAt(at)}
                aria-label={`Play ${track.name}`}
                title={`Play ${track.name}`}
              >
                {track.name}
              </button>
            </li>
          ))}
        </ul>
      )}
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
      {failed && <p className="hud-sound-empty">Could not read the music folder.</p>}
      {playError && <p className="hud-sound-empty">{playError}</p>}
      {openError && <p className="hud-sound-empty">{openError}</p>}
    </div>
  )
}
