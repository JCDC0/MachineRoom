import { act, createElement } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import MusicPlayer from '../src/ui/MusicPlayer.jsx'
import { sound } from '../src/ui/sound.js'
import { buttonWithText, settle, withDom } from './helpers/uiDom.js'

const originalFetch = globalThis.fetch

const audio = {
  paused: true,
  ended: false,
  volume: 1,
  src: '',
  dataset: {},
  listeners: {},
  addEventListener(type, fn) {
    if (!this.listeners[type]) this.listeners[type] = []
    this.listeners[type].push(fn)
  },
  play() {
    this.paused = false
    return Promise.resolve()
  },
  pause() {
    this.paused = true
  },
}

afterEach(() => {
  globalThis.fetch = originalFetch
  sound.pauseMusic()
})

function installAudio(dom) {
  audio.paused = true
  audio.ended = false
  audio.play = () => {
    audio.paused = false
    return Promise.resolve()
  }
  audio.pause = () => {
    audio.paused = true
  }
  dom.window.Audio = function Audio() {
    return audio
  }
  return audio
}

function listAnswer(tracks) {
  return async () => ({
    ok: true,
    json: async () => ({ folder: '/music', tracks }),
  })
}

function libraryAnswer(tracks, playlists) {
  return async () => ({
    ok: true,
    json: async () => ({ folder: '/music', tracks, playlists }),
  })
}

async function choosePlaylist(container, value) {
  await act(async () => {
    const select = container.querySelector('#music-playlist')
    select.value = value
    select.dispatchEvent({ type: 'change', bubbles: true, cancelable: true })
  })
}

async function endTrack(player) {
  await act(async () => {
    for (const listener of player.listeners.ended ?? []) listener()
  })
}

describe('the music player', () => {
  it('shows the track that is still playing after the panel reopens', async () => {
    globalThis.fetch = listAnswer(['alpha.mp3', 'beta.mp3'])
    await withDom(async ({ container, dom, root }) => {
      const player = installAudio(dom)
      await act(async () => {
        root.render(createElement(MusicPlayer))
      })
      await settle(5)
      await act(async () => {
        buttonWithText(container, 'Play').click()
      })
      await settle(5)
      expect(buttonWithText(container, 'Pause')).not.toBeNull()
      expect(player.paused).toBe(false)

      await act(async () => {
        root.render(null)
      })
      await act(async () => {
        root.render(createElement(MusicPlayer))
      })
      await settle(5)

      expect(container.textContent).toContain('alpha.mp3')
      expect(buttonWithText(container, 'Pause')).not.toBeNull()
    })
  })

  it('says when a track cannot start', async () => {
    globalThis.fetch = listAnswer(['alpha.mp3', 'beta.mp3'])
    await withDom(async ({ container, dom, root }) => {
      const player = installAudio(dom)
      player.play = () => Promise.reject(new Error('no audio device'))
      await act(async () => {
        root.render(createElement(MusicPlayer))
      })
      await settle(5)
      await act(async () => {
        buttonWithText(container, 'Play').click()
      })
      await settle(5)

      expect(container.textContent).toContain('Could not play alpha.mp3.')
      expect(buttonWithText(container, 'Play')).not.toBeNull()
    })
  })

  it('stops the music list read when the panel closes', async () => {
    let seen = null
    globalThis.fetch = (url, options = {}) =>
      new Promise((resolve, reject) => {
        seen = options.signal
        options.signal?.addEventListener('abort', () => reject(new Error('aborted')))
      })
    await withDom(async ({ dom, root }) => {
      installAudio(dom)
      await act(async () => {
        root.render(createElement(MusicPlayer))
      })
      await settle(5)
      expect(seen).not.toBeNull()
      expect(seen.aborted).toBe(false)

      await act(async () => {
        root.render(null)
      })
      expect(seen.aborted).toBe(true)
    })
  })

  it('lists All, the playlists and Loose tracks, and plays All in name order', async () => {
    globalThis.fetch = libraryAnswer(['loose.mp3'], [
      { name: 'Lofi', tracks: ['one.mp3', 'two.mp3'] },
      { name: 'Technical Calm', tracks: ['focus.mp3'] },
    ])
    await withDom(async ({ container, dom, root }) => {
      const player = installAudio(dom)
      await act(async () => {
        root.render(createElement(MusicPlayer))
      })
      await settle(5)

      const select = container.querySelector('#music-playlist')
      expect(select).not.toBeNull()
      expect(select.options.map((option) => option.textContent)).toEqual([
        'All',
        'Lofi',
        'Technical Calm',
        'Loose tracks',
      ])

      await act(async () => {
        buttonWithText(container, 'Play').click()
      })
      await settle(5)
      expect(player.src.endsWith('/music/Lofi/one.mp3')).toBe(true)

      await endTrack(player)
      expect(player.src.endsWith('/music/Lofi/two.mp3')).toBe(true)
      await endTrack(player)
      expect(player.src.endsWith('/music/Technical%20Calm/focus.mp3')).toBe(true)
      await endTrack(player)
      expect(player.src.endsWith('/music/loose.mp3')).toBe(true)
      await endTrack(player)
      expect(player.src.endsWith('/music/Lofi/one.mp3')).toBe(true)
    })
  })

  it('plays the chosen playlist in order, loops, and saves the choice', async () => {
    globalThis.fetch = libraryAnswer(['loose.mp3'], [
      { name: 'Lofi', tracks: ['one.mp3', 'two.mp3'] },
      { name: 'Technical Calm', tracks: ['focus.mp3'] },
    ])
    await withDom(async ({ container, dom, root }) => {
      const player = installAudio(dom)
      await act(async () => {
        root.render(createElement(MusicPlayer))
      })
      await settle(5)

      await choosePlaylist(container, 'playlist:Technical Calm')
      const saved = JSON.parse(dom.window.localStorage.getItem('machineroom.settings'))
      expect(saved.music.playlist).toBe('playlist:Technical Calm')
      expect(container.querySelector('#music-playlist').value).toBe('playlist:Technical Calm')
      expect(container.textContent).toContain('focus.mp3')

      await act(async () => {
        buttonWithText(container, 'Play').click()
      })
      await settle(5)
      expect(player.src.endsWith('/music/Technical%20Calm/focus.mp3')).toBe(true)
      await endTrack(player)
      expect(player.src.endsWith('/music/Technical%20Calm/focus.mp3')).toBe(true)

      await choosePlaylist(container, 'loose')
      expect(player.src.endsWith('/music/loose.mp3')).toBe(true)
    })
  })

  it('opens on the saved playlist and leaves Loose tracks out when nothing sits at the top', async () => {
    globalThis.fetch = libraryAnswer([], [{ name: 'Lofi', tracks: ['one.mp3', 'two.mp3'] }])
    await withDom(async ({ container, dom, root, window }) => {
      const player = installAudio(dom)
      window.localStorage.setItem('machineroom.settings', JSON.stringify({
        source: 'bridge',
        bridge: 'http://127.0.0.1:5174',
        music: { playlist: 'playlist:Lofi' },
      }))
      await act(async () => {
        root.render(createElement(MusicPlayer))
      })
      await settle(5)

      expect(container.querySelector('#music-playlist').options.map((option) => option.textContent)).toEqual(['All', 'Lofi'])
      expect(container.textContent).toContain('one.mp3')
      await act(async () => {
        buttonWithText(container, 'Play').click()
      })
      await settle(5)
      expect(player.src.endsWith('/music/Lofi/one.mp3')).toBe(true)
    })
  })
})
