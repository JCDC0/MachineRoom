import * as THREE from 'three'
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js'
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js'
import { CopyShader } from 'three/addons/shaders/CopyShader.js'

export const BLOOM_STRENGTH_DEFAULT = 0.4
export const BLOOM_THRESHOLD = 0.15
export const BLOOM_RADIUS = 0.4

function pixelSpan(width, height, pixelRatio) {
  const ratio = Number.isFinite(pixelRatio) && pixelRatio > 0 ? pixelRatio : 1
  return {
    width: Math.max(1, Math.round(width * ratio)),
    height: Math.max(1, Math.round(height * ratio)),
  }
}

function copyMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: THREE.UniformsUtils.clone(CopyShader.uniforms),
    vertexShader: CopyShader.vertexShader,
    fragmentShader: [
      'uniform sampler2D tDiffuse;',
      'varying vec2 vUv;',
      '',
      'void main() {',
      '  gl_FragColor = texture2D( tDiffuse, vUv );',
      '  #include <colorspace_fragment>',
      '}',
    ].join('\n'),
    premultipliedAlpha: true,
    transparent: true,
    depthTest: false,
    depthWrite: false,
  })
}

export function createBloomLayer({
  container,
  scene,
  camera,
  width = 1,
  height = 1,
  pixelRatio = 1,
  strength = BLOOM_STRENGTH_DEFAULT,
  createRenderer = null,
}) {
  let spanWidth = Math.max(1, Math.round(width))
  let spanHeight = Math.max(1, Math.round(height))
  let disposed = false
  const pixels = pixelSpan(spanWidth, spanHeight, pixelRatio)

  const renderer = createRenderer
    ? createRenderer({ alpha: true, antialias: false })
    : new THREE.WebGLRenderer({ alpha: true, antialias: false, powerPreference: 'high-performance' })
  renderer.setClearColor(0x000000, 0)
  renderer.setPixelRatio(pixelRatio)
  renderer.setSize(spanWidth, spanHeight)
  renderer.domElement.className = 'screen-bloom'
  container.appendChild(renderer.domElement)

  const target = new THREE.WebGLRenderTarget(pixels.width, pixels.height, {
    type: THREE.HalfFloatType,
    depthBuffer: true,
    stencilBuffer: false,
  })
  const pass = new UnrealBloomPass(
    new THREE.Vector2(pixels.width, pixels.height),
    strength,
    BLOOM_RADIUS,
    BLOOM_THRESHOLD
  )
  const material = copyMaterial()
  const quad = new FullScreenQuad(material)

  function render() {
    if (disposed) return
    renderer.setRenderTarget(target)
    renderer.clear()
    renderer.render(scene, camera)
    pass.render(renderer, null, target, 0, false)
    material.uniforms.tDiffuse.value = pass.renderTargetsHorizontal[0].texture
    renderer.setRenderTarget(null)
    renderer.clear()
    quad.render(renderer)
  }

  function resize(nextWidth, nextHeight) {
    if (disposed) return
    spanWidth = Math.max(1, Math.round(Number(nextWidth) || 1))
    spanHeight = Math.max(1, Math.round(Number(nextHeight) || 1))
    const next = pixelSpan(spanWidth, spanHeight, pixelRatio)
    renderer.setSize(spanWidth, spanHeight)
    target.setSize(next.width, next.height)
    pass.setSize(next.width, next.height)
  }

  function setStrength(next) {
    const value = Number(next)
    pass.strength = Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : BLOOM_STRENGTH_DEFAULT
  }

  function dispose() {
    if (disposed) return
    disposed = true
    pass.dispose()
    target.dispose()
    material.dispose()
    quad.dispose()
    renderer.dispose()
    renderer.forceContextLoss?.()
    container.removeChild(renderer.domElement)
  }

  return {
    render,
    resize,
    setStrength,
    dispose,
    screen: renderer.domElement,
    strength: () => pass.strength,
  }
}
