import { readStorage, store, writeStorage } from '../storage.js'
import { loadSettings } from './settings.js'
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

export function formatTrackTime(value) {
  const seconds = Number(value)
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00'
  const whole = Math.floor(seconds)
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`
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

const EMPTY_LIST = Object.freeze({ base: '', folder: '', tracks: [], playlists: [] })

const EMPTY_STATE = Object.freeze({
  list: EMPTY_LIST,
  loading: true,
  refreshing: false,
  failed: false,
  queue: [],
  choice: ALL_CHOICE,
  shownChoice: ALL_CHOICE,
  index: 0,
  playing: false,
  playError: '',
  openError: '',
  status: '',
  shuffle: false,
  loop: 'off',
  order: [],
})

let state = EMPTY_STATE
let started = false
let controller = null
let statusTimer = null
let stopEnded = null
let playToken = 0
const listeners = new Set()

export function musicQueueSnapshot() {
  return state
}

export function subscribeMusicQueue(listener) {
  if (typeof listener !== 'function') return () => {}
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

function publish(patch) {
  state = { ...state, ...patch }
  for (const listener of [...listeners]) listener()
}

function flashStatus(text) {
  if (statusTimer) clearTimeout(statusTimer)
  publish({ status: text })
  statusTimer = setTimeout(() => {
    statusTimer = null
    publish({ status: '' })
  }, 4000)
}

function applyList(found) {
  const saved = readMusicSettings(store())
  const choice = playlistChoice(saved.playlist, found.playlists, found.tracks)
  if (choice !== saved.playlist) saveMusicSettings({ playlist: choice }, store())
  const queue = playlistQueue(found.playlists, found.tracks, choice)
  const playingUrl = sound.musicTrack()
  const at = playingUrl === '' ? -1 : queue.findIndex((track) => musicTrackUrl(found.base, track) === playingUrl)
  if (at < 0 && playingUrl !== '') sound.pauseMusic()
  const index = at >= 0 ? at : 0
  publish({
    list: found,
    choice,
    shownChoice: choice,
    queue,
    index,
    playing: at >= 0 ? sound.musicPlaying() : false,
    playError: '',
    order: state.shuffle ? shuffleOrderFrom(index, queue.length) : [],
  })
}

async function loadList() {
  const active = new AbortController()
  controller = active
  const found = await readMusicList(active.signal)
  if (controller !== active) return
  controller = null
  if (!found) {
    publish({ loading: false, failed: true })
    return
  }
  publish({ loading: false, failed: false })
  applyList(found)
}

function playTrack(at) {
  const track = state.queue[at]
  if (!track) return
  const token = (playToken += 1)
  sound.arm()
  publish({ index: at, playing: true, playError: '' })
  sound.playMusic(musicTrackUrl(state.list.base, track)).then((ok) => {
    if (token !== playToken) return
    if (ok) return
    publish({ playing: false, playError: `Could not play ${track.name}.` })
  })
}

function stopPlayback() {
  playToken += 1
  sound.pauseMusic()
  publish({ playing: false, playError: '' })
}

function orderPosition() {
  const at = state.order.indexOf(state.index)
  return at < 0 ? 0 : at
}

function playNext() {
  const { queue, shuffle, order, index, loop } = state
  if (queue.length === 0) return
  if (loop === 'one') {
    playTrack(index >= 0 && index < queue.length ? index : 0)
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
  playTrack(next)
}

function onTrackEnded() {
  if (!state.playing) return
  playNext()
}

export function startMusicQueue() {
  if (started) return
  started = true
  const saved = readMusicSettings(store())
  stopEnded = sound.onMusicEnded(onTrackEnded)
  publish({ shuffle: saved.shuffle, loop: saved.loop, choice: saved.playlist })
  void loadList()
}

export function resetMusicQueue() {
  if (stopEnded) stopEnded()
  stopEnded = null
  if (controller) controller.abort()
  controller = null
  if (statusTimer) clearTimeout(statusTimer)
  statusTimer = null
  started = false
  playToken += 1
  state = EMPTY_STATE
  for (const listener of [...listeners]) listener()
}

export function toggleMusicPlay() {
  if (state.queue.length === 0) return
  if (state.playing) {
    stopPlayback()
    return
  }
  playTrack(state.index >= 0 && state.index < state.queue.length ? state.index : 0)
}

export function changeMusicTrack(step) {
  const { queue, shuffle, order, index } = state
  if (queue.length === 0) return
  const shuffled = shuffle && order.length === queue.length
  const next = shuffled
    ? order[(orderPosition() + step + queue.length) % queue.length]
    : (index + step + queue.length) % queue.length
  if (!Number.isInteger(next) || next < 0) return
  playTrack(next)
}

export function playMusicAt(at) {
  if (!state.queue[at]) return
  playTrack(at)
}

function onLoadedTrack() {
  const track = state.queue[state.index]
  const url = track ? musicTrackUrl(state.list.base, track) : ''
  return url !== '' && sound.musicTrack() === url
}

export function musicPosition() {
  return onLoadedTrack() ? sound.musicPosition() : 0
}

export function musicDuration() {
  return onLoadedTrack() ? sound.musicDuration() : 0
}

export function seekMusic(value) {
  return sound.seekMusic(value)
}

export function chooseMusicPlaylist(raw) {
  const choice = playlistChoice(raw, state.list.playlists, state.list.tracks)
  const queue = playlistQueue(state.list.playlists, state.list.tracks, choice)
  const wasPlaying = state.playing
  saveMusicSettings({ playlist: choice }, store())
  publish({
    choice,
    shownChoice: choice,
    queue,
    index: 0,
    playError: '',
    order: state.shuffle ? shuffleOrderFrom(0, queue.length) : [],
  })
  if (!wasPlaying) return
  if (queue.length === 0) {
    stopPlayback()
    return
  }
  playTrack(0)
}

export function toggleMusicShuffle() {
  const shuffle = !state.shuffle
  saveMusicSettings({ shuffle }, store())
  publish({ shuffle, order: shuffle ? shuffleOrderFrom(state.index, state.queue.length) : [] })
}

export function cycleMusicLoop() {
  const loop = nextLoop(state.loop)
  saveMusicSettings({ loop }, store())
  publish({ loop })
}

export async function refreshMusicList() {
  if (state.refreshing) return
  publish({ refreshing: true })
  const found = await readMusicList()
  publish({ refreshing: false })
  if (!found) {
    publish({ failed: true })
    return
  }
  publish({ failed: false })
  applyList(found)
  const tracks = trackCount(found)
  const lists = found.playlists.length
  flashStatus(`${tracks} ${tracks === 1 ? 'track' : 'tracks'} in ${lists} ${lists === 1 ? 'playlist' : 'playlists'}.`)
}

export async function openMusicFolder() {
  publish({ openError: '' })
  const base = state.list.base || musicBases()[0] || ''
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
    publish({ openError: sentence })
  } catch {
    publish({ openError: 'Could not open the music folder.' })
  }
}
