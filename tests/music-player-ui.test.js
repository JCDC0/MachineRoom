import { act, createElement } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import MusicPlayer from '../src/ui/MusicPlayer.jsx'
import { sound } from '../src/ui/sound.js'
import { buttonWithText, settle, withDom } from './helpers/uiDom.js'

const originalFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = originalFetch
  sound.pauseMusic()
})

function installAudio(dom) {
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
      const audio = installAudio(dom)
      await act(async () => {
        root.render(createElement(MusicPlayer))
      })
      await settle(5)
      await act(async () => {
        buttonWithText(container, 'Play').click()
      })
      await settle(5)
      expect(buttonWithText(container, 'Pause')).not.toBeNull()
      expect(audio.paused).toBe(false)

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
})
