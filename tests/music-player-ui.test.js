import { act, createElement } from 'react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import MusicPlayer from '../src/ui/MusicPlayer.jsx'
import { formatTrackTime, musicDuration, musicPosition, nextLoop, resetMusicQueue, shuffleOrder, shuffleOrderFrom } from '../src/ui/musicQueue.js'
import { sound } from '../src/ui/sound.js'
import { buttonWithText, classesOf, settle, type, withDom } from './helpers/uiDom.js'

const originalFetch = globalThis.fetch
const originalRandom = Math.random

const audio = {
  paused: true,
  ended: false,
  volume: 1,
  currentTime: 0,
  duration: 0,
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
  resetMusicQueue()
  globalThis.fetch = originalFetch
  Math.random = originalRandom
  sound.pauseMusic()
})

beforeEach(() => {
  resetMusicQueue()
})

function installAudio(dom) {
  audio.paused = true
  audio.ended = false
  audio.currentTime = 0
  audio.duration = 0
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

function control(container, label) {
  return container.querySelector(`button[aria-label="${label}"]`)
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

describe('the music time', () => {
  it('reads a track position as minutes and seconds', () => {
    expect(formatTrackTime(0)).toBe('0:00')
    expect(formatTrackTime(5.9)).toBe('0:05')
    expect(formatTrackTime(65)).toBe('1:05')
    expect(formatTrackTime(125)).toBe('2:05')
    expect(formatTrackTime(-1)).toBe('0:00')
    expect(formatTrackTime(Number.NaN)).toBe('0:00')
    expect(formatTrackTime(Infinity)).toBe('0:00')
  })
})

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
        control(container, 'Play').click()
      })
      await settle(5)
      expect(control(container, 'Pause')).not.toBeNull()
      expect(player.paused).toBe(false)
      await act(async () => {
        control(container, 'Shuffle').click()
      })
      await act(async () => {
        control(container, 'Loop off').click()
      })

      await act(async () => {
        root.render(null)
      })
      await act(async () => {
        root.render(createElement(MusicPlayer))
      })
      await settle(5)

      expect(container.textContent).toContain('alpha.mp3')
      expect(control(container, 'Pause')).not.toBeNull()
      expect(classesOf(control(container, 'Shuffle'))).toContain('is-on')
      expect(control(container, 'Loop all')).not.toBeNull()
      expect(buttonWithText(container, 'alpha.mp3')).not.toBeNull()
      expect(buttonWithText(container, 'beta.mp3')).not.toBeNull()
    })
  })

  it('shows the track time and seeks the playing track', async () => {
    globalThis.fetch = listAnswer(['alpha.mp3'])
    await withDom(async ({ container, dom, root }) => {
      const player = installAudio(dom)
      player.duration = NaN
      await act(async () => {
        root.render(createElement(MusicPlayer))
      })
      await settle(5)

      const seek = container.querySelector('input[aria-label="Track position"]')
      const times = () => container.querySelectorAll('.hud-sound-time-value').map((node) => node.textContent)
      expect(seek).not.toBeNull()
      expect(seek.getAttribute('disabled')).not.toBeNull()
      expect(times()[0]).toBe('0:00')

      player.duration = 125
      await act(async () => {
        control(container, 'Play').click()
      })
      await settle(5)
      expect(seek.getAttribute('disabled')).toBeNull()
      expect(times()).toEqual(['0:00', '2:05'])

      player.currentTime = 65
      await settle(300)
      expect(times()).toEqual(['1:05', '2:05'])
      expect(Number(seek.value)).toBeCloseTo(65, 0)

      await type(root, seek, '30')
      expect(player.currentTime).toBe(30)
      expect(times()).toEqual(['0:30', '2:05'])
    })
  })

  it('shows the position while a playing track has no length', async () => {
    globalThis.fetch = listAnswer(['alpha.mp3'])
    await withDom(async ({ container, dom, root }) => {
      const player = installAudio(dom)
      player.duration = NaN
      await act(async () => {
        root.render(createElement(MusicPlayer))
      })
      await settle(5)
      await act(async () => {
        control(container, 'Play').click()
      })
      await settle(5)

      player.currentTime = 65
      await settle(300)
      const seek = container.querySelector('input[aria-label="Track position"]')
      const times = () => container.querySelectorAll('.hud-sound-time-value').map((node) => node.textContent)
      expect(times()).toEqual(['1:05', '0:00'])
      expect(Number(seek.value)).toBe(0)
      expect(seek.getAttribute('disabled')).not.toBeNull()
    })
  })

  it('shows the elapsed time at the end the time bar can reach', async () => {
    globalThis.fetch = listAnswer(['alpha.mp3'])
    await withDom(async ({ container, dom, root }) => {
      const player = installAudio(dom)
      player.duration = 60
      await act(async () => {
        root.render(createElement(MusicPlayer))
      })
      await settle(5)
      await act(async () => {
        control(container, 'Play').click()
      })
      await settle(5)

      player.currentTime = 90
      await settle(300)
      const seek = container.querySelector('input[aria-label="Track position"]')
      const times = () => container.querySelectorAll('.hud-sound-time-value').map((node) => node.textContent)
      expect(Number(seek.value)).toBe(60)
      expect(times()).toEqual(['1:00', '1:00'])
    })
  })

  it('resets the time bar to the new playlist while the music is paused', async () => {
    globalThis.fetch = libraryAnswer([], [
      { name: 'Lofi', tracks: ['one.mp3', 'two.mp3'] },
      { name: 'Calm', tracks: ['slow.mp3'] },
    ])
    await withDom(async ({ container, dom, root }) => {
      const player = installAudio(dom)
      player.duration = 125
      await act(async () => {
        root.render(createElement(MusicPlayer))
      })
      await settle(5)
      await choosePlaylist(container, 'playlist:Lofi')
      await act(async () => {
        control(container, 'Play').click()
      })
      await settle(5)
      expect(player.src.endsWith('/music/Lofi/one.mp3')).toBe(true)

      player.currentTime = 65
      await settle(300)
      const times = () => container.querySelectorAll('.hud-sound-time-value').map((node) => node.textContent)
      expect(times()).toEqual(['1:05', '2:05'])
      expect(musicPosition()).toBe(65)
      expect(musicDuration()).toBe(125)

      await act(async () => {
        control(container, 'Pause').click()
      })
      expect(player.paused).toBe(true)
      await choosePlaylist(container, 'playlist:Calm')
      await settle(300)

      expect(player.src.endsWith('/music/Lofi/one.mp3')).toBe(true)
      expect(musicPosition()).toBe(0)
      expect(musicDuration()).toBe(0)
      expect(times()).toEqual(['0:00', '0:00'])

      await act(async () => {
        control(container, 'Play').click()
      })
      await settle(5)
      expect(player.src.endsWith('/music/Calm/slow.mp3')).toBe(true)
      player.currentTime = 0
      player.duration = 42
      await settle(300)
      expect(times()).toEqual(['0:00', '0:42'])
    })
  })

  it('mutes the music, keeps the volume and unmutes from the slider', async () => {
    globalThis.fetch = listAnswer(['alpha.mp3'])
    await withDom(async ({ container, dom, root }) => {
      const player = installAudio(dom)
      player.duration = 60
      await act(async () => {
        root.render(createElement(MusicPlayer))
      })
      await settle(5)
      await act(async () => {
        control(container, 'Play').click()
      })
      await settle(5)

      const volume = container.querySelector('input[aria-label="Music volume"]')
      expect(player.volume).toBeCloseTo(0.5)
      expect(control(container, 'Mute music').getAttribute('title')).toBe('Mute music')
      expect(control(container, 'Mute music').querySelector('svg')).not.toBeNull()

      await act(async () => {
        control(container, 'Mute music').click()
      })
      expect(player.volume).toBe(0)
      expect(JSON.parse(dom.window.localStorage.getItem('machineroom.settings')).sound.musicMuted).toBe(true)
      expect(control(container, 'Unmute music').getAttribute('title')).toBe('Unmute music')
      expect(container.textContent).toContain('50%')
      expect(Number(volume.value)).toBeCloseTo(0.5)

      await act(async () => {
        control(container, 'Unmute music').click()
      })
      expect(player.volume).toBeCloseTo(0.5)
      expect(control(container, 'Mute music')).not.toBeNull()

      await act(async () => {
        control(container, 'Mute music').click()
      })
      await type(root, volume, '0.8')
      const saved = JSON.parse(dom.window.localStorage.getItem('machineroom.settings')).sound
      expect(player.volume).toBeCloseTo(0.8)
      expect(saved.musicVolume).toBeCloseTo(0.8)
      expect(saved.musicMuted).toBe(false)
      expect(control(container, 'Mute music')).not.toBeNull()
      expect(container.textContent).toContain('80%')
    })
  })

  it('plays the next track when one ends while the player is unmounted', async () => {
    globalThis.fetch = listAnswer(['alpha.mp3', 'beta.mp3'])
    await withDom(async ({ container, dom, root }) => {
      const player = installAudio(dom)
      await act(async () => {
        root.render(createElement(MusicPlayer))
      })
      await settle(5)
      await act(async () => {
        buttonWithText(container, 'alpha.mp3').click()
      })
      await settle(5)
      expect(player.src.endsWith('/music/alpha.mp3')).toBe(true)

      await act(async () => {
        root.render(null)
      })
      await endTrack(player)
      await settle(5)
      expect(player.src.endsWith('/music/beta.mp3')).toBe(true)
      expect(player.paused).toBe(false)
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
        buttonWithText(container, 'alpha.mp3').click()
      })
      await settle(5)

      expect(container.textContent).toContain('Could not play alpha.mp3.')
      expect(control(container, 'Play')).not.toBeNull()
    })
  })

  it('keeps the music list read running when the panel closes', async () => {
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
      expect(seen.aborted).toBe(false)
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
        control(container, 'Play').click()
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
      expect(control(container, 'Play')).not.toBeNull()
      expect(player.paused).toBe(true)
    })
  })

  it('plays the chosen playlist in order and saves the choice', async () => {
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
        control(container, 'Play').click()
      })
      await settle(5)
      expect(player.src.endsWith('/music/Technical%20Calm/focus.mp3')).toBe(true)
      await endTrack(player)
      expect(control(container, 'Play')).not.toBeNull()
      expect(player.paused).toBe(true)
    })
  })

  it('cycles loop off, all and one, and saves the mode', async () => {
    expect(nextLoop('off')).toBe('all')
    expect(nextLoop('all')).toBe('one')
    expect(nextLoop('one')).toBe('off')
    globalThis.fetch = libraryAnswer([], [{ name: 'Lofi', tracks: ['one.mp3', 'two.mp3'] }])
    await withDom(async ({ container, dom, root }) => {
      installAudio(dom)
      await act(async () => {
        root.render(createElement(MusicPlayer))
      })
      await settle(5)

      expect(control(container, 'Loop off')).not.toBeNull()
      await act(async () => {
        control(container, 'Loop off').click()
      })
      expect(control(container, 'Loop all')).not.toBeNull()
      expect(classesOf(control(container, 'Loop all'))).toContain('is-on')
      expect(JSON.parse(dom.window.localStorage.getItem('machineroom.settings')).music.loop).toBe('all')

      await act(async () => {
        control(container, 'Loop all').click()
      })
      expect(control(container, 'Loop one')).not.toBeNull()
      expect(JSON.parse(dom.window.localStorage.getItem('machineroom.settings')).music.loop).toBe('one')

      await act(async () => {
        control(container, 'Loop one').click()
      })
      expect(control(container, 'Loop off')).not.toBeNull()
      expect(JSON.parse(dom.window.localStorage.getItem('machineroom.settings')).music.loop).toBe('off')
    })
  })

  it('stops after the last track when loop is off, wraps when all and repeats when one', async () => {
    globalThis.fetch = libraryAnswer([], [{ name: 'Lofi', tracks: ['one.mp3', 'two.mp3'] }])
    await withDom(async ({ container, dom, root }) => {
      const player = installAudio(dom)
      await act(async () => {
        root.render(createElement(MusicPlayer))
      })
      await settle(5)
      await choosePlaylist(container, 'playlist:Lofi')

      await act(async () => {
        control(container, 'Play').click()
      })
      await settle(5)
      expect(player.src.endsWith('/music/Lofi/one.mp3')).toBe(true)
      await endTrack(player)
      expect(player.src.endsWith('/music/Lofi/two.mp3')).toBe(true)
      await endTrack(player)
      expect(control(container, 'Play')).not.toBeNull()
      expect(player.paused).toBe(true)

      await act(async () => {
        control(container, 'Loop off').click()
      })
      await act(async () => {
        control(container, 'Play').click()
      })
      await settle(5)
      expect(player.src.endsWith('/music/Lofi/two.mp3')).toBe(true)
      await endTrack(player)
      expect(player.src.endsWith('/music/Lofi/one.mp3')).toBe(true)

      await act(async () => {
        control(container, 'Loop all').click()
      })
      await endTrack(player)
      expect(player.src.endsWith('/music/Lofi/one.mp3')).toBe(true)
      expect(control(container, 'Pause')).not.toBeNull()
    })
  })

  it('plays every track once before wrapping in shuffle order', () => {
    expect(shuffleOrder(4, () => 0.5)).toEqual([0, 3, 1, 2])
    expect(shuffleOrderFrom(0, 4, () => 0.5)).toEqual([0, 3, 1, 2])
    expect(shuffleOrderFrom(2, 4, () => 0.5)).toEqual([2, 0, 3, 1])
    expect(shuffleOrderFrom(0, 0, () => 0.5)).toEqual([])
  })

  it('walks the shuffle order and saves the shuffle switch', async () => {
    Math.random = () => 0.5
    globalThis.fetch = libraryAnswer([], [{ name: 'Lofi', tracks: ['a.mp3', 'b.mp3', 'c.mp3', 'd.mp3'] }])
    await withDom(async ({ container, dom, root }) => {
      const player = installAudio(dom)
      await act(async () => {
        root.render(createElement(MusicPlayer))
      })
      await settle(5)
      await choosePlaylist(container, 'playlist:Lofi')

      await act(async () => {
        control(container, 'Play').click()
      })
      await settle(5)
      expect(player.src.endsWith('/music/Lofi/a.mp3')).toBe(true)

      await act(async () => {
        control(container, 'Shuffle').click()
      })
      expect(classesOf(control(container, 'Shuffle'))).toContain('is-on')
      expect(JSON.parse(dom.window.localStorage.getItem('machineroom.settings')).music.shuffle).toBe(true)

      const played = []
      for (let step = 0; step < 4; step += 1) {
        await act(async () => {
          control(container, 'Next track').click()
        })
        await settle(5)
        played.push(player.src.split('/').pop())
      }
      expect(played).toEqual(['d.mp3', 'b.mp3', 'c.mp3', 'a.mp3'])
    })
  })

  it('plays the track Next, Previous and a track name move to, also when paused', async () => {
    globalThis.fetch = listAnswer(['alpha.mp3', 'beta.mp3', 'gamma.mp3'])
    await withDom(async ({ container, dom, root }) => {
      const player = installAudio(dom)
      await act(async () => {
        root.render(createElement(MusicPlayer))
      })
      await settle(5)

      await act(async () => {
        control(container, 'Play').click()
      })
      await settle(5)
      expect(player.src.endsWith('/music/alpha.mp3')).toBe(true)

      await act(async () => {
        control(container, 'Pause').click()
      })
      expect(player.paused).toBe(true)

      await act(async () => {
        control(container, 'Next track').click()
      })
      await settle(5)
      expect(player.src.endsWith('/music/beta.mp3')).toBe(true)
      expect(player.paused).toBe(false)
      expect(control(container, 'Pause')).not.toBeNull()

      await act(async () => {
        control(container, 'Pause').click()
      })
      await act(async () => {
        control(container, 'Previous track').click()
      })
      await settle(5)
      expect(player.src.endsWith('/music/alpha.mp3')).toBe(true)
      expect(player.paused).toBe(false)

      await act(async () => {
        buttonWithText(container, 'gamma.mp3').click()
      })
      await settle(5)
      expect(player.src.endsWith('/music/gamma.mp3')).toBe(true)
      expect(player.paused).toBe(false)
      expect(container.textContent).toContain('gamma.mp3')
    })
  })

  it('refreshes the list, keeps the playing track and shows the count', async () => {
    let calls = 0
    globalThis.fetch = async () => {
      calls += 1
      const body = calls === 1
        ? { folder: '/music', tracks: [], playlists: [{ name: 'Lofi', tracks: ['one.mp3', 'two.mp3'] }] }
        : { folder: '/music', tracks: ['loose.mp3'], playlists: [{ name: 'Lofi', tracks: ['one.mp3', 'two.mp3', 'three.mp3'] }] }
      return { ok: true, json: async () => body }
    }
    await withDom(async ({ container, dom, root }) => {
      const player = installAudio(dom)
      await act(async () => {
        root.render(createElement(MusicPlayer))
      })
      await settle(5)
      await choosePlaylist(container, 'playlist:Lofi')
      await act(async () => {
        control(container, 'Play').click()
      })
      await settle(5)
      expect(player.src.endsWith('/music/Lofi/one.mp3')).toBe(true)

      await act(async () => {
        control(container, 'Refresh').click()
      })
      await settle(5)

      expect(container.textContent).toContain('4 tracks in 1 playlist.')
      expect(container.querySelector('#music-playlist').options.map((option) => option.textContent)).toEqual(['All', 'Lofi', 'Loose tracks'])
      expect(player.src.endsWith('/music/Lofi/one.mp3')).toBe(true)
      expect(player.paused).toBe(false)
      expect(control(container, 'Pause')).not.toBeNull()
    })
  })

  it('shows an icon button for each control and opens the folder once confirmed', async () => {
    const posts = []
    let openStatus = 204
    globalThis.fetch = async (url, options = {}) => {
      if (String(url).includes('/api/music/open')) {
        posts.push({ url, options })
        return {
          status: openStatus,
          json: async () => ({ error: 'No file manager could be started.' }),
        }
      }
      return { ok: true, json: async () => ({ folder: '/music', tracks: ['alpha.mp3'], playlists: [] }) }
    }
    await withDom(async ({ container, dom, root }) => {
      installAudio(dom)
      await act(async () => {
        root.render(createElement(MusicPlayer))
      })
      await settle(5)

      const labels = ['Previous track', 'Play', 'Next track', 'Shuffle', 'Loop off', 'Open folder', 'Refresh', 'Mute music']
      for (const label of labels) {
        const button = control(container, label)
        expect(button).not.toBeNull()
        expect(button.getAttribute('title')).not.toBeNull()
        expect(button.querySelector('svg')).not.toBeNull()
      }

      await act(async () => {
        control(container, 'Open folder').click()
      })
      await settle(5)
      expect(posts).toHaveLength(1)
      expect(posts[0].options.method).toBe('POST')
      expect(JSON.parse(posts[0].options.body)).toEqual({ confirmed: true })
      expect(container.textContent).not.toContain('No file manager could be started.')

      openStatus = 501
      await act(async () => {
        control(container, 'Open folder').click()
      })
      await settle(5)
      expect(posts).toHaveLength(2)
      expect(container.textContent).toContain('No file manager could be started.')
    })
  })
})
