import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import Notice, { NOTHING_RECORDED } from '../src/ui/Notice.jsx'

describe('Notice empty state', () => {
  it('says the replay starts with the first conversation', () => {
    const html = renderToString(createElement(Notice, { status: 'empty' }))
    expect(NOTHING_RECORDED).toBe('Nothing recorded yet. Replay starts with the first conversation.')
    expect(html).toContain(NOTHING_RECORDED)
  })
})
