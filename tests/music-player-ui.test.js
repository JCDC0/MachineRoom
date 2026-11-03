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
})
