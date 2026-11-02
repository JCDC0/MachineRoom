import { useEffect, useRef } from 'react'

export const LOG_BOTTOM_SLACK = 24

export function atLogBottom(node, slack = LOG_BOTTOM_SLACK) {
  if (!node) return true
  const height = Number(node.scrollHeight)
  const top = Number(node.scrollTop)
  const view = Number(node.clientHeight)
  if (!Number.isFinite(height) || !Number.isFinite(top) || !Number.isFinite(view)) return true
  return height - top - view <= slack
}

export function useLogFollow(active, length) {
  const ref = useRef(null)
  const stickRef = useRef(true)

  useEffect(() => {
    if (active) stickRef.current = true
  }, [active])

  useEffect(() => {
    if (!active) return
    const node = ref.current
    if (!node || !stickRef.current) return
    node.scrollTop = node.scrollHeight
  }, [active, length])

  function onScroll(event) {
    const node = event?.currentTarget ?? ref.current
    stickRef.current = atLogBottom(node)
  }

  return { ref, onScroll }
}
