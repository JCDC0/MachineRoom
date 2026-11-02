import { act, createElement } from 'react'
import { describe, expect, it } from 'vitest'
import Hud, { hudKeyBlocked } from '../src/ui/Hud.jsx'
import { click, withDom } from './helpers/uiDom.js'

const SNAPSHOT = {
  position: 0,
  duration: 60,
  playing: false,
  speed: 1,
  agents: [],
  log: [],
}

function logLines(count) {
  return Array.from({ length: count }, (_, index) => ({
    time: index,
    agent: 'opencode',
    text: `line ${index + 1}`,
  }))
}

async function mountHud(root, props = {}) {
  await act(async () => {
    root.render(createElement(Hud, { mode: 'replay', snapshot: SNAPSHOT, speeds: [1, 2, 4], ...props }))
  })
}

function buttonByClass(scope, className) {
  return scope.querySelectorAll('button').find((button) => String(button.className).split(/\s+/).includes(className)) ?? null
}

describe('Hud keys and surfaces', () => {
  it('ignores a key that another control already handled', async () => {
    await withDom(async ({ container, root, window }) => {
      window.localStorage.setItem('machineroom.guide', '1')
      const swallow = (event) => event.preventDefault()
      window.addEventListener('keydown', swallow)
      await mountHud(root)
      expect(container.querySelector('#hud-log-drawer')).toBeNull()

      await act(async () => {
        window.dispatchEvent({ type: 'keydown', key: 'l', bubbles: true, cancelable: true })
      })

      expect(container.querySelector('#hud-log-drawer')).toBeNull()
      window.removeEventListener('keydown', swallow)
    })
  })

  it('opens the log from an untouched key', async () => {
    await withDom(async ({ container, root, window }) => {
      window.localStorage.setItem('machineroom.guide', '1')
      await mountHud(root)
      await act(async () => {
        window.dispatchEvent({ type: 'keydown', key: 'l', bubbles: true, cancelable: true })
      })
      expect(container.querySelector('#hud-log-drawer')).not.toBeNull()
    })
  })

  it('does not let the health popover block the room keys', async () => {
    await withDom(async ({ container, root, window }) => {
      window.localStorage.setItem('machineroom.guide', '1')
      await mountHud(root, { health: { runner: { alive: false } } })
      const chip = buttonByClass(container, 'hud-health-chip')
      expect(chip).not.toBeNull()
      await click(root, chip)

      const popover = container.querySelector('.hud-health-popover')
      expect(popover).not.toBeNull()
      expect(popover.getAttribute('role')).toBe('group')
      expect(window.document.querySelector('[role="dialog"]')).toBeNull()
      expect(hudKeyBlocked({ closest: () => null })).toBe(false)
    })
  })

  it('points the Settings button at the panel it opens', async () => {
    await withDom(async ({ container, root, window }) => {
      window.localStorage.setItem('machineroom.guide', '1')
      await mountHud(root)
      const button = container
        .querySelectorAll('button')
        .find((item) => item.getAttribute('aria-controls') === 'hud-settings')
      expect(button).not.toBeNull()
      expect(container.querySelector('#hud-settings')).toBeNull()

      await click(root, button)

      const panel = container.querySelector('#hud-settings')
      expect(panel).not.toBeNull()
      expect(panel.getAttribute('aria-labelledby')).toBe('hud-settings-title')
    })
  })

  it('moves focus into Help, keeps Tab inside and gives focus back on close', async () => {
    await withDom(async ({ container, root, window, dom }) => {
      window.localStorage.setItem('machineroom.guide', '1')
      await mountHud(root)
      const opener = dom.document.createElement('button')
      opener.textContent = 'opener'
      dom.body.appendChild(opener)
      opener.focus()

      const helpButton = container
        .querySelectorAll('button')
        .find((button) => button.getAttribute('aria-controls') === 'hud-help-dialog')
      expect(helpButton).not.toBeNull()
      helpButton.focus()
      await click(root, helpButton)

      const dialog = container.querySelector('#hud-help-dialog')
      expect(dialog).not.toBeNull()
      const controls = dialog.querySelectorAll('button')
      expect(controls.length).toBeGreaterThan(1)
      expect(dom.document.activeElement).toBe(controls[0])

      controls[controls.length - 1].focus()
      await act(async () => {
        window.dispatchEvent({ type: 'keydown', key: 'Tab', bubbles: true, cancelable: true })
      })
      expect(dom.document.activeElement).toBe(controls[0])

      controls[0].focus()
      await act(async () => {
        window.dispatchEvent({ type: 'keydown', key: 'Tab', shiftKey: true, bubbles: true, cancelable: true })
      })
      expect(dom.document.activeElement).toBe(controls[controls.length - 1])

      const close = controls.find((button) => button.textContent.trim() === 'Close')
      await click(root, close)
      expect(container.querySelector('#hud-help-dialog')).toBeNull()
      expect(dom.document.activeElement).toBe(helpButton)
    })
  })

  it('follows new log lines only while the log is at the bottom', async () => {
    await withDom(async ({ container, root, window }) => {
      window.localStorage.setItem('machineroom.guide', '1')
      const log = logLines(30)
      await mountHud(root, { log })
      const buttons = container.querySelectorAll('button')
      const openLog = buttons.find((button) => String(button.className).includes('hud-action') && button.textContent.includes('Log'))
      expect(openLog).not.toBeNull()
      await click(root, openLog)

      const drawer = container.querySelector('#hud-log-drawer')
      expect(drawer).not.toBeNull()
      const body = drawer.querySelector('.hud-log-body')
      body.scrollHeight = 1000
      body.clientHeight = 200
      body.scrollTop = 1000

      body.scrollHeight = 1018
      await mountHud(root, { log: logLines(31) })
      expect(body.scrollTop).toBe(1018)

      body.scrollTop = 0
      body.scrollHeight = 1036
      await act(async () => {
        body.dispatchEvent({ type: 'scroll', bubbles: true, cancelable: true })
      })
      body.scrollHeight = 1054
      await mountHud(root, { log: logLines(32) })
      expect(body.scrollTop).toBe(0)

      body.scrollTop = 1054
      body.scrollHeight = 1072
      await act(async () => {
        body.dispatchEvent({ type: 'scroll', bubbles: true, cancelable: true })
      })
      await mountHud(root, { log: logLines(33) })
      expect(body.scrollTop).toBe(1072)
    })
  })
})
