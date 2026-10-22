import * as THREE from 'three'
import { still } from './sprites.js'

const WIDTH = 512
const HEIGHT = 64
const LIFE = 2.6
const FADE = 0.8
const RISE = 16
const LIMIT = 30
const NEAR = 260
const STACK = 78

export function createLabels(scene, count = 16) {
  const items = Array.from({ length: count }, () => {
    const canvas = document.createElement('canvas')
    canvas.width = WIDTH
    canvas.height = HEIGHT
    const texture = new THREE.CanvasTexture(canvas)
    const sprite = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false, depthTest: false, opacity: 0 })
    )
    sprite.scale.set(WIDTH * 1.1, HEIGHT * 1.1, 1)
    sprite.visible = false
    sprite.renderOrder = 10
    scene.add(sprite)
    return { sprite, canvas, texture, life: 0 }
  })

  function show(text, position, color = '#ffffff') {
    const item = items.find((entry) => entry.life <= 0) ?? items.reduce((a, b) => (a.life < b.life ? a : b))
    const shown = text.length > LIMIT ? `${text.slice(0, LIMIT - 1)}~` : text
    const context = item.canvas.getContext('2d')
    context.clearRect(0, 0, WIDTH, HEIGHT)
    context.font = '30px "Space Mono", monospace'
    context.textAlign = 'center'
    context.textBaseline = 'middle'
    const plate = Math.ceil(context.measureText(shown).width) + 24
    context.fillStyle = 'rgba(0,0,0,0.78)'
    context.fillRect((WIDTH - plate) / 2, 8, plate, HEIGHT - 16)
    context.strokeStyle = color
    context.globalAlpha = 0.6
    context.strokeRect((WIDTH - plate) / 2, 8, plate, HEIGHT - 16)
    context.globalAlpha = 1
    context.fillStyle = color
    context.fillText(shown, WIDTH / 2, HEIGHT / 2 + 1)
    item.texture.needsUpdate = true
    const crowd = items.filter(
      (entry) => entry !== item && entry.life > 0 && entry.sprite.position.distanceTo(position) < NEAR
    ).length
    item.sprite.position.copy(position)
    item.sprite.position.y += 80 + crowd * STACK
    item.sprite.material.opacity = 1
    item.sprite.visible = true
    item.life = LIFE
  }

  function update(delta) {
    const isStill = still()
    for (const item of items) {
      if (item.life <= 0) continue
      item.life -= delta
      if (item.life <= 0) {
        item.sprite.visible = false
        continue
      }
      if (!isStill) {
        item.sprite.position.y += delta * RISE
      }
      item.sprite.material.opacity = Math.min(1, item.life / FADE)
    }
  }

  function clear() {
    for (const item of items) {
      item.life = 0
      item.sprite.visible = false
    }
  }

  function dispose() {
    for (const item of items) {
      scene.remove(item.sprite)
      item.texture.dispose()
      item.sprite.material.dispose()
    }
  }

  return { show, update, clear, dispose }
}
