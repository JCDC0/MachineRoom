import { act, useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { Chip, HoverCard, IconButton, Menu, Row, Switch } from '../src/ui/controls.jsx'
import { click, withDom } from './helpers/uiDom.js'

async function dispatch(node, type, init = {}) {
  const event = { type, ...init }
  await act(async () => { node.dispatchEvent(event) })
  return event
}

async function activate(root, button, key) {
  expect(button.tagName).toBe('BUTTON')
  expect(button.getAttribute('disabled')).toBeNull()
  button.focus()
  expect(button.ownerDocument.activeElement).toBe(button)
  const down = await dispatch(button, 'keydown', { key })
  if (key === 'Enter' && !down.defaultPrevented) await click(root, button)
  const up = await dispatch(button, 'keyup', { key })
  if (key === ' ' && !down.defaultPrevented && !up.defaultPrevented) await click(root, button)
}

describe('shared controls', () => {
  it('renders a chip button with a value and an optional expanded state', async () => {
    await withDom(async ({ container, root }) => {
      const onClick = vi.fn()
      await act(async () => root.render(<Chip label="Model" value="Sol" open={false} onClick={onClick} />))
      const chip = container.querySelector('button.ui-chip')
      expect(chip.querySelector('.ui-chip-label').textContent).toBe('Model')
      expect(chip.querySelector('.ui-chip-value').textContent).toBe('Sol')
      expect(chip.getAttribute('aria-expanded')).toBe('false')
      expect(chip.querySelector('.ui-chip-chevron').getAttribute('aria-hidden')).toBe('true')
      await activate(root, chip, 'Enter')
      expect(onClick).toHaveBeenCalledTimes(1)

      await act(async () => root.render(<Chip label="Model" value="Sol" open disabled />))
      expect(chip.getAttribute('aria-expanded')).toBe('true')
      expect(chip.hasAttribute('disabled')).toBe(true)
    })
  })

  it('uses a named native select and displays the selected option inside the chip', async () => {
    await withDom(async ({ container, root, dom }) => {
      const options = [
        { value: 'main', label: 'Main' },
        { value: 'lane', label: 'Lane' },
        { value: 'old', label: 'Old', disabled: true },
      ]
      const onChange = vi.fn()
      function Recipient() {
        const [value, setValue] = useState('main')
        return <Chip label="To" value={value} options={options} onChange={(next) => {
          setValue(next)
          onChange(next)
        }} />
      }
      await act(async () => root.render(<Recipient />))
      const select = container.querySelector('select')
      expect(select.getAttribute('aria-label')).toBe('To')
      expect(select.options[2].hasAttribute('disabled')).toBe(true)
      expect(container.querySelector('.ui-chip-value').textContent).toBe('Main')
      select.focus()
      expect(dom.document.activeElement).toBe(select)
      select.value = 'lane'
      await dispatch(select, 'change')
      expect(onChange).toHaveBeenCalledWith('lane')
      expect(container.querySelector('.ui-chip-value').textContent).toBe('Lane')
      await act(async () => root.render(<Chip label="To" value="main" options={options} disabled />))
      expect(container.querySelector('select').hasAttribute('disabled')).toBe(true)
    })
  })

  it('names the icon button and keeps its icon out of the accessible name', async () => {
    await withDom(async ({ container, root }) => {
      const onClick = vi.fn()
      await act(async () => root.render(<IconButton label="Open conversation" icon="+" onClick={onClick} />))
      const button = container.querySelector('button.ui-icon-btn')
      expect(button.getAttribute('type')).toBe('button')
      expect(button.getAttribute('aria-label')).toBe('Open conversation')
      expect(button.getAttribute('title')).toBe('Open conversation')
      expect(button.querySelector('.ui-icon').getAttribute('aria-hidden')).toBe('true')
      await activate(root, button, ' ')
      expect(onClick).toHaveBeenCalledTimes(1)
      await act(async () => root.render(<IconButton label="Open conversation" icon="+" disabled />))
      expect(button.hasAttribute('disabled')).toBe(true)
    })
  })

  it('toggles a named switch with native Space and Enter activation', async () => {
    await withDom(async ({ container, root }) => {
      function Worktree() {
        const [checked, setChecked] = useState(false)
        return <Switch label="Worktree" checked={checked} onChange={setChecked} />
      }
      await act(async () => root.render(<Worktree />))
      const button = container.querySelector('button[role="switch"]')
      expect(button.getAttribute('aria-label')).toBe('Worktree')
      expect(button.getAttribute('aria-checked')).toBe('false')
      expect(button.textContent).toBe('Worktree')
      await activate(root, button, ' ')
      expect(button.getAttribute('aria-checked')).toBe('true')
      await activate(root, button, 'Enter')
      expect(button.getAttribute('aria-checked')).toBe('false')
      await act(async () => root.render(<Switch label="Worktree" showLabel={false} disabled />))
      const iconSwitch = container.querySelector('[role="switch"]')
      expect(iconSwitch.getAttribute('aria-label')).toBe('Worktree')
      expect(iconSwitch.textContent).toBe('')
      expect(iconSwitch.hasAttribute('disabled')).toBe(true)
    })
  })

  it('opens a menu at the first or last enabled item and returns focus on Escape or selection', async () => {
    await withDom(async ({ container, root, dom }) => {
      const onSelect = vi.fn()
      const items = [
        { label: 'Add a lane' },
        { label: 'Build a team', disabled: true },
        { label: 'Show agent messages', checked: true, onSelect },
        { label: 'Delete', danger: true },
      ]
      await act(async () => root.render(<Menu label="Lane actions" items={items} />))
      const trigger = container.querySelector('button')
      expect(trigger.getAttribute('aria-haspopup')).toBe('menu')
      expect(trigger.getAttribute('aria-expanded')).toBe('false')

      await dispatch(trigger, 'keydown', { key: 'ArrowDown' })
      const menu = dom.body.querySelector('[role="menu"]')
      const [first, disabled, check, last] = menu.querySelectorAll('button')
      expect(trigger.getAttribute('aria-expanded')).toBe('true')
      expect(trigger.getAttribute('aria-controls')).toBe(menu.id)
      expect(menu.getAttribute('aria-label')).toBe('Lane actions')
      expect(disabled.hasAttribute('disabled')).toBe(true)
      expect(check.getAttribute('role')).toBe('menuitemcheckbox')
      expect(check.getAttribute('aria-checked')).toBe('true')
      expect(last.className).toContain('is-danger')
      expect(dom.document.activeElement).toBe(first)

      await dispatch(first, 'keydown', { key: 'ArrowUp' })
      expect(dom.document.activeElement).toBe(last)
      await dispatch(last, 'keydown', { key: 'ArrowDown' })
      expect(dom.document.activeElement).toBe(first)
      await dispatch(first, 'keydown', { key: 'ArrowDown' })
      expect(dom.document.activeElement).toBe(check)
      expect((await dispatch(check, 'keydown', { key: 'Escape' })).defaultPrevented).toBe(true)
      expect(dom.body.querySelector('[role="menu"]')).toBeNull()
      expect(dom.document.activeElement).toBe(trigger)

      await dispatch(trigger, 'keydown', { key: 'ArrowUp' })
      expect(dom.document.activeElement.textContent).toBe('Delete')
      await dispatch(dom.document.activeElement, 'keydown', { key: 'ArrowUp' })
      await activate(root, dom.document.activeElement, 'Enter')
      expect(onSelect).toHaveBeenCalledTimes(1)
      expect(trigger.getAttribute('aria-expanded')).toBe('false')
      expect(dom.document.activeElement).toBe(trigger)
    })
  })

  it('keeps a controlled menu inside the viewport and dismisses it on outside click or Tab', async () => {
    await withDom(async ({ container, root, dom, window }) => {
      dom.html.parentNode = dom.document
      dom.document.parentNode = window
      const onOpenChange = vi.fn()
      const items = [{ label: 'Add a lane' }]
      function Actions() {
        const [open, setOpen] = useState(false)
        return (
          <>
            <Menu label="Lane actions" items={items} open={open} onOpenChange={(next) => {
              setOpen(next)
              onOpenChange(next)
            }} />
            <button type="button">Outside</button>
          </>
        )
      }
      await act(async () => root.render(<Actions />))
      const [trigger, outside] = container.querySelectorAll('button')
      trigger.getBoundingClientRect = () => ({ left: 1248, right: 1276, top: 768, bottom: 796 })
      await click(root, trigger)
      const menu = dom.body.querySelector('.ui-menu')
      menu.getBoundingClientRect = () => ({ width: 144, height: 40 })
      window.dispatchEvent({ type: 'resize' })
      expect(menu.style.left).toBe('1128px')
      expect(menu.style.top).toBe('724px')
      menu.getBoundingClientRect = () => ({ width: 144, height: 800 })
      window.dispatchEvent({ type: 'resize' })
      expect(menu.style.top).toBe('8px')
      expect(menu.style.maxHeight).toBe('756px')
      await click(root, menu)
      expect(trigger.getAttribute('aria-expanded')).toBe('true')
      outside.focus()
      await click(root, outside)
      expect(trigger.getAttribute('aria-expanded')).toBe('false')
      expect(dom.document.activeElement).toBe(outside)
      expect(onOpenChange.mock.calls).toEqual([[true], [false]])

      await activate(root, trigger, 'Enter')
      const tab = await dispatch(dom.document.activeElement, 'keydown', { key: 'Tab' })
      expect(tab.defaultPrevented).toBe(false)
      expect(dom.document.activeElement).toBe(trigger)
      expect(trigger.getAttribute('aria-expanded')).toBe('false')
      await act(async () => root.render(<Menu label="Lane actions" items={items} open disabled />))
      expect(container.querySelector('button').hasAttribute('disabled')).toBe(true)
      expect(dom.body.querySelector('[role="menu"]')).toBeNull()
    })
  })

  it('keeps a selected row structural and its trailing action keyboard reachable', async () => {
    await withDom(async ({ container, root }) => {
      const onClick = vi.fn()
      await act(async () => root.render(
        <Row role="listitem" label="Coder" detail="Codex / Sol" selected leading={<span>Idle</span>}
          trailing={<IconButton label="Open conversation" icon="+" onClick={onClick} />} />,
      ))
      const row = container.querySelector('.ui-row[role="listitem"]')
      expect(row.className).toContain('is-selected')
      expect(row.firstChild.textContent).toBe('Idle')
      expect(row.querySelector('.ui-row-label').textContent).toBe('Coder')
      expect(row.querySelector('.ui-row-detail').getAttribute('title')).toBe('Codex / Sol')
      const action = row.querySelector('.ui-row-trailing').querySelector('button')
      expect(action.getAttribute('tabindex')).toBeNull()
      await activate(root, action, 'Enter')
      expect(onClick).toHaveBeenCalledTimes(1)
    })
  })

  it('shows the tooltip after 500 ms and keeps it open from the row to the card', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    try {
      await withDom(async ({ container, root, dom, window }) => {
        await act(async () => root.render(
          <HoverCard title="Coder" details={['Codex', 'Sol', 'High', 'Idle', 'Last run', 'Extra']}>
            <Row label="Coder" />
          </HoverCard>,
        ))
        const anchor = container.querySelector('.ui-hover-anchor')
        const card = dom.body.querySelector('[role="tooltip"]')
        expect(anchor.getAttribute('aria-describedby')).toBe(card.id)
        expect(card.children.map((child) => child.textContent)).toEqual(['Coder', 'Codex', 'Sol', 'High', 'Idle', 'Last run'])
        expect(card.hasAttribute('hidden')).toBe(true)
        await dispatch(anchor, 'pointerover')
        await act(async () => { vi.advanceTimersByTime(499) })
        expect(card.hasAttribute('hidden')).toBe(true)
        await act(async () => { vi.advanceTimersByTime(1) })
        expect(card.hasAttribute('hidden')).toBe(false)

        anchor.getBoundingClientRect = () => ({ left: 20, right: 320, top: 70, bottom: 102 })
        card.getBoundingClientRect = () => ({ width: 100, height: 120 })
        window.dispatchEvent({ type: 'resize' })
        expect(card.style.left).toBe('320px')
        expect(card.style.top).toBe('70px')
        await dispatch(anchor, 'pointerout', { relatedTarget: card })
        await dispatch(card, 'pointerover')
        await act(async () => { vi.advanceTimersByTime(100) })
        expect(card.hasAttribute('hidden')).toBe(false)
        await dispatch(card, 'pointerout')
        await act(async () => { vi.advanceTimersByTime(100) })
        expect(card.hasAttribute('hidden')).toBe(true)
      })
    } finally {
      vi.useRealTimers()
    }
  })

  it('opens the tooltip on focus and dismisses it on Escape or blur', async () => {
    await withDom(async ({ container, root, dom, window }) => {
      await act(async () => root.render(<HoverCard title="Coder"><Row label="Coder" /></HoverCard>))
      const anchor = container.querySelector('.ui-hover-anchor')
      const card = dom.body.querySelector('.ui-hovercard')
      expect(anchor.getAttribute('tabindex')).toBe('0')
      anchor.focus()
      await dispatch(anchor, 'focusin')
      expect(card.hasAttribute('hidden')).toBe(false)
      await dispatch(window, 'keydown', { key: 'Escape' })
      expect(card.hasAttribute('hidden')).toBe(true)
      expect(dom.document.activeElement).toBe(anchor)
      await dispatch(anchor, 'focusin')
      anchor.blur()
      await dispatch(anchor, 'focusout')
      expect(card.hasAttribute('hidden')).toBe(true)
    })
  })
})
