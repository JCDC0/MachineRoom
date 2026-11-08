import { useEffect, useState, useSyncExternalStore } from 'react'
import { store } from '../storage.js'
import { loadSoundSettings, saveSoundSettings } from './settings.js'
import {
  ALL_CHOICE,
  LOOSE_CHOICE,
  changeMusicTrack,
  chooseMusicPlaylist,
  cycleMusicLoop,
  formatTrackTime,
  musicDuration,
  musicPosition,
  musicQueueSnapshot,
  openMusicFolder,
  playMusicAt,
  refreshMusicList,
  seekMusic,
  startMusicQueue,
  subscribeMusicQueue,
  toggleMusicPlay,
  toggleMusicShuffle,
} from './musicQueue.js'
import { sound } from './sound.js'

const PLAYLIST_PREFIX = 'playlist:'

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

function SpeakerIcon() {
  return (
    <Icon>
      <path d="M3 6h2l3-2.5v9L5 10H3Z" />
      <path d="M10.5 5.5a4 4 0 0 1 0 5" />
      <path d="M12.5 3.5a7 7 0 0 1 0 9" />
    </Icon>
  )
}

function MutedSpeakerIcon() {
  return (
    <Icon>
      <path d="M3 6h2l3-2.5v9L5 10H3Z" />
      <path d="M10.5 6l4 4" />
      <path d="M14.5 6l-4 4" />
    </Icon>
  )
}

export default function MusicPlayer() {
  const media = useSyncExternalStore(subscribeMusicQueue, musicQueueSnapshot, musicQueueSnapshot)
  const [volume, setVolume] = useState(() => loadSoundSettings(store()).musicVolume)
  const [muted, setMuted] = useState(() => loadSoundSettings(store()).musicMuted)
  const [position, setPosition] = useState(0)
  const [duration, setDuration] = useState(0)
  const queue = media.queue
  const index = media.index
  const current = queue[index] ?? null

  useEffect(() => {
    startMusicQueue()
  }, [])

  useEffect(() => {
    sound.setMusicVolume(volume)
    sound.setMusicMuted(muted)
  }, [volume, muted])

  useEffect(() => {
    if (!current) {
      setPosition(0)
      setDuration(0)
      return undefined
    }
    function readTime() {
      setPosition(musicPosition())
      setDuration(musicDuration())
    }
    readTime()
    const timer = setInterval(readTime, 250)
    return () => clearInterval(timer)
  }, [current, media.playing])

  function changeVolume(value) {
    const next = Math.min(1, Math.max(0, Number(value)))
    if (!Number.isFinite(next)) return
    setVolume(next)
    if (muted) {
      setMuted(false)
      saveSoundSettings(store(), { musicVolume: next, musicMuted: false })
      return
    }
    saveSoundSettings(store(), { musicVolume: next })
  }

  function toggleMute() {
    const next = !muted
    setMuted(next)
    saveSoundSettings(store(), { musicMuted: next })
  }

  function changePosition(value) {
    const next = Math.max(0, Math.min(duration > 0 ? duration : Number.MAX_SAFE_INTEGER, Number(value)))
    if (!Number.isFinite(next)) return
    setPosition(next)
    seekMusic(next)
  }

  const loopLabel = `Loop ${media.loop}`
  const elapsed = duration > 0 ? Math.min(position, duration) : Math.max(0, position)
  const shownPosition = duration > 0 ? elapsed : 0
  const muteLabel = muted ? 'Unmute music' : 'Mute music'

  return (
    <div className="hud-sound-player">
      <div className="hud-sound-row">
        <span className="hud-settings-label">Music</span>
        <span className="hud-settings-value mono">{current?.name || (media.loading ? 'Loading' : 'Off')}</span>
      </div>
      <div className="hud-sound-row">
        <label className="hud-settings-label" htmlFor="music-playlist">Playlist</label>
        <select
          id="music-playlist"
          className="hud-sound-select"
          value={media.shownChoice}
          onChange={(event) => chooseMusicPlaylist(event.target.value)}
        >
          <option value={ALL_CHOICE}>All</option>
          {media.list.playlists.map((playlist) => (
            <option key={playlist.name} value={`${PLAYLIST_PREFIX}${playlist.name}`}>{playlist.name}</option>
          ))}
          {media.list.tracks.length > 0 && <option value={LOOSE_CHOICE}>Loose tracks</option>}
        </select>
      </div>
      {queue.length > 0 && (
        <ul className="hud-sound-tracks">
          {queue.map((track, at) => (
            <li key={`${track.playlist}\u0000${track.name}\u0000${at}`}>
              <button
                type="button"
                className={`hud-sound-track ${at === index ? 'is-current' : ''}`}
                onClick={() => playMusicAt(at)}
                aria-label={`Play ${track.name}`}
                title={`Play ${track.name}`}
              >
                {track.name}
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="hud-sound-time">
        <span className="hud-sound-time-value mono">{formatTrackTime(elapsed)}</span>
        <input
          type="range"
          min="0"
          max={duration > 0 ? duration : 0}
          step="0.1"
          value={shownPosition}
          aria-label="Track position"
          disabled={!current || duration <= 0}
          onChange={(event) => changePosition(event.target.value)}
        />
        <span className="hud-sound-time-value mono">{formatTrackTime(duration)}</span>
      </div>
      <div className="hud-sound-controls">
        <button
          type="button"
          className="hud-sound-button"
          onClick={() => changeMusicTrack(-1)}
          disabled={queue.length === 0}
          aria-label="Previous track"
          title="Previous track"
        >
          <PreviousIcon />
        </button>
        <button
          type="button"
          className="hud-sound-button"
          onClick={toggleMusicPlay}
          disabled={queue.length === 0}
          aria-label={media.playing ? 'Pause' : 'Play'}
          title={media.playing ? 'Pause' : 'Play'}
        >
          {media.playing ? <PauseIcon /> : <PlayIcon />}
        </button>
        <button
          type="button"
          className="hud-sound-button"
          onClick={() => changeMusicTrack(1)}
          disabled={queue.length === 0}
          aria-label="Next track"
          title="Next track"
        >
          <NextIcon />
        </button>
        <button
          type="button"
          className={`hud-sound-button ${media.shuffle ? 'is-on' : ''}`}
          onClick={toggleMusicShuffle}
          aria-label="Shuffle"
          aria-pressed={media.shuffle}
          title={media.shuffle ? 'Shuffle on' : 'Shuffle off'}
        >
          <ShuffleIcon />
        </button>
        <button
          type="button"
          className={`hud-sound-button ${media.loop === 'off' ? '' : 'is-on'}`}
          onClick={cycleMusicLoop}
          aria-label={loopLabel}
          aria-pressed={media.loop !== 'off'}
          title={loopLabel}
        >
          <LoopIcon mode={media.loop} />
        </button>
        <button
          type="button"
          className="hud-sound-button"
          onClick={openMusicFolder}
          aria-label="Open folder"
          title="Open folder"
        >
          <FolderIcon />
        </button>
        <button
          type="button"
          className="hud-sound-button"
          onClick={refreshMusicList}
          disabled={media.loading || media.refreshing}
          aria-label="Refresh"
          title="Refresh"
        >
          <RefreshIcon />
        </button>
      </div>
      <div className="hud-sound-volume">
        <span className="hud-settings-label">Volume</span>
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
        <button
          type="button"
          className="hud-sound-button"
          onClick={toggleMute}
          aria-label={muteLabel}
          aria-pressed={muted}
          title={muteLabel}
        >
          {muted ? <MutedSpeakerIcon /> : <SpeakerIcon />}
        </button>
      </div>
      <p className="hud-sound-hint">Put songs or folders of songs in the music folder, then press Refresh.</p>
      {media.status && <p className="hud-sound-status mono" role="status">{media.status}</p>}
      {!media.loading && !media.failed && queue.length === 0 && media.list.folder && (
        <p className="hud-sound-empty mono">{media.list.folder}</p>
      )}
      {media.failed && <p className="hud-sound-empty">Could not read the music folder.</p>}
      {media.playError && <p className="hud-sound-empty">{media.playError}</p>}
      {media.openError && <p className="hud-sound-empty">{media.openError}</p>}
    </div>
  )
}
