import { tourEnabled } from '../startup.js'
import { readStorage, store, writeStorage } from '../storage.js'
import { SETTINGS_KEY, savedSource } from './settings.js'

export const GUIDE_FLAG = 'machineroom.guide'
export const GUIDE_SEEN = '1'

export const GUIDE_STEPS = [
  {
    label: 'The lens',
    text: 'The room sits in the lens at the top: your project name is at its top left, and the hub, the folder cards and the agents fill it.',
  },
  {
    label: 'The dock',
    text: 'The dock has three columns: the agent list on the left, the selected agent, else the first working, else the orchestrator in the middle, and the settings and costs on the right.',
  },
  {
    label: 'The tunnel',
    text: 'A working agent sends a yellow tunnel to the file it touches, and packets run along it; white is a read or write, green is finished and red is a failure.',
  },
  {
    label: 'The chat',
    text: 'The orchestrator chat sits at the bottom right when the room runs with --lanes: press / or click ORCHESTRATOR, and its tabs switch between them.',
  },
  {
    label: 'The keys',
    text: 'C opens the control drawer, L the event log, T an agent log, F follow mode, 0 the overview, / opens the chat with --lanes or the assistant in a replay, and ? lists every key.',
  },
]

export const TOUR_STEPS = [
  {
    label: 'The lens',
    selector: '.lens',
    text: 'This lens holds the room, with the project name, the working lanes and the newest activity.',
  },
  {
    label: 'The hub and an agent',
    selector: '.mr-term',
    text: 'This terminal chip sits beside an agent above the hub and opens its log when you click it.',
  },
  {
    label: 'A working tunnel',
    selector: '.mr-card.is-targeted, .mr-callout.is-working, .mr-term.is-working',
    text: 'This yellow tunnel runs from a working agent to the file it touches, with packets along it.',
  },
  {
    label: 'The sidebar',
    selector: '.mr-side, .hud-dock-agents',
    text: 'This column holds the projects, their conversations and the agents, and the number keys focus agents.',
  },
  {
    label: 'The conversation',
    selector: '.hud-lower-main, .hud-dock-context',
    text: 'This middle column shows the conversation with the orchestrator, or the event log in a replay.',
  },
  {
    label: 'Overview',
    selector: '.hud-overview, .hud-dock-side',
    text: 'This Overview card opens Settings, the selected agent, the costs and the log in a drawer.',
  },
  {
    label: 'The transport',
    selector: '.transport',
    text: 'This transport plays or pauses the replay, seeks along the timeline and sets its speed.',
  },
  {
    label: 'Control and orchestrator',
    selector: '.hud-actions',
    text: 'This action row opens Control for tasks, runs and reviews, and the orchestrator chat when the room runs with --lanes.',
  },
]

export const LIVE_TOUR_STEPS = [
  {
    label: 'The lens',
    selector: '.lens',
    text: 'This lens shows your project as a room, with its folders, hub and agents.',
  },
  {
    label: 'The hub and its agents',
    selector: '.mr-term[data-agent="orchestrator"]',
    text: "This terminal chip shows the orchestrator's name and status above the hub and its agents.",
  },
  {
    label: 'Model and effort',
    selector: '.hud-strip-model',
    text: 'This model picker in the input box sets the model the orchestrator uses, with its effort beside it.',
  },
  {
    label: 'Compact',
    selector: '.hud-strip-compact',
    text: "This Compact button squeezes the orchestrator's context into a short summary.",
  },
  {
    label: 'Settings',
    selector: '.hud-action[aria-label="Settings"]',
    text: 'This Settings button in the menu row opens the folder depth and the screen effects.',
  },
  {
    label: 'New conversation',
    selector: '.hud-sessions-button',
    text: 'This New conversation button starts a fresh talk with the orchestrator, and older ones stay listed under the project.',
  },
]

export const CONFIRM_SELECTOR =
  '.brief-confirm-card, .backup-confirm-card, .mr-orch-confirm, .mr-assistant-btn-confirm'

export const DEFAULT_CARD_SIZE = Object.freeze({ width: 420, height: 220 })
export const DEFAULT_VIEWPORT = Object.freeze({ width: 1280, height: 800 })
const WINDOW_MARGIN = 16

let helpTourPending = false

function clamp(value, min, max) {
  if (max < min) return min
  return Math.min(Math.max(value, min), max)
}

export function clampStep(value, steps = GUIDE_STEPS) {
  const list = Array.isArray(steps) && steps.length > 0 ? steps : GUIDE_STEPS
  if (!Number.isInteger(value)) return 0
  return Math.min(Math.max(value, 0), list.length - 1)
}

export function guideSeen(storage = store()) {
  try {
    return readStorage(GUIDE_FLAG, storage) === GUIDE_SEEN
  } catch {
    return false
  }
}

export function tourRequested(search = typeof window !== 'undefined' ? window.location?.search : '') {
  if (search && typeof search.has === 'function') return tourEnabled(search)
  if (typeof search !== 'string' || search === '') return false
  try {
    return tourEnabled(new URLSearchParams(search))
  } catch {
    return false
  }
}

export function shouldShowGuide(
  storage = store(),
  search = typeof window !== 'undefined' ? window.location?.search : ''
) {
  if (tourRequested(search)) return true
  return !guideSeen(storage)
}

export function isFirstBoot(storage = store()) {
  return savedSource(storage) === null && !guideSeen(storage)
}

export function setTourSpeed(storage = store()) {
  const raw = readStorage(SETTINGS_KEY, storage)
  if (!raw) return false
  try {
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return false
    if (parsed.speed === 1) return true
    return writeStorage(SETTINGS_KEY, JSON.stringify({ ...parsed, speed: 1 }), storage)
  } catch {
    return false
  }
}

export function connectHref(pathname = '/') {
  const path = typeof pathname === 'string' && pathname !== '' ? pathname : '/'
  return `${path}?connect`
}

export function markGuideSeen(storage = store()) {
  try {
    return writeStorage(GUIDE_FLAG, GUIDE_SEEN, storage)
  } catch {
    return false
  }
}

export function confirmCardOpen(doc) {
  if (!doc || typeof doc.querySelector !== 'function') return false
  try {
    return Boolean(doc.querySelector(CONFIRM_SELECTOR))
  } catch {
    return false
  }
}

export function setupCardOpen(doc) {
  if (!doc || typeof doc.querySelector !== 'function') return false
  try {
    return Boolean(doc.querySelector('.mr-setup'))
  } catch {
    return false
  }
}

export function guideBlocked(doc) {
  return confirmCardOpen(doc) || setupCardOpen(doc)
}

export function guideCanOpen(doc) {
  if (guideBlocked(doc)) return false
  if (doc && typeof doc.querySelector === 'function') {
    try {
      helpTourPending = Boolean(doc.querySelector('#hud-help-dialog'))
    } catch {
      helpTourPending = false
    }
  }
  return true
}

export function consumeHelpTour() {
  const pending = helpTourPending
  helpTourPending = false
  return pending
}

function readElementRect(element, doc) {
  if (!element || typeof element !== 'object') return null
  if (element.hidden === true) return null
  const style = element.style
  if (
    style &&
    (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0')
  ) {
    return null
  }
  const view = doc?.defaultView ?? (typeof window !== 'undefined' ? window : null)
  if (view && typeof view.getComputedStyle === 'function' && typeof Element !== 'undefined' && element instanceof Element) {
    try {
      const computed = view.getComputedStyle(element)
      if (
        computed &&
        (computed.display === 'none' ||
          computed.visibility === 'hidden' ||
          Number(computed.opacity) === 0)
      ) {
        return null
      }
    } catch {
      return null
    }
  }
  const raw =
    typeof element.getBoundingClientRect === 'function'
      ? element.getBoundingClientRect()
      : element.rect && typeof element.rect === 'object'
        ? element.rect
        : element
  const left = Number(raw?.left ?? raw?.x ?? 0)
  const top = Number(raw?.top ?? raw?.y ?? 0)
  const width = Number(raw?.width ?? 0)
  const height = Number(raw?.height ?? 0)
  if (!Number.isFinite(left) || !Number.isFinite(top) || !(width > 0) || !(height > 0)) {
    return null
  }
  return {
    left,
    top,
    width,
    height,
    right: left + width,
    bottom: top + height,
  }
}

function clipRectToViewport(rect, viewport) {
  if (!rect) return null
  const vw = Number(viewport?.width)
  const vh = Number(viewport?.height)
  if (!(vw > 0) || !(vh > 0)) return rect
  const left = Math.max(0, rect.left)
  const top = Math.max(0, rect.top)
  const right = Math.min(vw, rect.right)
  const bottom = Math.min(vh, rect.bottom)
  if (right <= left || bottom <= top) return null
  return {
    left,
    top,
    width: right - left,
    height: bottom - top,
    right,
    bottom,
  }
}

function queryCandidates(doc, selector) {
  if (!doc || typeof selector !== 'string' || selector.trim() === '') return []
  if (typeof doc.querySelectorAll === 'function') {
    try {
      const found = Array.from(doc.querySelectorAll(selector)).filter(Boolean)
      if (found.length > 0) return found
    } catch {}
  }
  if (typeof doc.querySelector === 'function') {
    try {
      const one = doc.querySelector(selector)
      if (one) return [one]
    } catch {}
  }
  const parts = selector
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
  const list = []
  for (const part of parts) {
    try {
      if (typeof doc.querySelectorAll === 'function') {
        const found = Array.from(doc.querySelectorAll(part))
        for (const item of found) {
          if (item && !list.includes(item)) list.push(item)
        }
      } else if (typeof doc.querySelector === 'function') {
        const item = doc.querySelector(part)
        if (item && !list.includes(item)) list.push(item)
      }
    } catch {
      continue
    }
  }
  if (list.length === 0 && parts.length > 1 && typeof doc.querySelector === 'function') {
    try {
      const fallback = doc.querySelector(selector)
      if (fallback) list.push(fallback)
    } catch {
      return list
    }
  }
  return list
}

export function findStepTarget(doc, stepOrSelector, viewport = null) {
  const selector =
    typeof stepOrSelector === 'string' ? stepOrSelector : stepOrSelector?.selector ?? ''
  const candidates = queryCandidates(doc, selector)
  for (const candidate of candidates) {
    const rect = clipRectToViewport(readElementRect(candidate, doc), viewport)
    if (rect) return candidate
  }
  return null
}

export function stepTargetRect(doc, stepOrSelector, viewport = null) {
  const selector =
    typeof stepOrSelector === 'string' ? stepOrSelector : stepOrSelector?.selector ?? ''
  const candidates = queryCandidates(doc, selector)
  for (const candidate of candidates) {
    const rect = clipRectToViewport(readElementRect(candidate, doc), viewport)
    if (rect) return rect
  }
  return null
}

export function stepAvailable(step, doc, viewport = null) {
  return stepTargetRect(doc, step, viewport) !== null
}

export function availableSteps(steps, doc, viewport = null) {
  const list = Array.isArray(steps) ? steps : []
  return list.filter((step) => stepAvailable(step, doc, viewport))
}

export function nextStepIndex(steps, from, doc, viewport = null, direction = 1) {
  const list = Array.isArray(steps) ? steps : []
  if (list.length === 0) return null
  const step = direction < 0 ? -1 : 1
  let index = Number.isInteger(from) ? from + step : step > 0 ? 0 : list.length - 1
  while (index >= 0 && index < list.length) {
    if (stepAvailable(list[index], doc, viewport)) return index
    index += step
  }
  return null
}

export function resolveStepIndex(steps, from, doc, viewport = null) {
  const list = Array.isArray(steps) ? steps : []
  if (list.length === 0) return null
  const start = Number.isInteger(from) ? Math.min(Math.max(from, 0), list.length - 1) : 0
  if (stepAvailable(list[start], doc, viewport)) return start
  const forward = nextStepIndex(list, start, doc, viewport, 1)
  if (forward !== null) return forward
  return nextStepIndex(list, start, doc, viewport, -1)
}

export function placeGuideCard(
  targetRect,
  cardSize = DEFAULT_CARD_SIZE,
  viewport = DEFAULT_VIEWPORT,
  gap = 12
) {
  const vw = Number(viewport?.width) > 0 ? Number(viewport.width) : DEFAULT_VIEWPORT.width
  const vh = Number(viewport?.height) > 0 ? Number(viewport.height) : DEFAULT_VIEWPORT.height
  const margin = Math.min(WINDOW_MARGIN, Math.max(8, Math.floor(Math.min(vw, vh) * 0.04)))
  const cw = Math.min(
    Number(cardSize?.width) > 0 ? Number(cardSize.width) : DEFAULT_CARD_SIZE.width,
    Math.max(160, vw - margin * 2)
  )
  const ch = Math.min(
    Number(cardSize?.height) > 0 ? Number(cardSize.height) : DEFAULT_CARD_SIZE.height,
    Math.max(120, vh - margin * 2)
  )
  const maxLeft = Math.max(margin, vw - cw - margin)
  const maxTop = Math.max(margin, vh - ch - margin)

  const clipped = clipRectToViewport(
    targetRect &&
      Number.isFinite(Number(targetRect.left)) &&
      Number.isFinite(Number(targetRect.top)) &&
      Number(targetRect.width) > 0 &&
      Number(targetRect.height) > 0
      ? {
          left: Number(targetRect.left),
          top: Number(targetRect.top),
          width: Number(targetRect.width),
          height: Number(targetRect.height),
          right: Number(targetRect.left) + Number(targetRect.width),
          bottom: Number(targetRect.top) + Number(targetRect.height),
        }
      : null,
    { width: vw, height: vh }
  )

  if (!clipped) {
    return {
      centered: true,
      side: 'center',
      left: Math.round(clamp((vw - cw) / 2, margin, maxLeft)),
      top: Math.round(clamp((vh - ch) / 2, margin, maxTop)),
      outline: null,
    }
  }

  const oLeft = clamp(Math.round(clipped.left), 2, Math.max(2, vw - 4))
  const oTop = clamp(Math.round(clipped.top), 2, Math.max(2, vh - 4))
  const oRight = clamp(Math.round(clipped.right), oLeft + 2, Math.max(oLeft + 2, vw - 2))
  const oBottom = clamp(Math.round(clipped.bottom), oTop + 2, Math.max(oTop + 2, vh - 2))
  const outline = {
    left: oLeft,
    top: oTop,
    width: oRight - oLeft,
    height: oBottom - oTop,
  }

  const roomBottom = vh - margin - oBottom
  const roomTop = oTop - margin
  const roomRight = vw - margin - oRight
  const roomLeft = oLeft - margin

  const candidates =
    outline.width >= vw * 0.55
      ? [
          { side: 'bottom', fits: roomBottom >= ch + gap, room: roomBottom },
          { side: 'top', fits: roomTop >= ch + gap, room: roomTop },
          { side: 'right', fits: roomRight >= cw + gap, room: roomRight },
          { side: 'left', fits: roomLeft >= cw + gap, room: roomLeft },
        ]
      : [
          { side: 'right', fits: roomRight >= cw + gap, room: roomRight },
          { side: 'left', fits: roomLeft >= cw + gap, room: roomLeft },
          { side: 'bottom', fits: roomBottom >= ch + gap, room: roomBottom },
          { side: 'top', fits: roomTop >= ch + gap, room: roomTop },
        ]

  const chosen =
    candidates.find((item) => item.fits) ??
    [...candidates].sort((a, b) => b.room - a.room)[0]

  let left = (vw - cw) / 2
  let top = (vh - ch) / 2
  if (chosen.side === 'bottom') {
    left = oLeft
    top = oBottom + gap
  } else if (chosen.side === 'top') {
    left = oLeft
    top = oTop - ch - gap
  } else if (chosen.side === 'right') {
    left = oRight + gap
    top = oTop
  } else if (chosen.side === 'left') {
    left = oLeft - cw - gap
    top = oTop
  }

  return {
    centered: false,
    side: chosen.side,
    left: Math.round(clamp(left, margin, maxLeft)),
    top: Math.round(clamp(top, margin, maxTop)),
    outline,
  }
}
