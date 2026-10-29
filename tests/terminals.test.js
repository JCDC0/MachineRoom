import { describe, expect, it } from 'vitest'
import { CHIP_SIDE_DEAD_BAND, addressIn, addressUrl, chipSideFromScreen, consoleRows } from '../src/engine/terminals.js'

const line = (text, tone = 'normal') => ({ text, tone })

describe('chipSideFromScreen', () => {
  it('puts the chip on the side away from the hub', () => {
    expect(chipSideFromScreen(420, 300, 1)).toBe(1)
    expect(chipSideFromScreen(180, 300, -1)).toBe(-1)
  })

  it('follows the agent across the hub', () => {
    expect(chipSideFromScreen(260, 300, 1)).toBe(-1)
    expect(chipSideFromScreen(340, 300, -1)).toBe(1)
  })

  it('keeps the previous side inside the dead band', () => {
    expect(chipSideFromScreen(300 + CHIP_SIDE_DEAD_BAND, 300, -1)).toBe(-1)
    expect(chipSideFromScreen(300 - CHIP_SIDE_DEAD_BAND, 300, 1)).toBe(1)
    expect(chipSideFromScreen(300, 300, -1)).toBe(-1)
  })

  it('switches once the gap is past the dead band', () => {
    expect(chipSideFromScreen(300 + CHIP_SIDE_DEAD_BAND + 1, 300, -1)).toBe(1)
    expect(chipSideFromScreen(300 - CHIP_SIDE_DEAD_BAND - 1, 300, 1)).toBe(-1)
  })

  it('takes another dead band', () => {
    expect(chipSideFromScreen(305, 300, -1, 2)).toBe(1)
    expect(chipSideFromScreen(305, 300, -1, 10)).toBe(-1)
  })

  it('keeps the previous side when a point is not on screen', () => {
    expect(chipSideFromScreen(null, 300, -1)).toBe(-1)
    expect(chipSideFromScreen(NaN, 300, 1)).toBe(1)
    expect(chipSideFromScreen(500, undefined, -1)).toBe(-1)
  })

  it('defaults to the right for an unknown previous side', () => {
    expect(chipSideFromScreen(300, 300, 0)).toBe(1)
    expect(chipSideFromScreen(300, 300, undefined)).toBe(1)
  })
})

describe('consoleRows', () => {
  it('keeps the last five lines by default', () => {
    const lines = [1, 2, 3, 4, 5, 6, 7].map((n) => line(`line ${n}`))
    expect(consoleRows(lines).map((row) => row.text)).toEqual(['line 3', 'line 4', 'line 5', 'line 6', 'line 7'])
  })

  it('keeps every line when there are fewer than the limit', () => {
    const lines = [line('one'), line('two')]
    expect(consoleRows(lines)).toEqual(lines)
  })

  it('takes a smaller limit', () => {
    const lines = [line('one'), line('two'), line('three')]
    expect(consoleRows(lines, 2).map((row) => row.text)).toEqual(['two', 'three'])
  })

  it('answers an empty array for no lines', () => {
    expect(consoleRows([])).toEqual([])
    expect(consoleRows(null)).toEqual([])
    expect(consoleRows(undefined)).toEqual([])
    expect(consoleRows([line('one')], 0)).toEqual([])
  })

  it('leaves the input alone', () => {
    const lines = [line('one'), line('two')]
    const rows = consoleRows(lines, 1)
    expect(rows).toHaveLength(1)
    expect(lines).toHaveLength(2)
    expect(rows).not.toBe(lines)
  })
})

describe('addressIn', () => {
  it('finds a plain web address', () => {
    expect(addressIn('Local: http://localhost:5173/')).toBe('http://localhost:5173/')
  })

  it('finds https', () => {
    expect(addressIn('ready at https://example.com/room?x=1')).toBe('https://example.com/room?x=1')
  })

  it('drops the punctuation around a web address', () => {
    expect(addressIn('the dev server is up (http://localhost:5173/park).')).toBe('http://localhost:5173/park')
  })

  it('finds a localhost port inside a sentence', () => {
    expect(addressIn('  server listening on localhost:3000 for requests')).toBe('localhost:3000')
  })

  it('finds a loopback address and port', () => {
    expect(addressIn('go to 127.0.0.1:8080')).toBe('127.0.0.1:8080')
  })

  it('finds an ipv6 loopback and port', () => {
    expect(addressIn('[::1]:5174 ready')).toBe('[::1]:5174')
  })

  it('finds a bare port inside a sentence', () => {
    expect(addressIn('vite is running at :5173 now')).toBe(':5173')
  })

  it('finds the first address on a line', () => {
    expect(addressIn('dev http://localhost:5173 and api http://localhost:4000')).toBe('http://localhost:5173')
  })

  it('answers null for a line with no address', () => {
    expect(addressIn('Test Files  42 passed (42)')).toBeNull()
    expect(addressIn('Duration  1.23s')).toBeNull()
    expect(addressIn('')).toBeNull()
    expect(addressIn(null)).toBeNull()
  })

  it('does not read a clock as a port', () => {
    expect(addressIn('started at 10:30 and finished at 10:31')).toBeNull()
  })

  it('skips a clock and still finds the port after it', () => {
    expect(addressIn('started at 10:30 on :5173')).toBe(':5173')
  })
})

describe('addressUrl', () => {
  it('keeps a full http or https address', () => {
    expect(addressUrl('http://localhost:5173/')).toBe('http://localhost:5173/')
    expect(addressUrl('https://example.com/room?x=1')).toBe('https://example.com/room?x=1')
  })

  it('adds http to a local host and port', () => {
    expect(addressUrl('localhost:5173')).toBe('http://localhost:5173')
    expect(addressUrl('127.0.0.1:8080')).toBe('http://127.0.0.1:8080')
    expect(addressUrl('[::1]:3000')).toBe('http://[::1]:3000')
  })

  it('turns a bare port into a localhost address', () => {
    expect(addressUrl(':5173')).toBe('http://localhost:5173')
  })

  it('answers the url for an addressIn value', () => {
    expect(addressUrl(addressIn('Local: http://localhost:5173/'))).toBe('http://localhost:5173/')
    expect(addressUrl(addressIn('vite is running at :5173 now'))).toBe('http://localhost:5173')
  })

  it('refuses another scheme', () => {
    expect(addressUrl('ftp://example.com/room')).toBeNull()
    expect(addressUrl('file:///C:/room')).toBeNull()
    expect(addressUrl('javascript:alert(1)')).toBeNull()
  })

  it('refuses a value with spaces or no address', () => {
    expect(addressUrl('http://localhost:5173/a b')).toBeNull()
    expect(addressUrl('localhost:5173 room')).toBeNull()
    expect(addressUrl('example.com:8080')).toBeNull()
    expect(addressUrl('')).toBeNull()
    expect(addressUrl(null)).toBeNull()
    expect(addressUrl(42)).toBeNull()
  })

  it('refuses a full address that cannot be parsed', () => {
    expect(addressUrl('http://')).toBeNull()
    expect(addressUrl('https://')).toBeNull()
  })

  it('refuses a port out of range', () => {
    expect(addressUrl('localhost:70000')).toBeNull()
    expect(addressUrl(':0')).toBeNull()
  })
})
