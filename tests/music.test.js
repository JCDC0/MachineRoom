import { EventEmitter } from 'node:events'
import { createReadStream, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  MUSIC_LIMIT,
  createMusicApi,
  isSafeMusicName,
  listMusic,
  musicFolderFor,
  musicTrackNames,
  musicType,
  parseRange,
} from '../server/music.js'
import { getJson, startLaneBridge } from './helpers/bridge.js'
import { makeTempDir } from './helpers/tempRoot.js'

const cleanups = []

afterEach(async () => {
  while (cleanups.length > 0) {
    const cleanup = cleanups.pop()
    try {
      await cleanup()
    } catch {}
  }
})

function tempDir(prefix = 'mr-music-') {
  const dir = makeTempDir(prefix)
  cleanups.push(() => rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }))
  return dir
}

function musicFolder() {
  const dir = tempDir()
  mkdirSync(join(dir, 'nested'), { recursive: true })
  writeFileSync(join(dir, 'beta.mp3'), 'abcdef')
  writeFileSync(join(dir, 'alpha.ogg'), 'ogg')
  writeFileSync(join(dir, 'notes.txt'), 'not music')
  writeFileSync(join(dir, 'nested', 'inner.wav'), 'wav')
  return dir
}

async function bridgeFor(folder = musicFolder()) {
  const started = await startLaneBridge({ bridge: { musicFolder: folder } })
  cleanups.push(() => started.stop())
  return { url: started.url, folder }
}

describe('the music folder', () => {
  it('resolves from the install folder, then the environment, then the option', () => {
    const install = tempDir()
    expect(musicFolderFor({ env: {}, installFolder: install })).toBe(join(resolve(install), 'music'))
    const override = tempDir()
    expect(musicFolderFor({ env: { MACHINEROOM_MUSIC: override }, installFolder: install })).toBe(resolve(override))
    const chosen = tempDir()
    expect(musicFolderFor({ folder: chosen, env: { MACHINEROOM_MUSIC: override }, installFolder: install })).toBe(resolve(chosen))
  })

  it('lists the audio files by name and leaves out the rest', () => {
    expect(musicTrackNames(['b.mp3', 'a.ogg', 'notes.txt', 'C.FLAC', 'x.wav', 'y.m4a', 'z.opus', 'no'])).toEqual([
      'C.FLAC',
      'a.ogg',
      'b.mp3',
      'x.wav',
      'y.m4a',
      'z.opus',
    ])
    const many = Array.from({ length: MUSIC_LIMIT + 5 }, (_, index) => `${String(index).padStart(4, '0')}.mp3`)
    expect(musicTrackNames(many)).toHaveLength(MUSIC_LIMIT)
    expect(musicTrackNames(null)).toEqual([])
  })

  it('returns only files at the top of a folder', async () => {
    const folder = musicFolder()
    expect(await listMusic(folder)).toEqual(['alpha.ogg', 'beta.mp3'])
    expect(await listMusic(join(folder, 'missing'))).toEqual([])
  })

  it('refuses a separator or a parent link in a name', () => {
    expect(isSafeMusicName('song.mp3')).toBe(true)
    expect(isSafeMusicName('a song.mp3')).toBe(true)
    expect(isSafeMusicName('..')).toBe(false)
    expect(isSafeMusicName('../song.mp3')).toBe(false)
    expect(isSafeMusicName('a/song.mp3')).toBe(false)
    expect(isSafeMusicName('a\\song.mp3')).toBe(false)
    expect(isSafeMusicName('')).toBe(false)
    expect(isSafeMusicName(null)).toBe(false)
  })

  it('gives each extension its content type', () => {
    expect(musicType('a.mp3')).toBe('audio/mpeg')
    expect(musicType('a.ogg')).toBe('audio/ogg')
    expect(musicType('a.wav')).toBe('audio/wav')
    expect(musicType('a.m4a')).toBe('audio/mp4')
    expect(musicType('a.flac')).toBe('audio/flac')
    expect(musicType('a.opus')).toBe('audio/ogg')
    expect(musicType('a.txt')).toBe('application/octet-stream')
  })

  it('reads a byte range or marks it unsatisfiable', () => {
    expect(parseRange('bytes=1-3', 6)).toEqual({ start: 1, end: 3 })
    expect(parseRange('bytes=2-', 6)).toEqual({ start: 2, end: 5 })
    expect(parseRange('bytes=-2', 6)).toEqual({ start: 4, end: 5 })
    expect(parseRange('bytes=4-99', 6)).toEqual({ start: 4, end: 5 })
    expect(parseRange('bytes=99-', 6)).toEqual({ unsatisfiable: true })
    expect(parseRange('bytes=3-2', 6)).toEqual({ unsatisfiable: true })
    expect(parseRange('bytes=0-1,3-4', 6)).toEqual({ unsatisfiable: true })
    expect(parseRange('items=0-1', 6)).toBeNull()
  })
})

describe('the music routes', () => {
  it('lists the tunes and the folder', async () => {
    const { url, folder } = await bridgeFor()
    const answer = await getJson(`${url}/api/music`)
    expect(answer.status).toBe(200)
    expect(answer.body).toEqual({ folder: resolve(folder), tracks: ['alpha.ogg', 'beta.mp3'] })
  })

  it('serves a file with its type and supports a byte range', async () => {
    const { url } = await bridgeFor()
    const whole = await fetch(`${url}/music/beta.mp3`)
    expect(whole.status).toBe(200)
    expect(whole.headers.get('content-type')).toBe('audio/mpeg')
    expect(whole.headers.get('accept-ranges')).toBe('bytes')
    expect(await whole.text()).toBe('abcdef')

    const part = await fetch(`${url}/music/beta.mp3`, { headers: { Range: 'bytes=1-3' } })
    expect(part.status).toBe(206)
    expect(part.headers.get('content-range')).toBe('bytes 1-3/6')
    expect(part.headers.get('content-length')).toBe('3')
    expect(await part.text()).toBe('bcd')

    const suffix = await fetch(`${url}/music/beta.mp3`, { headers: { Range: 'bytes=-2' } })
    expect(suffix.status).toBe(206)
    expect(await suffix.text()).toBe('ef')
  })

  it('answers 416 for a range past the end', async () => {
    const { url } = await bridgeFor()
    const answer = await fetch(`${url}/music/beta.mp3`, { headers: { Range: 'bytes=99-' } })
    expect(answer.status).toBe(416)
    expect(answer.headers.get('content-range')).toBe('bytes */6')
  })

  it('answers 404 for a missing file and 400 for a separator or parent link', async () => {
    const { url } = await bridgeFor()
    expect((await fetch(`${url}/music/missing.mp3`)).status).toBe(404)
    expect((await fetch(`${url}/music/%2e%2e%2fsecret.mp3`)).status).toBe(400)
    expect((await fetch(`${url}/music/a%5Cb.mp3`)).status).toBe(400)
  })

  it('answers an empty list with the folder still named', async () => {
    const folder = tempDir()
    const { url } = await bridgeFor(folder)
    const answer = await getJson(`${url}/api/music`)
    expect(answer.status).toBe(200)
    expect(answer.body).toEqual({ folder: resolve(folder), tracks: [] })
  })

  it('destroys its file stream when the response closes', async () => {
    const dir = tempDir()
    const file = join(dir, 'test.mp3')
    writeFileSync(file, 'sample music content')
    let stream = null
    const api = createMusicApi({
      folder: dir,
      createStream: (filePath, options) => {
        stream = createReadStream(filePath, options)
        return stream
      },
    })
    const res = new EventEmitter()
    res.writeHead = () => {}
    res.write = () => true
    res.end = () => {}
    res.destroy = () => {}
    const req = { method: 'GET', headers: {} }
    await api.handle(req, res, new URL('http://localhost/music/test.mp3'))

    expect(stream).not.toBeNull()
    expect(stream.destroyed).toBe(false)
    res.emit('close')
    expect(stream.destroyed).toBe(true)
  })
})
