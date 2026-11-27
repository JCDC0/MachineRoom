import * as THREE from 'three'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { DOING_LABEL_Y, MODEL_LABEL_Y, NAME_LABEL_Y, createAgents } from '../src/engine/agents.js'
import { textSprite } from '../src/engine/sprites.js'

const drawn = []
const context2d = {
  font: '',
  fillStyle: '',
  measureText: (text) => ({ width: String(text).length * 10 }),
  fillRect: () => {},
  fillText: (text) => drawn.push(String(text)),
}

function element(tag) {
  if (tag === 'canvas') return { width: 0, height: 0, style: {}, getContext: () => context2d }
  const node = {
    className: '',
    textContent: '',
    style: {},
    dataset: {},
    children: [],
    append(...items) {
      node.children.push(...items)
    },
    remove() {},
    setAttribute() {},
    classList: { add() {}, remove() {}, contains: () => false },
  }
  return node
}

let savedDocument

beforeAll(() => {
  savedDocument = globalThis.document
  globalThis.document = { createElement: element }
})

afterAll(() => {
  globalThis.document = savedDocument
})

describe('a text sprite', () => {
  it('draws in Space Mono at weight 400', () => {
    textSprite('Alpha', { scale: 1 })
    expect(context2d.font).toBe('400 28px "Space Mono", monospace')
  })

  it('redraws its canvas with new text and leaves the same text alone', () => {
    drawn.length = 0
    const sprite = textSprite('Alpha', { scale: 1 })
    expect(drawn.at(-1)).toBe('Alpha')
    expect(sprite.userData.setText('Bridge Coder')).toBe(true)
    expect(drawn.at(-1)).toBe('Bridge Coder')
    expect(sprite.userData.setText('Bridge Coder')).toBe(false)
    expect(drawn.at(-1)).toBe('Bridge Coder')
  })
})

describe('agent labels', () => {
  it('updates the floating name sprite as well as the callout', () => {
    const agents = createAgents(new THREE.Scene(), [{ key: 'a', name: 'Alpha', shape: 'claude' }])
    const view = agents.views.get('a')
    drawn.length = 0

    agents.setLabels(new Map([['a', 'Bridge Coder']]))
    expect(view.callout.title.textContent).toBe('CLAUDE CODE BRIDGE CODER')
    expect(drawn).toContain('CLAUDE CODE BRIDGE CODER')

    agents.setLabels(null)
    expect(view.callout.title.textContent).toBe('CLAUDE CODE ALPHA')
    expect(drawn.at(-1)).toBe('CLAUDE CODE ALPHA')
    agents.dispose()
  })
})

describe('the name above and the model below', () => {
  it('puts the name over the shape and the model with its effort under it, above the status line', () => {
    drawn.length = 0
    const agents = createAgents(new THREE.Scene(), [{ key: 'codex3', name: 'Codex 3', shape: 'codex', model: 'gpt-6.2-sol', effort: 'high' }])
    const view = agents.views.get('codex3')
    expect(NAME_LABEL_Y).toBeGreaterThan(0)
    expect(MODEL_LABEL_Y).toBeLessThan(0)
    expect(DOING_LABEL_Y).toBeLessThan(MODEL_LABEL_Y)
    expect(view.label.position.y).toBe(NAME_LABEL_Y)
    expect(view.modelText.position.y).toBe(MODEL_LABEL_Y)
    expect(view.doing.position.y).toBe(DOING_LABEL_Y)
    expect(drawn).toContain('CODEX 3')
    expect(drawn).toContain('GPT-6.2-SOL · HIGH')
    agents.dispose()
  })

})
